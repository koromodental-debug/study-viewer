// Flashcard module entry (ESM). Safe parallel build; not wired into runtime yet.

import { DAY_MS, getNextInterval } from './algorithm.js';
import {
  loadProgress,
  saveProgress,
  recordDailyActivity,
  recordStudyTime,
  getDailyStats,
  getTodayStats,
  getWeeklyCards,
  getTopicStats,
  getSubjectStats,
  getOverallStats
} from './progress-tracker.js';
import { createStatsModule, formatStudyTime } from './stats.js';
import { createDeckManager } from './deck-manager.js';
import { createSessionManager } from './session.js';
import { createCardRenderer } from './card-renderer.js';

const STORAGE_KEY = 'studyViewer_flashcardProgress';
const SESSIONS_KEY = 'studyViewer_flashcardSessions';
const REPORTS_KEY = 'studyViewer_cardReports';
const DECK_CUSTOMIZATIONS_KEY = 'studyViewer_deckCustomizations';
const DAILY_STATS_KEY = 'studyViewer_dailyStats';
const STORAGE_VERSION = 1;

// 科目の表示順序（インポート済み → 必修 → 基礎系 → 保存系 → 補綴系 → その他臨床系 → 社会歯科系）
const SUBJECT_ORDER = [
  'インポート済み',
  '必修',
  // 基礎系
  '解剖', '組織', '生理', '生化',
  '病理', '微生物・免疫', '薬理', '歯科理工',
  // 保存系
  '保存修復', '歯内療法学', '歯周病',
  // 補綴系
  '全部床義歯', '部分床義歯', '冠橋義歯', 'インプラント',
  // その他臨床系
  '口腔外科', '歯科放射線', '高齢者歯科', '摂食嚥下',
  // 社会歯科系
  '公衆衛生', '疫学', '口腔衛生'
];

// 科目カテゴリ定義（色分け用）
const SUBJECT_CATEGORIES = {
  'インポート済み': { category: 'インポート', color: '#8E8E93' },  // グレー
  '必修': { category: '必修', color: '#FF9500' },      // オレンジ
  // 基礎系
  '解剖': { category: '基礎系', color: '#007AFF' },    // 青
  '組織': { category: '基礎系', color: '#007AFF' },
  '生理': { category: '基礎系', color: '#007AFF' },
  '生化': { category: '基礎系', color: '#007AFF' },
  '病理': { category: '基礎系', color: '#007AFF' },
  '微生物・免疫': { category: '基礎系', color: '#007AFF' },
  '薬理': { category: '基礎系', color: '#007AFF' },
  '歯科理工': { category: '基礎系', color: '#007AFF' },
  // 保存系
  '保存修復': { category: '保存系', color: '#34C759' },  // 緑
  '歯内療法学': { category: '保存系', color: '#34C759' },
  '歯周病': { category: '保存系', color: '#34C759' },
  // 補綴系
  '全部床義歯': { category: '補綴系', color: '#AF52DE' }, // 紫
  '部分床義歯': { category: '補綴系', color: '#AF52DE' },
  '冠橋義歯': { category: '補綴系', color: '#AF52DE' },
  'インプラント': { category: '補綴系', color: '#AF52DE' },
  // 外科系
  '口腔外科': { category: '外科系', color: '#FF3B30' },  // 赤
  '歯科放射線': { category: '外科系', color: '#FF3B30' },
  '高齢者歯科': { category: '外科系', color: '#FF3B30' },
  '摂食嚥下': { category: '外科系', color: '#FF3B30' },
  // 社会歯科系
  '公衆衛生': { category: '社会歯科系', color: '#5AC8FA' }, // 水色
  '疫学': { category: '社会歯科系', color: '#5AC8FA' },
  '口腔衛生': { category: '社会歯科系', color: '#5AC8FA' }
};

// コラボレーター（報告ボタンが表示されるユーザー）
const COLLABORATORS = [
  'koromo.dental@gmail.com',
  'den.sata.mo@gmail.com',
  'kameyasuka@gmail.com',
  'hidetoshimgx@gmail.com',
  'ryotasetohryotasetoh@gmail.com',
  '520020sagawatatsuya@gmail.com',
  '521021tanakamoyuru@gmail.com',
];

function isCollaborator() {
  if (typeof globalThis.FirebaseSync === 'undefined') {
    console.log('[Collaborator] FirebaseSync未定義');
    return false;
  }
  const user = globalThis.FirebaseSync.getCurrentUser();
  console.log('[Collaborator] user:', user);
  console.log('[Collaborator] email:', user?.email);
  console.log('[Collaborator] COLLABORATORS:', COLLABORATORS);
  if (!user || !user.email) return false;
  const result = COLLABORATORS.includes(user.email);
  console.log('[Collaborator] result:', result);
  return result;
}

const state = {
  currentTopicId: null,
  currentTopic: null,
  cards: [],           // パース済みQ&A配列
  filteredCards: [],   // 復習モード時のフィルタ済み配列
  currentIndex: 0,
  isFlipped: false,
  isReviewMode: false,
  shuffleEnabled: localStorage.getItem('flashcard-shuffle') === 'true',
  cramMode: localStorage.getItem('flashcard-cram-mode') === 'true', // 直前期モード（間隔反復OFF）
  againDelay: localStorage.getItem('flashcard-again-delay') || '1day', // 'immediate' or '1day'
  againMode: localStorage.getItem('flashcard-again-mode') || 'reinsert', // 'reinsert'(すぐ再挿入) or 'afterRound'(一周後)
  initialInterval: parseInt(localStorage.getItem('flashcard-initial-interval')) || 1, // 初回「覚えた」後の間隔（日）
  againCards: [], // 一周後モード用: 「もう一度」カードを貯める
  currentRound: 1, // 現在の周回数
  sessionSize: parseInt(localStorage.getItem('flashcard-session-size')) || 10, // 10, 20, 全問
  isActive: false,     // 演習中かどうか
  completed: false,    // デッキ完了フラグ（完了後のセッション保存防止用）
  answeredInSession: 0, // セッション中の回答数（5問ごとのマイルストーン用）
  combo: 0,            // 連続「覚えた」カウント（コンボシステム用）
  progress: {},        // { "topicId:index": { status, lastReview } }
  touchStartX: 0,
  touchStartY: 0,
  // Undo用
  undoState: null,     // { index, filteredCards, progress, card }
  undoTimer: null,     // Undoボタン自動非表示タイマー
  // まとめ折りたたみ状態
  summaryCollapsed: localStorage.getItem('flashcard-summary-collapsed') === 'true',
  // デッキ検索
  searchQuery: '',
  // 演習モード（mix, memorized, again, new）
  currentMode: 'mix',
  // おまかせの割合（newHeavy, balanced, reviewHeavy）
  mixRatio: localStorage.getItem('flashcard-mix-ratio') || 'balanced',
  // カード検索
  cardSearch: {
    isIndexing: false,
    allCardsIndex: null,
    query: '',
    results: [],
    expandedKeys: new Set(),
    showAll: false  // 全件表示フラグ
  },
  // 科目アコーディオンの開閉状態
  expandedSubjects: new Set(JSON.parse(localStorage.getItem('flashcard-expanded-subjects') || '[]')),
  // 最後に選択したトピックID
  lastSelectedTopicId: localStorage.getItem('flashcard-last-topic') || null,
  // 選択問題用
  selectedChoices: new Set(),  // 選択中の選択肢
  choiceAnswered: false,       // 解答済みフラグ
  // カード一覧のスクロール位置（topicId -> scrollTop）
  deckCardListScrollPos: {},
  // デッキ一覧のスクロール位置
  deckListScrollPos: 0,
  // ハイライトするトピックID（今日の10問からのジャンプ用）
  highlightTopicId: null,
  // スクロール方向検知用
  lastScrollTop: 0,
  // ピルボタンの表示状態（スクロール制御用）
  pillVisible: false,
  // セッション開始時間（勉強時間トラッキング用）
  sessionStartTime: null,
  sessionAccumulatedTime: 0,  // ページ非表示時に蓄積した時間
  lastActivityTime: null,     // 最後のユーザー操作時刻
  isIdle: false               // アイドル状態かどうか
};

// テーブル穴埋めカードの状態
const tableOcclusionState = {
  currentOcclusionIndex: 0,
  revealedCells: new Set(),
  isTableCard: false,
  currentCard: null,
  currentDeck: null,
  currentCardIndex: 0,
  totalOcclusions: 0,
  globalOcclusionIndex: 0
};

let container = null;

// DATAは動的に取得（ESMモジュール初期化時にglobalThis.DATAがまだない可能性があるため）
function getDATA() {
  return globalThis.DATA || [];
}

const refs = {
  deck: null,
  session: null,
  card: null,
  stats: null
};

function loadProgressWrapper() {
  loadProgress(state, { storageKey: STORAGE_KEY, storageVersion: STORAGE_VERSION });
}

function saveProgressWrapper() {
  saveProgress(state, { storageKey: STORAGE_KEY, storageVersion: STORAGE_VERSION });
}

function recordDailyActivityWrapper(type) {
  return recordDailyActivity(type, {
    dailyStatsKey: DAILY_STATS_KEY,
    storageKey: STORAGE_KEY,
    onPublicStatsUpdate: () => refs.stats?.updatePublicStats?.()
  });
}

function recordStudyTimeWrapper(durationMs) {
  return recordStudyTime(durationMs, { dailyStatsKey: DAILY_STATS_KEY, storageKey: STORAGE_KEY });
}

function getDailyStatsWrapper() {
  return getDailyStats({ dailyStatsKey: DAILY_STATS_KEY, storageKey: STORAGE_KEY });
}

function getTodayStatsWrapper() {
  return getTodayStats({ dailyStatsKey: DAILY_STATS_KEY, storageKey: STORAGE_KEY });
}

function getWeeklyCardsWrapper() {
  return getWeeklyCards({ dailyStatsKey: DAILY_STATS_KEY, storageKey: STORAGE_KEY });
}

function getRecommendedCount() {
  return state.sessionSize;
}

function getInProgressTopics(limit = 5) {
  const topicLastAccess = {};

  for (const [key, value] of Object.entries(state.progress)) {
    const topicId = key.split(':')[0];
    const lastReview = value.lastReview || 0;
    if (!topicLastAccess[topicId] || lastReview > topicLastAccess[topicId]) {
      topicLastAccess[topicId] = lastReview;
    }
  }

  const topics = Object.keys(topicLastAccess)
    .map(topicId => {
      const topicData = getDATA().find(d => d.id === topicId);
      if (!topicData) return null;
      const stats = getTopicStats(state, topicId);
      const session = refs.session?.getSession?.(topicId);
      return {
        ...topicData,
        stats,
        lastAccess: topicLastAccess[topicId],
        currentPosition: session ? session.index + 1 : null
      };
    })
    .filter(t => t !== null && t.currentPosition !== null);

  try {
    const stored = localStorage.getItem(SESSIONS_KEY);
    if (stored) {
      const allSessions = JSON.parse(stored);
      for (const [topicId, session] of Object.entries(allSessions)) {
        if (topicId.startsWith('__search_') && session.index !== undefined) {
          const query = topicId.replace('__search_', '');
          topics.push({
            id: topicId,
            title: `検索:${query}`,
            subject: '検索結果',
            stats: { memorized: 0, again: 0 },
            lastAccess: session.timestamp || 0,
            currentPosition: session.index + 1,
            isSearchDeck: true
          });
        }
      }
    }
  } catch (e) {}

  return topics
    .sort((a, b) => b.lastAccess - a.lastAccess)
    .slice(0, limit);
}

function getSessionSizeLabel(size = state.sessionSize) {
  return size >= 9999 ? '全問' : `${size}問`;
}

function buildStartSub(overall, mode) {
  const isAll = state.sessionSize >= 9999;
  const effectiveSize = isAll ? overall.total : state.sessionSize;
  const timeEstimate = Math.ceil(effectiveSize * 0.5);
  return `${getSessionSizeLabel()} · 約${timeEstimate}分`;
}

function buildBreakdown(overall, mode) {
  if (mode === 'mix') {
    return `全${overall.total}カードから出題`;
  } else if (mode === 'memorized') {
    return `覚えた${overall.memorized}カードをテスト`;
  } else if (mode === 'again') {
    return `もう一度${overall.again}カードを優先`;
  }
  return '';
}

function openBreakdownSheet() {
  const overlay = document.getElementById('breakdown-overlay');
  const body = document.getElementById('breakdown-sheet-body');
  if (!overlay || !body) return;

  const overall = getOverallStats(state);
  const sessionSize = state.sessionSize;
  const currentMode = state.currentMode || 'mix';

  const newCount = Math.max(0, sessionSize - overall.memorized);
  const mixRatio = state.mixRatio || 'balanced';

  const modeSection = `
    <div class="breakdown-section">
      <div class="breakdown-section-title">出題範囲</div>
      <div class="breakdown-mode-buttons">
        <button class="breakdown-mode-btn ${currentMode === 'mix' ? 'active' : ''}" data-mode="mix">
          <span class="breakdown-mode-label">おまかせ</span>
          <span class="breakdown-mode-desc">新規${newCount} + 覚えた${Math.min(sessionSize, overall.memorized)}</span>
        </button>
        <div class="breakdown-ratio-row ${currentMode === 'mix' ? '' : 'hidden'}" id="ratio-selector">
          <button class="breakdown-ratio-btn ${mixRatio === 'newHeavy' ? 'active' : ''}" data-ratio="newHeavy">新規多め</button>
          <button class="breakdown-ratio-btn ${mixRatio === 'balanced' ? 'active' : ''}" data-ratio="balanced">バランス</button>
          <button class="breakdown-ratio-btn ${mixRatio === 'reviewHeavy' ? 'active' : ''}" data-ratio="reviewHeavy">復習多め</button>
        </div>
        <button class="breakdown-mode-btn ${currentMode === 'new' ? 'active' : ''}" data-mode="new">
          <span class="breakdown-mode-label">新規のみ</span>
          <span class="breakdown-mode-desc">${getSessionSizeLabel(sessionSize)}</span>
        </button>
        <button class="breakdown-mode-btn ${currentMode === 'memorized' ? 'active' : ''}" data-mode="memorized">
          <span class="breakdown-mode-label">覚えたのみ</span>
          <span class="breakdown-mode-desc">${overall.memorized}カード</span>
        </button>
      </div>
    </div>
  `;

  const isAllSelected = sessionSize >= 9999;
  const sizeSection = `
    <div class="breakdown-section">
      <div class="breakdown-section-title">問数</div>
      <div class="breakdown-size-buttons">
        <button class="breakdown-size-btn ${sessionSize === 10 ? 'active' : ''}" data-size="10">10問</button>
        <button class="breakdown-size-btn ${sessionSize === 20 ? 'active' : ''}" data-size="20">20問</button>
        <button class="breakdown-size-btn ${isAllSelected ? 'active' : ''}" data-size="9999">全問</button>
      </div>
    </div>
  `;

  const intervalSection = `
    <div class="breakdown-section">
      <div class="breakdown-section-title">復習間隔</div>
      <div class="breakdown-section-desc">カードごとに自動調整されます（1日→3日→7日→14日→30日...）</div>
      <div class="breakdown-section-desc" style="margin-top: 4px; color: var(--text-tertiary);">「覚えた」を押すと次の復習までカウントダウン開始。期限が来ると「定着中」→「要復習」に移動します。</div>
      <div class="cram-mode-toggle" style="margin-top: 12px;">
        <label class="toggle-switch">
          <input type="checkbox" id="cram-mode-checkbox" ${state.cramMode ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
        <span class="cram-mode-label">直前期モード</span>
        <span class="cram-mode-desc">（間隔を無視して全カード復習可能）</span>
      </div>
    </div>
  `;

  body.innerHTML = `${modeSection}${sizeSection}${intervalSection}`;
  overlay.classList.add('active');

  body.querySelectorAll('.breakdown-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      state.currentMode = mode;
      localStorage.setItem('flashcard-mode', mode);

      body.querySelectorAll('.breakdown-mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const ratioSelector = document.getElementById('ratio-selector');
      if (ratioSelector) {
        ratioSelector.classList.toggle('hidden', mode !== 'mix');
      }
    });
  });

  body.querySelectorAll('.breakdown-ratio-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const ratio = btn.dataset.ratio;
      state.mixRatio = ratio;
      localStorage.setItem('flashcard-mix-ratio', ratio);

      body.querySelectorAll('.breakdown-ratio-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  body.querySelectorAll('.breakdown-size-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const newSize = parseInt(btn.dataset.size);
      state.sessionSize = newSize;
      localStorage.setItem('flashcard-session-size', newSize);

      body.querySelectorAll('.breakdown-size-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const newNewCount = Math.max(0, newSize - overall.memorized);
      const newMemCount = Math.min(newSize, overall.memorized);

      const allDesc = body.querySelector('.breakdown-mode-btn[data-mode="mix"] .breakdown-mode-desc');
      if (allDesc) allDesc.textContent = `新規${newNewCount} + 覚えた${newMemCount}`;

      const newDesc = body.querySelector('.breakdown-mode-btn[data-mode="new"] .breakdown-mode-desc');
      if (newDesc) newDesc.textContent = `${newSize}問`;
    });
  });

  const cramCheckbox = document.getElementById('cram-mode-checkbox');
  if (cramCheckbox) {
    cramCheckbox.addEventListener('change', () => {
      state.cramMode = cramCheckbox.checked;
      localStorage.setItem('flashcard-cram-mode', state.cramMode);
    });
  }

  const closeBtn = document.getElementById('breakdown-close');
  if (closeBtn) {
    closeBtn.onclick = () => closeBreakdownSheet();
  }

  const backdrop = overlay.querySelector('.breakdown-backdrop');
  if (backdrop) {
    backdrop.onclick = () => closeBreakdownSheet();
  }
}

function closeBreakdownSheet() {
  const overlay = document.getElementById('breakdown-overlay');
  if (overlay) {
    overlay.classList.remove('active');
  }
  refs.deck?.renderDeckList?.();
}

function openSettingsSheet() {
  const overlay = document.getElementById('breakdown-overlay');
  const body = document.getElementById('breakdown-sheet-body');
  if (!overlay || !body) return;

  body.innerHTML = `
    <div class="breakdown-section">
      <div class="breakdown-section-title">復習間隔</div>
      <div class="breakdown-section-desc">カードごとに自動調整されます（1日→3日→7日→14日→30日...）</div>
      <div class="breakdown-section-desc" style="margin-top: 4px; color: var(--text-tertiary);">「覚えた」を押すと次の復習までカウントダウン開始。期限が来ると「定着中」→「要復習」に移動します。</div>
      <div class="breakdown-section-subtitle" style="margin-top: 12px;">初回の復習間隔</div>
      <div class="again-delay-buttons" style="margin-top: 8px;">
        <button class="again-delay-btn initial-interval-btn ${state.initialInterval === 1 ? 'active' : ''}" data-initial="1">
          1日後
        </button>
        <button class="again-delay-btn initial-interval-btn ${state.initialInterval === 3 ? 'active' : ''}" data-initial="3">
          3日後
        </button>
        <button class="again-delay-btn initial-interval-btn ${state.initialInterval === 7 ? 'active' : ''}" data-initial="7">
          7日後
        </button>
      </div>
      <div class="breakdown-section-desc" style="margin-top: 6px; font-size: 12px;">※ 2回目以降は自動で間隔が延びます</div>
      <div class="cram-mode-toggle" style="margin-top: 12px;">
        <label class="toggle-switch">
          <input type="checkbox" id="cram-mode-checkbox" ${state.cramMode ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
        <span class="cram-mode-label">直前期モード</span>
        <span class="cram-mode-desc">（間隔を無視して全カード復習可能）</span>
      </div>
    </div>
    <div class="breakdown-section">
      <div class="breakdown-section-title">セッション内の再出題</div>
      <div class="again-delay-buttons">
        <button class="again-delay-btn ${state.againMode === 'reinsert' ? 'active' : ''}" data-mode="reinsert">
          すぐ混ぜる
        </button>
        <button class="again-delay-btn ${state.againMode === 'afterRound' ? 'active' : ''}" data-mode="afterRound">
          2周目にまとめる
        </button>
      </div>
      <div class="again-mode-example">
        ${state.againMode === 'reinsert'
          ? '1→2→<span class="x">もう一度</span>→4→5→<span class="x">再出題</span>→終了'
          : '1周目: 1→2→<span class="x">もう一度</span>→4→5<br>2周目: <span class="x">もう一度</span>のカードだけ'}
      </div>
    </div>
    <div class="breakdown-section">
      <div class="breakdown-section-title">次回セッションの出題</div>
      <div class="again-delay-buttons">
        <button class="again-delay-btn ${state.againDelay === 'immediate' ? 'active' : ''}" data-delay="immediate">
          すぐ出る
        </button>
        <button class="again-delay-btn ${state.againDelay === '1day' ? 'active' : ''}" data-delay="1day">
          1日後に出る
        </button>
      </div>
      <div class="breakdown-section-desc" style="margin-top: 8px;">→ アプリを閉じて次に開いた時、要復習に出るタイミング</div>
    </div>
  `;

  overlay.classList.add('active');

  const cramCheckbox = document.getElementById('cram-mode-checkbox');
  if (cramCheckbox) {
    cramCheckbox.addEventListener('change', () => {
      state.cramMode = cramCheckbox.checked;
      localStorage.setItem('flashcard-cram-mode', state.cramMode);
    });
  }

  body.querySelectorAll('.initial-interval-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const interval = parseInt(btn.dataset.initial);
      state.initialInterval = interval;
      localStorage.setItem('flashcard-initial-interval', interval);

      body.querySelectorAll('.initial-interval-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  body.querySelectorAll('.again-delay-btn[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      state.againMode = mode;
      localStorage.setItem('flashcard-again-mode', mode);

      btn.parentElement.querySelectorAll('.again-delay-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const descEl = btn.parentElement.nextElementSibling;
      if (descEl) {
        descEl.innerHTML = mode === 'reinsert'
          ? '1→2→<span class="x">もう一度</span>→4→5→<span class="x">再出題</span>→終了'
          : '1周目: 1→2→<span class="x">もう一度</span>→4→5<br>2周目: <span class="x">もう一度</span>のカードだけ';
      }
    });
  });

  body.querySelectorAll('.again-delay-btn[data-delay]').forEach(btn => {
    btn.addEventListener('click', () => {
      const delay = btn.dataset.delay;
      state.againDelay = delay;
      localStorage.setItem('flashcard-again-delay', delay);

      btn.parentElement.querySelectorAll('.again-delay-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  const closeBtn = document.getElementById('breakdown-close');
  if (closeBtn) {
    closeBtn.onclick = () => closeBreakdownSheet();
  }

  const backdrop = overlay.querySelector('.breakdown-backdrop');
  if (backdrop) {
    backdrop.onclick = () => closeBreakdownSheet();
  }
}

function showCardPreview(card) {
  if (typeof globalThis.showCardPreview === 'function') {
    return globalThis.showCardPreview(card);
  }
  return undefined;
}

async function loadTableOcclusionDeck(deckPath) {
  try {
    const response = await fetch(deckPath);
    const deck = await response.json();
    tableOcclusionState.currentDeck = deck;
    tableOcclusionState.currentOcclusionIndex = 0;
    tableOcclusionState.currentCardIndex = 0;
    tableOcclusionState.revealedCells.clear();
    tableOcclusionState.isTableCard = true;

    tableOcclusionState.totalOcclusions = deck.cards.reduce((sum, card) => sum + card.occlusions.length, 0);
    tableOcclusionState.globalOcclusionIndex = 0;

    if (deck.cards && deck.cards.length > 0) {
      tableOcclusionState.currentCard = deck.cards[0];
      state.isFlipped = false;
      refs.card?.renderTableOcclusionCard?.();
    }
  } catch (e) {
    console.error('テーブルデッキ読み込みエラー:', e);
  }
}

async function startRecommendedDeck() {
  const targetCount = state.sessionSize;
  const ratio = state.mixRatio || 'balanced';

  let newTarget, memorizedTarget;
  if (ratio === 'newHeavy') {
    newTarget = Math.ceil(targetCount * 0.7);
    memorizedTarget = targetCount - newTarget;
  } else if (ratio === 'reviewHeavy') {
    memorizedTarget = Math.ceil(targetCount * 0.7);
    newTarget = targetCount - memorizedTarget;
  } else {
    newTarget = Math.ceil(targetCount * 0.5);
    memorizedTarget = targetCount - newTarget;
  }

  const cardRefs = [];

  for (const [key, value] of Object.entries(state.progress)) {
    if (value.status === 'memorized' && cardRefs.filter(r => r.type === 'memorized').length < memorizedTarget) {
      const [topicId, cardIndex] = key.split(':');
      cardRefs.push({ topicId, cardIndex: parseInt(cardIndex), key, type: 'memorized' });
    }
  }

  const topicsWithQa = getDATA().filter(d => d.qaPath || d.localJsonData);
  for (const topic of topicsWithQa) {
    if (cardRefs.filter(r => r.type === 'new').length >= newTarget) break;

    const topicKeys = Object.keys(state.progress).filter(k => k.startsWith(topic.id + ':'));
    const learnedIndices = new Set(topicKeys.map(k => parseInt(k.split(':')[1])));

    for (let i = 0; i < 100 && cardRefs.filter(r => r.type === 'new').length < newTarget; i++) {
      if (!learnedIndices.has(i)) {
        cardRefs.push({ topicId: topic.id, cardIndex: i, key: `${topic.id}:${i}`, type: 'new' });
      }
    }
  }

  const currentNew = cardRefs.filter(r => r.type === 'new').length;
  const currentMem = cardRefs.filter(r => r.type === 'memorized').length;
  const shortage = targetCount - currentNew - currentMem;

  if (shortage > 0) {
    for (const topic of topicsWithQa) {
      if (cardRefs.length >= targetCount) break;
      const topicKeys = Object.keys(state.progress).filter(k => k.startsWith(topic.id + ':'));
      const usedIndices = new Set([
        ...topicKeys.map(k => parseInt(k.split(':')[1])),
        ...cardRefs.filter(r => r.topicId === topic.id).map(r => r.cardIndex)
      ]);
      for (let i = 0; i < 100 && cardRefs.length < targetCount; i++) {
        if (!usedIndices.has(i)) {
          cardRefs.push({ topicId: topic.id, cardIndex: i, key: `${topic.id}:${i}`, type: 'new' });
        }
      }
    }
  }

  if (cardRefs.length === 0) return;

  const uniqueTopicIds = [...new Set(cardRefs.map(r => r.topicId))];
  const topicCardsMap = new Map();

  for (const topicId of uniqueTopicIds) {
    const topic = getDATA().find(d => d.id === topicId);
    if (!topic || !topic.qaPath) continue;

    try {
      const response = await fetch(encodeURI(topic.qaPath));
      let cards;
      if (topic.qaPath.endsWith('.json')) {
        const jsonData = await response.json();
        cards = refs.deck?.parseJSONToCards?.(jsonData, topicId) || [];
      } else {
        const text = await response.text();
        cards = refs.deck?.parseQAToCards?.(text, topicId) || [];
      }
      topicCardsMap.set(topicId, { cards, topic });
    } catch (e) {
      console.log(`QA読み込みエラー (${topicId}):`, e);
    }
  }

  const filteredCards = [];
  for (const ref of cardRefs) {
    const topicData = topicCardsMap.get(ref.topicId);
    if (topicData) {
      const card = topicData.cards.find(c => c.originalIndex === ref.cardIndex);
      if (card) {
        filteredCards.push({
          ...card,
          topicTitle: topicData.topic.title,
          htmlPath: topicData.topic.htmlPath
        });
      }
    }
  }

  if (filteredCards.length === 0) return;

  state.currentTopicId = '__recommended';
  state.currentTopic = { title: '今日のおすすめ' };
  state.cards = filteredCards;
  state.filteredCards = [...filteredCards];
  state.currentIndex = 0;
  state.isFlipped = false;
  state.isActive = true;
  state.completed = false;
  state.answeredInSession = 0;
  state.combo = 0;
  state.againCards = [];
  state.currentRound = 1;

  for (let i = state.filteredCards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [state.filteredCards[i], state.filteredCards[j]] = [state.filteredCards[j], state.filteredCards[i]];
  }

  if (state.filteredCards.length > state.sessionSize) {
    state.filteredCards = state.filteredCards.slice(0, state.sessionSize);
  }

  refs.card?.renderCard?.();
}

const statsModule = createStatsModule({
  state,
  getDailyStats: getDailyStatsWrapper,
  getTodayStats: getTodayStatsWrapper,
  getWeeklyCards: getWeeklyCardsWrapper,
  FirebaseSyncRef: globalThis.FirebaseSync
});
refs.stats = statsModule;

const cardRenderer = createCardRenderer({
  state,
  tableOcclusionState,
  getDATA,
  getNextInterval,
  DAY_MS,
  recordDailyActivity: recordDailyActivityWrapper,
  saveProgress: saveProgressWrapper,
  getTopicStats: (topicId, options) => getTopicStats(state, topicId, options),
  markDailyTenCompleted: (...args) => refs.session?.markDailyTenCompleted?.(...args),
  clearSession: (...args) => refs.session?.clearSession?.(...args),
  startRecommendedDeck: (...args) => startRecommendedDeck(...args),
  shuffleArray: (...args) => refs.session?.shuffleArray?.(...args),
  goBack: (...args) => refs.session?.goBack?.(...args),
  renderDeckList: (...args) => refs.deck?.renderDeckList?.(...args),
  isCollaborator
});
refs.card = cardRenderer;

const deckManager = createDeckManager({
  state,
  getDATA,
  SUBJECT_ORDER,
  SUBJECT_CATEGORIES,
  FirebaseSyncRef: globalThis.FirebaseSync,
  FavoritesManager: globalThis.FavoritesManager,
  searchEngine: globalThis.searchEngine,
  showToast: (...args) => refs.card?.showToast?.(...args),
  renderCard: (...args) => refs.card?.renderCard?.(...args),
  renderNoCardsMessage: (...args) => refs.card?.renderNoCardsMessage?.(...args),
  showCardPreview,
  startDailyTenDeck: (...args) => refs.session?.startDailyTenDeck?.(...args),
  startStatusDeck: (...args) => refs.session?.startStatusDeck?.(...args),
  startSubjectDeck: (...args) => refs.session?.startSubjectDeck?.(...args),
  startGroupDeck: (...args) => refs.session?.startGroupDeck?.(...args),
  startSubjectDeckFromCards: (...args) => refs.session?.startSubjectDeckFromCards?.(...args),
  startGroupDeckFromCards: (...args) => refs.session?.startGroupDeckFromCards?.(...args),
  startFavoriteDeck: (...args) => refs.session?.startFavoriteDeck?.(...args),
  startSearchResultsDeck: (...args) => refs.session?.startSearchResultsDeck?.(...args),
  resumeSearchDeck: (...args) => refs.session?.resumeSearchDeck?.(...args),
  loadTopic: (...args) => refs.session?.loadTopic?.(...args),
  loadTableOcclusionDeck,
  openSettingsSheet,
  openStatsDetailSheet: (...args) => refs.stats?.openStatsDetailSheet?.(...args),
  showStatusHelpModal: (...args) => refs.card?.showStatusHelpModal?.(...args),
  openReportsOverlay: (...args) => refs.card?.openReportsOverlay?.(...args),
  reportCardFromList: (...args) => refs.card?.reportCardFromList?.(...args),
  saveProgress: saveProgressWrapper,
  getNextInterval,
  DAY_MS,
  getOverallStats: (options) => getOverallStats(state, options),
  getRecommendedCount,
  getInProgressTopics,
  getReports: (...args) => refs.card?.getReports?.(...args),
  getTodayStats: getTodayStatsWrapper,
  getDailyStats: getDailyStatsWrapper,
  getWeeklyCards: getWeeklyCardsWrapper,
  formatStudyTime,
  collectDailyTenCardRefs: (...args) => refs.session?.collectDailyTenCardRefs?.(...args),
  fetchCardsFromRefs: (...args) => refs.session?.fetchCardsFromRefs?.(...args),
  collectStatusCardRefs: (...args) => refs.session?.collectStatusCardRefs?.(...args),
  fetchAllCardsFromTopics: (...args) => refs.session?.fetchAllCardsFromTopics?.(...args),
  SESSIONS_KEY,
  REPORTS_KEY,
  DECK_CUSTOMIZATIONS_KEY,
  getSubjectStats: (s, data, subject, options) => getSubjectStats(s, data, subject, options),
  getTopicStats: (s, topicId, options) => getTopicStats(s, topicId, options),
  isCollaborator
});
refs.deck = deckManager;

const sessionManager = createSessionManager({
  state,
  tableOcclusionState,
  getDATA,
  SESSIONS_KEY,
  DAY_MS,
  parseQAToCards: (...args) => refs.deck?.parseQAToCards?.(...args),
  parseJSONToCards: (...args) => refs.deck?.parseJSONToCards?.(...args),
  applyCustomizations: (...args) => refs.deck?.applyCustomizations?.(...args),
  loadAllCardsIndex: (...args) => refs.deck?.loadAllCardsIndex?.(...args),
  searchCards: (...args) => refs.deck?.searchCards?.(...args),
  renderCard: (...args) => refs.card?.renderCard?.(...args),
  renderNoCardsMessage: (...args) => refs.card?.renderNoCardsMessage?.(...args),
  renderDeckList: (...args) => refs.deck?.renderDeckList?.(...args),
  exitPracticeMode: (...args) => refs.card?.exitPracticeMode?.(...args),
  updateAccordionPillVisibility: (...args) => refs.deck?.updateAccordionPillVisibility?.(...args),
  showToast: (...args) => refs.card?.showToast?.(...args),
  getNextInterval,
  saveProgress: saveProgressWrapper,
  FirebaseSyncRef: globalThis.FirebaseSync
});
refs.session = sessionManager;

function init() {
  container = document.getElementById('flashcard-content');
  if (!container) return;

  refs.deck?.setContainer?.(container);
  refs.session?.setContainer?.(container);
  refs.card?.setContainer?.(container);

  refs.deck?.loadImportedDecks?.();
  loadProgressWrapper();
  refs.deck?.renderDeckList?.();

  window.addEventListener('deckImported', (e) => {
    refs.deck?.addImportedDeckToData?.(e.detail);
    refs.deck?.renderDeckList?.();
  });

  window.addEventListener('firebaseSyncComplete', () => {
    console.log('[FlashcardModule] Firebase同期完了 - 進捗データを再読み込み');
    loadProgressWrapper();
    refs.deck?.loadImportedDecks?.();
    if (!state.isActive) {
      refs.deck?.renderDeckList?.();
    }
  });

  const closeAccordionPill = document.getElementById('close-accordion-pill');
  if (closeAccordionPill) {
    closeAccordionPill.addEventListener('click', () => {
      refs.deck?.resetDeckList?.();
    });
  }

  container.addEventListener('scroll', () => refs.deck?.handleDeckListScroll?.(), { passive: true });

  const now = Date.now();
  state.sessionStartTime = now;
  state.sessionAccumulatedTime = 0;
  state.lastActivityTime = now;
  state.isIdle = false;

  const IDLE_TIMEOUT = 5 * 60 * 1000;

  function handleActivity() {
    const now = Date.now();
    if (state.isIdle) {
      state.isIdle = false;
      state.sessionStartTime = now;
      console.log('[StudyTime] アイドルから復帰');
    }
    state.lastActivityTime = now;
  }

  let activityThrottle = null;
  function throttledActivity() {
    if (activityThrottle) return;
    activityThrottle = setTimeout(() => {
      activityThrottle = null;
    }, 1000);
    handleActivity();
  }

  ['click', 'scroll', 'keydown', 'touchstart', 'mousemove'].forEach(event => {
    document.addEventListener(event, throttledActivity, { passive: true });
  });

  setInterval(() => {
    if (state.isIdle || !state.sessionStartTime) return;

    const now = Date.now();
    const idleTime = now - state.lastActivityTime;

    if (idleTime >= IDLE_TIMEOUT) {
      const activeTime = state.lastActivityTime - state.sessionStartTime;
      if (activeTime > 0) {
        state.sessionAccumulatedTime += activeTime;
        recordStudyTimeWrapper(activeTime);
      }
      state.sessionStartTime = null;
      state.isIdle = true;
      console.log('[StudyTime] 5分間操作なし - アイドル状態');
    }
  }, 60 * 1000);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (state.sessionStartTime && !state.isIdle) {
        const elapsed = Date.now() - state.sessionStartTime;
        state.sessionAccumulatedTime += elapsed;
        state.sessionStartTime = null;
      }
      if (state.sessionAccumulatedTime > 0) {
        recordStudyTimeWrapper(state.sessionAccumulatedTime);
        state.sessionAccumulatedTime = 0;
      }
    } else {
      if (!state.isIdle) {
        state.sessionStartTime = Date.now();
        state.lastActivityTime = Date.now();
      }
    }
  });

  window.addEventListener('beforeunload', () => {
    if (state.sessionStartTime && !state.isIdle) {
      const elapsed = Date.now() - state.sessionStartTime;
      state.sessionAccumulatedTime += elapsed;
    }
    if (state.sessionAccumulatedTime > 0) {
      recordStudyTimeWrapper(state.sessionAccumulatedTime);
    }
  });

  setInterval(() => {
    if (state.sessionStartTime && !state.isIdle) {
      const elapsed = Date.now() - state.sessionStartTime;
      if (elapsed > 0) {
        recordStudyTimeWrapper(elapsed);
        state.sessionStartTime = Date.now();
      }
    }
  }, 3 * 60 * 1000);
}

function show() {
  if (!state.isActive) {
    refs.deck?.renderDeckList?.();
  }
}

function hide() {
  // no-op
}

function resetDeckList() {
  refs.deck?.resetDeckList?.();
}

function saveSession() {
  return refs.session?.saveSession?.();
}

window.addEventListener('beforeunload', saveSession);
window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    saveSession();
  }
});

const FlashcardModule = {
  init,
  show,
  hide,
  resetDeckList,
  loadTopic: (...args) => refs.session?.loadTopic?.(...args),
  startDeck: (...args) => refs.session?.startDeck?.(...args),
  next: (...args) => refs.card?.next?.(...args),
  prev: (...args) => refs.card?.prev?.(...args),
  flip: (...args) => refs.card?.flip?.(...args),
  markMemorized: (...args) => refs.card?.markMemorized?.(...args),
  markAgain: (...args) => refs.card?.markAgain?.(...args),
  goBack: (...args) => refs.session?.goBack?.(...args),
  saveSession,
  getReports: (...args) => refs.card?.getReports?.(...args),
  removeReport: (...args) => refs.card?.removeReport?.(...args),
  clearAllReports: (...args) => refs.card?.clearAllReports?.(...args),
  exportReportsAsText: (...args) => refs.card?.exportReportsAsText?.(...args)
};

if (typeof globalThis !== 'undefined') {
  globalThis.FlashcardModule = FlashcardModule;
}

if (typeof window !== 'undefined') {
  window.dispatchEvent(new Event('flashcard-module-ready'));
}

export default FlashcardModule;
export { FlashcardModule };
