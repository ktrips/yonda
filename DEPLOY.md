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

**必要な GitHub Secrets:**

| Secret | 説明 |
|--------|------|
| `GCP_PROJECT_ID` | GCP プロジェクト ID |
| `GCP_SA_KEY` | サービスアカウントキー（JSON の内容をそのまま） |
| `AUTH_JP_JSON` | `auth_jp.json` の内容（Audible 認証） |
| `CREDENTIALS_JSON` | `.credentials.json` の内容（図書館認証、任意） |

**トリガー:**
- `main` ブランチへの push でフルデプロイ
- 手動実行（Actions → Deploy to Cloud Run → Run workflow）で、オプション「イメージ更新のみ」を選択可能

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
gsutil cp data/.credentials.json gs://PROJECT_ID-yonda-data/
```
