"""
Firestore 統合モジュール

books の読み書きを担当。利用不可時はすべての操作が安全に失敗し、
呼び出し元が JSON フォールバックできるよう None / 例外を返さず静かに終了する。
"""
from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)

PROJECT_ID = "airgo-trip"

# 遅延初期化。False = 初期化失敗済み（再試行しない）
_db = None


def get_db():
    """Firestore クライアントを遅延初期化して返す。失敗時は None。"""
    global _db
    if _db is None:
        try:
            from google.cloud import firestore  # noqa: PLC0415
            _db = firestore.Client(project=PROJECT_ID)
            logger.info("Firestore クライアント初期化完了 (project=%s)", PROJECT_ID)
        except Exception as e:
            logger.warning("Firestore 利用不可（JSONモードで継続）: %s", e)
            _db = False  # 失敗済みフラグ
    return _db if _db else None


def make_book_id(book: dict) -> str:
    """安定した book_id を生成。catalog_number があればそれを使用。"""
    cn = (book.get("catalog_number") or "").strip()
    source = book.get("source", "")
    if cn:
        return f"{source}_{cn}"
    key = f"{book.get('title', '')}\t{book.get('author', '')}\t{source}"
    return hashlib.sha256(key.encode()).hexdigest()[:16]


def load_books(uid: str) -> Optional[dict]:
    """
    Firestore から全 books + sources を読み込み library_service 互換形式で返す。
    失敗時は None（呼び出し元が JSON にフォールバックする）。
    """
    db = get_db()
    if not db:
        return None
    try:
        user_ref = db.collection("users").document(uid)

        # books 読み込み
        book_docs = user_ref.collection("books").get()
        all_books: list[dict] = []
        for doc in book_docs:
            b = doc.to_dict()
            # 内部管理フィールドを除去
            b.pop("_migrated_at", None)
            b.pop("_updated_at", None)
            all_books.append(b)

        if not all_books:
            return None

        # sources メタデータ読み込み
        source_docs = user_ref.collection("sources").get()
        sources: list[dict] = []
        for doc in source_docs:
            d = doc.to_dict()
            sources.append({
                "library_id":   d.get("library_id", doc.id),
                "library_name": d.get("library_name", doc.id),
                "total":        d.get("total", 0),
                "fetch_date":   d.get("fetch_date", ""),
            })

        # setagaya / paper は runtime_length_min を補完
        for b in all_books:
            if b.get("source") in ("setagaya", "paper") and not (b.get("runtime_length_min") or 0):
                b["runtime_length_min"] = 240

        all_books.sort(key=lambda b: b.get("loan_date", ""), reverse=True)
        logger.info("Firestore 読み込み完了: %d冊 (uid=%s)", len(all_books), uid)
        return {"sources": sources, "total": len(all_books), "books": all_books}

    except Exception as e:
        logger.error("Firestore 読み込みエラー: %s", e)
        return None


def save_books(uid: str, source_id: str, books: list[dict], meta: dict) -> None:
    """
    特定ソースの books を Firestore にバッチ書き込み。
    失敗してもログのみ出力（呼び出し元は JSON 保存済みなので安全）。
    """
    db = get_db()
    if not db:
        return
    try:
        user_ref = db.collection("users").document(uid)
        books_col = user_ref.collection("books")
        now = datetime.now(timezone.utc).isoformat()

        batch = db.batch()
        count = 0
        for book in books:
            if not book.get("source"):
                book = {**book, "source": source_id}
            bid = make_book_id(book)
            clean = {k: v for k, v in book.items() if v is not None}
            clean["_updated_at"] = now
            batch.set(books_col.document(bid), clean)
            count += 1
            if count >= 499:
                batch.commit()
                batch = db.batch()
                count = 0
        if count > 0:
            batch.commit()

        # sources メタデータ更新
        user_ref.collection("sources").document(source_id).set({
            **meta,
            "_updated_at": now,
        })
        logger.info("Firestore 書き込み完了: %s (%d冊)", source_id, len(books))

    except Exception as e:
        logger.error("Firestore 書き込みエラー（JSONは保存済み）: %s", e)


def save_single_book(uid: str, book: dict) -> None:
    """1冊だけ Firestore に書き込む（paper_book の add/update 用）。"""
    db = get_db()
    if not db:
        return
    try:
        bid = make_book_id(book)
        clean = {k: v for k, v in book.items() if v is not None}
        clean["_updated_at"] = datetime.now(timezone.utc).isoformat()
        db.collection("users").document(uid).collection("books").document(bid).set(clean)
    except Exception as e:
        logger.error("Firestore 単冊書き込みエラー: %s", e)


def delete_single_book(uid: str, book: dict) -> None:
    """1冊 Firestore から削除する（paper_book の delete 用）。"""
    db = get_db()
    if not db:
        return
    try:
        bid = make_book_id(book)
        db.collection("users").document(uid).collection("books").document(bid).delete()
    except Exception as e:
        logger.error("Firestore 単冊削除エラー: %s", e)


def delete_book_by_uuid(uid: str, book_id: str) -> Optional[dict]:
    """book_id フィールド（UUID）で Firestore を検索して削除する。
    JSON にない本を Firestore から削除する場合に使用。
    削除した本の dict を返す。見つからなければ None。
    """
    db = get_db()
    if not db:
        return None
    try:
        docs = (
            db.collection("users")
            .document(uid)
            .collection("books")
            .where("book_id", "==", book_id)
            .get()
        )
        for doc in docs:
            book = doc.to_dict()
            doc.reference.delete()
            return book
    except Exception as e:
        logger.error("Firestore UUID削除エラー: %s", e)
    return None


def list_users() -> list[dict]:
    """
    Firestore に登録されている全ユーザーのプロフィール一覧を返す。
    管理者用。各ユーザーの books 件数も集計して返す。
    """
    db = get_db()
    if not db:
        return []
    try:
        users = []
        for doc in db.collection("users").stream():
            profile = doc.to_dict() or {}
            book_total = 0
            source_ids = []
            for src_doc in doc.reference.collection("sources").stream():
                src_data = src_doc.to_dict() or {}
                book_total += src_data.get("total", 0)
                source_ids.append(src_doc.id)
            users.append({
                "uid":        doc.id,
                "email":      profile.get("email", ""),
                "name":       profile.get("name", ""),
                "picture":    profile.get("picture", ""),
                "created_at": profile.get("created_at", ""),
                "last_login": profile.get("last_login", ""),
                "book_total": book_total,
                "sources":    source_ids,
            })
        users.sort(key=lambda u: u.get("created_at", ""), reverse=True)
        return users
    except Exception as e:
        logger.error("ユーザー一覧取得エラー: %s", e)
        return []


def upsert_user_profile(uid: str, user_info: dict) -> None:
    """
    ログイン時にユーザープロフィールを Firestore に作成/更新する。
    - 初回ログイン: created_at を含む全フィールドを作成
    - 2回目以降: last_login と name/picture だけ更新
    """
    db = get_db()
    if not db:
        return
    try:
        now = datetime.now(timezone.utc).isoformat()
        user_ref = db.collection("users").document(uid)
        doc = user_ref.get()
        if doc.exists:
            user_ref.update({
                "last_login": now,
                "name":       user_info.get("name", ""),
                "picture":    user_info.get("picture", ""),
            })
            logger.info("ユーザープロフィール更新: %s", uid)
        else:
            user_ref.set({
                "uid":        uid,
                "email":      user_info.get("email", ""),
                "name":       user_info.get("name", ""),
                "picture":    user_info.get("picture", ""),
                "created_at": now,
                "last_login": now,
            })
            logger.info("ユーザープロフィール新規作成: %s", uid)
    except Exception as e:
        logger.warning("ユーザープロフィール作成/更新失敗: %s", e)


def update_user_sources(uid: str, source: str, enabled: bool) -> None:
    """sources フラグを更新する。認証設定/削除時に呼ぶ。"""
    db = get_db()
    if not db:
        return
    try:
        db.collection("users").document(uid).set(
            {"sources": {source: enabled}},
            merge=True,
        )
        logger.info("sources フラグ更新: uid=%s source=%s enabled=%s", uid, source, enabled)
    except Exception as e:
        logger.error("sources フラグ更新エラー: %s", e)


def list_sync_users() -> list:
    """sources が1つ以上 true のユーザーを返す（同期ループ用）。"""
    db = get_db()
    if not db:
        return []
    try:
        result = []
        for doc in db.collection("users").stream():
            profile = doc.to_dict() or {}
            sources = profile.get("sources", {})
            if any(v for v in sources.values() if v):
                result.append({
                    "uid":     doc.id,
                    "sources": sources,
                    "name":    profile.get("name", ""),
                    "picture": profile.get("picture", ""),
                })
        return result
    except Exception as e:
        logger.error("同期ユーザー一覧取得エラー: %s", e)
        return []


def get_uid_by_email(email: str) -> str | None:
    """Gmail アドレスからユーザー UID を検索する。見つからなければ None。"""
    db = get_db()
    if not db:
        return None
    try:
        docs = db.collection("users").where("email", "==", email.lower().strip()).limit(1).stream()
        for doc in docs:
            return doc.id
        return None
    except Exception as e:
        logger.warning("get_uid_by_email エラー: %s", e)
        return None


def get_user_public_profile(uid: str) -> dict | None:
    """uid から公開プロフィール情報（名前・アバター・統計）を返す。"""
    db = get_db()
    if not db:
        return None
    try:
        doc = db.collection("users").document(uid).get()
        if not doc.exists:
            return None
        p = doc.to_dict() or {}
        return {
            "name":            p.get("name", ""),
            "picture":         p.get("picture", ""),
            "completed_count": p.get("completed_count", 0),
            "stats_updated_at": p.get("stats_updated_at", ""),
        }
    except Exception as e:
        logger.warning("get_user_public_profile エラー uid=%s: %s", uid, e)
        return None


def update_user_stats(uid: str, completed_count: int) -> None:
    """同期後にユーザーの読了冊数を Firestore に保存する（公開統計用）。"""
    db = get_db()
    if not db:
        return
    try:
        db.collection("users").document(uid).update({
            "completed_count": completed_count,
            "stats_updated_at": datetime.now(timezone.utc).isoformat(),
        })
        logger.info("ユーザー統計更新: uid=%s completed=%d", uid, completed_count)
    except Exception as e:
        logger.warning("ユーザー統計更新エラー uid=%s: %s", uid, e)


def list_all_users_public_stats() -> list:
    """全ユーザーの公開統計（名前・アバター・読了数）を返す（ログイン不要で表示する用）。"""
    db = get_db()
    if not db:
        return []
    try:
        result = []
        for doc in db.collection("users").stream():
            p = doc.to_dict() or {}
            name = p.get("name", "")
            picture = p.get("picture", "")
            completed = p.get("completed_count", 0)
            # 名前・アバター・読了数のどれかがあるユーザーのみ公開
            if not name and not picture:
                continue
            result.append({
                "uid":             doc.id,
                "name":            name,
                "picture":         picture,
                "completed_count": completed,
            })
        result.sort(key=lambda u: u["completed_count"], reverse=True)
        return result
    except Exception as e:
        logger.error("公開ユーザー統計取得エラー: %s", e)
        return []


def get_user_profile(uid: str) -> Optional[dict]:
    """1ユーザーのプロフィールを返す（メッセージ生成用）。"""
    db = get_db()
    if not db:
        return None
    try:
        doc = db.collection("users").document(uid).get()
        if doc.exists:
            d = doc.to_dict() or {}
            return {
                "name":    d.get("name", ""),
                "email":   d.get("email", ""),
                "picture": d.get("picture", ""),
            }
    except Exception:
        pass
    return None
