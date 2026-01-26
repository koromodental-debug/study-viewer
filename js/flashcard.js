/**
 * フラッシュカードモジュール
 * Q&Aを使った演習機能を提供
 */
const FlashcardModule = (function() {
  // 定数
  const STORAGE_KEY = 'studyViewer_flashcardProgress';
  const SESSIONS_KEY = 'studyViewer_flashcardSessions';
  const REPORTS_KEY = 'studyViewer_cardReports';
  const DECK_CUSTOMIZATIONS_KEY = 'studyViewer_deckCustomizations';
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
    cramMode: localStorage.getItem('flashcard-cram-mode') === 'true', // 直前期モード（間隔反復OFF）
    againDelay: localStorage.getItem('flashcard-again-delay') || '1day', // 'immediate' or '1day'
    againMode: localStorage.getItem('flashcard-again-mode') || 'reinsert', // 'reinsert'(すぐ再挿入) or 'afterRound'(一周後)
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
    highlightTopicId: null
  };

  // DOM要素
  let container = null;

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

    const topic = DATA.find(d => d.id === topicId);
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
      // インポートデッキも再読み込み（他デバイスからの同期を反映）
      loadImportedDecks();
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
    if (!deck) return;

    // ローカルインポート（JSONデータを直接持つ）の場合
    if (deck.isLocal && deck.jsonData) {
      // deck.idは既に'local_'で始まっているのでそのまま使う
      const topicId = deck.id;

      // 既存を削除（重複防止）
      for (let i = DATA.length - 1; i >= 0; i--) {
        if (DATA[i].id === topicId) {
          DATA.splice(i, 1);
        }
      }

      // ローカルJSONデッキをDATAに追加
      DATA.push({
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
    for (let i = DATA.length - 1; i >= 0; i--) {
      if (DATA[i].id === topicId || DATA[i].importedDeckId === deckId) {
        DATA.splice(i, 1);
      }
    }

    // 3. 進捗データから関連エントリを削除
    const keysToDelete = Object.keys(state.progress).filter(k => k.startsWith(topicId + ':'));
    for (const key of keysToDelete) {
      delete state.progress[key];
    }
    saveProgress();

    // 4. Firebaseに同期（ログイン中の場合）
    if (typeof FirebaseSync !== 'undefined' && FirebaseSync.isLoggedIn()) {
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
      if (typeof FirebaseSync !== 'undefined' && FirebaseSync.isLoggedIn()) {
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
    // トピックに関連する進捗を集計（3分類: again/learning/mastered）
    const keys = Object.keys(state.progress).filter(k => k.startsWith(topicId + ':'));
    const now = Date.now();
    const MASTERY_THRESHOLD = 14; // 14日以上の間隔で「習得済」

    let again = 0;     // 要復習（期限切れ）
    let learning = 0;  // 定着中（interval < 14日）
    let mastered = 0;  // 習得済（interval >= 14日）

    for (const k of keys) {
      const p = state.progress[k];
      // 直前期モードでは全てのカードを「要復習」に
      const isDue = state.cramMode ? true : (p.nextReview && p.nextReview <= now);
      const interval = p.interval || 0;

      if (p.status === 'again' && (!p.nextReview || isDue)) {
        again++;
      } else if (p.status === 'memorized') {
        if (isDue) {
          again++;
        } else if (interval >= MASTERY_THRESHOLD) {
          mastered++;
        } else {
          learning++;
        }
      }
    }

    // 後方互換性のためmemorizedも返す（learning + mastered）
    return { again, learning, mastered, memorized: learning + mastered };
  }

  function getSubjectStats(subject) {
    // 科目配下の全トピックの統計を集計
    const topics = DATA.filter(d => d.subject === subject && (d.qaPath || d.localJsonData));
    let totalAgain = 0;
    let totalLearning = 0;
    let totalMastered = 0;

    for (const topic of topics) {
      const stats = getTopicStats(topic.id);
      totalAgain += stats.again;
      totalLearning += stats.learning;
      totalMastered += stats.mastered;
    }

    const totalMemorized = totalLearning + totalMastered;
    const totalCards = totalAgain + totalMemorized;

    return { again: totalAgain, learning: totalLearning, mastered: totalMastered, memorized: totalMemorized, total: totalCards };
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
    // progressから直接カウント（全てのtopicIdを含む、3分類）
    const now = Date.now();
    const MASTERY_THRESHOLD = 14;

    let again = 0;
    let learning = 0;
    let mastered = 0;

    for (const value of Object.values(state.progress)) {
      // 直前期モードでは全てのカードを「要復習」に
      const isDue = state.cramMode ? true : (value.nextReview && value.nextReview <= now);
      const interval = value.interval || 0;

      if (value.status === 'again' && (!value.nextReview || isDue)) {
        again++;
      } else if (value.status === 'memorized') {
        if (isDue) {
          again++;
        } else if (interval >= MASTERY_THRESHOLD) {
          mastered++;
        } else {
          learning++;
        }
      }
    }

    const memorized = learning + mastered;
    const totalCards = memorized + again;
    return { total: totalCards, memorized, again, learning, mastered };
  }

  // 今日のおすすめカード数を計算
  function getRecommendedCount() {
    // セッションサイズを使用
    return state.sessionSize;
  }

  // セッションサイズのラベルを取得（9999以上は「全問」）
  function getSessionSizeLabel(size = state.sessionSize) {
    return size >= 9999 ? '全問' : `${size}問`;
  }

  // 開始ボタンのサブテキストを生成（1行目：問数と時間）
  function buildStartSub(overall, mode) {
    const isAll = state.sessionSize >= 9999;
    const effectiveSize = isAll ? overall.total : state.sessionSize;
    const timeEstimate = Math.ceil(effectiveSize * 0.5);
    return `${getSessionSizeLabel()} · 約${timeEstimate}分`;
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
            <span class="breakdown-mode-desc">${getSessionSizeLabel(sessionSize)}</span>
          </button>
          <button class="breakdown-mode-btn ${currentMode === 'memorized' ? 'active' : ''}" data-mode="memorized">
            <span class="breakdown-mode-label">覚えたのみ</span>
            <span class="breakdown-mode-desc">${overall.memorized}カード</span>
          </button>
        </div>
      </div>
    `;

    // 問数選択ボタン（9999以上は「全問」）
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

    // 適応的間隔の説明セクション + 直前期モードトグル
    const intervalSection = `
      <div class="breakdown-section">
        <div class="breakdown-section-title">復習間隔</div>
        <div class="breakdown-section-desc">カードごとに自動調整されます（1日→3日→7日→14日→30日...）</div>
        <div class="cram-mode-toggle">
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

    // 直前期モードトグルのイベント
    const cramCheckbox = document.getElementById('cram-mode-checkbox');
    if (cramCheckbox) {
      cramCheckbox.addEventListener('change', () => {
        state.cramMode = cramCheckbox.checked;
        localStorage.setItem('flashcard-cram-mode', state.cramMode);
      });
    }

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

  // 設定シートを開く（ホーム画面から）
  function openSettingsSheet() {
    const overlay = document.getElementById('breakdown-overlay');
    const body = document.getElementById('breakdown-sheet-body');
    if (!overlay || !body) return;

    // 設定を表示
    body.innerHTML = `
      <div class="breakdown-section">
        <div class="breakdown-section-title">復習間隔</div>
        <div class="breakdown-section-desc">カードごとに自動調整されます（1日→3日→7日→14日→30日...）</div>
        <div class="cram-mode-toggle">
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

    // シートを開く
    overlay.classList.add('active');

    // 直前期モードトグルのイベント
    const cramCheckbox = document.getElementById('cram-mode-checkbox');
    if (cramCheckbox) {
      cramCheckbox.addEventListener('change', () => {
        state.cramMode = cramCheckbox.checked;
        localStorage.setItem('flashcard-cram-mode', state.cramMode);
      });
    }

    // 「もう一度」タイミングボタンのイベント（モード選択）
    body.querySelectorAll('.again-delay-btn[data-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        state.againMode = mode;
        localStorage.setItem('flashcard-again-mode', mode);

        // ボタンのアクティブ状態を更新（同じグループ内のみ）
        btn.parentElement.querySelectorAll('.again-delay-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // 説明テキストを更新
        const descEl = btn.parentElement.nextElementSibling;
        if (descEl) {
          descEl.innerHTML = mode === 'reinsert'
            ? '1→2→<span class="x">もう一度</span>→4→5→<span class="x">再出題</span>→終了'
            : '1周目: 1→2→<span class="x">もう一度</span>→4→5<br>2周目: <span class="x">もう一度</span>のカードだけ';
        }
      });
    });

    // 「もう一度」復習期限ボタンのイベント（delay選択）
    body.querySelectorAll('.again-delay-btn[data-delay]').forEach(btn => {
      btn.addEventListener('click', () => {
        const delay = btn.dataset.delay;
        state.againDelay = delay;
        localStorage.setItem('flashcard-again-delay', delay);

        // ボタンのアクティブ状態を更新（同じグループ内のみ）
        btn.parentElement.querySelectorAll('.again-delay-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
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

    // スクロール位置を復元（演習から戻った場合はハイライト付き、一覧から戻った場合は位置のみ）
    restoreDeckListScroll();
  }

  function restoreDeckListScroll() {
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
    const favoritesCount = getValidFavoritesCount();

    const dailyTenCompleted = isDailyTenCompleted();

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

      <!-- 学習の記録 -->
      <div class="review-center">
        <h2 class="review-center-title">
          学習の記録 <span class="review-total-badge">${totalLearned}件</span>
          <button class="review-help-btn" id="review-help-btn" aria-label="説明">?</button>
          <button class="review-settings-btn ${state.cramMode ? 'cram-active' : ''}" id="review-settings-btn" aria-label="設定">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>
        </h2>
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
    const allTopics = DATA.filter(d => d.subject === subject && (d.qaPath || d.localJsonData));
    // 重複除外: .txtと.jsonの両方がある場合、.jsonを優先
    const topics = deduplicateTopics(allTopics);
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
            ${stats.again > 0 ? `<span class="deck-subject-again">要復習 ${stats.again}</span>` : ''}
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
      let groupKey = null;
      let groupName = null;
      let sortOrder = '99'; // ソート用の番号

      // 1. まずpathからグループを抽出（従来の方式）
      const path = topic.qaPath || topic.htmlPath || '';
      const pathMatch = path.match(/subject\/[^/]+\/(\d{2})_([^_]+)/);
      if (pathMatch) {
        sortOrder = pathMatch[1];
        groupName = pathMatch[2];
      }

      // 2. pathでマッチしなければcategoryから抽出
      if (!groupName && topic.category) {
        // categoryの形式: "科目名/01_大項目名"
        const categoryMatch = topic.category.match(/[^/]+\/(\d{2})_([^_]+)/);
        if (categoryMatch) {
          sortOrder = categoryMatch[1];
          groupName = categoryMatch[2];
        }
      }

      // groupNameでグループ化（同じ「総論」は1つにまとめる）
      if (groupName) {
        groupKey = groupName;
        if (!groups.has(groupKey)) {
          groups.set(groupKey, { name: groupName, sortOrder: sortOrder, topics: [] });
        } else {
          // 既存グループのsortOrderより小さければ更新（最小番号を保持）
          if (sortOrder < groups.get(groupKey).sortOrder) {
            groups.get(groupKey).sortOrder = sortOrder;
          }
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

    // sortOrder順にソート
    const sortedKeys = [...groups.keys()].sort((a, b) => {
      const orderA = groups.get(a).sortOrder || '99';
      const orderB = groups.get(b).sortOrder || '99';
      return orderA.localeCompare(orderB);
    });

    return sortedKeys.map(key => {
      const group = groups.get(key);
      // 大項目に属するトピックIDをJSON形式で保存
      const topicIds = group.topics.map(t => t.id);
      return `
        <div class="deck-hisshu-group">
          <div class="deck-hisshu-header">
            <span class="hisshu-header-name">${group.name}</span>
            <button class="group-list-btn" data-topic-ids='${JSON.stringify(topicIds)}' data-group-name="${group.name}" title="カード一覧">
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

    // インポート済みデッキには⋮メニューを表示
    const isImported = topic.source === 'local_imported';
    const moreBtn = isImported ? `
      <button class="deck-more-btn" data-topic-id="${topic.id}" data-deck-id="${topic.importedDeckId || ''}" title="メニュー">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="2"></circle>
          <circle cx="12" cy="12" r="2"></circle>
          <circle cx="12" cy="19" r="2"></circle>
        </svg>
      </button>
    ` : '';

    const isHighlighted = state.highlightTopicId === topic.id;

    return `
      <div class="deck-topic${isHighlighted ? ' highlighted' : ''}" data-topic-id="${topic.id}">
        <span class="deck-topic-name">${displayTitle}</span>
        <div class="deck-topic-right">
          ${statsHtml}
          <button class="deck-list-btn" data-topic-id="${topic.id}" title="カード一覧">
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
        // 一覧ボタンや管理ボタンがクリックされた場合はスキップ
        if (e.target.closest('.subject-list-btn') || e.target.closest('.deck-manage-toggle-btn')) return;

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
        // ボタンがクリックされた場合はスキップ
        if (e.target.closest('.deck-list-btn') || e.target.closest('.deck-edit-btn') || e.target.closest('.deck-delete-btn')) return;
        e.stopPropagation();
        const topicId = row.dataset.topicId;
        // 選択したトピックを記憶
        state.lastSelectedTopicId = topicId;
        localStorage.setItem('flashcard-last-topic', topicId);
        state.isReviewMode = false;
        await loadTopic(topicId, state.shuffleEnabled);
      });
    });

    // 一覧ボタンクリック（カード一覧表示）
    const listBtns = container.querySelectorAll('.deck-list-btn');
    listBtns.forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        // デッキ一覧のスクロール位置を保存
        state.deckListScrollPos = container.scrollTop;
        const topicId = btn.dataset.topicId;
        await renderDeckCardList(topicId);
      });
    });

    // ココシカバナークリック（学習開始）
    const kokoshikaBanners = container.querySelectorAll('.kokoshika-banner');
    kokoshikaBanners.forEach(banner => {
      banner.addEventListener('click', async (e) => {
        // 一覧ボタンがクリックされた場合はスキップ
        if (e.target.closest('.kokoshika-list-btn')) return;
        e.stopPropagation();
        const topicId = banner.dataset.topicId;
        state.lastSelectedTopicId = topicId;
        localStorage.setItem('flashcard-last-topic', topicId);
        state.isReviewMode = false;
        await loadTopic(topicId, state.shuffleEnabled);
      });
    });

    // ココシカ一覧ボタンクリック
    const kokoshikaListBtns = container.querySelectorAll('.kokoshika-list-btn');
    kokoshikaListBtns.forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        // デッキ一覧のスクロール位置を保存
        state.deckListScrollPos = container.scrollTop;
        const topicId = btn.dataset.topicId;
        await renderDeckCardList(topicId);
      });
    });

    // インポートデッキ ⋮メニューボタン → アクションシート表示
    const moreBtns = container.querySelectorAll('.deck-more-btn');
    moreBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const topicId = btn.dataset.topicId;
        const deckId = btn.dataset.deckId;
        showDeckActionSheet(topicId, deckId);
      });
    });

    // デッキ管理ボタンクリック
    const manageBtn = document.getElementById('deck-manage-toggle');
    if (manageBtn) {
      manageBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openDeckManageModal();
      });
    }

    // 設定ボタン（内訳シートを開く）
    const breakdownLink = document.getElementById('deck-breakdown-link');
    if (breakdownLink) {
      breakdownLink.addEventListener('click', (e) => {
        e.stopPropagation();
        openBreakdownSheet();
      });
    }

    // 「要復習」ボタン → 一覧表示
    const againBtn = document.getElementById('start-again-deck');
    if (againBtn) {
      againBtn.addEventListener('click', () => renderStatusDeckCardList('again'));
    }

    // 「定着中」ボタン → 一覧表示
    const learningBtn = document.getElementById('start-learning-deck');
    if (learningBtn) {
      learningBtn.addEventListener('click', () => renderStatusDeckCardList('learning'));
    }

    // 「習得済」ボタン → 一覧表示
    const masteredBtn = document.getElementById('start-mastered-deck');
    if (masteredBtn) {
      masteredBtn.addEventListener('click', () => renderStatusDeckCardList('mastered'));
    }

    // 「お気に入り」ボタン → 一覧表示
    const favoriteBtn = document.getElementById('start-favorite-deck');
    if (favoriteBtn) {
      favoriteBtn.addEventListener('click', () => renderFavoriteDeckCardList());
    }

    // 「今日の10問」演習開始ボタン
    const dailyTenStartBtn = document.getElementById('daily-ten-start');
    if (dailyTenStartBtn) {
      dailyTenStartBtn.addEventListener('click', () => startDailyTenDeck());
    }

    // 「今日の10問」一覧ボタン
    const dailyTenListBtn = document.getElementById('daily-ten-list');
    if (dailyTenListBtn) {
      dailyTenListBtn.addEventListener('click', () => renderDailyTenCardList());
    }

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
    if (!topic) return;

    state.currentTopicId = topicId;
    state.currentTopic = topic;

    // ローカルインポート（JSONデータを直接持つ）の場合
    if (topic.localJsonData) {
      try {
        const cards = parseJSONToCards(topic.localJsonData, topicId);
        loadTopicFromCards(cards, topicId, shuffle);
      } catch (e) {
        console.log('ローカルJSON読み込みエラー:', e);
        container.innerHTML = `<div class="flashcard-error">デッキの読み込みに失敗しました</div>`;
      }
      return;
    }

    // 通常のqaPathを持つトピック
    if (!topic.qaPath) return;

    try {
      const response = await fetch(encodeURI(topic.qaPath));
      const text = await response.text();
      loadTopicFromText(text, topicId, shuffle);
    } catch (e) {
      console.log('Q&A読み込みエラー:', e);
      container.innerHTML = `<div class="flashcard-error">Q&Aの読み込みに失敗しました</div>`;
    }
  }

  // カード配列から直接ロード（ローカルJSON用）
  function loadTopicFromCards(cards, topicId, shuffle = false) {
    state.cards = cards;

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
      if (session.order && session.order.length === state.filteredCards.length) {
        const orderMap = new Map(state.filteredCards.map(c => [c.originalIndex, c]));
        const reordered = session.order.map(idx => orderMap.get(idx)).filter(Boolean);
        if (reordered.length === state.filteredCards.length) {
          state.filteredCards = reordered;
        }
      }
      if (session.index !== undefined && session.index > 0) {
        savedIndex = Math.min(session.index, state.filteredCards.length - 1);
      }
    } else if (state.shuffleEnabled && state.filteredCards.length > 0) {
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
    state.againCards = [];
    state.currentRound = 1;

    if (state.filteredCards.length === 0) {
      renderNoCardsMessage();
    } else {
      renderCard();
    }
  }

  // テキストからトピックを読み込む共通処理
  function loadTopicFromText(text, topicId, shuffle = false) {
    let cards = parseQAToCards(text, topicId);
    // 組み込みデッキの場合、カスタマイズを適用
    cards = applyCustomizations(cards, topicId);
    state.cards = cards;

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
    state.againCards = [];
    state.currentRound = 1;

    if (state.filteredCards.length === 0) {
      renderNoCardsMessage();
    } else {
      renderCard();
    }
  }

  // === 今日の10問 ===

  // 日付ベースのランダムシード生成
  function getDailyRandomSeed() {
    const today = new Date().toDateString();
    let hash = 0;
    for (let i = 0; i < today.length; i++) {
      hash = ((hash << 5) - hash) + today.charCodeAt(i);
      hash = hash & hash;
    }
    return hash;
  }

  // 今日の10問が完了済みかチェック
  function isDailyTenCompleted() {
    const completedDate = localStorage.getItem('flashcard-daily-ten-completed');
    const today = new Date().toDateString();
    return completedDate === today;
  }

  // 今日の10問を完了としてマーク
  function markDailyTenCompleted() {
    const today = new Date().toDateString();
    localStorage.setItem('flashcard-daily-ten-completed', today);
  }

  // シード付き乱数生成
  function seededRandom(seed) {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
  }

  // 今日の10問のカード参照を収集
  function collectDailyTenCardRefs() {
    const seed = getDailyRandomSeed();
    const allCardRefs = [];

    // 学習済みカードを収集
    for (const [key, value] of Object.entries(state.progress)) {
      const parts = key.split(':');
      if (parts.length >= 2) {
        const topicId = parts[0];
        const cardIndex = parseInt(parts[1]);
        if (!isNaN(cardIndex)) {
          allCardRefs.push({ topicId, cardIndex, key });
        }
      }
    }

    // シード付きシャッフル（Fisher-Yates with seeded random）
    let currentSeed = seed;
    for (let i = allCardRefs.length - 1; i > 0; i--) {
      currentSeed = (currentSeed * 9301 + 49297) % 233280;
      const j = Math.floor((currentSeed / 233280) * (i + 1));
      [allCardRefs[i], allCardRefs[j]] = [allCardRefs[j], allCardRefs[i]];
    }

    // 最初の10問を返す
    return allCardRefs.slice(0, 10);
  }

  // 今日の10問のカード一覧表示
  async function renderDailyTenCardList() {
    console.log('[renderDailyTenCardList] 開始');
    const cardRefs = collectDailyTenCardRefs();

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
      const isFavorite = FavoritesManager.isFavoriteByParams('qa', card.topicId, card.originalIndex);

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
        let topic = DATA.find(d => d.id === topicId);
        if (!topic) {
          topic = DATA.find(d => d.id.includes(topicId) || d.id.endsWith('_' + topicId.toLowerCase()));
        }
        if (!topic) {
          topic = DATA.find(d => d.title === topicId || topicId.includes(d.title));
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
        const isFav = FavoritesManager.toggle('qa', topicId, originalIndex, content);
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
          const newInterval = currentInterval === 0 ? 1 : getNextInterval(currentInterval);
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

  // 今日の10問の演習開始
  async function startDailyTenDeck() {
    console.log('[startDailyTenDeck] 開始');
    const cardRefs = collectDailyTenCardRefs();
    console.log('[startDailyTenDeck] cardRefs:', cardRefs.length);

    if (cardRefs.length === 0) {
      showToast('学習済みのカードがありません', 2000);
      return;
    }

    const filteredCards = await fetchCardsFromRefs(cardRefs);
    console.log('[startDailyTenDeck] filteredCards:', filteredCards.length);
    if (filteredCards.length === 0) {
      showToast('カードの読み込みに失敗しました', 2000);
      return;
    }

    // 今日の10問デッキとして開始
    state.currentTopicId = '__daily_ten';
    state.currentTopic = { title: '今日の10問' };
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

    // シャッフル
    for (let i = state.filteredCards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [state.filteredCards[i], state.filteredCards[j]] = [state.filteredCards[j], state.filteredCards[i]];
    }

    renderCard();
  }

  // === ステータスデッキ（要復習/定着中/習得済） ===

  // ステータスに応じたカード参照を収集
  function collectStatusCardRefs(status) {
    const cardRefs = [];
    const now = Date.now();
    const MASTERY_THRESHOLD = 14;

    for (const [key, value] of Object.entries(state.progress)) {
      const isDue = state.cramMode ? true : (value.nextReview && value.nextReview <= now);
      const interval = value.interval || 0;

      if (status === 'again') {
        if (value.status === 'again') {
          if (!value.nextReview || isDue) {
            const [topicId, cardIndex] = key.split(':');
            cardRefs.push({ topicId, cardIndex: parseInt(cardIndex), key });
          }
        } else if (value.status === 'memorized' && isDue) {
          const [topicId, cardIndex] = key.split(':');
          cardRefs.push({ topicId, cardIndex: parseInt(cardIndex), key });
        }
      } else if (status === 'learning') {
        if (value.status === 'memorized' && !isDue && interval < MASTERY_THRESHOLD) {
          const [topicId, cardIndex] = key.split(':');
          cardRefs.push({ topicId, cardIndex: parseInt(cardIndex), key });
        }
      } else if (status === 'mastered') {
        if (value.status === 'memorized' && !isDue && interval >= MASTERY_THRESHOLD) {
          const [topicId, cardIndex] = key.split(':');
          cardRefs.push({ topicId, cardIndex: parseInt(cardIndex), key });
        }
      } else if (status === 'memorized') {
        if (value.status === 'memorized' && !isDue) {
          const [topicId, cardIndex] = key.split(':');
          cardRefs.push({ topicId, cardIndex: parseInt(cardIndex), key });
        }
      }
    }
    return cardRefs;
  }

  // カード参照からカードデータを取得
  async function fetchCardsFromRefs(cardRefs) {
    // 不正なエントリをフィルタリング
    const validRefs = cardRefs.filter(r => r && r.topicId);
    const uniqueTopicIds = [...new Set(validRefs.map(r => r.topicId))];
    const topicCardsMap = new Map();

    // 各トピックの情報を準備
    const fetchTasks = [];
    for (const topicId of uniqueTopicIds) {
      let topic, qaPath;

      if (topicId === 'kokoshika_hisshu') {
        topic = { id: 'kokoshika_hisshu', title: '必修ココシカ', subject: '必修' };
        qaPath = 'deck/必修ココシカ.txt';
      } else {
        topic = DATA.find(d => d.id === topicId);
        if (!topic) {
          topic = DATA.find(d => d.id.includes(topicId) || d.id.endsWith('_' + topicId.toLowerCase()));
        }
        if (!topic) {
          topic = DATA.find(d => d.title === topicId || topicId.includes(d.title));
        }
        qaPath = topic?.qaPath;
      }

      // ローカルインポート（localJsonData）の場合
      if (topic && topic.localJsonData) {
        try {
          const cards = parseJSONToCards(topic.localJsonData, topicId);
          topicCardsMap.set(topicId, { cards, topic });
        } catch (e) {
          console.log(`ローカルJSON読み込みエラー (${topicId}):`, e);
        }
        continue;
      }

      if (!qaPath && topic && topic.category) {
        const parts = topic.category.split('/');
        const subject = parts[0];
        const idParts = topic.id.split('_');
        const fileName = idParts.slice(1).join('_');
        qaPath = `qa/subject/${subject}/${fileName}.json`;
      }

      if (!topic || !qaPath) continue;

      // fetchタスクを配列に追加（並列実行用）
      fetchTasks.push({ topicId, topic, qaPath });
    }

    // 全トピックを並列でfetch
    await Promise.all(fetchTasks.map(async ({ topicId, topic, qaPath }) => {
      try {
        const response = await fetch(encodeURI(qaPath));
        if (!response.ok) return;

        const contentType = response.headers.get('content-type');
        let cards;

        if (qaPath.endsWith('.json') || (contentType && contentType.includes('json'))) {
          const jsonData = await response.json();
          cards = parseJSONToCards(jsonData, topicId);
        } else {
          const text = await response.text();
          cards = parseQAToCards(text, topicId);
        }

        topicCardsMap.set(topicId, { cards, topic });
      } catch (e) {
        console.log(`QA読み込みエラー (${topicId}):`, e);
      }
    }))

    // フィルタ済みカード配列を構築
    const filteredCards = [];
    const addedKeys = new Set();
    const invalidKeys = [];

    for (const ref of validRefs) {
      if (addedKeys.has(ref.key)) continue;
      const topicData = topicCardsMap.get(ref.topicId);
      if (topicData) {
        const card = topicData.cards.find(c => c.originalIndex === ref.cardIndex);
        if (card) {
          addedKeys.add(ref.key);
          filteredCards.push({
            ...card,
            topicId: ref.topicId,
            topicTitle: topicData.topic.title,
            htmlPath: topicData.topic.htmlPath,
            progressKey: ref.key
          });
        } else {
          invalidKeys.push(ref.key);
        }
      } else {
        invalidKeys.push(ref.key);
      }
    }

    // 見つからなかったカードをprogressから削除
    if (invalidKeys.length > 0) {
      for (const key of invalidKeys) {
        delete state.progress[key];
      }
      saveProgress();
    }

    return filteredCards;
  }

  async function startStatusDeck(status) {
    console.log('[startStatusDeck] 開始:', status);
    const cardRefs = collectStatusCardRefs(status);
    console.log('[startStatusDeck] cardRefs:', cardRefs.length);

    if (cardRefs.length === 0) {
      return;
    }

    const filteredCards = await fetchCardsFromRefs(cardRefs);
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
    state.againCards = [];
    state.currentRound = 1;

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

  // === 科目・大項目シャッフル演習 ===

  // 科目全体のシャッフル演習
  async function startSubjectDeck(subject) {
    console.log('[startSubjectDeck] 開始:', subject);

    // 対象トピックを取得
    const topics = DATA.filter(d => d.subject === subject);
    if (topics.length === 0) {
      showToast('対象のトピックがありません', 2000);
      return;
    }

    // カード参照を収集
    const cardRefs = [];
    topics.forEach(topic => {
      const stats = getTopicStats(topic.id);
      const total = stats.memorized + stats.again + (stats.new || 0);
      // 進捗がある場合はその数だけ参照を作成、なければカード数を推定（後でfetch時に実際のデータを取得）
      for (let i = 0; i < Math.max(total, 1); i++) {
        cardRefs.push({ topicId: topic.id, cardIndex: i, estimated: total === 0 });
      }
    });

    // 全カードを読み込み
    const allCards = await fetchAllCardsFromTopics(topics);
    if (allCards.length === 0) {
      showToast('カードの読み込みに失敗しました', 2000);
      return;
    }

    // 科目デッキとして開始
    state.currentTopicId = '__subject_' + subject;
    state.currentTopic = { title: subject + '（全体）' };
    state.cards = allCards;
    state.filteredCards = [...allCards];
    state.currentIndex = 0;
    state.isFlipped = false;
    state.isActive = true;
    state.completed = false;
    state.answeredInSession = 0;
    state.combo = 0;
    state.againCards = [];
    state.currentRound = 1;

    // シャッフル（Fisher-Yates）
    for (let i = state.filteredCards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [state.filteredCards[i], state.filteredCards[j]] = [state.filteredCards[j], state.filteredCards[i]];
    }

    console.log('[startSubjectDeck] カード数:', state.filteredCards.length);
    renderCard();
  }

  // 大項目（グループ）のシャッフル演習
  async function startGroupDeck(topicIds, groupName) {
    console.log('[startGroupDeck] 開始:', groupName, topicIds);

    // 対象トピックを取得
    const topics = topicIds.map(id => DATA.find(d => d.id === id)).filter(Boolean);
    if (topics.length === 0) {
      showToast('対象のトピックがありません', 2000);
      return;
    }

    // 全カードを読み込み
    const allCards = await fetchAllCardsFromTopics(topics);
    if (allCards.length === 0) {
      showToast('カードの読み込みに失敗しました', 2000);
      return;
    }

    // グループデッキとして開始
    state.currentTopicId = '__group_' + groupName;
    state.currentTopic = { title: groupName };
    state.cards = allCards;
    state.filteredCards = [...allCards];
    state.currentIndex = 0;
    state.isFlipped = false;
    state.isActive = true;
    state.completed = false;
    state.answeredInSession = 0;
    state.combo = 0;
    state.againCards = [];
    state.currentRound = 1;

    // シャッフル（Fisher-Yates）
    for (let i = state.filteredCards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [state.filteredCards[i], state.filteredCards[j]] = [state.filteredCards[j], state.filteredCards[i]];
    }

    console.log('[startGroupDeck] カード数:', state.filteredCards.length);
    renderCard();
  }

  // 複数トピックから全カードを取得
  async function fetchAllCardsFromTopics(topics) {
    const allCards = [];

    for (const topic of topics) {
      try {
        let cards;

        // ローカルインポート（JSONデータを直接持つ）の場合
        if (topic.localJsonData) {
          cards = parseJSONToCards(topic.localJsonData, topic.id);
        } else {
          // 通常のトピック
          let qaPath = topic.qaPath;

          // qaPathがない場合はcategoryから推定
          if (!qaPath && topic.category) {
            const parts = topic.category.split('/');
            const subject = parts[0];
            const idParts = topic.id.split('_');
            const fileName = idParts.slice(1).join('_');
            qaPath = `qa/subject/${subject}/${fileName}.json`;
          }

          if (!qaPath) continue;

          const response = await fetch(encodeURI(qaPath));
          if (!response.ok) continue;

          const contentType = response.headers.get('content-type');

          if (qaPath.endsWith('.json') || (contentType && contentType.includes('json'))) {
            const jsonData = await response.json();
            cards = parseJSONToCards(jsonData, topic.id);
          } else {
            const text = await response.text();
            cards = parseQAToCards(text, topic.id);
          }
        }

        // 各カードにtopicIdとoriginalIndexを付与
        cards.forEach((card, idx) => {
          card.topicId = topic.id;
          card.originalIndex = idx;
          card.progressKey = `${topic.id}:${idx}`;
          card.topicTitle = topic.title;
        });

        allCards.push(...cards);
      } catch (e) {
        console.log(`QA読み込みエラー (${topic.id}):`, e);
      }
    }

    return allCards;
  }

  // === 科目・大項目カード一覧表示 ===

  // 科目のカード一覧表示
  async function renderSubjectCardList(subject) {
    console.log('[renderSubjectCardList] 開始:', subject);

    // 対象トピックを取得
    const topics = DATA.filter(d => d.subject === subject);
    if (topics.length === 0) {
      showToast('対象のトピックがありません', 2000);
      return;
    }

    // 全カードを読み込み
    const allCards = await fetchAllCardsFromTopics(topics);
    if (allCards.length === 0) {
      showToast('カードの読み込みに失敗しました', 2000);
      return;
    }

    // 一時保存（演習開始時に使用）
    state.tempSubjectCards = allCards;
    state.tempSubjectName = subject;

    // ヘッダー
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

    // カード一覧
    const cardsHtml = allCards.map((card, idx) => {
      const key = card.progressKey;
      const cardProgress = state.progress[key];
      const cardStatus = cardProgress ? cardProgress.status : 'new';
      const isFavorite = FavoritesManager.isFavoriteByParams('qa', card.topicId, card.originalIndex);

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

    container.innerHTML = `
      <div class="deck-card-list-view" data-subject="${subject}">
        ${headerHtml}
        <div class="deck-card-list-content">
          ${cardsHtml}
        </div>
      </div>
    `;

    // タブバーを非表示
    const tabbar = document.querySelector('.floating-tabbar');
    if (tabbar) tabbar.classList.add('hidden');

    // イベントバインド
    bindSubjectCardListEvents(subject, allCards);
  }

  // 科目カード一覧のイベントバインド
  function bindSubjectCardListEvents(subject, allCards) {
    // 戻るボタン
    const backBtn = document.getElementById('deck-card-list-back');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        renderDeckList();
        setTimeout(() => {
          container.scrollTop = state.deckListScrollPos || 0;
        }, 50);
      });
    }

    // 演習開始ボタン
    const startBtn = document.getElementById('deck-card-list-start');
    if (startBtn) {
      startBtn.addEventListener('click', () => {
        startSubjectDeckFromCards(allCards, subject);
      });
    }

    // カード行クリック（プレビュー）
    const cardItems = container.querySelectorAll('.card-search-item');
    cardItems.forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.card-search-action-btn') || e.target.closest('.card-search-favorite-btn')) return;
        const idx = parseInt(item.dataset.cardIndex);
        showCardPreview(allCards[idx]);
      });
    });

    // 覚えた/もう一度ボタン
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
          const newInterval = currentInterval === 0 ? 1 : getNextInterval(currentInterval);
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

        // UIを更新
        const parent = btn.closest('.card-search-actions');
        if (parent) {
          parent.querySelectorAll('.card-search-action-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        }
      });
    });

    // お気に入りボタン
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

        const newFavorite = FavoritesManager.toggle('qa', favTopicId, originalIndex, content);

        btn.classList.toggle('active', newFavorite);
        const svg = btn.querySelector('svg');
        if (svg) {
          svg.setAttribute('fill', newFavorite ? 'currentColor' : 'none');
        }
        showToast(newFavorite ? 'お気に入りに追加' : 'お気に入りから削除', 1000);
      });
    });
  }

  // 大項目のカード一覧表示
  async function renderGroupCardList(topicIds, groupName) {
    console.log('[renderGroupCardList] 開始:', groupName, topicIds);

    // 対象トピックを取得
    const topics = topicIds.map(id => DATA.find(d => d.id === id)).filter(Boolean);
    if (topics.length === 0) {
      showToast('対象のトピックがありません', 2000);
      return;
    }

    // 全カードを読み込み
    const allCards = await fetchAllCardsFromTopics(topics);
    if (allCards.length === 0) {
      showToast('カードの読み込みに失敗しました', 2000);
      return;
    }

    // 一時保存（演習開始時に使用）
    state.tempGroupCards = allCards;
    state.tempGroupName = groupName;

    // ヘッダー
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

    // カード一覧
    const cardsHtml = allCards.map((card, idx) => {
      const key = card.progressKey;
      const cardProgress = state.progress[key];
      const cardStatus = cardProgress ? cardProgress.status : 'new';
      const isFavorite = FavoritesManager.isFavoriteByParams('qa', card.topicId, card.originalIndex);

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

    container.innerHTML = `
      <div class="deck-card-list-view" data-group="${groupName}">
        ${headerHtml}
        <div class="deck-card-list-content">
          ${cardsHtml}
        </div>
      </div>
    `;

    // タブバーを非表示
    const tabbar = document.querySelector('.floating-tabbar');
    if (tabbar) tabbar.classList.add('hidden');

    // イベントバインド
    bindGroupCardListEvents(groupName, allCards);
  }

  // 大項目カード一覧のイベントバインド
  function bindGroupCardListEvents(groupName, allCards) {
    // 戻るボタン
    const backBtn = document.getElementById('deck-card-list-back');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        renderDeckList();
        setTimeout(() => {
          container.scrollTop = state.deckListScrollPos || 0;
        }, 50);
      });
    }

    // 演習開始ボタン
    const startBtn = document.getElementById('deck-card-list-start');
    if (startBtn) {
      startBtn.addEventListener('click', () => {
        startGroupDeckFromCards(allCards, groupName);
      });
    }

    // カード行クリック（プレビュー）
    const cardItems = container.querySelectorAll('.card-search-item');
    cardItems.forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.card-search-action-btn') || e.target.closest('.card-search-favorite-btn')) return;
        const idx = parseInt(item.dataset.cardIndex);
        showCardPreview(allCards[idx]);
      });
    });

    // 覚えた/もう一度ボタン
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
          const newInterval = currentInterval === 0 ? 1 : getNextInterval(currentInterval);
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

        // UIを更新
        const parent = btn.closest('.card-search-actions');
        if (parent) {
          parent.querySelectorAll('.card-search-action-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        }
      });
    });

    // お気に入りボタン
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

        const newFavorite = FavoritesManager.toggle('qa', favTopicId, originalIndex, content);

        btn.classList.toggle('active', newFavorite);
        const svg = btn.querySelector('svg');
        if (svg) {
          svg.setAttribute('fill', newFavorite ? 'currentColor' : 'none');
        }
        showToast(newFavorite ? 'お気に入りに追加' : 'お気に入りから削除', 1000);
      });
    });
  }

  // カードデータから科目デッキを開始
  function startSubjectDeckFromCards(allCards, subject) {
    state.currentTopicId = '__subject_' + subject;
    state.currentTopic = { title: subject + '（全体）' };
    state.cards = allCards;
    state.filteredCards = [...allCards];
    state.currentIndex = 0;
    state.isFlipped = false;
    state.isActive = true;
    state.completed = false;
    state.answeredInSession = 0;
    state.combo = 0;
    state.againCards = [];
    state.currentRound = 1;

    // シャッフル（Fisher-Yates）
    for (let i = state.filteredCards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [state.filteredCards[i], state.filteredCards[j]] = [state.filteredCards[j], state.filteredCards[i]];
    }

    console.log('[startSubjectDeckFromCards] カード数:', state.filteredCards.length);
    renderCard();
  }

  // カードデータから大項目デッキを開始
  function startGroupDeckFromCards(allCards, groupName) {
    state.currentTopicId = '__group_' + groupName;
    state.currentTopic = { title: groupName };
    state.cards = allCards;
    state.filteredCards = [...allCards];
    state.currentIndex = 0;
    state.isFlipped = false;
    state.isActive = true;
    state.completed = false;
    state.answeredInSession = 0;
    state.combo = 0;
    state.againCards = [];
    state.currentRound = 1;

    // シャッフル（Fisher-Yates）
    for (let i = state.filteredCards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [state.filteredCards[i], state.filteredCards[j]] = [state.filteredCards[j], state.filteredCards[i]];
    }

    console.log('[startGroupDeckFromCards] カード数:', state.filteredCards.length);
    renderCard();
  }

  // ステータスデッキの一覧表示
  async function renderStatusDeckCardList(status) {
    console.log('[renderStatusDeckCardList] 開始:', status);
    const cardRefs = collectStatusCardRefs(status);

    if (cardRefs.length === 0) {
      return;
    }

    // ローディング表示（即座にフィードバック）
    const statusNames = { again: '要復習', learning: '定着中', mastered: '習得済' };
    container.innerHTML = `
      <div class="loading-view" style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 50vh; gap: 16px;">
        <div class="loading-spinner" style="width: 32px; height: 32px; border: 3px solid var(--border-color); border-top-color: var(--system-blue); border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
        <div style="color: var(--text-muted); font-size: 14px;">${statusNames[status] || status}を読み込み中...</div>
      </div>
      <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
    `;

    const filteredCards = await fetchCardsFromRefs(cardRefs);
    if (filteredCards.length === 0) {
      return;
    }

    const title = statusNames[status] || status;

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
      const isFavorite = FavoritesManager.isFavoriteByParams('qa', card.topicId, card.originalIndex);

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

    container.innerHTML = `
      <div class="deck-card-list-view" data-status="${status}">
        ${headerHtml}
        <div class="deck-card-list-content">
          ${cardsHtml}
        </div>
      </div>
    `;

    // タブバーを非表示
    const tabbar = document.querySelector('.floating-tabbar');
    if (tabbar) tabbar.classList.add('hidden');

    // イベントバインド
    bindStatusDeckCardListEvents(status, filteredCards);

    // スクロール位置を復元
    const scrollKey = `status:${status}`;
    if (state.deckCardListScrollPos[scrollKey] !== undefined) {
      container.scrollTop = state.deckCardListScrollPos[scrollKey];
    }
  }

  // ステータスデッキのスクロール位置保存
  function saveStatusDeckScrollPos(status) {
    const scrollKey = `status:${status}`;
    state.deckCardListScrollPos[scrollKey] = container.scrollTop;
  }

  // ステータスデッキ一覧のイベントバインド
  function bindStatusDeckCardListEvents(status, filteredCards) {
    // 戻るボタン
    const backBtn = document.getElementById('deck-card-list-back');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        // スクロール位置を保存
        saveStatusDeckScrollPos(status);
        const tabbar = document.querySelector('.floating-tabbar');
        if (tabbar) tabbar.classList.remove('hidden');
        renderDeckList();
        // ホーム画面のスクロール位置をトップにリセット
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
          // スクロール位置を保存
          saveStatusDeckScrollPos(status);
          const tabbar = document.querySelector('.floating-tabbar');
          if (tabbar) tabbar.classList.remove('hidden');
          renderDeckList();
          // ホーム画面のスクロール位置をトップにリセット
          window.scrollTo(0, 0);
          container.scrollTop = 0;
        }
      }, { passive: true });
    }

    // 演習開始ボタン
    const startBtn = document.getElementById('deck-card-list-start');
    if (startBtn) {
      startBtn.addEventListener('click', () => {
        // スクロール位置を保存してから演習開始
        saveStatusDeckScrollPos(status);
        startStatusDeck(status);
      });
    }

    // カードクリックで展開
    const cardItems = container.querySelectorAll('.card-search-item');
    cardItems.forEach((item, idx) => {
      const card = filteredCards[idx];
      if (!card) return;

      item.addEventListener('click', (e) => {
        // ボタンクリックは除外
        if (e.target.closest('.card-search-action-btn') || e.target.closest('.card-search-favorite-btn')) {
          return;
        }

        const isExpanded = item.classList.contains('expanded');
        // 他の展開を閉じる
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
        const isFav = FavoritesManager.toggle('qa', topicId, originalIndex, content);
        btn.classList.toggle('active', isFav);
        const svg = btn.querySelector('svg');
        if (svg) svg.setAttribute('fill', isFav ? 'currentColor' : 'none');
      });
    });

    // ステータスボタン（もう一度/覚えた）
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
          const newInterval = currentInterval === 0 ? 1 : getNextInterval(currentInterval);
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

        // ボタンの見た目を更新
        const item = btn.closest('.card-search-item');
        const againBtn = item.querySelector('.card-search-action-btn.again');
        const memorizedBtn = item.querySelector('.card-search-action-btn.memorized');
        againBtn.classList.toggle('active', action === 'again');
        memorizedBtn.classList.toggle('active', action === 'memorized');
      });
    });
  }

  // === お気に入りデッキ ===

  // 有効なお気に入り数を取得（存在するトピックのみカウント）
  function getValidFavoritesCount() {
    const favorites = FavoritesManager.getByType('qa');
    let validCount = 0;
    for (const fav of favorites) {
      // トピックが存在するかチェック
      let topic = DATA.find(d => d.id === fav.topicId);
      if (!topic && fav.topicId === 'kokoshika_hisshu') {
        topic = { id: 'kokoshika_hisshu' };
      }
      if (topic) {
        validCount++;
      }
    }
    return validCount;
  }

  // 孤立したお気に入りをクリーンアップ
  function cleanupOrphanedFavorites() {
    const favorites = FavoritesManager.getByType('qa');
    let removedCount = 0;
    for (const fav of favorites) {
      let topic = DATA.find(d => d.id === fav.topicId);
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

  // お気に入りデッキの一覧表示
  async function renderFavoriteDeckCardList() {
    // 孤立したお気に入りをクリーンアップ
    cleanupOrphanedFavorites();

    const allFavorites = FavoritesManager.getAll();
    const favorites = allFavorites.filter(f => f.type === 'qa');
    if (favorites.length === 0) return;

    // 必要なトピックのQAファイルを取得
    const uniqueTopicIds = [...new Set(favorites.map(f => f.topicId))];
    const topicCardsMap = new Map();

    for (const topicId of uniqueTopicIds) {
      let topic, qaPath;

      if (topicId === 'kokoshika_hisshu') {
        topic = { id: 'kokoshika_hisshu', title: '必修ココシカ', subject: '必修' };
        qaPath = 'deck/必修ココシカ.txt';
      } else {
        topic = DATA.find(d => d.id === topicId);
        if (!topic) {
          topic = DATA.find(d => d.id.includes(topicId) || d.id.endsWith('_' + topicId.toLowerCase()));
        }
        qaPath = topic?.qaPath;
      }

      if (!topic) continue;

      try {
        let cards;
        if (topic.localJsonData) {
          cards = parseJSONToCards(topic.localJsonData, topicId);
        } else if (qaPath) {
          const response = await fetch(encodeURI(qaPath));
          const text = await response.text();
          cards = parseQAToCards(text, topicId);
        } else {
          continue;
        }
        topicCardsMap.set(topicId, { cards, topic });
      } catch (e) {
        console.log(`QA読み込みエラー (${topicId}):`, e);
      }
    }

    // お気に入りカード配列を構築
    const filteredCards = [];
    for (const fav of favorites) {
      const topicData = topicCardsMap.get(fav.topicId);
      if (!topicData) continue;
      const card = topicData.cards.find(c => c.originalIndex === parseInt(fav.cardIndex));
      if (!card) continue;
      filteredCards.push({
        ...card,
        topicId: fav.topicId,
        topicTitle: topicData.topic.title,
        htmlPath: topicData.topic.htmlPath,
        progressKey: `${fav.topicId}:${fav.cardIndex}`
      });
    }

    if (filteredCards.length === 0) return;

    // ヘッダー
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

    // カード一覧
    const cardsHtml = filteredCards.map((card, idx) => {
      const key = card.progressKey;
      const cardProgress = state.progress[key];
      const cardStatus = cardProgress ? cardProgress.status : 'new';

      return `
        <div class="card-search-item" data-key="${escapeHtml(key)}" data-card-index="${idx}">
          <div class="card-search-card deck-card-list-card" data-key="${escapeHtml(key)}">
            <div class="card-search-question">Q: ${escapeHtml(card.question)}</div>
          </div>
          <div class="card-search-footer">
            <div class="card-search-meta">${card.topicTitle || ''}</div>
            <div class="card-search-actions">
              <button class="card-search-favorite-btn active" data-key="${escapeHtml(key)}" data-topic-id="${escapeHtml(card.topicId)}" data-original-index="${card.originalIndex}" data-question="${escapeHtml(card.question)}" data-answer="${escapeHtml(card.answer)}" data-section="${card.section ? escapeHtml(card.section) : ''}" title="お気に入り解除">
                <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2">
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

    container.innerHTML = `
      <div class="deck-card-list-view" data-status="favorite">
        ${headerHtml}
        <div class="deck-card-list-content">
          ${cardsHtml}
        </div>
      </div>
    `;

    // タブバーを非表示
    const tabbar = document.querySelector('.floating-tabbar');
    if (tabbar) tabbar.classList.add('hidden');

    // イベントバインド
    bindFavoriteDeckCardListEvents(filteredCards);

    // スクロール位置を復元
    const scrollKey = 'favorite';
    if (state.deckCardListScrollPos[scrollKey] !== undefined) {
      container.scrollTop = state.deckCardListScrollPos[scrollKey];
    }
  }

  // お気に入りデッキのスクロール位置保存
  function saveFavoriteDeckScrollPos() {
    state.deckCardListScrollPos['favorite'] = container.scrollTop;
  }

  // お気に入りデッキ一覧のイベントバインド
  function bindFavoriteDeckCardListEvents(filteredCards) {
    // 戻るボタン
    const backBtn = document.getElementById('deck-card-list-back');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        // スクロール位置を保存
        saveFavoriteDeckScrollPos();
        const tabbar = document.querySelector('.floating-tabbar');
        if (tabbar) tabbar.classList.remove('hidden');
        renderDeckList();
        // ホーム画面のスクロール位置をトップにリセット
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
          // スクロール位置を保存
          saveFavoriteDeckScrollPos();
          const tabbar = document.querySelector('.floating-tabbar');
          if (tabbar) tabbar.classList.remove('hidden');
          renderDeckList();
          // ホーム画面のスクロール位置をトップにリセット
          window.scrollTo(0, 0);
          container.scrollTop = 0;
        }
      }, { passive: true });
    }

    // 演習開始ボタン
    const startBtn = document.getElementById('deck-card-list-start');
    if (startBtn) {
      startBtn.addEventListener('click', () => {
        // スクロール位置を保存してから演習開始
        saveFavoriteDeckScrollPos();
        startFavoriteDeck();
      });
    }

    // カードクリックで展開
    const cardItems = container.querySelectorAll('.card-search-item');
    cardItems.forEach((item, idx) => {
      const card = filteredCards[idx];
      if (!card) return;

      item.addEventListener('click', (e) => {
        if (e.target.closest('.card-search-action-btn') || e.target.closest('.card-search-favorite-btn')) {
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

    // お気に入りボタン（削除してアニメーション）
    const favBtns = container.querySelectorAll('.card-search-favorite-btn');
    favBtns.forEach((btn, idx) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const topicId = btn.dataset.topicId;
        const originalIndex = parseInt(btn.dataset.originalIndex);

        // お気に入りから削除
        FavoritesManager.toggle('qa', topicId, originalIndex, null);

        // カードを画面から削除（アニメーション）
        const cardItem = btn.closest('.card-search-item');
        if (cardItem) {
          cardItem.style.transition = 'opacity 0.3s, transform 0.3s';
          cardItem.style.opacity = '0';
          cardItem.style.transform = 'translateX(-100%)';
          setTimeout(() => {
            cardItem.remove();
            // カウント更新
            const countEl = container.querySelector('.deck-card-list-count');
            const remaining = container.querySelectorAll('.card-search-item').length;
            if (countEl) countEl.textContent = `${remaining}枚`;
            // 全て削除されたら戻る
            if (remaining === 0) {
              const tabbar = document.querySelector('.floating-tabbar');
              if (tabbar) tabbar.classList.remove('hidden');
              renderDeckList();
            }
          }, 300);
        }
      });
    });

    // ステータスボタン（もう一度/覚えた）
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
          const newInterval = currentInterval === 0 ? 1 : getNextInterval(currentInterval);
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

  async function startFavoriteDeck() {
    // 孤立したお気に入りをクリーンアップ
    const removedCount = cleanupOrphanedFavorites();
    if (removedCount > 0) {
      console.log('[Favorites] クリーンアップ完了:', removedCount, '件削除');
    }

    const allFavorites = FavoritesManager.getAll();
    const favorites = allFavorites.filter(f => f.type === 'qa');
    if (favorites.length === 0) return;

    // 必要なトピックのQAファイルを取得
    const uniqueTopicIds = [...new Set(favorites.map(f => f.topicId))];
    const topicCardsMap = new Map();

    for (const topicId of uniqueTopicIds) {
      let topic, qaPath;

      // ココシカ（特別デッキ）の場合
      if (topicId === 'kokoshika_hisshu') {
        topic = { id: 'kokoshika_hisshu', title: '必修ココシカ', subject: '必修' };
        qaPath = 'deck/必修ココシカ.txt';
      } else {
        // 完全一致 → 部分一致の順で検索
        topic = DATA.find(d => d.id === topicId);
        if (!topic) {
          topic = DATA.find(d => d.id.includes(topicId) || d.id.endsWith('_' + topicId.toLowerCase()));
        }
        qaPath = topic?.qaPath;
      }

      if (!topic) continue;

      try {
        let cards;
        // インポートデッキ（localJsonData）の場合
        if (topic.localJsonData) {
          cards = parseJSONToCards(topic.localJsonData, topicId);
        } else if (qaPath) {
          // 組み込みデッキ（.txtベース）の場合
          const response = await fetch(encodeURI(qaPath));
          const text = await response.text();
          cards = parseQAToCards(text, topicId);
        } else {
          continue;
        }
        topicCardsMap.set(topicId, { cards, topic });
      } catch (e) {
        console.log(`QA読み込みエラー (${topicId}):`, e);
      }
    }

    // お気に入りカード配列を構築
    const filteredCards = [];
    for (const fav of favorites) {
      const topicData = topicCardsMap.get(fav.topicId);
      if (!topicData) continue;
      const card = topicData.cards.find(c => c.originalIndex === parseInt(fav.cardIndex));
      if (!card) continue;
      filteredCards.push({
        ...card,
        topicTitle: topicData.topic.title,
        htmlPath: topicData.topic.htmlPath
      });
    }

    if (filteredCards.length === 0) return;

    // お気に入りデッキとして開始
    state.currentTopicId = '__favorites';
    state.currentTopic = { title: 'お気に入り' };
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
    state.againCards = [];
    state.currentRound = 1;

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
    state.againCards = [];
    state.currentRound = 1;

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
    const topicsWithQa = DATA.filter(d => d.qaPath || d.localJsonData);
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
    state.againCards = [];
    state.currentRound = 1;

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
    const topicsWithQa = DATA.filter(d => d.qaPath || d.localJsonData);
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
    state.againCards = [];
    state.currentRound = 1;

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
    let currentChoices = {};  // 選択肢を保存
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
        currentChoices = {};  // 新しい質問が始まったら選択肢をリセット
      } else if (/^[a-e]:\s/.test(trimmed)) {
        // 選択肢を解析（a: xxx, b: xxx 形式）
        const choiceKey = trimmed.charAt(0);
        const choiceValue = trimmed.slice(2).trim();
        currentChoices[choiceKey] = choiceValue;
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

        // 選択肢がある場合、選択問題として設定
        if (Object.keys(currentChoices).length > 0) {
          // 正解キーを特定（answerと一致する選択肢を探す）
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
          card.numChoices = 1;  // デフォルトは1つ選択
        }

        // @sourceがある場合、HTMLパスを設定
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

  // === デッキ内カード一覧を表示 ===
  async function renderDeckCardList(topicId) {
    let topic;
    let qaPath;

    // ココシカ（特別デッキ）の場合
    if (topicId === 'kokoshika_hisshu') {
      topic = { id: 'kokoshika_hisshu', title: '必修ココシカ', subject: '必修' };
      qaPath = 'deck/必修ココシカ.txt';
    } else {
      // 複数の方法でトピックを検索
      topic = DATA.find(d => d.id === topicId);
      if (!topic) {
        topic = DATA.find(d => d.id.includes(topicId) || d.id.endsWith('_' + topicId.toLowerCase()));
      }
      if (!topic) {
        topic = DATA.find(d => d.title === topicId || topicId.includes(d.title));
      }
      if (!topic || (!topic.qaPath && !topic.localJsonData)) {
        container.innerHTML = `<div class="flashcard-error">トピックが見つかりません</div>`;
        return;
      }
      qaPath = topic.qaPath;
    }

    // QAファイルを読み込み
    let cards = [];
    let isBuiltInDeck = false; // 組み込みデッキ（.txtベース）かどうか
    try {
      // ローカルインポートの場合
      if (topic.localJsonData) {
        cards = parseJSONToCards(topic.localJsonData, topicId);
      } else {
        const response = await fetch(encodeURI(qaPath));
        const text = await response.text();
        cards = parseQAToCards(text, topicId);
        isBuiltInDeck = true;
        // 組み込みデッキの場合、カスタマイズを適用
        cards = applyCustomizations(cards, topicId);
      }
    } catch (e) {
      console.log('Q&A読み込みエラー:', e);
      container.innerHTML = `<div class="flashcard-error">Q&Aの読み込みに失敗しました</div>`;
      return;
    }

    // カスタマイズがあるかどうか
    const hasCustomization = hasTopicCustomization(topicId);

    // ヘッダー
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

    // インポート済みデッキかどうか（編集・削除ボタン表示用）
    const isImportedDeck = topic.source === 'local_imported';
    // 編集可能なデッキかどうか（インポート済み または 組み込みデッキ）
    const isEditable = isImportedDeck || isBuiltInDeck;

    // カード一覧（検索結果と同じ形式）
    let cardsHtml = cards.map((card, idx) => {
      const key = `${topicId}:${idx}`;
      const cardProgress = state.progress[key];
      const cardStatus = cardProgress ? cardProgress.status : 'new';
      const isExpanded = state.deckCardListExpandedKeys && state.deckCardListExpandedKeys.has(key);

      // 元のインデックス（カスタマイズ用）
      const originalIndex = card.originalIndex !== undefined ? card.originalIndex : idx;
      // お気に入り状態（FavoritesManagerを使用）
      const isFavorite = FavoritesManager.isFavoriteByParams('qa', topicId, originalIndex);

      // htmlPathを決定（カード単位 or トピック単位）
      const cardHtmlPath = card.htmlPath || (topic && topic.htmlPath);

      // 編集メニューボタン（編集可能なデッキのみ）
      const moreMenuBtn = isEditable ? `
        <button class="card-more-menu-btn" data-card-index="${idx}" data-original-index="${originalIndex}" title="メニュー">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="5" r="2"/>
            <circle cx="12" cy="12" r="2"/>
            <circle cx="12" cy="19" r="2"/>
          </svg>
        </button>
      ` : '';

      // インラインまとめの展開状態を確認
      const isSummaryExpanded = state.deckCardListSummaryKeys && state.deckCardListSummaryKeys.has(key);
      const summaryContent = state.deckCardListSummaryContent && state.deckCardListSummaryContent[key] || '';

      return `
        <div class="card-search-item ${isExpanded ? 'expanded' : ''}" data-key="${escapeHtml(key)}" data-card-index="${idx}">
          <div class="card-search-card deck-card-list-card" data-key="${escapeHtml(key)}">
            <div class="card-search-question">Q: ${escapeHtml(card.question)}</div>
            ${isExpanded ? `
              <div class="card-search-answer">A: ${escapeHtml(card.answer)}${cardHtmlPath ? `<span class="inline-summary-toggle" data-html-path="${escapeHtml(cardHtmlPath)}" data-section="${card.section ? escapeHtml(card.section) : ''}"> ${isSummaryExpanded ? '∨' : '>'}</span>` : ''}</div>
              ${cardHtmlPath ? `<div class="inline-summary-content ${isSummaryExpanded ? '' : 'collapsed'}">${summaryContent}</div>` : ''}
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
            </div>
          </div>
        </div>
      `;
    }).join('');

    container.innerHTML = `
      <div class="deck-card-list-view">
        ${headerHtml}
        <div class="deck-card-list-content">
          ${cardsHtml}
        </div>
      </div>
    `;

    // タブバーを非表示
    const tabbar = document.querySelector('.floating-tabbar');
    if (tabbar) tabbar.classList.add('hidden');

    // 展開状態を初期化
    if (!state.deckCardListExpandedKeys) {
      state.deckCardListExpandedKeys = new Set();
    }
    // インラインまとめの展開状態とコンテンツを初期化
    if (!state.deckCardListSummaryKeys) {
      state.deckCardListSummaryKeys = new Set();
    }
    if (!state.deckCardListSummaryContent) {
      state.deckCardListSummaryContent = {};
    }

    // イベントバインド
    bindDeckCardListEvents(topicId);

    // スクロール位置を復元（保存されていない場合は先頭にスクロール）
    requestAnimationFrame(() => {
      if (state.deckCardListScrollPos[topicId] !== undefined) {
        container.scrollTop = state.deckCardListScrollPos[topicId];
      } else {
        container.scrollTop = 0;
      }
    });
  }

  // カード一覧のスクロール位置を保存
  function saveDeckCardListScrollPos(topicId) {
    state.deckCardListScrollPos[topicId] = container.scrollTop;
  }

  // デッキカード一覧のイベントバインド
  function bindDeckCardListEvents(topicId) {
    // 戻るボタン
    const backBtn = document.getElementById('deck-card-list-back');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        // スクロール位置を保存してから戻る
        saveDeckCardListScrollPos(topicId);
        state.deckCardListExpandedKeys = new Set();
        state.deckCardListSummaryKeys = new Set();
        state.deckCardListSummaryContent = {};
        // タブバーを再表示
        const tabbar = document.querySelector('.floating-tabbar');
        if (tabbar) tabbar.classList.remove('hidden');
        renderDeckList();
      });
    }

    // スワイプで戻るジェスチャー
    const swipeContainer = document.querySelector('.deck-card-list-view');
    if (swipeContainer) {
      let touchStartX = 0;
      let touchStartY = 0;
      let isSwiping = false;

      swipeContainer.addEventListener('touchstart', (e) => {
        const touch = e.touches[0];
        // 画面左端40px以内からのタッチのみ対象
        if (touch.clientX <= 40) {
          touchStartX = touch.clientX;
          touchStartY = touch.clientY;
          isSwiping = true;
        }
      }, { passive: true });

      swipeContainer.addEventListener('touchmove', (e) => {
        if (!isSwiping) return;
        // スワイプ中の処理（必要に応じてビジュアルフィードバック追加可能）
      }, { passive: true });

      swipeContainer.addEventListener('touchend', (e) => {
        if (!isSwiping) return;
        isSwiping = false;

        const touch = e.changedTouches[0];
        const deltaX = touch.clientX - touchStartX;
        const deltaY = Math.abs(touch.clientY - touchStartY);

        // 右に80px以上スワイプ、かつ縦方向の移動が少ない場合
        if (deltaX > 80 && deltaY < 100) {
          // 戻る処理を実行
          saveDeckCardListScrollPos(topicId);
          state.deckCardListExpandedKeys = new Set();
          state.deckCardListSummaryKeys = new Set();
          state.deckCardListSummaryContent = {};
          const tabbar = document.querySelector('.floating-tabbar');
          if (tabbar) tabbar.classList.remove('hidden');
          renderDeckList();
        }
      }, { passive: true });
    }

    // 演習開始ボタン
    const startBtn = document.getElementById('deck-card-list-start');
    if (startBtn) {
      startBtn.addEventListener('click', async () => {
        // スクロール位置を保存してから演習開始
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

    // カードクリックで展開/折りたたみ
    const cardEls = document.querySelectorAll('.deck-card-list-view .deck-card-list-card');
    cardEls.forEach(cardEl => {
      cardEl.addEventListener('click', () => {
        const key = cardEl.dataset.key;
        if (state.deckCardListExpandedKeys.has(key)) {
          state.deckCardListExpandedKeys.delete(key);
        } else {
          state.deckCardListExpandedKeys.add(key);
        }
        saveDeckCardListScrollPos(topicId);
        renderDeckCardList(topicId);
      });
    });

    // 覚えた/もう一度ボタン
    const actionBtns = document.querySelectorAll('.deck-card-list-view .card-search-action-btn');
    actionBtns.forEach(btn => {
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

        // UIを更新
        const parent = btn.closest('.card-search-actions');
        if (parent) {
          parent.querySelectorAll('.card-search-action-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        }
      });
    });

    // お気に入りボタン（FavoritesManagerを使用）
    const favBtns = document.querySelectorAll('.deck-card-list-view .card-search-favorite-btn');
    favBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const favTopicId = btn.dataset.topicId;
        const originalIndex = parseInt(btn.dataset.originalIndex);
        const content = {
          question: btn.dataset.question,
          answer: btn.dataset.answer,
          section: btn.dataset.section || '',
          topicTitle: topic?.title || favTopicId,
          subject: topic?.subject || ''
        };

        const newFavorite = FavoritesManager.toggle('qa', favTopicId, originalIndex, content);

        btn.classList.toggle('active', newFavorite);
        const svg = btn.querySelector('svg');
        if (svg) {
          svg.setAttribute('fill', newFavorite ? 'currentColor' : 'none');
        }
        showToast(newFavorite ? 'お気に入りに追加' : 'お気に入りから削除', 1000);
      });
    });

    // インラインまとめトグル（「>」クリック）
    const inlineSummaryToggles = document.querySelectorAll('.deck-card-list-view .inline-summary-toggle');
    inlineSummaryToggles.forEach(toggle => {
      toggle.addEventListener('click', async (e) => {
        e.stopPropagation();
        const cardItem = toggle.closest('.card-search-item');
        const card = toggle.closest('.card-search-card');
        const content = card.querySelector('.inline-summary-content');
        if (!content) return;

        const key = cardItem?.dataset.key;
        const isCollapsed = content.classList.contains('collapsed');

        if (isCollapsed) {
          // 展開時: まだ読み込んでいなければHTMLを取得
          if (!content.innerHTML.trim()) {
            const htmlPath = toggle.dataset.htmlPath;
            const sectionName = toggle.dataset.section;
            await loadDeckCardSummary(content, htmlPath, sectionName);
          }
          toggle.textContent = ' ∨';
          // 状態を保存
          if (key) {
            state.deckCardListSummaryKeys.add(key);
            state.deckCardListSummaryContent[key] = content.innerHTML;
          }
        } else {
          toggle.textContent = ' >';
          // 状態を削除
          if (key) {
            state.deckCardListSummaryKeys.delete(key);
          }
        }

        content.classList.toggle('collapsed');
      });
    });

    // リセットボタン（カスタマイズリセット）
    const resetBtn = document.getElementById('deck-card-list-reset');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        showConfirmDialog(
          '編集をリセット',
          'このデッキへの編集・削除をすべて元に戻しますか？',
          () => {
            if (resetTopicCustomization(topicId)) {
              showToast('編集をリセットしました');
              saveDeckCardListScrollPos(topicId);
              renderDeckCardList(topicId);
            }
          }
        );
      });
    }

    // カードメニューボタン（⋮）→ アクションシート表示
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

  // カード操作アクションシート
  function showCardActionSheet(topicId, cardIndex, originalIndex, cardItem) {
    // 既存のアクションシートを削除
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

    // オーバーレイクリックで閉じる
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.classList.contains('cancel')) {
        overlay.remove();
      }
    });

    // 編集
    overlay.querySelector('.edit').addEventListener('click', async () => {
      overlay.remove();
      const topic = DATA.find(d => d.id === topicId);

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

      // 組み込みデッキ
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

    // 削除
    overlay.querySelector('.delete').addEventListener('click', () => {
      overlay.remove();
      const topic = DATA.find(d => d.id === topicId);

      if (topic && topic.localJsonData) {
        deleteCard(topicId, cardIndex);
      } else {
        deleteBuiltInCard(topicId, originalIndex);
      }
    });
  }

  // JSONフォーマットのQAをパース
  function parseJSONToCards(jsonData, topicId) {
    const cards = [];
    let index = 0;

    for (const section of jsonData.sections || []) {
      for (const qa of section.qa || []) {
        const hasChoices = qa.choices && Object.keys(qa.choices).length > 0;

        // 選択肢から正解キーを抽出（「○」を含む選択肢）
        let correctAnswerKey = '';
        if (hasChoices) {
          const correctKeys = Object.entries(qa.choices)
            .filter(([key, value]) => value && value.includes('○'))
            .map(([key]) => key);
          correctAnswerKey = correctKeys.join('').toUpperCase();
        }

        // 問題文から「（○つ）」を抽出してnumChoicesを決定
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
          // 選択問題用フィールド
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
      const cardProgress = state.progress[item.searchKey];
      const cardStatus = cardProgress ? cardProgress.status : 'new';
      const isFavorite = cardProgress && cardProgress.favorite;
      return `
        <div class="card-search-item ${isExpanded ? 'expanded' : ''}" data-key="${escapeHtml(item.searchKey)}">
          <div class="card-search-card" data-key="${escapeHtml(item.searchKey)}">
            <div class="card-search-question">Q: ${highlightText(item.question, query)}</div>
            ${isExpanded ? `<div class="card-search-answer">A: ${highlightText(item.answer, query)}</div>` : ''}
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

    // 覚えた/もう一度ボタンクリック（カード）
    resultsEl.querySelectorAll('.card-search-action-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const key = btn.dataset.key;
        const action = btn.dataset.action;

        // 進捗を更新（既存のfavorite状態を保持）
        const existing = state.progress[key] || {};
        state.progress[key] = {
          ...existing,
          status: action,
          lastReview: Date.now()
        };
        saveProgress();

        // UIを更新（ボタンのactive状態を切り替え）
        const parent = btn.closest('.card-search-actions');
        if (parent) {
          parent.querySelectorAll('.card-search-action-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        }
      });
    });

    // お気に入りボタンクリック
    resultsEl.querySelectorAll('.card-search-favorite-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const key = btn.dataset.key;

        // 進捗を更新（favorite状態をトグル）
        const existing = state.progress[key] || {};
        const newFavorite = !existing.favorite;
        state.progress[key] = {
          ...existing,
          favorite: newFavorite
        };
        saveProgress();

        // UIを更新
        btn.classList.toggle('active', newFavorite);
        const svg = btn.querySelector('svg');
        if (svg) {
          svg.setAttribute('fill', newFavorite ? 'currentColor' : 'none');
        }
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
      const cardProgress = state.progress[item.searchKey];
      const cardStatus = cardProgress ? cardProgress.status : 'new';
      const isFavorite = cardProgress && cardProgress.favorite;
      return `
        <div class="card-search-item ${isExpanded ? 'expanded' : ''}" data-key="${escapeHtml(item.searchKey)}">
          <div class="card-search-card" data-key="${escapeHtml(item.searchKey)}">
            <div class="card-search-question">Q: ${highlightText(item.question, query)}</div>
            ${isExpanded ? `<div class="card-search-answer">A: ${highlightText(item.answer, query)}</div>` : ''}
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

    // 覚えた/もう一度ボタンクリック
    resultsEl.querySelectorAll('.card-search-action-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const key = btn.dataset.key;
        const action = btn.dataset.action;

        // 進捗を更新（既存のfavorite状態を保持）
        const existing = state.progress[key] || {};
        state.progress[key] = {
          ...existing,
          status: action,
          lastReview: Date.now()
        };
        saveProgress();

        // UIを更新（ボタンのactive状態を切り替え）
        const parent = btn.closest('.card-search-actions');
        if (parent) {
          parent.querySelectorAll('.card-search-action-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        }
      });
    });

    // お気に入りボタンクリック
    resultsEl.querySelectorAll('.card-search-favorite-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const key = btn.dataset.key;

        // 進捗を更新（favorite状態をトグル）
        const existing = state.progress[key] || {};
        const newFavorite = !existing.favorite;
        state.progress[key] = {
          ...existing,
          favorite: newFavorite
        };
        saveProgress();

        // UIを更新
        btn.classList.toggle('active', newFavorite);
        const svg = btn.querySelector('svg');
        if (svg) {
          svg.setAttribute('fill', newFavorite ? 'currentColor' : 'none');
        }
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
    // 今日の10問は問数固定なので除外
    if (state.currentTopicId === '__daily_ten') return false;
    // それ以外の__で始まるデッキは特殊デッキ
    return state.currentTopicId.startsWith('__');
  }

  // === 選択問題用UI ===
  function renderChoicesUI(card) {
    const choices = card.choices || {};
    const validChoices = Object.entries(choices)
      .filter(([key, value]) => value && value.trim() !== '');

    if (validChoices.length === 0) return '';

    // 選択肢テキストから正解マーク（○、：○など）を除去して表示
    const cleanChoiceText = (text) => {
      return text
        .replace(/[：:]\s*○/g, '')  // ：○ や : ○ を除去
        .replace(/○/g, '')          // 残った○を除去
        .trim();
    };

    return `
      <div class="flashcard-choices" data-num="${card.numChoices || 1}">
        ${validChoices.map(([key, value]) => `
          <button class="flashcard-choice-btn" data-choice="${key}">
            <span class="choice-label">${key.toUpperCase()}</span>
            <span class="choice-text">${escapeHtml(cleanChoiceText(value))}</span>
          </button>
        `).join('')}
      </div>
      <button class="flashcard-submit-btn" id="flashcard-submit-btn" disabled>
        解答
      </button>
    `;
  }

  // 選択肢タップ時の処理
  function onChoiceSelect(e) {
    if (state.choiceAnswered) return;

    const btn = e.currentTarget;
    const choiceKey = btn.dataset.choice;
    const card = state.filteredCards[state.currentIndex];
    const numChoices = card.numChoices || 1;

    // 選択状態の切り替え
    if (state.selectedChoices.has(choiceKey)) {
      state.selectedChoices.delete(choiceKey);
      btn.classList.remove('selected');
    } else {
      // 単一選択の場合は他を解除
      if (numChoices === 1) {
        document.querySelectorAll('.flashcard-choice-btn').forEach(b => {
          b.classList.remove('selected');
        });
        state.selectedChoices.clear();
      }
      state.selectedChoices.add(choiceKey);
      btn.classList.add('selected');
    }

    // 解答ボタンの有効/無効
    const submitBtn = document.getElementById('flashcard-submit-btn');
    if (submitBtn) {
      submitBtn.disabled = state.selectedChoices.size !== numChoices;
    }
  }

  // 解答ボタン押下時の判定処理
  function onSubmitAnswer() {
    if (state.choiceAnswered) return;

    const card = state.filteredCards[state.currentIndex];
    const correctAnswer = (card.correctAnswer || '').toUpperCase();

    // 判定
    const selectedKeys = Array.from(state.selectedChoices)
      .map(k => k.toUpperCase())
      .sort()
      .join('');
    const sortedCorrect = correctAnswer.split('').sort().join('');
    const isCorrect = selectedKeys === sortedCorrect;

    // 状態を更新
    state.choiceAnswered = true;

    // UIにフィードバック表示
    showChoiceFeedback(correctAnswer, isCorrect);

    // カードをめくる（解説表示）
    flipToAnswer();
  }

  // 正解/不正解のUI表示
  function showChoiceFeedback(correctAnswer, isCorrect) {
    // 全選択肢を無効化し、正解/不正解を表示
    document.querySelectorAll('.flashcard-choice-btn').forEach(btn => {
      btn.disabled = true;
      const key = btn.dataset.choice.toUpperCase();

      if (correctAnswer.includes(key)) {
        btn.classList.add('correct');
      } else if (btn.classList.contains('selected')) {
        btn.classList.add('incorrect');
      }
    });

    // 解答ボタンを非表示
    const submitBtn = document.getElementById('flashcard-submit-btn');
    if (submitBtn) {
      submitBtn.style.display = 'none';
    }

    // 結果フィードバック表示
    const feedback = document.createElement('div');
    feedback.className = `flashcard-result-feedback ${isCorrect ? 'correct' : 'incorrect'}`;
    feedback.textContent = isCorrect ? '正解!' : '不正解';

    const choicesDiv = document.querySelector('.flashcard-choices');
    if (choicesDiv) {
      choicesDiv.after(feedback);
    }
  }

  // 選択問題用：解答後にカードをめくる（トグルではなく強制的にめくる）
  function flipToAnswer() {
    state.isFlipped = true;
    const exercise = document.querySelector('.flashcard-exercise');
    const card = document.getElementById('flashcard-card');
    const actionBar = document.querySelector('.flashcard-action-bar');
    const summary = document.getElementById('flashcard-summary');

    if (exercise) exercise.classList.add('flipped');
    if (card) card.classList.add('flipped');
    if (actionBar) actionBar.classList.add('show');
    if (summary && summary.classList.contains('has-content')) {
      summary.classList.add('show');
    }
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
    // お気に入り状態
    const isFavorite = FavoritesManager.isFavoriteByParams('qa', keyTopicId, card.originalIndex);

    container.innerHTML = `
      <div class="flashcard-exercise ${state.isFlipped ? 'flipped' : ''}">
        <!-- ヘッダー -->
        <div class="flashcard-header">
          <button class="flashcard-back-btn" id="flashcard-back-btn" aria-label="戻る">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
          </button>
          <button class="flashcard-text-btn" id="flashcard-report-btn">報告</button>
          <div class="flashcard-progress-bar">
            <div class="flashcard-progress-fill" style="width: ${progressPercent}%"></div>
            <span class="flashcard-progress-text">${current} / ${total}${pendingAgain > 0 ? ` <span class="progress-pending">再${pendingAgain}</span>` : ''}</span>
            ${showSizeBtn ? `<button class="flashcard-size-btn" id="flashcard-size-btn" aria-label="問数変更">${state.sessionSize >= 9999 ? '全' : state.sessionSize}</button>` : ''}
          </div>
          <div class="flashcard-header-actions">
            ${(!showSizeBtn || state.currentTopicId === '__favorites') ? `<button class="flashcard-text-btn ${state.shuffleEnabled ? 'active' : ''}" id="flashcard-shuffle-btn">シャッフル</button>` : ''}
            <button class="flashcard-favorite-btn ${isFavorite ? 'active' : ''}" id="flashcard-favorite-btn" aria-label="お気に入り" title="お気に入り">
              <svg viewBox="0 0 24 24" fill="${isFavorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
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
                ${card.isChoiceCard ? renderChoicesUI(card) : `
                <!-- タップヒント（カード内、表面のみ、通常カードのみ） -->
                <div class="flashcard-tap-hint ${state.isFlipped ? 'hide' : ''}" id="tap-hint">
                  タップで答え
                </div>
                `}
                <div class="flashcard-answer">
                  ${card.answer}
                </div>
                ${card.topicTitle ? `
                <div class="flashcard-deck-pill-wrap">
                  <button class="flashcard-deck-pill" data-topic-id="${card.topicId}">
                    ${card.topicTitle}
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                      <polyline points="15 3 21 3 21 9"></polyline>
                      <line x1="10" y1="14" x2="21" y2="3"></line>
                    </svg>
                  </button>
                </div>
                ` : ''}
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

    // お気に入りボタン
    document.getElementById('flashcard-favorite-btn').addEventListener('click', toggleFavoriteCurrentCard);

    // デッキジャンプボタン（特殊デッキ用）
    const gotoDeckBtn = document.querySelector('.flashcard-deck-pill');
    if (gotoDeckBtn) {
      gotoDeckBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const topicId = gotoDeckBtn.dataset.topicId;

        // トピックを検索
        let topic = DATA.find(d => d.id === topicId);
        if (!topic) {
          topic = DATA.find(d => d.id.includes(topicId) || d.id.endsWith('_' + topicId.toLowerCase()));
        }
        if (!topic) {
          topic = DATA.find(d => d.title === topicId || topicId.includes(d.title));
        }

        if (topic) {
          state.highlightTopicId = topic.id;
          if (topic.subject) {
            state.expandedSubjects.add(topic.subject);
            localStorage.setItem('flashcard-expanded-subjects', JSON.stringify([...state.expandedSubjects]));
          }
        }

        // 演習を終了してデッキ一覧に戻る
        state.isActive = false;
        exitPracticeMode();
        renderDeckList();

        setTimeout(() => {
          const highlightedTopic = container.querySelector('.deck-topic.highlighted');
          if (highlightedTopic) {
            highlightedTopic.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
          setTimeout(() => {
            state.highlightTopicId = null;
            if (highlightedTopic) {
              highlightedTopic.classList.remove('highlighted');
            }
          }, 3000);
        }, 100);
      });
    }

    // 現在のカードを取得
    const currentCard = state.filteredCards[state.currentIndex];

    // 選択問題の場合
    if (currentCard && currentCard.isChoiceCard) {
      // 選択肢クリックイベント
      document.querySelectorAll('.flashcard-choice-btn').forEach(btn => {
        btn.addEventListener('click', onChoiceSelect);
      });

      // 解答ボタンイベント
      const submitBtn = document.getElementById('flashcard-submit-btn');
      if (submitBtn) {
        submitBtn.addEventListener('click', onSubmitAnswer);
      }
    } else {
      // 通常カード：タップでめくる
      const cardContainer = document.getElementById('flashcard-card-container');
      cardContainer.addEventListener('click', flip);
    }

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

    try {
      const canvas = await html2canvas(content, {
        backgroundColor: '#ffffff',
        scale: 2,
        useCORS: true,
        // クローンされたDOM上でライトモードスタイルを強制適用
        onclone: (clonedDoc, clonedEl) => {
          // ダークモードクラスを削除してライトモードに
          clonedDoc.documentElement.classList.remove('dark');
          clonedDoc.body.classList.remove('dark');

          // クローン上で全要素をライトモードに（!importantで強制）
          const applyLightStyle = (el) => {
            el.style.setProperty('color', '#1c1c1e', 'important');
            el.style.setProperty('-webkit-text-fill-color', '#1c1c1e', 'important');
            el.style.setProperty('border-color', '#c6c6c8', 'important');
          };

          clonedEl.style.setProperty('background-color', '#ffffff', 'important');
          applyLightStyle(clonedEl);

          const elements = clonedEl.querySelectorAll('*');
          elements.forEach(el => {
            applyLightStyle(el);
            const tagName = el.tagName.toUpperCase();
            if (tagName === 'TH') {
              el.style.setProperty('background-color', '#f2f2f7', 'important');
            } else if (tagName === 'TD') {
              el.style.setProperty('background-color', '#ffffff', 'important');
            } else if (tagName === 'TABLE' || tagName === 'TBODY' || tagName === 'THEAD' || tagName === 'TR') {
              el.style.setProperty('background-color', '#ffffff', 'important');
            } else if (tagName === 'MARK' || el.classList.contains('highlight') || el.classList.contains('keyword-highlight')) {
              el.style.setProperty('background-color', 'transparent', 'important');
            } else {
              el.style.setProperty('background-color', 'transparent', 'important');
            }
          });
        }
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
      // 元のスタイルを復元（oncloneを使用しているため、overflow/maxHeightのみ）
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
    // スナックバーを非表示にする
    hideSnackbar();
    state.undoState = null;

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
      // 選択問題用状態をリセット
      state.selectedChoices.clear();
      state.choiceAnswered = false;
      renderCard();
    }
  }

  function prev() {
    if (state.currentIndex > 0) {
      state.currentIndex--;
      state.isFlipped = false;
      // 選択問題用状態をリセット
      state.selectedChoices.clear();
      state.choiceAnswered = false;
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

  // お気に入りをトグル
  function toggleFavoriteCurrentCard() {
    const card = state.filteredCards[state.currentIndex];
    if (!card) return;

    const keyTopicId = card.topicId || state.currentTopicId;
    const topicData = DATA.find(d => d.id === keyTopicId);

    const content = {
      question: card.question,
      answer: card.answer,
      section: card.section || '',
      topicTitle: card.topicTitle || topicData?.title || keyTopicId,
      subject: topicData?.subject || ''
    };

    const isNowFavorite = FavoritesManager.toggle('qa', keyTopicId, card.originalIndex, content);

    // ボタンの状態を更新
    const btn = document.getElementById('flashcard-favorite-btn');
    if (btn) {
      btn.classList.toggle('active', isNowFavorite);
      const svg = btn.querySelector('svg');
      if (svg) {
        svg.setAttribute('fill', isNowFavorite ? 'currentColor' : 'none');
      }
    }

    showToast(isNowFavorite ? 'お気に入りに追加' : 'お気に入りから削除', 1000);
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

  // ステータス説明モーダルを表示
  function showStatusHelpModal() {
    const overlay = document.createElement('div');
    overlay.className = 'status-help-overlay';
    overlay.id = 'status-help-overlay';
    overlay.innerHTML = `
      <div class="status-help-modal">
        <div class="status-help-header">
          <h3>学習ステータスについて</h3>
          <button class="status-help-close" id="status-help-close">✕</button>
        </div>
        <div class="status-help-body">
          <div class="status-help-item">
            <div class="status-help-badge again">要復習</div>
            <div class="status-help-desc">
              「もう一度」を押したカード、または復習期限を過ぎたカード。
            </div>
          </div>
          <div class="status-help-item">
            <div class="status-help-badge learning">定着中</div>
            <div class="status-help-desc">
              「覚えた」を押したカード。まだ忘れやすい状態です。
            </div>
          </div>
          <div class="status-help-item">
            <div class="status-help-badge mastered">習得済</div>
            <div class="status-help-desc">
              「覚えた」を4回以上続けて押したカード。十分に定着しています。
            </div>
          </div>
          <div class="status-help-flow">
            <div class="status-help-flow-title">「覚えた」を押し続けると...</div>
            <div class="status-help-flow-steps">
              <span>1日後</span><span class="arrow">→</span>
              <span>3日後</span><span class="arrow">→</span>
              <span>7日後</span><span class="arrow">→</span>
              <span class="highlight">14日後で習得済に</span>
            </div>
            <div class="status-help-note">※「もう一度」を押すと最初からやり直し</div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // 閉じるボタン
    document.getElementById('status-help-close').addEventListener('click', () => {
      overlay.remove();
    });

    // 背景クリックで閉じる
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
      }
    });
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

      // 8秒後に自動非表示
      state.undoTimer = setTimeout(() => {
        hideSnackbar();
        state.undoState = null;
      }, 8000);
    }
  }

  function hideSnackbar() {
    const snackbar = document.getElementById('flashcard-snackbar');
    if (snackbar) {
      snackbar.classList.remove('show');
    }
  }

  // === 適応的間隔システム ===
  // 間隔スケジュール（日数）: 1, 3, 7, 14, 30, 60, 90...
  const INTERVAL_SCHEDULE = [1, 3, 7, 14, 30, 60, 90];
  const DAY_MS = 24 * 60 * 60 * 1000;

  function getNextInterval(currentInterval) {
    const idx = INTERVAL_SCHEDULE.indexOf(currentInterval);
    if (idx === -1) {
      // 現在の間隔がスケジュールにない場合、最も近い次の間隔を探す
      for (let i = 0; i < INTERVAL_SCHEDULE.length; i++) {
        if (INTERVAL_SCHEDULE[i] > currentInterval) {
          return INTERVAL_SCHEDULE[i];
        }
      }
      // 90日を超えている場合は1.5倍（最大180日）
      return Math.min(180, Math.round(currentInterval * 1.5));
    }
    if (idx < INTERVAL_SCHEDULE.length - 1) {
      return INTERVAL_SCHEDULE[idx + 1];
    }
    // 最大間隔に達している場合は1.5倍（最大180日）
    return Math.min(180, Math.round(currentInterval * 1.5));
  }

  // === 学習記録 ===
  function markMemorized() {
    const card = state.filteredCards[state.currentIndex];
    if (!card) return;

    // Undo用に状態を保存
    saveUndoState('memorized');

    const keyTopicId = card.topicId || state.currentTopicId;
    const key = `${keyTopicId}:${card.originalIndex}`;
    const now = Date.now();
    const prev = state.progress[key] || {};

    // 適応的間隔の計算
    const currentInterval = prev.interval || 0;
    const newInterval = currentInterval === 0 ? 1 : getNextInterval(currentInterval);
    const successCount = (prev.successCount || 0) + 1;

    state.progress[key] = {
      status: 'memorized',
      lastReview: now,
      nextReview: now + newInterval * DAY_MS,
      interval: newInterval,
      successCount: successCount
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
      // 一周終了時: againCardsがあれば次の周へ
      if (state.againMode === 'afterRound' && state.againCards.length > 0) {
        startNextRound();
      } else {
        renderCompletionScreen();
      }
    }
  }

  function markAgain() {
    const card = state.filteredCards[state.currentIndex];
    if (!card) return;

    // Undo用に状態を保存
    saveUndoState('again');

    const keyTopicId = card.topicId || state.currentTopicId;
    const key = `${keyTopicId}:${card.originalIndex}`;
    const now = Date.now();

    // 間隔をリセット（設定に応じて即時 or 1日後）
    const nextReviewDelay = state.againDelay === 'immediate' ? 0 : DAY_MS;
    state.progress[key] = {
      status: 'again',
      lastReview: now,
      nextReview: now + nextReviewDelay,
      interval: state.againDelay === 'immediate' ? 0 : 1,
      successCount: 0
    };
    saveProgress();

    // 再出題ロジック：モードに応じて分岐
    if (state.againMode === 'afterRound') {
      // 一周後モード: againCardsに貯める
      state.againCards.push({ ...card, _reinsertCount: 0 });
    } else {
      // すぐ再挿入モード: 最後に再度出題（最大2回まで）
      const reinsertCount = card._reinsertCount || 0;
      if (reinsertCount < 2) {
        const reinsertCard = { ...card, _reinsertCount: reinsertCount + 1 };
        state.filteredCards.push(reinsertCard);
      }
    }

    // 次のカードへ自動移動（飛びアニメーション付き）
    const isLastCard = state.currentIndex >= state.filteredCards.length - 1;

    if (!isLastCard) {
      flyCardOut('left', () => {
        next();
        bumpProgress();
        state.combo = Math.max(0, state.combo - 3);  // コンボ3減少
        updateComboDisplay();
        showSnackbar(state.againMode === 'afterRound' ? '一周後に再出題' : '最後に再出題');
      });
    } else {
      // 一周終了時
      if (state.againMode === 'afterRound' && state.againCards.length > 0) {
        // 次の周へ
        startNextRound();
      } else {
        renderCompletionScreen();
      }
    }
  }

  // 次の周を開始（一周後モード用）
  function startNextRound() {
    state.currentRound++;
    state.filteredCards = [...state.againCards];
    state.againCards = [];
    state.currentIndex = 0;
    state.isFlipped = false;

    // シャッフル
    if (state.shuffleEnabled) {
      shuffleArray(state.filteredCards);
    }

    showSnackbar(`${state.currentRound}周目開始（${state.filteredCards.length}枚）`);
    renderCard();
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

    // 今日の10問を完了としてマーク
    if (state.currentTopicId === '__daily_ten') {
      markDailyTenCompleted();
    }

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
          ${specialDeck ? `<button class="completion-btn primary" id="completion-continue-btn">もう${state.sessionSize >= 9999 ? '全問' : state.sessionSize + '枚'}やる</button>` : ''}
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

  // 文字列を正規化（マッチング用）
  function normalizeForMatch(str) {
    if (!str) return '';
    return str
      .toLowerCase()
      .replace(/[\s　・、。（）()「」『』【】\-_]/g, '') // 空白・記号を除去
      .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)) // 全角数字→半角
      .replace(/[Ａ-Ｚａ-ｚ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)); // 全角英字→半角
  }

  // セクション抽出関数（柔軟なマッチング）
  function extractSection(doc, sectionName) {
    if (!sectionName) return null;

    const normalizedSection = normalizeForMatch(sectionName);

    // キーワードを抽出（2文字以上の単語）
    const keywords = sectionName
      .split(/[\s　・、。（）()「」『』【】\-_]+/)
      .filter(k => k.length >= 2);

    // 見出し要素のスコアを計算する関数
    function calcScore(headingText) {
      const normalizedHeading = normalizeForMatch(headingText);

      // 完全一致（正規化後）
      if (normalizedHeading === normalizedSection) {
        return 100;
      }
      // 部分一致
      if (normalizedHeading.includes(normalizedSection) || normalizedSection.includes(normalizedHeading)) {
        return 80;
      }
      // キーワードマッチ
      const matchedKeywords = keywords.filter(k =>
        normalizedHeading.includes(normalizeForMatch(k))
      );
      if (matchedKeywords.length > 0) {
        return (matchedKeywords.length / keywords.length) * 60;
      }
      return 0;
    }

    // まずh3で検索
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

    // h3でマッチしない場合、h2でも検索
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

    // スコアが30以上ならマッチとみなす
    if (bestMatch && bestScore >= 30) {
      const content = [bestMatch.outerHTML];
      let sibling = bestMatch.nextElementSibling;
      const stopTags = matchLevel === 'h2' ? ['H2'] : ['H3', 'H2'];

      while (sibling && !stopTags.includes(sibling.tagName)) {
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

    return null; // 見つからない場合
  }

  // カード一覧用まとめ読み込み
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
    // 10→20→全問 のサイクル（全問はInfinityで表現）
    const sizes = [10, 20, Infinity];
    const currentIdx = sizes.findIndex(s =>
      s === Infinity ? state.sessionSize >= 9999 : s === state.sessionSize
    );
    const nextIdx = (currentIdx + 1) % sizes.length;
    const newSize = sizes[nextIdx];
    state.sessionSize = newSize === Infinity ? 9999 : newSize;
    localStorage.setItem('flashcard-session-size', state.sessionSize);

    // 現在のセッションに即時反映
    const currentTotal = state.filteredCards.length;
    const effectiveSize = newSize === Infinity ? state.cards.length : newSize;

    if (effectiveSize < currentTotal) {
      // 問数を減らす場合：現在位置以降を切り詰め
      const keepCount = Math.max(effectiveSize, state.currentIndex + 1);
      state.filteredCards = state.filteredCards.slice(0, keepCount);
    } else if (effectiveSize > currentTotal && state.cards.length > currentTotal) {
      // 問数を増やす場合：元のカードプールから追加
      const currentKeys = new Set(state.filteredCards.map(c =>
        `${c.topicId || state.currentTopicId}:${c.originalIndex}`
      ));
      const additionalCards = state.cards
        .filter(c => !currentKeys.has(`${c.topicId || state.currentTopicId}:${c.originalIndex}`))
        .slice(0, effectiveSize - currentTotal);
      state.filteredCards = [...state.filteredCards, ...additionalCards];
    }

    // 画面を再描画
    renderCard();
    const sizeLabel = newSize === Infinity ? '全問' : `${newSize}問`;
    showSnackbar(`${sizeLabel}に変更`);
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

  // ===========================================
  // デッキ編集機能
  // ===========================================

  // 編集中のデッキ/カード情報
  const editState = {
    deckId: null,
    cardKey: null,
    cardTopicId: null,
    cardIndex: null,
    selectedDecks: new Set(),
    isBuiltInDeck: false // 組み込みデッキ編集フラグ
  };

  // デッキ編集モーダルを開く
  function openDeckEditModal(topicId) {
    const topic = DATA.find(d => d.id === topicId);
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
      // カテゴリからプレフィックスを除去
      const category = (topic.subjectCategory || topic.category || '').replace(/^インポート\//, '');
      categoryInput.value = category;
      overlay.classList.add('show');
      nameInput.focus();
    }

    // イベントバインド
    bindDeckEditEvents();
  }

  // デッキ編集モーダルを閉じる
  function closeDeckEditModal() {
    const overlay = document.getElementById('deck-edit-overlay');
    if (overlay) overlay.classList.remove('show');
    editState.deckId = null;
  }

  // デッキ編集を保存
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

    // DATAを更新
    const topic = DATA.find(d => d.id === editState.deckId);
    if (topic) {
      topic.title = newName;
      topic.category = `インポート/${newCategory}`;
      topic.subjectCategory = newCategory;
    }

    // localStorageを更新
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

    // Firebase同期
    if (typeof FirebaseSync !== 'undefined' && FirebaseSync.isLoggedIn()) {
      FirebaseSync.sync().catch(e => console.error('同期エラー:', e));
    }

    closeDeckEditModal();
    renderDeckList();
    showToast('デッキを更新しました');
  }

  // デッキ編集イベントをバインド
  function bindDeckEditEvents() {
    const overlay = document.getElementById('deck-edit-overlay');
    const backdrop = overlay?.querySelector('.deck-edit-backdrop');
    const cancelBtn = document.getElementById('deck-edit-cancel');
    const saveBtn = document.getElementById('deck-edit-save');

    backdrop?.addEventListener('click', closeDeckEditModal);
    cancelBtn?.addEventListener('click', closeDeckEditModal);
    saveBtn?.addEventListener('click', saveDeckEdit);
  }

  // ===========================================
  // カード編集機能
  // ===========================================

  // カード編集モーダルを開く
  function openCardEditModal(topicId, cardIndex, card) {
    // インポート済みデッキのカードのみ編集可能
    const topic = DATA.find(d => d.id === topicId);
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

      // 選択肢がある場合
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

    // イベントバインド
    bindCardEditEvents();
  }

  // カード編集モーダルを閉じる
  function closeCardEditModal() {
    const overlay = document.getElementById('card-edit-overlay');
    if (overlay) overlay.classList.remove('show');
    editState.cardTopicId = null;
    editState.cardIndex = null;
    editState.isBuiltInDeck = false;
  }

  // カード編集を保存
  function saveCardEdit() {
    if (editState.cardTopicId === null || editState.cardIndex === null) return;

    const topic = DATA.find(d => d.id === editState.cardTopicId);
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

    // localJsonDataを更新
    let cardCount = 0;
    for (const section of topic.localJsonData.sections || []) {
      for (const qa of section.qa || []) {
        if (cardCount === editState.cardIndex) {
          qa.question = newQuestion;
          qa.answer = newAnswer;

          // 選択肢を更新
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

    // localStorageを更新
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

    // Firebase同期
    if (typeof FirebaseSync !== 'undefined' && FirebaseSync.isLoggedIn()) {
      FirebaseSync.sync().catch(e => console.error('同期エラー:', e));
    }

    // topicIdを保存してからモーダルを閉じる（closeCardEditModalでeditStateがクリアされるため）
    const topicId = editState.cardTopicId;
    closeCardEditModal();
    saveDeckCardListScrollPos(topicId);
    renderDeckCardList(topicId);
    showToast('カードを更新しました');
  }

  // カード編集イベントをバインド
  function bindCardEditEvents() {
    const overlay = document.getElementById('card-edit-overlay');
    const backdrop = overlay?.querySelector('.card-edit-backdrop');
    const cancelBtn = document.getElementById('card-edit-cancel');
    const saveBtn = document.getElementById('card-edit-save');

    backdrop?.addEventListener('click', closeCardEditModal);
    cancelBtn?.addEventListener('click', closeCardEditModal);
    saveBtn?.addEventListener('click', saveCardEdit);
  }

  // ===========================================
  // 組み込みデッキカード編集機能（差分保存）
  // ===========================================

  // 組み込みデッキ用の編集モーダルを開く
  function openBuiltInCardEditModal(topicId, originalIndex, card) {
    editState.cardTopicId = topicId;
    editState.cardIndex = originalIndex; // 元のインデックスを保存
    editState.isBuiltInDeck = true; // 組み込みデッキフラグ

    const overlay = document.getElementById('card-edit-overlay');
    const questionInput = document.getElementById('card-edit-question');
    const answerInput = document.getElementById('card-edit-answer');
    const choicesSection = document.getElementById('card-edit-choices-section');
    const choicesContainer = document.getElementById('card-edit-choices');

    if (overlay && questionInput && answerInput) {
      questionInput.value = card.question || '';
      answerInput.value = card.answer || '';

      // 組み込みデッキでは選択肢編集は非対応
      if (choicesSection) choicesSection.style.display = 'none';
      if (choicesContainer) choicesContainer.innerHTML = '';

      overlay.classList.add('show');
      questionInput.focus();
    }

    // イベントバインド（組み込みデッキ用）
    bindBuiltInCardEditEvents();
  }

  // 組み込みデッキ用の保存処理
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

    // カスタマイズを保存（差分として）
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

  // 組み込みデッキ用のイベントバインド
  function bindBuiltInCardEditEvents() {
    const overlay = document.getElementById('card-edit-overlay');
    const backdrop = overlay?.querySelector('.card-edit-backdrop');
    const cancelBtn = document.getElementById('card-edit-cancel');
    const saveBtn = document.getElementById('card-edit-save');

    // 既存のリスナーを削除してから追加
    const newSaveBtn = saveBtn.cloneNode(true);
    saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);

    backdrop?.addEventListener('click', closeCardEditModal);
    cancelBtn?.addEventListener('click', closeCardEditModal);
    newSaveBtn?.addEventListener('click', saveBuiltInCardEdit);
  }

  // ===========================================
  // 組み込みデッキカード削除機能（差分保存）
  // ===========================================

  // 組み込みデッキのカードを削除（差分として記録）
  function deleteBuiltInCard(topicId, originalIndex) {
    showConfirmDialog(
      'カードを削除',
      'このカードを削除しますか？「編集をリセット」で元に戻せます。',
      () => {
        // カスタマイズを保存（削除インデックスを追加）
        const customization = getTopicCustomization(topicId);
        if (!customization.deleted) customization.deleted = [];

        // 既に削除済みでなければ追加
        if (!customization.deleted.includes(originalIndex)) {
          customization.deleted.push(originalIndex);
          customization.deleted.sort((a, b) => a - b);
        }

        // 編集データがある場合は削除
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

  // ===========================================
  // カード削除機能（インポート済みデッキ用）
  // ===========================================

  // カードを削除
  function deleteCard(topicId, cardIndex) {
    const topic = DATA.find(d => d.id === topicId);
    if (!topic || topic.source !== 'local_imported') {
      showToast('このカードは削除できません');
      return;
    }

    showConfirmDialog(
      'カードを削除',
      'このカードを削除しますか？この操作は取り消せません。',
      () => {
        // localJsonDataから削除
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

        // 空のセクションを削除
        topic.localJsonData.sections = topic.localJsonData.sections.filter(s => s.qa && s.qa.length > 0);

        // カード数を更新
        let totalCards = 0;
        for (const section of topic.localJsonData.sections || []) {
          totalCards += (section.qa || []).length;
        }
        topic.cardCount = totalCards;

        // localStorageを更新
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

        // 進捗データから関連エントリを削除し、インデックスを再計算
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
            // インデックスを1つ減らす
            newProgress[`${topicId}:${idx - 1}`] = state.progress[key];
          }
          // idx === cardIndex は削除
        }

        // 古いキーを削除
        for (const key of keysToUpdate) {
          delete state.progress[key];
        }

        // 新しいキーを追加
        Object.assign(state.progress, newProgress);
        saveProgress();

        // Firebase同期
        if (typeof FirebaseSync !== 'undefined' && FirebaseSync.isLoggedIn()) {
          FirebaseSync.sync().catch(e => console.error('同期エラー:', e));
        }

        saveDeckCardListScrollPos(topicId);
        renderDeckCardList(topicId);
        showToast('カードを削除しました');
      },
      true // danger
    );
  }

  // ===========================================
  // デッキ管理機能（合体・一括削除）
  // ===========================================

  // デッキ管理モーダルを開く
  function openDeckManageModal() {
    const importedDecks = DATA.filter(d => d.source === 'local_imported');

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

  // デッキ管理モーダルを閉じる
  function closeDeckManageModal() {
    const overlay = document.getElementById('deck-manage-overlay');
    if (overlay) overlay.classList.remove('show');
    editState.selectedDecks.clear();
  }

  // デッキ管理のUIを更新
  function updateDeckManageUI() {
    const countEl = document.getElementById('deck-manage-count');
    const mergeBtn = document.getElementById('deck-manage-merge');
    const deleteBtn = document.getElementById('deck-manage-delete');

    const count = editState.selectedDecks.size;
    if (countEl) countEl.textContent = `${count}件選択`;
    if (mergeBtn) mergeBtn.disabled = count < 2;
    if (deleteBtn) deleteBtn.disabled = count === 0;

    // 選択状態を反映
    const items = document.querySelectorAll('.deck-manage-item');
    items.forEach(item => {
      const deckId = item.dataset.deckId;
      item.classList.toggle('selected', editState.selectedDecks.has(deckId));
    });
  }

  // デッキ管理イベントをバインド
  function bindDeckManageEvents() {
    const overlay = document.getElementById('deck-manage-overlay');
    const backdrop = overlay?.querySelector('.deck-manage-backdrop');
    const cancelBtn = document.getElementById('deck-manage-cancel');
    const mergeBtn = document.getElementById('deck-manage-merge');
    const deleteBtn = document.getElementById('deck-manage-delete');

    backdrop?.addEventListener('click', closeDeckManageModal);
    cancelBtn?.addEventListener('click', closeDeckManageModal);

    // 各デッキアイテムのクリック
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

    // 合体ボタン
    mergeBtn?.addEventListener('click', openMergeDialog);

    // 削除ボタン
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

  // ===========================================
  // デッキ合体機能
  // ===========================================

  // 合体ダイアログを開く
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

  // 合体ダイアログを閉じる
  function closeMergeDialog() {
    const dialog = document.getElementById('deck-merge-dialog');
    if (dialog) dialog.classList.remove('show');
  }

  // 合体を実行
  function executeMerge() {
    const nameInput = document.getElementById('deck-merge-name');
    const newName = nameInput?.value.trim();

    if (!newName) {
      showToast('新しいデッキ名を入力してください');
      return;
    }

    // 選択されたデッキの全カードを収集
    const allCards = [];
    for (const deckId of editState.selectedDecks) {
      const topic = DATA.find(d => d.id === deckId);
      if (topic && topic.localJsonData) {
        for (const section of topic.localJsonData.sections || []) {
          for (const qa of section.qa || []) {
            allCards.push({
              ...qa,
              section: section.section || topic.title
            });
          }
        }
      }
    }

    if (allCards.length === 0) {
      showToast('合体するカードがありません');
      return;
    }

    // 新しいデッキを作成
    const newDeckId = `local_${Date.now()}`;
    const newJsonData = {
      deckTitle: newName,
      sections: [{
        section: newName,
        qa: allCards
      }]
    };

    const newDeck = {
      id: newDeckId,
      title: newName,
      category: '統合',
      isLocal: true,
      jsonData: newJsonData,
      cardCount: allCards.length,
      importedAt: Date.now()
    };

    // localStorageに保存
    const IMPORTED_DECKS_KEY = 'studyViewer_importedDecks';
    try {
      const stored = localStorage.getItem(IMPORTED_DECKS_KEY);
      let importedDecks = stored ? JSON.parse(stored) : [];

      // 元のデッキを削除
      importedDecks = importedDecks.filter(d => !editState.selectedDecks.has(d.id));

      // 新しいデッキを追加
      importedDecks.push(newDeck);
      localStorage.setItem(IMPORTED_DECKS_KEY, JSON.stringify(importedDecks));
    } catch (e) {
      console.error('デッキ合体保存エラー:', e);
      showToast('合体に失敗しました');
      return;
    }

    // DATA配列を更新（元のデッキを削除）
    for (const deckId of editState.selectedDecks) {
      for (let i = DATA.length - 1; i >= 0; i--) {
        if (DATA[i].id === deckId) {
          DATA.splice(i, 1);
        }
      }
    }

    // 新しいデッキをDATAに追加
    addImportedDeckToData(newDeck);

    // Firebase同期
    if (typeof FirebaseSync !== 'undefined' && FirebaseSync.isLoggedIn()) {
      FirebaseSync.sync().catch(e => console.error('同期エラー:', e));
    }

    closeMergeDialog();
    closeDeckManageModal();
    renderDeckList();
    showToast(`${editState.selectedDecks.size}個のデッキを合体しました`);
  }

  // 合体ダイアログイベントをバインド
  function bindMergeDialogEvents() {
    const dialog = document.getElementById('deck-merge-dialog');
    const backdrop = dialog?.querySelector('.deck-merge-backdrop');
    const cancelBtn = document.getElementById('deck-merge-cancel');
    const confirmBtn = document.getElementById('deck-merge-confirm');

    backdrop?.addEventListener('click', closeMergeDialog);
    cancelBtn?.addEventListener('click', closeMergeDialog);
    confirmBtn?.addEventListener('click', executeMerge);
  }

  // ===========================================
  // 確認ダイアログ
  // ===========================================

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
    state.againCards = [];
    state.currentRound = 1;
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
