"""読書記録アダプタの基底クラス"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional

import requests


@dataclass
class BookRecord:
    """1冊分の読書記録"""
    title: str = ""
    author: str = ""
    loan_date: str = ""          # YYYY-MM-DD（購入日・貸出日）
    loan_location: str = ""      # 図書室名 or "Audible JP" 等
    rating: int = 0              # 0-5
    comment: str = ""
    cover_url: str = ""
    detail_url: str = ""
    catalog_number: str = ""     # 図書館番号 or ASIN
    completed: bool = False
    source: str = ""             # "setagaya", "audible_jp" 等
    genre: str = ""              # ジャンル / カテゴリ
    summary: str = ""            # 概要（短縮版・カード用）
    full_summary: str = ""       # 概要全文（publisher_summary 等）
    completed_date: str = ""    # 読了日 YYYY-MM-DD（finished_at_timestamp 等）
    percent_complete: float = 0.0  # 聴取進捗 %（未読了時、Audible 等）
    favorite: bool = False      # お気に入り登録済み
    review_headline: str = ""   # レビュー見出し（Audible 等）
    catalog_rating: float = 0.0  # 総合評価（ktrips 優先、なければ全体平均、0–5）
    catalog_rating_content: str = ""  # 評価内容（ktrips のレビュー本文、Audible 等）

    def to_dict(self) -> dict:
        return {
            "title": self.title,
            "author": self.author,
            "loan_date": self.loan_date,
            "loan_location": self.loan_location,
            "rating": self.rating,
            "comment": self.comment,
            "cover_url": self.cover_url,
            "detail_url": self.detail_url,
            "catalog_number": self.catalog_number,
            "completed": self.completed,
            "source": self.source,
            "genre": self.genre,
            "summary": self.summary,
            "full_summary": self.full_summary,
            "completed_date": self.completed_date,
            "percent_complete": self.percent_complete,
            "favorite": self.favorite,
            "review_headline": self.review_headline,
            "catalog_rating": self.catalog_rating,
            "catalog_rating_content": self.catalog_rating_content,
        }


@dataclass
class LibraryCredentials:
    user_id: str = ""
    password: str = ""


class LibraryAdapter(ABC):
    """読書記録アダプタの基底クラス。
    図書館サイトや Audible 等、新しいソースを追加する場合はこのクラスを継承して実装する。
    """

    @property
    @abstractmethod
    def library_id(self) -> str:
        """一意な識別子 (例: 'setagaya', 'audible_jp')"""

    @property
    @abstractmethod
    def library_name(self) -> str:
        """表示名 (例: '世田谷区立図書館')"""

    @property
    @abstractmethod
    def library_url(self) -> str:
        """サイトの URL"""

    @property
    def needs_credentials(self) -> bool:
        """ユーザーID/パスワード認証が必要か（False ならトークンファイル等を使用）"""
        return True

    @abstractmethod
    def login(self, session: Optional[requests.Session], credentials: Optional[LibraryCredentials]) -> bool:
        """認証を行い、成功したら True を返す"""

    @abstractmethod
    def fetch_history(self, session: Optional[requests.Session]) -> list[BookRecord]:
        """読書記録を全件取得"""
