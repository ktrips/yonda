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
