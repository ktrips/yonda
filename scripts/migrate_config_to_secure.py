#!/usr/bin/env python3
"""認証・設定ファイルを ~/.config/yonda/ へ移行するスクリプト

既存の .ai_config.json と .credentials.json を
セキュアなディレクトリ ~/.config/yonda/ にコピーし、
パーミッションを 0o700（ディレクトリ）/ 0o600（ファイル）に設定します。

使い方:
  python -m scripts.migrate_config_to_secure
  python -m scripts.migrate_config_to_secure --remove-old  # コピー後に元ファイルを削除
"""
from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

# プロジェクトルートをパスに追加
APP_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(APP_DIR))

from config_paths import _config_dir, _ensure_secure_dir, _ensure_secure_file


def main() -> None:
    parser = argparse.ArgumentParser(description="設定ファイルを ~/.config/yonda へ移行")
    parser.add_argument("--remove-old", action="store_true", help="移行後に元ファイルを削除")
    args = parser.parse_args()

    cfg_dir = _config_dir()
    _ensure_secure_dir(cfg_dir)
    print(f"設定ディレクトリ: {cfg_dir}")

    migrated = 0

    # .ai_config.json
    old_paths = [APP_DIR / ".ai_config.json"]
    new_path = cfg_dir / "ai_config.json"
    for old in old_paths:
        if old.exists():
            shutil.copy2(old, new_path)
            _ensure_secure_file(new_path)
            print(f"  ✔ {old.name} → {new_path}")
            migrated += 1
            if args.remove_old:
                old.unlink()
                print(f"     (元ファイル削除)")
            break

    # .credentials.json
    old_paths = [
        APP_DIR / "data" / ".credentials.json",
        APP_DIR / ".credentials.json",
    ]
    new_path = cfg_dir / "credentials.json"
    for old in old_paths:
        if old.exists():
            shutil.copy2(old, new_path)
            _ensure_secure_file(new_path)
            print(f"  ✔ {old.name} → {new_path}")
            migrated += 1
            if args.remove_old:
                old.unlink()
                print(f"     (元ファイル削除)")
            break

    if migrated == 0:
        print("移行対象のファイルがありません。")
    else:
        print(f"\n✔ {migrated} ファイルを移行しました。")


if __name__ == "__main__":
    main()
