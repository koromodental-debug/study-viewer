// Deck list, deck management, and card list screens.
// Extracted from js/flashcard.js (no runtime wiring yet).

export function createDeckManager(deps) {
  const state = deps.state;
  const getDATA = deps.getDATA || (() => []);
  const SUBJECT_ORDER = deps.SUBJECT_ORDER || [];
  const SUBJECT_CATEGORIES = deps.SUBJECT_CATEGORIES || {};

  const FirebaseSyncRef = deps.FirebaseSyncRef;
  const FirebaseSync = FirebaseSyncRef || (typeof globalThis !== 'undefined' ? globalThis.FirebaseSync : undefined);
  const FavoritesManager = deps.FavoritesManager || (typeof globalThis !== 'undefined' ? globalThis.FavoritesManager : undefined);
  const searchEngine = deps.searchEngine || (typeof globalThis !== 'undefined' ? globalThis.searchEngine : undefined);

  const showToast = deps.showToast || (() => {});
  const renderCard = deps.renderCard || (() => {});
  const renderNoCardsMessage = deps.renderNoCardsMessage || (() => {});
  const showCardPreview = deps.showCardPreview || (() => {});
  const startDailyTenDeck = deps.startDailyTenDeck || (() => {});
  const startStatusDeck = deps.startStatusDeck || (() => {});
  const startSubjectDeck = deps.startSubjectDeck || (() => {});
  const startGroupDeck = deps.startGroupDeck || (() => {});
  const startSubjectDeckFromCards = deps.startSubjectDeckFromCards || (() => {});
  const startGroupDeckFromCards = deps.startGroupDeckFromCards || (() => {});
  const startFavoriteDeck = deps.startFavoriteDeck || (() => {});
  const startSearchResultsDeck = deps.startSearchResultsDeck || (() => {});
  const resumeSearchDeck = deps.resumeSearchDeck || (() => {});
  const loadTopic = deps.loadTopic || (async () => {});
  const loadTableOcclusionDeck = deps.loadTableOcclusionDeck || (async () => {});
  const openSettingsSheet = deps.openSettingsSheet || (() => {});
  const openStatsDetailSheet = deps.openStatsDetailSheet || (() => {});
  const showStatusHelpModal = deps.showStatusHelpModal || (() => {});
  const openReportsOverlay = deps.openReportsOverlay || (() => {});

  const saveProgress = deps.saveProgress || (() => {});
  const getNextInterval = deps.getNextInterval || ((n) => n);
  const DAY_MS = deps.DAY_MS || 24 * 60 * 60 * 1000;

  const getOverallStats = deps.getOverallStats || (() => ({ total: 0, memorized: 0, again: 0, learning: 0, mastered: 0 }));
  const getRecommendedCount = deps.getRecommendedCount || (() => state.sessionSize || 0);
  const getInProgressTopics = deps.getInProgressTopics || (() => []);
  const getReports = deps.getReports || (() => []);
  const getTodayStats = deps.getTodayStats || (() => ({ cardsReviewed: 0, memorized: 0, again: 0, studyTimeMs: 0, sessions: 0 }));
  const getDailyStats = deps.getDailyStats || (() => ({ days: {}, streak: { current: 0, longest: 0, lastStudyDate: null } }));
  const getWeeklyCards = deps.getWeeklyCards || (() => 0);
  const formatStudyTime = deps.formatStudyTime || (() => '0分');

  const collectDailyTenCardRefs = deps.collectDailyTenCardRefs || (async () => []);
  const fetchCardsFromRefs = deps.fetchCardsFromRefs || (async () => []);
  const collectStatusCardRefs = deps.collectStatusCardRefs || (() => []);
  const fetchAllCardsFromTopics = deps.fetchAllCardsFromTopics || (async () => []);

  const SESSIONS_KEY = deps.SESSIONS_KEY || 'studyViewer_flashcardSessions';
  const REPORTS_KEY = deps.REPORTS_KEY || 'studyViewer_cardReports';
  const DECK_CUSTOMIZATIONS_KEY = deps.DECK_CUSTOMIZATIONS_KEY || 'studyViewer_deckCustomizations';

  let container = deps.container || null;
  function setContainer(el) {
    container = el;
  }

  // 重複トピック除外（.txtと.jsonの両方がある場合、.jsonを優先）
  function deduplicateTopics(topics) {
    const seen = new Map(); // basePath -> topic
    for (const topic of topics) {
      const qaPath = topic.qaPath || '';
      // ベースパスを取得（_QA.txt や _QA.json を除去）
      const basePath = qaPath.replace(/_QA\.(txt|json)$/, '');
      if (!basePath) {
        // qaPathがない場合はそのまま追加
        seen.set(topic.id, topic);
        continue;
      }
      const existing = seen.get(basePath);
      if (!existing) {
        seen.set(basePath, topic);
      } else {
        // 既存がある場合、.jsonを優先
        const existingIsJson = (existing.qaPath || '').endsWith('.json');
        const currentIsJson = qaPath.endsWith('.json');
        if (currentIsJson && !existingIsJson) {
          seen.set(basePath, topic);
        }
      }
    }
    return Array.from(seen.values());
  }

  // デッキ操作アクションシート
  function showDeckActionSheet(topicId, deckId) {
    const existing = document.querySelector('.card-action-sheet-overlay');
    if (existing) existing.remove();

    const topic = getDATA().find(d => d.id === topicId);
    const title = topic?.title || 'このデッキ';

    const overlay = document.createElement('div');
    overlay.className = 'card-action-sheet-overlay';
    overlay.innerHTML = `
      <div class="card-action-sheet">
        <button class="card-action-sheet-item edit">編集</button>
        <button class="card-action-sheet-item delete">削除</button>
        <button class="card-action-sheet-item cancel">キャンセル</button>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.classList.contains('cancel')) {
        overlay.remove();
      }
    });

    overlay.querySelector('.edit').addEventListener('click', () => {
      overlay.remove();
      openDeckEditModal(topicId);
    });

    overlay.querySelector('.delete').addEventListener('click', () => {
      overlay.remove();
      showConfirmDialog(
        'デッキを削除',
        `「${title}」を削除しますか？\n\n学習進捗も削除されます。`,
        () => {
          deleteImportedDeck(deckId, topicId);
          renderDeckList();
        },
        true
      );
    });
  }

  // インポート済みデッキをDATAに追加
  function loadImportedDecks() {
    // FirebaseSyncが利用可能な場合のみ
    if (!FirebaseSync) return;

    const importedDecks = FirebaseSync.getImportedDecks();
    if (!importedDecks || importedDecks.length === 0) return;

    for (const deck of importedDecks) {
      addImportedDeckToData(deck);
    }
  }

  // 単一のインポートデッキをDATAに追加
  function addImportedDeckToData(deck) {
    if (!deck) return;

    // ローカルインポート（JSONデータを直接持つ）の場合
    if (deck.isLocal && deck.jsonData) {
      // deck.idは既に'local_'で始まっているのでそのまま使う
      const topicId = deck.id;

      // 既存を削除（重複防止）
      for (let i = getDATA().length - 1; i >= 0; i--) {
        if (DATA[i].id === topicId) {
          getDATA().splice(i, 1);
        }
      }

      // ローカルJSONデッキをDATAに追加
      getDATA().push({
        id: topicId,
        title: deck.title,
        category: `インポート/${deck.category || 'ローカル'}`,
        htmlPath: null,
        qaPath: null, // qaPathはないがjsonDataを持つ
        localJsonData: deck.jsonData, // JSONデータを直接保持
        searchText: `${deck.title} ${deck.category || ''}`,
        source: 'local_imported',
        subject: 'インポート済み',
        subjectCategory: deck.category || 'ローカル',
        importedDeckId: deck.id,
        cardCount: deck.cardCount
      });
      return;
    }

    // Firebase経由のインポート（topicsを持つ）の場合
    if (!deck.topics) return;

    // 既存のトピックを削除（重複防止）
    const existingIds = deck.topics.map(t => `imported_${deck.id}_${t.id}`);
    for (let i = getDATA().length - 1; i >= 0; i--) {
      if (existingIds.includes(DATA[i].id)) {
        getDATA().splice(i, 1);
      }
    }

    // トピックをDATAに追加
    for (const topic of deck.topics) {
      getDATA().push({
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

  // インポートデッキを削除
  function deleteImportedDeck(deckId, topicId) {
    // 1. localStorageから削除
    const IMPORTED_DECKS_KEY = 'studyViewer_importedDecks';
    try {
      const stored = localStorage.getItem(IMPORTED_DECKS_KEY);
      if (stored) {
        let importedDecks = JSON.parse(stored);
        importedDecks = importedDecks.filter(d => d.id !== deckId);
        localStorage.setItem(IMPORTED_DECKS_KEY, JSON.stringify(importedDecks));
      }
    } catch (e) {
      console.error('インポートデッキ削除エラー:', e);
    }

    // 2. DATA配列から削除
    for (let i = getDATA().length - 1; i >= 0; i--) {
      if (DATA[i].id === topicId || DATA[i].importedDeckId === deckId) {
        getDATA().splice(i, 1);
      }
    }

    // 3. 進捗データから関連エントリを削除
    const keysToDelete = Object.keys(state.progress).filter(k => k.startsWith(topicId + ':'));
    for (const key of keysToDelete) {
      delete state.progress[key];
    }
    saveProgress();

    // 4. Firebaseに同期（ログイン中の場合）
    if (FirebaseSync && FirebaseSync.isLoggedIn()) {
      FirebaseSync.sync().catch(e => console.error('同期エラー:', e));
    }

    console.log(`[deleteImportedDeck] 削除完了: ${deckId}`);
  }

  // === デッキカスタマイズ管理 ===
  // データ形式: { "topicId": { "edited": { "3": { "q": "...", "a": "..." } }, "deleted": [5, 12] } }

  function loadDeckCustomizations() {
    try {
      const saved = localStorage.getItem(DECK_CUSTOMIZATIONS_KEY);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.error('[loadDeckCustomizations] 読み込みエラー:', e);
    }
    return {};
  }

  function saveDeckCustomizations(customizations) {
    try {
      localStorage.setItem(DECK_CUSTOMIZATIONS_KEY, JSON.stringify(customizations));
      console.log('[saveDeckCustomizations] 保存完了');
      // Firebase同期
      if (FirebaseSync && FirebaseSync.isLoggedIn()) {
        FirebaseSync.sync().catch(e => console.error('同期エラー:', e));
      }
    } catch (e) {
      console.error('[saveDeckCustomizations] 保存エラー:', e);
    }
  }

  function getTopicCustomization(topicId) {
    const customizations = loadDeckCustomizations();
    return customizations[topicId] || { edited: {}, deleted: [] };
  }

  function saveTopicCustomization(topicId, customization) {
    const customizations = loadDeckCustomizations();
    customizations[topicId] = customization;
    saveDeckCustomizations(customizations);
  }

  function resetTopicCustomization(topicId) {
    const customizations = loadDeckCustomizations();
    if (customizations[topicId]) {
      delete customizations[topicId];
      saveDeckCustomizations(customizations);
      console.log(`[resetTopicCustomization] リセット完了: ${topicId}`);
      return true;
    }
    return false;
  }

  // カスタマイズを適用してカードを返す
  function applyCustomizations(cards, topicId) {
    const customization = getTopicCustomization(topicId);
    const { edited, deleted } = customization;

    // 削除されたカードを除外
    let filteredCards = cards.filter((card, idx) => {
      return !deleted.includes(idx);
    });

    // 編集されたカードを上書き
    filteredCards = filteredCards.map((card, newIdx) => {
      // 元のインデックスを探す（削除によりインデックスがずれている場合を考慮）
      const originalIndex = card.originalIndex !== undefined ? card.originalIndex : card.index;
      if (edited[originalIndex]) {
        return {
          ...card,
          question: edited[originalIndex].q || card.question,
          answer: edited[originalIndex].a || card.answer
        };
      }
      return card;
    });

    // インデックスを再割り当て
    filteredCards.forEach((card, idx) => {
      card.index = idx;
    });

    return filteredCards;
  }

  // トピックにカスタマイズがあるかどうか
  function hasTopicCustomization(topicId) {
    const customization = getTopicCustomization(topicId);
    return Object.keys(customization.edited || {}).length > 0 ||
           (customization.deleted || []).length > 0;
  }

  // === Ankiスタイル デッキ一覧画面 ===
  function renderDeckList() {
    const rawSubjects = [...new Set(getDATA().map(d => d.subject).filter(Boolean))];
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
    if (isSearchMode && searchEngine) {
      const results = searchEngine.search(state.searchQuery);
      searchResults = results.filter(item => item.qaPath);
    }

    if (!container) return;

    container.innerHTML = `
      <div class="deck-list">
        ${renderDeckHome(overall, subjects)}
      </div>
    `;

    // イベントバインド
    bindDeckListEvents();

    // スクロール位置を復元（演習から戻った場合はハイライト付き、一覧から戻った場合は位置のみ）
    restoreDeckListScroll();

    // アコーディオンピルの表示状態を更新（アコーディオンが開いていれば表示可能に）
    if (state.expandedSubjects.size > 0) {
      state.pillVisible = true;
    }
    updateAccordionPillVisibility();
  }

  function restoreDeckListScroll() {
    if (!container) return;
    requestAnimationFrame(() => {
      // 演習から戻った場合：トピックにスクロールしてハイライト
      if (state.lastSelectedTopicId) {
        const topicEl = container.querySelector(`.deck-topic[data-topic-id="${state.lastSelectedTopicId}"]`);
        if (topicEl) {
          topicEl.scrollIntoView({ block: 'center', behavior: 'instant' });
          topicEl.classList.add('last-selected');
          setTimeout(() => topicEl.classList.remove('last-selected'), 1500);
        }
        // ハイライト後にクリア
        state.lastSelectedTopicId = null;
        localStorage.removeItem('flashcard-last-topic');
      }
      // カード一覧から戻った場合：保存した位置に復元
      else if (state.deckListScrollPos > 0) {
        container.scrollTop = state.deckListScrollPos;
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
                ${hitCount > 0 ? `<span class=\"deck-hit-count\">${hitCount}件</span>` : ''}
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
    const favoritesCount = getValidFavoritesCount();

    const dailyTenCompleted = isDailyTenCompleted();

    const todayStats = getTodayStats();
    const dailyStatsData = getDailyStats();
    const weeklyCards = getWeeklyCards();
    const streakCurrent = dailyStatsData.streak.current;
    const todayStudyTime = formatStudyTime(todayStats.studyTimeMs);

    return `
      <!-- 今日の10問 -->
      <div class="daily-ten-section">
        <div class="daily-ten-card ${dailyTenCompleted ? 'completed' : ''}" id="daily-ten-card">
          <div class="daily-ten-title">${dailyTenCompleted ? 'お疲れ様でした' : '今日の10問'}</div>
          <div class="daily-ten-desc">${dailyTenCompleted ? '今日の10問は完了しました' : '全デッキからランダムに出題'}</div>
          ${dailyTenCompleted ? '' : `
          <div class="daily-ten-actions">
            <button class="daily-ten-start-btn" id="daily-ten-start">演習を始める</button>
            <button class="daily-ten-list-btn" id="daily-ten-list">一覧を見る</button>
          </div>
          `}
        </div>
      </div>

      <!-- 学習の記録（タブ切り替え） -->
      <div class="review-center">
        <div class="review-center-header">
          <div class="review-tabs">
            <button class="review-tab active" data-tab="progress">カード</button>
            <button class="review-tab" data-tab="today">記録</button>
            <button class="review-tab" data-tab="analysis">分析</button>
          </div>
          <span class="review-total-count">全 ${overall.again + overall.learning + overall.mastered} 枚</span>
          <div class="review-header-actions">
            <button class="review-help-btn" id="review-help-btn" aria-label="説明">?</button>
            <button class="review-settings-btn ${state.cramMode ? 'cram-active' : ''}" id="review-settings-btn" aria-label="設定">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </button>
          </div>
        </div>

        <!-- 進捗タブ -->
        <div class="review-tab-content" id="review-tab-progress">
          <div class="review-center-cards four-cards">
            <button class="review-card review-card-again ${overall.again === 0 ? 'empty' : ''}" id="start-again-deck" ${overall.again === 0 ? 'disabled' : ''}>
              <span class="review-card-count">${overall.again}</span>
              <span class="review-card-label">要復習 ›</span>
            </button>
            <button class="review-card review-card-learning ${overall.learning === 0 ? 'empty' : ''}" id="start-learning-deck" ${overall.learning === 0 ? 'disabled' : ''}>
              <span class="review-card-count">${overall.learning}</span>
              <span class="review-card-label">定着中 ›</span>
            </button>
            <button class="review-card review-card-mastered ${overall.mastered === 0 ? 'empty' : ''}" id="start-mastered-deck" ${overall.mastered === 0 ? 'disabled' : ''}>
              <span class="review-card-count">${overall.mastered}</span>
              <span class="review-card-label">習得済 ›</span>
            </button>
          </div>
          <button class="favorite-deck-btn ${favoritesCount === 0 ? 'empty' : ''}" id="start-favorite-deck" ${favoritesCount === 0 ? 'disabled' : ''}>
            <span class="favorite-deck-icon">★</span>
            <span class="favorite-deck-label">お気に入り ${favoritesCount}件 ›</span>
          </button>
        </div>

        <!-- 今日タブ -->
        <div class="review-tab-content" id="review-tab-today" style="display:none;">
          <div class="today-stats-grid">
            <div class="today-stat-card streak">
              <span class="today-stat-icon">${streakCurrent > 0 ? '🔥' : '💤'}</span>
              <span class="today-stat-value">${streakCurrent}</span>
              <span class="today-stat-label">日連続</span>
            </div>
            <div class="today-stat-card cards">
              <span class="today-stat-value">${todayStats.cardsReviewed}</span>
              <span class="today-stat-label">今日の枚数</span>
            </div>
            <div class="today-stat-card time">
              <span class="today-stat-value">${todayStudyTime || '0分'}</span>
              <span class="today-stat-label">勉強時間</span>
            </div>
            <div class="today-stat-card weekly">
              <span class="today-stat-value">${weeklyCards}</span>
              <span class="today-stat-label">週間</span>
            </div>
          </div>
          <button class="today-detail-btn" id="today-progress-detail">
            詳しく見る →
          </button>
        </div>

        <!-- 分析タブ -->
        <div class="review-tab-content" id="review-tab-analysis" style="display:none;">
          <!-- renderAnalysisTab() で動的に生成 -->
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
              ${topic.currentPosition ? `<span class=\"continue-item-stats\">${topic.currentPosition}枚目から</span>` : ''}
            </button>
          `).join('')}
        </div>
      </div>
      ` : ''}

      <!-- 表穴埋め（アコーディオン） -->
      <div class="table-occlusion-section">
        <button class="table-occlusion-toggle" id="table-occlusion-toggle">
          <span class="table-occlusion-toggle-icon">📋</span>
          <span class="table-occlusion-toggle-text">表穴埋め</span>
          <span class="table-occlusion-toggle-chevron">›</span>
        </button>
        <div class="table-deck-list collapsed" id="table-deck-list">
          <!-- 必修 -->
          <div class="table-deck-category" style="color: #FF9500">必修</div>
          <button class="table-deck-item" data-deck="deck/必修_table_deck.json">
            <span class="table-deck-icon">📋</span>
            <span class="table-deck-info">
              <span class="table-deck-name">必修</span>
              <span class="table-deck-stats">223表 / 347問</span>
            </span>
            <span class="table-deck-arrow">›</span>
          </button>
          <!-- 基礎系 -->
          <div class="table-deck-category" style="color: #007AFF">基礎系</div>
          <button class="table-deck-item" data-deck="deck/解剖学_table_deck.json">
            <span class="table-deck-icon">📋</span>
            <span class="table-deck-info">
              <span class="table-deck-name">解剖学</span>
              <span class="table-deck-stats">35表 / 62問</span>
            </span>
            <span class="table-deck-arrow">›</span>
          </button>
          <button class="table-deck-item" data-deck="deck/組織学_table_deck.json">
            <span class="table-deck-icon">📋</span>
            <span class="table-deck-info">
              <span class="table-deck-name">組織学</span>
              <span class="table-deck-stats">20表 / 34問</span>
            </span>
            <span class="table-deck-arrow">›</span>
          </button>
          <button class="table-deck-item" data-deck="deck/生理学_table_deck.json">
            <span class="table-deck-icon">📋</span>
            <span class="table-deck-info">
              <span class="table-deck-name">生理学</span>
              <span class="table-deck-stats">57表 / 98問</span>
            </span>
            <span class="table-deck-arrow">›</span>
          </button>
          <button class="table-deck-item" data-deck="deck/生化学_table_deck.json">
            <span class="table-deck-icon">📋</span>
            <span class="table-deck-info">
              <span class="table-deck-name">生化学</span>
              <span class="table-deck-stats">37表 / 62問</span>
            </span>
            <span class="table-deck-arrow">›</span>
          </button>
          <button class="table-deck-item" data-deck="deck/病理学_table_deck.json">
            <span class="table-deck-icon">📋</span>
            <span class="table-deck-info">
              <span class="table-deck-name">病理学</span>
              <span class="table-deck-stats">195表 / 494問</span>
            </span>
            <span class="table-deck-arrow">›</span>
          </button>
          <button class="table-deck-item" data-deck="deck/微生物学・免疫学_table_deck.json">
            <span class="table-deck-icon">📋</span>
            <span class="table-deck-info">
              <span class="table-deck-name">微生物学・免疫学</span>
              <span class="table-deck-stats">40表 / 86問</span>
            </span>
            <span class="table-deck-arrow">›</span>
          </button>
          <button class="table-deck-item" data-deck="deck/薬理学_table_deck.json">
            <span class="table-deck-icon">📋</span>
            <span class="table-deck-info">
              <span class="table-deck-name">薬理学</span>
              <span class="table-deck-stats">30表 / 46問</span>
            </span>
            <span class="table-deck-arrow">›</span>
          </button>
          <button class="table-deck-item" data-deck="deck/歯科理工学_table_deck.json">
            <span class="table-deck-icon">📋</span>
            <span class="table-deck-info">
              <span class="table-deck-name">歯科理工学</span>
              <span class="table-deck-stats">66表 / 134問</span>
            </span>
            <span class="table-deck-arrow">›</span>
          </button>
          <!-- 保存系 -->
          <div class="table-deck-category" style="color: #34C759">保存系</div>
          <button class="table-deck-item" data-deck="deck/保存修復学_table_deck.json">
            <span class="table-deck-icon">📋</span>
            <span class="table-deck-info">
              <span class="table-deck-name">保存修復学</span>
              <span class="table-deck-stats">25表 / 38問</span>
            </span>
            <span class="table-deck-arrow">›</span>
          </button>
          <button class="table-deck-item" data-deck="deck/歯内療法学_table_deck.json">
            <span class="table-deck-icon">📋</span>
            <span class="table-deck-info">
              <span class="table-deck-name">歯内療法学</span>
              <span class="table-deck-stats">41表 / 66問</span>
            </span>
            <span class="table-deck-arrow">›</span>
          </button>
          <button class="table-deck-item" data-deck="deck/歯周病学_table_deck.json">
            <span class="table-deck-icon">📋</span>
            <span class="table-deck-info">
              <span class="table-deck-name">歯周病学</span>
              <span class="table-deck-stats">49表 / 84問</span>
            </span>
            <span class="table-deck-arrow">›</span>
          </button>
          <!-- 補綴系 -->
          <div class="table-deck-category" style="color: #AF52DE">補綴系</div>
          <button class="table-deck-item" data-deck="deck/全部床義歯学_table_deck.json">
            <span class="table-deck-icon">📋</span>
            <span class="table-deck-info">
              <span class="table-deck-name">全部床義歯学</span>
              <span class="table-deck-stats">12表 / 17問</span>
            </span>
            <span class="table-deck-arrow">›</span>
          </button>
          <button class="table-deck-item" data-deck="deck/部分床義歯学_table_deck.json">
            <span class="table-deck-icon">📋</span>
            <span class="table-deck-info">
              <span class="table-deck-name">部分床義歯学</span>
              <span class="table-deck-stats">8表 / 16問</span>
            </span>
            <span class="table-deck-arrow">›</span>
          </button>
          <button class="table-deck-item" data-deck="deck/冠橋義歯学_table_deck.json">
            <span class="table-deck-icon">📋</span>
            <span class="table-deck-info">
              <span class="table-deck-name">冠橋義歯学</span>
              <span class="table-deck-stats">30表 / 66問</span>
            </span>
            <span class="table-deck-arrow">›</span>
          </button>
          <button class="table-deck-item" data-deck="deck/インプラント_table_deck.json">
            <span class="table-deck-icon">📋</span>
            <span class="table-deck-info">
              <span class="table-deck-name">インプラント</span>
              <span class="table-deck-stats">9表 / 26問</span>
            </span>
            <span class="table-deck-arrow">›</span>
          </button>
          <!-- 外科系 -->
          <div class="table-deck-category" style="color: #FF3B30">外科系</div>
          <button class="table-deck-item" data-deck="deck/口腔外科学_table_deck.json">
            <span class="table-deck-icon">📋</span>
            <span class="table-deck-info">
              <span class="table-deck-name">口腔外科学</span>
              <span class="table-deck-stats">16表 / 39問</span>
            </span>
            <span class="table-deck-arrow">›</span>
          </button>
          <button class="table-deck-item" data-deck="deck/小児歯科_table_deck.json">
            <span class="table-deck-icon">📋</span>
            <span class="table-deck-info">
              <span class="table-deck-name">小児歯科</span>
              <span class="table-deck-stats">71表 / 135問</span>
            </span>
            <span class="table-deck-arrow">›</span>
          </button>
          <button class="table-deck-item" data-deck="deck/矯正_table_deck.json">
            <span class="table-deck-icon">📋</span>
            <span class="table-deck-info">
              <span class="table-deck-name">矯正</span>
              <span class="table-deck-stats">44表 / 81問</span>
            </span>
            <span class="table-deck-arrow">›</span>
          </button>
          <button class="table-deck-item" data-deck="deck/摂食嚥下_table_deck.json">
            <span class="table-deck-icon">📋</span>
            <span class="table-deck-info">
              <span class="table-deck-name">摂食嚥下</span>
              <span class="table-deck-stats">11表 / 15問</span>
            </span>
            <span class="table-deck-arrow">›</span>
          </button>
          <!-- 社会歯科系 -->
          <div class="table-deck-category" style="color: #5AC8FA">社会歯科系</div>
          <button class="table-deck-item" data-deck="deck/公衆衛生_table_deck.json">
            <span class="table-deck-icon">📋</span>
            <span class="table-deck-info">
              <span class="table-deck-name">公衆衛生</span>
              <span class="table-deck-stats">53表 / 87問</span>
            </span>
            <span class="table-deck-arrow">›</span>
          </button>
          <button class="table-deck-item" data-deck="deck/疫学_table_deck.json">
            <span class="table-deck-icon">📋</span>
            <span class="table-deck-info">
              <span class="table-deck-name">疫学</span>
              <span class="table-deck-stats">26表 / 46問</span>
            </span>
            <span class="table-deck-arrow">›</span>
          </button>
          <button class="table-deck-item" data-deck="deck/口腔衛生_table_deck.json">
            <span class="table-deck-icon">📋</span>
            <span class="table-deck-info">
              <span class="table-deck-name">口腔衛生</span>
              <span class="table-deck-stats">21表 / 40問</span>
            </span>
            <span class="table-deck-arrow">›</span>
          </button>
        </div>
      </div>

      <!-- 科目一覧 -->
      <div class="deck-subjects-wrapper">
        <div class="deck-subjects-list" id="deck-subjects-list">
          ${renderSubjectsWithCategories(subjects)}
        </div>
      </div>
    `;
  }

  // 科目リストをカテゴリヘッダー付きでレンダリング
  function renderSubjectsWithCategories(subjects) {
    let lastCategory = null;
    return subjects.map(subject => {
      const info = SUBJECT_CATEGORIES[subject] || { category: 'その他', color: '#8E8E93' };
      let header = '';
      if (info.category !== lastCategory) {
        header = `<div class="deck-category-header" style="color: ${info.color}">
          <span class="deck-category-name">${info.category}</span>
        </div>`;
        lastCategory = info.category;
      }
      return header + renderSubjectRow(subject, info.color);
    }).join('');
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

  function renderSubjectRow(subject, categoryColor) {
    // カテゴリ色が渡されない場合はSUBJECT_CATEGORIESから取得
    const catColor = categoryColor || (SUBJECT_CATEGORIES[subject] || { color: '#8E8E93' }).color;
    const allTopics = getDATA().filter(d => d.subject === subject && (d.qaPath || d.localJsonData));
    // 重複除外: .txtと.jsonの両方がある場合、.jsonを優先
    const topics = deduplicateTopics(allTopics);
    const stats = deps.getSubjectStats ? deps.getSubjectStats(state, DATA, subject) : { again: 0 };
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
      const kokoshikaStats = deps.getTopicStats ? deps.getTopicStats(state, 'kokoshika_hisshu') : { memorized: 0, again: 0 };
      const kokoshikaTotal = kokoshikaStats.memorized + kokoshikaStats.again;
      let kokoshikaStatsHtml = '';
      if (kokoshikaTotal === 0) {
        kokoshikaStatsHtml = '<span class="deck-stat-new">424問</span>';
      } else if (kokoshikaStats.again > 0) {
        kokoshikaStatsHtml = `<span class=\"deck-stat again\">要復習 ${kokoshikaStats.again}</span>`;
      } else {
        kokoshikaStatsHtml = `<span class=\"deck-stat memorized\">✓ ${kokoshikaStats.memorized}</span>`;
      }
      kokoshikaBanner = `
        <div class="kokoshika-banner" data-topic-id="kokoshika_hisshu">
          <div class="kokoshika-banner-content">
            <div class="kokoshika-banner-text">
              <div class="kokoshika-banner-title">必修ココシカ</div>
              <div class="kokoshika-banner-desc">★★★超頻出のみ424問</div>
            </div>
          </div>
          <div class="kokoshika-banner-right">
            <div class="kokoshika-banner-stats">
              ${kokoshikaStatsHtml}
            </div>
            <button class="kokoshika-list-btn" data-topic-id="kokoshika_hisshu" title="カード一覧">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="8" y1="6" x2="21" y2="6"></line>
                <line x1="8" y1="12" x2="21" y2="12"></line>
                <line x1="8" y1="18" x2="21" y2="18"></line>
                <line x1="3" y1="6" x2="3.01" y2="6"></line>
                <line x1="3" y1="12" x2="3.01" y2="12"></line>
                <line x1="3" y1="18" x2="3.01" y2="18"></line>
              </svg>
            </button>
          </div>
        </div>
      `;
    }

    // インポート済みセクションには管理ボタンを表示
    const manageBtn = subject === 'インポート済み' ? `
      <button class="deck-manage-toggle-btn" id="deck-manage-toggle" title="デッキを管理">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="1"></circle>
          <circle cx="12" cy="5" r="1"></circle>
          <circle cx="12" cy="19" r="1"></circle>
        </svg>
      </button>
    ` : '';

    return `
      <div class="deck-subject${isOpen ? ' open' : ''}" data-subject="${subject}">
        <div class="deck-subject-header">
          <div class="deck-subject-main">
            <span class="deck-subject-name">${subject}</span>
          </div>
          <div class="deck-subject-right">
            ${stats.again > 0 ? `<span class=\"deck-subject-again\">要復習 ${stats.again}</span>` : ''}
            <button class="subject-list-btn" data-subject="${subject}" title="カード一覧">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="8" y1="6" x2="21" y2="6"></line>
                <line x1="8" y1="12" x2="21" y2="12"></line>
                <line x1="8" y1="18" x2="21" y2="18"></line>
                <line x1="3" y1="6" x2="3.01" y2="6"></line>
                <line x1="3" y1="12" x2="3.01" y2="12"></line>
                <line x1="3" y1="18" x2="3.01" y2="18"></line>
              </svg>
            </button>
            ${manageBtn}
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
      // html/subject/科目/大項目/xxx.html の構造を想定
      let groupName = null;
      if (topic.htmlPath) {
        const match = topic.htmlPath.match(/html\/subject\/[^/]+\/([^/]+)\//);
        if (match) groupName = match[1];
      } else if (topic.qaPath) {
        const match = topic.qaPath.match(/qa\/subject\/[^/]+\/([^/]+)\//);
        if (match) groupName = match[1];
      }

      if (!groupName) {
        groupName = 'その他';
      }

      if (!groups.has(groupName)) {
        groups.set(groupName, []);
      }
      groups.get(groupName).push(topic);
    });

    let html = '';
    groups.forEach((groupTopics, groupName) => {
      html += `
        <div class="deck-group">
          <div class="deck-group-header">
            <span class="deck-group-name">${groupName}</span>
            <button class="group-list-btn" data-group-name="${groupName}" data-topic-ids='${JSON.stringify(groupTopics.map(t => t.id))}'>
              カード一覧
            </button>
          </div>
          ${groupTopics.map(topic => renderTopicRow(topic, groupName)).join('')}
        </div>
      `;
    });

    return html;
  }

  function renderTopicRow(topic, groupName = null) {
    const key = `${topic.id}`;
    const stats = deps.getTopicStats ? deps.getTopicStats(state, topic.id) : { memorized: 0, again: 0 };
    const total = stats.memorized + stats.again;

    let statsHtml = '';
    if (total === 0) {
      statsHtml = `<span class="deck-stat-new">${topic.cardCount || topic.count || '-'}問</span>`;
    } else if (stats.again > 0) {
      statsHtml = `<span class="deck-stat again">要復習 ${stats.again}</span>`;
    } else {
      statsHtml = `<span class="deck-stat memorized">✓ ${stats.memorized}</span>`;
    }

    // インポート済みデッキはメニューボタンを表示
    const moreBtn = topic.source === 'local_imported' ? `
      <button class="deck-more-btn" data-topic-id="${topic.id}" data-deck-id="${topic.importedDeckId || ''}" title="メニュー">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="2"/>
          <circle cx="12" cy="12" r="2"/>
          <circle cx="12" cy="19" r="2"/>
        </svg>
      </button>
    ` : '';

    // ハイライト対象かどうか
    const highlighted = state.highlightTopicId === topic.id ? 'highlighted' : '';

    return `
      <div class="deck-topic ${highlighted}" data-topic-id="${topic.id}" data-group="${groupName || ''}">
        <div class="deck-topic-left">
          <div class="deck-topic-title">${escapeHtml(topic.title)}</div>
          <div class="deck-topic-meta">${escapeHtml(topic.category || '')}</div>
        </div>
        <div class="deck-topic-right">
          ${statsHtml}
          <button class="deck-start-btn">演習</button>
          <button class="deck-list-btn" title="カード一覧">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="8" y1="6" x2="21" y2="6"></line>
              <line x1="8" y1="12" x2="21" y2="12"></line>
              <line x1="8" y1="18" x2="21" y2="18"></line>
              <line x1="3" y1="6" x2="3.01" y2="6"></line>
              <line x1="3" y1="12" x2="3.01" y2="12"></line>
              <line x1="3" y1="18" x2="3.01" y2="18"></line>
            </svg>
          </button>
          ${moreBtn}
        </div>
      </div>
    `;
  }

  // === 今日の10問 ===
  function isDailyTenCompleted() {
    const completedDate = localStorage.getItem('flashcard-daily-ten-completed');
    const today = new Date().toDateString();
    return completedDate === today;
  }

  // === デッキ一覧イベント ===
  function bindDeckListEvents() {
    if (!container) return;

    // 今日の10問
    const dailyTenCard = document.getElementById('daily-ten-card');
    const dailyTenStartBtn = document.getElementById('daily-ten-start');
    const dailyTenListBtn = document.getElementById('daily-ten-list');
    if (dailyTenCard) {
      dailyTenCard.addEventListener('click', () => {
        if (isDailyTenCompleted()) return;
        startDailyTenDeck();
      });
    }
    if (dailyTenStartBtn) {
      dailyTenStartBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        startDailyTenDeck();
      });
    }
    if (dailyTenListBtn) {
      dailyTenListBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        renderDailyTenCardList();
      });
    }

    // 学習の記録タブ切り替え
    const reviewTabs = container.querySelectorAll('.review-tab');
    reviewTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const targetTab = tab.dataset.tab;

        // タブのアクティブ状態を切り替え
        reviewTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        // コンテンツの表示切り替え
        const progressContent = document.getElementById('review-tab-progress');
        const todayContent = document.getElementById('review-tab-today');
        const analysisContent = document.getElementById('review-tab-analysis');

        if (progressContent) progressContent.style.display = targetTab === 'progress' ? 'block' : 'none';
        if (todayContent) todayContent.style.display = targetTab === 'today' ? 'block' : 'none';
        if (analysisContent) analysisContent.style.display = targetTab === 'analysis' ? 'block' : 'none';

        // 分析タブが選択されたらレンダリング
        if (targetTab === 'analysis' && analysisContent) {
          renderAnalysisTab(analysisContent);
        }
      });
    });

    // 「？」説明ボタン
    const helpBtn = document.getElementById('review-help-btn');
    if (helpBtn) {
      helpBtn.addEventListener('click', () => showStatusHelpModal());
    }

    // 設定ボタン（歯車アイコン）
    const settingsBtn = document.getElementById('review-settings-btn');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', () => openSettingsSheet());
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

    // 科目一覧ボタンクリック
    const subjectListBtns = container.querySelectorAll('.subject-list-btn');
    subjectListBtns.forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        state.deckListScrollPos = container.scrollTop;
        const subject = btn.dataset.subject;
        await renderSubjectCardList(subject);
      });
    });

    // 大項目一覧ボタンクリック
    const groupListBtns = container.querySelectorAll('.group-list-btn');
    groupListBtns.forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        state.deckListScrollPos = container.scrollTop;
        const topicIds = JSON.parse(btn.dataset.topicIds);
        const groupName = btn.dataset.groupName;
        await renderGroupCardList(topicIds, groupName);
      });
    });

    // デッキ検索
    const searchInput = document.getElementById('deck-inline-search');
    const searchClear = document.getElementById('deck-search-clear');
    const searchCancel = document.getElementById('deck-search-cancel');

    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        state.searchQuery = e.target.value;
        renderDeckList();
      });
    }

    if (searchClear) {
      searchClear.addEventListener('click', () => {
        state.searchQuery = '';
        renderDeckList();
      });
    }

    if (searchCancel) {
      searchCancel.addEventListener('click', () => {
        state.searchQuery = '';
        renderDeckList();
      });
    }

    // 検索結果クリック
    const searchResults = container.querySelectorAll('.deck-search-result');
    searchResults.forEach(result => {
      result.addEventListener('click', async () => {
        const topicId = result.dataset.id;
        state.searchQuery = '';
        await loadTopic(topicId, state.shuffleEnabled);
      });
    });

    // デッキクリック（演習開始）
    const deckTopics = container.querySelectorAll('.deck-topic');
    deckTopics.forEach(topic => {
      topic.addEventListener('click', async (e) => {
        if (e.target.closest('.deck-list-btn') || e.target.closest('.deck-more-btn')) return;
        const topicId = topic.dataset.topicId;
        state.lastSelectedTopicId = topicId;
        localStorage.setItem('flashcard-last-topic', topicId);
        await loadTopic(topicId, state.shuffleEnabled);
      });
    });

    // カード一覧ボタン
    const deckListBtns = container.querySelectorAll('.deck-list-btn');
    deckListBtns.forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        state.deckListScrollPos = container.scrollTop;
        const topicId = btn.closest('.deck-topic')?.dataset.topicId;
        if (topicId) {
          await renderDeckCardList(topicId);
        }
      });
    });

    // デッキメニューボタン
    const moreBtns = container.querySelectorAll('.deck-more-btn');
    moreBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const topicId = btn.dataset.topicId;
        const deckId = btn.dataset.deckId;
        showDeckActionSheet(topicId, deckId);
      });
    });

    // インポートデッキ管理ボタン
    const manageBtn = document.getElementById('deck-manage-toggle');
    if (manageBtn) {
      manageBtn.addEventListener('click', () => openDeckManageModal());
    }

    // ステータスデッキ
    const againBtn = document.getElementById('start-again-deck');
    const learningBtn = document.getElementById('start-learning-deck');
    const masteredBtn = document.getElementById('start-mastered-deck');
    const favoriteBtn = document.getElementById('start-favorite-deck');

    if (againBtn) againBtn.addEventListener('click', () => renderStatusDeckCardList('again'));
    if (learningBtn) learningBtn.addEventListener('click', () => renderStatusDeckCardList('learning'));
    if (masteredBtn) masteredBtn.addEventListener('click', () => renderStatusDeckCardList('mastered'));
    if (favoriteBtn) favoriteBtn.addEventListener('click', () => renderFavoriteDeckCardList());

    // 今日の統計詳細
    const todayDetailBtn = document.getElementById('today-progress-detail');
    if (todayDetailBtn) {
      todayDetailBtn.addEventListener('click', () => openStatsDetailSheet());
    }

    // テーブル穴埋めデッキ
    const tableDeckItems = container.querySelectorAll('.table-deck-item');
    tableDeckItems.forEach(item => {
      item.addEventListener('click', async (e) => {
        e.stopPropagation();
        const deckPath = item.dataset.deck;
        if (deckPath) {
          await loadTableOcclusionDeck(deckPath);
        }
      });
    });
  }

  // === 今日の10問一覧 ===
  async function renderDailyTenCardList() {
    console.log('[renderDailyTenCardList] 開始');
    const cardRefs = await collectDailyTenCardRefs();

    if (cardRefs.length === 0) {
      return;
    }

    const filteredCards = await fetchCardsFromRefs(cardRefs);
    if (filteredCards.length === 0) {
      return;
    }

    const title = '今日の10問';

    // ヘッダー
    const headerHtml = `
      <div class="deck-card-list-header">
        <button class="deck-card-list-back" id="deck-card-list-back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="15 18 9 12 15 6"></polyline>
          </svg>
        </button>
        <div class="deck-card-list-title">
          <span class="deck-card-list-topic">${title}</span>
          <span class="deck-card-list-count">${filteredCards.length}枚</span>
        </div>
        <div class="deck-card-list-actions">
          <button class="deck-card-list-start" id="deck-card-list-start">演習</button>
        </div>
      </div>
    `;

    // カード一覧
    const cardsHtml = filteredCards.map((card, idx) => {
      const key = card.progressKey;
      const cardProgress = state.progress[key];
      const cardStatus = cardProgress ? cardProgress.status : 'new';
      const isFavorite = FavoritesManager && FavoritesManager.isFavoriteByParams('qa', card.topicId, card.originalIndex);

      return `
        <div class="card-search-item" data-key="${escapeHtml(key)}" data-card-index="${idx}">
          <div class="card-search-card deck-card-list-card" data-key="${escapeHtml(key)}">
            <div class="card-search-question">Q: ${escapeHtml(card.question)}</div>
          </div>
          <div class="card-search-footer">
            <div class="card-search-meta">
              ${card.topicTitle || ''}
              <button class="goto-deck-btn" data-topic-id="${escapeHtml(card.topicId)}" title="デッキを見る">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                  <polyline points="15 3 21 3 21 9"></polyline>
                  <line x1="10" y1="14" x2="21" y2="3"></line>
                </svg>
              </button>
            </div>
            <div class="card-search-actions">
              <button class="card-search-favorite-btn ${isFavorite ? 'active' : ''}" data-key="${escapeHtml(key)}" data-topic-id="${escapeHtml(card.topicId)}" data-original-index="${card.originalIndex}" data-question="${escapeHtml(card.question)}" data-answer="${escapeHtml(card.answer)}" data-section="${card.section ? escapeHtml(card.section) : ''}" title="お気に入り">
                <svg viewBox="0 0 24 24" fill="${isFavorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                </svg>
              </button>
              <button class="card-search-action-btn again ${cardStatus === 'again' ? 'active' : ''}" data-key="${escapeHtml(key)}" data-action="again">もう一度</button>
              <button class="card-search-action-btn memorized ${cardStatus === 'memorized' ? 'active' : ''}" data-key="${escapeHtml(key)}" data-action="memorized">覚えた</button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    if (!container) return;
    container.innerHTML = `
      <div class="deck-card-list-view" data-status="daily_ten">
        ${headerHtml}
        <div class="deck-card-list-content">
          ${cardsHtml}
        </div>
      </div>
    `;

    // タブバーを非表示
    const tabbar = document.querySelector('.floating-tabbar');
    if (tabbar) tabbar.classList.add('hidden');

    // アコーディオン全閉じピルを非表示
    updateAccordionPillVisibility(true);

    // イベントバインド
    bindDailyTenCardListEvents(filteredCards);
  }

  // 今日の10問一覧のイベントバインド
  function bindDailyTenCardListEvents(filteredCards) {
    // 戻るボタン
    const backBtn = document.getElementById('deck-card-list-back');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        const tabbar = document.querySelector('.floating-tabbar');
        if (tabbar) tabbar.classList.remove('hidden');
        renderDeckList();
        window.scrollTo(0, 0);
        container.scrollTop = 0;
      });
    }

    // スワイプで戻る
    const listView = container.querySelector('.deck-card-list-view');
    if (listView) {
      let touchStartX = 0;
      let touchStartY = 0;
      let isSwiping = false;

      container.addEventListener('touchstart', (e) => {
        const touch = e.touches[0];
        if (touch.clientX <= 40) {
          touchStartX = touch.clientX;
          touchStartY = touch.clientY;
          isSwiping = true;
        }
      }, { passive: true });

      container.addEventListener('touchend', (e) => {
        if (!isSwiping) return;
        isSwiping = false;
        const touch = e.changedTouches[0];
        const deltaX = touch.clientX - touchStartX;
        const deltaY = Math.abs(touch.clientY - touchStartY);
        if (deltaX > 80 && deltaY < 100) {
          const tabbar = document.querySelector('.floating-tabbar');
          if (tabbar) tabbar.classList.remove('hidden');
          renderDeckList();
          window.scrollTo(0, 0);
          container.scrollTop = 0;
        }
      }, { passive: true });
    }

    // 演習開始ボタン
    const startBtn = document.getElementById('deck-card-list-start');
    if (startBtn) {
      startBtn.addEventListener('click', () => {
        startDailyTenDeck();
      });
    }

    // デッキジャンプボタン
    const gotoDeckBtns = container.querySelectorAll('.goto-deck-btn');
    gotoDeckBtns.forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const topicId = btn.dataset.topicId;

        // トピックを検索して科目を取得
        let topic = getDATA().find(d => d.id === topicId);
        if (!topic) {
          topic = getDATA().find(d => d.id.includes(topicId) || d.id.endsWith('_' + topicId.toLowerCase()));
        }
        if (!topic) {
          topic = getDATA().find(d => d.title === topicId || topicId.includes(d.title));
        }

        if (topic) {
          // ハイライト対象を設定
          state.highlightTopicId = topic.id;
          // 科目を展開
          if (topic.subject) {
            state.expandedSubjects.add(topic.subject);
            localStorage.setItem('flashcard-expanded-subjects', JSON.stringify([...state.expandedSubjects]));
          }
        }

        // タブバーを表示
        const tabbar = document.querySelector('.floating-tabbar');
        if (tabbar) tabbar.classList.remove('hidden');

        // デッキ一覧に戻る
        renderDeckList();

        // 少し待ってからスクロールしてハイライトをクリア
        setTimeout(() => {
          const highlightedTopic = container.querySelector('.deck-topic.highlighted');
          if (highlightedTopic) {
            highlightedTopic.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
          // 3秒後にハイライトを消す
          setTimeout(() => {
            state.highlightTopicId = null;
            if (highlightedTopic) {
              highlightedTopic.classList.remove('highlighted');
            }
          }, 3000);
        }, 100);
      });
    });

    // カードクリックで展開
    const cardItems = container.querySelectorAll('.card-search-item');
    cardItems.forEach((item, idx) => {
      const card = filteredCards[idx];
      if (!card) return;

      item.addEventListener('click', (e) => {
        if (e.target.closest('.card-search-action-btn') || e.target.closest('.card-search-favorite-btn') || e.target.closest('.goto-deck-btn')) {
          return;
        }

        const isExpanded = item.classList.contains('expanded');
        cardItems.forEach(other => {
          if (other !== item && other.classList.contains('expanded')) {
            other.classList.remove('expanded');
            const answerEl = other.querySelector('.card-search-answer');
            if (answerEl) answerEl.remove();
          }
        });

        if (!isExpanded) {
          item.classList.add('expanded');
          const cardEl = item.querySelector('.card-search-card');
          if (cardEl) {
            const answerHtml = `<div class="card-search-answer">A: ${escapeHtml(card.answer)}</div>`;
            cardEl.insertAdjacentHTML('beforeend', answerHtml);
          }
        } else {
          item.classList.remove('expanded');
          const answerEl = item.querySelector('.card-search-answer');
          if (answerEl) answerEl.remove();
        }
      });
    });

    // お気に入りボタン
    const favBtns = container.querySelectorAll('.card-search-favorite-btn');
    favBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const topicId = btn.dataset.topicId;
        const originalIndex = parseInt(btn.dataset.originalIndex);
        const question = btn.dataset.question;
        const answer = btn.dataset.answer;
        const section = btn.dataset.section;

        const content = { question, answer, section };
        const isFav = FavoritesManager && FavoritesManager.toggle('qa', topicId, originalIndex, content);
        btn.classList.toggle('active', isFav);
        const svg = btn.querySelector('svg');
        if (svg) svg.setAttribute('fill', isFav ? 'currentColor' : 'none');
      });
    });

    // ステータスボタン
    const actionBtns = container.querySelectorAll('.card-search-action-btn');
    actionBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const key = btn.dataset.key;
        const action = btn.dataset.action;
        const now = Date.now();

        const existing = state.progress[key] || {};
        const currentInterval = existing.interval || 0;

        if (action === 'memorized') {
          const newInterval = currentInterval === 0 ? state.initialInterval : getNextInterval(currentInterval);
          state.progress[key] = {
            status: 'memorized',
            lastReview: now,
            nextReview: now + newInterval * DAY_MS,
            interval: newInterval,
            successCount: (existing.successCount || 0) + 1
          };
        } else {
          // again
          const nextReviewDelay = state.againDelay === 'immediate' ? 0 : DAY_MS;
          state.progress[key] = {
            status: 'again',
            lastReview: now,
            nextReview: now + nextReviewDelay,
            interval: state.againDelay === 'immediate' ? 0 : 1,
            successCount: 0
          };
        }
        saveProgress();

        const item = btn.closest('.card-search-item');
        const againBtn = item.querySelector('.card-search-action-btn.again');
        const memorizedBtn = item.querySelector('.card-search-action-btn.memorized');
        againBtn.classList.toggle('active', action === 'again');
        memorizedBtn.classList.toggle('active', action === 'memorized');
      });
    });
  }

  // === ステータスデッキのカード一覧 ===
  async function renderStatusDeckCardList(status) {
    console.log('[renderStatusDeckCardList] 開始:', status);
    const cardRefs = collectStatusCardRefs(status);

    if (cardRefs.length === 0) return;

    const filteredCards = await fetchCardsFromRefs(cardRefs);
    if (filteredCards.length === 0) return;

    const titleMap = {
      again: '要復習',
      learning: '定着中',
      mastered: '習得済',
      memorized: '覚えた'
    };
    const title = titleMap[status] || 'カード一覧';

    // ヘッダー
    const headerHtml = `
      <div class="deck-card-list-header">
        <button class="deck-card-list-back" id="deck-card-list-back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="15 18 9 12 15 6"></polyline>
          </svg>
        </button>
        <div class="deck-card-list-title">
          <span class="deck-card-list-topic">${title}</span>
          <span class="deck-card-list-count">${filteredCards.length}枚</span>
        </div>
        <div class="deck-card-list-actions">
          <button class="deck-card-list-start" id="deck-card-list-start">演習</button>
        </div>
      </div>
    `;

    const cardsHtml = filteredCards.map((card, idx) => {
      const key = card.progressKey;
      const cardProgress = state.progress[key];
      const cardStatus = cardProgress ? cardProgress.status : 'new';
      const isFavorite = FavoritesManager && FavoritesManager.isFavoriteByParams('qa', card.topicId, card.originalIndex);

      return `
        <div class="card-search-item" data-key="${escapeHtml(key)}" data-card-index="${idx}">
          <div class="card-search-card deck-card-list-card" data-key="${escapeHtml(key)}">
            <div class="card-search-question">Q: ${escapeHtml(card.question)}</div>
          </div>
          <div class="card-search-footer">
            <div class="card-search-meta">${card.topicTitle || ''}</div>
            <div class="card-search-actions">
              <button class="card-search-favorite-btn ${isFavorite ? 'active' : ''}" data-key="${escapeHtml(key)}" data-topic-id="${escapeHtml(card.topicId)}" data-original-index="${card.originalIndex}" data-question="${escapeHtml(card.question)}" data-answer="${escapeHtml(card.answer)}" data-section="${card.section ? escapeHtml(card.section) : ''}" title="お気に入り">
                <svg viewBox="0 0 24 24" fill="${isFavorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                </svg>
              </button>
              <button class="card-search-action-btn again ${cardStatus === 'again' ? 'active' : ''}" data-key="${escapeHtml(key)}" data-action="again">もう一度</button>
              <button class="card-search-action-btn memorized ${cardStatus === 'memorized' ? 'active' : ''}" data-key="${escapeHtml(key)}" data-action="memorized">覚えた</button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    if (!container) return;
    container.innerHTML = `
      <div class="deck-card-list-view" data-status="${status}">
        ${headerHtml}
        <div class="deck-card-list-content">
          ${cardsHtml}
        </div>
      </div>
    `;

    const tabbar = document.querySelector('.floating-tabbar');
    if (tabbar) tabbar.classList.add('hidden');

    updateAccordionPillVisibility(true);

    bindStatusDeckCardListEvents(status, filteredCards);
  }

  function bindStatusDeckCardListEvents(status, filteredCards) {
    const backBtn = document.getElementById('deck-card-list-back');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        const tabbar = document.querySelector('.floating-tabbar');
        if (tabbar) tabbar.classList.remove('hidden');
        renderDeckList();
      });
    }

    const startBtn = document.getElementById('deck-card-list-start');
    if (startBtn) {
      startBtn.addEventListener('click', () => {
        startStatusDeck(status);
      });
    }

    const actionBtns = container.querySelectorAll('.card-search-action-btn');
    actionBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const key = btn.dataset.key;
        const action = btn.dataset.action;
        const now = Date.now();

        const existing = state.progress[key] || {};
        const currentInterval = existing.interval || 0;

        if (action === 'memorized') {
          const newInterval = currentInterval === 0 ? state.initialInterval : getNextInterval(currentInterval);
          state.progress[key] = {
            status: 'memorized',
            lastReview: now,
            nextReview: now + newInterval * DAY_MS,
            interval: newInterval,
            successCount: (existing.successCount || 0) + 1
          };
        } else {
          const nextReviewDelay = state.againDelay === 'immediate' ? 0 : DAY_MS;
          state.progress[key] = {
            status: 'again',
            lastReview: now,
            nextReview: now + nextReviewDelay,
            interval: state.againDelay === 'immediate' ? 0 : 1,
            successCount: 0
          };
        }
        saveProgress();

        const parent = btn.closest('.card-search-actions');
        if (parent) {
          parent.querySelectorAll('.card-search-action-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        }
      });
    });

    const favBtns = container.querySelectorAll('.card-search-favorite-btn');
    favBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const favTopicId = btn.dataset.topicId;
        const originalIndex = parseInt(btn.dataset.originalIndex);
        const content = {
          question: btn.dataset.question,
          answer: btn.dataset.answer,
          section: btn.dataset.section || ''
        };

        const newFavorite = FavoritesManager && FavoritesManager.toggle('qa', favTopicId, originalIndex, content);

        btn.classList.toggle('active', newFavorite);
        const svg = btn.querySelector('svg');
        if (svg) {
          svg.setAttribute('fill', newFavorite ? 'currentColor' : 'none');
        }
        showToast(newFavorite ? 'お気に入りに追加' : 'お気に入りから削除', 1000);
      });
    });
  }

  // === お気に入りデッキ ===
  function getValidFavoritesCount() {
    if (!FavoritesManager) return 0;
    const favorites = FavoritesManager.getByType('qa');
    let validCount = 0;
    for (const fav of favorites) {
      let topic = getDATA().find(d => d.id === fav.topicId);
      if (!topic && fav.topicId === 'kokoshika_hisshu') {
        topic = { id: 'kokoshika_hisshu' };
      }
      if (topic) {
        validCount++;
      }
    }
    return validCount;
  }

  function cleanupOrphanedFavorites() {
    if (!FavoritesManager) return 0;
    const favorites = FavoritesManager.getByType('qa');
    let removedCount = 0;
    for (const fav of favorites) {
      let topic = getDATA().find(d => d.id === fav.topicId);
      if (!topic && fav.topicId === 'kokoshika_hisshu') {
        topic = { id: 'kokoshika_hisshu' };
      }
      if (!topic) {
        FavoritesManager.remove(fav.id);
        removedCount++;
        console.log('[Favorites] 孤立したお気に入りを削除:', fav.topicId);
      }
    }
    return removedCount;
  }

  async function renderFavoriteDeckCardList() {
    cleanupOrphanedFavorites();

    if (!FavoritesManager) return;
    const allFavorites = FavoritesManager.getAll();
    const favorites = allFavorites.filter(f => f.type === 'qa');
    if (favorites.length === 0) return;

    // お気に入りカードを参照情報に変換
    const cardRefs = favorites.map(f => ({
      topicId: f.topicId,
      cardIndex: parseInt(f.cardIndex),
      key: `${f.topicId}:${f.cardIndex}`
    }));

    const filteredCards = await fetchCardsFromRefs(cardRefs);
    if (filteredCards.length === 0) return;

    const headerHtml = `
      <div class="deck-card-list-header">
        <button class="deck-card-list-back" id="deck-card-list-back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="15 18 9 12 15 6"></polyline>
          </svg>
        </button>
        <div class="deck-card-list-title">
          <span class="deck-card-list-topic">お気に入り</span>
          <span class="deck-card-list-count">${filteredCards.length}枚</span>
        </div>
        <div class="deck-card-list-actions">
          <button class="deck-card-list-start" id="deck-card-list-start">演習</button>
        </div>
      </div>
    `;

    const cardsHtml = filteredCards.map((card, idx) => {
      const key = card.progressKey;
      const cardProgress = state.progress[key];
      const cardStatus = cardProgress ? cardProgress.status : 'new';
      const isFavorite = FavoritesManager && FavoritesManager.isFavoriteByParams('qa', card.topicId, card.originalIndex);

      return `
        <div class="card-search-item" data-key="${escapeHtml(key)}" data-card-index="${idx}">
          <div class="card-search-card deck-card-list-card" data-key="${escapeHtml(key)}">
            <div class="card-search-question">Q: ${escapeHtml(card.question)}</div>
          </div>
          <div class="card-search-footer">
            <div class="card-search-meta">${card.topicTitle || ''}</div>
            <div class="card-search-actions">
              <button class="card-search-favorite-btn ${isFavorite ? 'active' : ''}" data-key="${escapeHtml(key)}" data-topic-id="${escapeHtml(card.topicId)}" data-original-index="${card.originalIndex}" data-question="${escapeHtml(card.question)}" data-answer="${escapeHtml(card.answer)}" data-section="${card.section ? escapeHtml(card.section) : ''}" title="お気に入り">
                <svg viewBox="0 0 24 24" fill="${isFavorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                </svg>
              </button>
              <button class="card-search-action-btn again ${cardStatus === 'again' ? 'active' : ''}" data-key="${escapeHtml(key)}" data-action="again">もう一度</button>
              <button class="card-search-action-btn memorized ${cardStatus === 'memorized' ? 'active' : ''}" data-key="${escapeHtml(key)}" data-action="memorized">覚えた</button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    if (!container) return;
    container.innerHTML = `
      <div class="deck-card-list-view" data-status="favorite">
        ${headerHtml}
        <div class="deck-card-list-content">
          ${cardsHtml}
        </div>
      </div>
    `;

    const tabbar = document.querySelector('.floating-tabbar');
    if (tabbar) tabbar.classList.add('hidden');

    updateAccordionPillVisibility(true);

    bindFavoriteDeckCardListEvents(filteredCards);
  }

  function saveFavoriteDeckScrollPos() {
    if (!container) return;
    state.deckListScrollPos = container.scrollTop;
  }

  function bindFavoriteDeckCardListEvents(filteredCards) {
    const backBtn = document.getElementById('deck-card-list-back');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        saveFavoriteDeckScrollPos();
        const tabbar = document.querySelector('.floating-tabbar');
        if (tabbar) tabbar.classList.remove('hidden');
        renderDeckList();
      });
    }

    const startBtn = document.getElementById('deck-card-list-start');
    if (startBtn) {
      startBtn.addEventListener('click', () => {
        saveFavoriteDeckScrollPos();
        startFavoriteDeck();
      });
    }

    const cardItems = container.querySelectorAll('.card-search-item');
    cardItems.forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.card-search-action-btn') || e.target.closest('.card-search-favorite-btn')) return;
        const idx = parseInt(item.dataset.cardIndex);
        showCardPreview(filteredCards[idx]);
      });
    });

    const actionBtns = container.querySelectorAll('.card-search-action-btn');
    actionBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const key = btn.dataset.key;
        const action = btn.dataset.action;
        const now = Date.now();

        const existing = state.progress[key] || {};
        const currentInterval = existing.interval || 0;

        if (action === 'memorized') {
          const newInterval = currentInterval === 0 ? state.initialInterval : getNextInterval(currentInterval);
          state.progress[key] = {
            status: 'memorized',
            lastReview: now,
            nextReview: now + newInterval * DAY_MS,
            interval: newInterval,
            successCount: (existing.successCount || 0) + 1
          };
        } else {
          const nextReviewDelay = state.againDelay === 'immediate' ? 0 : DAY_MS;
          state.progress[key] = {
            status: 'again',
            lastReview: now,
            nextReview: now + nextReviewDelay,
            interval: state.againDelay === 'immediate' ? 0 : 1,
            successCount: 0
          };
        }
        saveProgress();

        const parent = btn.closest('.card-search-actions');
        if (parent) {
          parent.querySelectorAll('.card-search-action-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        }
      });
    });

    const favBtns = container.querySelectorAll('.card-search-favorite-btn');
    favBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const favTopicId = btn.dataset.topicId;
        const originalIndex = parseInt(btn.dataset.originalIndex);
        const content = {
          question: btn.dataset.question,
          answer: btn.dataset.answer,
          section: btn.dataset.section || ''
        };

        const newFavorite = FavoritesManager && FavoritesManager.toggle('qa', favTopicId, originalIndex, content);

        btn.classList.toggle('active', newFavorite);
        const svg = btn.querySelector('svg');
        if (svg) {
          svg.setAttribute('fill', newFavorite ? 'currentColor' : 'none');
        }
        showToast(newFavorite ? 'お気に入りに追加' : 'お気に入りから削除', 1000);
      });
    });
  }

  // === 科目・大項目カード一覧表示 ===
  async function renderSubjectCardList(subject) {
    console.log('[renderSubjectCardList] 開始:', subject);

    const topics = getDATA().filter(d => d.subject === subject);
    if (topics.length === 0) {
      showToast('対象のトピックがありません', 2000);
      return;
    }

    const allCards = await fetchAllCardsFromTopics(topics);
    if (allCards.length === 0) {
      showToast('カードの読み込みに失敗しました', 2000);
      return;
    }

    state.tempSubjectCards = allCards;
    state.tempSubjectName = subject;

    const headerHtml = `
      <div class="deck-card-list-header">
        <button class="deck-card-list-back" id="deck-card-list-back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="15 18 9 12 15 6"></polyline>
          </svg>
        </button>
        <div class="deck-card-list-title">
          <span class="deck-card-list-topic">${subject}</span>
          <span class="deck-card-list-count">${allCards.length}枚</span>
        </div>
        <div class="deck-card-list-actions">
          <button class="deck-card-list-start" id="deck-card-list-start">演習</button>
        </div>
      </div>
    `;

    const cardsHtml = allCards.map((card, idx) => {
      const key = card.progressKey;
      const cardProgress = state.progress[key];
      const cardStatus = cardProgress ? cardProgress.status : 'new';
      const isFavorite = FavoritesManager && FavoritesManager.isFavoriteByParams('qa', card.topicId, card.originalIndex);

      return `
        <div class="card-search-item" data-key="${escapeHtml(key)}" data-card-index="${idx}">
          <div class="card-search-card deck-card-list-card" data-key="${escapeHtml(key)}">
            <div class="card-search-question">Q: ${escapeHtml(card.question)}</div>
          </div>
          <div class="card-search-footer">
            <div class="card-search-meta">${card.topicTitle || ''}</div>
            <div class="card-search-actions">
              <button class="card-search-favorite-btn ${isFavorite ? 'active' : ''}" data-key="${escapeHtml(key)}" data-topic-id="${escapeHtml(card.topicId)}" data-original-index="${card.originalIndex}" data-question="${escapeHtml(card.question)}" data-answer="${escapeHtml(card.answer)}" data-section="${card.section ? escapeHtml(card.section) : ''}" title="お気に入り">
                <svg viewBox="0 0 24 24" fill="${isFavorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                </svg>
              </button>
              <button class="card-search-action-btn again ${cardStatus === 'again' ? 'active' : ''}" data-key="${escapeHtml(key)}" data-action="again">もう一度</button>
              <button class="card-search-action-btn memorized ${cardStatus === 'memorized' ? 'active' : ''}" data-key="${escapeHtml(key)}" data-action="memorized">覚えた</button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    if (!container) return;
    container.innerHTML = `
      <div class="deck-card-list-view" data-subject="${subject}">
        ${headerHtml}
        <div class="deck-card-list-content">
          ${cardsHtml}
        </div>
      </div>
    `;

    const tabbar = document.querySelector('.floating-tabbar');
    if (tabbar) tabbar.classList.add('hidden');

    updateAccordionPillVisibility(true);

    bindSubjectCardListEvents(subject, allCards);
  }

  function bindSubjectCardListEvents(subject, allCards) {
    const backBtn = document.getElementById('deck-card-list-back');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        renderDeckList();
        setTimeout(() => {
          container.scrollTop = state.deckListScrollPos || 0;
        }, 50);
      });
    }

    const startBtn = document.getElementById('deck-card-list-start');
    if (startBtn) {
      startBtn.addEventListener('click', () => {
        startSubjectDeckFromCards(allCards, subject);
      });
    }

    const cardItems = container.querySelectorAll('.card-search-item');
    cardItems.forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.card-search-action-btn') || e.target.closest('.card-search-favorite-btn')) return;
        const idx = parseInt(item.dataset.cardIndex);
        showCardPreview(allCards[idx]);
      });
    });

    const actionBtns = container.querySelectorAll('.card-search-action-btn');
    actionBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const key = btn.dataset.key;
        const action = btn.dataset.action;
        const now = Date.now();

        const existing = state.progress[key] || {};
        const currentInterval = existing.interval || 0;

        if (action === 'memorized') {
          const newInterval = currentInterval === 0 ? state.initialInterval : getNextInterval(currentInterval);
          state.progress[key] = {
            status: 'memorized',
            lastReview: now,
            nextReview: now + newInterval * DAY_MS,
            interval: newInterval,
            successCount: (existing.successCount || 0) + 1
          };
        } else {
          const nextReviewDelay = state.againDelay === 'immediate' ? 0 : DAY_MS;
          state.progress[key] = {
            status: 'again',
            lastReview: now,
            nextReview: now + nextReviewDelay,
            interval: state.againDelay === 'immediate' ? 0 : 1,
            successCount: 0
          };
        }
        saveProgress();

        const parent = btn.closest('.card-search-actions');
        if (parent) {
          parent.querySelectorAll('.card-search-action-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        }
      });
    });

    const favBtns = container.querySelectorAll('.card-search-favorite-btn');
    favBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const favTopicId = btn.dataset.topicId;
        const originalIndex = parseInt(btn.dataset.originalIndex);
        const content = {
          question: btn.dataset.question,
          answer: btn.dataset.answer,
          section: btn.dataset.section || ''
        };

        const newFavorite = FavoritesManager && FavoritesManager.toggle('qa', favTopicId, originalIndex, content);

        btn.classList.toggle('active', newFavorite);
        const svg = btn.querySelector('svg');
        if (svg) {
          svg.setAttribute('fill', newFavorite ? 'currentColor' : 'none');
        }
        showToast(newFavorite ? 'お気に入りに追加' : 'お気に入りから削除', 1000);
      });
    });
  }

  async function renderGroupCardList(topicIds, groupName) {
    console.log('[renderGroupCardList] 開始:', groupName, topicIds);

    const topics = topicIds.map(id => getDATA().find(d => d.id === id)).filter(Boolean);
    if (topics.length === 0) {
      showToast('対象のトピックがありません', 2000);
      return;
    }

    const allCards = await fetchAllCardsFromTopics(topics);
    if (allCards.length === 0) {
      showToast('カードの読み込みに失敗しました', 2000);
      return;
    }

    state.tempGroupCards = allCards;
    state.tempGroupName = groupName;

    const headerHtml = `
      <div class="deck-card-list-header">
        <button class="deck-card-list-back" id="deck-card-list-back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="15 18 9 12 15 6"></polyline>
          </svg>
        </button>
        <div class="deck-card-list-title">
          <span class="deck-card-list-topic">${groupName}</span>
          <span class="deck-card-list-count">${allCards.length}枚</span>
        </div>
        <div class="deck-card-list-actions">
          <button class="deck-card-list-start" id="deck-card-list-start">演習</button>
        </div>
      </div>
    `;

    const cardsHtml = allCards.map((card, idx) => {
      const key = card.progressKey;
      const cardProgress = state.progress[key];
      const cardStatus = cardProgress ? cardProgress.status : 'new';
      const isFavorite = FavoritesManager && FavoritesManager.isFavoriteByParams('qa', card.topicId, card.originalIndex);

      return `
        <div class="card-search-item" data-key="${escapeHtml(key)}" data-card-index="${idx}">
          <div class="card-search-card deck-card-list-card" data-key="${escapeHtml(key)}">
            <div class="card-search-question">Q: ${escapeHtml(card.question)}</div>
          </div>
          <div class="card-search-footer">
            <div class="card-search-meta">${card.topicTitle || ''}</div>
            <div class="card-search-actions">
              <button class="card-search-favorite-btn ${isFavorite ? 'active' : ''}" data-key="${escapeHtml(key)}" data-topic-id="${escapeHtml(card.topicId)}" data-original-index="${card.originalIndex}" data-question="${escapeHtml(card.question)}" data-answer="${escapeHtml(card.answer)}" data-section="${card.section ? escapeHtml(card.section) : ''}" title="お気に入り">
                <svg viewBox="0 0 24 24" fill="${isFavorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                </svg>
              </button>
              <button class="card-search-action-btn again ${cardStatus === 'again' ? 'active' : ''}" data-key="${escapeHtml(key)}" data-action="again">もう一度</button>
              <button class="card-search-action-btn memorized ${cardStatus === 'memorized' ? 'active' : ''}" data-key="${escapeHtml(key)}" data-action="memorized">覚えた</button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    if (!container) return;
    container.innerHTML = `
      <div class="deck-card-list-view" data-group="${groupName}">
        ${headerHtml}
        <div class="deck-card-list-content">
          ${cardsHtml}
        </div>
      </div>
    `;

    const tabbar = document.querySelector('.floating-tabbar');
    if (tabbar) tabbar.classList.add('hidden');

    updateAccordionPillVisibility(true);

    bindGroupCardListEvents(groupName, allCards);
  }

  function bindGroupCardListEvents(groupName, allCards) {
    const backBtn = document.getElementById('deck-card-list-back');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        renderDeckList();
        setTimeout(() => {
          container.scrollTop = state.deckListScrollPos || 0;
        }, 50);
      });
    }

    const startBtn = document.getElementById('deck-card-list-start');
    if (startBtn) {
      startBtn.addEventListener('click', () => {
        startGroupDeckFromCards(allCards, groupName);
      });
    }

    const cardItems = container.querySelectorAll('.card-search-item');
    cardItems.forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.card-search-action-btn') || e.target.closest('.card-search-favorite-btn')) return;
        const idx = parseInt(item.dataset.cardIndex);
        showCardPreview(allCards[idx]);
      });
    });

    const actionBtns = container.querySelectorAll('.card-search-action-btn');
    actionBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const key = btn.dataset.key;
        const action = btn.dataset.action;
        const now = Date.now();

        const existing = state.progress[key] || {};
        const currentInterval = existing.interval || 0;

        if (action === 'memorized') {
          const newInterval = currentInterval === 0 ? state.initialInterval : getNextInterval(currentInterval);
          state.progress[key] = {
            status: 'memorized',
            lastReview: now,
            nextReview: now + newInterval * DAY_MS,
            interval: newInterval,
            successCount: (existing.successCount || 0) + 1
          };
        } else {
          const nextReviewDelay = state.againDelay === 'immediate' ? 0 : DAY_MS;
          state.progress[key] = {
            status: 'again',
            lastReview: now,
            nextReview: now + nextReviewDelay,
            interval: state.againDelay === 'immediate' ? 0 : 1,
            successCount: 0
          };
        }
        saveProgress();

        const parent = btn.closest('.card-search-actions');
        if (parent) {
          parent.querySelectorAll('.card-search-action-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        }
      });
    });

    const favBtns = container.querySelectorAll('.card-search-favorite-btn');
    favBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const favTopicId = btn.dataset.topicId;
        const originalIndex = parseInt(btn.dataset.originalIndex);
        const content = {
          question: btn.dataset.question,
          answer: btn.dataset.answer,
          section: btn.dataset.section || ''
        };

        const newFavorite = FavoritesManager && FavoritesManager.toggle('qa', favTopicId, originalIndex, content);

        btn.classList.toggle('active', newFavorite);
        const svg = btn.querySelector('svg');
        if (svg) {
          svg.setAttribute('fill', newFavorite ? 'currentColor' : 'none');
        }
        showToast(newFavorite ? 'お気に入りに追加' : 'お気に入りから削除', 1000);
      });
    });
  }

  // === カード一覧（デッキ内） ===
  async function renderDeckCardList(topicId) {
    let topic;
    let qaPath;

    if (topicId === 'kokoshika_hisshu') {
      topic = { id: 'kokoshika_hisshu', title: '必修ココシカ', subject: '必修' };
      qaPath = 'deck/必修ココシカ.txt';
    } else {
      topic = getDATA().find(d => d.id === topicId);
      if (!topic) {
        topic = getDATA().find(d => d.id.includes(topicId) || d.id.endsWith('_' + topicId.toLowerCase()));
      }
      if (!topic) {
        topic = getDATA().find(d => d.title === topicId || topicId.includes(d.title));
      }
      if (!topic || (!topic.qaPath && !topic.localJsonData)) {
        if (container) {
          container.innerHTML = `<div class="flashcard-error">トピックが見つかりません</div>`;
        }
        return;
      }
      qaPath = topic.qaPath;
    }

    let cards = [];
    let isBuiltInDeck = false;
    try {
      if (topic.localJsonData) {
        cards = parseJSONToCards(topic.localJsonData, topicId);
      } else {
        const response = await fetch(encodeURI(qaPath));
        if (qaPath.endsWith('.json')) {
          const jsonData = await response.json();
          cards = parseJSONToCards(jsonData, topicId);
        } else {
          const text = await response.text();
          cards = parseQAToCards(text, topicId);
        }
        isBuiltInDeck = true;
        cards = applyCustomizations(cards, topicId);
      }
    } catch (e) {
      console.log('Q&A読み込みエラー:', e);
      if (container) {
        container.innerHTML = `<div class="flashcard-error">Q&Aの読み込みに失敗しました</div>`;
      }
      return;
    }

    const hasCustomization = hasTopicCustomization(topicId);

    const allExpanded = cards.length > 0 &&
      cards.every((_, idx) => state.deckCardListExpandedKeys && state.deckCardListExpandedKeys.has(`${topicId}:${idx}`));

    const headerHtml = `
      <div class="deck-card-list-header">
        <button class="deck-card-list-back" id="deck-card-list-back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="15 18 9 12 15 6"></polyline>
          </svg>
        </button>
        <div class="deck-card-list-title">
          <span class="deck-card-list-topic">${escapeHtml(topic.title)}</span>
          <span class="deck-card-list-count">${cards.length}枚${hasCustomization ? ' (編集済)' : ''}</span>
        </div>
        <div class="deck-card-list-actions">
          <button class="deck-card-list-toggle-all" id="deck-card-list-toggle-all" data-card-count="${cards.length}">${allExpanded ? 'すべて閉じる' : 'すべて開く'}</button>
          ${hasCustomization ? `
            <button class="deck-card-list-reset" id="deck-card-list-reset" title="編集をリセット">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path>
                <path d="M21 3v5h-5"></path>
                <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path>
                <path d="M3 21v-5h5"></path>
              </svg>
            </button>
          ` : ''}
          <button class="deck-card-list-start" id="deck-card-list-start">演習</button>
        </div>
      </div>
    `;

    const isImportedDeck = topic.source === 'local_imported';
    const isEditable = isImportedDeck || isBuiltInDeck;

    let cardsHtml = cards.map((card, idx) => {
      const key = `${topicId}:${idx}`;
      const cardProgress = state.progress[key];
      const cardStatus = cardProgress ? cardProgress.status : 'new';
      const isExpanded = state.deckCardListExpandedKeys && state.deckCardListExpandedKeys.has(key);

      const originalIndex = card.originalIndex !== undefined ? card.originalIndex : idx;
      const isFavorite = FavoritesManager && FavoritesManager.isFavoriteByParams('qa', topicId, originalIndex);

      const cardHtmlPath = card.htmlPath || (topic && topic.htmlPath);

      const moreMenuBtn = isEditable ? `
        <button class="card-more-menu-btn" data-card-index="${idx}" data-original-index="${originalIndex}" title="メニュー">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="5" r="2"/>
            <circle cx="12" cy="12" r="2"/>
            <circle cx="12" cy="19" r="2"/>
          </svg>
        </button>
      ` : '';

      const isSummaryExpanded = state.deckCardListSummaryKeys && state.deckCardListSummaryKeys.has(key);
      const summaryContent = state.deckCardListSummaryContent && state.deckCardListSummaryContent[key] || '';

      return `
        <div class="card-search-item ${isExpanded ? 'expanded' : ''}" data-key="${escapeHtml(key)}" data-card-index="${idx}">
          <div class="card-search-card deck-card-list-card" data-key="${escapeHtml(key)}">
            <div class="card-search-question">Q: ${escapeHtml(card.question)}</div>
            ${isExpanded ? `
              <div class="card-search-answer">A: ${escapeHtml(card.answer)}${cardHtmlPath ? `<span class=\"inline-summary-toggle\" data-html-path=\"${escapeHtml(cardHtmlPath)}\" data-section=\"${card.section ? escapeHtml(card.section) : ''}\"> ${isSummaryExpanded ? '∨' : '>'}</span>` : ''}</div>
              ${cardHtmlPath ? `<div class=\"inline-summary-content ${isSummaryExpanded ? '' : 'collapsed'}\">${summaryContent}</div>` : ''}
            ` : ''}
          </div>
          <div class="card-search-footer">
            <div class="card-search-meta">${card.section ? escapeHtml(card.section) : ''}</div>
            <div class="card-search-actions">
              ${moreMenuBtn}
              <button class="card-search-favorite-btn ${isFavorite ? 'active' : ''}" data-key="${escapeHtml(key)}" data-topic-id="${escapeHtml(topicId)}" data-original-index="${originalIndex}" data-question="${escapeHtml(card.question)}" data-answer="${escapeHtml(card.answer)}" data-section="${card.section ? escapeHtml(card.section) : ''}" title="お気に入り">
                <svg viewBox="0 0 24 24" fill="${isFavorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                </svg>
              </button>
              <button class="card-search-action-btn again ${cardStatus === 'again' ? 'active' : ''}" data-key="${escapeHtml(key)}" data-action="again">もう一度</button>
              <button class="card-search-action-btn memorized ${cardStatus === 'memorized' ? 'active' : ''}" data-key="${escapeHtml(key)}" data-action="memorized">覚えた</button>
              ${deps.isCollaborator && deps.isCollaborator() ? `<button class=\"card-search-action-btn report\" data-key=\"${escapeHtml(key)}\" data-topic-id=\"${escapeHtml(topicId)}\" data-question=\"${escapeHtml(card.question)}\" data-answer=\"${escapeHtml(card.answer)}\" data-section=\"${card.section ? escapeHtml(card.section) : ''}\" data-action=\"report\">報告</button>` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');

    if (!container) return;
    container.innerHTML = `
      <div class="deck-card-list-view">
        ${headerHtml}
        <div class="deck-card-list-content">
          ${cardsHtml}
        </div>
      </div>
    `;

    const tabbar = document.querySelector('.floating-tabbar');
    if (tabbar) tabbar.classList.add('hidden');

    updateAccordionPillVisibility(true);

    if (!state.deckCardListExpandedKeys) {
      state.deckCardListExpandedKeys = new Set();
    }
    if (!state.deckCardListSummaryKeys) {
      state.deckCardListSummaryKeys = new Set();
    }
    if (!state.deckCardListSummaryContent) {
      state.deckCardListSummaryContent = {};
    }

    bindDeckCardListEvents(topicId);

    requestAnimationFrame(() => {
      if (state.deckCardListScrollPos[topicId] !== undefined) {
        container.scrollTop = state.deckCardListScrollPos[topicId];
      } else {
        container.scrollTop = 0;
      }
    });
  }

  function saveDeckCardListScrollPos(topicId) {
    if (!container) return;
    state.deckCardListScrollPos[topicId] = container.scrollTop;
  }

  function bindDeckCardListEvents(topicId) {
    const backBtn = document.getElementById('deck-card-list-back');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        saveDeckCardListScrollPos(topicId);
        state.deckCardListExpandedKeys = new Set();
        state.deckCardListSummaryKeys = new Set();
        state.deckCardListSummaryContent = {};
        const tabbar = document.querySelector('.floating-tabbar');
        if (tabbar) tabbar.classList.remove('hidden');
        renderDeckList();
      });
    }

    const swipeContainer = document.querySelector('.deck-card-list-view');
    if (swipeContainer) {
      let touchStartX = 0;
      let touchStartY = 0;
      let isSwiping = false;

      swipeContainer.addEventListener('touchstart', (e) => {
        const touch = e.touches[0];
        if (touch.clientX <= 40) {
          touchStartX = touch.clientX;
          touchStartY = touch.clientY;
          isSwiping = true;
        }
      }, { passive: true });

      swipeContainer.addEventListener('touchend', (e) => {
        if (!isSwiping) return;
        isSwiping = false;
        const touch = e.changedTouches[0];
        const deltaX = touch.clientX - touchStartX;
        const deltaY = Math.abs(touch.clientY - touchStartY);
        if (deltaX > 80 && deltaY < 100) {
          const tabbar = document.querySelector('.floating-tabbar');
          if (tabbar) tabbar.classList.remove('hidden');
          renderDeckList();
        }
      }, { passive: true });
    }

    const startBtn = document.getElementById('deck-card-list-start');
    if (startBtn) {
      startBtn.addEventListener('click', async () => {
        saveDeckCardListScrollPos(topicId);
        state.deckCardListExpandedKeys = new Set();
        state.deckCardListSummaryKeys = new Set();
        state.deckCardListSummaryContent = {};
        state.lastSelectedTopicId = topicId;
        localStorage.setItem('flashcard-last-topic', topicId);
        state.isReviewMode = false;
        await loadTopic(topicId, state.shuffleEnabled);
      });
    }

    const toggleAllBtn = document.getElementById('deck-card-list-toggle-all');
    if (toggleAllBtn) {
      toggleAllBtn.addEventListener('click', () => {
        const cardCount = parseInt(toggleAllBtn.dataset.cardCount, 10) || 0;
        let currentAllExpanded = cardCount > 0;
        for (let i = 0; i < cardCount; i++) {
          if (!state.deckCardListExpandedKeys || !state.deckCardListExpandedKeys.has(`${topicId}:${i}`)) {
            currentAllExpanded = false;
            break;
          }
        }
        if (currentAllExpanded) {
          state.deckCardListExpandedKeys.clear();
        } else {
          if (!state.deckCardListExpandedKeys) {
            state.deckCardListExpandedKeys = new Set();
          }
          for (let i = 0; i < cardCount; i++) {
            state.deckCardListExpandedKeys.add(`${topicId}:${i}`);
          }
        }
        saveDeckCardListScrollPos(topicId);
        renderDeckCardList(topicId);
      });
    }

    const resetBtn = document.getElementById('deck-card-list-reset');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        showConfirmDialog(
          '編集をリセット',
          'このデッキの編集内容をすべてリセットしますか？',
          () => {
            const ok = resetTopicCustomization(topicId);
            if (ok) {
              saveDeckCardListScrollPos(topicId);
              renderDeckCardList(topicId);
            }
          },
          true
        );
      });
    }

    const cardItems = container.querySelectorAll('.card-search-item');
    cardItems.forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.card-search-action-btn') || e.target.closest('.card-search-favorite-btn') || e.target.closest('.card-more-menu-btn') || e.target.closest('.inline-summary-toggle')) return;
        const key = item.dataset.key;
        if (state.deckCardListExpandedKeys.has(key)) {
          state.deckCardListExpandedKeys.delete(key);
        } else {
          state.deckCardListExpandedKeys.add(key);
        }
        renderDeckCardList(topicId);
      });
    });

    const inlineSummaryToggles = container.querySelectorAll('.inline-summary-toggle');
    inlineSummaryToggles.forEach(toggle => {
      toggle.addEventListener('click', async (e) => {
        e.stopPropagation();
        const cardItem = toggle.closest('.card-search-item');
        const key = cardItem?.dataset.key;
        if (!key) return;

        if (state.deckCardListSummaryKeys.has(key)) {
          state.deckCardListSummaryKeys.delete(key);
        } else {
          state.deckCardListSummaryKeys.add(key);
          const htmlPath = toggle.dataset.htmlPath;
          const section = toggle.dataset.section;
          const contentEl = cardItem.querySelector('.inline-summary-content');
          if (contentEl && htmlPath) {
            await loadDeckCardSummary(contentEl, htmlPath, section);
            state.deckCardListSummaryContent[key] = contentEl.innerHTML;
          }
        }
        saveDeckCardListScrollPos(topicId);
        renderDeckCardList(topicId);
      });
    });

    const actionBtns = container.querySelectorAll('.card-search-action-btn');
    actionBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        const key = btn.dataset.key;

        if (action === 'report') {
          deps.reportCardFromList && deps.reportCardFromList(btn);
          return;
        }

        const existing = state.progress[key] || {};
        const currentInterval = existing.interval || 0;
        const now = Date.now();

        if (action === 'memorized') {
          const newInterval = currentInterval === 0 ? state.initialInterval : getNextInterval(currentInterval);
          state.progress[key] = {
            status: 'memorized',
            lastReview: now,
            nextReview: now + newInterval * DAY_MS,
            interval: newInterval,
            successCount: (existing.successCount || 0) + 1
          };
        } else if (action === 'again') {
          const nextReviewDelay = state.againDelay === 'immediate' ? 0 : DAY_MS;
          state.progress[key] = {
            status: 'again',
            lastReview: now,
            nextReview: now + nextReviewDelay,
            interval: state.againDelay === 'immediate' ? 0 : 1,
            successCount: 0
          };
        }

        saveProgress();
        saveDeckCardListScrollPos(topicId);
        renderDeckCardList(topicId);
      });
    });

    const favBtns = container.querySelectorAll('.card-search-favorite-btn');
    favBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const favTopicId = btn.dataset.topicId;
        const originalIndex = parseInt(btn.dataset.originalIndex);
        const content = {
          question: btn.dataset.question,
          answer: btn.dataset.answer,
          section: btn.dataset.section || ''
        };
        const newFavorite = FavoritesManager && FavoritesManager.toggle('qa', favTopicId, originalIndex, content);
        btn.classList.toggle('active', newFavorite);
        const svg = btn.querySelector('svg');
        if (svg) {
          svg.setAttribute('fill', newFavorite ? 'currentColor' : 'none');
        }
        showToast(newFavorite ? 'お気に入りに追加' : 'お気に入りから削除', 1000);
      });
    });

    const moreMenuBtns = document.querySelectorAll('.deck-card-list-view .card-more-menu-btn');
    moreMenuBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const cardIndex = parseInt(btn.dataset.cardIndex);
        const originalIndex = parseInt(btn.dataset.originalIndex);
        const cardItem = btn.closest('.card-search-item');

        showCardActionSheet(topicId, cardIndex, originalIndex, cardItem);
      });
    });
  }

  function startDeckFromCardList(topicId) {
    // For now, just re-use loadTopic/start behavior
    state.isReviewMode = false;
    loadTopic(topicId, state.shuffleEnabled);
  }

  // === カード操作アクションシート ===
  function showCardActionSheet(topicId, cardIndex, originalIndex, cardItem) {
    const existing = document.querySelector('.card-action-sheet-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'card-action-sheet-overlay';
    overlay.innerHTML = `
      <div class="card-action-sheet">
        <button class="card-action-sheet-item edit">編集</button>
        <button class="card-action-sheet-item delete">削除</button>
        <button class="card-action-sheet-item cancel">キャンセル</button>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.classList.contains('cancel')) {
        overlay.remove();
      }
    });

    overlay.querySelector('.edit').addEventListener('click', async () => {
      overlay.remove();
      const topic = getDATA().find(d => d.id === topicId);

      if (topic && topic.localJsonData) {
        let card = null;
        let count = 0;
        for (const section of topic.localJsonData.sections || []) {
          for (const qa of section.qa || []) {
            if (count === cardIndex) {
              card = {
                question: qa.question,
                answer: qa.answer,
                isChoiceCard: qa.choices && Object.keys(qa.choices).length > 0,
                choices: qa.choices
              };
              break;
            }
            count++;
          }
          if (card) break;
        }
        if (card) openCardEditModal(topicId, cardIndex, card);
        return;
      }

      if (cardItem) {
        const questionEl = cardItem.querySelector('.card-search-question');
        const answerEl = cardItem.querySelector('.card-search-answer');
        const card = {
          question: questionEl ? questionEl.textContent.replace(/^Q:\s*/, '') : '',
          answer: answerEl ? answerEl.textContent.replace(/^A:\s*/, '').replace(/ [>∨]$/, '') : '',
          isChoiceCard: false,
          choices: null
        };
        openBuiltInCardEditModal(topicId, originalIndex, card);
      }
    });

    overlay.querySelector('.delete').addEventListener('click', () => {
      overlay.remove();
      const topic = getDATA().find(d => d.id === topicId);

      if (topic && topic.localJsonData) {
        deleteCard(topicId, cardIndex);
      } else {
        deleteBuiltInCard(topicId, originalIndex);
      }
    });
  }

  // === JSON/Q&Aパース ===
  function parseQAToCards(text, topicId) {
    const cards = [];
    const lines = text.split('\n');
    let currentSection = '';
    let currentQ = null;
    let currentSource = null;
    let currentSourceSection = null;
    let currentChoices = {};
    let index = 0;

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
        currentChoices = {};
      } else if (/^[a-e]:\s/.test(trimmed)) {
        const choiceKey = trimmed.charAt(0);
        const choiceValue = trimmed.slice(2).trim();
        currentChoices[choiceKey] = choiceValue;
      } else if ((trimmed.startsWith('A: ') || trimmed.startsWith('A:')) && currentQ) {
        const answer = trimmed.replace(/^A:\s*/, '');

        const codeMatch = currentQ.match(/^\[(\d+[A-Z]\d+)\]/);
        const groupId = codeMatch ? codeMatch[1] : null;

        const card = {
          index: index,
          originalIndex: index,
          section: currentSourceSection || currentSection,
          question: currentQ,
          answer: answer,
          topicId: topicId,
          groupId: groupId
        };

        if (Object.keys(currentChoices).length > 0) {
          let correctKey = '';
          for (const [key, value] of Object.entries(currentChoices)) {
            if (value === answer || answer.includes(value) || value.includes(answer)) {
              correctKey = key.toUpperCase();
              break;
            }
          }
          card.choices = { ...currentChoices };
          card.isChoiceCard = true;
          card.correctAnswer = correctKey;
          card.numChoices = 1;
        }

        if (currentSource && subjectName) {
          card.htmlPath = `html/subject/${subjectName}/${currentSource}.html`;
        }
        cards.push(card);
        index++;
        currentQ = null;
        currentSource = null;
        currentSourceSection = null;
        currentChoices = {};
      }
    }

    return cards;
  }

  function parseJSONToCards(jsonData, topicId) {
    const cards = [];
    let index = 0;

    for (const section of jsonData.sections || []) {
      for (const qa of section.qa || []) {
        if (qa.type === 'table-occlusion') {
          for (let occIdx = 0; occIdx < qa.occlusions.length; occIdx++) {
            cards.push({
              index: index,
              originalIndex: index,
              section: section.section,
              type: 'table-occlusion',
              title: qa.title,
              table: qa.table,
              occlusions: qa.occlusions,
              currentOcclusionIndex: occIdx,
              topicId: topicId
            });
            index++;
          }
          continue;
        }

        const hasChoices = qa.choices && Object.keys(qa.choices).length > 0;

        let correctAnswerKey = '';
        if (hasChoices) {
          if (qa.correctAnswer) {
            correctAnswerKey = qa.correctAnswer;
          } else {
            const correctKeys = Object.entries(qa.choices)
              .filter(([key, value]) => value && value.includes('○'))
              .map(([key]) => key);
            correctAnswerKey = correctKeys.join('').toUpperCase();
          }
        }

        let numChoices = qa.numChoices || 1;
        if (!qa.numChoices && qa.question) {
          const match = qa.question.match(/[（(](\d+)つ[）)]/);
          if (match) {
            numChoices = parseInt(match[1], 10);
          }
        }

        cards.push({
          index: index,
          originalIndex: index,
          section: section.section,
          question: qa.question,
          answer: qa.answer,
          topicId: topicId,
          isChoiceCard: hasChoices,
          choices: hasChoices ? qa.choices : null,
          correctAnswer: correctAnswerKey || qa.answer || '',
          numChoices: numChoices
        });
        index++;
      }
    }

    return cards;
  }

  // === カード検索機能 ===
  async function loadAllCardsIndex(progressCallback) {
    if (state.cardSearch.allCardsIndex) {
      return state.cardSearch.allCardsIndex;
    }

    state.cardSearch.isIndexing = true;

    try {
      if (progressCallback) {
        progressCallback(0, 1);
      }

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

  function searchCards(query) {
    if (!state.cardSearch.allCardsIndex || !query.trim()) {
      return [];
    }

    const normalizedQuery = query.toLowerCase().trim();
    const terms = normalizedQuery.split(/\s+/).filter(t => t.length > 0);

    const results = state.cardSearch.allCardsIndex.filter(item => {
      const searchTarget = item.type === 'summary'
        ? (item.searchText || '').toLowerCase()
        : `${item.question} ${item.answer}`.toLowerCase();
      return terms.every(term => searchTarget.includes(term));
    });

    return results.slice(0, 100);
  }

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

  async function renderCardSearchScreen(initialQuery = '', showAllResults = false) {
    state.cardSearch.expandedKeys = new Set();
    state.cardSearch.showAll = showAllResults;
    if (!initialQuery) {
      state.cardSearch.query = '';
      state.cardSearch.results = [];
    }

    const tabbar = document.querySelector('.floating-tabbar');
    if (tabbar) tabbar.classList.add('hidden');

    if (!container) return;
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

    bindCardSearchEvents();

    if (!state.cardSearch.allCardsIndex) {
      const statusEl = document.getElementById('card-search-status');
      if (statusEl) {
        statusEl.innerHTML = '<div class="card-search-loading">カードを読み込み中...</div>';
      }
      await loadAllCardsIndex((loaded, total) => {
        if (statusEl) {
          const percent = Math.round((loaded / total) * 100);
          statusEl.innerHTML = `<div class=\"card-search-loading\">カードを読み込み中... ${percent}%</div>`;
        }
      });
      if (statusEl) {
        statusEl.innerHTML = '';
      }
    }

    const input = document.getElementById('card-search-input');
    const clearBtn = document.getElementById('card-search-clear');

    if (initialQuery && input) {
      input.value = initialQuery;
      if (clearBtn) clearBtn.style.display = 'flex';
      renderCardSearchResults();
    } else if (input) {
      input.focus();
    }
  }

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
          state.cardSearch.showAll = false;
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

    const cardResults = results.filter(r => r.type !== 'summary');
    const summaryResults = results.filter(r => r.type === 'summary');

    if (statusEl) {
      let statusHtml = '<div class="card-search-status-row">';
      statusHtml += `<div class=\"card-search-count\">${results.length}件見つかりました`;
      if (cardResults.length > 0 && summaryResults.length > 0) {
        statusHtml += `（カード${cardResults.length}件 + まとめ${summaryResults.length}件）`;
      }
      statusHtml += `${results.length >= 100 ? '（上限100件）' : ''}</div>`;

      if (cardResults.length > 0) {
        statusHtml += `<button class=\"card-search-start-deck-btn\" id=\"card-search-start-deck\">${cardResults.length}件で演習</button>`;
      }
      statusHtml += '</div>';
      statusEl.innerHTML = statusHtml;

      const startDeckBtn = document.getElementById('card-search-start-deck');
      if (startDeckBtn) {
        startDeckBtn.addEventListener('click', () => {
          startSearchResultsDeck();
        });
      }
    }

    const DISPLAY_LIMIT = 5;
    const displayResults = state.cardSearch.showAll ? results : results.slice(0, DISPLAY_LIMIT);
    const hasMore = results.length > DISPLAY_LIMIT && !state.cardSearch.showAll;
    const remainingCount = results.length - DISPLAY_LIMIT;

    let html = displayResults.map(item => {
      const isExpanded = state.cardSearch.expandedKeys.has(item.searchKey);

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

      const cardProgress = state.progress[item.searchKey];
      const cardStatus = cardProgress ? cardProgress.status : 'new';
      const isFavorite = cardProgress && cardProgress.favorite;
      return `
        <div class="card-search-item ${isExpanded ? 'expanded' : ''}" data-key="${escapeHtml(item.searchKey)}">
          <div class="card-search-card" data-key="${escapeHtml(item.searchKey)}">
            <div class="card-search-question">Q: ${highlightText(item.question, query)}</div>
            ${isExpanded ? `<div class=\"card-search-answer\">A: ${highlightText(item.answer, query)}</div>` : ''}
          </div>
          <div class="card-search-footer">
            <div class="card-search-meta">${escapeHtml(item.subject)} › ${escapeHtml(item.topicTitle)}</div>
            <div class="card-search-actions">
              <button class="card-search-favorite-btn ${isFavorite ? 'active' : ''}" data-key="${escapeHtml(item.searchKey)}" title="お気に入り">
                <svg viewBox="0 0 24 24" fill="${isFavorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                </svg>
              </button>
              <button class="card-search-action-btn again ${cardStatus === 'again' ? 'active' : ''}" data-key="${escapeHtml(item.searchKey)}" data-action="again">もう一度</button>
              <button class="card-search-action-btn memorized ${cardStatus === 'memorized' ? 'active' : ''}" data-key="${escapeHtml(item.searchKey)}" data-action="memorized">覚えた</button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    if (hasMore) {
      html += `<button class=\"card-search-more-btn\" id=\"card-search-show-all\">他${remainingCount}件を表示...</button>`;
    }

    resultsEl.innerHTML = html;

    bindInlineSearchEvents(resultsEl);

    const showAllBtn = document.getElementById('card-search-show-all');
    if (showAllBtn) {
      showAllBtn.addEventListener('click', () => {
        renderCardSearchScreen(state.cardSearch.query, true);
      });
    }
  }

  function renderInlineSearchResults() {
    const resultsEl = document.getElementById('card-search-inline-results');
    if (!resultsEl) return;

    const query = state.cardSearch.query;
    const results = state.cardSearch.results;

    if (!query.trim() || results.length === 0) {
      resultsEl.style.display = 'none';
      return;
    }

    resultsEl.style.display = 'block';

    const cardResults = results.filter(r => r.type !== 'summary');

    let html = '<div class="card-search-inline-header">';
    html += `<div class=\"card-search-inline-count\">${results.length}件</div>`;
    if (cardResults.length > 0) {
      html += `<button class=\"card-search-start-deck-btn\" id=\"inline-start-deck\">${cardResults.length}件で演習</button>`;
    }
    html += '</div>';

    html += '<div class="card-search-inline-list">';
    const INLINE_LIMIT = 5;
    html += results.slice(0, INLINE_LIMIT).map(item => {
      const isExpanded = state.cardSearch.expandedKeys.has(item.searchKey);

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

      const cardProgress = state.progress[item.searchKey];
      const cardStatus = cardProgress ? cardProgress.status : 'new';
      const isFavorite = cardProgress && cardProgress.favorite;
      return `
        <div class="card-search-item ${isExpanded ? 'expanded' : ''}" data-key="${escapeHtml(item.searchKey)}">
          <div class="card-search-card" data-key="${escapeHtml(item.searchKey)}">
            <div class="card-search-question">Q: ${highlightText(item.question, query)}</div>
            ${isExpanded ? `<div class=\"card-search-answer\">A: ${highlightText(item.answer, query)}</div>` : ''}
          </div>
          <div class="card-search-footer">
            <div class="card-search-meta">${escapeHtml(item.subject)} › ${escapeHtml(item.topicTitle)}</div>
            <div class="card-search-actions">
              <button class="card-search-favorite-btn ${isFavorite ? 'active' : ''}" data-key="${escapeHtml(item.searchKey)}" title="お気に入り">
                <svg viewBox="0 0 24 24" fill="${isFavorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                </svg>
              </button>
              <button class="card-search-action-btn again ${cardStatus === 'again' ? 'active' : ''}" data-key="${escapeHtml(item.searchKey)}" data-action="again">もう一度</button>
              <button class="card-search-action-btn memorized ${cardStatus === 'memorized' ? 'active' : ''}" data-key="${escapeHtml(item.searchKey)}" data-action="memorized">覚えた</button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    if (results.length > INLINE_LIMIT) {
      html += `<button class=\"card-search-more-btn\" id=\"card-search-show-all\">他${results.length - INLINE_LIMIT}件を表示...</button>`;
    }
    html += '</div>';

    resultsEl.innerHTML = html;

    bindInlineSearchEvents(resultsEl);

    const showAllBtn = document.getElementById('card-search-show-all');
    if (showAllBtn) {
      showAllBtn.addEventListener('click', () => {
        renderCardSearchScreen(state.cardSearch.query, true);
      });
    }
  }

  function bindInlineSearchEvents(resultsEl) {
    const startDeckBtn = document.getElementById('inline-start-deck');
    if (startDeckBtn) {
      startDeckBtn.addEventListener('click', () => {
        startSearchResultsDeck();
      });
    }

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

    resultsEl.querySelectorAll('.card-search-action-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const key = btn.dataset.key;
        const action = btn.dataset.action;

        const existing = state.progress[key] || {};
        state.progress[key] = {
          ...existing,
          status: action,
          lastReview: Date.now()
        };
        saveProgress();

        const parent = btn.closest('.card-search-actions');
        if (parent) {
          parent.querySelectorAll('.card-search-action-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        }
      });
    });

    resultsEl.querySelectorAll('.card-search-favorite-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const key = btn.dataset.key;

        const existing = state.progress[key] || {};
        const newFavorite = !existing.favorite;
        state.progress[key] = {
          ...existing,
          favorite: newFavorite
        };
        saveProgress();

        btn.classList.toggle('active', newFavorite);
        const svg = btn.querySelector('svg');
        if (svg) {
          svg.setAttribute('fill', newFavorite ? 'currentColor' : 'none');
        }
      });
    });

    resultsEl.querySelectorAll('.card-search-summary-link').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const topicId = btn.dataset.topicId;

        state.cardSearch.query = '';
        state.cardSearch.results = [];
        state.cardSearch.expandedKeys = new Set();
        state.isActive = false;

        if (typeof window.switchTab === 'function') {
          window.switchTab('html');
        }

        if (typeof window.selectItem === 'function') {
          window.selectItem(topicId);
        }
      });
    });
  }

  // === デッキ編集機能 ===
  const editState = {
    deckId: null,
    cardKey: null,
    cardTopicId: null,
    cardIndex: null,
    selectedDecks: new Set(),
    isBuiltInDeck: false
  };

  function openDeckEditModal(topicId) {
    const topic = getDATA().find(d => d.id === topicId);
    if (!topic || topic.source !== 'local_imported') {
      showToast('このデッキは編集できません');
      return;
    }

    editState.deckId = topicId;

    const overlay = document.getElementById('deck-edit-overlay');
    const nameInput = document.getElementById('deck-edit-name');
    const categoryInput = document.getElementById('deck-edit-category');

    if (overlay && nameInput && categoryInput) {
      nameInput.value = topic.title || '';
      const category = (topic.subjectCategory || topic.category || '').replace(/^インポート\//, '');
      categoryInput.value = category;
      overlay.classList.add('show');
      nameInput.focus();
    }

    bindDeckEditEvents();
  }

  function closeDeckEditModal() {
    const overlay = document.getElementById('deck-edit-overlay');
    if (overlay) overlay.classList.remove('show');
    editState.deckId = null;
  }

  function saveDeckEdit() {
    if (!editState.deckId) return;

    const nameInput = document.getElementById('deck-edit-name');
    const categoryInput = document.getElementById('deck-edit-category');

    const newName = nameInput?.value.trim();
    const newCategory = categoryInput?.value.trim() || 'ローカル';

    if (!newName) {
      showToast('デッキ名を入力してください');
      return;
    }

    const topic = getDATA().find(d => d.id === editState.deckId);
    if (topic) {
      topic.title = newName;
      topic.category = `インポート/${newCategory}`;
      topic.subjectCategory = newCategory;
    }

    const IMPORTED_DECKS_KEY = 'studyViewer_importedDecks';
    try {
      const stored = localStorage.getItem(IMPORTED_DECKS_KEY);
      if (stored) {
        let importedDecks = JSON.parse(stored);
        const deck = importedDecks.find(d => d.id === editState.deckId);
        if (deck) {
          deck.title = newName;
          deck.category = newCategory;
          localStorage.setItem(IMPORTED_DECKS_KEY, JSON.stringify(importedDecks));
        }
      }
    } catch (e) {
      console.error('デッキ編集エラー:', e);
    }

    if (FirebaseSync && FirebaseSync.isLoggedIn()) {
      FirebaseSync.sync().catch(e => console.error('同期エラー:', e));
    }

    closeDeckEditModal();
    renderDeckList();
    showToast('デッキを更新しました');
  }

  function bindDeckEditEvents() {
    const overlay = document.getElementById('deck-edit-overlay');
    const backdrop = overlay?.querySelector('.deck-edit-backdrop');
    const cancelBtn = document.getElementById('deck-edit-cancel');
    const saveBtn = document.getElementById('deck-edit-save');

    backdrop?.addEventListener('click', closeDeckEditModal);
    cancelBtn?.addEventListener('click', closeDeckEditModal);
    saveBtn?.addEventListener('click', saveDeckEdit);
  }

  // === カード編集機能 ===
  function openCardEditModal(topicId, cardIndex, card) {
    const topic = getDATA().find(d => d.id === topicId);
    if (!topic || topic.source !== 'local_imported') {
      showToast('このカードは編集できません');
      return;
    }

    editState.cardTopicId = topicId;
    editState.cardIndex = cardIndex;

    const overlay = document.getElementById('card-edit-overlay');
    const questionInput = document.getElementById('card-edit-question');
    const answerInput = document.getElementById('card-edit-answer');
    const choicesSection = document.getElementById('card-edit-choices-section');
    const choicesContainer = document.getElementById('card-edit-choices');

    if (overlay && questionInput && answerInput) {
      questionInput.value = card.question || '';
      answerInput.value = card.answer || '';

      if (card.isChoiceCard && card.choices) {
        choicesSection.style.display = 'block';
        choicesContainer.innerHTML = Object.entries(card.choices).map(([key, value]) => `
          <div class="card-edit-choice-item">
            <span class="card-edit-choice-key">${key.toUpperCase()}</span>
            <input type="text" class="card-edit-choice-input" data-choice-key="${key}" value="${escapeHtml(value || '')}">
          </div>
        `).join('');
      } else {
        choicesSection.style.display = 'none';
        choicesContainer.innerHTML = '';
      }

      overlay.classList.add('show');
      questionInput.focus();
    }

    bindCardEditEvents();
  }

  function closeCardEditModal() {
    const overlay = document.getElementById('card-edit-overlay');
    if (overlay) overlay.classList.remove('show');
    editState.cardTopicId = null;
    editState.cardIndex = null;
    editState.isBuiltInDeck = false;
  }

  function saveCardEdit() {
    if (editState.cardTopicId === null || editState.cardIndex === null) return;

    const topic = getDATA().find(d => d.id === editState.cardTopicId);
    if (!topic || !topic.localJsonData) {
      showToast('保存できませんでした');
      return;
    }

    const questionInput = document.getElementById('card-edit-question');
    const answerInput = document.getElementById('card-edit-answer');

    const newQuestion = questionInput?.value.trim();
    const newAnswer = answerInput?.value.trim();

    if (!newQuestion) {
      showToast('問いを入力してください');
      return;
    }

    let cardCount = 0;
    for (const section of topic.localJsonData.sections || []) {
      for (const qa of section.qa || []) {
        if (cardCount === editState.cardIndex) {
          qa.question = newQuestion;
          qa.answer = newAnswer;

          const choiceInputs = document.querySelectorAll('.card-edit-choice-input');
          if (choiceInputs.length > 0) {
            choiceInputs.forEach(input => {
              const key = input.dataset.choiceKey;
              if (qa.choices && key) {
                qa.choices[key] = input.value.trim();
              }
            });
          }
          break;
        }
        cardCount++;
      }
    }

    const IMPORTED_DECKS_KEY = 'studyViewer_importedDecks';
    try {
      const stored = localStorage.getItem(IMPORTED_DECKS_KEY);
      if (stored) {
        let importedDecks = JSON.parse(stored);
        const deck = importedDecks.find(d => d.id === editState.cardTopicId);
        if (deck) {
          deck.jsonData = topic.localJsonData;
          localStorage.setItem(IMPORTED_DECKS_KEY, JSON.stringify(importedDecks));
        }
      }
    } catch (e) {
      console.error('カード編集保存エラー:', e);
    }

    if (FirebaseSync && FirebaseSync.isLoggedIn()) {
      FirebaseSync.sync().catch(e => console.error('同期エラー:', e));
    }

    const topicId = editState.cardTopicId;
    closeCardEditModal();
    saveDeckCardListScrollPos(topicId);
    renderDeckCardList(topicId);
    showToast('カードを更新しました');
  }

  function bindCardEditEvents() {
    const overlay = document.getElementById('card-edit-overlay');
    const backdrop = overlay?.querySelector('.card-edit-backdrop');
    const cancelBtn = document.getElementById('card-edit-cancel');
    const saveBtn = document.getElementById('card-edit-save');

    backdrop?.addEventListener('click', closeCardEditModal);
    cancelBtn?.addEventListener('click', closeCardEditModal);
    saveBtn?.addEventListener('click', saveCardEdit);
  }

  // === 組み込みデッキカード編集機能（差分保存） ===
  function openBuiltInCardEditModal(topicId, originalIndex, card) {
    editState.cardTopicId = topicId;
    editState.cardIndex = originalIndex;
    editState.isBuiltInDeck = true;

    const overlay = document.getElementById('card-edit-overlay');
    const questionInput = document.getElementById('card-edit-question');
    const answerInput = document.getElementById('card-edit-answer');
    const choicesSection = document.getElementById('card-edit-choices-section');
    const choicesContainer = document.getElementById('card-edit-choices');

    if (overlay && questionInput && answerInput) {
      questionInput.value = card.question || '';
      answerInput.value = card.answer || '';

      if (choicesSection) choicesSection.style.display = 'none';
      if (choicesContainer) choicesContainer.innerHTML = '';

      overlay.classList.add('show');
      questionInput.focus();
    }

    bindBuiltInCardEditEvents();
  }

  function saveBuiltInCardEdit() {
    if (editState.cardTopicId === null || editState.cardIndex === null) return;

    const questionInput = document.getElementById('card-edit-question');
    const answerInput = document.getElementById('card-edit-answer');

    const newQuestion = questionInput?.value.trim();
    const newAnswer = answerInput?.value.trim();

    if (!newQuestion) {
      showToast('問いを入力してください');
      return;
    }

    const customization = getTopicCustomization(editState.cardTopicId);
    if (!customization.edited) customization.edited = {};
    customization.edited[editState.cardIndex] = {
      q: newQuestion,
      a: newAnswer
    };
    saveTopicCustomization(editState.cardTopicId, customization);

    const savedTopicId = editState.cardTopicId;
    closeCardEditModal();
    saveDeckCardListScrollPos(savedTopicId);
    renderDeckCardList(savedTopicId);
    showToast('カードを更新しました');
  }

  function bindBuiltInCardEditEvents() {
    const overlay = document.getElementById('card-edit-overlay');
    const backdrop = overlay?.querySelector('.card-edit-backdrop');
    const cancelBtn = document.getElementById('card-edit-cancel');
    const saveBtn = document.getElementById('card-edit-save');

    const newSaveBtn = saveBtn.cloneNode(true);
    saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);

    backdrop?.addEventListener('click', closeCardEditModal);
    cancelBtn?.addEventListener('click', closeCardEditModal);
    newSaveBtn?.addEventListener('click', saveBuiltInCardEdit);
  }

  function deleteBuiltInCard(topicId, originalIndex) {
    showConfirmDialog(
      'カードを削除',
      'このカードを削除しますか？「編集をリセット」で元に戻せます。',
      () => {
        const customization = getTopicCustomization(topicId);
        if (!customization.deleted) customization.deleted = [];

        if (!customization.deleted.includes(originalIndex)) {
          customization.deleted.push(originalIndex);
          customization.deleted.sort((a, b) => a - b);
        }

        if (customization.edited && customization.edited[originalIndex]) {
          delete customization.edited[originalIndex];
        }

        saveTopicCustomization(topicId, customization);
        saveDeckCardListScrollPos(topicId);
        renderDeckCardList(topicId);
        showToast('カードを削除しました');
      }
    );
  }

  function deleteCard(topicId, cardIndex) {
    const topic = getDATA().find(d => d.id === topicId);
    if (!topic || topic.source !== 'local_imported') {
      showToast('このカードは削除できません');
      return;
    }

    showConfirmDialog(
      'カードを削除',
      'このカードを削除しますか？この操作は取り消せません。',
      () => {
        let cardCount = 0;
        let deleted = false;
        for (const section of topic.localJsonData.sections || []) {
          for (let i = 0; i < (section.qa || []).length; i++) {
            if (cardCount === cardIndex) {
              section.qa.splice(i, 1);
              deleted = true;
              break;
            }
            cardCount++;
          }
          if (deleted) break;
        }

        topic.localJsonData.sections = topic.localJsonData.sections.filter(s => s.qa && s.qa.length > 0);

        let totalCards = 0;
        for (const section of topic.localJsonData.sections || []) {
          totalCards += (section.qa || []).length;
        }
        topic.cardCount = totalCards;

        const IMPORTED_DECKS_KEY = 'studyViewer_importedDecks';
        try {
          const stored = localStorage.getItem(IMPORTED_DECKS_KEY);
          if (stored) {
            let importedDecks = JSON.parse(stored);
            const deck = importedDecks.find(d => d.id === topicId);
            if (deck) {
              deck.jsonData = topic.localJsonData;
              deck.cardCount = totalCards;
              localStorage.setItem(IMPORTED_DECKS_KEY, JSON.stringify(importedDecks));
            }
          }
        } catch (e) {
          console.error('カード削除保存エラー:', e);
        }

        const keysToUpdate = Object.keys(state.progress)
          .filter(k => k.startsWith(topicId + ':'))
          .sort((a, b) => {
            const idxA = parseInt(a.split(':')[1]);
            const idxB = parseInt(b.split(':')[1]);
            return idxA - idxB;
          });

        const newProgress = {};
        for (const key of keysToUpdate) {
          const idx = parseInt(key.split(':')[1]);
          if (idx < cardIndex) {
            newProgress[key] = state.progress[key];
          } else if (idx > cardIndex) {
            newProgress[`${topicId}:${idx - 1}`] = state.progress[key];
          }
        }

        for (const key of keysToUpdate) {
          delete state.progress[key];
        }

        Object.assign(state.progress, newProgress);
        saveProgress();

        if (FirebaseSync && FirebaseSync.isLoggedIn()) {
          FirebaseSync.sync().catch(e => console.error('同期エラー:', e));
        }

        saveDeckCardListScrollPos(topicId);
        renderDeckCardList(topicId);
        showToast('カードを削除しました');
      },
      true
    );
  }

  // === デッキ管理機能（合体・一括削除） ===
  function openDeckManageModal() {
    const importedDecks = getDATA().filter(d => d.source === 'local_imported');

    if (importedDecks.length === 0) {
      showToast('管理できるデッキがありません');
      return;
    }

    editState.selectedDecks = new Set();

    const overlay = document.getElementById('deck-manage-overlay');
    const listContainer = document.getElementById('deck-manage-list');

    if (overlay && listContainer) {
      listContainer.innerHTML = importedDecks.map(deck => `
        <div class="deck-manage-item" data-deck-id="${deck.id}">
          <div class="deck-manage-checkbox">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </div>
          <div class="deck-manage-info">
            <div class="deck-manage-name">${escapeHtml(deck.title)}</div>
            <div class="deck-manage-meta">${deck.cardCount || 0}枚 · ${deck.subjectCategory || 'ローカル'}</div>
          </div>
        </div>
      `).join('');

      overlay.classList.add('show');
    }

    bindDeckManageEvents();
    updateDeckManageUI();
  }

  function closeDeckManageModal() {
    const overlay = document.getElementById('deck-manage-overlay');
    if (overlay) overlay.classList.remove('show');
    editState.selectedDecks.clear();
  }

  function updateDeckManageUI() {
    const countEl = document.getElementById('deck-manage-count');
    const mergeBtn = document.getElementById('deck-manage-merge');
    const deleteBtn = document.getElementById('deck-manage-delete');

    const count = editState.selectedDecks.size;
    if (countEl) countEl.textContent = `${count}件選択`;
    if (mergeBtn) mergeBtn.disabled = count < 2;
    if (deleteBtn) deleteBtn.disabled = count === 0;

    const items = document.querySelectorAll('.deck-manage-item');
    items.forEach(item => {
      const deckId = item.dataset.deckId;
      item.classList.toggle('selected', editState.selectedDecks.has(deckId));
    });
  }

  function bindDeckManageEvents() {
    const overlay = document.getElementById('deck-manage-overlay');
    const backdrop = overlay?.querySelector('.deck-manage-backdrop');
    const cancelBtn = document.getElementById('deck-manage-cancel');
    const mergeBtn = document.getElementById('deck-manage-merge');
    const deleteBtn = document.getElementById('deck-manage-delete');

    backdrop?.addEventListener('click', closeDeckManageModal);
    cancelBtn?.addEventListener('click', closeDeckManageModal);

    const items = document.querySelectorAll('.deck-manage-item');
    items.forEach(item => {
      item.addEventListener('click', () => {
        const deckId = item.dataset.deckId;
        if (editState.selectedDecks.has(deckId)) {
          editState.selectedDecks.delete(deckId);
        } else {
          editState.selectedDecks.add(deckId);
        }
        updateDeckManageUI();
      });
    });

    mergeBtn?.addEventListener('click', openMergeDialog);

    deleteBtn?.addEventListener('click', () => {
      const count = editState.selectedDecks.size;
      showConfirmDialog(
        'デッキを削除',
        `選択した${count}個のデッキを削除しますか？この操作は取り消せません。`,
        () => {
          for (const deckId of editState.selectedDecks) {
            deleteImportedDeck(deckId, deckId);
          }
          closeDeckManageModal();
          renderDeckList();
          showToast(`${count}個のデッキを削除しました`);
        },
        true
      );
    });
  }

  // === デッキ合体機能 ===
  function openMergeDialog() {
    const dialog = document.getElementById('deck-merge-dialog');
    const countEl = document.getElementById('deck-merge-count');
    const nameInput = document.getElementById('deck-merge-name');

    if (dialog && countEl && nameInput) {
      countEl.textContent = editState.selectedDecks.size;
      nameInput.value = '';
      dialog.classList.add('show');
      nameInput.focus();
    }

    bindMergeDialogEvents();
  }

  function closeMergeDialog() {
    const dialog = document.getElementById('deck-merge-dialog');
    if (dialog) dialog.classList.remove('show');
  }

  function executeMerge() {
    const nameInput = document.getElementById('deck-merge-name');
    const newName = nameInput?.value.trim();

    if (!newName) {
      showToast('新しいデッキ名を入力してください');
      return;
    }

    const decksToMerge = Array.from(editState.selectedDecks)
      .map(id => getDATA().find(d => d.id === id))
      .filter(Boolean);

    if (decksToMerge.length < 2) return;

    let mergedCards = [];
    let mergedCategory = 'ローカル';

    for (const deck of decksToMerge) {
      if (deck.localJsonData) {
        mergedCards.push(...(deck.localJsonData.sections || []));
      }
    }

    const mergedDeck = {
      id: `local_${Date.now()}`,
      title: newName,
      category: mergedCategory,
      isLocal: true,
      jsonData: {
        sections: mergedCards
      },
      cardCount: mergedCards.reduce((sum, s) => sum + (s.qa || []).length, 0)
    };

    const IMPORTED_DECKS_KEY = 'studyViewer_importedDecks';
    try {
      const stored = localStorage.getItem(IMPORTED_DECKS_KEY);
      let importedDecks = stored ? JSON.parse(stored) : [];

      importedDecks = importedDecks.filter(d => !editState.selectedDecks.has(d.id));
      importedDecks.push(mergedDeck);

      localStorage.setItem(IMPORTED_DECKS_KEY, JSON.stringify(importedDecks));
    } catch (e) {
      console.error('デッキ合体保存エラー:', e);
    }

    for (const deckId of editState.selectedDecks) {
      for (let i = getDATA().length - 1; i >= 0; i--) {
        if (DATA[i].id === deckId) {
          getDATA().splice(i, 1);
        }
      }
    }

    addImportedDeckToData(mergedDeck);

    if (FirebaseSync && FirebaseSync.isLoggedIn()) {
      FirebaseSync.sync().catch(e => console.error('同期エラー:', e));
    }

    closeMergeDialog();
    closeDeckManageModal();
    renderDeckList();
    showToast(`${editState.selectedDecks.size}個のデッキを合体しました`);
  }

  function bindMergeDialogEvents() {
    const dialog = document.getElementById('deck-merge-dialog');
    const backdrop = dialog?.querySelector('.deck-merge-backdrop');
    const cancelBtn = document.getElementById('deck-merge-cancel');
    const confirmBtn = document.getElementById('deck-merge-confirm');

    backdrop?.addEventListener('click', closeMergeDialog);
    cancelBtn?.addEventListener('click', closeMergeDialog);
    confirmBtn?.addEventListener('click', executeMerge);
  }

  // === 確認ダイアログ ===
  let confirmCallback = null;

  function showConfirmDialog(title, message, callback, isDanger = false) {
    const dialog = document.getElementById('confirm-dialog');
    const titleEl = document.getElementById('confirm-title');
    const messageEl = document.getElementById('confirm-message');
    const okBtn = document.getElementById('confirm-ok');

    if (dialog && titleEl && messageEl && okBtn) {
      titleEl.textContent = title;
      messageEl.textContent = message;
      okBtn.classList.toggle('danger', isDanger);
      confirmCallback = callback;
      dialog.classList.add('show');
    }

    bindConfirmDialogEvents();
  }

  function closeConfirmDialog() {
    const dialog = document.getElementById('confirm-dialog');
    if (dialog) dialog.classList.remove('show');
    confirmCallback = null;
  }

  function bindConfirmDialogEvents() {
    const dialog = document.getElementById('confirm-dialog');
    const backdrop = dialog?.querySelector('.confirm-backdrop');
    const cancelBtn = document.getElementById('confirm-cancel');
    const okBtn = document.getElementById('confirm-ok');

    backdrop?.addEventListener('click', closeConfirmDialog);
    cancelBtn?.addEventListener('click', closeConfirmDialog);
    okBtn?.addEventListener('click', () => {
      if (confirmCallback) confirmCallback();
      closeConfirmDialog();
    });
  }

  // === アコーディオン全閉じピルボタンの表示状態を更新 ===
  function updateAccordionPillVisibility(forceHide = false) {
    const pill = document.getElementById('close-accordion-pill');
    if (!pill) return;

    if (state.isActive || state.expandedSubjects.size === 0 || forceHide) {
      pill.classList.remove('visible');
      state.pillVisible = false;
      return;
    }

    if (state.pillVisible) {
      pill.classList.add('visible');
    } else {
      pill.classList.remove('visible');
    }
  }

  function handleDeckListScroll() {
    if (!container || state.isActive) return;

    const currentScrollTop = container.scrollTop;
    const scrollDelta = currentScrollTop - state.lastScrollTop;

    if (Math.abs(scrollDelta) < 5) return;

    if (scrollDelta > 0) {
      state.pillVisible = false;
    } else {
      if (state.expandedSubjects.size > 0) {
        state.pillVisible = true;
      }
    }

    state.lastScrollTop = currentScrollTop;
    updateAccordionPillVisibility();
  }

  function resetDeckList() {
    state.expandedSubjects.clear();
    localStorage.removeItem('flashcard-expanded-subjects');
    state.pillVisible = false;
    updateAccordionPillVisibility();
    state.lastSelectedTopicId = null;
    localStorage.removeItem('flashcard-last-topic');
    if (!state.isActive) {
      renderDeckList();
      if (container) {
        container.scrollTop = 0;
      }
    }
  }

  // === カード一覧用まとめ読み込み ===
  function normalizeForMatch(text) {
    return text
      .toLowerCase()
      .replace(/[\s　]/g, '')
      .replace(/[Ａ-Ｚａ-ｚ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  }

  function extractSection(doc, sectionName) {
    if (!sectionName) return null;

    const normalizedSection = normalizeForMatch(sectionName);

    const keywords = sectionName
      .split(/[\s　・、。（）()「」『』【】\-_]+/)
      .filter(k => k.length >= 2);

    function calcScore(headingText) {
      const normalizedHeading = normalizeForMatch(headingText);

      if (normalizedHeading === normalizedSection) {
        return 100;
      }
      if (normalizedHeading.includes(normalizedSection) || normalizedSection.includes(normalizedHeading)) {
        return 80;
      }
      const matchedKeywords = keywords.filter(k =>
        normalizedHeading.includes(normalizeForMatch(k))
      );
      if (matchedKeywords.length > 0) {
        return (matchedKeywords.length / keywords.length) * 60;
      }
      return 0;
    }

    const h3Elements = doc.querySelectorAll('h3');
    let bestMatch = null;
    let bestScore = 0;
    let matchLevel = 'h3';

    for (const h3 of h3Elements) {
      const h3Text = h3.childNodes[0]?.textContent?.trim() || h3.textContent.trim();
      const score = calcScore(h3Text);

      if (score > bestScore) {
        bestScore = score;
        bestMatch = h3;
      }
      if (score === 100) break;
    }

    if (bestScore < 30) {
      const h2Elements = doc.querySelectorAll('h2');
      for (const h2 of h2Elements) {
        const h2Text = h2.childNodes[0]?.textContent?.trim() || h2.textContent.trim();
        const score = calcScore(h2Text);

        if (score > bestScore) {
          bestScore = score;
          bestMatch = h2;
          matchLevel = 'h2';
        }
        if (score === 100) break;
      }
    }

    if (bestMatch && bestScore >= 30) {
      const content = [bestMatch.outerHTML];
      let sibling = bestMatch.nextElementSibling;
      const stopTags = matchLevel === 'h2' ? ['H2'] : ['H3', 'H2'];

      while (sibling && !stopTags.includes(sibling.tagName)) {
        if (sibling.classList?.contains('question-box')) {
          sibling = sibling.nextElementSibling;
          continue;
        }
        content.push(sibling.outerHTML);
        sibling = sibling.nextElementSibling;
      }

      return content.join('');
    }

    return null;
  }

  async function loadDeckCardSummary(contentEl, htmlPath, sectionName) {
    try {
      contentEl.innerHTML = '<p style="color: var(--secondary-label); font-style: italic;">読み込み中...</p>';
      const response = await fetch(encodeURI(htmlPath));
      if (!response.ok) {
        throw new Error('Failed to fetch');
      }
      const html = await response.text();

      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      if (sectionName) {
        const sectionContent = extractSection(doc, sectionName);
        if (sectionContent) {
          contentEl.innerHTML = sectionContent;
          return;
        }
      }

      contentEl.innerHTML = doc.body ? doc.body.innerHTML : html;
    } catch (e) {
      contentEl.innerHTML = '<p style="color: var(--destructive-red, #ff3b30);">まとめの読み込みに失敗しました</p>';
    }
  }

  // === 分析タブ ===

  function getAnalysisBadge(again, total) {
    if (total < 5) return { cls: 'grey', label: '未着手' };
    const rate = total > 0 ? again / total : 0;
    if (rate > 0.4) return { cls: 'red', label: '弱点' };
    if (rate >= 0.2) return { cls: 'yellow', label: '要注意' };
    return { cls: 'green', label: '得意' };
  }

  function renderAnalysisStackedBar(again, learning, mastered) {
    const total = again + learning + mastered;
    if (total === 0) return '<div class="analysis-stacked-bar"><div class="analysis-bar-empty"></div></div>';
    const pctAgain = (again / total * 100).toFixed(1);
    const pctLearning = (learning / total * 100).toFixed(1);
    const pctMastered = (mastered / total * 100).toFixed(1);
    return `
      <div class="analysis-stacked-bar">
        ${again > 0 ? `<div class="analysis-bar-segment again" style="width:${pctAgain}%"></div>` : ''}
        ${learning > 0 ? `<div class="analysis-bar-segment learning" style="width:${pctLearning}%"></div>` : ''}
        ${mastered > 0 ? `<div class="analysis-bar-segment mastered" style="width:${pctMastered}%"></div>` : ''}
      </div>
    `;
  }

  function renderAnalysisTab(containerEl) {
    const DATA = getDATA();
    const rawSubjects = [...new Set(DATA.map(d => d.subject).filter(Boolean))];
    const subjects = rawSubjects.sort((a, b) => {
      const indexA = SUBJECT_ORDER.indexOf(a);
      const indexB = SUBJECT_ORDER.indexOf(b);
      return (indexA === -1 ? 999 : indexA) - (indexB === -1 ? 999 : indexB);
    });

    // 全体統計
    const overall = getOverallStats();
    const overallTotal = overall.again + overall.learning + overall.mastered;

    // 科目別統計を収集
    const subjectDataList = subjects.map(subject => {
      const stats = deps.getSubjectStats ? deps.getSubjectStats(state, DATA, subject) : { again: 0, learning: 0, mastered: 0, total: 0 };
      const total = stats.again + stats.learning + stats.mastered;
      const badge = getAnalysisBadge(stats.again, total);
      return { subject, stats, total, badge };
    }).filter(d => d.total > 0 || DATA.some(t => t.subject === d.subject && (t.qaPath || t.localJsonData)));

    // 弱点順にソート（要復習率の高い順、未着手は最後）
    const attempted = subjectDataList.filter(d => d.total >= 5);
    const unattempted = subjectDataList.filter(d => d.total < 5);
    attempted.sort((a, b) => {
      const rateA = a.total > 0 ? a.stats.again / a.total : 0;
      const rateB = b.total > 0 ? b.stats.again / b.total : 0;
      return rateB - rateA;
    });

    // 全体プログレスバー
    const overallBarHtml = renderAnalysisStackedBar(overall.again, overall.learning, overall.mastered);

    // レジェンド
    const legendHtml = `
      <div class="analysis-legend">
        <span class="analysis-legend-item"><span class="analysis-legend-dot again"></span>要復習 ${overall.again}</span>
        <span class="analysis-legend-item"><span class="analysis-legend-dot learning"></span>定着中 ${overall.learning}</span>
        <span class="analysis-legend-item"><span class="analysis-legend-dot mastered"></span>習得済 ${overall.mastered}</span>
      </div>
    `;

    // 科目カード生成
    const subjectCardsHtml = attempted.map(d => {
      const info = SUBJECT_CATEGORIES[d.subject] || { color: '#8E8E93' };
      return `
        <div class="analysis-subject-card" data-subject="${escapeHtml(d.subject)}">
          <div class="analysis-subject-header">
            <span class="analysis-subject-name" style="border-left: 3px solid ${info.color}; padding-left: 8px;">${escapeHtml(d.subject)}</span>
            <span class="weakness-badge ${d.badge.cls}">${d.badge.label}</span>
          </div>
          ${renderAnalysisStackedBar(d.stats.again, d.stats.learning, d.stats.mastered)}
          <div class="analysis-subject-footer">
            <span class="analysis-subject-counts">要復習 ${d.stats.again} / 定着中 ${d.stats.learning} / 習得済 ${d.stats.mastered}</span>
            <span class="analysis-subject-arrow">›</span>
          </div>
        </div>
      `;
    }).join('');

    // 未着手科目
    const unattemptedHtml = unattempted.length > 0 ? `
      <div class="analysis-section-title" style="margin-top: 20px;">未着手</div>
      ${unattempted.map(d => {
        const info = SUBJECT_CATEGORIES[d.subject] || { color: '#8E8E93' };
        const topicCount = DATA.filter(t => t.subject === d.subject && (t.qaPath || t.localJsonData)).length;
        return `
          <div class="analysis-subject-card unattempted" data-subject="${escapeHtml(d.subject)}">
            <div class="analysis-subject-header">
              <span class="analysis-subject-name" style="border-left: 3px solid ${info.color}; padding-left: 8px;">${escapeHtml(d.subject)}</span>
              <span class="weakness-badge grey">未着手</span>
            </div>
            <div class="analysis-subject-footer">
              <span class="analysis-subject-counts">${topicCount}デッキ</span>
              <span class="analysis-subject-arrow">›</span>
            </div>
          </div>
        `;
      }).join('')}
    ` : '';

    // 空状態
    if (overallTotal === 0 && unattempted.length === 0) {
      containerEl.innerHTML = `
        <div class="analysis-empty">
          <div class="analysis-empty-icon">📊</div>
          <div class="analysis-empty-text">まだ学習データがありません</div>
          <div class="analysis-empty-hint">カードを学習すると、ここに科目別の習得状況が表示されます</div>
        </div>
      `;
      return;
    }

    containerEl.innerHTML = `
      <div class="analysis-container">
        <div class="analysis-overall">
          <div class="analysis-overall-label">全体の習得状況（${overallTotal}枚）</div>
          ${overallBarHtml}
          ${legendHtml}
        </div>
        <div class="analysis-section-title">科目別（弱点順）</div>
        <div class="analysis-subject-list">
          ${subjectCardsHtml}
        </div>
        ${unattemptedHtml}
      </div>
    `;

    // イベントバインド: 科目カードクリック
    containerEl.querySelectorAll('.analysis-subject-card').forEach(card => {
      card.addEventListener('click', () => {
        const subject = card.dataset.subject;
        renderAnalysisSubjectDetail(containerEl, subject);
      });
    });
  }

  function renderAnalysisSubjectDetail(containerEl, subject) {
    const DATA = getDATA();
    const info = SUBJECT_CATEGORIES[subject] || { color: '#8E8E93' };
    const allTopics = DATA.filter(d => d.subject === subject && (d.qaPath || d.localJsonData));
    const topics = deduplicateTopics(allTopics);

    // トピック別統計を収集
    const topicDataList = topics.map(topic => {
      const stats = deps.getTopicStats ? deps.getTopicStats(state, topic.id) : { again: 0, learning: 0, mastered: 0 };
      const total = stats.again + stats.learning + stats.mastered;
      const badge = getAnalysisBadge(stats.again, total);
      return { topic, stats, total, badge };
    });

    // 弱点順にソート
    const attempted = topicDataList.filter(d => d.total >= 5);
    const unattempted = topicDataList.filter(d => d.total < 5);
    attempted.sort((a, b) => {
      const rateA = a.total > 0 ? a.stats.again / a.total : 0;
      const rateB = b.total > 0 ? b.stats.again / b.total : 0;
      return rateB - rateA;
    });

    const allSorted = [...attempted, ...unattempted];

    const topicRowsHtml = allSorted.map(d => {
      const title = d.topic.title.replace(/^[ア-オ]_/, '');
      const isUnattempted = d.total < 5;
      return `
        <div class="analysis-topic-row ${isUnattempted ? 'unattempted' : ''}">
          <div class="analysis-topic-header">
            <span class="analysis-topic-name">${escapeHtml(title)}</span>
            <span class="weakness-badge ${d.badge.cls}">${d.badge.label}</span>
          </div>
          ${d.total > 0 ? renderAnalysisStackedBar(d.stats.again, d.stats.learning, d.stats.mastered) : ''}
          <div class="analysis-topic-footer">
            <span class="analysis-topic-counts">${d.total > 0 ? `要復習 ${d.stats.again} / 定着中 ${d.stats.learning} / 習得済 ${d.stats.mastered}` : '未学習'}</span>
            <button class="analysis-study-btn" data-topic-id="${escapeHtml(d.topic.id)}">学習する ›</button>
          </div>
        </div>
      `;
    }).join('');

    // 科目全体の統計
    const subjectStats = deps.getSubjectStats ? deps.getSubjectStats(state, DATA, subject) : { again: 0, learning: 0, mastered: 0, total: 0 };

    containerEl.innerHTML = `
      <div class="analysis-container">
        <button class="analysis-back-btn" id="analysis-back-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
          科目一覧
        </button>
        <div class="analysis-detail-title" style="border-left: 3px solid ${info.color}; padding-left: 10px;">${escapeHtml(subject)}</div>
        <div class="analysis-overall" style="margin-bottom: 16px;">
          ${renderAnalysisStackedBar(subjectStats.again, subjectStats.learning, subjectStats.mastered)}
          <div class="analysis-legend" style="margin-top: 8px;">
            <span class="analysis-legend-item"><span class="analysis-legend-dot again"></span>要復習 ${subjectStats.again}</span>
            <span class="analysis-legend-item"><span class="analysis-legend-dot learning"></span>定着中 ${subjectStats.learning}</span>
            <span class="analysis-legend-item"><span class="analysis-legend-dot mastered"></span>習得済 ${subjectStats.mastered}</span>
          </div>
        </div>
        <div class="analysis-topic-list">
          ${topicRowsHtml}
        </div>
      </div>
    `;

    // 戻るボタン
    const backBtn = containerEl.querySelector('#analysis-back-btn');
    if (backBtn) {
      backBtn.addEventListener('click', () => renderAnalysisTab(containerEl));
    }

    // 「学習する」ボタン
    containerEl.querySelectorAll('.analysis-study-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const topicId = btn.dataset.topicId;
        state.isReviewMode = false;
        await loadTopic(topicId, state.shuffleEnabled);
      });
    });
  }

  return {
    setContainer,
    deduplicateTopics,
    showDeckActionSheet,
    loadImportedDecks,
    addImportedDeckToData,
    deleteImportedDeck,
    loadDeckCustomizations,
    saveDeckCustomizations,
    getTopicCustomization,
    saveTopicCustomization,
    resetTopicCustomization,
    applyCustomizations,
    hasTopicCustomization,
    renderDeckList,
    renderDailyTenCardList,
    renderStatusDeckCardList,
    renderFavoriteDeckCardList,
    renderSubjectCardList,
    renderGroupCardList,
    renderDeckCardList,
    renderCardSearchScreen,
    renderInlineSearchResults,
    loadAllCardsIndex,
    searchCards,
    parseQAToCards,
    parseJSONToCards,
    openDeckEditModal,
    openDeckManageModal,
    openCardEditModal,
    openBuiltInCardEditModal,
    deleteBuiltInCard,
    deleteCard,
    showConfirmDialog,
    updateAccordionPillVisibility,
    handleDeckListScroll,
    resetDeckList,
    loadDeckCardSummary,
    extractSection,
    normalizeForMatch
  };
}
