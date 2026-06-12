"""
Firestore 接続テスト
- ローカル実行: gcloud auth application-default login が必要
- Cloud Run 上: サービスアカウントで自動認証
"""
import sys
from pathlib import Path

# プロジェクトルートを追加
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from google.cloud import firestore

PROJECT_ID = "airgo-trip"

def test_connection():
    print(f"[1] Firestore クライアント初期化 (project={PROJECT_ID})...")
    db = firestore.Client(project=PROJECT_ID)
    print("    ✓ 接続成功")

    # テスト書き込み
    print("[2] テストドキュメント書き込み...")
    test_ref = db.collection("_test").document("ping")
    test_ref.set({"message": "hello from yonda", "ok": True})
    print("    ✓ 書き込み成功")

    # テスト読み込み
    print("[3] テストドキュメント読み込み...")
    doc = test_ref.get()
    if doc.exists:
        print(f"    ✓ 読み込み成功: {doc.to_dict()}")
    else:
        print("    ✗ ドキュメントが見つかりません")

    # 後片付け
    test_ref.delete()
    print("[4] テストドキュメント削除 ✓")
    print("\n🎉 Firestore 接続テスト完了！")

if __name__ == "__main__":
    test_connection()
