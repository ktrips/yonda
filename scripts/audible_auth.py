#!/usr/bin/env python3
"""Audible Japan 再認証スクリプト

audible-cli なしで auth_jp.json を再生成します。

使い方:
    python3 scripts/audible_auth.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

try:
    import audible
except ImportError:
    print("ERROR: audible ライブラリが未インストールです。pip install 'audible[cryptography]' を実行してください。")
    sys.exit(1)

OUTPUT_PATH = Path(__file__).resolve().parent.parent / "data" / "auth_jp.json"


def otp_callback() -> str:
    return input("OTP（ワンタイムパスワード）を入力してください: ").strip()


def captcha_callback(captcha_url: str) -> str:
    print(f"\nCAPTCHA が必要です。以下のURLをブラウザで開いて画像を確認し、回答を入力してください:")
    print(f"  {captcha_url}\n")
    return input("CAPTCHA の回答: ").strip()


def cvf_callback() -> str:
    print("\nAmazon から確認コードが送信されました（メールまたはSMS）。")
    return input("確認コードを入力してください: ").strip()


def main() -> None:
    print("=" * 50)
    print("  Audible Japan 再認証")
    print("=" * 50)
    print(f"出力先: {OUTPUT_PATH}\n")

    email = input("Amazon メールアドレス: ").strip()
    password = input("Amazon パスワード: ").strip()

    print("\nAudible Japan に接続中...")
    try:
        auth = audible.Authenticator.from_login(
            username=email,
            password=password,
            locale="jp",
            with_username=False,
            captcha_callback=captcha_callback,
            otp_callback=otp_callback,
            cvf_callback=cvf_callback,
        )
    except Exception as e:
        print(f"\nERROR: 認証に失敗しました: {e}")
        sys.exit(1)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    auth.to_file(str(OUTPUT_PATH), encryption=False)

    data = json.loads(OUTPUT_PATH.read_text())
    print(f"\n✔ auth_jp.json を保存しました: {OUTPUT_PATH}")
    print(f"  locale_code    : {data.get('locale_code')}")
    print(f"  customer_info  : {data.get('customer_info', {}).get('name', '(不明)')}")

    import datetime, time
    expires = data.get("expires")
    if expires:
        exp_dt = datetime.datetime.fromtimestamp(float(expires))
        print(f"  expires        : {exp_dt.strftime('%Y-%m-%d %H:%M:%S')}")

    print("\n次のステップ:")
    print("  1. ローカル動作確認: python3 app.py")
    print("  2. GitHub Secrets の AUTH_JP_JSON を更新してから push")
    print(f"\n  cat {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
