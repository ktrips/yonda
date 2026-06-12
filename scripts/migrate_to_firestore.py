"""
Yonda 既存JSONデータ → Firestore 移行スクリプト

使い方:
  # dry-run（書き込みなし・件数確認）
  python scripts/migrate_to_firestore.py --dry-run

  # 特定ユーザーとして移行（ローカルの data/ ディレクトリを使用）
  python scripts/migrate_to_firestore.py --uid 107382660117155800856

  # 別のデータディレクトリを指定
  python scripts/migrate_to_firestore.py --uid <uid> --data-dir /path/to/data

Firestore 構造:
  users/{uid}/books/{book_id}   ← 各本のデータ
  users/{uid}/sources/{source}  ← ライブラリ取得メタデータ
  community/messages/{id}       ← みんなのYondaメッセージ（共有）
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path
from datetime import datetime

PROJECT_ID = "airgo-trip"

# ソースID → ファイル名マッピング
SOURCE_FILES = {
    "audible_jp": "audible_books.json",
    "setagaya":   "library_books.json",
    "kindle":     "kindle_books.json",
    "paper":      "paper_books.json",
}


def make_book_id(book: dict) -> str:
    """安定したbook_idを生成。catalog_numberがあればそれを使用、なければハッシュ。"""
    cn = (book.get("catalog_number") or "").strip()
    source = book.get("source", "")
    if cn:
        # ソースプレフィックスを付けて衝突回避
        return f"{source}_{cn}"
    # タイトル+著者+ソースのSHA256前16文字
    key = f"{book.get('title','')}\t{book.get('author','')}\t{source}"
    return hashlib.sha256(key.encode()).hexdigest()[:16]


def clean_book(book: dict) -> dict:
    """Firestoreに保存するbookデータを整形。None/NaN を除去。"""
    out = {}
    for k, v in book.items():
        if v is None:
            continue
        if isinstance(v, float) and (v != v):  # NaN チェック
            continue
        out[k] = v
    # 必須フィールドのデフォルト補完
    out.setdefault("title", "")
    out.setdefault("author", "")
    out.setdefault("source", "")
    out.setdefault("completed", False)
    out.setdefault("favorite", False)
    out.setdefault("rating", 0)
    # 移行タイムスタンプ
    out["_migrated_at"] = datetime.utcnow().isoformat() + "Z"
    return out


def load_json_safe(path: Path) -> dict | None:
    """Extra dataエラーにも対応したJSON読み込み。"""
    if not path.exists():
        return None
    raw = path.read_text(encoding="utf-8")
    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        if "Extra data" in str(e):
            decoder = json.JSONDecoder()
            data, _ = decoder.raw_decode(raw.lstrip())
            print(f"  ⚠️  Extra data を無視して読み込み: {path.name}")
            return data
        raise


def run_migration(uid: str, data_dir: Path, dry_run: bool):
    total_books = 0
    all_book_ids = set()
    books_by_source: dict[str, list] = {}

    print(f"\n{'[DRY-RUN] ' if dry_run else ''}移行対象ユーザー: {uid}")
    print(f"データディレクトリ: {data_dir}\n")

    # ─── 1. 各ソースのJSONを読み込み ───────────────────────────────
    for source_id, filename in SOURCE_FILES.items():
        path = data_dir / filename
        payload = load_json_safe(path)
        if not payload:
            print(f"  スキップ ({filename} なし)")
            continue

        books = payload.get("books", [])
        # book_id を付与・重複チェック
        enriched = []
        dupes = 0
        for b in books:
            b["source"] = b.get("source") or source_id
            bid = make_book_id(b)
            if bid in all_book_ids:
                dupes += 1
                continue
            all_book_ids.add(bid)
            enriched.append((bid, clean_book(b)))

        books_by_source[source_id] = (payload, enriched)
        print(f"  {source_id:12s}: {len(enriched):4d} 冊  (重複除外: {dupes})")
        total_books += len(enriched)

    print(f"\n  合計: {total_books} 冊")

    # ─── 2. yonda_messages ──────────────────────────────────────
    msg_path = data_dir / "yonda_messages.json"
    # data_dir の親にある場合も確認
    if not msg_path.exists():
        msg_path = data_dir.parent / "yonda_messages.json"
    msg_payload = load_json_safe(msg_path) if msg_path.exists() else None
    messages = (msg_payload or {}).get("messages", [])
    print(f"  yonda_messages : {len(messages)} 件\n")

    if dry_run:
        print("✅ DRY-RUN 完了（実際の書き込みは行いませんでした）")
        return

    # ─── 3. Firestore へ書き込み ────────────────────────────────
    from google.cloud import firestore as fs
    db = fs.Client(project=PROJECT_ID)

    user_ref = db.collection("users").document(uid)

    # 3-a. books をバッチ書き込み（500件/バッチ上限）
    print("📝 books 書き込み中...")
    books_col = user_ref.collection("books")
    batch = db.batch()
    count = 0
    written = 0
    for source_id, (payload, enriched) in books_by_source.items():
        for bid, book_data in enriched:
            batch.set(books_col.document(bid), book_data)
            count += 1
            written += 1
            if count >= 499:
                batch.commit()
                print(f"  バッチコミット: {written} 冊")
                batch = db.batch()
                count = 0
    if count > 0:
        batch.commit()
        print(f"  バッチコミット: {written} 冊")

    # 3-b. sources メタデータ
    print("📝 sources メタデータ書き込み中...")
    sources_col = user_ref.collection("sources")
    for source_id, (payload, enriched) in books_by_source.items():
        sources_col.document(source_id).set({
            "library_id":   payload.get("library_id", source_id),
            "library_name": payload.get("library_name", source_id),
            "fetch_date":   payload.get("fetch_date", ""),
            "total":        len(enriched),
            "_migrated_at": datetime.utcnow().isoformat() + "Z",
        })
    print(f"  {len(books_by_source)} ソース完了")

    # 3-c. yonda_messages
    if messages:
        print(f"📝 yonda_messages {len(messages)} 件 書き込み中...")
        msg_col = db.collection("community").document("messages_meta").collection("items")
        batch = db.batch()
        count = 0
        for i, msg in enumerate(messages):
            doc_id = msg.get("id") or f"msg_{i:06d}"
            batch.set(msg_col.document(doc_id), msg)
            count += 1
            if count >= 499:
                batch.commit()
                batch = db.batch()
                count = 0
        if count > 0:
            batch.commit()
        print(f"  完了")

    print(f"\n🎉 移行完了！  {total_books} 冊 → Firestore users/{uid}/books/")


def main():
    parser = argparse.ArgumentParser(description="Yonda JSON → Firestore 移行")
    parser.add_argument("--uid",      default="107382660117155800856",
                        help="Google ユーザーの sub (UID)")
    parser.add_argument("--data-dir", default=None,
                        help="JSONファイルのディレクトリ（省略時: ./data）")
    parser.add_argument("--dry-run",  action="store_true",
                        help="書き込みを行わず件数だけ確認")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parent.parent
    data_dir = Path(args.data_dir) if args.data_dir else repo_root / "data"

    if not data_dir.exists():
        print(f"❌ データディレクトリが見つかりません: {data_dir}")
        sys.exit(1)

    run_migration(uid=args.uid, data_dir=data_dir, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
