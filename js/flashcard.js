/**
 * フラッシュカードモジュール
 * Q&Aを使った演習機能を提供
 */
const FlashcardModule = (function() {
  // 定数
  const STORAGE_KEY = 'studyViewer_flashcardProgress';
  const SESSIONS_KEY = 'studyViewer_flashcardSessions';
  const REPORTS_KEY = 'studyViewer_cardReports';
  const STORAGE_VERSION = 1;

  // 科目の表示順序（インポート済み → 必修 → 基礎系 → 臨床系）
  const SUBJECT_ORDER = [
    'インポート済み',
    '必修',
    // 基礎系
    '解剖', '組織', '生理', '生化',
    '病理', '微生物・免疫', '薬理', '歯科理工',
    '公衆衛生', '疫学', '口腔衛生',
    // 臨床系
    '保存修復', '歯周病', '口腔外科', '歯科放射線',
    '全部床義歯', '部分床義歯', '高齢者歯科', '摂食嚥下'
  ];

  // 状態
  const state = {
    currentTopicId: null,
    currentTopic: null,
    cards: [],           // パース済みQ&A配列
    filteredCards: [],   // 復習モード時のフィルタ済み配列
    currentIndex: 0,
    isFlipped: false,
    isReviewMode: false,
    shuffleEnabled: localStorage.getItem('flashcard-shuffle') === 'true',
    sessionSize: parseInt(localStorage.getItem('flashcard-session-size')) || 5, // 5, 10, 20
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
    lastSelectedTopicId: localStorage.getItem('flashcard-last-topic') || null
  };

  // DOM要素
  let container = null;

  // === 初期化 ===
  function init() {
    container = document.getElementById('flashcard-content');
    if (!container) return;

    // インポート済みデッキを読み込んでDATAに追加
    loadImportedDecks();

    loadProgress();
    renderDeckList();

    // デッキインポートイベントをリッスン
    window.addEventListener('deckImported', (e) => {
      addImportedDeckToData(e.detail);
      renderDeckList();
    });

    // Firebase同期完了後にデータを再読み込み
    window.addEventListener('firebaseSyncComplete', () => {
      console.log('[FlashcardModule] Firebase同期完了 - 進捗データを再読み込み');
      loadProgress();
      // 演習中でなければ画面を更新
      if (!state.isActive) {
        renderDeckList();
      }
    });
  }

  // インポート済みデッキをDATAに追加
  function loadImportedDecks() {
    // FirebaseSyncが利用可能な場合のみ
    if (typeof FirebaseSync === 'undefined') return;

    const importedDecks = FirebaseSync.getImportedDecks();
    if (!importedDecks || importedDecks.length === 0) return;

    for (const deck of importedDecks) {
      addImportedDeckToData(deck);
    }
  }

  // 単一のインポートデッキをDATAに追加
  function addImportedDeckToData(deck) {
    if (!deck || !deck.topics) return;

    // 既存のトピックを削除（重複防止）
    const existingIds = deck.topics.map(t => `imported_${deck.id}_${t.id}`);
    for (let i = DATA.length - 1; i >= 0; i--) {
      if (existingIds.includes(DATA[i].id)) {
        DATA.splice(i, 1);
      }
    }

    // トピックをDATAに追加
    for (const topic of deck.topics) {
      DATA.push({
        id: `imported_${deck.id}_${topic.id}`,
        title: topic.title,
        category: `インポート/${deck.title}`,
        htmlPath: null,
        qaPath: topic.qaPath,
        searchText: `${deck.title} ${topic.title}`,
        source: 'imported',
        subject: 'インポート済み',
        subjectCategory: deck.title,
        importedDeckId: deck.id
      });
    }
  }

  // === localStorage管理 ===
  function loadProgress() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const data = JSON.parse(saved);
        if (data.version === STORAGE_VERSION) {
          state.progress = data.cards || {};
          const cardCount = Object.keys(state.progress).length;
          console.log(`[loadProgress] 読み込み完了: ${cardCount}件`);
        } else {
          console.log(`[loadProgress] バージョン不一致: ${data.version} !== ${STORAGE_VERSION}`);
        }
      } else {
        console.log('[loadProgress] 保存データなし');
      }
    } catch (e) {
      console.error('[loadProgress] 読み込みエラー:', e);
    }
  }

  function saveProgress() {
    try {
      const data = {
        version: STORAGE_VERSION,
        cards: state.progress
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      const cardCount = Object.keys(state.progress).length;
      console.log(`[saveProgress] 保存完了: ${cardCount}件`);
    } catch (e) {
      console.error('[saveProgress] 保存エラー:', e);
    }
  }

  // === 統計計算 ===
  function getTopicStats(topicId) {
    // トピックに関連する進捗を集計
    const keys = Object.keys(state.progress).filter(k => k.startsWith(topicId + ':'));
    const memorized = keys.filter(k => state.progress[k].status === 'memorized').length;
    const again = keys.filter(k => state.progress[k].status === 'again').length;
    return { memorized, again };
  }

  function getSubjectStats(subject) {
    // 科目配下の全トピックの統計を集計
    const topics = DATA.filter(d => d.subject === subject && d.qaPath);
    let totalMemorized = 0;
    let totalAgain = 0;
    let totalCards = 0;

    for (const topic of topics) {
      const stats = getTopicStats(topic.id);
      totalMemorized += stats.memorized;
      totalAgain += stats.again;
      // 推定カード数（進捗がある分だけカウント）
      totalCards += stats.memorized + stats.again;
    }

    return { memorized: totalMemorized, again: totalAgain, total: totalCards };
  }

  // 進捗のあるトピックを最終学習日時順で取得
  function getInProgressTopics(limit = 5) {
    const topicLastAccess = {};

    // 各トピックの最終アクセス時刻を集計
    for (const [key, value] of Object.entries(state.progress)) {
      const topicId = key.split(':')[0];
      const lastReview = value.lastReview || 0;
      if (!topicLastAccess[topicId] || lastReview > topicLastAccess[topicId]) {
        topicLastAccess[topicId] = lastReview;
      }
    }

    // トピック情報と統計を取得
    const topics = Object.keys(topicLastAccess)
      .map(topicId => {
        const topicData = DATA.find(d => d.id === topicId);
        if (!topicData) return null;
        const stats = getTopicStats(topicId);
        const session = getSession(topicId);
        return {
          ...topicData,
          stats,
          lastAccess: topicLastAccess[topicId],
          currentPosition: session ? session.index + 1 : null
        };
      })
      .filter(t => t !== null && t.currentPosition !== null);

    // 検索結果デッキのセッションも追加
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

    // ソートして制限
    return topics
      .sort((a, b) => b.lastAccess - a.lastAccess)
      .slice(0, limit);
  }

  function getOverallStats() {
    const subjects = [...new Set(DATA.map(d => d.subject).filter(Boolean))];
    let totalCards = 0;
    let memorized = 0;
    let again = 0;

    for (const subject of subjects) {
      const stats = getSubjectStats(subject);
      totalCards += stats.total;
      memorized += stats.memorized;
      again += stats.again;
    }

    // 特別デッキ（kokoshika_hisshu）の進捗も含める
    const kokoshikaStats = getTopicStats('kokoshika_hisshu');
    memorized += kokoshikaStats.memorized;
    again += kokoshikaStats.again;
    totalCards += kokoshikaStats.memorized + kokoshikaStats.again;

    return { total: totalCards, memorized, again };
  }

  // 今日のおすすめカード数を計算
  function getRecommendedCount() {
    // セッションサイズを使用
    return state.sessionSize;
  }

  // 開始ボタンのサブテキストを生成（1行目：問数と時間）
  function buildStartSub(overall, mode) {
    const timeEstimate = Math.ceil(state.sessionSize * 0.5);
    return `${state.sessionSize}問 · 約${timeEstimate}分`;
  }

  // 内訳テキストを生成（シート内表示用）
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

  // 内訳シートを開く
  function openBreakdownSheet() {
    const overlay = document.getElementById('breakdown-overlay');
    const body = document.getElementById('breakdown-sheet-body');
    if (!overlay || !body) return;

    const overall = getOverallStats();
    const sessionSize = state.sessionSize;
    const currentMode = state.currentMode || 'mix';

    // 新規カード数を計算（セッション数 - 覚えた数）
    const newCount = Math.max(0, sessionSize - overall.memorized);

    // 出題範囲の選択肢
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
            <span class="breakdown-mode-desc">${sessionSize}問</span>
          </button>
          <button class="breakdown-mode-btn ${currentMode === 'memorized' ? 'active' : ''}" data-mode="memorized">
            <span class="breakdown-mode-label">覚えたのみ</span>
            <span class="breakdown-mode-desc">${overall.memorized}カード</span>
          </button>
        </div>
      </div>
    `;

    // 問数選択ボタン
    const sizeSection = `
      <div class="breakdown-section">
        <div class="breakdown-section-title">問数</div>
        <div class="breakdown-size-buttons">
          <button class="breakdown-size-btn ${sessionSize === 5 ? 'active' : ''}" data-size="5">5問</button>
          <button class="breakdown-size-btn ${sessionSize === 10 ? 'active' : ''}" data-size="10">10問</button>
          <button class="breakdown-size-btn ${sessionSize === 20 ? 'active' : ''}" data-size="20">20問</button>
        </div>
      </div>
    `;

    body.innerHTML = `${modeSection}${sizeSection}`;

    // シートを開く
    overlay.classList.add('active');

    // 出題範囲ボタンのイベント
    body.querySelectorAll('.breakdown-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        state.currentMode = mode;
        localStorage.setItem('flashcard-mode', mode);

        // ボタンのアクティブ状態を更新
        body.querySelectorAll('.breakdown-mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // おまかせ選択時のみ割合セレクターを表示
        const ratioSelector = document.getElementById('ratio-selector');
        if (ratioSelector) {
          ratioSelector.classList.toggle('hidden', mode !== 'mix');
        }
      });
    });

    // 割合ボタンのイベント
    body.querySelectorAll('.breakdown-ratio-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const ratio = btn.dataset.ratio;
        state.mixRatio = ratio;
        localStorage.setItem('flashcard-mix-ratio', ratio);

        // ボタンのアクティブ状態を更新
        body.querySelectorAll('.breakdown-ratio-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    // 問数選択ボタンのイベント
    body.querySelectorAll('.breakdown-size-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const newSize = parseInt(btn.dataset.size);
        state.sessionSize = newSize;
        localStorage.setItem('flashcard-session-size', newSize);

        // ボタンのアクティブ状態を更新
        body.querySelectorAll('.breakdown-size-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // 出題範囲の数値を更新
        const newNewCount = Math.max(0, newSize - overall.memorized);
        const newMemCount = Math.min(newSize, overall.memorized);

        // すべての説明を更新
        const allDesc = body.querySelector('.breakdown-mode-btn[data-mode="mix"] .breakdown-mode-desc');
        if (allDesc) allDesc.textContent = `新規${newNewCount} + 覚えた${newMemCount}`;

        // 新規のみの説明を更新
        const newDesc = body.querySelector('.breakdown-mode-btn[data-mode="new"] .breakdown-mode-desc');
        if (newDesc) newDesc.textContent = `${newSize}問`;
      });
    });

    // 閉じるボタン
    const closeBtn = document.getElementById('breakdown-close');
    if (closeBtn) {
      closeBtn.onclick = () => closeBreakdownSheet();
    }

    // 背景クリックで閉じる
    const backdrop = overlay.querySelector('.breakdown-backdrop');
    if (backdrop) {
      backdrop.onclick = () => closeBreakdownSheet();
    }
  }

  // 内訳シートを閉じる
  function closeBreakdownSheet() {
    const overlay = document.getElementById('breakdown-overlay');
    if (overlay) {
      overlay.classList.remove('active');
    }
    // トップ画面を再描画
    renderDeckList();
  }

  // === Ankiスタイル デッキ一覧画面 ===
  function renderDeckList() {
    const rawSubjects = [...new Set(DATA.map(d => d.subject).filter(Boolean))];
    // SUBJECT_ORDERの順序でソート（未定義の科目は末尾）
    const subjects = rawSubjects.sort((a, b) => {
      const indexA = SUBJECT_ORDER.indexOf(a);
      const indexB = SUBJECT_ORDER.indexOf(b);
      const orderA = indexA === -1 ? 999 : indexA;
      const orderB = indexB === -1 ? 999 : indexB;
      return orderA - orderB;
    });
    const overall = getOverallStats();
    const recommendedCount = getRecommendedCount();
    const isSearchMode = state.searchQuery.length > 0;

    // 検索結果を取得
    let searchResults = [];
    if (isSearchMode && typeof searchEngine !== 'undefined') {
      const results = searchEngine.search(state.searchQuery);
      searchResults = results.filter(item => item.qaPath);
    }

    container.innerHTML = `
      <div class="deck-list">
        ${renderDeckHome(overall, subjects)}
      </div>
    `;

    // イベントバインド
    bindDeckListEvents();

    // 最後に選択したトピックにスクロール
    scrollToLastSelectedTopic();
  }

  function scrollToLastSelectedTopic() {
    if (!state.lastSelectedTopicId) return;

    // 少し遅延させてDOM更新を待つ
    requestAnimationFrame(() => {
      const topicEl = container.querySelector(`.deck-topic[data-topic-id="${state.lastSelectedTopicId}"]`);
      if (topicEl) {
        topicEl.scrollIntoView({ block: 'center', behavior: 'instant' });
        // 選択状態を視覚的にハイライト（一時的）
        topicEl.classList.add('last-selected');
        setTimeout(() => topicEl.classList.remove('last-selected'), 1500);
      }
    });
  }

  // 検索結果をレンダリング
  function renderSearchResults(results) {
    if (results.length === 0) {
      return `
        <div class="deck-search-empty">
          <p>「${escapeHtml(state.searchQuery)}」に一致するデッキはありません</p>
        </div>
      `;
    }

    return `
      <div class="deck-search-results">
        ${results.map(item => {
          const subject = item.subject || 'その他';
          const title = item.title.replace(/^[ア-オ]_/, '');
          const searchText = (item.searchText || '').toLowerCase();
          const queryLower = state.searchQuery.toLowerCase();
          const hitCount = (searchText.match(new RegExp(queryLower, 'g')) || []).length;

          return `
            <div class="deck-search-result" data-id="${item.id}">
              <div class="deck-result-info">
                <div class="deck-result-subject">${escapeHtml(subject)}</div>
                <div class="deck-result-title">${escapeHtml(title)}</div>
              </div>
              <div class="deck-result-action">
                ${hitCount > 0 ? `<span class="deck-hit-count">${hitCount}件</span>` : ''}
                <button class="deck-start-btn">演習</button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  // モードラベルを取得
  function getModeLabel(mode) {
    switch (mode) {
      case 'new': return '新規のみ';
      case 'memorized': return '覚えたのみ';
      default: return 'おまかせ';
    }
  }

  // 通常のデッキホームをレンダリング
  function renderDeckHome(overall, subjects) {
    const totalLearned = overall.memorized + overall.again;
    const inProgressTopics = getInProgressTopics(10);
    const reports = getReports();

    return `
      <!-- 学習の記録 -->
      <div class="review-center">
        <h2 class="review-center-title">学習の記録</h2>
        <div class="review-center-cards three-cards">
          <div class="review-card review-card-total">
            <span class="review-card-count">${totalLearned}</span>
            <span class="review-card-label">総数</span>
          </div>
          <button class="review-card review-card-again ${overall.again === 0 ? 'empty' : ''}" id="start-again-deck" ${overall.again === 0 ? 'disabled' : ''}>
            <span class="review-card-count">${overall.again}</span>
            <span class="review-card-label">もう一度 ›</span>
          </button>
          <button class="review-card review-card-memorized ${overall.memorized === 0 ? 'empty' : ''}" id="start-memorized-deck" ${overall.memorized === 0 ? 'disabled' : ''}>
            <span class="review-card-count">${overall.memorized}</span>
            <span class="review-card-label">覚えた ›</span>
          </button>
        </div>
      </div>

      <!-- カード検索 -->
      <div class="card-search-entry">
        <div class="card-search-inline">
          <svg class="card-search-inline-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/>
            <path d="M21 21l-4.35-4.35"/>
          </svg>
          <input type="text" class="card-search-inline-input" id="card-search-inline-input"
                 placeholder="カード検索..." autocomplete="off">
          <button class="card-search-inline-clear" id="card-search-inline-clear" style="display:none;">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
          </button>
        </div>
        <div class="card-search-inline-results" id="card-search-inline-results" style="display:none;"></div>
      </div>

      ${reports.length > 0 ? `
      <!-- 報告されたカード -->
      <div class="reports-section">
        <button class="reports-toggle" id="reports-toggle">
          <span class="reports-toggle-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
              <line x1="4" y1="22" x2="4" y2="15"/>
            </svg>
          </span>
          <span class="reports-toggle-text">報告済み ${reports.length}件</span>
          <span class="reports-toggle-chevron">›</span>
        </button>
      </div>
      ` : ''}

      ${inProgressTopics.length > 0 ? `
      <!-- 続きから -->
      <div class="continue-section">
        <h3 class="continue-title">続きから</h3>
        <div class="continue-list">
          ${inProgressTopics.map(topic => `
            <button class="continue-item" data-topic-id="${escapeHtml(topic.id)}">
              <span class="continue-item-title">${escapeHtml(topic.title)}</span>
              ${topic.currentPosition ? `<span class="continue-item-stats">${topic.currentPosition}枚目から</span>` : ''}
            </button>
          `).join('')}
        </div>
      </div>
      ` : ''}

      <!-- 科目一覧 -->
      <div class="deck-subjects-wrapper">
        <div class="deck-subjects-list" id="deck-subjects-list">
          ${subjects.map(subject => renderSubjectRow(subject)).join('')}
        </div>
      </div>
    `;
  }

  // 検索モードの表示
  function renderSearchMode(searchResults) {
    return `
      <div class="deck-search-mode">
        <div class="deck-search-wrapper active">
          <div class="deck-search-bar">
            <svg class="deck-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"/>
              <path d="M21 21l-4.35-4.35"/>
            </svg>
            <input type="text" id="deck-inline-search" class="deck-search-input"
                   placeholder="デッキを検索" value="${escapeHtml(state.searchQuery)}" autofocus>
            <button id="deck-search-clear" class="deck-search-clear" style="display:flex;">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
              </svg>
            </button>
          </div>
          <button id="deck-search-cancel" class="deck-search-cancel">キャンセル</button>
        </div>
        ${renderSearchResults(searchResults)}
      </div>
    `;
  }

  // HTMLエスケープ
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function renderSubjectRow(subject) {
    const topics = DATA.filter(d => d.subject === subject && d.qaPath);
    const stats = getSubjectStats(subject);
    const isOpen = state.expandedSubjects.has(subject);

    // html/subject/配下の科目は大項目でグルーピング
    let topicsHtml = '';
    const hasSubjectPath = topics.some(t =>
      (t.htmlPath && t.htmlPath.includes('html/subject/')) ||
      (t.qaPath && t.qaPath.includes('qa/subject/'))
    );

    if (hasSubjectPath) {
      topicsHtml = renderGroupedTopics(topics);
    } else {
      topicsHtml = topics.map(topic => renderTopicRow(topic)).join('');
    }

    // 必修科目の場合、ココシカバナーを先頭に追加
    let kokoshikaBanner = '';
    if (subject === '必修') {
      const kokoshikaStats = getTopicStats('kokoshika_hisshu');
      const kokoshikaTotal = kokoshikaStats.memorized + kokoshikaStats.again;
      let kokoshikaStatsHtml = '';
      if (kokoshikaTotal === 0) {
        kokoshikaStatsHtml = '<span class="deck-stat-new">424問</span>';
      } else if (kokoshikaStats.again > 0) {
        kokoshikaStatsHtml = `<span class="deck-stat again">要復習 ${kokoshikaStats.again}</span>`;
      } else {
        kokoshikaStatsHtml = `<span class="deck-stat memorized">✓ ${kokoshikaStats.memorized}</span>`;
      }
      kokoshikaBanner = `
        <div class="kokoshika-banner" data-topic-id="kokoshika_hisshu">
          <div class="kokoshika-banner-content">
            <div class="kokoshika-banner-text">
              <div class="kokoshika-banner-title">必修ココシカ</div>
              <div class="kokoshika-banner-desc">★★★超頻出のみ424問</div>
            </div>
          </div>
          <div class="kokoshika-banner-stats">
            ${kokoshikaStatsHtml}
          </div>
        </div>
      `;
    }

    return `
      <div class="deck-subject${isOpen ? ' open' : ''}" data-subject="${subject}">
        <div class="deck-subject-header">
          <div class="deck-subject-main">
            <span class="deck-subject-name">${subject}</span>
          </div>
          <div class="deck-subject-right">
            ${stats.again > 0 ? `<span class="deck-subject-again">要復習 ${stats.again}</span>` : ''}
            <span class="deck-subject-chevron">›</span>
          </div>
        </div>
        <div class="deck-topics">
          ${kokoshikaBanner}
          ${topicsHtml}
        </div>
      </div>
    `;
  }

  // 大項目でグルーピングしたトピック一覧をレンダリング
  function renderGroupedTopics(topics) {
    const groups = new Map();

    topics.forEach(topic => {
      const path = topic.qaPath || topic.htmlPath || '';
      // パターン: subject/科目名/01_大項目名_小項目名.html
      const match = path.match(/subject\/[^/]+\/(\d{2})_([^_]+)/);
      if (match) {
        const groupKey = match[1]; // 01, 02, etc.
        const groupName = match[2]; // 大項目名
        if (!groups.has(groupKey)) {
          groups.set(groupKey, { name: groupName, topics: [] });
        }
        groups.get(groupKey).topics.push(topic);
      } else {
        // 番号プレフィックスがない場合は「その他」に
        if (!groups.has('99')) {
          groups.set('99', { name: 'その他', topics: [] });
        }
        groups.get('99').topics.push(topic);
      }
    });

    // 番号順にソート
    const sortedKeys = [...groups.keys()].sort((a, b) => a.localeCompare(b));

    return sortedKeys.map(key => {
      const group = groups.get(key);
      return `
        <div class="deck-hisshu-group">
          <div class="deck-hisshu-header">${key} ${group.name}</div>
          ${group.topics.map(topic => renderTopicRow(topic, group.name)).join('')}
        </div>
      `;
    }).join('');
  }

  function renderTopicRow(topic, groupName = null) {
    const stats = getTopicStats(topic.id);
    const total = stats.memorized + stats.again;

    // 要復習（再>0）のみ強調表示、それ以外は最小限
    let statsHtml = '';
    if (total === 0) {
      statsHtml = '<span class="deck-stat-new">未学習</span>';
    } else if (stats.again > 0) {
      statsHtml = `<span class="deck-stat again">要復習 ${stats.again}</span>`;
    } else {
      // 全て覚えた状態
      statsHtml = `<span class="deck-stat memorized">✓ ${stats.memorized}</span>`;
    }

    // グループ名が指定されている場合、タイトルから「グループ名_」を除去
    let displayTitle = topic.title;
    if (groupName) {
      const prefix = groupName + '_';
      if (displayTitle.startsWith(prefix)) {
        displayTitle = displayTitle.slice(prefix.length);
      }
    }

    return `
      <div class="deck-topic" data-topic-id="${topic.id}">
        <span class="deck-topic-name">${displayTitle}</span>
        <div class="deck-topic-stats">
          ${statsHtml}
        </div>
      </div>
    `;
  }

  function bindDeckListEvents() {
    // 検索バーのイベント（検索モード時）
    const searchWrapper = document.querySelector('.deck-search-wrapper');
    const searchInput = document.getElementById('deck-inline-search');
    const searchClear = document.getElementById('deck-search-clear');
    const searchCancel = document.getElementById('deck-search-cancel');
    let debounceTimer = null;

    if (searchInput) {
      searchInput.addEventListener('input', function() {
        const query = this.value.trim();
        if (searchClear) {
          searchClear.style.display = query ? 'flex' : 'none';
        }
        // デバウンス（150ms）
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          state.searchQuery = query;
          renderDeckList();
          // 入力欄にフォーカスを戻す
          const newInput = document.getElementById('deck-inline-search');
          if (newInput) {
            newInput.focus();
            newInput.setSelectionRange(query.length, query.length);
          }
        }, 150);
      });

      // フォーカス時にキャンセルボタン表示
      searchInput.addEventListener('focus', function() {
        if (searchWrapper) searchWrapper.classList.add('focused');
      });

      // ブラー時にキャンセルボタン非表示（遅延して検索結果クリックを許可）
      searchInput.addEventListener('blur', function() {
        setTimeout(() => {
          if (searchWrapper && !state.searchQuery) {
            searchWrapper.classList.remove('focused');
          }
        }, 150);
      });

      // Enterキーで最初の結果を選択
      searchInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
          const firstResult = container.querySelector('.deck-search-result');
          if (firstResult) {
            firstResult.click();
          }
        }
      });
    }

    if (searchClear) {
      searchClear.addEventListener('click', function() {
        state.searchQuery = '';
        renderDeckList();
      });
    }

    // キャンセルボタン
    if (searchCancel) {
      searchCancel.addEventListener('click', function() {
        state.searchQuery = '';
        if (searchWrapper) searchWrapper.classList.remove('focused');
        renderDeckList();
      });
    }

    // 検索結果のクリック
    const searchResults = container.querySelectorAll('.deck-search-result');
    searchResults.forEach(result => {
      result.addEventListener('click', async function() {
        const id = this.dataset.id;
        state.searchQuery = ''; // 検索をクリア
        state.isReviewMode = false;
        await loadTopic(id, state.shuffleEnabled);
      });
    });

    // 科目ヘッダークリック（アコーディオン）
    const subjectHeaders = container.querySelectorAll('.deck-subject-header');
    subjectHeaders.forEach(header => {
      header.addEventListener('click', (e) => {
        const subjectEl = header.closest('.deck-subject');
        const subject = subjectEl.dataset.subject;
        subjectEl.classList.toggle('open');

        // 状態を保存
        if (subjectEl.classList.contains('open')) {
          state.expandedSubjects.add(subject);
        } else {
          state.expandedSubjects.delete(subject);
        }
        localStorage.setItem('flashcard-expanded-subjects', JSON.stringify([...state.expandedSubjects]));
      });
    });

    // トピック行クリック（学習開始）
    const topicRows = container.querySelectorAll('.deck-topic');
    topicRows.forEach(row => {
      row.addEventListener('click', async (e) => {
        e.stopPropagation();
        const topicId = row.dataset.topicId;
        // 選択したトピックを記憶
        state.lastSelectedTopicId = topicId;
        localStorage.setItem('flashcard-last-topic', topicId);
        state.isReviewMode = false;
        await loadTopic(topicId, state.shuffleEnabled);
      });
    });

    // ココシカバナークリック（学習開始）
    const kokoshikaBanners = container.querySelectorAll('.kokoshika-banner');
    kokoshikaBanners.forEach(banner => {
      banner.addEventListener('click', async (e) => {
        e.stopPropagation();
        const topicId = banner.dataset.topicId;
        state.lastSelectedTopicId = topicId;
        localStorage.setItem('flashcard-last-topic', topicId);
        state.isReviewMode = false;
        await loadTopic(topicId, state.shuffleEnabled);
      });
    });

    // 設定ボタン（内訳シートを開く）
    const breakdownLink = document.getElementById('deck-breakdown-link');
    if (breakdownLink) {
      breakdownLink.addEventListener('click', (e) => {
        e.stopPropagation();
        openBreakdownSheet();
      });
    }

    // 「確認」ボタン
    const memorizedBtn = document.getElementById('start-memorized-deck');
    if (memorizedBtn) {
      memorizedBtn.addEventListener('click', () => startStatusDeck('memorized'));
    }

    // 「復習」ボタン
    const againBtn = document.getElementById('start-again-deck');
    if (againBtn) {
      againBtn.addEventListener('click', () => startStatusDeck('again'));
    }

    // 報告一覧ボタン
    const reportsToggle = document.getElementById('reports-toggle');
    if (reportsToggle) {
      reportsToggle.addEventListener('click', () => openReportsOverlay());
    }

    // カード検索（インライン）
    const cardSearchInput = document.getElementById('card-search-inline-input');
    const cardSearchClear = document.getElementById('card-search-inline-clear');
    const cardSearchResults = document.getElementById('card-search-inline-results');
    let cardSearchDebounce = null;

    if (cardSearchInput) {
      cardSearchInput.addEventListener('input', async function() {
        const query = this.value;
        if (cardSearchClear) {
          cardSearchClear.style.display = query ? 'flex' : 'none';
        }

        clearTimeout(cardSearchDebounce);
        cardSearchDebounce = setTimeout(async () => {
          if (!query.trim()) {
            if (cardSearchResults) cardSearchResults.style.display = 'none';
            return;
          }

          try {
            // インデックスがなければ構築
            if (!state.cardSearch.allCardsIndex) {
              if (cardSearchResults) {
                cardSearchResults.style.display = 'block';
                cardSearchResults.innerHTML = '<div class="card-search-loading">読み込み中...</div>';
              }
              await loadAllCardsIndex();
            }

            // 検索実行
            state.cardSearch.query = query;
            state.cardSearch.results = searchCards(query);
            renderInlineSearchResults();
          } catch (e) {
            console.error('検索エラー:', e);
            if (cardSearchResults) {
              cardSearchResults.innerHTML = '<div class="card-search-empty">読み込みエラーが発生しました</div>';
            }
          }
        }, 300);
      });
    }

    if (cardSearchClear) {
      cardSearchClear.addEventListener('click', () => {
        if (cardSearchInput) {
          cardSearchInput.value = '';
          cardSearchInput.focus();
        }
        cardSearchClear.style.display = 'none';
        state.cardSearch.query = '';
        state.cardSearch.results = [];
        state.cardSearch.expandedKeys = new Set();
        if (cardSearchResults) cardSearchResults.style.display = 'none';
      });
    }

    // 「続きから」アイテムクリック
    const continueItems = container.querySelectorAll('.continue-item');
    continueItems.forEach(item => {
      item.addEventListener('click', async () => {
        const topicId = item.dataset.topicId;
        state.isReviewMode = false;

        // 検索結果デッキの場合
        if (topicId.startsWith('__search_')) {
          await resumeSearchDeck(topicId);
        } else {
          await loadTopic(topicId, state.shuffleEnabled);
        }
      });
    });

    // 科目一覧の折りたたみ
    const subjectsToggle = document.getElementById('deck-subjects-toggle');
    const subjectsList = document.getElementById('deck-subjects');
    if (subjectsToggle && subjectsList) {
      subjectsToggle.addEventListener('click', () => {
        const isCollapsed = subjectsList.classList.contains('collapsed');
        subjectsList.classList.toggle('collapsed', !isCollapsed);
        subjectsToggle.classList.toggle('open', isCollapsed);

        // 展開時に検索入力にフォーカス
        if (isCollapsed) {
          setTimeout(() => {
            const searchInput = document.getElementById('subjects-search-input');
            if (searchInput) searchInput.focus();
          }, 100);
        }
      });
    }

    // 科目検索
    const subjectsSearchInput = document.getElementById('subjects-search-input');
    if (subjectsSearchInput) {
      subjectsSearchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        const subjectRows = container.querySelectorAll('.deck-subject');

        subjectRows.forEach(row => {
          const subjectName = row.dataset.subject.toLowerCase();
          const topics = row.querySelectorAll('.deck-topic');
          let hasMatch = subjectName.includes(query);

          // トピック名も検索
          topics.forEach(topic => {
            const topicName = topic.querySelector('.deck-topic-name')?.textContent.toLowerCase() || '';
            if (topicName.includes(query)) {
              hasMatch = true;
              topic.style.display = query ? 'flex' : 'flex';
            } else {
              topic.style.display = query && !subjectName.includes(query) ? 'none' : 'flex';
            }
          });

          row.style.display = hasMatch || !query ? 'block' : 'none';

          // クエリがある場合、マッチした科目を展開
          if (query && hasMatch) {
            row.classList.add('expanded');
          } else if (!query) {
            row.classList.remove('expanded');
          }
        });
      });
    }
  }

  // === トピック読み込み ===
  async function loadTopic(topicId, shuffle = false) {
    // ココシカ（特別デッキ）の場合
    if (topicId === 'kokoshika_hisshu') {
      state.currentTopicId = topicId;
      state.currentTopic = {
        id: 'kokoshika_hisshu',
        title: '必修ココシカ',
        subject: '必修',
        qaPath: 'deck/必修ココシカ.txt'
      };
      try {
        const response = await fetch('deck/必修ココシカ.txt');
        const text = await response.text();
        return loadTopicFromText(text, topicId, shuffle);
      } catch (e) {
        console.log('ココシカ読み込みエラー:', e);
        container.innerHTML = `<div class="flashcard-error">ココシカの読み込みに失敗しました</div>`;
        return;
      }
    }

    const topic = DATA.find(d => d.id === topicId);
    if (!topic || !topic.qaPath) return;

    state.currentTopicId = topicId;
    state.currentTopic = topic;

    try {
      const response = await fetch(encodeURI(topic.qaPath));
      const text = await response.text();
      loadTopicFromText(text, topicId, shuffle);
    } catch (e) {
      console.log('Q&A読み込みエラー:', e);
      container.innerHTML = `<div class="flashcard-error">Q&Aの読み込みに失敗しました</div>`;
    }
  }

  // テキストからトピックを読み込む共通処理
  function loadTopicFromText(text, topicId, shuffle = false) {
    state.cards = parseQAToCards(text, topicId);

    // 復習モードの場合、「もう一度」のカードのみフィルタ
    if (state.isReviewMode) {
      state.filteredCards = state.cards.filter((card, idx) => {
        const key = `${topicId}:${idx}`;
        return state.progress[key] && state.progress[key].status === 'again';
      });
    } else {
      state.filteredCards = [...state.cards];
    }

    // 保存されたセッションを復元
    let savedIndex = 0;
    const session = getSession(topicId);

    if (session) {
      // 保存された順序でカードを並べ替え（可能な場合）
      if (session.order && session.order.length === state.filteredCards.length) {
        const orderMap = new Map(state.filteredCards.map(c => [c.originalIndex, c]));
        const reordered = session.order.map(idx => orderMap.get(idx)).filter(Boolean);
        if (reordered.length === state.filteredCards.length) {
          state.filteredCards = reordered;
        }
      }
      // インデックスは常に復元を試みる
      if (session.index !== undefined && session.index > 0) {
        savedIndex = Math.min(session.index, state.filteredCards.length - 1);
      }
    } else if (state.shuffleEnabled && state.filteredCards.length > 0) {
      // 新規シャッフル（保存セッションがない場合のみ）
      for (let i = state.filteredCards.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [state.filteredCards[i], state.filteredCards[j]] = [state.filteredCards[j], state.filteredCards[i]];
      }
    }

    state.currentIndex = savedIndex;
    state.isFlipped = false;
    state.isActive = true;
    state.completed = false;
    state.answeredInSession = 0;
    state.combo = 0;

    if (state.filteredCards.length === 0) {
      renderNoCardsMessage();
    } else {
      renderCard();
    }
  }

  // === ステータスデッキ（覚えた/もう一度のみ） ===
  async function startStatusDeck(status) {
    // 指定ステータスのカード参照を収集
    const cardRefs = [];
    for (const [key, value] of Object.entries(state.progress)) {
      if (value.status === status) {
        const [topicId, cardIndex] = key.split(':');
        cardRefs.push({ topicId, cardIndex: parseInt(cardIndex), key });
      }
    }

    if (cardRefs.length === 0) {
      return;
    }

    // 必要なトピックのQAファイルを取得
    const uniqueTopicIds = [...new Set(cardRefs.map(r => r.topicId))];
    const topicCardsMap = new Map();

    for (const topicId of uniqueTopicIds) {
      const topic = DATA.find(d => d.id === topicId);
      if (!topic || !topic.qaPath) continue;

      try {
        const response = await fetch(encodeURI(topic.qaPath));
        const text = await response.text();
        const cards = parseQAToCards(text, topicId);
        topicCardsMap.set(topicId, { cards, topic });
      } catch (e) {
        console.log(`QA読み込みエラー (${topicId}):`, e);
      }
    }

    // フィルタ済みカード配列を構築
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

    if (filteredCards.length === 0) {
      return;
    }

    // ステータスデッキとして開始
    state.currentTopicId = `__status_${status}`;
    state.currentTopic = { title: status === 'memorized' ? '確認デッキ' : '復習デッキ' };
    state.cards = filteredCards;
    state.filteredCards = [...filteredCards];
    state.currentIndex = 0;
    state.isFlipped = false;
    state.isActive = true;
    state.completed = false;
    state.answeredInSession = 0;
    state.combo = 0;

    // 常にシャッフル（覚えた順の固定出題を防ぐ）
    for (let i = state.filteredCards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [state.filteredCards[i], state.filteredCards[j]] = [state.filteredCards[j], state.filteredCards[i]];
    }

    // セッションサイズで制限
    if (state.filteredCards.length > state.sessionSize) {
      state.filteredCards = state.filteredCards.slice(0, state.sessionSize);
    }

    renderCard();
  }

  // === 検索結果デッキ ===
  function startSearchResultsDeck() {
    const results = state.cardSearch.results;
    const query = state.cardSearch.query;

    if (results.length === 0 || !query) {
      return;
    }

    // まとめを除外してカードのみを対象にする
    const cardResults = results.filter(item => item.type !== 'summary');
    if (cardResults.length === 0) {
      return;
    }

    // 検索結果のカードをfilteredCardsに設定
    const filteredCards = cardResults.map(card => ({
      ...card,
      // topicId, originalIndex, topicTitle, subject は既にある
      htmlPath: DATA.find(d => d.id === card.topicId)?.htmlPath || null
    }));

    // 検索結果デッキとして開始
    state.currentTopicId = `__search_${query}`;
    state.currentTopic = { title: `検索:${query}` };
    state.cards = filteredCards;
    state.filteredCards = [...filteredCards];
    state.currentIndex = 0;
    state.isFlipped = false;
    state.isActive = true;
    state.completed = false;
    state.answeredInSession = 0;
    state.combo = 0;

    // セッション復元
    const session = getSession(state.currentTopicId);
    if (session && session.order && session.order.length === state.filteredCards.length) {
      // 保存された順序で復元
      const orderMap = new Map(state.filteredCards.map(c => [c.searchKey, c]));
      const reordered = session.order.map(key => orderMap.get(key)).filter(Boolean);
      if (reordered.length === state.filteredCards.length) {
        state.filteredCards = reordered;
      }
      if (session.index !== undefined && session.index > 0) {
        state.currentIndex = Math.min(session.index, state.filteredCards.length - 1);
      }
    } else if (state.shuffleEnabled) {
      // 新規開始時のシャッフル
      for (let i = state.filteredCards.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [state.filteredCards[i], state.filteredCards[j]] = [state.filteredCards[j], state.filteredCards[i]];
      }
    }

    // 検索状態をクリア
    state.cardSearch.query = '';
    state.cardSearch.results = [];
    state.cardSearch.expandedKeys = new Set();

    renderCard();
  }

  // 検索結果デッキを再開
  async function resumeSearchDeck(topicId) {
    const query = topicId.replace('__search_', '');
    const session = getSession(topicId);

    if (!session || !session.order || session.order.length === 0) {
      // セッションがない場合はデッキ一覧に戻る
      renderDeckList();
      return;
    }

    // カードインデックスがなければ構築
    if (!state.cardSearch.allCardsIndex) {
      container.innerHTML = `
        <div class="card-search-screen">
          <div class="card-search-loading">カードを読み込み中...</div>
        </div>
      `;
      await loadAllCardsIndex();
    }

    // セッションの order（searchKeyの配列）からカードを復元
    const allCards = state.cardSearch.allCardsIndex;
    const cardMap = new Map(allCards.map(c => [c.searchKey, c]));

    const filteredCards = session.order
      .map(key => cardMap.get(key))
      .filter(Boolean)
      .map(card => ({
        ...card,
        htmlPath: DATA.find(d => d.id === card.topicId)?.htmlPath || null
      }));

    if (filteredCards.length === 0) {
      renderDeckList();
      return;
    }

    // デッキとして開始
    state.currentTopicId = topicId;
    state.currentTopic = { title: `検索:${query}` };
    state.cards = filteredCards;
    state.filteredCards = [...filteredCards];
    state.currentIndex = session.index !== undefined ? Math.min(session.index, filteredCards.length - 1) : 0;
    state.isFlipped = false;
    state.isActive = true;
    state.completed = false;
    state.answeredInSession = 0;
    state.combo = 0;

    // 検索状態をクリア
    state.cardSearch.query = '';
    state.cardSearch.results = [];
    state.cardSearch.expandedKeys = new Set();

    renderCard();
  }

  // === 今日のおすすめデッキ ===
  async function startRecommendedDeck() {
    const targetCount = state.sessionSize;
    const ratio = state.mixRatio || 'balanced';

    // 割合に応じてターゲット数を計算
    let newTarget, memorizedTarget;
    if (ratio === 'newHeavy') {
      newTarget = Math.ceil(targetCount * 0.7);      // 70% 新規
      memorizedTarget = targetCount - newTarget;     // 30% 覚えた
    } else if (ratio === 'reviewHeavy') {
      memorizedTarget = Math.ceil(targetCount * 0.7); // 70% 覚えた
      newTarget = targetCount - memorizedTarget;      // 30% 新規
    } else {
      newTarget = Math.ceil(targetCount * 0.5);       // 50% 新規
      memorizedTarget = targetCount - newTarget;      // 50% 覚えた
    }

    const cardRefs = [];

    // 1. 覚えたカードを収集
    for (const [key, value] of Object.entries(state.progress)) {
      if (value.status === 'memorized' && cardRefs.filter(r => r.type === 'memorized').length < memorizedTarget) {
        const [topicId, cardIndex] = key.split(':');
        cardRefs.push({ topicId, cardIndex: parseInt(cardIndex), key, type: 'memorized' });
      }
    }

    // 2. 新規（未学習）カードを収集
    const topicsWithQa = DATA.filter(d => d.qaPath);
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

    // 3. 足りない分を補充（新規 or 覚えた）
    const currentNew = cardRefs.filter(r => r.type === 'new').length;
    const currentMem = cardRefs.filter(r => r.type === 'memorized').length;
    const shortage = targetCount - currentNew - currentMem;

    if (shortage > 0) {
      // 新規で補充
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

    // トピックごとにQAファイルを読み込み
    const uniqueTopicIds = [...new Set(cardRefs.map(r => r.topicId))];
    const topicCardsMap = new Map();

    for (const topicId of uniqueTopicIds) {
      const topic = DATA.find(d => d.id === topicId);
      if (!topic || !topic.qaPath) continue;

      try {
        const response = await fetch(encodeURI(topic.qaPath));
        const text = await response.text();
        const cards = parseQAToCards(text, topicId);
        topicCardsMap.set(topicId, { cards, topic });
      } catch (e) {
        console.log(`QA読み込みエラー (${topicId}):`, e);
      }
    }

    // フィルタ済みカード配列を構築
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

    // おすすめデッキとして開始
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

    // シャッフル
    for (let i = state.filteredCards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [state.filteredCards[i], state.filteredCards[j]] = [state.filteredCards[j], state.filteredCards[i]];
    }

    // セッションサイズで制限
    if (state.filteredCards.length > state.sessionSize) {
      state.filteredCards = state.filteredCards.slice(0, state.sessionSize);
    }

    renderCard();
  }

  // 新規のみモードでデッキ開始
  async function startNewOnlyDeck() {
    const targetCount = state.sessionSize;
    const cardRefs = [];

    // 各トピックから未学習カードのみを収集
    const topicsWithQa = DATA.filter(d => d.qaPath);
    for (const topic of topicsWithQa) {
      if (cardRefs.length >= targetCount) break;

      // このトピックの進捗キーを取得
      const topicKeys = Object.keys(state.progress).filter(k => k.startsWith(topic.id + ':'));
      const learnedIndices = new Set(topicKeys.map(k => parseInt(k.split(':')[1])));

      // 未学習カードを追加
      for (let i = 0; i < 100 && cardRefs.length < targetCount; i++) {
        if (!learnedIndices.has(i)) {
          cardRefs.push({ topicId: topic.id, cardIndex: i, key: `${topic.id}:${i}` });
        }
      }
    }

    if (cardRefs.length === 0) return;

    // トピックごとにQAファイルを読み込み
    const uniqueTopicIds = [...new Set(cardRefs.map(r => r.topicId))];
    const topicCardsMap = new Map();

    for (const topicId of uniqueTopicIds) {
      const topic = DATA.find(d => d.id === topicId);
      if (!topic || !topic.qaPath) continue;

      try {
        const response = await fetch(encodeURI(topic.qaPath));
        const text = await response.text();
        const cards = parseQAToCards(text, topicId);
        topicCardsMap.set(topicId, { cards, topic });
      } catch (e) {
        console.log(`QA読み込みエラー (${topicId}):`, e);
      }
    }

    // フィルタ済みカード配列を構築
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

    // 新規のみデッキとして開始
    state.currentTopicId = '__new_only';
    state.currentTopic = { title: '新規カード' };
    state.cards = filteredCards;
    state.filteredCards = [...filteredCards];
    state.currentIndex = 0;
    state.isFlipped = false;
    state.isActive = true;
    state.completed = false;
    state.answeredInSession = 0;
    state.combo = 0;

    // シャッフル
    for (let i = state.filteredCards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [state.filteredCards[i], state.filteredCards[j]] = [state.filteredCards[j], state.filteredCards[i]];
    }

    // セッションサイズで制限
    if (state.filteredCards.length > state.sessionSize) {
      state.filteredCards = state.filteredCards.slice(0, state.sessionSize);
    }

    renderCard();
  }

  // === Q&Aパース ===
  function parseQAToCards(text, topicId) {
    const cards = [];
    const lines = text.split('\n');
    let currentSection = '';
    let currentQ = null;
    let currentSource = null;
    let currentSourceSection = null;
    let index = 0;

    // ココシカデッキの場合、科目名を特定
    let subjectName = null;
    if (topicId === 'kokoshika_hisshu') {
      subjectName = '必修';
    }

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.startsWith('## ')) {
        currentSection = trimmed.slice(3);
      } else if (trimmed.startsWith('@source: ')) {
        currentSource = trimmed.slice(9);
      } else if (trimmed.startsWith('@section: ')) {
        currentSourceSection = trimmed.slice(10);
      } else if (trimmed.startsWith('Q: ') || trimmed.startsWith('Q:')) {
        currentQ = trimmed.replace(/^Q:\s*/, '');
      } else if ((trimmed.startsWith('A: ') || trimmed.startsWith('A:')) && currentQ) {
        const answer = trimmed.replace(/^A:\s*/, '');
        const card = {
          index: index,
          originalIndex: index,
          section: currentSourceSection || currentSection,
          question: currentQ,
          answer: answer,
          topicId: topicId
        };
        // @sourceがある場合、HTMLパスを設定
        if (currentSource && subjectName) {
          card.htmlPath = `html/subject/${subjectName}/${currentSource}.html`;
        }
        cards.push(card);
        index++;
        currentQ = null;
        currentSource = null;
        currentSourceSection = null;
      }
    }

    return cards;
  }

  // === カード検索機能 ===

  // 全カードのインデックスを読み込み（事前生成されたJSONから）
  async function loadAllCardsIndex(progressCallback) {
    if (state.cardSearch.allCardsIndex) {
      return state.cardSearch.allCardsIndex;
    }

    state.cardSearch.isIndexing = true;

    try {
      if (progressCallback) {
        progressCallback(0, 1);
      }

      // 事前生成されたインデックスJSONを読み込み
      const response = await fetch('search-index.json');
      if (!response.ok) {
        throw new Error('search-index.json not found');
      }

      const allItems = await response.json();

      if (progressCallback) {
        progressCallback(1, 1);
      }

      state.cardSearch.allCardsIndex = allItems;
      state.cardSearch.isIndexing = false;
      return allItems;

    } catch (e) {
      console.error('検索インデックスの読み込みに失敗:', e);
      state.cardSearch.isIndexing = false;
      return [];
    }
  }

  // カード検索を実行
  function searchCards(query) {
    if (!state.cardSearch.allCardsIndex || !query.trim()) {
      return [];
    }

    const normalizedQuery = query.toLowerCase().trim();
    const terms = normalizedQuery.split(/\s+/).filter(t => t.length > 0);

    const results = state.cardSearch.allCardsIndex.filter(item => {
      // カードの場合は question と answer を検索
      // まとめの場合は searchText を検索
      const searchTarget = item.type === 'summary'
        ? (item.searchText || '').toLowerCase()
        : `${item.question} ${item.answer}`.toLowerCase();
      return terms.every(term => searchTarget.includes(term));
    });

    return results.slice(0, 100);
  }

  // 検索結果のハイライト処理
  function highlightText(text, query) {
    if (!query.trim()) return escapeHtml(text);
    const terms = query.toLowerCase().trim().split(/\s+/).filter(t => t.length > 0);
    let result = escapeHtml(text);
    terms.forEach(term => {
      const regex = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
      result = result.replace(regex, '<mark class="card-search-highlight">$1</mark>');
    });
    return result;
  }

  // カード検索画面をレンダリング
  async function renderCardSearchScreen(initialQuery = '', showAllResults = false) {
    state.cardSearch.expandedKeys = new Set();
    state.cardSearch.showAll = showAllResults;  // 全件表示フラグ
    // クエリが渡された場合は保持、そうでなければクリア
    if (!initialQuery) {
      state.cardSearch.query = '';
      state.cardSearch.results = [];
    }

    // タブバーを隠す（検索結果エリアを広く取るため）
    const tabbar = document.querySelector('.floating-tabbar');
    if (tabbar) tabbar.classList.add('hidden');

    container.innerHTML = `
      <div class="card-search-screen">
        <div class="card-search-header">
          <button class="card-search-back-btn" id="card-search-back">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
          </button>
          <h2 class="card-search-title">カード検索</h2>
        </div>
        <div class="card-search-input-wrapper">
          <svg class="card-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/>
            <path d="M21 21l-4.35-4.35"/>
          </svg>
          <input type="text" id="card-search-input" class="card-search-input"
                 placeholder="質問・回答を検索..." autocomplete="off">
          <button class="card-search-clear" id="card-search-clear" style="display:none;">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
          </button>
        </div>
        <div class="card-search-status" id="card-search-status"></div>
        <div class="card-search-results" id="card-search-results"></div>
      </div>
    `;

    // イベントバインド
    bindCardSearchEvents();

    // インデックスがなければ構築
    if (!state.cardSearch.allCardsIndex) {
      const statusEl = document.getElementById('card-search-status');
      if (statusEl) {
        statusEl.innerHTML = '<div class="card-search-loading">カードを読み込み中...</div>';
      }
      await loadAllCardsIndex((loaded, total) => {
        if (statusEl) {
          const percent = Math.round((loaded / total) * 100);
          statusEl.innerHTML = `<div class="card-search-loading">カードを読み込み中... ${percent}%</div>`;
        }
      });
      if (statusEl) {
        statusEl.innerHTML = '';
      }
    }

    // 入力欄にフォーカス
    const input = document.getElementById('card-search-input');
    const clearBtn = document.getElementById('card-search-clear');

    // 初期クエリがある場合は設定して検索実行
    if (initialQuery && input) {
      input.value = initialQuery;
      if (clearBtn) clearBtn.style.display = 'flex';
      // 検索結果をレンダリング
      renderCardSearchResults();
    } else if (input) {
      input.focus();
    }
  }

  // カード検索画面のイベントバインド
  function bindCardSearchEvents() {
    const backBtn = document.getElementById('card-search-back');
    const input = document.getElementById('card-search-input');
    const clearBtn = document.getElementById('card-search-clear');
    let debounceTimer = null;

    if (backBtn) {
      backBtn.addEventListener('click', () => {
        state.cardSearch.query = '';
        state.cardSearch.results = [];
        state.cardSearch.expandedKeys = new Set();
        // タブバーを再表示
        const tabbar = document.querySelector('.floating-tabbar');
        if (tabbar) tabbar.classList.remove('hidden');
        renderDeckList();
      });
    }

    if (input) {
      input.addEventListener('input', function() {
        const query = this.value;
        if (clearBtn) {
          clearBtn.style.display = query ? 'flex' : 'none';
        }
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          state.cardSearch.query = query;
          state.cardSearch.results = searchCards(query);
          state.cardSearch.showAll = false;  // 新しい検索では5件表示に戻す
          renderCardSearchResults();
        }, 300);
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (input) {
          input.value = '';
          input.focus();
        }
        clearBtn.style.display = 'none';
        state.cardSearch.query = '';
        state.cardSearch.results = [];
        renderCardSearchResults();
      });
    }
  }

  // 検索結果をレンダリング
  function renderCardSearchResults() {
    const resultsEl = document.getElementById('card-search-results');
    const statusEl = document.getElementById('card-search-status');
    if (!resultsEl) return;

    const query = state.cardSearch.query;
    const results = state.cardSearch.results;

    if (!query.trim()) {
      resultsEl.innerHTML = '<div class="card-search-hint">検索キーワードを入力してください</div>';
      if (statusEl) statusEl.innerHTML = '';
      return;
    }

    if (results.length === 0) {
      resultsEl.innerHTML = `<div class="card-search-empty">「${escapeHtml(query)}」に一致する結果はありません</div>`;
      if (statusEl) statusEl.innerHTML = '';
      return;
    }

    // カードとまとめを分けてカウント
    const cardResults = results.filter(r => r.type !== 'summary');
    const summaryResults = results.filter(r => r.type === 'summary');

    if (statusEl) {
      let statusHtml = '<div class="card-search-status-row">';
      statusHtml += `<div class="card-search-count">${results.length}件見つかりました`;
      if (cardResults.length > 0 && summaryResults.length > 0) {
        statusHtml += `（カード${cardResults.length}件 + まとめ${summaryResults.length}件）`;
      }
      statusHtml += `${results.length >= 100 ? '（上限100件）' : ''}</div>`;

      // カードがある場合のみ演習ボタンを表示
      if (cardResults.length > 0) {
        statusHtml += `<button class="card-search-start-deck-btn" id="card-search-start-deck">${cardResults.length}件で演習</button>`;
      }
      statusHtml += '</div>';
      statusEl.innerHTML = statusHtml;

      // 演習開始ボタンのイベント
      const startDeckBtn = document.getElementById('card-search-start-deck');
      if (startDeckBtn) {
        startDeckBtn.addEventListener('click', () => {
          startSearchResultsDeck();
        });
      }
    }

    // 表示件数制限（デフォルト5件）
    const DISPLAY_LIMIT = 5;
    const displayResults = state.cardSearch.showAll ? results : results.slice(0, DISPLAY_LIMIT);
    const hasMore = results.length > DISPLAY_LIMIT && !state.cardSearch.showAll;
    const remainingCount = results.length - DISPLAY_LIMIT;

    let html = displayResults.map(item => {
      const isExpanded = state.cardSearch.expandedKeys.has(item.searchKey);

      // まとめの場合
      if (item.type === 'summary') {
        return `
          <div class="card-search-item" data-key="${escapeHtml(item.searchKey)}">
            <div class="card-search-card">
              <div class="card-search-question">${escapeHtml(item.topicTitle)}</div>
            </div>
            <div class="card-search-footer">
              <div class="card-search-meta">${escapeHtml(item.subject)}</div>
              <button class="card-search-summary-link" data-topic-id="${escapeHtml(item.topicId)}">まとめを見る</button>
            </div>
          </div>
        `;
      }

      // カードの場合
      return `
        <div class="card-search-item ${isExpanded ? 'expanded' : ''}" data-key="${escapeHtml(item.searchKey)}">
          <div class="card-search-card" data-key="${escapeHtml(item.searchKey)}">
            <div class="card-search-question">Q: ${highlightText(item.question, query)}</div>
            ${isExpanded ? `<div class="card-search-answer">A: ${highlightText(item.answer, query)}</div>` : ''}
          </div>
          <div class="card-search-footer">
            <div class="card-search-meta">${escapeHtml(item.subject)} › ${escapeHtml(item.topicTitle)}</div>
            <button class="card-search-deck-link" data-topic-id="${escapeHtml(item.topicId)}">演習</button>
          </div>
        </div>
      `;
    }).join('');

    // 「他○件を表示」リンク
    if (hasMore) {
      html += `<button class="card-search-show-more" id="card-search-show-more">他${remainingCount}件を表示...</button>`;
    }

    resultsEl.innerHTML = html;

    // カードクリックで展開/折りたたみ
    resultsEl.querySelectorAll('.card-search-card').forEach(cardEl => {
      cardEl.addEventListener('click', (e) => {
        const key = cardEl.dataset.key;
        if (state.cardSearch.expandedKeys.has(key)) {
          state.cardSearch.expandedKeys.delete(key);
        } else {
          state.cardSearch.expandedKeys.add(key);
        }
        renderCardSearchResults();
      });
    });

    // 演習ボタンクリック（カード）
    resultsEl.querySelectorAll('.card-search-deck-link').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const topicId = btn.dataset.topicId;
        state.cardSearch.query = '';
        state.cardSearch.results = [];
        state.cardSearch.expandedKeys = new Set();
        state.isReviewMode = false;
        await loadTopic(topicId, state.shuffleEnabled);
      });
    });

    // まとめを見るボタンクリック
    resultsEl.querySelectorAll('.card-search-summary-link').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const topicId = btn.dataset.topicId;

        // 検索状態をクリア
        state.cardSearch.query = '';
        state.cardSearch.results = [];
        state.cardSearch.expandedKeys = new Set();
        state.isActive = false;

        // タブバーを表示に戻す
        exitPracticeMode();
        const tabbar = document.querySelector('.floating-tabbar');
        if (tabbar) tabbar.classList.remove('hidden');

        // まとめタブに切り替え
        if (typeof window.switchTab === 'function') {
          window.switchTab('html');
        }

        // selectItemでトピックを読み込み
        if (typeof window.selectItem === 'function') {
          window.selectItem(topicId);
        }
      });
    });

    // 「他○件を表示」ボタンクリック
    const showMoreBtn = document.getElementById('card-search-show-more');
    if (showMoreBtn) {
      showMoreBtn.addEventListener('click', () => {
        state.cardSearch.showAll = true;
        renderCardSearchResults();
      });
    }
  }

  // === インライン検索結果をレンダリング ===
  function renderInlineSearchResults() {
    const resultsEl = document.getElementById('card-search-inline-results');
    if (!resultsEl) return;

    const query = state.cardSearch.query;
    const results = state.cardSearch.results;

    if (!query.trim()) {
      resultsEl.style.display = 'none';
      return;
    }

    resultsEl.style.display = 'block';

    if (results.length === 0) {
      resultsEl.innerHTML = `<div class="card-search-empty">「${escapeHtml(query)}」に一致する結果はありません</div>`;
      return;
    }

    // カードとまとめを分けてカウント
    const cardResults = results.filter(r => r.type !== 'summary');
    const summaryResults = results.filter(r => r.type === 'summary');

    let html = '<div class="card-search-inline-status">';
    html += `<span class="card-search-count">${results.length}件`;
    if (cardResults.length > 0 && summaryResults.length > 0) {
      html += `（カード${cardResults.length}件 + まとめ${summaryResults.length}件）`;
    }
    html += `${results.length >= 100 ? '（上限100件）' : ''}</span>`;

    // カードがある場合のみ演習ボタンを表示
    if (cardResults.length > 0) {
      html += `<button class="card-search-start-deck-btn" id="inline-start-deck">${cardResults.length}件で演習</button>`;
    }
    html += '</div>';

    html += '<div class="card-search-inline-list">';
    const INLINE_LIMIT = 5;
    html += results.slice(0, INLINE_LIMIT).map(item => {
      const isExpanded = state.cardSearch.expandedKeys.has(item.searchKey);

      // まとめの場合
      if (item.type === 'summary') {
        return `
          <div class="card-search-item" data-key="${escapeHtml(item.searchKey)}">
            <div class="card-search-card">
              <div class="card-search-question">${escapeHtml(item.topicTitle)}</div>
            </div>
            <div class="card-search-footer">
              <div class="card-search-meta">${escapeHtml(item.subject)}</div>
              <button class="card-search-summary-link" data-topic-id="${escapeHtml(item.topicId)}">まとめを見る</button>
            </div>
          </div>
        `;
      }

      // カードの場合
      return `
        <div class="card-search-item ${isExpanded ? 'expanded' : ''}" data-key="${escapeHtml(item.searchKey)}">
          <div class="card-search-card" data-key="${escapeHtml(item.searchKey)}">
            <div class="card-search-question">Q: ${highlightText(item.question, query)}</div>
            ${isExpanded ? `<div class="card-search-answer">A: ${highlightText(item.answer, query)}</div>` : ''}
          </div>
          <div class="card-search-footer">
            <div class="card-search-meta">${escapeHtml(item.subject)} › ${escapeHtml(item.topicTitle)}</div>
            <button class="card-search-deck-link" data-topic-id="${escapeHtml(item.topicId)}">演習</button>
          </div>
        </div>
      `;
    }).join('');

    if (results.length > INLINE_LIMIT) {
      html += `<button class="card-search-more-btn" id="card-search-show-all">他${results.length - INLINE_LIMIT}件を表示...</button>`;
    }
    html += '</div>';

    resultsEl.innerHTML = html;

    // イベントバインド
    bindInlineSearchEvents(resultsEl);

    // 全件表示ボタン
    const showAllBtn = document.getElementById('card-search-show-all');
    if (showAllBtn) {
      showAllBtn.addEventListener('click', () => {
        renderCardSearchScreen(state.cardSearch.query, true);  // 全件表示
      });
    }
  }

  // インライン検索結果のイベントバインド
  function bindInlineSearchEvents(resultsEl) {
    // 演習開始ボタン
    const startDeckBtn = document.getElementById('inline-start-deck');
    if (startDeckBtn) {
      startDeckBtn.addEventListener('click', () => {
        startSearchResultsDeck();
      });
    }

    // カードクリックで展開/折りたたみ
    resultsEl.querySelectorAll('.card-search-card').forEach(cardEl => {
      cardEl.addEventListener('click', (e) => {
        const key = cardEl.dataset.key;
        if (!key) return;
        if (state.cardSearch.expandedKeys.has(key)) {
          state.cardSearch.expandedKeys.delete(key);
        } else {
          state.cardSearch.expandedKeys.add(key);
        }
        renderInlineSearchResults();
      });
    });

    // 演習ボタンクリック
    resultsEl.querySelectorAll('.card-search-deck-link').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const topicId = btn.dataset.topicId;
        state.cardSearch.query = '';
        state.cardSearch.results = [];
        state.cardSearch.expandedKeys = new Set();
        state.isReviewMode = false;
        await loadTopic(topicId, state.shuffleEnabled);
      });
    });

    // まとめを見るボタンクリック
    resultsEl.querySelectorAll('.card-search-summary-link').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const topicId = btn.dataset.topicId;

        state.cardSearch.query = '';
        state.cardSearch.results = [];
        state.cardSearch.expandedKeys = new Set();
        state.isActive = false;

        exitPracticeMode();

        if (typeof window.switchTab === 'function') {
          window.switchTab('html');
        }

        if (typeof window.selectItem === 'function') {
          window.selectItem(topicId);
        }
      });
    });
  }

  // === 演習モード制御（タブバー・フローティングボタンを隠す） ===
  function enterPracticeMode() {
    document.body.classList.add('is-practice');
    const tabbar = document.querySelector('.floating-tabbar');
    if (tabbar) tabbar.classList.add('exercise-hidden');
  }

  function exitPracticeMode() {
    document.body.classList.remove('is-practice');
    const tabbar = document.querySelector('.floating-tabbar');
    if (tabbar) tabbar.classList.remove('exercise-hidden');
  }

  // === 特殊デッキ判定（おまかせ、覚えた、もう一度など - 問数制限あり） ===
  function isSpecialDeck() {
    if (!state.currentTopicId) return false;
    // 検索結果デッキは特殊デッキから除外（全問出題）
    if (state.currentTopicId.startsWith('__search_')) return false;
    // それ以外の__で始まるデッキは特殊デッキ
    return state.currentTopicId.startsWith('__');
  }

  // === カード表示 ===
  function renderCard() {
    enterPracticeMode(); // 演習中はUI要素を隠す

    const card = state.filteredCards[state.currentIndex];
    if (!card) return;

    // ステータスデッキの場合はcard.topicIdを使用
    const keyTopicId = card.topicId || state.currentTopicId;
    const key = `${keyTopicId}:${card.originalIndex}`;
    const progress = state.progress[key];

    const current = state.currentIndex + 1;
    const total = state.filteredCards.length;
    const progressPercent = (current / total) * 100;
    // 再出題待ちカード数（_reinsertCountを持つカード）
    const pendingAgain = state.filteredCards.slice(state.currentIndex + 1).filter(c => c._reinsertCount).length;
    // 特殊デッキかどうか
    const showSizeBtn = isSpecialDeck();

    container.innerHTML = `
      <div class="flashcard-exercise ${state.isFlipped ? 'flipped' : ''}">
        <!-- ヘッダー -->
        <div class="flashcard-header">
          <button class="flashcard-back-btn" id="flashcard-back-btn" aria-label="戻る">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
          </button>
          <div class="flashcard-progress-bar">
            <div class="flashcard-progress-fill" style="width: ${progressPercent}%"></div>
            <span class="flashcard-progress-text">${current} / ${total}${pendingAgain > 0 ? ` <span class="progress-pending">再${pendingAgain}</span>` : ''}</span>
            ${showSizeBtn ? `<button class="flashcard-size-btn" id="flashcard-size-btn" aria-label="問数変更">${state.sessionSize}</button>` : ''}
          </div>
          <div class="flashcard-header-actions">
            ${!showSizeBtn ? `<button class="flashcard-shuffle-btn ${state.shuffleEnabled ? 'active' : ''}" id="flashcard-shuffle-btn" aria-label="シャッフル">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>
              </svg>
            </button>` : ''}
            <button class="flashcard-report-btn" id="flashcard-report-btn" aria-label="問題を報告">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
                <line x1="4" y1="22" x2="4" y2="15"/>
              </svg>
            </button>
          </div>
        </div>

        <!-- メインステージ（カード中央配置） -->
        <div class="flashcard-stage">
          <div class="flashcard-card-container" id="flashcard-card-container">
            <div class="flashcard-card ${state.isFlipped ? 'flipped' : ''}" id="flashcard-card">
              <div class="flashcard-card-inner">
                <div class="flashcard-question">
                  ${card.question}
                </div>
                <!-- タップヒント（カード内、表面のみ） -->
                <div class="flashcard-tap-hint ${state.isFlipped ? 'hide' : ''}" id="tap-hint">
                  タップで答え
                </div>
                <div class="flashcard-answer">
                  ${card.answer}
                </div>
              </div>
              <div class="swipe-overlay swipe-left" id="swipe-overlay-left">
                <span>もう一度</span>
              </div>
              <div class="swipe-overlay swipe-right" id="swipe-overlay-right">
                <span>覚えた</span>
              </div>
            </div>
          </div>

          <!-- まとめ（読み込み成功時のみ表示） -->
          <div class="flashcard-summary ${state.summaryCollapsed ? 'collapsed' : ''}" id="flashcard-summary">
            <div class="flashcard-summary-header" id="flashcard-summary-toggle">
              <span>まとめ</span>
              <div class="summary-header-actions">
                <button class="summary-save-btn" id="summary-save-btn" title="画像として保存">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="3" y="3" width="18" height="18" rx="2"/>
                    <circle cx="8.5" cy="8.5" r="1.5"/>
                    <path d="M21 15l-5-5L5 21"/>
                  </svg>
                </button>
                <svg class="summary-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M6 9l6 6 6-6"/>
                </svg>
              </div>
            </div>
            <div class="flashcard-summary-content" id="flashcard-summary-content">
            </div>
          </div>
        </div>

        <!-- アクションバー（flexレイアウトで下部配置） -->
        <div class="flashcard-action-bar ${state.isFlipped ? 'show' : ''}">
          <button class="flashcard-btn again" id="flashcard-again-btn">
            もう一度
          </button>
          <button class="flashcard-btn memorized" id="flashcard-memorized-btn">
            覚えた
          </button>
        </div>

      </div>

      <!-- Undoスナックバー -->
      <div class="flashcard-snackbar" id="flashcard-snackbar">
        <span class="snackbar-message" id="snackbar-message"></span>
        <button class="snackbar-undo" id="flashcard-undo-btn">元に戻す</button>
      </div>
    `;

    bindCardEvents();

    // カード入場アニメーション（ふわっ）
    const cardEl = document.getElementById('flashcard-card');
    if (cardEl) {
      cardEl.classList.add('entering');
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          cardEl.classList.remove('entering');
        });
      });
    }

    // 初回のみタップヒントをパルス
    if (!localStorage.getItem('flashcard-hint-shown')) {
      const hint = document.getElementById('tap-hint');
      if (hint) {
        hint.classList.add('pulse');
        setTimeout(() => {
          hint.classList.remove('pulse');
          localStorage.setItem('flashcard-hint-shown', 'true');
        }, 2000);
      }
    }

    // まとめを読み込み（ステータスデッキの場合はcard.htmlPathを優先）
    const htmlPath = card.htmlPath || (state.currentTopic && state.currentTopic.htmlPath);
    if (htmlPath) {
      loadHtmlSummary(htmlPath, card.section);
    }
  }

  function renderNoCardsMessage() {
    container.innerHTML = `
      <div class="flashcard-no-cards">
        <div class="flashcard-no-cards-icon">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
          </svg>
        </div>
        <h3>復習するカードがありません</h3>
        <p>「もう一度」のカードがないか、まだ学習を開始していません。</p>
        <button class="flashcard-back-btn-large" id="flashcard-back-btn">
          トピック選択に戻る
        </button>
      </div>
    `;

    document.getElementById('flashcard-back-btn').addEventListener('click', goBack);
  }

  function bindCardEvents() {
    // 戻るボタン
    document.getElementById('flashcard-back-btn').addEventListener('click', goBack);

    // 問数変更ボタン（特殊デッキのみ表示）
    const sizeBtn = document.getElementById('flashcard-size-btn');
    if (sizeBtn) sizeBtn.addEventListener('click', cycleSessionSize);

    // シャッフルボタン（通常デッキのみ表示）
    const shuffleBtn = document.getElementById('flashcard-shuffle-btn');
    if (shuffleBtn) shuffleBtn.addEventListener('click', toggleShuffle);

    // 報告ボタン
    document.getElementById('flashcard-report-btn').addEventListener('click', reportCurrentCard);

    // カードタップ
    const cardContainer = document.getElementById('flashcard-card-container');
    cardContainer.addEventListener('click', flip);

    // スワイプ（ステージ全体で判定 = カード + まとめエリア）
    const stage = document.querySelector('.flashcard-stage');
    stage.addEventListener('touchstart', onTouchStart, { passive: true });
    stage.addEventListener('touchmove', onTouchMove, { passive: true });
    stage.addEventListener('touchend', onTouchEnd, { passive: true });

    // 学習ボタン
    document.getElementById('flashcard-memorized-btn').addEventListener('click', markMemorized);
    document.getElementById('flashcard-again-btn').addEventListener('click', markAgain);

    // Undoボタン
    document.getElementById('flashcard-undo-btn').addEventListener('click', undo);

    // まとめ折りたたみトグル
    document.getElementById('flashcard-summary-toggle').addEventListener('click', toggleSummary);

    // まとめ画像保存ボタン
    document.getElementById('summary-save-btn')?.addEventListener('click', (e) => {
      e.stopPropagation(); // 折りたたみトグルを防止
      saveSummaryAsImage();
    });
  }

  // === まとめ折りたたみ ===
  function toggleSummary() {
    state.summaryCollapsed = !state.summaryCollapsed;
    localStorage.setItem('flashcard-summary-collapsed', state.summaryCollapsed);

    const summary = document.getElementById('flashcard-summary');
    if (summary) {
      summary.classList.toggle('collapsed', state.summaryCollapsed);
    }
  }

  // まとめを画像として保存（長押しで保存できるプレビュー表示）
  async function saveSummaryAsImage() {
    const content = document.getElementById('flashcard-summary-content');
    if (!content || typeof html2canvas === 'undefined') return;

    // スクロールを一時的にリセット（全体をキャプチャするため）
    const originalOverflow = content.style.overflow;
    const originalMaxHeight = content.style.maxHeight;
    content.style.overflow = 'visible';
    content.style.maxHeight = 'none';

    // 全要素の色を直接インラインスタイルで黒に変更（元のスタイルを保存）
    const elements = content.querySelectorAll('*');
    const originalStyles = [];
    elements.forEach((el, i) => {
      originalStyles[i] = {
        color: el.style.color,
        webkitTextFillColor: el.style.webkitTextFillColor,
        backgroundColor: el.style.backgroundColor
      };
      el.style.color = '#1c1c1e';
      el.style.webkitTextFillColor = '#1c1c1e';
      if (el.tagName === 'TH') {
        el.style.backgroundColor = '#f2f2f7';
      } else if (el.tagName === 'TD') {
        el.style.backgroundColor = '#ffffff';
      }
    });
    content.style.backgroundColor = '#ffffff';

    try {
      const canvas = await html2canvas(content, {
        backgroundColor: '#ffffff',
        scale: 2,
        useCORS: true
      });

      const dataUrl = canvas.toDataURL('image/png');

      // プレビューオーバーレイを作成
      const overlay = document.createElement('div');
      overlay.className = 'image-preview-overlay';
      overlay.innerHTML = `
        <div class="image-preview-container">
          <div class="image-preview-header">
            <span>長押しで写真に保存</span>
            <button class="image-preview-close" id="image-preview-close">✕</button>
          </div>
          <div class="image-preview-body">
            <img src="${dataUrl}" alt="まとめ" />
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      // 閉じるボタン
      document.getElementById('image-preview-close').addEventListener('click', () => {
        overlay.remove();
      });

      // オーバーレイ背景クリックで閉じる
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          overlay.remove();
        }
      });

    } finally {
      // 元のスタイルを復元
      elements.forEach((el, i) => {
        el.style.color = originalStyles[i].color;
        el.style.webkitTextFillColor = originalStyles[i].webkitTextFillColor;
        el.style.backgroundColor = originalStyles[i].backgroundColor;
      });
      content.style.backgroundColor = '';
      content.style.overflow = originalOverflow;
      content.style.maxHeight = originalMaxHeight;
    }
  }

  // === スワイプ処理 ===
  const SWIPE_THRESHOLD = 72;
  let swipeRAF = null;
  let swipeDiffX = 0;
  let swipeDiffY = 0;

  function onTouchStart(e) {
    state.touchStartX = e.touches[0].clientX;
    state.touchStartY = e.touches[0].clientY;
    swipeDiffX = 0;
    swipeDiffY = 0;

    const card = document.getElementById('flashcard-card');
    if (card) {
      card.classList.add('swiping');
      card.style.transition = 'none';
    }
  }

  function onTouchMove(e) {
    swipeDiffX = e.touches[0].clientX - state.touchStartX;
    swipeDiffY = e.touches[0].clientY - state.touchStartY;

    // 縦スクロールが優勢なら何もしない
    if (Math.abs(swipeDiffY) > Math.abs(swipeDiffX) * 0.8) return;

    // rAFでまとめて更新（60fps維持）
    if (!swipeRAF) {
      swipeRAF = requestAnimationFrame(updateSwipeVisuals);
    }
  }

  function updateSwipeVisuals() {
    swipeRAF = null;

    const card = document.getElementById('flashcard-card');
    const overlayLeft = document.getElementById('swipe-overlay-left');
    const overlayRight = document.getElementById('swipe-overlay-right');

    if (!card || !overlayLeft || !overlayRight) return;

    // カードを移動（横は1:1追従、縦は弱める）
    const moveX = Math.max(-150, Math.min(150, swipeDiffX * 0.6));
    const moveY = swipeDiffY * 0.1;
    const rotation = Math.max(-6, Math.min(6, moveX / 18));
    card.style.transform = `translate3d(${moveX}px,${moveY}px,0) rotate(${rotation}deg)`;

    // オーバーレイの透明度（閾値に近づくほど濃く）
    const progress = Math.min(1, Math.abs(swipeDiffX) / SWIPE_THRESHOLD);
    const exceeded = Math.abs(swipeDiffX) >= SWIPE_THRESHOLD;

    if (swipeDiffX < -20) {
      // 左スワイプ → もう一度（オレンジ）
      overlayLeft.style.opacity = progress;
      overlayRight.style.opacity = 0;
      overlayLeft.classList.toggle('pop', exceeded);
      overlayRight.classList.remove('pop');
    } else if (swipeDiffX > 20) {
      // 右スワイプ → 覚えた（緑）
      overlayRight.style.opacity = progress;
      overlayLeft.style.opacity = 0;
      overlayRight.classList.toggle('pop', exceeded);
      overlayLeft.classList.remove('pop');
    } else {
      overlayLeft.style.opacity = 0;
      overlayRight.style.opacity = 0;
      overlayLeft.classList.remove('pop');
      overlayRight.classList.remove('pop');
    }
  }

  function onTouchEnd(e) {
    // rAFをキャンセル
    if (swipeRAF) {
      cancelAnimationFrame(swipeRAF);
      swipeRAF = null;
    }

    const diffX = e.changedTouches[0].clientX - state.touchStartX;
    const diffY = e.changedTouches[0].clientY - state.touchStartY;

    const card = document.getElementById('flashcard-card');
    const overlayLeft = document.getElementById('swipe-overlay-left');
    const overlayRight = document.getElementById('swipe-overlay-right');

    // リセット（ぬるっとeasingで戻す）
    if (card) {
      card.classList.remove('swiping');
      card.style.transition = 'transform 180ms cubic-bezier(.2,.9,.2,1)';
      card.style.transform = '';
    }
    if (overlayLeft) {
      overlayLeft.style.opacity = 0;
      overlayLeft.classList.remove('pop');
    }
    if (overlayRight) {
      overlayRight.style.opacity = 0;
      overlayRight.classList.remove('pop');
    }

    // 横方向のスワイプが縦より大きい場合
    if (Math.abs(diffX) > SWIPE_THRESHOLD && Math.abs(diffX) > Math.abs(diffY) * 1.5) {
      if (diffX < 0) {
        // 左スワイプ → もう一度
        markAgain();
      } else {
        // 右スワイプ → 覚えた
        markMemorized();
      }
    }
  }

  // === カード操作 ===
  function flip() {
    state.isFlipped = !state.isFlipped;
    const exercise = document.querySelector('.flashcard-exercise');
    const card = document.getElementById('flashcard-card');
    const actionBar = document.querySelector('.flashcard-action-bar');
    const summary = document.getElementById('flashcard-summary');
    const tapHint = document.querySelector('.flashcard-tap-hint');

    if (state.isFlipped) {
      if (exercise) exercise.classList.add('flipped');
      if (card) card.classList.add('flipped');
      if (actionBar) actionBar.classList.add('show');
      // まとめはコンテンツがある場合のみ表示
      if (summary && summary.classList.contains('has-content')) {
        summary.classList.add('show');
      }
      if (tapHint) tapHint.classList.add('hide');
    } else {
      if (exercise) exercise.classList.remove('flipped');
      if (card) card.classList.remove('flipped');
      if (actionBar) actionBar.classList.remove('show');
      if (summary) summary.classList.remove('show');
      if (tapHint) tapHint.classList.remove('hide');
    }
  }

  function next() {
    if (state.currentIndex < state.filteredCards.length - 1) {
      state.currentIndex++;
      state.isFlipped = false;
      renderCard();
    }
  }

  function prev() {
    if (state.currentIndex > 0) {
      state.currentIndex--;
      state.isFlipped = false;
      renderCard();
    }
  }

  // === Undo用のステート保存 ===
  function saveUndoState(action) {
    const card = state.filteredCards[state.currentIndex];
    state.undoState = {
      action: action, // 'memorized' or 'again'
      index: state.currentIndex,
      filteredCards: [...state.filteredCards],
      progressSnapshot: { ...state.progress },
      card: card
    };
  }

  // === Undo実行 ===
  function undo() {
    if (!state.undoState) return;

    // スナックバーを隠す
    hideSnackbar();

    // 状態を復元
    state.filteredCards = state.undoState.filteredCards;
    state.currentIndex = state.undoState.index;
    state.progress = state.undoState.progressSnapshot;
    state.isFlipped = false;

    // 進捗を保存
    saveProgress();

    // Undo状態をクリア
    state.undoState = null;
    if (state.undoTimer) {
      clearTimeout(state.undoTimer);
      state.undoTimer = null;
    }

    // 再描画
    renderCard();
  }

  // === トースト表示 ===
  function showToast(message, duration = 1200) {
    // 既存のトーストがあれば削除
    const existingToast = document.querySelector('.flashcard-toast');
    if (existingToast) {
      existingToast.remove();
    }

    const toast = document.createElement('div');
    toast.className = 'flashcard-toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    // フェードイン
    requestAnimationFrame(() => {
      toast.classList.add('show');
    });

    // 自動削除
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  // === カード報告機能（Google Forms送信） ===
  const GOOGLE_FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSfNxFF5NrMxgNdhFq24jGTd1pGBd5-dlAWQOb1eX1kqDqz4WA/formResponse';
  const FORM_ENTRIES = {
    subject: 'entry.164360725',
    topic: 'entry.300876290',
    section: 'entry.676904274',
    question: 'entry.338182143',
    answer: 'entry.1207584254'
  };

  function reportCurrentCard() {
    const card = state.filteredCards[state.currentIndex];
    if (!card) return;

    const keyTopicId = card.topicId || state.currentTopicId;
    const topicData = DATA.find(d => d.id === keyTopicId);

    // 報告データを作成
    const reportData = {
      subject: topicData?.subject || '',
      topic: card.topicTitle || topicData?.title || keyTopicId,
      section: card.section || '',
      question: card.question,
      answer: card.answer
    };

    // ボタンにフィードバック（送信中）
    const btn = document.getElementById('flashcard-report-btn');
    if (btn) {
      btn.classList.add('sending');
    }

    // Google Formsに送信
    const formData = new FormData();
    formData.append(FORM_ENTRIES.subject, reportData.subject);
    formData.append(FORM_ENTRIES.topic, reportData.topic);
    formData.append(FORM_ENTRIES.section, reportData.section);
    formData.append(FORM_ENTRIES.question, reportData.question);
    formData.append(FORM_ENTRIES.answer, reportData.answer);

    fetch(GOOGLE_FORM_URL, {
      method: 'POST',
      mode: 'no-cors',
      body: formData
    }).then(() => {
      // 送信完了
      if (btn) {
        btn.classList.remove('sending');
        btn.classList.add('reported');
        setTimeout(() => btn.classList.remove('reported'), 1500);
      }
      showToast('報告しました', 1200);
    }).catch(() => {
      if (btn) {
        btn.classList.remove('sending');
      }
      showToast('送信に失敗しました', 1500);
    });
  }

  // 報告一覧を取得
  function getReports() {
    try {
      const stored = localStorage.getItem(REPORTS_KEY);
      if (stored) return JSON.parse(stored);
    } catch (e) {}
    return [];
  }

  // 報告を削除
  function removeReport(reportId) {
    let reports = getReports();
    reports = reports.filter(r => r.id !== reportId);
    localStorage.setItem(REPORTS_KEY, JSON.stringify(reports));
    return reports;
  }

  // 全報告をクリア
  function clearAllReports() {
    localStorage.removeItem(REPORTS_KEY);
  }

  // 報告をテキストとしてエクスポート
  function exportReportsAsText() {
    const reports = getReports();
    if (reports.length === 0) return '報告されたカードはありません';

    const lines = ['# 報告されたカード一覧', ''];
    for (const r of reports) {
      lines.push(`## ${r.topicTitle} - ${r.section || '(セクションなし)'}`);
      lines.push(`Q: ${r.question}`);
      lines.push(`A: ${r.answer}`);
      lines.push(`報告日時: ${new Date(r.reportedAt).toLocaleString('ja-JP')}`);
      lines.push('');
    }
    return lines.join('\n');
  }

  // 報告一覧オーバーレイを開く
  function openReportsOverlay() {
    const reports = getReports();

    // オーバーレイを作成
    const overlay = document.createElement('div');
    overlay.className = 'reports-overlay';
    overlay.id = 'reports-overlay';
    overlay.innerHTML = `
      <div class="reports-modal">
        <div class="reports-modal-header">
          <h3>報告されたカード</h3>
          <button class="reports-close-btn" id="reports-close-btn">✕</button>
        </div>
        <div class="reports-modal-body">
          ${reports.length === 0 ? `
            <div class="reports-empty">
              報告されたカードはありません
            </div>
          ` : `
            <div class="reports-list">
              ${reports.map(r => `
                <div class="reports-item" data-report-id="${escapeHtml(r.id)}">
                  <div class="reports-item-header">
                    <span class="reports-item-topic">${escapeHtml(r.topicTitle)}</span>
                    <button class="reports-item-delete" data-id="${escapeHtml(r.id)}" title="削除">✕</button>
                  </div>
                  ${r.section ? `<span class="reports-item-section">${escapeHtml(r.section)}</span>` : ''}
                  <div class="reports-item-qa">
                    <div class="reports-item-q">Q: ${escapeHtml(r.question)}</div>
                    <div class="reports-item-a">A: ${escapeHtml(r.answer)}</div>
                  </div>
                </div>
              `).join('')}
            </div>
          `}
        </div>
        ${reports.length > 0 ? `
        <div class="reports-modal-footer">
          <button class="reports-copy-btn" id="reports-copy-btn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
            テキストをコピー
          </button>
          <button class="reports-clear-btn" id="reports-clear-btn">全て削除</button>
        </div>
        ` : ''}
      </div>
    `;
    document.body.appendChild(overlay);

    // イベント設定
    // 閉じるボタン
    document.getElementById('reports-close-btn').addEventListener('click', closeReportsOverlay);

    // 背景クリックで閉じる
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeReportsOverlay();
    });

    // コピーボタン
    const copyBtn = document.getElementById('reports-copy-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        const text = exportReportsAsText();
        try {
          await navigator.clipboard.writeText(text);
          copyBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M20 6L9 17l-5-5"/>
            </svg>
            コピーしました
          `;
          copyBtn.classList.add('copied');
          setTimeout(() => {
            copyBtn.innerHTML = `
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
              テキストをコピー
            `;
            copyBtn.classList.remove('copied');
          }, 2000);
        } catch (e) {
          showToast('コピーに失敗しました', 1500);
        }
      });
    }

    // 全削除ボタン
    const clearBtn = document.getElementById('reports-clear-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (confirm('報告を全て削除しますか？')) {
          clearAllReports();
          closeReportsOverlay();
          renderDeckList();
        }
      });
    }

    // 個別削除ボタン
    overlay.querySelectorAll('.reports-item-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        removeReport(id);
        // UIを更新
        const item = btn.closest('.reports-item');
        if (item) {
          item.style.animation = 'fadeOut 0.2s ease forwards';
          setTimeout(() => {
            item.remove();
            // 残り0件なら閉じる
            const remaining = overlay.querySelectorAll('.reports-item');
            if (remaining.length === 0) {
              closeReportsOverlay();
              renderDeckList();
            }
          }, 200);
        }
      });
    });

    // フェードイン
    requestAnimationFrame(() => {
      overlay.classList.add('show');
    });
  }

  // 報告一覧オーバーレイを閉じる
  function closeReportsOverlay() {
    const overlay = document.getElementById('reports-overlay');
    if (overlay) {
      overlay.classList.remove('show');
      setTimeout(() => overlay.remove(), 200);
    }
  }

  // === スナックバー表示制御 ===
  function showSnackbar(message) {
    const snackbar = document.getElementById('flashcard-snackbar');
    const messageEl = document.getElementById('snackbar-message');
    if (snackbar && messageEl) {
      messageEl.textContent = message;
      snackbar.classList.add('show');

      // 既存タイマーをクリア
      if (state.undoTimer) {
        clearTimeout(state.undoTimer);
      }

      // 2秒後に自動非表示（控えめに）
      state.undoTimer = setTimeout(() => {
        hideSnackbar();
        state.undoState = null;
      }, 2000);
    }
  }

  function hideSnackbar() {
    const snackbar = document.getElementById('flashcard-snackbar');
    if (snackbar) {
      snackbar.classList.remove('show');
    }
  }

  // === 学習記録 ===
  function markMemorized() {
    const card = state.filteredCards[state.currentIndex];
    if (!card) return;

    // Undo用に状態を保存
    saveUndoState('memorized');

    const keyTopicId = card.topicId || state.currentTopicId;
    const key = `${keyTopicId}:${card.originalIndex}`;
    state.progress[key] = {
      status: 'memorized',
      lastReview: Date.now()
    };
    saveProgress();

    // 次のカードへ自動移動（飛びアニメーション付き）
    if (state.currentIndex < state.filteredCards.length - 1) {
      flyCardOut('right', () => {
        next();
        bumpProgress();
        state.combo++;
        updateComboDisplay();
        showSnackbar('覚えたに分類');
      });
    } else {
      renderCompletionScreen();
    }
  }

  function markAgain() {
    const card = state.filteredCards[state.currentIndex];
    if (!card) return;

    // Undo用に状態を保存
    saveUndoState('again');

    const keyTopicId = card.topicId || state.currentTopicId;
    const key = `${keyTopicId}:${card.originalIndex}`;
    state.progress[key] = {
      status: 'again',
      lastReview: Date.now()
    };
    saveProgress();

    // 再出題ロジック：このカードを後で再度出題（最大2回まで）
    const reinsertCount = card._reinsertCount || 0;
    if (reinsertCount < 2) {
      const reinsertCard = { ...card, _reinsertCount: reinsertCount + 1 };
      // 残りカード数に応じて挿入位置を決定
      const remaining = state.filteredCards.length - state.currentIndex - 1;
      const insertOffset = Math.min(4, Math.max(2, Math.floor(remaining / 2)));
      const insertPosition = Math.min(
        state.currentIndex + insertOffset,
        state.filteredCards.length
      );
      state.filteredCards.splice(insertPosition, 0, reinsertCard);
    }

    // 次のカードへ自動移動（飛びアニメーション付き）
    if (state.currentIndex < state.filteredCards.length - 1) {
      flyCardOut('left', () => {
        next();
        bumpProgress();
        state.combo = Math.max(0, state.combo - 3);  // コンボ3減少
        updateComboDisplay();
        showSnackbar('まもなく再出題');
      });
    } else {
      renderCompletionScreen();
    }
  }

  // === 進捗ポンアニメーション ===
  function bumpProgress() {
    const progressText = document.querySelector('.flashcard-progress-text');
    const progressFill = document.querySelector('.flashcard-progress-fill');
    state.answeredInSession++;
    const isMilestone = state.answeredInSession % 5 === 0;

    if (progressText) {
      progressText.classList.remove('bump', 'milestone-bump');
      if (progressFill) progressFill.classList.remove('milestone');
      void progressText.offsetWidth;

      if (isMilestone) {
        progressText.classList.add('milestone-bump');
        if (progressFill) progressFill.classList.add('milestone');
        spawnMilestoneStars(progressText);
      } else {
        progressText.classList.add('bump');
      }
    }
  }

  // === マイルストーン星エフェクト ===
  function spawnMilestoneStars(anchor) {
    const rect = anchor.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const stars = ['⭐', '✨', '🌟', '💫'];

    for (let i = 0; i < 6; i++) {
      const star = document.createElement('span');
      star.className = 'milestone-star';
      star.textContent = stars[Math.floor(Math.random() * stars.length)];
      star.style.left = centerX + 'px';
      star.style.top = centerY + 'px';
      const angle = (Math.PI * 2 / 6) * i + Math.random() * 0.5;
      const distance = 40 + Math.random() * 30;
      star.style.setProperty('--tx', Math.cos(angle) * distance + 'px');
      star.style.setProperty('--ty', Math.sin(angle) * distance + 'px');
      document.body.appendChild(star);
      setTimeout(() => star.remove(), 700);
    }
  }

  // === コンボ表示更新 ===
  function updateComboDisplay() {
    if (state.combo >= 1) {
      const starCount = Math.min(state.combo, 10);
      spawnComboStars(starCount);
    }
  }

  // === コンボ星エフェクト ===
  function spawnComboStars(count) {
    const progressBar = document.querySelector('.flashcard-progress-bar');
    if (!progressBar) return;

    const rect = progressBar.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const stars = ['⭐', '✨', '🌟'];

    for (let i = 0; i < count; i++) {
      const star = document.createElement('span');
      star.className = 'combo-star';
      star.textContent = stars[Math.floor(Math.random() * stars.length)];
      star.style.left = centerX + 'px';
      star.style.top = centerY + 'px';
      const angle = (Math.PI * 2 / count) * i + Math.random() * 0.3;
      const distance = 30 + Math.random() * 20;
      star.style.setProperty('--tx', Math.cos(angle) * distance + 'px');
      star.style.setProperty('--ty', Math.sin(angle) * distance + 'px');
      document.body.appendChild(star);
      setTimeout(() => star.remove(), 500);
    }
  }

  // === 飛びアニメーション（2フェーズ） ===
  function flyCardOut(direction, callback) {
    const card = document.getElementById('flashcard-card');
    if (!card) {
      callback();
      return;
    }

    // インラインスタイルをクリア
    card.style.transition = '';
    card.style.transform = '';
    void card.offsetWidth;

    // フェーズ1: 確定感（80ms）- 軽く縮む + 色フラッシュ
    card.classList.add('is-commit', `commit-${direction}`);

    setTimeout(() => {
      // フェーズ2: 飛び出し（260ms）
      card.classList.remove('is-commit', `commit-${direction}`);
      card.classList.add('flying', `fly-${direction}`);

      // アニメーション完了後にコールバック
      setTimeout(() => {
        callback();
      }, 280);
    }, 80);
  }

  // === 完了画面 ===
  function renderCompletionScreen() {
    // 完了したのでセッションをクリア
    clearSession(state.currentTopicId);
    state.completed = true;  // 完了フラグをセット

    const stats = getTopicStats(state.currentTopicId);
    const cardCount = state.filteredCards.length;

    // 特殊デッキ（おまかせ、覚えた、もう一度）の場合のみ「もうX枚やる」を表示
    const specialDeck = isSpecialDeck();

    container.innerHTML = `
      <div class="flashcard-completion">
        <div class="completion-check">
          <svg class="completion-check-svg" viewBox="0 0 52 52">
            <circle class="completion-check-circle" cx="26" cy="26" r="24" fill="none" stroke="currentColor" stroke-width="2"/>
            <path class="completion-check-mark" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" d="M14 27l8 8 16-16"/>
          </svg>
        </div>
        <h2 class="completion-title">おつかれさま</h2>
        <div class="completion-stats">
          <div class="completion-stat">
            <span class="completion-stat-value">${cardCount}</span>
            <span class="completion-stat-label">枚</span>
          </div>
          <div class="completion-stat memorized">
            <span class="completion-stat-value">${stats.memorized}</span>
            <span class="completion-stat-label">覚えた</span>
          </div>
          <div class="completion-stat again">
            <span class="completion-stat-value">${stats.again}</span>
            <span class="completion-stat-label">もう一度</span>
          </div>
        </div>
        <div class="completion-actions">
          ${specialDeck ? `<button class="completion-btn primary" id="completion-continue-btn">もう${state.sessionSize}枚やる</button>` : ''}
          <button class="completion-btn ${specialDeck ? 'secondary' : 'primary'}" id="completion-back-btn">デッキに戻る</button>
        </div>
      </div>
    `;

    // チェックアニメーション
    setTimeout(() => {
      const svg = container.querySelector('.completion-check-svg');
      if (svg) svg.classList.add('animate');
    }, 100);

    document.getElementById('completion-back-btn').addEventListener('click', goBack);

    const continueBtn = document.getElementById('completion-continue-btn');
    if (continueBtn) {
      continueBtn.addEventListener('click', () => {
        // 同じデッキでもう一度
        startRecommendedDeck();
      });
    }
  }

  // === HTMLまとめ埋め込み ===
  async function loadHtmlSummary(htmlPath, sectionName) {
    const summaryContent = document.getElementById('flashcard-summary-content');
    if (!summaryContent) return;

    try {
      const response = await fetch(encodeURI(htmlPath));
      const html = await response.text();

      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      const summaryEl = document.getElementById('flashcard-summary');

      // セクション名がある場合、該当セクションのみ抽出
      if (sectionName) {
        const sectionContent = extractSection(doc, sectionName);
        if (sectionContent) {
          summaryContent.innerHTML = sectionContent;
          // コンテンツがあることを示すクラスを追加（showはflip時に追加）
          if (summaryEl) {
            summaryEl.classList.add('has-content');
            // フリップ済みなら表示
            if (state.isFlipped) summaryEl.classList.add('show');
          }
          return;
        }
        // マッチ失敗: まとめセクションを非表示のまま
        return;
      }

      // セクション名なし: 全体表示（トピック単位のまとめ）
      summaryContent.innerHTML = doc.body ? doc.body.innerHTML : html;
      if (summaryEl) {
        summaryEl.classList.add('has-content');
        // フリップ済みなら表示
        if (state.isFlipped) summaryEl.classList.add('show');
      }
    } catch (e) {
      summaryContent.innerHTML = '<p>まとめの読み込みに失敗しました</p>';
    }
  }

  // セクション抽出関数
  function extractSection(doc, sectionName) {
    const h3Elements = doc.querySelectorAll('h3');

    for (const h3 of h3Elements) {
      // h3のテキスト部分のみ取得（spanタグ等を除外）
      const h3Text = h3.childNodes[0]?.textContent?.trim() || h3.textContent.trim();

      if (h3Text.includes(sectionName) || sectionName.includes(h3Text)) {
        // このh3から次のh3までの内容を収集（過去問は除外）
        const content = [h3.outerHTML];
        let sibling = h3.nextElementSibling;

        while (sibling && sibling.tagName !== 'H3' && sibling.tagName !== 'H2') {
          // 過去問セクション・question-boxは除外
          if (sibling.classList?.contains('question-box')) {
            sibling = sibling.nextElementSibling;
            continue;
          }
          content.push(sibling.outerHTML);
          sibling = sibling.nextElementSibling;
        }

        return content.join('');
      }
    }

    return null; // 見つからない場合
  }

  // === 戻る ===
  function goBack() {
    // 現在位置とカード順序を保存（完了後は保存しない）
    if (state.currentTopicId && state.currentIndex > 0 && !state.completed) {
      // 検索結果デッキの場合は searchKey を使用
      const isSearchDeck = state.currentTopicId.startsWith('__search_');
      const saveData = {
        index: state.currentIndex,
        order: state.filteredCards.map(c => isSearchDeck ? c.searchKey : c.originalIndex),
        shuffled: state.shuffleEnabled,
        timestamp: Date.now()
      };

      // SESSIONS_KEY に保存（getInProgressTopics で使用）
      let allSessions = {};
      try {
        const stored = localStorage.getItem(SESSIONS_KEY);
        if (stored) allSessions = JSON.parse(stored);
      } catch (e) {}
      allSessions[state.currentTopicId] = saveData;
      localStorage.setItem(SESSIONS_KEY, JSON.stringify(allSessions));

      // 旧形式にも保存（互換性のため）
      localStorage.setItem(`flashcard-session-${state.currentTopicId}`, JSON.stringify(saveData));
    }

    state.isActive = false;
    state.completed = false;  // 完了フラグをリセット
    state.currentTopicId = null;
    state.currentTopic = null;
    state.cards = [];
    state.filteredCards = [];
    state.currentIndex = 0;
    state.isFlipped = false;

    exitPracticeMode(); // UI要素を再表示
    // 検索画面からの遷移時にhiddenクラスも除去
    const tabbar = document.querySelector('.floating-tabbar');
    if (tabbar) tabbar.classList.remove('hidden');
    renderDeckList();
  }

  // === 問数サイクル切り替え ===
  function cycleSessionSize() {
    const sizes = [5, 10, 20];
    const currentIdx = sizes.indexOf(state.sessionSize);
    const nextIdx = (currentIdx + 1) % sizes.length;
    const newSize = sizes[nextIdx];
    state.sessionSize = newSize;
    localStorage.setItem('flashcard-session-size', newSize);

    // 現在のセッションに即時反映
    const currentTotal = state.filteredCards.length;

    if (newSize < currentTotal) {
      // 問数を減らす場合：現在位置以降を切り詰め
      const keepCount = Math.max(newSize, state.currentIndex + 1);
      state.filteredCards = state.filteredCards.slice(0, keepCount);
    } else if (newSize > currentTotal && state.cards.length > currentTotal) {
      // 問数を増やす場合：元のカードプールから追加
      const currentKeys = new Set(state.filteredCards.map(c =>
        `${c.topicId || state.currentTopicId}:${c.originalIndex}`
      ));
      const additionalCards = state.cards
        .filter(c => !currentKeys.has(`${c.topicId || state.currentTopicId}:${c.originalIndex}`))
        .slice(0, newSize - currentTotal);
      state.filteredCards = [...state.filteredCards, ...additionalCards];
    }

    // 画面を再描画
    renderCard();
    showSnackbar(`${newSize}問に変更`);
  }

  // === シャッフルトグル ===
  function toggleShuffle() {
    state.shuffleEnabled = !state.shuffleEnabled;
    localStorage.setItem('flashcard-shuffle', state.shuffleEnabled);

    // ボタンの見た目を更新
    const btn = document.getElementById('flashcard-shuffle-btn');
    if (btn) {
      btn.classList.toggle('active', state.shuffleEnabled);
    }

    // 学習中の場合、残りのカードを即時シャッフル/ソート
    if (state.isActive && state.filteredCards.length > 0) {
      const currentCard = state.filteredCards[state.currentIndex];
      const remainingCards = state.filteredCards.slice(state.currentIndex + 1);

      if (state.shuffleEnabled) {
        // シャッフルON: 残りのカードをシャッフル
        for (let i = remainingCards.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [remainingCards[i], remainingCards[j]] = [remainingCards[j], remainingCards[i]];
        }
      } else {
        // シャッフルOFF: 残りのカードを元の順番（originalIndex順）にソート
        remainingCards.sort((a, b) => a.originalIndex - b.originalIndex);
      }

      // 現在のカードまで + シャッフル/ソートした残り
      state.filteredCards = [
        ...state.filteredCards.slice(0, state.currentIndex + 1),
        ...remainingCards
      ];
    }
  }

  // === 統計表示 ===
  function renderStats() {
    const statsEl = document.getElementById('flashcard-stats');
    if (!statsEl) return;

    const total = Object.keys(state.progress).length;
    const memorized = Object.values(state.progress).filter(p => p.status === 'memorized').length;
    const again = Object.values(state.progress).filter(p => p.status === 'again').length;

    if (total === 0) {
      statsEl.innerHTML = '<p class="flashcard-stats-empty">まだ学習履歴がありません</p>';
      return;
    }

    statsEl.innerHTML = `
      <div class="flashcard-stats-content">
        <h3>学習統計</h3>
        <div class="flashcard-stats-grid">
          <div class="flashcard-stat">
            <span class="flashcard-stat-value">${total}</span>
            <span class="flashcard-stat-label">学習済み</span>
          </div>
          <div class="flashcard-stat memorized">
            <span class="flashcard-stat-value">${memorized}</span>
            <span class="flashcard-stat-label">覚えた</span>
          </div>
          <div class="flashcard-stat again">
            <span class="flashcard-stat-value">${again}</span>
            <span class="flashcard-stat-label">もう一度</span>
          </div>
        </div>
      </div>
    `;
  }

  // === 公開関数 ===
  function show() {
    if (!state.isActive) {
      renderDeckList();
    }
  }

  function hide() {
    // 特に処理なし
  }

  /**
   * デッキ一覧をリセット（アコーディオン閉じる、トップにスクロール）
   */
  function resetDeckList() {
    // アコーディオン状態をクリア
    state.expandedSubjects.clear();
    localStorage.removeItem('flashcard-expanded-subjects');
    // 最後に選択したトピックもクリア
    state.lastSelectedTopicId = null;
    localStorage.removeItem('flashcard-last-topic');
    // デッキ一覧を再描画
    if (!state.isActive) {
      renderDeckList();
      // トップにスクロール
      if (container) {
        container.scrollTop = 0;
      }
    }
  }

  /**
   * 外部からデッキを指定して演習を開始
   */
  async function startDeck(topicId) {
    const topic = DATA.find(d => d.id === topicId);
    if (!topic || !topic.qaPath) return;

    // 演習モードに入る
    state.isActive = true;
    state.completed = false;
    state.answeredInSession = 0;
    state.combo = 0;
    state.isReviewMode = false;
    state.currentIndex = 0;

    // トピックを読み込み
    await loadTopic(topicId, state.shuffleEnabled);

    // 演習画面をレンダリング
    renderCard();
    enterPracticeMode();
  }

  // === セッション保存（外部から呼び出し可能） ===
  function saveSession() {
    if (state.currentTopicId && state.isActive && state.currentIndex > 0 && !state.completed) {
      // 検索結果デッキの場合は searchKey を使用
      const isSearchDeck = state.currentTopicId.startsWith('__search_');
      const saveData = {
        index: state.currentIndex,
        order: state.filteredCards.map(c => isSearchDeck ? c.searchKey : c.originalIndex),
        shuffled: state.shuffleEnabled,
        timestamp: Date.now()
      };

      // 全セッションを1つのオブジェクトで管理（Firebase同期用）
      let allSessions = {};
      try {
        const stored = localStorage.getItem(SESSIONS_KEY);
        if (stored) allSessions = JSON.parse(stored);
      } catch (e) {}

      allSessions[state.currentTopicId] = saveData;
      localStorage.setItem(SESSIONS_KEY, JSON.stringify(allSessions));

      // 旧形式との互換性（一時的）
      localStorage.setItem(`flashcard-session-${state.currentTopicId}`, JSON.stringify(saveData));
      return true;
    }
    return false;
  }

  // セッション取得
  function getSession(topicId) {
    // 新形式を優先
    try {
      const stored = localStorage.getItem(SESSIONS_KEY);
      if (stored) {
        const allSessions = JSON.parse(stored);
        if (allSessions[topicId]) return allSessions[topicId];
      }
    } catch (e) {}

    // 旧形式にフォールバック
    try {
      const old = localStorage.getItem(`flashcard-session-${topicId}`);
      if (old) return JSON.parse(old);
    } catch (e) {}

    return null;
  }

  // セッション削除
  function clearSession(topicId) {
    try {
      const stored = localStorage.getItem(SESSIONS_KEY);
      if (stored) {
        const allSessions = JSON.parse(stored);
        delete allSessions[topicId];
        localStorage.setItem(SESSIONS_KEY, JSON.stringify(allSessions));
      }
    } catch (e) {}

    // 旧形式も削除
    localStorage.removeItem(`flashcard-session-${topicId}`);
  }

  // ページ離脱時にセッションを保存
  window.addEventListener('beforeunload', saveSession);
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      saveSession();
    }
  });

  // === 公開API ===
  return {
    init,
    show,
    hide,
    resetDeckList,
    loadTopic,
    startDeck,
    next,
    prev,
    flip,
    markMemorized,
    markAgain,
    goBack,
    saveSession,
    // 報告機能
    getReports,
    removeReport,
    clearAllReports,
    exportReportsAsText
  };
})();
