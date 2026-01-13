/**
 * フラッシュカードモジュール
 * Q&Aを使った演習機能を提供
 */
const FlashcardModule = (function() {
  // 定数
  const STORAGE_KEY = 'studyViewer_flashcardProgress';
  const SESSIONS_KEY = 'studyViewer_flashcardSessions';
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
    sessionSize: parseInt(localStorage.getItem('flashcard-session-size')) || 5, // 5, 10, 20
    isActive: false,     // 演習中かどうか
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
    mixRatio: localStorage.getItem('flashcard-mix-ratio') || 'balanced'
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
    const subjects = [...new Set(DATA.map(d => d.subject).filter(Boolean))];
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
        ${isSearchMode ? renderSearchMode(searchResults) : renderDeckHome(overall, subjects)}
      </div>
    `;

    // イベントバインド
    bindDeckListEvents();
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
    // 時間目安を計算（1問約30秒）
    const timeEstimate = Math.ceil(state.sessionSize * 0.5);

    return `
      <!-- 開始ボタン（カード風） -->
      <div class="deck-start-card" id="deck-start-btn">
        <span class="deck-start-label">開始</span>
        <span class="deck-start-sub" id="deck-start-sub">${state.sessionSize}問 · 約${timeEstimate}分</span>
      </div>

      <!-- 設定（1行に集約） -->
      <button class="deck-settings-line" id="deck-breakdown-link">
        <span class="deck-settings-text">設定：${getModeLabel(state.currentMode)}／${state.sessionSize}問</span>
        <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
          <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z"/>
        </svg>
      </button>

      <!-- 科目一覧（折りたたみ＋検索） -->
      <div class="deck-subjects-wrapper muted">
        <button class="deck-subjects-toggle" id="deck-subjects-toggle">
          <span>科目・デッキを探す</span>
          <svg class="deck-subjects-arrow" viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
            <path d="M7 10l5 5 5-5z"/>
          </svg>
        </button>
        <div class="deck-subjects collapsed" id="deck-subjects">
          <div class="deck-subjects-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"/>
              <path d="M21 21l-4.35-4.35"/>
            </svg>
            <input type="text" id="subjects-search-input" placeholder="科目・デッキを検索" />
          </div>
          <div class="deck-subjects-list" id="deck-subjects-list">
            ${subjects.map(subject => renderSubjectRow(subject)).join('')}
          </div>
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
    const totalLearned = stats.memorized + stats.again;

    // 未学習トピックをカウント（進捗が0のトピック）
    const unlearnedTopics = topics.filter(topic => {
      const topicStats = getTopicStats(topic.id);
      return topicStats.memorized === 0 && topicStats.again === 0;
    }).length;

    // サブ情報を構築
    let subInfo = `${topics.length}トピック`;
    if (totalLearned > 0) {
      subInfo += ` · ${totalLearned}問学習済`;
    }
    if (unlearnedTopics > 0 && totalLearned > 0) {
      subInfo += ` · 未${unlearnedTopics}`;
    }

    return `
      <div class="deck-subject" data-subject="${subject}">
        <div class="deck-subject-header">
          <div class="deck-subject-main">
            <span class="deck-subject-name">${subject}</span>
            <span class="deck-subject-sub">${subInfo}</span>
          </div>
          <div class="deck-subject-right">
            ${stats.again > 0 ? `<span class="deck-subject-again">要復習 ${stats.again}</span>` : ''}
            ${unlearnedTopics > 0 && stats.again === 0 ? `<span class="deck-subject-unlearned">未あり</span>` : ''}
            <span class="deck-subject-chevron">›</span>
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

    // 開始ボタンのクリックでモードに応じて開始
    const startBtn = document.getElementById('deck-start-btn');
    if (startBtn) {
      startBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const mode = state.currentMode || 'mix';

        if (mode === 'mix') {
          startRecommendedDeck();
        } else if (mode === 'new') {
          startNewOnlyDeck();
        } else if (mode === 'memorized') {
          startStatusDeck('memorized');
        } else if (mode === 'again') {
          startStatusDeck('again');
        }
      });
    }
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
    state.currentTopic = { title: status === 'memorized' ? '確認デッキ' : '復習デッキ' };
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

    // 新規のみデッキとして開始
    state.currentTopicId = '__new_only';
    state.currentTopic = { title: '新規カード' };
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

    // ダークモードでも白背景・黒文字で描画するため一時的にクラス追加
    content.classList.add('capture-light-mode');

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
      content.classList.remove('capture-light-mode');
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

  /**
   * 外部からデッキを指定して演習を開始
   */
  async function startDeck(topicId) {
    const topic = DATA.find(d => d.id === topicId);
    if (!topic || !topic.qaPath) return;

    // 演習モードに入る
    state.isActive = true;
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
    if (state.currentTopicId && state.isActive && state.currentIndex > 0) {
      const saveData = {
        index: state.currentIndex,
        order: state.filteredCards.map(c => c.originalIndex),
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
    loadTopic,
    startDeck,
    next,
    prev,
    flip,
    markMemorized,
    markAgain,
    goBack,
    saveSession
  };
})();
