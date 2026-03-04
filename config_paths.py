"""認証・設定ファイルのセキュアなパス管理

環境変数 YONDA_CONFIG_DIR が未設定の場合、
~/.config/yonda/ をデフォルトの設定ディレクトリとして使用します。
ディレクトリは 0o700、ファイルは 0o600 で作成されます。

既存の .ai_config.json / .credentials.json がある場合は
初回起動時に新パスへ移行（コピー）します。
"""
from __future__ import annotations

import os
import shutil
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent

# セキュアな設定ディレクトリ（デフォルト: ~/.config/yonda）
def _config_dir() -> Path:
    d = os.environ.get("YONDA_CONFIG_DIR")
    if d:
        return Path(d).expanduser().resolve()
    return Path.home() / ".config" / "yonda"


def _ensure_secure_dir(path: Path) -> None:
    """ディレクトリを 0o700 で作成"""
    path.mkdir(parents=True, mode=0o700, exist_ok=True)


def _ensure_secure_file(path: Path, content: bytes | None = None) -> None:
    """ファイルを 0o600 で作成（既存ならパーミッションのみ更新）"""
    if content is not None:
        path.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
        path.write_bytes(content)
    path.chmod(0o600)


def _migrate_if_needed(new_path: Path, old_paths: list[Path]) -> bool:
    """新パスにファイルがなければ、old_paths からコピー。整合性を保つためコピー後は元を削除しない"""
    if new_path.exists():
        return True
    for old in old_paths:
        if old.exists():
            _ensure_secure_dir(new_path.parent)
            shutil.copy2(old, new_path)
            _ensure_secure_file(new_path)
            return True
    return False


# AI 設定（api_key 等）
def get_ai_config_path() -> Path:
    path = os.environ.get("YONDA_AI_CONFIG_PATH")
    if path:
        return Path(path).expanduser().resolve()
    cfg_dir = _config_dir()
    target = cfg_dir / "ai_config.json"
    _migrate_if_needed(target, [
        APP_DIR / ".ai_config.json",
    ])
    return target


# 図書館認証（.credentials.json）
def get_credentials_path() -> Path:
    path = os.environ.get("YONDA_CREDS_PATH")
    if path:
        return Path(path).expanduser().resolve()
    cfg_dir = _config_dir()
    target = cfg_dir / "credentials.json"
    data_dir = Path(os.environ.get("YONDA_DATA_DIR", str(APP_DIR / "data")))
    _migrate_if_needed(target, [
        data_dir / ".credentials.json",
        APP_DIR / ".credentials.json",
        APP_DIR / "data" / ".credentials.json",
    ])
    return target


def ensure_config_dir() -> Path:
    """設定ディレクトリを 0o700 で作成して返す"""
    d = _config_dir()
    _ensure_secure_dir(d)
    return d
