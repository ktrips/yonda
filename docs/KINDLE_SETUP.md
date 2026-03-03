# Kindle 読書情報の取得方法（詳細ガイド）

yonda で Kindle の蔵書・読書情報を取得する手順を説明します。

---

## 前提条件

- **Kindle for Mac** または **Kindle for PC** がインストールされていること
- Amazon アカウントで Kindle アプリにログイン済みであること
- 蔵書情報が一度でも同期されていること

---

## 1. Kindle アプリの準備

### 1-1. Kindle for Mac をインストール

1. [Amazon の Kindle for Mac のページ](https://www.amazon.co.jp/kindle-dbs/fd/kcp) からダウンロード
2. インストール後、アプリを起動
3. Amazon アカウントでログイン
4. アプリを起動したまま、しばらく待って蔵書情報を同期させる

### 1-2. データファイルの確認

Kindle アプリは蔵書情報をローカルファイルに保存します。バージョンによって形式が異なります。

| 形式 | 対象 | ファイル |
|------|------|----------|
| **SQLite** | 2024年以降の Kindle for Mac | `BookData.sqlite` |
| **SQLite** | yonda データディレクトリに配置した場合 | `yonda/data/BookData.sqlite` |
| **XML** | 従来の Kindle for PC/Mac | `KindleSyncMetadataCache.xml` |

---

## 2. データファイルの場所を確認する

### Mac の場合

ターミナルで以下のコマンドを実行し、ファイルが存在するか確認します。

```bash
# SQLite（2024年以降の Kindle for Mac）
ls -la ~/Library/Containers/com.amazon.Lassen/Data/Library/Protected/BookData.sqlite

# または別のパス
ls -la ~/Library/Containers/Kindle/Data/Library/Protected/Protected/BookData.sqlite
ls -la ~/Library/Containers/com.amazon.Kindle/Data/Library/Protected/BookData.sqlite

# XML（従来の Kindle for Mac）
ls -la ~/Library/Containers/com.amazon.Kindle/Data/Library/Application\ Support/Kindle/Cache/KindleSyncMetadataCache.xml
ls -la ~/Library/Application\ Support/Kindle/Cache/KindleSyncMetadataCache.xml
```

### Windows の場合

```
C:\Users\{ユーザー名}\AppData\Local\Amazon\Kindle\Cache\KindleSyncMetadataCache.xml
```

### ファイルが見つからない場合

1. Finder で `~/Library/Containers/` を開く（ターミナルで `open ~/Library/Containers/`）
2. `com.amazon.Lassen` または `com.amazon.Kindle` フォルダを探す
3. その中を `Data/Library/Protected/` までたどる
4. `BookData.sqlite` を探す

---

## 3. yonda で Kindle を取得する

### 3-1. アプリを起動

```bash
cd /path/to/ObsidianGit/yonda
python -m app
```

ブラウザで `http://127.0.0.1:5002` を開く（ポート番号は表示に従う）。

### 3-2. 読書記録を取得

1. メニュー（ハンバーガーアイコン）を開く
2. **ソース** で「Kindle」を選択
3. **「読書記録を取得」** ボタンをクリック

### 3-3. 2段階認証（OTP）が有効な場合

Amazon で 2段階認証を有効にしている場合、「読書記録を取得」実行後に OTP 入力画面が表示されます。

1. メールまたは認証アプリに届いた 6桁のコードを入力
2. **「OTP を送信して取得」** をクリック
3. 認証が成功すると蔵書が取得されます

### 3-4. API 失敗時の自動フォールバック

認証情報を登録した状態で、Kindle for Mac を起動して蔵書を同期しておくと、Amazon API が失敗した場合でも自動でローカルファイル（`BookData.sqlite`）から取得されます。認証情報を削除する必要はありません。

---

## 4. FIONA API で取得（CLI スクリプト）

ユーザー名・パスワードで Amazon にログインし、FIONA API から蔵書を取得する CLI スクリプトがあります。ローカルファイル（Kindle アプリ）が不要なため、クラウド環境や cron での定期取得に適しています。

```bash
# 環境変数で認証情報を指定
export YONDA_KINDLE_EMAIL="your@email.com"
export YONDA_KINDLE_PASSWORD="your_password"
python scripts/fetch_kindle_fiona.py

# アカウント設定で登録済みの認証情報を使用
python scripts/fetch_kindle_fiona.py

# 2段階認証（OTP）が有効な場合、プロンプトでコードを入力
```

2段階認証が有効な場合、プロンプトで OTP の入力が促されます。メールまたは認証アプリに届いた 6桁のコードを入力してください。

オプション:

| オプション | 説明 |
|------------|------|
| `--email` | Amazon メールアドレス |
| `--password` | Amazon パスワード |
| `-o`, `--output` | 出力JSONファイル（省略時は kindle_books.json に保存） |

---

## 5. 取得できない場合の対処

### 5-1. 環境変数でパスを指定する

データファイルが自動検出されない場合、パスを環境変数で指定します。

```bash
# SQLite の場合（2024年以降の Kindle for Mac）
export YONDA_KINDLE_SQLITE_PATH="$HOME/Library/Containers/com.amazon.Lassen/Data/Library/Protected/BookData.sqlite"
python -m app

# XML の場合（従来の Kindle）
export YONDA_KINDLE_XML_PATH="$HOME/Library/Containers/com.amazon.Kindle/Data/Library/Application Support/Kindle/Cache/KindleSyncMetadataCache.xml"
python -m app
```

### 5-2. アプリを起動してから取得する

Kindle アプリは起動時にデータファイルを更新します。

1. **Kindle for Mac** を起動
2. アプリが完全に起動するまで待つ
3. yonda で「読書記録を取得」を実行

### 5-3. アカウント設定で接続確認

1. メニュー → **「アカウント設定」**
2. ソースで「Kindle」を選択
3. **「接続確認」** ボタンをクリック

「データファイルが検出されました」と表示されれば、パスは正しく見つかっています。

---

## 6. 取得したデータの保存場所

取得した読書記録は以下のファイルに保存されます。

```
yonda/data/kindle_books.json
```

Markdown 形式でも出力されます。

```
yonda/data/Kindle.md
```

---

## 7. 蔵書の取得方法（「取得した蔵書がありません」の場合）

FIONA API で 0 件の場合、**Kindle for Mac のローカルファイル**から取得する方法が確実です。

### 手順

1. **Kindle for Mac をインストール**
   - [ダウンロード](https://www.amazon.co.jp/kindle-dbs/fd/kcp)

2. **アプリを起動して Amazon にログイン**

3. **蔵書を同期**
   - アプリを起動したまま **5〜10分ほど待つ**
   - 画面上で本の一覧が表示されるまで待つ
   - 初回は同期に時間がかかることがあります

4. **再度取得を実行**
   - yonda の「読書記録を取得」または `python scripts/fetch_kindle_fiona.py`
   - ローカルファイル（BookData.sqlite）が自動検出され、そこから取得されます

### データファイルの場所（Mac）

```bash
# 2024年以降の Kindle for Mac
~/Library/Containers/com.amazon.Lassen/Data/Library/Protected/BookData.sqlite

# 別のパス
~/Library/Containers/Kindle/Data/Library/Protected/Protected/BookData.sqlite
~/Library/Containers/com.amazon.Kindle/Data/Library/Protected/BookData.sqlite
```

パスがわからない場合: `find ~/Library -name "BookData.sqlite" 2>/dev/null`

---

## 8. トラブルシューティング

| 問題 | 対処 |
|------|------|
| 「データファイルが見つかりません」 | Kindle アプリを起動して同期する。環境変数でパスを指定する |
| 「読書記録が取得できませんでした」 | Kindle アプリを起動して蔵書を同期した後、再度取得する |
| 「取得した蔵書がありません」 | 上記「7. 蔵書の取得方法」を参照。Kindle for Mac で蔵書を同期する |
| 「Amazon から Kindle 蔵書を取得できませんでした」 | Kindle for Mac を起動して蔵書を同期しておけば、自動でローカルファイルから取得される |
| OTP を入力してもエラーになる | Kindle for Mac を起動して同期しておけばローカルファイルに自動フォールバックされる |
| 0 冊と表示される | 購入日が記録されている書籍のみ取得対象。サンプル・試読本は含まれない場合がある |
| パスがわからない | ターミナルで `find ~/Library -name "BookData.sqlite" 2>/dev/null` を実行して検索 |

---

## 9. 参考リンク

- [Kindle 蔵書一覧を取得する方法（Qiita）](https://qiita.com/taka_hira/items/8a9181c0733de2c9f8ee)
- [Kindle購入書籍をCSVで保存する（Zenn）](https://zenn.dev/ktanoooo/articles/d2dd1fc3f14029)
- [Mac版Kindleの蔵書情報をPythonで読む（note）](https://note.com/abay_ksg/n/ne345750a61d7)
