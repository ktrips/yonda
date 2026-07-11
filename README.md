# yonda — 読書が、あなたの財産に。

図書館・Audible・Kindle・紙の本の読書記録を自動で同期し、ひとつの本棚として積み上げる Web アプリ。入力する項目は、ありません。

- 本番: https://yonda.ktrips.net
- 戦略プラン: [docs/Yonda_plan.md](docs/Yonda_plan.md) / 設計変数（PR & FAQ）: [docs/Yonda_PR_FAQ.md](docs/Yonda_PR_FAQ.md)
- PR & FAQ（公開版）: https://yonda.ktrips.net/pr-faq
- 開発ガイド（公開版）: https://yonda.ktrips.net/dev-guide

## 機能

### データソース

| ソース | 機能 |
|-------|------|
| **世田谷区立図書館** | 貸出履歴の取得、お気に入り登録の表示 |
| **Audible Japan** | オーディオブック蔵書の取得（auth_jp.json 認証） |
| **Kindle** | Amazon ログインまたはローカルファイルから蔵書取得 |
| **紙の本** | 手動登録（タイトル入力・写真撮影・Amazon リンク貼付け） |

---

### Yonda（読んだ？）— 読書記録の表示・管理

#### タブ構成

| タブ | 内容 |
|------|------|
| **Yonda** | 読んだ・読中の本一覧 |
| **みんなのYonda** | ユーザー全体の読書記録をコミュニティ表示 |

#### 一覧表示

- **カード表示 / テーブル表示** の切り替え
- **フィルター**: 検索（タイトル・著者）、ソース（図書館/Audible/Kindle/紙）、状態（読了/未読/お気に入り/評価）
- **並べ替え**: 取得日・読了日・著者・積読日数など
- **本の概要**: カード・テーブルに概要を表示（Open Library / Google Books / Audible から自動取得）
- **表紙**: Open Library / Google Books API で自動取得
- **評価（★）**: 個人評価を優先表示。Audible は Audible カタログ評価にフォールバック
- **ジャンル**: バッジ表示（ジャンル別カラーコード付き）

#### テーブルビュー 列構成

| 列 | 説明 |
|----|------|
| 表紙 | サムネイル |
| タイトル | 読了バッジ・お気に入りバッジ |
| 著者 | |
| 概要 | 最大80文字 |
| ジャンル | ジャンルカラーバッジ |
| 再生時間 | Audible / 紙（デフォルト4時間） |
| 取得日 | |
| 読了日 | 読中は進捗 |
| 積読 | 取得〜読了日数 |
| ソース | 図/A/K/P バッジ |
| 書評ポイント | AI 生成または手入力のレビューポイント |
| **非公開** | チェックでみんなのYondaから除外 |
| **非表示** | チェックで一覧から非表示（自分の一覧にも表示しない） |

#### 本の詳細モーダル

- 著者・ジャンル・★評価・レビュー（見出し/コメント）
- Amazon・メルカリへのリンク（アフィリエイトタグ付き）
- 概要テキスト
- **書評ポイント**: AI 生成または手入力。スクロール可能エリア（最大260px）
- 書評を書くリンク（📝 アイコン）
- 紙の本の場合: 編集・削除ボタン
- **非公開フラグ**: みんなのYondaから除外
- **非表示フラグ**: 一覧から非表示

#### マイ・ランキング

- Yonda タブ内にインライン表示
- 年別フィルター付き（全期間・各年）
- ★評価順ランキング

#### 読書グラフ・統計

- 月別・ジャンル別の読了数チャート
- 読了数・今年の読了数・お気に入り数

---

### Yomu（何読む？）— 次に読みたい本検索

- **キーワード検索**: タイトル・著者で Amazon・Kindle・Audible・メルカリ・ブックオフ・図書館を横断検索
- **写真から検索**: 本の表紙を撮影すると AI（OpenAI/Gemini）またはバーコード（ISBN）・OCR で本情報を自動抽出
- **+紙の本として保存**: 検索結果または手動入力で紙の本を登録。写真を表紙に使用可能
- **Amazonリスト**: 欲しいものリストの本を表示・管理
- **Amazon 設定**: ハンバーガーメニュー → Amazon設定 から Wishlist URL とアフィリエイトタグを設定
- **検索するアプリ**: ハンバーガーメニュー → アプリ設定 → 検索するアプリ で有効/無効を選択、カスタムアプリも追加可能

---

### Oshi（AI推し）— AI による本の提案

| モード | 説明 |
|--------|------|
| **簡単質問推し** | 性別・年代・職業・ジャンル・頻度をスライダーで入力、会話形式で提案 |
| **MBTI推し** | 性格タイプに合った本を提案 |
| **強み診断推し** | StrengthsFinder の強みに合った本を提案 |
| **読書履歴推し** | 自分の読了・未読リストから AI が最適な本を理由付きで推薦 |

---

### みんなのYonda — コミュニティ表示

- 直近の読書メッセージ（最大10件、1件あたり5冊まで）
- **ジャンルカラー**: 本カードの背景・左ボーダーをジャンル色で表示
- **ジャンルバッジ**: 頭文字1文字の丸バッジ（ジャンル色）
- **ソースバッジ**: 図/A/K/P
- **個人評価★**: `displayRating` による星表示（個人評価優先、Audibleはカタログ評価）
- **個人レビュー**: 見出しまたはコメントを表示
- **非公開本は除外**: `private: true` の本は表示されない
- 本をタップすると詳細モーダルが開く

---

### アプリ設定

ハンバーガーメニュー → **アプリ設定** から各種設定が可能。

| 設定項目 | 説明 |
|---------|------|
| **Amazon設定** | Wishlist URL・アフィリエイトタグ |
| **AI設定** | OpenAI / Gemini API キー |
| **検索するアプリ** | Amazon・Kindle・Audible・メルカリ・ブックオフ・図書館の有効/無効、カスタムアプリ追加 |

---

### 非公開・非表示フラグ

| フラグ | 対象 | 効果 |
|--------|------|------|
| **非公開** | 全ソース | みんなのYondaに表示されない |
| **非表示** | 全ソース | 自分の一覧にも表示されない |

- `data/private_books.json` / `data/hidden_books.json` で book_id を管理
- デフォルトは公開・表示（ブランク）

---

### ヘッダー検索

- タイトル・著者のリアルタイム検索
- 結果なし時: Amazon・Kindle・Audible・メルカリ・ブックオフ・図書館 + **+紙の本** ボタンを表示

---

### 書評ポイント

- **手入力**: 見出し・本文を自分で入力
- **AI生成**: OpenAI/Gemini で書評ポイントを自動生成
- 各ポイントのコピーボタン付き
- 本の詳細モーダルでスクロール可能エリアに表示

---

### REST API v1（外部公開 API）

認証不要で外部から読書データを取得できる読み取り専用 REST API。

**ベース URL:** `https://yonda.ktrips.net`

---

#### プロフィール取得

```
GET /api/v1/users/{gmail}/profile
```

```json
{
  "success": true,
  "profile": {
    "name": "Kenichi Yoshida",
    "picture": "https://...",
    "completed_count": 1932,
    "stats_updated_at": "2026-06-28T12:40:34+00:00"
  }
}
```

---

#### 読書リスト取得

```
GET /api/v1/users/{gmail}/books
```

| パラメーター | デフォルト | 説明 |
|---|---|---|
| `filter` | `completed` | `completed`（読了）/ `recent`（直近）/ `in_progress`（読中）/ `all` |
| `days` | `7` | `recent` 時の日数（最大 365） |
| `source` | `all` | `kindle` / `setagaya` / `audible_jp` / `paper` / `all` |
| `limit` | `50` | 最大件数（最大 500） |
| `offset` | `0` | ページネーション用オフセット |

**使用例:**

```bash
# 読了本（直近30日）
curl "https://yonda.ktrips.net/api/v1/users/you@gmail.com/books?filter=recent&days=30"

# Kindle の全読了本（100件）
curl "https://yonda.ktrips.net/api/v1/users/you@gmail.com/books?source=kindle&limit=100"

# 全ソース 500件目以降
curl "https://yonda.ktrips.net/api/v1/users/you@gmail.com/books?filter=all&limit=500&offset=500"
```

**レスポンス例:**

```json
{
  "success": true,
  "filter": "recent",
  "total": 12,
  "returned": 5,
  "offset": 0,
  "limit": 5,
  "books": [
    {
      "title": "〇〇の本",
      "author": "著者名",
      "genre": "文学・フィクション",
      "cover": "https://...",
      "source": "audible_jp",
      "completed": true,
      "completed_date": "2026-06-28T00:00:00+09:00",
      "rating": 4,
      "comment": "面白かった",
      "isbn": "",
      "asin": "B0XXXXXX",
      "runtime_length_min": 480
    }
  ]
}
```

---

#### 直近読了ショートカット

```
GET /api/v1/users/{gmail}/recent?days=7&limit=20
```

---

#### 全ユーザー統計（公開）

```
GET /api/public/user-stats
```

```json
{
  "success": true,
  "users": [
    {
      "name": "Kenichi Yoshida",
      "picture": "https://...",
      "completed_count": 1932,
      "uid": "..."
    }
  ]
}
```

---

### Slack 連携

Slack Slash Command `/yonda` で読書記録を検索・確認できます。

| コマンド | 説明 |
|---|---|
| `/yonda read` | 直近の読了済み本 |
| `/yonda reading` | 読んでいる途中の本 |
| `/yonda unread` | 未読の本 |
| `/yonda stats` | 統計情報 |
| `/yonda <キーワード>` | タイトル・著者を検索 |
| `/yonda help` | ヘルプ |

設定方法は「[Slack 連携セットアップ](#slack-連携セットアップ)」を参照。

---

## 起動方法

```bash
cd yonda
pip install -r requirements.txt
python -m app
```

ブラウザで `http://127.0.0.1:5002` を開く（ポート番号は表示に従う）。

## 設定

各ソースの設定手順は、アプリ内の **「設定のヘルプ」** から確認できます。

| ソース | 認証方法 |
|--------|----------|
| 世田谷区立図書館 | 利用者番号・パスワード（アカウント設定で登録） |
| Audible Japan | `scripts/audible_auth.py` で認証し `data/auth_jp.json` を生成（トークン有効期限: 約60〜90日） |
| Kindle | Amazon メール・パスワード、またはローカルファイル（BookData.sqlite） |
| 紙の本 | アプリ内から手動登録（テキスト・写真・Amazon リンク） |

## Kindle の取得方法

1. **Amazon ログイン（推奨）**: 認証情報を登録し、初回のみ2段階認証（OTP）を入力。**セッションが自動保存されるため、次回以降は OTP なしで自動取得できます**
2. **ローカルファイル**: Kindle for Mac を起動して蔵書を同期し、認証なしで取得
3. **フォールバック**: 認証 + ローカルファイルを用意しておくと、API 失敗時に自動でローカルから取得

### セッション永続化

- 初回 OTP 認証後、セッションが `~/.config/yonda/kindle_session.json` に7日間保存されます
- Cloud Scheduler による定期取得時、保存済みセッションが自動再利用されます
- セッションが無効になった場合のみ、再ログイン（OTP 必要）が行われます

詳細は [docs/KINDLE_SETUP.md](docs/KINDLE_SETUP.md) を参照。

## Audible の認証と再認証

Audible のアクセストークンは **約60〜90日**で期限切れになります。期限切れになると取得時にエラーが表示されます。

### 初回認証・再認証手順

```bash
python3 scripts/audible_auth.py
```

Amazon メールアドレスとパスワードを入力します。2段階認証（OTP）が設定されている場合はコード入力を求められます。完了すると `data/auth_jp.json` が更新されます。

### Cloud Run（yonda.ktrips.net）への反映

```bash
cat data/auth_jp.json
```

GitHub リポジトリ → **Settings** → **Secrets and variables** → **Actions** → `AUTH_JP_JSON` を新しい内容で上書き保存後、`main` に push してデプロイします。

## スクリプト一覧（`scripts/`）

| スクリプト | 説明 |
|-----------|------|
| `audible_auth.py` | Audible Japan 認証・再認証。`data/auth_jp.json` を生成 |
| `fetch_audible_full.py` | Audible API から指定タイトルの全データを取得（デバッグ用） |
| `fetch_kindle_fiona.py` | Amazon FIONA API 経由で Kindle 蔵書を取得 |
| `kindle_session_manager.py` | Kindle セッションの状態確認・削除（`status` / `verify` / `clear`） |
| `show_audible_fields.py` | Audible API レスポンスのフィールド確認（デバッグ用） |
| `migrate_config_to_secure.py` | 旧パスの設定ファイルを `~/.config/yonda/` に移行 |
| `migrate_to_firestore.py` | JSON データを Cloud Firestore へ移行 |
| `firestore_test.py` | Firestore 接続確認ユーティリティ |

**ルートスクリプト:**

| スクリプト | 説明 |
|-----------|------|
| `fetch_all.py` | 全ソース（図書館・Audible・Kindle）の読書記録を一括取得して保存 |

## データの保存先

| ファイル | ソース |
|----------|--------|
| `library_books.json` | 図書館 |
| `audible_books.json` | Audible |
| `kindle_books.json` | Kindle |
| `paper_books.json` | 紙の本（手動登録） |
| `amazon_list.json` | Amazon 欲しいものリスト |
| `book_insights.json` | 書評ポイント（AI生成・手入力） |
| `private_books.json` | 非公開フラグ（book_id リスト） |
| `hidden_books.json` | 非表示フラグ（book_id リスト） |
| `yonda_messages.json` | みんなのYonda コミュニティデータ |
| `BookData.sqlite` | Kindle（ローカル同期用） |

読書データは `yonda/data/`（環境変数 `YONDA_DATA_DIR` で変更可能）。

**認証・設定ファイル**（セキュアな保存先）:

| ファイル | 用途 | デフォルトパス |
|----------|------|----------------|
| `ai_config.json` | AI（OpenAI/Gemini）API キー | `~/.config/yonda/ai_config.json` |
| `credentials.json` | 図書館認証 | `~/.config/yonda/credentials.json` |

環境変数 `YONDA_CONFIG_DIR` でディレクトリを変更、`YONDA_AI_CONFIG_PATH` / `YONDA_CREDS_PATH` で個別パスを指定可能。

## 環境変数

### アプリ基本設定

| 変数 | 説明 |
|------|------|
| `YONDA_DATA_DIR` | データ保存先ディレクトリ（Cloud Runでは`/mnt/data`にGCSマウント） |
| `YONDA_CONFIG_DIR` | 認証・設定ファイルのディレクトリ（デフォルト: `~/.config/yonda`） |
| `YONDA_AI_CONFIG_PATH` | AI 設定ファイルのパス |
| `YONDA_CREDS_PATH` | 図書館認証ファイルのパス |
| `YONDA_AUTH_FILE` | Audible 認証ファイル（auth_jp.json）のパス |
| `YONDA_KINDLE_SQLITE_PATH` | Kindle BookData.sqlite のパス（任意） |
| `YONDA_KINDLE_XML_PATH` | KindleSyncMetadataCache.xml のパス（任意） |
| `YONDA_KINDLE_SESSION_PATH` | Kindle セッションファイルのパス（デフォルト: `~/.config/yonda/kindle_session.json`） |
| `FLASK_SECRET_KEY` | Flask セッション署名キー（未設定時は `GOOGLE_CLIENT_SECRET` から自動生成） |

### Google OAuth（マルチユーザー）

| 変数 | 説明 |
|------|------|
| `GOOGLE_CLIENT_ID` | Google OAuth 2.0 クライアント ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth 2.0 クライアントシークレット |
| `GOOGLE_REDIRECT_URI` | OAuth コールバック URI（例: `https://yonda.ktrips.net/auth/callback`） |

### 自動取得・通知

| 変数 | 説明 |
|------|------|
| `YONDA_INTERNAL_TOKEN` | `/api/internal/auto-fetch` 認証トークン（Cloud Scheduler マルチユーザー取得用） |
| `TWILIO_ACCOUNT_SID` | Twilio Account SID（SMS 通知利用時） |
| `TWILIO_AUTH_TOKEN` | Twilio Auth Token |
| `TWILIO_FROM` | Twilio 送信元電話番号 |
| `IOS_MESSAGE_TO` | SMS 送信先電話番号 |
| `YONDA_IOS_MESSAGE_WEBHOOK_URL` | 読書完了メッセージ送信先 Webhook URL（Twilio の代替） |

### Slack

| 変数 | 説明 |
|------|------|
| `SLACK_SIGNING_SECRET` | Slack Slash Command の署名シークレット（Slack 連携利用時） |

**ローカル起動時にクラウドのデータを参照する場合:**

```bash
brew install --cask google-cloud-sdk
brew install gcsfuse
mkdir -p ~/yonda-gcs-mount
gcsfuse airgo-trip-yonda-data ~/yonda-gcs-mount
export YONDA_DATA_DIR=~/yonda-gcs-mount
python -m app
```

## デプロイ

Google Cloud Run へのデプロイ方法は 2 通りあります。

| 方法 | 説明 |
|------|------|
| **deploy.sh** | ローカルから `./deploy.sh` でフルデプロイ、`./deploy.sh --image-only` でイメージ更新のみ |
| **GitHub Actions** | `main` への push で自動デプロイ。手動実行で「イメージ更新のみ」も選択可能 |

詳細は [DEPLOY.md](DEPLOY.md) を参照。`yonda.ktrips.net` としてホスティング可能。

### 定期自動取得（Cloud Scheduler）

フルデプロイ時に Cloud Scheduler ジョブが自動作成され、毎日 3 回データを取得して GCS に保存します。

| ジョブ名 | 時刻（JST） | 対象 |
|----------|-------------|------|
| `yonda-fetch-morning` | 06:00 | 図書館・Audible・Kindle（自動） |
| `yonda-fetch-noon` | 12:00 | 図書館・Audible・Kindle（自動） |
| `yonda-fetch-evening` | 18:00 | 図書館・Audible・Kindle（自動） |

取得先エンドポイント: `POST https://yonda.ktrips.net/api/fetch` with `{"library_id": "all"}`

> **Kindle の自動取得について**  
> セッションが有効な場合、またはローカルファイルが利用可能な場合に自動取得されます。  
> - 初回のみ手動ログイン（OTP 入力）が必要。以降はセッションが自動再利用されます（有効期限: 7日間）  
> - セッションが無効でローカルファイルもない場合はスキップされます  
> - GCS に `BookData.sqlite` を配置する場合は `YONDA_KINDLE_SQLITE_PATH=/mnt/data/BookData.sqlite` を設定

### Google OAuth セットアップ（マルチユーザー）

Google Cloud Console でOAuth 2.0 クライアントを作成し、以下を設定します。

1. [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services** → **認証情報** → **OAuth 2.0 クライアント ID** を作成
2. 承認済みのリダイレクト URI に `https://yonda.ktrips.net/auth/callback` を追加
3. クライアント ID・シークレットを取得し、GitHub Secrets へ登録

```bash
# Cloud Run への環境変数設定例
gcloud run services update yonda \
  --region=asia-northeast1 \
  --update-env-vars="GOOGLE_CLIENT_ID=xxx,GOOGLE_CLIENT_SECRET=yyy,GOOGLE_REDIRECT_URI=https://yonda.ktrips.net/auth/callback"
```

> OAuth を設定しない場合はシングルユーザーモードで動作します（ログイン不要）。

---

### ホーム画面ショートカット（PWA）

`static/manifest.json` を参照。Android / iOS のホーム画面への追加時にブックアイコン（192×512px）とアプリ名「Yonda」が表示されます。

---

### Slack 連携セットアップ

1. [Slack API](https://api.slack.com/apps) でアプリを作成
2. **Slash Commands** → `/yonda` を追加、Request URL を `https://yonda.ktrips.net/slack/command` に設定
3. **Basic Information** → **Signing Secret** をコピー
4. 環境変数 `SLACK_SIGNING_SECRET` に設定

```bash
gcloud run services update yonda \
  --region=asia-northeast1 \
  --update-env-vars="SLACK_SIGNING_SECRET=your_signing_secret"
```

### GitHub Actions セットアップ（初回のみ）

#### 1. GCP サービスアカウントの作成

```bash
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
export PROJECT_ID="your-gcp-project-id"

gcloud iam service-accounts create github-actions-yonda \
  --display-name="GitHub Actions for yonda"

for role in "roles/run.admin" "roles/artifactregistry.admin" "roles/cloudbuild.builds.builder" \
  "roles/storage.admin" "roles/secretmanager.admin" "roles/iam.serviceAccountUser" \
  "roles/serviceusage.serviceUsageAdmin" "roles/logging.viewer" \
  "roles/cloudscheduler.admin"; do
  gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:github-actions-yonda@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="$role" --quiet
done

gcloud iam service-accounts keys create ~/sa-key-yonda.json \
  --iam-account=github-actions-yonda@${PROJECT_ID}.iam.gserviceaccount.com
cat ~/sa-key-yonda.json
```

#### 2. GitHub Secrets の登録

リポジトリ → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

| Secret 名 | 値 | 必須 |
|-----------|-----|------|
| `GCP_PROJECT_ID` | GCP プロジェクト ID | ✅ |
| `GCP_SA_KEY` | サービスアカウントキー JSON 全文 | ✅ |
| `AUTH_JP_JSON` | `auth_jp.json` の内容 | ✅（Audible 利用時） |
| `CREDENTIALS_JSON` | `credentials.json` の内容 | 任意（図書館利用時） |
| `GOOGLE_CLIENT_ID` | Google OAuth クライアント ID | 任意（マルチユーザー時） |
| `GOOGLE_CLIENT_SECRET` | Google OAuth クライアントシークレット | 任意（マルチユーザー時） |
| `YONDA_INTERNAL_TOKEN` | 内部 API 認証トークン | 任意（Cloud Scheduler 自動取得時） |

#### 3. セットアップチェックリスト

- [ ] ワークフローが `.github/workflows/yonda-deploy.yml` に配置されている
- [ ] `GCP_PROJECT_ID` を GitHub Secrets に登録
- [ ] `GCP_SA_KEY` を GitHub Secrets に登録
- [ ] `AUTH_JP_JSON` を GitHub Secrets に登録（Audible 利用時）
- [ ] `CREDENTIALS_JSON` を GitHub Secrets に登録（図書館利用時、任意）
