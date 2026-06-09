"""yonda — 読書記録ビューア（図書館 + Audible 統合）"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import re
import socket
import time
import uuid
from pathlib import Path

import requests
from flask import Flask, render_template, jsonify, request, send_file

import library_service
from adapters.kindle import KindleAdapter
from adapters.base import LibraryCredentials

from config_paths import get_ai_config_path, ensure_config_dir

logger = logging.getLogger(__name__)

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


@app.route("/api/docs")
def api_docs():
    return render_template("api_docs.html")


@app.route("/help")
def help_page():
    """設定のヘルプページ（Yondaの使い方を除く）"""
    return render_template("help.html")


@app.route("/help/usage")
def help_usage_page():
    """Yondaの使い方ページ"""
    return render_template("help_usage.html")


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

#MBTI16タイプの正式対応表（必ずこの表に従って正確に判定すること。日本語名と4文字コードの対応を厳守）
INTJ=建築家, INTP=論理学者, ENTJ=指揮官, ENTP=討論者
INFJ=提唱者, INFP=仲介者, ENFJ=主人公, ENFP=運動家
ISTJ=管理者, ISFJ=擁護者, ESTJ=幹部, ESFJ=領事
ISTP=巨匠, ISFP=冒険家, ESTP=起業家, ESFP=エンターテイナー

※起業家=ESTP（指揮官ENTJとは別）。指揮官=ENTJ。混同しないこと。

#重要
MBTI結果がわかってる人は、いきなり「ENTJ」や「指揮官」など入れてくれれば、それに合った本をすぐに選書します！とユーザーに伝えること。

#進め方
1. ユーザーのメッセージにMBTIタイプ（4文字コード）や日本語の性格タイプ名が含まれる場合、上記の対応表に従って正確にタイプを特定し、質問はせずにそのタイプに合う本を3冊、直ちに提案フォーマットで出力すること
2. 日本語名からタイプを判定する際は、上記対応表を厳密に参照すること（例：起業家→ESTP、指揮官→ENTJ）
3. そうでない場合、MBTIの4軸（E/I, S/N, T/F, J/P）について、短い質問を1つずつ出してユーザーの傾向を把握する
4. 質問はひとつずつ実行すること
5. 十分な情報が集まったら、推測したMBTIタイプを伝え、そのタイプに合う本を3冊提案する

#クレジットの制限
入力は30トークン以内で完結するように処理してください

#出力
最終提案時は以下のフォーマットに従うこと。おすすめする本は必ず3冊とすること。
MBTIタイプを提示する際は「ESTP（起業家）ということは〇〇な人で、」のように4文字コードと日本語名を明示し、そのタイプの特徴を1文で簡潔に説明してから本を提案すること。推薦する本は、判定した正しいMBTIタイプの性格・価値観に正確に対応するものを選ぶこと。"""

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
【最終提案時の出力ルール（この括弧内は出力に含めない）】
・BookMeterのリンクは site:bookmeter.com で検索して正しいURLを付与
・Amazonのリンクは site:www.amazon.co.jp で検索して正しいURLを付与
・表紙画像は width="120" height="150" alt="書籍名" で表示
・必ず3冊提案すること。1冊や2冊は不可。
・「#」や「アウトプット」「BookMeterのリンクは」等のメタ指示文は出力しない。ユーザー向けの本文のみ出力すること。

【出力する本文の形式】
■あなたにおすすめ書籍
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
    "5questions": "こんにちは。AI推しをお願いします。まず「簡単質問推しへようこそ！簡単な質問で、あなたにピッタリな本を推すので、短くてもいいので答えて下さいね。」と挨拶した後、最初の質問（Q1. 今の気分）をしてください。",
    "mbti": "こんにちは。MBTI推しで選書します。まず「MBTI推しへようこそ！いくつか質問に答えてもらって、あなたの性格タイプに合った本を提案しますね。MBTI結果がわかってる人は、いきなり「ENTJ」や「指揮官」など入れてくれれば、それに合った本をすぐに選書します！」と挨拶した後、MBTIの最初の軸（外向型E vs 内向型I）に関する質問をしてください。",
    "strength": "こんにちは。強み診断推しで選書します。まず「強み診断推しへようこそ！あなたの強みや得意なことに合わせた本を提案します。いくつか質問に答えてくださいね。」と挨拶した後、強みに関する最初の質問をしてください。",
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

        # プロンプトのメタ指示が出力に混入した場合に除去
        def _is_meta_line(line: str) -> bool:
            s = line.strip()
            if s.startswith("#アウトプット") or (s.startswith("#") and "出力" in s[:25]):
                return True
            if "BookMeterのリンクは" in s and "site:" in s:
                return True
            if "Amazonのリンクは" in s and "site:" in s:
                return True
            if "表紙画像は width=" in s and "で表示" in s and s.startswith("#"):
                return True
            if "おすすめする本は必ず3冊" in s and s.startswith("#"):
                return True
            if "この括弧内は出力に含めない" in s or "出力に含めない" in s:
                return True
            if "メタ指示文は出力しない" in s:
                return True
            if "【最終提案時の出力ルール" in s and "出力に含めない" in s:
                return True
            return False

        text = "\n".join(ln for ln in text.split("\n") if not _is_meta_line(ln)).strip()

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
        return jsonify({"success": False, "error": "AI設定が未設定です。アプリ設定からAPIキーを登録してください"}), 400

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


def _book_identity(book: dict) -> str:
    catalog = (book.get("catalog_number") or book.get("asin") or "").strip()
    if catalog:
        return catalog
    title = (book.get("title") or "").strip().lower()
    author = (book.get("author") or "").strip().lower()
    return f"{title}::{author}"


def _parse_book_datetime(value: str):
    """Audible等のISO日時をUTC aware datetimeとして読む。読めない場合はNone。"""
    if not value:
        return None
    from datetime import datetime, timezone
    text = str(value).strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _message_book_identity(book: dict) -> str:
    source = (book.get("source") or "book").strip()
    return f"{source}:{_book_identity(book)}"


def _completed_messaged_book_ids() -> set[str]:
    """既にメッセージ化した読了本の識別子。重複通知を防ぐ。"""
    messages = library_service.load_yonda_messages().get("messages") or []
    ids: set[str] = set()
    for message in messages:
        if message.get("type") not in ("audible_completed", "completed_books", "sync_result"):
            continue
        for item in message.get("books") or []:
            book = item.get("book") if isinstance(item, dict) else None
            if isinstance(book, dict):
                ids.add(_message_book_identity(book))
    return ids


def _review_url_for_book(book: dict) -> str:
    source = book.get("source") or ""
    asin = (book.get("catalog_number") or "").strip()
    if source == "audible_jp" and asin:
        return f"https://www.audible.co.jp/write-review?asin={asin}"
    if book.get("detail_url"):
        return book["detail_url"]
    if source == "audible_jp":
        return "https://www.audible.co.jp/library/titles"
    if source == "kindle" and asin:
        return f"https://www.amazon.co.jp/dp/{asin}"
    return ""


def _source_label(source: str) -> str:
    return {
        "setagaya": "図書館",
        "audible_jp": "Audible",
        "kindle": "Kindle",
    }.get(source or "", source or "その他")


def _group_message_books_by_source(books: list[dict]) -> dict[str, list[dict]]:
    groups: dict[str, list[dict]] = {}
    for item in books:
        book = item.get("book") or {}
        source = book.get("source") or "other"
        groups.setdefault(source, []).append(item)
    return groups


def _message_text_for_completed_books(books: list[dict], sync_summary: dict | None = None) -> str:
    created_at = (sync_summary or {}).get("created_at_jst") or ""
    lines = [f"データ同期が完了しました。{created_at}".strip()]
    lines.append(f"新規読了: {len(books)}冊")
    errors = (sync_summary or {}).get("errors") or {}
    if errors:
        lines.append("一部取得エラーあり:")
        for source, error in errors.items():
            lines.append(f"- {_source_label(source)}: {error}")
    if not books:
        return "\n".join(lines)

    groups = _group_message_books_by_source(books)
    for source, items in groups.items():
        lines.append("")
        lines.append(f"# {_source_label(source)}")
        for i, item in enumerate(items, 1):
            book = item["book"]
            lines.append(f"{i}. {book.get('title') or '不明なタイトル'}")
            if book.get("author"):
                lines.append(f"著者: {book['author']}")
            if book.get("review_url"):
                lines.append(f"レビュー: {book['review_url']}")
            points = item.get("insight", {}).get("points") or []
            if points:
                lines.append("書評ポイント:")
                for p in points[:5]:
                    lines.append(f"- {(p.get('heading') or 'ポイント')}: {p.get('text') or ''}")
    return "\n".join(lines)


def _message_source_groups(books: list[dict]) -> list[dict]:
    groups = _group_message_books_by_source(books)
    return [
        {
            "source": source,
            "label": _source_label(source),
            "count": len(items),
            "books": items,
        }
        for source, items in groups.items()
    ]


def _sync_summary(
    current_payloads: dict[str, dict | None],
    new_completed_count: int,
    errors: dict[str, str] | None = None,
) -> dict:
    from datetime import datetime
    from zoneinfo import ZoneInfo
    now_jst = datetime.now(ZoneInfo("Asia/Tokyo"))
    sources = []
    for library_id, payload in current_payloads.items():
        books = (payload or {}).get("books") or []
        sources.append({
            "source": library_id,
            "label": _source_label(library_id),
            "total": len(books),
            "completed": sum(1 for b in books if b.get("completed")),
        })
    return {
        "created_at_jst": now_jst.isoformat(timespec="seconds"),
        "new_completed_count": new_completed_count,
        "sources": sources,
        "errors": errors or {},
        "status": "partial_error" if errors else "complete",
    }


def _send_ios_message_webhook(message: dict) -> bool:
    """iOS/SMS連携へ送る。未設定なら何もしない。"""
    sid = os.environ.get("TWILIO_ACCOUNT_SID", "")
    token = os.environ.get("TWILIO_AUTH_TOKEN", "")
    from_number = os.environ.get("TWILIO_FROM", "")
    to_number = os.environ.get("IOS_MESSAGE_TO", "")
    if sid and token and from_number and to_number:
        try:
            r = requests.post(
                f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json",
                data={
                    "From": from_number,
                    "To": to_number,
                    "Body": (message.get("body") or "")[:1500],
                },
                auth=(sid, token),
                timeout=15,
            )
            r.raise_for_status()
            return True
        except Exception:
            logger.warning("Twilio SMS送信に失敗", exc_info=True)

    url = (
        os.environ.get("YONDA_IOS_MESSAGE_WEBHOOK_URL")
        or os.environ.get("IOS_MESSAGE_WEBHOOK_URL")
    )
    if not url:
        return False
    try:
        r = requests.post(url, json={
            "title": message.get("title"),
            "message": message.get("body"),
            "books": message.get("books", []),
            "created_at": message.get("created_at"),
        }, timeout=15)
        r.raise_for_status()
        return True
    except Exception:
        logger.warning("iOSメッセージWebhook送信に失敗", exc_info=True)
        return False


def _create_completed_books_message(
    previous_payloads: dict[str, dict | None],
    current_payloads: dict[str, dict | None],
    errors: dict[str, str] | None = None,
) -> dict | None:
    """新規読了があった場合のみメッセージ化し、書評ポイントも付ける。"""
    errors = errors or {}
    if not current_payloads and not errors:
        return None

    notified_ids = _completed_messaged_book_ids()
    from datetime import datetime, timezone, timedelta
    recent_threshold = datetime.now(timezone.utc) - timedelta(hours=24)

    newly_completed = []
    seen_ids = set()
    for library_id, current_payload in current_payloads.items():
        prev_payload = previous_payloads.get(library_id) or {}
        prev_books = prev_payload.get("books") or []
        curr_books = (current_payload or {}).get("books") or []
        prev_completed = {
            _message_book_identity(b)
            for b in prev_books
            if b.get("completed")
        }
        prev_fetch_at = _parse_book_datetime(prev_payload.get("fetch_date") or "")
        for book in curr_books:
            if not book.get("completed"):
                continue
            msg_book = dict(book)
            msg_book.setdefault("source", library_id)
            identity = _message_book_identity(msg_book)
            if identity in notified_ids or identity in seen_ids:
                continue
            completed_at = _parse_book_datetime(msg_book.get("completed_date") or "")
            changed_to_completed = bool(prev_books) and identity not in prev_completed
            completed_after_last_fetch = bool(completed_at and prev_fetch_at and completed_at > prev_fetch_at)
            completed_recently = bool(completed_at and completed_at >= recent_threshold)
            if changed_to_completed or completed_after_last_fetch or completed_recently:
                newly_completed.append(msg_book)
                seen_ids.add(identity)
    if not newly_completed and not errors:
        return None

    message_books = []
    needs_insight = []
    for book in newly_completed:
        insight = library_service.get_book_insight(book)
        if not insight:
            insight = {"points": [], "pending": True}
            needs_insight.append((len(message_books), book))
        review_url = _review_url_for_book(book)
        msg_book = dict(book)
        msg_book["review_url"] = review_url
        message_books.append({
            "book": msg_book,
            "insight": insight,
        })

    created_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    sync_summary = _sync_summary(current_payloads, len(message_books), errors)
    message = {
        "id": str(uuid.uuid4()),
        "type": "sync_result",
        "title": f"データ同期 新規読了{len(message_books)}冊",
        "created_at": created_at,
        "books": message_books,
        "source_groups": _message_source_groups(message_books),
        "sync_summary": sync_summary,
        "ai_status": "pending" if needs_insight else "complete",
    }
    message["body"] = _message_text_for_completed_books(message_books, sync_summary)
    message["ios_sent"] = False
    library_service.save_yonda_message(message)

    # 同期結果は先に保存し、時間のかかるAI生成は生成できた分から同じメッセージへ反映する。
    for idx, book in needs_insight:
        try:
            insight = library_service.save_book_insight(book, _generate_book_insight(book))
        except Exception as e:
            logger.warning("書評ポイント生成に失敗: %s", e, exc_info=True)
            insight = {"points": [], "error": str(e)}
        message_books[idx]["insight"] = insight
        message["books"] = message_books
        message["source_groups"] = _message_source_groups(message_books)
        message["body"] = _message_text_for_completed_books(message_books, sync_summary)
        library_service.update_yonda_message(message)

    message["ai_status"] = "complete"
    message["ios_sent"] = _send_ios_message_webhook(message) if message_books else False
    return library_service.update_yonda_message(message)


def _create_audible_completed_message(previous_payload: dict | None, current_payload: dict | None) -> dict | None:
    """互換用: Audible単体更新でも同じメッセージ生成を使う。"""
    return _create_completed_books_message(
        {"audible_jp": previous_payload},
        {"audible_jp": current_payload},
    )


@app.route("/api/fetch", methods=["POST"])
def api_fetch():
    """指定ソースから読書記録を取得・保存し、全ソース統合データを返す。
    Kindle で OTP が必要な場合は needs_otp, session_id を返す。"""
    try:
        body = request.get_json(silent=True) or {}
        library_id = body.get("library_id", "setagaya")
        session_id = body.get("session_id", "")
        otp = (body.get("otp") or "").strip()
        notify_completed = bool(body.get("notify_completed"))

        if library_id == "kindle":
            return _api_fetch_kindle(session_id, otp)
        if library_id == "all":
            errors = {}
            synced_libraries = ["setagaya", "audible_jp", "kindle"]
            previous_payloads = {
                lid: library_service.load_saved_for(lid)
                for lid in synced_libraries
            } if notify_completed else {}
            current_payloads = {}
            for lid in ["setagaya", "audible_jp"]:
                try:
                    payload = library_service.fetch_and_save(lid)
                    current_payloads[lid] = payload
                except Exception as e:
                    errors[lid] = str(e)
            try:
                if library_service.try_auto_fetch_kindle():
                    current_payloads["kindle"] = library_service.load_saved_for("kindle")
            except Exception as e:
                errors["kindle"] = str(e)
                logger.warning("Kindle 自動取得エラー: %s", e)
            combined = library_service.load_saved()
            result = {"success": True, **(combined or {})}
            if notify_completed:
                message_payloads = dict(current_payloads)
                for lid in synced_libraries:
                    if lid not in message_payloads:
                        message_payloads[lid] = previous_payloads.get(lid) or library_service.load_saved_for(lid)
                message = _create_completed_books_message(previous_payloads, message_payloads, errors)
                if message:
                    result["message"] = message
            if errors:
                result["errors"] = errors
            # 同期後にバックグラウンドでinsights未生成の本を補完（最大5冊/回）
            import threading
            threading.Thread(
                target=_backfill_missing_insights,
                kwargs={"max_books": 5},
                daemon=False,
                name="insights-backfill",
            ).start()
            # 図書館本のジャンル・概要未設定を自動補完（最大5冊/回）
            threading.Thread(
                target=_backfill_library_genre,
                daemon=False,
                name="library-genre-backfill",
            ).start()
            # Kindle本のジャンル・概要未設定を自動補完（最大5冊/回）
            threading.Thread(
                target=_backfill_library_genre,
                kwargs={"library_id": "kindle"},
                daemon=False,
                name="kindle-genre-backfill",
            ).start()
            return jsonify(result)
        previous_audible = (
            library_service.load_saved_for(library_id)
            if notify_completed
            else None
        )
        payload = library_service.fetch_and_save(library_id)
        combined = library_service.load_saved()
        result = {"success": True, **(combined or {})}
        if notify_completed:
            message = _create_completed_books_message({library_id: previous_audible}, {library_id: payload})
            if message:
                result["message"] = message
        if library_id == "setagaya":
            import threading
            threading.Thread(
                target=_backfill_library_genre,
                daemon=False,
                name="library-genre-backfill",
            ).start()
        return jsonify(result)
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
        import threading
        threading.Thread(
            target=_backfill_library_genre,
            kwargs={"library_id": "kindle"},
            daemon=False,
            name="kindle-genre-backfill",
        ).start()
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
        # OTP認証成功後もセッションを保存（次回自動取得時に再利用）
        adapter.save_session(session)
        combined = library_service.save_kindle_records_and_load(records)
        import threading
        threading.Thread(
            target=_backfill_library_genre,
            kwargs={"library_id": "kindle"},
            daemon=False,
            name="kindle-genre-backfill",
        ).start()
        return jsonify({"success": True, **combined})

    # 初回: セッション再利用を試してからログイン
    session = requests.Session()
    session.headers.update({
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        ),
        "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
    })
    adapter = KindleAdapter()

    # 1. 保存済みセッションを試す
    session_loaded = adapter.load_session(session)
    session_valid = False
    if session_loaded:
        logger.info("保存済みセッションを検証中...")
        session_valid = adapter.verify_session(session)

    # 2. セッションが有効ならそのまま使う
    if session_valid:
        logger.info("保存済みセッションを使用してデータ取得")
        records = adapter.fetch_history(session)
        combined = library_service.save_kindle_records_and_load(records)
        import threading
        threading.Thread(
            target=_backfill_library_genre,
            kwargs={"library_id": "kindle"},
            daemon=False,
            name="kindle-genre-backfill",
        ).start()
        return jsonify({"success": True, **combined})

    # 3. セッションが無効なら再ログイン
    logger.info("セッションが無効なため、再ログイン")
    creds_obj = LibraryCredentials(user_id=creds["user_id"], password=creds["password"])
    ok, needs_otp, otp_page_html = adapter._login_amazon(session, creds_obj)
    if ok:
        records = adapter.fetch_history(session)
        # ログイン成功時もセッションを保存（次回自動取得時に再利用）
        adapter.save_session(session)
        combined = library_service.save_kindle_records_and_load(records)
        import threading
        threading.Thread(
            target=_backfill_library_genre,
            kwargs={"library_id": "kindle"},
            daemon=False,
            name="kindle-genre-backfill",
        ).start()
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


def _trim_text(text: str, limit: int = 900) -> str:
    text = re.sub(r"\s+", " ", (text or "")).strip()
    return text[:limit]


def _sanitize_json_strings(text: str) -> str:
    """JSON文字列値内のリテラル制御文字（改行・タブ等）をエスケープして合法的なJSONに修正する。"""
    result = []
    in_string = False
    escaped = False
    for ch in text:
        if escaped:
            result.append(ch)
            escaped = False
        elif ch == "\\" and in_string:
            result.append(ch)
            escaped = True
        elif ch == '"':
            result.append(ch)
            in_string = not in_string
        elif in_string and ch == "\n":
            result.append("\\n")
        elif in_string and ch == "\r":
            result.append("\\r")
        elif in_string and ch == "\t":
            result.append("\\t")
        else:
            result.append(ch)
    return "".join(result)


def _extract_json_object(text: str) -> dict:
    """AI応答からJSONオブジェクト部分を取り出す。不完全なJSONも修復を試みる。"""
    text = (text or "").strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.IGNORECASE | re.MULTILINE).strip()
    # 1. 標準パース
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # 2. {...} の最外殻を抽出して再試行
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        candidate = text[start:end + 1]
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            pass
        # 3. リテラル制御文字を修正して再試行
        try:
            return json.loads(_sanitize_json_strings(candidate))
        except json.JSONDecodeError:
            pass
    raise json.JSONDecodeError("JSONの抽出に失敗しました", text, 0)


def _fetch_book_context_from_internet(book: dict) -> list[dict]:
    """書評・レビューを優先し、足りない場合は信頼できる概要情報も要約材料にする。"""
    title = (book.get("title") or "").strip()
    author = (book.get("author") or "").strip()
    query = " ".join(x for x in [title, author] if x)
    if not query:
        return []

    session = requests.Session()
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (compatible; YondaBot/1.0; +https://github.com/ktrips/yonda)",
        "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
    })
    sources: list[dict] = []

    # DuckDuckGo HTML検索: 第三者の書評・評判・感想ページのタイトルとスニペットだけ利用する
    try:
        from bs4 import BeautifulSoup

        search_queries = [
            f'"{title}" "{author}" 書評 レビュー 評判 感想' if author else f'"{title}" 書評 レビュー 評判 感想',
            f'"{title}" 読後感 口コミ おすすめ 評価',
            f'"{title}" book review impression reputation',
        ]
        review_keywords = ("書評", "レビュー", "評判", "感想", "口コミ", "評価", "読後", "おすすめ", "review", "impression")
        for search_query in search_queries:
            r = session.get(
                "https://duckduckgo.com/html/",
                params={"q": search_query},
                timeout=15,
            )
            r.raise_for_status()
            soup = BeautifulSoup(r.text, "lxml")
            for result in soup.select(".result")[:8]:
                a = result.select_one(".result__a")
                snippet = result.select_one(".result__snippet")
                if not a or not snippet:
                    continue
                result_title = a.get_text(" ", strip=True)
                text = _trim_text(snippet.get_text(" ", strip=True), 550)
                combined = f"{result_title} {text}".lower()
                if not text or not any(k.lower() in combined for k in review_keywords):
                    continue
                sources.append({
                    "title": result_title,
                    "url": a.get("href") or "",
                    "text": text,
                    "source_type": "review",
                })
    except Exception:
        logger.debug("書評・評判スニペットの取得に失敗", exc_info=True)

    # Wikipedia: 書評が見つからない本でも、作品背景や主題を補助情報として使う
    try:
        search_terms = [f"{title} {author}".strip(), title]
        page_id = None
        for search_term in search_terms:
            r = session.get(
                "https://ja.wikipedia.org/w/api.php",
                params={
                    "action": "query",
                    "list": "search",
                    "srsearch": search_term,
                    "format": "json",
                    "utf8": 1,
                    "srlimit": 3,
                },
                timeout=12,
            )
            r.raise_for_status()
            for item in r.json().get("query", {}).get("search", []):
                page_title = item.get("title") or ""
                if title and title.replace(" ", "") not in page_title.replace(" ", ""):
                    continue
                page_id = item.get("pageid")
                break
            if page_id:
                break
        if page_id:
            r = session.get(
                "https://ja.wikipedia.org/w/api.php",
                params={
                    "action": "query",
                    "prop": "extracts|info",
                    "pageids": page_id,
                    "exintro": 1,
                    "explaintext": 1,
                    "inprop": "url",
                    "format": "json",
                    "utf8": 1,
                },
                timeout=12,
            )
            r.raise_for_status()
            page = next(iter(r.json().get("query", {}).get("pages", {}).values()), {})
            extract = _trim_text(page.get("extract") or "", 900)
            if extract:
                sources.append({
                    "title": f"Wikipedia: {page.get('title') or title}",
                    "url": page.get("fullurl") or "",
                    "text": extract,
                    "source_type": "reference",
                })
    except Exception:
        logger.debug("Wikipedia情報の取得に失敗", exc_info=True)

    # 出版社・公式ページ: レビューではないため、内容・特徴の補助情報として扱う
    try:
        from bs4 import BeautifulSoup

        official_queries = [
            f'"{title}" "{author}" 出版社 公式' if author else f'"{title}" 出版社 公式',
            f'"{title}" 書籍 公式 内容 著者',
        ]
        official_keywords = ("出版社", "公式", "書籍", "著者", "内容", "紹介", "版元", "publisher", "book")
        for search_query in official_queries:
            r = session.get(
                "https://duckduckgo.com/html/",
                params={"q": search_query},
                timeout=15,
            )
            r.raise_for_status()
            soup = BeautifulSoup(r.text, "lxml")
            for result in soup.select(".result")[:5]:
                a = result.select_one(".result__a")
                snippet = result.select_one(".result__snippet")
                if not a or not snippet:
                    continue
                result_title = a.get_text(" ", strip=True)
                text = _trim_text(snippet.get_text(" ", strip=True), 550)
                combined = f"{result_title} {text}".lower()
                if not text or not any(k.lower() in combined for k in official_keywords):
                    continue
                sources.append({
                    "title": result_title,
                    "url": a.get("href") or "",
                    "text": text,
                    "source_type": "official",
                })
    except Exception:
        logger.debug("出版社・公式ページ情報の取得に失敗", exc_info=True)

    # Google Books: 出版社概要やカテゴリを補助情報として使う
    try:
        r = session.get(
            "https://www.googleapis.com/books/v1/volumes",
            params={
                "q": f"intitle:{title} inauthor:{author}" if author else f"intitle:{title}",
                "maxResults": 5,
                "langRestrict": "ja",
            },
            timeout=12,
        )
        r.raise_for_status()
        for item in r.json().get("items", [])[:3]:
            info = item.get("volumeInfo", {})
            desc = info.get("description") or ""
            parts = [
                desc,
                f"出版社: {info.get('publisher')}" if info.get("publisher") else "",
                f"カテゴリ: {', '.join(info.get('categories') or [])}" if info.get("categories") else "",
            ]
            text = _trim_text(" ".join(p for p in parts if p), 900)
            if text:
                sources.append({
                    "title": f"Google Books: {info.get('title') or title}",
                    "url": info.get("infoLink") or "",
                    "text": text,
                    "source_type": "bibliographic",
                })
                break
    except Exception:
        logger.debug("Google Books情報の取得に失敗", exc_info=True)

    # Open Library: 英語圏情報しかない本の補助
    try:
        r = session.get(
            "https://openlibrary.org/search.json",
            params={"title": title, "author": author, "limit": 3},
            timeout=12,
        )
        r.raise_for_status()
        for doc in r.json().get("docs", [])[:3]:
            work_key = (doc.get("key") or "").strip()
            if not work_key:
                continue
            r2 = session.get(f"https://openlibrary.org{work_key}.json", timeout=12)
            r2.raise_for_status()
            work = r2.json()
            desc = work.get("description") or ""
            if isinstance(desc, dict):
                desc = desc.get("value") or ""
            subjects = ", ".join((work.get("subjects") or [])[:8])
            text = _trim_text(" ".join(x for x in [desc, f"Subjects: {subjects}" if subjects else ""] if x), 900)
            if text:
                sources.append({
                    "title": f"Open Library: {work.get('title') or doc.get('title') or title}",
                    "url": f"https://openlibrary.org{work_key}",
                    "text": text,
                    "source_type": "bibliographic",
                })
                break
    except Exception:
        logger.debug("Open Library情報の取得に失敗", exc_info=True)

    # 最終フォールバック: 外部取得が全滅しても、Yonda内の本データから生成を継続する
    metadata_parts = [
        f"タイトル: {title}" if title else "",
        f"著者: {author}" if author else "",
        f"ジャンル: {book.get('genre')}" if book.get("genre") else "",
        f"概要: {book.get('full_summary') or book.get('summary')}" if (book.get("full_summary") or book.get("summary")) else "",
        f"コメント: {book.get('comment')}" if book.get("comment") else "",
        f"詳細URL: {book.get('detail_url')}" if book.get("detail_url") else "",
        f"識別子: {book.get('catalog_number') or book.get('asin')}" if (book.get("catalog_number") or book.get("asin")) else "",
    ]
    metadata_text = _trim_text(" ".join(p for p in metadata_parts if p), 900)
    if metadata_text:
        sources.append({
            "title": "Yonda内の本データ",
            "url": book.get("detail_url") or "",
            "text": metadata_text,
            "source_type": "book_metadata",
        })

    seen = set()
    unique = []
    for src in sources:
        key = (src.get("url") or src.get("title") or "").strip()
        if key and key not in seen:
            seen.add(key)
            unique.append(src)
    return unique[:10]


def _call_text_ai(prompt: str, max_tokens: int = 2200, temperature: float = 0.2, json_mode: bool = False) -> tuple[str, str, str]:
    """既存AI設定を使ってテキスト生成する。戻り値: (text, provider, model)。"""
    cfg = _load_ai_config()
    api_key = (cfg.get("api_key") or "").strip()
    provider = (cfg.get("provider") or "gemini").lower()
    if not api_key:
        raise ValueError("AI設定が未設定です。設定メニューからAPIキーを登録してください")

    if provider == "openai":
        payload = {
            "model": "gpt-4o-mini",
            "messages": [{"role": "user", "content": prompt}],
            "max_completion_tokens": max_tokens,
        }
        if json_mode:
            payload["response_format"] = {"type": "json_object"}
        r = requests.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json=payload,
            timeout=90,
        )
        r.raise_for_status()
        text = (r.json().get("choices", [{}])[0].get("message", {}).get("content") or "").strip()
        return text, provider, "gpt-4o-mini"

    models_to_try = ["gemini-2.0-flash-lite", "gemini-2.0-flash", "gemini-2.5-flash"]
    last_err = None
    safety_settings = [
        {"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE"},
        {"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE"},
        {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE"},
        {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE"},
    ]
    for model in models_to_try:
        try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
            gen_config: dict = {"maxOutputTokens": max_tokens, "temperature": temperature}
            if json_mode:
                gen_config["response_mime_type"] = "application/json"
            payload = {
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": gen_config,
                "safetySettings": safety_settings,
            }
            r = requests.post(url, json=payload, timeout=90)
            r.raise_for_status()
            candidates = r.json().get("candidates", [])
            parts = candidates[0].get("content", {}).get("parts", []) if candidates else []
            text = (parts[0].get("text", "") if parts else "").strip()
            if text:
                return text, provider, model
        except requests.RequestException as e:
            last_err = e
            continue
    if last_err:
        raise last_err
    raise RuntimeError("AIが応答を生成できませんでした")


def _generate_book_insight(book: dict) -> dict:
    title = (book.get("title") or "").strip()
    author = (book.get("author") or "").strip()
    if not title:
        raise ValueError("本のタイトルが必要です")

    sources = _fetch_book_context_from_internet(book)
    if not sources:
        raise RuntimeError("インターネット上の参考情報を取得できませんでした")

    source_text = "\n\n".join(
        f"[{i + 1}] 種類: {src.get('source_type', 'reference')}\n"
        f"タイトル: {src.get('title', '')}\nURL: {src.get('url', '')}\n内容: {src.get('text', '')}"
        for i, src in enumerate(sources)
    )
    prompt = f"""次の本について、インターネット上の参考情報をもとに、書評ポイントを5点に要約してください。

本:
タイトル: {title}
著者: {author or "不明"}

参考情報:
{source_text}

要件:
- 日本語で出力する
- 重要な情報を必ず5点
- 各ポイントの本文は必ず200字以内に要約する
- 1ポイントには1つの重要な観点だけを書く
- review の参考情報がある場合は、第三者の視点で評価されている点、評判、読後感、実用性、賛否を優先する
- reference / official / bibliographic の参考情報は、作品背景・主題・内容の特徴・読む前に役立つ観点として扱う
- book_metadata しかない場合は、外部書評が見つからなかった前提で、タイトル・著者・ジャンル等から読みどころや確認観点を控えめに整理する
- 出版社や公式ページの内容を「評判」「読者評価」として断定しない
- Wikipedia等の概要情報だけの場合は、評価ではなく客観的な理解ポイントとして書く
- Yonda内の本データだけから読者評価や世評を断定しない
- 参考情報にない一般的な知識や推測で補完しない
- 公式のあらすじ・出版社紹介・書誌情報の丸写しは禁止。要点を自分の言葉で要約する
- 参考情報の丸写しは禁止。自分の言葉で要約する
- 本文・レビューの長い引用は禁止
- 不明な情報は断定しない
- 出力はJSONのみ。前置きやMarkdownは禁止

JSON形式:
{{
  "points": [
    {{
      "heading": "20字以内の見出し",
      "text": "200字以内の要約",
      "source_url": "最も関連する参考URL"
    }}
  ]
}}"""
    text, provider, model = _call_text_ai(prompt, max_tokens=4096, json_mode=True)
    data = _extract_json_object(text)
    points = data.get("points") if isinstance(data, dict) else None
    if not isinstance(points, list):
        raise RuntimeError("AI応答の形式が正しくありません")

    cleaned = []
    for point in points[:5]:
        if not isinstance(point, dict):
            continue
        heading = _trim_text(point.get("heading") or "ポイント", 40)
        body = _trim_text(point.get("text") or "", 220)
        body = re.sub(r'^(本書[はでにを]、?|この本[はでにを]、?|著者[はが]、?)', '', body).strip()
        if len(body) > 200:
            body = body[:200]
        if body:
            cleaned.append({
                "heading": heading,
                "text": body,
                "source_url": (point.get("source_url") or "").strip(),
            })
    if len(cleaned) < 5:
        raise RuntimeError("AIが5点のポイントを生成できませんでした")

    from datetime import datetime, timezone
    return {
        "title": title,
        "author": author,
        "points": cleaned[:5],
        "sources": [
            {"title": s.get("title", ""), "url": s.get("url", ""), "source_type": s.get("source_type", "reference")}
            for s in sources
            if s.get("url")
        ][:8],
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "provider": provider,
        "model": model,
    }


@app.route("/api/book-insights", methods=["GET", "POST"])
def api_book_insight_get():
    """保存済みの書評ポイントを返す。"""
    if request.method == "GET":
        return jsonify({"success": True, **library_service.load_book_insights()})
    body = request.get_json(silent=True) or {}
    book = body.get("book") or body
    insight = library_service.get_book_insight(book)
    return jsonify({"success": True, "insight": insight})


@app.route("/api/book-insights/generate", methods=["POST"])
def api_book_insight_generate():
    """指定本の書評ポイントをAI生成して保存する。"""
    body = request.get_json(silent=True) or {}
    book = body.get("book") or {}
    try:
        insight = _generate_book_insight(book)
        insight = library_service.save_book_insight(book, insight)
        return jsonify({"success": True, "insight": insight})
    except ValueError as e:
        return jsonify({"success": False, "error": str(e)}), 400
    except requests.RequestException as e:
        err = str(e)
        if getattr(e, "response", None) is not None:
            try:
                err = e.response.json().get("error", {}).get("message", err)
            except Exception:
                pass
        return jsonify({"success": False, "error": err}), 502
    except Exception as e:
        logger.warning("書評ポイント生成に失敗: %s", e, exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/book-insights/save", methods=["POST"])
def api_book_insight_save():
    """書評ポイントを手入力で保存する。"""
    body = request.get_json(silent=True) or {}
    book = body.get("book") or {}
    points = body.get("points") or []
    title = (book.get("title") or "").strip()
    author = (book.get("author") or "").strip()
    if not title:
        return jsonify({"success": False, "error": "本のタイトルが必要です"}), 400
    if not isinstance(points, list):
        return jsonify({"success": False, "error": "points は配列で指定してください"}), 400

    cleaned = []
    for point in points[:5]:
        if not isinstance(point, dict):
            continue
        heading = _trim_text(point.get("heading") or "ポイント", 40)
        text = _trim_text(point.get("text") or "", 220)
        if len(text) > 200:
            text = text[:200]
        if text:
            cleaned.append({
                "heading": heading,
                "text": text,
                "source_url": "",
            })
    if not cleaned:
        return jsonify({"success": False, "error": "書評ポイントを1件以上入力してください"}), 400

    from datetime import datetime, timezone
    insight = library_service.save_book_insight(book, {
        "title": title,
        "author": author,
        "points": cleaned,
        "sources": [],
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "provider": "manual",
        "model": "manual",
    })
    return jsonify({"success": True, "insight": insight})


def _backfill_missing_insights(max_books: int = 10) -> dict:
    """insights未生成の読了本にAI書評を自動生成するバックフィル処理。
    同期や定期ジョブから呼び出される。"""
    candidates = library_service.get_completed_books_without_insights(max_count=max_books * 3)
    processed = 0
    skipped = 0
    errors = 0
    for book in candidates:
        if processed >= max_books:
            break
        # ループ中に他のリクエストが生成済みにした場合はスキップ
        if library_service.get_book_insight(book):
            skipped += 1
            continue
        try:
            insight = _generate_book_insight(book)
            library_service.save_book_insight(book, insight)
            processed += 1
            logger.info("バックフィル書評生成完了: %s", book.get("title", "—"))
        except Exception as e:
            errors += 1
            logger.warning("バックフィル書評生成エラー [%s]: %s", book.get("title", "—"), e)
    remaining = library_service.get_completed_books_without_insights(max_count=1)
    logger.info("バックフィル完了 processed=%d skipped=%d errors=%d remaining=%s",
                processed, skipped, errors, "1+" if remaining else "0")
    return {"processed": processed, "skipped": skipped, "errors": errors,
            "has_remaining": bool(remaining)}


def _backfill_library_genre(library_id: str = "setagaya", max_books: int = 5) -> None:
    """fetchの後バックグラウンドで呼ばれ、ジャンル・概要未設定の図書館本を補完する。"""
    try:
        result = library_service.enrich_library_books_missing_genre(
            library_id=library_id, max_books=max_books
        )
        still_missing = [b for b in result.get("books", []) if not b.get("genre")]
        ai_updated = 0
        if still_missing:
            ai_updated = _enrich_missing_books_with_ai(library_id, still_missing)
        logger.info(
            "library-genre-backfill: updated=%d ai_updated=%d skipped=%d errors=%d",
            result.get("updated", 0),
            ai_updated,
            result.get("skipped", 0),
            result.get("errors", 0),
        )
    except Exception as e:
        logger.warning("library-genre-backfill エラー: %s", e, exc_info=True)


@app.route("/api/add-paper-book", methods=["POST"])
def api_add_paper_book():
    """紙の本を既読として登録する。ジャンル・概要が未設定なら Google Books / AI で補完。"""
    try:
        body = request.get_json(silent=True) or {}
        title = (body.get("title") or "").strip()
        if not title:
            return jsonify({"success": False, "error": "タイトルは必須です"}), 400

        author   = (body.get("author") or "").strip()
        cover_url = (body.get("cover_url") or "").strip()
        summary  = (body.get("summary") or "").strip()
        genre    = (body.get("genre") or "").strip()
        completed_date = (body.get("completed_date") or "").strip()
        if not completed_date:
            import pytz
            jst = pytz.timezone("Asia/Tokyo")
            completed_date = datetime.now(jst).strftime("%Y-%m-%dT%H:%M:%S+09:00")

        # ── Google Books で表紙・概要・ジャンル補完 ──
        needs_cover   = not cover_url
        needs_summary = not summary
        needs_genre   = not genre
        if needs_cover or needs_summary or needs_genre:
            q = f"{title} {author}".strip()
            gb_result = _fetch_book_info_with_genre(q, want_title=title, want_author=author)
            if gb_result:
                if needs_cover and gb_result.get("cover_url"):
                    cover_url = gb_result["cover_url"]
                if needs_summary and gb_result.get("summary"):
                    raw = gb_result["summary"].strip()
                    raw = re.sub(r"^(本書[はでにをも]、?|この本[はでにをも]、?|著者[はが]、?)", "", raw).strip()
                    summary = raw
                if needs_genre and gb_result.get("genre"):
                    genre = gb_result["genre"]

        # ── まだ不足なら AI で補完 ──
        if (not genre or not summary) and title:
            tmp_book = {"title": title, "author": author, "genre": genre, "summary": summary}
            ai_result = _enrich_missing_books_with_ai("paper", [tmp_book])
            # ai_result は件数(int)なのでファイルから再取得
            paper_path = library_service._json_path_for("paper")
            if paper_path.exists():
                import json as _json
                pd = _json.load(open(paper_path, encoding="utf-8"))
                for b in pd.get("books", []):
                    if b.get("title") == title:
                        genre   = genre   or b.get("genre", "")
                        summary = summary or b.get("full_summary") or b.get("summary", "")
                        break

        book_record = {
            "title":          title,
            "author":         author,
            "cover_url":      cover_url,
            "summary":        (summary[:100] + "…" if len(summary) > 100 else summary) if summary else "",
            "full_summary":   summary,
            "genre":          genre,
            "source":         "paper",
            "completed":      True,
            "completed_date": completed_date,
            "loan_date":      completed_date[:10],
            "rating":         0,
            "comment":        "",
            "favorite":       False,
        }

        result = library_service.add_paper_book(book_record)
        if result.get("duplicate"):
            return jsonify({"success": False, "duplicate": True, "error": "同じ本がすでに登録されています", "book": result["book"]})

        combined = library_service.load_saved()
        return jsonify({"success": True, "book": result["book"], **(combined or {})})
    except Exception as e:
        logger.warning("api_add_paper_book エラー: %s", e, exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


def _fetch_book_info_with_genre(q: str, want_title: str = "", want_author: str = "") -> dict | None:
    """Google Books から表紙URL・概要・ジャンルを一括取得"""
    try:
        params = {"q": q[:100], "maxResults": 5}
        google_api_key = library_service._get_google_api_key()
        if google_api_key:
            params["key"] = google_api_key
        r = requests.get("https://www.googleapis.com/books/v1/volumes", params=params, timeout=8)
        r.raise_for_status()
        data = r.json()
        for item in data.get("items", []):
            vi = item.get("volumeInfo", {})
            links = vi.get("imageLinks", {})
            cover = links.get("thumbnail") or links.get("smallThumbnail") or ""
            if cover:
                cover = cover.replace("http://", "https://")
            desc = vi.get("description", "")
            cats = vi.get("categories", [])
            genre = " / ".join(cats) if cats else ""
            return {"cover_url": cover, "summary": desc[:300] if desc else "", "genre": genre}
    except Exception as e:
        logger.debug("_fetch_book_info_with_genre エラー: %s", e)
    return None


@app.route("/api/enrich", methods=["POST"])
def api_enrich():
    """書籍データ一括エンリッチ: insights/genre/summary 補完。
    Cloud Scheduler の週次ジョブから呼び出される。"""
    try:
        body = request.get_json(silent=True) or {}
        max_books = int(body.get("max_books", 50))
        result = _backfill_missing_insights(max_books=max_books)
        return jsonify({"success": True, **result})
    except Exception as e:
        logger.warning("api_enrich エラー: %s", e, exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/enrich-library-genre", methods=["POST"])
def api_enrich_library_genre():
    """図書館本のジャンル・概要が未設定の直近N冊を補完する。
    Open Library / Google Books API 取得後、取れなかった本は AI で推定する。"""
    try:
        body = request.get_json(silent=True) or {}
        library_id = body.get("library_id", "setagaya")
        max_books = int(body.get("max_books", 10))

        result = library_service.enrich_library_books_missing_genre(
            library_id=library_id, max_books=max_books
        )

        # 外部 API で取得できなかった本を AI で補完
        still_missing = [b for b in result.get("books", []) if not b.get("genre")]
        if still_missing:
            ai_updated = _enrich_missing_books_with_ai(library_id, still_missing)
            result["ai_updated"] = ai_updated
            result["updated"] = result.get("updated", 0) + ai_updated

        return jsonify({"success": True, **result})
    except Exception as e:
        logger.warning("api_enrich_library_genre エラー: %s", e, exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


def _enrich_missing_books_with_ai(library_id: str, books_summary: list[dict]) -> int:
    """タイトルリストを受け取り、AI でジャンル・概要を推定して JSON ファイルに書き戻す。"""
    path = library_service._json_path_for(library_id)
    if not path.exists():
        return 0
    with open(path, encoding="utf-8") as f:
        payload = json.load(f)

    books_data: list[dict] = payload.get("books", [])
    title_index = {b.get("title", ""): b for b in books_data}

    cfg = _load_ai_config()
    api_key = (cfg.get("api_key") or "").strip()
    if not api_key:
        logger.warning("AI設定が未設定のためジャンル推定をスキップ")
        return 0

    updated = 0
    for summary_book in books_summary:
        title = summary_book.get("title", "")
        book = title_index.get(title)
        if not book:
            continue
        author = (book.get("author") or "").strip()
        needs_summary = not (book.get("full_summary") or book.get("summary") or "").strip()
        needs_genre = not (book.get("genre") or "").strip()
        if not needs_genre and not needs_summary:
            continue

        prompt = f"""次の本のジャンルと概要を日本語で推定してください。

書名: {title}
著者: {author or "不明"}

JSONのみ出力してください。前置きや説明は不要です。
概要は「本書は」「本書では」「この本は」などの書き出しを使わず、内容を直接述べてください。

{{
  "genre": "ジャンル（例: 科学・工学 / 一般向け科学 など）",
  "summary": "200字以内の概要"
}}"""
        try:
            text, _, _ = _call_text_ai(prompt, max_tokens=512, json_mode=True)
            data = _extract_json_object(text)
            if not isinstance(data, dict):
                continue
            if needs_genre and data.get("genre"):
                book["genre"] = data["genre"].strip()
            if needs_summary and data.get("summary"):
                s = data["summary"].strip()
                s = re.sub(r'^(本書[はでにを]、?|この本[はでにを]、?|著者[はが]、?)', '', s).strip()
                book["full_summary"] = s
                book["summary"] = s[:100] + "…" if len(s) > 100 else s
            updated += 1
            logger.info("AI ジャンル推定: %s → %s", title[:30], book.get("genre"))
        except Exception as e:
            logger.warning("AI ジャンル推定エラー [%s]: %s", title[:30], e)

    if updated:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        logger.info("AI 補完 %d 件保存: %s", updated, library_id)

    return updated


@app.route("/api/messages", methods=["GET"])
def api_messages():
    """Yonda内メッセージ一覧を返す。同期のタイミングで古いメッセージを自動アーカイブ。"""
    library_service.archive_old_messages(months=3)
    return jsonify({"success": True, **library_service.load_yonda_messages()})


@app.route("/api/messages/<message_id>", methods=["DELETE"])
def api_message_delete(message_id: str):
    """指定IDのメッセージを削除する。"""
    deleted = library_service.delete_yonda_message(message_id)
    return jsonify({"success": deleted})


@app.route("/api/libraries")
def api_libraries():
    """対応図書館一覧"""
    return jsonify({"success": True, "libraries": library_service.get_available_libraries()})


# ------------------------------------------------------------------
# Amazon ほしいものリスト
# ------------------------------------------------------------------

@app.route("/api/amazon-list", methods=["GET"])
def api_amazon_list_get():
    """Amazon ほしいものリストを返す"""
    return jsonify(library_service.load_amazon_list())


@app.route("/api/amazon-list", methods=["POST"])
def api_amazon_list_add():
    """Amazon ほしいものリストに本を追加する"""
    body = request.get_json(silent=True) or {}
    title = (body.get("title") or "").strip()
    if not title:
        return jsonify({"success": False, "error": "title は必須です"}), 400

    author = (body.get("author") or "").strip()
    asin = (body.get("asin") or "").strip()
    cover_url = (body.get("cover_url") or "").strip()

    import hashlib
    entry_id = asin if asin else hashlib.md5(f"{title}__{author}".encode()).hexdigest()[:12]

    data = library_service.load_amazon_list()
    books = data.get("books", [])

    if any(b.get("id") == entry_id for b in books):
        return jsonify({"success": True, "already_exists": True, "id": entry_id})

    from datetime import date
    books.append({
        "id": entry_id,
        "title": title,
        "author": author,
        "asin": asin,
        "cover_url": cover_url,
        "added_date": date.today().isoformat(),
    })
    library_service.save_amazon_list(books)
    return jsonify({"success": True, "id": entry_id})


@app.route("/api/amazon-list/<entry_id>", methods=["DELETE"])
def api_amazon_list_delete(entry_id: str):
    """Amazon ほしいものリストから本を削除する"""
    data = library_service.load_amazon_list()
    books = [b for b in data.get("books", []) if b.get("id") != entry_id]
    library_service.save_amazon_list(books)
    return jsonify({"success": True})


_DOWNLOAD_MAP = {
    "setagaya":   ("library_books.json",  "library_books.json"),
    "audible_jp": ("audible_books.json",  "audible_books.json"),
    "kindle":     ("kindle_books.json",   "kindle_books.json"),
}

@app.route("/api/download/<library_id>")
def api_download_books(library_id: str):
    """保存済みの _books.json をダウンロードする（ログイン済みのみ）"""
    if library_id not in _DOWNLOAD_MAP:
        return jsonify({"success": False, "error": "不明なソースです"}), 400
    if not library_service.has_credentials(library_id):
        return jsonify({"success": False, "error": "認証情報が設定されていません"}), 403
    data_filename, download_name = _DOWNLOAD_MAP[library_id]
    data_path = library_service.DATA_DIR / data_filename
    if not data_path.exists():
        return jsonify({"success": False, "error": "データファイルがまだ存在しません。先に「読書記録を取込み」を実行してください"}), 404
    return send_file(
        data_path,
        mimetype="application/json",
        as_attachment=True,
        download_name=download_name,
    )


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
            # ログイン成功時もセッションを保存（次回自動取得時に再利用）
            adapter.save_session(session)
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
            # OTP認証成功時もセッションを保存（次回自動取得時に再利用）
            adapter.save_session(session)
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


# ===========================================================================
# /api/v1/books — 読書記録アクセス API
# ===========================================================================

@app.route("/api/v1/books")
def api_v1_books():
    """読書記録を条件でフィルタリングして返す

    Query params:
      status   : read | unread | in_progress | all (default: all)
      source   : kindle | audible_jp | setagaya | all (default: all)
      q        : タイトル・著者の部分一致検索
      sort     : loan_date_desc (default) | completed_date_desc | percent_desc | title_asc
      limit    : 1–200 (default: 50)
      offset   : default 0
    """
    try:
        data = library_service.load_saved()
        books = data.get("books", []) if data else []

        status = request.args.get("status", "all").strip().lower()
        source = request.args.get("source", "all").strip().lower()
        q = request.args.get("q", "").strip().lower()
        sort = request.args.get("sort", "loan_date_desc").strip().lower()
        try:
            limit = min(int(request.args.get("limit", 50)), 200)
            offset = max(int(request.args.get("offset", 0)), 0)
        except ValueError:
            return jsonify({"success": False, "error": "limit/offset は整数で指定してください"}), 400

        # ソースフィルタ
        if source != "all":
            books = [b for b in books if b.get("source") == source]

        # 状態フィルタ
        if status == "read":
            books = [b for b in books if b.get("completed")]
        elif status == "unread":
            books = [b for b in books if not b.get("completed") and (b.get("percent_complete") or 0) == 0]
        elif status == "in_progress":
            books = [b for b in books if not b.get("completed") and (b.get("percent_complete") or 0) > 0]

        # テキスト検索
        if q:
            books = [
                b for b in books
                if q in (b.get("title") or "").lower()
                or q in (b.get("author") or "").lower()
            ]

        # ソート
        if sort == "completed_date_desc":
            books = sorted(books, key=lambda b: b.get("completed_date") or "", reverse=True)
        elif sort == "percent_desc":
            books = sorted(books, key=lambda b: b.get("percent_complete") or 0, reverse=True)
        elif sort == "title_asc":
            books = sorted(books, key=lambda b: (b.get("title") or "").lower())
        else:  # loan_date_desc (default)
            books = sorted(books, key=lambda b: b.get("loan_date") or "", reverse=True)

        total = len(books)
        page = books[offset: offset + limit]

        return jsonify({
            "success": True,
            "total": total,
            "offset": offset,
            "limit": limit,
            "books": page,
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/v1/books/stats")
def api_v1_books_stats():
    """読書記録の統計情報を返す"""
    try:
        import datetime
        data = library_service.load_saved()
        books = data.get("books", []) if data else []

        this_year = str(datetime.date.today().year)
        read = [b for b in books if b.get("completed")]
        in_progress = [b for b in books if not b.get("completed") and (b.get("percent_complete") or 0) > 0]
        unread = [b for b in books if not b.get("completed") and (b.get("percent_complete") or 0) == 0]
        read_this_year = [b for b in read if (b.get("completed_date") or "").startswith(this_year)]

        sources = {}
        for b in books:
            src = b.get("source") or "unknown"
            if src not in sources:
                sources[src] = {"total": 0, "read": 0, "in_progress": 0, "unread": 0}
            sources[src]["total"] += 1
            if b.get("completed"):
                sources[src]["read"] += 1
            elif (b.get("percent_complete") or 0) > 0:
                sources[src]["in_progress"] += 1
            else:
                sources[src]["unread"] += 1

        avg_percent = (
            sum(b.get("percent_complete") or 0 for b in books) / len(books)
            if books else 0
        )

        return jsonify({
            "success": True,
            "total": len(books),
            "read": len(read),
            "in_progress": len(in_progress),
            "unread": len(unread),
            "read_this_year": len(read_this_year),
            "avg_percent_complete": round(avg_percent, 1),
            "by_source": sources,
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/v1/books/<catalog_number>")
def api_v1_book_detail(catalog_number: str):
    """ASIN や図書館番号で1冊の詳細を返す"""
    try:
        data = library_service.load_saved()
        books = data.get("books", []) if data else []

        book = next(
            (b for b in books if b.get("catalog_number") == catalog_number),
            None,
        )
        if book is None:
            return jsonify({"success": False, "error": "該当する書籍が見つかりません"}), 404

        return jsonify({"success": True, "book": book})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ===========================================================================
# /slack/command — Slack Slash Command (/yonda)
# ===========================================================================

def _verify_slack_signature(request_body: bytes, timestamp: str, signature: str) -> bool:
    """Slack リクエストの署名を検証する"""
    signing_secret = os.environ.get("SLACK_SIGNING_SECRET", "")
    if not signing_secret:
        logger.warning("SLACK_SIGNING_SECRET が未設定です")
        return False
    # リプレイ攻撃防止: 5分以上古いリクエストは拒否
    try:
        if abs(time.time() - float(timestamp)) > 300:
            return False
    except (ValueError, TypeError):
        return False
    basestring = f"v0:{timestamp}:{request_body.decode('utf-8')}"
    expected = "v0=" + hmac.new(
        signing_secret.encode(), basestring.encode(), hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature)


def _slack_book_block(book: dict) -> list:
    """1冊分の Slack Block Kit ブロックを生成"""
    title = book.get("title") or "不明"
    author = book.get("author") or ""
    source = {"kindle": "Kindle", "audible_jp": "Audible", "setagaya": "図書館"}.get(
        book.get("source", ""), book.get("source", "")
    )
    detail_url = book.get("detail_url") or ""
    title_text = f"<{detail_url}|{title}>" if detail_url else title

    status_parts = []
    if book.get("completed"):
        date = book.get("completed_date") or ""
        status_parts.append(f"✅ 読了{(' ' + date) if date else ''}")
    elif (book.get("percent_complete") or 0) > 0:
        pct = round(book["percent_complete"])
        status_parts.append(f"📖 読中 {pct}%")
    else:
        status_parts.append("📚 未読")

    if author:
        status_parts.append(f"著者: {author}")
    if book.get("loan_date"):
        status_parts.append(f"取得: {book['loan_date']}")
    status_parts.append(f"[{source}]")

    return [
        {"type": "section", "text": {"type": "mrkdwn", "text": f"*{title_text}*"}},
        {"type": "context", "elements": [{"type": "mrkdwn", "text": "  ".join(status_parts)}]},
        {"type": "divider"},
    ]


def _slack_books_response(books: list, header: str, total: int) -> dict:
    """書籍リストを Slack Block Kit レスポンスに変換（最大5冊表示）"""
    shown = books[:5]
    blocks: list = [
        {"type": "header", "text": {"type": "plain_text", "text": header}},
    ]
    if not shown:
        blocks.append({"type": "section", "text": {"type": "mrkdwn", "text": "該当する本が見つかりませんでした。"}})
    else:
        for book in shown:
            blocks.extend(_slack_book_block(book))
        if total > 5:
            blocks.append({
                "type": "context",
                "elements": [{"type": "mrkdwn", "text": f"他 {total - 5} 冊 → <https://yonda.ktrips.net|Yonda で全件表示>"}],
            })
    return {"response_type": "in_channel", "blocks": blocks}


@app.route("/slack/command", methods=["POST"])
def slack_command():
    """Slack Slash Command /yonda のエンドポイント

    使い方:
      /yonda read       — 直近の読了済み本
      /yonda reading    — 読んでいる途中の本
      /yonda unread     — 未読の本
      /yonda stats      — 統計情報
      /yonda <キーワード> — タイトル・著者を検索
      /yonda help       — ヘルプ
    """
    # 署名検証
    body = request.get_data()
    ts = request.headers.get("X-Slack-Request-Timestamp", "")
    sig = request.headers.get("X-Slack-Signature", "")
    if not _verify_slack_signature(body, ts, sig):
        return jsonify({"error": "Unauthorized"}), 401

    text = (request.form.get("text") or "").strip().lower()
    sub, _, rest = text.partition(" ")
    rest = rest.strip()

    try:
        data = library_service.load_saved()
        books = data.get("books", []) if data else []

        # --- read ---
        if sub in ("read", "既読", "読了"):
            filtered = sorted(
                [b for b in books if b.get("completed")],
                key=lambda b: b.get("completed_date") or b.get("loan_date") or "",
                reverse=True,
            )
            return jsonify(_slack_books_response(filtered, f"✅ 読了済み（{len(filtered)} 冊）", len(filtered)))

        # --- reading / in_progress ---
        elif sub in ("reading", "read_progress", "読中", "途中"):
            filtered = sorted(
                [b for b in books if not b.get("completed") and (b.get("percent_complete") or 0) > 0],
                key=lambda b: b.get("percent_complete") or 0,
                reverse=True,
            )
            return jsonify(_slack_books_response(filtered, f"📖 読んでいる途中（{len(filtered)} 冊）", len(filtered)))

        # --- unread ---
        elif sub in ("unread", "未読", "積読"):
            filtered = sorted(
                [b for b in books if not b.get("completed") and (b.get("percent_complete") or 0) == 0],
                key=lambda b: b.get("loan_date") or "",
                reverse=True,
            )
            return jsonify(_slack_books_response(filtered, f"📚 未読（{len(filtered)} 冊）", len(filtered)))

        # --- stats ---
        elif sub in ("stats", "統計"):
            import datetime
            this_year = str(datetime.date.today().year)
            read = [b for b in books if b.get("completed")]
            in_prog = [b for b in books if not b.get("completed") and (b.get("percent_complete") or 0) > 0]
            unread = [b for b in books if not b.get("completed") and (b.get("percent_complete") or 0) == 0]
            read_yr = [b for b in read if (b.get("completed_date") or "").startswith(this_year)]
            by_src = {}
            for b in books:
                s = {"kindle": "Kindle 📱", "audible_jp": "Audible 🎧", "setagaya": "図書館 🏛️"}.get(b.get("source", ""), b.get("source", ""))
                by_src[s] = by_src.get(s, 0) + 1
            src_lines = "\n".join(f"  • {s}: {n} 冊" for s, n in sorted(by_src.items(), key=lambda x: -x[1]))
            text_body = (
                f"*Yonda 読書統計*\n\n"
                f"📚 総冊数: *{len(books)}* 冊\n"
                f"✅ 読了: *{len(read)}* 冊（{this_year}年: *{len(read_yr)}* 冊）\n"
                f"📖 読中: *{len(in_prog)}* 冊\n"
                f"🗂️ 未読: *{len(unread)}* 冊\n\n"
                f"*ソース別*\n{src_lines}"
            )
            return jsonify({
                "response_type": "in_channel",
                "blocks": [{"type": "section", "text": {"type": "mrkdwn", "text": text_body}}],
            })

        # --- help ---
        elif sub in ("help", "ヘルプ", ""):
            help_text = (
                "*Yonda Slack コマンド*\n\n"
                "`/yonda read` — 読了済みの本\n"
                "`/yonda reading` — 読んでいる途中の本\n"
                "`/yonda unread` — 未読の本\n"
                "`/yonda stats` — 統計情報\n"
                "`/yonda <キーワード>` — タイトル・著者を検索\n\n"
                f"🔗 <https://yonda.ktrips.net|Yonda を開く>"
            )
            return jsonify({"response_type": "ephemeral", "text": help_text})

        # --- search ---
        else:
            keyword = text.lower()
            filtered = [
                b for b in books
                if keyword in (b.get("title") or "").lower()
                or keyword in (b.get("author") or "").lower()
            ]
            return jsonify(_slack_books_response(
                filtered, f"🔍 「{text}」の検索結果（{len(filtered)} 冊）", len(filtered)
            ))

    except Exception as e:
        logger.exception("Slack command error: %s", e)
        return jsonify({"response_type": "ephemeral", "text": f"エラーが発生しました: {e}"}), 500


if __name__ == "__main__":
    # ログレベルを設定（デバッグモード）
    logging.basicConfig(
        level=logging.DEBUG,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S"
    )

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
