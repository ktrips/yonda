# yonda — 読書記録ビューア

図書館・Audible・Kindle の読書記録を統合して表示・管理する Web アプリ。

## 機能

### データソース

| ソース | 機能 |
|-------|------|
| **世田谷区立図書館** | 貸出履歴の取得、お気に入り登録の表示 |
| **Audible Japan** | オーディオブック蔵書の取得（auth_jp.json 認証） |
| **Kindle** | Amazon ログインまたはローカルファイルから蔵書取得 |

### Yonda（読んだ？）— 読書記録の表示

- **読んだ / ランキング / オススメ**: タブで切り替え
- **フィルター**: 検索（タイトル・著者）、ソース（図書館/Audible/Kindle）、状態（読了/未読/お気に入り/評価）、並べ替え
- **表示切り替え**: カード表示 / テーブル表示
- **本の概要**: カード・テーブルに本の概要を表示（Open Library / Google Books / Audible から取得）
- **読書グラフ**: 月別・ジャンル別の読了数チャート
- **統計**: 読了数、今年の読了数、お気に入り数
- **評価・お気に入り**: 本ごとに★評価とお気に入り登録（Audible はカタログ評価を表示）
- **表紙**: Open Library / Google Books API で自動取得
- **Yonda オススメ**: 読了本の傾向から未読本を AI で 5 冊推薦
- **最終同期日時**: メニューの「読書記録取込み」にソースごとの最終取得日時を表示（例: `図書館 4/3 06:00`）

### Yomu（何読む？）— 次に読みたい本検索

- **価格比較検索**: タイトル・著者で検索し、Amazon（Kindle/Audible）、メルカリ、ブックオフ、図書館の在庫・価格を一覧表示
- **写真から検索**: 本の表紙を撮影すると、AI（OpenAI/Gemini）またはバーコード（ISBN）・OCR で本の情報を自動抽出して検索

### Oshi（AI推し）— AI による本の提案

- **選書モード**: 簡単な質問で選書（デフォルト）、MBTI診断で選書、Strength Finderで選書
- **フォーム入力**: 簡単な質問モードでは性別・年代・職業・ジャンル・読書頻度をスライダーで選択（モバイルでは読書頻度は非表示）
- **会話型提案**: AI が質問しながらあなたに合った本を提案
- **提案内容**: 選んだ理由、本の紹介、レビュー、Amazon リンク

### その他

- **ISBN 検索**: Open Library API で ISBN から書籍情報を取得（CORS 回避用プロキシ）
- **アフィリエイトタグ**: Kindle・Audible リンクにタグを付与可能
- **書籍データダウンロード**: `GET /api/download/<source>` で保存済みの JSON をダウンロード
- **API ドキュメント**: `GET /api/docs` でブラウザから REST API 仕様を確認可能

### REST API v1

外部連携用の読み取り専用 REST API。

| エンドポイント | 説明 |
|---|---|
| `GET /api/v1/books` | 読書記録一覧（フィルタ・検索・ページネーション対応） |
| `GET /api/v1/books/stats` | 統計情報（読了数・ソース別集計など） |
| `GET /api/v1/books/<catalog_number>` | ASIN・図書館番号で1冊の詳細を取得 |

**`/api/v1/books` クエリパラメータ:**

| パラメータ | 値 | デフォルト |
|---|---|---|
| `status` | `read` / `unread` / `in_progress` / `all` | `all` |
| `source` | `setagaya` / `audible_jp` / `kindle` / `all` | `all` |
| `q` | タイトル・著者の部分一致検索 | — |
| `sort` | `loan_date_desc` / `completed_date_desc` / `percent_desc` / `title_asc` | `loan_date_desc` |
| `limit` | 1〜200 | `50` |
| `offset` | 0以上 | `0` |

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
# 更新された auth_jp.json の内容を確認
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

## データの保存先

| ファイル | ソース |
|----------|--------|
| `library_books.json` | 図書館（`fetch_date` フィールドに最終取得日時を記録） |
| `audible_books.json` | Audible（同上） |
| `kindle_books.json` | Kindle（同上） |
| `BookData.sqlite` | Kindle（ローカル同期用） |

読書データは `yonda/data/`（環境変数 `YONDA_DATA_DIR` で変更可能）。

**認証・設定ファイル**（セキュアな保存先）:

| ファイル | 用途 | デフォルトパス |
|----------|------|----------------|
| `ai_config.json` | AI（OpenAI/Gemini）API キー | `~/.config/yonda/ai_config.json` |
| `credentials.json` | 図書館認証 | `~/.config/yonda/credentials.json` |

環境変数 `YONDA_CONFIG_DIR` でディレクトリを変更、`YONDA_AI_CONFIG_PATH` / `YONDA_CREDS_PATH` で個別パスを指定可能。既存ファイルは初回起動時に自動移行されます。

## 環境変数

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
| `SLACK_SIGNING_SECRET` | Slack Slash Command の署名シークレット（Slack 連携利用時） |

**ローカル起動時にクラウドのデータを参照する場合:**

```bash
# GCSFUSEをインストール（macOS）
brew install --cask google-cloud-sdk
brew install gcsfuse

# GCSバケットをマウント
mkdir -p ~/yonda-gcs-mount
gcsfuse airgo-trip-yonda-data ~/yonda-gcs-mount

# アプリ起動
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
| `yonda-fetch-morning` | 06:00 | 図書館・Audible |
| `yonda-fetch-noon` | 12:00 | 図書館・Audible |
| `yonda-fetch-evening` | 18:00 | 図書館・Audible |

取得先エンドポイント: `POST https://yonda.ktrips.net/api/fetch` with `{"library_id": "all"}`

> **Kindle について**  
> Kindle はスケジュール自動取得の対象外です。手動で「読書記録取込み」から取得してください。  
> - Amazon メール・パスワードを登録し、初回のみ OTP を入力（**セッション永続化により次回以降は OTP 不要**、有効期限: 7日間）  
> - または `BookData.sqlite` を GCS バケットに配置し、`YONDA_KINDLE_SQLITE_PATH=/mnt/data/BookData.sqlite` を設定

### Slack 連携セットアップ

1. [Slack API](https://api.slack.com/apps) でアプリを作成
2. **Slash Commands** → `/yonda` を追加、Request URL を `https://yonda.ktrips.net/slack/command` に設定
3. **Basic Information** → **Signing Secret** をコピー
4. 環境変数 `SLACK_SIGNING_SECRET` に設定（Cloud Run の場合は Secret Manager 経由で設定）

```bash
# Cloud Run に環境変数を追加（ローカル deploy.sh 経由）
gcloud run services update yonda \
  --region=asia-northeast1 \
  --update-env-vars="SLACK_SIGNING_SECRET=your_signing_secret"
```

### GitHub Actions セットアップ（初回のみ）

GitHub Actions でデプロイするには、以下を設定してください。

#### 1. ワークフロー配置

ワークフローは **リポジトリルート** の `.github/workflows/yonda-deploy.yml` に配置されています。GitHub はこのパスのみを読み込むため、サブディレクトリ内のワークフローは実行されません。

#### 2. GCP サービスアカウントの作成と GCP_SA_KEY の取得

**Step 1: gcloud でログイン**

```bash
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
```

**Step 2: サービスアカウントの作成**

```bash
export PROJECT_ID="your-gcp-project-id"   # 実際のプロジェクトIDに変更

gcloud iam service-accounts create github-actions-yonda \
  --display-name="GitHub Actions for yonda"
```

**Step 3: 必要な権限の付与**

```bash
for role in "roles/run.admin" "roles/artifactregistry.admin" "roles/cloudbuild.builds.builder" \
  "roles/storage.admin" "roles/secretmanager.admin" "roles/iam.serviceAccountUser" \
  "roles/serviceusage.serviceUsageAdmin" "roles/logging.viewer" \
  "roles/cloudscheduler.admin"; do
  gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:github-actions-yonda@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="$role" --quiet
done
```

**Step 4: キー（JSON）のダウンロード**

```bash
gcloud iam service-accounts keys create ~/sa-key-yonda.json \
  --iam-account=github-actions-yonda@${PROJECT_ID}.iam.gserviceaccount.com
```

**Step 5: JSON の内容をコピー**

```bash
cat ~/sa-key-yonda.json
```

表示された JSON を **最初の `{` から最後の `}` まで** すべてコピーします。この内容が `GCP_SA_KEY` です。

> ⚠️ **注意**: この JSON は秘密情報です。Git にコミットしたり他人に共有しないでください。登録後は `~/sa-key-yonda.json` を削除して構いません。

#### 3. GitHub Secrets の登録

リポジトリ → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

| Secret 名 | 値 | 必須 |
|-----------|-----|------|
| `GCP_PROJECT_ID` | GCP プロジェクト ID（例: `my-project-123`） | ✅ |
| `GCP_SA_KEY` | Step 5 でコピーした JSON の全文を貼り付け | ✅ |
| `AUTH_JP_JSON` | `auth_jp.json` の内容 | ✅（Audible 利用時） |
| `CREDENTIALS_JSON` | `.credentials.json` の内容 | 任意（図書館利用時） |

**認証ファイルの取得例:**

```bash
# Audible 認証（auth_jp.json）— 再認証後に生成
python3 scripts/audible_auth.py
cat data/auth_jp.json   # この内容を AUTH_JP_JSON に登録

# 図書館認証（.credentials.json）
cat data/.credentials.json
# または ~/.config/yonda に移行済みなら
cat ~/.config/yonda/credentials.json
```

#### 4. 実行方法

- **自動**: `main` ブランチに push するとフルデプロイが自動開始
- **手動**: **Actions** タブ → **Deploy yonda to Cloud Run** → **Run workflow**（「イメージ更新のみ」を選択可能）

#### 5. セットアップチェックリスト

- [ ] ワークフローが `.github/workflows/yonda-deploy.yml` に配置されている
- [ ] `GCP_PROJECT_ID` を GitHub Secrets に登録
- [ ] `GCP_SA_KEY` を GitHub Secrets に登録（サービスアカウントキー JSON の全文）
- [ ] `AUTH_JP_JSON` を GitHub Secrets に登録（Audible 利用時）
- [ ] `CREDENTIALS_JSON` を GitHub Secrets に登録（図書館利用時、任意）
