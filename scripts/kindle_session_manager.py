#!/usr/bin/env python3
"""Kindle セッション管理スクリプト

使い方:
  python scripts/kindle_session_manager.py status   # セッション状態を確認
  python scripts/kindle_session_manager.py clear    # セッションを削除
  python scripts/kindle_session_manager.py verify   # セッションの有効性を検証
"""
from __future__ import annotations

import sys
from pathlib import Path

# プロジェクトルートをパスに追加
APP_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(APP_DIR))

import json
import requests
from datetime import datetime
from adapters.kindle import KindleAdapter
from config_paths import get_kindle_session_path


def show_status():
    """セッション状態を表示"""
    session_path = get_kindle_session_path()
    print(f"セッションファイル: {session_path}")

    if not session_path.exists():
        print("❌ セッションファイルが存在しません")
        return

    try:
        with open(session_path, "r", encoding="utf-8") as f:
            session_data = json.load(f)

        saved_at = session_data.get("saved_at", "不明")
        expiry_str = session_data.get("expiry", "不明")
        cookies_count = len(session_data.get("cookies", {}))

        print(f"✅ セッションファイルが存在します")
        print(f"   保存日時: {saved_at}")
        print(f"   有効期限: {expiry_str}")
        print(f"   クッキー数: {cookies_count}")

        # 有効期限チェック
        if expiry_str != "不明":
            expiry_time = datetime.fromisoformat(expiry_str)
            now = datetime.now()
            if now >= expiry_time:
                print(f"   ⚠️  有効期限切れ（{(now - expiry_time).days}日前に期限切れ）")
            else:
                remaining_days = (expiry_time - now).days
                print(f"   ✅ 有効（残り{remaining_days}日）")

    except Exception as e:
        print(f"❌ セッションファイルの読み込みに失敗: {e}")


def clear_session():
    """セッションを削除"""
    adapter = KindleAdapter()
    adapter.clear_session()
    print("✅ セッションを削除しました")


def verify_session():
    """セッションの有効性を検証"""
    session_path = get_kindle_session_path()

    if not session_path.exists():
        print("❌ セッションファイルが存在しません")
        return

    print("セッションを読み込み中...")
    adapter = KindleAdapter()
    session = requests.Session()
    session.headers.update({
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        ),
        "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
    })

    loaded = adapter.load_session(session)
    if not loaded:
        print("❌ セッションの読み込みに失敗しました")
        return

    print("セッションの有効性を検証中...")
    valid = adapter.verify_session(session)

    if valid:
        print("✅ セッションは有効です（Amazon にログイン済み）")
    else:
        print("❌ セッションが無効です（再ログインが必要）")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    command = sys.argv[1].lower()

    if command == "status":
        show_status()
    elif command == "clear":
        clear_session()
    elif command == "verify":
        verify_session()
    else:
        print(f"不明なコマンド: {command}")
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
