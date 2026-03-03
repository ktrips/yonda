#!/usr/bin/env python3
"""指定タイトルで Audible API から取得可能な全データを取得するスクリプト

使用例:
  python scripts/fetch_audible_full.py "シェニール織とか黄肉のメロンとか"
  python scripts/fetch_audible_full.py "シェニール織とか黄肉のメロンとか" -o output.json
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# yonda のルートをパスに追加
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# 全 response_groups（catalog/products 用）
# ドキュメント: https://audible.readthedocs.io/en/latest/misc/external_api.html
ALL_CATALOG_RESPONSE_GROUPS = (
    "contributors,media,price,product_attrs,product_desc,product_details,"
    "product_extended_attrs,product_plan_details,product_plans,rating,sample,sku,"
    "series,reviews,relationships,review_attrs,category_ladders,claim_code_url,"
    "provided_review,rights,customer_rights,goodreads_ratings"
)

# library 用（ユーザーが所持している場合）
ALL_LIBRARY_RESPONSE_GROUPS = (
    "contributors,customer_rights,media,price,product_attrs,product_desc,"
    "product_details,product_extended_attrs,product_plan_details,product_plans,"
    "rating,sample,sku,series,reviews,ws4v,origin,relationships,review_attrs,"
    "categories,badge_types,category_ladders,claim_code_url,in_wishlist,"
    "is_archived,is_downloaded,is_finished,is_playable,is_removable,"
    "is_returnable,is_visible,listening_status,order_details,origin_asin,"
    "pdf_url,percent_complete,periodicals,provided_review"
)


def main() -> None:
    parser = argparse.ArgumentParser(description="Audible API で指定タイトルの全データを取得")
    parser.add_argument("query", help="検索クエリ（タイトルまたはキーワード）")
    parser.add_argument("-o", "--output", default=None, help="出力JSONファイル（省略時は標準出力）")
    parser.add_argument("--auth", default=None, help="認証ファイルパス（省略時は auth_jp.json）")
    args = parser.parse_args()

    auth_path = Path(args.auth) if args.auth else ROOT / "auth_jp.json"
    if not auth_path.exists():
        print(f"エラー: 認証ファイルが見つかりません: {auth_path}", file=sys.stderr)
        print("audible-cli で認証し、auth_jp.json を配置してください。", file=sys.stderr)
        sys.exit(1)

    try:
        import audible
    except ImportError:
        print("エラー: audible パッケージがインストールされていません。", file=sys.stderr)
        print("pip install audible[cryptography] を実行してください。", file=sys.stderr)
        sys.exit(1)

    auth = audible.Authenticator.from_file(str(auth_path), encryption=False)
    client = audible.Client(auth)
    client.switch_marketplace("jp")

    result: dict = {"query": args.query, "catalog": None, "library": None, "finished": None}

    # 1. カタログ検索
    print(f"検索中: {args.query}", file=sys.stderr)
    search_resp = client.get(
        "catalog/products",
        keywords=args.query,
        num_results=10,
        response_groups="product_desc,product_attrs,contributors,media,rating,series,category_ladders",
    )
    products = search_resp.get("products", []) or []
    if not products:
        print("検索結果がありません。", file=sys.stderr)
        output = json.dumps(result, ensure_ascii=False, indent=2)
        if args.output:
            Path(args.output).write_text(output, encoding="utf-8")
            print(f"空の結果を保存: {args.output}", file=sys.stderr)
        else:
            print(output)
        return

    asin = products[0].get("asin") or (products[0].get("product", {}) or {}).get("asin")
    title = products[0].get("title") or (products[0].get("product", {}) or {}).get("title")
    print(f"ヒット: {title} (ASIN: {asin})", file=sys.stderr)

    # 2. カタログAPIで全データ取得
    print("カタログAPIで全データ取得中...", file=sys.stderr)
    try:
        catalog_resp = client.get(
            f"catalog/products/{asin}",
            response_groups=ALL_CATALOG_RESPONSE_GROUPS,
            reviews_num_results=10,
        )
        result["catalog"] = catalog_resp
    except Exception as e:
        result["catalog_error"] = str(e)
        print(f"カタログ取得エラー: {e}", file=sys.stderr)

    # 3. ライブラリAPI（所持している場合）
    print("ライブラリAPIで取得中（所持している場合）...", file=sys.stderr)
    try:
        library_resp = client.get(
            f"library/{asin}",
            response_groups=ALL_LIBRARY_RESPONSE_GROUPS,
        )
        result["library"] = library_resp
    except Exception as e:
        result["library_error"] = str(e)
        print(f"ライブラリ取得（所持していない可能性）: {e}", file=sys.stderr)

    # 4. 聴き終わり日（所持している場合）
    try:
        finished_resp = client.get(
            "stats/status/finished",
            asin=asin,
            start_date="2000-01-01T00:00:00Z",
        )
        result["finished"] = finished_resp
    except Exception as e:
        result["finished_error"] = str(e)

    # 5. レビュー一覧（最大50件）
    try:
        reviews_resp = client.get(
            f"catalog/products/{asin}/reviews",
            num_results=50,
            sort_by="MostHelpful",
        )
        result["reviews"] = reviews_resp
    except Exception as e:
        result["reviews_error"] = str(e)

    # 6. 類似作品（sims）
    try:
        sims_resp = client.get(
            f"catalog/products/{asin}/sims",
            num_results=20,
            response_groups="contributors,media,product_attrs,product_desc,rating,series,sku",
        )
        result["sims"] = sims_resp
    except Exception as e:
        result["sims_error"] = str(e)

    output = json.dumps(result, ensure_ascii=False, indent=2)
    if args.output:
        Path(args.output).write_text(output, encoding="utf-8")
        print(f"保存しました: {args.output}", file=sys.stderr)
    else:
        print(output)


if __name__ == "__main__":
    main()
