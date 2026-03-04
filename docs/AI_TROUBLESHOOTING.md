# AI推し 機能のAPIエラー対処法

AI推しでAPIエラーが出る場合の確認手順と対処法です。

## 1. 設定の確認

### APIキーが設定されているか

1. ハンバーガーメニュー → **Amazon/AI設定** を開く
2. **AI プロバイダ** で OpenAI または Google Gemini を選択
3. **API キー** が入力されているか確認
4. **保存** をクリック

### 設定ファイルの場所

- 設定は `~/.config/yonda/ai_config.json` に保存されます（環境変数 `YONDA_AI_CONFIG_PATH` で変更可）
- 内容例: `{"provider": "gemini", "api_key": "AIza..."}`

---

## 2. エラー別の対処法

### エラー: 「AI設定が未設定です」

**原因**: APIキーが登録されていない

**対処**: メニュー → Amazon/AI設定 でAPIキーを入力し保存

---

### エラー: 401 Unauthorized（認証エラー）

**原因**: APIキーが無効・期限切れ・不正

**対処**:

- **Gemini の場合**:
  1. [Google AI Studio](https://aistudio.google.com/apikey) にアクセス
  2. 新しいAPIキーを発行
  3. キーは `AIza` で始まる形式であることを確認
  4. Amazon/AI設定で新しいキーを登録

- **OpenAI の場合**:
  1. [OpenAI API Keys](https://platform.openai.com/api-keys) にアクセス
  2. 新しいAPIキーを発行
  3. キーは `sk-` で始まる形式であることを確認
  4. Amazon/AI設定で新しいキーを登録

---

### エラー: 403 Forbidden

**原因**: APIが有効化されていない、プロジェクトの権限不足

**対処**:

- **Gemini**: [Google AI Studio](https://aistudio.google.com/) で Generative Language API が有効か確認
- **OpenAI**: [OpenAI Platform](https://platform.openai.com/) で課金設定・利用制限を確認

---

### エラー: 429 Too Many Requests（レート制限）

**原因**: リクエスト数が上限を超えた

**対処**:

- 数十秒〜数分待ってから再試行
- Gemini無料枠: 2025年12月以降、制限が厳しくなっている場合あり
- 課金プランへのアップグレードを検討

---

### エラー: 400 Bad Request

**原因**: リクエスト形式の不備、モデル名の変更、地域制限

**対処**:

- **Gemini**: 無料枠が地域によって利用不可の場合あり。課金を有効化すると解消することがある
- APIキーを再発行して再設定
- 別のプロバイダ（OpenAI ↔ Gemini）に切り替えて試す

---

### エラー: 500, 503, 504（サーバーエラー）

**原因**: Google/OpenAI側の一時的な障害

**対処**:

- 5〜60分待ってから再試行
- [Google AI Studio Status](https://aistudio.google.com/status) で障害情報を確認
- [OpenAI Status](https://status.openai.com/) で障害情報を確認

---

## 3. プロバイダの切り替え

一方でエラーが出る場合、もう一方を試してください。

| プロバイダ | モデル | キー取得先 |
|-----------|--------|------------|
| **OpenAI** | gpt-4o-mini | https://platform.openai.com/api-keys |
| **Google Gemini** | gemini-2.5-pro 等 | https://aistudio.google.com/apikey |

Amazon/AI設定で **AI プロバイダ** を切り替え、それぞれのAPIキーを登録してください。

---

## 4. 詳細エラーの確認方法

ブラウザの開発者ツールでエラー内容を確認できます。

1. キーボードで **F12** を押す（または右クリック → 検証）
2. **Console** タブを開く
3. **Network** タブで `/api/ai-recommend` のリクエストを選択
4. **Response** でサーバーから返されたエラーメッセージを確認

---

## 5. よくある質問

**Q: 写真から本を検索は動くが、AI推しだけエラーになる**

A: 同じAPI設定を使います。両方とも Amazon/AI設定で正しく設定されているか確認してください。

**Q: 以前は動いていたが急にエラーになった**

A: APIキーの期限切れ、無料枠の制限変更、モデルの廃止が考えられます。キーを再発行し、最新の設定で試してください。
