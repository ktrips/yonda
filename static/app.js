/* --- yonda frontend --- */

const API = {
  books: '/api/books',
  fetch: '/api/fetch',
  libraries: '/api/libraries',
  credentials: '/api/credentials',
  credentialsAudibleUpload: '/api/credentials/audible_jp/upload',
  testLogin: '/api/test-login',
  kindleLogin: '/api/kindle-login',
  kindleLoginOtp: '/api/kindle-login-otp',
  aiRecommend: '/api/ai-recommend',
  yondaRecommend: '/api/yonda-recommend',
  bookCover: '/api/book-cover',
  bookInfo: '/api/book-info',
};

let allBooks = [];
let filteredBooks = [];
let currentPage = 0;
let activeMainTab = 'yonda'; // 'yonda' | 'yomu' | 'oshi'
let activeBookTab = 'read'; // 'read' = 読んだ/途中, 'ranking' = ランキング, 'recommend' = オススメ (Yonda内)
let monthlyChart = null;
let genreChart = null;
let chartMode = 'count';  // 'count' | 'runtime'
let relationChartMode = 'genre_rating';  // 'genre_rating' | 'author_genre'
const PAGE_SIZE = 100;
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

/** 途中: Audibleで再生したが読了していない / 図書館で借りているが評価を付けていない */
function isInProgress(book) {
  if (book.completed) return false;
  if (book.source === 'audible_jp' && (book.percent_complete || 0) > 0) return true;
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
    const d = new Date(isoStr);
    // 日本時間（JST）に変換
    const jst = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
    const M = jst.getMonth() + 1;
    const D = jst.getDate();
    const h = String(jst.getHours()).padStart(2, '0');
    const m = String(jst.getMinutes()).padStart(2, '0');
    return `${M}/${D} ${h}:${m}`;
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
      await loadBooks();
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
          await loadBooks();
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
    renderCharts();
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
      renderCharts();
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

  document.getElementById('statRatedVal').textContent = completed;
  document.getElementById('statTsundokuVal').textContent = inProgress;
  document.getElementById('statYearlyVal').textContent = yearlyCompleted;
  document.getElementById('statYearlyLabel').textContent = year + '年';
  document.getElementById('statFavoriteVal').textContent = favorite;
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
  if (activeBookTab === 'ranking') {
    if (bookList) bookList.style.display = 'none';
    if (pagination) pagination.style.display = 'none';
    if (recommendSection) recommendSection.style.display = 'none';
    if (rankingSection) {
      rankingSection.style.display = 'block';
      renderRanking();
    }
  } else if (activeBookTab === 'recommend') {
    if (bookList) bookList.style.display = 'none';
    if (pagination) pagination.style.display = 'none';
    if (rankingSection) rankingSection.style.display = 'none';
    if (recommendSection) {
      recommendSection.style.display = 'block';
      showRecommendInitialState();
    }
  } else {
    if (rankingSection) rankingSection.style.display = 'none';
    if (recommendSection) recommendSection.style.display = 'none';
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

/** ランキング得点: 自分の評価＋お気に入りが最高位 */
function rankingScore(book) {
  const stars = displayRating(book) || 0;
  return stars * 10 + (book.favorite ? 5 : 0);
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
    ? starsHtml(book.catalog_rating, { asLink: true, source: book.source, detailUrl: getAudibleRatingUrl(book) })
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
  if (activeBookTab === 'ranking') {
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
  renderCharts();
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
      if (!searchText && typeof Tesseract !== 'undefined') {
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
    resultsEl.innerHTML = `
      <div class="book-search-result-item book-search-links-only">
        <p class="book-search-query">「${escapeHtml(query)}」で検索</p>
        <div class="book-search-links">
          <a href="${urls.kindle}" target="_blank" rel="noopener" class="book-search-link book-search-link-kindle">Kindle</a>
          <a href="${urls.audible}" target="_blank" rel="noopener" class="book-search-link book-search-link-audible">Audible</a>
          <a href="${urls.mercari}" target="_blank" rel="noopener" class="book-search-link book-search-link-mercari">メルカリ</a>
          <a href="${urls.bookoff}" target="_blank" rel="noopener" class="book-search-link book-search-link-bookoff">ブックオフ</a>
          <a href="${urls.setagaya}" target="_blank" rel="noopener" class="book-search-link book-search-link-setagaya book-search-link-library">図書館</a>
        </div>
      </div>
    `;
  } else {
    const items = matches.slice(0, 20).map(book => {
      const searchText = `${book.title || ''} ${book.author || ''}`.trim() || query;
      const u = getBookSearchUrls(searchText, { libraryQuery: searchText });
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
          </div>
        </div>
      `;
    }).join('');
    resultsEl.innerHTML = items;
  }
  resultsEl.style.display = 'block';
}

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

function renderCharts() {
  const section = document.getElementById('chartSection');
  if (allBooks.length === 0) {
    section.style.display = 'none';
    return;
  }
  section.style.display = 'block';
  renderMonthlyChart();
  renderGenreChart();
  renderRelationChart();
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
      label: useRuntime ? '読了（試聴時間）' : 'Audible',
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
              if (useRuntime && lbl.includes('試聴時間')) {
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

function openBookDetail(book) {
  const modal = document.getElementById('bookDetailModal');
  const NO_COVER = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="90" viewBox="0 0 64 90">' +
    '<rect fill="#f0e6d8" width="64" height="90" rx="3"/>' +
    '<text x="32" y="50" text-anchor="middle" fill="#8a7968" font-size="10" font-family="sans-serif">No Cover</text></svg>'
  );
  document.getElementById('bookDetailTitle').textContent = book.title || '—';
  document.getElementById('bookDetailAuthor').textContent = book.author ? `著者: ${book.author}` : '';
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
  let detailHref = book.detail_url || '#';
  if (book.detail_url && (book.source === 'kindle' || book.source === 'audible_jp')) {
    const tag = getAffiliateTag();
    if (tag) detailHref = appendTagToUrl(book.detail_url, tag);
  }
  document.getElementById('bookDetailLink').href = detailHref;
  document.getElementById('bookDetailLink').style.display = book.detail_url ? '' : 'none';
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
  const summaryText = book.full_summary || book.summary || '';
  document.getElementById('bookDetailSummary').textContent = summaryText || '（概要なし）';
  modal.classList.add('open');
}

function closeBookDetail() {
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
          <div class="book-card-author">${escapeHtml(book.author || '')}</div>
          ${genreHtml}
          ${progressBarHtml}
          <div class="book-card-meta">
            ${(book.runtime_length_min || 0) > 0 ? `<span class="book-card-runtime">${formatRuntime(book.runtime_length_min)} · </span>` : ''}
            ${book.completed && book.completed_date ? `<span>読了: ${formatDateOnly(book.completed_date)}</span>` : (formatProgress(book) ? `<span>進捗: ${formatProgress(book)}</span>` : `<span>${formatDate(book.loan_date)}</span>`)}
            ${(t => t != null ? ` · 積読: ${t}日` : '')(getTsundokuDays(book))}
          </div>
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
        headerRow = `<tr class="rating-group-row"><td colspan="10" class="rating-group-header">${escapeHtml(sg)}（${cnt}冊）</td></tr>`;
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
    renderCharts();
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
    if (tabVal === 'ranking' || tabVal === 'recommend') {
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
    if (data.success && data.configured) {
      document.getElementById('credUserId').value = data.user_id || '';
      document.getElementById('credPassword').value = '';
      document.getElementById('credPassword').placeholder = '変更する場合のみ入力';
    } else {
      document.getElementById('credUserId').value = '';
      document.getElementById('credPassword').value = '';
      document.getElementById('credPassword').placeholder = 'パスワードを入力';
    }
  } catch (_) {}
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

document.getElementById('bookList')?.addEventListener('click', (e) => {
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
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
