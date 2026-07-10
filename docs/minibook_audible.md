# Audible の読書記録を Python で全自動取得する

> Cursor + Claude 個人開発ミニシリーズ ①
> 非公式 API・認証ファイル・読了判定・レート制限まで — Audible 連携だけを深掘りする一冊

---

## はじめに

このミニ書籍は、読書記録アプリ **yonda**（Audible・Kindle・図書館・紙の本を一元管理する Web アプリ）の中から、**Audible 連携の部分だけ** を抜き出して深掘りするものです。

「Audible で聴いた本を、自分のアプリやスクリプトに自動で取り込みたい」— この一点に絞って、認証・取得・読了判定・レート制限・マルチユーザーまでを実装レベルで解説します。読書記録アプリを丸ごと作る本編（『Cursor + Claude Fable 5 で Amazon 連携アプリを週末だけで開発して収益化する方法』）の副読本として、あるいは Audible 連携だけが必要な人の逆引きとして使えます。

対象読者は Python の基礎がある方。コードは Cursor + Claude で生成・デバッグする前提で、「AI にどう聞くか」の質問例も添えています。

> ⚠️ 本書が扱うのは Audible の **非公式 API** です。Audible の利用規約・スクレイピングの節度を守り、自分のアカウントのデータ取得に限って利用してください。API 仕様は予告なく変わり得ます。

---

## 第 1 章 — なぜ Audible 連携は「面倒」なのか

Audible には公式の一般向け読書履歴 API がありません。取得手段は実質的に 2 つです。

1. **`audible` Python パッケージ**（非公式・OSS）を使い、`audible-cli` で作った認証ファイル経由で API を叩く
2. ブラウザ自動操作でライブラリページをスクレイピングする

本書は 1 を採ります。理由は、スクレイピングより壊れにくく、読了率（`percent_complete`）や購入日といった構造化データが取れるからです。そして皮肉なことに、**この「面倒くささ」自体が、読書記録アプリの参入障壁になります**。誰もやりたがらない実装を一度乗り越えれば、それが差別化になる。

### この章の Claude への聞き方

> 「Python で Audible のライブラリ一覧と読了率を取得したい。公式 API はないが `audible` という非公式パッケージがあると聞いた。認証はどう通すのが定番？ audible-cli との関係も教えて」

---

## 第 2 章 — 認証: audible-cli で認証ファイルを作る

`audible` パッケージは、事前に作った認証ファイル（JSON）を読み込んで API を叩きます。パスワードそのものをコードに置かないのがポイントです。

```bash
pip install audible audible-cli

# 対話形式で認証（OTP・CAPTCHA に対応）
audible quickstart
# → 国（日本なら jp）・メール・パスワード・OTP を入力
# → ~/.audible/ に認証ファイルが生成される
```

生成された JSON（例: `auth_jp.json`）には、パスワードではなく **アクセストークン・リフレッシュトークン・デバイス情報** が入っています。これをアプリに読み込ませます。

```python
import audible

auth = audible.Authenticator.from_file("auth_jp.json")
client = audible.Client(auth=auth)
```

トークンには有効期限がありますが、`audible` パッケージはリフレッシュトークンで自動更新してくれます。認証が切れたら `audible-cli` で作り直します。

### この章でハマるところ

- **国コードの取り違え**: 日本アカウントは `jp`。米国 `us` で作ると別マーケットプレイスのデータが返る（yonda は `auth_jp.json` / `auth_us.json` を分けている）
- **OTP（2 段階認証）**: `quickstart` は対話で OTP を求めてくる。自動化サーバー上では作れないので、手元で作って認証ファイルだけをサーバーに置く

### Claude への聞き方

> 「audible.Authenticator.from_file で読んだ auth が期限切れのとき、リフレッシュはパッケージが自動でやってくれる？ 手動で更新するコードも見せて」

---

## 第 3 章 — 取得: ライブラリ全件をページングで取る

ライブラリは 1 リクエストで全件は返りません。ページングします。yonda の実装を単純化するとこうです。

```python
def fetch_all_library(client) -> list[dict]:
    """Audible ライブラリを全ページ取得する。"""
    items: list[dict] = []
    page = 1
    while True:
        resp = client.get(
            "library",
            num_results=1000,          # 1ページ最大件数
            page=page,
            response_groups=(
                "product_desc,product_attrs,contributors,"
                "media,price,relationships,percent_complete"
            ),
        )
        batch = resp.get("items", [])
        if not batch:
            break
        items.extend(batch)
        if len(batch) < 1000:
            break
        page += 1
    return items
```

`response_groups` が肝です。ここで `percent_complete`（読了率）や `contributors`（著者・ナレーター）を要求しないと、後で読了判定に使うフィールドが空で返ってきます。必要なグループを最初から指定しておきます。

### Claude への聞き方

> 「Audible の library エンドポイントで、読了率と著者と表紙画像 URL を一度に取りたい。response_groups に何を指定すればいい？」

---

## 第 4 章 — 読了判定: percent_complete をどう解釈するか

Audible の「読了」は明確なフラグがありません。`percent_complete`（0〜100）で判定します。yonda では次のように扱っています。

```python
def to_record(item: dict) -> dict:
    percent = item.get("percent_complete") or 0
    return {
        "title":        item.get("title", ""),
        "author":       _join_names(item.get("authors")),
        "narrator":     _join_names(item.get("narrators")),
        "asin":         item.get("asin", ""),          # catalog_number として使う
        "cover_url":    _best_cover(item.get("product_images")),
        "purchase_date": item.get("purchase_date", "")[:10],
        "percent_complete": percent,
        # 95%以上を読了とみなす（末尾のクレジット等で100%にならない本があるため）
        "completed":    percent >= 95,
    }
```

**閾値 95%** がノウハウです。オーディオブックは末尾に謝辞やクレジットが入り、最後まで聴いても 100% にならないことがあります。100% 厳密判定にすると「聴き終わったのに読了にならない」不満が出ます。95% で「実質読了」と扱うのが実用的です。

ASIN を `catalog_number` として持っておくと、後で Amazon/Audible の商品ページや書評ページへのディープリンクが作れます（`https://www.audible.co.jp/pd/{asin}`、レビュー投稿は `https://www.audible.co.jp/write-review?asin={asin}`）。

### Claude への聞き方

> 「オーディオブックが最後まで聴いても percent_complete が 100 にならないことがある。実務的な読了判定の閾値は？ 根拠も添えて」

---

## 第 5 章 — レート制限とエラー処理

非公式 API は行儀よく叩く必要があります。yonda は取得失敗を種類ごとに分けてユーザーに伝わるメッセージへ変換しています。

```python
from audible.exceptions import NetworkError, Unauthorized, RequestError

try:
    items = fetch_all_library(client)
except NetworkError as e:
    raise RuntimeError("Audible API に接続できません。時間をおいて再試行してください。") from e
except Unauthorized as e:
    raise RuntimeError("認証が期限切れです。audible-cli で再認証してください。") from e
except RequestError as e:
    raise RuntimeError(f"Audible API エラー: {e}") from e
```

ポイントは 2 つ。

- **例外を握りつぶさない**: `Unauthorized` は「再認証してね」、`NetworkError` は「時間をおいて」— 原因ごとに次のアクションを示す
- **自動同期では OTP を要求しない**: サーバーの定期実行中に OTP を求められても人間が入力できない。トークンが有効なときだけ同期し、切れていたらスキップして次回に回す

### Claude への聞き方

> 「audible パッケージの例外（NetworkError / Unauthorized / RequestError）を、ユーザー向けの日本語エラーメッセージに変換する except チェーンを書いて。原因ごとに次の行動を示したい」

---

## 第 6 章 — マルチユーザー化: 認証ファイルをユーザーごとに分ける

自分だけで使うなら認証ファイルは 1 つで済みますが、複数ユーザーのアプリにするなら **ユーザーごとに認証ファイルを分離** します。yonda はスレッドローカルに「今処理中のユーザーのデータディレクトリ」を持ち、認証ファイルもそこから読みます。

```python
# 概念コード（yonda の設計を単純化）
import threading
_tls = threading.local()

def set_user_dir(path):
    _tls.user_dir = path

def resolve_auth_file() -> Path:
    user_dir = getattr(_tls, "user_dir", DATA_DIR)
    p = user_dir / "auth_jp.json"
    return p if p.exists() else (DATA_DIR / "auth_jp.json")  # フォールバック
```

Web リクエストの入口（Flask なら `before_request`）でログインユーザーのディレクトリをセットしておけば、以降の同期処理は自動的にそのユーザーの認証ファイルを使います。並列実行してもスレッドローカルなので混ざりません。

本番（Google Cloud Run など）では、認証ファイルを Secret Manager や暗号化ストレージに置き、コンテナ起動時にマウントします。**リポジトリには絶対にコミットしない**（`.gitignore` に `auth_*.json` を入れる）。

### Claude への聞き方

> 「Flask アプリで、ログインユーザーごとに別の認証ファイルを使いたい。スレッドローカルで安全に切り替える設計を、before_request での初期化込みで見せて」

---

## 第 7 章 — 完成: 取得から保存までを 1 本にする

ここまでを 1 つの関数にまとめます。

```python
def sync_audible(auth_path: str) -> dict:
    auth = audible.Authenticator.from_file(auth_path)
    client = audible.Client(auth=auth)
    items = fetch_all_library(client)          # 第3章
    records = [to_record(i) for i in items]    # 第4章
    completed = sum(1 for r in records if r["completed"])
    payload = {
        "source": "audible_jp",
        "total": len(records),
        "completed": completed,
        "books": records,
    }
    save_json("audible_books.json", payload)   # 好きな保存先へ
    return payload
```

これを Cron（ローカルなら `cron`、クラウドなら Cloud Scheduler）で毎朝叩けば、Audible の読書記録が自動で貯まり続けます。あとはこの JSON を好きな画面に表示するだけです。

---

## おわりに — この先へ

Audible 連携だけでも、これだけの論点（認証・ページング・読了判定・レート制限・マルチユーザー）がありました。同じ深さで **Kindle 連携（FIONA API・OTP フロー）** と **図書館連携（汎用スクレイピング）** を扱った続刊も準備しています。

そして、この 4 つのソースを 1 つの画面に統合し、AI で書評・選書まで付け、収益化する — その全体像は本編『Cursor + Claude Fable 5 で Amazon 連携アプリを週末だけで開発して収益化する方法』にまとめています。実際に動くアプリは **yonda.ktrips.net** で公開しています。まずは自分の Audible ライブラリが自動で貯まる感覚を、手元で味わってみてください。

---

### 付録: この本のコードを Cursor + Claude で動かす最短手順

```bash
# 1. 認証ファイルを作る（対話・手元のマシンで）
pip install audible audible-cli
audible quickstart          # 国=jp、OTP を入力 → ~/.audible/ に JSON

# 2. 認証ファイルを作業ディレクトリにコピー
cp ~/.audible/*.json ./auth_jp.json
echo "auth_*.json" >> .gitignore   # 絶対にコミットしない

# 3. 第7章の sync_audible をファイルに保存して実行
python sync_audible.py
# → audible_books.json に読了率つきで全件が出力される
```

詰まったら、エラーの全文をそのまま Cursor のチャットに貼って Claude に聞くのが最速です。「このスタックトレースの原因と直し方を教えて」で、たいてい根本原因と修正コードが返ってきます。
