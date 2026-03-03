"""Kindle アダプタ — Amazonログイン または ローカルファイルから蔵書情報を取得"""
from __future__ import annotations

import html
import json
import logging
import os
import plistlib
import re
import sqlite3
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Optional

import requests

from adapters.base import BookRecord, LibraryAdapter, LibraryCredentials

logger = logging.getLogger(__name__)

AMAZON_JP = "https://www.amazon.co.jp"

APP_DIR = Path(__file__).resolve().parent.parent

# yonda/data 内の BookData.sqlite（最優先）
_YONDA_DATA_BOOKDATA = APP_DIR / "data" / "BookData.sqlite"

# デフォルトパス（環境変数で上書き可能）
_KINDLE_XML_PATHS = [
    Path(os.environ.get(
        "YONDA_KINDLE_XML_PATH",
        str(Path.home() / "Library/Containers/com.amazon.Kindle/Data/Library/Application Support/Kindle/Cache/KindleSyncMetadataCache.xml"),
    )),
    Path.home() / "Library/Application Support/Kindle/Cache/KindleSyncMetadataCache.xml",
]

_KINDLE_SQLITE_PATHS = [
    _YONDA_DATA_BOOKDATA,
    Path(os.environ.get(
        "YONDA_KINDLE_SQLITE_PATH",
        str(Path.home() / "Library/Containers/com.amazon.Lassen/Data/Library/Protected/BookData.sqlite"),
    )),
    Path.home() / "Library/Containers/com.amazon.Lassen/Data/Library/Protected/BookData.sqlite",
    Path.home() / "Library/Containers/Kindle/Data/Library/Protected/Protected/BookData.sqlite",
    Path.home() / "Library/Containers/com.amazon.Kindle/Data/Library/Protected/BookData.sqlite",
]


class KindleAdapter(LibraryAdapter):
    """Kindle 蔵書アダプタ。Amazonログイン または KindleSyncMetadataCache.xml / BookData.sqlite から取得。"""

    @property
    def library_id(self) -> str:
        return "kindle"

    @property
    def library_name(self) -> str:
        return "Kindle"

    @property
    def library_url(self) -> str:
        return "https://www.amazon.co.jp/kindle"

    @property
    def needs_credentials(self) -> bool:
        return False  # 認証は任意（Amazonログイン or ローカルファイル）

    def login(self, session: Optional[requests.Session], credentials: Optional[LibraryCredentials]) -> bool:
        if session and credentials and credentials.user_id and credentials.password:
            ok, _, _ = self._login_amazon(session, credentials)
            return ok
        path = self._find_data_path()
        if path:
            logger.info("Kindle データファイルを検出: %s", path)
            return True
        logger.error(
            "Kindle データファイルが見つかりません。"
            "Amazon にログインするか、Kindle for PC/Mac を起動して同期するか、"
            "環境変数 YONDA_KINDLE_XML_PATH または YONDA_KINDLE_SQLITE_PATH でパスを指定してください。"
        )
        return False

    def fetch_history(self, session: Optional[requests.Session]) -> list[BookRecord]:
        if session:
            return self._fetch_from_amazon(session)
        path = self._find_data_path()
        if not path:
            raise RuntimeError("Kindle データファイルが見つかりません")

        if path.suffix == ".xml":
            return self._fetch_from_xml(path)
        return self._fetch_from_sqlite(path)

    def _login_amazon(
        self, session: requests.Session, credentials: LibraryCredentials
    ) -> tuple[bool, bool, Optional[str]]:
        """Amazon にログイン。戻り値: (成功, OTP必要, OTPページHTML)"""
        try:
            from bs4 import BeautifulSoup
        except ImportError:
            logger.error("BeautifulSoup4 が必要です: pip install beautifulsoup4")
            return False, False, None

        session.headers.update({
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
        })

        r = session.get(AMAZON_JP + "/gp/digital/fiona/manage", timeout=30)
        soup = BeautifulSoup(r.content, "html.parser")

        form = soup.find("form", id="signInForm")
        if form is None:
            form = soup.find("form", action=re.compile(r"signin", re.I))
        if form is None:
            for f in soup.find_all("form"):
                if f.find("input", {"name": "email"}) or f.find("input", {"name": "ap_email"}):
                    form = f
                    break
        if form is None:
            form = soup.find("form")

        form_values: dict[str, str] = {}
        if form:
            for inp in form.find_all("input"):
                name = inp.get("name")
                if name and inp.get("type") not in ("submit", "image"):
                    form_values[name] = inp.get("value", "")

        form_values["email"] = credentials.user_id.strip()
        form_values["password"] = credentials.password
        if "ap_email" in form_values:
            form_values["ap_email"] = credentials.user_id.strip()
        if "ap_password" in form_values:
            form_values["ap_password"] = credentials.password

        signin_url = AMAZON_JP + "/ap/signin"
        if form and form.get("action"):
            action = form["action"].strip()
            if action.startswith("/"):
                signin_url = AMAZON_JP + action
            elif action.startswith("http"):
                signin_url = action

        r = session.post(signin_url, data=form_values, allow_redirects=True, timeout=30)
        soup = BeautifulSoup(r.content, "html.parser")

        if soup.find(class_=re.compile(r"message\s+error")):
            logger.error("Amazon ログイン失敗: メールアドレスまたはパスワードが正しくありません")
            return False, False, None
        if soup.find(id="ap_captcha_img") or soup.find(id="auth-captcha-image-container"):
            logger.error("Amazon ログイン失敗: CAPTCHA が表示されています。ブラウザでログインしてから再試行してください。")
            return False, False, None

        # OTP/2段階認証ページの検出
        otp_input = soup.find("input", {"name": re.compile(r"otp|code|auth", re.I)})
        if otp_input or re.search(r"otp|ワンタイム|認証コード|2段階", r.text or "", re.I):
            logger.info("Amazon OTP 入力が必要です")
            return False, True, r.text

        if "signin" in r.url.lower() and "fiona" not in r.url.lower() and "digital" not in r.url.lower():
            logger.error("Amazon ログイン失敗: サインインが完了しませんでした")
            return False, False, None

        logger.info("Amazon ログイン成功")
        return True, False, None

    def submit_otp(
        self, session: requests.Session, otp: str, otp_page_html: Optional[str] = None
    ) -> bool:
        """OTP を送信してログインを完了。otp_page_html は OTP ページの HTML（省略時は再取得を試行）"""
        try:
            from bs4 import BeautifulSoup
        except ImportError:
            return False

        if otp_page_html:
            soup = BeautifulSoup(otp_page_html, "html.parser")
        else:
            r = session.get(AMAZON_JP + "/ap/signin", timeout=30)
            soup = BeautifulSoup(r.content, "html.parser")

        form = soup.find("form", id="auth-mfa-otp-form") or soup.find("form", action=re.compile(r"signin|otp", re.I))
        if form is None:
            for f in soup.find_all("form"):
                if f.find("input", {"name": re.compile(r"otp|code", re.I)}):
                    form = f
                    break
        if form is None:
            form = soup.find("form")

        form_values: dict[str, str] = {}
        if form:
            for inp in form.find_all("input"):
                name = inp.get("name")
                if name and inp.get("type") not in ("submit", "image"):
                    form_values[name] = inp.get("value", "")

        otp_key = None
        for inp in (form.find_all("input") if form else []):
            n = inp.get("name", "")
            if n and re.search(r"otp|code", n, re.I):
                otp_key = n
                break
        if otp_key:
            form_values[otp_key] = otp.strip()

        signin_url = AMAZON_JP + "/ap/signin"
        if form and form.get("action"):
            action = form["action"].strip()
            signin_url = (AMAZON_JP + action) if action.startswith("/") else action

        r = session.post(signin_url, data=form_values, allow_redirects=True, timeout=30)
        soup = BeautifulSoup(r.content, "html.parser")

        if soup.find(class_=re.compile(r"message\s+error")):
            logger.error("OTP が正しくありません")
            return False
        if "signin" in r.url.lower() and "fiona" not in r.url.lower() and "digital" not in r.url.lower():
            return False

        logger.info("Amazon OTP 認証成功")
        return True

    def _fetch_from_amazon(self, session: requests.Session) -> list[BookRecord]:
        """Amazon FIONA API から購入済み Kindle タイトルを取得"""
        books: list[BookRecord] = []
        offset = 0
        count = 100
        seen_asins: set[str] = set()

        # FIONA 管理ページにアクセスしてセッションを確立（API 呼び出し前に必要）
        try:
            r = session.get(AMAZON_JP + "/gp/digital/fiona/manage", timeout=30)
            r.raise_for_status()
            if "signin" in r.url.lower() and "fiona" not in r.url.lower():
                raise RuntimeError(
                    "ログインセッションが切れています。もう一度「読書記録を取得」からやり直してください。"
                )
        except requests.RequestException as e:
            logger.warning("FIONA 管理ページ取得: %s", e)

        api_url = AMAZON_JP + "/gp/digital/fiona/manage/features/order-history/ajax/queryOwnership_refactored2.html"
        ajax_headers = {
            "X-Requested-With": "XMLHttpRequest",
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        }

        while True:
            try:
                r = session.post(
                    api_url,
                    data={"offset": offset, "count": count},
                    headers=ajax_headers,
                    timeout=30,
                )
                r.raise_for_status()
                raw = re.sub(r"[\x00-\x1f]", "", r.text)
                raw_stripped = raw.strip()
                if raw_stripped.startswith("<") or "<!DOCTYPE" in raw_stripped[:50]:
                    raise ValueError(
                        "API が HTML を返しました（ログインが必要な可能性）。"
                        "Kindle for Mac を起動して蔵書を同期した後、ローカルファイルから取得する方法も試してください。"
                    )
                data = json.loads(raw)
            except (json.JSONDecodeError, requests.RequestException, ValueError) as e:
                logger.exception("FIONA API 取得失敗: %s", e)
                if not books:
                    msg = str(e) if isinstance(e, ValueError) else ""
                    path = self._find_data_path()
                    if path:
                        logger.info("FIONA API 失敗。ローカルファイルから取得を試行: %s", path)
                        return self._fetch_from_xml(path) if path.suffix == ".xml" else self._fetch_from_sqlite(path)
                    raise RuntimeError(
                        "Amazon から Kindle 蔵書を取得できませんでした。"
                        "ログイン状態を確認するか、Amazon の仕様変更の可能性があります。"
                        "Kindle for Mac を起動して蔵書を同期し、ローカルファイル（BookData.sqlite）から取得する方法も試してください。"
                        + (" " + msg if msg else "")
                    ) from e
                break

            payload = data.get("data") if isinstance(data, dict) else data
            if not isinstance(payload, dict):
                payload = data if isinstance(data, dict) else {}
            items = payload.get("items", [])
            total = payload.get("totalCount", 0)

            for item in items:
                if not isinstance(item, dict):
                    continue
                asin = (item.get("asin") or item.get("contentId") or "").strip()
                if not asin or asin in seen_asins:
                    continue
                seen_asins.add(asin)
                title = (item.get("title") or "").strip()
                if isinstance(title, str):
                    title = html.unescape(title)
                purchase_date = (
                    item.get("purchaseDate")
                    or item.get("purchase_date")
                    or item.get("dateAdded")
                    or item.get("acquisitionDate")
                    or ""
                )

                book = BookRecord(
                    title=title or "不明なタイトル",
                    author="",
                    loan_date=self._format_date(str(purchase_date)),
                    loan_location="Kindle",
                    rating=0,
                    comment="",
                    cover_url="",
                    detail_url=f"https://www.amazon.co.jp/dp/{asin}" if asin else "",
                    catalog_number=asin,
                    completed=False,
                    source=self.library_id,
                    genre="",
                    summary="",
                    full_summary="",
                    completed_date="",
                    favorite=False,
                    review_headline="",
                    catalog_rating=0.0,
                )
                books.append(book)

            offset += len(items)
            if offset >= total or len(items) == 0:
                break

        logger.info("Kindle Amazon: %d 冊取得", len(books))
        return books

    def _find_data_path(self) -> Optional[Path]:
        for p in _KINDLE_XML_PATHS:
            if p.exists():
                return p
        for p in _KINDLE_SQLITE_PATHS:
            if p.exists():
                return p
        return None

    def _fetch_from_xml(self, path: Path) -> list[BookRecord]:
        """KindleSyncMetadataCache.xml をパース"""
        try:
            tree = ET.parse(path)
        except ET.ParseError as e:
            logger.exception("XML パース失敗: %s", e)
            raise RuntimeError(f"Kindle XML の読み込みに失敗しました: {e}") from e

        root = tree.getroot()
        items: list[ET.Element] = []

        add_list = root.find("add_update_list") or root.find("add_update_lsit")  # typo in some versions
        if add_list is None:
            add_list = root.find(".//add_update_list") or root.find(".//add_update_lsit")
        if add_list is not None:
            items = add_list.findall("meta_data")
            if not items:
                for child in add_list:
                    ctag = child.tag.split("}")[-1] if "}" in child.tag else child.tag
                    if ctag == "meta_data":
                        items.append(child)
                    elif ctag in ("dict", "item") and self._xml_text(child, "ASIN"):
                        items.append(child)

        if not items:
            for elem in root.iter():
                tag = elem.tag.split("}")[-1] if "}" in elem.tag else elem.tag
                if tag == "meta_data":
                    items.append(elem)

        books: list[BookRecord] = []
        seen_asins: set[str] = set()

        for item in items:
            if not isinstance(item, ET.Element):
                continue
            asin = self._xml_text(item, "ASIN")
            if not asin or asin in seen_asins:
                continue

            purchase_date = (
                self._xml_text(item, "purchase_date")
                or self._xml_text(item, "publication_date")
                or self._xml_text(item, "date_added")
                or self._xml_text(item, "last_access_date")
            )
            if not purchase_date:
                continue

            seen_asins.add(asin)
            title = self._xml_title(item)
            author = self._xml_author(item)

            book = BookRecord(
                title=title or "不明なタイトル",
                author=author,
                loan_date=self._format_date(purchase_date),
                loan_location="Kindle",
                rating=0,
                comment="",
                cover_url="",
                detail_url=f"https://www.amazon.co.jp/dp/{asin}" if asin else "",
                catalog_number=asin,
                completed=False,
                source=self.library_id,
                genre="",
                summary="",
                full_summary="",
                completed_date="",
                favorite=False,
                review_headline="",
                catalog_rating=0.0,
            )
            books.append(book)

        logger.info("Kindle XML: %d 冊取得", len(books))
        return books

    def _xml_text(self, elem: ET.Element, tag: str) -> str:
        child = elem.find(tag)
        if child is None:
            for c in elem:
                ctag = c.tag.split("}")[-1] if "}" in c.tag else c.tag
                if ctag == tag:
                    child = c
                    break
        if child is None:
            return ""
        text = (child.text or "").strip()
        if text:
            return text
        for sub in child:
            if sub.text:
                return sub.text.strip()
        return ""

    def _xml_title(self, elem: ET.Element) -> str:
        return self._xml_text(elem, "title")

    def _xml_author(self, elem: ET.Element) -> str:
        authors_elem = elem.find("authors")
        if authors_elem is None:
            for c in elem:
                ctag = c.tag.split("}")[-1] if "}" in c.tag else c.tag
                if ctag == "authors":
                    authors_elem = c
                    break
        if authors_elem is None:
            return ""
        author_elems = list(authors_elem.findall("author"))
        if not author_elems:
            inner = authors_elem.find("author")
            if inner is not None:
                author_elems = [inner]
            else:
                author_elems = [authors_elem]
        names = []
        for a in author_elems:
            t = (a.text or "").strip()
            if not t:
                for sub in a:
                    if sub.text:
                        t = sub.text.strip()
                        break
            if t:
                names.append(t)
        return ", ".join(names)

    def _fetch_from_sqlite(self, path: Path) -> list[BookRecord]:
        """BookData.sqlite (2024年以降のKindle for Mac) から取得"""
        try:
            conn = sqlite3.connect(str(path))
            conn.row_factory = sqlite3.Row
            tables = [r[0] for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()]
            table = "ZBOOK" if "ZBOOK" in tables else (tables[0] if tables else None)
            if not table:
                conn.close()
                return []
            rows = conn.execute(f"SELECT * FROM {table}").fetchall()
            conn.close()
        except sqlite3.Error as e:
            logger.exception("SQLite 読み込み失敗: %s", e)
            raise RuntimeError(f"Kindle SQLite の読み込みに失敗しました: {e}") from e

        books: list[BookRecord] = []
        seen_asins: set[str] = set()

        for row in rows:
            try:
                attrs = self._read_plist_attrs(row)
                if not attrs:
                    continue

                asin = attrs.get("ASIN", "")
                purchase_date = (
                    attrs.get("purchase_date")
                    or attrs.get("publication_date")
                    or attrs.get("date_added")
                    or attrs.get("last_access_date")
                    or ""
                )
                if not asin or asin in seen_asins:
                    continue
                if not purchase_date:
                    continue

                seen_asins.add(asin)
                title = attrs.get("title", "")
                authors = attrs.get("authors", {})
                if isinstance(authors, dict):
                    author = authors.get("author", "")
                    if isinstance(author, list):
                        author = ", ".join(str(a) for a in author)
                else:
                    author = str(authors) if authors else ""

                book = BookRecord(
                    title=(title or "不明なタイトル").strip(),
                    author=(author or "").strip(),
                    loan_date=self._format_date(purchase_date),
                    loan_location="Kindle",
                    rating=0,
                    comment="",
                    cover_url="",
                    detail_url=f"https://www.amazon.co.jp/dp/{asin}" if asin else "",
                    catalog_number=asin,
                    completed=False,
                    source=self.library_id,
                    genre="",
                    summary="",
                    full_summary="",
                    completed_date="",
                    favorite=False,
                    review_headline="",
                    catalog_rating=0.0,
                )
                books.append(book)
            except Exception:
                logger.debug("行のパースをスキップ", exc_info=True)

        logger.info("Kindle SQLite: %d 冊取得", len(books))
        return books

    def _read_plist_attrs(self, row: sqlite3.Row) -> Optional[dict]:
        """ZSYNCMETADATAATTRIBUTES から plist を読み取り attributes を返す"""
        col_names = [d[0] for d in row.description]
        plist_col = None
        for c in ("ZSYNCMETADATAATTRIBUTES", "ZMETADATAATTRIBUTES", "ZATTRIBUTES"):
            if c in col_names:
                plist_col = c
                break
        if plist_col is None:
            return None

        raw = row[plist_col]
        if raw is None or len(raw) < 8:
            return None

        try:
            data = plistlib.loads(raw)
        except Exception:
            return None

        if not isinstance(data, dict):
            return None
        if "attributes" in data:
            return data["attributes"]
        if "ASIN" in data or "title" in data:
            return data
        return None

    @staticmethod
    def _format_date(raw: str) -> str:
        if not raw:
            return ""
        m = re.match(r"(\d{4})-(\d{2})-(\d{2})", raw)
        if m:
            return m.group(0)
        m = re.match(r"(\d{4})/(\d{2})/(\d{2})", raw)
        if m:
            return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
        m = re.search(r"(\d{4})-(\d{2})-(\d{2})", raw)
        if m:
            return m.group(0)
        return raw[:10] if len(raw) >= 10 else raw
