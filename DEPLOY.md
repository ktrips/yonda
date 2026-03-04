# yonda デプロイ手順（Google Cloud Run）

`yonda.ktrips.net` として Google Cloud Run にホスティングする手順。

## アーキテクチャ

```
ブラウザ → Cloud Run (yonda) → GCS バケット (データ永続化)
                               → Secret Manager (認証ファイル)
```

| コンポーネント | 用途 |
|---|---|
| **Cloud Run** | Flask アプリ本体（gunicorn） |
| **GCS バケット** | `library_books.json` / `audible_books.json` / `kindle_books.json` / `.credentials.json` の永続保存（FUSE マウント） |
| **Secret Manager** | `auth_jp.json`（Audible 認証）、`.credentials.json`（図書館ログイン） |
| **Artifact Registry** | Docker イメージ保管 |

## 前提条件

1. **gcloud CLI** がインストール済み
2. GCP プロジェクトにログイン済み
3. 課金が有効
4. `ktrips.net` ドメインの DNS を管理できる

```bash
# ログイン & プロジェクト設定
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
```

## デプロイ手順

### 1. 初回フルデプロイ

```bash
cd yonda
./deploy.sh
```

スクリプトが以下を自動で行います:

1. 必要な GCP API を有効化
2. Artifact Registry リポジトリを作成
3. Docker イメージを Cloud Build でビルド & プッシュ
4. GCS バケットを作成し、既存データをアップロード
5. `auth_jp.json` / `.credentials.json` を Secret Manager に登録
6. サービスアカウントに権限付与
7. Cloud Run にデプロイ（GCS FUSE マウント + Secret 注入）
8. カスタムドメインをマッピング

### 2. DNS 設定

デプロイ後、DNS に CNAME レコードを追加:

```
yonda.ktrips.net.  CNAME  ghs.googlehosted.com.
```

または、以下のコマンドで確認できる A/AAAA レコードを設定:

```bash
gcloud run domain-mappings describe \
  --domain=yonda.ktrips.net \
  --region=asia-northeast1
```

SSL 証明書は Google が自動でプロビジョニングします（DNS 設定後、最大15分程度）。

### 3. コード更新時の再デプロイ

```bash
cd yonda
./deploy.sh --image-only
```

イメージのビルド & Cloud Run のデプロイのみ行います（バケットやシークレットは既存のものを使用）。

### 4. GitHub Actions でのデプロイ

`deploy.sh` と同等の処理を GitHub Actions で実行できます。

#### 4.1 ワークフロー配置（重要）

GitHub は **リポジトリルート** の `.github/workflows/` のみを読み込みます。

- ワークフローは `Git/.github/workflows/yonda-deploy.yml` に配置すること
- `yonda/.github/workflows/` 内のワークフローは実行されません

#### 4.2 セットアップ手順

**Step 1: GCP サービスアカウントの作成**

```bash
# プロジェクトIDを設定
export PROJECT_ID="your-gcp-project-id"
gcloud config set project $PROJECT_ID

# サービスアカウント作成
gcloud iam service-accounts create github-actions-yonda \
  --display-name="GitHub Actions for yonda"

# 必要な権限を付与
for role in "roles/run.admin" "roles/artifactregistry.admin" "roles/cloudbuild.builds.builder" \
  "roles/storage.admin" "roles/secretmanager.admin" "roles/iam.serviceAccountUser"; do
  gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:github-actions-yonda@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="$role" --quiet
done
```

**Step 2: サービスアカウントキーを JSON でダウンロード**

```bash
gcloud iam service-accounts keys create ~/sa-key-yonda.json \
  --iam-account=github-actions-yonda@${PROJECT_ID}.iam.gserviceaccount.com
```

**Step 3: GitHub Secrets の登録**

GitHub リポジトリ → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

| Secret 名 | 値 | 必須 |
|-----------|-----|------|
| `GCP_PROJECT_ID` | GCP プロジェクト ID（例: `my-project-123`） | ✅ |
| `GCP_SA_KEY` | Step 2 で作成した JSON ファイルの**全文**をコピー&ペースト | ✅ |
| `AUTH_JP_JSON` | `auth_jp.json` の内容 | ✅（Audible 利用時） |
| `CREDENTIALS_JSON` | `.credentials.json` の内容（図書館ログイン用） | 任意 |

**認証ファイルの取得例:**

```bash
# Audible 認証（auth_jp.json）
cat data/auth_jp.json
# または yonda 直下
cat auth_jp.json

# 図書館認証（.credentials.json）
cat data/.credentials.json
# または ~/.config/yonda に移行済みなら
cat ~/.config/yonda/credentials.json
```

**Step 4: 初回実行**

1. **方法A**: `main` ブランチの `yonda/` に push する（自動でフルデプロイが開始）
2. **方法B**: **Actions** タブ → **Deploy yonda to Cloud Run** → **Run workflow** で手動実行

#### 4.3 セットアップチェックリスト

- [ ] ワークフローが `Git/.github/workflows/yonda-deploy.yml` に配置されている
- [ ] `GCP_PROJECT_ID` を GitHub Secrets に登録
- [ ] `GCP_SA_KEY` を GitHub Secrets に登録
- [ ] `AUTH_JP_JSON` を GitHub Secrets に登録（Audible 利用時）
- [ ] `CREDENTIALS_JSON` を GitHub Secrets に登録（図書館利用時、任意）
- [ ] サービスアカウントに必要なロールを付与

#### 4.4 よくあるエラーと対処

| エラー | 原因 | 対処 |
|--------|------|------|
| ワークフローが実行されない | ワークフローがサブディレクトリにある | リポジトリルートの `.github/workflows/` に配置 |
| `Permission denied` / `403` | サービスアカウントの権限不足 | Step 1 の権限付与を再確認 |
| `GCP_SA_KEY` invalid | JSON の形式が不正 | キー全体をコピー（`{` から `}` まで） |
| `AUTH_JP_JSON` が空 | Secret 未設定 | Audible を使う場合は `auth_jp.json` の内容を登録 |
| Cloud Build 失敗 | Dockerfile のビルドエラー | ローカルで `docker build .` を試して動作確認 |
| イメージが push できない | Artifact Registry の権限 | `roles/artifactregistry.admin` が必要 |

#### 4.5 トリガー

- **push**: `main` ブランチの `yonda/**` に変更があるとフルデプロイ
- **workflow_dispatch**: 手動実行。「イメージ更新のみ」を選択可能（`deploy.sh --image-only` 相当）

## 環境変数

| 変数名 | デプロイ時の値 | ローカルデフォルト |
|---|---|---|
| `YONDA_DATA_DIR` | `/mnt/data` (GCS FUSE) | `./data` |
| `YONDA_AUTH_FILE` | `/secrets/auth_jp.json` | `./auth_jp.json` |
| `YONDA_CREDS_PATH` | `/mnt/data/.credentials.json` | `./data/.credentials.json` |

## コスト目安

- **Cloud Run**: リクエストがない時はスケールダウン（min-instances=0）、月数百円程度
- **GCS**: 数MB のデータファイルのみ、ほぼ無料
- **Secret Manager**: 無料枠内

## トラブルシューティング

```bash
# ログ確認
gcloud run services logs read yonda --region=asia-northeast1 --limit=50

# Cloud Run サービス状態
gcloud run services describe yonda --region=asia-northeast1

# ドメインマッピング状態
gcloud run domain-mappings describe --domain=yonda.ktrips.net --region=asia-northeast1

# シークレット更新（auth_jp.json を更新した場合）
gcloud secrets versions add yonda-auth-jp --data-file=auth_jp.json

# 手動でデータをバケットにアップロード
gsutil cp data/library_books.json gs://PROJECT_ID-yonda-data/
gsutil cp data/audible_books.json gs://PROJECT_ID-yonda-data/
gsutil cp data/kindle_books.json gs://PROJECT_ID-yonda-data/
gsutil cp ~/.config/yonda/credentials.json gs://PROJECT_ID-yonda-data/.credentials.json
```
