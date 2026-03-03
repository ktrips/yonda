#!/usr/bin/env python3
"""Audible API から overall_rating, asin, publisher_summary, finished.update_date を取得して表示

使用例:
  python scripts/show_audible_fields.py "シェニール織とか黄肉のメロンとか"
  python scripts/show_audible_fields.py -f output.json
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


def extract_fields(data: dict) -> dict:
    """JSON から対象フィールドを抽出"""
    result = {"asin": None, "overall_rating": None, "publisher_summary": None, "finished_update_date": None}

    # catalog.product
    prod = (data.get("catalog") or {}).get("product") or {}
    result["asin"] = prod.get("asin")

    # overall_rating: rating.overall_distribution.display_average_rating または average_rating
    rating = prod.get("rating") or {}
    od = rating.get("overall_distribution") or {}
    result["overall_rating"] = od.get("display_average_rating") or od.get("average_rating")

    # publisher_summary（product_desc 内の full/short も確認）
    result["publisher_summary"] = prod.get("publisher_summary")
    if not result["publisher_summary"]:
        pd = prod.get("product_desc") or {}
        if isinstance(pd, dict):
            result["publisher_summary"] = pd.get("full") or pd.get("short")
        elif isinstance(pd, str):
            result["publisher_summary"] = pd
    if not result["publisher_summary"]:
        result["publisher_summary"] = prod.get("merchandising_summary")

    # finished.update_date (API では update_date)
    finished = data.get("finished") or {}
    items = finished.get("mark_as_finished_status_list") or []
    if items:
        first = items[0]
        result["finished_update_date"] = first.get("update_date") or first.get("updated_date")

    return result


def display(result: dict) -> None:
    """結果を表示"""
    print("=" * 60)
    print("ASIN:", result["asin"] or "—")
    print("-" * 60)
    print("overall_rating:", result["overall_rating"] or "—")
    print("-" * 60)
    print("finished.update_date:", result["finished_update_date"] or "—")
    print("-" * 60)
    summary = result["publisher_summary"] or ""
    if summary:
        # HTML タグを除去して表示
        summary = re.sub(r"<br\s*/?>", "\n", summary, flags=re.I)
        summary = re.sub(r"<[^>]+>", "", summary)
        summary = summary.strip()
    print("publisher_summary:")
    print(summary or "—")
    print("=" * 60)


def fetch_from_api(query: str, auth_path: Path) -> dict:
    """API から取得"""
    import audible

    auth = audible.Authenticator.from_file(str(auth_path), encryption=False)
    client = audible.Client(auth)
    client.switch_marketplace("jp")

    # 検索
    search_resp = client.get(
        "catalog/products",
        keywords=query,
        num_results=5,
        response_groups="product_attrs",
    )
    products = search_resp.get("products", []) or []
    if not products:
        raise RuntimeError("検索結果がありません")
    asin = products[0].get("asin") or (products[0].get("product") or {}).get("asin")
    if not asin:
        raise RuntimeError("ASIN を取得できませんでした")

    # カタログ取得（rating, publisher_summary 含む）
    catalog_resp = client.get(
        f"catalog/products/{asin}",
        response_groups="rating,product_desc,product_attrs,product_details,product_extended_attrs",
    )

    # finished 取得（stats/status/finished）
    finished_resp = {}
    try:
        finished_resp = client.get(
            "stats/status/finished",
            asin=asin,
            start_date="2000-01-01T00:00:00Z",
        )
    except Exception:
        pass

    return {"catalog": {"product": catalog_resp.get("product", catalog_resp)}, "finished": finished_resp}


def main() -> None:
    parser = argparse.ArgumentParser(description="overall_rating, asin, publisher_summary, finished.update_date を表示")
    parser.add_argument("query", nargs="?", help="検索クエリ（-f 未指定時）")
    parser.add_argument("-f", "--file", help="既存の JSON ファイルから読み込む")
    parser.add_argument("--auth", default=None, help="認証ファイル（API 取得時）")
    args = parser.parse_args()

    if args.file:
        path = Path(args.file)
        if not path.exists():
            print(f"エラー: ファイルが見つかりません: {path}", file=sys.stderr)
            sys.exit(1)
        data = json.loads(path.read_text(encoding="utf-8"))
    elif args.query:
        auth_path = Path(args.auth) if args.auth else ROOT / "auth_jp.json"
        if not auth_path.exists():
            print(f"エラー: 認証ファイルが見つかりません: {auth_path}", file=sys.stderr)
            sys.exit(1)
        try:
            import audible
        except ImportError:
            print("エラー: pip install audible[cryptography]", file=sys.stderr)
            sys.exit(1)
        data = fetch_from_api(args.query, auth_path)
    else:
        parser.print_help()
        sys.exit(1)

    result = extract_fields(data)
    display(result)


if __name__ == "__main__":
    main()
