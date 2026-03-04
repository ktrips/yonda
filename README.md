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
- **読書グラフ**: 月別・ジャンル別の読了数チャート
- **統計**: 読了数、今年の読了数、お気に入り数
- **評価・お気に入り**: 本ごとに★評価とお気に入り登録（Audible はカタログ評価を表示）
- **表紙・概要**: Open Library / Google Books API で自動取得
- **Yonda オススメ**: 読了本の傾向から未読本を AI で 5 冊推薦

### Yomu（何読む？）— 読みたい本検索

- **価格比較検索**: タイトル・著者で検索し、Amazon（Kindle/Audible）、メルカリ、ブックオフ、図書館の在庫・価格を一覧表示
- **写真から検索**: 本の表紙を撮影すると、AI（OpenAI/Gemini）またはバーコード（ISBN）・OCR で本の情報を自動抽出して検索

### Oshi（AI推し）— AI による本の提案

- **フォーム入力**: 性別、年代、職業、読書頻度、ジャンルをスライダーで選択（学生〜悠々、月４冊以上〜読まない、ノンフィクション〜ファンタジー・SF など）
- **会話型提案**: AI が質問しながらあなたに合った本を提案
- **提案内容**: 選んだ理由、本の紹介、レビュー、Amazon リンク

### その他

- **ISBN 検索**: Open Library API で ISBN から書籍情報を取得（CORS 回避用プロキシ）
- **アフィリエイトタグ**: Kindle・Audible リンクにタグを付与可能

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
| Audible Japan | `audible-cli` で認証し `auth_jp.json` を配置 |
| Kindle | Amazon メール・パスワード、またはローカルファイル（BookData.sqlite） |

## Kindle の取得方法

1. **Amazon ログイン**: 認証情報を登録し、2段階認証（OTP）が必要な場合は取得時に OTP を入力
2. **ローカルファイル**: Kindle for Mac を起動して蔵書を同期し、認証なしで取得
3. **フォールバック**: 認証 + ローカルファイルを用意しておくと、API 失敗時に自動でローカルから取得

詳細は [docs/KINDLE_SETUP.md](docs/KINDLE_SETUP.md) を参照。

## データの保存先

| ファイル | ソース |
|----------|--------|
| `library_books.json` | 図書館 |
| `audible_books.json` | Audible |
| `kindle_books.json` | Kindle |
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
| `YONDA_DATA_DIR` | データ保存先ディレクトリ |
| `YONDA_CONFIG_DIR` | 認証・設定ファイルのディレクトリ（デフォルト: `~/.config/yonda`） |
| `YONDA_AI_CONFIG_PATH` | AI 設定ファイルのパス |
| `YONDA_CREDS_PATH` | 図書館認証ファイルのパス |
| `YONDA_AUTH_FILE` | Audible 認証ファイル（auth_jp.json）のパス |
| `YONDA_KINDLE_SQLITE_PATH` | Kindle BookData.sqlite のパス（任意） |
| `YONDA_KINDLE_XML_PATH` | KindleSyncMetadataCache.xml のパス（任意） |

## デプロイ

Google Cloud Run へのデプロイ方法は 2 通りあります。

| 方法 | 説明 |
|------|------|
| **deploy.sh** | ローカルから `./deploy.sh` でフルデプロイ、`./deploy.sh --image-only` でイメージ更新のみ |
| **GitHub Actions** | `main` への push で自動デプロイ。手動実行で「イメージ更新のみ」も選択可能 |

詳細は [DEPLOY.md](DEPLOY.md) を参照。`yonda.ktrips.net` としてホスティング可能。

### GitHub Actions セットアップ（初回のみ）

GitHub Actions でデプロイするには、以下を設定してください。

**1. ワークフロー配置**

- ワークフローは **リポジトリルート** の `.github/workflows/` に配置する必要があります
- `yonda-deploy.yml` が `Git/.github/workflows/` にあることを確認

**2. GitHub Secrets の登録**

リポジトリ → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

| Secret 名 | 値 | 必須 |
|-----------|-----|------|
| `GCP_PROJECT_ID` | GCP プロジェクト ID | ✅ |
| `GCP_SA_KEY` | サービスアカウント JSON の全文 | ✅ |
| `AUTH_JP_JSON` | `auth_jp.json` の内容（`data/auth_jp.json` または `auth_jp.json`） | ✅（Audible 利用時） |
| `CREDENTIALS_JSON` | `.credentials.json` の内容（`data/.credentials.json`） | 任意（図書館利用時） |

**3. 認証ファイルの取得例**

```bash
# Audible 認証（auth_jp.json）
cat data/auth_jp.json
# または yonda 直下にある場合
cat auth_jp.json

# 図書館認証（.credentials.json）
cat data/.credentials.json
```

**4. サービスアカウントの権限**

`GCP_SA_KEY` のサービスアカウントに以下のロールを付与してください。

- Cloud Run 管理者
- Artifact Registry 作成者
- サービス アカウント ユーザー
- Secret Manager 管理者
- Storage オブジェクト管理者

**5. 実行方法**

- **自動**: `main` ブランチの `yonda/` に push すると自動デプロイ
- **手動**: Actions タブ → "Deploy yonda to Cloud Run" → Run workflow
