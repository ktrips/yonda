"""全ソースの読書記録を取得して保存するスクリプト。"""
import json
import logging
import sys
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("fetch_all")

sys.path.insert(0, str(Path(__file__).parent))

import library_service

SOURCES = ["setagaya", "audible_jp", "kindle"]

results = {}

for source in SOURCES:
    logger.info("=" * 50)
    logger.info("取得開始: %s", source)
    try:
        payload = library_service.fetch_and_save(source)
        count = payload.get("total", 0)
        fetch_date = payload.get("fetch_date", "")
        logger.info("✓ %s: %d 件を保存しました (取得日時: %s)", source, count, fetch_date)
        results[source] = {"status": "ok", "total": count, "fetch_date": fetch_date}
    except Exception as e:
        logger.error("✗ %s: 取得失敗 — %s", source, e)
        results[source] = {"status": "error", "error": str(e)}

logger.info("=" * 50)
logger.info("全ソース処理完了。結果:")

# 保存済みデータを確認
logger.info("-" * 40)
logger.info("data/ ディレクトリの保存済みファイル:")
data_dir = Path(__file__).parent / "data"
for source in SOURCES:
    json_files = {
        "setagaya": data_dir / "library_books.json",
        "audible_jp": data_dir / "audible_books.json",
        "kindle": data_dir / "kindle_books.json",
    }
    path = json_files.get(source)
    if path and path.exists():
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
            total = data.get("total", len(data.get("books", [])))
            fetch_date = data.get("fetch_date", "不明")
            logger.info("  ✓ %s: %s — %d 件 (取得日時: %s)", source, path.name, total, fetch_date)
        except Exception as e:
            logger.warning("  ! %s: ファイル読込エラー — %s", source, e)
    else:
        logger.info("  - %s: ファイルなし", source)

# マージされた全データを確認
logger.info("-" * 40)
merged = library_service.load_saved()
if merged:
    logger.info("マージ済みデータ: 合計 %d 件", merged["total"])
    for src in merged.get("sources", []):
        logger.info(
            "  • %s (%s): %d 件",
            src["library_name"],
            src["library_id"],
            src["total"],
        )
else:
    logger.info("マージ済みデータ: なし")

logger.info("=" * 50)
