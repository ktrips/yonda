# Cursor + Claude で Amazon 連携読書記録アプリを作る実践ガイド

> **yonda** を参考に — Audible・Kindle・公共図書館・紙の本を一元管理し、AI が書評と選書を支援する Web アプリを、AI エディタで実際に作る方法を解説する実践書

---

## はじめに — このガイドの目的

このガイドは「完成品のコードを配布する」ものではなく、**AI を使いながら自分でアプリを作るプロセス** を体験してもらうことを目的としています。

参考アプリ「yonda」は筆者が Cursor + Claude を使って週末だけで開発した読書記録 Web アプリです。完成までの設計判断・詰まったポイント・AI との対話方法をそのまま記録しています。

あなたが作るアプリは yonda と同じである必要はありません。読書記録に限らず、「複数のデータソースを統合して AI で付加価値をつける」Web アプリ全般に応用できる構造です。

### このガイドで学べること

- Cursor + Claude を使った **週末開発の進め方**
- Audible・Kindle・公共図書館からのデータ自動収集
- **複数ユーザー対応（マルチユーザー化）** の設計と実装
- **ユーザーごとのデータ同期** の仕組み
- **任意の市区町村図書館** に対応できる汎用アダプタ設計
- Google Cloud Run へのデプロイと運用

---

## 目次

1. [全体アーキテクチャ](#1-全体アーキテクチャ)
2. [開発環境のセットアップ](#2-開発環境のセットアップ)
3. [Flask アプリの基盤構築](#3-flaskアプリの基盤構築)
4. [Google OAuth 認証の実装](#4-google-oauth認証の実装)
5. [マルチユーザー設計](#5-マルチユーザー設計)
6. [Audible 連携](#6-audible連携)
7. [Kindle 連携](#7-kindle連携)
8. [図書館連携 — 任意の図書館に対応する汎用設計](#8-図書館連携)
9. [紙の本の登録](#9-紙の本の登録)
10. [書誌情報の自動補完](#10-書誌情報の自動補完)
11. [Firestore データベース統合](#11-firestoreデータベース統合)
12. [マルチユーザーデータ同期](#12-マルチユーザーデータ同期)
13. [AI 書評機能](#13-ai書評機能)
14. [AI 選書機能](#14-ai選書機能)
15. [フロントエンド UI 設計](#15-フロントエンドui設計)
16. [Amazon 連携とアフィリエイト](#16-amazon連携とアフィリエイト)
17. [コミュニティ機能](#17-コミュニティ機能)
18. [Google Cloud Run へのデプロイ](#18-cloud-runへのデプロイ)
19. [セキュリティの考慮事項](#19-セキュリティの考慮事項)
20. [Cursor + Claude を使った開発の進め方](#20-cursor--claudeを使った開発の進め方)

---

## 1. 全体アーキテクチャ

### システム構成図

```
┌─────────────────────────────────────────────────────────┐
│                      ブラウザ                             │
│  index.html + app.js + style.css                         │
│  (Vanilla JS / Chart.js)                                 │
└─────────────────┬────────────────────────────────────────┘
                  │ HTTP/JSON
┌─────────────────▼────────────────────────────────────────┐
│               Flask (app.py)                              │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ Google OAuth  │  │ API Routes   │  │ Internal API  │  │
│  │ /auth/*       │  │ /api/*       │  │ /api/internal │  │
│  └──────────────┘  └──────┬───────┘  └───────────────┘  │
│                            │                              │
│  ┌─────────────────────────▼──────────────────────────┐  │
│  │           library_service.py                        │  │
│  │  load_saved() → Firestore優先 → JSONフォールバック  │  │
│  │  fetch_and_save() → アダプタ → JSON + Firestore     │  │
│  └──────┬─────────────┬────────────────────────────────┘  │
│         │             │                                    │
│  ┌──────▼──────┐ ┌────▼──────────────┐                   │
│  │ adapters/   │ │ firestore_service  │                   │
│  │ audible.py  │ │ .py                │                   │
│  │ kindle.py   │ └────────────────────┘                   │
│  │ library.py  │  ← 汎用図書館アダプタ                    │
│  └─────────────┘                                          │
└──────────────────┬───────────────────────────────────────┘
                   │
    ┌──────────────┼──────────────────┐
    ▼              ▼                  ▼
┌───────┐  ┌─────────────┐  ┌──────────────────┐
│ GCS   │  │  Firestore  │  │   外部API        │
│(JSON) │  │ (books DB)  │  │ Google Books     │
│       │  │             │  │ Open Library     │
│       │  │             │  │ OpenAI / Gemini  │
└───────┘  └─────────────┘  └──────────────────┘
```

### 技術スタック

| 領域 | 技術 |
|------|------|
| バックエンド | Python 3.11+ / Flask 3.0 |
| フロントエンド | Vanilla JavaScript / CSS（フレームワークなし）|
| データベース | Google Cloud Firestore |
| ストレージ | Google Cloud Storage（GCS）|
| ホスティング | Google Cloud Run |
| 認証 | Google OAuth 2.0（authlib）|
| AI | OpenAI GPT-4o / Google Gemini |
| 書誌情報 | Google Books API / Open Library API |

### データモデル

#### BookRecord（書籍 1 冊のデータ構造）

```python
@dataclass
class BookRecord:
    title: str                    # タイトル
    author: str                   # 著者/ナレーター
    loan_date: str                # 取得/貸出日 (YYYY-MM-DD)
    loan_location: str            # 貸出場所・ストア名
    rating: int                   # 評価 0-5
    comment: str                  # コメント
    cover_url: str                # 表紙画像URL
    detail_url: str               # 商品/詳細ページURL
    catalog_number: str           # ASIN または図書館資料番号
    completed: bool               # 読了/聴了フラグ
    source: str                   # "audible_jp" / "kindle" / "library_xxx" / "paper"
    genre: str                    # ジャンル（正規化済み）
    summary: str                  # 概要（短縮版）
    full_summary: str             # 概要（全文）
    completed_date: str           # 読了日 (YYYY-MM-DD)
    percent_complete: float       # 読書進捗 0.0-1.0
    favorite: bool                # お気に入りフラグ
    review_headline: str          # Audible レビュー見出し
    catalog_rating: float         # ストアの平均評価
    runtime_length_min: int       # 再生時間（分）
```

#### Firestore のコレクション構造

```
users/
  {google_uid}/
    books/
      {source}_{catalog_number}   ← 本1冊ずつのドキュメント
      {sha256_hash[:16]}          ← catalog_numberがない場合のID
    sources/
      audible_jp                  ← ソース別メタデータ
      library_setagaya
      kindle
      paper
community/
  messages_meta/
    items/
      {message_id}               ← みんなの読書記録メッセージ
```

---

## 2. 開発環境のセットアップ

### 必要なもの

- Python 3.11 以上
- Google Cloud アカウント（無料枠で動作）
- Audible アカウント（Audible 連携する場合）
- Amazon アカウント（Kindle 連携する場合）
- OpenAI または Google Gemini の API キー（AI 機能を使う場合）

### プロジェクトの作成

```bash
mkdir myapp && cd myapp

# Python仮想環境
python3 -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# 依存パッケージのインストール
pip install flask flask-compress requests beautifulsoup4 lxml \
            gunicorn authlib google-cloud-firestore
```

### ディレクトリ構成

```
myapp/
├── app.py                  # Flaskアプリ本体
├── library_service.py      # データ取得・保存ロジック
├── firestore_service.py    # Firestore読み書き
├── config_paths.py         # パス設定
├── requirements.txt
├── Dockerfile
├── adapters/
│   ├── __init__.py
│   ├── base.py             # 基底クラス（全アダプタ共通）
│   ├── audible.py          # Audible
│   ├── kindle.py           # Kindle
│   └── library_base.py     # 図書館スクレイピング基底クラス
├── templates/
│   ├── index.html
│   └── help_usage.html
├── static/
│   ├── app.js
│   └── style.css
└── data/                   # ローカル開発時のデータ置き場
    └── .gitkeep
```

---

## 3. Flask アプリの基盤構築

### app.py の全体構造

```python
from flask import Flask
from flask_compress import Compress
from werkzeug.middleware.proxy_fix import ProxyFix
import library_service

app = Flask(__name__)

# gzip圧縮（JSONレスポンスを大幅に圧縮）
Compress(app)

# Cloud Run のリバースプロキシ対応（HTTPSリダイレクト等）
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)

# セッション暗号化キー（全インスタンスで同一である必要あり）
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "dev-secret-key")

# リクエストごとにユーザーデータディレクトリをセット
@app.before_request
def _before_request_handler():
    library_service.set_user_data_dir(get_user_data_dir_for_session())
```

### スレッドローカルによるユーザーデータ分離

Cloud Run は複数リクエストを並列処理します。どのユーザーのデータを読むかをスレッドごとに管理することが、マルチユーザー化の核心です。

```python
# library_service.py
import threading
_tls = threading.local()

def set_user_data_dir(path: Path) -> None:
    """リクエストごとのユーザーデータディレクトリをセット"""
    _tls.user_data_dir = path

def get_user_data_dir() -> Path:
    """現在スレッドのユーザーデータディレクトリを返す"""
    return getattr(_tls, 'user_data_dir', DATA_DIR)
```

### mtime ベースのキャッシュ

```python
_saved_caches: dict[str, Optional[dict]] = {}
_saved_cache_mtimes: dict[str, float] = {}

def load_saved() -> Optional[dict]:
    key = str(get_user_data_dir())
    max_mtime = _get_books_max_mtime()
    if _saved_caches.get(key) is not None and max_mtime <= _saved_cache_mtimes.get(key, 0.0):
        return _saved_caches[key]  # キャッシュ利用
    result = _load_saved_uncached()
    _saved_caches[key] = result
    _saved_cache_mtimes[key] = max_mtime
    return result
```

---

## 4. Google OAuth 認証の実装

### Google Cloud Console での設定

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成
2. 「API とサービス」→「認証情報」→「OAuth クライアント ID を作成」
3. アプリケーションの種類: **ウェブアプリケーション**
4. 承認済みリダイレクト URI に追加:
   - `http://localhost:5002/auth/callback`（開発用）
   - `https://your-cloudrun-url/auth/callback`（本番用）

### authlib による OAuth 実装

```python
from authlib.integrations.flask_client import OAuth

oauth = OAuth(app)
oauth.register(
    name="google",
    client_id=os.environ.get("GOOGLE_CLIENT_ID"),
    client_secret=os.environ.get("GOOGLE_CLIENT_SECRET"),
    server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
    client_kwargs={"scope": "openid email profile"},
)

@app.route("/auth/login")
def auth_login():
    state = os.urandom(16).hex()
    _save_oauth_state_to_fs(state, GOOGLE_REDIRECT_URI)
    return oauth.google.authorize_redirect(GOOGLE_REDIRECT_URI, state=state)

@app.route("/auth/callback")
def auth_callback():
    state = request.args.get("state", "")
    _restore_oauth_state_from_fs(state)
    try:
        token = oauth.google.authorize_access_token()
    except MismatchingStateError:
        return redirect(url_for("auth_login"))

    user = token.get("userinfo") or oauth.google.userinfo(token=token)
    session["user"] = {
        "sub":     user["sub"],      # Google UID（不変の識別子）
        "email":   user["email"],
        "name":    user.get("name", ""),
        "picture": user.get("picture", ""),
    }
    _migrate_root_data_to_user(user["sub"])
    return redirect("/")
```

### Cloud Run でセッションが消える問題の解決

Cloud Run はリクエストごとに異なるインスタンスで処理されることがあります。OAuth の state がセッションから消えると `MismatchingStateError` が発生します。

**解決策: OAuth ステートをファイルシステム（GCS マウント）にバックアップ**

```python
_OAUTH_STATE_DIR = Path(os.environ.get("DATA_DIR", "data")) / ".oauth_states"

def _save_oauth_state_to_fs(state: str, redirect_uri: str) -> None:
    _OAUTH_STATE_DIR.mkdir(parents=True, exist_ok=True)
    state_file = _OAUTH_STATE_DIR / f"oauth_state_{state}.json"
    state_file.write_text(json.dumps({
        "state": state,
        "redirect_uri": redirect_uri,
        "created_at": time.time(),
    }))

def _restore_oauth_state_from_fs(state: str) -> bool:
    state_key = f"_state_google_{state}"
    if state_key in session:
        return True  # セッションにある場合はそのまま
    state_file = _OAUTH_STATE_DIR / f"oauth_state_{state}.json"
    if not state_file.exists():
        return False
    data = json.loads(state_file.read_text())
    if time.time() - data["created_at"] > 600:  # 10分で期限切れ
        state_file.unlink(missing_ok=True)
        return False
    session[state_key] = {
        "state": data["state"],
        "redirect_uri": data["redirect_uri"],
    }
    state_file.unlink(missing_ok=True)
    return True
```

---

## 5. マルチユーザー設計

### 設計の考え方

1 人用アプリをマルチユーザー化する際の核心は「**誰のデータか**」をリクエストごとに正確に把握することです。yonda は以下の 2 層でユーザーデータを分離しています。

```
【ファイル層】GCS マウント
data/
  users/
    {google_uid}/
      audible_books.json      ← Audibleの本
      library_books.json      ← 図書館の本
      kindle_books.json       ← Kindleの本
      paper_books.json        ← 紙の本
      credentials.json        ← 図書館ID/PW（暗号化推奨）
      auth_jp.json            ← Audible認証トークン
      kindle_session.json     ← Kindleセッション

【DB層】Firestore
users/
  {google_uid}/
    profile                   ← 名前・メール・アイコン・同期設定
    books/
      {book_id}               ← 本データ（全ソース統合）
```

### スレッドローカルによる分離の仕組み

```
リクエスト → before_request → set_user_data_dir(users/{uid}/)
                                       ↓
                           library_service.get_user_data_dir()
                                       ↓
                           data/users/{uid}/ 配下を読み書き
```

Flask は 1 リクエスト = 1 スレッドで処理するため、スレッドローカル変数に「今どのユーザーのディレクトリを使うか」を持たせることで、並行リクエストが混在しません。

```python
# app.py
@app.before_request
def _before_request_handler():
    user = get_current_user()
    if user:
        uid_safe = re.sub(r"[^a-zA-Z0-9_\-]", "_", user["sub"])
        user_dir = library_service.DATA_DIR / "users" / uid_safe
        user_dir.mkdir(parents=True, exist_ok=True)
        library_service.set_user_data_dir(user_dir)
    else:
        library_service.set_user_data_dir(library_service.DATA_DIR)
```

### 初回ログイン時のデータ移行

既存の 1 人用データを最初にログインしたユーザーに引き継ぐ仕組みです。

```python
def _migrate_root_data_to_user(uid: str) -> None:
    uid_safe = re.sub(r"[^a-zA-Z0-9_\-]", "_", uid)
    sentinel = library_service.DATA_DIR / ".data_migrated"
    user_dir = library_service.DATA_DIR / "users" / uid_safe
    user_dir.mkdir(parents=True, exist_ok=True)

    # 既にユーザーデータがあればスキップ
    if any((user_dir / f).exists() for f in ["audible_books.json", "library_books.json"]):
        return

    if sentinel.exists():
        # 2人目以降 → 空のディレクトリから開始
        return

    # 初回ユーザー: ルートのデータをコピー
    for fname in ["audible_books.json", "library_books.json",
                  "kindle_books.json", "paper_books.json"]:
        src = library_service.DATA_DIR / fname
        if src.exists():
            shutil.copy2(src, user_dir / fname)

    # 認証ファイルも移行
    for src_name, dst_name in {
        ".credentials.json": "credentials.json",
        "kindle_session.json": "kindle_session.json",
    }.items():
        src = library_service.DATA_DIR / src_name
        if src.exists():
            shutil.copy2(src, user_dir / dst_name)
            (user_dir / dst_name).chmod(0o600)

    sentinel.touch()  # 以降は新規ユーザー扱い
```

### ユーザー情報の Firestore への保存

```python
@app.route("/auth/callback")
def auth_callback():
    # ... OAuth処理 ...
    session["user"] = user_info

    # Firestoreにプロフィール保存
    uid = user_info["sub"]
    try:
        import firestore_service as fs
        fs.save_user_profile(uid, {
            "email":      user_info["email"],
            "name":       user_info.get("name", ""),
            "picture":    user_info.get("picture", ""),
            "last_login": datetime.now(timezone.utc).isoformat(),
        })
    except Exception as e:
        logger.warning("プロフィール保存失敗: %s", e)

    _migrate_root_data_to_user(uid)
    return redirect("/")
```

---

## 6. Audible 連携

### Audible 認証の仕組み

Audible の認証には `audible` ライブラリ（非公式）を使います。`audible-cli` で事前にログインし、`auth_jp.json` を生成します。

```bash
pip install audible-cli
audible quickstart  # ブラウザが開き Amazon でログイン
# → ~/.audible/my_audible_account.json が生成される
```

### マルチユーザーでの認証ファイル管理

各ユーザーの Audible 認証ファイルをユーザーディレクトリ配下に格納します。

```python
# adapters/audible.py
def _resolve_auth_file() -> Path:
    """ユーザーごとの auth_jp.json を返す（マルチユーザー対応）"""
    try:
        from library_service import get_user_data_dir, DATA_DIR
        user_dir = get_user_data_dir()
        if user_dir != DATA_DIR:
            p = user_dir / "auth_jp.json"
            if p.exists():
                return p
    except Exception:
        pass
    # フォールバック: 環境変数 or Secret Manager
    if os.environ.get("YONDA_AUTH_FILE"):
        return Path(os.environ["YONDA_AUTH_FILE"])
    return Path("data/auth_jp.json")
```

### ライブラリの全取得（ページング）

```python
def _fetch_library(self) -> list[dict]:
    all_items = []
    page = 1
    while True:
        response = self._client.get(
            "1.0/library",
            num_results=1000,
            page=page,
            response_groups="product_attrs,media,series,contributors,product_plan_details",
            sort_by="-PurchaseDate",
        )
        items = response.get("items", [])
        all_items.extend(items)
        if len(items) < 1000:
            break
        page += 1
    return all_items
```

### 読了情報の取得

```python
def _fetch_finished_status(self) -> dict[str, dict]:
    response = self._client.get(
        "1.0/stats/status/finished",
        response_groups="status",
    )
    result = {}
    for item in response.get("items", []):
        asin = item.get("asin", "")
        if asin:
            result[asin] = {
                "is_finished":  item.get("is_finished", False),
                "date_heard":   item.get("last_heard_date", ""),
                "percent":      item.get("percent_complete", 0.0),
            }
    return result
```

---

## 7. Kindle 連携

### データソースの優先順位

```python
def fetch_history(self, session=None, credentials=None) -> list[BookRecord]:
    # 1. Amazon FIONA API（最新・最多）
    try:
        if self._try_load_session():
            return self._fetch_from_amazon()
    except Exception:
        pass

    # 2. BookData.sqlite（Kindle for Mac 2024年以降）
    local_db = APP_DIR / "data" / "BookData.sqlite"
    if local_db.exists():
        return self._fetch_from_sqlite(local_db)

    # 3. KindleSyncMetadataCache.xml
    for path in _KINDLE_XML_PATHS:
        if path.exists():
            return self._fetch_from_xml(path)

    raise ValueError("Kindleデータを取得できませんでした")
```

### OTP（二段階認証）フロー

```python
@app.route("/api/kindle-login", methods=["POST"])
def api_kindle_login():
    data = request.get_json()
    adapter = KindleAdapter()
    try:
        adapter.login(None, {"user_id": data["user_id"], "password": data["password"]})
        return jsonify({"success": True})
    except KindleOTPRequired:
        session_id = str(uuid.uuid4())
        _kindle_otp_sessions[session_id] = {"adapter": adapter, **data}
        return jsonify({"needs_otp": True, "session_id": session_id})
```

---

## 8. 図書館連携 — 任意の図書館に対応する汎用設計

### 設計の考え方

日本の公共図書館はほとんどが「富士通」「NEC」「京セラコミュニケーションシステム」などのシステムベンダーが提供するシステムを使っています。同じベンダーのシステムなら、URL とセレクタが変わるだけで基本的な構造は共通です。

汎用アダプタを設計しておくことで、**どの市区町村の図書館でも設定ファイルを追加するだけで対応** できます。

### 汎用図書館アダプタ基底クラス

```python
# adapters/library_base.py
from abc import ABC, abstractmethod
from bs4 import BeautifulSoup
import requests
from dataclasses import dataclass
from typing import Optional

@dataclass
class LibraryConfig:
    """図書館システムの設定。新しい図書館を追加する時はここを定義する"""
    library_id: str          # 一意ID例: "setagaya", "minato", "shinjuku"
    library_name: str        # 表示名: "世田谷区立図書館"
    base_url: str            # トップURL: "https://libweb.city.setagaya.tokyo.jp"
    login_path: str          # ログインパス: "/login"
    history_path: str        # 貸出履歴パス: "/rentalhistorylist"
    history_page_param: str  # ページパラメータ名: "pageNo"
    history_size_param: str  # ページサイズパラメータ名: "pageSize"
    history_page_size: int   # 1ページの取得件数: 100
    # CSSセレクタ（図書館システムによって異なる）
    item_selector: str       # 各本のセレクタ: ".rentalhistoryItem"
    title_selector: str      # タイトルのセレクタ: "h3 a"
    csrf_field_name: Optional[str] = "_csrf"  # CSRFフィールド名（なければNone）
    user_field_name: str = "userId"
    pass_field_name: str = "password"


class LibraryAdapter:
    """任意の図書館システムに対応する汎用スクレイピングアダプタ"""

    def __init__(self, config: LibraryConfig):
        self.config = config
        self._session = requests.Session()

    def login(self, user_id: str, password: str) -> bool:
        cfg = self.config
        login_url = cfg.base_url + cfg.login_path

        # ログインページを取得（CSRFトークン等の取得）
        resp = self._session.get(login_url, timeout=(10, 30))
        soup = BeautifulSoup(resp.text, "lxml")

        post_data = {
            cfg.user_field_name: user_id,
            cfg.pass_field_name: password,
        }

        # CSRFトークンがある場合は取得して追加
        if cfg.csrf_field_name:
            csrf_input = soup.find("input", {"name": cfg.csrf_field_name})
            if csrf_input:
                post_data[cfg.csrf_field_name] = csrf_input.get("value", "")

        resp = self._session.post(login_url, data=post_data,
                                  allow_redirects=True, timeout=(10, 30))
        # ログイン成功判定（ログアウトリンクがあればOK）
        return "logout" in resp.url or "mypage" in resp.text.lower()

    def fetch_history(self) -> list[dict]:
        """貸出履歴を全ページ取得"""
        cfg = self.config
        records = []
        page = 1

        while True:
            url = cfg.base_url + cfg.history_path
            params = {
                cfg.history_page_param: page,
                cfg.history_size_param: cfg.history_page_size,
            }
            resp = self._session.get(url, params=params,
                                     allow_redirects=True, timeout=(10, 30))
            page_records = self._parse_page(resp.text)
            records.extend(page_records)

            if len(page_records) < cfg.history_page_size:
                break  # 最終ページ
            page += 1

        return records

    def _parse_page(self, html: str) -> list[dict]:
        """HTMLから本のリストを抽出（サブクラスでオーバーライド可）"""
        cfg = self.config
        soup = BeautifulSoup(html, "lxml")
        records = []

        for item in soup.select(cfg.item_selector):
            title_elem = item.select_one(cfg.title_selector)
            if not title_elem:
                continue

            title = title_elem.get_text(strip=True)
            href = title_elem.get("href", "")
            detail_url = cfg.base_url + href if href.startswith("/") else href

            # DL リスト（著者・貸出日・貸出館など）の汎用パース
            info = self._parse_dl(item)

            records.append({
                "title":        title,
                "author":       info.get("著者", info.get("author", "")),
                "loan_date":    info.get("貸出日", info.get("loan_date", "")),
                "loan_location": info.get("貸出館", info.get("branch", "")),
                "detail_url":   detail_url,
                "source":       self.config.library_id,
                "completed":    True,
            })
        return records

    def _parse_dl(self, element) -> dict:
        """dt/dd ペアを辞書に変換"""
        result = {}
        dl = element.select_one("dl")
        if dl:
            dts = dl.select("dt")
            dds = dl.select("dd")
            for dt, dd in zip(dts, dds):
                result[dt.get_text(strip=True)] = dd.get_text(strip=True)
        return result
```

### 各図書館の設定定義

新しい図書館を追加する時は、`LibraryConfig` を定義するだけです。

```python
# adapters/library_configs.py

# 世田谷区立図書館（富士通 IPACS）
SETAGAYA = LibraryConfig(
    library_id      = "setagaya",
    library_name    = "世田谷区立図書館",
    base_url        = "https://libweb.city.setagaya.tokyo.jp",
    login_path      = "/login",
    history_path    = "/rentalhistorylist",
    history_page_param = "pageNo",
    history_size_param = "pageSize",
    history_page_size  = 100,
    item_selector   = ".rentalhistoryItem",
    title_selector  = "h3 a",
    csrf_field_name = "_csrf",
)

# 港区立図書館（同システムを想定した例）
MINATO = LibraryConfig(
    library_id      = "minato",
    library_name    = "港区立図書館",
    base_url        = "https://www.lib.city.minato.tokyo.jp",
    login_path      = "/opac/login",
    history_path    = "/opac/borrowhistory",
    history_page_param = "page",
    history_size_param = "limit",
    history_page_size  = 50,
    item_selector   = ".borrow-item",
    title_selector  = ".item-title a",
    csrf_field_name = None,
    user_field_name = "username",
    pass_field_name = "passwd",
)

# 利用する図書館のレジストリ
LIBRARY_REGISTRY: dict[str, LibraryConfig] = {
    "setagaya": SETAGAYA,
    "minato":   MINATO,
    # 追加したい図書館はここに追記するだけ
}
```

### アダプタのアダプタファクトリ

```python
# adapters/__init__.py
from .library_configs import LIBRARY_REGISTRY
from .library_base import LibraryAdapter
from .audible import AudibleAdapter
from .kindle import KindleAdapter

def get_adapter(source_id: str):
    """ソースIDからアダプタインスタンスを返す"""
    if source_id == "audible_jp":
        return AudibleAdapter()
    if source_id == "kindle":
        return KindleAdapter()
    if source_id in LIBRARY_REGISTRY:
        return LibraryAdapter(LIBRARY_REGISTRY[source_id])
    raise ValueError(f"未知のソース: {source_id}")
```

### 新しい図書館を追加するときの手順

1. 図書館の Web サイトをブラウザの開発者ツールで調査
2. ログイン URL・フォームフィールド名を確認
3. 貸出履歴ページのセレクタを確認
4. `library_configs.py` に `LibraryConfig` を追加
5. `LIBRARY_REGISTRY` に登録

ほとんどの図書館は富士通・NEC 製システムのいずれかを使っているため、既存設定のコピーで動くことが多いです。固有のシステムの場合は `_parse_page` をオーバーライドします。

### 各ページシステムの特徴と調査方法

| ベンダー | 特徴 | 確認方法 |
|---------|------|---------|
| 富士通 IPACS | `.rentalhistoryItem` クラス、CSRFあり | HTML ソースで `.rentalhistoryItem` 検索 |
| NEC CAREAL | `#lend-history` テーブル形式 | `<table id="lend-history">` 確認 |
| OCLC WorldCat | 英語UIの場合も | ログインページの言語で判定 |
| NDL デジタル | `/nw/` パス | URL パターンで判定 |

---

## 9. 紙の本の登録

### カメラ撮影 → AI でタイトル抽出

```javascript
async function captureBookPhoto() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.capture = "environment";  // 背面カメラ

    input.onchange = async (e) => {
        const file = e.target.files[0];
        const reader = new FileReader();
        reader.onload = async () => {
            const base64 = reader.result.split(",")[1];
            const result = await fetch("/api/ai-extract-book", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({image: base64}),
            }).then(r => r.json());

            if (result.title) {
                document.getElementById("paperBookTitle").value = result.title;
                document.getElementById("paperBookAuthor").value = result.author || "";
            }
        };
        reader.readAsDataURL(file);
    };
    input.click();
}
```

```python
@app.route("/api/ai-extract-book", methods=["POST"])
def api_ai_extract_book():
    data = request.get_json()
    image_base64 = data.get("image", "")
    ai_config = library_service.load_ai_config()

    if ai_config.get("provider") == "openai":
        import openai
        client = openai.OpenAI(api_key=ai_config["api_key"])
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text",
                     "text": "この本の画像からタイトルと著者をJSONで返してください。形式: {\"title\": \"...\", \"author\": \"...\"}"},
                    {"type": "image_url",
                     "image_url": {"url": f"data:image/jpeg;base64,{image_base64}"}},
                ],
            }],
        )
        result = json.loads(response.choices[0].message.content)
        return jsonify(result)
```

---

## 10. 書誌情報の自動補完

### Google Books API で概要・ジャンル取得

```python
def _fetch_summary_and_genre_from_google_books(
    title: str, author: str, isbn: Optional[str] = None,
    api_key: Optional[str] = None,
) -> tuple[Optional[str], Optional[str]]:

    def _search(params: dict):
        url = "https://www.googleapis.com/books/v1/volumes"
        if api_key:
            params["key"] = api_key
        resp = requests.get(url, params=params, timeout=8)
        items = resp.json().get("items", [])
        if not items:
            return None, None
        info = items[0].get("volumeInfo", {})
        return info.get("description") or None, (info.get("categories") or [None])[0]

    if isbn:
        result = _search({"q": f"isbn:{isbn}"})
        if result[0]:
            return result

    return _search({"q": f"intitle:{title}+inauthor:{author}", "langRestrict": "ja"})
```

### 並列取得でパフォーマンス向上

```python
from concurrent.futures import ThreadPoolExecutor

def _enrich_book(book_dict: dict) -> None:
    if book_dict.get("summary") and book_dict.get("genre"):
        return  # 既にある場合はスキップ

    title = book_dict.get("title", "")
    author = book_dict.get("author", "")

    with ThreadPoolExecutor(max_workers=2) as executor:
        future_google = executor.submit(
            _fetch_summary_and_genre_from_google_books, title, author
        )
        future_openlibrary = executor.submit(
            _fetch_summary_and_genre_from_open_library, title, author
        )
        google_result = future_google.result(timeout=10)
        ol_result = future_openlibrary.result(timeout=10)

    summary = google_result[0] or ol_result[0] or ""
    genre   = google_result[1] or ol_result[1] or ""

    if summary and not book_dict.get("summary"):
        book_dict["summary"] = summary[:200]
        book_dict["full_summary"] = summary
    if genre and not book_dict.get("genre"):
        book_dict["genre"] = normalize_genre(genre)
```

---

## 11. Firestore データベース統合

### なぜ Firestore を選んだか

| 要件 | Firestore | PostgreSQL | SQLite |
|------|-----------|------------|--------|
| Cloud Run との統合 | ◎（IAM）| ○（Auth Proxy）| ◎ |
| スキーマレス | ◎ | ✗ | ✗ |
| スケール | ◎ | ○ | ✗ |
| 無料枠 | ◎ 50K 読取/日 | ✗ | ◎ |
| ユーザー分離 | ◎（パス）| ○（行）| △ |

### バッチ書き込み（500 件制限の対処）

```python
def save_books(uid: str, source_id: str, books: list[dict], meta: dict) -> None:
    db = get_db()
    if not db:
        return

    user_ref = db.collection("users").document(uid)
    books_col = user_ref.collection("books")
    now = datetime.now(timezone.utc).isoformat()

    batch = db.batch()
    count = 0

    for book in books:
        bid = make_book_id(book)
        clean = {k: v for k, v in book.items() if v is not None}
        clean["_updated_at"] = now
        batch.set(books_col.document(bid), clean)
        count += 1

        if count >= 499:  # 500件ごとにコミット
            batch.commit()
            batch = db.batch()
            count = 0

    if count > 0:
        batch.commit()

    user_ref.collection("sources").document(source_id).set(
        {**meta, "_updated_at": now}
    )
```

### JSON フォールバックパターン

Firestore が使えない場合（ローカル開発・障害時）は自動的に JSON ファイルを使います。

```python
def load_saved() -> Optional[dict]:
    uid = get_current_uid()
    if uid:
        try:
            import firestore_service
            result = firestore_service.load_books(uid)
            if result:
                return result
        except Exception as e:
            logger.warning("Firestore失敗、JSONにフォールバック: %s", e)

    # JSON フォールバック
    all_books = []
    for lid in _KNOWN_SOURCES:
        path = _get_json_path(lid)
        if path and path.exists():
            data = json.loads(path.read_text())
            all_books.extend(data.get("books", []))
    return {"books": all_books, "total": len(all_books)} if all_books else None
```

---

## 12. マルチユーザーデータ同期

### 同期の全体フロー

マルチユーザー環境での定期同期は、「誰の、どのソースを、いつ同期するか」をシステムが把握している必要があります。

```
Cloud Scheduler（定期実行）
  ↓ POST /api/internal/auto-fetch-all
app.py
  ↓ Firestoreから「同期対象ユーザー一覧」を取得
  ↓ 各ユーザーの認証情報を読み込み
  ↓ バックグラウンドスレッドで各ソースを同期
  ↓ 新規読了があればコミュニティフィードに投稿
```

### Firestore の同期設定フラグ

ユーザーが「このソースを同期する」と設定した情報を Firestore に保持します。

```python
# firestore_service.py

def update_user_sources(uid: str, source: str, enabled: bool) -> None:
    """認証設定の保存/削除時に同期フラグを更新"""
    db = get_db()
    if not db:
        return
    db.collection("users").document(uid).set(
        {"sources": {source: enabled}},
        merge=True
    )

def list_sync_users() -> list[dict]:
    """1つ以上のソースが有効なユーザー一覧を返す"""
    db = get_db()
    if not db:
        return []
    result = []
    for doc in db.collection("users").stream():
        profile = doc.to_dict() or {}
        sources = profile.get("sources", {})
        if any(v for v in sources.values() if v):
            result.append({
                "uid":     doc.id,
                "sources": sources,
                "name":    profile.get("name", ""),
                "picture": profile.get("picture", ""),
            })
    return result
```

### 自動同期エンドポイント

Cloud Scheduler から呼ばれる内部エンドポイントです。即座に 202 を返し、重い処理はバックグラウンドスレッドで実行します。

```python
# app.py
import threading as _threading
import concurrent.futures as _cf

@app.route("/api/internal/auto-fetch-all", methods=["POST"])
def api_internal_auto_fetch_all():
    """Cloud Scheduler から定期実行されるエンドポイント"""
    # 内部トークンで認証
    token = request.headers.get("X-Internal-Token", "")
    if not _INTERNAL_TOKEN or not hmac.compare_digest(token, _INTERNAL_TOKEN):
        return jsonify({"error": "unauthorized"}), 401

    # 同期対象ユーザーを取得
    import firestore_service as fs
    fs_users = fs.list_sync_users()
    if not fs_users:
        return jsonify({"status": "ok", "users": 0, "message": "同期対象ユーザーなし"})

    def _run_all_fetches():
        """バックグラウンドで全ユーザーを同期"""
        source_map = {"setagaya": "setagaya", "audible": "audible_jp", "kindle": "kindle"}

        def _fetch_for_user(u: dict):
            uid = u["uid"]
            user_dir = library_service.DATA_DIR / "users" / uid
            if not user_dir.exists():
                return uid, {"error": "no_data_dir"}

            library_service.set_user_data_dir(user_dir)
            results = {}

            for src_key, enabled in u["sources"].items():
                if not enabled:
                    continue
                lib_id = source_map.get(src_key, src_key)
                try:
                    payload = library_service.fetch_and_save(lib_id)
                    results[src_key] = {"total": payload.get("total", 0)}
                except Exception as e:
                    results[src_key] = {"error": str(e)}
                    logger.error("auto-fetch uid=%s src=%s error=%s", uid, src_key, e)

            return uid, results

        # 最大4ユーザーを並列処理（API レート制限対策で上限あり）
        with _cf.ThreadPoolExecutor(max_workers=min(4, len(fs_users))) as executor:
            futures = {executor.submit(_fetch_for_user, u): u["uid"] for u in fs_users}
            for future in _cf.as_completed(futures, timeout=600):
                try:
                    uid, res = future.result(timeout=5)
                    logger.info("auto-fetch uid=%s 完了: %s", uid, res)
                except Exception as e:
                    logger.error("auto-fetch エラー: %s", e)

        library_service.set_user_data_dir(library_service.DATA_DIR)

    # バックグラウンドで実行し、即座に202を返す
    _threading.Thread(target=_run_all_fetches, daemon=True,
                      name="auto-fetch-all").start()
    return jsonify({"status": "accepted", "users": len(fs_users)}), 202
```

### Cloud Scheduler の設定

```bash
# 毎朝6時に同期（日本時間）
gcloud scheduler jobs create http yonda-fetch-morning \
  --location=asia-northeast1 \
  --schedule="0 6 * * *" \
  --time-zone="Asia/Tokyo" \
  --uri="https://your-app.run.app/api/internal/auto-fetch-all" \
  --http-method=POST \
  --headers="Content-Type=application/json,X-Internal-Token=${YONDA_INTERNAL_TOKEN}" \
  --message-body='{}' \
  --attempt-deadline=30s  # 202で即返すのでタイムアウトは短くてOK
```

### セキュリティ: 内部トークンの設定

Cloud Scheduler から Cloud Run を叩く際、外部からの不正呼び出しを防ぐためにトークン認証を使います。

```bash
# ランダムトークンを生成
openssl rand -hex 32
# → GitHub Secrets に YONDA_INTERNAL_TOKEN として登録

# Cloud Run の環境変数に設定
gcloud run services update myapp \
  --update-env-vars "YONDA_INTERNAL_TOKEN=${YONDA_INTERNAL_TOKEN}" \
  --region asia-northeast1
```

### ユーザーが認証情報を設定した時の自動 sources 更新

```python
@app.route("/api/credentials", methods=["POST"])
def api_save_credentials():
    data = request.get_json()
    library_id = data.get("library_id")
    # ... 認証情報を保存 ...

    # Firestore の sources フラグを有効化
    uid = library_service.get_current_uid()
    if uid:
        try:
            import firestore_service
            firestore_service.update_user_sources(uid, library_id, True)
        except Exception:
            pass

    return jsonify({"success": True})

@app.route("/api/credentials/<library_id>", methods=["DELETE"])
def api_delete_credentials(library_id):
    # ... 認証情報を削除 ...

    # Firestore の sources フラグを無効化
    uid = library_service.get_current_uid()
    if uid:
        try:
            import firestore_service
            firestore_service.update_user_sources(uid, library_id, False)
        except Exception:
            pass

    return jsonify({"success": True})
```

### 2 人目以降のユーザーオンボーディング

2 人目以降のユーザーは空のデータから始まります。アプリ内で各ソースの認証情報を設定するとそのユーザー専用のディレクトリに認証情報が保存され、次回の自動同期から対象になります。

```
1. ユーザーがアプリにGoogle ログイン
   → data/users/{uid}/ ディレクトリが作成される

2. ユーザーが「図書館設定」から認証情報を入力・保存
   → data/users/{uid}/credentials.json に保存
   → Firestore: users/{uid}.sources.setagaya = true

3. 次回の Cloud Scheduler 実行時
   → list_sync_users() に {uid} が含まれる
   → 自動同期が実行される
```

---

## 13. AI 書評機能

### 書評ポイントの自動生成

```python
@app.route("/api/book-insights/generate", methods=["POST"])
def api_generate_book_insight():
    data = request.get_json()
    book = data.get("book", {})

    prompt = f"""
以下の本について、読者が「読んでよかった」と感じるポイントを3〜5個、
箇条書きで簡潔に教えてください。

タイトル: {book.get('title', '')}
著者: {book.get('author', '')}
ジャンル: {book.get('genre', '')}
概要: {(book.get('full_summary') or book.get('summary', ''))[:500]}

各ポイントは1〜2文で、具体的な学びや気づきを含めてください。
"""

    ai_config = library_service.load_ai_config()

    if ai_config.get("provider") == "openai":
        import openai
        client = openai.OpenAI(api_key=ai_config["api_key"])
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=500,
        )
        insight_text = response.choices[0].message.content

    elif ai_config.get("provider") == "gemini":
        import google.generativeai as genai
        genai.configure(api_key=ai_config["api_key"])
        model = genai.GenerativeModel("gemini-1.5-flash")
        insight_text = model.generate_content(prompt).text

    insight = {"points": insight_text, "generated_at": datetime.now().isoformat()}
    library_service.save_book_insight(book, insight)
    return jsonify({"success": True, "insight": insight})
```

### バックグラウンドでの自動生成

```python
import threading

def _background_enrich_insights(library_id: str):
    books = library_service.get_completed_books_without_insights(max_count=5)
    for book in books:
        try:
            _generate_insight_for_book(book)
            time.sleep(2)  # API レート制限対策
        except Exception as e:
            logger.warning("書評生成エラー: %s - %s", book.get("title"), e)

threading.Thread(
    target=_background_enrich_insights,
    kwargs={"library_id": "kindle"},
    daemon=True,
    name="insight-backfill",
).start()
```

---

## 14. AI 選書機能

### 読書履歴からの推薦

```python
@app.route("/api/ai-recommend", methods=["POST"])
def api_ai_recommend():
    data = request.get_json()
    messages = data.get("messages", [])
    mode = data.get("mode", "5questions")

    system_prompts = {
        "5questions": """
あなたは読書コンシェルジュです。ユーザーに5つの質問をして、
ぴったりな本を3冊推薦してください。

質問例:
1. よく読むジャンルは?
2. 今の気分・悩みは?
3. 読書にかける時間は?
4. 最近印象に残った本は?
5. 求めているもの（知識・娯楽・癒し）は?
""",
        "yonda_history": """
ユーザーの読書履歴を分析して、好みに合った本を推薦するアシスタントです。
""",
    }

    ai_config = library_service.load_ai_config()
    system = system_prompts.get(mode, system_prompts["5questions"])

    if ai_config.get("provider") == "openai":
        import openai
        client = openai.OpenAI(api_key=ai_config["api_key"])
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": system},
                *[{"role": m["role"], "content": m["content"]} for m in messages],
            ],
            stream=True,
        )
        def generate():
            for chunk in response:
                delta = chunk.choices[0].delta.content or ""
                yield f"data: {json.dumps({'content': delta})}\n\n"
            yield "data: [DONE]\n\n"
        return Response(generate(), mimetype="text/event-stream")
```

---

## 15. フロントエンド UI 設計

### フレームワークなしで作る理由

- バンドルサイズが小さい（外部 JS ライブラリなし = 初期ロード高速）
- Claude が素の JS を最もよく理解してコードを生成する
- React 等の学習コストなしで機能に集中できる

### 状態管理

```javascript
// グローバル状態（シンプルに変数で管理）
let allBooks = [];           // 全書籍データ（API から取得済み）
let filteredBooks = [];      // 現在のフィルタ適用後のリスト
let currentPage = 1;
const PAGE_SIZE = 30;
let activeMainTab = 'yonda';
let _authUser = null;        // ログイン中ユーザー情報
```

### 書籍カードの描画

```javascript
function renderBookCard(book) {
    const stars = "★".repeat(book.rating || 0) + "☆".repeat(5 - (book.rating || 0));
    const sourceIcon = {
        "audible_jp": "🎧",
        "kindle":     "📱",
        "paper":      "📖",
    }[book.source] || "🏛️";

    return `
<div class="book-card" onclick="openBookDetail(${JSON.stringify(book).replace(/"/g, "&quot;")})">
  <div class="book-cover-wrap">
    <img class="book-cover" src="${escapeHtml(book.cover_url || '/static/book.png')}"
         alt="${escapeHtml(book.title)}" loading="lazy"
         onerror="this.src='/static/book.png'">
    <span class="book-source-badge">${sourceIcon}</span>
  </div>
  <div class="book-info">
    <div class="book-title">${escapeHtml(book.title)}</div>
    <div class="book-author">${escapeHtml(book.author || "")}</div>
    <div class="book-rating">${stars}</div>
  </div>
</div>`;
}
```

### 遅延読み込みとページネーション

2,000 冊以上を一度に描画するとブラウザがフリーズします。

```javascript
function renderBooks() {
    const start = (currentPage - 1) * PAGE_SIZE;
    const paginated = filteredBooks.slice(start, start + PAGE_SIZE);
    const bookList = document.getElementById("bookList");
    const fragment = document.createDocumentFragment();
    const div = document.createElement("div");
    div.innerHTML = paginated.map(renderBookCard).join("");
    while (div.firstChild) fragment.appendChild(div.firstChild);
    bookList.innerHTML = "";
    bookList.appendChild(fragment);
    renderPagination(filteredBooks.length, currentPage, PAGE_SIZE);
}
```

---

## 16. Amazon 連携とアフィリエイト

### アフィリエイトタグの設定

```javascript
function getAmazonUrl(book) {
    const tag = localStorage.getItem("yonda_affiliate_tag");
    const asin = book.catalog_number;
    if (asin) {
        return `https://www.amazon.co.jp/dp/${asin}${tag ? `?tag=${tag}` : ""}`;
    }
    return `https://www.amazon.co.jp/s?k=${encodeURIComponent(book.title)}${tag ? `&tag=${tag}` : ""}`;
}
```

### 複数ストアでの検索リンク生成

```javascript
function getBookSearchUrls(book) {
    const query = encodeURIComponent(`${book.title} ${book.author}`);
    const tag = localStorage.getItem("yonda_affiliate_tag") || "";
    const tagParam = tag ? `&tag=${tag}` : "";

    return {
        amazon:  `https://www.amazon.co.jp/s?k=${query}${tagParam}`,
        kindle:  `https://www.amazon.co.jp/s?k=${query}&i=digital-text${tagParam}`,
        audible: `https://www.audible.co.jp/search?keywords=${query}`,
        bookoff: `https://www.bookoffonline.co.jp/old/search?q=${query}`,
        calil:   `https://calil.jp/book/search?q=${query}`,  // 全国図書館横断検索
    };
}
```

---

## 17. コミュニティ機能

### みんなの読書記録（公開タイムライン）

```python
def _create_completed_books_message(
    prev_payloads: dict, curr_payloads: dict,
    errors: dict, user: dict
) -> Optional[dict]:
    """新規読了本があればコミュニティ投稿を生成"""
    new_books = []
    for lib_id, curr in curr_payloads.items():
        prev = prev_payloads.get(lib_id, {})
        prev_titles = {b.get("title") for b in prev.get("books", [])}
        for book in curr.get("books", []):
            if book.get("completed") and book.get("title") not in prev_titles:
                if not book.get("private", False):
                    new_books.append(book)

    if not new_books:
        return None

    return {
        "id":        str(uuid.uuid4()),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "books":     new_books[:10],
        "user":      user,
    }
```

---

## 18. Google Cloud Run へのデプロイ

### Dockerfile

```dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# 本番サーバー（gunicorn）で起動
CMD ["gunicorn", "--bind", "0.0.0.0:8080",
     "--workers", "2", "--threads", "4",
     "--timeout", "120", "app:app"]
```

### Cloud Run のデプロイ

```bash
gcloud config set project your-project-id

gcloud run deploy myapp \
  --source . \
  --region asia-northeast1 \
  --allow-unauthenticated \
  --memory 1Gi \
  --cpu 1 \
  --set-env-vars "GOOGLE_CLIENT_ID=xxx,GOOGLE_CLIENT_SECRET=xxx,FLASK_SECRET_KEY=xxx" \
  --quiet
```

### GCS バケットのマウント（永続ストレージ）

```bash
# GCSバケットを作成
gsutil mb -l asia-northeast1 gs://your-project-myapp-data

# Cloud Run サービスにバケットをマウント
gcloud run services update myapp \
  --add-volume name=data-vol,type=cloud-storage,bucket=your-project-myapp-data \
  --add-volume-mount volume=data-vol,mount-path=/mnt/data \
  --set-env-vars DATA_DIR=/mnt/data \
  --region asia-northeast1
```

### Firestore の有効化

```bash
gcloud firestore databases create --region=asia-northeast1

gcloud projects add-iam-policy-binding your-project-id \
  --member="serviceAccount:YOUR_SA@developer.gserviceaccount.com" \
  --role="roles/datastore.user"
```

### Secret Manager で認証情報を安全に管理

```bash
# Audible 認証ファイルを Secret Manager に保存
gcloud secrets create myapp-auth-jp --data-file=data/auth_jp.json

# Cloud Run にシークレットをマウント
gcloud run services update myapp \
  --add-volume name=auth-secret,type=secret,secret=myapp-auth-jp \
  --add-volume-mount volume=auth-secret,mount-path=/secrets \
  --set-env-vars AUTH_FILE=/secrets/auth_jp.json \
  --region asia-northeast1
```

### GitHub Actions による継続的デプロイ

```yaml
# .github/workflows/deploy.yml
name: Deploy to Cloud Run
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: google-github-actions/auth@v2
        with:
          credentials_json: ${{ secrets.GCP_SA_KEY }}
      - uses: google-github-actions/deploy-cloudrun@v2
        with:
          service: myapp
          region: asia-northeast1
          source: .
          env_vars: |
            GOOGLE_CLIENT_ID=${{ secrets.GOOGLE_CLIENT_ID }}
            GOOGLE_CLIENT_SECRET=${{ secrets.GOOGLE_CLIENT_SECRET }}
            FLASK_SECRET_KEY=${{ secrets.FLASK_SECRET_KEY }}
            YONDA_INTERNAL_TOKEN=${{ secrets.YONDA_INTERNAL_TOKEN }}
```

---

## 19. セキュリティの考慮事項

### XSS 対策

```javascript
function escapeHtml(text) {
    const div = document.createElement("div");
    div.appendChild(document.createTextNode(String(text || "")));
    return div.innerHTML;
}

// DOM 操作は textContent を使う（innerHTML より安全）
titleEl.textContent = book.title;  // ✓ 安全
titleEl.innerHTML = book.title;    // ✗ XSS 脆弱性
```

### API キーの保護

```python
@app.route("/api/ai-config", methods=["GET"])
def api_get_ai_config():
    config = library_service.load_ai_config()
    return jsonify({
        "provider": config.get("provider", ""),
        "has_key":  bool(config.get("api_key")),
        # "api_key" は返さない
    })
```

### セキュリティヘッダー

```python
@app.after_request
def add_security_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response
```

---

## 20. Cursor + Claude を使った開発の進め方

### なぜ Cursor + Claude か

このアプリは **Cursor（AI コードエディタ）と Claude（Anthropic の大規模言語モデル）** を使って短期間で開発しました。

```
開発期間の比較:
- 従来の開発: 2〜3ヶ月
- Cursor + Claude: 週末2日 + 細部の調整数日
```

### 効果的な使い方

#### 1. 全体設計を Claude に相談する

```
「PythonとFlaskで読書記録アプリを作りたい。
AudibleとKindleと図書館から本を自動取得して、
AIで書評を生成する機能が欲しい。
複数ユーザーにも対応したい。
全体アーキテクチャを教えて」
```

Claude はアーキテクチャ案・技術選定・実装方針を詳細に提案します。

#### 2. スモールスタートで始める

```
Week 1: Flask + Google OAuth + 書籍データのJSONファイル保存
Week 2: Audible連携 or 図書館連携を追加
Week 3: フロントエンドを整える + Cloud Runデプロイ
Week 4: マルチユーザー対応 + Firestore統合
```

最初から「マルチユーザー対応」「Firestore」を目指さず、**まず動くもの**を作ってから段階的に拡張するのが成功のコツです。

#### 3. エラーはそのまま Claude に貼る

```
「以下のエラーが出ています。修正してください:

MismatchingStateError: CSRF Warning! State not equal in request and response.
  File "app.py", line 45, in auth_callback」
```

Claude はエラーの原因と解決策を即座に提案します。このアプリ開発でも同じエラーが発生し、Claude が提案したファイルシステムバックアップ方式で解決しました。

#### 4. 「なぜそうするか」を聞く

Claude が生成したコードが理解できない場合は説明を求めます。

```
「このコードの threading.local() の部分が
マルチユーザーに必要な理由を説明して」
```

理解せずに使うのではなく、Claude を「説明してくれる先生」として活用することで、知識も同時に習得できます。

#### 5. Cursor のマルチファイル編集を活用

Cursor は複数ファイルを同時に編集できます。

```
「app.py と library_service.py の両方を修正して、
スレッドローカルによるユーザー分離を実装して」
```

この指示が 1 回で効きます。

#### 6. 機能追加のプロンプト例

```
# 新機能追加
「現在の実装に、図書館の貸出履歴を取得する機能を追加したい。
世田谷区立図書館のHTMLスクレイピングで実装して。
ログインページのURLは https://... で、フォームのフィールド名は userId と password」

# リファクタリング
「現在の setagaya.py をベースに、
どの図書館でも設定ファイルだけで対応できる汎用アダプタに書き直して」

# パフォーマンス改善
「2000冊の書籍リストを表示する際にブラウザがフリーズする。
ページネーションと DocumentFragment を使って改善して」
```

### 週末開発のタイムライン例

```
土曜日 午前（3時間）:
  09:00 プロジェクト作成・Flask基盤
  10:00 Google OAuth実装
  11:00 基本的なUIテンプレート作成

土曜日 午後（4時間）:
  13:00 Audibleアダプタ実装
  15:00 書籍データの保存・表示
  17:00 フィルタ・ソート機能

日曜日 午前（3時間）:
  09:00 図書館アダプタ実装
  10:30 書誌情報自動補完（Google Books）
  11:30 Cloud Runデプロイ

日曜日 午後（4時間）:
  13:00 UIの改善・モバイル対応
  14:30 AI書評機能
  16:00 Firestoreデータベース統合
  17:00 マルチユーザー化（threading.local）
```

### 実際に詰まったポイントと解決策

| 問題 | 原因 | 解決策 |
|------|------|--------|
| Cloud Run で MismatchingStateError | セッション Cookie がインスタンス間で共有されない | OAuth ステートを GCS にファイルで保存 |
| Kindle データが取得できない | Amazon の OTP 認証 | セッションストア + OTP フロー実装 |
| 2,000 冊表示でブラウザが固まる | DOM 操作が重い | ページネーション + DocumentFragment |
| 図書館の自動同期がタイムアウト | HTTP リクエストにタイムアウト設定なし | `timeout=(10, 30)` を全リクエストに追加 |
| マルチユーザーでデータが混在 | グローバル変数にデータを保持 | threading.local でスレッドごとに分離 |
| Firestore への書き込みが失敗 | バッチ書き込みの 500 件制限 | 499 件ごとにコミットを分割 |

---

## まとめ

**Cursor + Claude でのアプリ開発を通じて実証されたこと：**

1. **API の壁を AI が突破する** — Audible の非公式 API、Kindle の FIONA API、図書館スクレイピングはすべて Claude が実装方針を提案
2. **エラーデバッグが速い** — スタックトレースを貼るだけで根本原因と修正コードが返ってくる
3. **設計の相談相手になる** — 「マルチユーザーにするにはどう設計すればいいか」のような設計判断も Claude と議論できる
4. **汎用化も AI に頼む** — 「世田谷区立図書館専用の実装を、どの図書館でも動く汎用設計に書き直して」という指示が通る
5. **ドキュメントまで自動生成** — このドキュメント自体も Cursor + Claude で生成

### 次のステップ

このガイドをベースに、さらに拡張できる機能：

- [ ] Kindle ハイライト連携（読書メモの自動取込み）
- [ ] 読書ペース予測（今の積読をいつ読み終えるか）
- [ ] 読書サークル機能（グループでの読書記録共有）
- [ ] 書評ブログへの自動投稿（WordPress / note 連携）
- [ ] LINE / Slack Bot で読了報告
- [ ] 楽天 Kobo / honto 連携
- [ ] 都道府県横断の図書館横断検索（カーリル API 活用）

---

*このドキュメントは yonda の開発実践をベースに、AI を使ったアプリ開発の実践書として執筆されました。*
*最終更新: 2026年6月*
