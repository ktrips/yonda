#!/usr/bin/env bash
# ============================================================
# yonda → Google Cloud Run デプロイスクリプト
#   ホスト名: yonda.ktrips.net
#
# 前提:
#   - gcloud CLI がインストール済み & ログイン済み
#   - 対象 GCP プロジェクトが選択済み
#   - auth_jp.json がカレントディレクトリにある
#   - (任意) .credentials.json がカレントディレクトリにある
#
# 使い方:
#   chmod +x deploy.sh
#   ./deploy.sh                          # フルデプロイ
#   ./deploy.sh --image-only             # イメージ更新のみ
# ============================================================
set -euo pipefail

# ---------- 設定 ----------
PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
REGION="asia-northeast1"
SERVICE_NAME="yonda"
DOMAIN="yonda.ktrips.net"
REPO_NAME="yonda-repo"
IMAGE_TAG="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/${SERVICE_NAME}:latest"
BUCKET_NAME="${PROJECT_ID}-yonda-data"
DATA_MOUNT="/mnt/data"
SECRETS_MOUNT="/secrets"

echo "============================================"
echo "  yonda Deploy"
echo "  Project : ${PROJECT_ID}"
echo "  Region  : ${REGION}"
echo "  Service : ${SERVICE_NAME}"
echo "  Domain  : ${DOMAIN}"
echo "============================================"
echo ""

# ---------- 1. API を有効化 ----------
echo ">>> 必要な API を有効化..."
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  storage.googleapis.com \
  cloudscheduler.googleapis.com \
  --quiet

# ---------- 2. Artifact Registry リポジトリ作成 ----------
echo ">>> Artifact Registry リポジトリを作成..."
if ! gcloud artifacts repositories describe "${REPO_NAME}" \
     --location="${REGION}" --format='value(name)' 2>/dev/null; then
  gcloud artifacts repositories create "${REPO_NAME}" \
    --repository-format=docker \
    --location="${REGION}" \
    --description="yonda container images"
fi

# ---------- 3. Docker イメージをビルド & プッシュ ----------
echo ">>> Cloud Build でイメージをビルド..."
gcloud builds submit \
  --tag "${IMAGE_TAG}" \
  --timeout=600 \
  .

if [[ "${1:-}" == "--image-only" ]]; then
  echo ">>> イメージ更新のみ — Cloud Run をデプロイ..."
  gcloud run deploy "${SERVICE_NAME}" \
    --image "${IMAGE_TAG}" \
    --region "${REGION}" \
    --quiet
  echo "✔ デプロイ完了"
  exit 0
fi

# ---------- 4. GCS バケット作成 (データ永続化) ----------
echo ">>> GCS バケットを作成..."
if ! gsutil ls -b "gs://${BUCKET_NAME}" 2>/dev/null; then
  gsutil mb -l "${REGION}" "gs://${BUCKET_NAME}"
fi

# 既存データがあればアップロード
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOCAL_DATA_DIR="${SCRIPT_DIR}/data"
if [[ -d "${LOCAL_DATA_DIR}" ]]; then
  echo ">>> 既存データファイルを GCS にアップロード..."
  for f in library_books.json audible_books.json kindle_books.json; do
    if [[ -f "${LOCAL_DATA_DIR}/${f}" ]]; then
      gsutil -q cp "${LOCAL_DATA_DIR}/${f}" "gs://${BUCKET_NAME}/${f}"
      echo "    ✔ ${f}"
    fi
  done
  CREDS_SRC="${LOCAL_DATA_DIR}/.credentials.json"
  [[ -f "${CREDS_SRC}" ]] || CREDS_SRC=".credentials.json"
  [[ -f "${CREDS_SRC}" ]] || CREDS_SRC="${HOME}/.config/yonda/credentials.json"
  if [[ -f "${CREDS_SRC}" ]]; then
    gsutil -q cp "${CREDS_SRC}" "gs://${BUCKET_NAME}/.credentials.json"
    echo "    ✔ .credentials.json"
  fi
fi

# ---------- 5. Secret Manager にシークレットを登録 ----------
echo ">>> Secret Manager にシークレットを登録..."

create_or_update_secret() {
  local name="$1" file="$2"
  if ! gcloud secrets describe "${name}" --format='value(name)' 2>/dev/null; then
    gcloud secrets create "${name}" \
      --replication-policy="automatic"
  fi
  gcloud secrets versions add "${name}" --data-file="${file}" --quiet
  echo "    ✔ ${name}"
}

if [[ -f "auth_jp.json" ]]; then
  create_or_update_secret "yonda-auth-jp" "auth_jp.json"
else
  echo "    ⚠  auth_jp.json が見つかりません（Audible 機能には必要）"
fi

CREDS_FILE="${LOCAL_DATA_DIR}/.credentials.json"
[[ -f "${CREDS_FILE}" ]] || CREDS_FILE=".credentials.json"
[[ -f "${CREDS_FILE}" ]] || CREDS_FILE="${HOME}/.config/yonda/credentials.json"
if [[ -f "${CREDS_FILE}" ]]; then
  create_or_update_secret "yonda-credentials" "${CREDS_FILE}"
else
  echo "    ⚠  .credentials.json が見つかりません（図書館ログインには必要）"
fi

# ---------- 6. サービスアカウントに権限付与 ----------
echo ">>> サービスアカウントに権限を設定..."
PROJECT_NUMBER=$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)' 2>/dev/null)
DEFAULT_COMPUTE_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
SA_EMAIL="${PROJECT_ID}@appspot.gserviceaccount.com"
RUN_SA="${DEFAULT_COMPUTE_SA}"

for role in roles/storage.objectAdmin roles/secretmanager.secretAccessor; do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${RUN_SA}" \
    --role="${role}" \
    --quiet 2>/dev/null || true
done
# シークレットごとに Secret Accessor を明示付与（Cloud Run で必要）
for secret_name in yonda-auth-jp yondapp-auth-jp yonda-credentials; do
  if gcloud secrets describe "${secret_name}" --format='value(name)' 2>/dev/null; then
    gcloud secrets add-iam-policy-binding "${secret_name}" \
      --member="serviceAccount:${RUN_SA}" \
      --role="roles/secretmanager.secretAccessor" \
      --quiet 2>/dev/null || true
    echo "    ✔ ${secret_name} → ${RUN_SA}"
  fi
done
echo "    ✔ ${RUN_SA}"

# ---------- 7. Cloud Run デプロイ ----------
echo ">>> Cloud Run にデプロイ..."

# 使用するシークレット名（yondapp-auth-jp が既存ならそれを使用）
AUTH_SECRET="yonda-auth-jp"
if gcloud secrets describe "yondapp-auth-jp" 2>/dev/null; then
  AUTH_SECRET="yondapp-auth-jp"
fi

# GCS FUSE マウント用の実行環境設定
gcloud run deploy "${SERVICE_NAME}" \
  --image "${IMAGE_TAG}" \
  --region "${REGION}" \
  --platform managed \
  --allow-unauthenticated \
  --port 8080 \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 3 \
  --timeout 300 \
  --execution-environment gen2 \
  --add-volume "name=data-vol,type=cloud-storage,bucket=${BUCKET_NAME}" \
  --add-volume-mount "volume=data-vol,mount-path=${DATA_MOUNT}" \
  --set-secrets "${SECRETS_MOUNT}/auth_jp.json=${AUTH_SECRET}:latest" \
  --update-env-vars "\
YONDA_DATA_DIR=${DATA_MOUNT},\
YONDA_AUTH_FILE=${SECRETS_MOUNT}/auth_jp.json,\
YONDA_CREDS_PATH=${DATA_MOUNT}/.credentials.json" \
  --quiet

SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" \
  --region "${REGION}" --format='value(status.url)')
echo ""
echo "✔ Cloud Run デプロイ完了: ${SERVICE_URL}"

# ---------- 8. カスタムドメイン マッピング ----------
echo ""
echo ">>> カスタムドメインをマッピング..."
if ! gcloud run domain-mappings describe \
     --domain="${DOMAIN}" --region="${REGION}" 2>/dev/null; then
  gcloud run domain-mappings create \
    --service="${SERVICE_NAME}" \
    --domain="${DOMAIN}" \
    --region="${REGION}" \
    --quiet || true
fi

# ---------- 9. Cloud Scheduler 定期取得ジョブ ----------
echo ""
echo ">>> Cloud Scheduler ジョブを設定（6時/12時/18時 JST）..."

FETCH_URL="https://${DOMAIN}/api/fetch"
FETCH_BODY='{"library_id":"all"}'
SCHEDULER_REGION="asia-northeast1"

setup_scheduler_job() {
  local job_name="$1"
  local schedule="$2"
  if gcloud scheduler jobs describe "${job_name}" \
       --location="${SCHEDULER_REGION}" --format='value(name)' 2>/dev/null; then
    gcloud scheduler jobs update http "${job_name}" \
      --location="${SCHEDULER_REGION}" \
      --schedule="${schedule}" \
      --uri="${FETCH_URL}" \
      --message-body="${FETCH_BODY}" \
      --headers="Content-Type=application/json" \
      --time-zone="Asia/Tokyo" \
      --attempt-deadline=540s \
      --quiet
    echo "    ✔ ${job_name} (更新)"
  else
    gcloud scheduler jobs create http "${job_name}" \
      --location="${SCHEDULER_REGION}" \
      --schedule="${schedule}" \
      --uri="${FETCH_URL}" \
      --message-body="${FETCH_BODY}" \
      --headers="Content-Type=application/json" \
      --time-zone="Asia/Tokyo" \
      --attempt-deadline=540s \
      --quiet
    echo "    ✔ ${job_name} (新規作成)"
  fi
}

setup_scheduler_job "yonda-fetch-morning" "0 6 * * *"
setup_scheduler_job "yonda-fetch-noon"    "0 12 * * *"
setup_scheduler_job "yonda-fetch-evening" "0 18 * * *"

echo ""
echo "============================================"
echo "  デプロイ完了!"
echo ""
echo "  Cloud Run URL : ${SERVICE_URL}"
echo "  カスタムドメイン: https://${DOMAIN}"
echo ""
echo "  定期取得スケジュール (JST):"
echo "    朝  06:00  yonda-fetch-morning"
echo "    昼  12:00  yonda-fetch-noon"
echo "    夕  18:00  yonda-fetch-evening"
echo ""
echo "  ★ DNS 設定が必要です:"
echo "    ${DOMAIN} → CNAME → ghs.googlehosted.com."
echo ""
echo "    または gcloud run domain-mappings describe で"
echo "    表示される A/AAAA レコードを設定してください:"
echo ""
echo "    gcloud run domain-mappings describe \\"
echo "      --domain=${DOMAIN} --region=${REGION}"
echo "============================================"
