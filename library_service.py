"""読書記録の取得・保存・読込を統括するサービス層"""
from __future__ import annotations

import json
import logging
import os
import re
import time
from datetime import datetime
from pathlib import Path
from typing import Optional
import requests

from adapters import get_adapter, list_libraries
from adapters.base import LibraryCredentials, BookRecord

from config_paths import get_credentials_path, ensure_config_dir

logger = logging.getLogger(__name__)

# 図書館の本の表紙取得: Open Library API（多くの表紙は Amazon 等と共通）
OPENLIBRARY_SEARCH = "https://openlibrary.org/search.json"
OPENLIBRARY_BOOKS = "https://openlibrary.org/api/books"

APP_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get(
    "YONDA_DATA_DIR",
    str(APP_DIR / "data"),
))
CREDS_PATH = get_credentials_path()

_JSON_MAP: dict[str, Path] = {
    "setagaya": DATA_DIR / "library_books.json",
    "audible_jp": DATA_DIR / "audible_books.json",
    "kindle": DATA_DIR / "kindle_books.json",
}

_ENV_MAP = {
    "setagaya": ("SETAGAYA_USER_ID", "SETAGAYA_PASSWORD"),
}


def _json_path_for(library_id: str) -> Path:
    return _JSON_MAP.get(library_id, DATA_DIR / f"{library_id}_books.json")


# ------------------------------------------------------------------
# 認証情報管理
# ------------------------------------------------------------------

def save_credentials(library_id: str, user_id: str, password: str) -> None:
    """認証情報をローカルファイルに保存（~/.config/yonda/credentials.json）"""
    ensure_config_dir()
    all_creds = _load_all_credentials()
    all_creds[library_id] = {"user_id": user_id, "password": password}
    with open(CREDS_PATH, "w", encoding="utf-8") as f:
        json.dump(all_creds, f, ensure_ascii=False, indent=2)
    CREDS_PATH.chmod(0o600)
    logger.info("認証情報を保存: %s", library_id)


def delete_credentials(library_id: str) -> None:
    """認証情報を削除"""
    ensure_config_dir()
    all_creds = _load_all_credentials()
    all_creds.pop(library_id, None)
    with open(CREDS_PATH, "w", encoding="utf-8") as f:
        json.dump(all_creds, f, ensure_ascii=False, indent=2)
    CREDS_PATH.chmod(0o600)


def has_credentials(library_id: str) -> bool:
    """認証情報が設定済みか（Kindle は Amazon認証 または データファイルの存在で判定）"""
    adapter = get_adapter(library_id)
    if library_id == "kindle":
        creds = _load_all_credentials().get(library_id)
        if creds and creds.get("user_id") and creds.get("password"):
            return True
        return adapter.login(None, None)
    if not adapter.needs_credentials:
        from adapters.audible import _resolve_auth_file
        return _resolve_auth_file().exists()
    creds = _load_all_credentials().get(library_id)
    if creds and creds.get("user_id") and creds.get("password"):
        return True
    keys = _ENV_MAP.get(library_id, (f"{library_id.upper()}_USER_ID", f"{library_id.upper()}_PASSWORD"))
    return bool(os.environ.get(keys[0])) and bool(os.environ.get(keys[1]))


def get_credentials_info(library_id: str) -> dict:
    """認証情報の登録状態を返す（パスワードは含まない）"""
    adapter = get_adapter(library_id)
    if library_id == "kindle":
        creds = _load_all_credentials().get(library_id)
        if creds and creds.get("user_id"):
            return {"configured": True, "user_id": creds["user_id"], "source": "amazon"}
        configured = adapter.login(None, None)
        return {
            "configured": configured,
            "user_id": "Kindle データファイル検出" if configured else "",
            "source": "local_file" if configured else "",
        }
    if not adapter.needs_credentials:
        from adapters.audible import _resolve_auth_file
        auth_exists = _resolve_auth_file().exists()
        return {
            "configured": auth_exists,
            "user_id": "auth_jp.json" if auth_exists else "",
            "source": "auth_file" if auth_exists else "",
        }
    creds = _load_all_credentials().get(library_id)
    if creds and creds.get("user_id"):
        return {"configured": True, "user_id": creds["user_id"], "source": "file"}
    keys = _ENV_MAP.get(library_id, (f"{library_id.upper()}_USER_ID", f"{library_id.upper()}_PASSWORD"))
    uid = os.environ.get(keys[0], "")
    if uid:
        return {"configured": True, "user_id": uid, "source": "env"}
    return {"configured": False, "user_id": "", "source": ""}


def test_login(library_id: str) -> bool:
    """認証情報でログインをテスト"""
    adapter = get_adapter(library_id)
    if library_id == "kindle":
        creds = _load_all_credentials().get(library_id)
        if creds and creds.get("user_id") and creds.get("password"):
            session = requests.Session()
            session.headers.update({
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                              "AppleWebKit/537.36 (KHTML, like Gecko) "
                              "Chrome/120.0.0.0 Safari/537.36",
            })
            return adapter.login(session, LibraryCredentials(
                user_id=creds["user_id"], password=creds["password"]
            ))
        return adapter.login(None, None)
    if not adapter.needs_credentials:
        return adapter.login(None, None)
    creds = _get_credentials(library_id)
    session = requests.Session()
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                       "AppleWebKit/537.36 (KHTML, like Gecko) "
                       "Chrome/120.0.0.0 Safari/537.36",
    })
    return adapter.login(session, creds)


def _load_all_credentials() -> dict:
    if not CREDS_PATH.exists():
        return {}
    try:
        with open(CREDS_PATH, encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}


def _get_credentials(library_id: str) -> LibraryCredentials:
    creds = _load_all_credentials().get(library_id)
    if creds and creds.get("user_id") and creds.get("password"):
        return LibraryCredentials(user_id=creds["user_id"], password=creds["password"])
    keys = _ENV_MAP.get(library_id, (f"{library_id.upper()}_USER_ID", f"{library_id.upper()}_PASSWORD"))
    uid = os.environ.get(keys[0], "")
    pwd = os.environ.get(keys[1], "")
    if not uid or not pwd:
        raise ValueError("認証情報が未登録です。メニューから「アカウント設定」で登録してください。")
    return LibraryCredentials(user_id=uid, password=pwd)


def fetch_and_save(library_id: str) -> dict:
    """読書記録を取得し、JSON + MD に保存。"""
    adapter = get_adapter(library_id)

    if library_id == "kindle":
        creds = _load_all_credentials().get(library_id)
        if creds and creds.get("user_id") and creds.get("password"):
            session = requests.Session()
            session.headers.update({
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                              "AppleWebKit/537.36 (KHTML, like Gecko) "
                              "Chrome/120.0.0.0 Safari/537.36",
                "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
            })

            # 1. 保存済みセッションを試す
            session_loaded = adapter.load_session(session)
            session_valid = False
            if session_loaded:
                logger.info("保存済みセッションを検証中...")
                session_valid = adapter.verify_session(session)

            # 2. セッションが無効なら再ログイン
            if not session_valid:
                logger.info("Amazon に再ログイン中...")
                if not adapter.login(session, LibraryCredentials(
                    user_id=creds["user_id"], password=creds["password"]
                )):
                    raise RuntimeError("Amazon へのログインに失敗しました。メールアドレスとパスワードを確認してください。")

            # 3. データ取得（取得成功時にセッションが自動保存される）
            records = adapter.fetch_history(session)
        else:
            if not adapter.login(None, None):
                msg = (
                    "Kindle データファイルが見つかりません。"
                    "アカウント設定で Amazon メールアドレスとパスワードを登録するか、"
                    "Kindle for PC/Mac を起動して同期するか、"
                    "環境変数 YONDA_KINDLE_XML_PATH または YONDA_KINDLE_SQLITE_PATH でパスを指定してください。"
                )
                raise RuntimeError(msg)
            records = adapter.fetch_history(None)
    elif library_id == "audible_jp":
        try:
            if not adapter.login(None, None):
                raise RuntimeError(
                    f"{adapter.library_name} への認証に失敗しました。auth_jp.json を確認するか、"
                    "audible-cli で再認証してください。"
                )
            records = adapter.fetch_history(None)
        except RuntimeError:
            raise
        except Exception as e:
            err_msg = str(e).strip() or type(e).__name__
            try:
                from audible.exceptions import NetworkError, Unauthorized, RequestError
                if isinstance(e, NetworkError):
                    raise RuntimeError(
                        "Audible API に接続できません。ネットワーク接続を確認するか、"
                        "しばらく待ってから再度お試しください。"
                    ) from e
                if isinstance(e, Unauthorized):
                    raise RuntimeError(
                        "Audible の認証が期限切れです。audible-cli で再認証し、"
                        "auth_jp.json を更新してください。"
                    ) from e
                if isinstance(e, RequestError):
                    raise RuntimeError(f"Audible API エラー: {err_msg}") from e
            except ImportError:
                pass
            raise RuntimeError(f"Audible データ取得に失敗しました: {err_msg}") from e
    elif adapter.needs_credentials:
        creds = _get_credentials(library_id)
        session = requests.Session()
        session.headers.update({
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                           "AppleWebKit/537.36 (KHTML, like Gecko) "
                           "Chrome/120.0.0.0 Safari/537.36",
        })
        if not adapter.login(session, creds):
            raise RuntimeError(f"{adapter.library_name} へのログインに失敗しました")
        records: list[BookRecord] = adapter.fetch_history(session)
    else:
        if not adapter.login(None, None):
            msg = f"{adapter.library_name} への認証に失敗しました。"
            raise RuntimeError(msg)
        records = adapter.fetch_history(None)

    if not records:
        if library_id == "kindle":
            raise RuntimeError(
                "読書記録が取得できませんでした。Kindle for PC/Mac を起動して蔵書を同期した後、再度お試しください。"
                " データファイルのパスは環境変数 YONDA_KINDLE_XML_PATH または YONDA_KINDLE_SQLITE_PATH で指定できます。"
            )
        raise RuntimeError("読書記録が取得できませんでした")

    _enrich_library_books(records, library_id)
    payload = _build_payload(adapter, records)
    _save_json(library_id, payload)
    _save_markdown(adapter, records)

    return payload


def load_saved() -> Optional[dict]:
    """全ソースの保存済み JSON を統合して読み込む。デフォルトは library_books.json と audible_books.json"""
    all_books: list[dict] = []
    sources: list[dict] = []

    # デフォルトのライブラリデータ: setagaya, audible_jp を優先（kindle はあれば追加）
    load_order = ("setagaya", "audible_jp", "kindle")
    for lid in load_order:
        path = _JSON_MAP.get(lid)
        if not path or not path.exists():
            continue
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
            books = data.get("books", [])
            for b in books:
                if not b.get("source"):
                    b["source"] = lid
                if lid == "setagaya" and (b.get("runtime_length_min") or 0) == 0:
                    b["runtime_length_min"] = 240  # 図書館の本は一律4時間
            all_books.extend(books)
            sources.append({
                "library_id": data.get("library_id", lid),
                "library_name": data.get("library_name", lid),
                "total": len(books),
                "fetch_date": data.get("fetch_date", ""),
            })
        except (json.JSONDecodeError, OSError) as e:
            logger.warning("JSON 読込失敗 (%s): %s", path, e)

    if not all_books:
        return None

    all_books.sort(key=lambda b: b.get("loan_date", ""), reverse=True)

    return {
        "sources": sources,
        "total": len(all_books),
        "books": all_books,
    }


def load_saved_for(library_id: str) -> Optional[dict]:
    """特定ソースの保存済み JSON を読み込む"""
    path = _json_path_for(library_id)
    if not path.exists():
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def get_available_libraries() -> list[dict]:
    libs = list_libraries()
    for lib in libs:
        lib["configured"] = has_credentials(lib["id"])
    return libs


def adapter_needs_credentials(library_id: str) -> bool:
    """アダプタがユーザーID/パスワード認証を必要とするか"""
    return get_adapter(library_id).needs_credentials


def get_kindle_credentials() -> Optional[dict]:
    """Kindle の認証情報を返す（user_id, password）。未登録なら None"""
    return _load_all_credentials().get("kindle")


def save_kindle_records_and_load(records: list[BookRecord]) -> dict:
    """Kindle の読書記録を保存し、全ソース統合データを返す"""
    adapter = get_adapter("kindle")
    payload = _build_payload(adapter, records)
    _save_json("kindle", payload)
    _save_markdown(adapter, records)
    return load_saved() or {"sources": [], "total": 0, "books": []}


# ------------------------------------------------------------------
# 図書館の本: 表紙は book.png、概要・ジャンルは Open Library から取得（Amazon 等と共通の書誌データが多い）
# ------------------------------------------------------------------

LIBRARY_COVER_URL = "/static/book.png"


def _fetch_summary_and_genre_from_open_library(
    title: str, author: str, isbn: Optional[str] = None
) -> tuple[Optional[str], Optional[str]]:
    """Open Library API で概要とジャンルを取得。戻り値は (summary, genre)。"""
    if not title and not author and not isbn:
        return None, None
    try:
        if isbn:
            isbn_clean = re.sub(r"\D", "", isbn)
            if len(isbn_clean) >= 10:
                r = requests.get(
                    OPENLIBRARY_BOOKS,
                    params={
                        "bibkeys": f"ISBN:{isbn_clean}",
                        "format": "json",
                        "jscmd": "details",
                    },
                    timeout=8,
                )
                r.raise_for_status()
                data = r.json()
                key = f"ISBN:{isbn_clean}"
                if key in data and data[key]:
                    item = data[key]
                    summary = None
                    details = item.get("details", {})
                    if isinstance(details, dict):
                        desc = details.get("description")
                        if isinstance(desc, str):
                            summary = re.sub(r"<[^>]+>", "", desc).strip()
                        elif isinstance(desc, dict) and "value" in desc:
                            summary = re.sub(r"<[^>]+>", "", str(desc.get("value", ""))).strip()
                    genre = None
                    subjects = details.get("subjects", []) if isinstance(details, dict) else []
                    if subjects and isinstance(subjects[0], str):
                        genre = subjects[0]
                    elif subjects and isinstance(subjects[0], dict) and "name" in subjects[0]:
                        genre = subjects[0]["name"]
                    return summary or None, genre
        q = " ".join(filter(None, [title, author]))
        if not q.strip():
            return None, None
        r = requests.get(
            OPENLIBRARY_SEARCH,
            params={"q": q.strip(), "limit": 3, "fields": "first_sentence,subject"},
            timeout=8,
        )
        r.raise_for_status()
        data = r.json()
        docs = data.get("docs", [])
        for doc in docs:
            summary = None
            first_sent = doc.get("first_sentence")
            if isinstance(first_sent, list) and first_sent:
                summary = (first_sent[0] if isinstance(first_sent[0], str) else str(first_sent[0])).strip()
            elif isinstance(first_sent, str):
                summary = first_sent.strip()
            genre = None
            subjects = doc.get("subject", [])
            if isinstance(subjects, list) and subjects and isinstance(subjects[0], str):
                genre = subjects[0]
            if summary or genre:
                return summary or None, genre or None
    except requests.RequestException as e:
        logger.debug("Open Library 取得失敗: %s", e)
    except Exception as e:
        logger.debug("Open Library 取得エラー: %s", e)
    return None, None


def _enrich_library_books(records: list[BookRecord], library_id: str) -> None:
    """図書館の本について、表紙は book.png、概要・ジャンルは Open Library から取得。"""
    if library_id != "setagaya":
        return
    base = "https://libweb.city.setagaya.tokyo.jp"
    summary_count = genre_count = 0
    for i, book in enumerate(records):
        if not book.title:
            continue
        has_cover = book.cover_url and book.cover_url.strip()
        is_library_cover = has_cover and base in (book.cover_url or "")
        if not has_cover or is_library_cover:
            book.cover_url = LIBRARY_COVER_URL
        needs_summary = not (book.full_summary or book.summary or "").strip()
        needs_genre = not (book.genre or "").strip()
        if needs_summary or needs_genre:
            summary, genre = _fetch_summary_and_genre_from_open_library(
                book.title, book.author or ""
            )
            if summary and needs_summary:
                book.full_summary = summary
                book.summary = summary[:100] + "…" if len(summary) > 100 else summary
                summary_count += 1
            if genre and needs_genre:
                book.genre = genre
                genre_count += 1
        if (i + 1) % 5 == 0:
            time.sleep(0.3)
    if summary_count or genre_count:
        logger.info(
            "図書館の本: Open Library から概要 %d 件、ジャンル %d 件を取得",
            summary_count,
            genre_count,
        )


# ------------------------------------------------------------------
# Internal helpers
# ------------------------------------------------------------------

def _build_payload(adapter, records: list[BookRecord]) -> dict:
    return {
        "library_id": adapter.library_id,
        "library_name": adapter.library_name,
        "fetch_date": datetime.now().isoformat(timespec="seconds"),
        "total": len(records),
        "books": [r.to_dict() for r in records],
    }


def _save_json(library_id: str, payload: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    path = _json_path_for(library_id)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    logger.info("JSON 保存: %s (%d 冊)", path, payload["total"])


def _save_markdown(adapter, records: list[BookRecord]) -> None:
    md_path = DATA_DIR / f"{adapter.library_name.replace(' ', '_')}.md"
    completed_count = sum(1 for r in records if r.completed)

    is_audible = "audible" in adapter.library_id
    is_kindle = "kindle" in adapter.library_id
    date_label = "購入日" if (is_audible or is_kindle) else "貸出日"
    loc_label = "ソース" if (is_audible or is_kindle) else "場所"

    lines = [
        "---",
        "tags: [permanent-note, book-list, reading-history]",
        "---",
        f"# {adapter.library_name} 読書記録",
        "",
        f"全{len(records)}冊（読了 {completed_count}冊）。",
        "",
    ]

    # Kindle の場合は読書進捗情報を表示
    if is_kindle:
        avg_progress = sum(r.percent_complete for r in records) / len(records) if records else 0
        lines.extend([
            f"読書進捗: 平均 {avg_progress:.1f}%",
            "",
            "| # | 状態 | タイトル | 著者 | ジャンル | 購入日 | 進捗 | 読了日 | 評価 |",
            "|---|------|---------|------|---------|--------|------|--------|------|",
        ])
        for i, r in enumerate(records, 1):
            title = r.title.replace("|", "｜")
            author = r.author.replace("|", "｜")
            genre = r.genre.replace("|", "｜")[:40] if r.genre else "—"
            stars = "★" * r.rating + "☆" * (5 - r.rating) if r.rating else "—"
            detail = f"[{title}]({r.detail_url})" if r.detail_url else title
            status = "読了" if r.completed else "読中" if r.percent_complete > 0 else ""
            progress = f"{r.percent_complete:.0f}%" if r.percent_complete > 0 else "—"
            completed_date = r.completed_date if r.completed_date else "—"
            lines.append(
                f"| {i} | {status} | {detail} | {author} | {genre} | {r.loan_date} | {progress} | {completed_date} | {stars} |"
            )
    else:
        # その他の図書館（Audible や Setagaya）
        lines.extend([
            f"| # | 状態 | タイトル | 著者 | ジャンル | {date_label} | 評価 |",
            "|---|------|---------|------|---------|--------|------|",
        ])
        for i, r in enumerate(records, 1):
            title = r.title.replace("|", "｜")
            author = r.author.replace("|", "｜")
            genre = r.genre.replace("|", "｜")[:40] if r.genre else "—"
            stars = "★" * r.rating + "☆" * (5 - r.rating) if r.rating else "—"
            detail = f"[{title}]({r.detail_url})" if r.detail_url else title
            status = "読了" if r.completed else ""
            lines.append(
                f"| {i} | {status} | {detail} | {author} | {genre} | {r.loan_date} | {stars} |"
            )

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(md_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    logger.info("Markdown 保存: %s", md_path)
