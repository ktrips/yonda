"""Kindle アダプタ — Amazonログイン または ローカルファイルから蔵書情報を取得"""
from __future__ import annotations

import html
import json
import logging
import os
import plistlib
import re
import sqlite3
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
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

    # セッションの有効期限（デフォルト7日間）
    SESSION_EXPIRY_DAYS = 7

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

    @staticmethod
    def _get_session_path() -> Path:
        """セッションファイルのパスを取得"""
        from config_paths import get_kindle_session_path
        return get_kindle_session_path()

    def save_session(self, session: requests.Session) -> None:
        """セッションクッキーを保存"""
        try:
            from config_paths import ensure_config_dir
            ensure_config_dir()
            session_path = self._get_session_path()

            # クッキーを辞書形式で保存
            cookies_dict = requests.utils.dict_from_cookiejar(session.cookies)
            expiry_time = datetime.now() + timedelta(days=self.SESSION_EXPIRY_DAYS)

            session_data = {
                "cookies": cookies_dict,
                "expiry": expiry_time.isoformat(),
                "saved_at": datetime.now().isoformat(),
            }

            with open(session_path, "w", encoding="utf-8") as f:
                json.dump(session_data, f, ensure_ascii=False, indent=2)
            session_path.chmod(0o600)
            logger.info("Kindle セッションを保存しました（有効期限: %s）", expiry_time.strftime("%Y-%m-%d %H:%M"))
        except Exception as e:
            logger.warning("セッション保存に失敗: %s", e)

    def load_session(self, session: requests.Session) -> bool:
        """保存済みセッションを読み込む。有効期限切れの場合は False を返す"""
        try:
            session_path = self._get_session_path()
            if not session_path.exists():
                logger.debug("セッションファイルが存在しません: %s", session_path)
                return False

            with open(session_path, "r", encoding="utf-8") as f:
                session_data = json.load(f)

            # 有効期限チェック
            expiry_str = session_data.get("expiry")
            if not expiry_str:
                logger.warning("セッションに有効期限がありません")
                return False

            expiry_time = datetime.fromisoformat(expiry_str)
            if datetime.now() >= expiry_time:
                logger.info("Kindle セッションの有効期限が切れています")
                session_path.unlink(missing_ok=True)
                return False

            # クッキーを復元
            cookies_dict = session_data.get("cookies", {})
            if not cookies_dict:
                logger.warning("セッションにクッキーがありません")
                return False

            logger.debug("クッキーを復元中: %d 個", len(cookies_dict))
            session.cookies.update(requests.utils.cookiejar_from_dict(cookies_dict))
            saved_at = session_data.get("saved_at", "不明")
            logger.info("Kindle セッションを読み込みました（保存日時: %s、有効期限: %s、クッキー数: %d）",
                       saved_at[:19] if len(saved_at) >= 19 else saved_at,
                       expiry_time.strftime("%Y-%m-%d %H:%M"),
                       len(cookies_dict))
            return True
        except Exception as e:
            logger.warning("セッション読み込みに失敗: %s", e)
            return False

    def verify_session(self, session: requests.Session) -> bool:
        """セッションが有効かチェック（FIONA 管理ページにアクセス）"""
        try:
            logger.debug("セッション検証開始: クッキー数=%d", len(session.cookies))
            r = session.get(AMAZON_JP + "/gp/digital/fiona/manage", timeout=15, allow_redirects=True)
            r.raise_for_status()

            logger.debug("セッション検証: 最終URL=%s", r.url)

            # サインインページにリダイレクトされた場合は無効
            if "signin" in r.url.lower() and "fiona" not in r.url.lower():
                logger.info("Kindle セッションが無効です（ログインが必要）")
                self.clear_session()
                return False

            # FIONA ページにアクセスできれば有効
            if "fiona" in r.url.lower() or "digital" in r.url.lower():
                logger.info("Kindle セッションは有効です")
                return True

            logger.warning("Kindle セッション検証: 予期しないURL - %s", r.url)
            self.clear_session()
            return False
        except requests.RequestException as e:
            logger.warning("セッション検証に失敗: %s", e)
            self.clear_session()
            return False

    def clear_session(self) -> None:
        """保存済みセッションを削除"""
        try:
            session_path = self._get_session_path()
            if session_path.exists():
                session_path.unlink()
                logger.info("Kindle セッションを削除しました")
        except Exception as e:
            logger.warning("セッション削除に失敗: %s", e)

    @staticmethod
    def _extract_progress_from_item(item: dict) -> tuple[float, str, bool]:
        """FIONA ownership API item から読書進捗情報を抽出
        返り値: (percent_complete, last_read_date_str, is_finished)"""
        percent = 0.0
        for key in ("percentRead", "percent_read", "percentComplete", "percent_complete",
                    "readingProgress", "readPercent", "reading_percent", "furthestReadPercent"):
            val = item.get(key)
            if isinstance(val, (int, float)) and val > 0:
                percent = float(val)
                break

        last_read_date = ""
        for key in ("lastReadDate", "last_read_date", "lastReadTimestamp",
                    "lastOpenedDate", "lastAccessDate", "last_opened_date",
                    "lastAccessTime", "lastSyncTime"):
            val = item.get(key)
            if val and isinstance(val, str):
                last_read_date = val.strip()
                if last_read_date:
                    break

        is_finished = False
        if item.get("isFinished") is True or item.get("is_finished") is True:
            is_finished = True
        elif item.get("percentRead") == 100.0 or item.get("percent_read") == 100.0:
            is_finished = True
        else:
            status = str(item.get("readingStatus") or item.get("reading_status") or "").strip().lower()
            if status in ("read", "finished", "completed", "done"):
                is_finished = True

        return percent, last_read_date, is_finished

    @staticmethod
    def _generate_cover_url(asin: str) -> str:
        """ASIN からカバー画像 URL を生成
        Amazon のカバー画像は複数の URL パターンで提供されている"""
        if not asin:
            return ""
        asin = asin.strip()
        # 優先順位順で複数の URL パターンを返す（呼び出し側で最初に使用可能なものを試す）
        return f"https://m.media-amazon.com/images/P/{asin}.09.L.jpg"

    @staticmethod
    def _determine_completion(percent: float, is_finished: bool, status_str: str) -> bool:
        """複数シグナルから completed bool を決定
        Kindle は章末で 100% に届かないため、95% 以上で完了と判定"""
        if is_finished:
            return True
        status_lower = status_str.strip().lower()
        if status_lower in ("read", "finished", "completed"):
            return True
        if percent >= 95.0:
            return True
        return False

    def _fetch_reading_progress(
        self, session: requests.Session, asins: list[str]
    ) -> dict[str, dict]:
        """FIONA reading-progress エンドポイントから読書進捗を取得
        複数のエンドポイント候補を試す
        返り値: {asin: {"percent_complete": float, "last_read_date": str, "is_finished": bool}}
        失敗時は {} を返す（never raises）"""
        if not asins:
            return {}

        progress_map: dict[str, dict] = {}

        # エンドポイント候補を複数用意
        endpoint_candidates = [
            "/gp/digital/fiona/manage/features/reading-progress/ajax/queryReadingProgress.html",
            "/gp/digital/fiona/reading/ajax/queryProgress.html",
            "/gp/digital/fiona/manage/features/progress/ajax/queryProgress.html",
        ]

        ajax_headers = {
            "X-Requested-With": "XMLHttpRequest",
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        }

        try:
            # ASIN をバッチ処理（50個ずつ）
            batch_size = 50
            for i in range(0, len(asins), batch_size):
                batch_asins = asins[i:i+batch_size]
                batch_asin_str = ",".join(batch_asins)

                # 各エンドポイント候補を試す
                for endpoint in endpoint_candidates:
                    try:
                        api_url = AMAZON_JP + endpoint
                        r = session.post(
                            api_url,
                            data={"asins": batch_asin_str, "type": "KINDLE"},
                            headers=ajax_headers,
                            timeout=20,
                        )
                        r.raise_for_status()
                        data = json.loads(r.text)

                        items = data.get("data", {}).get("items", []) if isinstance(data, dict) else []
                        if not items:
                            items = data.get("items", []) if isinstance(data, dict) else []

                        if items:
                            for item in items:
                                if not isinstance(item, dict):
                                    continue
                                asin = (item.get("asin") or item.get("contentId") or "").strip()
                                if asin:
                                    percent = float(item.get("percentRead") or
                                                  item.get("percent_read") or
                                                  item.get("percentComplete") or
                                                  item.get("furthestReadPercent") or 0.0)
                                    last_read = (item.get("lastReadDate") or
                                               item.get("last_read_date") or
                                               item.get("lastAccessDate") or
                                               item.get("lastAccessTime") or "").strip()
                                    is_finished = (item.get("isFinished") is True or
                                                 item.get("reading_status", "").lower() in ("read", "finished"))
                                    progress_map[asin] = {
                                        "percent_complete": percent,
                                        "last_read_date": last_read,
                                        "is_finished": is_finished,
                                    }
                            # エンドポイントが成功したらそれ以降の候補は試さない
                            logger.debug("Reading progress API 成功: %s (%d items)", endpoint, len(items))
                            break
                    except (json.JSONDecodeError, requests.RequestException, ValueError) as e:
                        logger.debug("エンドポイント %s 失敗: %s (次を試します)", endpoint, type(e).__name__)
                        continue

            if progress_map:
                logger.info("Kindle reading progress: %d 冊の進捗情報を取得", len(progress_map))
            return progress_map
        except Exception as e:
            logger.debug("_fetch_reading_progress 全体エラー (無視します): %s", e)
            return {}

    def _fetch_from_amazon(self, session: requests.Session) -> list[BookRecord]:
        """Amazon FIONA API から購入済み Kindle タイトルを取得（読書進捗情報を含む）"""
        raw_items: list[dict] = []
        offset = 0
        count = 100
        seen_asins: set[str] = set()

        # FIONA 管理ページにアクセスしてセッションを確立（API 呼び出し前に必要）
        try:
            r = session.get(AMAZON_JP + "/gp/digital/fiona/manage", timeout=30)
            r.raise_for_status()
            logger.debug("FIONA 管理ページアクセス成功: %s", r.url)
            if "signin" in r.url.lower() and "fiona" not in r.url.lower():
                logger.warning("FIONA アクセス時にサインインページにリダイレクトされました")
                self.clear_session()
                raise RuntimeError(
                    "Amazon ログインセッションが無効になっています。"
                    "もう一度「読書記録を取得」から OTP を入力してログインしてください。"
                )
        except requests.RequestException as e:
            logger.warning("FIONA 管理ページ取得エラー: %s", e)

        api_url = AMAZON_JP + "/gp/digital/fiona/manage/features/order-history/ajax/queryOwnership_refactored2.html"
        ajax_headers = {
            "X-Requested-With": "XMLHttpRequest",
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        }

        # ステップ 1: オーナーシップ API からすべてのアイテムを収集
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
                if not raw_items:
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
                raw_items.append(item)

            offset += len(items)
            if offset >= total or len(items) == 0:
                break

        # ステップ 2: すべての ASIN について読書進捗情報を一括取得
        all_asins = [item.get("asin") or item.get("contentId") for item in raw_items]
        all_asins = [a.strip() for a in all_asins if a]
        progress_map = self._fetch_reading_progress(session, all_asins)
        logger.info("Kindle reading progress: %d 冊の進捗情報を取得", len(progress_map))

        # ステップ 3: BookRecord を生成（進捗データを含める）
        books: list[BookRecord] = []
        for item in raw_items:
            asin = (item.get("asin") or item.get("contentId") or "").strip()
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

            # オーナーシップ API のフィールドから進捗を抽出
            ownership_percent, ownership_date, ownership_finished = self._extract_progress_from_item(item)

            # プログレス API のデータとマージ（プログレス API を優先）
            percent_complete = ownership_percent
            last_read_date = ownership_date
            is_finished = ownership_finished

            if asin in progress_map:
                prog = progress_map[asin]
                if prog.get("percent_complete", 0.0) > percent_complete:
                    percent_complete = prog["percent_complete"]
                if prog.get("last_read_date") and not last_read_date:
                    last_read_date = prog["last_read_date"]
                if prog.get("is_finished"):
                    is_finished = True

            # 完了判定
            completed = self._determine_completion(percent_complete, is_finished, "")

            # 完了日の決定（読了済みの場合のみ）
            completed_date = ""
            if completed and last_read_date:
                completed_date = self._format_date(last_read_date)

            # カバー画像の取得
            # 1. FIONA API のレスポンスから直接取得を試す
            cover_url = ""
            for key in ("productImage", "coverUrl", "imageUrl", "imageUrl500", "bookCoverImage",
                       "image", "coverImage", "cover_url"):
                val = item.get(key)
                if val and isinstance(val, str):
                    cover_url = val.strip()
                    if cover_url:
                        break

            # 2. API から取得できない場合は ASIN から生成
            if not cover_url and asin:
                cover_url = self._generate_cover_url(asin)

            book = BookRecord(
                title=title or "不明なタイトル",
                author="",
                loan_date=self._format_date(str(purchase_date)),
                loan_location="Kindle",
                rating=0,
                comment="",
                cover_url=cover_url,
                detail_url=f"https://www.amazon.co.jp/dp/{asin}" if asin else "",
                catalog_number=asin,
                completed=completed,
                source=self.library_id,
                genre="",
                summary="",
                full_summary="",
                completed_date=completed_date,
                percent_complete=percent_complete,
                favorite=False,
                review_headline="",
                catalog_rating=0.0,
            )
            books.append(book)

        logger.info("Kindle Amazon: %d 冊取得（%d 冊読了, %.1f%% 平均進捗）",
                   len(books),
                   sum(1 for b in books if b.completed),
                   sum(b.percent_complete for b in books) / len(books) if books else 0)

        # 取得成功時はセッションを保存（次回の自動取得で再利用）
        self.save_session(session)

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

            # XML から読書進捗を抽出
            percent_complete = float(self._xml_text(item, "percent_read") or 0)
            if not percent_complete:
                percent_complete = float(self._xml_text(item, "percentComplete") or 0)
            if not percent_complete:
                percent_complete = float(self._xml_text(item, "furthestReadPercent") or 0)

            last_read_date = (self._xml_text(item, "last_read_date") or
                            self._xml_text(item, "lastAccessDate") or
                            self._xml_text(item, "lastSyncTime") or "")

            reading_status = self._xml_text(item, "reading_status").lower()
            is_finished = (reading_status in ("read", "finished", "completed", "done") or
                          self._xml_text(item, "is_finished").lower() == "true")
            completed = self._determine_completion(percent_complete, is_finished, "")

            completed_date = ""
            if completed and last_read_date:
                completed_date = self._format_date(last_read_date)

            # カバー画像 URL を生成
            cover_url = self._generate_cover_url(asin) if asin else ""

            book = BookRecord(
                title=title or "不明なタイトル",
                author=author,
                loan_date=self._format_date(purchase_date),
                loan_location="Kindle",
                rating=0,
                comment="",
                cover_url=cover_url,
                detail_url=f"https://www.amazon.co.jp/dp/{asin}" if asin else "",
                catalog_number=asin,
                completed=completed,
                source=self.library_id,
                genre="",
                summary="",
                full_summary="",
                completed_date=completed_date,
                percent_complete=percent_complete,
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

        col_names = set(rows[0].keys()) if rows else set()
        has_direct_cols = "ZDISPLAYTITLE" in col_names and "ZBOOKID" in col_names

        for row in rows:
            try:
                # --- 直接カラム読み取り（NSKeyedArchiver plist は解析不要）---
                if has_direct_cols:
                    asin, title, author, percent_complete, last_read_date, is_finished = \
                        self._read_direct_cols(row)
                else:
                    attrs = self._read_plist_attrs(row)
                    if not attrs:
                        continue
                    asin = attrs.get("ASIN", "")
                    title = attrs.get("title", "")
                    authors_val = attrs.get("authors", {})
                    if isinstance(authors_val, dict):
                        author_raw = authors_val.get("author", "")
                        author = ", ".join(str(a) for a in author_raw) if isinstance(author_raw, list) else str(author_raw)
                    else:
                        author = str(authors_val) if authors_val else ""
                    percent_complete = 0.0
                    for key in ("reading_percent", "readingPercent", "percent_read", "percentRead",
                               "furthestReadPercent", "furthest_read_percent"):
                        val = attrs.get(key)
                        if isinstance(val, (int, float)) and val > 0:
                            percent_complete = float(val)
                            break
                    lpr = attrs.get("lpr") or attrs.get("furthest_page_read") or 0
                    total_pages = attrs.get("total_pages") or attrs.get("pages") or 0
                    if total_pages and isinstance(lpr, (int, float)) and isinstance(total_pages, (int, float)) and float(total_pages) > 0:
                        calc = (float(lpr) / float(total_pages)) * 100
                        if calc > percent_complete:
                            percent_complete = calc
                    last_read_date = ""
                    for key in ("last_read_date", "lastReadDate", "last_access_date", "lastAccessDate",
                               "lastSyncTime", "last_sync_time"):
                        val = attrs.get(key)
                        if val and isinstance(val, str):
                            last_read_date = val.strip()
                            break
                    is_finished = False
                    for status_key in ("reading_status", "readingStatus", "read_status", "readStatus"):
                        if str(attrs.get(status_key) or "").strip().lower() in ("read", "finished", "completed", "done"):
                            is_finished = True
                            break
                    if attrs.get("is_finished") is True or attrs.get("isFinished") is True:
                        is_finished = True
                    purchase_date = (
                        attrs.get("purchase_date") or attrs.get("publication_date")
                        or attrs.get("date_added") or attrs.get("last_access_date") or ""
                    )
                    if not purchase_date:
                        continue

                if not asin or asin in seen_asins:
                    continue

                seen_asins.add(asin)
                completed = self._determine_completion(percent_complete, is_finished, "")
                completed_date = self._format_date(last_read_date) if completed and last_read_date else ""
                cover_url = self._generate_cover_url(asin) if asin else ""
                loan_date = last_read_date[:10] if last_read_date else ""

                book = BookRecord(
                    title=(title or "不明なタイトル").strip(),
                    author=(author or "").strip(),
                    loan_date=loan_date,
                    loan_location="Kindle",
                    rating=0,
                    comment="",
                    cover_url=cover_url,
                    detail_url=f"https://www.amazon.co.jp/dp/{asin}" if asin else "",
                    catalog_number=asin,
                    completed=completed,
                    source=self.library_id,
                    genre="",
                    summary="",
                    full_summary="",
                    completed_date=completed_date,
                    percent_complete=round(percent_complete, 1),
                    favorite=False,
                    review_headline="",
                    catalog_rating=0.0,
                )
                books.append(book)
            except Exception:
                logger.debug("行のパースをスキップ", exc_info=True)

        logger.info("Kindle SQLite: %d 冊取得", len(books))
        return books

    def _read_direct_cols(self, row: sqlite3.Row) -> tuple[str, str, str, float, str, bool]:
        """ZBOOK テーブルの直接カラムから (asin, title, author, percent, last_date, is_finished) を返す"""
        from datetime import datetime as _dt

        book_id = str(row["ZBOOKID"] or "")
        asin = book_id[2:].split("-")[0] if book_id.startswith("A:") else ""
        title = str(row["ZDISPLAYTITLE"] or "")

        # 辞書本はスキップ
        col_names = row.keys()
        if "ZRAWISDICTIONARY" in col_names and row["ZRAWISDICTIONARY"] == 1:
            return "", title, "", 0.0, "", False

        # 著者（ZDISPLAYAUTHOR は暗号化バイト列の場合があるため空扱い）
        author = ""

        # 進捗: ZRAWCURRENTPOSITION / ZRAWMAXPOSITION
        percent_complete = 0.0
        cur_pos = row["ZRAWCURRENTPOSITION"] if "ZRAWCURRENTPOSITION" in col_names else None
        max_pos = row["ZRAWMAXPOSITION"] if "ZRAWMAXPOSITION" in col_names else None
        if cur_pos and max_pos and float(max_pos) > 0:
            percent_complete = min((float(cur_pos) / float(max_pos)) * 100, 100.0)

        # 最終アクセス日（Unix タイムスタンプ）
        last_read_date = ""
        ts_raw = row["ZRAWLASTACCESSTIME"] if "ZRAWLASTACCESSTIME" in col_names else None
        if ts_raw:
            try:
                last_read_date = _dt.fromtimestamp(float(ts_raw)).strftime("%Y-%m-%d")
            except (OSError, ValueError, OverflowError):
                pass

        # 完了判定: ZRAWREADSTATE=1 または percent>=95
        read_state = row["ZRAWREADSTATE"] if "ZRAWREADSTATE" in col_names else 0
        is_finished = (read_state == 1)

        return asin, title, author, percent_complete, last_read_date, is_finished

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
