#!/usr/bin/env python3
"""FIONA API で Kindle 蔵書を取得するスクリプト（ユーザー名・パスワード認証）

Amazon にログインし、FIONA API から購入済み Kindle タイトルを取得します。
ローカルファイル（BookData.sqlite 等）は使用せず、API のみで取得します。

使用例:
  # 環境変数で認証情報を指定
  export YONDA_KINDLE_EMAIL="your@email.com"
  export YONDA_KINDLE_PASSWORD="your_password"
  python scripts/fetch_kindle_fiona.py

  # アカウント設定で登録済みの認証情報を使用
  python scripts/fetch_kindle_fiona.py

  # 2段階認証（OTP）が有効な場合、プロンプトでコードを入力
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import requests

# yonda のルートをパスに追加
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from adapters.kindle import KindleAdapter
from adapters.base import LibraryCredentials
import library_service


def main() -> None:
    parser = argparse.ArgumentParser(
        description="FIONA API で Kindle 蔵書を取得（ユーザー名・パスワード認証）"
    )
    parser.add_argument(
        "-o", "--output",
        default=None,
        help="出力JSONファイル（省略時は kindle_books.json に保存）",
    )
    parser.add_argument(
        "--email",
        default=os.environ.get("YONDA_KINDLE_EMAIL"),
        help="Amazon メールアドレス（省略時は環境変数またはアカウント設定から）",
    )
    parser.add_argument(
        "--password",
        default=os.environ.get("YONDA_KINDLE_PASSWORD"),
        help="Amazon パスワード（省略時は環境変数またはアカウント設定から）",
    )
    args = parser.parse_args()

    # 認証情報の取得
    email = (args.email or "").strip()
    password = args.password or ""

    if not email or not password:
        creds = library_service.get_kindle_credentials()
        if creds and creds.get("user_id") and creds.get("password"):
            email = creds["user_id"].strip()
            password = creds["password"]
        else:
            print("エラー: 認証情報が指定されていません。", file=sys.stderr)
            print("次のいずれかで指定してください:", file=sys.stderr)
            print("  - 環境変数: YONDA_KINDLE_EMAIL, YONDA_KINDLE_PASSWORD", file=sys.stderr)
            print("  - オプション: --email, --password", file=sys.stderr)
            print("  - アカウント設定: メニューから Kindle の認証情報を登録", file=sys.stderr)
            sys.exit(1)

    session = requests.Session()
    session.headers.update({
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        ),
        "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
    })

    adapter = KindleAdapter()
    creds_obj = LibraryCredentials(user_id=email, password=password)

    print("Amazon にログイン中...", file=sys.stderr)
    ok, needs_otp, otp_page_html = adapter._login_amazon(session, creds_obj)

    if needs_otp and otp_page_html:
        print("", file=sys.stderr)
        print("=" * 50, file=sys.stderr)
        print("2段階認証（OTP）が必要です", file=sys.stderr)
        print("=" * 50, file=sys.stderr)
        print("メールまたは認証アプリに届いた6桁のコードを入力してください。", file=sys.stderr)
        print("", file=sys.stderr)
        otp = input("OTP 認証コードを入力してください: ").strip()
        if not otp:
            print("エラー: OTP が入力されていません。", file=sys.stderr)
            sys.exit(1)
        if not adapter.submit_otp(session, otp, otp_page_html):
            print("エラー: OTP が正しくありません。", file=sys.stderr)
            sys.exit(1)
        print("OTP 認証成功。", file=sys.stderr)
    elif not ok:
        print("エラー: Amazon へのログインに失敗しました。", file=sys.stderr)
        print("メールアドレスとパスワードを確認してください。", file=sys.stderr)
        sys.exit(1)

    print("FIONA API から蔵書を取得中...", file=sys.stderr)
    records = adapter._fetch_from_amazon(session)

    if not records:
        path = adapter._find_data_path()
        if path:
            print("FIONA API から0件でした。ローカルファイルから取得を試行...", file=sys.stderr)
            records = (
                adapter._fetch_from_xml(path)
                if path.suffix == ".xml"
                else adapter._fetch_from_sqlite(path)
            )
        if not records:
            print("", file=sys.stderr)
            print("取得した蔵書がありません。", file=sys.stderr)
            print("", file=sys.stderr)
            print("【対処方法】", file=sys.stderr)
            print("1. Kindle for Mac をインストールし、Amazon でログイン", file=sys.stderr)
            print("2. アプリを起動したまま蔵書を同期（数分待つ）", file=sys.stderr)
            print("3. 再度このスクリプトを実行", file=sys.stderr)
            print("   → ローカルファイル（BookData.sqlite）から自動取得されます", file=sys.stderr)
            print("", file=sys.stderr)
            print("詳細: yonda/docs/KINDLE_SETUP.md", file=sys.stderr)
            sys.exit(1)

    print(f"{len(records)} 冊取得しました。", file=sys.stderr)

    if args.output:
        # 指定パスに JSON を保存
        payload = {
            "library_id": "kindle",
            "library_name": "Kindle",
            "fetch_date": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(timespec="seconds"),
            "books": [r.to_dict() for r in records],
        }
        Path(args.output).write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"保存: {args.output}", file=sys.stderr)
    else:
        # library_service 経由で kindle_books.json に保存し、統合データを更新
        combined = library_service.save_kindle_records_and_load(records)
        out_path = library_service.DATA_DIR / "kindle_books.json"
        print(f"保存: {out_path}", file=sys.stderr)
        print(f"統合データ: {combined.get('total', 0)} 冊", file=sys.stderr)


if __name__ == "__main__":
    main()
