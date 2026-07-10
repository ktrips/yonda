# Yonda 開発計画 — できていること / すぐやるべきこと

> 最終更新: 2026-07-10
> 対象: yonda（読書記録ビューア） https://yonda.ktrips.net

---

## 1. ビジョン

**「読んだ本のすべてが、どこから読んだかに関係なく、一箇所に集まる」**

図書館・Audible・Kindle・紙の本という分断された読書記録を自動で統合し、
振り返り（Yonda）・次の一冊探し（Yomu）・AI 推薦（Oshi）までを一つのアプリで完結させる。
個人ツールからマルチユーザーのコミュニティ（みんなのYonda）へ育て、収益化（アフィリエイト・開発ノウハウ公開）も狙う。

---

## 2. 現状スナップショット

| 項目 | 状態 |
|---|---|
| コード規模 | 約 8,300 行（app.py 4,025 / library_service.py 1,442 / adapters 2,420 ほか） |
| API エンドポイント | 56 ルート（REST API v1 / 内部 API 含む） |
| 本番環境 | Cloud Run（yonda.ktrips.net）+ GCS + Firestore |
| 自動取得 | Cloud Scheduler 毎日3回（06/12/18 JST）→ `/api/internal/auto-fetch-all` |
| ユーザー | 1名（kenichiyoshida13@gmail.com）、マルチユーザー基盤は実装済み |
| テスト | **0件** |

---

## 3. ✅ できていること

### データ統合（コア機能）

- [x] **世田谷区立図書館**: 貸出履歴スクレイピング取得（ID/PW 認証）
- [x] **Audible Japan**: API 経由で蔵書取得（auth_jp.json 認証）
- [x] **Kindle**: Amazon ログイン（OTP → セッション7日間永続化）＋ローカルファイル（SQLite/XML）フォールバック
- [x] **紙の本**: 手動登録（テキスト・写真撮影・Amazon リンク）
- [x] 書誌エンリッチ: Google Books / Open Library から概要・ジャンル・表紙を自動補完
- [x] 一括取得スクリプト `fetch_all.py`（エラー時も取得済み分は保存）

### アプリ UI

- [x] Yonda タブ: カード/テーブル表示、フィルター、並べ替え、読書統計・グラフ、マイ・ランキング
- [x] Yomu タブ: 横断検索（Amazon/Kindle/Audible/メルカリ/ブックオフ/図書館）、写真から AI/バーコード検索
- [x] みんなのYonda: コミュニティ表示（非公開/非表示フラグ対応）
- [x] 書評ポイント: AI 生成（OpenAI/Gemini）＋手入力
- [x] AI 推し（簡単質問/MBTI/強み診断/読書履歴）※現在 Yomu ページ下部に統合、Oshi タブは無効化中
- [x] PWA 対応（ホーム画面ショートカット）

### マルチユーザー・インフラ

- [x] Google OAuth ログイン + per-user データディレクトリ（`users/{uid}/`）
- [x] 認証情報の per-user 化（credentials.json / auth_jp.json / kindle_session.json）
- [x] Firestore ライトスルー（JSON 消失時の復元フォールバック付き）
- [x] `/api/internal/auto-fetch-all`: 全ユーザー分の定期自動取得（multiuser-sync-design.md の実装完了）
- [x] Cloud Run デプロイ（deploy.sh / GitHub Actions 自動デプロイ）
- [x] Cloud Scheduler 毎日3回の自動取得

### 外部連携・公開

- [x] REST API v1（読み取り専用・認証不要）: profile / books / recent / user-stats
- [x] Slack Slash Command `/yonda`（read/reading/unread/stats/検索）
- [x] SMS/Webhook 読了通知（Twilio）
- [x] 開発ノウハウのドキュメント化（「Cursor+Claude で週末開発して収益化する方法」docx/pdf）

---

## 4. 🔥 すぐやるべきこと（優先順）

### P1: 運用が壊れる・壊れているもの

- [ ] **Audible トークン期限切れの検知と通知**
  トークンは 60〜90 日で失効するが、現在は「取得が失敗して気づく」運用。失効前（残り7日など）に検知して通知する仕組みを入れる。再認証も `audible_auth.py` 手動実行 → GitHub Secret 手動上書き → 再デプロイという多段手順なので、少なくとも失効日を `/api/internal/auto-fetch-all` のレスポンスやログに出す。
- [ ] **自動取得失敗の監視・通知**
  Cloud Scheduler ジョブが失敗してもどこにも通知されない。取得結果（成功/失敗/件数）を Slack か SMS に日次サマリーで送る。既存の Twilio / Slack 連携を流用できる。
- [ ] **個人データを git 管理から外す**
  `data/kindle_books.json`（読書記録75冊分）と `output.json` がリポジトリに commit されている。公開リポジトリなら個人情報の漏洩。`git rm --cached` + `.gitignore` 追加（`data/.gitkeep` のみ残す）。

### P2: 開発の持続性

- [ ] **依存関係のインストール修復**
  新しい Python 環境で `pip install -r requirements.txt` が失敗する（`audible` パッケージ経由の `pyaes` / `pbkdf2` のビルドエラー。2026-07-10 に実環境で確認済み）。Python バージョンを Dockerfile と合わせて明記するか、依存を更新する。CI でインストール検証を回すと再発を防げる。
- [ ] **最低限のテスト整備（現在0件）**
  8,300 行・56 エンドポイントに対してテストが1つもない。ハンバーガーメニューの回帰バグが直近で2回発生しているように、修正のたびに手動確認に頼っている。まずは:
  - `library_service.py` のデータマージ・キャッシュ・重複判定のユニットテスト
  - REST API v1 のレスポンス形式テスト（外部公開しているため互換性が重要）
- [ ] **app.py の分割**
  4,000 行超の単一ファイル。Blueprint 単位（auth / api_v1 / internal / ui / slack）に分割して見通しを改善する。

### P3: プロダクトの意思決定

- [ ] **Oshi タブの方針決定**: 無効化して Yomu 下部に移した AI 推しを、正式に統合するか復活させるか決めて、不要コードを削除する
- [ ] **2人目ユーザーのオンボーディング検証**: マルチユーザー基盤は実装済みだが、2人目は空データ + 全ソース認証設定から始まる。設定導線を実際に通して詰まる箇所を洗い出す（みんなのYonda を活かすにはユーザー増が前提）

---

## 5. 📅 そのうちやること（中期）

- [ ] 図書館アダプタの多館対応（世田谷以外の自治体、カーリル API 等の汎用化）
- [ ] REST API v1 の認証オプション（現在は gmail を知っていれば誰でも読める）
- [ ] 読書データのエクスポート（CSV / 読書メーター・ブクログ形式）
- [ ] アフィリエイト収益のトラッキング（Amazon リンクのクリック計測）
- [ ] 書評ポイントの共有機能（みんなのYonda に AI 書評を表示）
- [ ] Kindle セッション7日期限の延長 or リフレッシュ自動化

---

## 6. 参考

| リソース | 場所 |
|---|---|
| 全体 README | `README.md` |
| マルチユーザー同期設計（実装済み） | `docs/multiuser-sync-design.md` |
| Kindle セットアップ | `docs/KINDLE_SETUP.md` / `docs/KINDLE_SESSION.md` |
| デプロイ手順 | `DEPLOY.md` / `deploy.sh` / `.github/workflows/yonda-deploy.yml` |
| 一括取得 | `python fetch_all.py` |
| Audible 再認証 | `python scripts/audible_auth.py` → GitHub Secret `AUTH_JP_JSON` 更新 → main へ push |
