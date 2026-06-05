/* --- yonda frontend --- */

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
};

let allBooks = [];
let filteredBooks = [];
let currentPage = 0;
let activeMainTab = 'yonda'; // 'yonda' | 'yomu' | 'oshi'
let activeBookTab = 'read'; // 'read' = 読んだ/途中, 'ranking' = ランキング, 'recommend' = オススメ, 'messages' = メッセージ
let monthlyChart = null;
let genreChart = null;
let currentDetailBook = null;
let bookInsightsCache = {};
let yondaMessages = [];
let archivedMessages = [];
let messageBookRefs = [];
let messageInsightRefs = [];
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

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

function escapeAttr(text) {
  return escapeHtml(text).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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

/** Audible の表示用評価: 総合評価(catalog_rating)を優先、なければ自分の評価(rating) */
function displayRating(book) {
  if (book.source === 'audible_jp' && (book.catalog_rating || 0) > 0) {
    return book.catalog_rating;
  }
  return book.rating || 0;
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

/** 正規化した検索語がテキストに含まれるか */
function matchesSearch(normalizedQuery, text) {
  if (!normalizedQuery) return true;
  const n = normalizeForSearch(text);
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
function getTsundokuDays(book) {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const endStr = (book.completed_date || '').trim().substring(0, 10) || todayStr;
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

/** タイトル横に表示する補足: 評価・コメントがあればそれ、なければ概要サマリー */
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

const AUDIBLE_LIBRARY_URL = 'https://www.audible.co.jp/library/audiobooks';

/** Audible 評価リンク用URL（レビュー入力ページ or ライブラリトップ） */
function getAudibleRatingUrl(book) {
  if (book.catalog_number) {
    return `https://www.audible.co.jp/write-review?asin=${encodeURIComponent(book.catalog_number)}`;
  }
  return AUDIBLE_LIBRARY_URL;
}

const SOURCE_LABELS = { setagaya: '図書館', audible_jp: 'Audible', kindle: 'Kindle' };
function sourceLabel(source) { return SOURCE_LABELS[source] || source || ''; }

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
      body: JSON.stringify({ library_id: sourceId })
    });

    const data = await response.json();

    if (data.success) {
      showToast(`${sourceId}の取得が完了しました`, 'success');
      // データを再読み込み
      if (typeof loadBooks === 'function') await loadBooks();
      await loadMessages();
    } else if (data.needs_otp) {
      // Kindle OTP が必要な場合
      const otp = prompt('Kindle の2段階認証コード（OTP）を入力してください:');
      if (otp) {
        const otpResponse = await fetch('/api/fetch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            library_id: 'kindle',
            session_id: data.session_id,
            otp: otp
          })
        });
        const otpData = await otpResponse.json();
        if (otpData.success) {
          showToast('Kindleの取得が完了しました', 'success');
          if (typeof loadBooks === 'function') await loadBooks();
          await loadMessages();
        } else {
          showToast(`エラー: ${otpData.error || '取得に失敗しました'}`, 'error');
        }
      }
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

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toast.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);' +
    'background:#333;color:#fff;padding:12px 24px;border-radius:8px;z-index:10000;' +
    'box-shadow:0 4px 12px rgba(0,0,0,0.3);animation:slideUp 0.3s ease;';
  if (type === 'success') toast.style.background = '#4caf50';
  if (type === 'error') toast.style.background = '#f44336';
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'slideDown 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

const AFFILIATE_TAG_KEY = 'yonda_affiliate_tag';
const DEFAULT_AFFILIATE_TAG = 'ktrip-22';
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
    if (v && ['yonda', 'yomu', 'oshi'].includes(v)) return v;
  } catch (_) {}
  return DEFAULT_PAGE;
}

function setDefaultPage(page) {
  try {
    if (page && ['yonda', 'yomu', 'oshi'].includes(page)) {
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

/** ランキング用: 特定ジャンルを「ライフ」にまとめる */
const LIFESTYLE_GENRES = [
  '絵本・児童書', '教育・学習', 'LGBT', 'ティーン', 'ホーム・ガーデン', 'スポーツ・アウトドア',
  'コメディー・落語', '旅行・観光', '官能・ロマンス', '衛生・健康', 'エンターテインメント・アート',
  '宗教・スピリチュアル',
];
/** ランキング用: 特定ジャンルを「ビジネス・キャリア」にまとめる */
const BUSINESS_CAREER_GENRES = ['資産・金融'];
/** ランキング用: 特定ジャンルを「コンピュータ・テクノロジー」にまとめる */
const COMPUTER_TECHNOLOGY_GENRES = ['SF・ファンタジー'];
function displayGenre(genre) {
  const pg = primaryGenre(genre) || 'その他';
  if (LIFESTYLE_GENRES.includes(pg)) return 'ライフ';
  if (BUSINESS_CAREER_GENRES.includes(pg)) return 'ビジネス・キャリア';
  if (COMPUTER_TECHNOLOGY_GENRES.includes(pg)) return 'コンピュータ・テクノロジー';
  return pg;
}
function rankingGenre(genre) {
  return displayGenre(genre);
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
  const disp = displayGenre(book.genre || '');
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

  try {
    const res = await fetch(API.books);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'データなし');
    allBooks = data.books || [];
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

function updateStats() {
  const year = new Date().getFullYear();
  const completed = allBooks.filter(b => b.completed).length;
  const inProgress = allBooks.filter(b => isInProgress(b)).length;
  const yearlyCompleted = allBooks.filter(b =>
    b.completed && b.completed_date && b.completed_date.startsWith(String(year))
  ).length;
  const favorite = allBooks.filter(b => b.favorite).length;

  // 最新メッセージに新規読了があればヘッダー読了数に (N) を追加
  const latestNewCount = yondaMessages.length > 0
    ? (yondaMessages[0].sync_summary?.new_completed_count || yondaMessages[0].books?.length || 0)
    : 0;
  const ratedEl = document.getElementById('statRatedVal');
  if (ratedEl) {
    ratedEl.innerHTML = latestNewCount > 0
      ? `${completed}<span class="stat-new-badge" id="statNewBadge">(${latestNewCount})</span>`
      : String(completed);
  }

  document.getElementById('statTsundokuVal').textContent = inProgress;
  document.getElementById('statYearlyVal').textContent = yearlyCompleted;
  document.getElementById('statYearlyLabel').textContent = year + '年';
  document.getElementById('statFavoriteVal').textContent = favorite;
  updateBookTabLabels();
}

function loadReadMessageIds() {
  try {
    const raw = localStorage.getItem(READ_MESSAGES_STORAGE_KEY);
    const ids = JSON.parse(raw || '[]');
    return new Set(Array.isArray(ids) ? ids : []);
  } catch (_) {
    return new Set();
  }
}

function saveReadMessageIds(ids) {
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

function updateBookTabLabels() {
  const readCount = allBooks.filter(b => b.completed).length;
  const inProgressCount = allBooks.filter(b => isInProgress(b)).length;
  const unreadCount = allBooks.filter(b => isUnread(b)).length;
  const year = new Date().getFullYear();
  const yearlyCount = allBooks.filter(b =>
    b.completed && b.completed_date && b.completed_date.startsWith(String(year))
  ).length;
  const favoriteCount = allBooks.filter(b => b.favorite).length;
  const allCount = allBooks.length;
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
    else if (rating === 'yearly_completed') label = `${year}年（${yearlyCount}）`;
    else if (rating === 'favorite') label = `お気に入り（${favoriteCount}）`;
    else if (rating === 'all') label = `すべて（全${allCount}冊）`;
    else if (rating === '5') label = `★★★★★（${allBooks.filter(b => (displayRating(b) || 0) >= 5).length}）`;
    else if (rating === '4') label = `★★★★☆以上（${allBooks.filter(b => (displayRating(b) || 0) >= 4).length}）`;
    else if (rating === '3') label = `★★★☆☆以上（${allBooks.filter(b => (displayRating(b) || 0) >= 3).length}）`;
    else {
      const sel = document.getElementById('ratingFilter');
      const optText = sel?.selectedOptions?.[0]?.textContent || '読んだ';
      label = `${optText}（${allCount}）`;
    }
    tabRead.textContent = label;
  }
  if (tabRanking) tabRanking.textContent = 'ランキング';
  if (tabRecommend) tabRecommend.textContent = 'オススメ';
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
  updateTabContentVisibility();
  updateMainTabVisibility();
}

function updateMainTabVisibility() {
  document.querySelectorAll('.main-content').forEach(el => { el.style.display = 'none'; });
  const yonda = document.getElementById('mainContentYonda');
  const yomu = document.getElementById('mainContentYomu');
  const oshi = document.getElementById('mainContentOshi');
  if (activeMainTab === 'yonda' && yonda) yonda.style.display = 'block';
  else if (activeMainTab === 'yomu' && yomu) {
    yomu.style.display = 'block';
    renderBookSearchResults();
    renderTagAnalytics();
  } else if (activeMainTab === 'oshi' && oshi) {
    oshi.style.display = 'block';
    initAiRecommendIfNeeded();
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
  const recommendSection = document.getElementById('recommendSection');
  const messagesSection = document.getElementById('messagesSection');
  if (activeBookTab === 'ranking') {
    if (bookList) bookList.style.display = 'none';
    if (pagination) pagination.style.display = 'none';
    if (recommendSection) recommendSection.style.display = 'none';
    if (messagesSection) messagesSection.style.display = 'none';
    if (rankingSection) {
      rankingSection.style.display = 'block';
      renderRanking();
    }
  } else if (activeBookTab === 'recommend') {
    if (bookList) bookList.style.display = 'none';
    if (pagination) pagination.style.display = 'none';
    if (rankingSection) rankingSection.style.display = 'none';
    if (messagesSection) messagesSection.style.display = 'none';
    if (recommendSection) {
      recommendSection.style.display = 'block';
      showRecommendInitialState();
    }
  } else if (activeBookTab === 'messages') {
    if (bookList) bookList.style.display = 'none';
    if (pagination) pagination.style.display = 'none';
    if (rankingSection) rankingSection.style.display = 'none';
    if (recommendSection) recommendSection.style.display = 'none';
    if (messagesSection) {
      messagesSection.style.display = 'block';
      renderMessages();
    }
  } else {
    if (rankingSection) rankingSection.style.display = 'none';
    if (recommendSection) recommendSection.style.display = 'none';
    if (messagesSection) messagesSection.style.display = 'none';
    // bookList / pagination は renderBooks で表示制御
  }
}

function populateSourceFilter(sources) {
  const sel = document.getElementById('sourceFilter');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="all">すべて</option>';
  if (sources && sources.length > 0) {
    for (const s of sources) {
      const label = sourceLabel(s.library_id);
      sel.innerHTML += `<option value="${escapeHtml(s.library_id)}">${escapeHtml(label)}（${s.total}冊）</option>`;
    }
  } else {
    const ids = [...new Set(allBooks.map(b => b.source).filter(Boolean))];
    for (const id of ids) {
      sel.innerHTML += `<option value="${escapeHtml(id)}">${escapeHtml(sourceLabel(id))}</option>`;
    }
  }
  if ([...sel.options].some(o => o.value === current)) sel.value = current;
}

function populateGenreFilter() {
  const sel = document.getElementById('genreFilter');
  if (!sel) return;
  const current = sel.value;
  const genreCount = {};
  for (const b of allBooks) {
    const g = displayGenre(b.genre) || 'その他';
    genreCount[g] = (genreCount[g] || 0) + 1;
  }
  const sorted = Object.entries(genreCount)
    .sort((a, b) => b[1] - a[1]);
  sel.innerHTML = '<option value="all">すべて</option>';
  for (const [g, cnt] of sorted) {
    sel.innerHTML += `<option value="${escapeHtml(g)}">${escapeHtml(g)}（${cnt}）</option>`;
  }
  if ([...sel.options].some(o => o.value === current)) sel.value = current;
}

function populateRankingFilters() {
  const yearSel = document.getElementById('rankingYearFilter');
  if (!yearSel) return;
  const completed = allBooks.filter(b => b.completed && (displayRating(b) || 0) > 0);
  const years = [...new Set(completed.map(b => (b.completed_date || '').slice(0, 4)).filter(Boolean))].sort().reverse();
  const yearCurrent = yearSel.value;
  yearSel.innerHTML = '<option value="all">全期間</option>';
  for (const y of years) {
    const cnt = completed.filter(b => (b.completed_date || '').startsWith(y)).length;
    yearSel.innerHTML += `<option value="${escapeHtml(y)}">${escapeHtml(y)}年（${cnt}冊）</option>`;
  }
  if ([...yearSel.options].some(o => o.value === yearCurrent)) yearSel.value = yearCurrent;
}

/** ランキング得点: Audibleのカタログ評価を最優先し、お気に入りを加点 */
function rankingScore(book) {
  const favoriteBonus = book.favorite ? 10 : 0;
  if (book.source === 'audible_jp' && (book.catalog_rating || 0) > 0) {
    return 1000 + (book.catalog_rating * 10) + favoriteBonus;
  }
  const stars = displayRating(book) || 0;
  return stars * 10 + favoriteBonus;
}

function getRankingByGenre() {
  let books = allBooks.filter(b => b.completed && (displayRating(b) || 0) > 0);
  const year = document.getElementById('rankingYearFilter')?.value;
  if (year && year !== 'all') {
    books = books.filter(b => (b.completed_date || '').startsWith(year));
  }
  const byGenre = {};
  for (const b of books) {
    const g = rankingGenre(b.genre) || 'その他';
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
    <div class="ranking-item book-card-clickable" data-book-index="${allBooks.indexOf(book)}" role="button" tabindex="0">
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
      const idx = allBooks.indexOf(b);
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
  if (activeBookTab === 'ranking' || activeBookTab === 'messages') {
    updateTabContentVisibility();
    return;
  }
  if (activeBookTab === 'recommend') {
    updateTabContentVisibility();
    return;
  }

  const searchRaw = (document.getElementById('searchInputYonda')?.value || '').trim();
  const searchNorm = normalizeForSearch(searchRaw);
  const source = document.getElementById('sourceFilter').value;
  const genre = document.getElementById('genreFilter').value;
  const rating = document.getElementById('ratingFilter').value;

  let books = [...allBooks];

  if (searchNorm) {
    books = books.filter(b =>
      matchesSearch(searchNorm, b.title) ||
      matchesSearch(searchNorm, b.author) ||
      matchesSearch(searchNorm, b.comment)
    );
  }
  if (source !== 'all') {
    books = books.filter(b => b.source === source);
  }
  if (genre !== 'all') {
    books = books.filter(b => (displayGenre(b.genre) || 'その他') === genre);
  }
  if (rating === 'completed') {
    books = books.filter(b => b.completed);
  } else if (rating === 'in_progress') {
    books = books.filter(b => isInProgress(b));
  } else if (rating === 'yearly_completed') {
    const year = new Date().getFullYear();
    books = books.filter(b =>
      b.completed && b.completed_date && b.completed_date.startsWith(String(year))
    );
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
    inputEl.value = searchText;
    const modelLabel = window._lastAiExtractModel || (window._lastAiExtractProvider === 'gemini' ? 'Gemini' : (window._lastAiExtractProvider === 'openai' ? 'OpenAI' : ''));
    const statusSuffix = modelLabel ? ` (${modelLabel})` : '';
    setStatus('検索しました: ' + searchText.substring(0, 30) + (searchText.length > 30 ? '…' : '') + statusSuffix);
    renderBookSearchResults();
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
  if (asin) return `https://www.amazon.co.jp/wishlist/add-item?ASIN.1=${encodeURIComponent(asin)}`;
  const q = encodeURIComponent(`${title} ${author}`.trim());
  return `https://www.amazon.co.jp/s?k=${q}`;
}

function getAmazonProductUrl(asin, title, author) {
  if (asin) return `https://www.amazon.co.jp/dp/${encodeURIComponent(asin)}`;
  const q = encodeURIComponent(`${title} ${author}`.trim());
  return `https://www.amazon.co.jp/s?k=${q}`;
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
    itemsEl.innerHTML = '<p class="amazon-list-empty">検索結果の「+ Amazonリスト」から本を追加できます</p>';
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
  const urlInput = document.getElementById('amazonListUrl');
  const nameInput = document.getElementById('amazonListName');
  if (urlInput) urlInput.value = url;
  if (nameInput) nameInput.value = name;
  _updateAmazonListRegisteredView(url, name);
}

function _updateAmazonListRegisteredView(url, name) {
  const registered = document.getElementById('amazonListRegistered');
  const form = document.getElementById('amazonListUrlForm');
  const link = document.getElementById('amazonListRegisteredLink');
  if (!registered || !form) return;

  if (url) {
    registered.style.display = 'flex';
    form.style.display = 'none';
    if (link) {
      link.href = url;
      link.textContent = name || url;
    }
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
  const saveBtn = document.getElementById('amazonListUrlSaveBtn');
  if (saveBtn) saveBtn.addEventListener('click', saveAmazonListUrl);

  const urlInput = document.getElementById('amazonListUrl');
  if (urlInput) urlInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') saveAmazonListUrl();
  });

  const editBtn = document.getElementById('amazonListUrlEditBtn');
  if (editBtn) editBtn.addEventListener('click', function() {
    const registered = document.getElementById('amazonListRegistered');
    const form = document.getElementById('amazonListUrlForm');
    if (registered) registered.style.display = 'none';
    if (form) form.style.display = 'block';
    if (urlInput) urlInput.focus();
  });

  loadAmazonListUrl();
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
    if (saved && ['5questions', 'mbti', 'strength'].includes(saved)) {
      aiRecommendMode = saved;
      setAiRecommendMode(saved);
    } else {
      setAiRecommendMode(aiRecommendMode);
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
    const params = new URLSearchParams({ q });
    if (title) params.set('title', title);
    if (author) params.set('author', author);
    fetch(`${API.bookInfo}?${params}`)
      .then(r => r.json())
      .then(data => {
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

/** ソース・状態・ジャンルでフィルタした本リスト（チャート用。検索・並べ替えは含まない） */
function getBooksForChart() {
  const source = document.getElementById('sourceFilter')?.value || 'all';
  const genre = document.getElementById('genreFilter')?.value || 'all';
  const rating = document.getElementById('ratingFilter')?.value || 'all';
  let books = [...allBooks];
  if (source !== 'all') books = books.filter(b => b.source === source);
  if (genre !== 'all') books = books.filter(b => (displayGenre(b.genre) || 'その他') === genre);
  if (rating === 'completed') books = books.filter(b => b.completed);
  else if (rating === 'in_progress') books = books.filter(b => isInProgress(b));
  else if (rating === 'yearly_completed') {
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
  const runtimeMonthMap = {};
  const useRuntime = chartMode === 'runtime';
  const books = getBooksForChart();
  for (const b of books) {
    const d = b.loan_date || '';
    const runtime = (b.runtime_length_min || 0) | 0;
    if (d.length >= 7) {
      const ym = d.substring(0, 7);
      if (!monthMap[ym]) monthMap[ym] = { library: 0, audible: 0 };
      if (!runtimeMonthMap[ym]) runtimeMonthMap[ym] = 0;
      if (b.source === 'audible_jp') {
        monthMap[ym].audible++;
        if (useRuntime && b.completed && runtime > 0) {
          const compYm = (b.completed_date || '').substring(0, 7);
          if (compYm.length >= 7) {
            runtimeMonthMap[compYm] = (runtimeMonthMap[compYm] || 0) + runtime;
          }
        }
      } else if (b.source === 'setagaya') {
        monthMap[ym].library++;
        if (useRuntime && b.completed && runtime > 0) {
          const compYm = (b.completed_date || '').substring(0, 7);
          if (compYm.length >= 7) {
            runtimeMonthMap[compYm] = (runtimeMonthMap[compYm] || 0) + runtime;
          }
        }
      } else {
        monthMap[ym].library++;
      }
    }
    if (b.completed && b.completed_date && b.completed_date.length >= 7) {
      const compYm = b.completed_date.substring(0, 7);
      compMonthMap[compYm] = (compMonthMap[compYm] || 0) + 1;
    }
  }

  const allMonths = new Set([...Object.keys(monthMap), ...Object.keys(compMonthMap), ...Object.keys(runtimeMonthMap)]);
  const labels = [...allMonths].sort();
  const last24 = labels.slice(-24);
  const libData = useRuntime ? last24.map(() => 0) : last24.map(k => (monthMap[k]?.library || 0));
  const audData = useRuntime
    ? last24.map(k => Math.round(((runtimeMonthMap[k] || 0) / 60) * 10) / 10)
    : last24.map(k => (monthMap[k]?.audible || 0));
  const compData = last24.map(k => (compMonthMap[k] || 0));
  const shortLabels = last24.map(k => {
    const [y, m] = k.split('-');
    return m === '01' ? `${y}/${m}` : m;
  });

  const ctx = document.getElementById('monthlyChart');
  if (monthlyChart) monthlyChart.destroy();

  const datasets = [
    ...(useRuntime ? [] : [{
      label: '図書館',
      data: libData,
      backgroundColor: 'rgba(107,66,38,0.65)',
      borderRadius: 2,
      barPercentage: 0.7,
    }]),
    {
      label: useRuntime ? '読了（視聴時間）' : 'Audible',
      data: audData,
      backgroundColor: 'rgba(192,94,32,0.55)',
      borderRadius: 2,
      barPercentage: 0.7,
    },
    {
      label: '読了',
      data: compData,
      type: 'line',
      borderColor: '#5a7a3a',
      backgroundColor: 'rgba(90,122,58,0.15)',
      borderWidth: 2,
      pointRadius: 2,
      pointBackgroundColor: '#5a7a3a',
      fill: true,
      tension: 0.3,
    },
  ];
  monthlyChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: shortLabels,
      datasets,
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'top',
          labels: { font: { size: 11 }, boxWidth: 12, padding: 12 },
        },
        tooltip: {
          callbacks: {
            title: (items) => {
              const idx = items[0].dataIndex;
              return last24[idx];
            },
            label: (item) => {
              const v = item.raw;
              const lbl = item.dataset.label || '';
              if (useRuntime && lbl.includes('視聴時間')) {
                const h = Math.round(v * 10) / 10;
                return `${lbl}: ${h}時間`;
              }
              if (lbl === '読了') return `${lbl}: ${v}冊`;
              return `${lbl}: ${v}${useRuntime ? '時間' : '冊'}`;
            },
          },
        },
      },
      scales: {
        x: {
          stacked: !useRuntime,
          grid: { display: false },
          ticks: { font: { size: 10 }, maxRotation: 0 },
        },
        y: {
          stacked: !useRuntime,
          beginAtZero: true,
          grid: { color: 'rgba(0,0,0,0.05)' },
          ticks: {
            font: { size: 10 },
            stepSize: useRuntime ? undefined : 10,
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
    const g = displayGenre(b.genre) || 'その他';
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
      const g = displayGenre(b.genre) || 'その他';
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
      const g = displayGenre(b.genre) || 'その他';
      if (!authorGenreCount[a]) authorGenreCount[a] = {};
      authorGenreCount[a][g] = (authorGenreCount[a][g] || 0) + 1;
    }

    const authorTotals = Object.entries(authorGenreCount)
      .map(([a, counts]) => [a, Object.values(counts).reduce((s, c) => s + c, 0)])
      .filter(([, total]) => total > 0)
      .sort((x, y) => y[1] - x[1])
      .slice(0, 10);
    const authors = authorTotals.map(([a]) => a);
    const genres = [...new Set(books.flatMap(b => [displayGenre(b.genre) || 'その他']))]
      .filter(Boolean)
      .sort((a, b) => {
        const ca = books.filter(bk => (displayGenre(bk.genre) || 'その他') === a).length;
        const cb = books.filter(bk => (displayGenre(bk.genre) || 'その他') === b).length;
        return cb - ca;
      })
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
    return;
  }

  empty.style.display = 'none';
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

  if (isCard) {
    list.className = 'book-grid';
    list.innerHTML = renderCardView(pageBooks, selectedGenre, prevBook, subGenreCounts);
  } else {
    list.className = '';
    list.innerHTML = renderTableView(pageBooks, selectedGenre, prevBook, subGenreCounts);
  }

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
  return Object.values(bookInsightsCache).find((item) =>
    (item.title || '').trim() === title && (item.author || '').trim() === author
  ) || null;
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

function renderTableInsightCell(book) {
  const insight = findBookInsight(book);
  if (!insight || !Array.isArray(insight.points) || insight.points.length === 0) {
    const idx = allBooks.indexOf(book);
    return `<button type="button" class="btn-table-ai-insight" data-book-index="${idx}">AI生成</button>`;
  }
  const idx = allBooks.indexOf(book);
  const reviewUrl = reviewUrlForBook(book);
  return `
    <div class="book-table-insight-wrap">
      <div class="book-table-insight-actions">
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
  return '';
}

function renderMessageInsight(insight, bookIndex) {
  const points = Array.isArray(insight?.points) ? insight.points : [];
  if (!points.length) {
    const errMsg = insight?.error
      ? `<span class="message-insight-error" title="${escapeAttr(insight.error)}">⚠ 生成エラー</span>`
      : '';
    return `
      <div class="message-insight-empty-row">
        ${errMsg}
        <button type="button" class="btn-table-ai-insight message-ai-generate-link" data-message-book-index="${bookIndex}">AI生成</button>
      </div>
    `;
  }
  return `
    <div class="message-insight-preview message-detail-open" data-message-book-index="${bookIndex}" role="button" tabindex="0" title="詳細で書評ポイントを確認">
      <ol class="message-insight-points">
      ${points.slice(0, 5).map(point => `
        <li>
          <strong>${escapeHtml(point.heading || 'ポイント')}</strong>
          <span>${escapeHtml(point.text || '')}</span>
        </li>
      `).join('')}
      </ol>
    </div>
  `;
}

function renderMessageInsightActions(insight, book) {
  const points = Array.isArray(insight?.points) ? insight.points : [];
  const reviewUrl = reviewUrlForBook(book);
  const insightIndex = messageInsightRefs.push(insight) - 1;
  return `
    <div class="message-insight-actions">
      ${points.length ? `<button type="button" class="btn-copy-insight btn-copy-insight-message" data-message-insight-index="${insightIndex}" title="書評ポイントをコピー" aria-label="書評ポイントをコピー">⧉</button>` : ''}
      ${reviewUrl ? `<a href="${escapeAttr(reviewUrl)}" target="_blank" rel="noopener" class="btn-review-insight btn-review-insight-message" title="レビューを書く" aria-label="レビューを書く">📖</a>` : ''}
    </div>
  `;
}

function messageId(message, idx) {
  return message.id || `${message.created_at || 'message'}-${idx}`;
}

function findBookFromMessage(book) {
  if (!book) return null;
  const source = (book.source || '').trim();
  const catalog = (book.catalog_number || book.asin || '').trim();
  if (catalog) {
    const matched = allBooks.find(b =>
      (b.source || '').trim() === source &&
      ((b.catalog_number || b.asin || '').trim() === catalog)
    );
    if (matched) return matched;
  }
  const title = (book.title || '').trim();
  const author = (book.author || '').trim();
  return allBooks.find(b =>
    (b.source || '').trim() === source &&
    (b.title || '').trim() === title &&
    (b.author || '').trim() === author
  ) || book;
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
  const sources = Array.isArray(summary.sources) ? summary.sources : [];
  const sourceText = sources.length
    ? sources.map(src => `${src.label || sourceLabel(src.source)} ${Number(src.total || 0)}冊`).join(' / ')
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
  const book = item.book || {};
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
  const genre = book.genre ? escapeHtml(book.genre.length > 30 ? book.genre.substring(0, 30) + '…' : book.genre) : '—';
  const srcBadge = book.source ? `<span class="badge-source badge-${escapeHtml(book.source)}">${escapeHtml(sourceLabel(book.source))}</span>` : '';
  const tsundoku = getTsundokuDays(book);
  const tsundokuStr = tsundoku != null ? tsundoku + '日' : '—';
  return `
    <tr class="message-book-row">
      <td class="col-cover"><img src="${escapeHtml(book.cover_url || NO_COVER)}" alt="" loading="lazy" onerror="this.src='${NO_COVER}'"></td>
      <td class="col-title">
        <button type="button" class="message-book-title-link message-detail-open" data-message-book-index="${refIndex}">
          ${completedBadge}${favoriteBadge}${escapeHtml(book.title || '不明なタイトル')}
        </button>
      </td>
      <td class="col-author" title="${escapeHtml(book.author || '')}">${escapeHtml(book.author || '')}</td>
      <td class="col-summary" title="${summary ? escapeHtml(summary) : ''}">${summaryCell}</td>
      <td class="col-genre">${genre}</td>
      <td class="col-runtime">${(book.runtime_length_min || 0) > 0 ? formatRuntime(book.runtime_length_min) : '—'}</td>
      <td>${formatDate(book.loan_date)}</td>
      <td>${book.completed ? formatDateOnly(book.completed_date) : (formatProgress(book) || '—')}</td>
      <td class="col-tsundoku">${tsundokuStr}</td>
      <td>${srcBadge}</td>
      <td class="col-ai-insight">${renderMessageInsight(insight, refIndex)}</td>
      <td class="col-message-actions">${renderMessageInsightActions(insight, book)}</td>
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
                <th class="col-summary">概要</th>
                <th class="col-genre">ジャンル</th>
                <th class="col-runtime">再生時間</th>
                <th>取得日</th>
                <th>読了日</th>
                <th>積読</th>
                <th>ソース</th>
                <th class="col-ai-insight">書評ポイント</th>
                <th class="col-message-actions">操作</th>
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
  messageInsightRefs = [];
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
  listEl.querySelectorAll('.message-ai-generate-link').forEach(btn => {
    btn.addEventListener('click', () => generateMessageBookInsight(btn));
  });
  listEl.querySelectorAll('.btn-copy-insight-message').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.getAttribute('data-message-insight-index'), 10);
      const insight = messageInsightRefs[idx];
      if (insight) copyBookInsightText(insight, btn);
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
    if (data.insight?.id) bookInsightsCache[data.insight.id] = data.insight;
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
    if (data.insight?.id) bookInsightsCache[data.insight.id] = data.insight;
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
      if (data.insight.id) bookInsightsCache[data.insight.id] = data.insight;
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
    if (data.insight?.id) bookInsightsCache[data.insight.id] = data.insight;
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

  // タイトル: detail URLがあればリンクにする
  const titleEl = document.getElementById('bookDetailTitle');
  if (detailHref) {
    titleEl.innerHTML = `<a href="${escapeHtml(detailHref)}" target="_blank" rel="noopener" class="book-detail-title-link">${escapeHtml(book.title || '—')}</a>`;
  } else {
    titleEl.textContent = book.title || '—';
  }

  // 著者: detail URLがあればリンクにする
  const authorEl = document.getElementById('bookDetailAuthor');
  if (book.author && detailHref) {
    authorEl.innerHTML = `<a href="${escapeHtml(detailHref)}" target="_blank" rel="noopener" class="book-detail-meta-link">著者: ${escapeHtml(book.author)}</a>`;
  } else {
    authorEl.textContent = book.author ? `著者: ${book.author}` : '';
  }

  document.getElementById('bookDetailGenre').textContent = book.genre ? `ジャンル: ${book.genre}` : '';
  document.getElementById('bookDetailFavorite').textContent = book.favorite ? '♥ お気に入り' : '';
  document.getElementById('bookDetailFavorite').style.display = book.favorite ? '' : 'none';

  const ratingEl = document.getElementById('bookDetailRating');
  if (book.source === 'audible_jp') {
    const bookUrl = getAudibleRatingUrl(book);
    const dispRating = displayRating(book);
    const ratingContent = dispRating > 0
      ? `総合評価: ${starsHtml(dispRating, { asLink: true, source: book.source, detailUrl: bookUrl })}${(book.catalog_rating || 0) > 0 && (book.catalog_rating || 0) % 1 !== 0 ? ` (${book.catalog_rating})` : ''}`
      : `総合評価: <a href="${escapeHtml(bookUrl)}" target="_blank" rel="noopener" class="rating-link" title="Audibleで評価を入力">— 評価を入力</a>`;
    ratingEl.innerHTML = ratingContent;
  } else {
    ratingEl.innerHTML = book.rating ? `評価: ${starsHtml(book.rating)}` : '評価: —';
  }

  const headlineEl = document.getElementById('bookDetailReviewHeadline');
  if (book.review_headline) {
    headlineEl.textContent = `見出し: ${book.review_headline}`;
    headlineEl.style.display = '';
  } else {
    headlineEl.textContent = '';
    headlineEl.style.display = 'none';
  }

  document.getElementById('bookDetailLoanDate').textContent = book.loan_date ? `購入・貸出: ${book.loan_date}` : '';

  const compEl = document.getElementById('bookDetailCompleted');
  if (book.completed) {
    compEl.textContent = book.completed_date ? `読了: ${formatDateOnly(book.completed_date)}` : '読了';
    compEl.style.display = '';
  } else if (formatProgress(book)) {
    compEl.textContent = `進捗: ${formatProgress(book)}`;
    compEl.style.display = '';
  } else {
    compEl.textContent = '';
    compEl.style.display = 'none';
  }

  document.getElementById('bookDetailComment').textContent = book.comment || '';
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

  // 概要: detail URLがあればリンクにする
  const summaryText = book.full_summary || book.summary || '';
  const summaryEl = document.getElementById('bookDetailSummary');
  if (summaryText && detailHref) {
    summaryEl.innerHTML = `<a href="${escapeHtml(detailHref)}" target="_blank" rel="noopener" class="book-detail-summary-link">${escapeHtml(summaryText)}</a>`;
  } else {
    summaryEl.textContent = summaryText || '（概要なし）';
  }

  // レビューURL（評価横アイコン＆書評ポイント横ボタン共通）
  const reviewUrl = reviewUrlForBook(book);
  const reviewIcon = document.getElementById('bookDetailReviewIcon');
  if (reviewIcon) {
    reviewIcon.href = reviewUrl || '#';
    reviewIcon.style.display = reviewUrl ? '' : 'none';
  }
  const reviewBtn = document.getElementById('bookDetailReviewBtn');
  if (reviewBtn) {
    reviewBtn.href = reviewUrl || '#';
    reviewBtn.style.display = reviewUrl ? '' : 'none';
  }

  loadBookInsight(book);
  modal.classList.add('open');
}

function closeBookDetail() {
  currentDetailBook = null;
  document.getElementById('bookDetailModal').classList.remove('open');
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

    const cover = book.cover_url || NO_COVER;
    const srcClass = book.source === 'audible_jp' ? ' source-audible' : '';
    const srcBadge = book.source ? `<span class="badge-source badge-${escapeHtml(book.source)}">${escapeHtml(sourceLabel(book.source))}</span> ` : '';
    const completedBadge = book.completed ? '<span class="badge-completed">読了</span> ' : '';
    const favoriteBadge = book.favorite ? '<span class="badge-favorite" title="お気に入り">♥</span> ' : '';

    const genreHtml = book.genre ? `<span class="book-card-genre">${escapeHtml(book.genre)}</span>` : '';
    const supplementHtml = titleSupplementHtml(book);
    const summaryHtml = book.summary ? `<div class="book-card-summary">${escapeHtml(book.summary)}</div>` : '';
    const progressBarHtml = book.source === 'kindle' && (book.percent_complete || 0) > 0 ? renderProgressBar(book) : '';

    return header + `
      <div class="book-card book-card-clickable${book.completed ? ' completed' : ''}${srcClass}" data-book-index="${i}" role="button" tabindex="0">
        <img class="book-cover" src="${escapeHtml(cover)}" alt="" loading="lazy"
             onerror="this.src='${NO_COVER}'">
        <div class="book-card-body">
          <div class="book-card-title">${completedBadge}${favoriteBadge}${srcBadge}${escapeHtml(book.title)}</div>
          ${supplementHtml ? `<div class="book-card-title-supplement">${supplementHtml}</div>` : ''}
          <div class="book-card-author">${escapeHtml(book.author || '')}${(book.runtime_length_min || 0) > 0 ? ` · ${formatRuntime(book.runtime_length_min)}` : ''}${book.completed && book.completed_date ? ` · 読了: ${formatDateOnly(book.completed_date)}` : ''}</div>
          ${genreHtml}
          ${progressBarHtml}
          ${!book.completed ? `<div class="book-card-meta">${formatProgress(book) ? `<span>進捗: ${formatProgress(book)}</span>` : `<span>${formatDate(book.loan_date)}</span>`}</div>` : ''}
          ${summaryHtml}
        </div>
      </div>
    `;
  }).join('');
}

function renderTableView(books, selectedGenre = 'all', prevBook = null, subGenreCounts = {}) {
  let lastSubGenre = prevBook && selectedGenre !== 'all' ? getSubGenreForGrouping(prevBook, selectedGenre) : null;
  const showSubGenreHeaders = selectedGenre !== 'all';

  const rows = books.map((book, i) => {
    let headerRow = '';
    if (showSubGenreHeaders) {
      const sg = getSubGenreForGrouping(book, selectedGenre) || selectedGenre;
      if (sg !== lastSubGenre) {
        lastSubGenre = sg;
        const cnt = subGenreCounts[sg] || 0;
        headerRow = `<tr class="rating-group-row"><td colspan="11" class="rating-group-header">${escapeHtml(sg)}（${cnt}冊）</td></tr>`;
      }
    }
    const srcBadge = book.source ? `<span class="badge-source badge-${escapeHtml(book.source)}">${escapeHtml(sourceLabel(book.source))}</span>` : '';
    const completedBadge = book.completed ? '<span class="badge-completed">読了</span> ' : '';
    const favoriteBadge = book.favorite ? '<span class="badge-favorite" title="お気に入り">♥</span> ' : '';
    const genre = book.genre ? escapeHtml(book.genre.length > 30 ? book.genre.substring(0, 30) + '…' : book.genre) : '—';
    const supplementHtml = titleSupplementHtml(book);
    const summary = (book.summary || '').trim();
    const summaryCell = summary ? escapeHtml(summary.length > 80 ? summary.substring(0, 80) + '…' : summary) : '—';
    const tsundoku = getTsundokuDays(book);
    const tsundokuStr = tsundoku != null ? tsundoku + '日' : '—';
    return headerRow + `
      <tr class="book-row-clickable ${book.completed ? 'row-completed' : ''}" data-book-index="${i}" role="button" tabindex="0">
        <td class="col-cover"><img src="${escapeHtml(book.cover_url || NO_COVER)}" alt=""
            loading="lazy" onerror="this.src='${NO_COVER}'"></td>
        <td class="col-title">
          <div>${completedBadge}${favoriteBadge}${escapeHtml(book.title)}</div>
          ${supplementHtml ? `<div class="title-supplement-cell">${supplementHtml}</div>` : ''}
        </td>
        <td class="col-author" title="${escapeHtml(book.author || '')}">${escapeHtml(book.author || '')}</td>
        <td class="col-summary" title="${summary ? escapeHtml(summary) : ''}">${summaryCell}</td>
        <td class="col-genre">${genre}</td>
        <td class="col-runtime">${(book.runtime_length_min || 0) > 0 ? formatRuntime(book.runtime_length_min) : '—'}</td>
        <td>${formatDate(book.loan_date)}</td>
        <td>${book.completed ? formatDateOnly(book.completed_date) : (formatProgress(book) || '—')}</td>
        <td class="col-tsundoku">${tsundokuStr}</td>
        <td>${srcBadge}</td>
        <td class="col-ai-insight">${renderTableInsightCell(book)}</td>
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
          <th class="col-summary">概要</th>
          <th class="col-genre">ジャンル</th>
          <th class="col-runtime">再生時間</th>
          <th class="th-sortable" data-sort-asc="tsundoku_desc" data-sort-desc="date_desc" title="クリックでソート">取得日</th>
          <th class="th-sortable" data-sort-asc="completed_date_asc" data-sort-desc="completed_date_desc" title="クリックでソート">読了日</th>
          <th class="th-sortable" data-sort-asc="tsundoku_desc" data-sort-desc="tsundoku_desc" title="クリックでソート">積読</th>
          <th>ソース</th>
          <th class="col-ai-insight">書評ポイント</th>
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
    scheduleRenderCharts();
  });
});

document.querySelectorAll('.chart-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.chart-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const target = tab.dataset.tab;
    document.getElementById('chartMonthlyWrap').style.display = target === 'monthly' ? '' : 'none';
    document.getElementById('chartGenreWrap').style.display = target === 'genre' ? '' : 'none';
    document.getElementById('chartRelationWrap').style.display = target === 'relation' ? '' : 'none';
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
    if (tabVal === 'ranking' || tabVal === 'recommend' || tabVal === 'messages') {
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

/* ============================================================
   タグ傾向分析 v2 — カテゴリ別タグクラウド
   ============================================================ */

const TAG_MAIN_CATEGORIES = [
  '文学・フィクション',
  'ビジネス・自己啓発・政治・社会',
  'テクノロジー・科学',
  'ライフ',
  'その他',
];

// ジャンル文字列のキーワードでカテゴリを決定
const TAG_CATEGORY_GENRE_KEYWORDS = {
  '文学・フィクション': ['文学', '小説', 'フィクション', '文芸', '詩', '海外文学', 'エンターテインメント', 'sf', 'ミステリー', '推理', 'ホラー', 'ファンタジー', 'ロマンス', '歴史小説', 'サスペンス', 'スリラー', '冒険', '児童文学', '絵本', 'コミック', '漫画', 'ライトノベル', '大衆小説', '純文学', '外国文学', '日本文学', '現代文学', 'fiction', 'drama'],
  'ビジネス・自己啓発・政治・社会': ['ビジネス', '経営', 'マネジメント', 'リーダーシップ', '起業', 'マーケティング', '投資', '金融', '経済', '自己啓発', '政治', '社会', '哲学', '歴史', '宗教', '倫理', 'キャリア', '人間関係', 'コミュニケーション', 'スピリチュアル', '心理', '脳科学', '認知', '教養', '資産', '人文', '思想', 'business', 'psychology'],
  'テクノロジー・科学': ['テクノロジー', 'ai', '人工知能', 'プログラミング', 'コンピュータ', 'it', 'サイエンス', '科学', '医学', '生物', '物理', '数学', 'エンジニアリング', 'データ', 'デジタル', '宇宙', '工学', '医療', 'technology', 'science'],
  'ライフ': ['ライフ', '料理', '健康', 'スポーツ', '旅行', '趣味', '家族', '教育', '子育て', 'ファッション', 'アート', '音楽', '映画', 'エッセイ', '随筆', '育児', '美容', 'ガーデニング', 'インテリア', '語学', 'ホビー', '食', 'グルメ', 'ライフスタイル', 'アウトドア', 'life', 'essay'],
};

// カテゴリ別・summary/full_summary からの詳細タグ抽出パターン
const DETAIL_TAG_PATTERNS = {
  '文学・フィクション': [
    { tag: '恋愛・ロマンス',     words: ['恋愛', '恋人', 'ロマンス', '片思い', '初恋', '恋心', '愛し', '恋し', '結婚', 'プロポーズ', '交際', '告白', 'love', 'romance'] },
    { tag: '家族・親子',         words: ['家族', '親子', '夫婦', '母親', '父親', '兄弟', '姉妹', '子ども', '子供', '息子', '娘', '両親', '兄', '弟', '姉', '妹'] },
    { tag: '青春・学生',         words: ['青春', '高校生', '中学生', '大学生', '学生', '受験', '部活', '文化祭', '修学旅行', '進路', '学校', '少年', '少女'] },
    { tag: '友情・仲間',         words: ['友情', '友人', '友達', '仲間', '絆', '親友'] },
    { tag: 'ミステリー・謎解き', words: ['謎', '推理', '殺人', '事件', '探偵', '刑事', '犯罪', '犯人', '容疑者', 'トリック', 'mystery', 'detective'] },
    { tag: 'ホラー・恐怖',       words: ['ホラー', '恐怖', '怖い', '幽霊', '呪い', '恐ろしい', 'horror'] },
    { tag: 'サスペンス・スリラー', words: ['サスペンス', 'スリラー', '心理戦', '追跡', '逃亡', 'thriller', 'suspense'] },
    { tag: 'SF・未来',           words: ['sf', '宇宙', '未来', 'ロボット', 'タイムトラベル', 'クローン', 'サイバー', '仮想現実', 'ディストピア', 'science fiction'] },
    { tag: 'ファンタジー・異世界', words: ['魔法', '異世界', 'ファンタジー', '魔王', '勇者', 'ドラゴン', '精霊', '魔法使い', 'fantasy'] },
    { tag: '歴史・時代小説',     words: ['江戸', '明治', '昭和', '侍', '武士', '戦国', '幕末', '平安', '鎌倉', '時代小説', '大正'] },
    { tag: '戦争・戦時',         words: ['戦争', '戦時', '兵士', '戦場', '爆撃', '特攻', '捕虜', '空襲'] },
    { tag: '感動・泣ける',       words: ['感動', '涙', '泣ける', '切ない', '号泣', '心打つ', '胸に刺さる'] },
    { tag: '社会・格差',         words: ['格差', '差別', '貧困', '社会問題', '不平等', 'いじめ', '孤独', '孤立'] },
    { tag: '成長・自己発見',     words: ['成長', '自己発見', '変化', '新しい自分', '旅立ち', '挑戦', '夢', '再生'] },
    { tag: '死・喪失・悲哀',     words: ['死', '喪失', '悲しみ', '亡くなる', '別れ', '悲劇', '追悼'] },
    { tag: '職場・仕事',         words: ['仕事', '職場', '会社', 'サラリーマン', '転職', '出世', '同僚', '上司'] },
    { tag: '冒険・旅',           words: ['冒険', '旅', '探検', '旅人', '旅行', 'adventure'] },
    { tag: 'コメディ・ユーモア', words: ['笑い', 'コメディ', 'ユーモア', 'おかしい', '笑える', 'comedy', 'humor'] },
  ],
  'ビジネス・自己啓発・政治・社会': [
    { tag: 'リーダーシップ・組織', words: ['リーダー', 'リーダーシップ', '組織', 'チーム', 'マネジメント', '部下', '上司', 'management'] },
    { tag: '起業・スタートアップ', words: ['起業', 'スタートアップ', 'ベンチャー', '創業', '事業', '独立', 'startup'] },
    { tag: '投資・資産形成',     words: ['投資', '資産', '株', '資産形成', '節約', '節税', 'お金', 'ファイナンス', 'investment'] },
    { tag: 'マーケティング・戦略', words: ['マーケティング', '戦略', 'ブランド', '広告', 'セールス', '顧客', '市場', 'marketing'] },
    { tag: '心理学・行動経済学', words: ['心理', '行動', '認知', '意思決定', 'バイアス', '脳', 'ナッジ', 'psychology'] },
    { tag: '自己啓発・習慣',     words: ['習慣', '生産性', '目標', '朝活', 'マインドフルネス', '瞑想', '集中', '時間管理', 'habit'] },
    { tag: '哲学・思想',         words: ['哲学', '思想', '倫理', '道徳', '存在', '自由', '幸福', '正義', 'philosophy'] },
    { tag: '歴史・政治',         words: ['歴史', '政治', '選挙', '外交', '国際', '民主主義', '経済史', 'history'] },
    { tag: 'コミュニケーション', words: ['コミュニケーション', '人間関係', '対話', '交渉', '説得', '共感', 'communication'] },
    { tag: 'キャリア・転職',     words: ['キャリア', '転職', '就職', '仕事術', '働き方', 'ワークライフ', 'career'] },
    { tag: '社会問題・格差',     words: ['格差', '貧困', '差別', '不平等', 'ジェンダー', '少子化', '高齢化', '社会問題'] },
    { tag: 'イノベーション・DX', words: ['イノベーション', 'dx', 'デジタル変革', '変革', 'トランスフォーメーション', 'innovation'] },
    { tag: '経済・金融',         words: ['経済', '金融', 'gdp', '景気', '貿易', 'economics', 'finance'] },
    { tag: '教育・学習',         words: ['教育', '学習', '学び', '勉強', '学校', 'education', 'learning'] },
    { tag: '健康・ウェルネス',   words: ['健康', 'ウェルネス', 'メンタル', '幸福', '充実', 'wellness'] },
  ],
  'テクノロジー・科学': [
    { tag: 'AI・機械学習',           words: ['ai', '機械学習', 'ディープラーニング', 'chatgpt', '生成ai', '人工知能', 'llm', '深層学習'] },
    { tag: 'プログラミング・開発',   words: ['プログラミング', 'コーディング', '開発', 'エンジニア', 'ソフトウェア', 'アプリ', 'coding'] },
    { tag: 'データサイエンス・統計', words: ['データ', '統計', '分析', 'データサイエンス', 'ビッグデータ', 'analytics'] },
    { tag: 'セキュリティ',           words: ['セキュリティ', 'ハッキング', 'サイバー', 'プライバシー', '暗号', 'security'] },
    { tag: '医療・バイオ',           words: ['医療', '医学', '遺伝子', 'バイオ', '病気', 'がん', 'ゲノム', '薬', 'medicine', 'biology'] },
    { tag: '宇宙・天文',             words: ['宇宙', '天文', 'ブラックホール', '天体', '星', '惑星', '銀河', 'space'] },
    { tag: '物理・量子',             words: ['物理', '量子', '相対性', '素粒子', 'physics', 'quantum'] },
    { tag: '数学・論理',             words: ['数学', '論理', '確率', '証明', '数式', 'math', 'mathematics'] },
    { tag: 'ロボット・自動化',       words: ['ロボット', '自動化', 'オートメーション', '自律', 'robot'] },
    { tag: '環境・エネルギー',       words: ['環境', 'エネルギー', '再生可能', '気候変動', 'カーボン', 'サステナブル', 'environment'] },
    { tag: 'デジタル・インターネット', words: ['インターネット', 'デジタル', 'web', 'sns', 'ソーシャル', 'digital'] },
  ],
  'ライフ': [
    { tag: '料理・グルメ',       words: ['料理', 'レシピ', '食', 'グルメ', '食べ物', '食材', 'レストラン', 'シェフ', 'cooking'] },
    { tag: '健康・ダイエット',   words: ['健康', 'ダイエット', '体', '栄養', '食事管理', 'ヘルシー', 'health'] },
    { tag: 'フィットネス・スポーツ', words: ['運動', 'フィットネス', 'スポーツ', 'トレーニング', '筋肉', 'ランニング', 'exercise'] },
    { tag: '子育て・育児',       words: ['子育て', '育児', '子ども', '子供', '親', '保育', 'parenting'] },
    { tag: '教育・学習',         words: ['教育', '学習', '学び', '学校', '塾', 'education'] },
    { tag: '旅行・アウトドア',   words: ['旅行', '旅', 'アウトドア', '登山', '海外', '観光', '旅人', 'travel'] },
    { tag: 'アート・デザイン',   words: ['アート', '美術', 'デザイン', 'クリエイティブ', '絵', '写真', '芸術', 'art'] },
    { tag: '音楽・映画',         words: ['音楽', '映画', 'エンタメ', '映像', '演劇', 'ライブ', 'アニメ', 'music'] },
    { tag: 'エッセイ・回顧録',   words: ['エッセイ', '随筆', '体験', '自伝', '回顧録', '伝記', 'memoir', 'essay'] },
    { tag: 'マインド・メンタル', words: ['メンタル', '心', 'ストレス', '不安', 'うつ', '癒し', '幸福', '充実', 'mental'] },
    { tag: '語学・学習',         words: ['語学', '英語', '言語', '外国語', '学習', '勉強', 'language'] },
    { tag: '住まい・インテリア', words: ['インテリア', '住まい', '家', '部屋', '収納', 'diy', 'interior'] },
    { tag: '環境・サステナブル', words: ['環境', 'サステナブル', 'エコ', 'ゼロウェイスト', 'sustainable'] },
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

/** book を5大カテゴリに分類 */
function classifyBookToMainCategory(book) {
  const genreRaw = (book.genre || '').toLowerCase();
  for (const [cat, keywords] of Object.entries(TAG_CATEGORY_GENRE_KEYWORDS)) {
    for (const kw of keywords) {
      if (genreRaw.includes(kw)) return cat;
    }
  }
  return 'その他';
}

/** 1冊の詳細タグを生成（insight headings + genre sub + summary patterns） */
function generateDetailedTagsForBook(book, mainCat) {
  const tags = new Set();
  // 1. insight point headings
  const key = _bookInsightKey(book);
  if (key && bookInsightsCache[key]?.points) {
    bookInsightsCache[key].points.forEach(p => {
      const h = (p.heading || '').trim();
      if (h && h.length <= 20) tags.add(h);
    });
  }
  // 2. ジャンルの2階層目以降
  genreTags(book.genre).slice(1).forEach(g => {
    if (g && g.length <= 20) tags.add(g);
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
function renderCategoryOverview(catData) {
  const el = document.getElementById('tagCatOverview');
  if (!el) return;
  const total = allBooks.length || 1;
  const bars = TAG_MAIN_CATEGORIES.map(cat => {
    const n = catData[cat].books.length;
    const pct = Math.round((n / total) * 100);
    const read = catData[cat].books.filter(b => b.completed).length;
    const isActive = cat === _tagActiveCat ? ' tag-overview-bar-active' : '';
    return `<div class="tag-overview-bar-item${isActive}" data-cat="${escapeAttr(cat)}">
      <div class="tag-overview-bar-label">${escapeHtml(cat)}</div>
      <div class="tag-overview-bar-bg"><div class="tag-overview-bar-fill" style="width:${pct}%"></div></div>
      <div class="tag-overview-bar-stats">${n}冊 / 読了${read}</div>
    </div>`;
  }).join('');
  el.innerHTML = `<div class="tag-overview-bars">${bars}</div>`;
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
        const pct = d.total > 0 ? Math.round((d.read / d.total) * 100) : 0;
        return `<span class="tag-chip" data-tag="${escapeAttr(tag)}" style="font-size:${size.toFixed(2)}rem;opacity:${opacity.toFixed(2)}" title="${escapeHtml(tag)}: 計${d.total}冊（読了${d.read} / 未読${d.unread}）">${escapeHtml(tag)}<span class="tag-chip-pct">${pct}%</span></span>`;
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
    const idx = allBooks.indexOf(b);
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
  });
}
document.getElementById('bookPhotoBtn')?.addEventListener('click', () => {
  document.getElementById('bookPhotoInput')?.click();
});
document.getElementById('bookPhotoInput')?.addEventListener('change', (e) => {
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
});
document.getElementById('bookInsightGenerateBtn')?.addEventListener('click', () => generateBookInsight());
document.getElementById('bookInsightEditBtn')?.addEventListener('click', showBookInsightForm);

document.getElementById('bookList')?.addEventListener('click', (e) => {
  const reviewLink = e.target.closest('.btn-review-insight-table');
  if (reviewLink) {
    e.stopPropagation();
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
document.getElementById('statYearly')?.addEventListener('click', (e) => {
  e.preventDefault();
  activeMainTab = 'yonda';
  activeBookTab = 'read';
  document.getElementById('ratingFilter').value = 'yearly_completed';
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
  activeMainTab = getDefaultPage();

  try {
    const libRes = await fetch(API.libraries);
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

  try {
    await loadFromFile();
  } catch (err) {
    console.error('loadFromFile error:', err);
    const empty = document.getElementById('emptyState');
    const error = document.getElementById('error');
    if (empty) empty.style.display = 'block';
    if (error) {
      error.textContent = 'データの読み込みに失敗しました。メニューから「読書記録を取込み」を実行してください。';
      error.style.display = 'block';
    }
  }
  updateMainTabVisibility();
  loadAmazonList();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
