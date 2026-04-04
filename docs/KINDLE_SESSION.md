# Kindle セッション永続化機能

Amazon ログインのセッションクッキーを保存・再利用することで、OTP（2段階認証）の入力頻度を大幅に削減します。

## 機能概要

- **初回ログイン後、セッションが自動保存される**（有効期限: 7日間）
- **次回以降は保存済みセッションを自動再利用**（OTP入力不要）
- **セッション無効時のみ再ログイン**（自動検出）
- **Cloud Run 環境でも動作**（GCSバケットに保存）

## セッション保存先

### ローカル環境
```
~/.config/yonda/kindle_session.json
```

### Cloud Run 環境
```
/mnt/data/kindle_session.json (GCS バケットにマウント)
```

環境変数 `YONDA_KINDLE_SESSION_PATH` で変更可能。

## セッションの構造

```json
{
  "cookies": {
    "session-id": "xxx",
    "ubid-acbjp": "xxx",
    ...
  },
  "expiry": "2026-04-11T12:00:00",
  "saved_at": "2026-04-04T12:00:00"
}
```

## 使い方

### 1. 通常の取得フロー（自動）

```python
# library_service.fetch_and_save("kindle") を呼ぶだけ
# セッション管理は自動で行われる

# 1回目: ログイン → データ取得 → セッション保存
# 2回目以降: セッション読み込み → 検証 → データ取得（OTPなし）
```

### 2. セッション管理スクリプト

セッション状態の確認や削除を行うスクリプトが用意されています。

```bash
# セッション状態を確認
python scripts/kindle_session_manager.py status

# セッションの有効性を検証
python scripts/kindle_session_manager.py verify

# セッションを削除（再ログインが必要になる）
python scripts/kindle_session_manager.py clear
```

### 出力例

```bash
$ python scripts/kindle_session_manager.py status
セッションファイル: /Users/xxx/.config/yonda/kindle_session.json
✅ セッションファイルが存在します
   保存日時: 2026-04-04T12:00:00
   有効期限: 2026-04-11T12:00:00
   クッキー数: 15
   ✅ 有効（残り7日）
```

## 動作フロー

### 初回ログイン時

1. ユーザーが Amazon メール・パスワードを入力
2. OTP が必要な場合は OTP 入力
3. ログイン成功 → データ取得
4. **セッションクッキーを自動保存**（有効期限7日）

### 2回目以降の取得

1. 保存済みセッションを読み込み
2. セッションの有効性を検証（FIONA 管理ページにアクセス）
3. **有効な場合**: そのまま使用（OTP不要）
4. **無効な場合**: 再ログイン → 新しいセッションを保存

### Cloud Scheduler による定期取得

```
06:00 JST → セッション読み込み → 検証 → データ取得
12:00 JST → セッション読み込み → 検証 → データ取得
18:00 JST → セッション読み込み → 検証 → データ取得
```

セッションが有効な限り、OTP なしで自動取得が継続されます。

## セッション有効期限

デフォルト: **7日間**

変更する場合は `adapters/kindle.py` の定数を編集:

```python
class KindleAdapter(LibraryAdapter):
    SESSION_EXPIRY_DAYS = 7  # ← この値を変更
```

## セキュリティ

- セッションファイルは **0o600** のパーミッションで保護
- `~/.config/yonda/` は **0o700** で作成
- Cloud Run 環境では GCS バケット（プライベート）に保存
- セッションクッキーには個人情報が含まれる可能性があるため、取り扱いに注意

## トラブルシューティング

### セッションが保存されない

1. ログを確認:
   ```bash
   python -m app  # ログ出力を確認
   ```

2. 保存先ディレクトリの権限を確認:
   ```bash
   ls -la ~/.config/yonda/
   ```

3. 環境変数を確認:
   ```bash
   echo $YONDA_KINDLE_SESSION_PATH
   ```

### セッションがすぐに無効になる

Amazon のセキュリティ設定により、以下の場合にセッションが無効化されることがあります:

- 異なる IP アドレスからのアクセス
- 長期間未使用（7日以上）
- Amazon 側でセッションをリセット

この場合は再ログイン（OTP 入力）が必要です。

### Cloud Run でセッションが共有されない

環境変数が正しく設定されているか確認:

```bash
gcloud run services describe yonda \
  --region asia-northeast1 \
  --format='value(spec.template.spec.containers[0].env)'
```

`YONDA_KINDLE_SESSION_PATH=/mnt/data/kindle_session.json` が設定されていることを確認してください。

## API リファレンス

### KindleAdapter.save_session(session)

セッションクッキーを保存します。

```python
adapter = KindleAdapter()
session = requests.Session()
# ... ログイン処理 ...
adapter.save_session(session)
```

### KindleAdapter.load_session(session)

保存済みセッションを読み込みます。

```python
adapter = KindleAdapter()
session = requests.Session()
loaded = adapter.load_session(session)
if loaded:
    print("セッション読み込み成功")
```

戻り値:
- `True`: 読み込み成功（有効期限内）
- `False`: 読み込み失敗（ファイルなし or 期限切れ）

### KindleAdapter.verify_session(session)

セッションの有効性を検証します。

```python
adapter = KindleAdapter()
session = requests.Session()
adapter.load_session(session)
valid = adapter.verify_session(session)
if valid:
    print("セッションは有効")
```

戻り値:
- `True`: 有効（Amazon にログイン済み）
- `False`: 無効（再ログイン必要）

### KindleAdapter.clear_session()

保存済みセッションを削除します。

```python
adapter = KindleAdapter()
adapter.clear_session()
```

## まとめ

セッション永続化機能により、**初回 OTP 認証後は最大7日間、OTP なしで自動取得が可能**になります。Cloud Run 環境での定期自動取得も、この機能によりほぼ完全に自動化されます。
