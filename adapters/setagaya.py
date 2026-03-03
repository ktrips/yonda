"""世田谷区立図書館アダプタ — 読書記録のスクレイピング"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta
from typing import Optional
from urllib.parse import urljoin, parse_qs, urlparse

import requests
from bs4 import BeautifulSoup

from adapters.base import LibraryAdapter, LibraryCredentials, BookRecord

logger = logging.getLogger(__name__)

BASE_URL = "https://libweb.city.setagaya.tokyo.jp"
LOGIN_PATH = "/idcheck"
HISTORY_PATH = "/rentalhistorylist"
# お気に入り資料ページ（?2, ?12, ?8 等は Wicket のページID、セッションで変動する場合あり）
FAVORITE_PATHS = ("/favoritelist?2", "/favoritelist?12", "/favoritelist?8", "/favoritelist", "/booklist", "/favlist")
ITEMS_PER_PAGE = 100


class SetagayaAdapter(LibraryAdapter):

    @property
    def library_id(self) -> str:
        return "setagaya"

    @property
    def library_name(self) -> str:
        return "世田谷区立図書館"

    @property
    def library_url(self) -> str:
        return BASE_URL

    # ------------------------------------------------------------------
    # Login
    # ------------------------------------------------------------------

    def login(self, session: Optional[requests.Session], credentials: Optional[LibraryCredentials]) -> bool:
        login_url = f"{BASE_URL}{LOGIN_PATH}"
        resp = session.get(login_url, allow_redirects=True)
        if resp.status_code != 200:
            logger.error("ログインページの取得に失敗: %s", resp.status_code)
            return False

        soup = BeautifulSoup(resp.text, "lxml")
        form = soup.find("form", attrs={"action": re.compile(r"login.*inputForm")})
        if not form:
            logger.error("ログインフォームが見つかりません")
            return False

        action = form.get("action", "")
        post_url = urljoin(resp.url, action)

        data = {
            "textUserId": credentials.user_id,
            "textPassword": credentials.password,
            "buttonLogin": "ログイン",
        }

        resp2 = session.post(post_url, data=data, allow_redirects=True)
        if resp2.status_code != 200:
            return False

        still_on_login = "login" in resp2.url
        redirected_ok = any(x in resp2.url for x in ("rentalhistory", "favoritelist", "idcheck", "contents"))
        if still_on_login and not redirected_ok:
            soup2 = BeautifulSoup(resp2.text, "lxml")
            err = soup2.find(string=re.compile(r"(パスワード|利用者ID|ログイン.*失敗)"))
            if err:
                logger.error("ログイン失敗: %s", err.strip())
            return False

        logger.info("ログイン成功: %s", resp2.url)
        return True

    # ------------------------------------------------------------------
    # Fetch history
    # ------------------------------------------------------------------

    def fetch_history(self, session: Optional[requests.Session]) -> list[BookRecord]:
        """貸出履歴を全件取得し、お気に入り (favoritelist) に含まれる本に favorite フラグを付与"""
        favorite_conums = self._get_favorite_conums(session)
        favorite_titles = self._get_favorite_titles(session)
        return self._fetch_all_from_rental_history(session, favorite_conums, favorite_titles)

    def _fetch_all_from_rental_history(
        self,
        session: requests.Session,
        favorite_conums: set[str],
        favorite_titles: set[str],
    ) -> list[BookRecord]:
        """貸出履歴から全件取得。お気に入りは conum または同名（タイトル）でマッチ"""
        all_books: list[BookRecord] = []
        url = f"{BASE_URL}{HISTORY_PATH}"
        params = {"mv": ITEMS_PER_PAGE, "pcnt": 1, "sort": 1, "list": -1}
        page = 1
        while True:
            resp = session.get(url, params=params, allow_redirects=True)
            if resp.status_code != 200:
                break
            soup = BeautifulSoup(resp.text, "lxml")
            books = self._parse_rental_page(soup)
            if not books:
                break
            for book in books:
                book.favorite = (
                    book.catalog_number in favorite_conums
                    or self._normalize_title(book.title) in favorite_titles
                )
            all_books.extend(books)
            logger.info("ページ %d: %d 冊取得 (累計 %d)", page, len(books), len(all_books))
            next_link = self._find_next_page_link(soup)
            if not next_link:
                break
            url = urljoin(resp.url, next_link)
            params = {}
            page += 1
        return all_books

    # ------------------------------------------------------------------
    # HTML parsing
    # ------------------------------------------------------------------

    def _parse_rental_page(self, soup: BeautifulSoup) -> list[BookRecord]:
        """貸出履歴ページから本の一覧をパース"""
        books: list[BookRecord] = []
        entries = soup.find_all("h3")
        if not entries:
            entries = soup.find_all(["h2", "h3", "h4"], string=re.compile(r"^\d+"))

        for heading in entries:
            link = heading.find("a", href=re.compile(r"rentalhistorydetail"))
            if not link:
                continue

            book = BookRecord()
            book.title = self._clean_title(link.get_text(strip=True))
            book.detail_url = urljoin(BASE_URL, link.get("href", ""))
            book.catalog_number = self._extract_conum(book.detail_url)

            container = self._find_entry_container(heading)
            if container is None:
                container = heading.parent

            book.cover_url = self._extract_cover(container)
            book.author = self._clean_author(self._extract_field(container, "著者名"))
            book.loan_date = self._parse_date(self._extract_field(container, "貸出日"))
            book.completed_date = self._add_weeks_to_date(book.loan_date, 1)
            book.loan_location = self._extract_field(container, "貸出場所")
            book.rating = self._extract_rating(container)
            raw_comment = self._extract_field(container, "コメント")
            book.comment = "" if re.search(r"ワンクリック予約|ボタン.*デザイン", raw_comment) else raw_comment
            book.completed = book.rating > 0
            book.source = self.library_id

            books.append(book)

        return books

    def _get_favorite_conums(self, session: requests.Session) -> set[str]:
        """お気に入り資料照会ページから conum 一覧を取得"""
        conums: set[str] = set()
        # 利用者メニュー経由でセッションを確立してからお気に入りページへ
        try:
            session.get(f"{BASE_URL}/idcheck", allow_redirects=True)
        except Exception:
            pass

        for path in FAVORITE_PATHS:
            url = f"{BASE_URL}{path}"
            page = 1
            while True:
                resp = session.get(url, allow_redirects=True)
                if resp.status_code != 200:
                    break
                soup = BeautifulSoup(resp.text, "lxml")
                page_conums = self._extract_conums_from_page(soup, resp.url)
                conums.update(page_conums)
                if page_conums:
                    logger.info("お気に入り (%s): %d 件取得", path, len(page_conums))
                next_link = self._find_next_page_link(soup)
                if not next_link:
                    break
                url = urljoin(resp.url, next_link)
                page += 1
            if conums:
                logger.info("お気に入り資料: 合計 %d 件の conum を取得", len(conums))
                break
        if not conums:
            logger.debug("お気に入りページから conum を取得できませんでした（お気に入り登録が0件の可能性）")
        return conums

    def _get_favorite_titles(self, session: requests.Session) -> set[str]:
        """お気に入り資料照会ページから書名一覧を取得（同名マッチ用）"""
        titles: set[str] = set()
        try:
            session.get(f"{BASE_URL}/idcheck", allow_redirects=True)
        except Exception:
            pass
        for path in FAVORITE_PATHS:
            url = f"{BASE_URL}{path}"
            page = 1
            while True:
                resp = session.get(url, allow_redirects=True)
                if resp.status_code != 200:
                    break
                soup = BeautifulSoup(resp.text, "lxml")
                page_titles = self._extract_titles_from_favoritelist(soup)
                titles.update(page_titles)
                if page_titles:
                    logger.info("お気に入り (%s): %d 件の書名を取得", path, len(page_titles))
                next_link = self._find_next_page_link(soup)
                if not next_link:
                    break
                url = urljoin(resp.url, next_link)
                page += 1
            if titles:
                logger.info("お気に入り資料: 合計 %d 件の書名を取得（同名マッチ用）", len(titles))
                break
        return titles

    def _extract_titles_from_favoritelist(self, soup: BeautifulSoup) -> set[str]:
        """お気に入りページから書名を抽出（リンクテキスト・見出し・資料名など）"""
        titles: set[str] = set()
        # 1. 資料詳細へのリンク（favoritedetail, rentalhistorydetail, detailresult）
        for a in soup.find_all("a", href=re.compile(r"favoritedetail|rentalhistorydetail|detailresult")):
            t = self._clean_title(a.get_text(strip=True))
            if t and len(t) > 1:
                nt = self._normalize_title(t)
                if nt:
                    titles.add(nt)
        # 2. 見出し（h2, h3, h4）内のリンク
        for h in soup.find_all(["h2", "h3", "h4"]):
            link = h.find("a", href=True)
            if link:
                t = self._clean_title(link.get_text(strip=True))
                if t and len(t) > 1:
                    nt = self._normalize_title(t)
                    if nt:
                        titles.add(nt)
        # 3. 資料名・書名ラベルの隣のテキスト
        for label in ["資料名", "書名", "タイトル"]:
            el = soup.find(string=re.compile(rf"^\s*{re.escape(label)}\s*"))
            if el:
                parent = el.parent
                if parent:
                    dd = parent.find_next("dd") or parent.find_next_sibling()
                    if dd:
                        t = self._clean_title(dd.get_text(strip=True))
                        if t and len(t) > 1:
                            nt = self._normalize_title(t)
                            if nt:
                                titles.add(nt)
        return titles

    @staticmethod
    def _normalize_title(title: str) -> str:
        """同名マッチ用にタイトルを正規化"""
        if not title:
            return ""
        t = re.sub(r"^\d+\s*", "", title)
        t = re.sub(r"\s+", " ", t.strip())
        return t

    def _extract_conums_from_page(self, soup: BeautifulSoup, base_url: str) -> set[str]:
        """お気に入り資料ページから conum 一覧を抽出（リンク・フォーム・data属性・onclick など）"""
        conums: set[str] = set()
        # 1. リンクから抽出（rentalhistorydetail, favoritedetail, detailresult など）
        for a in soup.find_all("a", href=True):
            href = a["href"]
            full_url = urljoin(base_url, href)
            c = self._extract_conum(href) or self._extract_conum(full_url)
            if c:
                conums.add(c)
        # 2. フォームの hidden input から抽出
        for inp in soup.find_all("input", {"type": "hidden", "name": re.compile(r"conum", re.I)}):
            val = inp.get("value", "").strip()
            if val:
                conums.add(val)
        # 3. data-conum 属性から抽出
        for el in soup.find_all(attrs={"data-conum": True}):
            c = el.get("data-conum", "").strip()
            if c:
                conums.add(c)
        # 4. onclick や JavaScript 内の conum= から抽出（お気に入りページの Wicket リンク対応）
        for el in soup.find_all(attrs={"onclick": True}):
            c = self._extract_conum(el.get("onclick", ""))
            if c:
                conums.add(c)
        for script in soup.find_all("script", string=True):
            for m in re.finditer(r"conum=([^&;\s'\")\]]+)", script.string or "", re.I):
                val = m.group(1).strip()
                if val.isdigit():
                    conums.add(val)
        return conums

    def _find_entry_container(self, heading) -> "BeautifulSoup | None":
        """heading の次の兄弟要素群から、次の heading までをコンテナとみなす"""
        parts = []
        for sib in heading.next_siblings:
            if sib.name and sib.name in ("h2", "h3", "h4"):
                if sib.find("a", href=re.compile(r"rentalhistorydetail")):
                    break
            parts.append(str(sib))
        if not parts:
            return None
        html = "".join(parts)
        return BeautifulSoup(html, "lxml")

    @staticmethod
    def _find_next_page_link(soup: BeautifulSoup) -> str:
        for a in soup.find_all("a", href=True):
            if "次へ" in (a.get_text() or ""):
                return a["href"]
        return ""

    @staticmethod
    def _clean_title(raw: str) -> str:
        raw = re.sub(r"^\d+\s*", "", raw)
        return raw.strip()

    @staticmethod
    def _clean_author(raw: str) -> str:
        """'榛葉豊／著' -> '榛葉豊', '小林昌平／著　山本周嗣／著' -> '小林昌平　山本周嗣'"""
        if not raw:
            return ""
        raw = re.sub(r"／\[?著\]?", "", raw)
        raw = re.sub(r"／\[?訳\]?", "", raw)
        raw = re.sub(r"／\[?編\]?", "", raw)
        raw = re.sub(r"\s+", "　", raw).strip("　 ")
        return raw

    @staticmethod
    def _extract_conum(url: str) -> str:
        qs = parse_qs(urlparse(url).query)
        vals = qs.get("conum", [])
        if vals:
            return vals[0]
        # Wicket 形式など、クエリ外の conum= にも対応
        m = re.search(r"conum=([^&;\s]+)", url, re.I)
        return m.group(1).strip() if m else ""

    @staticmethod
    def _extract_cover(container) -> str:
        if container is None:
            return ""
        img = container.find("img", src=re.compile(r"(imgCover|book\.png|images/)"))
        if not img:
            img = container.find("img")
        if img and img.get("src"):
            src = img["src"]
            if "rateit" in src or "star" in src:
                return ""
            return urljoin(BASE_URL, src)
        return ""

    @staticmethod
    def _extract_field(container, label: str) -> str:
        if container is None:
            return ""
        el = container.find(string=re.compile(rf"^\s*{re.escape(label)}\s*$"))
        if not el:
            el = container.find("dt", string=re.compile(label))
            if el:
                dd = el.find_next("dd")
                return dd.get_text(strip=True) if dd else ""
            return ""
        node = el.find_next(string=True)
        while node:
            text = node.strip() if isinstance(node, str) else node.get_text(strip=True)
            if text and text != label and text != "\xa0":
                return text
            node = node.find_next(string=True) if hasattr(node, "find_next") else None
        return ""

    @staticmethod
    def _is_favorite_in_container(container) -> bool:
        """コンテナ内にお気に入り登録済みの表示があるか"""
        if container is None:
            return False
        # お気に入り解除リンク・ボタン（登録済みの場合は解除が表示される）
        for a in container.find_all("a", href=True):
            href = a.get("href", "").lower()
            text = (a.get_text() or "").strip()
            title = (a.get("title") or "").strip()
            if "favoritelist" in href or "お気に入り解除" in text or ("解除" in text and "お気に入り" in title):
                return True
        # お気に入り登録済みのテキスト
        if container.find(string=re.compile(r"お気に入り\s*登録\s*済み|お気に入り登録済")):
            return True
        return False

    @staticmethod
    def _extract_rating(container) -> int:
        if container is None:
            return 0
        img = container.find("img", src=re.compile(r"star_small_\d+\.gif"))
        if img:
            m = re.search(r"star_small_(\d+)\.gif", img.get("src", ""))
            if m:
                return int(m.group(1))
        return 0

    @staticmethod
    def _parse_date(raw: str) -> str:
        """'2026年2月21日' -> '2026-02-21'"""
        if not raw:
            return ""
        m = re.search(r"(\d{4})\D+(\d{1,2})\D+(\d{1,2})", raw)
        if m:
            return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
        return raw.strip()

    @staticmethod
    def _add_weeks_to_date(date_str: str, weeks: int) -> str:
        """YYYY-MM-DD に指定週数を加算して返す"""
        if not date_str or len(date_str) < 10:
            return ""
        try:
            dt = datetime.strptime(date_str[:10], "%Y-%m-%d")
            result = dt + timedelta(weeks=weeks)
            return result.strftime("%Y-%m-%d")
        except (ValueError, TypeError):
            return ""
