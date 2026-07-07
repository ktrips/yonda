/* --- yonda frontend --- */

// ---- 認証状態 ----
let _authUser = null;      // ログイン中ユーザー情報 (null = 未ログイン or OAuth 無効)
let _oauthEnabled = false; // サーバーで OAuth が設定されているか
let _isAdmin = false;      // 管理者フラグ

function confirmLogout() {
  if (confirm('ログアウトしますか？')) {
    location.href = '/auth/logout';
  }
}

async function initAuth() {
  try {
    const res = await fetch('/auth/me');
    const data = await res.json();
    _oauthEnabled = data.oauth_enabled || false;
    _authUser = data.user || null;
    _isAdmin = data.is_admin || false;
  } catch (_) {
    _oauthEnabled = false;
    _authUser = null;
    _isAdmin = false;
  }
  _applyAuthUI();
}

function _applyAuthUI() {
  const loginBtn = document.getElementById('headerLoginBtn');
  const userEl = document.getElementById('headerUser');
  const avatarEl = document.getElementById('headerUserAvatar');
  const nameEl = document.getElementById('headerUserName');

  // メニュー内のauth要素
  const menuAuthSection = document.getElementById('menuAuthSection');
  const menuUserInfo = document.getElementById('menuUserInfo');
  const menuUserAvatar = document.getElementById('menuUserAvatar');
  const menuUserName = document.getElementById('menuUserName');
  const menuLoginBtn = document.getElementById('menuLoginBtn');
  const menuLoggedInSection = document.getElementById('menuLoggedInSection');

  if (!_oauthEnabled) {
    if (loginBtn) loginBtn.style.display = 'none';
    if (userEl) userEl.style.display = 'none';
    if (menuAuthSection) menuAuthSection.style.display = 'none';
    if (menuLoggedInSection) menuLoggedInSection.style.display = '';
    document.getElementById('headerWelcomeBanner')?.style.setProperty('display', 'none');
    _showAllTabs();
    return;
  }

  // メニューのauth欄を常に表示
  if (menuAuthSection) menuAuthSection.style.display = '';

  if (_authUser) {
    if (loginBtn) loginBtn.style.display = 'none';
    document.getElementById('headerTotalCompleted')?.style.setProperty('display', 'none');
    if (userEl) userEl.style.display = '';
    if (avatarEl && _authUser.picture) {
      avatarEl.src = _authUser.picture.includes('=s') ? _authUser.picture : _authUser.picture + '=s64-c';
    }
    if (nameEl) nameEl.textContent = (_authUser.name || _authUser.email || '').split(' ')[0];
    // メニュー内: ユーザー情報表示、ログインボタン非表示
    if (menuUserInfo) menuUserInfo.style.display = '';
    if (menuLoginBtn) menuLoginBtn.style.display = 'none';
    if (menuUserAvatar && _authUser.picture) {
      menuUserAvatar.src = _authUser.picture.includes('=s') ? _authUser.picture : _authUser.picture + '=s64-c';
    }
    if (menuUserName) menuUserName.textContent = _authUser.name || _authUser.email || '';
    // ログイン済みメニュー表示
    if (menuLoggedInSection) menuLoggedInSection.style.display = '';
    // 管理者メニュー表示制御
    const adminSection = document.getElementById('menuAdminSection');
    if (adminSection) adminSection.style.display = _isAdmin ? '' : 'none';
    document.getElementById('headerWelcomeBanner')?.style.setProperty('display', 'none');
    document.getElementById('hamburgerBtn')?.style.setProperty('display', '');
    _showAllTabs();
    _updateHeaderCompletedCount();
  } else {
    if (loginBtn) loginBtn.style.display = '';
    if (userEl) userEl.style.display = 'none';
    // メニュー内: ログインボタン表示、ユーザー情報非表示、機能メニュー非表示
    if (menuUserInfo) menuUserInfo.style.display = 'none';
    if (menuLoginBtn) menuLoginBtn.style.display = '';
    if (menuLoggedInSection) menuLoggedInSection.style.display = 'none';
    document.getElementById('headerWelcomeBanner')?.style.setProperty('display', '');
    _updateHeaderCompletedCount();
    // 未ログイン時はハンバーガーを非表示
    document.getElementById('hamburgerBtn')?.style.setProperty('display', 'none');
    _showPublicOnly();
  }
}

function _showAllTabs() {
  // mainTabOshi は一旦無効化中（HTML側で display:none、コンテンツはYomu下部へ移動）
  ['mainTabYonda', 'mainTabYomu'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = '';
  });
  const searchEl = document.querySelector('.header-search');
  if (searchEl) searchEl.style.display = '';
  const statsEl = document.getElementById('headerStats');
  if (statsEl) statsEl.style.display = '';
  const hamburgerEl = document.getElementById('hamburgerBtn');
  if (hamburgerEl) hamburgerEl.style.display = '';
}

function switchMainTab(tab) {
  activeMainTab = tab;
  updateMainTabVisibility();
}

function switchBookTab(tabVal) {
  activeBookTab = tabVal;
  document.querySelectorAll('.book-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tabVal);
  });
  showFilters();
}

function _showPublicOnly() {
  // ヘッダーのタブは全て表示（Yonda/Yomu。Oshiは一旦無効化中）
  ['mainTabYonda', 'mainTabYomu'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = '';
  });
  // 検索・統計は非表示（データなし）、ハンバーガーも未ログイン時は非表示
  const searchEl = document.querySelector('.header-search');
  if (searchEl) searchEl.style.display = 'none';
  const statsEl = document.getElementById('headerStats');
  if (statsEl) statsEl.style.display = 'none';
  const hamburgerEl = document.getElementById('hamburgerBtn');
  if (hamburgerEl) hamburgerEl.style.display = 'none';

  // mainContentYonda を表示（他のメインコンテンツは非表示）
  document.querySelectorAll('.main-content').forEach(el => { el.style.display = 'none'; });
  const mainYonda = document.getElementById('mainContentYonda');
  if (mainYonda) mainYonda.style.display = 'block';

  // 読書記録なし・エラーメッセージは非表示
  const emptyState = document.getElementById('emptyState');
  if (emptyState) emptyState.style.display = 'none';
  const errorEl = document.getElementById('error');
  if (errorEl) errorEl.style.display = 'none';

  // フィルター・書籍リスト・ランキング等を非表示
  ['bookList', 'pagination', 'bookTabs', 'filterWrapper', 'myRankingBar', 'rankingSection'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

  // ウェルカムバナーを表示（publicWelcomeBanner は HTML に存在しないため headerWelcomeBanner で対応済み）
  const welcomeBanner = document.getElementById('publicWelcomeBanner');
  if (welcomeBanner) welcomeBanner.style.display = '';
  // bookTabs は表示しない（タブ名不要）。みんなのYondaコンテンツを直接表示
  const communitySection = document.getElementById('communitySection');
  if (communitySection) communitySection.style.display = 'block';
  activeBookTab = 'community';
}

// ------------------------------------------------------------------
// 全ユーザー読了バブル（ヘッダー常時表示）
// ------------------------------------------------------------------

let _publicUserStatsData = []; // [{uid, name, picture, completed_count}]

async function loadPublicUserStats() {
  try {
    const res = await fetch(API.publicUserStats);
    if (!res.ok) return;
    const data = await res.json();
    _publicUserStatsData = data.users || [];
    _renderPublicUserBubbles();
    _updateHeaderCompletedCount();
  } catch (_) {
    // 取得失敗時は非表示のまま
  }
}

function _updateHeaderCompletedCount() {
  const totalEl = document.getElementById('headerTotalCompleted');
  const totalCountEl = document.getElementById('headerTotalCount');
  const userCompletedEl = document.getElementById('headerUserCompleted');

  if (_authUser) {
    // ログイン済み: 自分の読了数を表示
    if (totalEl) totalEl.style.display = 'none';
    const myUid = _authUser.sub;
    const myStats = _publicUserStatsData.find(u => u.uid === myUid);
    const myCount = myStats ? (myStats.completed_count || 0) : 0;
    if (userCompletedEl) {
      userCompletedEl.textContent = myCount > 0 ? `${myCount}冊読了` : '';
    }
  } else {
    // 未ログイン: 全ユーザー合計読了数を表示
    const total = _publicUserStatsData.reduce((sum, u) => sum + (u.completed_count || 0), 0);
    if (totalCountEl) totalCountEl.textContent = total.toLocaleString();
    if (totalEl) totalEl.style.display = total > 0 ? 'flex' : 'none';
  }
}

function _renderPublicUserBubbles() {
  // ユーザーバブルは非表示（_updateHeaderCompletedCount で合計数のみ表示）
}

function _esc(s) {
  return escapeHtml(String(s || ''));
}

function _openUserBooksModal(user) {
  const modal = document.getElementById('userBooksModal');
  if (!modal) return;

  // ヘッダー情報をセット
  const avatarEl = document.getElementById('userBooksModalAvatar');
  const nameEl = document.getElementById('userBooksModalName');
  const countEl = document.getElementById('userBooksModalCount');
  if (avatarEl) {
    const src = user.picture
      ? (user.picture.includes('=s') ? user.picture : user.picture + '=s64-c')
      : '';
    avatarEl.src = src;
    avatarEl.style.display = src ? '' : 'none';
  }
  if (nameEl) nameEl.textContent = user.name || '';
  if (countEl) countEl.textContent = `読了 ${user.completed_count || 0} 冊`;

  // 本一覧をロード
  const body = document.getElementById('userBooksModalBody');
  if (body) body.innerHTML = '<div class="user-books-loading">読み込み中…</div>';

  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  _loadUserBooksForModal(user.uid, body);
}

async function _loadUserBooksForModal(uid, bodyEl) {
  if (!bodyEl) return;
  try {
    // メッセージから該当ユーザーの本を収集
    const res = await fetch(API.messages);
    if (!res.ok) throw new Error('messages fetch failed');
    const data = await res.json();
    const messages = (data.messages || []).filter(m => (m.user || {}).uid === uid);

    // 重複除去しつつ本を収集（新しい順）
    const seen = new Set();
    const books = [];
    for (const msg of messages) {
      for (const b of (msg.books || [])) {
        const key = b.title + '|' + (b.author || '');
        if (!seen.has(key)) {
          seen.add(key);
          books.push(b);
        }
      }
    }

    if (!books.length) {
      bodyEl.innerHTML = '<p class="user-books-empty">読了本のデータがありません。</p>';
      return;
    }

    const html = books.map(b => {
      const cover = b.cover
        ? `<img class="user-books-cover" src="${_esc(b.cover)}" alt="" loading="lazy" width="50" height="70">`
        : `<div class="user-books-cover user-books-cover-placeholder"></div>`;
      const genre = b.genre ? `<span class="user-books-genre">${_esc(b.genre)}</span>` : '';
      return `<div class="user-books-item">
        ${cover}
        <div class="user-books-info">
          <div class="user-books-title">${_esc(b.title || '')}</div>
          <div class="user-books-author">${_esc(b.author || '')}</div>
          ${genre}
        </div>
      </div>`;
    }).join('');
    bodyEl.innerHTML = `<div class="user-books-list">${html}</div>`;
  } catch (e) {
    bodyEl.innerHTML = '<p class="user-books-empty">データを取得できませんでした。</p>';
  }
}

function closeUserBooksModal() {
  const modal = document.getElementById('userBooksModal');
  if (modal) modal.style.display = 'none';
  document.body.style.overflow = '';
}


const API = {
  books: '/api/books',
  fetch: '/api/fetch',
  libraries: '/api/libraries',
  credentials: '/api/credentials',
  credentialsAudibleUpload: '/api/credentials/audible_jp/upload',
  download: '/api/download',
  testLogin: '/api/test-login',
  kindleLogin: '/api/kindle-login',
  kindleLoginOtp: '/api/kindle-login-otp',
  aiRecommend: '/api/ai-recommend',
  yondaRecommend: '/api/yonda-recommend',
  bookCover: '/api/book-cover',
  bookInfo: '/api/book-info',
  amazonList: '/api/amazon-list',
  bookInsights: '/api/book-insights',
  messages: '/api/messages',
  addPaperBook: '/api/add-paper-book',
  updatePaperBook: (id) => `/api/paper-book/${id}`,
  deletePaperBook: (id) => `/api/paper-book/${id}`,
  publicUserStats: '/api/public/user-stats',
};

let allBooks = [];
let filteredBooks = [];
/** _computeBookStats のキャッシュ（allBooks 更新時に null クリア） */
let _bookStatsCache = null;
/** allBooks の O(1) インデックス検索用 Map（indexOf の O(n) を回避） */
const _bookIndexMap = new Map();
/** source:catalog → book のルックアップ Map */
const _bookByCatalogMap = new Map();
/** source:title:author → book のルックアップ Map */
const _bookByTitleAuthorMap = new Map();
/** book_id (UUID) → book のルックアップ Map */
const _bookByIdMap = new Map();

/**
 * 全書籍データに検索・フィルタ用のキャッシュフィールドを事前計算する。
 * applyFilters() のループ内で毎回計算するコストを排除する。
 *   _normalizedGenre  : 正規化済みジャンル文字列
 *   _normalizedTitle  : 正規化済みタイトル（検索用）
 *   _normalizedAuthor : 正規化済み著者名（検索用）
 *   _normalizedComment: 正規化済みコメント（検索用）
 *   _completedDateStr : completed_date の YYYY-MM-DD 文字列（日付比較を文字列演算に変換）
 */
function _preprocessBooks(books) {
  for (const b of books) {
    b._normalizedGenre   = normalizeGenre(b.genre || '');
    b._normalizedTitle   = normalizeForSearch(b.title  || '');
    b._normalizedAuthor  = normalizeForSearch(b.author || '');
    b._normalizedComment = normalizeForSearch(b.comment || '');
    // ISO文字列の先頭10文字が YYYY-MM-DD なので文字列比較で日付フィルタ可能
    b._completedDateStr  = (b.completed_date || '').slice(0, 10);
  }
}

function _rebuildBookIndexMap() {
  _bookIndexMap.clear();
  _bookByCatalogMap.clear();
  _bookByTitleAuthorMap.clear();
  _bookByIdMap.clear();
  _bookStatsCache = null;
  allBooks.forEach((b, i) => {
    _bookIndexMap.set(b, i);
    const src = (b.source || '').trim();
    const catalog = (b.catalog_number || b.asin || '').trim();
    if (catalog) _bookByCatalogMap.set(`${src}:${catalog}`, b);
    const title = (b.title || '').trim();
    const author = (b.author || '').trim();
    _bookByTitleAuthorMap.set(`${src}:${title}:${author}`, b);
    if (b.book_id) _bookByIdMap.set(b.book_id, b);
  });
}
function _bookIndex(book) {
  return _bookIndexMap.has(book) ? _bookIndexMap.get(book) : allBooks.indexOf(book);
}
let currentPage = 0;
let activeMainTab = 'yonda'; // 'yonda' | 'yomu'（'oshi' は一旦無効化、AI推しはYomu下部に統合）
let activeBookTab = 'read'; // 'read' = 読んだ/途中, 'community' = みんなのYonda, 'messages' = メッセージ
let monthlyChart = null;
let activeChartSource = null; // null=全ソース, 'audible'|'kindle'|'library'|'paper'
let genreChart = null;
let currentDetailBook = null;
let bookInsightsCache = {};
/** title+author のセカンダリインデックス（Object.values().find の線形探索を回避） */
const _insightByTitleAuthorMap = new Map();

function _addToInsightCache(insight) {
  if (!insight?.id) return;
  bookInsightsCache[insight.id] = insight;
  const key = `${(insight.title || '').trim()}:${(insight.author || '').trim()}`;
  if (key !== ':') _insightByTitleAuthorMap.set(key, insight);
}

function _rebuildInsightIndex() {
  _insightByTitleAuthorMap.clear();
  for (const insight of Object.values(bookInsightsCache)) {
    const key = `${(insight.title || '').trim()}:${(insight.author || '').trim()}`;
    if (key !== ':') _insightByTitleAuthorMap.set(key, insight);
  }
}
let yondaMessages = [];
let archivedMessages = [];
let _readIdsCached = null; // loadReadMessageIds のキャッシュ
let messageBookRefs = [];
let activeMessageId = null;
let chartMode = 'count';  // 'count' | 'runtime'
let relationChartMode = 'genre_rating';  // 'genre_rating' | 'author_genre'
const PAGE_SIZE = 100;
const READ_MESSAGES_STORAGE_KEY = 'yonda_read_message_ids';
const NO_COVER = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="90" viewBox="0 0 64 90">' +
  '<rect fill="#f0e6d8" width="64" height="90" rx="3"/>' +
  '<text x="32" y="50" text-anchor="middle" fill="#8a7968" font-size="10" font-family="sans-serif">No Cover</text></svg>'
);

/* --- Utility --- */

const _HTML_ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escapeHtml(text) {
  return (text || '').replace(/[&<>"']/g, c => _HTML_ESCAPE_MAP[c]);
}

function escapeAttr(text) {
  return escapeHtml(text);
}

function starsHtml(rating, options = {}) {
  const { asLink = false, source, detailUrl } = options;
  const starCount = rating != null ? Math.round(Number(rating)) : 0;
  const content = starCount > 0
    ? (() => { let s = ''; for (let i = 1; i <= 5; i++) s += i <= starCount ? '★' : '☆'; return `<span class="stars">${s}</span>`; })()
    : '<span class="stars">—</span>';
  if (asLink && source === 'audible_jp' && detailUrl) {
    return `<a href="${escapeHtml(detailUrl)}" target="_blank" rel="noopener" class="rating-link" title="Audibleで評価を入力" onclick="event.stopPropagation()">${content}</a>`;
  }
  return content;
}

/** 表示用評価: 個人評価(rating)を最優先、なければAudibleの総合評価(catalog_rating) */
function displayRating(book) {
  if ((book.rating || 0) > 0) return book.rating;
  if (book.source === 'audible_jp' && (book.catalog_rating || 0) > 0) {
    return book.catalog_rating;
  }
  return 0;
}

/** 途中: Audible/Kindleで進捗があるが読了していない / 図書館で借りているが評価を付けていない */
function isInProgress(book) {
  if (book.completed) return false;
  if ((book.source === 'audible_jp' || book.source === 'kindle') && (book.percent_complete || 0) > 0) return true;
  const isLibrary = book.source && book.source !== 'audible_jp' && book.source !== 'kindle';
  if (isLibrary && (book.loan_date || '').trim()) return true;
  return false;
}

/** 未読: 読了でも途中でもないもの */
function isUnread(book) {
  return !book.completed && !isInProgress(book);
}

function formatDate(d) {
  if (!d) return '—';
  return d;
}

/** 日付のみ表示（時間を除く）。読了日用 */
function formatDateOnly(d) {
  if (!d) return '—';
  const s = String(d).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[0];
  const m2 = s.match(/^(\d{4})\/(\d{2})\/(\d{2})/);
  if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`;
  return s.length >= 10 ? s.substring(0, 10) : s;
}

/** 読了日がない場合の進捗表示 */
function formatProgress(book) {
  const pct = book.percent_complete;
  if (pct == null || pct <= 0) return null;
  return `${Math.round(pct)}%`;
}

/** Kindle 用: 読書進捗バーの HTML を生成 */
function renderProgressBar(book) {
  const pct = book.percent_complete;
  if (pct == null || pct <= 0) return '';
  const rounded = Math.round(pct);
  return `<div class="progress-bar-container" title="${rounded}% 読了">
    <div class="progress-bar-fill" style="width: ${rounded}%"></div>
    <div class="progress-bar-text">${rounded}%</div>
  </div>`;
}

/** 検索用: スペース・括弧・特殊文字を除去して正規化。「村上春樹」で「村上 春樹」もヒット */
function normalizeForSearch(str) {
  if (!str) return '';
  return String(str)
    .toLowerCase()
    .replace(/\s+/g, '')                    // 半角・全角スペース、改行など
    .replace(/[　\u3000]+/g, '')           // 全角スペース
    .replace(/[（）\(\)\[\]【】「」『』〔〕〈〉《》［］｛｝、。・：；！？]/g, '')  // 括弧・句読点
    .replace(/[－―ー\-‐−]/g, '');         // ハイフン類
}

/** 正規化した検索語がテキストに含まれるか
 * @param {string} normalizedQuery - 正規化済みクエリ
 * @param {string} text - 検索対象（生テキスト or 事前正規化済み）
 * @param {boolean} [alreadyNormalized=false] - text が既に正規化済みなら true
 */
function matchesSearch(normalizedQuery, text, alreadyNormalized = false) {
  if (!normalizedQuery) return true;
  const n = alreadyNormalized ? (text || '') : normalizeForSearch(text);
  return n.includes(normalizedQuery);
}

/** 再生時間（分）を「X.X時間」形式で返す。Audible用 */
function formatRuntime(min) {
  const m = (min || 0) | 0;
  if (m <= 0) return null;
  const h = Math.round((m / 60) * 10) / 10;
  return `${h}時間`;
}

/** 積読期間の日数を返す（読了日 or 本日 − 取得日） */
function getTsundokuDays(book, _todayStr) {
  if (!_todayStr) {
    const today = new Date();
    _todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  }
  const endStr = (book.completed_date || '').trim().substring(0, 10) || _todayStr;
  const startStr = (book.loan_date || '').trim().substring(0, 10);
  if (!startStr) return null;
  const m1 = startStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const m2 = endStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m1 || !m2) return null;
  const d1 = new Date(parseInt(m1[1], 10), parseInt(m1[2], 10) - 1, parseInt(m1[3], 10));
  const d2 = new Date(parseInt(m2[1], 10), parseInt(m2[2], 10) - 1, parseInt(m2[3], 10));
  return Math.round((d2 - d1) / (24 * 60 * 60 * 1000));
}

/** 評価コメントを短縮して返す（Audible: review_headline、他: comment） */
function ratingCommentText(book, maxLen = 40) {
  const text = (book.source === 'audible_jp' ? book.review_headline : book.comment) || '';
  const trimmed = text.trim();
  if (!trimmed) return '';
  return trimmed.length > maxLen ? trimmed.substring(0, maxLen) + '…' : trimmed;
}

/** タイトル横に表示する補足: 評価・コメントがなければ概要サマリーのみ（カード内では使わない） */
function titleSupplementHtml(book) {
  const hasRating = (displayRating(book) || 0) > 0;
  const comment = ratingCommentText(book);
  const hasComment = !!comment;
  if (hasRating || hasComment) {
    const stars = book.source === 'audible_jp'
      ? starsHtml(displayRating(book), { asLink: true, source: book.source, detailUrl: getAudibleRatingUrl(book) })
      : starsHtml(book.rating);
    const parts = [stars];
    if (hasComment) parts.push(`<span class="title-supplement-comment">${escapeHtml(comment)}</span>`);
    return `<span class="title-supplement">${parts.join(' ')}</span>`;
  }
  const summary = (book.summary || '').trim();
  if (summary) {
    const short = summary.length > 80 ? summary.substring(0, 80) + '…' : summary;
    return `<span class="title-supplement title-supplement-summary">${escapeHtml(short)}</span>`;
  }
  return '';
}

/** カード内の著者行の下: 星 + 個人レビュー + 未レビューボタン */
function bookRatingRowHtml(book, { showUnrated = false, communityUnrated = false } = {}) {
  const rating = displayRating(book) || 0;
  const comment = (book.source === 'audible_jp' ? (book.review_headline || book.comment) : book.comment) || '';
  const reviewText = comment.trim();
  const hasReview = rating > 0 || !!reviewText;

  // 未レビューボタン（完了済み & レビューなし のみ表示）
  let unratedEl = '';
  if (book.completed && !hasReview) {
    if (showUnrated) {
      // 自分の本: クリックで書評ページへ
      if (book.source === 'paper' && book.book_id) {
        unratedEl = `<span class="btn-unrated btn-unrated-card" onclick="event.stopPropagation();openPaperBookEditToRate('${escapeHtml(book.book_id)}')">未レビュー</span>`;
      } else {
        const url = reviewUrlForBook(book);
        unratedEl = url
          ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener"
               class="btn-unrated btn-unrated-card" title="レビューを入力"
               onclick="event.stopPropagation()">未レビュー</a>`
          : `<span class="btn-unrated btn-unrated-card" onclick="event.stopPropagation();openBookDetail(_bookByIdMap.get('${escapeHtml(book.book_id||'')}'))">未レビュー</span>`;
      }
    } else if (communityUnrated) {
      // 他人の本: グレーの未レビューラベル（クリック不可）
      unratedEl = `<span class="btn-unrated btn-unrated-other">未レビュー</span>`;
    }
  }

  if (!hasReview && !unratedEl) return '';

  const stars = rating > 0
    ? (book.source === 'audible_jp'
        ? starsHtml(rating, { asLink: true, source: book.source, detailUrl: getAudibleRatingUrl(book) })
        : starsHtml(rating))
    : '';
  const reviewHtml = reviewText
    ? `<span class="card-review-text">"${escapeHtml(reviewText.length > 60 ? reviewText.substring(0, 60) + '…' : reviewText)}"</span>`
    : '';
  return `<div class="book-card-rating-row">${stars}${reviewHtml}${unratedEl}</div>`;
}

const AUDIBLE_LIBRARY_URL = 'https://www.audible.co.jp/library/audiobooks';

/** Audible 評価リンク用URL（レビュー入力ページ or ライブラリトップ） */
function getAudibleRatingUrl(book) {
  if (book.catalog_number) {
    return `https://www.audible.co.jp/write-review?asin=${encodeURIComponent(book.catalog_number)}`;
  }
  return AUDIBLE_LIBRARY_URL;
}

const SOURCE_LABELS = { setagaya: '図書館', audible_jp: 'Audible', kindle: 'Kindle', paper: 'Paper' };
const SOURCE_SHORT_LABELS = { setagaya: 'L', audible_jp: 'A', kindle: 'K', paper: 'P' };
function sourceLabel(source) { return SOURCE_LABELS[source] || source || ''; }
function sourceShortLabel(source) { return SOURCE_SHORT_LABELS[source] || SOURCE_LABELS[source] || source || ''; }

/** 7日以内に追加/同期された本かどうか */
function isRecentBook(book, days = 7) {
  // 既読本は completed_date を優先（Audible は loan_date が購入日のため）
  const dateStr = (book.completed && book.completed_date)
    ? book.completed_date
    : (book.loan_date || book.added_date || book.completed_date || '');
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return d >= cutoff;
}

function sourceBadgeHtml(source, extraClass = '') {
  if (!source) return '';
  const label = escapeHtml(sourceLabel(source));
  const short = escapeHtml(sourceShortLabel(source));
  const cls = `badge-source badge-${escapeHtml(source)}${extraClass ? ' ' + extraClass : ''}`;
  return `<span class="${cls}" data-short="${short}">${label}</span>`;
}

function formatSyncDate(isoStr) {
  if (!isoStr) return '未取得';
  try {
    // タイムゾーン情報がない文字列はUTCとして扱う（Cloud RunはUTCで動作するため）
    const normalized = /[Z+\-]\d{2}:?\d{2}$/.test(isoStr) ? isoStr : isoStr + 'Z';
    const d = new Date(normalized);
    return d.toLocaleString('ja-JP', {
      timeZone: 'Asia/Tokyo',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch { return '不明'; }
}

function updateMenuSyncDates(sources) {
  const el = document.getElementById('menuSyncDates');
  if (!el) return;
  const map = {};
  for (const s of (sources || [])) map[s.library_id] = s.fetch_date;
  const rows = [
    { id: 'setagaya',   label: '図書館' },
    { id: 'audible_jp', label: 'Audible' },
    { id: 'kindle',     label: 'Kindle' },
  ];
  el.innerHTML = rows.map(({ id, label }) =>
    `<div class="menu-sync-date-row">` +
    `<span class="menu-sync-date-label">${label}</span>` +
    `<span class="menu-sync-date-value">${formatSyncDate(map[id])}</span>` +
    `<button class="menu-sync-fetch-btn" onclick="manualFetchSource('${id}')" title="手動で取得">↻</button>` +
    `</div>`
  ).join('');
}

async function manualFetchSource(sourceId) {
  const btn = event.target;
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳';
  btn.style.opacity = '0.5';

  try {
    const response = await fetch('/api/fetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ library_id: sourceId, notify_completed: true })
    });

    const data = await response.json();

    if (data.success) {
      showToast(`${sourceId}の取得が完了しました`, 'success');
      if (typeof loadBooks === 'function') await loadBooks();
      await loadMessages();
    } else if (data.needs_otp) {
      // Kindle OTP が必要: インラインモーダルで入力
      btn.disabled = false;
      btn.textContent = originalText;
      btn.style.opacity = '1';
      _kindleOtpPendingSessionId = data.session_id;
      _kindleOtpPendingSourceBtn = null;
      const modal = document.getElementById('kindleOtpModal');
      const input = document.getElementById('kindleOtpInput');
      const errEl = document.getElementById('kindleOtpError');
      if (errEl) errEl.style.display = 'none';
      if (input) input.value = '';
      if (modal) modal.style.display = 'flex';
      if (input) input.focus();
      return; // finaly でボタン復元しない
    } else {
      showToast(`エラー: ${data.error || '取得に失敗しました'}`, 'error');
    }
  } catch (err) {
    console.error('取得エラー:', err);
    showToast('取得に失敗しました', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
    btn.style.opacity = '1';
  }
}

const AFFILIATE_TAG_KEY = 'yonda_affiliate_tag';
const DEFAULT_AFFILIATE_TAG = 'ktrip-22';

const SEARCH_APPS_KEY = 'yonda_search_apps';
const BUILTIN_SEARCH_APP_IDS = ['amazon', 'kindle', 'audible', 'mercari', 'bookoff', 'library'];

function getSearchAppsConfig() {
  try {
    const stored = localStorage.getItem(SEARCH_APPS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch (_) {}
  return {
    builtin: { amazon: true, kindle: true, audible: true, mercari: true, bookoff: true, library: true },
    libraryUrl: '',
    custom: [],
  };
}

function saveSearchAppsConfig(config) {
  localStorage.setItem(SEARCH_APPS_KEY, JSON.stringify(config));
}

/** 設定UIの「カスタムアプリ」行を1件描画して saCustomList に追加 */
function _renderCustomAppRow(app, idx) {
  const list = document.getElementById('saCustomList');
  if (!list) return;
  const row = document.createElement('div');
  row.className = 'sa-custom-row';
  row.dataset.idx = idx;
  row.innerHTML = `
    <input type="text" class="modal-input sa-custom-label" placeholder="アプリ名" value="${escapeHtml(app.label || '')}">
    <input type="url" class="modal-input sa-custom-url" placeholder="URL（{q}で検索語）" value="${escapeHtml(app.url || '')}">
    <button type="button" class="sa-custom-del" aria-label="削除">&times;</button>
  `;
  row.querySelector('.sa-custom-del').addEventListener('click', () => row.remove());
  list.appendChild(row);
}

/** 設定モーダルの search apps UI を現在の config で初期化 */
function _loadSearchAppsUI() {
  const cfg = getSearchAppsConfig();
  for (const id of BUILTIN_SEARCH_APP_IDS) {
    const el = document.getElementById('sa' + id.charAt(0).toUpperCase() + id.slice(1));
    if (el) el.checked = cfg.builtin[id] !== false;
  }
  const libraryUrlEl = document.getElementById('saLibraryUrl');
  if (libraryUrlEl) libraryUrlEl.value = cfg.libraryUrl || '';
  const list = document.getElementById('saCustomList');
  if (list) list.innerHTML = '';
  (cfg.custom || []).forEach((app, i) => _renderCustomAppRow(app, i));
}

/** 設定モーダルの search apps UI から config を収集して保存 */
function _saveSearchAppsFromUI() {
  const builtin = {};
  for (const id of BUILTIN_SEARCH_APP_IDS) {
    const el = document.getElementById('sa' + id.charAt(0).toUpperCase() + id.slice(1));
    builtin[id] = el ? el.checked : true;
  }
  const libraryUrl = (document.getElementById('saLibraryUrl')?.value || '').trim();
  const customRows = document.querySelectorAll('#saCustomList .sa-custom-row');
  const custom = [];
  customRows.forEach(row => {
    const label = row.querySelector('.sa-custom-label')?.value.trim() || '';
    const url = row.querySelector('.sa-custom-url')?.value.trim() || '';
    if (label && url) custom.push({ label, url, enabled: true });
  });
  saveSearchAppsConfig({ builtin, libraryUrl, custom });
}

/** 検索結果なしパネル用: 設定に基づいたアプリボタン HTML を生成 */
function _buildSearchAppButtons(urls, rawQuery) {
  const cfg = getSearchAppsConfig();
  const q = encodeURIComponent((rawQuery || '').trim());
  const parts = [];
  const b = cfg.builtin;
  if (b.amazon !== false) parts.push(`<a href="${escapeHtml(urls.amazon)}" target="_blank" rel="noopener" class="snr-btn snr-amazon">Amazon</a>`);
  if (b.kindle !== false) parts.push(`<a href="${escapeHtml(urls.kindle)}" target="_blank" rel="noopener" class="snr-btn snr-kindle">Kindle</a>`);
  if (b.audible !== false) parts.push(`<a href="${escapeHtml(urls.audible)}" target="_blank" rel="noopener" class="snr-btn snr-audible">Audible</a>`);
  if (b.mercari !== false) parts.push(`<a href="${escapeHtml(urls.mercari)}" target="_blank" rel="noopener" class="snr-btn snr-mercari">メルカリ</a>`);
  if (b.bookoff !== false) parts.push(`<a href="${escapeHtml(urls.bookoff)}" target="_blank" rel="noopener" class="snr-btn snr-bookoff">ブックオフ</a>`);
  // +紙の本 は常にブックオフの直後
  parts.push(`<button type="button" class="snr-btn snr-paper" id="snrAddPaperBtn">＋紙の本</button>`);
  if (b.library !== false) {
    const libUrl = cfg.libraryUrl
      ? cfg.libraryUrl.replace('{q}', q)
      : urls.setagaya;
    parts.push(`<a href="${escapeHtml(libUrl)}" target="_blank" rel="noopener" class="snr-btn snr-library">図書館</a>`);
  }
  for (const app of cfg.custom || []) {
    if (app.enabled !== false && app.label && app.url) {
      const appUrl = app.url.replace('{q}', q);
      parts.push(`<a href="${escapeHtml(appUrl)}" target="_blank" rel="noopener" class="snr-btn snr-custom">${escapeHtml(app.label)}</a>`);
    }
  }
  return parts.join('');
}
const DEFAULT_PAGE_KEY = 'yonda_default_page';
const DEFAULT_PAGE = 'yonda';

function getAffiliateTag() {
  try {
    const t = localStorage.getItem(AFFILIATE_TAG_KEY);
    if (t === null || (t || '').trim() === '') return DEFAULT_AFFILIATE_TAG;
    return t.trim();
  } catch (_) {
    return DEFAULT_AFFILIATE_TAG;
  }
}

function setAffiliateTag(tag) {
  try {
    localStorage.setItem(AFFILIATE_TAG_KEY, (tag || '').trim());
  } catch (_) {}
}

function getDefaultPage() {
  try {
    const v = localStorage.getItem(DEFAULT_PAGE_KEY);
    if (v === 'oshi') return 'yomu'; // Oshiは一旦無効化（AI推しはYomu下部へ移動）
    if (v && ['yonda', 'yomu'].includes(v)) return v;
  } catch (_) {}
  return DEFAULT_PAGE;
}

function setDefaultPage(page) {
  try {
    if (page && ['yonda', 'yomu'].includes(page)) {
      localStorage.setItem(DEFAULT_PAGE_KEY, page);
    }
  } catch (_) {}
}

/** URL にアフィリエイトタグを付与（Kindle・Audible 用） */
function appendTagToUrl(url, tag) {
  if (!url || !tag) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}tag=${encodeURIComponent(tag)}`;
}

/** 図書館検索用：最初の6文字 または 最初のスペースまでの1単語 の短い方（例：街とその不確かな壁 下→街とその不確、国宝 下 花道篇→国宝） */
function getLibrarySearchTerm(query) {
  const q = (query || '').trim();
  const spaceIdx = q.indexOf(' ');
  const firstWord = spaceIdx >= 0 ? q.slice(0, spaceIdx) : q;
  const first6 = q.slice(0, 6);
  return firstWord.length <= first6.length ? firstWord : first6;
}

/** 世田谷区立図書館の検索URL（検索キーワード付き） */
function getSetagayaSearchUrl(query, options = {}) {
  let searchTerm = (query || '').trim();
  if (options.bookTitle != null) {
    searchTerm = String(options.bookTitle).trim().slice(0, 6);
  } else if (options.libraryQuery != null) {
    searchTerm = getLibrarySearchTerm(String(options.libraryQuery));
  }
  const q = encodeURIComponent(searchTerm);
  if (!q) return 'https://libweb.city.setagaya.tokyo.jp/detailsearch?16';
  return `https://libweb.city.setagaya.tokyo.jp/detailresult?comp1=3&comp2=3&cond=2&item1=5&item2=N&key1=${q}&key2=${q}&mv=10&pcnt=1&target1=1&target2=2&target3=3`;
}

/** 本検索用：各サービスの検索URLを生成。図書館のみ options.libraryQuery の先頭6文字orスペースまで使用 */
function getBookSearchUrls(query, options = {}) {
  const q = encodeURIComponent((query || '').trim());
  const tag = getAffiliateTag();
  const setagayaOpts = options.bookTitle != null
    ? { bookTitle: options.bookTitle }
    : (options.libraryQuery != null ? { libraryQuery: options.libraryQuery } : {});
  return {
    amazon: appendTagToUrl(`https://www.amazon.co.jp/s?k=${q}`, tag),
    audible: appendTagToUrl(`https://www.audible.co.jp/search?keywords=${q}`, tag),
    kindle: appendTagToUrl(`https://www.amazon.co.jp/s?k=${q}&i=digital-text`, tag),
    mercari: `https://jp.mercari.com/search?keyword=${q}`,
    bookoff: `https://shopping.bookoff.co.jp/search/keyword/${q}`,
    setagaya: getSetagayaSearchUrl(query, setagayaOpts),
  };
}

/** 各ソースの公式サイトリンク（メニュー用） */
const SOURCE_LINKS = {
  setagaya: { url: 'https://libweb.city.setagaya.tokyo.jp/rentalhistorylist?2', label: '読書記録照会' },
  audible_jp: { url: 'https://www.audible.co.jp/library/titles?ref=a_listener_nhe_library', label: 'ライブラリ' },
  kindle: { url: 'https://www.amazon.co.jp/kindle', label: 'Kindle' },
};

function getSourceLinkUrl(libraryId) {
  const info = SOURCE_LINKS[libraryId];
  if (!info) return null;
  const tag = getAffiliateTag();
  if ((libraryId === 'audible_jp' || libraryId === 'kindle') && tag) {
    return appendTagToUrl(info.url, tag);
  }
  return info.url;
}

function primaryGenre(genre) {
  if (!genre) return '';
  return genre.split(' / ')[0].trim();
}

/**
 * ============================================================
 * ジャンル正規化 — フィルター・グラフ・ランキング・タグ分析で共通使用
 * ============================================================
 */

/** 全セクションで使用する正規化後カテゴリの正式リスト */
const CANONICAL_GENRES = [
  '文学・フィクション',
  'ミステリー・サスペンス',
  'ビジネス・キャリア',
  '自己啓発・人間関係',
  '社会・政治',
  '科学・テクノロジー',
  'ノンフィクション',
  '歴史・文化',
  'ライフ',
  'その他',
];

/**
 * メインジャンル文字列 → 正規化カテゴリ マッピング（全ソース共通）
 * 図書館 / Audible / Kindle のすべてのジャンル文字列をカバーする
 */
const GENRE_NORMALIZE_MAP = {
  // 文学・フィクション（純粋なフィクション・小説）
  '文学・フィクション':               '文学・フィクション',
  '小説':                              '文学・フィクション',
  '小説: 現代文学':                    '文学・フィクション',
  '小説: 家族・恋愛':                  '文学・フィクション',
  // ミステリー・サスペンス（独立ジャンル）
  'ミステリー・スリラー・サスペンス':  'ミステリー・サスペンス',
  'ミステリー・スリラー':              'ミステリー・サスペンス',
  'ミステリー・サスペンス':            'ミステリー・サスペンス',
  'ミステリー':                        'ミステリー・サスペンス',
  // ビジネス・キャリア
  'ビジネス・キャリア':                'ビジネス・キャリア',
  '資産・金融':                        'ビジネス・キャリア',
  // 自己啓発・人間関係
  '自己啓発・人間関係・子育て':        '自己啓発・人間関係',
  '自己啓発・人間関係':                '自己啓発・人間関係',
  '自己啓発':                          '自己啓発・人間関係',
  '人間関係・教育':                    '自己啓発・人間関係',
  // 社会・政治
  '政治学・社会科学':                  '社会・政治',
  '政治・社会科学':                    '社会・政治',
  '政治・社会':                        '社会・政治',
  '政治・社会・歴史':                  '社会・政治',
  '社会・政治':                        '社会・政治',
  // 科学・テクノロジー
  '科学・テクノロジー':                '科学・テクノロジー',
  '科学・工学':                        '科学・テクノロジー',
  'コンピュータ・テクノロジー':        '科学・テクノロジー',
  'コンピュータ・it':                  '科学・テクノロジー',
  'サイエンス・テクノロジー':          '科学・テクノロジー',
  'SF・ファンタジー':                  '科学・テクノロジー',
  // ノンフィクション（エッセイ・自伝・回顧録含む）
  'ノンフィクション':                  'ノンフィクション',
  '自伝・回顧録':                      'ノンフィクション',
  '自伝・ノンフィクション':            'ノンフィクション',
  'エッセイ':                          'ノンフィクション',
  '随筆':                              'ノンフィクション',
  // 歴史・文化（宗教・文化・文明含む）
  '歴史':                              '歴史・文化',
  '歴史・文化':                        '歴史・文化',
  '宗教・スピリチュアル':              '歴史・文化',
  '宗教・哲学':                        '歴史・文化',
  // ライフ
  'ライフ':                            'ライフ',
  'アート・エンタメ':                  'ライフ',
  'アート・エンターテイメント':        'ライフ',
  '衛生・健康':                        'ライフ',
  'スポーツ・アウトドア':              'ライフ',
  '旅行・観光':                        'ライフ',
  'エンターテインメント・アート':      'ライフ',
  '絵本・児童書':                      'ライフ',
  'ホーム・ガーデン':                  'ライフ',
  'ティーン':                          'ライフ',
  'LGBT':                              'ライフ',
  'コメディー・落語':                  'ライフ',
  '官能・ロマンス':                    'ライフ',
  '新書':                              'ライフ',
  '教育・学習':                        'ライフ',
  '語学学習':                          'ライフ',
  '単語・言語・文法':                  'ライフ',
};

/**
 * 全セクション共通のジャンル正規化関数
 * フィルター・読書グラフ・ランキング・タグ分析のすべてで同一の結果を返す
 */
function normalizeGenre(genreStr) {
  if (!genreStr) return 'その他';
  const parts   = genreStr.split(/\s*[/／]\s*/).map(s => s.trim()).filter(Boolean);
  const main    = parts[0] || '';
  const genreLow = genreStr.toLowerCase();

  // ── エッセイ・随筆はノンフィクション優先（"文学・フィクション / エッセイ" 等を考慮）──
  if (parts.some(p => ['エッセイ', '随筆'].includes(p))) return 'ノンフィクション';

  // ── ミステリー系も優先チェック ──
  if (parts.some(p => ['ミステリー', 'サスペンス', 'スリラー', 'ホラー', '推理'].some(kw => p.includes(kw))))
    return 'ミステリー・サスペンス';

  // ── SF・ファンタジー系は科学・テクノロジー優先（"文学・フィクション / SF" 等を考慮）──
  if (parts.some(p => ['SF', 'Sf', 'sf', 'サイエンスフィクション', 'ファンタジー', 'ファンタジー・マジック'].some(kw => p.includes(kw))))
    return '科学・テクノロジー';

  // ── GENRE_NORMALIZE_MAP で直接マッピング（メイン完全一致優先）──
  if (GENRE_NORMALIZE_MAP[main]) return GENRE_NORMALIZE_MAP[main];

  // ── 全パートで部分一致照合 ──
  for (const [key, cat] of Object.entries(GENRE_NORMALIZE_MAP)) {
    const k = key.toLowerCase();
    if (parts.some(p => p.toLowerCase().includes(k) || k.includes(p.toLowerCase()))) return cat;
    if (genreLow.includes(k)) return cat;
  }

  // ── キーワードフォールバック ──
  if (['ミステリー', '推理', 'サスペンス', 'スリラー', 'ホラー'].some(kw => genreLow.includes(kw)))
    return 'ミステリー・サスペンス';
  if (['エッセイ', '随筆', 'ノンフィクション', '自伝', '伝記', 'memoir', 'biography'].some(kw => genreLow.includes(kw)))
    return 'ノンフィクション';
  if (['文学', '小説', 'フィクション', 'fiction'].some(kw => genreLow.includes(kw)))
    return '文学・フィクション';
  if (['ビジネス', '経営', 'マーケティング', 'キャリア', 'business'].some(kw => genreLow.includes(kw)))
    return 'ビジネス・キャリア';
  if (['自己啓発', '習慣', '人間関係', '子育て', 'self-help', 'コミュニケーション'].some(kw => genreLow.includes(kw)))
    return '自己啓発・人間関係';
  if (['政治', '社会科学', 'politics', 'economics', '経済', '社会学'].some(kw => genreLow.includes(kw)))
    return '社会・政治';
  if (['科学', 'テクノロジー', 'it', 'コンピュータ', 'プログラミング', 'science', 'technology', 'sf', 'ファンタジー'].some(kw => genreLow.includes(kw)))
    return '科学・テクノロジー';
  if (['歴史', 'history', '文化史', '宗教', '文明', '文化', '哲学'].some(kw => genreLow.includes(kw)))
    return '歴史・文化';
  if (['ライフ', '健康', '料理', '旅行', 'アート', 'life', '教育', '学習', '語学'].some(kw => genreLow.includes(kw)))
    return 'ライフ';

  return 'その他';
}


/** 紙の本追加確認モーダルを開く */
function openPaperAddConfirm(title, author, coverUrl, summary, genre, detailUrl = '') {
  if (!title) return;

  // フロントエンドで事前重複チェック
  const titleNorm = title.trim().toLowerCase();
  const existing = allBooks.find(b => (b.title || '').trim().toLowerCase() === titleNorm);
  if (existing) {
    const confirmed = window.confirm(`「${title}」はすでに記録されています。\n（${existing.source === 'paper' ? '紙の本' : existing.source}）\n\n詳細を開きますか？`);
    if (confirmed) openBookDetail(existing);
    return;
  }

  const effectiveCover = window._lastBookPhotoCover || coverUrl || '';
  const bookInfo = window._lastBookInfo || {};
  const effectiveAuthor = author || bookInfo.author || '';
  const effectiveSummary = summary || bookInfo.summary || '';

  // モーダルに情報をセット
  document.getElementById('paperConfirmTitle').value  = title;
  document.getElementById('paperConfirmAuthor').value = effectiveAuthor;
  document.getElementById('paperConfirmStatus').value = 'completed';
  document.getElementById('paperConfirmRating').value = '';
  document.getElementById('paperConfirmComment').value = '';
  _setPaperConfirmStars(0);

  const img = document.getElementById('paperConfirmCoverImg');
  const NO_COVER_SVG = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="90" height="126" viewBox="0 0 90 126">' +
    '<rect fill="#f0e6d8" width="90" height="126"/>' +
    '<text x="45" y="68" text-anchor="middle" fill="#8a7968" font-size="11" font-family="sans-serif">No Cover</text></svg>'
  );
  img.src = effectiveCover || NO_COVER_SVG;
  img.onerror = () => { img.src = NO_COVER_SVG; };

  // 一時データを保存してボタン押下時に参照
  document.getElementById('paperAddConfirmModal')._pendingData = {
    title, author: effectiveAuthor, coverUrl: effectiveCover,
    summary: effectiveSummary, genre, detailUrl,
  };

  document.getElementById('paperAddConfirmModal').classList.add('open');
}

function _setPaperConfirmStars(rating) {
  document.querySelectorAll('#paperConfirmStars .paper-star-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.value, 10) <= rating);
  });
}

function closePaperAddConfirm() {
  document.getElementById('paperAddConfirmModal').classList.remove('open');
}

async function _submitPaperBookAdd() {
  const modal = document.getElementById('paperAddConfirmModal');
  const pending = modal._pendingData || {};
  const saveBtn = document.getElementById('paperConfirmSaveBtn');
  saveBtn.disabled = true;
  saveBtn.textContent = '追加中…';

  const title      = document.getElementById('paperConfirmTitle').value.trim();
  const author     = document.getElementById('paperConfirmAuthor').value.trim();
  const status     = document.getElementById('paperConfirmStatus').value;
  const ratingVal  = parseInt(document.getElementById('paperConfirmRating').value || '0', 10) || null;
  const commentVal = document.getElementById('paperConfirmComment').value.trim();

  const today = new Date();
  const pad = n => String(n).padStart(2, '0');
  const jst = '+09:00';
  const completedDate = `${today.getFullYear()}-${pad(today.getMonth()+1)}-${pad(today.getDate())}T${pad(today.getHours())}:${pad(today.getMinutes())}:${pad(today.getSeconds())}${jst}`;

  try {
    const res = await fetch(API.addPaperBook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        author,
        cover_url: pending.coverUrl || '',
        summary: pending.summary || '',
        genre: pending.genre || '',
        completed_date: status === 'completed' ? completedDate : '',
        status,
        detail_url: pending.detailUrl || '',
        rating: ratingVal,
        comment: commentVal,
      }),
    });
    const data = await res.json();
    if (data.duplicate) {
      showToast(`「${title}」はすでに登録済みです`, 'info');
      return;
    }
    if (!data.success) {
      showToast(`登録失敗: ${data.error || '不明なエラー'}`, 'error');
      return;
    }
    closePaperAddConfirm();
    window._lastBookPhotoCover = null;
    window._lastBookInfo = null;
    if (data.books) {
      allBooks = data.books;
      _preprocessBooks(allBooks);
      _rebuildBookIndexMap();
      applyFilters();
      if (activeMainTab === 'yomu') renderBookSearchResults();
    }
    // 保存後に編集モーダルを開いて追加情報を入力できるようにする
    const savedBook = data.book;
    if (savedBook) {
      showToast(`「${title}」を登録しました。追加情報を入力できます`, 'success');
      _justAddedPaperBook = true;
      setTimeout(() => openPaperBookEdit(savedBook), 250);
      addToAmazonList({
        title: savedBook.title || title,
        author: savedBook.author || author,
        cover_url: (savedBook.cover_url || '').startsWith('data:') ? '' : (savedBook.cover_url || ''),
        asin: '',
      }).then(() => loadAmazonList()).catch(() => {});
    } else {
      showToast(`「${title}」を紙の本として登録しました`, 'success');
    }
  } catch (e) {
    showToast('登録中にエラーが発生しました', 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = '追加する';
  }
}

/** 紙の本として既読登録（確認モーダルを経由） */
async function addPaperBook(title, author, coverUrl, summary, genre, detailUrl = '') {
  openPaperAddConfirm(title, author, coverUrl, summary, genre, detailUrl);
}

/** トースト通知 */
function showToast(message, type = 'success') {
  let toast = document.getElementById('yondaToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'yondaToast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.className = `yonda-toast yonda-toast-${type} show`;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 3000);
}

/** アクションボタン付きトースト */
function showActionToast(message, actionLabel, onAction, duration = 6000) {
  const id = 'yondaActionToast';
  let toast = document.getElementById(id);
  if (!toast) {
    toast = document.createElement('div');
    toast.id = id;
    document.body.appendChild(toast);
  }
  toast.innerHTML = `<span class="action-toast-msg">${escapeHtml(message)}</span>
    <button type="button" class="action-toast-btn">${escapeHtml(actionLabel)}</button>`;
  toast.className = 'yonda-action-toast show';
  toast.querySelector('.action-toast-btn').onclick = () => {
    toast.classList.remove('show');
    onAction();
  };
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), duration);
}

/**
 * 正規化ジャンルの色付きバッジ HTML を返す
 * @param {object} book - book オブジェクト
 * @param {boolean} [showOriginal=false] - オリジナルジャンルを小さく表示するか
 */
function genreBadgeHtml(book, showOriginal = false) {
  if (!book.genre) return '';
  const canonical = normalizeGenre(book.genre);
  const colors = CAT_COLORS[canonical] || CAT_COLORS['その他'];
  const bg = book.completed ? colors.read : colors.unread;
  const textColor = book.completed ? '#fff' : '#444';
  const badge = `<span class="genre-badge" style="background:${bg};color:${textColor}" data-filter-genre="${escapeHtml(canonical)}">${escapeHtml(canonical)}</span>`;
  if (!showOriginal) return badge;
  const orig = book.genre === canonical ? '' : `<div class="genre-original">${escapeHtml(book.genre)}</div>`;
  return badge + orig;
}

function getSetagayaRatingUrl(book) {
  return book.detail_url || SOURCE_LINKS.setagaya.url;
}

function genreTags(genre) {
  if (!genre) return [];
  return genre.split(' / ').map(g => g.trim()).filter(Boolean);
}

/** ジャンル選択時: 詳細分類（/ の2番目）でグループ表示用のキーを返す */
function getSubGenreForGrouping(book, selectedGenre) {
  const tags = genreTags(book.genre || '');
  const disp = normalizeGenre(book.genre || '');
  if (disp !== selectedGenre) return null;
  if (tags.length <= 1) return selectedGenre;
  return tags[1];
}

/** ジャンル選択時: 詳細分類でグループ化し、冊数多い順に並べ替えた配列を返す */
function groupBySubGenreForDisplay(books, selectedGenre) {
  const bySub = {};
  for (const b of books) {
    const sg = getSubGenreForGrouping(b, selectedGenre);
    const key = sg || selectedGenre;
    if (!bySub[key]) bySub[key] = [];
    bySub[key].push(b);
  }
  const groups = Object.entries(bySub).sort((a, b) => b[1].length - a[1].length);
  return groups.flatMap(([, arr]) => arr);
}

/* --- Data loading --- */

async function loadBookInsightsCache() {
  try {
    const res = await fetch(API.bookInsights);
    const data = await res.json();
    bookInsightsCache = data.success && data.items ? data.items : {};
  } catch (e) {
    console.error('loadBookInsightsCache error:', e);
    bookInsightsCache = {};
  }
  _rebuildInsightIndex();
}

async function loadMessages() {
  try {
    const res = await fetch(API.messages);
    const data = await res.json();
    yondaMessages = data.success && Array.isArray(data.messages) ? data.messages : [];
    archivedMessages = data.success && Array.isArray(data.archived) ? data.archived : [];
    updateBookTabLabels();
    if (activeBookTab === 'messages') renderMessages();
  } catch (e) {
    console.error('loadMessages error:', e);
    yondaMessages = [];
    archivedMessages = [];
  }
}

function refreshSupplementalData() {
  Promise.all([loadBookInsightsCache(), loadMessages()])
    .then(() => {
      updateBookTabLabels();
      if (document.getElementById('viewTable')?.classList.contains('active')) {
        renderBooks();
      }
      if (activeBookTab === 'messages') {
        renderMessages();
      }
    })
    .catch((e) => console.error('refreshSupplementalData error:', e));
}

async function loadFromFile() {
  const loading = document.getElementById('loading');
  const error = document.getElementById('error');
  const empty = document.getElementById('emptyState');
  if (loading) loading.style.display = 'block';
  if (error) error.style.display = 'none';
  if (empty) empty.style.display = 'none';

  // localStorage キャッシュキー（バージョン＋ユーザー単位）
  const cacheKey = `yonda_books_${APP_VERSION}_${_authUser?.email || 'anon'}`;
  const CACHE_TTL_MS = 3 * 60 * 1000; // 3分

  async function fetchBooks() {
    const res = await fetch(API.books);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'データなし');
    try {
      localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data }));
    } catch (_) {}
    return data;
  }

  let data;
  try {
    // キャッシュ確認
    const cached = (() => {
      try { return JSON.parse(localStorage.getItem(cacheKey) || 'null'); } catch (_) { return null; }
    })();
    if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) {
      data = cached.data;
      // バックグラウンドで最新を取得してキャッシュ更新（stale-while-revalidate）
      fetchBooks().then(fresh => {
        allBooks = fresh.books || [];
        _preprocessBooks(allBooks);
        _rebuildBookIndexMap();
        _bookStatsCache = null;
        updateStats();
        populateSourceFilter(fresh.sources || []);
        updateMenuSyncDates(fresh.sources || []);
        populateGenreFilter();
        applyFilters();
      }).catch(() => {});
    } else {
      data = await fetchBooks();
    }

    allBooks = data.books || [];
    _preprocessBooks(allBooks);
    _rebuildBookIndexMap();
    const sources = data.sources || [];
    updateStats();
    populateSourceFilter(sources);
    updateMenuSyncDates(sources);
    populateGenreFilter();
    showFilters();
    applyFilters();
    refreshSupplementalData();
  } catch (err) {
    if (error) {
      error.textContent = err.message + '。メニューから「読書記録を取込み」を実行してください。';
      error.style.display = 'block';
    }
    allBooks = [];
    _rebuildBookIndexMap();
  } finally {
    if (loading) loading.style.display = 'none';
    if (empty) empty.style.display = allBooks.length === 0 ? 'block' : 'none';
  }
}

let _fetchOtpSessionId = null;

async function fetchFromLibrary(opts = {}) {
  const { sessionId, otp } = opts;
  const loading = document.getElementById('loading');
  const loadingMsg = document.getElementById('loadingMessage');
  const error = document.getElementById('error');
  const empty = document.getElementById('emptyState');
  const fetchBtn = document.getElementById('fetchBtn');
  const libSel = document.getElementById('librarySelect');
  const libraryId = libSel ? libSel.value : 'setagaya';
  const label = libraryId === 'audible_jp' ? 'Audible' : (libraryId === 'kindle' ? 'Kindle' : '図書館');

  loading.style.display = 'block';
  loadingMsg.textContent = sessionId && otp
    ? 'OTP を送信中…'
    : `${label}から読書記録を取得しています…（数十秒かかります）`;
  error.style.display = 'none';
  empty.style.display = 'none';
  if (fetchBtn) fetchBtn.disabled = true;
  document.getElementById('hamburgerMenu')?.classList.remove('open');

  try {
    const body = { library_id: libraryId };
    if (sessionId && otp) {
      body.session_id = sessionId;
      body.otp = otp;
    }
    const res = await fetch(API.fetch, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.needs_otp && data.session_id && libraryId === 'kindle') {
      _fetchOtpSessionId = data.session_id;
      document.getElementById('fetchOtpModal').classList.add('open');
      document.getElementById('fetchOtpInput').value = '';
      document.getElementById('fetchOtpInput').focus();
      document.getElementById('fetchOtpStatus').textContent = data.message || 'OTP を入力してください。';
      document.getElementById('fetchOtpStatus').className = 'modal-status';
    } else if (!data.success) {
      throw new Error(data.error || '取得に失敗しました');
    } else {
      allBooks = data.books || [];
      // 同期後はキャッシュを無効化して次回ロード時に最新データを取得
      try {
        Object.keys(localStorage).filter(k => k.startsWith('yonda_books_')).forEach(k => localStorage.removeItem(k));
      } catch (_) {}
      const sources = data.sources || [];
      updateStats();
      populateSourceFilter(sources);
      updateMenuSyncDates(sources);
      populateGenreFilter();
      showFilters();
      applyFilters();
      refreshSupplementalData();
    }
  } catch (err) {
    error.textContent = err.message;
    error.style.display = 'block';
  } finally {
    loading.style.display = 'none';
    loadingMsg.textContent = '読み込み中…';
    if (fetchBtn) fetchBtn.disabled = false;
    empty.style.display = allBooks.length === 0 ? 'block' : 'none';
  }
}

function closeFetchOtpModal() {
  document.getElementById('fetchOtpModal').classList.remove('open');
  _fetchOtpSessionId = null;
  document.getElementById('fetchOtpStatus').textContent = '';
}

async function submitFetchOtp() {
  const otp = document.getElementById('fetchOtpInput').value.trim();
  const statusEl = document.getElementById('fetchOtpStatus');
  const submitBtn = document.getElementById('fetchOtpSubmitBtn');

  if (!otp || !_fetchOtpSessionId) {
    statusEl.className = 'modal-status error';
    statusEl.textContent = 'OTP を入力してください。';
    return;
  }

  const sid = _fetchOtpSessionId;
  submitBtn.disabled = true;
  statusEl.className = 'modal-status loading';
  statusEl.textContent = 'OTP を確認中…';

  closeFetchOtpModal();
  await fetchFromLibrary({ sessionId: sid, otp });

  submitBtn.disabled = false;
  statusEl.textContent = '';
  statusEl.className = 'modal-status';
}

/* --- Stats --- */

function _computeBookStats() {
  if (_bookStatsCache) return _bookStatsCache;
  const now = new Date();
  const yearStr = String(now.getFullYear());
  const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
  let completed = 0, inProgress = 0, unread = 0, yearlyCompleted = 0, weeklyCompleted = 0, favorite = 0;
  let star5 = 0, star4 = 0, star3 = 0;
  for (const b of allBooks) {
    if (b.completed) {
      completed++;
      if (b.completed_date?.startsWith(yearStr)) yearlyCompleted++;
      if (b.completed_date && new Date(b.completed_date) >= weekAgo) weeklyCompleted++;
    } else if (isInProgress(b)) {
      inProgress++;
    } else {
      unread++;
    }
    if (b.favorite) favorite++;
    const r = displayRating(b) || 0;
    if (r >= 5) star5++;
    if (r >= 4) star4++;
    if (r >= 3) star3++;
  }
  _bookStatsCache = {
    year: +yearStr,
    completed, inProgress, unread, yearlyCompleted, weeklyCompleted, favorite,
    all: allBooks.length,
    star5, star4, star3,
  };
  return _bookStatsCache;
}

function updateStats() {
  const s = _computeBookStats();

  // 今週の読了数（直近7日）
  const weeklyEl = document.getElementById('statWeeklyVal');
  if (weeklyEl) weeklyEl.textContent = String(s.weeklyCompleted);

  // 積読
  const tsundokuEl = document.getElementById('statTsundokuVal');
  if (tsundokuEl) tsundokuEl.textContent = String(s.inProgress);

  // 全読了数（最新メッセージに新規読了があればバッジ表示）
  const latestNewCount = yondaMessages.length > 0
    ? (yondaMessages[0].sync_summary?.new_completed_count || yondaMessages[0].books?.length || 0)
    : 0;
  const ratedEl = document.getElementById('statRatedVal');
  if (ratedEl) {
    ratedEl.innerHTML = latestNewCount > 0
      ? `${s.completed}<span class="stat-new-badge" id="statNewBadge">(${latestNewCount})</span>`
      : String(s.completed);
  }

  updateBookTabLabels(s);
}

function loadReadMessageIds() {
  if (_readIdsCached !== null) return _readIdsCached;
  try {
    const raw = localStorage.getItem(READ_MESSAGES_STORAGE_KEY);
    const ids = JSON.parse(raw || '[]');
    _readIdsCached = new Set(Array.isArray(ids) ? ids : []);
  } catch (_) {
    _readIdsCached = new Set();
  }
  return _readIdsCached;
}

function saveReadMessageIds(ids) {
  _readIdsCached = ids;
  try {
    localStorage.setItem(READ_MESSAGES_STORAGE_KEY, JSON.stringify([...ids].slice(-500)));
  } catch (_) {}
}

function unreadMessageCount() {
  const readIds = loadReadMessageIds();
  return yondaMessages.filter((message, idx) => !readIds.has(messageId(message, idx))).length;
}

function markMessageRead(id) {
  if (!id) return;
  const readIds = loadReadMessageIds();
  if (readIds.has(id)) return;
  readIds.add(id);
  saveReadMessageIds(readIds);
  updateBookTabLabels();
}

function updateBookTabLabels(s) {
  if (!s) s = _computeBookStats();
  const { completed: readCount, inProgress: inProgressCount, unread: unreadCount,
          year, yearlyCompleted: yearlyCount, favorite: favoriteCount, all: allCount,
          star5, star4, star3 } = s;
  const rating = document.getElementById('ratingFilter')?.value || 'completed';
  const tabRead = document.getElementById('tabRead');
  const tabRanking = document.getElementById('tabRanking');
  const tabRecommend = document.getElementById('tabRecommend');
  const menuMessages = document.getElementById('menuMessages');
  if (tabRead) {
    let label;
    if (rating === 'completed') label = `読んだ（${readCount}）`;
    else if (rating === 'in_progress') label = `途中（${inProgressCount}）`;
    else if (rating === 'not_completed') label = `未読（${unreadCount}）`;
    else if (rating === 'weekly_completed') label = '今週の読了';
    else if (rating === 'monthly_completed') label = '今月の読了';
    else if (rating === 'yearly_completed') label = `${year}年`;
    else if (rating === 'favorite') label = 'お気に入り';
    else if (rating === 'all') label = `すべて（${allCount}）`;
    else if (rating === '5') label = `★★★★★（${star5}）`;
    else if (rating === '4') label = `★★★★☆以上（${star4}）`;
    else if (rating === '3') label = `★★★☆☆以上（${star3}）`;
    else {
      const sel = document.getElementById('ratingFilter');
      label = sel?.selectedOptions?.[0]?.textContent || 'Yonda';
    }
    // ログインユーザーのアイコンをタブに表示
    if (_authUser) {
      const pic = _authUser.picture
        ? (_authUser.picture.includes('=s') ? _authUser.picture : _authUser.picture + '=s32-c')
        : '';
      const init = escapeHtml(([...((_authUser.name || _authUser.email || '?').split(' ')[0])][0] || '?').toUpperCase());
      const avatarHtml = pic
        ? `<img src="${escapeHtml(pic)}" class="tab-user-avatar" alt="" onerror="this.style.display='none'">`
        : `<span class="tab-user-avatar tab-user-avatar-init">${init}</span>`;
      tabRead.innerHTML = `${avatarHtml}<span>${escapeHtml(label)}</span>`;
    } else {
      tabRead.textContent = label;
    }
  }
  if (tabRanking) tabRanking.textContent = 'ランキング';
  const tabCommunity = document.getElementById('tabCommunity');
  if (tabCommunity) tabCommunity.textContent = 'みんな';
  const messageUnreadCount = unreadMessageCount();
  if (menuMessages) menuMessages.textContent = `メッセージ${messageUnreadCount ? `（${messageUnreadCount}）` : ''}`;
}

/* --- Filters --- */

function showFilters() {
  const filterWrapper = document.getElementById('filterWrapper');
  if (filterWrapper) filterWrapper.style.display = activeMainTab === 'yonda' && allBooks.length > 0 ? 'block' : 'none';
  populateRankingFilters();
  const bookTabs = document.getElementById('bookTabs');
  if (bookTabs) {
    bookTabs.style.display = allBooks.length > 0 ? 'flex' : 'none';
  }
  const myRankingBar = document.getElementById('myRankingBar');
  if (myRankingBar) myRankingBar.style.display = (activeMainTab === 'yonda' && activeBookTab === 'ranking' && allBooks.length > 0) ? 'flex' : 'none';
  updateTabContentVisibility();
  updateMainTabVisibility();
}

function updateMainTabVisibility() {
  document.querySelectorAll('.main-content').forEach(el => { el.style.display = 'none'; });
  const yonda = document.getElementById('mainContentYonda');
  const yomu = document.getElementById('mainContentYomu');
  if (activeMainTab === 'yonda' && yonda) yonda.style.display = 'block';
  else if (activeMainTab === 'yomu' && yomu) {
    yomu.style.display = 'block';
    renderBookSearchResults();
    renderTagAnalytics();
    initAiRecommendIfNeeded(); // AI推し（旧Oshi）はYomu下部に統合
  }
  document.querySelectorAll('.header-tab').forEach(t => t.classList.remove('active'));
  const activeTab = document.querySelector(`.header-tab[data-main-tab="${activeMainTab}"]`);
  if (activeTab) activeTab.classList.add('active');
  const headerSearch = document.querySelector('.header-search');
  if (headerSearch) headerSearch.style.display = activeMainTab === 'yonda' ? '' : 'none';
}

function updateTabContentVisibility() {
  if (activeMainTab !== 'yonda') return;
  const bookList = document.getElementById('bookList');
  const pagination = document.getElementById('pagination');
  const rankingSection = document.getElementById('rankingSection');
  const myRankingBar = document.getElementById('myRankingBar');
  const communitySection = document.getElementById('communitySection');
  const messagesSection = document.getElementById('messagesSection');

  // ランキングバー（年フィルター）はランキングタブのみ表示
  if (myRankingBar) myRankingBar.style.display = (activeBookTab === 'ranking' && allBooks.length > 0) ? 'flex' : 'none';

  const chartSection = document.getElementById('chartSection');

  if (activeBookTab === 'ranking') {
    if (bookList) bookList.style.display = 'none';
    if (pagination) pagination.style.display = 'none';
    if (communitySection) communitySection.style.display = 'none';
    if (messagesSection) messagesSection.style.display = 'none';
    if (chartSection) chartSection.style.display = 'none';
    if (rankingSection) {
      rankingSection.style.display = 'block';
      selectedRankingGenre = null;
      populateRankingFilters();
      renderRanking();
    }
  } else if (activeBookTab === 'community') {
    if (bookList) bookList.style.display = 'none';
    if (pagination) pagination.style.display = 'none';
    if (rankingSection) rankingSection.style.display = 'none';
    if (messagesSection) messagesSection.style.display = 'none';
    if (chartSection) chartSection.style.display = 'none';
    if (communitySection) {
      communitySection.style.display = 'block';
      renderCommunitySection();
    }
  } else if (activeBookTab === 'messages') {
    if (bookList) bookList.style.display = 'none';
    if (pagination) pagination.style.display = 'none';
    if (rankingSection) rankingSection.style.display = 'none';
    if (communitySection) communitySection.style.display = 'none';
    if (chartSection) chartSection.style.display = 'none';
    if (messagesSection) {
      messagesSection.style.display = 'block';
      renderMessages();
    }
  } else {
    // read タブ — グラフを（データがあれば）表示
    if (rankingSection) rankingSection.style.display = 'none';
    if (communitySection) communitySection.style.display = 'none';
    if (messagesSection) messagesSection.style.display = 'none';
    if (chartSection && allBooks.length > 0) scheduleRenderCharts();
    // bookList / pagination は renderBooks で表示制御
  }
}

function populateSourceFilter(sources) {
  const sel = document.getElementById('sourceFilter');
  if (!sel) return;
  const current = sel.value;
  const opts = ['<option value="all">すべて</option>'];
  if (sources && sources.length > 0) {
    for (const s of sources) {
      opts.push(`<option value="${escapeHtml(s.library_id)}">${escapeHtml(sourceLabel(s.library_id))}（${s.total}冊）</option>`);
    }
  } else {
    for (const id of [...new Set(allBooks.map(b => b.source).filter(Boolean))]) {
      opts.push(`<option value="${escapeHtml(id)}">${escapeHtml(sourceLabel(id))}</option>`);
    }
  }
  sel.innerHTML = opts.join('');
  if ([...sel.options].some(o => o.value === current)) sel.value = current;
}

function populateGenreFilter() {
  const sel = document.getElementById('genreFilter');
  if (!sel) return;
  const current = sel.value;
  const genreCount = {};
  for (const b of allBooks) {
    const g = b._normalizedGenre || 'その他';
    genreCount[g] = (genreCount[g] || 0) + 1;
  }
  const sorted = Object.entries(genreCount)
    .sort((a, b) => b[1] - a[1]);
  const html = ['<option value="all">すべて</option>'];
  for (const [g, cnt] of sorted) {
    html.push(`<option value="${escapeHtml(g)}">${escapeHtml(g)}（${cnt}）</option>`);
  }
  sel.innerHTML = html.join('');
  if ([...sel.options].some(o => o.value === current)) sel.value = current;
}

function populateRankingFilters() {
  const yearSel = document.getElementById('rankingYearFilter');
  if (!yearSel) return;
  const completed = allBooks.filter(b => b.completed && (displayRating(b) || 0) > 0);
  const years = [...new Set(completed.map(b => (b.completed_date || '').slice(0, 4)).filter(Boolean))].sort().reverse();
  const yearCurrent = yearSel.value;
  // Map で事前集計し、最後に一括 innerHTML セット
  const yearCounts = new Map(years.map(y => [y, 0]));
  for (const b of completed) {
    const y = (b.completed_date || '').slice(0, 4);
    if (yearCounts.has(y)) yearCounts.set(y, yearCounts.get(y) + 1);
  }
  const opts = ['<option value="all">全期間</option>',
    ...years.map(y => `<option value="${y}">${y}年（${yearCounts.get(y)}冊）</option>`)];
  yearSel.innerHTML = opts.join('');
  if ([...yearSel.options].some(o => o.value === yearCurrent)) yearSel.value = yearCurrent;
}

/** ランキング得点: 表示評価 > お気に入り > コメント文字数 > カタログ評価 の優先順
 *  優先度: 星(100000) > ♥(10000) > コメント最大9999文字(1pt/文字) > カタログ評価(/100) */
function rankingScore(book) {
  const stars      = displayRating(book) || 0;
  const favorite   = book.favorite ? 1 : 0;
  const commentLen = Math.min(
    ((book.source === 'audible_jp' ? book.review_headline : book.comment) || '').trim().length,
    9999  // 最大9999pt → ♥の10000ptを絶対に超えない
  );
  const catalog = (book.catalog_rating || 0) / 100; // 最大0.05pt → コメント1文字(1pt)を超えない
  return stars * 100000 + favorite * 10000 + commentLen + catalog;
}

function getRankingByGenre() {
  let books = allBooks.filter(b => b.completed && (displayRating(b) || 0) > 0);
  const year = document.getElementById('rankingYearFilter')?.value;
  if (year && year !== 'all') {
    books = books.filter(b => (b.completed_date || '').startsWith(year));
  }
  const byGenre = {};
  for (const b of books) {
    const g = b._normalizedGenre || normalizeGenre(b.genre || '') || 'その他';
    if (!byGenre[g]) byGenre[g] = [];
    byGenre[g].push(b);
  }
  for (const g of Object.keys(byGenre)) {
    byGenre[g].sort((a, b) => rankingScore(b) - rankingScore(a));
  }
  return byGenre;
}

function renderRankingItem(book, rank) {
  const cover = book.cover_url || NO_COVER;
  const stars = book.source === 'audible_jp'
    ? starsHtml(displayRating(book), { asLink: true, source: book.source, detailUrl: getAudibleRatingUrl(book) })
    : book.source === 'setagaya'
      ? starsHtml(book.rating, { asLink: true, source: book.source, detailUrl: getSetagayaRatingUrl(book) })
      : starsHtml(book.rating);
  const favMark = book.favorite ? ' <span class="ranking-fav" title="お気に入り">♥</span>' : '';
  const comment = ratingCommentText(book);
  const completedYear = (book.completed_date || '').slice(0, 4);
  const dateStr = completedYear ? `読了 ${completedYear}年` : '';
  return `
    <div class="ranking-item book-card-clickable" data-book-index="${_bookIndex(book)}" role="button" tabindex="0">
      <span class="ranking-rank">${rank}位</span>
      <img class="book-cover ranking-cover" src="${escapeHtml(cover)}" alt="" loading="lazy" onerror="this.src='${NO_COVER}'">
      <div class="ranking-body">
        <div class="ranking-title">${escapeHtml(book.title || '—')}${favMark}</div>
        <div class="ranking-author">${escapeHtml(book.author || '')}</div>
        <div class="ranking-meta">
          <span class="ranking-stars">${stars}</span>
          ${comment ? `<span class="ranking-comment">${escapeHtml(comment)}</span>` : ''}
          ${dateStr ? `<span class="ranking-date">${escapeHtml(dateStr)}</span>` : ''}
        </div>
      </div>
    </div>
  `;
}

let selectedRankingGenre = null;

function renderRanking() {
  const listEl = document.getElementById('rankingList');
  if (!listEl) return;
  const byGenre = getRankingByGenre();
  const genres = Object.entries(byGenre)
    .filter(([, arr]) => arr.length > 0)
    .sort((a, b) => b[1].length - a[1].length);
  if (genres.length === 0) {
    listEl.innerHTML = '<p class="ranking-empty">該当する本がありません</p>';
    return;
  }
  if (selectedRankingGenre) {
    const genreBooks = byGenre[selectedRankingGenre] || [];
    const items = genreBooks.map((book, i) => renderRankingItem(book, i + 1)).join('');
    listEl.innerHTML = `
      <div class="ranking-genre-detail">
        <button type="button" class="ranking-back-btn" id="rankingBackBtn">← 一覧に戻る</button>
        <h3 class="ranking-genre-title">${escapeHtml(selectedRankingGenre)}（${genreBooks.length}冊）</h3>
        <div class="ranking-genre-row">${items}</div>
      </div>
    `;
    listEl.querySelector('#rankingBackBtn')?.addEventListener('click', () => {
      selectedRankingGenre = null;
      renderRanking();
    });
  } else {
    const sections = genres.map(([genreName, genreBooks]) => {
      const toShow = genreBooks.slice(0, 5);
      const items = toShow.map((book, i) => renderRankingItem(book, i + 1)).join('');
      return `
        <div class="ranking-genre-block">
          <h3 class="ranking-genre-title ranking-genre-clickable" data-genre="${escapeHtml(genreName)}">${escapeHtml(genreName)}（${genreBooks.length}冊）</h3>
          <div class="ranking-genre-row">${items}</div>
        </div>
      `;
    }).join('');
    listEl.innerHTML = `<div class="ranking-by-genre">${sections}</div>`;
    listEl.querySelectorAll('.ranking-genre-clickable').forEach((el) => {
      el.addEventListener('click', () => {
        selectedRankingGenre = el.getAttribute('data-genre');
        renderRanking();
      });
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          el.click();
        }
      });
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
    });
  }
  listEl.querySelectorAll('.ranking-item').forEach((el) => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.getAttribute('data-book-index'), 10);
      if (!isNaN(idx) && allBooks[idx]) openBookDetail(allBooks[idx]);
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        el.click();
      }
    });
  });
}

let _yondaRecommendCache = null;

function showRecommendInitialState() {
  const initialEl = document.getElementById('recommendInitial');
  const listEl = document.getElementById('recommendList');
  const refreshBtn = document.getElementById('recommendRefreshBtn');
  if (initialEl) initialEl.style.display = 'flex';
  if (listEl) listEl.innerHTML = '';
  if (refreshBtn) refreshBtn.style.display = 'none';
}

/** AI推しセクション（Yomuページ下部）で読書履歴ベース推薦を実行 */
async function renderHistoryRecommend() {
  const listEl = document.getElementById('historyRecommendList');
  const loadingEl = document.getElementById('historyRecommendLoading');
  const refreshBtn = document.getElementById('historyRecommendRefreshBtn');
  if (!listEl) return;

  const completed = allBooks.filter(b => b.completed).slice(0, 20);
  const unread = allBooks.filter(b => !b.completed);
  if (completed.length === 0 || unread.length === 0) {
    listEl.innerHTML = '<p class="recommend-empty">読了本と未読本の両方が必要です。読書記録を取込んでください。</p>';
    if (loadingEl) loadingEl.style.display = 'none';
    return;
  }

  if (loadingEl) loadingEl.style.display = 'block';
  listEl.innerHTML = '';
  if (refreshBtn) refreshBtn.style.display = 'none';

  try {
    const res = await fetch(API.yondaRecommend, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        completed_books: completed.map(b => ({ title: b.title, author: b.author, genre: b.genre })),
        unread_books: unread.map(b => ({ title: b.title, author: b.author, genre: b.genre })),
      }),
    });
    const data = await res.json();
    if (loadingEl) loadingEl.style.display = 'none';
    if (!data.success) {
      listEl.innerHTML = `<p class="recommend-error">${escapeHtml(data.error || 'エラー')}</p>`;
      return;
    }
    const recs = data.recommendations || [];
    if (recs.length === 0) {
      listEl.innerHTML = '<p class="recommend-empty">おすすめが見つかりませんでした。</p>';
      return;
    }
    listEl.innerHTML = recs.map((rec, i) => {
      const book = rec.book || rec;
      const reason = rec.reason || '';
      const cardHtml = renderAiRecommendBookCards([book]);
      const reasonHtml = reason
        ? `<div class="history-recommend-reason"><span class="history-recommend-reason-label">推薦理由</span>${escapeHtml(reason)}</div>`
        : '';
      return `<div class="history-recommend-item">
        <div class="history-recommend-card-wrap">${cardHtml}</div>
        ${reasonHtml}
      </div>`;
    }).join('');
    if (refreshBtn) refreshBtn.style.display = 'block';
  } catch (e) {
    if (loadingEl) loadingEl.style.display = 'none';
    listEl.innerHTML = `<p class="recommend-error">エラー: ${escapeHtml(e.message)}</p>`;
  }
}
document.getElementById('historyRecommendRefreshBtn')?.addEventListener('click', renderHistoryRecommend);

/** みんなのYonda タブ: 日付→ユーザー名の順でグルーピングして表示 */
// コミュニティ用書籍キャッシュ（イベントデリゲーション用）
const _communityBookCache = new Map();

function renderCommunitySection() {
  const listEl = document.getElementById('communityMessageList');
  const loadingEl = document.getElementById('communityLoading');
  if (!listEl) return;

  // yondaMessages が未ロードなら fetch してからレンダリング
  if (!yondaMessages.length && !archivedMessages.length) {
    if (loadingEl) loadingEl.style.display = 'block';
    listEl.innerHTML = '';
    loadMessages().then(() => {
      if (loadingEl) loadingEl.style.display = 'none';
      _renderCommunityFromCache(listEl);
    }).catch(e => {
      if (loadingEl) loadingEl.style.display = 'none';
      listEl.innerHTML = `<p class="recommend-error">取得エラー: ${escapeHtml(e.message)}</p>`;
    });
    return;
  }
  if (loadingEl) loadingEl.style.display = 'none';
  _renderCommunityFromCache(listEl);
}

function _renderCommunityFromCache(listEl) {
  const messages = yondaMessages.slice(0, 50);
  if (messages.length === 0) {
    listEl.innerHTML = '<p class="recommend-empty">まだ投稿がありません。</p>';
    return;
  }

  const toDateKey = ts => {
    if (!ts) return '日時不明';
    const d = new Date(ts);
    if (isNaN(d)) return '日時不明';
    return `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日`;
  };

  // 日付 → ユーザーID → メッセージ[] でグルーピング
  const dateMap = new Map();
  for (const msg of messages) {
    const dateKey = toDateKey(msg.created_at);
    const msgUser = msg.user || {};
    const userId = msgUser.id || msgUser.email || '匿名';
    if (!dateMap.has(dateKey)) dateMap.set(dateKey, new Map());
    const userMap = dateMap.get(dateKey);
    if (!userMap.has(userId)) userMap.set(userId, { user: msgUser, msgs: [] });
    userMap.get(userId).msgs.push(msg);
  }

  _communityBookCache.clear();
  let cacheIdx = 0;
  const fragments = [];

  dateMap.forEach((userMap, dateKey) => {
    const userBlocks = [];
    userMap.forEach(({ user: msgUser, msgs }) => {
      const userName = (msgUser.name || msgUser.email || '匿名').split(' ')[0];
      const avatarSrc = msgUser.picture || '';
      const avatarUrl = avatarSrc && !avatarSrc.includes('=s') ? avatarSrc + '=s64-c' : avatarSrc;
      const initial = escapeHtml([...userName][0] || '?');
      const avatarHtml = avatarUrl
        ? `<img src="${escapeHtml(avatarUrl)}" class="ig-avatar" alt="${escapeHtml(userName)}" loading="lazy"
             onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"
           ><div class="ig-avatar ig-avatar-placeholder" style="display:none;">${initial}</div>`
        : `<div class="ig-avatar ig-avatar-placeholder">${initial}</div>`;

      const seenTitles = new Set();
      const allMsgBooks = msgs.flatMap(msg => (msg.books || []).filter(item => {
        const b = item.book || item;
        if (!b.title || seenTitles.has(b.title)) return false;
        seenTitles.add(b.title);
        return true;
      }));

      // 読了日降順 → 未読は末尾
      allMsgBooks.sort((a, b) => {
        const ba = a.book || a, bb = b.book || b;
        const da = ba.completed_date || '';
        const db = bb.completed_date || '';
        if (da && db) return da > db ? -1 : da < db ? 1 : 0;
        if (da) return -1;
        if (db) return 1;
        return 0;
      });

      const bookCards = allMsgBooks.map(item => {
        const book = item.book || item;
        const cacheKey = `c${cacheIdx++}`;
        _communityBookCache.set(cacheKey, book);
        // O(1) lookupで allBooks.find() を排除
        const myBook = findBookFromMessage(book);
        const merged = (myBook && myBook !== book) ? { ...book, ...myBook } : book;
        return renderBookCardHtml(merged, {
          extraClass: 'community-book-card-item',
          extraAttrs: `data-cache-key="${cacheKey}"`,
          showUnrated: !!(myBook && myBook !== book) && !!_authUser,
          communityUnrated: true,
          showProgress: false,
        });
      }).join('');

      // 本が0冊のフィードは表示しない
      if (allMsgBooks.length === 0) return;

      userBlocks.push(`<div class="ig-post-card">
        <div class="ig-post-header">
          ${avatarHtml}
          <span class="ig-user-name">${escapeHtml(userName)}</span>
          <span class="ig-post-count">${allMsgBooks.length}冊</span>
        </div>
        <div class="community-cards-wrap">${bookCards}</div>
      </div>`);
    });

    // 本が1冊以上あるブロックのみ残った日付グループを出力
    if (userBlocks.length > 0) {
      fragments.push(`<div class="community-date-group">
        <div class="community-date-header">${escapeHtml(dateKey)}</div>
        ${userBlocks.join('')}
      </div>`);
    }
  });

  listEl.innerHTML = fragments.join('');

  // イベントデリゲーション（querySelectorAll+個別登録を廃止）
  listEl.onclick = e => {
    const card = e.target.closest('.community-book-card-item');
    if (!card) return;
    const msgBook = _communityBookCache.get(card.dataset.cacheKey);
    if (!msgBook) return;
    const found = findBookFromMessage(msgBook);
    openBookDetail((found && found !== msgBook) ? found : msgBook);
  };
}
// プルトゥリフレッシュ（communitySection が表示中に引き下げで更新）
(function() {
  let startY = 0;
  let pulling = false;
  const THRESHOLD = 70;
  const indicator = document.getElementById('pullToRefreshIndicator');
  if (!indicator) return;

  const isCommunityVisible = () => {
    const el = document.getElementById('communitySection');
    return el && el.style.display !== 'none';
  };

  document.addEventListener('touchstart', (e) => {
    if (!isCommunityVisible()) return;
    if (window.scrollY === 0) {
      startY = e.touches[0].clientY;
      pulling = true;
    }
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!pulling || !isCommunityVisible()) return;
    const dy = e.touches[0].clientY - startY;
    if (dy > 0) {
      const progress = Math.min(dy / THRESHOLD, 1);
      indicator.style.opacity = String(progress);
      indicator.style.transform = `translateY(${Math.min(dy * 0.4, 28)}px)`;
      indicator.querySelector('.ptr-arrow').textContent = dy >= THRESHOLD ? '↻' : '↓';
    }
  }, { passive: true });

  document.addEventListener('touchend', (e) => {
    if (!pulling) return;
    pulling = false;
    const dy = e.changedTouches[0].clientY - startY;
    indicator.style.opacity = '0';
    indicator.style.transform = '';
    indicator.querySelector('.ptr-arrow').textContent = '↓';
    if (dy >= THRESHOLD && isCommunityVisible()) renderCommunitySection();
  });
})();

async function renderYondaRecommend() {
  const listEl = document.getElementById('recommendList');
  const loadingEl = document.getElementById('recommendLoading');
  const initialEl = document.getElementById('recommendInitial');
  const refreshBtn = document.getElementById('recommendRefreshBtn');
  if (!listEl) return;

  const completed = allBooks.filter(b => b.completed).slice(0, 20);
  const unread = allBooks.filter(b => !b.completed);
  if (completed.length === 0 || unread.length === 0) {
    if (initialEl) initialEl.style.display = 'flex';
    listEl.innerHTML = '<p class="recommend-empty">読了本と未読本の両方が必要です。読書記録を取込んでください。</p>';
    if (loadingEl) loadingEl.style.display = 'none';
    if (refreshBtn) refreshBtn.style.display = 'none';
    return;
  }

  if (initialEl) initialEl.style.display = 'none';
  if (loadingEl) loadingEl.style.display = 'block';
  listEl.innerHTML = '';

  try {
    const res = await fetch(API.yondaRecommend, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        completed_books: completed.map(b => ({ title: b.title, author: b.author, genre: b.genre })),
        unread_books: unread.map(b => ({ ...b, title: b.title, author: b.author, genre: b.genre })),
      }),
    });
    const data = await res.json();
    if (loadingEl) loadingEl.style.display = 'none';
    if (!data.success) {
      if (initialEl) initialEl.style.display = 'flex';
      listEl.innerHTML = `<p class="recommend-error">${escapeHtml(data.error || 'エラー')}</p>`;
      if (refreshBtn) refreshBtn.style.display = 'none';
      return;
    }
    const recs = data.recommendations || [];
    if (recs.length === 0) {
      if (initialEl) initialEl.style.display = 'flex';
      listEl.innerHTML = '<p class="recommend-empty">おすすめを生成できませんでした。</p>';
      if (refreshBtn) refreshBtn.style.display = 'none';
      return;
    }
    const modelLabel = data.model ? ` (${data.model})` : '';
    const items = recs.map((r, i) => {
      const b = r.book;
      const cover = b.cover_url || NO_COVER;
      const idx = _bookIndex(b);
      const searchText = `${b.title || ''} ${b.author || ''}`.trim();
      const urls = getBookSearchUrls(searchText, { bookTitle: b.title });
      return `
        <div class="recommend-item book-card-clickable" data-book-index="${idx}" role="button" tabindex="0">
          <img class="book-cover recommend-cover" src="${escapeHtml(cover)}" alt="" loading="lazy" onerror="this.src='${NO_COVER}'">
          <div class="recommend-body">
            <div class="recommend-title">${i + 1}. ${escapeHtml(b.title || '—')}</div>
            <div class="recommend-author">${escapeHtml(b.author || '')}</div>
            ${r.reason ? `<p class="recommend-reason">${escapeHtml(r.reason)}</p>` : ''}
            <div class="recommend-links">
              <a href="${escapeHtml(urls.amazon)}" target="_blank" rel="noopener">Amazon</a>
              <a href="${escapeHtml(urls.audible)}" target="_blank" rel="noopener">Audible</a>
            </div>
          </div>
        </div>
      `;
    }).join('');
    listEl.innerHTML = `<p class="recommend-model">AI${modelLabel}によるおすすめ</p><div class="recommend-grid">${items}</div>`;
    if (refreshBtn) refreshBtn.style.display = 'block';
    listEl.querySelectorAll('.recommend-item').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('a')) return;
        const idx = parseInt(el.getAttribute('data-book-index'), 10);
        if (!isNaN(idx) && allBooks[idx]) openBookDetail(allBooks[idx]);
      });
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          el.click();
        }
      });
    });
  } catch (err) {
    if (loadingEl) loadingEl.style.display = 'none';
    if (initialEl) initialEl.style.display = 'flex';
    listEl.innerHTML = `<p class="recommend-error">${escapeHtml(err.message || 'エラー')}</p>`;
    if (refreshBtn) refreshBtn.style.display = 'none';
  }
}

function applyFilters() {
  if (activeBookTab === 'messages') {
    updateTabContentVisibility();
    return;
  }
  if (activeBookTab === 'community') {
    updateTabContentVisibility();
    return;
  }
  if (activeBookTab === 'ranking') {
    updateTabContentVisibility();
    return;
  }

  const searchRaw = (document.getElementById('searchInputYonda')?.value || '').trim();
  const searchNorm = normalizeForSearch(searchRaw);
  const source = document.getElementById('sourceFilter').value;
  const genre = document.getElementById('genreFilter').value;
  const rating = document.getElementById('ratingFilter').value;

  // 日付フィルタ用のカットオフ文字列をループ外で1回だけ計算（new Date を2000回生成しない）
  const _now = Date.now();
  const weekAgoStr  = new Date(_now - 7  * 86400000).toISOString().slice(0, 10);
  const monthAgoStr = (() => {
    const d = new Date(_now); d.setDate(1);
    return d.toISOString().slice(0, 10);
  })();
  const yearStr = String(new Date(_now).getFullYear());

  let books = allBooks.slice();

  if (searchNorm) {
    // 事前計算済みの正規化フィールドを使うので normalizeForSearch の再実行なし
    books = books.filter(b =>
      matchesSearch(searchNorm, b._normalizedTitle,   true) ||
      matchesSearch(searchNorm, b._normalizedAuthor,  true) ||
      matchesSearch(searchNorm, b._normalizedComment, true)
    );
  }
  if (source !== 'all') {
    books = books.filter(b => b.source === source);
  }
  if (genre !== 'all') {
    books = books.filter(b => (b._normalizedGenre || 'その他') === genre);
  }
  if (rating === 'completed') {
    books = books.filter(b => b.completed);
  } else if (rating === 'in_progress') {
    books = books.filter(b => isInProgress(b));
  } else if (rating === 'weekly_completed') {
    // 文字列比較（YYYY-MM-DD の辞書順 = 日付順）で new Date() 生成を回避
    books = books.filter(b => b.completed && b._completedDateStr >= weekAgoStr);
  } else if (rating === 'monthly_completed') {
    books = books.filter(b => b.completed && b._completedDateStr >= monthAgoStr);
  } else if (rating === 'yearly_completed') {
    books = books.filter(b => b.completed && b._completedDateStr.startsWith(yearStr));
  } else if (rating === 'not_completed') {
    books = books.filter(b => isUnread(b));
  } else if (rating === 'favorite') {
    books = books.filter(b => b.favorite);
  } else if (rating !== 'all') {
    const min = parseInt(rating);
    books = books.filter(b => b.rating >= min);
  }

  books = applySorting(books);
  if (genre !== 'all') books = groupBySubGenreForDisplay(books, genre);
  filteredBooks = books;
  currentPage = 0;
  updateTabContentVisibility();
  renderBooks();
  activeChartSource = null;
  scheduleRenderCharts();
}

/* --- 本検索（外部リンク表示） --- */

/** ファイルを base64 に変換 */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      resolve(match ? { mime_type: match[1], base64: match[2] } : null);
    };
    reader.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
    reader.readAsDataURL(file);
  });
}

let _tesseractLoadPromise = null;
function loadTesseract() {
  if (typeof Tesseract !== 'undefined') return Promise.resolve();
  if (_tesseractLoadPromise) return _tesseractLoadPromise;
  _tesseractLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('OCRライブラリの読み込みに失敗しました'));
    document.head.appendChild(script);
  });
  return _tesseractLoadPromise;
}

/** 写真から本情報を取得して検索 */
async function processBookPhoto(file) {
  const statusEl = document.getElementById('bookSearchPhotoStatus');
  const inputEl = document.getElementById('searchInput');
  if (!statusEl || !inputEl) return;

  const setStatus = (msg, isError = false) => {
    statusEl.textContent = msg;
    statusEl.className = 'book-search-photo-status' + (isError ? ' error' : '');
  };

  setStatus('画像を解析中…');
  let searchText = '';
  let showedError = false;
  window._lastAiExtractModel = null;

  try {
    const aiRes = await fetch('/api/ai-config');
    const aiCfg = await aiRes.json();
    if (aiCfg.configured) {
      const p = aiCfg.provider === 'gemini' ? 'Gemini' : (aiCfg.provider === 'openai' ? 'OpenAI' : '');
      setStatus(p ? `AI (${p}) で画像を解析中…` : 'AI で画像を解析中…');
      const encoded = await fileToBase64(file);
      if (encoded && encoded.base64) {
        const { mime_type, base64 } = encoded;
        const res = await fetch('/api/ai-extract-book', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_base64: base64, mime_type: mime_type || 'image/jpeg' }),
        });
        const data = await res.json();
        if (data.success && data.search_text) {
          searchText = data.search_text;
          window._lastAiExtractProvider = data.provider;
          window._lastAiExtractModel = data.model;
        }
      }
    }
  } catch (_) {}

  if (!searchText) {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    try {
      await new Promise((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
        img.src = objectUrl;
      });
      if (typeof BarcodeDetector !== 'undefined') {
        try {
          const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a'] });
          const barcodes = await detector.detect(img);
          for (const b of barcodes) {
            const raw = (b.rawValue || '').replace(/\D/g, '');
            if (raw.length >= 10 && raw.length <= 13) {
              const res = await fetch(`/api/isbn/${raw}`);
              const data = await res.json();
              if (data.success && data.search_text) {
                searchText = data.search_text;
                break;
              }
            }
          }
        } catch (_) {}
      }
      if (!searchText) {
        setStatus('OCRライブラリを読み込み中…');
        await loadTesseract();
      }
      if (!searchText && typeof Tesseract !== 'undefined') {
        setStatus('OCRで画像を解析中…');
        const { data: { text } } = await Tesseract.recognize(img, 'jpn+eng', { logger: () => {} });
        searchText = (text || '').replace(/\s+/g, ' ').trim();
        if (searchText.length > 100) searchText = searchText.substring(0, 100);
      }
    } catch (err) {
      setStatus(err.message || '画像の読み込みに失敗しました', true);
      showedError = true;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  if (searchText) {
    // 撮影した写真を表紙用に圧縮保存（200×280px / JPEG 75%）
    try {
      window._lastBookPhotoCover = await _compressImageToBase64(file, 200, 280);
    } catch (_) {
      window._lastBookPhotoCover = null;
    }
    window._lastBookInfo = null; // リセット
    inputEl.value = searchText;
    const modelLabel = window._lastAiExtractModel || (window._lastAiExtractProvider === 'gemini' ? 'Gemini' : (window._lastAiExtractProvider === 'openai' ? 'OpenAI' : ''));
    const statusSuffix = modelLabel ? ` (${modelLabel})` : '';
    setStatus('検索しました: ' + searchText.substring(0, 30) + (searchText.length > 30 ? '…' : '') + statusSuffix);
    renderBookSearchResults();
    // バックグラウンドで著者・概要・ジャンルを取得
    const parts = searchText.split(/\s+/);
    const titleGuess = parts[0] || searchText;
    const authorGuess = parts.slice(1).join(' ');
    const params = new URLSearchParams({ q: searchText });
    if (titleGuess) params.set('title', titleGuess);
    if (authorGuess) params.set('author', authorGuess);
    fetch(`${API.bookInfo}?${params}`)
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          window._lastBookInfo = {
            author: data.author || authorGuess || '',
            summary: data.summary || '',
          };
          // パネルが表示中なら更新
          const panel = document.getElementById('searchNoResults');
          if (panel && panel.style.display !== 'none') {
            updateSearchNoResultsPanel(searchText);
          }
        }
      })
      .catch(() => {});
  } else if (!showedError) {
    setStatus('本の情報を取得できませんでした。検索語を手入力してください。', true);
  }
}

function searchBooksForLinks(query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return [];
  return allBooks.filter(b =>
    (b.title || '').toLowerCase().includes(q) ||
    (b.author || '').toLowerCase().includes(q)
  );
}

function renderBookSearchResults() {
  const input = document.getElementById('searchInput');
  const resultsEl = document.getElementById('bookSearchResults');
  if (!input || !resultsEl) return;

  const query = (input.value || '').trim();
  if (!query) {
    resultsEl.innerHTML = '';
    resultsEl.style.display = 'none';
    return;
  }

  const matches = searchBooksForLinks(query);
  const urls = getBookSearchUrls(query, { libraryQuery: query });

  if (matches.length === 0) {
    const bookData = JSON.stringify({ title: query, author: '', asin: '', cover_url: '' });
    resultsEl.innerHTML = `
      <div class="book-search-result-item book-search-links-only">
        <p class="book-search-query">「${escapeHtml(query)}」で検索</p>
        <div class="book-search-links">
          <a href="${urls.kindle}" target="_blank" rel="noopener" class="book-search-link book-search-link-kindle">Kindle</a>
          <a href="${urls.audible}" target="_blank" rel="noopener" class="book-search-link book-search-link-audible">Audible</a>
          <a href="${urls.mercari}" target="_blank" rel="noopener" class="book-search-link book-search-link-mercari">メルカリ</a>
          <a href="${urls.bookoff}" target="_blank" rel="noopener" class="book-search-link book-search-link-bookoff">ブックオフ</a>
          <a href="${urls.setagaya}" target="_blank" rel="noopener" class="book-search-link book-search-link-setagaya book-search-link-library">図書館</a>
          <button class="book-search-link btn-amazon-list-add" data-book='${escapeHtml(bookData)}'>+ Amazonリスト</button>
          <button class="book-search-link btn-add-paper-book"
            data-title="${escapeAttr(query)}" data-author=""
            data-detail-url="${escapeAttr(urls.amazon)}"
            onclick="addPaperBook(this.dataset.title, this.dataset.author, '', '', '', this.dataset.detailUrl)">＋紙の本</button>
        </div>
      </div>
    `;
  } else {
    const items = matches.slice(0, 20).map(book => {
      const searchText = `${book.title || ''} ${book.author || ''}`.trim() || query;
      const u = getBookSearchUrls(searchText, { libraryQuery: searchText });
      const asin = (book.source === 'kindle' || book.source === 'audible_jp') ? (book.catalog_number || '') : '';
      const bookData = JSON.stringify({ title: book.title || '', author: book.author || '', asin, cover_url: book.cover_url || '' });
      return `
        <div class="book-search-result-item">
          <div class="book-search-result-meta">
            <span class="book-search-result-title">${escapeHtml(book.title || '—')}</span>
            <span class="book-search-result-author">${escapeHtml(book.author || '')}</span>
          </div>
          <div class="book-search-links">
            <a href="${u.kindle}" target="_blank" rel="noopener" class="book-search-link book-search-link-kindle">Kindle</a>
            <a href="${u.audible}" target="_blank" rel="noopener" class="book-search-link book-search-link-audible">Audible</a>
            <a href="${u.mercari}" target="_blank" rel="noopener" class="book-search-link book-search-link-mercari">メルカリ</a>
            <a href="${u.bookoff}" target="_blank" rel="noopener" class="book-search-link book-search-link-bookoff">ブックオフ</a>
            <a href="${u.setagaya}" target="_blank" rel="noopener" class="book-search-link book-search-link-setagaya book-search-link-library">図書館</a>
            <button class="book-search-link btn-amazon-list-add" data-book='${escapeHtml(bookData)}'>+ Amazonリスト</button>
            <button class="book-search-link btn-add-paper-book"
              data-title="${escapeAttr(book.title || '')}" data-author="${escapeAttr(book.author || '')}"
              data-detail-url="${escapeAttr(u.amazon)}"
              onclick="addPaperBook(this.dataset.title, this.dataset.author, '${escapeAttr(book.cover_url || '')}', '${escapeAttr((book.full_summary || book.summary || ''))}', '${escapeAttr(book.genre || '')}', this.dataset.detailUrl)">＋紙の本</button>
          </div>
        </div>
      `;
    }).join('');
    resultsEl.innerHTML = items;
  }
  resultsEl.style.display = 'block';
}

/* --- Amazon ほしいものリスト --- */

function getAmazonWishlistUrl(asin, title, author) {
  const tag = getAffiliateTag();
  if (asin) return appendTagToUrl(`https://www.amazon.co.jp/wishlist/add-item?ASIN.1=${encodeURIComponent(asin)}`, tag);
  const q = encodeURIComponent(`${title} ${author}`.trim());
  return appendTagToUrl(`https://www.amazon.co.jp/s?k=${q}`, tag);
}

function getAmazonProductUrl(asin, title, author) {
  const tag = getAffiliateTag();
  if (asin) return appendTagToUrl(`https://www.amazon.co.jp/dp/${encodeURIComponent(asin)}`, tag);
  const q = encodeURIComponent(`${title} ${author}`.trim());
  return appendTagToUrl(`https://www.amazon.co.jp/s?k=${q}`, tag);
}

async function loadAmazonList() {
  try {
    const res = await fetch(API.amazonList);
    const data = await res.json();
    renderAmazonList(data.books || []);
  } catch (e) {
    console.error('loadAmazonList error:', e);
  }
}

function renderAmazonList(books) {
  const section = document.getElementById('amazonListSection');
  const itemsEl = document.getElementById('amazonListItems');
  const countEl = document.getElementById('amazonListCount');
  if (!section || !itemsEl) return;

  section.style.display = 'block';
  if (countEl) countEl.textContent = books.length > 0 ? `${books.length}冊` : '';

  if (books.length === 0) {
    itemsEl.innerHTML = '<p class="amazon-list-empty">検索結果の「+ Amazonリスト」または「＋紙の本」から本を追加できます</p>';
    return;
  }

  itemsEl.innerHTML = books.map(book => {
    const wishUrl = getAmazonWishlistUrl(book.asin, book.title, book.author);
    const productUrl = getAmazonProductUrl(book.asin, book.title, book.author);
    const cover = book.cover_url
      ? `<img class="amazon-list-cover" src="${escapeHtml(book.cover_url)}" alt="" loading="lazy" onerror="this.style.display='none'">`
      : '';
    return `
      <div class="amazon-list-card" data-id="${escapeHtml(book.id)}">
        ${cover}
        <div class="amazon-list-card-meta">
          <a href="${productUrl}" target="_blank" rel="noopener" class="amazon-list-card-title">${escapeHtml(book.title || '—')}</a>
          <span class="amazon-list-card-author">${escapeHtml(book.author || '')}</span>
          <span class="amazon-list-card-date">${escapeHtml(book.added_date || '')}</span>
        </div>
        <div class="amazon-list-card-actions">
          <a href="${wishUrl}" target="_blank" rel="noopener" class="btn-amazon-open">Amazonで開く</a>
          <button class="btn-amazon-list-remove" data-id="${escapeHtml(book.id)}">削除</button>
        </div>
      </div>
    `;
  }).join('');
}

async function addToAmazonList(bookData) {
  try {
    const res = await fetch(API.amazonList, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bookData),
    });
    const data = await res.json();
    if (data.success) await loadAmazonList();
    return data;
  } catch (e) {
    console.error('addToAmazonList error:', e);
    return { success: false };
  }
}

async function removeFromAmazonList(id) {
  try {
    await fetch(`${API.amazonList}/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await loadAmazonList();
  } catch (e) {
    console.error('removeFromAmazonList error:', e);
  }
}

/* Amazon Wishlist URL の保存・読み込み */

const AMAZON_LIST_URL_KEY = 'yonda_amazonListUrl';
const AMAZON_LIST_NAME_KEY = 'yonda_amazonListName';

function loadAmazonListUrl() {
  const url = localStorage.getItem(AMAZON_LIST_URL_KEY) || '';
  const name = localStorage.getItem(AMAZON_LIST_NAME_KEY) || '';
  const link = document.getElementById('amazonListRegisteredLink');
  if (link) {
    if (url) {
      link.href = url;
      link.textContent = name || 'Amazonリストで見る →';
      link.style.display = 'inline';
    } else {
      link.style.display = 'none';
    }
  }
}

function _updateAmazonListRegisteredView(url, name) {
  // 後方互換のため残す（loadAmazonListUrl に統合）
  loadAmazonListUrl();
  const registered = document.getElementById('amazonListRegistered');
  const form = document.getElementById('amazonListUrlForm');
  if (!registered || !form) return;

  if (url) {
    registered.style.display = 'flex';
    form.style.display = 'none';
  } else {
    registered.style.display = 'none';
    form.style.display = 'block';
  }
}

function saveAmazonListUrl() {
  const urlInput = document.getElementById('amazonListUrl');
  const nameInput = document.getElementById('amazonListName');
  if (!urlInput) return;
  const url = (urlInput.value || '').trim();
  const name = (nameInput ? nameInput.value : '').trim();
  if (url) {
    localStorage.setItem(AMAZON_LIST_URL_KEY, url);
    if (name) localStorage.setItem(AMAZON_LIST_NAME_KEY, name);
    else localStorage.removeItem(AMAZON_LIST_NAME_KEY);
    _updateAmazonListRegisteredView(url, name);
    showToast('AmazonほしいものリストのURLを保存しました');
  } else {
    localStorage.removeItem(AMAZON_LIST_URL_KEY);
    localStorage.removeItem(AMAZON_LIST_NAME_KEY);
    _updateAmazonListRegisteredView('', '');
    showToast('URLをクリアしました');
  }
}

document.addEventListener('DOMContentLoaded', function() {
  loadAmazonListUrl();

  // ユーザー読了本モーダル: クローズボタン・オーバーレイクリックで閉じる
  const userBooksModal = document.getElementById('userBooksModal');
  const userBooksClose = document.getElementById('userBooksModalClose');
  if (userBooksClose) userBooksClose.addEventListener('click', closeUserBooksModal);
  if (userBooksModal) {
    userBooksModal.addEventListener('click', (e) => {
      if (e.target === userBooksModal) closeUserBooksModal();
    });
  }
});

// イベントデリゲーション: 検索結果の「+ Amazonリスト」ボタン
document.addEventListener('click', async function(e) {
  const addBtn = e.target.closest('.btn-amazon-list-add');
  if (addBtn) {
    e.preventDefault();
    let bookData;
    try { bookData = JSON.parse(addBtn.dataset.book); } catch (_) { return; }
    addBtn.disabled = true;
    addBtn.textContent = '追加中…';
    const result = await addToAmazonList(bookData);
    if (result.success) {
      addBtn.textContent = result.already_exists ? '追加済み' : '追加しました';
    } else {
      addBtn.textContent = 'エラー';
      addBtn.disabled = false;
    }
  }

  const removeBtn = e.target.closest('.btn-amazon-list-remove');
  if (removeBtn) {
    const id = removeBtn.dataset.id;
    if (id) await removeFromAmazonList(id);
  }
});

/* --- AI推し（選書チャット） --- */

let aiRecommendMessages = [];
let aiRecommendInitialized = false;
let aiRecommendCurrentProvider = '';
let aiRecommendMode = '5questions';  // 5questions | mbti | strength

const AI_RECOMMEND_MODE_DESCRIPTIONS = {
  '5questions': '会話するうちに、あなたにぴったりな推し本を探します。まずはあなたの基本的な事を教えて下さい。',
  'mbti': 'MBTIの質問に答えながら、あなたの性格タイプに合った本を提案します。MBTI結果がわかってる人は、いきなり「ENTJ」や「指揮官」など入れてくれれば、それに合った本をすぐに選書します！',
  'strength': '強み診断の質問に答えながら、あなたの強み・得意なことに合った本を提案します。',
};

function updateAiRecommendProvider(provider, model) {
  const el = document.getElementById('aiRecommendProvider');
  if (!el) return;
  const label = model || (provider === 'gemini' ? 'Gemini' : (provider === 'openai' ? 'OpenAI' : ''));
  el.textContent = label ? ` (${label})` : '';
}

const AI_RECOMMEND_FORM_STORAGE_KEY = 'yonda_aiRecommendFormPrefs';

const AI_RECOMMEND_SLIDER_LABELS = {
  q0: (v) => v <= 50 ? '女性' : '男性',
  q1: (v) => v < 17 ? '10代' : v < 34 ? '20代' : v < 51 ? '30代' : v < 68 ? '40代' : v < 84 ? '50代' : '60代以上',
  q2: (v) => v < 25 ? '学生' : v < 50 ? 'フリーター' : v < 75 ? '社会人' : v < 90 ? '経営者' : '悠々',
  q6: (v) => v < 25 ? '月４冊以上' : v < 50 ? '月２冊' : v < 75 ? '月１冊以下' : '読まない',
  q7: (v) => v < 34 ? 'ノンフィクション' : v < 67 ? '現代小説' : 'ファンタジー・SF',
};

function getAiRecommendFormPreferences() {
  const prefs = { q0: 100, q1: 50, q2: 50, q6: 25, q7: 50 };
  ['q0', 'q1', 'q2', 'q6', 'q7'].forEach(key => {
    const el = document.getElementById(key === 'q0' ? 'aiQ0' : key === 'q1' ? 'aiQ1' : key === 'q2' ? 'aiQ2' : key === 'q6' ? 'aiQ6' : 'aiQ7');
    if (el) prefs[key] = parseInt(el.value, 10);
  });
  return prefs;
}

function lerpColor(c1, c2, t) {
  const r = Math.round(c1.r + (c2.r - c1.r) * t);
  const g = Math.round(c1.g + (c2.g - c1.g) * t);
  const b = Math.round(c1.b + (c2.b - c1.b) * t);
  return `rgb(${r},${g},${b})`;
}
const AI_RECOMMEND_SLIDER_COLORS = {
  q0: { left: { r: 233, g: 30, b: 99 }, right: { r: 33, g: 150, b: 243 } },   // 女性=赤/ピンク, 男性=青
  q1: { left: { r: 76, g: 175, b: 80 }, right: { r: 121, g: 85, b: 72 } },     // 10代=緑, 60代=茶
  q2: { left: { r: 156, g: 39, b: 176 }, right: { r: 255, g: 152, b: 0 } },    // 学生=紫, 悠々=オレンジ
  q6: { left: { r: 76, g: 175, b: 80 }, right: { r: 158, g: 158, b: 158 } },   // 月4冊=緑, 読まない=グレー
  q7: { left: { r: 96, g: 125, b: 139 }, right: { r: 224, g: 64, b: 251 } },   // ノンフィクション=青灰, ファンタジー=マゼンタ
};
function updateAiRecommendSliderColors() {
  const ids = ['aiQ0', 'aiQ1', 'aiQ2', 'aiQ6', 'aiQ7'];
  const keys = ['q0', 'q1', 'q2', 'q6', 'q7'];
  ids.forEach((id, i) => {
    const el = document.getElementById(id);
    const cfg = AI_RECOMMEND_SLIDER_COLORS[keys[i]];
    if (!el || !cfg) return;
    const v = parseInt(el.value, 10) / 100;
    const accent = lerpColor(cfg.left, cfg.right, v);
    const track = `linear-gradient(to right, ${lerpColor(cfg.left, cfg.right, 0)}, ${lerpColor(cfg.left, cfg.right, 1)})`;
    el.style.setProperty('--slider-accent', accent);
    el.style.setProperty('--slider-track', track);
  });
}
function updateAiRecommendSliderDisplay() {
  const prefs = getAiRecommendFormPreferences();
  const q0Val = document.getElementById('aiQ0Value');
  const q1Val = document.getElementById('aiQ1Value');
  const q2Val = document.getElementById('aiQ2Value');
  const q6Val = document.getElementById('aiQ6Value');
  const q7Val = document.getElementById('aiQ7Value');
  if (q0Val) q0Val.textContent = AI_RECOMMEND_SLIDER_LABELS.q0(prefs.q0);
  if (q1Val) q1Val.textContent = AI_RECOMMEND_SLIDER_LABELS.q1(prefs.q1);
  if (q2Val) q2Val.textContent = AI_RECOMMEND_SLIDER_LABELS.q2(prefs.q2);
  if (q6Val) q6Val.textContent = AI_RECOMMEND_SLIDER_LABELS.q6(prefs.q6);
  if (q7Val) q7Val.textContent = AI_RECOMMEND_SLIDER_LABELS.q7(prefs.q7);
  updateAiRecommendSliderColors();
}

function saveAiRecommendFormPrefs(prefs) {
  try {
    localStorage.setItem(AI_RECOMMEND_FORM_STORAGE_KEY, JSON.stringify(prefs));
  } catch (_) {}
}

function loadAiRecommendFormPrefs() {
  try {
    const raw = localStorage.getItem(AI_RECOMMEND_FORM_STORAGE_KEY);
    if (!raw) return;
    const prefs = JSON.parse(raw);
    ['q0', 'q1', 'q2', 'q6', 'q7'].forEach(key => {
      const val = prefs[key];
      if (val !== undefined && val !== null) {
        const el = document.getElementById(key === 'q0' ? 'aiQ0' : key === 'q1' ? 'aiQ1' : key === 'q2' ? 'aiQ2' : key === 'q6' ? 'aiQ6' : 'aiQ7');
        if (el) el.value = Math.min(100, Math.max(0, parseInt(val, 10) || 0));
      }
    });
    updateAiRecommendSliderDisplay();
  } catch (_) {}
}

function setAiRecommendMode(mode) {
  aiRecommendMode = mode;
  const menu = document.getElementById('aiRecommendModeMenu');
  const formEl = document.getElementById('aiRecommendForm');
  const descEl = document.getElementById('aiRecommendDescription');
  if (menu) {
    menu.querySelectorAll('.ai-recommend-mode-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
  }
  if (formEl) {
    formEl.style.display = (mode === '5questions') ? '' : 'none';
  }
  const isHistory = mode === 'history';
  // 読書履歴推しではチャット・入力エリアを非表示
  const chatEl2 = document.getElementById('aiRecommendChat');
  const inputRow = document.querySelector('.ai-recommend-input-row');
  if (chatEl2) chatEl2.style.display = isHistory ? 'none' : '';
  if (inputRow) inputRow.style.display = isHistory ? 'none' : '';
  // 読書履歴推しセクションの制御
  const histSection = document.getElementById('historyRecommendSection');
  if (isHistory) {
    if (histSection) histSection.style.display = 'block';
    renderHistoryRecommend();
  } else {
    // 他モードに切り替えたらセクションをリセット・非表示
    if (histSection) histSection.style.display = 'none';
    const listEl = document.getElementById('historyRecommendList');
    if (listEl) listEl.innerHTML = '';
    const refreshBtn = document.getElementById('historyRecommendRefreshBtn');
    if (refreshBtn) refreshBtn.style.display = 'none';
  }
  if (descEl) {
    const base = AI_RECOMMEND_MODE_DESCRIPTIONS[mode] || AI_RECOMMEND_MODE_DESCRIPTIONS['5questions'];
    const providerEl = document.getElementById('aiRecommendProvider');
    descEl.innerHTML = base + (providerEl ? ' ' + providerEl.outerHTML : '');
  }
  try {
    localStorage.setItem('yonda_aiRecommendMode', mode);
  } catch (_) {}
}

function initAiRecommendIfNeeded() {
  const chatEl = document.getElementById('aiRecommendChat');
  const inputEl = document.getElementById('aiRecommendInput');
  const formEl = document.getElementById('aiRecommendForm');
  const modeMenu = document.getElementById('aiRecommendModeMenu');
  if (!chatEl || !inputEl) return;

  if (modeMenu && !modeMenu.dataset.listenersAttached) {
    modeMenu.dataset.listenersAttached = '1';
    modeMenu.querySelectorAll('.ai-recommend-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        if (mode === aiRecommendMode) return;
        setAiRecommendMode(mode);
        aiRecommendInitialized = false;
        initAiRecommendIfNeeded();
      });
    });
  }
  try {
    const saved = localStorage.getItem('yonda_aiRecommendMode');
    // history モードは初期化時に自動ロードしない（ボタン押下時のみ実行）
    if (saved && ['5questions', 'mbti', 'strength'].includes(saved)) {
      aiRecommendMode = saved;
      setAiRecommendMode(saved);
    } else {
      // history が保存されていても初期表示は 5questions に戻す
      aiRecommendMode = '5questions';
      setAiRecommendMode('5questions');
    }
  } catch (_) {
    setAiRecommendMode(aiRecommendMode);
  }

  if (aiRecommendMode === '5questions') {
    loadAiRecommendFormPrefs();
    updateAiRecommendSliderDisplay();
  }
  if (formEl && !formEl.dataset.listenersAttached) {
    formEl.dataset.listenersAttached = '1';
    ['aiQ0', 'aiQ1', 'aiQ2', 'aiQ6', 'aiQ7'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        const onSliderChange = () => {
          updateAiRecommendSliderDisplay();
          saveAiRecommendFormPrefs(getAiRecommendFormPreferences());
        };
        el.addEventListener('input', onSliderChange);
        el.addEventListener('change', onSliderChange);
      }
    });
  }
  if (aiRecommendInitialized) {
    renderAiRecommendChat();
    return;
  }
  aiRecommendInitialized = true;
  aiRecommendMessages = [];
  renderAiRecommendChat();
  sendAiRecommendMessage(null, true);
}

async function sendAiRecommendMessage(userText, isInit = false) {
  const chatEl = document.getElementById('aiRecommendChat');
  const inputEl = document.getElementById('aiRecommendInput');
  const sendBtn = document.getElementById('aiRecommendSendBtn');
  if (!chatEl || !inputEl) return;

  const text = (userText || inputEl.value || '').trim();
  if (!text && !isInit) return;

  if (!isInit) {
    inputEl.value = '';
    aiRecommendMessages.push({ role: 'user', content: text });
    renderAiRecommendChat();
  }

  sendBtn.disabled = true;
  chatEl.classList.add('loading');

  try {
    const history = isInit ? [] : aiRecommendMessages.slice(0, -1);
    const formPrefs = getAiRecommendFormPreferences();
    saveAiRecommendFormPrefs(formPrefs);
    const res = await fetch(API.aiRecommend, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: history,
        user_message: isInit ? '' : text,
        init: isInit,
        form_preferences: formPrefs,
        mode: aiRecommendMode,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || data.message || `通信エラー (${res.status})`);
    }
    if (!data.success) {
      throw new Error(data.error || 'エラーが発生しました');
    }
    aiRecommendMessages.push({ role: 'assistant', content: data.reply });
    aiRecommendCurrentProvider = data.provider || '';
    updateAiRecommendProvider(data.provider, data.model);
    renderAiRecommendChat();
  } catch (err) {
    aiRecommendMessages.push({
      role: 'assistant',
      content: `エラー: ${err.message}\n\n対処法はメニュー → 設定のヘルプ の「AI推し・写真検索」を参照してください。`,
    });
    renderAiRecommendChat();
  } finally {
    sendBtn.disabled = false;
    chatEl.classList.remove('loading');
    inputEl.focus();
  }
}

function sanitizeAiRecommendHtml(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/\bon\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/javascript:/gi, '');
}

/** AI応答から3冊の本を抽出（複数パターン対応） */
function parseAiRecommendBooks(content) {
  const books = [];
  const patterns = [
    /[１1一二2２三3３]冊目[：:]\s*[『\[「]?([^』\]」\n]+?)[』\]」]?\s*[（(]([^）)\n]+?)[）)]/g,
    /[１1一二2２三3３][.．)）]\s*[『\[「]?([^』\]」\n]+?)[』\]」]?\s*[（(]([^）)\n]+?)[）)]/g,
    /[１1一二2２三3３]冊目[：:]\s*[『\[「]?([^』\]」\n]+?)[』\]」]?\s*[／/]\s*([^\n]+?)(?=\s*[１1２2３3]冊目|$)/g,
    /[１1一二2２三3３][.．]\s*[『\[「]?([^』\]」\n]+?)[』\]」]?\s*[／/]\s*([^\n]+?)(?=\s*[１1２2３3][.．]|$)/g,
  ];
  const seen = new Set();
  for (const re of patterns) {
    if (books.length >= 3) break;
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(content)) !== null && books.length < 3) {
      const title = (m[1] || '').trim();
      const author = (m[2] || '').trim();
      const key = `${title}|${author}`;
      if (title && author && title.length >= 2 && !seen.has(key)) {
        seen.add(key);
        books.push({ title, author });
      }
    }
  }
  return books.slice(0, 3);
}

function renderAiRecommendBookCards(books) {
  if (!books || books.length === 0) return '';
  return books.map((book, i) => {
    const searchText = `${book.title} ${book.author}`.trim();
    const urls = getBookSearchUrls(searchText, { bookTitle: book.title });
    const coverPlaceholder = NO_COVER;
    return `
      <div class="ai-recommend-book-card" data-book-index="${i}">
        <a href="${urls.amazon}" target="_blank" rel="noopener" class="ai-recommend-book-cover-link">
          <div class="ai-recommend-book-cover">
            <img src="${coverPlaceholder}" alt="${escapeHtml(book.title)}" width="96" height="120" loading="lazy" data-cover-q="${escapeHtml(searchText)}" data-cover-title="${escapeHtml(book.title || '')}" data-cover-author="${escapeHtml(book.author || '')}" data-no-cover="${escapeHtml(NO_COVER)}" onerror="this.onerror=null;this.src=this.dataset.noCover">
          </div>
        </a>
        <div class="ai-recommend-book-body">
          <h4 class="ai-recommend-book-title"><a href="${urls.amazon}" target="_blank" rel="noopener">${escapeHtml(book.title)}</a></h4>
          <p class="ai-recommend-book-author">${escapeHtml(book.author)}</p>
          <p class="ai-recommend-book-summary" data-summary-q="${escapeHtml(searchText)}" data-summary-title="${escapeHtml(book.title || '')}" data-summary-author="${escapeHtml(book.author || '')}"></p>
          <div class="ai-recommend-book-links">
            <a href="${urls.amazon}" target="_blank" rel="noopener">Amazon</a>
            <a href="${urls.audible}" target="_blank" rel="noopener">Audible</a>
            <a href="${urls.mercari}" target="_blank" rel="noopener">メルカリ</a>
            <a href="${urls.bookoff}" target="_blank" rel="noopener">ブックオフ</a>
            <a href="${urls.setagaya}" target="_blank" rel="noopener">図書館</a>
          </div>
          <button class="btn-add-paper-book"
            data-title="${escapeAttr(book.title)}"
            data-author="${escapeAttr(book.author || '')}"
            data-detail-url="${escapeAttr(urls.amazon)}"
            onclick="event.stopPropagation();(async()=>{
              const btn=this;
              const img=btn.closest('.ai-recommend-book-card')?.querySelector('.ai-recommend-book-cover img');
              const sumEl=btn.closest('.ai-recommend-book-card')?.querySelector('.ai-recommend-book-summary');
              await addPaperBook(btn.dataset.title, btn.dataset.author, img?.src||'', sumEl?.textContent||'', '', btn.dataset.detailUrl||'');
            })()">＋紙の本</button>
        </div>
      </div>
    `;
  }).join('');
}

function stripRolePrefix(text) {
  return (text || '').replace(/^\s*(Assistant|User|assistant|user)\s*:\s*/i, '').trim();
}

function renderAiRecommendMessageContent(content, isUser) {
  const cleaned = stripRolePrefix(content);
  if (isUser) {
    return cleaned.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
  }
  const books = parseAiRecommendBooks(cleaned);
  if (books.length > 0) {
    const firstBookIdx = cleaned.search(/[１1２2３3]冊目/);
    const intro = firstBookIdx >= 0 ? cleaned.slice(0, firstBookIdx).trim() : '';
    const restIdx = cleaned.search(/最後に補足|選書した本が/);
    const rest = restIdx >= 0 ? cleaned.slice(restIdx).trim() : '';
    const introHtml = intro ? `<div class="ai-recommend-intro">${sanitizeAiRecommendHtml(intro.replace(/\n/g, '<br>'))}</div>` : '';
    const cardsHtml = renderAiRecommendBookCards(books);
    const restHtml = rest ? `<div class="ai-recommend-rest">${sanitizeAiRecommendHtml(rest.replace(/\n/g, '<br>'))}</div>` : '';
    return `${introHtml}<div class="ai-recommend-books-grid">${cardsHtml}</div>${restHtml}`;
  }
  return sanitizeAiRecommendHtml(cleaned.replace(/\n/g, '<br>'));
}

/** AI推し本カード用カバー・概要キャッシュ（q → {cover_url, summary}） */
const _bookInfoCache = new Map();

function renderAiRecommendChat() {
  const chatEl = document.getElementById('aiRecommendChat');
  if (!chatEl) return;
  chatEl.innerHTML = aiRecommendMessages.map(m => {
    const isUser = m.role === 'user';
    const content = (m.content || '').trim();
    const cleaned = stripRolePrefix(content);
    const books = isUser ? [] : parseAiRecommendBooks(cleaned);
    const cls = isUser ? 'ai-recommend-msg user' : `ai-recommend-msg assistant${books.length > 0 ? ' has-books' : ''}`;
    const html = renderAiRecommendMessageContent(content, isUser);
    return `<div class="${cls}"><div class="ai-recommend-msg-content">${html}</div></div>`;
  }).join('');
  chatEl.querySelectorAll('.ai-recommend-book-card').forEach(card => {
    const img = card.querySelector('.ai-recommend-book-cover img[data-cover-q]');
    const summaryEl = card.querySelector('.ai-recommend-book-summary[data-summary-q]');
    if (!img) return;
    const q = img.getAttribute('data-cover-q');
    const title = img.getAttribute('data-cover-title') || '';
    const author = img.getAttribute('data-cover-author') || '';
    if (!q) return;
    // キャッシュヒット時は API を呼ばない
    const cached = _bookInfoCache.get(q);
    if (cached) {
      if (cached.cover_url) img.src = cached.cover_url;
      if (summaryEl && cached.summary) summaryEl.textContent = cached.summary;
      return;
    }
    const params = new URLSearchParams({ q });
    if (title) params.set('title', title);
    if (author) params.set('author', author);
    fetch(`${API.bookInfo}?${params}`)
      .then(r => r.json())
      .then(data => {
        _bookInfoCache.set(q, { cover_url: data.cover_url || '', summary: data.summary || '' });
        if (data.success && data.cover_url) img.src = data.cover_url;
        if (summaryEl && data.summary) summaryEl.textContent = data.summary;
      })
      .catch(() => {});
  });
  chatEl.scrollTop = chatEl.scrollHeight;
}

document.getElementById('aiRecommendSendBtn')?.addEventListener('click', () => {
  sendAiRecommendMessage();
});
document.getElementById('aiRecommendInput')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendAiRecommendMessage();
  }
});

function applySorting(books) {
  const sort = document.getElementById('sortSelect').value;
  const compDate = (book) => book.completed_date || book.loan_date || '';
  if (sort === 'author_group') {
    const byAuthor = {};
    for (const b of books) {
      const a = (b.author || '').trim() || '（著者不明）';
      if (!byAuthor[a]) byAuthor[a] = [];
      byAuthor[a].push(b);
    }
    const unknownKey = '（著者不明）';
    const sortedAuthors = Object.entries(byAuthor)
      .sort((a, b) => {
        if (a[0] === unknownKey) return 1;
        if (b[0] === unknownKey) return -1;
        return b[1].length - a[1].length;
      })
      .map(([, arr]) => arr);
    for (const arr of sortedAuthors) {
      arr.sort((a, b) => compDate(b).localeCompare(compDate(a)));
    }
    return sortedAuthors.flat();
  }
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  function parseYmd(s) {
    const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10)) : null;
  }
  function tsundokuDays(book) {
    const endStr = (book.completed_date || '').trim().substring(0, 10) || todayStr;
    const startStr = (book.loan_date || '').trim().substring(0, 10);
    const d1 = parseYmd(startStr);
    const d2 = parseYmd(endStr);
    if (!d1 || !d2) return 0;
    return Math.round((d2 - d1) / (24 * 60 * 60 * 1000));
  }
  return books.sort((a, b) => {
    switch (sort) {
      case 'completed_date_desc': return compDate(b).localeCompare(compDate(a));
      case 'completed_date_asc': return compDate(a).localeCompare(compDate(b));
      case 'date_desc': return (b.loan_date || '').localeCompare(a.loan_date || '');
      case 'tsundoku_desc': return tsundokuDays(b) - tsundokuDays(a);
      case 'rating_desc': return (displayRating(b) || 0) - (displayRating(a) || 0);
      default: return compDate(b).localeCompare(compDate(a));
    }
  });
}

/* --- Charts --- */

/** チャート用本リスト: filteredBooks を再利用してフィルタ重複計算を回避 */
function getBooksForChart() {
  // filteredBooks は applyFilters() で既にフィルタ済みのため、そのまま利用
  // ただし検索文字列によるフィルタは除外したいので検索なしの場合は filteredBooks を使う
  const searchVal = (document.getElementById('searchInputYonda')?.value || '').trim();
  if (!searchVal) return [...filteredBooks];
  // 検索中は allBooks からフィルタし直す（検索を除いたフィルタ条件）
  const source = document.getElementById('sourceFilter')?.value || 'all';
  const genre = document.getElementById('genreFilter')?.value || 'all';
  const rating = document.getElementById('ratingFilter')?.value || 'all';
  let books = [...allBooks];
  if (source !== 'all') books = books.filter(b => b.source === source);
  if (genre !== 'all') books = books.filter(b => (b._normalizedGenre || 'その他') === genre);
  if (rating === 'completed') books = books.filter(b => b.completed);
  else if (rating === 'in_progress') books = books.filter(b => isInProgress(b));
  else if (rating === 'weekly_completed') {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    books = books.filter(b => b.completed && b.completed_date && new Date(b.completed_date) >= weekAgo);
  } else if (rating === 'monthly_completed') {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    books = books.filter(b => b.completed && b.completed_date && new Date(b.completed_date) >= monthStart);
  } else if (rating === 'yearly_completed') {
    const year = new Date().getFullYear();
    books = books.filter(b => b.completed && b.completed_date && b.completed_date.startsWith(String(year)));
  } else if (rating === 'not_completed') books = books.filter(b => isUnread(b));
  else if (rating === 'favorite') books = books.filter(b => b.favorite);
  else if (rating !== 'all') books = books.filter(b => b.rating >= (parseInt(rating) || 0));
  return books;
}

const GENRE_COLORS = [
  'rgba(107,66,38,0.7)', 'rgba(192,94,32,0.7)', 'rgba(90,122,58,0.7)',
  'rgba(58,100,140,0.7)', 'rgba(160,80,100,0.7)', 'rgba(180,140,60,0.7)',
  'rgba(100,70,130,0.7)', 'rgba(60,140,130,0.7)', 'rgba(140,90,50,0.7)',
  'rgba(80,120,80,0.7)',  'rgba(170,110,70,0.7)', 'rgba(90,90,140,0.7)',
  'rgba(140,130,90,0.7)', 'rgba(120,60,90,0.7)',  'rgba(70,110,120,0.7)',
];

let _chartJsLoadPromise = null;
function loadChartJs() {
  if (typeof Chart !== 'undefined') return Promise.resolve();
  if (_chartJsLoadPromise) return _chartJsLoadPromise;
  _chartJsLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('グラフライブラリの読み込みに失敗しました'));
    document.head.appendChild(script);
  });
  return _chartJsLoadPromise;
}

function renderCharts() {
  const section = document.getElementById('chartSection');
  if (allBooks.length === 0) {
    section.style.display = 'none';
    return;
  }
  if (typeof Chart === 'undefined') {
    loadChartJs().then(renderCharts).catch((e) => console.error(e));
    return;
  }
  section.style.display = 'block';
  renderMonthlyChart();
  renderGenreChart();
  renderRelationChart();
}

let _chartRenderTimer = null;
function scheduleRenderCharts() {
  if (_chartRenderTimer) clearTimeout(_chartRenderTimer);
  const run = () => {
    _chartRenderTimer = null;
    renderCharts();
  };
  if ('requestIdleCallback' in window) {
    _chartRenderTimer = window.setTimeout(() => window.requestIdleCallback(run, { timeout: 1200 }), 0);
  } else {
    _chartRenderTimer = window.setTimeout(run, 150);
  }
}

function renderMonthlyChart() {
  const monthMap = {};
  const compMonthMap = {};
  const compBySourceMap = {};
  const runtimeMonthMap = {};
  const useRuntime = chartMode === 'runtime';
  const books = getBooksForChart();
  for (const b of books) {
    const d = b.loan_date || '';
    const runtime = (b.runtime_length_min || 0) | 0;
    if (d.length >= 7) {
      const ym = d.substring(0, 7);
      if (!monthMap[ym]) monthMap[ym] = { audible: 0, kindle: 0, library: 0, paper: 0 };
      if (!runtimeMonthMap[ym]) runtimeMonthMap[ym] = 0;
      if (b.source === 'audible_jp') {
        monthMap[ym].audible++;
        if (useRuntime && b.completed && runtime > 0) {
          const compYm = (b.completed_date || '').substring(0, 7);
          if (compYm.length >= 7) runtimeMonthMap[compYm] = (runtimeMonthMap[compYm] || 0) + runtime;
        }
      } else if (b.source === 'kindle') {
        monthMap[ym].kindle++;
      } else if (b.source === 'paper') {
        monthMap[ym].paper++;
      } else {
        monthMap[ym].library++;
      }
    }
    if (b.completed && b.completed_date && b.completed_date.length >= 7) {
      const compYm = b.completed_date.substring(0, 7);
      compMonthMap[compYm] = (compMonthMap[compYm] || 0) + 1;
      const bSrcKey = b.source === 'audible_jp' ? 'audible'
        : b.source === 'kindle' ? 'kindle'
        : b.source === 'paper'  ? 'paper'
        : 'library';
      if (!compBySourceMap[compYm]) compBySourceMap[compYm] = {};
      compBySourceMap[compYm][bSrcKey] = (compBySourceMap[compYm][bSrcKey] || 0) + 1;
    }
  }

  const allMonths = new Set([...Object.keys(monthMap), ...Object.keys(compMonthMap), ...Object.keys(runtimeMonthMap)]);
  const labels = [...allMonths].sort();
  const last24 = labels.slice(-24);
  const shortLabels = last24.map(k => {
    const [y, m] = k.split('-');
    return m === '01' ? `${y}/${m}` : m;
  });

  const SOURCE_CONFIGS = [
    { key: 'audible', label: 'Audible', color: 'rgba(192,94,32,0.65)',  dataFn: k => monthMap[k]?.audible  || 0 },
    { key: 'kindle',  label: 'Kindle',  color: 'rgba(51,102,170,0.65)', dataFn: k => monthMap[k]?.kindle   || 0 },
    { key: 'library', label: '図書館',  color: 'rgba(107,66,38,0.65)',  dataFn: k => monthMap[k]?.library  || 0 },
    { key: 'paper',   label: '紙',      color: 'rgba(60,140,80,0.65)',  dataFn: k => monthMap[k]?.paper    || 0 },
  ];

  const ctx = document.getElementById('monthlyChart');
  if (monthlyChart) monthlyChart.destroy();

  const activeSrc = activeChartSource;
  const datasets = [];

  if (useRuntime) {
    const audData = last24.map(k => Math.round(((runtimeMonthMap[k] || 0) / 60) * 10) / 10);
    datasets.push({
      label: 'Audible（視聴時間）',
      data: audData,
      backgroundColor: 'rgba(192,94,32,0.55)',
      borderRadius: 2,
      barPercentage: 0.7,
      pointStyle: 'rect',
    });
  } else {
    const srcsToShow = activeSrc
      ? SOURCE_CONFIGS.filter(c => c.key === activeSrc)
      : SOURCE_CONFIGS;
    for (const cfg of srcsToShow) {
      datasets.push({
        label: cfg.label,
        data: last24.map(cfg.dataFn),
        backgroundColor: cfg.color,
        borderRadius: 2,
        barPercentage: activeSrc ? 0.5 : 0.7,
        pointStyle: 'rect',
      });
    }
  }

  // 読了ライン（ソースフィルタ中はそのソースの読了数）
  const compData = last24.map(k =>
    activeSrc ? (compBySourceMap[k]?.[activeSrc] || 0) : (compMonthMap[k] || 0)
  );
  datasets.push({
    label: '読了',
    data: compData,
    type: 'line',
    borderColor: '#22aa44',
    backgroundColor: 'rgba(34,170,68,0.12)',
    borderWidth: 2,
    pointRadius: 3,
    pointBackgroundColor: '#22aa44',
    pointStyle: 'circle',
    fill: true,
    tension: 0.3,
    yAxisID: 'y',
  });

  monthlyChart = new Chart(ctx, {
    type: 'bar',
    data: { labels: shortLabels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'top',
          labels: {
            font: { size: 11 },
            padding: 12,
            usePointStyle: true,
            pointStyleWidth: 14,
          },
          onClick: (_e, legendItem) => {
            const lbl = legendItem.text;
            if (lbl === '読了') {
              const meta = monthlyChart.getDatasetMeta(legendItem.datasetIndex);
              meta.hidden = !meta.hidden;
              monthlyChart.update();
              return;
            }
            const labelToKey = { 'Audible': 'audible', 'Kindle': 'kindle', '図書館': 'library', '紙': 'paper' };
            const key = labelToKey[lbl];
            if (key) {
              activeChartSource = (activeChartSource === key) ? null : key;
              renderMonthlyChart();
            }
          },
        },
        tooltip: {
          callbacks: {
            title: (items) => last24[items[0].dataIndex],
            label: (item) => {
              const v = item.raw;
              const lbl = item.dataset.label || '';
              if (useRuntime && lbl.includes('視聴時間')) return `${lbl}: ${Math.round(v * 10) / 10}時間`;
              if (lbl === '読了') return `読了: ${v}冊`;
              return `${lbl}: ${v}${useRuntime ? '時間' : '冊'}`;
            },
          },
        },
      },
      scales: {
        x: {
          stacked: !useRuntime && !activeSrc,
          grid: { display: false },
          ticks: { font: { size: 10 }, maxRotation: 0 },
        },
        y: {
          stacked: !useRuntime && !activeSrc,
          beginAtZero: true,
          grid: { color: 'rgba(0,0,0,0.05)' },
          ticks: {
            font: { size: 10 },
            stepSize: useRuntime ? undefined : (activeSrc ? undefined : 10),
            callback: (v) => (useRuntime ? (v ? v + 'h' : '0') : v),
          },
        },
      },
    },
  });
}

function renderGenreChart() {
  const genreData = {};
  const useRuntime = chartMode === 'runtime';
  const books = getBooksForChart();
  for (const b of books) {
    const g = b._normalizedGenre || 'その他';
    if (!genreData[g]) genreData[g] = { count: 0, runtime: 0 };
    genreData[g].count++;
    if (useRuntime && (b.source === 'audible_jp' || b.source === 'setagaya') && b.completed) {
      genreData[g].runtime += (b.runtime_length_min || 0) | 0;
    }
  }

  const sorted = Object.entries(genreData)
    .map(([g, d]) => [g, useRuntime ? Math.round((d.runtime / 60) * 10) / 10 : d.count])
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);

  if (sorted.length === 0) return;

  const labels = sorted.map(([g]) => g.length > 14 ? g.substring(0, 14) + '…' : g);
  const fullLabels = sorted.map(([g]) => g);
  const data = sorted.map(([, c]) => c);
  const colors = sorted.map((_, i) => GENRE_COLORS[i % GENRE_COLORS.length]);

  const ctx = document.getElementById('genreChart');
  if (genreChart) genreChart.destroy();

  genreChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors,
        borderRadius: 3,
        barThickness: 18,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      onHover: (ev, elements) => {
        ctx.style.cursor = elements.length > 0 ? 'pointer' : 'default';
      },
      onClick: (ev, elements) => {
        if (elements.length > 0) {
          const idx = elements[0].index;
          const genre = fullLabels[idx];
          const sel = document.getElementById('genreFilter');
          sel.value = genre;
          applyFilters();
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => fullLabels[items[0].dataIndex],
            label: (item) => {
              const v = item.raw;
              if (chartMode === 'runtime') {
                const h = Math.round(v * 10) / 10;
                return `${h}時間`;
              }
              return `${v} 冊`;
            },
          },
        },
      },
      scales: {
        x: {
          beginAtZero: true,
          grid: { color: 'rgba(0,0,0,0.05)' },
          ticks: {
            font: { size: 10 },
            stepSize: chartMode === 'runtime' ? undefined : 50,
            callback: (v) => (chartMode === 'runtime' ? (v ? v + 'h' : '0') : v),
          },
        },
        y: {
          grid: { display: false },
          ticks: { font: { size: 11 }, crossAlign: 'far' },
        },
      },
    },
  });
}

/** 関連性ヒートマップ: ジャンル×評価 または 著者×ジャンル */
function renderRelationChart() {
  const books = getBooksForChart();
  const heatmapEl = document.getElementById('relationHeatmap');
  const legendEl = document.getElementById('relationHeatmapLegend');

  if (relationChartMode === 'genre_rating') {
    const genreCount = {};
    const ratingLabels = ['未評価', '★1', '★2', '★3', '★4', '★5'];
    const ratingKeys = [0, 1, 2, 3, 4, 5];

    for (const b of books) {
      const g = b._normalizedGenre || 'その他';
      const r = Math.round(displayRating(b) || 0);
      if (!genreCount[g]) genreCount[g] = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      genreCount[g][Math.min(r, 5)] = (genreCount[g][Math.min(r, 5)] || 0) + 1;
    }

    const genres = Object.entries(genreCount)
      .map(([g, counts]) => [g, Object.values(counts).reduce((a, c) => a + c, 0)])
      .filter(([, total]) => total > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([g]) => g);

    if (genres.length === 0) {
      heatmapEl.innerHTML = '<p class="relation-heatmap-empty">データがありません</p>';
      if (legendEl) legendEl.textContent = '';
      return;
    }

    const maxVal = Math.max(1, ...genres.flatMap(g => ratingKeys.map(r => genreCount[g][r] || 0)));

    let html = '<table class="relation-heatmap-table"><thead><tr><th></th>';
    for (const lbl of ratingLabels) html += `<th>${escapeHtml(lbl)}</th>`;
    html += '</tr></thead><tbody>';

    for (const g of genres) {
      html += `<tr><th class="relation-heatmap-genre">${escapeHtml(g.length > 10 ? g.substring(0, 10) + '…' : g)}</th>`;
      for (const r of ratingKeys) {
        const v = genreCount[g][r] || 0;
        const bg = v > 0 ? `rgba(107,66,38,${0.2 + 0.7 * (v / maxVal)})` : 'rgba(0,0,0,0.04)';
        html += `<td class="relation-heatmap-cell" style="background:${bg}" title="${escapeHtml(g)} / ${ratingLabels[r]}: ${v}冊">${v || ''}</td>`;
      }
      html += '</tr>';
    }
    html += '</tbody></table>';
    heatmapEl.innerHTML = html;
    if (legendEl) legendEl.textContent = 'ジャンル × 評価の分布（色が濃いほど冊数が多い）';
  } else {
    const authorGenreCount = {};
    for (const b of books) {
      const a = (b.author || '').trim() || '（著者不明）';
      const g = b._normalizedGenre || 'その他';
      if (!authorGenreCount[a]) authorGenreCount[a] = {};
      authorGenreCount[a][g] = (authorGenreCount[a][g] || 0) + 1;
    }

    const authorTotals = Object.entries(authorGenreCount)
      .map(([a, counts]) => [a, Object.values(counts).reduce((s, c) => s + c, 0)])
      .filter(([, total]) => total > 0)
      .sort((x, y) => y[1] - x[1])
      .slice(0, 10);
    const authors = authorTotals.map(([a]) => a);
    // ジャンル件数を事前集計（O(n)）してからソート（O(n²)→O(n log n)）
    const genreCountForSort = new Map();
    for (const bk of books) genreCountForSort.set(bk._normalizedGenre || 'その他', (genreCountForSort.get(bk._normalizedGenre || 'その他') || 0) + 1);
    const genres = [...new Set(books.map(b => b._normalizedGenre || 'その他'))]
      .filter(Boolean)
      .sort((a, b) => (genreCountForSort.get(b) || 0) - (genreCountForSort.get(a) || 0))
      .slice(0, 10);

    if (authors.length === 0 || genres.length === 0) {
      heatmapEl.innerHTML = '<p class="relation-heatmap-empty">データがありません</p>';
      if (legendEl) legendEl.textContent = '';
      return;
    }

    const maxVal = Math.max(1, ...authors.flatMap(a => genres.map(g => authorGenreCount[a][g] || 0)));

    let html = '<table class="relation-heatmap-table"><thead><tr><th></th>';
    for (const g of genres) html += `<th>${escapeHtml(g.length > 8 ? g.substring(0, 8) + '…' : g)}</th>`;
    html += '</tr></thead><tbody>';

    for (const a of authors) {
      html += `<tr><th class="relation-heatmap-genre">${escapeHtml(a.length > 12 ? a.substring(0, 12) + '…' : a)}</th>`;
      for (const g of genres) {
        const v = authorGenreCount[a][g] || 0;
        const bg = v > 0 ? `rgba(107,66,38,${0.2 + 0.7 * (v / maxVal)})` : 'rgba(0,0,0,0.04)';
        html += `<td class="relation-heatmap-cell" style="background:${bg}" title="${escapeHtml(a)} / ${escapeHtml(g)}: ${v}冊">${v || ''}</td>`;
      }
      html += '</tr>';
    }
    html += '</tbody></table>';
    heatmapEl.innerHTML = html;
    if (legendEl) legendEl.textContent = '著者 × ジャンルの分布（色が濃いほど冊数が多い）';
  }
}

/** ジャンル×タグ パネルを描画 */
/**
 * タグ別タブ: ジャンルごとにトップタグをパーセント表示のチップで並べる
 * チップをクリックすると該当ジャンル×タグの本を下に表示する
 */
function renderTagTab() {
  const books    = getBooksForChart();
  const panelEl  = document.getElementById('tagPanel');
  const resultEl = document.getElementById('genreTagResult');
  if (!panelEl) return;
  if (resultEl) resultEl.style.display = 'none';

  const genreBooks  = {};
  const genreTagMap = {};
  for (const cat of CANONICAL_GENRES) { genreBooks[cat] = []; genreTagMap[cat] = {}; }

  for (const b of books) {
    const cat = b._normalizedGenre || normalizeGenre(b.genre || '');
    if (!genreBooks[cat]) { genreBooks[cat] = []; genreTagMap[cat] = {}; }
    genreBooks[cat].push(b);
    for (const tag of generateDetailedTagsForBook(b, cat)) {
      genreTagMap[cat][tag] = (genreTagMap[cat][tag] || 0) + 1;
    }
  }

  let html = '';
  for (const cat of CANONICAL_GENRES) {
    const catBooks = genreBooks[cat] || [];
    if (catBooks.length === 0) continue;
    const topTags = Object.entries(genreTagMap[cat] || {})
      .sort((a, b) => b[1] - a[1]).slice(0, 10);
    const col = (CAT_COLORS[cat] || CAT_COLORS['その他']).read;
    html += `<div class="genre-tag-row">`;
    html += `<div class="genre-tag-label" style="border-left:3px solid ${col}">
               ${escapeHtml(cat)}<span class="genre-tag-total">${catBooks.length}冊</span>
             </div>`;
    html += `<div class="genre-tag-chips">`;
    if (topTags.length === 0) {
      html += `<span class="genre-tag-empty-hint">タグなし</span>`;
    } else {
      for (const [tag, cnt] of topTags) {
        const pct = Math.round(cnt / catBooks.length * 100);
        html += `<button type="button" class="genre-tag-chip" data-genre="${escapeAttr(cat)}" data-tag="${escapeAttr(tag)}">${escapeHtml(tag)}<span class="genre-tag-chip-cnt">${pct}%</span></button>`;
      }
    }
    html += `</div></div>`;
  }
  panelEl.innerHTML = html;

  panelEl.querySelectorAll('.genre-tag-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      panelEl.querySelectorAll('.genre-tag-chip').forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
      _showGenreTagBooks(chip.dataset.genre, chip.dataset.tag, books);
    });
  });
}

/** ジャンル×タグ: タグクリック時に本一覧をパネルに表示 */
function _showGenreTagBooks(genre, tag, books) {
  const resultEl = document.getElementById('genreTagResult');
  if (!resultEl) return;

  const matched = books
    .filter(b => (b._normalizedGenre || normalizeGenre(b.genre || '')) === genre)
    .filter(b => generateDetailedTagsForBook(b, genre).includes(tag))
    .sort((a, b) => {
      if (a.completed && !b.completed) return -1;
      if (!a.completed && b.completed) return 1;
      return (b.completed_date || '').localeCompare(a.completed_date || '');
    });

  if (matched.length === 0) {
    resultEl.innerHTML = `<div class="genre-tag-result-header"><strong>「${escapeHtml(tag)}」</strong>（${escapeHtml(genre)}）— 該当する本はありません<button class="tag-detail-close" id="genreTagClose">✕</button></div>`;
    resultEl.style.display = '';
  } else {
    const items = matched.map(b => {
      const idx = _bookIndex(b);
      const status = b.completed
        ? `<span class="tag-detail-read">読了 ${(b.completed_date || '').slice(0, 7)}</span>`
        : `<span class="tag-detail-unread">未読</span>`;
      const stars = b.rating ? '★'.repeat(Math.round(b.rating)) + '<span style="opacity:.3">' + '★'.repeat(5 - Math.round(b.rating)) + '</span>' : '';
      return `<div class="tag-detail-book genre-tag-book-item" ${idx >= 0 ? `data-book-idx="${idx}"` : ''} style="cursor:pointer">
        ${b.cover_url ? `<img class="tag-detail-cover" src="${escapeHtml(b.cover_url)}" alt="" loading="lazy">` : '<div class="tag-detail-cover tag-detail-cover-placeholder"></div>'}
        <div class="tag-detail-info">
          <strong>${escapeHtml(b.title || '—')}</strong><br>
          <small>${escapeHtml(b.author || '')}</small><br>
          ${status}${stars ? `<span class="genre-tag-stars">${stars}</span>` : ''}
          ${b.summary ? `<p class="genre-tag-book-summary">${escapeHtml(b.summary.slice(0, 90))}…</p>` : ''}
        </div>
      </div>`;
    }).join('');

    resultEl.innerHTML = `
      <div class="tag-detail-header genre-tag-result-header">
        <strong>「${escapeHtml(tag)}」</strong>&ensp;${escapeHtml(genre)}&ensp;— ${matched.length}冊
        <button class="tag-detail-close" id="genreTagClose">✕</button>
      </div>
      <div class="tag-detail-list">${items}</div>`;
    resultEl.style.display = '';
  }

  resultEl.querySelector('#genreTagClose')?.addEventListener('click', () => {
    resultEl.style.display = 'none';
  });
  resultEl.querySelectorAll('.genre-tag-book-item[data-book-idx]').forEach(item => {
    item.addEventListener('click', () => {
      const idx = parseInt(item.dataset.bookIdx);
      if (!isNaN(idx) && allBooks[idx]) openBookDetail(allBooks[idx]);
    });
  });
  resultEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* --- 外部検索パネル --- */

function updateSearchNoResultsPanel(query) {
  const panel = document.getElementById('searchNoResults');
  if (!panel) return;
  if (!query) {
    panel.style.display = 'none';
    panel.innerHTML = '';
    return;
  }
  const info = window._lastBookInfo || {};
  const knownAuthor = info.author || '';
  const knownSummary = info.summary || '';
  const searchQuery = knownAuthor ? `${query} ${knownAuthor}`.trim() : query;
  const urls = getBookSearchUrls(searchQuery, { bookTitle: query });
  const authorHint = knownAuthor
    ? `<span class="snr-author-hint">著者: ${escapeHtml(knownAuthor)}</span>`
    : '';
  panel.innerHTML = `
    <div class="snr-label">「${escapeHtml(query)}」の記録なし${authorHint} — 外部で探す</div>
    <div class="snr-ext-row">
      ${_buildSearchAppButtons(urls, query)}
    </div>
  `;
  panel.style.display = 'block';

  // +紙の本ボタン（著者・概要・Amazonリンク込みで保存）
  document.getElementById('snrAddPaperBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('snrAddPaperBtn');
    if (btn) { btn.disabled = true; btn.textContent = '保存中…'; }
    const cur = window._lastBookInfo || {};
    await addPaperBook(query, cur.author || '', cur.summary || '', '', '', urls.amazon);
    const stillExists = allBooks.some(b => (b.title || '').trim().toLowerCase() === query.trim().toLowerCase());
    if (stillExists) {
      panel.style.display = 'none';
      panel.innerHTML = '';
    } else if (btn) {
      btn.disabled = false;
      btn.textContent = '＋ 紙の本として保存';
    }
  });
}

/* --- Rendering --- */

function renderBooks() {
  const list = document.getElementById('bookList');
  const empty = document.getElementById('emptyState');
  const pag = document.getElementById('pagination');

  if (filteredBooks.length === 0) {
    list.innerHTML = '';
    list.style.display = 'none';
    pag.style.display = 'none';
    empty.style.display = 'block';
    empty.innerHTML = '<p>該当する本がありません</p>';
    // 検索クエリがある場合は外部検索パネルを表示
    const searchRaw = (document.getElementById('searchInputYonda')?.value || '').trim();
    updateSearchNoResultsPanel(searchRaw);
    return;
  }

  empty.style.display = 'none';
  updateSearchNoResultsPanel(''); // 結果があれば外部検索パネルを隠す
  const start = currentPage * PAGE_SIZE;
  const pageBooks = filteredBooks.slice(start, start + PAGE_SIZE);
  const prevBook = start > 0 ? filteredBooks[start - 1] : null;
  const selectedGenre = document.getElementById('genreFilter')?.value || 'all';
  let subGenreCounts = {};
  if (selectedGenre !== 'all') {
    for (const b of filteredBooks) {
      const sg = getSubGenreForGrouping(b, selectedGenre) || selectedGenre;
      subGenreCounts[sg] = (subGenreCounts[sg] || 0) + 1;
    }
  }
  window._currentPageBooks = pageBooks;
  const isCard = document.getElementById('viewCard').classList.contains('active');

  const html = isCard
    ? renderCardView(pageBooks, selectedGenre, prevBook, subGenreCounts)
    : renderTableView(pageBooks, selectedGenre, prevBook, subGenreCounts);

  // DocumentFragment 経由で DOM 更新回数を1回に抑える
  const frag = document.createRange().createContextualFragment(html);
  list.className = isCard ? 'book-grid' : '';
  list.replaceChildren(frag);

  list.style.display = isCard ? 'grid' : 'block';
  renderPagination(start);
}

function setBookInsightStatus(message, className = '') {
  const statusEl = document.getElementById('bookDetailInsightStatus');
  if (!statusEl) return;
  statusEl.textContent = message || '';
  statusEl.className = `book-detail-insights-status ${className}`.trim();
}

function renderBookInsight(insight) {
  const listEl = document.getElementById('bookDetailInsights');
  const btn = document.getElementById('bookInsightGenerateBtn');
  const formEl = document.getElementById('bookDetailInsightForm');
  if (!listEl || !btn) return;
  document.getElementById('bookInsightCopyBtn')?.remove();
  if (formEl) formEl.style.display = 'none';
  if (!insight || !Array.isArray(insight.points) || insight.points.length === 0) {
    listEl.innerHTML = '';
    btn.textContent = 'AIで生成';
    btn.disabled = false;
    setBookInsightStatus('未入力です。手入力するか、AIで生成できます。');
    return;
  }
  listEl.innerHTML = insight.points.map((point) => {
    const source = point.source_url
      ? `<a href="${escapeHtml(point.source_url)}" target="_blank" rel="noopener">出典</a>`
      : '';
    return `
      <li class="book-detail-insight-item">
        <div class="book-detail-insight-heading">${escapeHtml(point.heading || 'ポイント')}</div>
        <div class="book-detail-insight-text">${escapeHtml(point.text || '')}</div>
        ${source ? `<div class="book-detail-insight-source">${source}</div>` : ''}
      </li>
    `;
  }).join('');
  listEl.insertAdjacentHTML(
    'beforebegin',
    '<button type="button" class="btn-copy-insight btn-copy-insight-detail" id="bookInsightCopyBtn" title="書評ポイントをコピー" aria-label="書評ポイントをコピー">⧉ コピー</button>'
  );
  document.getElementById('bookInsightCopyBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    copyBookInsightText(insight, e.currentTarget);
  });
  btn.textContent = 'AIで再生成';
  btn.disabled = false;
  const generatedAt = insight.generated_at ? `生成: ${formatSyncDate(insight.generated_at)}` : '';
  const model = insight.model && insight.model !== 'manual' ? ` / ${escapeHtml(insight.model)}` : '';
  const source = insight.provider === 'manual' ? '手入力' : 'AI生成';
  setBookInsightStatus(`${source}${generatedAt ? ` / ${generatedAt}` : ''}${model}`);
}

function findBookInsight(book) {
  if (!book || !bookInsightsCache) return null;
  const source = (book.source || '').trim();
  const catalog = (book.catalog_number || book.asin || '').trim();
  if (catalog) {
    const byCatalog = bookInsightsCache[`${source || 'book'}:${catalog}`];
    if (byCatalog) return byCatalog;
  }
  const title = (book.title || '').trim();
  const author = (book.author || '').trim();
  return _insightByTitleAuthorMap.get(`${title}:${author}`) || null;
}

function bookInsightCopyText(insight) {
  if (!insight || !Array.isArray(insight.points)) return '';
  return insight.points
    .slice(0, 5)
    .map((point, i) => {
      const heading = (point.heading || `ポイント${i + 1}`).trim();
      const text = (point.text || '').trim();
      return text ? `${i + 1}. ${heading}\n${text}` : '';
    })
    .filter(Boolean)
    .join('\n\n');
}

async function copyBookInsightText(insight, button = null) {
  const text = bookInsightCopyText(insight);
  if (!text) return;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }
    if (button) {
      const original = button.textContent;
      button.textContent = '✓';
      button.classList.add('copied');
      setTimeout(() => {
        button.textContent = original;
        button.classList.remove('copied');
      }, 1200);
    }
    if (currentDetailBook && insight === findBookInsight(currentDetailBook)) {
      setBookInsightStatus('書評ポイントをコピーしました。', 'success');
    }
  } catch (e) {
    console.error('copyBookInsightText error:', e);
    if (currentDetailBook && insight === findBookInsight(currentDetailBook)) {
      setBookInsightStatus('コピーに失敗しました。ブラウザの権限を確認してください。', 'error');
    }
  }
}

/** レビュー列HTML: 星 + 個人レビュー。レビューがなければ未レビューボタン。テーブル共通 */
function buildReviewCellHtml(book) {
  const dispRating = displayRating(book);
  const hasRating = dispRating > 0;
  const personalReview = ((book.source === 'audible_jp' ? book.review_headline : book.comment) || '').trim();
  const reviewUrl = reviewUrlForBook(book);
  let html = '';
  if (hasRating) {
    html += `<div class="table-review-stars">${starsHtml(dispRating)}</div>`;
  }
  if (personalReview) {
    const truncated = personalReview.length > 50 ? personalReview.slice(0, 50) + '…' : personalReview;
    html += `<div class="table-review-text">${escapeHtml(truncated)}</div>`;
  }
  if (!personalReview) {
    if (book.source === 'paper' && book.book_id && !!_authUser) {
      html += `<button type="button" class="btn-unrated" onclick="event.stopPropagation();openPaperBookEditToRate('${escapeHtml(book.book_id)}')">未レビュー</button>`;
    } else if (reviewUrl) {
      html += `<a href="${escapeHtml(reviewUrl)}" target="_blank" rel="noopener" class="btn-unrated" title="レビューを入力" onclick="event.stopPropagation()">未レビュー</a>`;
    }
  }
  return html;
}

function renderTableInsightCell(book) {
  const insight = findBookInsight(book);
  const editBtn = book.source === 'paper' && book.book_id && !!_authUser
    ? `<button type="button" class="btn-table-edit-paper" data-book-id="${escapeHtml(book.book_id)}" title="編集" onclick="event.stopPropagation();openPaperBookEditById(this.dataset.bookId)">✏️</button>`
    : '';
  if (!insight || !Array.isArray(insight.points) || insight.points.length === 0) {
    const idx = _bookIndex(book);
    return `<div class="book-table-insight-wrap">
      ${editBtn ? `<div class="book-table-insight-edit">${editBtn}</div>` : ''}
      <button type="button" class="btn-table-ai-insight" data-book-index="${idx}">AI生成</button>
    </div>`;
  }
  const idx = _bookIndex(book);
  const reviewUrl = reviewUrlForBook(book);
  return `
    <div class="book-table-insight-wrap">
      <div class="book-table-insight-actions">
        ${editBtn}
        <button type="button" class="btn-copy-insight btn-copy-insight-table" data-book-index="${idx}" title="書評ポイントをコピー" aria-label="書評ポイントをコピー">⧉</button>
        ${reviewUrl ? `<a href="${escapeAttr(reviewUrl)}" target="_blank" rel="noopener" class="btn-review-insight btn-review-insight-table" title="レビューを書く" aria-label="レビューを書く">📖</a>` : ''}
      </div>
      <ol class="book-table-insights">
        ${insight.points.slice(0, 5).map((point) => `
          <li>
            <span class="book-table-insight-heading">${escapeHtml(point.heading || 'ポイント')}</span>
            <span class="book-table-insight-text">${escapeHtml(point.text || '')}</span>
          </li>
        `).join('')}
      </ol>
    </div>
  `;
}

function reviewUrlForBook(book) {
  if (!book) return '';
  if (book.review_url) return book.review_url;
  if (book.source === 'audible_jp') return getAudibleRatingUrl(book);
  if (book.source === 'setagaya') return getSetagayaRatingUrl(book);
  if (book.source === 'paper') {
    const q = `${book.title || ''} ${book.author || ''}`.trim();
    return q ? appendTagToUrl(`https://www.amazon.co.jp/s?k=${encodeURIComponent(q)}&i=stripbooks`, getAffiliateTag()) : '';
  }
  return '';
}

function messageId(message, idx) {
  return message.id || `${message.created_at || 'message'}-${idx}`;
}

function findBookFromMessage(book) {
  if (!book) return null;
  const source = (book.source || '').trim();
  const catalog = (book.catalog_number || book.asin || '').trim();
  if (catalog) {
    const matched = _bookByCatalogMap.get(`${source}:${catalog}`);
    if (matched) return matched;
  }
  const title = (book.title || '').trim();
  const author = (book.author || '').trim();
  return _bookByTitleAuthorMap.get(`${source}:${title}:${author}`) || book;
}

function messageUpdatedCount(message) {
  const summary = message.sync_summary || {};
  if (summary.new_completed_count != null) return Number(summary.new_completed_count || 0);
  return (message.books || []).length;
}

function renderMessageSummaryRow(message, idx) {
  const id = messageId(message, idx);
  const isOpen = activeMessageId === id;
  const isUnread = !loadReadMessageIds().has(id);
  const updatedCount = messageUpdatedCount(message);
  const dateText = message.created_at ? formatSyncDate(message.created_at) : '日時不明';
  const summary = message.sync_summary || {};
  // サーバー側 sources が未設定/Kindle・Paper未収録の場合は books から集計
  const serverSources = Array.isArray(summary.sources) ? summary.sources : [];
  const sourcesForDisplay = serverSources.length
    ? serverSources
    : getMessageSourceGroups(message).map(g => ({ source: g.source, label: sourceShortLabel(g.source), total: g.count }));
  const sourceText = sourcesForDisplay.length
    ? sourcesForDisplay.map(src => `${src.label || sourceShortLabel(src.source)} ${Number(src.total || 0)}`).join(' / ')
    : '';
  return `
    <button type="button" class="message-summary-row${isOpen ? ' open' : ''}${isUnread ? ' unread' : ''}" data-message-id="${escapeAttr(id)}">
      <span class="message-summary-main">
        <span class="message-summary-date">${escapeHtml(dateText)}</span>
        <span class="message-summary-count">更新 ${updatedCount}件</span>
      </span>
      ${sourceText ? `<span class="message-summary-sub">${escapeHtml(sourceText)}</span>` : ''}
      <span class="message-summary-arrow">${isOpen ? '▲' : '▼'}</span>
    </button>
  `;
}

function renderMessageBookItem(item) {
  const rawBook = item.book || {};
  // allBooks からレーティング・レビューを補完（最新データを使用）
  const fullBook = findBookFromMessage(rawBook);
  const book = fullBook ? { ...rawBook, ...fullBook } : rawBook;
  const messageInsight = item.insight || {};
  const cachedInsight = findBookInsight(book);
  const insight = Array.isArray(messageInsight.points) && messageInsight.points.length > 0
    ? messageInsight
    : (cachedInsight || messageInsight);
  const refIndex = messageBookRefs.push({ book, item }) - 1;
  const completedBadge = book.completed ? '<span class="badge-completed">読了</span> ' : '';
  const favoriteBadge = book.favorite ? '<span class="badge-favorite" title="お気に入り">♥</span> ' : '';
  const summary = (book.summary || '').trim();
  const summaryCell = summary ? escapeHtml(summary.length > 80 ? summary.substring(0, 80) + '…' : summary) : '—';
  const genre = book.genre ? genreBadgeHtml(book, true) : '—';
  const srcBadge = book.source ? sourceBadgeHtml(book.source) : '';
  const tsundoku = getTsundokuDays(book);
  const tsundokuStr = tsundoku != null ? tsundoku + '日' : '—';

  // レビュー列: 星 + 個人レビュー（または未レビューボタン）
  const reviewCellHtml = buildReviewCellHtml(book);

  // 書評ポイント列: _bookIndex が正しく解決できるよう allBooks の実参照 (fullBook) を使う
  const insightCellHtml = renderTableInsightCell(fullBook || book);

  return `
    <tr class="message-book-row">
      <td class="col-cover"><img src="${escapeHtml(book.cover_url || NO_COVER)}" alt="" loading="lazy" onerror="this.src='${NO_COVER}'"></td>
      <td class="col-title">
        <button type="button" class="message-book-title-link message-detail-open" data-message-book-index="${refIndex}">
          ${completedBadge}${favoriteBadge}${escapeHtml(book.title || '不明なタイトル')}
        </button>
      </td>
      <td class="col-author" title="${escapeHtml(book.author || '')}">${escapeHtml(book.author || '')}</td>
      <td class="col-review" onclick="event.stopPropagation()">${reviewCellHtml}</td>
      <td class="col-ai-insight">${insightCellHtml}</td>
      <td class="col-summary" title="${summary ? escapeHtml(summary) : ''}">${summaryCell}</td>
      <td class="col-genre">${genre}</td>
      <td class="col-runtime">${(book.runtime_length_min || 0) > 0 ? formatRuntime(book.runtime_length_min) : '—'}</td>
      <td>${formatDate(book.loan_date)}</td>
      <td>${book.completed ? formatDateOnly(book.completed_date) : (formatProgress(book) || '—')}</td>
      <td class="col-tsundoku">${tsundokuStr}</td>
      <td>${srcBadge}</td>
    </tr>
  `;
}

function getMessageSourceGroups(message) {
  if (Array.isArray(message.source_groups) && message.source_groups.length) {
    return message.source_groups;
  }
  const groups = {};
  for (const item of (message.books || [])) {
    const book = item.book || {};
    const source = book.source || 'other';
    if (!groups[source]) {
      groups[source] = {
        source,
        label: sourceLabel(source) || source || 'その他',
        count: 0,
        books: [],
      };
    }
    groups[source].books.push(item);
    groups[source].count += 1;
  }
  return Object.values(groups);
}

function renderMessageDetail(message) {
  const books = message.books || [];
  const groups = getMessageSourceGroups(message);
  const groupedBooks = groups.flatMap(group => group.books || []);
  return `
    <div class="message-detail">
      ${books.length ? `
        <div class="message-books">
          <table class="book-table message-book-table">
            <thead>
              <tr>
                <th class="col-cover"></th>
                <th class="col-title">タイトル</th>
                <th class="col-author">著者</th>
                <th class="col-review">レビュー</th>
                <th class="col-ai-insight">書評ポイント</th>
                <th class="col-summary">概要</th>
                <th class="col-genre">ジャンル</th>
                <th class="col-runtime">再生時間</th>
                <th>取得日</th>
                <th>読了日</th>
                <th>積読</th>
                <th>ソース</th>
              </tr>
            </thead>
            <tbody>${groupedBooks.map(renderMessageBookItem).join('')}</tbody>
          </table>
        </div>
      ` : '<p class="message-insight-empty">この同期で新しく読了になった本はありません。</p>'}
    </div>
  `;
}

function renderMessages() {
  const listEl = document.getElementById('messagesList');
  if (!listEl) return;
  messageBookRefs = [];
  if (!yondaMessages.length && !archivedMessages.length) {
    listEl.innerHTML = '<p class="messages-empty">まだメッセージはありません。</p>';
    return;
  }
  let html = yondaMessages.map((message, idx) => `
    <article class="message-card">
      ${renderMessageSummaryRow(message, idx)}
      ${activeMessageId === messageId(message, idx) ? renderMessageDetail(message) : ''}
    </article>
  `).join('');

  if (archivedMessages.length) {
    html += `
      <details class="messages-archive-section" id="messagesArchive">
        <summary class="messages-archive-toggle">アーカイブ（${archivedMessages.length}件）</summary>
        <div class="messages-archive-list">
          ${archivedMessages.map((message, idx) => `
            <article class="message-card message-card-archived">
              ${renderMessageSummaryRow(message, yondaMessages.length + idx)}
              ${activeMessageId === messageId(message, yondaMessages.length + idx) ? renderMessageDetail(message) : ''}
            </article>
          `).join('')}
        </div>
      </details>
    `;
  }

  listEl.innerHTML = html;
  listEl.querySelectorAll('.message-summary-row').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-message-id');
      const willOpen = activeMessageId !== id;
      activeMessageId = willOpen ? id : null;
      if (willOpen) markMessageRead(id);
      renderMessages();
    });
  });
  listEl.querySelectorAll('.message-detail-open').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.getAttribute('data-message-book-index'), 10);
      openMessageBookDetail(idx);
    });
    btn.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      const idx = parseInt(btn.getAttribute('data-message-book-index'), 10);
      openMessageBookDetail(idx);
    });
  });
}

function openMessageBookDetail(refIndex) {
  const ref = messageBookRefs[refIndex];
  const matched = findBookFromMessage(ref?.book);
  if (!matched) return;
  openBookDetail(matched);
  setTimeout(() => {
    document.querySelector('.book-detail-insights-wrap')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 150);
}

async function generateMessageBookInsight(button) {
  const idx = parseInt(button.getAttribute('data-message-book-index'), 10);
  const ref = messageBookRefs[idx];
  if (!ref?.book || !ref?.item) return;
  button.disabled = true;
  button.textContent = '生成中…';
  try {
    const res = await fetch(API.bookInsights + '/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ book: ref.book }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || '生成に失敗しました');
    }
    ref.item.insight = data.insight;
    if (data.insight?.id) _addToInsightCache(data.insight);
    renderMessages();
  } catch (e) {
    ref.item.insight = { points: [], error: e.message || '生成に失敗しました' };
    renderMessages();
  }
}

function showBookInsightForm() {
  if (!currentDetailBook) return;
  document.getElementById('bookInsightCopyBtn')?.remove();
  const formEl = document.getElementById('bookDetailInsightForm');
  const listEl = document.getElementById('bookDetailInsights');
  if (!formEl) return;
  const insight = findBookInsight(currentDetailBook);
  const points = Array.isArray(insight?.points) ? insight.points : [];
  const rows = Array.from({ length: 5 }, (_, i) => {
    const point = points[i] || {};
    return `
      <div class="book-detail-insight-form-row">
        <input type="text" class="book-detail-insight-heading-input" data-point-heading="${i}" maxlength="40" placeholder="見出し ${i + 1}" value="${escapeAttr(point.heading || '')}">
        <textarea class="book-detail-insight-text-input" data-point-text="${i}" maxlength="200" rows="3" placeholder="ポイント ${i + 1}（200字以内）">${escapeHtml(point.text || '')}</textarea>
      </div>
    `;
  }).join('');
  formEl.innerHTML = `
    ${rows}
    <div class="book-detail-insight-form-actions">
      <button type="button" class="btn btn-secondary" id="bookInsightCancelBtn">キャンセル</button>
      <button type="button" class="btn btn-primary" id="bookInsightSaveBtn">保存</button>
    </div>
  `;
  formEl.style.display = 'block';
  if (listEl) listEl.innerHTML = '';
  setBookInsightStatus('書評ポイントを手入力できます。空欄の行は保存されません。');
  document.getElementById('bookInsightCancelBtn')?.addEventListener('click', () => {
    formEl.style.display = 'none';
    renderBookInsight(findBookInsight(currentDetailBook));
  });
  document.getElementById('bookInsightSaveBtn')?.addEventListener('click', saveManualBookInsight);
}

async function saveManualBookInsight() {
  if (!currentDetailBook) return;
  const saveBtn = document.getElementById('bookInsightSaveBtn');
  if (saveBtn) saveBtn.disabled = true;
  const points = Array.from({ length: 5 }, (_, i) => ({
    heading: document.querySelector(`[data-point-heading="${i}"]`)?.value.trim() || `ポイント${i + 1}`,
    text: document.querySelector(`[data-point-text="${i}"]`)?.value.trim() || '',
  })).filter(point => point.text);
  setBookInsightStatus('保存中…', 'loading');
  try {
    const res = await fetch(API.bookInsights + '/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ book: currentDetailBook, points }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      throw new Error(data.error || '保存に失敗しました');
    }
    if (data.insight?.id) _addToInsightCache(data.insight);
    renderBookInsight(data.insight);
    if (document.getElementById('viewTable')?.classList.contains('active')) {
      renderBooks();
    }
  } catch (e) {
    setBookInsightStatus(e.message || '保存に失敗しました。', 'error');
    if (saveBtn) saveBtn.disabled = false;
  }
}

async function loadBookInsight(book) {
  renderBookInsight(null);
  try {
    const res = await fetch(API.bookInsights, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ book }),
    });
    const data = await res.json();
    if (currentDetailBook !== book) return;
    if (data.success && data.insight) {
      if (data.insight.id) _addToInsightCache(data.insight);
      renderBookInsight(data.insight);
    }
  } catch (e) {
    console.error('loadBookInsight error:', e);
    setBookInsightStatus('保存済みポイントを読み込めませんでした。', 'error');
  }
}

async function generateBookInsight(bookOverride = null, options = {}) {
  if (bookOverride instanceof Event) bookOverride = null;
  const requestedBook = bookOverride || currentDetailBook;
  if (!requestedBook) return;
  const { tableButton = null } = options;
  const btn = document.getElementById('bookInsightGenerateBtn');
  const listEl = document.getElementById('bookDetailInsights');
  if (tableButton) {
    tableButton.disabled = true;
    tableButton.textContent = '生成中…';
  }
  if (!bookOverride) {
    if (btn) btn.disabled = true;
    if (listEl) listEl.innerHTML = '';
    setBookInsightStatus('インターネットから情報を集めてAIで要約しています…（1分ほどかかることがあります）', 'loading');
  }
  try {
    const res = await fetch(API.bookInsights + '/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ book: requestedBook }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      throw new Error(data.error || '生成に失敗しました');
    }
    if (data.insight?.id) _addToInsightCache(data.insight);
    if (!bookOverride && currentDetailBook === requestedBook) {
      renderBookInsight(data.insight);
    }
    if (document.getElementById('viewTable')?.classList.contains('active')) {
      renderBooks();
    }
  } catch (e) {
    console.error('generateBookInsight error:', e);
    if (tableButton) {
      tableButton.disabled = false;
      tableButton.textContent = 'AI生成';
      tableButton.title = e.message || '生成に失敗しました。';
    } else {
      setBookInsightStatus(e.message || '生成に失敗しました。', 'error');
      if (btn) btn.disabled = false;
    }
  }
}

function openBookDetail(book) {
  currentDetailBook = book;
  const modal = document.getElementById('bookDetailModal');
  const NO_COVER = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="90" viewBox="0 0 64 90">' +
    '<rect fill="#f0e6d8" width="64" height="90" rx="3"/>' +
    '<text x="32" y="50" text-anchor="middle" fill="#8a7968" font-size="10" font-family="sans-serif">No Cover</text></svg>'
  );

  // detail URLを先に解決（タイトル・著者・概要のリンクに使う）
  let detailHref = book.detail_url || '';
  if (book.detail_url && (book.source === 'kindle' || book.source === 'audible_jp')) {
    const tag = getAffiliateTag();
    if (tag) detailHref = appendTagToUrl(book.detail_url, tag);
  }
  // 紙の本: 保存済み detail_url があればそれを使い、なければ Amazon 検索URLを生成
  if (book.source === 'paper') {
    if (book.detail_url) {
      detailHref = appendTagToUrl(book.detail_url, getAffiliateTag());
    } else {
      const q = `${book.title || ''} ${book.author || ''}`.trim();
      if (q) detailHref = appendTagToUrl(`https://www.amazon.co.jp/s?k=${encodeURIComponent(q)}&i=stripbooks`, getAffiliateTag());
    }
  }

  // タイトル（ソースバッジはボタン下に移動したのでタイトルには含めない）
  const titleEl = document.getElementById('bookDetailTitle');
  const titleText = escapeHtml(book.title || '—');
  if (detailHref) {
    titleEl.innerHTML = `<a href="${escapeHtml(detailHref)}" target="_blank" rel="noopener" class="book-detail-title-link">${titleText}</a>`;
  } else {
    titleEl.innerHTML = titleText;
  }

  // 著者
  const authorEl = document.getElementById('bookDetailAuthor');
  if (book.author && detailHref) {
    authorEl.innerHTML = `<a href="${escapeHtml(detailHref)}" target="_blank" rel="noopener" class="book-detail-meta-link">著者: ${escapeHtml(book.author)}</a>`;
  } else {
    authorEl.textContent = book.author ? `著者: ${book.author}` : '';
  }

  // ナレーター（Audible: book.comment から "ナレーター: XXX" を抽出）
  const narratorEl = document.getElementById('bookDetailNarrator');
  if (narratorEl) {
    let narratorText = '';
    if (book.source === 'audible_jp' && book.comment) {
      const m = book.comment.match(/ナレーター:\s*([^/\n]+)/);
      if (m) narratorText = `ナレーター: ${m[1].trim()}`;
    }
    narratorEl.textContent = narratorText;
    narratorEl.style.display = narratorText ? '' : 'none';
  }

  // 再生時間（Audible の runtime_length_min）
  const runtimeEl = document.getElementById('bookDetailRuntime');
  if (runtimeEl) {
    const rt = book.runtime_length_min ? formatRuntime(book.runtime_length_min) : '';
    runtimeEl.textContent = rt || '';
    runtimeEl.style.display = rt ? '' : 'none';
  }

  // ソースバッジ + ジャンル（Amazon/メルカリボタンの下）
  const srcBadgeEl = document.getElementById('bookDetailSrcBadge');
  if (srcBadgeEl) {
    if (book.source) {
      srcBadgeEl.outerHTML = sourceBadgeHtml(book.source, 'badge-detail-src').replace(
        'class="', `id="bookDetailSrcBadge" class="`
      );
    } else {
      srcBadgeEl.className = '';
      srcBadgeEl.textContent = '';
    }
  }
  const genreEl = document.getElementById('bookDetailGenre');
  if (book.genre) {
    const canonical = normalizeGenre(book.genre);
    const colors = CAT_COLORS[canonical] || CAT_COLORS['その他'];
    const bg = book.completed ? colors.read : colors.unread;
    const textColor = book.completed ? '#fff' : '#444';
    const orig = book.genre !== canonical ? `<span class="book-detail-genre-orig">${escapeHtml(book.genre)}</span>` : '';
    genreEl.innerHTML = `<span class="genre-badge" style="background:${bg};color:${textColor}" data-filter-genre="${escapeHtml(canonical)}">${escapeHtml(canonical)}</span>${orig}`;
  } else {
    genreEl.textContent = '';
  }
  document.getElementById('bookDetailFavorite').textContent = book.favorite ? '♥ お気に入り' : '';
  document.getElementById('bookDetailFavorite').style.display = book.favorite ? '' : 'none';


  const ratingEl = document.getElementById('bookDetailRating');
  const reviewUrl = reviewUrlForBook(book);
  const dispRating = displayRating(book);
  // 個人レビューテキスト: Audible は review_headline、それ以外は comment
  const personalReview = (book.source === 'audible_jp'
    ? (book.review_headline || '')
    : (book.comment || '')).trim();
  // この本がログインユーザー自身のものか
  const isOwnBook = !!_authUser && allBooks.some(b => b.book_id && b.book_id === book.book_id);

  if (dispRating > 0) {
    const starsContent = starsHtml(dispRating);
    let html = reviewUrl
      ? `<a href="${escapeHtml(reviewUrl)}" target="_blank" rel="noopener" class="rating-link stars-link" title="レビュー画面へ">${starsContent}</a>`
      : starsContent;
    // 星はあるが個人レビューテキストがない場合も未レビューボタンを表示
    if (isOwnBook && !personalReview) {
      if (book.source === 'paper') {
        html += ` <button type="button" class="btn-no-review" onclick="closeBookDetail();openPaperBookEditToRate('${escapeHtml(book.book_id || '')}')">未レビュー</button>`;
      } else if (reviewUrl) {
        html += ` <a href="${escapeHtml(reviewUrl)}" target="_blank" rel="noopener" class="btn-no-review">未レビュー</a>`;
      }
    }
    ratingEl.innerHTML = html;
  } else if (isOwnBook && !personalReview) {
    // 星なし・自分の本で個人レビューがない場合
    if (book.source === 'paper') {
      ratingEl.innerHTML = `<button type="button" class="btn-no-review" onclick="closeBookDetail();openPaperBookEditToRate('${escapeHtml(book.book_id || '')}')">未レビュー</button>`;
    } else if (reviewUrl) {
      ratingEl.innerHTML = `<a href="${escapeHtml(reviewUrl)}" target="_blank" rel="noopener" class="btn-no-review">未レビュー</a>`;
    } else {
      ratingEl.innerHTML = '';
    }
  } else {
    ratingEl.innerHTML = '';
  }

  // 個人レビューをインライン表示
  const reviewInlineEl = document.getElementById('bookDetailReviewInline');
  if (reviewInlineEl) {
    reviewInlineEl.textContent = personalReview;
    reviewInlineEl.style.display = personalReview ? '' : 'none';
  }

  document.getElementById('bookDetailLoanDate').textContent =
    book.added_date ? `追加日: ${book.added_date}` :
    book.loan_date ? `追加日: ${book.loan_date}` : '';

  const compEl = document.getElementById('bookDetailCompleted');
  const statusLabel = { unread: '未読', in_progress: '読書中', completed: '読了' }[book.status] || '';
  if (book.source === 'paper' && book.status) {
    if (book.status === 'completed' && book.completed_date) {
      compEl.textContent = `読了: ${formatDateOnly(book.completed_date)}`;
    } else {
      compEl.textContent = statusLabel;
    }
    compEl.style.display = '';
  } else if (book.completed) {
    compEl.textContent = book.completed_date ? `読了: ${formatDateOnly(book.completed_date)}` : '読了';
    compEl.style.display = '';
  } else if (formatProgress(book)) {
    compEl.textContent = `進捗: ${formatProgress(book)}`;
    compEl.style.display = '';
  } else {
    compEl.textContent = '';
    compEl.style.display = 'none';
  }

  // コメント欄は rating 行で表示済みのため非表示
  document.getElementById('bookDetailComment').textContent = '';
  document.getElementById('bookDetailComment').style.display = 'none';
  document.getElementById('bookDetailCover').src = book.cover_url || NO_COVER;
  document.getElementById('bookDetailCover').onerror = function() { this.src = NO_COVER; };

  const searchQ = `${book.title || ''} ${book.author || ''}`.trim() || book.title || '';
  const urls = getBookSearchUrls(searchQ);
  const amazonEl = document.getElementById('bookDetailAmazon');
  const mercariEl = document.getElementById('bookDetailMercari');
  if (amazonEl) {
    amazonEl.href = urls.amazon;
    amazonEl.style.display = searchQ ? '' : 'none';
  }
  if (mercariEl) {
    mercariEl.href = urls.mercari;
    mercariEl.style.display = searchQ ? '' : 'none';
  }

  // 概要
  const summaryText = book.full_summary || book.summary || '';
  const summaryEl = document.getElementById('bookDetailSummary');
  if (summaryText && detailHref) {
    summaryEl.innerHTML = `<a href="${escapeHtml(detailHref)}" target="_blank" rel="noopener" class="book-detail-summary-link">${escapeHtml(summaryText)}</a>`;
  } else {
    summaryEl.textContent = summaryText || '（概要なし）';
  }
  // 概要ヘッダーをリセット（以前付けていたソースバッジを削除）
  const summaryWrap = summaryEl.closest('.book-detail-summary-wrap');
  if (summaryWrap) {
    const h3 = summaryWrap.querySelector('h3');
    if (h3) h3.textContent = '概要';
  }

  // 書評ポイント横「レビューを書く」ボタン
  const reviewBtn = document.getElementById('bookDetailReviewBtn');
  if (reviewBtn) {
    reviewBtn.href = reviewUrl || '#';
    reviewBtn.style.display = reviewUrl ? '' : 'none';
  }

  loadBookInsight(book);

  // 紙の本の場合は編集・削除ボタンを表示（登録した本人のみ）
  const paperEditBar = document.getElementById('bookDetailPaperActions');
  if (paperEditBar) {
    const isOwnPaperBook = book.source === 'paper' && !!_authUser
      && allBooks.some(b => b.book_id && b.book_id === book.book_id);
    if (isOwnPaperBook) {
      paperEditBar.innerHTML = `
        <button type="button" class="btn btn-danger-ghost btn-sm" id="paperDetailDeleteBtn">🗑 削除</button>
        <button type="button" class="btn btn-secondary" id="paperDetailEditBtn">✏️ 編集</button>
      `;
      document.getElementById('paperDetailEditBtn').onclick = () => { closeBookDetail(); openPaperBookEdit(book); };
      document.getElementById('paperDetailDeleteBtn').onclick = () => confirmDeletePaperBook(book);
      paperEditBar.style.display = '';
    } else {
      paperEditBar.style.display = 'none';
    }
  }

  modal.classList.add('open');
}

function closeBookDetail() {
  currentDetailBook = null;
  document.getElementById('bookDetailModal').classList.remove('open');
}

// ── 紙の本 編集モーダル ──────────────────────────────────────────────────────

let _paperEditBook = null;
let _justAddedPaperBook = false;

/** 紙の本編集モーダルを開き、評価・書評フィールドにスクロール */
function openPaperBookEditToRate(bookId) {
  const book = _bookByIdMap.get(bookId);
  if (!book) return;
  openPaperBookEdit(book);
  setTimeout(() => {
    const starsEl = document.getElementById('paperEditStars');
    if (starsEl) {
      starsEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const firstStar = starsEl.querySelector('.paper-star-btn');
      if (firstStar) firstStar.focus();
    }
  }, 120);
}

/** 紙の本編集モーダルの星UIを設定 */
function _setPaperEditStars(rating) {
  const btns = document.querySelectorAll('#paperEditStars .paper-star-btn');
  btns.forEach(btn => {
    const v = parseInt(btn.dataset.value, 10);
    btn.classList.toggle('active', v <= rating);
  });
}

function openPaperBookEdit(book) {
  _paperEditBook = book;
  const NO_COVER = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="90" viewBox="0 0 64 90">' +
    '<rect fill="#f0e6d8" width="64" height="90" rx="3"/>' +
    '<text x="32" y="50" text-anchor="middle" fill="#8a7968" font-size="10" font-family="sans-serif">No Cover</text></svg>'
  );
  document.getElementById('paperEditTitle').value   = book.title  || '';
  document.getElementById('paperEditAuthor').value  = book.author || '';

  // ジャンル select
  const genreSel = document.getElementById('paperEditGenre');
  if (genreSel) genreSel.value = book.genre || '';

  document.getElementById('paperEditSummary').value = book.full_summary || book.summary || '';

  // 読書状態
  const statusSel = document.getElementById('paperEditStatus');
  const curStatus = book.status || (book.completed ? 'completed' : 'unread');
  if (statusSel) statusSel.value = curStatus;
  _toggleCompletedDateField(curStatus);

  // 読了日
  const cdField = document.getElementById('paperEditCompletedDate');
  if (cdField && book.completed_date) {
    cdField.value = (book.completed_date || '').slice(0, 10);
  } else if (cdField) {
    cdField.value = '';
  }

  // 追加日
  const addedDateEl = document.getElementById('paperEditAddedDate');
  if (addedDateEl) addedDateEl.textContent = book.added_date || book.loan_date || '—';

  // Amazonリンク
  const detailUrlEl = document.getElementById('paperEditDetailUrl');
  if (detailUrlEl) detailUrlEl.value = book.detail_url || '';

  // 評価（★）
  const rating = book.rating || 0;
  document.getElementById('paperEditRating').value = rating || '';
  _setPaperEditStars(rating);

  // 書評・コメント
  const commentEl = document.getElementById('paperEditComment');
  if (commentEl) commentEl.value = book.comment || '';

  // 表紙
  const coverUrl = book.cover_url || '';
  const isDataUrl = coverUrl.startsWith('data:');
  document.getElementById('paperEditCoverUrl').value = isDataUrl ? '' : coverUrl;
  document.getElementById('paperEditCoverUrl').style.display = isDataUrl ? 'none' : '';
  const fileLabel = document.getElementById('paperEditCoverFileLabel');
  if (fileLabel) fileLabel.style.display = isDataUrl ? '' : 'none';
  const coverImg = document.getElementById('paperEditCoverImg');
  coverImg.src = coverUrl || NO_COVER;
  coverImg.onerror = () => { coverImg.src = NO_COVER; };
  document.getElementById('paperEditCoverFile').value = '';
  document.getElementById('paperBookEditModal').classList.add('open');
}

function _toggleCompletedDateField(status) {
  const field = document.getElementById('paperEditCompletedDateField');
  if (field) field.style.display = status === 'completed' ? '' : 'none';
}

function closePaperBookEdit() {
  _paperEditBook = null;
  document.getElementById('paperBookEditModal').classList.remove('open');
}

function openPaperBookEditById(bookId) {
  const book = _bookByIdMap.get(bookId);
  if (book) openPaperBookEdit(book);
}

async function savePaperBookEdit() {
  if (!_paperEditBook) return;
  const saveBtn = document.getElementById('paperEditSaveBtn');
  saveBtn.disabled = true;
  saveBtn.textContent = '保存中…';

  const title    = document.getElementById('paperEditTitle').value.trim();
  const author   = document.getElementById('paperEditAuthor').value.trim();
  const genre    = document.getElementById('paperEditGenre').value.trim();
  const summary  = document.getElementById('paperEditSummary').value.trim();
  const urlInput = document.getElementById('paperEditCoverUrl').value.trim();
  const fileInput = document.getElementById('paperEditCoverFile');
  const status = document.getElementById('paperEditStatus')?.value || 'unread';
  const completedDateRaw = document.getElementById('paperEditCompletedDate')?.value || '';
  const completedDate = status === 'completed' && completedDateRaw
    ? `${completedDateRaw}T00:00:00+09:00` : '';

  // 既存のカバーURLを保持（ファイル選択もURL入力もない場合）
  const existingCover = _paperEditBook.cover_url || '';
  let coverUrl = urlInput || (existingCover.startsWith('data:') ? existingCover : urlInput);

  // ファイルが選択されていれば canvas で圧縮して base64 に変換
  if (fileInput.files && fileInput.files[0]) {
    try {
      coverUrl = await _compressImageToBase64(fileInput.files[0], 200, 280);
    } catch (e) {
      console.warn('画像変換エラー:', e);
    }
  } else if (!urlInput && existingCover) {
    coverUrl = existingCover;
  }

  const bookId = _paperEditBook.book_id || '';
  const ratingVal = parseInt(document.getElementById('paperEditRating')?.value || '0', 10) || null;
  const commentVal = (document.getElementById('paperEditComment')?.value || '').trim();
  const body = {
    title, author, genre, summary, cover_url: coverUrl,
    status, completed_date: completedDate,
    detail_url: (document.getElementById('paperEditDetailUrl')?.value || '').trim(),
    rating: ratingVal,
    comment: commentVal,
    _title: _paperEditBook.title || '',
    _author: _paperEditBook.author || '',
  };

  try {
    const url = bookId ? API.updatePaperBook(bookId) : API.updatePaperBook('unknown');
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.success) {
      const wasNew = _justAddedPaperBook;
      _justAddedPaperBook = false;
      const savedBookSnap = _paperEditBook;
      if (data.books) {
        allBooks = data.books;
        _rebuildBookIndexMap();
        applyFilters();
      }
      closePaperBookEdit();
      if (wasNew && savedBookSnap) {
        const savedId = savedBookSnap.book_id;
        const savedTitle = savedBookSnap.title || body.title || '本';
        const target = savedId
          ? _bookByIdMap.get(savedId)
          : allBooks.find(b => b.title === body.title && b.author === body.author);
        showActionToast(`「${savedTitle}」を追加しました！`, '確認する', () => {
          if (target) openBookDetail(target);
        });
      } else {
        showToast('保存しました', 'success');
      }
    } else {
      showToast(data.error || '保存に失敗しました', 'error');
    }
  } catch (e) {
    showToast('保存エラー: ' + e.message, 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = '保存';
  }
}


async function confirmDeletePaperBook(book) {
  if (!confirm(`「${book.title}」を削除しますか？`)) return;
  const bookId = book.book_id || '';
  try {
    const res = await fetch(API.deletePaperBook(bookId), { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast('削除しました', 'success');
      closeBookDetail();
      if (data.books) {
        allBooks = data.books;
        _rebuildBookIndexMap();
        applyFilters();
      }
    } else {
      showToast(data.error || '削除に失敗しました', 'error');
    }
  } catch (e) {
    showToast('削除エラー: ' + e.message, 'error');
  }
}

/** 画像ファイルを指定サイズに圧縮して base64 data URL を返す */
function _compressImageToBase64(file, maxW, maxH) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(maxW / img.width, maxH / img.height, 1);
        const w = Math.round(img.width  * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width  = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.75));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * 単一書籍カードのHTML文字列を生成する共通関数。
 * renderCardView と renderCommunitySection の両方から使用。
 *
 * @param {object} book           書籍データ
 * @param {object} opts
 *   extraClass   {string}  カード要素に追加するクラス文字列
 *   extraAttrs   {string}  カード要素に追加するHTML属性文字列
 *   showUnrated  {boolean} 未レビューボタンを表示するか
 *   showProgress {boolean} Kindle進捗バーを表示するか（デフォルトtrue）
 */
function renderBookCardHtml(book, { extraClass = '', extraAttrs = '', showUnrated = false, communityUnrated = false, showProgress = true } = {}) {
  const cover = book.cover_url || NO_COVER;
  const srcClass = book.source === 'audible_jp' ? ' source-audible' : '';
  const srcLabel_map = { setagaya: '図書館', audible_jp: 'Audible', kindle: 'Kindle', paper: 'Paper' };
  const srcFullLabel = srcLabel_map[book.source] || book.source || '';
  const affiliateTag = getAffiliateTag();

  const cardDetailUrl = (() => {
    if (book.source === 'paper') {
      if (book.detail_url) return appendTagToUrl(book.detail_url, affiliateTag);
      const q = `${book.title || ''} ${book.author || ''}`.trim();
      return q ? appendTagToUrl(`https://www.amazon.co.jp/s?k=${encodeURIComponent(q)}&i=stripbooks`, affiliateTag) : '';
    }
    return book.detail_url ? appendTagToUrl(book.detail_url, affiliateTag) : '';
  })();

  const srcBadge = srcFullLabel
    ? (cardDetailUrl
        ? `<a href="${escapeHtml(cardDetailUrl)}" target="_blank" rel="noopener"
             class="badge-source badge-${escapeHtml(book.source)} badge-card-top"
             data-short="${escapeHtml(sourceShortLabel(book.source))}"
             title="${escapeHtml(srcFullLabel)}" onclick="event.stopPropagation()">${escapeHtml(srcFullLabel)}</a>`
        : sourceBadgeHtml(book.source, 'badge-card-top'))
    : '';
  const favoriteBadge = book.favorite ? '<span class="badge-favorite" title="お気に入り">♥</span> ' : '';
  const completedBadge = book.completed
    ? `<span class="badge-completed badge-short" title="読了" data-filter-source="${escapeHtml(book.source || '')}">完</span>`
    : '';
  const summaryHtml = book.summary ? `<div class="book-card-summary">${escapeHtml(book.summary)}</div>` : '';
  const progressBarHtml = showProgress && book.source === 'kindle' && (book.percent_complete || 0) > 0 ? renderProgressBar(book) : '';

  const genreCanonical = book._normalizedGenre || normalizeGenre(book.genre || '');
  const genreColors = CAT_COLORS[genreCanonical] || CAT_COLORS['その他'];
  const cardBg = genreColors.unread + '55';

  const authorExtra = (book.runtime_length_min || 0) > 0 ? ` · ${formatRuntime(book.runtime_length_min)}` : '';
  const completedExtra = book.completed
    ? ` · ${completedBadge}${book.completed_date ? ` ${formatDateOnly(book.completed_date)}` : ''}`
    : '';
  const progress = formatProgress(book);
  const progressMeta = !book.completed
    ? (progress ? `<div class="book-card-meta"><span>進捗: ${progress}</span></div>` : `<div class="book-card-meta"><span>${formatDate(book.loan_date)}</span></div>`)
    : '';

  const newBadge = isRecentBook(book) ? '<span class="badge-new-book">N</span>' : '';

  return `
    <div class="book-card${book.completed ? ' completed' : ''}${srcClass}${extraClass ? ' ' + extraClass : ''}"
         role="button" tabindex="0" style="background:${cardBg}; cursor:pointer;" ${extraAttrs}>
      <img class="book-cover" src="${escapeHtml(cover)}" alt="" loading="lazy" decoding="async"
           onerror="this.src='${NO_COVER}'">
      <div class="book-card-body">
        <div class="book-card-title">${newBadge}${escapeHtml(book.title || '—')}</div>
        <div class="book-card-author">${escapeHtml(book.author || '')}${authorExtra}${completedExtra}${srcBadge ? `<span class="book-card-src-inline">${srcBadge}</span>` : ''}</div>
        ${bookRatingRowHtml(book, { showUnrated, communityUnrated })}
        ${progressBarHtml}
        ${progressMeta}
        <div class="book-card-top-row">${favoriteBadge}</div>
        ${summaryHtml}
      </div>
    </div>`;
}

function renderCardView(books, selectedGenre = 'all', prevBook = null, subGenreCounts = {}) {
  let lastYear = null;
  let lastAuthor = null;
  let lastSubGenre = prevBook && selectedGenre !== 'all' ? getSubGenreForGrouping(prevBook, selectedGenre) : null;
  const sort = document.getElementById('sortSelect').value;
  const showYearHeaders = ['date_desc', 'completed_date_desc', 'completed_date_asc'].includes(sort);
  const showAuthorHeaders = sort === 'author_group';
  const showSubGenreHeaders = selectedGenre !== 'all';
  const useCompletedDate = sort.startsWith('completed_date');
  const authorCounts = showAuthorHeaders ? {} : null;
  if (showAuthorHeaders) {
    for (const b of books) {
      const a = (b.author || '').trim() || '（著者不明）';
      authorCounts[a] = (authorCounts[a] || 0) + 1;
    }
  }

  return books.map((book, i) => {
    let header = '';
    if (showSubGenreHeaders) {
      const sg = getSubGenreForGrouping(book, selectedGenre) || selectedGenre;
      if (sg !== lastSubGenre) {
        lastSubGenre = sg;
        const cnt = subGenreCounts[sg] || 0;
        header = `<div class="year-group-header">${escapeHtml(sg)}（${cnt}冊）</div>`;
      }
    } else if (showYearHeaders) {
      const dateStr = useCompletedDate ? (book.completed_date || book.loan_date || '') : (book.loan_date || '');
      const year = dateStr.substring(0, 4);
      if (year && year !== lastYear) {
        lastYear = year;
        header = `<div class="year-group-header">${escapeHtml(year)}年</div>`;
      }
    } else if (showAuthorHeaders) {
      const authorKey = (book.author || '').trim() || '（著者不明）';
      if (authorKey !== lastAuthor) {
        lastAuthor = authorKey;
        const cnt = authorCounts[authorKey] || 0;
        header = `<div class="year-group-header">${escapeHtml(authorKey)}（${cnt}冊）</div>`;
      }
    }

    return header + renderBookCardHtml(book, {
      extraClass: 'book-card-clickable',
      extraAttrs: `data-book-index="${i}"`,
      showUnrated: !!_authUser,
      showProgress: true,
    });
  }).join('');
}

function renderTableView(books, selectedGenre = 'all', prevBook = null, subGenreCounts = {}) {
  let lastSubGenre = prevBook && selectedGenre !== 'all' ? getSubGenreForGrouping(prevBook, selectedGenre) : null;
  const showSubGenreHeaders = selectedGenre !== 'all';
  // 今日の日付を1回だけ計算してループ内で使い回す
  const _today = new Date();
  const _todayStr = `${_today.getFullYear()}-${String(_today.getMonth() + 1).padStart(2, '0')}-${String(_today.getDate()).padStart(2, '0')}`;

  const rows = books.map((book, i) => {
    let headerRow = '';
    if (showSubGenreHeaders) {
      const sg = getSubGenreForGrouping(book, selectedGenre) || selectedGenre;
      if (sg !== lastSubGenre) {
        lastSubGenre = sg;
        const cnt = subGenreCounts[sg] || 0;
        headerRow = `<tr class="rating-group-row"><td colspan="12" class="rating-group-header">${escapeHtml(sg)}（${cnt}冊）</td></tr>`;
      }
    }
    const srcBadge = book.source ? `<span class="badge-source badge-${escapeHtml(book.source)}" data-short="${escapeHtml(sourceShortLabel(book.source))}" data-filter-source="${escapeHtml(book.source)}">${escapeHtml(sourceLabel(book.source))}</span>` : '';
    const completedBadge = book.completed ? `<span class="badge-completed" data-filter-source="${escapeHtml(book.source || '')}">読了</span> ` : '';
    const favoriteBadge = book.favorite ? '<span class="badge-favorite" title="お気に入り">♥</span> ' : '';
    const genre = book.genre ? genreBadgeHtml(book, true) : '—';
    const summary = (book.summary || '').trim();
    const summaryCell = summary ? escapeHtml(summary.length > 80 ? summary.substring(0, 80) + '…' : summary) : '—';
    const tsundoku = getTsundokuDays(book, _todayStr);
    const tsundokuStr = tsundoku != null ? tsundoku + '日' : '—';

    // レビュー列: 星 + 個人レビュー（または未レビューボタン）
    const reviewCellHtml = buildReviewCellHtml(book);

    return headerRow + `
      <tr class="book-row-clickable ${book.completed ? 'row-completed' : ''}" data-book-index="${i}" role="button" tabindex="0">
        <td class="col-cover"><img src="${escapeHtml(book.cover_url || NO_COVER)}" alt=""
            loading="lazy" onerror="this.src='${NO_COVER}'"></td>
        <td class="col-title">
          <div>${completedBadge}${favoriteBadge}${escapeHtml(book.title)}</div>
        </td>
        <td class="col-author" title="${escapeHtml(book.author || '')}">${escapeHtml(book.author || '')}</td>
        <td class="col-review" onclick="event.stopPropagation()">${reviewCellHtml}</td>
        <td class="col-ai-insight">${renderTableInsightCell(book)}</td>
        <td class="col-summary" title="${summary ? escapeHtml(summary) : ''}">${summaryCell}</td>
        <td class="col-genre">${genre}</td>
        <td class="col-runtime">${(book.runtime_length_min || 0) > 0 ? formatRuntime(book.runtime_length_min) : '—'}</td>
        <td>${formatDate(book.loan_date)}</td>
        <td>${book.completed ? formatDateOnly(book.completed_date) : (formatProgress(book) || '—')}</td>
        <td class="col-tsundoku">${tsundokuStr}</td>
        <td>${srcBadge}</td>
      </tr>
    `;
  }).join('');

  return `
    <table class="book-table">
      <thead>
        <tr>
          <th class="col-cover"></th>
          <th class="col-title">タイトル</th>
          <th class="col-author th-sortable" data-sort-asc="author_group" data-sort-desc="author_group" title="クリックでソート">著者</th>
          <th class="col-review">レビュー</th>
          <th class="col-ai-insight">書評ポイント</th>
          <th class="col-summary">概要</th>
          <th class="col-genre">ジャンル</th>
          <th class="col-runtime">再生時間</th>
          <th class="th-sortable" data-sort-asc="tsundoku_desc" data-sort-desc="date_desc" title="クリックでソート">取得日</th>
          <th class="th-sortable" data-sort-asc="completed_date_asc" data-sort-desc="completed_date_desc" title="クリックでソート">読了日</th>
          <th class="th-sortable" data-sort-asc="tsundoku_desc" data-sort-desc="tsundoku_desc" title="クリックでソート">積読</th>
          <th>ソース</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderPagination(start) {
  const pag = document.getElementById('pagination');
  const totalPages = Math.ceil(filteredBooks.length / PAGE_SIZE);
  if (totalPages <= 1) { pag.style.display = 'none'; return; }
  const from = start + 1;
  const to = Math.min(start + PAGE_SIZE, filteredBooks.length);

  pag.innerHTML = `
    <div class="pagination-info">${filteredBooks.length}件中 ${from}–${to}件</div>
    <div class="pagination-buttons">
      <button type="button" class="btn btn-secondary" id="pagePrev" ${currentPage <= 0 ? 'disabled' : ''}>← 前へ</button>
      <span class="pagination-page">${currentPage + 1} / ${totalPages}</span>
      <button type="button" class="btn btn-secondary" id="pageNext" ${currentPage >= totalPages - 1 ? 'disabled' : ''}>次へ →</button>
    </div>
  `;
  pag.style.display = 'flex';

  document.getElementById('pagePrev')?.addEventListener('click', () => {
    if (currentPage > 0) { currentPage--; renderBooks(); window.scrollTo(0, 0); }
  });
  document.getElementById('pageNext')?.addEventListener('click', () => {
    if (currentPage < totalPages - 1) { currentPage++; renderBooks(); window.scrollTo(0, 0); }
  });
}

/* --- Chart toggle & tabs --- */

document.getElementById('chartToggle')?.addEventListener('click', () => {
  document.getElementById('chartSection')?.classList.toggle('open');
});

document.querySelectorAll('.chart-mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.chart-mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    chartMode = btn.dataset.mode || 'count';
    activeChartSource = null;
    scheduleRenderCharts();
  });
});

document.querySelectorAll('.chart-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.chart-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const target = tab.dataset.tab;
    document.getElementById('chartMonthlyWrap').style.display  = target === 'monthly'  ? '' : 'none';
    document.getElementById('chartGenreWrap').style.display    = target === 'genre'    ? '' : 'none';
    document.getElementById('chartTagWrap').style.display      = target === 'tag'      ? '' : 'none';
    document.getElementById('chartRelationWrap').style.display = target === 'relation' ? '' : 'none';
    if (target === 'tag') renderTagTab();
  });
});

document.querySelectorAll('.relation-mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.relation-mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    relationChartMode = btn.dataset.relationMode || 'genre_rating';
    renderRelationChart();
  });
});

/* --- 本リストタブ（読んだ / 途中 / これから検索） --- */
document.querySelectorAll('.book-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const tabVal = tab.dataset.tab;
    if (tabVal === activeBookTab) return;
    activeBookTab = tabVal;
    document.querySelectorAll('.book-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    if (tabVal === 'community' || tabVal === 'messages' || tabVal === 'ranking') {
      updateTabContentVisibility();
    } else {
      const sortSel = document.getElementById('sortSelect');
      if (sortSel && tabVal === 'read') sortSel.value = 'completed_date_desc';
      applyFilters();
    }
    window.scrollTo(0, 0);
  });
});

document.getElementById('rankingYearFilter')?.addEventListener('change', () => {
  if (activeBookTab === 'ranking') {
    selectedRankingGenre = null;
    populateRankingFilters();
    renderRanking();
  }
});
document.getElementById('recommendGenerateBtn')?.addEventListener('click', () => {
  if (activeBookTab === 'recommend') renderYondaRecommend();
});
document.getElementById('recommendRefreshBtn')?.addEventListener('click', () => {
  if (activeBookTab === 'recommend') renderYondaRecommend();
});
document.getElementById('messagesRefreshBtn')?.addEventListener('click', loadMessages);

/* --- Kindle OTP モーダル --- */
(function () {
  const modal = document.getElementById('kindleOtpModal');
  const input = document.getElementById('kindleOtpInput');
  const submitBtn = document.getElementById('kindleOtpSubmitBtn');
  const cancelBtn = document.getElementById('kindleOtpCancelBtn');
  const closeBtn = document.getElementById('kindleOtpClose');
  const errEl = document.getElementById('kindleOtpError');

  function closeKindleOtpModal() {
    if (modal) modal.style.display = 'none';
    _kindleOtpPendingSessionId = null;
    if (input) input.value = '';
    if (errEl) errEl.style.display = 'none';
  }

  async function submitKindleOtpFetch() {
    const otp = (input?.value || '').trim();
    if (!otp) {
      if (errEl) { errEl.textContent = 'コードを入力してください。'; errEl.style.display = ''; }
      return;
    }
    if (!_kindleOtpPendingSessionId) {
      if (errEl) { errEl.textContent = 'セッションが期限切れです。再度取り込みをお試しください。'; errEl.style.display = ''; }
      return;
    }
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '送信中…'; }
    try {
      const res = await fetch('/api/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ library_id: 'kindle', session_id: _kindleOtpPendingSessionId, otp, notify_completed: true }),
      });
      const data = await res.json();
      if (data.success) {
        closeKindleOtpModal();
        showToast('Kindle の取得が完了しました', 'success');
        if (typeof loadBooks === 'function') await loadBooks();
        await loadMessages();
      } else {
        if (errEl) { errEl.textContent = data.error || 'OTP が正しくありません。再度お試しください。'; errEl.style.display = ''; }
      }
    } catch (e) {
      if (errEl) { errEl.textContent = '通信エラー: ' + e.message; errEl.style.display = ''; }
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '送信'; }
    }
  }

  submitBtn?.addEventListener('click', submitKindleOtpFetch);
  cancelBtn?.addEventListener('click', closeKindleOtpModal);
  closeBtn?.addEventListener('click', closeKindleOtpModal);
  input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitKindleOtpFetch(); });
  modal?.addEventListener('click', (e) => { if (e.target === modal) closeKindleOtpModal(); });
})();
document.getElementById('menuAdminUsers')?.addEventListener('click', () => {
  closeHamburger();
  openAdminUsersModal();
});

/* ============================================================
   ユーザー管理モーダル（管理者のみ）
   ============================================================ */

function openAdminUsersModal() {
  const modal = document.getElementById('adminUsersModal');
  if (!modal) return;
  modal.style.display = 'flex';
  loadAdminUsers();
}

function closeAdminUsersModal() {
  const modal = document.getElementById('adminUsersModal');
  if (modal) modal.style.display = 'none';
}

document.getElementById('adminBackfillBtn')?.addEventListener('click', async () => {
  const btn = document.getElementById('adminBackfillBtn');
  const resultEl = document.getElementById('adminBackfillResult');
  if (btn) btn.disabled = true;
  if (resultEl) resultEl.textContent = '処理中…';
  try {
    const res = await fetch('/api/admin/backfill-messages', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ email: _authUser?.email }),
    });
    const data = await res.json();
    if (data.success) {
      if (resultEl) resultEl.textContent = `✅ ${data.updated}件のメッセージに「${data.user?.name || data.user?.email}」を設定しました`;
    } else {
      if (resultEl) resultEl.textContent = `❌ ${data.error || 'エラー'}`;
    }
  } catch (e) {
    if (resultEl) resultEl.textContent = `❌ ${e.message}`;
  } finally {
    if (btn) btn.disabled = false;
  }
});

async function loadAdminUsers() {
  const listEl = document.getElementById('adminUsersList');
  const loadingEl = document.getElementById('adminUsersLoading');
  if (!listEl) return;
  if (loadingEl) loadingEl.style.display = 'block';
  listEl.innerHTML = '';
  try {
    const res = await fetch('/api/admin/users');
    const data = await res.json();
    if (loadingEl) loadingEl.style.display = 'none';
    if (!res.ok) {
      listEl.innerHTML = `<p class="recommend-error">${escapeHtml(data.error || 'エラー')}</p>`;
      return;
    }
    const users = data.users || [];
    if (users.length === 0) {
      listEl.innerHTML = '<p class="recommend-empty">登録ユーザーがいません</p>';
      return;
    }
    listEl.innerHTML = `
      <div class="admin-users-summary">
        <strong>登録ユーザー数: ${users.length}人</strong>
        &nbsp;/&nbsp;
        <strong>総書籍数: ${users.reduce((s, u) => s + (u.book_total || 0), 0).toLocaleString()}冊</strong>
      </div>
      <table class="admin-users-table">
        <thead>
          <tr>
            <th>ユーザー</th>
            <th>登録日</th>
            <th>最終ログイン</th>
            <th>書籍数</th>
            <th>ソース</th>
          </tr>
        </thead>
        <tbody>
          ${users.map(u => {
            const avatar = u.picture
              ? `<img src="${escapeHtml(u.picture)}" class="admin-user-avatar" width="28" height="28">`
              : '<span class="admin-user-avatar-placeholder">👤</span>';
            const created = u.created_at ? u.created_at.substring(0, 10) : '—';
            const lastLogin = u.last_login ? u.last_login.substring(0, 10) : '—';
            const sources = (u.sources || []).join(', ') || '—';
            return `<tr>
              <td class="admin-user-name-cell">
                ${avatar}
                <span>
                  <div>${escapeHtml(u.name || '—')}</div>
                  <div class="admin-user-email">${escapeHtml(u.email || '—')}</div>
                </span>
              </td>
              <td>${created}</td>
              <td>${lastLogin}</td>
              <td>${(u.book_total || 0).toLocaleString()}冊</td>
              <td class="admin-user-sources">${escapeHtml(sources)}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;
  } catch (e) {
    if (loadingEl) loadingEl.style.display = 'none';
    listEl.innerHTML = `<p class="recommend-error">エラー: ${escapeHtml(e.message)}</p>`;
  }
}

/* ============================================================
   タグ傾向分析 v2 — カテゴリ別タグクラウド
   ============================================================ */


// タグ分析のカテゴリ一覧は CANONICAL_GENRES と同一（統一定義を参照）
const TAG_MAIN_CATEGORIES = CANONICAL_GENRES;


// 実データのジャンル文字列 → 表示カテゴリへの直接マッピング
// ※ 部分一致で判定するため、長いキーワードを先に並べる
// GENRE_TO_CATEGORY は GENRE_NORMALIZE_MAP に統合済み（後方互換エイリアス）
const GENRE_TO_CATEGORY = GENRE_NORMALIZE_MAP;

// カテゴリ内のノイズタグ（そのカテゴリ内では表示しない自明なタグ）
const CATEGORY_TAG_BLOCKLIST = {
  '文学・フィクション':       new Set(['文学', '小説', 'フィクション', 'fiction', '文芸']),
  'ミステリー・サスペンス':   new Set(['ミステリー', 'サスペンス', 'スリラー', 'ホラー', '小説', 'フィクション']),
  'ビジネス・キャリア':       new Set(['ビジネス', 'business', 'キャリア', 'ドキュメンタリー']),
  '自己啓発・人間関係':       new Set(['自己啓発', '人間関係', '子育て', 'self-help', 'コミュニケーション']),
  '社会・政治':               new Set(['政治', '社会', '政治学', '社会科学', '政治学・社会科学']),
  '科学・テクノロジー':       new Set(['テクノロジー', 'it', 'science', 'technology', '科学', '工学', 'コンピュータ']),
  'ノンフィクション':         new Set(['ノンフィクション', 'エッセイ', '随筆', '自伝', '回顧録', 'nonfiction']),
  '歴史・文化':                new Set(['歴史', 'history', '歴史学', '文化', '宗教', '文明']),
  'ライフ':                   new Set(['ライフ', 'ライフスタイル', 'life', 'アート', 'エンタメ']),
};

// カテゴリ別・summary/full_summary からの詳細タグ抽出パターン
const DETAIL_TAG_PATTERNS = {
  '文学・フィクション': [
    { tag: '恋愛・ロマンス',     words: ['恋愛', '恋人', 'ロマンス', '片思い', '初恋', '結婚', '告白', 'love', 'romance'] },
    { tag: '家族・親子',         words: ['家族', '親子', '夫婦', '母親', '父親', '兄弟', '子ども', '子供', '息子', '娘'] },
    { tag: '青春・学生',         words: ['青春', '高校生', '中学生', '大学生', '学生', '部活', '学校', '少年', '少女'] },
    { tag: '感動・泣ける',       words: ['感動', '涙', '泣ける', '切ない', '号泣'] },
    { tag: '職場・社会ドラマ',   words: ['仕事', '職場', '会社', 'サラリーマン', '格差', '差別', '孤独'] },
    { tag: '歴史・時代小説',     words: ['江戸', '明治', '昭和', '侍', '武士', '戦国', '幕末', '時代小説'] },
    { tag: 'SF・ファンタジー',   words: ['sf', '宇宙', '未来', 'ロボット', '異世界', '魔法', 'ファンタジー'] },
    { tag: '海外・翻訳',         words: ['海外', '外国', '翻訳', 'アメリカ', 'イギリス', 'フランス'] },
  ],
  'ミステリー・サスペンス': [
    { tag: '謎解き・推理',       words: ['謎', '推理', '殺人', '事件', '探偵', '刑事', '犯罪', 'mystery', 'detective'] },
    { tag: 'ホラー・恐怖',       words: ['ホラー', '恐怖', '怖い', '幽霊', '呪い', 'horror'] },
    { tag: 'サスペンス・逃走',   words: ['サスペンス', 'スリラー', '心理戦', '追跡', '逃亡', 'thriller', 'suspense'] },
    { tag: '法廷・法律',         words: ['法廷', '裁判', '弁護士', '検察', '判決', '冤罪'] },
    { tag: '国際・スパイ',       words: ['スパイ', '国際', '諜報', 'テロ', '陰謀', '工作員'] },
    { tag: '社会派・格差',       words: ['格差', '差別', '貧困', '社会問題', 'いじめ'] },
  ],
  'ビジネス・キャリア': [
    { tag: 'リーダーシップ・組織', words: ['リーダー', 'リーダーシップ', '組織', 'チーム', 'マネジメント', 'management'] },
    { tag: '起業・スタートアップ', words: ['起業', 'スタートアップ', 'ベンチャー', '創業', '事業', 'startup'] },
    { tag: 'マーケティング・戦略', words: ['マーケティング', '戦略', 'ブランド', '広告', '市場', 'marketing'] },
    { tag: 'キャリア・転職',       words: ['キャリア', '転職', '就職', '働き方', 'career'] },
    { tag: 'イノベーション・DX',   words: ['イノベーション', 'dx', 'デジタル変革', '変革', 'innovation'] },
    { tag: '会計・投資',           words: ['会計', '財務', '投資', '株', '資産', 'ファイナンス', 'accounting'] },
    { tag: 'エンタメビジネス',     words: ['エンタメ', 'アニメ', 'ゲーム', '映画', 'ip', 'コンテンツ', 'プロデューサー'] },
    { tag: 'プレゼン・説明力',     words: ['プレゼン', '説明', '伝え方', 'ファシリテーション'] },
  ],
  '自己啓発・人間関係': [
    { tag: '習慣・生産性',     words: ['習慣', '生産性', '目標', '時間管理', 'habit', 'productivity'] },
    { tag: '心理学・行動科学', words: ['心理', '行動', '認知', '意思決定', 'バイアス', '脳', 'psychology'] },
    { tag: '思考法・学習',     words: ['思考法', '考え方', '学習法', '記憶', 'ロジカル', 'thinking'] },
    { tag: '成功・成長',       words: ['成功', '成長', '自己実現', '挑戦', '可能性', 'growth'] },
    { tag: 'メンタル・幸福',   words: ['メンタル', '幸福', '充実', 'ウェルビーイング', 'happiness'] },
    { tag: '人間関係',         words: ['人間関係', '対人', '共感', '信頼', 'relationship'] },
    { tag: 'コミュニケーション', words: ['コミュニケーション', '対話', '交渉', '説得', '話し方'] },
    { tag: '子育て・教育',     words: ['子育て', '育児', '子ども', '親', '教育', '学校', 'parenting'] },
    { tag: '語学・言語',       words: ['語学', '英語', '言語', '外国語', 'language'] },
  ],
  '社会・政治': [
    { tag: '経済・金融',             words: ['経済', '金融', 'gdp', '景気', '貿易', 'economics', '資本主義'] },
    { tag: '政治・行政',             words: ['政治', '政策', '選挙', '行政', '議会', '政府', 'politics'] },
    { tag: '国際・外交',             words: ['外交', '国際', '世界', '条約', '安全保障', 'international'] },
    { tag: '中国・アジア',           words: ['中国', '習近平', '共産党', '台湾', 'アジア', '北朝鮮', '韓国'] },
    { tag: '哲学・思想',             words: ['哲学', '思想', '倫理', '道徳', '自由', '正義', 'philosophy'] },
    { tag: 'ジェンダー・社会',       words: ['ジェンダー', 'フェミニズム', '女性', '男女', '格差', '差別', '貧困'] },
    { tag: 'メディア・情報',         words: ['メディア', 'ジャーナリズム', '新聞', 'テレビ', '報道', 'media'] },
  ],
  '科学・テクノロジー': [
    { tag: 'AI・機械学習',         words: ['ai', '機械学習', 'ディープラーニング', 'chatgpt', '生成ai', '人工知能', 'llm'] },
    { tag: 'プログラミング・開発', words: ['プログラミング', 'コーディング', '開発', 'エンジニア', 'ソフトウェア', 'coding'] },
    { tag: '医療・バイオ',         words: ['医療', '医学', '遺伝子', 'バイオ', '病気', 'がん', 'ゲノム', 'medicine'] },
    { tag: '脳科学・認知科学',     words: ['脳', '脳科学', '神経', '認知', '意識', '心理学', '行動', '感情'] },
    { tag: '人類学・考古学',       words: ['人類学', '考古', '化石', 'ネアンデルタール', '縄文', '人類起源', '先史'] },
    { tag: '宇宙・天文',           words: ['宇宙', '天文', 'ブラックホール', '天体', '星', '惑星', 'space'] },
    { tag: '物理・数学',           words: ['物理', '量子', '相対性', '素粒子', '数学', '論理', 'physics', 'math'] },
    { tag: 'デジタル・インターネット', words: ['インターネット', 'デジタル', 'web', 'sns', 'ソーシャル', 'digital'] },
  ],
  'ノンフィクション': [
    { tag: 'エッセイ・随筆',     words: ['エッセイ', '随筆', '日記', '雑感', 'コラム', 'essay'] },
    { tag: '自伝・回顧録',       words: ['自伝', '回顧録', '自叙伝', '体験記', 'memoir', 'autobiography'] },
    { tag: '有名人・著名人',     words: ['有名人', '著名人', '芸能人', '政治家', '経営者', '起業家', '作家'] },
    { tag: 'ルポ・ジャーナリズム', words: ['ルポ', 'ルポルタージュ', '調査', '取材', 'ジャーナリズム', 'ドキュメント'] },
    { tag: '旅・体験記',         words: ['旅', '旅行', '体験', '冒険', '探検', 'travel'] },
    { tag: '日常・暮らし',       words: ['日常', '生活', '暮らし', '日々', 'くらし'] },
    { tag: '社会・時代観察',     words: ['社会', '時代', '世の中', '現代', '観察', '考察'] },
  ],
  '歴史・文化': [
    { tag: '日本史',         words: ['明治', '大正', '昭和', '幕末', '江戸', '平安', '鎌倉', '戦国', '室町', '日本史'] },
    { tag: '世界史・国際史', words: ['世界史', '世界大戦', 'ヨーロッパ', '植民地', '帝国'] },
    { tag: '古代文明',       words: ['古代', 'インカ', 'マヤ', 'エジプト', 'メソポタミア', 'ローマ', 'ギリシャ', '遺跡', '文明'] },
    { tag: '戦争・軍事',     words: ['戦争', '軍事', '兵器', '戦闘', '太平洋戦争', '第二次世界大戦', '冷戦'] },
    { tag: '歴史的人物',     words: ['偉人', '英雄', '武将', '将軍', '王', '皇帝', '革命家'] },
    { tag: '宗教・信仰',     words: ['宗教', '信仰', 'キリスト教', 'イスラム', '仏教', '神道', 'religion'] },
    { tag: '文化・思想',     words: ['文化', '伝統', '風俗', '哲学', '思想', '価値観', '倫理'] },
    { tag: '文明・人類学',   words: ['文明', '人類', '民族', '民俗', '起源', '文明史'] },
  ],
  'ライフ': [
    { tag: '料理・グルメ',       words: ['料理', 'レシピ', '食', 'グルメ', '食べ物', '食材', 'cooking'] },
    { tag: '健康・ダイエット',   words: ['健康', 'ダイエット', '体', '栄養', 'ヘルシー', 'health'] },
    { tag: '旅行・アウトドア',   words: ['旅行', '旅', 'アウトドア', '登山', '観光', '散歩', 'travel'] },
    { tag: '日常・暮らし',       words: ['暮らし', '生活', '日常', '家事', '掃除', '整理', 'ライフスタイル'] },
    { tag: 'アート・エンタメ',   words: ['アート', '美術', 'デザイン', '映画', '音楽', 'エンタメ', '演劇', 'art'] },
    { tag: '読書・本',           words: ['読書', '本', '書籍', '図書館', '名著', '読み方', '文章'] },
    { tag: 'フィットネス・スポーツ', words: ['運動', 'フィットネス', 'スポーツ', 'トレーニング', 'ランニング'] },
    { tag: '環境・サステナブル', words: ['環境', 'サステナブル', 'エコ', '気候変動', 'sustainable'] },
    { tag: '教育・学習',         words: ['教育', '学習', '語学', '英語', '言語', '読書法', '思考法', '勉強', 'learning'] },
  ],
};

let _tagActiveCat  = TAG_MAIN_CATEGORIES[0];
let _tagCatData    = null; // computeCategoryTagAnalytics() の結果をキャッシュ

/** book の insight key を返す (bookInsightsCache のキーと一致) */
function _bookInsightKey(book) {
  const src = (book.source || '').trim();
  const cat = (book.catalog_number || '').trim();
  if (src && cat) return `${src}:${cat}`;
  return null;
}

/** book の genre 文字列を表示カテゴリに分類する（normalizeGenre に完全委譲） */
function classifyBookToMainCategory(book) {
  return normalizeGenre(book.genre || '');
}

/** 1冊の詳細タグを生成（insight headings + genre sub + summary patterns） */
function generateDetailedTagsForBook(book, mainCat) {
  const tags = new Set();
  const blocklist = CATEGORY_TAG_BLOCKLIST[mainCat] || new Set();
  // 1. insight point headings
  const key = _bookInsightKey(book);
  if (key && bookInsightsCache[key]?.points) {
    bookInsightsCache[key].points.forEach(p => {
      const h = (p.heading || '').trim();
      if (h && h.length <= 20 && !blocklist.has(h.toLowerCase())) tags.add(h);
    });
  }
  // 2. ジャンルの2階層目以降（カテゴリ名と同じ語は除外）
  genreTags(book.genre).slice(1).forEach(g => {
    if (g && g.length <= 20 && !blocklist.has(g) && !blocklist.has(g.toLowerCase())) tags.add(g);
  });
  // 3. summary / full_summary のキーワードパターン
  const summaryText = ((book.full_summary || '') + ' ' + (book.summary || '')).toLowerCase();
  const patterns = DETAIL_TAG_PATTERNS[mainCat] || [];
  for (const { tag, words } of patterns) {
    if (words.some(w => summaryText.includes(w))) tags.add(tag);
  }
  return [...tags];
}

/** カテゴリ別にタグ集計データを作成 */
function computeCategoryTagAnalytics() {
  const result = {};
  for (const cat of TAG_MAIN_CATEGORIES) result[cat] = { books: [], tagMap: {} };
  for (const book of allBooks) {
    const cat = classifyBookToMainCategory(book);
    result[cat].books.push(book);
    const detailTags = generateDetailedTagsForBook(book, cat);
    for (const tag of detailTags) {
      if (!result[cat].tagMap[tag]) result[cat].tagMap[tag] = { total: 0, read: 0, unread: 0, books: [] };
      const td = result[cat].tagMap[tag];
      td.total++;
      book.completed ? td.read++ : td.unread++;
      td.books.push(book);
    }
  }
  return result;
}

/** カテゴリ分布バーを描画 */
const CAT_COLORS = {
  '文学・フィクション':    { read: '#6d9eeb', unread: '#bdd3f5' },
  'ミステリー・サスペンス': { read: '#e06666', unread: '#f5b8b8' },
  'ビジネス・キャリア':    { read: '#f6b26b', unread: '#fad9b5' },
  '自己啓発・人間関係':    { read: '#ffd966', unread: '#fff0b0' },
  '社会・政治':            { read: '#b07ab8', unread: '#ddb8e4' },
  '科学・テクノロジー':    { read: '#45818e', unread: '#9ec5cb' },
  'ノンフィクション':      { read: '#93c47d', unread: '#c6e2b7' },
  '歴史・文化':            { read: '#c9a040', unread: '#e8d095' },
  'ライフ':                { read: '#76a5af', unread: '#b8d5db' },
  'その他':                { read: '#b7b7b7', unread: '#dedede' },
};

function renderCategoryOverview(catData) {
  const el = document.getElementById('tagCatOverview');
  if (!el) return;
  const total = allBooks.length || 1;
  const maxN = Math.max(...TAG_MAIN_CATEGORIES.map(c => catData[c]?.books.length || 0), 1);

  const bars = TAG_MAIN_CATEGORIES.map(cat => {
    const info = catData[cat] || { books: [] };
    const n = info.books.length;
    const read = info.books.filter(b => b.completed).length;
    const unread = n - read;
    const barPct = Math.round((n / maxN) * 100);
    const readPct = n > 0 ? Math.round((read / n) * 100) : 0;
    const unreadPct = 100 - readPct;
    const col = CAT_COLORS[cat] || CAT_COLORS['その他'];
    const isActive = cat === _tagActiveCat ? ' tag-overview-bar-active' : '';
    return `<div class="tag-overview-bar-item${isActive}" data-cat="${escapeAttr(cat)}">
      <div class="tag-overview-bar-label">${escapeHtml(cat)}</div>
      <div class="tag-overview-bar-track">
        <div class="tag-overview-bar-bg" style="width:${barPct}%">
          <div class="tag-overview-bar-read"  style="width:${readPct}%;background:${col.read}"></div>
          <div class="tag-overview-bar-unread" style="width:${unreadPct}%;background:${col.unread}"></div>
        </div>
      </div>
      <div class="tag-overview-bar-stats"><strong>${n}</strong>冊 <span class="tob-read">読了${read}</span> <span class="tob-unread">未読${unread}</span></div>
    </div>`;
  }).join('');

  el.innerHTML = `
    <div class="tag-overview-legend">
      <span class="tob-legend-read">■ 読了</span>
      <span class="tob-legend-unread">■ 未読</span>
      <span class="tob-legend-note">（バー長 = カテゴリ最大冊数比）</span>
    </div>
    <div class="tag-overview-bars">${bars}</div>`;
  el.querySelectorAll('.tag-overview-bar-item').forEach(item => {
    item.addEventListener('click', () => {
      _tagActiveCat = item.dataset.cat;
      renderCategoryOverview(catData);
      renderCategoryTabs(catData);
      renderCategoryCloud(catData);
    });
  });
}

/** カテゴリタブを描画 */
function renderCategoryTabs(catData) {
  const el = document.getElementById('tagCatTabs');
  if (!el) return;
  el.innerHTML = TAG_MAIN_CATEGORIES.map(cat => {
    const n = catData[cat].books.length;
    const active = cat === _tagActiveCat ? ' active' : '';
    return `<button type="button" class="tag-cat-tab${active}" data-cat="${escapeAttr(cat)}">${escapeHtml(cat)}<span class="tag-cat-tab-count">${n}</span></button>`;
  }).join('');
  el.querySelectorAll('.tag-cat-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      _tagActiveCat = btn.dataset.cat;
      renderCategoryOverview(catData);
      renderCategoryTabs(catData);
      renderCategoryCloud(catData);
    });
  });
}

/** 選択カテゴリのタグクラウドを描画 */
function renderCategoryCloud(catData) {
  const el = document.getElementById('tagCatContent');
  if (!el) return;
  const catInfo = catData[_tagActiveCat];
  if (!catInfo) return;
  const { books, tagMap } = catInfo;
  const read = books.filter(b => b.completed).length;
  const unread = books.length - read;
  const sortedTagList = Object.entries(tagMap).sort((a, b) => b[1].total - a[1].total);
  const max = sortedTagList.length ? sortedTagList[0][1].total : 1;

  const cloudHtml = sortedTagList.length
    ? sortedTagList.map(([tag, d]) => {
        const size = 0.7 + (d.total / max) * 1.2;
        const opacity = 0.45 + (d.total / max) * 0.55;
        const pct = books.length > 0 ? Math.round((d.total / books.length) * 100) : 0;
        return `<span class="tag-chip" data-tag="${escapeAttr(tag)}" style="font-size:${size.toFixed(2)}rem;opacity:${opacity.toFixed(2)}" title="${escapeHtml(tag)}: ${pct}%（計${d.total}冊 / 読了${d.read} / 未読${d.unread}）">${escapeHtml(tag)}<span class="tag-chip-pct">${pct}%</span></span>`;
      }).join('')
    : '<p class="tag-cloud-empty">このカテゴリにタグはまだありません<br><small>AI書評を生成すると詳細タグが増えます</small></p>';

  el.innerHTML = `
    <div class="tag-cat-stats">
      <span>計 <strong>${books.length}</strong>冊</span>
      <span class="tag-cat-stat-read">読了 <strong>${read}</strong></span>
      <span class="tag-cat-stat-unread">未読 <strong>${unread}</strong></span>
    </div>
    <div class="tag-cloud-wrap">${cloudHtml}</div>
    <div class="tag-detail-panel" id="tagDetailPanel" style="display:none"></div>
  `;

  el.querySelectorAll('.tag-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const tag = chip.dataset.tag;
      const tagBooks = tagMap[tag]?.books || [];
      _showTagDetailInline(tag, tagBooks, el);
    });
  });
}

/** タグクリック時: 該当書籍リストをインライン表示 */
function _showTagDetailInline(tag, books, container) {
  const panel = container.querySelector('#tagDetailPanel');
  if (!panel) return;
  const sorted = books.slice().sort((a, b) => {
    if (a.completed && !b.completed) return -1;
    if (!a.completed && b.completed) return 1;
    return (b.completed_date || '').localeCompare(a.completed_date || '');
  });
  const html = sorted.map(b => {
    const status = b.completed
      ? `<span class="tag-detail-read">読了 ${(b.completed_date || '').slice(0, 7)}</span>`
      : `<span class="tag-detail-unread">未読</span>`;
    const idx = _bookIndex(b);
    return `<div class="tag-detail-book" ${idx >= 0 ? `data-book-idx="${idx}"` : ''}>
      ${b.cover_url ? `<img class="tag-detail-cover" src="${escapeHtml(b.cover_url)}" alt="" loading="lazy">` : '<div class="tag-detail-cover tag-detail-cover-placeholder"></div>'}
      <div class="tag-detail-info"><strong>${escapeHtml(b.title || '—')}</strong><br><small>${escapeHtml(b.author || '')}</small><br>${status}</div>
    </div>`;
  }).join('');
  panel.innerHTML = `
    <div class="tag-detail-header">
      <strong>「${escapeHtml(tag)}」の本 ${books.length}冊</strong>
      <button class="tag-detail-close" id="tagDetailClose">✕</button>
    </div>
    <div class="tag-detail-list">${html}</div>
  `;
  panel.style.display = 'block';
  panel.querySelector('#tagDetailClose')?.addEventListener('click', () => { panel.style.display = 'none'; });
  panel.querySelectorAll('.tag-detail-book[data-book-idx]').forEach(item => {
    item.style.cursor = 'pointer';
    item.addEventListener('click', () => {
      const idx = parseInt(item.dataset.bookIdx);
      if (!isNaN(idx) && allBooks[idx]) openBookDetail(allBooks[idx]);
    });
  });
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/** Yomuタブ表示時にタグ分析を初期化・描画 */
function renderTagAnalytics() {
  if (!allBooks.length) return;
  const section = document.getElementById('tagAnalyticsSection');
  if (!section) return;
  if (!section.open) {
    // details が閉じている間は toggle イベント登録だけ
    const onToggle = () => {
      if (section.open) {
        section.removeEventListener('toggle', onToggle);
        _doRenderTagAnalytics();
      }
    };
    section.addEventListener('toggle', onToggle);
    return;
  }
  _doRenderTagAnalytics();
}

function _doRenderTagAnalytics() {
  _tagCatData = computeCategoryTagAnalytics(); // 常に再計算
  renderCategoryOverview(_tagCatData);
  renderCategoryTabs(_tagCatData);
  renderCategoryCloud(_tagCatData);
}


function openMessagesFromMenu() {
  activeMainTab = 'yonda';
  activeBookTab = 'messages';
  document.getElementById('hamburgerMenu')?.classList.remove('open');
  document.getElementById('filterMenuPanel')?.classList.remove('open');
  document.querySelectorAll('.book-tab').forEach(t => t.classList.remove('active'));
  updateMainTabVisibility();
  showFilters();
  updateTabContentVisibility();
  loadMessages();
  window.scrollTo(0, 0);
}

/* --- Credential management --- */

function updateMenuSourceLink() {
  const libSel = document.getElementById('librarySelect');
  if (!libSel) return;
  const libraryId = libSel.value;
  const linkEl = document.getElementById('menuSourceLink');
  if (!linkEl) return;
  const info = SOURCE_LINKS[libraryId];
  if (info) {
    const url = getSourceLinkUrl(libraryId);
    linkEl.innerHTML = `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" class="menu-source-link-a">${escapeHtml(info.label)} →</a>`;
    linkEl.style.display = '';
  } else {
    linkEl.innerHTML = '';
    linkEl.style.display = 'none';
  }
}

async function updateCredentialStatus() {
  const libSel = document.getElementById('librarySelect');
  if (!libSel) return;
  const libraryId = libSel.value;
  const statusEl = document.getElementById('menuCredStatus');
  if (!statusEl) return;
  try {
    const res = await fetch(`${API.credentials}/${libraryId}`);
    const data = await res.json();
    if (data.success && data.configured) {
      statusEl.className = 'menu-credential-status configured';
      statusEl.textContent = `ログイン設定済み（${data.user_id}）`;
    } else {
      statusEl.className = 'menu-credential-status not-configured';
      statusEl.textContent = 'アカウント未設定';
    }
  } catch (_) {
    statusEl.className = 'menu-credential-status not-configured';
    statusEl.textContent = 'アカウント未設定';
  }
}

function openCredentialModal(libraryId) {
  const modal = document.getElementById('credentialModal');
  const libSelect = document.getElementById('credLibrarySelect');
  const mainLibSelect = document.getElementById('librarySelect');
  const statusEl = document.getElementById('credModalStatus');
  statusEl.textContent = '';
  statusEl.className = 'modal-status';
  libSelect.innerHTML = mainLibSelect.innerHTML;
  libSelect.value = libraryId || mainLibSelect.value;
  if (libraryId) mainLibSelect.value = libraryId;
  document.getElementById('credUserId').value = '';
  document.getElementById('credPassword').value = '';
  modal.classList.add('open');
  loadCredentialForModal();
}

function closeCredentialModal() {
  document.getElementById('credentialModal').classList.remove('open');
  document.getElementById('credOtpFields').style.display = 'none';
  document.getElementById('credCredentialFields').style.display = '';
  document.getElementById('credTestSaveBtn').style.display = '';
  _kindleOtpSessionId = null;
  updateCredentialStatus();
}

/* --- 設定モーダル（アフィリエイトタグ・AI設定） --- */
async function openSettingsModal() {
  const modal = document.getElementById('settingsModal');
  const input = document.getElementById('affiliateTagInput');
  const defaultPageSelect = document.getElementById('defaultPageSelect');
  const statusEl = document.getElementById('settingsModalStatus');
  if (defaultPageSelect) {
    defaultPageSelect.value = getDefaultPage();
  }
  if (input) {
    const stored = localStorage.getItem(AFFILIATE_TAG_KEY);
    input.value = (stored === null || (stored || '').trim() === '') ? DEFAULT_AFFILIATE_TAG : (stored || '');
  }
  const affiliateSection = document.getElementById('affiliateTagSection');
  if (affiliateSection) affiliateSection.style.display = 'none';
  const aiProvider = document.getElementById('aiProviderSelect');
  const aiKey = document.getElementById('aiApiKeyInput');
  if (aiProvider && aiKey) {
    try {
      const res = await fetch('/api/ai-config');
      const data = await res.json();
      if (data.provider) aiProvider.value = data.provider;
      aiKey.value = '';
      aiKey.placeholder = data.configured ? '（設定済み・変更時のみ入力）' : 'sk-... または AIza...';
    } catch (_) {
      aiKey.placeholder = 'sk-... または AIza...';
    }
  }
  if (statusEl) statusEl.textContent = '';
  _loadSearchAppsUI();
  modal.classList.add('open');
}

function closeSettingsModal() {
  document.getElementById('settingsModal').classList.remove('open');
  updateMenuSourceLink();
  renderBookSearchResults();
}

async function saveSettings() {
  const tagInput = document.getElementById('affiliateTagInput');
  const defaultPageSelect = document.getElementById('defaultPageSelect');
  const aiProvider = document.getElementById('aiProviderSelect');
  const aiKey = document.getElementById('aiApiKeyInput');
  const statusEl = document.getElementById('settingsModalStatus');
  const tag = (tagInput?.value || '').trim();
  setAffiliateTag(tag);
  if (defaultPageSelect) {
    setDefaultPage(defaultPageSelect.value);
  }
  _saveSearchAppsFromUI();
  try {
    const res = await fetch('/api/ai-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: aiProvider?.value || 'gemini',
        api_key: (aiKey?.value || '').trim(),
      }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || '保存に失敗しました');
    statusEl.className = 'modal-status success';
    statusEl.textContent = '保存しました。';
  } catch (err) {
    statusEl.className = 'modal-status error';
    statusEl.textContent = err.message || '保存に失敗しました';
    return;
  }
  setTimeout(() => closeSettingsModal(), 500);
}

const CREDENTIAL_LIBS = ['setagaya', 'kindle'];

async function loadCredentialForModal() {
  const libraryId = document.getElementById('credLibrarySelect').value;
  const credFields = document.getElementById('credCredentialFields');
  const kindleNote = document.getElementById('credKindleNote');
  const audibleFields = document.getElementById('credAudibleFields');
  const saveBtn = document.getElementById('credTestSaveBtn');
  const deleteBtn = document.getElementById('credDeleteBtn');

  const needsCreds = CREDENTIAL_LIBS.includes(libraryId);
  credFields.style.display = needsCreds ? '' : 'none';
  kindleNote.style.display = libraryId === 'kindle' ? '' : 'none';
  audibleFields.style.display = libraryId === 'audible_jp' ? '' : 'none';
  document.getElementById('credOtpFields').style.display = 'none';
  document.getElementById('credTestSaveBtn').style.display = libraryId === 'audible_jp' ? 'none' : '';
  _kindleOtpSessionId = null;
  const credUserIdLabel = document.querySelector('label[for="credUserId"]');
  if (credUserIdLabel) {
    credUserIdLabel.textContent = libraryId === 'kindle' ? 'Amazonメールアドレス:' : 'ユーザーID（利用者番号）:';
  }
  document.getElementById('credUserId').placeholder = libraryId === 'kindle' ? 'Amazonメールアドレスを入力' : '利用者番号を入力';
  saveBtn.textContent = needsCreds ? 'ログインテスト & 保存' : '接続確認';
  deleteBtn.style.display = libraryId === 'audible_jp' ? 'none' : '';
  if (libraryId === 'audible_jp') {
    document.getElementById('credAudibleFile').value = '';
  }

  try {
    const res = await fetch(`${API.credentials}/${libraryId}`);
    const data = await res.json();
    const configured = data.success && data.configured;
    if (configured) {
      document.getElementById('credUserId').value = data.user_id || '';
      document.getElementById('credPassword').value = '';
      document.getElementById('credPassword').placeholder = '変更する場合のみ入力';
    } else {
      document.getElementById('credUserId').value = '';
      document.getElementById('credPassword').value = '';
      document.getElementById('credPassword').placeholder = 'パスワードを入力';
    }
    // ダウンロードボタンはログイン済みのときだけ表示
    const downloadRow = document.getElementById('credDownloadRow');
    if (downloadRow) downloadRow.style.display = configured ? '' : 'none';
  } catch (_) {
    const downloadRow = document.getElementById('credDownloadRow');
    if (downloadRow) downloadRow.style.display = 'none';
  }
}

let _kindleOtpSessionId = null;
let _kindleOtpPendingSessionId = null; // manualFetchSource OTP フロー用

async function testAndSaveCredentials() {
  const libraryId = document.getElementById('credLibrarySelect').value;
  const userId = document.getElementById('credUserId').value.trim();
  const password = document.getElementById('credPassword').value;
  const statusEl = document.getElementById('credModalStatus');
  const saveBtn = document.getElementById('credTestSaveBtn');
  const otpFields = document.getElementById('credOtpFields');
  const credFields = document.getElementById('credCredentialFields');

  if (libraryId === 'setagaya' && (!userId || !password)) {
    statusEl.className = 'modal-status error';
    statusEl.textContent = 'ユーザーIDとパスワードを入力してください。';
    return;
  }
  if (libraryId === 'kindle' && userId && !password) {
    statusEl.className = 'modal-status error';
    statusEl.textContent = 'パスワードを入力してください。';
    return;
  }

  if (libraryId === 'kindle' && userId && password) {
    saveBtn.disabled = true;
    statusEl.className = 'modal-status loading';
    statusEl.textContent = 'Amazon にログイン中…';
    otpFields.style.display = 'none';
    _kindleOtpSessionId = null;

    try {
      const res = await fetch(API.kindleLogin, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, password }),
      });
      const data = await res.json();
      if (data.success) {
        statusEl.className = 'modal-status success';
        statusEl.textContent = 'ログイン成功！認証情報を保存しました。';
        updateCredentialStatus();
      } else if (data.needs_otp && data.session_id) {
        _kindleOtpSessionId = data.session_id;
        otpFields.style.display = '';
        credFields.style.display = 'none';
        saveBtn.style.display = 'none';
        statusEl.className = 'modal-status';
        statusEl.textContent = data.message || 'OTP を入力してください。';
        document.getElementById('credOtp').value = '';
        document.getElementById('credOtp').focus();
      } else {
        statusEl.className = 'modal-status error';
        statusEl.textContent = data.error || 'ログインに失敗しました。';
      }
    } catch (err) {
      statusEl.className = 'modal-status error';
      statusEl.textContent = '通信エラー: ' + err.message;
    } finally {
      saveBtn.disabled = false;
    }
    return;
  }

  saveBtn.disabled = true;
  statusEl.className = 'modal-status loading';
  statusEl.textContent = 'ログインテスト中…';

  try {
    const res = await fetch(API.testLogin, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ library_id: libraryId, user_id: userId, password }),
    });
    const data = await res.json();
    if (data.success) {
      statusEl.className = 'modal-status success';
      statusEl.textContent = 'ログイン成功！認証情報を保存しました。';
    } else {
      statusEl.className = 'modal-status error';
      statusEl.textContent = data.error || 'ログインに失敗しました。';
    }
  } catch (err) {
    statusEl.className = 'modal-status error';
    statusEl.textContent = '通信エラー: ' + err.message;
  } finally {
    saveBtn.disabled = false;
  }
}

async function submitKindleOtp() {
  const otp = document.getElementById('credOtp').value.trim();
  const statusEl = document.getElementById('credModalStatus');
  const otpSubmitBtn = document.getElementById('credOtpSubmitBtn');
  const otpFields = document.getElementById('credOtpFields');
  const credFields = document.getElementById('credCredentialFields');
  const saveBtn = document.getElementById('credTestSaveBtn');

  if (!otp || !_kindleOtpSessionId) {
    statusEl.className = 'modal-status error';
    statusEl.textContent = 'OTP を入力してください。';
    return;
  }

  otpSubmitBtn.disabled = true;
  statusEl.className = 'modal-status loading';
  statusEl.textContent = 'OTP を確認中…';

  try {
    const res = await fetch(API.kindleLoginOtp, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: _kindleOtpSessionId, otp }),
    });
    const data = await res.json();
    if (data.success) {
      statusEl.className = 'modal-status success';
      statusEl.textContent = 'ログイン成功！認証情報を保存しました。';
      otpFields.style.display = 'none';
      credFields.style.display = '';
      saveBtn.style.display = '';
      _kindleOtpSessionId = null;
      updateCredentialStatus();
    } else {
      statusEl.className = 'modal-status error';
      statusEl.textContent = data.error || 'OTP が正しくありません。';
    }
  } catch (err) {
    statusEl.className = 'modal-status error';
    statusEl.textContent = '通信エラー: ' + err.message;
  } finally {
    otpSubmitBtn.disabled = false;
  }
}

async function deleteCredentials() {
  const libraryId = document.getElementById('credLibrarySelect').value;
  const statusEl = document.getElementById('credModalStatus');
  if (!confirm('この認証情報を削除しますか？')) return;

  try {
    const res = await fetch(`${API.credentials}/${libraryId}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      statusEl.className = 'modal-status success';
      statusEl.textContent = '認証情報を削除しました。';
      document.getElementById('credUserId').value = '';
      document.getElementById('credPassword').value = '';
      document.getElementById('credPassword').placeholder = 'パスワードを入力';
    } else {
      statusEl.className = 'modal-status error';
      statusEl.textContent = data.error || '削除に失敗しました。';
    }
  } catch (err) {
    statusEl.className = 'modal-status error';
    statusEl.textContent = '通信エラー: ' + err.message;
  }
}

/* --- Event listeners --- */

document.getElementById('fetchBtn')?.addEventListener('click', fetchFromLibrary);
const searchInputYomu = document.getElementById('searchInput');
if (searchInputYomu) {
  let searchDebounce = null;
  searchInputYomu.addEventListener('input', () => {
    if (activeMainTab === 'yomu') {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(renderBookSearchResults, 200);
    }
  });
  searchInputYomu.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && activeMainTab === 'yomu') {
      clearTimeout(searchDebounce);
      renderBookSearchResults();
    }
  });
}
const searchInputYondaEl = document.getElementById('searchInputYonda');
if (searchInputYondaEl) {
  let yondaDebounce = null;
  searchInputYondaEl.addEventListener('input', () => {
    if (activeMainTab === 'yonda') {
      clearTimeout(yondaDebounce);
      yondaDebounce = setTimeout(applyFilters, 200);
    }
    // 検索が空になったら即座にパネルを閉じる
    if (!searchInputYondaEl.value.trim()) updateSearchNoResultsPanel('');
  });
}
document.getElementById('bookPhotoBtn')?.addEventListener('click', () => {
  document.getElementById('bookPhotoAlbumInput')?.click();
});
document.getElementById('bookPhotoAlbumInput')?.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (file && file.type.startsWith('image/')) {
    processBookPhoto(file);
  }
  e.target.value = '';
});
document.getElementById('sourceFilter')?.addEventListener('change', applyFilters);
document.getElementById('genreFilter')?.addEventListener('change', applyFilters);
document.getElementById('ratingFilter')?.addEventListener('change', () => {
  updateBookTabLabels();
  applyFilters();
});
document.getElementById('sortSelect')?.addEventListener('change', applyFilters);

document.getElementById('viewCard')?.addEventListener('click', () => {
  document.getElementById('viewCard').classList.add('active');
  document.getElementById('viewTable').classList.remove('active');
  renderBooks();
});
document.getElementById('viewTable')?.addEventListener('click', () => {
  document.getElementById('viewTable').classList.add('active');
  document.getElementById('viewCard').classList.remove('active');
  renderBooks();
});

document.getElementById('hamburgerBtn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  document.getElementById('hamburgerMenu')?.classList.toggle('open');
  document.getElementById('filterMenuPanel')?.classList.remove('open');
  document.getElementById('menuSourceLink') && updateMenuSourceLink();
  document.getElementById('menuCredStatus') && updateCredentialStatus();
});
document.getElementById('filterMenuBtn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  document.getElementById('hamburgerMenu')?.classList.remove('open');
  document.getElementById('filterMenuPanel')?.classList.toggle('open');
});
document.getElementById('librarySelect')?.addEventListener('change', () => {
  document.getElementById('menuSourceLink') && updateMenuSourceLink();
  document.getElementById('menuCredStatus') && updateCredentialStatus();
});
document.addEventListener('click', () => {
  document.getElementById('hamburgerMenu')?.classList.remove('open');
  document.getElementById('filterMenuPanel')?.classList.remove('open');
});
document.getElementById('hamburgerMenu')?.addEventListener('click', (e) => e.stopPropagation());
document.getElementById('filterMenuPanel')?.addEventListener('click', (e) => e.stopPropagation());

document.getElementById('menuFetchDirect')?.addEventListener('click', () => {
  document.getElementById('hamburgerMenu')?.classList.remove('open');
  const libSel = document.getElementById('librarySelect');
  const libraryId = libSel?.value || 'setagaya';
  openCredentialModal(libraryId);
});
document.getElementById('menuAmazonAi')?.addEventListener('click', () => {
  document.getElementById('hamburgerMenu')?.classList.remove('open');
  openSettingsModal();
});

/* --- Amazon設定モーダル --- */

function openAmazonSettingsModal() {
  const modal = document.getElementById('amazonSettingsModal');
  if (!modal) return;
  // 現在の値をロード
  const url = localStorage.getItem(AMAZON_LIST_URL_KEY) || '';
  const name = localStorage.getItem(AMAZON_LIST_NAME_KEY) || '';
  const tag = localStorage.getItem(AFFILIATE_TAG_KEY) || DEFAULT_AFFILIATE_TAG;
  const urlInput = document.getElementById('amazonSettingsListUrl');
  const nameInput = document.getElementById('amazonSettingsListName');
  const tagInput = document.getElementById('amazonSettingsTag');
  if (urlInput) urlInput.value = url;
  if (nameInput) nameInput.value = name;
  if (tagInput) tagInput.value = tag;
  const statusEl = document.getElementById('amazonSettingsStatus');
  if (statusEl) statusEl.textContent = '';
  modal.style.display = 'flex';
}

function closeAmazonSettingsModal() {
  const modal = document.getElementById('amazonSettingsModal');
  if (modal) modal.style.display = 'none';
}

function saveAmazonSettings() {
  const url = (document.getElementById('amazonSettingsListUrl')?.value || '').trim();
  const name = (document.getElementById('amazonSettingsListName')?.value || '').trim();
  const tag = (document.getElementById('amazonSettingsTag')?.value || '').trim();
  // Amazonリストの保存
  localStorage.setItem(AMAZON_LIST_URL_KEY, url);
  localStorage.setItem(AMAZON_LIST_NAME_KEY, name);
  // アフィリエイトタグの保存
  setAffiliateTag(tag);
  // Yomuタブのリスト表示も更新
  loadAmazonListUrl();
  const statusEl = document.getElementById('amazonSettingsStatus');
  if (statusEl) {
    statusEl.textContent = '保存しました';
    statusEl.style.color = 'var(--success)';
    setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2000);
  }
}

document.getElementById('menuAmazonSettings')?.addEventListener('click', () => {
  document.getElementById('hamburgerMenu')?.classList.remove('open');
  openAmazonSettingsModal();
});
document.getElementById('amazonSettingsClose')?.addEventListener('click', closeAmazonSettingsModal);
document.getElementById('amazonSettingsCancelBtn')?.addEventListener('click', closeAmazonSettingsModal);
document.getElementById('amazonSettingsSaveBtn')?.addEventListener('click', saveAmazonSettings);
document.getElementById('amazonSettingsModal')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeAmazonSettingsModal();
});
document.getElementById('menuMessages')?.addEventListener('click', openMessagesFromMenu);
document.querySelectorAll('[data-help-url]').forEach((el) => {
  el.addEventListener('click', () => {
    const url = el.getAttribute('data-help-url');
    const title = el.getAttribute('data-help-title') || 'ヘルプ';
    document.getElementById('hamburgerMenu')?.classList.remove('open');
    document.getElementById('helpModalTitle').textContent = title;
    document.getElementById('helpModalIframe').src = url;
    document.getElementById('helpModal').classList.add('open');
  });
});
document.getElementById('helpModalClose')?.addEventListener('click', () => {
  document.getElementById('helpModal').classList.remove('open');
  document.getElementById('helpModalIframe').src = 'about:blank';
});
document.getElementById('helpModal')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) {
    document.getElementById('helpModal').classList.remove('open');
    document.getElementById('helpModalIframe').src = 'about:blank';
  }
});
window.addEventListener('message', (e) => {
  if (e.data === 'yondaCloseHelpModal') {
    document.getElementById('helpModal')?.classList.remove('open');
    document.getElementById('helpModalIframe').src = 'about:blank';
  }
});
document.getElementById('settingsModalClose')?.addEventListener('click', closeSettingsModal);
document.getElementById('settingsModal')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeSettingsModal();
});
document.getElementById('settingsSaveBtn')?.addEventListener('click', saveSettings);
document.getElementById('saAddCustomBtn')?.addEventListener('click', () => {
  const cfg = getSearchAppsConfig();
  const newIdx = (document.querySelectorAll('#saCustomList .sa-custom-row').length);
  _renderCustomAppRow({ label: '', url: '', enabled: true }, newIdx);
});
document.getElementById('affiliateTagToggle')?.addEventListener('click', () => {
  const section = document.getElementById('affiliateTagSection');
  if (section) section.style.display = section.style.display === 'none' ? 'block' : 'none';
});
document.getElementById('credentialModalClose')?.addEventListener('click', closeCredentialModal);
document.getElementById('credentialModal')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeCredentialModal();
});
document.getElementById('credLibrarySelect')?.addEventListener('change', loadCredentialForModal);
document.getElementById('credTestSaveBtn')?.addEventListener('click', testAndSaveCredentials);
document.getElementById('credFetchBtn')?.addEventListener('click', () => {
  const libraryId = document.getElementById('credLibrarySelect').value;
  document.getElementById('librarySelect').value = libraryId;
  closeCredentialModal();
  fetchFromLibrary();
});
document.getElementById('credOtpSubmitBtn')?.addEventListener('click', submitKindleOtp);
document.getElementById('credOtpCancelBtn')?.addEventListener('click', () => {
  document.getElementById('credOtpFields').style.display = 'none';
  document.getElementById('credCredentialFields').style.display = '';
  document.getElementById('credTestSaveBtn').style.display = '';
  document.getElementById('credModalStatus').textContent = '';
  _kindleOtpSessionId = null;
});
document.getElementById('credOtp')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitKindleOtp();
});
document.getElementById('credDeleteBtn')?.addEventListener('click', deleteCredentials);
document.getElementById('credDownloadBtn')?.addEventListener('click', async function () {
  const libraryId = document.getElementById('credLibrarySelect').value;
  const statusEl = document.getElementById('credModalStatus');
  statusEl.className = 'modal-status loading';
  statusEl.textContent = 'ダウンロード中…';
  try {
    const res = await fetch(`${API.download}/${libraryId}`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const nameMap = { setagaya: 'library_books.json', audible_jp: 'audible_books.json', kindle: 'kindle_books.json' };
    a.href = url;
    a.download = nameMap[libraryId] || `${libraryId}_books.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    statusEl.className = 'modal-status success';
    statusEl.textContent = 'ダウンロードしました。';
  } catch (err) {
    statusEl.className = 'modal-status error';
    statusEl.textContent = err.message || 'ダウンロードに失敗しました。';
  }
});

document.getElementById('credAudibleUploadBtn')?.addEventListener('click', async function () {
  const fileInput = document.getElementById('credAudibleFile');
  const statusEl = document.getElementById('credModalStatus');
  if (!fileInput?.files?.length) {
    statusEl.className = 'modal-status error';
    statusEl.textContent = 'auth_jp.json ファイルを選択してください。';
    return;
  }
  const file = fileInput.files[0];
  if (!file.name.toLowerCase().endsWith('.json')) {
    statusEl.className = 'modal-status error';
    statusEl.textContent = 'JSON ファイル（auth_jp.json）を選択してください。';
    return;
  }
  statusEl.className = 'modal-status loading';
  statusEl.textContent = 'アップロード中…';
  try {
    const formData = new FormData();
    formData.append('auth_file', file);
    const res = await fetch(API.credentialsAudibleUpload, {
      method: 'POST',
      body: formData,
    });
    const data = await res.json().catch(() => ({}));
    if (data.success) {
      statusEl.className = 'modal-status success';
      statusEl.textContent = data.message || '保存しました。';
      updateCredentialStatus();
      fileInput.value = '';
    } else {
      statusEl.className = 'modal-status error';
      statusEl.textContent = data.error || 'アップロードに失敗しました。';
    }
  } catch (err) {
    statusEl.className = 'modal-status error';
    statusEl.textContent = '通信エラー: ' + err.message;
  }
});

document.getElementById('credAudibleTestBtn')?.addEventListener('click', async function () {
  const statusEl = document.getElementById('credModalStatus');
  statusEl.className = 'modal-status loading';
  statusEl.textContent = '接続確認中…';
  try {
    const res = await fetch(API.testLogin, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ library_id: 'audible_jp', user_id: '', password: '' }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.success) {
      statusEl.className = 'modal-status success';
      statusEl.textContent = '接続成功！auth_jp.json が正しく設定されています。';
      updateCredentialStatus();
    } else {
      statusEl.className = 'modal-status error';
      statusEl.textContent = data.error || '接続に失敗しました。auth_jp.json をアップロードするか、data/ に配置してください。';
    }
  } catch (err) {
    statusEl.className = 'modal-status error';
    statusEl.textContent = '通信エラー: ' + err.message;
  }
});

document.getElementById('fetchOtpModalClose')?.addEventListener('click', closeFetchOtpModal);
document.getElementById('fetchOtpModal')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeFetchOtpModal();
});
document.getElementById('fetchOtpCancelBtn')?.addEventListener('click', closeFetchOtpModal);
document.getElementById('fetchOtpSubmitBtn')?.addEventListener('click', submitFetchOtp);
document.getElementById('fetchOtpInput')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitFetchOtp();
});

document.getElementById('bookDetailClose')?.addEventListener('click', closeBookDetail);
document.getElementById('bookDetailModal')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeBookDetail();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.getElementById('bookDetailModal')?.classList.contains('open')) {
    closeBookDetail();
  }
  if (e.key === 'Escape' && document.getElementById('paperBookEditModal')?.classList.contains('open')) {
    closePaperBookEdit();
  }
});

// 紙の本 追加確認モーダル イベントリスナー
document.getElementById('paperAddConfirmClose')?.addEventListener('click', closePaperAddConfirm);
document.getElementById('paperAddConfirmModal')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closePaperAddConfirm();
});
document.getElementById('paperConfirmCancelBtn')?.addEventListener('click', closePaperAddConfirm);
document.getElementById('paperConfirmSaveBtn')?.addEventListener('click', _submitPaperBookAdd);
document.getElementById('paperConfirmStars')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.paper-star-btn');
  if (!btn) return;
  const v = parseInt(btn.dataset.value, 10);
  document.getElementById('paperConfirmRating').value = v;
  _setPaperConfirmStars(v);
});
document.getElementById('paperConfirmStarClear')?.addEventListener('click', () => {
  document.getElementById('paperConfirmRating').value = '';
  _setPaperConfirmStars(0);
});

// 紙の本 編集モーダル イベントリスナー
document.getElementById('paperBookEditClose')?.addEventListener('click', closePaperBookEdit);
document.getElementById('paperBookEditModal')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closePaperBookEdit();
});
document.getElementById('paperEditCancelBtn')?.addEventListener('click', closePaperBookEdit);
document.getElementById('paperEditSaveBtn')?.addEventListener('click', savePaperBookEdit);
document.getElementById('paperEditDeleteBtn')?.addEventListener('click', () => {
  if (_paperEditBook) confirmDeletePaperBook(_paperEditBook);
});
document.getElementById('paperEditStatus')?.addEventListener('change', function() {
  _toggleCompletedDateField(this.value);
});
// 評価星ボタン
document.getElementById('paperEditStars')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.paper-star-btn');
  if (!btn) return;
  const v = parseInt(btn.dataset.value, 10);
  document.getElementById('paperEditRating').value = v;
  _setPaperEditStars(v);
});
document.getElementById('paperEditStarClear')?.addEventListener('click', () => {
  document.getElementById('paperEditRating').value = '';
  _setPaperEditStars(0);
});
// 表紙ファイル選択のプレビュー
document.getElementById('paperEditCoverFile')?.addEventListener('change', function() {
  if (this.files && this.files[0]) {
    const reader = new FileReader();
    reader.onload = (e) => {
      document.getElementById('paperEditCoverImg').src = e.target.result;
      document.getElementById('paperEditCoverUrl').value = '';
      document.getElementById('paperEditCoverUrl').style.display = 'none';
      const lbl = document.getElementById('paperEditCoverFileLabel');
      if (lbl) lbl.style.display = '';
    };
    reader.readAsDataURL(this.files[0]);
  }
});
// URL入力時のプレビュー
document.getElementById('paperEditCoverUrl')?.addEventListener('blur', function() {
  if (this.value.trim()) {
    document.getElementById('paperEditCoverImg').src = this.value.trim();
  }
});
document.getElementById('bookInsightGenerateBtn')?.addEventListener('click', () => generateBookInsight());
document.getElementById('bookInsightEditBtn')?.addEventListener('click', showBookInsightForm);

document.getElementById('bookList')?.addEventListener('change', (e) => {
});

document.getElementById('bookList')?.addEventListener('click', (e) => {
  const reviewLink = e.target.closest('.btn-review-insight-table');
  if (reviewLink) {
    e.stopPropagation();
    return;
  }

  // ソースバッジクリック → ソースフィルター適用
  const srcBadgeEl = e.target.closest('[data-filter-source]');
  if (srcBadgeEl && (srcBadgeEl.classList.contains('badge-source') || srcBadgeEl.classList.contains('badge-completed') || srcBadgeEl.classList.contains('badge-short'))) {
    e.stopPropagation();
    e.preventDefault();
    const src = srcBadgeEl.getAttribute('data-filter-source');
    const sel = document.getElementById('sourceFilter');
    if (sel) {
      sel.value = (sel.value === src) ? 'all' : src;
      applyFilters();
    }
    return;
  }

  // ジャンルバッジクリック → ジャンルフィルター適用
  const genreBadgeEl = e.target.closest('[data-filter-genre]');
  if (genreBadgeEl) {
    e.stopPropagation();
    e.preventDefault();
    const genre = genreBadgeEl.getAttribute('data-filter-genre');
    const sel = document.getElementById('genreFilter');
    if (sel) {
      sel.value = (sel.value === genre) ? 'all' : genre;
      applyFilters();
    }
    return;
  }

  const copyBtn = e.target.closest('.btn-copy-insight-table');
  if (copyBtn) {
    e.preventDefault();
    e.stopPropagation();
    const idx = parseInt(copyBtn.getAttribute('data-book-index'), 10);
    if (!isNaN(idx) && allBooks[idx]) {
      const insight = findBookInsight(allBooks[idx]);
      copyBookInsightText(insight, copyBtn);
    }
    return;
  }

  const aiBtn = e.target.closest('.btn-table-ai-insight');
  if (aiBtn) {
    e.preventDefault();
    e.stopPropagation();
    const idx = parseInt(aiBtn.getAttribute('data-book-index'), 10);
    if (!isNaN(idx) && allBooks[idx]) {
      generateBookInsight(allBooks[idx], { tableButton: aiBtn });
    }
    return;
  }

  const th = e.target.closest('.th-sortable');
  if (th) {
    e.preventDefault();
    const sortAsc = th.getAttribute('data-sort-asc');
    const sortDesc = th.getAttribute('data-sort-desc');
    const current = document.getElementById('sortSelect').value;
    const next = current === sortDesc ? sortAsc : sortDesc;
    document.getElementById('sortSelect').value = next;
    applyFilters();
    return;
  }
  const card = e.target.closest('.book-card-clickable');
  const row = e.target.closest('.book-row-clickable');
  const el = card || row;
  if (el && window._currentPageBooks) {
    const i = parseInt(el.getAttribute('data-book-index'), 10);
    if (!isNaN(i) && window._currentPageBooks[i]) {
      e.preventDefault();
      openBookDetail(window._currentPageBooks[i]);
    }
  }
});
document.getElementById('bookList')?.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const el = e.target.closest('.book-card-clickable, .book-row-clickable');
  if (el && window._currentPageBooks) {
    const i = parseInt(el.getAttribute('data-book-index'), 10);
    if (!isNaN(i) && window._currentPageBooks[i]) {
      e.preventDefault();
      openBookDetail(window._currentPageBooks[i]);
    }
  }
});

document.querySelectorAll('.header-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const tabVal = tab.dataset.mainTab;
    if (tabVal === activeMainTab && tabVal !== 'yonda') return;
    activeMainTab = tabVal;
    document.getElementById('hamburgerMenu')?.classList.remove('open');
    document.getElementById('filterMenuPanel')?.classList.remove('open');
    // 未ログイン時の案内バナー表示制御
    const notLoggedIn = _oauthEnabled && !_authUser;
    ['loginNoticeYomu', 'loginNoticeOshi'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    // headerWelcomeBanner は Yonda タブのみ表示
    const wb = document.getElementById('headerWelcomeBanner');
    if (wb) wb.style.display = notLoggedIn && tabVal === 'yonda' ? '' : 'none';
    if (notLoggedIn && tabVal === 'yomu') {
      const el = document.getElementById('loginNoticeYomu');
      if (el) el.style.display = '';
      // AI推し（旧Oshi）セクションの案内もYomu内に表示
      const oshiNotice = document.getElementById('loginNoticeOshi');
      if (oshiNotice) oshiNotice.style.display = '';
    }
    if (tabVal === 'yonda') {
      document.getElementById('sourceFilter').value = 'all';
      document.getElementById('genreFilter').value = 'all';
      document.getElementById('ratingFilter').value = 'completed';
      document.getElementById('sortSelect').value = 'completed_date_desc';
      activeBookTab = 'read';
      document.querySelectorAll('.book-tab').forEach(t => t.classList.remove('active'));
      document.getElementById('tabRead')?.classList.add('active');
      updateBookTabLabels();
      applyFilters();
    }
    updateMainTabVisibility();
    showFilters();
    window.scrollTo(0, 0);
  });
});

document.getElementById('statWeekly')?.addEventListener('click', (e) => {
  e.preventDefault();
  activeMainTab = 'yonda';
  activeBookTab = 'read';
  document.getElementById('ratingFilter').value = 'weekly_completed';
  document.getElementById('sortSelect').value = 'completed_date_desc';
  document.querySelectorAll('.book-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tabRead')?.classList.add('active');
  updateBookTabLabels();
  updateMainTabVisibility();
  applyFilters();
  window.scrollTo(0, 0);
});
document.getElementById('statRated')?.addEventListener('click', (e) => {
  e.preventDefault();
  // 新規更新バッジがあればメッセージへ、なければ読了リストへ
  const latestNewCount = yondaMessages.length > 0
    ? (yondaMessages[0].sync_summary?.new_completed_count || yondaMessages[0].books?.length || 0)
    : 0;
  if (latestNewCount > 0) {
    openMessagesFromMenu();
    return;
  }
  activeMainTab = 'yonda';
  activeBookTab = 'read';
  document.getElementById('ratingFilter').value = 'completed';
  document.querySelectorAll('.book-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tabRead')?.classList.add('active');
  updateBookTabLabels();
  updateMainTabVisibility();
  applyFilters();
});
document.getElementById('statTsundoku')?.addEventListener('click', (e) => {
  e.preventDefault();
  activeMainTab = 'yonda';
  activeBookTab = 'read';
  document.getElementById('ratingFilter').value = 'in_progress';
  document.querySelectorAll('.book-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tabRead')?.classList.add('active');
  updateBookTabLabels();
  updateMainTabVisibility();
  applyFilters();
});
document.getElementById('statFavorite')?.addEventListener('click', (e) => {
  e.preventDefault();
  activeMainTab = 'yonda';
  activeBookTab = 'read';
  document.getElementById('ratingFilter').value = 'favorite';
  document.querySelectorAll('.book-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tabRead')?.classList.add('active');
  updateBookTabLabels();
  updateMainTabVisibility();
  applyFilters();
});

/* --- Init --- */

async function init() {
  // まず認証状態を確認（UIの表示制御のため最初に実行）
  await initAuth();

  // 全ユーザーの読了統計を常時ロード（未ログイン時もヘッダーに表示）
  loadPublicUserStats();

  // 未ログインかつ OAuth 有効の場合は書籍データ読み込みをスキップ
  if (_oauthEnabled && !_authUser) {
    renderCommunitySection();
    return;
  }

  activeMainTab = getDefaultPage();

  try {
    // ライブラリ一覧と書籍データを並列取得
    const [libRes] = await Promise.all([
      fetch(API.libraries),
      loadFromFile(),
    ]);
    const libData = await libRes.json();
    const sel = document.getElementById('librarySelect');
    if (sel && libData.success && libData.libraries && libData.libraries.length > 0) {
      sel.innerHTML = libData.libraries.map(l =>
        `<option value="${escapeHtml(l.id)}">${escapeHtml(l.name)}${l.configured ? '' : '（未設定）'}</option>`
      ).join('');
    }
  } catch (_) {}
  if (document.getElementById('menuSourceLink')) updateMenuSourceLink();
  if (document.getElementById('menuCredStatus')) updateCredentialStatus();

  updateMainTabVisibility();
  loadAmazonList();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
