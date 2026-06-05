"""読書記録の取得・保存・読込を統括するサービス層"""
from __future__ import annotations

import json
import logging
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
import requests

from adapters import get_adapter, list_libraries
from adapters.base import LibraryCredentials, BookRecord

from config_paths import get_credentials_path, get_ai_config_path, ensure_config_dir

logger = logging.getLogger(__name__)

# 図書館の本の表紙・書誌補完: Google Books / Open Library API
GOOGLE_BOOKS_VOLUMES = "https://www.googleapis.com/books/v1/volumes"
OPENLIBRARY_SEARCH = "https://openlibrary.org/search.json"
OPENLIBRARY_BOOKS = "https://openlibrary.org/api/books"


def _get_google_api_key() -> Optional[str]:
    """Google Books API キーを環境変数→AI設定ファイルの順で取得する。"""
    key = os.environ.get("GOOGLE_BOOKS_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if key:
        return key
    # AI設定ファイル（gemini プロバイダーのキーは Google Books でも有効）
    try:
        config_path = get_ai_config_path()
        if config_path.exists():
            with open(config_path, "r", encoding="utf-8") as f:
                cfg = json.load(f)
            if cfg.get("provider") == "gemini" and cfg.get("api_key"):
                return cfg["api_key"]
    except Exception:
        pass
    return None

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

AMAZON_LIST_PATH = DATA_DIR / "amazon_list.json"
BOOK_INSIGHTS_PATH = DATA_DIR / "book_insights.json"
YONDA_MESSAGES_PATH = DATA_DIR / "yonda_messages.json"

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
                ok, needs_otp, _ = adapter._login_amazon(
                    session,
                    LibraryCredentials(user_id=creds["user_id"], password=creds["password"])
                )
                if needs_otp:
                    raise RuntimeError(
                        "Amazon のログインに2段階認証（OTP）が必要です。"
                        "ブラウザでアプリにアクセスし、手動で「読書記録を取得」を実行して OTP を入力してください。"
                        "その後、セッションが保存され、次回以降は自動取得が可能になります。"
                    )
                if not ok:
                    raise RuntimeError("Amazon へのログインに失敗しました。メールアドレスとパスワードを確認してください。")
                # ログイン成功時はセッションを保存
                adapter.save_session(session)

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


def try_auto_fetch_kindle() -> bool:
    """自動取得用: 保存済みセッションが有効な場合のみ Kindle データを取得・保存。
    OTP は要求せず、セッション無効時はスキップして False を返す。
    ローカルファイル（SQLite/XML）がある場合はそちらから取得する。"""
    import requests as _requests
    from adapters.kindle import KindleAdapter

    adapter = KindleAdapter()
    creds = get_kindle_credentials()

    if creds and creds.get("user_id") and creds.get("password"):
        session = _requests.Session()
        session.headers.update({
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            ),
            "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
        })
        if adapter.load_session(session) and adapter.verify_session(session):
            records = adapter.fetch_history(session)
            save_kindle_records_and_load(records)
            logger.info("Kindle 自動取得成功: %d 冊", len(records))
            return True
        logger.info("Kindle: セッション無効のためスキップ（手動ログインが必要）")
        return False

    # Amazon 認証なし → ローカルファイルから取得（ローカル環境向け）
    if adapter.login(None, None):
        records = adapter.fetch_history(None)
        save_kindle_records_and_load(records)
        logger.info("Kindle ローカルファイル取得成功: %d 冊", len(records))
        return True

    logger.info("Kindle: データソースなし、スキップ")
    return False


# ------------------------------------------------------------------
# Amazon ほしいものリスト（ローカル管理）
# ------------------------------------------------------------------

def load_amazon_list() -> dict:
    """Amazon ほしいものリストを読み込む。ファイルがなければ空リストを返す。"""
    if not AMAZON_LIST_PATH.exists():
        return {"books": []}
    try:
        with open(AMAZON_LIST_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"books": []}


def save_amazon_list(books: list) -> None:
    """Amazon ほしいものリストを保存する。"""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(AMAZON_LIST_PATH, "w", encoding="utf-8") as f:
        json.dump({"books": books}, f, ensure_ascii=False, indent=2)


def book_insight_key(book: dict) -> str:
    """本ごとの書評ポイント保存キーを作る。ASIN等があれば優先する。"""
    source = (book.get("source") or "").strip()
    catalog_number = (book.get("catalog_number") or book.get("asin") or "").strip()
    if catalog_number:
        return f"{source or 'book'}:{catalog_number}"
    title = (book.get("title") or "").strip()
    author = (book.get("author") or "").strip()
    raw = f"{source}::{title}::{author}".lower()
    import hashlib
    return "book:" + hashlib.md5(raw.encode("utf-8")).hexdigest()[:16]


def load_book_insights() -> dict:
    """書評ポイントを読み込む。"""
    if not BOOK_INSIGHTS_PATH.exists():
        return {"items": {}}
    try:
        with open(BOOK_INSIGHTS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict) and isinstance(data.get("items"), dict):
            return data
    except Exception:
        logger.warning("書評ポイントの読込に失敗", exc_info=True)
    return {"items": {}}


def get_book_insight(book: dict) -> dict | None:
    """指定本の書評ポイントを返す。"""
    key = book_insight_key(book)
    return load_book_insights().get("items", {}).get(key)


def save_book_insight(book: dict, insight: dict) -> dict:
    """指定本の書評ポイントを保存して返す。"""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    data = load_book_insights()
    key = book_insight_key(book)
    insight = dict(insight)
    insight["id"] = key
    data.setdefault("items", {})[key] = insight
    with open(BOOK_INSIGHTS_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    return insight


def get_completed_books_without_insights(max_count: int | None = None) -> list[dict]:
    """AI書評（insights）が未生成の読了本リストを返す。
    max_count 指定時はその件数で打ち切る。"""
    combined = load_saved()
    if not combined:
        return []
    existing_keys = set(load_book_insights().get("items", {}).keys())
    result: list[dict] = []
    for book in combined.get("books", []):
        if not book.get("completed"):
            continue
        if book_insight_key(book) not in existing_keys:
            result.append(book)
            if max_count and len(result) >= max_count:
                break
    return result


def load_yonda_messages() -> dict:
    """Yonda内メッセージ一覧を読み込む。"""
    if not YONDA_MESSAGES_PATH.exists():
        return {"messages": []}
    try:
        with open(YONDA_MESSAGES_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict) and isinstance(data.get("messages"), list):
            return data
    except Exception:
        logger.warning("Yondaメッセージの読込に失敗", exc_info=True)
    return {"messages": []}


def save_yonda_message(message: dict) -> dict:
    """Yonda内メッセージを先頭に追加して保存する。"""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    data = load_yonda_messages()
    messages = data.setdefault("messages", [])
    messages.insert(0, message)
    del messages[100:]
    with open(YONDA_MESSAGES_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    return message


def update_yonda_message(message: dict) -> dict:
    """同じidのYonda内メッセージを更新する。なければ先頭に追加する。"""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    data = load_yonda_messages()
    messages = data.setdefault("messages", [])
    message_id = message.get("id")
    replaced = False
    if message_id:
        for i, existing in enumerate(messages):
            if existing.get("id") == message_id:
                messages[i] = message
                replaced = True
                break
    if not replaced:
        messages.insert(0, message)
    del messages[100:]
    with open(YONDA_MESSAGES_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    return message


def delete_yonda_message(message_id: str) -> bool:
    """指定IDのメッセージを削除する。削除できたらTrueを返す。"""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    data = load_yonda_messages()
    messages = data.get("messages") or []
    new_messages = [m for m in messages if m.get("id") != message_id]
    if len(new_messages) == len(messages):
        return False
    data["messages"] = new_messages
    with open(YONDA_MESSAGES_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    return True


def archive_old_messages(months: int = 3) -> int:
    """3ヶ月以上前のメッセージをarchivedへ移動する。移動件数を返す。"""
    from datetime import datetime, timezone, timedelta
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    data = load_yonda_messages()
    messages = data.get("messages") or []
    archived = data.get("archived") or []
    threshold = datetime.now(timezone.utc) - timedelta(days=months * 30)
    keep, move = [], []
    for m in messages:
        try:
            created = datetime.fromisoformat(m.get("created_at", "").replace("Z", "+00:00"))
            if created.tzinfo is None:
                created = created.replace(tzinfo=timezone.utc)
            if created < threshold:
                move.append(m)
            else:
                keep.append(m)
        except Exception:
            keep.append(m)
    if not move:
        return 0
    archived = move + archived
    del archived[500:]
    data["messages"] = keep
    data["archived"] = archived
    with open(YONDA_MESSAGES_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    return len(move)


# ------------------------------------------------------------------
# 図書館/Kindleの本: 概要・ジャンルは Google Books 優先で取得
# ------------------------------------------------------------------

LIBRARY_COVER_URL = "/static/book.png"


def _clean_book_text(text: str) -> str:
    text = re.sub(r"<[^>]+>", " ", text or "")
    return re.sub(r"\s+", " ", text).strip()


def _normalize_book_key(text: str) -> str:
    return re.sub(r"[\s　:：・,，.。『』「」\[\]（）()\-ー]+", "", (text or "").lower())


def _book_title_author_match(
    want_title: str,
    want_author: str,
    result_title: str,
    result_authors: list[str],
) -> bool:
    want_title_norm = _normalize_book_key(want_title)
    result_title_norm = _normalize_book_key(result_title)
    if want_title_norm and result_title_norm:
        if want_title_norm not in result_title_norm and result_title_norm not in want_title_norm:
            return False
    want_author_norm = _normalize_book_key(want_author)
    if want_author_norm and result_authors:
        authors_norm = _normalize_book_key(" ".join(result_authors))
        # 著者名は表記ゆれがあるため、タイトル一致より緩く見る。
        if want_author_norm not in authors_norm and authors_norm not in want_author_norm:
            return False
    return True


def _fetch_summary_and_genre_from_google_books(
    title: str, author: str, isbn: Optional[str] = None, api_key: Optional[str] = None
) -> tuple[Optional[str], Optional[str]]:
    """Google Books API で概要とジャンルを取得。戻り値は (summary, genre)。
    ISBN がある場合は ISBN 検索を優先する。api_key は呼び出し元から渡す。"""
    if not title and not isbn:
        return None, None

    key = api_key or _get_google_api_key()

    def _search(params: dict) -> tuple[Optional[str], Optional[str]]:
        if key:
            params["key"] = key
        params.setdefault("maxResults", 5)
        params.setdefault("printType", "books")
        try:
            r = requests.get(GOOGLE_BOOKS_VOLUMES, params=params, timeout=10)
            if r.status_code == 429:
                logger.warning("Google Books API レート制限 (429)。10秒待機後リトライ")
                time.sleep(10)
                r = requests.get(GOOGLE_BOOKS_VOLUMES, params=params, timeout=10)
            r.raise_for_status()
        except requests.RequestException as e:
            logger.warning("Google Books 取得失敗: %s", e)
            return None, None
        fallback: tuple[Optional[str], Optional[str]] = (None, None)
        for item in r.json().get("items", []) or []:
            info = item.get("volumeInfo", {}) or {}
            result_title = info.get("title") or ""
            result_authors = info.get("authors") or []
            summary = _clean_book_text(info.get("description") or "")
            categories = info.get("categories") or []
            genre = categories[0] if categories else None
            if (summary or genre) and not fallback[0] and not fallback[1]:
                fallback = (summary or None, genre)
            if not _book_title_author_match(title or "", author, result_title, result_authors):
                continue
            if summary or genre:
                return summary or None, genre
        return fallback

    try:
        # 1. ISBN 検索（最も精度が高い）
        if isbn:
            isbn_clean = re.sub(r"\D", "", isbn)
            if len(isbn_clean) >= 10:
                result = _search({"q": f"isbn:{isbn_clean}"})
                if result[0] or result[1]:
                    return result

        # 2. タイトル+著者で日本語限定検索
        if title:
            queries = []
            if author:
                queries.append(f"intitle:{title} inauthor:{author}")
            queries.append(title if not author else f"{title} {author}")
            queries.append(f"intitle:{title}")

            for q in queries:
                result = _search({"q": q[:120], "langRestrict": "ja"})
                if result[0] or result[1]:
                    return result

            # 3. langRestrict なしでフォールバック（外国語版が先にヒットする場合対策）
            for q in queries[:2]:
                result = _search({"q": q[:120]})
                if result[0] or result[1]:
                    return result

    except Exception as e:
        logger.warning("Google Books 取得エラー: %s", e)
    return None, None


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
                            summary = _clean_book_text(desc)
                        elif isinstance(desc, dict) and "value" in desc:
                            summary = _clean_book_text(str(desc.get("value", "")))
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
    """図書館/Kindleの本について、概要・ジャンルは Google Books / Open Library から取得。"""
    if library_id not in ("setagaya", "kindle"):
        return
    base = "https://libweb.city.setagaya.tokyo.jp"
    summary_count = genre_count = 0
    google_api_key = _get_google_api_key()
    if google_api_key:
        logger.info("%s: Google Books API キーを使用してエンリッチ", library_id)
    else:
        logger.warning("%s: Google Books API キー未設定。レート制限に注意", library_id)
    existing_by_key: dict[str, dict] = {}
    existing_by_title_author: dict[str, dict] = {}
    try:
        existing_payload = load_saved_for(library_id) or {}
        for existing in existing_payload.get("books") or []:
            catalog = (existing.get("catalog_number") or existing.get("asin") or "").strip()
            if catalog:
                existing_by_key[catalog] = existing
            title_author_key = "::".join([
                _normalize_book_key(existing.get("title") or ""),
                _normalize_book_key(existing.get("author") or ""),
            ])
            if title_author_key.strip(":"):
                existing_by_title_author[title_author_key] = existing
    except Exception:
        logger.debug("%s: 既存の概要・ジャンル引き継ぎをスキップ", library_id, exc_info=True)
    for i, book in enumerate(records):
        if not book.title:
            continue
        catalog = (book.catalog_number or "").strip()
        title_author_key = "::".join([
            _normalize_book_key(book.title),
            _normalize_book_key(book.author or ""),
        ])
        existing = (
            existing_by_key.get(catalog)
            if catalog else None
        ) or existing_by_title_author.get(title_author_key)
        if existing:
            if not (book.full_summary or book.summary or "").strip():
                book.full_summary = existing.get("full_summary") or existing.get("summary") or ""
                book.summary = existing.get("summary") or (
                    book.full_summary[:100] + "…" if len(book.full_summary) > 100 else book.full_summary
                )
            if not (book.genre or "").strip():
                book.genre = existing.get("genre") or ""
        has_cover = book.cover_url and book.cover_url.strip()
        is_library_cover = has_cover and base in (book.cover_url or "")
        if library_id == "setagaya" and (not has_cover or is_library_cover):
            book.cover_url = LIBRARY_COVER_URL
        needs_summary = not (book.full_summary or book.summary or "").strip()
        needs_genre = not (book.genre or "").strip()
        # 図書館の本は「既読（評価済み = completed）」になったタイミングで
        # 概要・ジャンルを外部APIから補完する。未読の貸出履歴は対象外とし、
        # 既存データの引き継ぎ（上記）のみ行う。
        enrich_allowed = book.completed if library_id == "setagaya" else True
        if enrich_allowed and (needs_summary or needs_genre):
            # catalog_number が ISBN 形式であれば ISBN 検索に活用
            isbn = None
            catalog = (book.catalog_number or "").strip()
            if re.match(r"^\d{10,13}$", catalog):
                isbn = catalog
            summary, genre = _fetch_summary_and_genre_from_google_books(
                book.title, book.author or "", isbn=isbn, api_key=google_api_key
            )
            if (needs_summary and not summary) or (needs_genre and not genre):
                ol_summary, ol_genre = _fetch_summary_and_genre_from_open_library(
                    book.title, book.author or "", isbn=isbn
                )
                summary = summary or ol_summary
                genre = genre or ol_genre
            if summary and needs_summary:
                book.full_summary = summary
                book.summary = summary[:100] + "…" if len(summary) > 100 else summary
                summary_count += 1
            if genre and needs_genre:
                book.genre = genre
                genre_count += 1
            # API キーあり: 0.5秒/件、なし: 1秒/件 のスロットル（レート制限対策）
            time.sleep(0.5 if google_api_key else 1.0)
        elif (i + 1) % 10 == 0:
            time.sleep(0.1)
    if summary_count or genre_count:
        logger.info(
            "%s: Google Books/Open Library から概要 %d 件、ジャンル %d 件を取得",
            library_id,
            summary_count,
            genre_count,
        )
    else:
        logger.info("%s: エンリッチ対象なし（全件既取得済み）", library_id)


# ------------------------------------------------------------------
# Internal helpers
# ------------------------------------------------------------------

def _build_payload(adapter, records: list[BookRecord]) -> dict:
    return {
        "library_id": adapter.library_id,
        "library_name": adapter.library_name,
        "fetch_date": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "total": len(records),
        "books": [r.to_dict() for r in records],
    }


def _save_json(library_id: str, payload: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    path = _json_path_for(library_id)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    logger.info("JSON 保存: %s (%d 冊)", path, payload["total"])


def enrich_library_books_missing_genre(
    library_id: str = "setagaya",
    max_books: int = 10,
) -> dict:
    """ジャンル・概要が未設定の図書館本を最大 max_books 件補完して保存する。
    直近登録順（loan_date 降順）で対象を選択。"""
    path = _json_path_for(library_id)
    if not path.exists():
        return {"error": f"{library_id} のデータファイルが見つかりません"}
    with open(path, encoding="utf-8") as f:
        payload = json.load(f)

    books: list[dict] = payload.get("books", [])
    # loan_date 降順（直近登録が先頭）に並び替え
    books.sort(key=lambda b: b.get("loan_date", ""), reverse=True)

    google_api_key = _get_google_api_key()
    updated = 0
    skipped = 0
    errors = 0
    targets = []
    for book in books:
        if updated + len(targets) >= max_books:
            break
        # 図書館の本は既読（completed）になった本のみ補完対象にする。
        if library_id == "setagaya" and not book.get("completed"):
            continue
        needs = not (book.get("genre") or "").strip() or not (book.get("summary") or book.get("full_summary") or "").strip()
        if needs:
            targets.append(book)

    for book in targets:
        title = (book.get("title") or "").strip()
        author = (book.get("author") or "").strip()
        if not title:
            skipped += 1
            continue
        isbn = None
        catalog = (book.get("catalog_number") or "").strip()
        if re.match(r"^\d{10,13}$", catalog):
            isbn = catalog
        try:
            needs_summary = not (book.get("full_summary") or book.get("summary") or "").strip()
            needs_genre = not (book.get("genre") or "").strip()
            summary: Optional[str] = None
            genre: Optional[str] = None

            # ① Open Library（API キー不要・日本語書籍も対応）を先に試す
            ol_s, ol_g = _fetch_summary_and_genre_from_open_library(title, author, isbn=isbn)
            summary, genre = ol_s, ol_g

            # ② Google Books（API キーがある場合のみ追加で試す）
            if google_api_key and (needs_summary and not summary or needs_genre and not genre):
                gb_s, gb_g = _fetch_summary_and_genre_from_google_books(
                    title, author, isbn=isbn, api_key=google_api_key
                )
                summary = summary or gb_s
                genre = genre or gb_g

            if summary and needs_summary:
                book["full_summary"] = summary
                book["summary"] = summary[:100] + "…" if len(summary) > 100 else summary
            if genre and needs_genre:
                book["genre"] = genre
            if (summary and needs_summary) or (genre and needs_genre):
                updated += 1
                logger.info("ジャンル/概要補完: %s → genre=%s", title[:30], genre)
            else:
                skipped += 1
                logger.warning("ジャンル/概要取得できず: %s", title[:30])
        except Exception as e:
            errors += 1
            logger.warning("エンリッチエラー [%s]: %s", title[:30], e)
        time.sleep(0.5)

    if updated:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        logger.info("%s: ジャンル/概要補完 %d 件保存完了", library_id, updated)

    return {
        "library_id": library_id,
        "updated": updated,
        "skipped": skipped,
        "errors": errors,
        "books": [
            {
                "title": b.get("title", ""),
                "genre": b.get("genre", ""),
                "summary": (b.get("summary") or "")[:60],
            }
            for b in targets
        ],
    }


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
