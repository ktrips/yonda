"""yonda — 読書記録ビューア（図書館 + Audible 統合）"""
from __future__ import annotations

import base64
import json
import os
import re
import socket
import uuid
from pathlib import Path

import requests
from flask import Flask, render_template, jsonify, request

import library_service
from adapters.kindle import KindleAdapter
from adapters.base import LibraryCredentials

from config_paths import get_ai_config_path, ensure_config_dir

APP_DIR = Path(__file__).resolve().parent
os.chdir(APP_DIR)

AI_CONFIG_PATH = get_ai_config_path()

# Kindle OTP ログイン用セッション（session_id -> {cookies, otp_page_html}）
_kindle_otp_sessions: dict[str, dict] = {}

app = Flask(
    __name__,
    template_folder=str(APP_DIR / "templates"),
    static_folder=str(APP_DIR / "static"),
)
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024  # 16MB（長い会話履歴対応）


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/help")
def help_page():
    """設定のヘルプページ"""
    return render_template("help.html")


@app.route("/api/isbn/<isbn>")
def api_isbn_lookup(isbn):
    """ISBN から本の情報を Open Library API で取得（CORS 回避用）"""
    import re
    isbn_clean = re.sub(r"\D", "", isbn)
    if len(isbn_clean) < 10:
        return jsonify({"success": False, "error": "無効なISBN"}), 400
    try:
        r = requests.get(
            f"https://openlibrary.org/api/books",
            params={"bibkeys": f"ISBN:{isbn_clean}", "format": "json", "jscmd": "data"},
            timeout=10,
        )
        r.raise_for_status()
        data = r.json()
        key = f"ISBN:{isbn_clean}"
        if key not in data or not data[key]:
            return jsonify({"success": False, "error": "本が見つかりません"}), 404
        book = data[key]
        title = book.get("title", "")
        authors = book.get("authors", [])
        author = " ".join(a.get("name", "") for a in authors if a.get("name"))
        return jsonify({
            "success": True,
            "title": title,
            "author": author,
            "search_text": f"{title} {author}".strip(),
        })
    except requests.RequestException as e:
        return jsonify({"success": False, "error": str(e)}), 502


def _normalize_for_match(s: str) -> str:
    """表紙マッチング用の正規化（空白・記号除去、小文字化）"""
    if not s:
        return ""
    s = "".join(c for c in s if c.isalnum() or c in " 　")
    return " ".join(s.split()).lower()


def _title_author_match(
    want_title: str, want_author: str,
    result_title: str, result_authors: list[str],
) -> bool:
    """検索結果がタイトル・著者と一致するか判定"""
    want_t = _normalize_for_match(want_title)
    want_a = _normalize_for_match(want_author)
    res_t = _normalize_for_match(result_title or "")
    res_authors = [_normalize_for_match(a or "") for a in (result_authors or [])]
    if not want_t or not res_t:
        return False
    # タイトル: いずれかが他方を含む（部分一致）
    title_ok = want_t in res_t or res_t in want_t
    if not want_a:
        return title_ok
    # 著者: いずれかの著者名が検索著者と一致
    author_ok = any(
        want_a in ra or ra in want_a
        for ra in res_authors
    ) if res_authors else False
    return title_ok and (author_ok or not res_authors)


def _fetch_cover_open_library(
    q: str, limit: int = 5,
    want_title: str = "", want_author: str = "",
) -> str | None:
    """Open Library で表紙URLを取得。タイトル・著者で一致するものを優先"""
    try:
        r = requests.get(
            "https://openlibrary.org/search.json",
            params={"q": q[:100], "limit": limit},
            timeout=8,
        )
        r.raise_for_status()
        data = r.json()
        for doc in data.get("docs", []):
            cover_i = doc.get("cover_i")
            if not cover_i:
                continue
            res_title = doc.get("title", "")
            res_authors = doc.get("author_name", [])
            if want_title:
                if not _title_author_match(want_title, want_author, res_title, res_authors):
                    continue
            return f"https://covers.openlibrary.org/b/id/{cover_i}-M.jpg"
    except requests.RequestException:
        pass
    return None


def _fetch_cover_google_books(
    q: str, max_results: int = 5,
    want_title: str = "", want_author: str = "",
) -> str | None:
    """Google Books API で表紙URLを取得。タイトル・著者で一致するものを優先"""
    result = _fetch_book_info_google_books(q, max_results, want_title, want_author)
    return result[0] if result else None


def _truncate_summary(desc: str, max_len: int = 50) -> str:
    """概要を指定文字数に切り詰め"""
    if not desc:
        return ""
    text = re.sub(r"<[^>]+>", "", desc)
    text = " ".join(text.split())
    if len(text) <= max_len:
        return text
    return text[: max_len - 1] + "…"


def _fetch_book_info_google_books(
    q: str, max_results: int = 5,
    want_title: str = "", want_author: str = "",
) -> tuple[str, str] | None:
    """Google Books API で表紙URLと概要を取得。戻り値は (cover_url, summary)"""
    try:
        r = requests.get(
            "https://www.googleapis.com/books/v1/volumes",
            params={"q": q[:100], "maxResults": max_results},
            timeout=8,
        )
        r.raise_for_status()
        data = r.json()
        for item in data.get("items", []):
            vi = item.get("volumeInfo", {})
            links = vi.get("imageLinks", {})
            url = links.get("thumbnail") or links.get("smallThumbnail")
            if not url:
                continue
            res_title = vi.get("title", "")
            res_authors = vi.get("authors", [])
            if want_title:
                if not _title_author_match(want_title, want_author, res_title, res_authors):
                    continue
            desc = vi.get("description", "") or ""
            return (url.replace("http://", "https://"), _truncate_summary(desc))
    except requests.RequestException:
        pass
    return None


@app.route("/api/book-cover")
def api_book_cover():
    """タイトル・著者から表紙画像URLを取得。一致するものを優先"""
    q = request.args.get("q", "").strip()
    title = request.args.get("title", "").strip()
    author = request.args.get("author", "").strip()
    if not q and not title:
        return jsonify({"success": False, "error": "q または title パラメータが必要です"}), 400
    search_q = q or f"{title} {author}".strip() or title

    # 1. title+author で intitle:inauthor: 検索（Google Books が最も正確）
    cover_url = None
    if title and author:
        cover_url = _fetch_cover_google_books(
            f"intitle:{title} inauthor:{author}",
            max_results=8,
            want_title=title,
            want_author=author,
        )
    # 2. Open Library（タイトル・著者で検証）
    if not cover_url:
        cover_url = _fetch_cover_open_library(
            search_q or title,
            limit=8,
            want_title=title or search_q,
            want_author=author,
        )
    # 3. Google Books 汎用検索（タイトル・著者で検証）
    if not cover_url:
        cover_url = _fetch_cover_google_books(
            search_q or title,
            max_results=8,
            want_title=title or search_q,
            want_author=author,
        )
    # 4. 検証なしでフォールバック（一致なしの場合）
    if not cover_url and title and author:
        cover_url = _fetch_cover_google_books(f"intitle:{title} inauthor:{author}", max_results=3)
    if not cover_url:
        cover_url = _fetch_cover_open_library(search_q or title, limit=3)
    if not cover_url:
        cover_url = _fetch_cover_google_books(search_q or title, max_results=3)

    if cover_url:
        return jsonify({"success": True, "cover_url": cover_url})
    return jsonify({"success": False, "cover_url": None})


@app.route("/api/book-info")
def api_book_info():
    """タイトル・著者から表紙URLと概要（50字程度）を取得"""
    q = request.args.get("q", "").strip()
    title = request.args.get("title", "").strip()
    author = request.args.get("author", "").strip()
    if not q and not title:
        return jsonify({"success": False, "error": "q または title パラメータが必要です"}), 400
    search_q = q or f"{title} {author}".strip() or title

    cover_url = None
    summary = ""
    if title and author:
        result = _fetch_book_info_google_books(
            f"intitle:{title} inauthor:{author}",
            max_results=8,
            want_title=title,
            want_author=author,
        )
        if result:
            cover_url, summary = result
    if not cover_url:
        result = _fetch_book_info_google_books(
            search_q or title,
            max_results=8,
            want_title=title or search_q,
            want_author=author,
        )
        if result:
            cover_url, summary = result
    if not cover_url:
        cover_url = _fetch_cover_open_library(
            search_q or title,
            limit=5,
            want_title=title or search_q,
            want_author=author,
        )
    if not cover_url:
        result = _fetch_book_info_google_books(search_q or title, max_results=3)
        if result:
            cover_url, summary = result[0], result[1]
    if not cover_url:
        cover_url = _fetch_cover_google_books(search_q or title, max_results=3)

    return jsonify({
        "success": bool(cover_url),
        "cover_url": cover_url,
        "summary": summary,
    })


def _sanitize_api_key(key: str) -> str:
    """APIキー内のキリル文字（ラテン風）等を正しいラテン文字に置換。コピペ時の混入対策"""
    if not key:
        return key
    # キリル文字 → ラテン文字（見た目が似ているもの）
    table = str.maketrans({
        "\u0410": "A", "\u0412": "B", "\u0415": "E", "\u041a": "K", "\u041c": "M",
        "\u041d": "H", "\u041e": "O", "\u0420": "P", "\u0421": "C", "\u0422": "T",
        "\u0423": "Y", "\u0425": "X", "\u0417": "Z", "\u0430": "a", "\u0435": "e",
        "\u043e": "o", "\u0440": "p", "\u0441": "c", "\u0442": "t", "\u0443": "y",
        "\u0445": "x",
        "\u2014": "-", "\u2013": "-",  # em dash, en dash → hyphen
    })
    return key.translate(table)


def _load_ai_config():
    """AI設定を読み込み"""
    if not AI_CONFIG_PATH.exists():
        return {}
    try:
        with open(AI_CONFIG_PATH, "r", encoding="utf-8") as f:
            cfg = json.load(f)
        api_key = cfg.get("api_key") or ""
        if api_key:
            cfg["api_key"] = _sanitize_api_key(api_key)
        return cfg
    except Exception:
        return {}


def _save_ai_config(provider: str, api_key: str):
    """AI設定を保存（~/.config/yonda/ai_config.json）"""
    ensure_config_dir()
    key = _sanitize_api_key(api_key.strip())
    data = {"provider": provider, "api_key": key}
    with open(AI_CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    AI_CONFIG_PATH.chmod(0o600)


def _extract_field_value(line: str) -> str:
    """「タイトル: 値」形式から値を抽出（全角・半角コロン対応）"""
    for sep in (":", "："):
        if sep in line:
            return line.split(sep, 1)[-1].strip()
    return ""


@app.route("/api/ai-config", methods=["GET"])
def api_ai_config_get():
    """AI設定の状態を返す（APIキーは返さない）"""
    cfg = _load_ai_config()
    return jsonify({
        "configured": bool(cfg.get("api_key")),
        "provider": cfg.get("provider", "gemini"),
    })


@app.route("/api/ai-config", methods=["POST"])
def api_ai_config_post():
    """AI設定を保存"""
    body = request.get_json(silent=True) or {}
    provider = (body.get("provider") or "gemini").lower()
    api_key = (body.get("api_key") or "").strip()
    if provider not in ("openai", "gemini"):
        return jsonify({"success": False, "error": "provider は openai または gemini を指定してください"}), 400
    try:
        cfg = _load_ai_config()
        if not api_key and cfg.get("api_key"):
            api_key = cfg["api_key"]
        _save_ai_config(provider, api_key)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/ai-extract-book", methods=["POST"])
def api_ai_extract_book():
    """画像から本の情報をAIで抽出"""
    body = request.get_json(silent=True) or {}
    image_b64 = body.get("image_base64")
    mime_type = body.get("mime_type", "image/jpeg")
    if not image_b64:
        return jsonify({"success": False, "error": "image_base64 が必要です"}), 400

    cfg = _load_ai_config()
    api_key = (cfg.get("api_key") or "").strip()
    provider = (cfg.get("provider") or "gemini").lower()
    if not api_key:
        return jsonify({"success": False, "error": "AI設定が未設定です。設定メニューからAPIキーを登録してください"}), 400

    prompt = (
        "This image shows a book cover. Extract the book title and author name accurately.\n\n"
        "Rules:\n"
        "- Read the text on the cover exactly as printed. Do not paraphrase or translate.\n"
        "- For Japanese books: output title and author in Japanese.\n"
        "- For books in other languages: output in the original language.\n"
        "- If the author is written as \"著者\" or \"Author\" etc., extract that value.\n"
        "- Reply ONLY in this exact format, one per line:\n"
        "タイトル: [exact title]\n"
        "著者: [exact author]\n"
        "- If a field is unreadable, write \"不明\". Do not guess or invent."
    )

    try:
        if provider == "openai":
            # gpt-4o-mini が最安の OpenAI モデル
            url = "https://api.openai.com/v1/chat/completions"
            headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
            payload = {
                "model": "gpt-4o-mini",
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {
                                "type": "image_url",
                                "image_url": {"url": f"data:{mime_type};base64,{image_b64}"},
                            },
                        ],
                    }
                ],
                "max_tokens": 200,
            }
            r = requests.post(url, headers=headers, json=payload, timeout=30)
            r.raise_for_status()
            data = r.json()
            text = (data.get("choices", [{}])[0].get("message", {}).get("content") or "").strip()
            model_used = "gpt-4o-mini"
        else:
            # リーズナブルなモデルを優先（flash-lite が最安）
            models_to_try = ["gemini-2.0-flash-lite", "gemini-2.0-flash", "gemini-2.5-flash"]
            text = ""
            model_used = ""
            last_err = None
            for model in models_to_try:
                try:
                    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
                    safety_settings = [
                        {"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE"},
                        {"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE"},
                        {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE"},
                        {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE"},
                    ]
                    payload = {
                        "contents": [{
                            "parts": [
                                {"inline_data": {"mime_type": mime_type, "data": image_b64}},
                                {"text": prompt},
                            ]
                        }],
                        "generationConfig": {
                            "maxOutputTokens": 256,
                            "temperature": 0.1,
                            "topP": 0.95,
                        },
                        "safetySettings": safety_settings,
                    }
                    r = requests.post(url, json=payload, timeout=45)
                    r.raise_for_status()
                    data = r.json()
                    candidates = data.get("candidates", [])
                    if candidates:
                        cand = candidates[0]
                        parts = cand.get("content", {}).get("parts", [])
                        text = (parts[0].get("text", "") if parts else "").strip()
                    if text:
                        model_used = model
                        break
                except requests.RequestException as e:
                    last_err = e
                    continue  # 次のモデルを試す
            if not text and last_err:
                raise last_err

        if not text:
            return jsonify({"success": False, "error": "AIが本の情報を抽出できませんでした"}), 400

        title = ""
        author = ""
        for line in text.split("\n"):
            line = line.strip()
            if line.startswith("タイトル:") or line.startswith("タイトル：") or line.lower().startswith("title:"):
                title = _extract_field_value(line)
            elif line.startswith("著者:") or line.startswith("著者：") or line.lower().startswith("author:"):
                author = _extract_field_value(line)
        # 「不明」は検索に含めない
        if title == "不明":
            title = ""
        if author == "不明":
            author = ""
        search_text = f"{title} {author}".strip() or text
        model_used = model_used or ("gpt-4o-mini" if provider == "openai" else "gemini")
        return jsonify({"success": True, "search_text": search_text[:200], "provider": provider, "model": model_used})
    except requests.RequestException as e:
        err = str(e)
        if hasattr(e, "response") and e.response is not None:
            try:
                err = e.response.json().get("error", {}).get("message", err)
            except Exception:
                pass
        return jsonify({"success": False, "error": err}), 502


AI_RECOMMEND_QUESTIONS = """#AI推し問答（順番に進める。性別・職業・年代・読書頻度・ジャンルはフォームで事前入力済みのため質問しないこと）
■基本属性（フォーム入力済み・必ず推し本の選出に活用すること）
性別・職業・年代・読書頻度・ジャンル: ユーザーがフォームで入力済み。これらの値を無視せず、推し本の内容・選定理由に確実に反映すること。
■第1段階：人間性・価値観の把握
Q1. 今の気分: 今日の気分はいかがですか？
Q2. 休日の過ごし方: お休みの日は何をして過ごすことが多いですか？
Q3. 最近の嬉しい出来事: 最近嬉しかったこと、心が温かくなったことはありますか？
Q4. 理想・夢: もし100万円あったら何をしたいですか？叶えてみたい夢や憧れはありますか？
Q5. 価値観: 人生で大切にしていることは何ですか？どんなときに感動しますか？
■第2段階：読書習慣（フォーム入力済み・質問しない）
読書頻度: ユーザーがフォームで選択済み
■第3段階：具体的な読書条件（フォーム入力済み・質問しない）
ジャンル: ユーザーがフォームで選択済み"""

AI_RECOMMEND_MBTI_PROMPT = """#役割
あなたはAI推しの運営です。MBTI診断に基づいてユーザーの性格タイプを把握し、その人に合った書籍を提案します。

#進め方
1. MBTIの4軸（E/I, S/N, T/F, J/P）について、短い質問を1つずつ出してユーザーの傾向を把握する
2. 質問はひとつずつ実行すること
3. 十分な情報が集まったら、推測したMBTIタイプを伝え、そのタイプに合う本を3冊提案する

#クレジットの制限
入力は30トークン以内で完結するように処理してください

#出力
最終提案時は以下のフォーマットに従うこと。おすすめする本は必ず3冊とすること。"""

AI_RECOMMEND_STRENGTH_PROMPT = """#役割
あなたはAI推しの運営です。Strength Finder（ストレングスファインダー）の34の資質の考え方に基づき、ユーザーの強み・傾向を把握し、その人に合った書籍を提案します。

#進め方
1. 強みや得意なこと、エネルギーが湧く場面について、短い質問を1つずつ出してユーザーの傾向を把握する
2. 質問はひとつずつ実行すること
3. 十分な情報が集まったら、推測した強みの傾向を伝え、その人に合う本を3冊提案する

#クレジットの制限
入力は30トークン以内で完結するように処理してください

#出力
最終提案時は以下のフォーマットに従うこと。おすすめする本は必ず3冊とすること。"""

AI_RECOMMEND_OUTPUT_FORMAT = """
#アウトプット（最終提案時のみ）: 以下のフォーマットに従うこと
#BookMeterのリンクは site:bookmeter.com から情報を取得し正しくリンク付与
#Amazonのリンクは site:www.amazon.co.jp から情報を取得し正しくリンク付与
#表紙画像は width="120" height="150" alt="画像の説明" で表示
#おすすめする本は必ず3冊とすること。1冊や2冊では不可。

■あなたにおすすめ書籍
必ず以下の形式で3冊分出力すること（１冊目、２冊目、３冊目の3つを欠かさず書くこと）:
１冊目：『書籍名』（著者名）
[表紙画像: img src="..." width="120" height="150" alt="書籍名"]
おすすめの理由: 〇〇な理由
内容: △△な物語
あなたとの関連性: □□な価値観と合致
レビュー: BookMeter
購入：Amazon

２冊目：『書籍名』（著者名）
（同様の形式で）
３冊目：『書籍名』（著者名）
（同様の形式で）

最後に補足: 選書した本が既に読んだ作品だったり、求める作品と違う場合は、追加条件を入れてください。例）追加で3冊、父と娘の物語、翻訳小説に限定、10年以内の作品、文学賞受賞作品 など
"""


def _build_ai_recommend_system_prompt(form_prefs: dict, mode: str = "5questions") -> str:
    """フォーム入力値を含めたシステムプロンプトを生成"""
    if mode == "mbti":
        return AI_RECOMMEND_MBTI_PROMPT + AI_RECOMMEND_OUTPUT_FORMAT
    if mode == "strength":
        return AI_RECOMMEND_STRENGTH_PROMPT + AI_RECOMMEND_OUTPUT_FORMAT

    base = """#役割
あなたはAI推しの運営です。
ユーザーと情報のやり取りをすることで、その人の人間性や趣味趣向を収集し、その人にあった書籍を提案します。
その本を選んだ理由、簡単な本の紹介、世間でのレビュー、AmazonのURLを提供します。

#以下のAI推し問答をユーザーとやり取りして、ユーザーの情報を収集して判断すること
#質問はひとつずつ実行すること
#性別・職業・年代・読書頻度・ジャンルはユーザーがフォームで入力済み。これらは質問せず、以下の値を必ず推し本の選出・理由に反映すること。

#クレジットの制限
入力は30トークン以内で完結するように処理してください

#出力
最終提案時はフォーマットに従い十分な情報を出力すること。

"""
    # スライダー値からラベルを生成（0-100）
    def q0_label(v):
        v = int(v) if v is not None else 0
        return "男性" if v > 50 else "女性"

    def q2_label(v):
        v = int(v) if v is not None else 50
        if v < 25:
            return "学生"
        if v < 50:
            return "フリーター"
        if v < 75:
            return "社会人"
        if v < 90:
            return "経営者"
        return "悠々"

    def q1_label(v):
        v = int(v) if v is not None else 50
        if v < 17:
            return "10代"
        if v < 34:
            return "20代"
        if v < 51:
            return "30代"
        if v < 68:
            return "40代"
        if v < 84:
            return "50代"
        return "60代以上"

    def q6_label(v):
        v = int(v) if v is not None else 25
        if v < 25:
            return "月４冊以上"
        if v < 50:
            return "月２冊"
        if v < 75:
            return "月１冊以下"
        return "読まない"

    def q7_label(v):
        v = int(v) if v is not None else 50
        if v < 34:
            return "ノンフィクション"
        if v < 67:
            return "現代小説"
        return "ファンタジー・SF"

    prefs = []
    prefs.append(f"性別: {q0_label(form_prefs.get('q0', 100))}")
    prefs.append(f"職業: {q2_label(form_prefs.get('q2', 50))}")
    prefs.append(f"年代: {q1_label(form_prefs.get('q1', 50))}")
    prefs.append(f"読書頻度: {q6_label(form_prefs.get('q6', 25))}")
    prefs.append(f"ジャンル: {q7_label(form_prefs.get('q7', 50))}")

    base += "#ユーザーがフォームで入力した読書条件（質問不要・推し本選出に必ず活用すること）\n"
    base += "\n".join(prefs) + "\n\n"
    base += "#重要: 上記の性別・職業・年代・読書頻度・ジャンルは、推し本の選定理由・あなたとの関連性に確実に反映すること。無視しないこと。\n\n"

    base += AI_RECOMMEND_QUESTIONS + AI_RECOMMEND_OUTPUT_FORMAT
    return base


AI_RECOMMEND_INIT_MESSAGES = {
    "5questions": "こんにちは。AI推しをお願いします。まず「AI推しへようこそ！5つの質問で、あなたにピッタリな本を推すので、短くてもいいので答えて下さいね。」と挨拶した後、最初の質問（Q1. 今の気分）をしてください。",
    "mbti": "こんにちは。MBTI診断で選書します。まず「MBTI診断で選書へようこそ！いくつか質問に答えてもらって、あなたの性格タイプに合った本を提案しますね。」と挨拶した後、MBTIの最初の軸（外向型E vs 内向型I）に関する質問をしてください。",
    "strength": "こんにちは。Strength Finderで選書します。まず「Strength Finderで選書へようこそ！あなたの強みや得意なことに合わせた本を提案します。いくつか質問に答えてくださいね。」と挨拶した後、強みに関する最初の質問をしてください。",
}


@app.route("/api/ai-recommend", methods=["POST"])
def api_ai_recommend():
    """AI選書チャット: 会話履歴とユーザー入力を送り、AIの返答を返す"""
    body = request.get_json(silent=True) or {}
    messages = body.get("messages", [])
    user_message = (body.get("user_message") or "").strip()
    is_init = body.get("init", False)
    form_prefs = body.get("form_preferences") or {}
    mode = body.get("mode") or "5questions"
    if mode not in ("5questions", "mbti", "strength"):
        mode = "5questions"
    if not user_message and not is_init:
        return jsonify({"success": False, "error": "user_message が必要です"}), 400

    system_prompt = _build_ai_recommend_system_prompt(form_prefs, mode)
    cfg = _load_ai_config()
    api_key = (cfg.get("api_key") or "").strip()
    provider = (cfg.get("provider") or "gemini").lower()
    if not api_key:
        return jsonify({
            "success": False,
            "error": "AI設定が未設定です。設定メニューからAPIキーを登録してください",
        }), 400

    # 会話履歴 + 最新ユーザーメッセージ
    chat_messages = []
    for m in messages:
        role = m.get("role")
        content = (m.get("content") or "").strip()
        if role and content:
            chat_messages.append({"role": role, "content": content})
    if is_init:
        init_msg = AI_RECOMMEND_INIT_MESSAGES.get(mode, AI_RECOMMEND_INIT_MESSAGES["5questions"])
        chat_messages.append({"role": "user", "content": init_msg})
    elif user_message:
        chat_messages.append({"role": "user", "content": user_message})

    # 質問フェーズか最終提案かはAIが判断。max_tokensは提案時用に多めに（3冊+最後に補足で長くなる）
    max_tokens = 8192

    try:
        if provider == "openai":
            # gpt-4o-mini が最安の OpenAI モデル
            url = "https://api.openai.com/v1/chat/completions"
            headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
            payload = {
                "model": "gpt-4o-mini",
                "messages": [
                    {"role": "system", "content": system_prompt},
                    *chat_messages,
                ],
                "max_tokens": max_tokens,
            }
            r = requests.post(url, headers=headers, json=payload, timeout=120)
            r.raise_for_status()
            data = r.json()
            text = (data.get("choices", [{}])[0].get("message", {}).get("content") or "").strip()
            model_used = "gpt-4o-mini"
        else:
            # リーズナブルなモデルを優先（flash-lite が最安）
            models_to_try = ["gemini-2.0-flash-lite", "gemini-2.0-flash", "gemini-2.5-flash"]
            text = ""
            model_used = ""
            last_err = None
            safety_settings = [
                {"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE"},
                {"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE"},
                {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE"},
                {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE"},
            ]
            conv_text = system_prompt + "\n\n--- 会話 ---\n\n"
            conv_text += "\n\n".join(
                f"{msg['role']}: {msg['content']}" for msg in chat_messages
            )
            for model in models_to_try:
                try:
                    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
                    payload = {
                        "contents": [{"parts": [{"text": conv_text}]}],
                        "generationConfig": {
                            "maxOutputTokens": max_tokens,
                            "temperature": 0.7,
                        },
                        "safetySettings": safety_settings,
                    }
                    r = requests.post(url, json=payload, timeout=120)
                    r.raise_for_status()
                    data = r.json()
                    candidates = data.get("candidates", [])
                    if candidates:
                        cand = candidates[0]
                        finish_reason = cand.get("finishReason", "")
                        cparts = cand.get("content", {}).get("parts", [])
                        if finish_reason == "SAFETY" and not cparts:
                            last_err = RuntimeError("応答がセーフティフィルターでブロックされました")
                            continue
                        text = (cparts[0].get("text", "") if cparts else "").strip()
                    if text:
                        model_used = model
                        break
                except requests.RequestException as e:
                    last_err = e
                    continue
            if not text and last_err:
                raise last_err

        if not text:
            return jsonify({"success": False, "error": "AIが応答を生成できませんでした"}), 400

        # Assistant/User などの役割プレフィックスを除去
        text = re.sub(r"^\s*(Assistant|User|assistant|user)\s*:\s*", "", text, flags=re.IGNORECASE).strip()

        model_used = model_used or ("gpt-4o-mini" if provider == "openai" else "gemini")
        return jsonify({"success": True, "reply": text, "provider": provider, "model": model_used})
    except requests.RequestException as e:
        err = str(e)
        if hasattr(e, "response") and e.response is not None:
            try:
                j = e.response.json()
                err_obj = j.get("error", {})
                if isinstance(err_obj, dict):
                    err = err_obj.get("message", err_obj.get("error", err))
                elif isinstance(err_obj, str):
                    err = err_obj
            except Exception:
                pass
            status = getattr(e.response, "status_code", 502)
            if status == 401:
                err = f"APIキーが無効です。正しいキーか確認してください。（{err}）"
            elif status == 403:
                err = f"APIの利用が制限されています。キーの有効性・課金設定を確認してください。（{err}）"
            elif status == 429:
                err = f"リクエスト制限に達しました。しばらく待ってから再試行してください。（{err}）"
        return jsonify({"success": False, "error": err}), 502


YONDA_RECOMMEND_PROMPT = """あなたは読書のプロです。ユーザーが読了した本の傾向から、まだ読んでいない本のリストの中から5冊を厳選しておすすめしてください。

# 読了した本（直近20冊）
{completed_summary}

# 未読の本（候補）
{unread_list}

# 出力形式（厳守）
以下の形式で5冊分を出力してください。番号は1〜5。

1冊目：『タイトル』（著者名）
理由: 〇〇
2冊目：『タイトル』（著者名）
理由: 〇〇
（3〜5冊目も同様）

タイトルと著者名は上記の未読リストに含まれるものから正確に選んでください。"""


@app.route("/api/yonda-recommend", methods=["POST"])
def api_yonda_recommend():
    """読了本の傾向から未読本を5冊AIでおすすめ"""
    body = request.get_json(silent=True) or {}
    completed_books = body.get("completed_books") or []
    unread_books = body.get("unread_books") or []
    if not completed_books or not unread_books:
        return jsonify({"success": False, "error": "読了本と未読本が必要です"}), 400

    cfg = _load_ai_config()
    api_key = (cfg.get("api_key") or "").strip()
    provider = (cfg.get("provider") or "gemini").lower()
    if not api_key:
        return jsonify({"success": False, "error": "AI設定が未設定です。Amazon/AI設定からAPIキーを登録してください"}), 400

    completed_summary = "\n".join(
        "- 『{}』（{}）{}".format(b.get("title", ""), b.get("author", ""), b.get("genre", ""))
        for b in completed_books[:20]
    )
    unread_list = "\n".join(
        "- 『{}』（{}）{}".format(b.get("title", ""), b.get("author", ""), b.get("genre", ""))
        for b in unread_books[:100]
    )
    prompt = YONDA_RECOMMEND_PROMPT.format(
        completed_summary=completed_summary,
        unread_list=unread_list,
    )

    try:
        if provider == "openai":
            url = "https://api.openai.com/v1/chat/completions"
            headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
            payload = {
                "model": "gpt-4o-mini",
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 2048,
            }
            r = requests.post(url, headers=headers, json=payload, timeout=60)
            r.raise_for_status()
            data = r.json()
            text = (data.get("choices", [{}])[0].get("message", {}).get("content") or "").strip()
            model_used = "gpt-4o-mini"
        else:
            models_to_try = ["gemini-2.0-flash-lite", "gemini-2.0-flash", "gemini-2.5-flash"]
            text = ""
            model_used = ""
            safety_settings = [
                {"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE"},
                {"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE"},
                {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE"},
                {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE"},
            ]
            for model in models_to_try:
                try:
                    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
                    payload = {
                        "contents": [{"parts": [{"text": prompt}]}],
                        "generationConfig": {"maxOutputTokens": 2048, "temperature": 0.7},
                        "safetySettings": safety_settings,
                    }
                    r = requests.post(url, json=payload, timeout=60)
                    r.raise_for_status()
                    data = r.json()
                    candidates = data.get("candidates", [])
                    if candidates:
                        cparts = candidates[0].get("content", {}).get("parts", [])
                        text = (cparts[0].get("text", "") if cparts else "").strip()
                    if text:
                        model_used = model
                        break
                except requests.RequestException:
                    continue
            if not text:
                return jsonify({"success": False, "error": "AIが応答を生成できませんでした"}), 400

        # パース: 「N冊目：『タイトル』（著者）」形式。理由は次の行
        rec_pattern = re.compile(
            r"(\d)冊目[：:]\s*[『\[「]?([^』\]」\n]+?)[』\]」]?\s*[（(]([^）)\n]+?)[）)]\s*(?:理由[：:]\s*)?([^\n]*)",
            re.DOTALL,
        )
        matches = rec_pattern.findall(text)
        recommended = []
        seen_ids = set()
        for m in matches:
            title, author = m[1].strip(), m[2].strip()
            reason = (m[3] or "").strip()[:200]
            for b in unread_books:
                bt, ba = (b.get("title") or "").strip(), (b.get("author") or "").strip()
                bid = f"{bt}|{ba}"
                if bid in seen_ids:
                    continue
                if (title in bt or bt in title) and (not author or author in ba or ba in author):
                    recommended.append({"book": b, "reason": reason})
                    seen_ids.add(bid)
                    break

        return jsonify({
            "success": True,
            "recommendations": recommended[:5],
            "raw_text": text,
            "model": model_used or "gemini",
        })
    except requests.RequestException as e:
        err = str(e)
        if hasattr(e, "response") and e.response is not None:
            try:
                j = e.response.json()
                err = j.get("error", {}).get("message", err)
            except Exception:
                pass
        return jsonify({"success": False, "error": err}), 502


@app.route("/api/books")
def api_books():
    """全ソースの保存済みデータを統合して返す"""
    try:
        data = library_service.load_saved()
        if data is None:
            return jsonify({
                "success": True,
                "books": [],
                "sources": [],
                "total": 0,
            })
        return jsonify({"success": True, **data})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/fetch", methods=["POST"])
def api_fetch():
    """指定ソースから読書記録を取得・保存し、全ソース統合データを返す。
    Kindle で OTP が必要な場合は needs_otp, session_id を返す。"""
    try:
        body = request.get_json(silent=True) or {}
        library_id = body.get("library_id", "setagaya")
        session_id = body.get("session_id", "")
        otp = (body.get("otp") or "").strip()

        if library_id == "kindle":
            return _api_fetch_kindle(session_id, otp)
        library_service.fetch_and_save(library_id)
        combined = library_service.load_saved()
        return jsonify({"success": True, **(combined or {})})
    except ValueError as e:
        return jsonify({"success": False, "error": str(e)}), 400
    except RuntimeError as e:
        return jsonify({"success": False, "error": str(e)}), 502
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


def _api_fetch_kindle(session_id: str, otp: str):
    """Kindle 読書記録取得（OTP フロー対応）"""
    creds = library_service.get_kindle_credentials()

    # 認証情報なし → ローカルファイルから取得（従来の挙動）
    if not creds or not creds.get("user_id") or not creds.get("password"):
        library_service.fetch_and_save("kindle")
        combined = library_service.load_saved()
        return jsonify({"success": True, **(combined or {})})

    if session_id and otp:
        # OTP 送信して取得を続行
        data = _kindle_otp_sessions.pop(session_id, None)
        if not data:
            return jsonify({"success": False, "error": "セッションが期限切れです。最初からやり直してください。"}), 400
        session = requests.Session()
        session.headers.update({
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            ),
            "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
        })
        session.cookies.update(requests.utils.cookiejar_from_dict(data["cookies"]))
        adapter = KindleAdapter()
        if not adapter.submit_otp(session, otp, data.get("otp_page_html")):
            return jsonify({"success": False, "error": "OTP が正しくありません。もう一度お試しください。"}), 401
        records = adapter.fetch_history(session)
        combined = library_service.save_kindle_records_and_load(records)
        return jsonify({"success": True, **combined})

    # 初回: ログイン試行
    session = requests.Session()
    session.headers.update({
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        ),
        "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
    })
    adapter = KindleAdapter()
    creds_obj = LibraryCredentials(user_id=creds["user_id"], password=creds["password"])
    ok, needs_otp, otp_page_html = adapter._login_amazon(session, creds_obj)
    if ok:
        records = adapter.fetch_history(session)
        combined = library_service.save_kindle_records_and_load(records)
        return jsonify({"success": True, **combined})
    if needs_otp and otp_page_html:
        sid = str(uuid.uuid4())
        _kindle_otp_sessions[sid] = {
            "cookies": requests.utils.dict_from_cookiejar(session.cookies),
            "otp_page_html": otp_page_html,
        }
        return jsonify({
            "success": False,
            "needs_otp": True,
            "session_id": sid,
            "message": "OTP（ワンタイムパスワード）を入力してください。",
        })
    return jsonify({"success": False, "error": "Amazon へのログインに失敗しました。メールアドレスとパスワードを確認してください。"}), 502


@app.route("/api/libraries")
def api_libraries():
    """対応図書館一覧"""
    return jsonify({"success": True, "libraries": library_service.get_available_libraries()})


@app.route("/api/credentials/<library_id>")
def api_get_credentials(library_id):
    """認証情報の登録状態を返す"""
    try:
        info = library_service.get_credentials_info(library_id)
        return jsonify({"success": True, **info})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/credentials", methods=["POST"])
def api_save_credentials():
    """認証情報を保存"""
    try:
        body = request.get_json(silent=True) or {}
        library_id = body.get("library_id", "")
        user_id = body.get("user_id", "")
        password = body.get("password", "")
        if not library_id or not user_id or not password:
            return jsonify({"success": False, "error": "図書館ID・ユーザーID・パスワードは必須です"}), 400
        library_service.save_credentials(library_id, user_id, password)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/credentials/<library_id>", methods=["DELETE"])
def api_delete_credentials(library_id):
    """認証情報を削除"""
    try:
        library_service.delete_credentials(library_id)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/credentials/audible_jp/upload", methods=["POST"])
def api_upload_audible_auth():
    """Audible: auth_jp.json をアップロードして保存"""
    try:
        if "auth_file" not in request.files:
            return jsonify({"success": False, "error": "auth_jp.json ファイルを選択してください"}), 400
        f = request.files["auth_file"]
        if not f.filename or not f.filename.lower().endswith(".json"):
            return jsonify({"success": False, "error": "JSON ファイル（auth_jp.json）を選択してください"}), 400
        raw = f.read()
        try:
            data = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError as e:
            return jsonify({"success": False, "error": f"JSON 形式が不正です: {e}"}), 400
        # audible 認証ファイルの必須キーを簡易チェック
        if not isinstance(data, dict) or not any(k in data for k in ("website_cookies", "adp_token", "access_token")):
            return jsonify({"success": False, "error": "auth_jp.json の形式が正しくありません。audible-cli で認証し直してください。"}), 400
        dest = library_service.DATA_DIR / "auth_jp.json"
        dest.parent.mkdir(parents=True, exist_ok=True)
        with open(dest, "wb") as out:
            out.write(raw)
        return jsonify({"success": True, "message": "auth_jp.json を保存しました"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/kindle-login", methods=["POST"])
def api_kindle_login():
    """Kindle: Amazon ログイン（ステップ1: メール/パスワード、OTP 必要時は session_id を返す）"""
    try:
        body = request.get_json(silent=True) or {}
        user_id = (body.get("user_id") or "").strip()
        password = body.get("password", "")
        if not user_id or not password:
            return jsonify({"success": False, "error": "メールアドレスとパスワードを入力してください。"}), 400

        session = requests.Session()
        session.headers.update({
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            ),
            "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
        })

        adapter = KindleAdapter()
        creds = LibraryCredentials(user_id=user_id, password=password)
        ok, needs_otp, otp_page_html = adapter._login_amazon(session, creds)

        if ok:
            library_service.save_credentials("kindle", user_id, password)
            return jsonify({"success": True, "message": "ログインに成功しました"})
        if needs_otp and otp_page_html:
            session_id = str(uuid.uuid4())
            _kindle_otp_sessions[session_id] = {
                "cookies": requests.utils.dict_from_cookiejar(session.cookies),
                "otp_page_html": otp_page_html,
                "user_id": user_id,
                "password": password,
            }
            return jsonify({
                "needs_otp": True,
                "session_id": session_id,
                "message": "OTP（ワンタイムパスワード）を入力してください。",
            })
        return jsonify({"success": False, "error": "ログインに失敗しました。メールアドレスまたはパスワードを確認してください。"}), 401
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/kindle-login-otp", methods=["POST"])
def api_kindle_login_otp():
    """Kindle: OTP を送信してログイン完了"""
    try:
        body = request.get_json(silent=True) or {}
        session_id = body.get("session_id", "")
        otp = (body.get("otp") or "").strip()
        if not session_id or not otp:
            return jsonify({"success": False, "error": "OTP を入力してください。"}), 400

        data = _kindle_otp_sessions.pop(session_id, None)
        if not data:
            return jsonify({"success": False, "error": "セッションが期限切れです。最初からやり直してください。"}), 400

        session = requests.Session()
        session.headers.update({
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            ),
            "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
        })
        session.cookies.update(requests.utils.cookiejar_from_dict(data["cookies"]))

        adapter = KindleAdapter()
        if adapter.submit_otp(session, otp, data.get("otp_page_html")):
            library_service.save_credentials("kindle", data["user_id"], data["password"])
            return jsonify({"success": True, "message": "ログインに成功しました"})
        return jsonify({"success": False, "error": "OTP が正しくありません。もう一度お試しください。"}), 401
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/test-login", methods=["POST"])
def api_test_login():
    """認証情報でログインテスト"""
    try:
        body = request.get_json(silent=True) or {}
        library_id = body.get("library_id", "")
        user_id = (body.get("user_id") or "").strip()
        password = body.get("password", "")
        if not library_id:
            return jsonify({"success": False, "error": "ソースを選択してください。"}), 400
        needs_creds = library_service.adapter_needs_credentials(library_id)
        if library_id == "kindle":
            if user_id and password:
                library_service.save_credentials(library_id, user_id, password)
            else:
                pass
        elif needs_creds and (not user_id or not password):
            return jsonify({"success": False, "error": "ユーザーIDとパスワードを入力してください。"}), 400
        if needs_creds:
            library_service.save_credentials(library_id, user_id, password)
        ok = library_service.test_login(library_id)
        if not ok:
            if library_id == "kindle" and user_id and password:
                library_service.delete_credentials(library_id)
            elif needs_creds:
                library_service.delete_credentials(library_id)
            err_msg = (
                "auth_jp.json が見つからないか、認証が期限切れです。"
                "ファイルをアップロードするか、audible-cli で再認証してください。"
                if library_id == "audible_jp"
                else "ログインに失敗しました。メールアドレスまたはパスワードを確認してください。"
            )
            return jsonify({"success": False, "error": err_msg}), 401
        return jsonify({"success": True, "message": "ログインに成功しました"})
    except ValueError as e:
        return jsonify({"success": False, "error": str(e)}), 400
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


if __name__ == "__main__":
    def find_free_port(start: int, max_attempts: int = 10) -> int:
        for i in range(max_attempts):
            port = start + i
            try:
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                    s.bind(("127.0.0.1", port))
                    return port
            except OSError:
                continue
        return start

    base_port = int(os.environ.get("YONDA_PORT", 5002))
    port = find_free_port(base_port)
    if port != base_port:
        print(f"ポート {base_port} は使用中。ポート {port} で起動します。")
    print(f"http://127.0.0.1:{port}")
    app.run(debug=True, port=port, host="127.0.0.1")
