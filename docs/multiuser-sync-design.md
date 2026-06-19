# Yonda マルチユーザー定期同期 — 設計 & 移行計画

> 対象ユーザー：kenichiyoshida13@gmail.com（唯一の既存ユーザー）

---

## 0. 現状スナップショット

```
/mnt/data/  (GCS マウント)
├── kindle_books.json          ← 既存の本データ（ルート）
├── .credentials.json          ← 図書館 ID/PW（グローバル）
├── kindle_session.json        ← Kindle セッション（グローバル）
└── (audible は Secret Manager /secrets/auth_jp.json)

~/.config/yonda/
└── credentials.json           ← ローカル用（Cloud Run では未使用）

Firestore:
└── users/{uid}                ← 現時点では未作成（未ログイン）

Cloud Scheduler:
└── → POST /api/fetch {"library_id":"all","notify_completed":true}
    ↑ セッションなし → DATA_DIR ルートに書き込み → 現状は動作している
```

**「現在動いている」理由**：まだ OAuth ログインしていないため、データがルートにあり Scheduler もルートを読む。OAuth ログインした瞬間にデータが `users/{uid}/` に移り、Scheduler はルートに書き続ける → **ここで同期が壊れる**。

---

## 1. ゴール

```
kenichiyoshida13@gmail.com が Google ログインして
図書館/Audible の設定を行うと、
以降は Cloud Scheduler が自動的にそのユーザーの本を定期取得する。
```

---

## 2. アーキテクチャ概要

### 変更後のデータレイアウト

```
/mnt/data/
├── .data_migrated             ← 移行完了センチネル（既存）
├── yonda_messages.json        ← コミュニティ共有（グローバルのまま）
└── users/
    └── {uid}/                 ← Google sub をサニタイズした ID
        ├── library_books.json
        ├── audible_books.json
        ├── kindle_books.json
        ├── paper_books.json
        ├── book_insights.json
        ├── amazon_list.json
        ├── credentials.json   ← ★新規：図書館 ID/PW（per-user 化）
        ├── auth_jp.json       ← ★新規：Audible 認証（per-user 化）
        └── kindle_session.json ← ★新規：Kindle セッション（per-user 化）

Firestore:
└── users/{uid}/
    ├── (profile doc)
    │   ├── email, name, picture, created_at, last_login（既存）
    │   └── sources: {setagaya, audible, kindle}  ← ★新規フィールド
    └── books/{book_id}        ← 本データ（既存）
```

---

## 3. 開発設計

### 3-A. `library_service.py` — 認証パスの per-user 化

`CREDS_PATH` はモジュールレベルの定数のため、リクエストごとに動的に解決する関数に置き換える。

```python
# 変更前
CREDS_PATH = get_credentials_path()  # 起動時に1回だけ評価、常にグローバル

# 変更後
def _get_creds_path() -> Path:
    """リクエスト時のユーザーデータディレクトリ内 credentials.json を返す。
    未ログインまたはシングルユーザーモードの場合はグローバルパスにフォールバック。"""
    user_dir = get_user_data_dir()
    if user_dir != DATA_DIR:                    # ユーザーディレクトリが切り替わっている
        p = user_dir / "credentials.json"
        if p.exists():
            return p
        # フォールバック: グローバル（移行期間中の互換性）
    return get_credentials_path()

# save_credentials / _load_all_credentials / delete_credentials の
# CREDS_PATH を _get_creds_path() に置き換える（3 箇所）
```

同様に Kindle セッションパスも per-user 対応：

```python
def get_kindle_session_path_for_user() -> Path:
    user_dir = get_user_data_dir()
    if user_dir != DATA_DIR:
        return user_dir / "kindle_session.json"
    return config_paths.get_kindle_session_path()
```

### 3-B. `adapters/audible.py` — auth_jp.json の per-user 化

```python
def _resolve_auth_file() -> Path:
    # 1. スレッドローカルなユーザーデータディレクトリを最優先
    try:
        from library_service import get_user_data_dir, DATA_DIR
        user_dir = get_user_data_dir()
        if user_dir != DATA_DIR:
            p = user_dir / "auth_jp.json"
            if p.exists():
                return p
    except Exception:
        pass
    # 2. 環境変数（Secret Manager 経由、シングルユーザー互換）
    if os.environ.get("YONDA_AUTH_FILE"):
        p = Path(os.environ["YONDA_AUTH_FILE"])
        if p.exists():
            return p
    # 3. 旧互換パス探索（既存ロジックそのまま）
    for p in [Path.cwd() / "data" / "auth_jp.json", ...]:
        if p.exists():
            return p
    # 4. 保存先デフォルト（存在しない場合もここを返す）
    try:
        from library_service import get_user_data_dir, DATA_DIR
        user_dir = get_user_data_dir()
        if user_dir != DATA_DIR:
            return user_dir / "auth_jp.json"
    except Exception:
        pass
    return Path.cwd() / "data" / "auth_jp.json"
```

### 3-C. `adapters/kindle.py` — セッションパスの per-user 化

```python
@staticmethod
def _get_session_path() -> Path:
    try:
        from library_service import get_kindle_session_path_for_user
        return get_kindle_session_path_for_user()
    except Exception:
        from config_paths import get_kindle_session_path
        return get_kindle_session_path()
```

### 3-D. `app.py` — Audible アップロード先の per-user 化

```python
# /api/credentials/audible_jp/upload の保存先
# 変更前
dest = library_service.DATA_DIR / "auth_jp.json"

# 変更後
dest = library_service.get_user_data_dir() / "auth_jp.json"
```

### 3-E. `app.py` — 設定保存時に Firestore sources フラグを更新

```python
# /api/credentials POST の末尾に追加
uid = library_service.get_current_uid()
if uid:
    try:
        import firestore_service
        source_key = {"setagaya": "setagaya", "audible_jp": "audible"}.get(library_id, library_id)
        firestore_service.update_user_sources(uid, source_key, True)
    except Exception:
        pass

# /api/credentials/{library_id} DELETE の末尾に追加
uid = library_service.get_current_uid()
if uid:
    try:
        import firestore_service
        source_key = {"setagaya": "setagaya", "audible_jp": "audible"}.get(library_id, library_id)
        firestore_service.update_user_sources(uid, source_key, False)
    except Exception:
        pass
```

### 3-F. `firestore_service.py` — 新規関数

```python
def update_user_sources(uid: str, source: str, enabled: bool) -> None:
    """sources フラグを更新。認証設定/削除時に呼ぶ。"""
    db = get_db()
    if not db:
        return
    try:
        db.collection("users").document(uid).set(
            {"sources": {source: enabled}},
            merge=True
        )
    except Exception as e:
        logger.error("sources フラグ更新エラー: %s", e)


def list_sync_users() -> list[dict]:
    """sources が1つ以上 true のユーザーを返す（同期ループ用・軽量版）。"""
    db = get_db()
    if not db:
        return []
    try:
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
    except Exception as e:
        logger.error("同期ユーザー一覧取得エラー: %s", e)
        return []


def get_user_profile(uid: str) -> dict | None:
    """1ユーザーのプロフィールを返す（メッセージ生成用）。"""
    db = get_db()
    if not db:
        return None
    try:
        doc = db.collection("users").document(uid).get()
        if doc.exists:
            d = doc.to_dict() or {}
            return {
                "name":    d.get("name", ""),
                "email":   d.get("email", ""),
                "picture": d.get("picture", ""),
            }
    except Exception:
        pass
    return None
```

### 3-G. `app.py` — 新エンドポイント `/api/internal/auto-fetch-all`

```python
@app.route("/api/internal/auto-fetch-all", methods=["POST"])
def api_internal_auto_fetch_all():
    """Cloud Scheduler から呼ばれる。Firestore の全同期対象ユーザーを順次 fetch する。"""
    token = request.headers.get("X-Internal-Token", "")
    if not _INTERNAL_TOKEN or not hmac.compare_digest(token, _INTERNAL_TOKEN):
        logger.warning("auto-fetch-all: 認証失敗 (IP=%s)", request.remote_addr)
        return jsonify({"error": "unauthorized"}), 401

    import firestore_service as fs
    users = fs.list_sync_users()
    if not users:
        return jsonify({"status": "ok", "users": 0, "message": "同期対象ユーザーなし"})

    all_results = {}
    source_map = {"setagaya": "setagaya", "audible": "audible_jp", "kindle": "kindle"}

    for u in users:
        uid      = u["uid"]
        sources  = u["sources"]
        user_dir = library_service.DATA_DIR / "users" / uid
        if not user_dir.exists():
            logger.warning("auto-fetch-all: uid=%s のデータディレクトリなし、スキップ", uid)
            continue

        library_service.set_user_data_dir(user_dir)

        results, errors = {}, {}
        prev_payloads, curr_payloads = {}, {}

        for src_key, enabled in sources.items():
            if not enabled:
                continue
            lib_id = source_map.get(src_key, src_key)
            try:
                prev_payloads[lib_id] = library_service.load_saved_for(lib_id)
                payload = library_service.fetch_and_save(lib_id)
                curr_payloads[lib_id] = payload
                results[src_key] = {"total": payload.get("total", 0)}
                logger.info("auto-fetch-all: uid=%s source=%s 完了 (%d冊)",
                            uid, src_key, payload.get("total", 0))
            except Exception as e:
                logger.error("auto-fetch-all: uid=%s source=%s エラー: %s", uid, src_key, e)
                errors[src_key] = str(e)

        # 新規読了メッセージ生成
        if curr_payloads:
            try:
                profile = fs.get_user_profile(uid)
                message = _create_completed_books_message(prev_payloads, curr_payloads, errors)
                if message and profile:
                    message["user"] = profile
                    library_service.update_yonda_message(message)
            except Exception as e:
                logger.error("auto-fetch-all: uid=%s メッセージ生成エラー: %s", uid, e)

        all_results[uid] = {"results": results, "errors": errors}

    # スレッドローカルをルートに戻す
    library_service.set_user_data_dir(library_service.DATA_DIR)

    logger.info("auto-fetch-all 完了: %d ユーザー処理", len(all_results))
    return jsonify({"status": "ok", "users": len(all_results), "results": all_results})
```

### 3-H. `app.py` — `_migrate_root_data_to_user()` に認証ファイルと sources 初期設定を追加

```python
def _migrate_root_data_to_user(uid_safe: str) -> None:
    # ...（既存ロジックはそのまま）...

    # ★ 追加: 認証ファイルもユーザーディレクトリにコピー
    cred_files = {
        ".credentials.json": "credentials.json",
        "kindle_session.json": "kindle_session.json",
        "auth_jp.json": "auth_jp.json",
    }
    for src_name, dst_name in cred_files.items():
        src = library_service.DATA_DIR / src_name
        dst = user_dir / dst_name
        if src.exists() and not dst.exists():
            shutil.copy2(src, dst)
            dst.chmod(0o600)
            logger.info("認証ファイル移行: %s → %s", src_name, dst_name)

    # Secret Manager の auth_jp.json も考慮
    secrets_auth = Path("/secrets/auth_jp.json")
    user_auth = user_dir / "auth_jp.json"
    if secrets_auth.exists() and not user_auth.exists():
        shutil.copy2(secrets_auth, user_auth)
        user_auth.chmod(0o600)
        logger.info("Secret Manager の auth_jp.json をユーザーディレクトリにコピー")

    # ★ 追加: sources フラグの初期設定（移行時のみ）
    sources = {}
    if (user_dir / "credentials.json").exists():
        try:
            creds = json.loads((user_dir / "credentials.json").read_text())
            if creds.get("setagaya", {}).get("user_id"):
                sources["setagaya"] = True
        except Exception:
            pass
    if (user_dir / "auth_jp.json").exists():
        sources["audible"] = True
    if (user_dir / "kindle_session.json").exists():
        sources["kindle"] = True
    if sources:
        try:
            import firestore_service
            for src, enabled in sources.items():
                firestore_service.update_user_sources(uid_safe, src, enabled)
            logger.info("sources フラグ初期設定: uid=%s sources=%s", uid_safe, sources)
        except Exception as e:
            logger.warning("sources フラグ設定エラー: %s", e)
```

### 3-I. `deploy.sh` — Scheduler と環境変数の更新

```bash
# ── 環境変数に追加 ──
--update-env-vars "\
YONDA_DATA_DIR=${DATA_MOUNT},\
YONDA_AUTH_FILE=${SECRETS_MOUNT}/auth_jp.json,\
YONDA_CREDS_PATH=${DATA_MOUNT}/.credentials.json,\
YONDA_KINDLE_SESSION_PATH=${DATA_MOUNT}/kindle_session.json,\
YONDA_AI_CONFIG_PATH=${DATA_MOUNT}/ai_config.json,\
YONDA_INTERNAL_TOKEN=${YONDA_INTERNAL_TOKEN}"    # ★追加

# ── Cloud Scheduler の URL と認証ヘッダーを変更 ──
# 変更前
FETCH_URL="${SERVICE_URL}/api/fetch"
FETCH_BODY='{"library_id":"all","notify_completed":true}'

# 変更後
FETCH_URL="${SERVICE_URL}/api/internal/auto-fetch-all"
FETCH_BODY='{}'
# setup_scheduler_job の --update-headers / --headers に X-Internal-Token を追加
```

### 3-J. GitHub Actions — Secret 追加

```yaml
# .github/workflows/yonda-deploy.yml
# GitHub Secrets に YONDA_INTERNAL_TOKEN を追加してから:
--update-env-vars "...,YONDA_INTERNAL_TOKEN=${{ secrets.YONDA_INTERNAL_TOKEN }}"
```

---

## 4. 移行プラン（kenichiyoshida13@gmail.com）

### フェーズ構成

```
Phase 0  現状確認・準備        [事前作業、本番影響なし]
Phase 1  コード開発・テスト    [ローカル or ステージング]
Phase 2  デプロイ             [本番、ダウンタイム < 1分]
Phase 3  初回ログイン移行      [ユーザー操作 1回]
Phase 4  sources フラグ設定   [自動（移行コードで処理）]
Phase 5  動作確認             [Scheduler テスト実行]
```

---

### Phase 0: 現状確認・準備

```bash
# GCS のデータ確認
gsutil ls gs://airgo-trip-yonda-data/
gsutil ls gs://airgo-trip-yonda-data/users/ 2>/dev/null  # まだないはず

# YONDA_INTERNAL_TOKEN を生成して GitHub Secrets に登録
openssl rand -hex 32
# → GitHub リポジトリ Settings → Secrets → Actions → YONDA_INTERNAL_TOKEN に登録
```

**確認チェックリスト:**
- [ ] GCS に `library_books.json`, `kindle_books.json` 等が存在する
- [ ] `users/` ディレクトリは存在しない（未ログイン）
- [ ] Firestore に `users/{uid}` ドキュメントがない（未ログイン）
- [ ] `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` が Secrets 登録済み
- [ ] `YONDA_INTERNAL_TOKEN` を生成して Secrets に登録済み

---

### Phase 1: コード開発

開発順序（依存関係順）:

| 順番 | ファイル | 変更内容 |
|------|----------|----------|
| 1 | `firestore_service.py` | `update_user_sources()`, `list_sync_users()`, `get_user_profile()` を追加 |
| 2 | `library_service.py` | `_get_creds_path()` 関数化、`get_kindle_session_path_for_user()` 追加 |
| 3 | `adapters/audible.py` | `_resolve_auth_file()` に per-user パスを最優先追加 |
| 4 | `adapters/kindle.py` | `_get_session_path()` を per-user 対応に |
| 5 | `app.py` | `_migrate_root_data_to_user()` 拡張、credentials エンドポイント更新、`/api/internal/auto-fetch-all` 追加 |
| 6 | `deploy.sh` | `YONDA_INTERNAL_TOKEN` 追加、Scheduler URL/headers 変更 |
| 7 | `yonda-deploy.yml` | `YONDA_INTERNAL_TOKEN` 追加 |

**ローカルテスト:**

```bash
export YONDA_INTERNAL_TOKEN="test-token-local"
python -m app

# 別ターミナルで確認
curl -X POST http://localhost:5002/api/internal/auto-fetch-all \
  -H "Content-Type: application/json" \
  -H "X-Internal-Token: test-token-local" \
  -d '{}'
# → {"status":"ok","users":0,"message":"同期対象ユーザーなし"}  ← Firestore 未設定なら OK

# 認証なしで 401 になることを確認
curl -X POST http://localhost:5002/api/internal/auto-fetch-all \
  -H "Content-Type: application/json" -d '{}'
# → {"error":"unauthorized"}
```

---

### Phase 2: デプロイ

```bash
# GitHub Actions 経由（推奨）
git push origin main

# またはローカルから
./deploy.sh
```

**デプロイ後の確認:**

```bash
# Scheduler の URL が更新されているか
gcloud scheduler jobs describe yonda-fetch-morning \
  --location=asia-northeast1 \
  --format='value(httpTarget.uri)'
# → https://yonda.ktrips.net/api/internal/auto-fetch-all  ✓

# トークンなしで 401 になるか
curl -X POST https://yonda.ktrips.net/api/internal/auto-fetch-all \
  -H "Content-Type: application/json" -d '{}'
# → {"error":"unauthorized"}  ✓
```

---

### Phase 3: 初回ログイン移行（ユーザー操作）

ブラウザで `https://yonda.ktrips.net` を開き **「Google でログイン」** をクリック。

このタイミングで `auth_callback()` → `_migrate_root_data_to_user(uid_safe)` が実行される。

**移行される内容（自動）:**

| 移行元（GCS ルート） | 移行先 | 備考 |
|---|---|---|
| `library_books.json` | `users/{uid}/library_books.json` | 既存ロジック |
| `audible_books.json` | `users/{uid}/audible_books.json` | 既存ロジック |
| `kindle_books.json` | `users/{uid}/kindle_books.json` | 既存ロジック |
| `paper_books.json` | `users/{uid}/paper_books.json` | 既存ロジック |
| `book_insights.json` | `users/{uid}/book_insights.json` | 既存ロジック |
| `amazon_list.json` | `users/{uid}/amazon_list.json` | 既存ロジック |
| `.credentials.json` | `users/{uid}/credentials.json` | ★追加 |
| `kindle_session.json` | `users/{uid}/kindle_session.json` | ★追加 |
| `/secrets/auth_jp.json` | `users/{uid}/auth_jp.json` | ★追加 |

また Firestore に `users/{uid}` プロフィールが作成され、`sources` フラグが自動設定される。

**ログイン後の確認:**

```bash
# GCS にユーザーディレクトリが作成されたか
gsutil ls gs://airgo-trip-yonda-data/users/
# → gs://airgo-trip-yonda-data/users/{uid}/

gsutil ls gs://airgo-trip-yonda-data/users/{uid}/
# → credentials.json, kindle_books.json, auth_jp.json, ...
```

---

### Phase 4: sources フラグ確認

ログイン時の移行コードが自動的に `sources` フラグを Firestore に設定する。

Firebase Console または Admin SDK で確認：

```
Firestore → users → {uid}
{
  email: "kenichiyoshida13@gmail.com",
  sources: {
    setagaya: true,   ← 図書館認証があれば
    audible:  true,   ← auth_jp.json があれば
    kindle:   true    ← kindle_session.json があれば
  }
}
```

フラグが正しくセットされていない場合は、アプリの設定画面で各ソースの認証を一度保存し直すと更新される。

---

### Phase 5: 動作確認

```bash
# auto-fetch-all を手動テスト
curl -X POST https://yonda.ktrips.net/api/internal/auto-fetch-all \
  -H "Content-Type: application/json" \
  -H "X-Internal-Token: ${YONDA_INTERNAL_TOKEN}" \
  -d '{}'
# → {"status":"ok","users":1,"results":{"{uid}":{"results":{"setagaya":{"total":N},...}}}}

# Cloud Scheduler を手動トリガー
gcloud scheduler jobs run yonda-fetch-morning --location=asia-northeast1

# Cloud Run のログで確認
gcloud logging read \
  'resource.type="cloud_run_revision" AND textPayload:"auto-fetch-all"' \
  --limit=20 --format="value(textPayload)"
```

**成功の確認基準:**

| チェック項目 | 期待値 |
|---|---|
| `/api/internal/auto-fetch-all` レスポンス | `{"status":"ok","users":1,...}` |
| Cloud Run ログ | `auto-fetch-all 完了: 1 ユーザー処理` |
| GCS `users/{uid}/library_books.json` の更新日時 | Scheduler 実行後に更新されている |
| Firestore `users/{uid}/books/` | 新規読了があれば追加されている |
| `yonda_messages.json` | 新規読了があれば追記されている |

---

## 5. ロールバックプラン

万一 Phase 2〜3 で問題が発生した場合：

```bash
# Cloud Scheduler を旧エンドポイントに戻す
gcloud scheduler jobs update http yonda-fetch-morning \
  --location=asia-northeast1 \
  --uri="https://yonda.ktrips.net/api/fetch" \
  --message-body='{"library_id":"all","notify_completed":true}' \
  --update-headers="Content-Type=application/json"

# 同様に yonda-fetch-noon, yonda-fetch-evening も更新
```

GCS のデータはコピー（元ファイルは削除されない）のため、ロールバック後もルートのデータは残っている。

---

## 6. 作業サマリー

| フェーズ | 作業者 | 所要時間 | 本番影響 |
|---|---|---|---|
| Phase 0 準備 | 開発者 | 30分 | なし |
| Phase 1 開発 | 開発者 | 2〜3時間 | なし |
| Phase 2 デプロイ | 自動（GitHub Actions） | 10分 | ダウンタイム < 1分 |
| Phase 3 初回ログイン | kenichiyoshida13@gmail.com | 1分 | なし |
| Phase 4 sources 確認 | 自動（移行コード） | 即時 | なし |
| Phase 5 動作確認 | 開発者 | 15分 | なし |

---

## 7. 注意事項

**Phase 3 のタイミングについて**

ログイン前は Cloud Scheduler が引き続きルート (`/mnt/data/`) に書き込む。ログイン後はユーザーディレクトリ (`users/{uid}/`) に書き込まれるため、**「当日の Scheduler 最終実行後にログインする」** のが理想。ただし、ログイン後に手動で「今すぐ取込み」を実行すれば即座に最新データが取得できる。

**2人目のユーザーが増える場合**

`.data_migrated` センチネルが作成済みのため、2人目以降は空のディレクトリから開始する（既存データは引き継がれない）。2人目のユーザーはアプリ内で各ソースの認証を設定する必要がある。
