/**
 * フラッシュカードモジュール
 * Q&Aを使った演習機能を提供
 */
const FlashcardModule = (function() {
  // 定数
  const STORAGE_KEY = 'studyViewer_flashcardProgress';
  const STORAGE_VERSION = 1;

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
    sessionSize: parseInt(localStorage.getItem('flashcard-session-size')) || 10, // 5, 10, 20
    isActive: false,     // 演習中かどうか
    progress: {},        // { "topicId:index": { status, lastReview } }
    touchStartX: 0,
    touchStartY: 0,
    // Undo用
    undoState: null,     // { index, filteredCards, progress, card }
    undoTimer: null,     // Undoボタン自動非表示タイマー
    // まとめ折りたたみ状態
    summaryCollapsed: localStorage.getItem('flashcard-summary-collapsed') === 'true'
  };

  // DOM要素
  let container = null;

  // === 初期化 ===
  function init() {
    container = document.getElementById('flashcard-content');
    if (!container) return;

    loadProgress();
    renderDeckList();
  }

  // === localStorage管理 ===
  function loadProgress() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const data = JSON.parse(saved);
        if (data.version === STORAGE_VERSION) {
          state.progress = data.cards || {};
        }
      }
    } catch (e) {
      console.log('フラッシュカード進捗の読み込みエラー:', e);
    }
  }

  function saveProgress() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: STORAGE_VERSION,
        cards: state.progress
      }));
    } catch (e) {
      console.log('フラッシュカード進捗の保存エラー:', e);
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

    return { total: totalCards, memorized, again };
  }

  // 今日のおすすめカード数を計算
  function getRecommendedCount() {
    // セッションサイズを使用
    return state.sessionSize;
  }

  // === Ankiスタイル デッキ一覧画面 ===
  function renderDeckList() {
    const subjects = [...new Set(DATA.map(d => d.subject).filter(Boolean))];
    const overall = getOverallStats();
    const recommendedCount = getRecommendedCount();

    container.innerHTML = `
      <div class="deck-list">
        <div class="deck-header">
          <h2>フラッシュカード</h2>
        </div>

        <div class="deck-recommended" id="start-recommended-deck">
          <span class="deck-recommended-label">今日のおすすめ</span>
          <span class="deck-recommended-action">開始</span>
        </div>

        <div class="session-size-row">
          <div class="session-size-buttons">
            <button class="session-size-btn ${state.sessionSize === 5 ? 'active' : ''}" data-size="5">5枚</button>
            <button class="session-size-btn ${state.sessionSize === 10 ? 'active' : ''}" data-size="10">10枚</button>
            <button class="session-size-btn ${state.sessionSize === 20 ? 'active' : ''}" data-size="20">20枚</button>
          </div>
          <span class="session-size-hint">おすすめ/覚えた/もう一度に適用</span>
        </div>

        <div class="deck-stats-row">
          <div class="deck-stat-item ${overall.memorized > 0 ? 'clickable' : ''}" id="start-memorized-deck">
            <span class="deck-stat-label">覚えた</span>
            <span class="deck-stat-value memorized">${overall.memorized}</span>
            ${overall.memorized > 0 ? '<span class="deck-stat-chevron">›</span>' : ''}
          </div>
          <div class="deck-stat-item ${overall.again > 0 ? 'clickable' : ''}" id="start-again-deck">
            <span class="deck-stat-label">もう一度</span>
            <span class="deck-stat-value again">${overall.again}</span>
            ${overall.again > 0 ? '<span class="deck-stat-chevron">›</span>' : ''}
          </div>
        </div>

        <div class="deck-subjects" id="deck-subjects">
          ${subjects.map(subject => renderSubjectRow(subject)).join('')}
        </div>
      </div>
    `;

    // イベントバインド
    bindDeckListEvents();
  }

  function renderSubjectRow(subject) {
    const topics = DATA.filter(d => d.subject === subject && d.qaPath);
    const stats = getSubjectStats(subject);

    return `
      <div class="deck-subject" data-subject="${subject}">
        <div class="deck-subject-header">
          <span class="deck-arrow">▶</span>
          <span class="deck-subject-name">${subject}</span>
          <div class="deck-subject-stats">
            ${stats.again > 0 ? `<span class="deck-subject-again">要復習 ${stats.again}</span>` : ''}
          </div>
        </div>
        <div class="deck-topics">
          ${topics.map(topic => renderTopicRow(topic)).join('')}
        </div>
      </div>
    `;
  }

  function renderTopicRow(topic) {
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

    return `
      <div class="deck-topic" data-topic-id="${topic.id}">
        <span class="deck-topic-name">${topic.title}</span>
        <div class="deck-topic-stats">
          ${statsHtml}
        </div>
      </div>
    `;
  }

  function bindDeckListEvents() {
    // 科目ヘッダークリック（アコーディオン）
    const subjectHeaders = container.querySelectorAll('.deck-subject-header');
    subjectHeaders.forEach(header => {
      header.addEventListener('click', (e) => {
        const subjectEl = header.closest('.deck-subject');
        subjectEl.classList.toggle('open');
      });
    });

    // トピック行クリック（学習開始）
    const topicRows = container.querySelectorAll('.deck-topic');
    topicRows.forEach(row => {
      row.addEventListener('click', async (e) => {
        e.stopPropagation();
        const topicId = row.dataset.topicId;
        state.isReviewMode = false;
        await loadTopic(topicId, state.shuffleEnabled);
      });
    });

    // 「覚えた」デッキ開始
    const memorizedBtn = document.getElementById('start-memorized-deck');
    if (memorizedBtn && memorizedBtn.classList.contains('clickable')) {
      memorizedBtn.addEventListener('click', () => startStatusDeck('memorized'));
    }

    // 「もう一度」デッキ開始
    const againBtn = document.getElementById('start-again-deck');
    if (againBtn && againBtn.classList.contains('clickable')) {
      againBtn.addEventListener('click', () => startStatusDeck('again'));
    }

    // 「今日のおすすめ」デッキ開始
    const recommendedBtn = document.getElementById('start-recommended-deck');
    if (recommendedBtn) {
      recommendedBtn.addEventListener('click', () => startRecommendedDeck());
    }

    // セッションサイズ選択
    const sizeBtns = container.querySelectorAll('.session-size-btn');
    sizeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const size = parseInt(btn.dataset.size);
        state.sessionSize = size;
        localStorage.setItem('flashcard-session-size', size);
        // ボタンの見た目を更新
        sizeBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });
  }

  // === トピック読み込み ===
  async function loadTopic(topicId, shuffle = false) {
    const topic = DATA.find(d => d.id === topicId);
    if (!topic || !topic.qaPath) return;

    state.currentTopicId = topicId;
    state.currentTopic = topic;

    try {
      const response = await fetch(topic.qaPath);
      const text = await response.text();
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
      const savedSession = localStorage.getItem(`flashcard-session-${topicId}`);

      if (savedSession) {
        try {
          const session = JSON.parse(savedSession);
          // 保存された順序でカードを並べ替え
          if (session.order && session.order.length === state.filteredCards.length) {
            const orderMap = new Map(state.filteredCards.map(c => [c.originalIndex, c]));
            const reordered = session.order.map(idx => orderMap.get(idx)).filter(Boolean);
            if (reordered.length === state.filteredCards.length) {
              state.filteredCards = reordered;
              savedIndex = Math.min(session.index, state.filteredCards.length - 1);
            }
          }
        } catch (e) {
          console.log('セッション復元エラー:', e);
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

      if (state.filteredCards.length === 0) {
        renderNoCardsMessage();
      } else {
        renderCard();
      }
    } catch (e) {
      console.log('Q&A読み込みエラー:', e);
      container.innerHTML = `<div class="flashcard-error">Q&Aの読み込みに失敗しました</div>`;
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
        const response = await fetch(topic.qaPath);
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
    state.currentTopic = { title: status === 'memorized' ? '覚えたカード' : 'もう一度カード' };
    state.cards = filteredCards;
    state.filteredCards = [...filteredCards];
    state.currentIndex = 0;
    state.isFlipped = false;
    state.isActive = true;

    if (state.shuffleEnabled) {
      for (let i = state.filteredCards.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [state.filteredCards[i], state.filteredCards[j]] = [state.filteredCards[j], state.filteredCards[i]];
      }
    }

    // セッションサイズで制限
    if (state.filteredCards.length > state.sessionSize) {
      state.filteredCards = state.filteredCards.slice(0, state.sessionSize);
    }

    renderCard();
  }

  // === 今日のおすすめデッキ ===
  async function startRecommendedDeck() {
    const targetCount = getRecommendedCount();
    const cardRefs = [];

    // 1. まず「もう一度」カードを全て収集
    for (const [key, value] of Object.entries(state.progress)) {
      if (value.status === 'again') {
        const [topicId, cardIndex] = key.split(':');
        cardRefs.push({ topicId, cardIndex: parseInt(cardIndex), key, priority: 1 });
      }
    }

    // 2. 不足分は各トピックから未学習カードを追加
    if (cardRefs.length < targetCount) {
      const topicsWithQa = DATA.filter(d => d.qaPath);
      for (const topic of topicsWithQa) {
        if (cardRefs.length >= targetCount) break;

        // このトピックの進捗キーを取得
        const topicKeys = Object.keys(state.progress).filter(k => k.startsWith(topic.id + ':'));
        const learnedIndices = new Set(topicKeys.map(k => parseInt(k.split(':')[1])));

        // 未学習カードを追加（最大3枚/トピック）
        let addedFromTopic = 0;
        for (let i = 0; i < 50 && addedFromTopic < 3; i++) {
          if (!learnedIndices.has(i)) {
            cardRefs.push({ topicId: topic.id, cardIndex: i, key: `${topic.id}:${i}`, priority: 2 });
            addedFromTopic++;
            if (cardRefs.length >= targetCount) break;
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
        const response = await fetch(topic.qaPath);
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
    let index = 0;

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.startsWith('## ')) {
        currentSection = trimmed.slice(3);
      } else if (trimmed.startsWith('Q: ') || trimmed.startsWith('Q:')) {
        currentQ = trimmed.replace(/^Q:\s*/, '');
      } else if ((trimmed.startsWith('A: ') || trimmed.startsWith('A:')) && currentQ) {
        const answer = trimmed.replace(/^A:\s*/, '');
        cards.push({
          index: index,
          originalIndex: index,
          section: currentSection,
          question: currentQ,
          answer: answer,
          topicId: topicId
        });
        index++;
        currentQ = null;
      }
    }

    return cards;
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
          </div>
          <button class="flashcard-shuffle-btn ${state.shuffleEnabled ? 'active' : ''}" id="flashcard-shuffle-btn" aria-label="シャッフル">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>
            </svg>
          </button>
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
              <svg class="summary-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M6 9l6 6 6-6"/>
              </svg>
            </div>
            <div class="flashcard-summary-content" id="flashcard-summary-content">
            </div>
          </div>
        </div>

        <!-- アクションバー（画面下固定） -->
        <div class="flashcard-action-bar ${state.isFlipped ? 'show' : ''}">
          <button class="flashcard-btn again" id="flashcard-again-btn">
            もう一度
          </button>
          <button class="flashcard-btn memorized" id="flashcard-memorized-btn">
            覚えた
          </button>
        </div>

        <!-- Undoスナックバー -->
        <div class="flashcard-snackbar" id="flashcard-snackbar">
          <span class="snackbar-message" id="snackbar-message"></span>
          <button class="snackbar-undo" id="flashcard-undo-btn">元に戻す</button>
        </div>
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

    // シャッフルボタン
    document.getElementById('flashcard-shuffle-btn').addEventListener('click', toggleShuffle);

    // カードタップ
    const cardContainer = document.getElementById('flashcard-card-container');
    cardContainer.addEventListener('click', flip);

    // スワイプ
    cardContainer.addEventListener('touchstart', onTouchStart, { passive: true });
    cardContainer.addEventListener('touchmove', onTouchMove, { passive: true });
    cardContainer.addEventListener('touchend', onTouchEnd, { passive: true });

    // 学習ボタン
    document.getElementById('flashcard-memorized-btn').addEventListener('click', markMemorized);
    document.getElementById('flashcard-again-btn').addEventListener('click', markAgain);

    // Undoボタン
    document.getElementById('flashcard-undo-btn').addEventListener('click', undo);

    // まとめ折りたたみトグル
    document.getElementById('flashcard-summary-toggle').addEventListener('click', toggleSummary);
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
      if (summary) summary.classList.add('show');
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
        showSnackbar('まもなく再出題');
      });
    } else {
      renderCompletionScreen();
    }
  }

  // === 進捗ポンアニメーション ===
  function bumpProgress() {
    const progressText = document.querySelector('.flashcard-progress-text');
    if (progressText) {
      progressText.classList.remove('bump');
      // 強制リフローでアニメーションリセット
      void progressText.offsetWidth;
      progressText.classList.add('bump');
    }
  }

  // === 飛びアニメーション ===
  function flyCardOut(direction, callback) {
    const cardContainer = document.getElementById('flashcard-card-container');
    const card = document.getElementById('flashcard-card');
    if (!card) {
      callback();
      return;
    }

    // インラインスタイルをクリアしてCSSアニメーションを有効に
    card.style.transition = '';
    card.style.transform = '';

    // 強制リフローでスタイルリセットを確定
    void card.offsetWidth;

    // アニメーションクラス追加
    card.classList.add('flying', `fly-${direction}`);

    // アニメーション完了後にコールバック
    setTimeout(() => {
      callback();
    }, 250);
  }

  // === 完了画面 ===
  function renderCompletionScreen() {
    // 完了したのでセッションをクリア
    localStorage.removeItem(`flashcard-session-${state.currentTopicId}`);

    const stats = getTopicStats(state.currentTopicId);
    const cardCount = state.filteredCards.length;

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
          <button class="completion-btn primary" id="completion-continue-btn">もう${state.sessionSize}枚やる</button>
          <button class="completion-btn secondary" id="completion-back-btn">デッキに戻る</button>
        </div>
      </div>
    `;

    // チェックアニメーション
    setTimeout(() => {
      const svg = container.querySelector('.completion-check-svg');
      if (svg) svg.classList.add('animate');
    }, 100);

    document.getElementById('completion-back-btn').addEventListener('click', goBack);
    document.getElementById('completion-continue-btn').addEventListener('click', () => {
      // 同じデッキでもう一度
      startRecommendedDeck();
    });
  }

  // === HTMLまとめ埋め込み ===
  async function loadHtmlSummary(htmlPath, sectionName) {
    const summaryContent = document.getElementById('flashcard-summary-content');
    if (!summaryContent) return;

    try {
      const response = await fetch(htmlPath);
      const html = await response.text();

      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      const summaryEl = document.getElementById('flashcard-summary');

      // セクション名がある場合、該当セクションのみ抽出
      if (sectionName) {
        const sectionContent = extractSection(doc, sectionName);
        if (sectionContent) {
          summaryContent.innerHTML = sectionContent;
          // 成功時のみ表示
          if (summaryEl) summaryEl.classList.add('show');
          return;
        }
        // マッチ失敗: まとめセクションを非表示のまま
        return;
      }

      // セクション名なし: 全体表示（トピック単位のまとめ）
      summaryContent.innerHTML = doc.body ? doc.body.innerHTML : html;
      if (summaryEl) summaryEl.classList.add('show');
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
        // このh3から次のh3までの内容を収集
        const content = [h3.outerHTML];
        let sibling = h3.nextElementSibling;

        while (sibling && sibling.tagName !== 'H3' && sibling.tagName !== 'H2') {
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
    // 現在位置とカード順序を保存
    if (state.currentTopicId && state.currentIndex > 0) {
      const saveData = {
        index: state.currentIndex,
        order: state.filteredCards.map(c => c.originalIndex),
        shuffled: state.shuffleEnabled
      };
      localStorage.setItem(`flashcard-session-${state.currentTopicId}`, JSON.stringify(saveData));
    }

    state.isActive = false;
    state.currentTopicId = null;
    state.currentTopic = null;
    state.cards = [];
    state.filteredCards = [];
    state.currentIndex = 0;
    state.isFlipped = false;

    exitPracticeMode(); // UI要素を再表示
    renderDeckList();
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

  // === 公開API ===
  return {
    init,
    show,
    hide,
    loadTopic,
    next,
    prev,
    flip,
    markMemorized,
    markAgain,
    goBack
  };
})();
