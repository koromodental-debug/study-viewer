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
    isActive: false,     // 演習中かどうか
    progress: {},        // { "topicId:index": { status, lastReview } }
    touchStartX: 0,
    touchStartY: 0
  };

  // DOM要素
  let container = null;

  // === 初期化 ===
  function init() {
    container = document.getElementById('flashcard-content');
    if (!container) return;

    loadProgress();
    renderSelectScreen();
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

  // === 科目・トピック選択画面 ===
  function renderSelectScreen() {
    // 科目一覧を取得
    const subjects = [...new Set(DATA.map(d => d.subject).filter(Boolean))];

    container.innerHTML = `
      <div class="flashcard-select">
        <div class="flashcard-select-header">
          <h2>フラッシュカード演習</h2>
          <p>科目とトピックを選んで演習を開始</p>
        </div>

        <div class="flashcard-select-form">
          <div class="flashcard-select-group">
            <label>科目を選択</label>
            <select id="flashcard-subject-select" class="flashcard-select-input">
              <option value="">科目を選んでください</option>
              ${subjects.map(s => `<option value="${s}">${s}</option>`).join('')}
            </select>
          </div>

          <div class="flashcard-select-group" id="flashcard-topic-group" style="display:none;">
            <label>トピックを選択</label>
            <select id="flashcard-topic-select" class="flashcard-select-input">
              <option value="">トピックを選んでください</option>
            </select>
          </div>

          <div class="flashcard-options">
            <label class="flashcard-checkbox">
              <input type="checkbox" id="flashcard-review-mode">
              <span>復習モード（「もう一度」のみ表示）</span>
            </label>
            <label class="flashcard-checkbox">
              <input type="checkbox" id="flashcard-shuffle-mode">
              <span>シャッフル</span>
            </label>
          </div>

          <button id="flashcard-start-btn" class="flashcard-start-btn" disabled>
            演習を開始
          </button>
        </div>

        <div class="flashcard-stats" id="flashcard-stats">
          <!-- 学習統計を表示 -->
        </div>
      </div>
    `;

    // イベントバインド
    const subjectSelect = document.getElementById('flashcard-subject-select');
    const topicSelect = document.getElementById('flashcard-topic-select');
    const startBtn = document.getElementById('flashcard-start-btn');

    subjectSelect.addEventListener('change', onSubjectChange);
    topicSelect.addEventListener('change', onTopicChange);
    startBtn.addEventListener('click', onStartClick);

    // 統計表示
    renderStats();
  }

  function onSubjectChange(e) {
    const subject = e.target.value;
    const topicGroup = document.getElementById('flashcard-topic-group');
    const topicSelect = document.getElementById('flashcard-topic-select');
    const startBtn = document.getElementById('flashcard-start-btn');

    if (!subject) {
      topicGroup.style.display = 'none';
      startBtn.disabled = true;
      return;
    }

    // 選択された科目のトピック一覧
    const topics = DATA.filter(d => d.subject === subject && d.qaPath);

    topicSelect.innerHTML = `
      <option value="">トピックを選んでください</option>
      ${topics.map(t => `<option value="${t.id}">${t.title}</option>`).join('')}
    `;

    topicGroup.style.display = 'block';
    startBtn.disabled = true;
  }

  function onTopicChange(e) {
    const topicId = e.target.value;
    const startBtn = document.getElementById('flashcard-start-btn');
    startBtn.disabled = !topicId;
  }

  async function onStartClick() {
    const topicId = document.getElementById('flashcard-topic-select').value;
    const isReviewMode = document.getElementById('flashcard-review-mode').checked;
    const isShuffleMode = document.getElementById('flashcard-shuffle-mode').checked;

    if (!topicId) return;

    state.isReviewMode = isReviewMode;

    await loadTopic(topicId, isShuffleMode);
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

      // シャッフル
      if (shuffle && state.filteredCards.length > 0) {
        for (let i = state.filteredCards.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [state.filteredCards[i], state.filteredCards[j]] = [state.filteredCards[j], state.filteredCards[i]];
        }
      }

      state.currentIndex = 0;
      state.isFlipped = false;
      state.isActive = true;

      if (state.filteredCards.length === 0) {
        renderNoCardsMessage();
      } else {
        renderCard();
        loadHtmlSummary(topic.htmlPath);
      }
    } catch (e) {
      console.log('Q&A読み込みエラー:', e);
      container.innerHTML = `<div class="flashcard-error">Q&Aの読み込みに失敗しました</div>`;
    }
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

  // === カード表示 ===
  function renderCard() {
    const card = state.filteredCards[state.currentIndex];
    if (!card) return;

    const key = `${state.currentTopicId}:${card.originalIndex}`;
    const progress = state.progress[key];

    container.innerHTML = `
      <div class="flashcard-exercise">
        <div class="flashcard-header">
          <button class="flashcard-back-btn" id="flashcard-back-btn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
            戻る
          </button>
          <div class="flashcard-progress">
            ${state.currentIndex + 1} / ${state.filteredCards.length}
          </div>
        </div>

        <div class="flashcard-card-container" id="flashcard-card-container">
          <div class="flashcard-card ${state.isFlipped ? 'flipped' : ''}" id="flashcard-card">
            ${card.section ? `<div class="flashcard-section">${card.section}</div>` : ''}
            <div class="flashcard-question">
              ${card.question}
            </div>
            ${!state.isFlipped ? '<div class="flashcard-tap-hint">タップで答えを見る</div>' : ''}
            <div class="flashcard-answer ${state.isFlipped ? 'show' : ''}">
              ${card.answer}
            </div>
          </div>
        </div>

        ${state.isFlipped ? `
        <div class="flashcard-actions">
          <button class="flashcard-btn memorized" id="flashcard-memorized-btn">
            覚えた
          </button>
          <button class="flashcard-btn again" id="flashcard-again-btn">
            もう一度
          </button>
        </div>

        <div class="flashcard-summary" id="flashcard-summary">
          <div class="flashcard-summary-header">
            <span>まとめ</span>
          </div>
          <div class="flashcard-summary-content" id="flashcard-summary-content">
            読み込み中...
          </div>
        </div>
        ` : ''}
      </div>
    `;

    bindCardEvents();

    // 答え表示時のみまとめを読み込み
    if (state.isFlipped) {
      loadHtmlSummary(state.currentTopic.htmlPath);
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

    // カードタップ
    const cardContainer = document.getElementById('flashcard-card-container');
    cardContainer.addEventListener('click', flip);

    // スワイプ
    cardContainer.addEventListener('touchstart', onTouchStart, { passive: true });
    cardContainer.addEventListener('touchend', onTouchEnd, { passive: true });

    // 学習ボタン（答え表示後のみ存在）
    const memorizedBtn = document.getElementById('flashcard-memorized-btn');
    const againBtn = document.getElementById('flashcard-again-btn');
    if (memorizedBtn) memorizedBtn.addEventListener('click', markMemorized);
    if (againBtn) againBtn.addEventListener('click', markAgain);
  }

  // === スワイプ処理 ===
  function onTouchStart(e) {
    state.touchStartX = e.touches[0].clientX;
    state.touchStartY = e.touches[0].clientY;
  }

  function onTouchEnd(e) {
    const diffX = e.changedTouches[0].clientX - state.touchStartX;
    const diffY = e.changedTouches[0].clientY - state.touchStartY;
    const threshold = 80;

    // 横方向のスワイプが縦より大きい場合
    if (Math.abs(diffX) > threshold && Math.abs(diffX) > Math.abs(diffY) * 1.5) {
      if (diffX < 0) {
        // 左スワイプ → 次のカード
        next();
      } else {
        // 右スワイプ → 前のカード
        prev();
      }
    }
  }

  // === カード操作 ===
  function flip() {
    state.isFlipped = !state.isFlipped;
    const card = document.getElementById('flashcard-card');
    const hint = document.getElementById('flashcard-tap-hint');
    const answer = card.querySelector('.flashcard-answer');

    if (state.isFlipped) {
      card.classList.add('flipped');
      answer.classList.add('show');
      hint.textContent = '';
    } else {
      card.classList.remove('flipped');
      answer.classList.remove('show');
      hint.textContent = 'タップで答えを見る';
    }
  }

  function next() {
    if (state.currentIndex < state.filteredCards.length - 1) {
      state.currentIndex++;
      state.isFlipped = false;
      renderCard();
      loadHtmlSummary(state.currentTopic.htmlPath);
    }
  }

  function prev() {
    if (state.currentIndex > 0) {
      state.currentIndex--;
      state.isFlipped = false;
      renderCard();
      loadHtmlSummary(state.currentTopic.htmlPath);
    }
  }

  // === 学習記録 ===
  function markMemorized() {
    const card = state.filteredCards[state.currentIndex];
    if (!card) return;

    const key = `${state.currentTopicId}:${card.originalIndex}`;
    state.progress[key] = {
      status: 'memorized',
      lastReview: Date.now()
    };
    saveProgress();

    // 次のカードへ自動移動
    if (state.currentIndex < state.filteredCards.length - 1) {
      next();
    } else {
      renderCard(); // 最後のカードの場合はステータス更新のみ
    }
  }

  function markAgain() {
    const card = state.filteredCards[state.currentIndex];
    if (!card) return;

    const key = `${state.currentTopicId}:${card.originalIndex}`;
    state.progress[key] = {
      status: 'again',
      lastReview: Date.now()
    };
    saveProgress();

    // 次のカードへ自動移動
    if (state.currentIndex < state.filteredCards.length - 1) {
      next();
    } else {
      renderCard();
    }
  }

  // === HTMLまとめ埋め込み ===
  async function loadHtmlSummary(htmlPath) {
    const summaryContent = document.getElementById('flashcard-summary-content');
    if (!summaryContent) return;

    try {
      const response = await fetch(htmlPath);
      const html = await response.text();

      // DOMParserでbody内容のみ抽出
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const bodyContent = doc.body ? doc.body.innerHTML : html;

      summaryContent.innerHTML = bodyContent;
    } catch (e) {
      summaryContent.innerHTML = '<p>まとめの読み込みに失敗しました</p>';
    }
  }

  // === 戻る ===
  function goBack() {
    state.isActive = false;
    state.currentTopicId = null;
    state.currentTopic = null;
    state.cards = [];
    state.filteredCards = [];
    state.currentIndex = 0;
    state.isFlipped = false;
    renderSelectScreen();
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
      renderSelectScreen();
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
