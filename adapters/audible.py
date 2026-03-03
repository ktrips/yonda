"""Amazon Audible Japan アダプタ — audible ライブラリ経由でオーディオブック履歴を取得"""
from __future__ import annotations

import json
import logging
import os
import re
from pathlib import Path
from typing import Optional

import requests

from adapters.base import BookRecord, LibraryAdapter, LibraryCredentials

logger = logging.getLogger(__name__)

# 総合評価取得用（write-review はログイン必須のため pd ページを使用）
AUDIBLE_PD_BASE = "https://www.audible.co.jp/pd/"

try:
    import audible
except ImportError:
    audible = None  # type: ignore[assignment]

APP_DIR = Path(__file__).resolve().parent.parent
_DATA_DIR = Path(os.environ.get("YONDA_DATA_DIR", str(APP_DIR / "data")))


def _resolve_auth_file() -> Path:
    """認証ファイルのパスを解決。data/auth_jp.json を優先（アップロード先と一致）"""
    if os.environ.get("YONDA_AUTH_FILE"):
        p = Path(os.environ["YONDA_AUTH_FILE"])
        if p.exists():
            return p
    # 複数パスを試行。cwd/data を最優先（app が os.chdir(APP_DIR) 済みの場合に確実にヒット）
    candidates = [
        Path.cwd() / "data" / "auth_jp.json",
        Path.cwd() / "auth_jp.json",
        _DATA_DIR / "auth_jp.json",
        APP_DIR / "data" / "auth_jp.json",
        APP_DIR / "auth_jp.json",
    ]
    for c in candidates:
        if c.exists():
            return c
    return Path.cwd() / "data" / "auth_jp.json"


AUTH_FILE = _resolve_auth_file()
LIBRARY_PAGE_SIZE = 1000


class AudibleJPAdapter(LibraryAdapter):
    """Amazon Audible Japan 用アダプタ。auth_jp.json を使って認証する。"""

    _client = None

    @property
    def library_id(self) -> str:
        return "audible_jp"

    @property
    def library_name(self) -> str:
        return "Audible Japan"

    @property
    def library_url(self) -> str:
        return "https://www.audible.co.jp"

    @property
    def needs_credentials(self) -> bool:
        return False

    # ------------------------------------------------------------------

    def login(self, session: Optional[requests.Session], credentials: Optional[LibraryCredentials]) -> bool:
        if audible is None:
            logger.error("audible パッケージが未インストールです")
            return False
        auth_path = _resolve_auth_file()
        if not auth_path.exists():
            logger.error("認証ファイルが見つかりません: %s（data/auth_jp.json を確認してください）", auth_path)
            return False
        try:
            auth = audible.Authenticator.from_file(str(auth_path), encryption=False)
            self._client = audible.Client(auth)
            self._client.switch_marketplace("jp")
            logger.info("Audible Japan 認証成功")
            return True
        except Exception:
            logger.exception("Audible 認証に失敗")
            return False

    def fetch_history(self, session: Optional[requests.Session]) -> list[BookRecord]:
        if self._client is None:
            raise RuntimeError("login() を先に呼び出してください")

        items = self._fetch_library()
        finished_dates = self._get_finished_dates()
        favorite_asins = self._get_favorite_asins()
        catalog_data = self._fetch_catalog_reviews([i.get("asin") for i in items if i.get("asin")])

        books: list[BookRecord] = []
        for item in items:
            asin = item.get("asin", "")
            prod = item.get("product") or item
            if not isinstance(prod, dict):
                prod = item

            title = (prod.get("title") or item.get("title") or "").strip()
            author = self._extract_author(prod)
            narrator = self._extract_narrator(prod)
            cover_url = self._extract_cover_url(prod.get("product_images", {}))
            purchase_date = self._extract_purchase_date(item)
            cd = catalog_data.get(asin, {})
            my_rating = cd.get("rating") if asin in catalog_data else None
            if my_rating is None:
                my_rating = self._extract_my_rating(item)
            catalog_rating = cd.get("catalog_rating") if asin in catalog_data else None
            if catalog_rating is None:
                catalog_rating = self._extract_avg_rating(item)
            catalog_rating_content = cd.get("catalog_rating_content", "") if asin in catalog_data else ""
            review_headline = cd.get("headline", "") or self._extract_review_headline(item)
            is_completed = self._is_completed(item)
            runtime = prod.get("runtime_length_min", 0) or 0

            comment_parts = []
            if narrator:
                comment_parts.append(f"ナレーター: {narrator}")
            if runtime:
                h, m = divmod(int(runtime), 60)
                comment_parts.append(f"{h}時間{m}分" if h else f"{m}分")

            genre = self._extract_genre(prod, item)
            summary = self._extract_summary(prod, item)
            full_summary = self._extract_full_summary(prod, item)
            completed_date, percent_complete = self._extract_finished_and_progress(item, prod)
            if not completed_date:
                completed_date = self._format_date(finished_dates.get(asin, ""))
            is_favorite = asin in favorite_asins

            book = BookRecord(
                title=title or "不明なタイトル",
                author=author,
                loan_date=self._format_date(purchase_date),
                loan_location="Audible JP",
                rating=my_rating or 0,
                comment=" / ".join(comment_parts),
                review_headline=review_headline or "",
                catalog_rating=catalog_rating or 0.0,
                catalog_rating_content=catalog_rating_content or "",
                cover_url=cover_url or "",
                detail_url=f"https://www.audible.co.jp/pd/{asin}" if asin else "",
                catalog_number=asin,
                completed=is_completed or (my_rating is not None and my_rating > 0),
                source=self.library_id,
                genre=genre,
                summary=summary,
                full_summary=full_summary,
                completed_date=completed_date,
                percent_complete=percent_complete,
                favorite=is_favorite,
            )
            books.append(book)

        logger.info("Audible Japan: %d 冊取得", len(books))
        try:
            self._client.close()
        except Exception:
            pass
        self._client = None
        return books

    # ------------------------------------------------------------------
    # Library fetching
    # ------------------------------------------------------------------

    def _fetch_library(self) -> list[dict]:
        all_items: list[dict] = []
        page = 1
        response_groups = (
            "rating,listening_status,provided_review,product_desc,contributors,media,"
            "is_finished,percent_complete,order_details,product_details,product_attrs,"
            "product_extended_attrs,series,category_ladders"
        )
        while True:
            library = self._client.get(
                "library",
                num_results=LIBRARY_PAGE_SIZE,
                page=page,
                response_groups=response_groups,
            )
            items = library.get("items", [])
            if not items:
                break
            all_items.extend(items)
            logger.info("Audible ページ %d: %d 冊取得", page, len(items))
            if len(items) < LIBRARY_PAGE_SIZE:
                break
            page += 1
        return all_items

    def _get_finished_dates(self) -> dict[str, str]:
        result: dict[str, str] = {}
        try:
            resp = self._client.get("stats/status/finished", start_date="2000-01-01T00:00:00Z")
            items = resp.get("items", []) or resp.get("finished_items", []) or []
            # mark_as_finished_status_list 形式（API によって返す構造が異なる）
            if not items and "mark_as_finished_status_list" in resp:
                items = resp.get("mark_as_finished_status_list", [])
            if not isinstance(items, list):
                items = [items] if items else []
            for item in items:
                if not isinstance(item, dict):
                    continue
                asin = item.get("asin")
                dt = (
                    item.get("completion_date")
                    or item.get("finished_date")
                    or item.get("date")
                    or item.get("timestamp")
                    or item.get("update_date")
                    or item.get("updated_date")
                )
                if asin and dt:
                    result[asin] = dt
        except Exception:
            logger.debug("完了日時の取得に失敗", exc_info=True)
        return result

    def _fetch_catalog_reviews(self, asins: list[str]) -> dict[str, dict]:
        """カタログAPI・ライブラリAPIから各ASINの総合評価(catalog_rating)、自分の評価(rating)、見出し(headline)を取得。
        author_name=ktrips のレビューがあればその overall_rating を優先、なければ全体の overall_rating を使用。"""
        result: dict[str, dict] = {}
        if not asins:
            return result
        unique_asins = list(dict.fromkeys(a for a in asins if a))
        rg = "provided_review,rating,reviews"

        def _extract_ktrips(item: dict) -> tuple[Optional[float], str]:
            """customer_reviews から author_name=ktrips の overall_rating と body を取得"""
            reviews = item.get("customer_reviews") or []
            if not reviews and isinstance(item.get("product"), dict):
                reviews = item.get("product", {}).get("customer_reviews") or []
            if not isinstance(reviews, list):
                return None, ""
            for rv in reviews:
                if not isinstance(rv, dict):
                    continue
                if (rv.get("author_name") or "").strip() == "ktrips":
                    ratings = rv.get("ratings") or {}
                    if isinstance(ratings, dict):
                        val = ratings.get("overall_rating")
                        if val is not None:
                            try:
                                v = float(val)
                                if 0 <= v <= 5:
                                    body = (rv.get("body") or "").strip()
                                    body = re.sub(r"<[^>]+>", " ", body)
                                    body = re.sub(r"\s+", " ", body).strip()
                                    return round(v, 1), body
                            except (ValueError, TypeError):
                                pass
                    break
            return None, ""

        def _extract(item: dict) -> tuple[Optional[int], Optional[float], str, Optional[float], str]:
            my_r = self._extract_my_rating(item)
            avg_r = self._extract_avg_rating(item)
            h = self._extract_review_headline(item)
            ktrips_r, ktrips_body = _extract_ktrips(item)
            return my_r, avg_r, h or "", ktrips_r, ktrips_body

        # 1. カタログAPI（バッチ）を試行
        batch_size = 20
        for i in range(0, len(unique_asins), batch_size):
            batch = unique_asins[i : i + batch_size]
            try:
                resp = self._client.get(
                    "catalog/products",
                    asins=",".join(batch),
                    response_groups=rg,
                )
                products = resp.get("products", []) or resp.get("items", []) or []
                if not products and "product" in resp:
                    products = [resp["product"]]
                if isinstance(products, dict):
                    products = [products]
                for p in products:
                    if not isinstance(p, dict):
                        continue
                    prod = p.get("product")
                    asin = p.get("asin") or (prod.get("asin") if isinstance(prod, dict) else None)
                    if not asin:
                        continue
                    item = prod if isinstance(prod, dict) else p
                    my_r, avg_r, h, ktrips_r, ktrips_body = _extract(p)
                    if my_r is None and avg_r is None and not h and ktrips_r is None:
                        my_r, avg_r, h, ktrips_r, ktrips_body = _extract(item)
                    catalog_r = ktrips_r if ktrips_r is not None else avg_r
                    if my_r is not None or catalog_r is not None or h or ktrips_body:
                        result[asin] = {
                            "rating": my_r or 0,
                            "catalog_rating": catalog_r,
                            "headline": h,
                            "catalog_rating_content": ktrips_body,
                        }
            except Exception as e:
                logger.warning("カタログ評価の取得に失敗 (batch %d): %s", i // batch_size + 1, e)

        # 2. 未取得分は library/{asin} で個別取得（タイムアウト対策で上限30件）
        missing = [a for a in unique_asins if a not in result]
        if missing:
            lib_count = 0
            for asin in missing[:30]:
                my_r, avg_r, h = None, None, ""
                try:
                    resp = self._client.get(
                        f"library/{asin}",
                        response_groups=rg,
                    )
                    item = resp.get("item", resp) if isinstance(resp, dict) else resp
                    my_r, avg_r, h, ktrips_r, ktrips_body = _extract(resp)
                    if my_r is None and avg_r is None and not h and ktrips_r is None:
                        my_r, avg_r, h, ktrips_r, ktrips_body = _extract(item)
                except Exception:
                    pass
                if my_r is None and avg_r is None and not h and ktrips_r is None:
                    try:
                        resp = self._client.get(
                            f"catalog/products/{asin}",
                            response_groups=rg,
                        )
                        prod = resp.get("product", {}) if isinstance(resp, dict) else {}
                        my_r, avg_r, h, ktrips_r, ktrips_body = _extract(resp)
                        if my_r is None and avg_r is None and not h and ktrips_r is None:
                            my_r, avg_r, h, ktrips_r, ktrips_body = _extract(prod)
                    except Exception:
                        pass
                catalog_r = ktrips_r if ktrips_r is not None else avg_r
                if my_r is not None or catalog_r is not None or h or ktrips_body:
                    result[asin] = {
                        "rating": my_r or 0,
                        "catalog_rating": catalog_r,
                        "headline": h or "",
                        "catalog_rating_content": ktrips_body or "",
                    }
                    lib_count += 1
            if lib_count:
                logger.info("個別APIから評価・見出しを取得: %d 件", lib_count)

        # 3. API で未取得の catalog_rating を write-review ページから取得
        missing_rating = []
        for asin in unique_asins:
            if asin not in result or (result.get(asin) or {}).get("catalog_rating") in (None, 0, 0.0):
                missing_rating.append(asin)
        if missing_rating:
            fetched = 0
            for asin in missing_rating[:5]:  # タイムアウト対策: 最大5件まで
                r = self._fetch_rating_from_write_review(asin)
                if r is not None and r > 0:
                    if asin not in result:
                        result[asin] = {"rating": 0, "catalog_rating": None, "headline": ""}
                    result[asin]["catalog_rating"] = r
                    fetched += 1
            if fetched:
                logger.info("Audible 商品ページから総合評価を取得: %d 件", fetched)

        if result:
            logger.info("評価・見出しを取得: 合計 %d 件", len(result))
        return result

    def _get_favorite_asins(self) -> set[str]:
        asins: set[str] = set()
        for path in ("library/collections/__FAVORITES/products", "collections/__FAVORITES/items"):
            try:
                resp = self._client.get(path, page_size=1000)
                items = resp.get("items", []) or resp.get("products", []) or []
                for item in items:
                    if isinstance(item, dict):
                        prod = item.get("product")
                        asin = item.get("asin") or (prod.get("asin") if isinstance(prod, dict) else None)
                    else:
                        asin = str(item) if item else None
                    if asin:
                        asins.add(asin)
                if asins:
                    break
            except Exception:
                continue
        return asins

    # ------------------------------------------------------------------
    # Extraction helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _extract_genre(prod: dict, item: dict) -> str:
        """category_ladders からジャンル名を抽出。
        構造: [{ladder: [{id, name}, ...]}, ...]"""
        genres: list[str] = []
        seen: set[str] = set()
        for src in (item, prod):
            ladders = src.get("category_ladders", []) or []
            if not isinstance(ladders, list):
                continue
            for entry in ladders:
                if not isinstance(entry, dict):
                    continue
                ladder_list = entry.get("ladder", []) or []
                if not isinstance(ladder_list, list):
                    continue
                for node in ladder_list:
                    if not isinstance(node, dict):
                        continue
                    name = (node.get("name") or "").strip()
                    if name and name not in seen:
                        seen.add(name)
                        genres.append(name)
        return " / ".join(genres) if genres else ""

    @staticmethod
    def _extract_finished_and_progress(item: dict, prod: dict) -> tuple[str, float]:
        """listening_status から finished_at_timestamp と percent_complete を抽出"""
        completed_date = ""
        percent_complete = 0.0
        for src in (item, prod):
            ls = src.get("listening_status")
            if isinstance(ls, dict):
                ts = ls.get("finished_at_timestamp")
                if ts:
                    completed_date = AudibleJPAdapter._normalize_datetime(str(ts))
                pct = ls.get("percent_complete")
                if pct is not None:
                    try:
                        percent_complete = float(pct)
                    except (ValueError, TypeError):
                        pass
            if percent_complete == 0:
                pct = src.get("percent_complete")
                if pct is not None:
                    try:
                        percent_complete = float(pct)
                    except (ValueError, TypeError):
                        pass
        return completed_date, percent_complete

    @staticmethod
    def _extract_summary(prod: dict, item: dict) -> str:
        """publisher_summary / merchandising_summary から概要テキストを抽出"""
        raw = ""
        for src in (item, prod):
            for key in ("publisher_summary", "merchandising_summary",
                        "product_desc", "extended_product_description",
                        "short_description"):
                val = src.get(key)
                if isinstance(val, str) and val.strip():
                    raw = val
                    break
                if isinstance(val, dict):
                    raw = val.get("full") or val.get("short") or ""
                    if raw:
                        break
            if raw:
                break
        if not raw:
            return ""
        text = re.sub(r"<[^>]+>", " ", raw).strip()
        text = re.sub(r"\s+", " ", text)
        return (text[:200] + "…") if len(text) > 200 else text

    @staticmethod
    def _extract_full_summary(prod: dict, item: dict) -> str:
        """publisher_summary 等の全文を抽出（詳細表示用）"""
        raw = ""
        for src in (item, prod):
            for key in ("publisher_summary", "merchandising_summary",
                        "product_desc", "extended_product_description",
                        "short_description"):
                val = src.get(key)
                if isinstance(val, str) and val.strip():
                    raw = val
                    break
                if isinstance(val, dict):
                    raw = val.get("full") or val.get("short") or ""
                    if raw:
                        break
            if raw:
                break
        if not raw:
            return ""
        text = re.sub(r"<[^>]+>", " ", raw).strip()
        text = re.sub(r"\s+", " ", text)
        return text[:3000] if len(text) > 3000 else text

    @staticmethod
    def _extract_author(prod: dict) -> str:
        contributors = prod.get("contributors", []) or []
        for c in (contributors if isinstance(contributors, list) else []):
            if isinstance(c, dict):
                role = (c.get("role") or "").lower()
                name = c.get("name") or ""
                if "author" in role and name:
                    return name
        authors = prod.get("authors", [])
        if isinstance(authors, list) and authors and isinstance(authors[0], dict):
            return authors[0].get("name", "")
        return ""

    @staticmethod
    def _extract_narrator(prod: dict) -> str:
        narrators = []
        contributors = prod.get("contributors", []) or []
        for c in (contributors if isinstance(contributors, list) else []):
            if isinstance(c, dict):
                role = (c.get("role") or "").lower()
                name = c.get("name") or ""
                if "narrator" in role and name:
                    narrators.append(name)
        if not narrators:
            narrs = prod.get("narrators", []) or []
            for n in (narrs if isinstance(narrs, list) else []):
                if isinstance(n, dict):
                    name = n.get("name") or ""
                    if name:
                        narrators.append(name)
        return ", ".join(narrators)

    @staticmethod
    def _extract_cover_url(images: dict) -> str:
        if not isinstance(images, dict) or not images:
            return ""
        return images.get("500") or images.get("315") or next(iter(images.values()), "") or ""

    @staticmethod
    def _extract_purchase_date(item: dict) -> str:
        date_keys = ("purchase_date", "order_date", "date", "purchaseDate", "orderDate", "created_at")
        order_details = item.get("order_details")
        if isinstance(order_details, dict):
            for key in date_keys:
                val = order_details.get(key)
                if val:
                    return str(val)
        elif isinstance(order_details, list) and order_details:
            first = order_details[0]
            if isinstance(first, dict):
                for key in date_keys:
                    val = first.get(key)
                    if val:
                        return str(val)
        for key in ("purchase_date", "order_date", "date_added", "purchaseDate", "orderDate"):
            val = item.get(key)
            if val:
                return str(val)
        return ""

    @staticmethod
    def _extract_avg_rating(item: dict) -> Optional[float]:
        """商品の総合評価（全ユーザー平均）を抽出。provided_review はユーザー評価なので除外"""
        r = item.get("rating")
        if r is None:
            prod = item.get("product")
            if isinstance(prod, dict):
                return AudibleJPAdapter._extract_avg_rating(prod)
            return None
        if isinstance(r, dict):
            # overall_distribution 形式（カタログAPI）
            od = r.get("overall_distribution") or {}
            if isinstance(od, dict):
                val = od.get("display_average_rating") or od.get("average_rating")
                if val is not None:
                    try:
                        v = float(val)
                        if 0 <= v <= 5:
                            return round(v, 1)
                    except (ValueError, TypeError):
                        pass
            r = r.get("overall_rating") or r.get("avg_rating") or r.get("rating") or r.get("value")
        if r is None:
            return None
        try:
            v = float(r) if isinstance(r, (int, float)) else float(str(r))
            if 0 <= v <= 5:
                return round(v, 1)
        except (ValueError, TypeError):
            pass
        return None

    @staticmethod
    def _fetch_rating_from_write_review(asin: str) -> Optional[float]:
        """商品ページ（pd）から総合評価を取得。write-review はログイン必須のため pd を使用"""
        if not asin or not asin.strip():
            return None
        try:
            from bs4 import BeautifulSoup
        except ImportError:
            return None
        url = AUDIBLE_PD_BASE + asin.strip()
        try:
            r = requests.get(
                url,
                headers={
                    "User-Agent": (
                        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                    ),
                    "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
                },
                timeout=15,
            )
            r.raise_for_status()
        except requests.RequestException as e:
            logger.debug("Audible pd 取得失敗 (%s): %s", asin, e)
            return None

        soup = BeautifulSoup(r.content, "html.parser")

        # JSON-LD aggregateRating
        for script in soup.find_all("script", type="application/ld+json"):
            try:
                data = json.loads(script.string or "{}")
                ar = None
                if isinstance(data, dict):
                    ar = data.get("aggregateRating")
                    if ar is None and "@graph" in data:
                        for it in data.get("@graph") or []:
                            if isinstance(it, dict) and "aggregateRating" in it:
                                ar = it.get("aggregateRating")
                                break
                elif isinstance(data, list):
                    for it in data:
                        if isinstance(it, dict) and "aggregateRating" in it:
                            ar = it.get("aggregateRating")
                            break
                if isinstance(ar, dict):
                    val = ar.get("ratingValue") or ar.get("rating")
                    if val is not None:
                        v = float(val)
                        if 0 <= v <= 5:
                            return round(v, 1)
            except (json.JSONDecodeError, TypeError, ValueError):
                pass

        # 総合評価 テキスト（例: "4.5" "4.5つ星"）
        for elem in soup.find_all(string=re.compile(r"総合評価|平均|★|☆")):
            parent = elem.parent
            if parent:
                text = parent.get_text() if hasattr(parent, "get_text") else str(parent)
            else:
                text = str(elem)
            m = re.search(r"(\d+\.?\d*)\s*[つ個]?\s*[星★☆]?", text)
            if m:
                try:
                    v = float(m.group(1))
                    if 0 <= v <= 5:
                        return round(v, 1)
                except ValueError:
                    pass

        # data-rating, aria-label 等
        for tag in soup.find_all(attrs={"data-rating": True}):
            try:
                v = float(tag["data-rating"])
                if 0 <= v <= 5:
                    return round(v, 1)
            except (ValueError, TypeError, KeyError):
                pass

        # 星の数（★の数）
        for tag in soup.find_all(class_=re.compile(r"rating|star", re.I)):
            text = tag.get_text() if hasattr(tag, "get_text") else str(tag)
            filled = len(re.findall(r"★|filled|full", text, re.I))
            if 1 <= filled <= 5:
                return float(filled)

        return None

    @staticmethod
    def _extract_my_rating(item: dict) -> Optional[int]:
        pr = item.get("provided_review")
        if isinstance(pr, dict):
            for key in ("overall_rating", "rating", "star_rating", "overall_star_rating", "performance_rating", "story_rating"):
                val = pr.get(key)
                if val is not None:
                    try:
                        r = int(float(val))
                        if 1 <= r <= 5:
                            return r
                    except (ValueError, TypeError):
                        pass
        val = item.get("rating")
        if val is not None:
            if isinstance(val, dict):
                for k in ("overall_rating", "rating", "star_rating", "value"):
                    v = val.get(k)
                    if v is not None:
                        try:
                            r = int(float(v))
                            if 1 <= r <= 5:
                                return r
                        except (ValueError, TypeError):
                            pass
            else:
                try:
                    r = int(float(val))
                    if 1 <= r <= 5:
                        return r
                except (ValueError, TypeError):
                    pass
        prod = item.get("product")
        if isinstance(prod, dict):
            return AudibleJPAdapter._extract_my_rating(prod)
        return None

    @staticmethod
    def _extract_review_headline(item: dict) -> str:
        """provided_review からレビュー見出しを抽出"""
        pr = item.get("provided_review")
        if isinstance(pr, dict):
            for key in ("review_title", "title", "headline", "review_headline", "head_line"):
                val = pr.get(key)
                if val and isinstance(val, str):
                    return val.strip()
        prod = item.get("product")
        if isinstance(prod, dict):
            return AudibleJPAdapter._extract_review_headline(prod)
        return ""

    @staticmethod
    def _is_completed(item: dict) -> bool:
        if item.get("is_finished") in (True, "true", "True", "1"):
            return True
        pct = item.get("percent_complete")
        if pct is not None:
            try:
                if int(float(pct)) >= 100:
                    return True
            except (ValueError, TypeError):
                pass
        if item.get("listening_status") == "Finished":
            return True
        return False

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
        return raw[:10] if len(raw) >= 10 else raw

    @staticmethod
    def _normalize_datetime(raw: str) -> str:
        """日時を含む場合はそのまま返し、日付のみなら YYYY-MM-DD に正規化。並び替えで時間を含めて比較するため"""
        if not raw:
            return ""
        raw = str(raw).strip()
        # ISO形式 (2026-02-27T10:25:17.379Z 等) はそのまま返す
        if "T" in raw or (len(raw) > 10 and raw[10] in (" ", "T")):
            return raw
        return AudibleJPAdapter._format_date(raw)
