/**
 * Study Viewer メインアプリケーション
 */
(function() {
  // 状態管理
  const validTabs = ['flashcard', 'html', 'kakomon'];
  const savedTab = localStorage.getItem('studyViewer_lastTab');
  const state = {
    currentItem: null,
    currentTab: validTabs.includes(savedTab) ? savedTab : 'flashcard',
    searchQuery: '',
    highlightQuery: null,  // 検索結果からジャンプ時のハイライト用
    collapsedCategories: new Set(),
    searchOpen: false,
    qaShowAll: false,
    lastScrollY: 0,
    headerHidden: false,
    // 無限スクロール用（まとめ）
    loadedTopicIndex: -1,       // 下方向：読み込み済みの最後のトピックインデックス
    firstLoadedTopicIndex: -1,  // 上方向：読み込み済みの最初のトピックインデックス
    isLoadingMore: false,       // 追加読み込み中フラグ
    startTopicIndex: -1,        // 最初に選択されたトピックのインデックス
    // 無限スクロール用（Q&A）
    qaLoadedTopicIndex: -1,
    qaFirstLoadedTopicIndex: -1,
    isLoadingMoreQA: false,
    // 無限スクロール用（過去問）
    kakomonLoadedTopicIndex: -1,
    kakomonFirstLoadedTopicIndex: -1,
    isLoadingMoreKakomon: false,
    // ノートバッジ表示制御（最後に閲覧した時刻）
    lastNoteViewTime: parseInt(localStorage.getItem('studyViewer_lastNoteViewTime') || '0'),
    // フローティング検索（GoodNotes風・全トピック横断）
    floatingSearchQuery: '',                // 検索クエリ
    floatingSearchResults: [],              // マッチしたトピック [{topicId, title, matchCount, matchPositions}]
    floatingSearchTotalMatches: 0,          // 総マッチ数
    floatingSearchCurrentTopicIdx: -1,      // 現在のトピックインデックス
    floatingSearchCurrentMatchInTopic: -1,  // トピック内のマッチインデックス
    floatingSearchGlobalIndex: 0,           // グローバルインデックス（1-based表示用）
    floatingSearchLocalMatches: [],         // 現在のページ内のマッチspan要素
    floatingSearchLocalMatchIdx: -1,        // 現在のページ内セクションインデックス
    floatingSearchSections: [],             // セクション単位の結果
    floatingSearchCurrentSectionIdx: 0,     // 現在のグローバルセクションインデックス
    floatingSearchTotalSections: 0,         // 総セクション数
    pendingFloatingSearch: null             // トピック切り替え後に継続する検索 {query, matchIndex}
  };

  // DOM要素
  const elements = {
    header: document.querySelector('.header'),
    mainContent: document.querySelector('.main-content'),
    searchBtn: document.getElementById('search-btn'),
    searchOverlay: document.getElementById('search-overlay'),
    searchInput: document.getElementById('search-input'),
    closeSearch: document.getElementById('close-search'),
    searchResults: document.getElementById('search-results'),
    // 検索シート
    searchSheet: document.getElementById('search-sheet'),
    searchSheetInput: document.getElementById('search-sheet-input'),
    searchSheetClear: document.getElementById('search-sheet-clear'),
    searchSheetCancel: document.getElementById('search-sheet-cancel'),
    searchSheetInitial: document.getElementById('search-sheet-initial'),
    searchSheetResults: document.getElementById('search-sheet-results'),
    tabs: document.querySelectorAll('.floating-tab'),
    htmlContent: document.getElementById('html-content'),
    htmlDisplay: document.getElementById('html-display'),
    // QA関連（後方互換性のため残す - 要素がなければnull）
    qaContent: document.getElementById('qa-content'),
    qaDisplay: document.getElementById('qa-display'),
    qaToolbar: document.getElementById('qa-toolbar'),
    qaToggleBtn: document.getElementById('qa-toggle-btn'),
    qaFloatingToggle: document.getElementById('qa-floating-toggle'),
    welcomeScreen: document.getElementById('welcome-screen'),
    welcomeStartBtn: document.getElementById('welcome-start-btn'),
    welcomeCardMenu: document.getElementById('welcome-card-menu'),
    welcomeSearchInput: document.getElementById('welcome-search-input'),
    welcomeTopics: document.getElementById('welcome-topics'),
    // 過去問
    kakomonContent: document.getElementById('kakomon-content'),
    // フラッシュカード
    flashcardContent: document.getElementById('flashcard-content'),
    kakomonDisplay: document.getElementById('kakomon-display'),
    kakomonToolbar: document.getElementById('kakomon-toolbar'),
    kakomonPlaceholder: document.getElementById('kakomon-placeholder'),
    kakomonCurrent: document.getElementById('kakomon-current'),
    kakomonTotal: document.getElementById('kakomon-total'),
    kakomonReset: document.getElementById('kakomon-reset'),
    // 統合ツールシート
    toolFab: document.getElementById('tool-fab'),
    toolSheetOverlay: document.getElementById('tool-sheet-overlay'),
    toolToc: document.getElementById('tool-toc'),
    toolTocHint: document.getElementById('tool-toc-hint'),
    toolPageSearch: document.getElementById('tool-page-search'),
    toolReading: document.getElementById('tool-reading'),
    toolPrevHeading: document.getElementById('tool-prev-heading'),
    toolHome: document.getElementById('tool-home'),
    // ノート（お気に入り）- 後方互換性のため残す
    noteOverlay: document.getElementById('note-overlay'),
    closeNote: document.getElementById('close-note'),
    noteTimeline: document.getElementById('note-timeline'),
    noteCount: document.getElementById('note-count'),
    noteEmpty: document.getElementById('note-empty'),
    noteBadge: document.getElementById('note-badge'),
    // 画像ライトボックス
    imageLightbox: document.getElementById('image-lightbox'),
    lightboxImage: document.getElementById('lightbox-image'),
    lightboxClose: document.getElementById('lightbox-close'),
    // 目次
    tocOverlay: document.getElementById('toc-overlay'),
    tocSheet: document.getElementById('toc-sheet'),
    tocHandle: document.getElementById('toc-handle'),
    tocNowText: document.getElementById('toc-now-text'),
    tocList: document.getElementById('toc-list'),
    tocCloseBtn: document.getElementById('toc-close-btn'),
    tocBackBtn: document.getElementById('toc-back-btn'),
    tocSearchInput: document.getElementById('toc-search-input'),
    prevHeadingBtn: document.getElementById('prev-heading-btn'),
    tocPrevTopic: document.getElementById('toc-prev-topic'),
    tocNextTopic: document.getElementById('toc-next-topic'),
    // 読書モード
    readingModeOverlay: document.getElementById('reading-mode-overlay'),
    readingModeClose: document.getElementById('reading-mode-close'),
    fontDecrease: document.getElementById('font-decrease'),
    fontIncrease: document.getElementById('font-increase'),
    fontSizeDisplay: document.getElementById('font-size-display'),
    // フローティング検索バー（GoodNotes風）
    floatingSearchBar: document.getElementById('floating-search-bar'),
    floatingSearchInput: document.getElementById('floating-search-input'),
    floatingSearchClear: document.getElementById('floating-search-clear'),
    floatingSearchCount: document.getElementById('floating-search-count'),
    floatingSearchPrev: document.getElementById('floating-search-prev'),
    floatingSearchNext: document.getElementById('floating-search-next'),
    floatingSearchClose: document.getElementById('floating-search-close')
  };

  // 目次の状態管理
  const tocState = {
    headings: [],           // 見出し要素の配列
    currentHeadingIndex: 0, // 現在の見出しインデックス
    previousScrollY: null,  // ジャンプ前のスクロール位置
    observer: null,         // IntersectionObserver
    mode: 'medium',         // 'medium' or 'full'
    hasH2: false,           // h2がある場合true（階層表示用）
    targetTopicId: null     // 前後トピックナビ用：現在のターゲットトピックID
  };

  // 読書モードの状態管理
  const FONT_SIZES = ['small', 'medium', 'large', 'xlarge'];
  const FONT_LABELS = { small: '小', medium: '標準', large: '大', xlarge: '特大' };
  const readingState = {
    fontSize: localStorage.getItem('reading-font-size') || 'medium',
    lineHeight: localStorage.getItem('reading-line-height') || 'normal',
    density: localStorage.getItem('reading-density') || 'normal'
  };

  // 検索エンジン
  let searchEngine;

  /**
   * 初期化
   */
  function init() {
    if (typeof DATA === 'undefined') {
      console.error('データを読み込めませんでした');
      return;
    }

    searchEngine = new SearchEngine(DATA);

    // 全てデフォルトで折りたたみ
    const categories = new Set(DATA.map(item => item.subjectCategory || 'その他'));
    categories.forEach(cat => state.collapsedCategories.add(`cat_${cat}`));
    const subjects = new Set(DATA.map(item => item.subject || 'その他'));
    subjects.forEach(subj => state.collapsedCategories.add(`subj_${subj}`));
    // チャプターも折りたたみ
    DATA.forEach(item => {
      const subject = item.subject || 'その他';
      const chapter = extractChapter(item);
      if (chapter) {
        state.collapsedCategories.add(`chap_${subject}_${chapter}`);
      }
    });

    bindEvents();
    restoreState();
    setupKeyboardHandler();

    // ツールシートのイベントをバインド
    bindToolSheetEvents();

    // 読書モードのイベントをバインド（一度だけ）
    bindReadingModeEvents();

    // ↑ボタンの条件付き表示
    setupPrevHeadingButtonScroll();

    // フローティング検索バー（GoodNotes風）のイベント設定
    setupFloatingSearchEvents();

    // フラッシュカード機能の初期化
    if (typeof FlashcardModule !== 'undefined') {
      FlashcardModule.init();
    }

    // テーマ切り替え機能の初期化
    initThemeToggle();

    // 初期タブの設定（前回のタブを復元）
    const initialTab = state.currentTab;
    switchTab(initialTab);

    // スクロール履歴管理の初期化
    initScrollHistory();

    // ウェルカム画面のトピック検索を初期化
    initWelcomeSearch();
  }

  /**
   * ウェルカム画面のトピック検索を初期化
   */
  function initWelcomeSearch() {
    if (!elements.welcomeTopics || !elements.welcomeSearchInput) return;

    const historySection = document.getElementById('welcome-history-section');
    const recommendSection = document.getElementById('welcome-recommend-section');
    const historyList = document.getElementById('welcome-history-list');
    const clearHistoryBtn = document.getElementById('clear-history-btn');

    // 検索履歴を表示
    renderSearchHistory();

    // 初期表示：履歴を表示、トピック一覧は非表示
    elements.welcomeTopics.style.display = 'none';

    // 検索入力イベント
    elements.welcomeSearchInput.addEventListener('input', (e) => {
      const query = e.target.value.trim();
      if (query) {
        // 検索中は履歴・おすすめを隠してトピック一覧を表示
        if (historySection) historySection.style.display = 'none';
        if (recommendSection) recommendSection.style.display = 'none';
        elements.welcomeTopics.style.display = '';
        renderWelcomeTopics(query);
      } else {
        // 空の場合は履歴・おすすめを表示、トピック一覧は非表示
        if (historySection) historySection.style.display = '';
        if (recommendSection) recommendSection.style.display = '';
        elements.welcomeTopics.style.display = 'none';
        renderSearchHistory();
      }
    });

    // トピッククリックイベント
    elements.welcomeTopics.addEventListener('click', (e) => {
      const item = e.target.closest('.welcome-topic-item');
      if (!item) return;

      const topicId = item.dataset.topicId;
      if (topicId) {
        // 検索キーワードを履歴に保存
        const searchQuery = elements.welcomeSearchInput ? elements.welcomeSearchInput.value.trim() : '';
        if (searchQuery) {
          addSearchHistory(searchQuery);
        }
        state.highlightQuery = searchQuery || null;
        selectItem(topicId);
      }
    });

    // 履歴アイテムクリック
    if (historyList) {
      historyList.addEventListener('click', (e) => {
        // 削除ボタンのクリック
        const deleteBtn = e.target.closest('.history-delete');
        if (deleteBtn) {
          const query = deleteBtn.dataset.query;
          removeSearchHistory(query);
          renderSearchHistory();
          return;
        }
        // 履歴アイテムのクリック
        const historyItem = e.target.closest('.history-item');
        if (historyItem) {
          const query = historyItem.dataset.query;
          if (query && elements.welcomeSearchInput) {
            elements.welcomeSearchInput.value = query;
            elements.welcomeSearchInput.dispatchEvent(new Event('input'));
          }
        }
      });
    }

    // 履歴を消去ボタン
    if (clearHistoryBtn) {
      clearHistoryBtn.addEventListener('click', () => {
        clearSearchHistory();
        renderSearchHistory();
      });
    }

    // おすすめキーワードを表示
    renderRecommendedKeywords();

    // おすすめキーワードクリック
    const keywordChips = document.getElementById('welcome-keyword-chips');
    if (keywordChips) {
      keywordChips.addEventListener('click', (e) => {
        const chip = e.target.closest('.keyword-chip');
        if (chip && elements.welcomeSearchInput) {
          const keyword = chip.dataset.keyword;
          elements.welcomeSearchInput.value = keyword;
          elements.welcomeSearchInput.dispatchEvent(new Event('input'));
        }
      });
    }
  }

  /**
   * おすすめキーワードをランダムに表示
   */
  function renderRecommendedKeywords() {
    const container = document.getElementById('welcome-keyword-chips');
    const section = document.getElementById('welcome-recommend-section');
    if (!container) return;

    // トピックタイトルからキーワードを抽出
    const topics = DATA.filter(d => d.htmlPath && d.title);
    if (topics.length === 0) {
      if (section) section.style.display = 'none';
      return;
    }

    // タイトルからキーワードを抽出（短いものを優先）
    const keywords = [];
    topics.forEach(topic => {
      const title = topic.title || '';
      // タイトルをそのまま使う（短いもの優先）
      if (title.length <= 12) {
        keywords.push(title);
      } else {
        // 長いタイトルは「_」や「・」で分割して短い部分を使う
        const parts = title.split(/[_・（）\(\)]/);
        parts.forEach(part => {
          const trimmed = part.trim();
          if (trimmed.length >= 2 && trimmed.length <= 10) {
            keywords.push(trimmed);
          }
        });
      }
    });

    // 重複を除去してシャッフル
    const uniqueKeywords = [...new Set(keywords)];
    const shuffled = uniqueKeywords.sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, 8);

    container.innerHTML = selected.map(keyword => `
      <span class="keyword-chip" data-keyword="${escapeHtml(keyword)}">${escapeHtml(keyword)}</span>
    `).join('');
  }

  /**
   * 検索履歴を取得
   */
  function getSearchHistory() {
    try {
      const history = localStorage.getItem('studyViewer_searchHistory');
      return history ? JSON.parse(history) : [];
    } catch {
      return [];
    }
  }

  /**
   * 検索履歴に追加
   */
  function addSearchHistory(query) {
    if (!query) return;
    let history = getSearchHistory();
    // 重複を削除
    history = history.filter(h => h !== query);
    // 先頭に追加
    history.unshift(query);
    // 最大10件
    if (history.length > 10) history = history.slice(0, 10);
    localStorage.setItem('studyViewer_searchHistory', JSON.stringify(history));
  }

  /**
   * 検索履歴から削除
   */
  function removeSearchHistory(query) {
    let history = getSearchHistory();
    history = history.filter(h => h !== query);
    localStorage.setItem('studyViewer_searchHistory', JSON.stringify(history));
  }

  /**
   * 検索履歴をクリア
   */
  function clearSearchHistory() {
    localStorage.removeItem('studyViewer_searchHistory');
  }

  /**
   * 検索履歴を描画
   */
  function renderSearchHistory() {
    const historyList = document.getElementById('welcome-history-list');
    const historySection = document.getElementById('welcome-history-section');
    if (!historyList) return;

    const history = getSearchHistory();

    if (history.length === 0) {
      // 履歴なし
      if (historySection) historySection.style.display = 'none';
      return;
    }

    if (historySection) historySection.style.display = '';

    historyList.innerHTML = history.map(query => `
      <div class="history-item" data-query="${escapeHtml(query)}">
        <svg class="history-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <path d="M12 6v6l4 2"/>
        </svg>
        <span class="history-text">${escapeHtml(query)}</span>
        <button class="history-delete" data-query="${escapeHtml(query)}" aria-label="削除">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>
    `).join('');
  }

  /**
   * ウェルカム画面のトピック一覧をレンダリング
   */
  function renderWelcomeTopics(filter) {
    if (!elements.welcomeTopics) return;

    const filterLower = filter.toLowerCase().trim();

    // フィルタリング
    let topics = DATA.filter(d => d.htmlPath);
    if (filterLower) {
      topics = topics.filter(d => {
        const title = (d.title || d.id || '').toLowerCase();
        const subject = (d.subject || '').toLowerCase();
        const searchText = (d.searchText || '').toLowerCase();
        return title.includes(filterLower) || subject.includes(filterLower) || searchText.includes(filterLower);
      });
    }

    // 最大50件に制限
    const limitedTopics = topics.slice(0, 50);

    if (limitedTopics.length === 0) {
      elements.welcomeTopics.innerHTML = `<div class="welcome-no-results">「${escapeHtml(filter)}」に一致するトピックがありません</div>`;
      return;
    }

    // HTML生成
    const html = limitedTopics.map(topic => {
      const title = topic.title || topic.id;
      const displayTitle = filterLower ? highlightWelcomeSearch(title, filter) : escapeHtml(title);
      const subject = topic.subject || '';

      // タイトルにマッチしない場合、本文からスニペットを取得
      let snippet = '';
      if (filterLower) {
        const titleLower = title.toLowerCase();
        const subjectLower = subject.toLowerCase();
        if (!titleLower.includes(filterLower) && !subjectLower.includes(filterLower)) {
          snippet = getSearchSnippet(topic.searchText || '', filter);
        }
      }

      return `
        <div class="welcome-topic-item" data-topic-id="${escapeHtml(topic.id)}">
          <span class="welcome-topic-subject">${escapeHtml(subject)}</span>
          <div class="welcome-topic-content">
            <span class="welcome-topic-title">${displayTitle}</span>
            ${snippet ? `<span class="welcome-topic-snippet">${snippet}</span>` : ''}
          </div>
          <span class="welcome-topic-arrow">›</span>
        </div>
      `;
    }).join('');

    elements.welcomeTopics.innerHTML = html;
  }

  /**
   * ウェルカム検索のハイライト
   */
  function highlightWelcomeSearch(text, query) {
    if (!query) return escapeHtml(text);
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escaped})`, 'gi');
    return escapeHtml(text).replace(regex, '<mark>$1</mark>');
  }

  /**
   * 検索スニペットを取得（マッチ箇所の前後を抽出）
   */
  function getSearchSnippet(text, query) {
    if (!text || !query) return '';
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const index = lowerText.indexOf(lowerQuery);
    if (index === -1) return '';

    // マッチ箇所の前後30文字を抽出
    const start = Math.max(0, index - 20);
    const end = Math.min(text.length, index + query.length + 30);
    let snippet = text.substring(start, end);

    // 前後に「...」を追加
    if (start > 0) snippet = '...' + snippet;
    if (end < text.length) snippet = snippet + '...';

    // マッチ箇所をハイライト
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escaped})`, 'gi');
    return escapeHtml(snippet).replace(regex, '<mark>$1</mark>');
  }

  /**
   * テーマ切り替え
   */
  function initThemeToggle() {
    const themeToggleSheet = document.getElementById('theme-toggle-sheet');

    // 保存されたテーマを適用
    const savedTheme = localStorage.getItem('studyViewer_theme');
    if (savedTheme) {
      document.documentElement.setAttribute('data-theme', savedTheme);
    }

    // テーマラベルを更新
    updateThemeLabel();

    // アカウントシート内のテーマトグル
    if (themeToggleSheet) {
      themeToggleSheet.addEventListener('click', toggleTheme);
    }
  }

  function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    let newTheme;
    if (currentTheme === 'dark') {
      newTheme = 'light';
    } else if (currentTheme === 'light') {
      newTheme = 'dark';
    } else {
      // 未設定の場合、システム設定と逆にする
      newTheme = systemDark ? 'light' : 'dark';
    }

    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('studyViewer_theme', newTheme);
    updateThemeLabel();
  }

  function updateThemeLabel() {
    const label = document.querySelector('.theme-toggle-label');
    if (!label) return;

    const currentTheme = document.documentElement.getAttribute('data-theme');
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    let isDark;
    if (currentTheme === 'dark') {
      isDark = true;
    } else if (currentTheme === 'light') {
      isDark = false;
    } else {
      isDark = systemDark;
    }

    label.textContent = isDark ? 'ダーク' : 'ライト';
  }

  /**
   * キーボード表示時の処理（iOS対応）
   */
  function setupKeyboardHandler() {
    // 現在は特別な処理なし（将来の拡張用）
  }

  /**
   * イベントバインド
   */
  function bindEvents() {
    // 検索ボタン（ヘッダー）→ 検索シートを開く
    if (elements.searchBtn) {
      elements.searchBtn.addEventListener('click', openSearchSheet);
    }

    // 検索シートのイベント
    if (elements.searchSheet) {
      setupSearchSheet();
    }

    // 検索オーバーレイを閉じる
    elements.closeSearch.addEventListener('click', closeSearch);
    elements.searchOverlay.addEventListener('click', (e) => {
      if (e.target === elements.searchOverlay) {
        closeSearch();
      }
    });

    // 検索入力
    let debounceTimer;
    elements.searchInput.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        handleSearch(e.target.value);
      }, 150);
    });

    // タブ切り替え
    elements.tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const targetTab = tab.dataset.tab;
        // まとめタブを再度押したらウェルカム画面に戻る
        if (targetTab === 'html' && state.currentTab === 'html') {
          showWelcomeScreen();
          return;
        }
        switchTab(targetTab);
      });
    });

    // Q&Aモード切り替え（ボタンがある場合のみ）
    const qaModeToggle = document.getElementById('qa-mode-toggle');
    if (qaModeToggle) {
      qaModeToggle.addEventListener('click', toggleQAMode);
    }

    // Q&Aトグルボタン
    if (elements.qaToggleBtn) {
      elements.qaToggleBtn.addEventListener('click', function(e) {
        e.preventDefault();
        toggleQAMode();
      });
    }

    // Q&Aフローティングトグルボタン
    if (elements.qaFloatingToggle) {
      elements.qaFloatingToggle.addEventListener('click', function(e) {
        e.preventDefault();
        toggleQAMode();
      });
    }

    // キーボードショートカット
    document.addEventListener('keydown', (e) => {
      // Ctrl+K or Cmd+K で検索シートを開く
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        openSearchSheet();
      }
    });

    // スクロールでヘッダー表示/非表示（無効化：固定表示に変更）
    // setupScrollHideHeader();

    // Q&Aフローティングトグルボタンのスクロール表示/非表示
    setupQAFloatingToggleScroll();

    // ウェルカム画面のボタン → 検索シートを開く
    if (elements.welcomeStartBtn) {
      elements.welcomeStartBtn.addEventListener('click', openSearchSheet);
    }
    if (elements.welcomeCardMenu) {
      elements.welcomeCardMenu.addEventListener('click', openSearchSheet);
    }

    // 画像ライトボックス：背景クリックで閉じる
    if (elements.imageLightbox) {
      elements.imageLightbox.addEventListener('click', function(e) {
        if (e.target === elements.imageLightbox) {
          closeImageLightbox();
        }
      });
    }
    // ライトボックス：✕ボタンで閉じる
    if (elements.lightboxClose) {
      elements.lightboxClose.addEventListener('click', function(e) {
        e.stopPropagation();
        closeImageLightbox();
      });
    }
  }

  /**
   * スクロール方向に応じてヘッダーを隠す/表示する
   */
  function setupScrollHideHeader() {
    const threshold = 10;

    // 各タブのコンテンツにスクロールリスナーを設定
    [elements.htmlContent, elements.qaContent, elements.kakomonContent].forEach(container => {
      if (!container) return;

      let lastScrollTop = 0;

      container.addEventListener('scroll', function() {
        const scrollTop = container.scrollTop;
        const diff = scrollTop - lastScrollTop;

        // 下にスクロール → ヘッダーを隠す（60px以上スクロールした場合のみ）
        if (diff > threshold && scrollTop > 60) {
          elements.header.classList.add('hidden');
          elements.mainContent.classList.add('header-hidden');
          document.documentElement.style.setProperty('--header-offset', '0px');
        }
        // 上にスクロール → ヘッダーを表示
        else if (diff < -threshold) {
          elements.header.classList.remove('hidden');
          elements.mainContent.classList.remove('header-hidden');
          document.documentElement.style.setProperty('--header-offset', '0px');
        }

        lastScrollTop = scrollTop;
      }, { passive: true });
    });
  }

  /**
   * Q&Aフローティングトグルボタンをスクロール方向に応じて表示/非表示
   */
  function setupQAFloatingToggleScroll() {
    let lastScrollTop = 0;
    const threshold = 10; // スクロール検知の閾値

    elements.qaContent.addEventListener('scroll', function() {
      if (!elements.qaFloatingToggle) return;
      if (state.currentTab !== 'qa') return;

      const scrollTop = elements.qaContent.scrollTop;
      const diff = scrollTop - lastScrollTop;

      // 下にスクロール（コンテンツを読み進める）→ ボタンを隠す
      if (diff > threshold) {
        elements.qaFloatingToggle.classList.remove('show');
      }
      // 上にスクロール（戻る）→ ボタンを表示
      else if (diff < -threshold) {
        elements.qaFloatingToggle.classList.add('show');
      }

      lastScrollTop = scrollTop;
    }, { passive: true });
  }

  /**
   * ホーム画面に戻る
   */
  function goHome() {
    // 現在のアイテムをクリア
    state.currentItem = null;

    // まとめ表示を非表示
    elements.htmlDisplay.innerHTML = '';
    elements.htmlDisplay.style.display = 'none';
    state.loadedTopicIndex = -1;
    state.firstLoadedTopicIndex = -1;
    state.startTopicIndex = -1;

    // Q&A を非表示
    elements.qaDisplay.innerHTML = '';
    elements.qaDisplay.style.display = 'none';
    elements.qaContent.querySelector('.placeholder').style.display = 'flex';
    if (elements.qaToolbar) {
      elements.qaToolbar.style.display = 'none';
    }

    // 過去問を非表示
    if (elements.kakomonDisplay) {
      elements.kakomonDisplay.innerHTML = '';
      elements.kakomonDisplay.style.display = 'none';
    }
    if (elements.kakomonPlaceholder) {
      elements.kakomonPlaceholder.style.display = 'flex';
    }
    if (elements.kakomonToolbar) {
      elements.kakomonToolbar.style.display = 'none';
    }

    // ウェルカム画面を表示
    if (elements.welcomeScreen) {
      elements.welcomeScreen.classList.remove('hidden');
    }

    // HTMLタブに切り替え
    switchTab('html');
  }

  /**
   * 検索を開く（旧：サイドバー検索用）
   */
  function openSearch() {
    state.searchOpen = true;
    elements.searchOverlay.classList.add('show');
    elements.searchInput.value = '';
    elements.searchInput.focus();
    elements.searchResults.innerHTML = '<div class="search-hint">キーワードを入力して検索</div>';
  }

  /**
   * 検索を閉じる（旧：サイドバー検索用）
   */
  function closeSearch() {
    state.searchOpen = false;
    elements.searchOverlay.classList.remove('show');
    elements.searchInput.value = '';
  }

  /**
   * 検索シートのセットアップ
   */
  function setupSearchSheet() {
    const backdrop = elements.searchSheet.querySelector('.search-sheet-backdrop');

    // 背景タップで閉じる
    backdrop.addEventListener('click', closeSearchSheet);

    // キャンセルボタン
    elements.searchSheetCancel.addEventListener('click', closeSearchSheet);

    // クリアボタン
    elements.searchSheetClear.addEventListener('click', () => {
      elements.searchSheetInput.value = '';
      elements.searchSheetClear.style.display = 'none';
      renderSearchSheetInitial();
      elements.searchSheetInput.focus();
    });

    // 入力イベント
    let debounceTimer;
    elements.searchSheetInput.addEventListener('input', (e) => {
      const query = e.target.value;
      elements.searchSheetClear.style.display = query ? 'flex' : 'none';

      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        handleSearchSheet(query);
      }, 150);
    });

    // Escapeで閉じる
    elements.searchSheetInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeSearchSheet();
      }
    });

    // 初期表示を準備
    renderSearchSheetInitial();
  }

  /**
   * 検索シートを開く
   */
  function openSearchSheet() {
    elements.searchSheet.classList.add('open');
    document.body.style.overflow = 'hidden';

    // 少し遅延してフォーカス（アニメーション後）
    setTimeout(() => {
      elements.searchSheetInput.focus();
    }, 100);

    renderSearchSheetInitial();
  }

  /**
   * 検索シートを閉じる
   */
  function closeSearchSheet() {
    elements.searchSheet.classList.remove('open');
    document.body.style.overflow = '';
    elements.searchSheetInput.value = '';
    elements.searchSheetClear.style.display = 'none';
  }

  /**
   * 検索シートの初期表示（候補チップ）
   */
  function renderSearchSheetInitial() {
    elements.searchSheetInitial.style.display = 'block';
    elements.searchSheetResults.style.display = 'none';

    // 最近の検索履歴
    const recentSearches = JSON.parse(localStorage.getItem('studyViewer_recentSearches') || '[]');

    // 候補キーワード（科目名から）
    const subjects = [...new Set(DATA.map(d => d.subject).filter(Boolean))].slice(0, 6);

    let html = '';

    if (recentSearches.length > 0) {
      html += `
        <div class="search-section-title">最近</div>
        <div class="search-chips">
          ${recentSearches.slice(0, 5).map(q => `<button class="search-chip" data-query="${escapeHtml(q)}">${escapeHtml(q)}</button>`).join('')}
        </div>
      `;
    }

    html += `
      <div class="search-section-title">科目</div>
      <div class="search-chips">
        ${subjects.map(s => `<button class="search-chip" data-query="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join('')}
      </div>
    `;

    elements.searchSheetInitial.innerHTML = html;

    // チップのクリックイベント
    elements.searchSheetInitial.querySelectorAll('.search-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const query = chip.dataset.query;
        elements.searchSheetInput.value = query;
        elements.searchSheetClear.style.display = 'flex';
        handleSearchSheet(query);
      });
    });
  }

  /**
   * 検索シートの検索処理（まとめ + フラッシュカード両対応）
   */
  function handleSearchSheet(query) {
    if (!query || query.trim() === '') {
      renderSearchSheetInitial();
      return;
    }

    elements.searchSheetInitial.style.display = 'none';
    elements.searchSheetResults.style.display = 'block';

    // 検索履歴に追加
    saveRecentSearch(query);

    // 検索実行
    const results = searchEngine.search(query);

    if (results.length === 0) {
      elements.searchSheetResults.innerHTML = `
        <div class="search-no-results">
          <div class="search-no-results-icon">🔍</div>
          <p>「${escapeHtml(query)}」に一致するトピックはありません</p>
        </div>
      `;
      return;
    }

    // まとめ（HTMLあり）とフラッシュカード（QAあり）を分けて表示
    const htmlResults = results.filter(item => item.htmlPath).slice(0, 15);
    const qaResults = results.filter(item => item.qaPath).slice(0, 10);

    let html = '';

    // まとめセクション
    if (htmlResults.length > 0) {
      html += `<div class="search-section-title">まとめ</div>`;
      html += htmlResults.map(item => {
        const subject = item.subject || 'その他';
        const title = item.title.replace(/^[ア-ン]_/, '');
        return `
          <div class="search-result-item" data-id="${item.id}" data-type="html">
            <div class="search-result-info">
              <div class="search-result-title">${escapeHtml(title)}</div>
              <div class="search-result-meta">${escapeHtml(subject)}</div>
            </div>
            <span class="search-result-badge badge-html">読む</span>
          </div>
        `;
      }).join('');
    }

    // フラッシュカードセクション
    if (qaResults.length > 0) {
      html += `<div class="search-section-title">フラッシュカード</div>`;
      html += qaResults.map(item => {
        const subject = item.subject || 'その他';
        const title = item.title.replace(/^[ア-ン]_/, '');
        return `
          <div class="search-result-item" data-id="${item.id}" data-type="flashcard">
            <div class="search-result-info">
              <div class="search-result-title">${escapeHtml(title)}</div>
              <div class="search-result-meta">${escapeHtml(subject)}</div>
            </div>
            <span class="search-result-badge badge-flashcard">演習</span>
          </div>
        `;
      }).join('');
    }

    elements.searchSheetResults.innerHTML = html;

    // 結果クリックでジャンプ
    elements.searchSheetResults.querySelectorAll('.search-result-item').forEach(item => {
      item.addEventListener('click', async () => {
        const id = item.dataset.id;
        const type = item.dataset.type;
        closeSearchSheet();

        if (type === 'html') {
          // まとめタブに切り替えてトピックを読み込み（スクロールはloadAndScrollToTopicで行うのでスキップ）
          switchTab('html', false, true);
          await loadAndScrollToTopic(id);
        } else {
          // フラッシュカードタブに切り替えてデッキを開始
          switchTab('flashcard');
          if (typeof FlashcardModule !== 'undefined' && FlashcardModule.startDeck) {
            FlashcardModule.startDeck(id);
          }
        }
      });
    });
  }

  /**
   * トピックを読み込んでスクロール
   */
  async function loadAndScrollToTopic(topicId) {
    // scrollToHTMLTopic が読み込み＋スクロールを行う
    await scrollToHTMLTopic(topicId);
  }

  /**
   * トピックセクションへスクロール
   */
  function scrollToTopicSection(section) {
    if (!section || !elements.htmlContent) return;

    const headerHeight = 56 + 16;
    const containerRect = elements.htmlContent.getBoundingClientRect();
    const sectionRect = section.getBoundingClientRect();
    const targetY = elements.htmlContent.scrollTop + sectionRect.top - containerRect.top - headerHeight;

    elements.htmlContent.scrollTo({
      top: targetY,
      behavior: 'smooth'
    });

    // ハイライトアニメーション
    section.classList.add('topic-highlight');
    setTimeout(() => section.classList.remove('topic-highlight'), 1500);
  }

  /**
   * 最近の検索を保存
   */
  function saveRecentSearch(query) {
    const key = 'studyViewer_recentSearches';
    let recent = JSON.parse(localStorage.getItem(key) || '[]');
    // 重複を除去して先頭に追加
    recent = recent.filter(q => q !== query);
    recent.unshift(query);
    // 最大10件
    recent = recent.slice(0, 10);
    localStorage.setItem(key, JSON.stringify(recent));
  }

  /**
   * 検索処理
   */
  function handleSearch(query) {
    state.searchQuery = query;

    // 未入力時はヒントを表示
    if (!query || query.trim() === '') {
      elements.searchResults.innerHTML = '<div class="search-hint">キーワードを入力して検索</div>';
      return;
    }

    const results = searchEngine.search(query);
    // まとめ（htmlPath）があるもののみ表示（Q&Aや過去問は除外）
    const filteredResults = results.filter(item => item.htmlPath);
    renderSearchResults(filteredResults.slice(0, 30));
  }

  /**
   * 検索テキストからスニペット（ヒット箇所のプレビュー）を取得
   */
  function getSearchSnippet(searchText, query) {
    if (!searchText || !query) return '';

    const terms = query.toLowerCase().trim().split(/\s+/).filter(t => t.length >= 2);
    if (terms.length === 0) return '';

    const lowerText = searchText.toLowerCase();

    // 最初にヒットするタームを探す
    let bestIndex = -1;
    let bestTerm = '';
    for (const term of terms) {
      const idx = lowerText.indexOf(term);
      if (idx !== -1 && (bestIndex === -1 || idx < bestIndex)) {
        bestIndex = idx;
        bestTerm = term;
      }
    }

    if (bestIndex === -1) return '';

    // 前後の文字を取得（約25文字ずつ）
    const contextBefore = 25;
    const contextAfter = 25;

    const start = Math.max(0, bestIndex - contextBefore);
    const end = Math.min(searchText.length, bestIndex + bestTerm.length + contextAfter);

    let snippet = searchText.substring(start, end);

    // 先頭・末尾を調整
    if (start > 0) snippet = '...' + snippet;
    if (end < searchText.length) snippet = snippet + '...';

    // 検索ワードをハイライト
    const regex = new RegExp(`(${escapeRegexForSnippet(bestTerm)})`, 'gi');
    snippet = escapeHtml(snippet).replace(regex, '<mark>$1</mark>');

    return snippet;
  }

  /**
   * 正規表現用エスケープ（スニペット用）
   */
  function escapeRegexForSnippet(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * 検索結果を描画
   */
  function renderSearchResults(items) {
    if (items.length === 0) {
      elements.searchResults.innerHTML = '<div class="search-empty">検索結果がありません</div>';
      return;
    }

    let html = '';
    items.forEach(item => {
      // スニペットを取得（タイトルにヒットしていない場合のみ表示）
      const titleLower = (item.title || '').toLowerCase();
      const queryLower = state.searchQuery.toLowerCase();
      const showSnippet = !titleLower.includes(queryLower);
      const snippet = showSnippet ? getSearchSnippet(item.searchText, state.searchQuery) : '';

      html += `
        <div class="search-result-item" data-id="${escapeHtml(item.id)}">
          <div class="result-content">
            <div class="result-title">${searchEngine.highlight(escapeHtml(item.title), state.searchQuery)}</div>
            <div class="result-category">${escapeHtml(item.category)}</div>
            ${snippet ? `<div class="result-snippet">${snippet}</div>` : ''}
          </div>
        </div>
      `;
    });

    elements.searchResults.innerHTML = html;

    // 検索結果クリック
    elements.searchResults.querySelectorAll('.search-result-item').forEach(el => {
      el.addEventListener('click', () => {
        // 検索クエリを保持（ページ内ハイライト用）
        state.highlightQuery = state.searchQuery;

        // まとめタブに切り替えてから選択（スクロールはselectItem内で行うのでスキップ）
        switchTab('html', false, true);
        selectItem(el.dataset.id);
        closeSearch();
      });
    });
  }

  /**
   * IDからチャプター情報を抽出
   */
  function extractChapter(item) {
    // パターン: 科目名_XX_チャプター名_トピック名
    const match = item.id.match(/^.+?_(\d+_.+?)_/);
    return match ? match[1] : null;
  }

  /**
   * アイテムを選択
   */
  function selectItem(id) {
    const item = DATA.find(i => i.id === id);
    if (!item) return;

    state.currentItem = item;
    saveState();

    // コンテンツを読み込み
    loadContent(item);
  }

  /**
   * iframe内にモバイル用CSSを注入
   */
  function injectMobileStyles(iframe) {
    try {
      const doc = iframe.contentDocument || iframe.contentWindow.document;
      if (!doc) return;

      // 既存のスタイルがあれば削除
      const existingStyle = doc.getElementById('mobile-override-style');
      if (existingStyle) existingStyle.remove();

      // スマホ用に最適化 - Q&A風デザインに統一
      const style = doc.createElement('style');
      style.id = 'mobile-override-style';
      style.textContent = `
        /* スクロール最適化 */
        html {
          scroll-behavior: auto !important;
          -webkit-overflow-scrolling: touch;
        }
        * {
          -webkit-tap-highlight-color: transparent;
        }

        /* ===== 基本レイアウト ===== */
        body {
          font-size: 15px !important;
          line-height: 1.8 !important;
          padding: 0 !important;
          padding-bottom: 150px !important;
          background: #fafafa !important;
        }
        .page {
          padding: 20px !important;
          max-width: 100% !important;
        }

        /* ===== 見出し（Q&A風：黒 + 下線） ===== */
        h1 {
          font-size: 22px !important;
          font-weight: 700 !important;
          color: #1d1d1f !important;
          margin-bottom: 20px !important;
        }
        h2 {
          font-size: 18px !important;
          font-weight: 700 !important;
          color: #1d1d1f !important;
          margin: 32px 0 16px 0 !important;
          padding-bottom: 12px !important;
          border-bottom: 2px solid #1d1d1f !important;
        }
        h3 {
          font-size: 15px !important;
          font-weight: 600 !important;
          color: #1d1d1f !important;
          margin: 24px 0 12px 0 !important;
        }

        /* ===== テーブル（カード風） ===== */
        table {
          background: #F5F5F7 !important;
          border-radius: 12px !important;
          overflow: hidden !important;
          font-size: 14px !important;
          margin: 16px 0 !important;
          border-collapse: separate !important;
          border-spacing: 0 !important;
        }
        th {
          background: #E8E8ED !important;
          color: #1d1d1f !important;
          font-size: 12px !important;
          font-weight: 600 !important;
          padding: 12px 16px !important;
          border: none !important;
        }
        td {
          padding: 14px 16px !important;
          border: none !important;
          border-bottom: 1px solid #E0E0E0 !important;
          background: #F5F5F7 !important;
        }
        tr:last-child td {
          border-bottom: none !important;
        }

        /* ===== ボックス（グレー背景に統一） ===== */
        .point-box, .summary-box {
          background: #F5F5F7 !important;
          border-radius: 12px !important;
          padding: 16px 20px !important;
          margin: 20px 0 !important;
          border: none !important;
        }
        .point-box-title, .summary-box-title {
          font-size: 15px !important;
          font-weight: 600 !important;
          color: #1d1d1f !important;
          margin-bottom: 10px !important;
        }

        /* 問題ボックス */
        .question-box {
          background: #F5F5F7 !important;
          border-radius: 12px !important;
          padding: 16px 20px !important;
          margin: 20px 0 !important;
          border: none !important;
          font-size: 14px !important;
        }
        .question-box .q-number {
          font-weight: 600 !important;
          color: #86868B !important;
          margin-bottom: 8px !important;
        }
        .question-box .answer {
          color: #1d1d1f !important;
          font-weight: 600 !important;
          margin-top: 12px !important;
        }

        /* ===== その他 ===== */
        .category-tag, .subtitle {
          background: #E8E8ED !important;
          color: #86868B !important;
          font-size: 12px !important;
          padding: 6px 12px !important;
          border-radius: 20px !important;
          margin-bottom: 16px !important;
        }

        .highlight, .red, .key, .caution {
          background: none !important;
          color: inherit !important;
          font-weight: 600 !important;
        }

        .note {
          font-size: 13px !important;
          color: #86868B !important;
          margin-top: 10px !important;
        }

        img {
          max-width: 100% !important;
          height: auto !important;
          border-radius: 8px !important;
        }

        /* リスト余白 */
        ul, ol {
          margin: 12px 0 !important;
          padding-left: 1.5em !important;
        }
        li {
          margin: 8px 0 !important;
        }
      `;
      doc.head.appendChild(style);
    } catch (e) {
      // クロスオリジンエラーは無視
      console.log('Could not inject styles:', e.message);
    }
  }

  /**
   * コンテンツを読み込み
   */
  function loadContent(item) {
    // ウェルカム画面を非表示
    if (elements.welcomeScreen) {
      elements.welcomeScreen.classList.add('hidden');
      elements.welcomeScreen.style.display = 'none';
    }

    // FABを表示（本文閲覧時のみ）
    if (elements.toolFab) {
      elements.toolFab.style.display = 'flex';
    }

    // 無限スクロール用：開始インデックスをセット
    const itemIndex = DATA.findIndex(d => d.id === item.id);
    state.startTopicIndex = itemIndex;
    state.loadedTopicIndex = itemIndex;
    state.firstLoadedTopicIndex = itemIndex;
    state.isLoadingMore = false;

    // HTML（無限スクロール対応）
    if (item.htmlPath) {
      // 表示をクリアして新規読み込み
      elements.htmlDisplay.innerHTML = '';
      elements.htmlDisplay.style.display = 'block';

      // 最初のトピックを読み込み
      loadTopicHTML(item, true);

      // 無限スクロールのセットアップ
      setupInfiniteScroll();
    } else {
      elements.htmlDisplay.innerHTML = '';
      elements.htmlDisplay.style.display = 'none';
      // HTMLがない場合はウェルカム画面を表示（メッセージ付き）
      if (elements.welcomeScreen) {
        elements.welcomeScreen.classList.remove('hidden');
      }
    }

    // Q&A（無限スクロール対応）
    state.qaLoadedTopicIndex = itemIndex;
    state.qaFirstLoadedTopicIndex = itemIndex;
    state.isLoadingMoreQA = false;

    if (item.qaPath) {
      elements.qaDisplay.innerHTML = '';
      elements.qaDisplay.style.display = 'block';
      elements.qaContent.querySelector('.placeholder').style.display = 'none';
      if (elements.qaToolbar) {
        elements.qaToolbar.style.display = 'block';
        elements.qaToolbar.classList.remove('hidden');
      }
      // 最初のトピックを読み込み
      loadQATopic(item, true);
      // 無限スクロールのセットアップ
      setupQAInfiniteScroll();
    } else {
      elements.qaDisplay.innerHTML = '';
      elements.qaDisplay.style.display = 'none';
      elements.qaContent.querySelector('.placeholder').style.display = 'flex';
      elements.qaContent.querySelector('.placeholder p').textContent = 'このトピックにはQ&Aがありません';
      // ツールバーを非表示
      if (elements.qaToolbar) {
        elements.qaToolbar.style.display = 'none';
      }
    }

    // 過去問（無限スクロール対応）
    state.kakomonLoadedTopicIndex = itemIndex;
    state.kakomonFirstLoadedTopicIndex = itemIndex;
    state.isLoadingMoreKakomon = false;

    if (typeof KakomonModule !== 'undefined') {
      elements.kakomonDisplay.innerHTML = '';
      elements.kakomonDisplay.style.display = 'block';
      if (elements.kakomonPlaceholder) {
        elements.kakomonPlaceholder.style.display = 'none';
      }
      if (elements.kakomonToolbar) {
        elements.kakomonToolbar.style.display = 'none';
      }
      // 最初のトピックを読み込み
      loadKakomonTopic(item, true);
      // 無限スクロールのセットアップ
      setupKakomonInfiniteScroll();
    }
  }

  /**
   * トピックのHTMLを読み込んでdivに追加（末尾）
   */
  async function loadTopicHTML(item, isFirst = false) {
    if (!item || !item.htmlPath) return;

    try {
      // 日本語ファイル名をURLエンコード
      const response = await fetch(encodeURI(item.htmlPath));
      if (!response.ok) throw new Error('Failed to load');
      const html = await response.text();

      // HTMLからbodyの中身を抽出
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const bodyContent = doc.body.innerHTML;

      // トピックセクションを作成
      const section = createTopicSection(item, bodyContent);

      // 表示領域に追加（末尾）
      elements.htmlDisplay.appendChild(section);

      // お気に入りボタンを追加（セクション内のh2に対して）- 遅延実行でパフォーマンス改善
      requestAnimationFrame(() => {
        injectFavoriteButtonsToSection(section, item);
      });

      // 過去問カードの折りたたみ・画像遅延読み込み初期化（新規コンテンツ）
      requestAnimationFrame(() => {
        initQuestionCards();
        initLazyImages();
      });

      // 検索からのジャンプ時：フローティング検索バーを表示
      if (isFirst && state.highlightQuery) {
        setTimeout(() => {
          showFloatingSearch(state.highlightQuery);
          state.highlightQuery = null;
        }, 300);
      }

      // フローティング検索継続（トピック切り替え後）
      if (isFirst && state.pendingFloatingSearch) {
        continueFloatingSearchAfterLoad();
      }

    } catch (e) {
      console.log('トピックHTML読み込みエラー:', e);
    }
  }

  /**
   * トピックのHTMLを読み込んでdivに追加（先頭）
   */
  async function loadTopicHTMLPrepend(item) {
    if (!item || !item.htmlPath) return;

    try {
      const response = await fetch(encodeURI(item.htmlPath));
      if (!response.ok) throw new Error('Failed to load');
      const html = await response.text();

      // HTMLからbodyの中身を抽出
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const bodyContent = doc.body.innerHTML;

      // トピックセクションを作成
      const section = createTopicSection(item, bodyContent);

      // 表示領域に追加（先頭）
      elements.htmlDisplay.insertBefore(section, elements.htmlDisplay.firstChild);

      // お気に入りボタンを追加（セクション内のh3に対して）- 遅延実行でパフォーマンス改善
      requestAnimationFrame(() => {
        injectFavoriteButtonsToSection(section, item);
      });

      // 過去問カードの折りたたみ・画像遅延読み込み初期化（新規コンテンツ）
      requestAnimationFrame(() => {
        initQuestionCards();
        initLazyImages();
      });

    } catch (e) {
      console.log('トピックHTML読み込みエラー:', e);
    }
  }

  /**
   * トピックセクション要素を作成
   */
  function createTopicSection(item, bodyContent) {
    const section = document.createElement('div');
    section.className = 'topic-section';
    section.dataset.topicId = item.id;

    // トピックヘッダー（区切り）を追加
    const header = document.createElement('div');
    header.className = 'topic-section-header';
    header.innerHTML = `
      <span class="topic-section-subject">${escapeHtml(item.subject || '')}</span>
      <span class="topic-section-title">${escapeHtml(item.title || item.id)}</span>
    `;
    section.appendChild(header);

    // ラージタイトル（iOS風）を追加
    const largeTitle = document.createElement('div');
    largeTitle.className = 'topic-section-large-title';
    largeTitle.innerHTML = `<h2>${escapeHtml(item.title || item.id)}</h2>`;
    section.appendChild(largeTitle);

    // スクロール監視（ラージタイトルが見えなくなったらヘッダーにタイトル表示）
    setupLargeTitleObserver(header, largeTitle);

    // コンテンツを追加
    const content = document.createElement('div');
    content.className = 'topic-section-content';
    content.innerHTML = bodyContent;
    section.appendChild(content);

    // 画像パスを修正（相対パスを正しいパスに変換）
    fixImagePaths(content, item.htmlPath);

    // 画像にクリックイベントを追加（ライトボックス用）
    const images = content.querySelectorAll('img');
    images.forEach(img => {
      img.addEventListener('click', () => {
        openImageLightbox(img.src);
      });
    });

    return section;
  }

  /**
   * ラージタイトルのスクロール監視をセットアップ
   */
  function setupLargeTitleObserver(header, largeTitle) {
    // ヘッダーの高さ分をrootMarginで調整
    const headerHeight = 56; // ヘッダーの高さ（--header-offset）
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            // ラージタイトルが見えている→ナビのタイトルを隠す
            header.classList.remove('scrolled');
            largeTitle.classList.remove('hidden');
          } else {
            // ラージタイトルが見えない→ナビにタイトルを表示
            header.classList.add('scrolled');
            largeTitle.classList.add('hidden');
          }
        });
      },
      {
        rootMargin: `-${headerHeight + 44}px 0px 0px 0px`,
        threshold: 0
      }
    );
    observer.observe(largeTitle);
  }

  /**
   * HTML内の画像パスを修正
   */
  function fixImagePaths(container, htmlPath) {
    if (!htmlPath) return;

    const images = container.querySelectorAll('img');
    images.forEach(img => {
      const src = img.getAttribute('src');
      if (!src) return;

      // 相対パス（../）を含む場合、正しいパスに変換
      if (src.startsWith('../')) {
        // htmlPathからディレクトリ部分を取得
        const htmlDir = htmlPath.substring(0, htmlPath.lastIndexOf('/'));
        // 相対パスを解決
        const resolvedPath = resolveRelativePath(htmlDir, src);
        img.setAttribute('src', resolvedPath);
      }
    });
  }

  /**
   * 相対パスを解決
   */
  function resolveRelativePath(basePath, relativePath) {
    const baseParts = basePath.split('/');
    const relativeParts = relativePath.split('/');

    for (const part of relativeParts) {
      if (part === '..') {
        baseParts.pop();
      } else if (part !== '.') {
        baseParts.push(part);
      }
    }

    return baseParts.join('/');
  }

  /**
   * 画像ライトボックスを開く
   */
  function openImageLightbox(imgSrc) {
    elements.lightboxImage.src = imgSrc;
    elements.imageLightbox.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  /**
   * 画像ライトボックスを閉じる
   */
  function closeImageLightbox() {
    elements.imageLightbox.classList.remove('open', 'show-hint');
    document.body.style.overflow = '';
  }

  /**
   * 検索クエリに一致する箇所をハイライト＆スクロール
   */
  function highlightAndScrollToMatch(container, query) {
    if (!query || !container) return;

    const terms = query.toLowerCase().trim().split(/\s+/).filter(t => t.length >= 2);
    if (terms.length === 0) return;

    // 既存のハイライトをクリア
    container.querySelectorAll('.search-highlight').forEach(el => {
      const parent = el.parentNode;
      parent.replaceChild(document.createTextNode(el.textContent), el);
      parent.normalize();
    });

    // テキストノードを走査してハイライト
    const walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );

    const nodesToHighlight = [];
    let firstMatch = null;

    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = node.textContent.toLowerCase();

      for (const term of terms) {
        if (text.includes(term)) {
          nodesToHighlight.push({ node, term });
          if (!firstMatch) {
            firstMatch = node;
          }
          break;
        }
      }
    }

    // ハイライトを適用（最初の5件のみ）
    let highlightCount = 0;
    for (const { node, term } of nodesToHighlight) {
      if (highlightCount >= 5) break;

      const text = node.textContent;
      const lowerText = text.toLowerCase();
      const index = lowerText.indexOf(term);

      if (index !== -1) {
        const before = text.substring(0, index);
        const match = text.substring(index, index + term.length);
        const after = text.substring(index + term.length);

        const span = document.createElement('span');
        span.className = 'search-highlight';
        span.textContent = match;

        const fragment = document.createDocumentFragment();
        if (before) fragment.appendChild(document.createTextNode(before));
        fragment.appendChild(span);
        if (after) fragment.appendChild(document.createTextNode(after));

        node.parentNode.replaceChild(fragment, node);
        highlightCount++;
      }
    }

    // 最初のハイライトにスクロール
    const firstHighlight = container.querySelector('.search-highlight');
    if (firstHighlight) {
      setTimeout(() => {
        firstHighlight.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 50);
    }
  }

  /**
   * 無限スクロールのセットアップ
   */
  function setupInfiniteScroll() {
    const container = elements.htmlContent;

    // 既存のリスナーを削除（重複防止）
    container.removeEventListener('scroll', handleInfiniteScroll);
    container.addEventListener('scroll', handleInfiniteScroll, { passive: true });
  }

  /**
   * 無限スクロールのハンドラ
   */
  function handleInfiniteScroll() {
    if (state.isLoadingMore) return;

    const container = elements.htmlContent;
    const scrollTop = container.scrollTop;
    const scrollHeight = container.scrollHeight;
    const clientHeight = container.clientHeight;

    // 上部から200px以内に達したら前のトピックを読み込み
    if (scrollTop <= 200) {
      loadPreviousTopic();
    }

    // 底部から200px以内に達したら次を読み込み
    if (scrollTop + clientHeight >= scrollHeight - 200) {
      loadNextTopic();
    }
  }

  /**
   * 前のトピックを読み込み（上方向スクロール）
   */
  async function loadPreviousTopic() {
    if (state.isLoadingMore) return;

    state.isLoadingMore = true;

    // htmlPathを持つ前のアイテムを探す
    let prevIndex = state.firstLoadedTopicIndex - 1;
    while (prevIndex >= 0) {
      const prevItem = DATA[prevIndex];
      if (prevItem && prevItem.htmlPath) {
        // スクロール位置を保持するため、挿入前の高さを記録
        const container = elements.htmlContent;
        const scrollHeightBefore = container.scrollHeight;

        await loadTopicHTMLPrepend(prevItem);
        state.firstLoadedTopicIndex = prevIndex;

        // 挿入後、スクロール位置を調整（追加された分だけ下にずらす）
        const scrollHeightAfter = container.scrollHeight;
        const heightDiff = scrollHeightAfter - scrollHeightBefore;
        container.scrollTop += heightDiff;
        break;
      }
      prevIndex--;
    }

    state.isLoadingMore = false;
  }

  /**
   * 次のトピックを読み込み（下方向スクロール）
   */
  async function loadNextTopic() {
    if (state.isLoadingMore) return;

    state.isLoadingMore = true;

    // htmlPathを持つ次のアイテムを探す
    let nextIndex = state.loadedTopicIndex + 1;
    while (nextIndex < DATA.length) {
      const nextItem = DATA[nextIndex];
      if (nextItem && nextItem.htmlPath) {
        await loadTopicHTML(nextItem, false);
        state.loadedTopicIndex = nextIndex;
        break;
      }
      nextIndex++;
    }

    state.isLoadingMore = false;
  }

  /**
   * セクション内のh2にお気に入りボタンを追加
   */
  function injectFavoriteButtonsToSection(section, item) {
    if (typeof FavoritesManager === 'undefined') return;

    const topicId = item.id;
    // h2を探し、なければh3を使用
    let headingElements = section.querySelectorAll('.topic-section-content h2');
    if (headingElements.length === 0) {
      headingElements = section.querySelectorAll('.topic-section-content h3');
    }

    headingElements.forEach((heading, index) => {
      // 既にラッパーがあればスキップ
      if (heading.parentElement.classList.contains('html-card-wrapper')) return;

      const headingTag = heading.tagName; // H2 or H3

      // 見出しをラッパーで囲む
      const wrapper = document.createElement('div');
      wrapper.className = 'html-card-wrapper';
      wrapper.dataset.cardIndex = index;
      wrapper.dataset.title = heading.textContent || '';

      // 見出しの後の要素を含める（次の同じ見出しまたはh1まで）
      const elementsToWrap = [];
      let sibling = heading.nextElementSibling;
      while (sibling && sibling.tagName !== headingTag && sibling.tagName !== 'H1' && sibling.tagName !== 'H2') {
        elementsToWrap.push(sibling);
        sibling = sibling.nextElementSibling;
      }

      heading.parentNode.insertBefore(wrapper, heading);
      wrapper.appendChild(heading);
      elementsToWrap.forEach(el => wrapper.appendChild(el));

      // お気に入りボタンを追加
      const favBtn = document.createElement('button');
      favBtn.className = 'favorite-btn';
      favBtn.setAttribute('aria-label', 'お気に入り');
      favBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>';

      // 既にお気に入りかチェック
      const isFav = FavoritesManager.isFavoriteByParams('html', topicId, index);
      if (isFav) favBtn.classList.add('active');

      favBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        const content = {
          title: heading.textContent || '',
          html: wrapper.innerHTML
        };
        const isNowFavorite = FavoritesManager.toggle('html', topicId, index, content);
        this.classList.toggle('active', isNowFavorite);
      });

      // 画像保存ボタンを追加
      const saveBtn = document.createElement('button');
      saveBtn.className = 'save-image-btn';
      saveBtn.setAttribute('aria-label', '画像保存');
      saveBtn.innerHTML = createSaveButtonSVG();
      saveBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        const filename = `まとめ_${topicId}_${heading.textContent || index}`;
        saveCardAsImage(wrapper, filename);
      });

      wrapper.insertBefore(saveBtn, wrapper.firstChild);
      wrapper.insertBefore(favBtn, wrapper.firstChild);
    });
  }

  /**
   * Q&Aを読み込んで表示
   */
  async function loadQA(path) {
    try {
      const response = await fetch(path);
      if (!response.ok) throw new Error('Failed to load');
      const text = await response.text();

      const html = parseQA(text);
      elements.qaDisplay.innerHTML = html;
      elements.qaDisplay.style.display = 'block';
      elements.qaContent.querySelector('.placeholder').style.display = 'none';

      // 現在のモードを適用
      if (state.qaShowAll) {
        elements.qaDisplay.classList.add('show-all');
      }

      // ツールバーを表示し、ボタンの状態を同期
      if (elements.qaToolbar) {
        elements.qaToolbar.style.display = 'block';
        elements.qaToolbar.classList.remove('hidden');
      }
      if (elements.qaToggleBtn) {
        elements.qaToggleBtn.classList.toggle('active', state.qaShowAll);
        elements.qaToggleBtn.textContent = state.qaShowAll ? '折りたたむ' : '全て表示';
      }

      // Q&Aの折りたたみイベント（全表示モードでは無効）
      elements.qaDisplay.querySelectorAll('.qa-question').forEach(q => {
        q.addEventListener('click', () => {
          if (state.qaShowAll) return;
          const answer = q.nextElementSibling;
          if (answer && answer.classList.contains('qa-answer')) {
            answer.classList.toggle('show');
          }
        });
      });

      // お気に入りボタンのイベント
      bindQAFavoriteButtons();

    } catch (e) {
      elements.qaDisplay.innerHTML = '<div class="no-results">Q&Aを読み込めませんでした</div>';
      elements.qaDisplay.style.display = 'block';
    }
  }

  /**
   * Q&A無限スクロール用：トピックを読み込み（末尾）
   */
  async function loadQATopic(item, isFirst = false) {
    if (!item || !item.qaPath) return;

    try {
      const response = await fetch(encodeURI(item.qaPath));
      if (!response.ok) throw new Error('Failed to load');
      const text = await response.text();

      // Q&Aセクションを作成
      const section = document.createElement('div');
      section.className = 'qa-topic-section';
      section.dataset.topicId = item.id;

      // トピックヘッダー（区切り）を追加
      const header = document.createElement('div');
      header.className = 'topic-section-header';
      header.innerHTML = `
        <span class="topic-section-subject">${escapeHtml(item.subject || '')}</span>
        <span class="topic-section-title">${escapeHtml(item.title || item.id)}</span>
      `;
      section.appendChild(header);

      // Q&Aコンテンツを追加
      const content = document.createElement('div');
      content.className = 'qa-topic-content';
      content.innerHTML = parseQAForSection(text, item.id);
      section.appendChild(content);

      // 表示領域に追加（末尾）
      elements.qaDisplay.appendChild(section);

      // モードを適用
      if (state.qaShowAll) {
        elements.qaDisplay.classList.add('show-all');
      }

      // イベントをバインド - 遅延実行でパフォーマンス改善
      requestAnimationFrame(() => {
        bindQAEventsInSection(section, item.id);
      });

    } catch (e) {
      console.log('Q&A読み込みエラー:', e);
    }
  }

  /**
   * Q&A無限スクロール用：トピックを読み込み（先頭）
   */
  async function loadQATopicPrepend(item) {
    if (!item || !item.qaPath) return;

    try {
      const response = await fetch(encodeURI(item.qaPath));
      if (!response.ok) throw new Error('Failed to load');
      const text = await response.text();

      // Q&Aセクションを作成
      const section = document.createElement('div');
      section.className = 'qa-topic-section';
      section.dataset.topicId = item.id;

      // トピックヘッダー（区切り）を追加
      const header = document.createElement('div');
      header.className = 'topic-section-header';
      header.innerHTML = `
        <span class="topic-section-subject">${escapeHtml(item.subject || '')}</span>
        <span class="topic-section-title">${escapeHtml(item.title || item.id)}</span>
      `;
      section.appendChild(header);

      // Q&Aコンテンツを追加
      const content = document.createElement('div');
      content.className = 'qa-topic-content';
      content.innerHTML = parseQAForSection(text, item.id);
      section.appendChild(content);

      // 表示領域に追加（先頭）
      elements.qaDisplay.insertBefore(section, elements.qaDisplay.firstChild);

      // モードを適用
      if (state.qaShowAll) {
        elements.qaDisplay.classList.add('show-all');
      }

      // イベントをバインド - 遅延実行でパフォーマンス改善
      requestAnimationFrame(() => {
        bindQAEventsInSection(section, item.id);
      });

    } catch (e) {
      console.log('Q&A読み込みエラー:', e);
    }
  }

  /**
   * Q&Aテキストをパース（セクション用・topicId付き）
   */
  function parseQAForSection(text, topicId) {
    const lines = text.split('\n');
    let html = '';
    let currentSection = '';
    let inRelated = false;
    let relatedItems = [];
    let inTable = false;
    let tableRows = [];
    let qaIndex = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Markdownテーブルの検出
      if (line.startsWith('|') && line.endsWith('|')) {
        if (line.match(/^\|[\s\-:|]+\|$/)) {
          inTable = true;
          continue;
        }
        if (!inTable && tableRows.length === 0) {
          tableRows.push({ cells: parseTableRow(line), isHeader: true });
        } else {
          inTable = true;
          tableRows.push({ cells: parseTableRow(line), isHeader: false });
        }
        continue;
      } else if (inTable || tableRows.length > 0) {
        html += renderTable(tableRows);
        tableRows = [];
        inTable = false;
      }

      if (line.startsWith('## ')) {
        if (relatedItems.length > 0) {
          html += renderRelated(relatedItems);
          relatedItems = [];
        }
        inRelated = false;
        currentSection = line.slice(3);
        html += `<div class="qa-section" data-section-title="${escapeHtml(currentSection)}">
          <div class="qa-section-header">
            <div class="qa-section-title">${escapeHtml(currentSection)}</div>
            <div class="qa-section-actions">
              <button class="save-image-btn" aria-label="画像保存">${createSaveButtonSVG()}</button>
              <button class="favorite-btn" aria-label="お気に入り"><svg viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg></button>
            </div>
          </div>
          <div class="qa-section-content">`;
        continue;
      }

      if (line === '---') {
        if (relatedItems.length > 0) {
          html += renderRelated(relatedItems);
          relatedItems = [];
        }
        if (currentSection) {
          html += '</div></div>'; // qa-section-content と qa-section を閉じる
          currentSection = '';
        }
        inRelated = false;
        continue;
      }

      if (line === '[関連質問]') {
        inRelated = true;
        continue;
      }

      if (inRelated && line.startsWith('- ')) {
        relatedItems.push(line.slice(2));
        continue;
      }

      if (line.startsWith('Q: ')) {
        if (relatedItems.length > 0) {
          html += renderRelated(relatedItems);
          relatedItems = [];
        }
        inRelated = false;
        const question = line.slice(3);
        html += `<div class="qa-item" data-topic-id="${escapeHtml(topicId)}" data-card-index="${qaIndex}" data-question="${escapeHtml(question)}">`;
        // セクションがない場合のみ個別ボタンを表示
        if (!currentSection) {
          html += `<button class="save-image-btn" aria-label="画像保存">${createSaveButtonSVG()}</button>`;
          html += `<button class="favorite-btn" aria-label="お気に入り"><svg viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg></button>`;
        }
        html += `<div class="qa-question">${escapeHtml(question)}</div>`;
        qaIndex++;
        continue;
      }

      if (line.startsWith('A: ')) {
        const answer = line.slice(3);
        html += `<div class="qa-answer" data-answer="${escapeHtml(answer)}">${escapeHtml(answer)}</div>`;
        html += `</div>`;
        continue;
      }
    }

    if (tableRows.length > 0) {
      html += renderTable(tableRows);
    }
    if (relatedItems.length > 0) {
      html += renderRelated(relatedItems);
    }
    if (currentSection) {
      html += '</div></div>'; // qa-section-content と qa-section を閉じる
    }

    return html;
  }

  /**
   * Q&Aセクション内のイベントをバインド
   */
  function bindQAEventsInSection(section, topicId) {
    // 折りたたみイベント
    section.querySelectorAll('.qa-question').forEach(q => {
      q.addEventListener('click', () => {
        if (state.qaShowAll) return;
        const answer = q.nextElementSibling;
        if (answer && answer.classList.contains('qa-answer')) {
          answer.classList.toggle('show');
        }
      });
    });

    // セクション単位のボタン（.qa-section-actions内）
    section.querySelectorAll('.qa-section').forEach(qaSection => {
      const sectionTitle = qaSection.dataset.sectionTitle || '';
      const favoriteBtn = qaSection.querySelector('.qa-section-actions .favorite-btn');
      const saveBtn = qaSection.querySelector('.qa-section-actions .save-image-btn');

      // お気に入りボタン
      if (favoriteBtn && typeof FavoritesManager !== 'undefined') {
        const isFav = FavoritesManager.isFavoriteByParams('qa-section', topicId, sectionTitle);
        favoriteBtn.classList.toggle('active', isFav);

        favoriteBtn.addEventListener('click', function(e) {
          e.stopPropagation();

          // セクション内の全Q&Aを取得
          const qaItems = qaSection.querySelectorAll('.qa-item');
          const qaList = [];
          qaItems.forEach(item => {
            const question = item.dataset.question || '';
            const answerEl = item.querySelector('.qa-answer');
            const answer = answerEl ? (answerEl.dataset.answer || answerEl.textContent) : '';
            qaList.push({ question, answer });
          });

          const content = {
            sectionTitle: sectionTitle,
            qaList: qaList
          };

          const isNowFavorite = FavoritesManager.toggle('qa-section', topicId, sectionTitle, content);
          this.classList.toggle('active', isNowFavorite);
        });
      }

      // 画像保存ボタン
      if (saveBtn) {
        saveBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          const filename = `QA_${topicId}_${sectionTitle}`;
          saveCardAsImage(qaSection, filename);
        });
      }
    });

    // 個別Q&Aのボタン（セクション外のもの）
    section.querySelectorAll('.qa-item').forEach(item => {
      const cardIndex = item.dataset.cardIndex;
      const itemTopicId = item.dataset.topicId || topicId;
      const favoriteBtn = item.querySelector('.favorite-btn');
      const saveBtn = item.querySelector('.save-image-btn');

      // お気に入りボタン
      if (favoriteBtn && typeof FavoritesManager !== 'undefined') {
        const isFav = FavoritesManager.isFavoriteByParams('qa', itemTopicId, cardIndex);
        favoriteBtn.classList.toggle('active', isFav);

        favoriteBtn.addEventListener('click', function(e) {
          e.stopPropagation();

          const question = item.dataset.question || '';
          const answerEl = item.querySelector('.qa-answer');
          const answer = answerEl ? (answerEl.dataset.answer || answerEl.textContent) : '';

          const content = {
            question: question,
            answer: answer
          };

          const isNowFavorite = FavoritesManager.toggle('qa', itemTopicId, cardIndex, content);
          this.classList.toggle('active', isNowFavorite);
        });
      }

      // 画像保存ボタン
      if (saveBtn) {
        saveBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          const question = item.dataset.question || '';
          const filename = `QA_${itemTopicId}_${question.substring(0, 20)}`;
          saveCardAsImage(item, filename);
        });
      }
    });
  }

  /**
   * Q&A無限スクロールのセットアップ
   */
  function setupQAInfiniteScroll() {
    const container = elements.qaContent;
    container.removeEventListener('scroll', handleQAInfiniteScroll);
    container.addEventListener('scroll', handleQAInfiniteScroll, { passive: true });
  }

  /**
   * Q&A無限スクロールのハンドラ
   */
  function handleQAInfiniteScroll() {
    if (state.isLoadingMoreQA) return;

    const container = elements.qaContent;
    const scrollTop = container.scrollTop;
    const scrollHeight = container.scrollHeight;
    const clientHeight = container.clientHeight;

    // 上部から200px以内
    if (scrollTop <= 200) {
      loadPreviousQATopic();
    }

    // 底部から200px以内
    if (scrollTop + clientHeight >= scrollHeight - 200) {
      loadNextQATopic();
    }
  }

  /**
   * Q&A：前のトピックを読み込み
   */
  async function loadPreviousQATopic() {
    if (state.isLoadingMoreQA) return;

    state.isLoadingMoreQA = true;

    // qaPathを持つ前のアイテムを探す
    let prevIndex = state.qaFirstLoadedTopicIndex - 1;
    while (prevIndex >= 0) {
      const prevItem = DATA[prevIndex];
      if (prevItem && prevItem.qaPath) {
        const container = elements.qaContent;
        const scrollHeightBefore = container.scrollHeight;

        await loadQATopicPrepend(prevItem);
        state.qaFirstLoadedTopicIndex = prevIndex;

        const scrollHeightAfter = container.scrollHeight;
        const heightDiff = scrollHeightAfter - scrollHeightBefore;
        container.scrollTop += heightDiff;
        break;
      }
      prevIndex--;
    }

    state.isLoadingMoreQA = false;
  }

  /**
   * Q&A：次のトピックを読み込み
   */
  async function loadNextQATopic() {
    if (state.isLoadingMoreQA) return;

    state.isLoadingMoreQA = true;

    // qaPathを持つ次のアイテムを探す
    let nextIndex = state.qaLoadedTopicIndex + 1;
    while (nextIndex < DATA.length) {
      const nextItem = DATA[nextIndex];
      if (nextItem && nextItem.qaPath) {
        await loadQATopic(nextItem, false);
        state.qaLoadedTopicIndex = nextIndex;
        break;
      }
      nextIndex++;
    }

    state.isLoadingMoreQA = false;
  }

  /**
   * 過去問無限スクロール用：トピックを読み込み（末尾）
   */
  async function loadKakomonTopic(item, isFirst = false) {
    if (!item || typeof KakomonModule === 'undefined') return;

    try {
      const subject = item.subject;
      const keyword = item.title;

      // 科目データを読み込み
      const subjectData = await KakomonModule.loadSubjectData(subject);
      if (!subjectData) return;

      // キーワードでフィルタリング
      const filtered = KakomonModule.filterByKeyword(subjectData.questions, keyword);
      if (filtered.length === 0) return;

      // セクションを作成
      const section = document.createElement('div');
      section.className = 'kakomon-topic-section';
      section.dataset.topicId = item.id;

      // トピックヘッダー
      const header = document.createElement('div');
      header.className = 'topic-section-header';
      header.innerHTML = `
        <span class="topic-section-subject">${escapeHtml(item.subject || '')}</span>
        <span class="topic-section-title">${escapeHtml(item.title || item.id)}</span>
      `;
      section.appendChild(header);

      // 問題数ヘッダー
      const countHeader = document.createElement('div');
      countHeader.className = 'kakomon-list-header';
      countHeader.textContent = `${filtered.length}問`;
      section.appendChild(countHeader);

      // 問題カードを追加
      filtered.forEach((question, index) => {
        const cardHtml = renderKakomonCard(question, index, filtered.length, item);
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = cardHtml;
        section.appendChild(tempDiv.firstElementChild);
      });

      // 表示領域に追加（末尾）
      elements.kakomonDisplay.appendChild(section);

      // イベントをバインド
      bindKakomonEventsInSection(section, item);

    } catch (e) {
      console.log('過去問読み込みエラー:', e);
    }
  }

  /**
   * 過去問無限スクロール用：トピックを読み込み（先頭）
   */
  async function loadKakomonTopicPrepend(item) {
    if (!item || typeof KakomonModule === 'undefined') return;

    try {
      const subject = item.subject;
      const keyword = item.title;

      const subjectData = await KakomonModule.loadSubjectData(subject);
      if (!subjectData) return;

      const filtered = KakomonModule.filterByKeyword(subjectData.questions, keyword);
      if (filtered.length === 0) return;

      const section = document.createElement('div');
      section.className = 'kakomon-topic-section';
      section.dataset.topicId = item.id;

      const header = document.createElement('div');
      header.className = 'topic-section-header';
      header.innerHTML = `
        <span class="topic-section-subject">${escapeHtml(item.subject || '')}</span>
        <span class="topic-section-title">${escapeHtml(item.title || item.id)}</span>
      `;
      section.appendChild(header);

      const countHeader = document.createElement('div');
      countHeader.className = 'kakomon-list-header';
      countHeader.textContent = `${filtered.length}問`;
      section.appendChild(countHeader);

      filtered.forEach((question, index) => {
        const cardHtml = renderKakomonCard(question, index, filtered.length, item);
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = cardHtml;
        section.appendChild(tempDiv.firstElementChild);
      });

      // 表示領域に追加（先頭）
      elements.kakomonDisplay.insertBefore(section, elements.kakomonDisplay.firstChild);

      bindKakomonEventsInSection(section, item);

    } catch (e) {
      console.log('過去問読み込みエラー:', e);
    }
  }

  /**
   * 過去問カードのHTMLを生成
   */
  function renderKakomonCard(question, index, total, item) {
    const choices = question.choices || {};
    const numChoices = question.numChoices || 1;

    const validChoices = Object.entries(choices)
      .filter(([key, value]) => value && value.trim() !== '');

    let imagesHtml = '';
    if (question.hasImage && question.imageFiles) {
      const examNum = question.examNum || question.code.match(/^\d+/)?.[0];
      const imageList = question.imageFiles.split(',').map(f => f.trim()).filter(f => f);
      if (imageList.length > 0 && examNum) {
        imagesHtml = `
          <div class="kakomon-images">
            ${imageList.map(file => `<img src="images/${examNum}回_Web画像/${file}" alt="${file}">`).join('')}
          </div>
        `;
      }
    }

    const choicesJson = JSON.stringify(Object.fromEntries(validChoices));

    let imagePathsJson = '[]';
    if (question.hasImage && question.imageFiles) {
      const examNum = question.examNum || question.code.match(/^\d+/)?.[0];
      const imageList = question.imageFiles.split(',').map(f => f.trim()).filter(f => f);
      if (imageList.length > 0 && examNum) {
        const paths = imageList.map(file => `images/${examNum}回_Web画像/${file}`);
        imagePathsJson = JSON.stringify(paths);
      }
    }

    const topicId = item.subject || item.id;

    return `
      <div class="kakomon-card" data-index="${index}" data-topic-id="${escapeHtml(topicId)}" data-answer="${escapeHtml(question.answer)}" data-num="${numChoices}" data-answered="false" data-code="${escapeHtml(question.code)}" data-text="${escapeHtml(question.text)}" data-choices='${choicesJson.replace(/'/g, "&#39;")}' data-images='${imagePathsJson}'>
        <div class="kakomon-header">
          <span class="kakomon-code">${escapeHtml(question.code)}</span>
          <span class="kakomon-index">${index + 1} / ${total}</span>
          <button class="favorite-btn" aria-label="お気に入り">
            <svg viewBox="0 0 24 24">
              <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
            </svg>
          </button>
        </div>

        <div class="kakomon-question">
          <p class="kakomon-text">${escapeHtml(question.text)}</p>
        </div>

        ${imagesHtml}

        <div class="kakomon-instruction">
          ${numChoices > 1 ? `${numChoices}つ選べ。` : '1つ選べ。'}
        </div>

        <div class="kakomon-choices">
          ${validChoices.map(([key, value]) => `
            <button class="kakomon-choice" data-choice="${key}">
              <span class="choice-label">${key}</span>
              <span class="choice-text">${escapeHtml(value)}</span>
            </button>
          `).join('')}
        </div>

        <button class="kakomon-submit" disabled>解答</button>

        <div class="kakomon-result" style="display:none;">
          <div class="result-answer">正解: ${formatKakomonAnswer(question.answer)}</div>
          <div class="result-message"></div>
        </div>
      </div>
    `;
  }

  /**
   * 過去問の正解をフォーマット
   */
  function formatKakomonAnswer(answer) {
    if (!answer) return '';
    return answer.toLowerCase().split('').join(', ');
  }

  /**
   * 過去問セクション内のイベントをバインド
   */
  function bindKakomonEventsInSection(section, item) {
    const topicId = item.subject || item.id;

    // お気に入りボタン
    if (typeof FavoritesManager !== 'undefined') {
      section.querySelectorAll('.kakomon-card').forEach(card => {
        const code = card.dataset.code;
        const favoriteBtn = card.querySelector('.favorite-btn');
        if (!favoriteBtn) return;

        const isFav = FavoritesManager.isFavoriteByParams('kakomon', topicId, code);
        favoriteBtn.classList.toggle('active', isFav);

        favoriteBtn.addEventListener('click', function(e) {
          e.stopPropagation();

          const questionText = card.dataset.text || '';
          const answer = card.dataset.answer || '';
          const numChoices = card.dataset.num || '1';

          let choices = {};
          let images = [];
          try {
            choices = JSON.parse(card.dataset.choices || '{}');
            images = JSON.parse(card.dataset.images || '[]');
          } catch (err) {
            console.log('パースエラー:', err);
          }

          const content = {
            code: code,
            text: questionText,
            answer: answer,
            numChoices: numChoices,
            choices: choices,
            images: images
          };

          const isNowFavorite = FavoritesManager.toggle('kakomon', topicId, code, content);
          this.classList.toggle('active', isNowFavorite);
        });
      });
    }

    // 選択肢・解答ボタンイベント
    section.querySelectorAll('.kakomon-card').forEach(card => {
      const numChoices = parseInt(card.dataset.num) || 1;
      let selectedChoices = new Set();

      card.querySelectorAll('.kakomon-choice').forEach(btn => {
        btn.addEventListener('click', () => {
          if (card.dataset.answered === 'true') return;

          const choiceKey = btn.dataset.choice;

          if (selectedChoices.has(choiceKey)) {
            selectedChoices.delete(choiceKey);
            btn.classList.remove('selected');
          } else {
            if (numChoices === 1) {
              card.querySelectorAll('.kakomon-choice').forEach(b => {
                b.classList.remove('selected');
              });
              selectedChoices.clear();
            }
            selectedChoices.add(choiceKey);
            btn.classList.add('selected');
          }

          const submitBtn = card.querySelector('.kakomon-submit');
          if (submitBtn) {
            submitBtn.disabled = selectedChoices.size !== numChoices;
          }
        });
      });

      const submitBtn = card.querySelector('.kakomon-submit');
      if (submitBtn) {
        submitBtn.addEventListener('click', () => {
          if (card.dataset.answered === 'true') return;

          const correctAnswer = card.dataset.answer;
          checkKakomonAnswer(card, correctAnswer, selectedChoices);
          submitBtn.style.display = 'none';
        });
      }
    });
  }

  /**
   * 過去問の答え合わせ
   */
  function checkKakomonAnswer(card, correctAnswer, selectedChoices) {
    card.dataset.answered = 'true';

    const selectedKeys = Array.from(selectedChoices)
      .map(k => k.toUpperCase())
      .sort()
      .join('');

    const sortedCorrect = correctAnswer.toUpperCase().split('').sort().join('');
    const isCorrect = selectedKeys === sortedCorrect;

    card.querySelectorAll('.kakomon-choice').forEach(btn => {
      btn.disabled = true;
      const key = btn.dataset.choice.toUpperCase();

      if (correctAnswer.toUpperCase().includes(key)) {
        btn.classList.add('correct');
      } else if (btn.classList.contains('selected')) {
        btn.classList.add('incorrect');
      }
    });

    const resultDiv = card.querySelector('.kakomon-result');
    const messageDiv = resultDiv.querySelector('.result-message');

    messageDiv.textContent = isCorrect ? '正解！' : '不正解';
    messageDiv.className = 'result-message ' + (isCorrect ? 'correct' : 'incorrect');
    resultDiv.style.display = 'block';
  }

  /**
   * 過去問無限スクロールのセットアップ
   */
  function setupKakomonInfiniteScroll() {
    const container = elements.kakomonContent;
    container.removeEventListener('scroll', handleKakomonInfiniteScroll);
    container.addEventListener('scroll', handleKakomonInfiniteScroll, { passive: true });
  }

  /**
   * 過去問無限スクロールのハンドラ
   */
  function handleKakomonInfiniteScroll() {
    if (state.isLoadingMoreKakomon) return;

    const container = elements.kakomonContent;
    const scrollTop = container.scrollTop;
    const scrollHeight = container.scrollHeight;
    const clientHeight = container.clientHeight;

    if (scrollTop <= 200) {
      loadPreviousKakomonTopic();
    }

    if (scrollTop + clientHeight >= scrollHeight - 200) {
      loadNextKakomonTopic();
    }
  }

  /**
   * 過去問：前のトピックを読み込み
   */
  async function loadPreviousKakomonTopic() {
    if (state.isLoadingMoreKakomon) return;

    const prevIndex = state.kakomonFirstLoadedTopicIndex - 1;
    if (prevIndex < 0) return;

    state.isLoadingMoreKakomon = true;

    const prevItem = DATA[prevIndex];
    if (prevItem) {
      const container = elements.kakomonContent;
      const scrollHeightBefore = container.scrollHeight;

      await loadKakomonTopicPrepend(prevItem);
      state.kakomonFirstLoadedTopicIndex = prevIndex;

      const scrollHeightAfter = container.scrollHeight;
      const heightDiff = scrollHeightAfter - scrollHeightBefore;
      container.scrollTop += heightDiff;
    }

    state.isLoadingMoreKakomon = false;
  }

  /**
   * 過去問：次のトピックを読み込み
   */
  async function loadNextKakomonTopic() {
    if (state.isLoadingMoreKakomon) return;

    const nextIndex = state.kakomonLoadedTopicIndex + 1;
    if (nextIndex >= DATA.length) return;

    state.isLoadingMoreKakomon = true;

    const nextItem = DATA[nextIndex];
    if (nextItem) {
      await loadKakomonTopic(nextItem, false);
      state.kakomonLoadedTopicIndex = nextIndex;
    }

    state.isLoadingMoreKakomon = false;
  }

  /**
   * Q&Aのお気に入り・保存ボタンにイベントをバインド
   */
  function bindQAFavoriteButtons() {
    if (typeof FavoritesManager === 'undefined' || !state.currentItem) return;

    const topicId = state.currentItem.id;
    let sectionIndex = 0;

    // セクション単位のボタンバインド
    elements.qaDisplay.querySelectorAll('.qa-section').forEach(section => {
      const sectionTitle = section.dataset.sectionTitle || `section_${sectionIndex}`;
      const favoriteBtn = section.querySelector('.qa-section-actions .favorite-btn');
      const saveBtn = section.querySelector('.qa-section-actions .save-image-btn');

      if (favoriteBtn) {
        const isFav = FavoritesManager.isFavoriteByParams('qa-section', topicId, sectionTitle);
        favoriteBtn.classList.toggle('active', isFav);

        favoriteBtn.addEventListener('click', function(e) {
          e.stopPropagation();

          // セクション内の全Q&Aを取得
          const qaItems = section.querySelectorAll('.qa-item');
          const qaList = [];
          qaItems.forEach(item => {
            const question = item.dataset.question || '';
            const answerEl = item.querySelector('.qa-answer');
            const answer = answerEl ? (answerEl.dataset.answer || answerEl.textContent) : '';
            qaList.push({ question, answer });
          });

          const content = {
            sectionTitle: sectionTitle,
            qaList: qaList
          };

          const isNowFavorite = FavoritesManager.toggle('qa-section', topicId, sectionTitle, content);
          this.classList.toggle('active', isNowFavorite);
        });
      }

      if (saveBtn) {
        saveBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          const filename = `QA_${topicId}_${sectionTitle}`;
          saveCardAsImage(section, filename);
        });
      }

      sectionIndex++;
    });

    // セクション外の個別Q&A（ボタンがあるもの）のバインド
    elements.qaDisplay.querySelectorAll('.qa-item').forEach(item => {
      // セクション内のQ&Aはスキップ（ボタンがない）
      const favoriteBtn = item.querySelector('.favorite-btn');
      const saveBtn = item.querySelector('.save-image-btn');
      if (!favoriteBtn && !saveBtn) return;

      const cardIndex = item.dataset.cardIndex;

      if (favoriteBtn) {
        const isFav = FavoritesManager.isFavoriteByParams('qa', topicId, cardIndex);
        favoriteBtn.classList.toggle('active', isFav);

        favoriteBtn.addEventListener('click', function(e) {
          e.stopPropagation();

          const question = item.dataset.question || '';
          const answerEl = item.querySelector('.qa-answer');
          const answer = answerEl ? (answerEl.dataset.answer || answerEl.textContent) : '';

          const content = {
            question: question,
            answer: answer
          };

          const isNowFavorite = FavoritesManager.toggle('qa', topicId, cardIndex, content);
          this.classList.toggle('active', isNowFavorite);
        });
      }

      if (saveBtn) {
        saveBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          const question = item.dataset.question || '';
          const filename = `QA_${topicId}_${question.substring(0, 20)}`;
          saveCardAsImage(item, filename);
        });
      }
    });
  }

  /**
   * Q&Aテキストをパース
   */
  function parseQA(text) {
    const lines = text.split('\n');
    let html = '';
    let currentSection = '';
    let inRelated = false;
    let relatedItems = [];
    let inTable = false;
    let tableRows = [];
    let qaIndex = 0; // Q&Aカードのインデックス

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Markdownテーブルの検出
      if (line.startsWith('|') && line.endsWith('|')) {
        // 区切り行（|---|---|）はスキップ
        if (line.match(/^\|[\s\-:|]+\|$/)) {
          inTable = true;
          continue;
        }
        // テーブル行
        if (!inTable && tableRows.length === 0) {
          // ヘッダー行
          tableRows.push({ cells: parseTableRow(line), isHeader: true });
        } else {
          // データ行
          inTable = true;
          tableRows.push({ cells: parseTableRow(line), isHeader: false });
        }
        continue;
      } else if (inTable || tableRows.length > 0) {
        // テーブル終了、HTMLに変換
        html += renderTable(tableRows);
        tableRows = [];
        inTable = false;
      }

      if (line.startsWith('## ')) {
        if (relatedItems.length > 0) {
          html += renderRelated(relatedItems);
          relatedItems = [];
        }
        inRelated = false;
        currentSection = line.slice(3);
        html += `<div class="qa-section" data-section-title="${escapeHtml(currentSection)}">
          <div class="qa-section-header">
            <div class="qa-section-title">${escapeHtml(currentSection)}</div>
            <div class="qa-section-actions">
              <button class="save-image-btn" aria-label="画像保存">${createSaveButtonSVG()}</button>
              <button class="favorite-btn" aria-label="お気に入り"><svg viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg></button>
            </div>
          </div>
          <div class="qa-section-content">`;
        continue;
      }

      if (line === '---') {
        if (relatedItems.length > 0) {
          html += renderRelated(relatedItems);
          relatedItems = [];
        }
        if (currentSection) {
          html += '</div></div>'; // qa-section-content と qa-section を閉じる
          currentSection = '';
        }
        inRelated = false;
        continue;
      }

      if (line === '[関連質問]') {
        inRelated = true;
        continue;
      }

      if (inRelated && line.startsWith('- ')) {
        relatedItems.push(line.slice(2));
        continue;
      }

      if (line.startsWith('Q: ')) {
        if (relatedItems.length > 0) {
          html += renderRelated(relatedItems);
          relatedItems = [];
        }
        inRelated = false;
        const question = line.slice(3);
        html += `<div class="qa-item" data-card-index="${qaIndex}" data-question="${escapeHtml(question)}">`;
        // セクションがない場合のみ個別ボタンを表示
        if (!currentSection) {
          html += `<button class="save-image-btn" aria-label="画像保存">${createSaveButtonSVG()}</button>`;
          html += `<button class="favorite-btn" aria-label="お気に入り"><svg viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg></button>`;
        }
        html += `<div class="qa-question">${escapeHtml(question)}</div>`;
        qaIndex++;
        continue;
      }

      if (line.startsWith('A: ')) {
        const answer = line.slice(3);
        html += `<div class="qa-answer" data-answer="${escapeHtml(answer)}">${escapeHtml(answer)}</div>`;
        html += `</div>`;
        continue;
      }
    }

    // 最後にテーブルが残っていれば出力
    if (tableRows.length > 0) {
      html += renderTable(tableRows);
    }

    if (relatedItems.length > 0) {
      html += renderRelated(relatedItems);
    }
    if (currentSection) {
      html += '</div></div>'; // qa-section-content と qa-section を閉じる
    }

    return html;
  }

  /**
   * Markdownテーブル行をパース
   */
  function parseTableRow(line) {
    return line.split('|').slice(1, -1).map(cell => cell.trim());
  }

  /**
   * テーブルをHTMLに変換
   */
  function renderTable(rows) {
    if (rows.length === 0) return '';

    let html = '<div class="qa-table-wrapper"><table class="qa-table">';

    for (const row of rows) {
      html += '<tr>';
      const tag = row.isHeader ? 'th' : 'td';
      for (const cell of row.cells) {
        html += `<${tag}>${escapeHtml(cell)}</${tag}>`;
      }
      html += '</tr>';
    }

    html += '</table></div>';
    return html;
  }

  /**
   * 関連質問を描画
   */
  function renderRelated(items) {
    if (items.length === 0) return '';
    return `<div class="qa-related"><strong>[関連]</strong> ${items.map(i => escapeHtml(i)).join(' / ')}</div>`;
  }

  /**
   * Q&Aで現在表示中のセクション名を取得
   */
  function getCurrentQASection() {
    const sections = elements.qaDisplay.querySelectorAll('.qa-section-title');
    const scrollTop = elements.qaContent.scrollTop;
    let currentSection = null;

    for (const section of sections) {
      const rect = section.getBoundingClientRect();
      const containerRect = elements.qaContent.getBoundingClientRect();
      // コンテナ上部から100px以内にある見出しを現在のセクションとする
      if (rect.top - containerRect.top <= 100) {
        currentSection = section.textContent.trim();
      }
    }
    return currentSection;
  }

  /**
   * HTMLで現在表示中のセクション名を取得
   */
  function getCurrentHTMLSection() {
    try {
      if (!elements.htmlDisplay) return null;

      const headings = elements.htmlDisplay.querySelectorAll('h1, h2, h3, h4');
      let currentSection = null;
      const containerRect = elements.htmlContent.getBoundingClientRect();

      for (const heading of headings) {
        const rect = heading.getBoundingClientRect();
        // コンテナ上部から100px以内にある見出しを現在のセクションとする
        if (rect.top - containerRect.top <= 100) {
          currentSection = heading.textContent.trim();
        }
      }
      return currentSection;
    } catch (e) {
      return null;
    }
  }

  /**
   * Q&Aで指定セクションにスクロール
   */
  function scrollToQASection(sectionName) {
    if (!sectionName) return false;

    const sections = elements.qaDisplay.querySelectorAll('.qa-section-title');
    let bestMatch = null;
    let bestScore = 0;
    const strippedSearch = stripBrackets(sectionName);

    for (const section of sections) {
      const text = section.textContent.trim();
      const strippedText = stripBrackets(text);
      let score = 0;

      // 完全一致は最高スコア
      if (text === sectionName) {
        score = 100;
      }
      // 括弧除去後の完全一致
      else if (strippedText === strippedSearch) {
        score = 90;
      }
      // 先頭が一致する場合は高スコア
      else if (text.startsWith(sectionName) || sectionName.startsWith(text)) {
        score = 50 + Math.min(text.length, sectionName.length);
      }
      // 括弧除去後の先頭一致
      else if (strippedText.startsWith(strippedSearch) || strippedSearch.startsWith(strippedText)) {
        score = 45 + Math.min(strippedText.length, strippedSearch.length);
      }
      // 部分一致（括弧除去後）
      else if (strippedText.includes(strippedSearch) || strippedSearch.includes(strippedText)) {
        score = Math.min(strippedText.length, strippedSearch.length);
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = section;
      }
    }

    if (bestMatch && bestScore >= 3) {
      const containerRect = elements.qaContent.getBoundingClientRect();
      const sectionRect = bestMatch.getBoundingClientRect();
      const offset = sectionRect.top - containerRect.top + elements.qaContent.scrollTop - 20;
      elements.qaContent.scrollTo({ top: offset, behavior: 'auto' });
      return true;
    }
    return false;
  }

  /**
   * 括弧内を除去してコアテキストを抽出
   */
  function stripBrackets(text) {
    return text
      .replace(/【[^】]*】/g, '')
      .replace(/（[^）]*）/g, '')
      .replace(/\([^)]*\)/g, '')
      .trim();
  }

  /**
   * HTMLで指定セクションにスクロール
   */
  function scrollToHTMLSection(sectionName) {
    if (!sectionName) return false;

    try {
      if (!elements.htmlDisplay) return false;

      const headings = elements.htmlDisplay.querySelectorAll('h1, h2, h3, h4');
      let bestMatch = null;
      let bestScore = 0;
      const strippedSearch = stripBrackets(sectionName);

      for (const heading of headings) {
        const text = heading.textContent.trim();
        const strippedText = stripBrackets(text);
        let score = 0;

        // 完全一致は最高スコア
        if (text === sectionName) {
          score = 100;
        }
        // 括弧除去後の完全一致
        else if (strippedText === strippedSearch) {
          score = 90;
        }
        // 先頭が一致する場合は高スコア
        else if (text.startsWith(sectionName) || sectionName.startsWith(text)) {
          score = 50 + Math.min(text.length, sectionName.length);
        }
        // 括弧除去後の先頭一致
        else if (strippedText.startsWith(strippedSearch) || strippedSearch.startsWith(strippedText)) {
          score = 45 + Math.min(strippedText.length, strippedSearch.length);
        }
        // 部分一致（括弧除去後）
        else if (strippedText.includes(strippedSearch) || strippedSearch.includes(strippedText)) {
          score = Math.min(strippedText.length, strippedSearch.length);
        }

        if (score > bestScore) {
          bestScore = score;
          bestMatch = heading;
        }
      }

      if (bestMatch && bestScore >= 3) {
        const containerRect = elements.htmlContent.getBoundingClientRect();
        const headingRect = bestMatch.getBoundingClientRect();
        const offset = headingRect.top - containerRect.top + elements.htmlContent.scrollTop - 20;
        elements.htmlContent.scrollTo({ top: offset, behavior: 'auto' });
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  /**
   * 現在表示中のトピックIDを取得（HTML）
   */
  function getCurrentHTMLTopicId() {
    try {
      const sections = elements.htmlDisplay.querySelectorAll('.topic-section');
      const containerRect = elements.htmlContent.getBoundingClientRect();

      for (const section of sections) {
        const rect = section.getBoundingClientRect();
        // セクションの上端がコンテナ内にあるものを見つける
        if (rect.top <= containerRect.top + 150 && rect.bottom > containerRect.top + 50) {
          return section.dataset.topicId || null;
        }
      }
      // 見つからなければ最初のセクション
      const firstSection = elements.htmlDisplay.querySelector('.topic-section');
      return firstSection ? firstSection.dataset.topicId : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * 現在表示中のトピックIDを取得（QA）
   */
  function getCurrentQATopicId() {
    try {
      const sections = elements.qaDisplay.querySelectorAll('.qa-topic-section');
      const containerRect = elements.qaContent.getBoundingClientRect();

      for (const section of sections) {
        const rect = section.getBoundingClientRect();
        if (rect.top <= containerRect.top + 150 && rect.bottom > containerRect.top + 50) {
          return section.dataset.topicId || null;
        }
      }
      const firstSection = elements.qaDisplay.querySelector('.qa-topic-section');
      return firstSection ? firstSection.dataset.topicId : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * 指定トピックIDの位置にスクロール（HTML）
   */
  function scrollToHTMLTopic(topicId) {
    if (!topicId) return false;
    const section = elements.htmlDisplay.querySelector(`.topic-section[data-topic-id="${topicId}"]`);
    if (section) {
      section.scrollIntoView({ behavior: 'auto', block: 'start' });
      return true;
    }
    return false;
  }

  /**
   * 指定トピックIDの位置にスクロール（QA）- 存在しなければ読み込む
   */
  async function scrollToQATopic(topicId) {
    if (!topicId) return false;

    // まず既存のセクションを探す
    let section = elements.qaDisplay.querySelector(`.qa-topic-section[data-topic-id="${topicId}"]`);

    if (!section) {
      // セクションがない場合、トピックを読み込む
      const item = DATA.find(d => d.id === topicId);
      if (item && item.qaPath) {
        await loadQATopic(item, false);
        // 読み込み後に再度セクションを探す
        section = elements.qaDisplay.querySelector(`.qa-topic-section[data-topic-id="${topicId}"]`);
      }
    }

    if (section) {
      section.scrollIntoView({ behavior: 'auto', block: 'start' });
      return true;
    }
    return false;
  }

  /**
   * 指定トピックIDの位置にスクロール（HTML）- 存在しなければ読み込む
   */
  async function scrollToHTMLTopic(topicId) {
    if (!topicId) return false;

    let section = elements.htmlDisplay.querySelector(`.topic-section[data-topic-id="${topicId}"]`);

    if (!section) {
      const item = DATA.find(d => d.id === topicId);
      if (item && item.htmlPath) {
        await loadTopicHTML(item, false);
        section = elements.htmlDisplay.querySelector(`.topic-section[data-topic-id="${topicId}"]`);
      }
    }

    if (section) {
      // ヘッダーの高さを考慮して上部付近に表示
      const headerHeight = 56 + 16;
      const containerRect = elements.htmlContent.getBoundingClientRect();
      const sectionRect = section.getBoundingClientRect();
      const targetY = elements.htmlContent.scrollTop + sectionRect.top - containerRect.top - headerHeight;

      elements.htmlContent.scrollTo({
        top: Math.max(0, targetY),
        behavior: 'smooth'
      });

      // ハイライトアニメーション
      section.classList.add('topic-highlight');
      setTimeout(() => section.classList.remove('topic-highlight'), 1500);
      return true;
    }
    return false;
  }

  /**
   * タブを切り替え
   * @param {string} tab - 切り替え先のタブ
   * @param {boolean} skipHistory - trueの場合、履歴にpushしない（popstate時）
   * @param {boolean} skipScroll - trueの場合、自動スクロールをスキップ（検索ジャンプ時など）
   */
  function switchTab(tab, skipHistory = false, skipScroll = false) {
    const prevTab = state.currentTab;

    // 同じタブなら何もしない（初期化済みの場合のみ）
    if (prevTab === tab && scrollHistory.initialized) return;

    // タブ切り替え時はフローティング検索バーを閉じる
    hideFloatingSearch();

    // 履歴にpush（popstate以外かつ初期化済みの場合）
    if (!skipHistory && scrollHistory.initialized) {
      pushScrollState(tab);
    }

    // 切り替え前のトピックIDとセクション名を取得
    let currentTopicId = null;
    let currentSection = null;

    if (prevTab === 'html') {
      currentTopicId = getCurrentHTMLTopicId();
      currentSection = getCurrentHTMLSection();
    }

    state.currentTab = tab;
    // 前回のタブを保存
    localStorage.setItem('studyViewer_lastTab', tab);

    elements.tabs.forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tab);
    });

    elements.htmlContent.classList.toggle('active', tab === 'html');
    if (elements.kakomonContent) {
      elements.kakomonContent.classList.toggle('active', tab === 'kakomon');
    }
    if (elements.flashcardContent) {
      elements.flashcardContent.classList.toggle('active', tab === 'flashcard');
      if (tab === 'flashcard' && typeof FlashcardModule !== 'undefined') {
        FlashcardModule.show();
        // 演習タブではFABを非表示
        if (elements.toolFab) elements.toolFab.style.display = 'none';
      } else if (prevTab === 'flashcard' && typeof FlashcardModule !== 'undefined') {
        // 演習タブから離れる時にセッションを保存
        FlashcardModule.saveSession();
      }
    }

    // 目次・読書モード機能の切り替え
    if (tab === 'html') {
      // まとめタブに切り替えたら目次・読書モード・過去問カード・画像遅延読み込みを初期化
      setTimeout(() => {
        initTOC();
        initReadingMode();
        initQuestionCards();
        initLazyImages();
      }, 100);
    } else if (prevTab === 'html') {
      // まとめタブから離れたらクリーンアップ
      cleanupTOC();
      cleanupReadingMode();
      cleanupLazyImages();
    }

    // 新しいタブにスクロール（トピックID優先、セクション名、最後にトップ）
    // skipScroll=true の場合はスキップ（検索からのジャンプ時など）
    if (!skipScroll) {
      // 非同期処理のためsetTimeoutではなくasync即時関数
      (async () => {
        let scrolled = false;

        // まずトピックIDでスクロールを試みる（存在しなければ読み込む）
        if (tab === 'html' && currentTopicId) {
          scrolled = await scrollToHTMLTopic(currentTopicId);
        }

        // トピックが見つからなければセクション名で試みる
        if (!scrolled && currentSection) {
          if (tab === 'html') {
            scrolled = scrollToHTMLSection(currentSection);
          }
        }

        // それでも見つからなければトップにスクロール
        if (!scrolled) {
          if (tab === 'html') {
            elements.htmlContent.scrollTop = 0;
          }
        }
      })();
    }
  }

  /**
   * Q&A表示モードを切り替え
   */
  function toggleQAMode() {
    // 1. 切り替え前に現在見えている要素の位置を記録
    const container = elements.qaContent;
    const items = elements.qaDisplay.querySelectorAll('.qa-item');
    let anchorElement = null;
    let anchorOffset = 0;

    for (const item of items) {
      const rect = item.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      // コンテナ内で見えている要素を探す
      if (rect.top >= containerRect.top && rect.top < containerRect.bottom) {
        anchorElement = item;
        anchorOffset = rect.top - containerRect.top;
        break;
      }
    }

    // 2. 状態を切り替え
    state.qaShowAll = !state.qaShowAll;
    elements.qaDisplay.classList.toggle('show-all', state.qaShowAll);

    // 折りたたむ時は手動で開いたQ&Aも全て閉じる
    if (!state.qaShowAll) {
      elements.qaDisplay.querySelectorAll('.qa-answer.show').forEach(el => {
        el.classList.remove('show');
      });
    }

    // ボタンがあれば更新
    const qaModeToggle = document.getElementById('qa-mode-toggle');
    if (qaModeToggle) {
      qaModeToggle.classList.toggle('active', state.qaShowAll);
      qaModeToggle.textContent = state.qaShowAll ? '折りたたむ' : '全て表示';
    }

    // トグルボタンを更新
    if (elements.qaToggleBtn) {
      elements.qaToggleBtn.classList.toggle('active', state.qaShowAll);
      elements.qaToggleBtn.textContent = state.qaShowAll ? '折りたたむ' : '全て表示';
    }

    // フローティングトグルボタンを更新
    if (elements.qaFloatingToggle) {
      elements.qaFloatingToggle.classList.toggle('active', state.qaShowAll);
      elements.qaFloatingToggle.querySelector('span').textContent = state.qaShowAll ? '折りたたむ' : '全て表示';
    }

    // 3. アンカー要素の位置を復元
    if (anchorElement) {
      requestAnimationFrame(() => {
        const newRect = anchorElement.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const newOffset = newRect.top - containerRect.top;
        const diff = newOffset - anchorOffset;
        container.scrollTop += diff;
      });
    }
  }

  /**
   * 状態を保存
   */
  function saveState() {
    if (state.currentItem) {
      localStorage.setItem('studyViewer_lastItem', state.currentItem.id);
    }
  }

  /**
   * 状態を復元
   */
  function restoreState() {
    const hasVisited = localStorage.getItem('studyViewer_visited');
    const lastItemId = localStorage.getItem('studyViewer_lastItem');

    // 初回訪問時はウェルカム画面を表示（復元しない）
    if (!hasVisited) {
      localStorage.setItem('studyViewer_visited', 'true');
      // FABを非表示（ウェルカム画面では不要）
      if (elements.toolFab) {
        elements.toolFab.style.display = 'none';
      }
      return;
    }

    // 2回目以降は前回のトピックを復元
    if (lastItemId) {
      selectItem(lastItemId);
    } else {
      // 復元するトピックがない場合もFABを非表示
      if (elements.toolFab) {
        elements.toolFab.style.display = 'none';
      }
    }
  }

  /**
   * HTMLエスケープ
   */
  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * カードを画像として保存（プレビュー表示→長押しで保存）
   */
  async function saveCardAsImage(element, filename) {
    if (typeof html2canvas === 'undefined') {
      alert('画像保存機能を読み込めませんでした');
      return;
    }

    // ローディング表示
    const loadingOverlay = document.createElement('div');
    loadingOverlay.className = 'saving-overlay';
    loadingOverlay.innerHTML = '<div class="saving-spinner">画像を生成中...</div>';
    document.body.appendChild(loadingOverlay);

    // Q&Aの答えを一時的に表示（画像に含めるため）
    const hiddenAnswers = [];
    const answers = element.querySelectorAll('.qa-answer');
    answers.forEach(answer => {
      if (!answer.classList.contains('show') && getComputedStyle(answer).display === 'none') {
        answer.style.display = 'block';
        hiddenAnswers.push(answer);
      }
    });

    try {
      const originalCanvas = await html2canvas(element, {
        backgroundColor: '#ffffff',
        scale: 2,
        useCORS: true,
        logging: false,
        // キャプチャ用クローンのみライトモードに（画面は変わらない）
        onclone: (clonedDoc) => {
          clonedDoc.documentElement.setAttribute('data-theme', 'light');
        }
      });

      // 余白を追加した新しいcanvasを作成
      const padding = 40; // 余白のサイズ（px）
      const canvas = document.createElement('canvas');
      canvas.width = originalCanvas.width + padding * 2;
      canvas.height = originalCanvas.height + padding * 2;
      const ctx = canvas.getContext('2d');

      // 背景を白で塗りつぶし
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // 元の画像を中央に配置
      ctx.drawImage(originalCanvas, padding, padding);

      const dataUrl = canvas.toDataURL('image/png');

      // プレビューオーバーレイを作成（長押しで保存）
      const previewOverlay = document.createElement('div');
      previewOverlay.className = 'image-preview-overlay';
      previewOverlay.innerHTML = `
        <div class="image-preview-container">
          <div class="image-preview-header">
            <span>長押しで写真に保存</span>
            <button class="image-preview-close">✕</button>
          </div>
          <div class="image-preview-body">
            <img src="${dataUrl}" alt="${filename}" />
          </div>
        </div>
      `;
      document.body.appendChild(previewOverlay);

      // 閉じるボタン
      previewOverlay.querySelector('.image-preview-close').addEventListener('click', () => {
        previewOverlay.remove();
      });

      // オーバーレイ背景クリックで閉じる
      previewOverlay.addEventListener('click', (e) => {
        if (e.target === previewOverlay) {
          previewOverlay.remove();
        }
      });

    } catch (err) {
      console.error('画像保存エラー:', err);
      alert('画像の生成に失敗しました');
    } finally {
      // 一時的に表示した答えを非表示に戻す
      hiddenAnswers.forEach(answer => {
        answer.style.display = '';
      });
      loadingOverlay.remove();
    }
  }

  /**
   * 保存ボタンのSVGアイコンを生成（画像アイコン）
   */
  function createSaveButtonSVG() {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <circle cx="8.5" cy="8.5" r="1.5"/>
      <path d="M21 15l-5-5L5 21"/>
    </svg>`;
  }

  // グローバルに公開（kakomon.jsから使用）
  window.saveCardAsImage = saveCardAsImage;
  window.createSaveButtonSVG = createSaveButtonSVG;

  // ===== ノート（お気に入り）機能 =====

  /**
   * ノートオーバーレイを開く
   */
  function openNoteOverlay() {
    if (elements.noteOverlay) {
      elements.noteOverlay.classList.add('open');
      renderNoteTimeline();
      // 閲覧時刻を保存（リロード後も維持）
      state.lastNoteViewTime = Date.now();
      localStorage.setItem('studyViewer_lastNoteViewTime', state.lastNoteViewTime.toString());
      // バッジを非表示
      if (elements.noteBadge) {
        elements.noteBadge.style.display = 'none';
      }
    }
  }

  /**
   * ノートオーバーレイを閉じる
   */
  function closeNoteOverlay() {
    if (elements.noteOverlay) {
      elements.noteOverlay.classList.remove('open');
    }
  }

  /**
   * ノートバッジを更新
   */
  function updateNoteBadge() {
    if (!elements.noteBadge || typeof FavoritesManager === 'undefined') return;

    const allFavorites = FavoritesManager.getAll();
    const totalCount = allFavorites.length;

    // カウント表示は常に総数を更新
    if (elements.noteCount) {
      elements.noteCount.textContent = totalCount + '件';
    }

    // バッジ表示：最後に閲覧した時刻以降に追加されたお気に入りの数
    const newCount = allFavorites.filter(fav => fav.addedAt > state.lastNoteViewTime).length;

    if (newCount > 0) {
      elements.noteBadge.textContent = newCount > 99 ? '99+' : newCount;
      elements.noteBadge.style.display = 'flex';
    } else {
      elements.noteBadge.style.display = 'none';
    }
  }

  /**
   * ノートタイムラインを描画
   */
  function renderNoteTimeline() {
    if (!elements.noteTimeline || typeof FavoritesManager === 'undefined') return;

    const favorites = FavoritesManager.getAll();

    // 空状態の表示切り替え
    if (elements.noteEmpty) {
      elements.noteEmpty.classList.toggle('hidden', favorites.length > 0);
    }

    // カード部分をクリア（空状態以外）
    const existingCards = elements.noteTimeline.querySelectorAll('.note-card');
    existingCards.forEach(card => card.remove());

    if (favorites.length === 0) return;

    // カードを生成
    favorites.forEach(function(item) {
      const card = createNoteCard(item);
      elements.noteTimeline.appendChild(card);
    });
  }

  /**
   * ノートカードを生成
   */
  function createNoteCard(item) {
    const card = document.createElement('div');
    card.className = 'note-card';
    card.dataset.id = item.id;

    // タイプラベル
    const typeLabels = {
      html: 'まとめ',
      qa: 'Q&A',
      kakomon: '過去問'
    };

    // ヘッダー
    const header = document.createElement('div');
    header.className = 'note-card-header';
    header.innerHTML = `
      <span class="note-card-type ${item.type}">${typeLabels[item.type] || item.type}</span>
      <span class="note-card-topic">${escapeHtml(item.topicId)}</span>
      <button class="save-image-btn" aria-label="画像保存">
        ${createSaveButtonSVG()}
      </button>
      <button class="note-card-delete" data-id="${escapeHtml(item.id)}" aria-label="削除">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
    `;

    // 保存ボタンのイベント
    const saveBtn = header.querySelector('.save-image-btn');
    saveBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      const filename = `${typeLabels[item.type]}_${item.topicId}_${item.cardIndex}`;
      saveCardAsImage(content, filename);
    });

    // 削除ボタンのイベント
    const deleteBtn = header.querySelector('.note-card-delete');
    deleteBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      const id = this.dataset.id;
      FavoritesManager.remove(id);
      card.remove();

      // 空状態の再チェック
      if (FavoritesManager.count() === 0 && elements.noteEmpty) {
        elements.noteEmpty.classList.remove('hidden');
      }
    });

    // コンテンツ
    const content = document.createElement('div');
    content.className = 'note-card-content ' + item.type + '-content';

    if (item.type === 'html') {
      // まとめカード
      content.innerHTML = item.content.html || '<p>コンテンツなし</p>';
    } else if (item.type === 'qa') {
      // Q&Aカード - タップで答えを表示
      content.innerHTML = `
        <div class="qa-q">${escapeHtml(item.content.question)}</div>
        <div class="qa-tap-hint">タップで答えを表示</div>
        <div class="qa-a">${escapeHtml(item.content.answer)}</div>
      `;
      // 質問タップで答えを表示
      const qaQ = content.querySelector('.qa-q');
      const qaA = content.querySelector('.qa-a');
      const hint = content.querySelector('.qa-tap-hint');
      qaQ.addEventListener('click', function() {
        qaA.classList.toggle('show');
        hint.style.display = qaA.classList.contains('show') ? 'none' : 'block';
      });
    } else if (item.type === 'kakomon') {
      // 過去問カード（全文表示）
      const questionText = item.content.text || item.content.question || '';
      const answerText = item.content.answer || '';
      const numChoices = item.content.numChoices || '1';
      const choices = item.content.choices || {};
      const images = item.content.images || [];

      // 画像HTML
      let imagesHtml = '';
      if (images.length > 0) {
        imagesHtml = `<div class="note-kakomon-images">${images.map(src => `<img src="${escapeHtml(src)}" alt="問題画像">`).join('')}</div>`;
      }

      // 選択肢HTML
      let choicesHtml = '';
      const choiceEntries = Object.entries(choices);
      if (choiceEntries.length > 0) {
        choicesHtml = `<div class="note-kakomon-choices">${choiceEntries.map(([key, value]) => `<div class="note-choice"><span class="note-choice-label">${escapeHtml(key)}</span>${escapeHtml(value)}</div>`).join('')}</div>`;
      }

      content.innerHTML = `
        <span class="kakomon-code-badge">${escapeHtml(item.content.code || item.cardIndex)}</span>
        <div class="kakomon-q">${escapeHtml(questionText)}</div>
        ${imagesHtml}
        <div class="kakomon-instruction">${numChoices > 1 ? numChoices + 'つ選べ。' : '1つ選べ。'}</div>
        ${choicesHtml}
        <div class="kakomon-answer">正解: ${escapeHtml(answerText)}</div>
      `;
    }

    card.appendChild(header);
    card.appendChild(content);

    return card;
  }

  /**
   * お気に入りボタンのSVG
   */
  function getFavoriteButtonHTML(isActive) {
    const activeClass = isActive ? 'active' : '';
    return `
      <button class="favorite-btn ${activeClass}" aria-label="お気に入り">
        <svg viewBox="0 0 24 24">
          <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
        </svg>
      </button>
    `;
  }

  /**
   * まとめHTML（iframe内）にお気に入りボタンを注入
   */
  function injectFavoriteButtons(iframe, item) {
    if (typeof FavoritesManager === 'undefined') return;

    try {
      const doc = iframe.contentDocument || iframe.contentWindow.document;
      if (!doc) return;

      const topicId = item.id;
      let cardIndex = 0;

      // お気に入りボタン用のCSS
      const style = doc.createElement('style');
      style.id = 'favorite-btn-style';
      style.textContent = `
        .html-card-wrapper {
          position: relative;
          margin: 16px 0;
          padding: 16px;
          background: white;
          border-radius: 12px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.06);
        }
        .html-card-wrapper .favorite-btn {
          position: absolute;
          top: 8px;
          right: 8px;
          width: 32px;
          height: 32px;
          border: none;
          background: rgba(0, 0, 0, 0.03);
          border-radius: 50%;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s ease;
          z-index: 10;
        }
        .html-card-wrapper .favorite-btn:hover {
          transform: scale(1.1);
          background: rgba(0, 0, 0, 0.08);
        }
        .html-card-wrapper .favorite-btn:active {
          transform: scale(0.9);
        }
        .html-card-wrapper .favorite-btn svg {
          width: 18px;
          height: 18px;
          fill: #d1d1d6;
          transition: fill 0.2s ease;
        }
        .html-card-wrapper .favorite-btn.active svg {
          fill: #ff9500;
        }
      `;
      doc.head.appendChild(style);

      // h3要素をカード化
      const h3Elements = doc.querySelectorAll('.container h3');
      h3Elements.forEach((h3, index) => {
        // 既にラップ済みならスキップ
        if (h3.parentElement.classList.contains('html-card-wrapper')) return;

        // h3と次のh3/h2までの要素を収集
        const cardContent = collectContentUntilNextHeading(h3);

        // ラッパーを作成
        const wrapper = doc.createElement('div');
        wrapper.className = 'html-card-wrapper';
        wrapper.dataset.cardIndex = cardIndex;
        wrapper.dataset.title = h3.textContent;

        // お気に入りボタンを追加
        const isFav = FavoritesManager.isFavoriteByParams('html', topicId, cardIndex);
        const btn = doc.createElement('button');
        btn.className = 'favorite-btn' + (isFav ? ' active' : '');
        btn.setAttribute('aria-label', 'お気に入り');
        btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>';

        // クリックイベント
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          e.preventDefault();

          const content = {
            title: h3.textContent,
            html: cardContent
          };

          const isNowFavorite = FavoritesManager.toggle('html', topicId, wrapper.dataset.cardIndex, content);
          this.classList.toggle('active', isNowFavorite);
        });

        // h3の前にラッパーを挿入
        h3.parentNode.insertBefore(wrapper, h3);
        wrapper.appendChild(btn);
        wrapper.appendChild(h3);

        cardIndex++;
      });

    } catch (e) {
      console.log('[Favorites] iframe注入エラー:', e);
    }
  }

  /**
   * h3から次の見出しまでのコンテンツを収集（HTMLとして）
   */
  function collectContentUntilNextHeading(h3) {
    let html = h3.outerHTML;
    let sibling = h3.nextElementSibling;

    while (sibling) {
      const tagName = sibling.tagName.toLowerCase();
      // 次の見出しまたはhtml-card-wrapperで停止
      if (tagName === 'h2' || tagName === 'h3' || sibling.classList.contains('html-card-wrapper')) {
        break;
      }
      // point-boxは含めない（別カード扱い）
      if (sibling.classList.contains('point-box')) {
        break;
      }
      html += sibling.outerHTML;
      sibling = sibling.nextElementSibling;
    }

    return html;
  }

  // グローバルに公開（他モジュールから使用するため）
  window.FavoritesUI = {
    getFavoriteButtonHTML: getFavoriteButtonHTML,
    renderNoteTimeline: renderNoteTimeline
  };

  // ===== 目次機能 =====

  /**
   * 目次を初期化（まとめタブ表示時）
   */
  function initTOC() {
    if (!elements.htmlDisplay) return;

    // 見出しを収集（topic-section-content内のみ、ラッパーh2は除外）
    const headings = elements.htmlDisplay.querySelectorAll('.topic-section-content h2, .topic-section-content h3');
    tocState.headings = Array.from(headings).map((h, i) => {
      h.dataset.tocIndex = i;
      return {
        element: h,
        text: h.textContent.trim(),
        level: parseInt(h.tagName.charAt(1))
      };
    });

    // h2があるか検出（コンテンツ内の実際のh2のみ）
    tocState.hasH2 = tocState.headings.some(h => h.level === 2);

    // 初期モードはmedium
    tocState.mode = 'medium';

    if (tocState.headings.length === 0) {
      hideToolButtons();
      return;
    }

    // 目次ボタンを表示
    showToolButtons();

    // IntersectionObserverをセットアップ
    setupTOCObserver();

    // 目次リストを構築
    buildTOCList();

    // イベントをバインド
    bindTOCEvents();
  }

  /**
   * ツールボタンを表示（まとめタブ用）
   */
  function showToolButtons() {
    if (elements.toolFab) elements.toolFab.style.display = 'flex';
    // prev-heading-btnは条件付き表示のため、ここでは制御しない
  }

  /**
   * ツールボタンを非表示
   */
  function hideToolButtons() {
    if (elements.toolFab) elements.toolFab.style.display = 'none';
    if (elements.prevHeadingBtn) elements.prevHeadingBtn.style.display = 'none';
  }

  /**
   * IntersectionObserverで現在の見出しを追跡
   */
  function setupTOCObserver() {
    // 既存のオブザーバーをクリア
    if (tocState.observer) {
      tocState.observer.disconnect();
    }

    const headerHeight = 56 + 44; // ヘッダー + 余裕

    tocState.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const index = parseInt(entry.target.dataset.tocIndex);
            if (!isNaN(index)) {
              tocState.currentHeadingIndex = index;
              updateTOCHighlight(index);
            }
          }
        });
      },
      {
        rootMargin: `-${headerHeight}px 0px -60% 0px`,
        threshold: 0
      }
    );

    // 見出しを監視
    tocState.headings.forEach(h => {
      tocState.observer.observe(h.element);
    });
  }

  /**
   * 検索キーワードをハイライト表示する
   */
  function highlightSearchText(text, query) {
    if (!query || query.length === 0) return escapeHtml(text);
    // 正規表現の特殊文字をエスケープ
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escaped})`, 'gi');
    // テキストをエスケープしてからハイライト適用
    const escapedText = escapeHtml(text);
    return escapedText.replace(regex, '<mark>$1</mark>');
  }

  /**
   * 検索用テキスト正規化（全角/半角、記号、番号を統一）
   */
  function normalizeForSearch(text) {
    return text
      // 全角英数字→半角
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
      // 全角スペース→半角
      .replace(/　/g, ' ')
      // 番号プレフィックス除去（1. ① ア. など）
      .replace(/^[\d０-９]+[.．、]\s*/g, '')
      .replace(/^[①②③④⑤⑥⑦⑧⑨⑩]\s*/g, '')
      .replace(/^[ア-ン][.．、_]\s*/g, '')
      // 記号を除去（■□●○など）
      .replace(/[■□●○▶▷◆◇★☆]/g, '')
      .toLowerCase()
      .trim();
  }

  /**
   * 目次リストを構築（2段階対応：medium/full）
   */
  function buildTOCList(filter = '') {
    if (!elements.tocList) return;

    const filterNormalized = normalizeForSearch(filter);
    const isFiltering = filter.length > 0;
    const isFull = tocState.mode === 'full' || isFiltering;

    // 見出しがない場合
    if (tocState.headings.length === 0) {
      elements.tocList.innerHTML = `<div class="toc-empty">見出しがありません</div>`;
      return;
    }

    // HTMLを構築
    let html = '';

    tocState.headings.forEach((heading, index) => {
      const text = heading.text;
      const level = heading.level;
      const isCurrent = index === tocState.currentHeadingIndex;

      // フィルタチェック（正規化して比較）
      if (isFiltering) {
        const textNormalized = normalizeForSearch(text);
        if (!textNormalized.includes(filterNormalized)) {
          return;
        }
      }

      // Medium時の表示ルール：
      // - h2がある場合 → h2のみ表示
      // - h2がない場合 → h3を章扱いで表示
      if (!isFull) {
        if (tocState.hasH2) {
          if (level !== 2) return; // h2のみ
        } else {
          if (level !== 3) return; // h3のみ（h2がない場合）
        }
      }

      // 長いテキストは省略
      const displayText = text.length > 35 ? text.substring(0, 35) + '…' : text;

      // h2がない場合、h3を章スタイルで表示
      const isChapter = (level === 2) || (!tocState.hasH2 && level === 3);

      // 検索マッチ時のクラスとテキスト表示
      const matchClass = isFiltering ? ' toc-search-match' : '';
      const displayHtml = isFiltering ? highlightSearchText(displayText, filter) : escapeHtml(displayText);

      if (isChapter) {
        // 章として表示（太字・大きめ）
        html += `
          <button class="toc-item toc-h2${matchClass} ${isCurrent ? 'current' : ''}" data-index="${index}">
            <span class="toc-item-bar"></span>
            <span class="toc-item-text">${displayHtml}</span>
          </button>
        `;
      } else if (level === 3) {
        // 節として表示（インデント） - Full時のみ
        html += `
          <button class="toc-item toc-h3${matchClass} ${isCurrent ? 'current' : ''}" data-index="${index}">
            <span class="toc-item-bar"></span>
            <span class="toc-item-text">${displayHtml}</span>
          </button>
        `;
      }
      // H4以下は省略
    });

    if (html === '') {
      if (isFiltering) {
        elements.tocList.innerHTML = `<div class="toc-no-results">見つかりません</div>`;
      } else {
        elements.tocList.innerHTML = `<div class="toc-empty">見出しがありません</div>`;
      }
    } else {
      elements.tocList.innerHTML = html;
    }
  }

  /**
   * 目次のハイライトを更新
   */
  function updateTOCHighlight(index) {
    if (!elements.tocList) return;

    const items = elements.tocList.querySelectorAll('.toc-item');
    items.forEach(item => {
      const itemIndex = parseInt(item.dataset.index);
      if (itemIndex === index) {
        item.classList.add('current');
      } else {
        item.classList.remove('current');
      }
    });
  }

  /**
   * 目次シートを開く
   */
  function openTOC() {
    if (!elements.tocOverlay) return;

    // 現在のスクロール位置を記録
    const container = elements.htmlContent;
    tocState.previousScrollY = container ? container.scrollTop : 0;

    // ターゲットトピックをリセット（スクロール位置から取得するように）
    tocState.targetTopicId = null;

    // 「元の位置へ」ボタンを隠す（まだジャンプしていない）
    if (elements.tocBackBtn) {
      elements.tocBackBtn.style.display = 'none';
    }

    // Mediumモードで開始
    setTocMode('medium');

    // 現在地を更新
    updateTocNow();

    // 前後トピックボタンを更新
    updateTopicNavButtons();

    // 目次リストを再構築（現在位置のハイライト付き）
    buildTOCList(elements.tocSearchInput?.value || '');

    // シートを開く
    elements.tocOverlay.classList.add('open');
    document.body.style.overflow = 'hidden';

    // 現在の見出しまでスクロール
    setTimeout(() => {
      const currentItem = elements.tocList?.querySelector('.toc-item.current');
      if (currentItem) {
        currentItem.scrollIntoView({ block: 'center', behavior: 'instant' });
      }
    }, 100);
  }

  /**
   * 目次シートを閉じる
   */
  function closeTOC() {
    if (!elements.tocOverlay) return;

    elements.tocOverlay.classList.remove('open');
    document.body.style.overflow = '';

    // 検索をクリア
    if (elements.tocSearchInput) {
      elements.tocSearchInput.value = '';
    }

    // モードをリセット
    tocState.mode = 'medium';
  }

  /**
   * TOCモードを設定（medium/full）
   */
  function setTocMode(mode) {
    tocState.mode = mode;
    if (elements.tocSheet) {
      if (mode === 'full') {
        elements.tocSheet.classList.add('toc-full');
      } else {
        elements.tocSheet.classList.remove('toc-full');
      }
    }
    // リスト再構築（モードに応じた表示）
    buildTOCList(elements.tocSearchInput?.value || '');
  }

  /**
   * 現在地（Now）表示を更新
   */
  function updateTocNow() {
    if (!elements.tocNowText) return;

    const current = tocState.headings[tocState.currentHeadingIndex];
    if (current) {
      const text = current.text.length > 40 ? current.text.substring(0, 40) + '…' : current.text;
      elements.tocNowText.textContent = text;
    } else {
      elements.tocNowText.textContent = '-';
    }
  }

  /**
   * 前後トピックボタンの状態を更新
   * @param {string} [targetTopicId] - 指定した場合、このトピックを基準にボタンを更新
   */
  function updateTopicNavButtons(targetTopicId = null) {
    if (!elements.tocPrevTopic || !elements.tocNextTopic) return;

    // 読み込み済みトピックを取得
    const loadedTopics = getLoadedTopicIds();
    const currentTopicId = targetTopicId || getCurrentTopicId();

    if (loadedTopics.length === 0 || !currentTopicId) {
      elements.tocPrevTopic.disabled = true;
      elements.tocNextTopic.disabled = true;
      return;
    }

    // DATA内でのインデックスを取得
    const currentDataIndex = DATA.findIndex(d => d.id === currentTopicId);
    if (currentDataIndex === -1) {
      elements.tocPrevTopic.disabled = true;
      elements.tocNextTopic.disabled = true;
      return;
    }

    // 前後のトピックがあるか確認（DATA順）
    const hasPrev = currentDataIndex > 0;
    const hasNext = currentDataIndex < DATA.length - 1;

    elements.tocPrevTopic.disabled = !hasPrev;
    elements.tocNextTopic.disabled = !hasNext;

    // ボタンテキストにトピック名を表示（オプション）
    if (hasPrev) {
      const prevTopic = DATA[currentDataIndex - 1];
      const prevTitle = (prevTopic.title || prevTopic.id).replace(/^[ア-ン]_/, '');
      elements.tocPrevTopic.querySelector('.toc-topic-btn-text').textContent =
        prevTitle.length > 10 ? prevTitle.substring(0, 10) + '…' : prevTitle;
    } else {
      elements.tocPrevTopic.querySelector('.toc-topic-btn-text').textContent = '前のトピック';
    }

    if (hasNext) {
      const nextTopic = DATA[currentDataIndex + 1];
      const nextTitle = (nextTopic.title || nextTopic.id).replace(/^[ア-ン]_/, '');
      elements.tocNextTopic.querySelector('.toc-topic-btn-text').textContent =
        nextTitle.length > 10 ? nextTitle.substring(0, 10) + '…' : nextTitle;
    } else {
      elements.tocNextTopic.querySelector('.toc-topic-btn-text').textContent = '次のトピック';
    }
  }

  /**
   * 読み込み済みトピックIDを取得
   */
  function getLoadedTopicIds() {
    const sections = elements.htmlDisplay?.querySelectorAll('.topic-section[data-topic-id]') || [];
    return Array.from(sections).map(s => s.dataset.topicId);
  }

  /**
   * 現在表示中のトピックIDを取得
   */
  function getCurrentTopicId() {
    if (!elements.htmlContent || !elements.htmlDisplay) return null;

    const sections = elements.htmlDisplay.querySelectorAll('.topic-section[data-topic-id]');
    if (sections.length === 0) return null;

    // スクロール位置から現在のトピックを判定
    const containerRect = elements.htmlContent.getBoundingClientRect();
    const headerHeight = 80;

    for (const section of sections) {
      const rect = section.getBoundingClientRect();
      // セクションの上部がヘッダー下にあれば現在のトピック
      if (rect.top <= containerRect.top + headerHeight && rect.bottom > containerRect.top + headerHeight) {
        return section.dataset.topicId;
      }
    }

    // 最初のセクションを返す
    return sections[0]?.dataset.topicId || null;
  }

  /**
   * 前のトピックへ移動
   */
  async function goToPrevTopic() {
    const prevBtn = elements.tocPrevTopic;
    if (!prevBtn || prevBtn.disabled) return;

    // tocState.targetTopicId があればそれを基準に、なければスクロール位置から
    const baseTopicId = tocState.targetTopicId || getCurrentTopicId();
    if (!baseTopicId) return;

    const currentIndex = DATA.findIndex(d => d.id === baseTopicId);
    if (currentIndex <= 0) return;

    const prevTopic = DATA[currentIndex - 1];

    // ターゲットを更新（連続クリック対応）
    tocState.targetTopicId = prevTopic.id;

    // TOCは閉じずに読み込み＆スクロール
    await loadAndScrollToTopic(prevTopic.id);
    // ボタンを更新（移動先トピックを基準に）
    updateTopicNavButtons(prevTopic.id);
    // 現在地も更新
    updateTocNow();
  }

  /**
   * 次のトピックへ移動
   */
  async function goToNextTopic() {
    const nextBtn = elements.tocNextTopic;
    if (!nextBtn || nextBtn.disabled) return;

    // tocState.targetTopicId があればそれを基準に、なければスクロール位置から
    const baseTopicId = tocState.targetTopicId || getCurrentTopicId();
    if (!baseTopicId) return;

    const currentIndex = DATA.findIndex(d => d.id === baseTopicId);
    if (currentIndex === -1 || currentIndex >= DATA.length - 1) return;

    const nextTopic = DATA[currentIndex + 1];

    // ターゲットを更新（連続クリック対応）
    tocState.targetTopicId = nextTopic.id;

    // TOCは閉じずに読み込み＆スクロール
    await loadAndScrollToTopic(nextTopic.id);
    // ボタンを更新（移動先トピックを基準に）
    updateTopicNavButtons(nextTopic.id);
    // 現在地も更新
    updateTocNow();
  }

  /**
   * 見出しへジャンプ
   */
  function jumpToHeading(index) {
    if (index < 0 || index >= tocState.headings.length) return;

    const heading = tocState.headings[index];
    if (!heading || !heading.element) return;

    // スクロールコンテナを取得
    const container = elements.htmlContent;
    if (!container) return;

    // ジャンプ前の位置を保存
    tocState.previousScrollY = container.scrollTop;

    // 「元の位置へ」ボタンを表示
    if (elements.tocBackBtn) {
      elements.tocBackBtn.style.display = 'flex';
    }

    // シートを閉じる
    closeTOC();

    // スクロール（コンテナ内）
    const headerHeight = 56 + 16; // ヘッダー + 余裕
    const containerRect = container.getBoundingClientRect();
    const headingRect = heading.element.getBoundingClientRect();
    const targetY = container.scrollTop + headingRect.top - containerRect.top - headerHeight;

    container.scrollTo({
      top: targetY,
      behavior: 'smooth'
    });

    // ジャンプ先をハイライト（2秒間）
    heading.element.classList.add('jump-highlight');
    setTimeout(() => {
      heading.element.classList.remove('jump-highlight');
    }, 2000);

    // 現在位置を更新
    tocState.currentHeadingIndex = index;
  }

  /**
   * 元の位置へ戻る
   */
  function returnToPreviousPosition() {
    if (tocState.previousScrollY === null) return;

    const container = elements.htmlContent;
    if (container) {
      container.scrollTo({
        top: tocState.previousScrollY,
        behavior: 'smooth'
      });
    }

    tocState.previousScrollY = null;

    // ボタンを隠す
    if (elements.tocBackBtn) {
      elements.tocBackBtn.style.display = 'none';
    }

    closeTOC();
  }

  /**
   * 前の見出しへ移動
   */
  function goToPreviousHeading() {
    if (tocState.headings.length === 0) return;

    const container = elements.htmlContent;
    if (!container) return;

    // 現在位置より上にある最も近い見出しを探す
    const containerRect = container.getBoundingClientRect();
    const headerHeight = 56 + 20;

    let targetIndex = 0;
    for (let i = tocState.headings.length - 1; i >= 0; i--) {
      const heading = tocState.headings[i];
      const headingRect = heading.element.getBoundingClientRect();
      // 見出しがコンテナ上部（ヘッダー分下）より上にあるか
      if (headingRect.top < containerRect.top + headerHeight - 10) {
        targetIndex = i;
        break;
      }
    }

    jumpToHeading(targetIndex);
  }

  /**
   * 目次イベントをバインド
   */
  function bindTOCEvents() {
    // 閉じるボタン
    if (elements.tocCloseBtn) {
      elements.tocCloseBtn.onclick = closeTOC;
    }

    // 「全ての見出しを見る」ボタン
    const expandBtn = document.getElementById('toc-expand-btn');
    if (expandBtn) {
      expandBtn.onclick = () => {
        setTocMode('full');
      };
    }

    // オーバーレイクリックで閉じる
    if (elements.tocOverlay) {
      elements.tocOverlay.onclick = (e) => {
        if (e.target === elements.tocOverlay) {
          closeTOC();
        }
      };
    }

    // 「元の位置へ」ボタン
    if (elements.tocBackBtn) {
      elements.tocBackBtn.onclick = returnToPreviousPosition;
    }

    // 目次項目クリック
    if (elements.tocList) {
      elements.tocList.onclick = async (e) => {
        const item = e.target.closest('.toc-item');
        if (!item) return;

        // トピック項目の場合
        if (item.dataset.topicId) {
          const topicId = item.dataset.topicId;
          closeTOC();
          // トピックへスクロール（読み込んでいなければ読み込む）
          await scrollToHTMLTopic(topicId);
          return;
        }

        // 見出し項目の場合
        const index = parseInt(item.dataset.index);
        if (!isNaN(index)) {
          jumpToHeading(index);
        }
      };
    }

    // 目次内検索
    if (elements.tocSearchInput) {
      // 入力時：フィルタリング
      elements.tocSearchInput.oninput = (e) => {
        buildTOCList(e.target.value);
      };
      // フォーカス時：Full展開
      elements.tocSearchInput.onfocus = () => {
        if (tocState.mode === 'medium') {
          setTocMode('full');
        }
      };
    }

    // 前の見出しへボタン
    if (elements.prevHeadingBtn) {
      elements.prevHeadingBtn.onclick = goToPreviousHeading;
    }

    // ドラッグハンドルでスワイプ操作
    if (elements.tocHandle) {
      let startY = 0;
      let startHeight = 0;

      elements.tocHandle.addEventListener('touchstart', (e) => {
        startY = e.touches[0].clientY;
        startHeight = elements.tocSheet?.offsetHeight || 0;
      }, { passive: true });

      elements.tocHandle.addEventListener('touchend', (e) => {
        const endY = e.changedTouches[0].clientY;
        const deltaY = startY - endY;

        // 上スワイプ（50px以上）でFull展開
        if (deltaY > 50 && tocState.mode === 'medium') {
          setTocMode('full');
        }
        // 下スワイプ（50px以上）でMediumに縮小、またはさらに下で閉じる
        else if (deltaY < -50) {
          if (tocState.mode === 'full') {
            setTocMode('medium');
          } else {
            closeTOC();
          }
        }
      }, { passive: true });

      // ハンドルダブルタップでトグル
      let lastTap = 0;
      elements.tocHandle.addEventListener('click', () => {
        const now = Date.now();
        if (now - lastTap < 300) {
          // ダブルタップ：モードトグル
          setTocMode(tocState.mode === 'medium' ? 'full' : 'medium');
        }
        lastTap = now;
      });
    }

    // 前後トピックボタン
    if (elements.tocPrevTopic) {
      elements.tocPrevTopic.onclick = goToPrevTopic;
    }
    if (elements.tocNextTopic) {
      elements.tocNextTopic.onclick = goToNextTopic;
    }
  }

  /**
   * 目次をクリーンアップ
   */
  function cleanupTOC() {
    if (tocState.observer) {
      tocState.observer.disconnect();
      tocState.observer = null;
    }
    tocState.headings = [];
    tocState.currentHeadingIndex = 0;
    tocState.previousScrollY = null;
    tocState.mode = 'medium';
    tocState.hasH2 = false;
    // シートのFullクラスも除去
    if (elements.tocSheet) {
      elements.tocSheet.classList.remove('toc-full');
    }
    hideToolButtons();
  }

  // ===== 読書モード機能 =====

  /**
   * 読書モードを初期化
   */
  function initReadingMode() {
    // 保存された設定を適用
    applyReadingSettings();
  }

  /**
   * 読書モードをクリーンアップ
   */
  function cleanupReadingMode() {
    closeReadingMode();
  }

  /**
   * 読書設定を適用
   */
  function applyReadingSettings() {
    if (!elements.htmlDisplay) return;

    // 既存のクラスを削除
    FONT_SIZES.forEach(size => elements.htmlDisplay.classList.remove(`font-${size}`));
    ['compact', 'normal', 'wide'].forEach(lh => elements.htmlDisplay.classList.remove(`line-${lh}`));
    ['compact', 'normal'].forEach(d => elements.htmlDisplay.classList.remove(`density-${d}`));

    // 新しいクラスを追加
    elements.htmlDisplay.classList.add(`font-${readingState.fontSize}`);
    elements.htmlDisplay.classList.add(`line-${readingState.lineHeight}`);
    elements.htmlDisplay.classList.add(`density-${readingState.density}`);

    // 表示を更新
    updateFontSizeDisplay();
    updateToggleButtons();
  }

  /**
   * 文字サイズ表示を更新
   */
  function updateFontSizeDisplay() {
    if (elements.fontSizeDisplay) {
      elements.fontSizeDisplay.textContent = FONT_LABELS[readingState.fontSize];
    }
  }

  /**
   * トグルボタンのアクティブ状態を更新
   */
  function updateToggleButtons() {
    // 行間
    document.querySelectorAll('[data-line-height]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.lineHeight === readingState.lineHeight);
    });

    // 表示密度
    document.querySelectorAll('[data-density]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.density === readingState.density);
    });
  }

  /**
   * 文字サイズを変更
   */
  function changeFontSize(delta) {
    const currentIndex = FONT_SIZES.indexOf(readingState.fontSize);
    const newIndex = Math.max(0, Math.min(FONT_SIZES.length - 1, currentIndex + delta));
    readingState.fontSize = FONT_SIZES[newIndex];
    localStorage.setItem('reading-font-size', readingState.fontSize);
    applyReadingSettings();
  }

  /**
   * 行間を変更
   */
  function changeLineHeight(value) {
    readingState.lineHeight = value;
    localStorage.setItem('reading-line-height', value);
    applyReadingSettings();
  }

  /**
   * 表示密度を変更
   */
  function changeDensity(value) {
    readingState.density = value;
    localStorage.setItem('reading-density', value);
    applyReadingSettings();
  }

  /**
   * 読書モードメニューを開く
   */
  function openReadingMode() {
    if (elements.readingModeOverlay) {
      elements.readingModeOverlay.classList.add('open');
      document.body.style.overflow = 'hidden';
    }
  }

  /**
   * 読書モードメニューを閉じる
   */
  function closeReadingMode() {
    if (elements.readingModeOverlay) {
      elements.readingModeOverlay.classList.remove('open');
      document.body.style.overflow = '';
    }
  }

  // ===== 過去問カード折りたたみ機能 =====

  /**
   * 過去問カードのスタイル適用（折りたたみなし）
   */
  function initQuestionCards() {
    // 折りたたみ機能は廃止 - question-boxをそのまま表示
  }

  /**
   * 画像の遅延読み込みを初期化
   */
  let lazyImageObserver = null;

  function initLazyImages() {
    if (!elements.htmlDisplay) return;

    // 未処理の画像を取得
    const images = elements.htmlDisplay.querySelectorAll('img:not(.lazy-processed)');
    if (images.length === 0) return;

    // Intersection Observer がサポートされているか確認
    if ('IntersectionObserver' in window) {
      // Observer がまだなければ作成
      if (!lazyImageObserver) {
        lazyImageObserver = new IntersectionObserver((entries) => {
          entries.forEach(entry => {
            if (entry.isIntersecting) {
              const img = entry.target;
              // data-src から src にコピー
              if (img.dataset.src) {
                img.src = img.dataset.src;
                img.removeAttribute('data-src');
              }
              img.classList.add('lazy-loaded');
              lazyImageObserver.unobserve(img);
            }
          });
        }, {
          rootMargin: '200px 0px', // 200px手前から読み込み開始
          threshold: 0.01
        });
      }

      images.forEach(img => {
        img.classList.add('lazy-processed');

        // すでにsrcがある場合はdata-srcに移動
        if (img.src && !img.dataset.src) {
          img.dataset.src = img.src;
          // 小さなプレースホルダーを設定
          img.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"%3E%3C/svg%3E';
          img.classList.add('lazy-image');
        }

        lazyImageObserver.observe(img);
      });
    } else {
      // フォールバック: ネイティブ loading="lazy" を使用
      images.forEach(img => {
        img.classList.add('lazy-processed');
        img.loading = 'lazy';
      });
    }
  }

  function cleanupLazyImages() {
    if (lazyImageObserver) {
      lazyImageObserver.disconnect();
      lazyImageObserver = null;
    }
  }

  /**
   * スクロール位置の履歴管理
   */
  const scrollHistory = {
    saveTimeout: null,
    initialized: false
  };

  function initScrollHistory() {
    if (scrollHistory.initialized) return;
    scrollHistory.initialized = true;

    // 初期状態を設定
    const initialState = {
      tab: state.currentTab,
      scrollPositions: {}
    };
    history.replaceState(initialState, '');

    // popstateイベント（戻る/進む）
    window.addEventListener('popstate', (e) => {
      if (e.state && e.state.tab) {
        // タブを復元
        switchTab(e.state.tab, true); // skipHistory=trueで再度pushしない

        // スクロール位置を復元
        if (e.state.scrollPositions) {
          setTimeout(() => {
            restoreScrollPositions(e.state.scrollPositions);
          }, 150);
        }
      }
    });

    // スクロールイベントで位置を保存（デバウンス）
    const containers = [
      elements.htmlContent,
      elements.qaContent,
      elements.kakomonContent,
      elements.flashcardContent
    ].filter(Boolean);

    containers.forEach(container => {
      container.addEventListener('scroll', () => {
        debounceSaveScrollState();
      }, { passive: true });
    });
  }

  function debounceSaveScrollState() {
    if (scrollHistory.saveTimeout) {
      clearTimeout(scrollHistory.saveTimeout);
    }
    scrollHistory.saveTimeout = setTimeout(() => {
      saveScrollState();
    }, 300);
  }

  function saveScrollState() {
    const scrollPositions = getScrollPositions();
    const currentState = {
      tab: state.currentTab,
      scrollPositions: scrollPositions
    };
    history.replaceState(currentState, '');
  }

  function getScrollPositions() {
    const positions = {};
    if (elements.htmlContent) {
      positions.html = elements.htmlContent.scrollTop;
    }
    if (elements.qaContent) {
      positions.qa = elements.qaContent.scrollTop;
    }
    if (elements.kakomonContent) {
      positions.kakomon = elements.kakomonContent.scrollTop;
    }
    if (elements.flashcardContent) {
      positions.flashcard = elements.flashcardContent.scrollTop;
    }
    return positions;
  }

  function restoreScrollPositions(positions) {
    if (!positions) return;
    if (positions.html && elements.htmlContent) {
      elements.htmlContent.scrollTop = positions.html;
    }
    if (positions.qa && elements.qaContent) {
      elements.qaContent.scrollTop = positions.qa;
    }
    if (positions.kakomon && elements.kakomonContent) {
      elements.kakomonContent.scrollTop = positions.kakomon;
    }
    if (positions.flashcard && elements.flashcardContent) {
      elements.flashcardContent.scrollTop = positions.flashcard;
    }
  }

  function pushScrollState(newTab) {
    const scrollPositions = getScrollPositions();
    const newState = {
      tab: newTab,
      scrollPositions: scrollPositions
    };
    history.pushState(newState, '');
  }

  /**
   * 読書モードイベントをバインド
   */
  function bindReadingModeEvents() {
    // 閉じるボタン
    if (elements.readingModeClose) {
      elements.readingModeClose.onclick = closeReadingMode;
    }

    // オーバーレイクリックで閉じる
    if (elements.readingModeOverlay) {
      elements.readingModeOverlay.onclick = (e) => {
        if (e.target === elements.readingModeOverlay) {
          closeReadingMode();
        }
      };
    }

    // 文字サイズ
    if (elements.fontDecrease) {
      elements.fontDecrease.onclick = () => changeFontSize(-1);
    }
    if (elements.fontIncrease) {
      elements.fontIncrease.onclick = () => changeFontSize(1);
    }

    // 行間トグル
    document.querySelectorAll('[data-line-height]').forEach(btn => {
      btn.onclick = () => changeLineHeight(btn.dataset.lineHeight);
    });

    // 表示密度トグル
    document.querySelectorAll('[data-density]').forEach(btn => {
      btn.onclick = () => changeDensity(btn.dataset.density);
    });
  }

  // ===== 統合ツールシート =====

  /**
   * ツールシートを開く
   */
  function openToolSheet() {
    if (!elements.toolSheetOverlay) return;
    elements.toolSheetOverlay.classList.add('open');
    document.body.style.overflow = 'hidden';

    // 現在地ヒントを更新
    if (elements.toolTocHint && tocState.headings.length > 0) {
      const current = tocState.headings[tocState.currentHeadingIndex];
      if (current) {
        elements.toolTocHint.textContent = current.text.substring(0, 15) + (current.text.length > 15 ? '…' : '');
      }
    }
  }

  /**
   * ツールシートを閉じる
   */
  function closeToolSheet() {
    if (!elements.toolSheetOverlay) return;
    elements.toolSheetOverlay.classList.remove('open');
    document.body.style.overflow = '';
  }

  /**
   * ツールシートのイベントをバインド
   */
  function bindToolSheetEvents() {
    // 検索FABクリック → ホームに戻る
    if (elements.toolFab) {
      elements.toolFab.onclick = showWelcomeScreen;
    }

    // オーバーレイクリックで閉じる
    if (elements.toolSheetOverlay) {
      elements.toolSheetOverlay.onclick = (e) => {
        if (e.target === elements.toolSheetOverlay) {
          closeToolSheet();
        }
      };
    }

    // 目次ボタン
    if (elements.toolToc) {
      elements.toolToc.onclick = () => {
        closeToolSheet();
        openTOC();
      };
    }

    // ページ内検索ボタン
    if (elements.toolPageSearch) {
      elements.toolPageSearch.onclick = () => {
        closeToolSheet();
        showFloatingSearch();
      };
    }

    // 表示設定ボタン
    if (elements.toolReading) {
      elements.toolReading.onclick = () => {
        closeToolSheet();
        openReadingMode();
      };
    }

    // 前の見出しへボタン
    if (elements.toolPrevHeading) {
      elements.toolPrevHeading.onclick = () => {
        closeToolSheet();
        goToPreviousHeading();
      };
    }

    // ホームボタン
    if (elements.toolHome) {
      elements.toolHome.onclick = () => {
        closeToolSheet();
        showWelcomeScreen();
      };
    }
  }

  /**
   * トップへスクロール
   */
  function scrollToTop() {
    if (elements.htmlContent) {
      elements.htmlContent.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  /**
   * ウェルカム画面を表示
   */
  function showWelcomeScreen() {
    // HTMLコンテンツを非表示
    if (elements.htmlDisplay) {
      elements.htmlDisplay.style.display = 'none';
    }
    // ウェルカム画面を表示
    if (elements.welcomeScreen) {
      elements.welcomeScreen.style.display = 'flex';
      elements.welcomeScreen.classList.remove('hidden');
    }
    // 検索入力をクリア
    if (elements.welcomeSearchInput) {
      elements.welcomeSearchInput.value = '';
    }
    // 検索結果を非表示、履歴・おすすめを表示
    if (elements.welcomeTopics) {
      elements.welcomeTopics.style.display = 'none';
    }
    const historySection = document.getElementById('welcome-history-section');
    const recommendSection = document.getElementById('welcome-recommend-section');
    if (historySection) historySection.style.display = '';
    if (recommendSection) recommendSection.style.display = '';
    // 検索履歴を更新
    renderSearchHistory();
    // FABを非表示（検索画面では不要）
    if (elements.toolFab) {
      elements.toolFab.style.display = 'none';
    }
    // 現在のトピック情報をクリア
    state.currentItem = null;
    // ローカルストレージから現在のトピックをクリア
    localStorage.removeItem('studyViewer_lastTopicId');
  }

  /**
   * ↑ボタンの条件付き表示を設定
   */
  function setupPrevHeadingButtonScroll() {
    if (!elements.htmlContent || !elements.prevHeadingBtn) return;

    let lastScrollY = 0;
    const threshold = window.innerHeight * 1.5; // 1.5画面

    elements.htmlContent.addEventListener('scroll', () => {
      const scrollY = elements.htmlContent.scrollTop;
      const isScrollingDown = scrollY > lastScrollY;
      const isPastThreshold = scrollY > threshold;

      if (isPastThreshold && !isScrollingDown) {
        // 1.5画面以上スクロール済み + 上スクロール中 → 表示
        elements.prevHeadingBtn.style.display = 'flex';
        elements.prevHeadingBtn.style.opacity = '1';
      } else if (isScrollingDown || scrollY < threshold) {
        // 下スクロール中 or 閾値未満 → 非表示
        elements.prevHeadingBtn.style.opacity = '0';
        setTimeout(() => {
          if (elements.prevHeadingBtn.style.opacity === '0') {
            elements.prevHeadingBtn.style.display = 'none';
          }
        }, 200);
      }

      lastScrollY = scrollY;
    }, { passive: true });
  }

  // ===== フローティング検索バー（GoodNotes風・全トピック横断） =====

  /**
   * フローティング検索バーを表示
   * @param {string} query - 初期検索クエリ（オプション）
   */
  function showFloatingSearch(query = '') {
    if (!elements.floatingSearchBar) return;

    elements.floatingSearchBar.style.display = 'flex';
    elements.floatingSearchInput.value = query;

    // FABを非表示
    if (elements.toolFab) {
      elements.toolFab.style.display = 'none';
    }

    if (query) {
      performGlobalSearch(query);
      elements.floatingSearchClear.style.display = 'flex';
    } else {
      elements.floatingSearchClear.style.display = 'none';
      updateFloatingSearchCount(0, 0);
    }

    // 入力欄にフォーカス（クエリがない場合）
    if (!query) {
      setTimeout(() => elements.floatingSearchInput.focus(), 100);
    }
  }

  /**
   * フローティング検索バーを非表示
   */
  function hideFloatingSearch() {
    if (!elements.floatingSearchBar) return;

    elements.floatingSearchBar.style.display = 'none';
    elements.floatingSearchInput.value = '';
    clearFloatingSearchHighlights();
    resetFloatingSearchState();

    // FABを再表示
    if (elements.toolFab) {
      elements.toolFab.style.display = 'flex';
    }
  }

  /**
   * 検索状態をリセット
   */
  function resetFloatingSearchState() {
    state.floatingSearchQuery = '';
    state.floatingSearchResults = [];
    state.floatingSearchTotalMatches = 0;
    state.floatingSearchCurrentTopicIdx = -1;
    state.floatingSearchCurrentMatchInTopic = -1;
    state.floatingSearchGlobalIndex = 0;
    state.floatingSearchLocalMatches = [];
    state.floatingSearchLocalMatchIdx = -1;
    state.floatingSearchSections = [];        // セクション単位の結果
    state.floatingSearchCurrentSectionIdx = 0; // 現在のセクションインデックス
    state.floatingSearchTotalSections = 0;    // 総セクション数
  }

  /**
   * DOM要素が属するセクション（h2/h3）を見つける
   */
  function findParentSection(element) {
    let current = element;
    while (current && current !== document.body) {
      // 前の兄弟要素を遡ってh2/h3を探す
      let sibling = current.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === 'H2' || sibling.tagName === 'H3' || sibling.tagName === 'H1') {
          return sibling;
        }
        sibling = sibling.previousElementSibling;
      }
      current = current.parentElement;
    }
    return null;
  }

  /**
   * 全トピックを横断して検索
   */
  function performGlobalSearch(query) {
    if (!query || query.length < 1) {
      clearFloatingSearchHighlights();
      resetFloatingSearchState();
      updateFloatingSearchCount(0, 0);
      return;
    }

    const lowerQuery = query.toLowerCase();
    const results = [];
    let totalMatches = 0;

    // 全トピックのsearchTextを検索（htmlPathがあるもののみ）
    DATA.forEach((item, index) => {
      // htmlPathがないエントリはスキップ（コンテンツがないため検索対象外）
      if (!item.htmlPath) return;

      const searchText = (item.searchText || item.title || '').toLowerCase();
      let count = 0;
      let pos = 0;

      // マッチ数をカウント
      while ((pos = searchText.indexOf(lowerQuery, pos)) !== -1) {
        count++;
        pos++;
      }

      if (count > 0) {
        results.push({
          topicId: item.id,
          topicIndex: index,
          title: item.title || item.id,
          subject: item.subject || '',
          matchCount: count,
          sectionCount: 1, // 初期値（実際のセクション数はトピック読み込み時に更新）
          globalStartIndex: totalMatches + 1 // 1-based
        });
        totalMatches += count;
      }
    });

    // 状態を更新
    state.floatingSearchQuery = query;
    state.floatingSearchResults = results;
    state.floatingSearchTotalMatches = totalMatches;
    state.floatingSearchTotalSections = results.length; // 初期値はトピック数

    if (results.length === 0) {
      state.floatingSearchCurrentTopicIdx = -1;
      state.floatingSearchCurrentSectionIdx = 0;
      updateFloatingSearchCount(0, 0);
      clearFloatingSearchHighlights();
      return;
    }

    // 現在開いているトピックがマッチしているか確認
    const currentTopicId = state.currentItem?.id;
    let startTopicIdx = 0;
    let startMatchInTopic = 0;

    if (currentTopicId) {
      const currentResultIdx = results.findIndex(r => r.topicId === currentTopicId);
      if (currentResultIdx !== -1) {
        startTopicIdx = currentResultIdx;
      }
    }

    // 最初のマッチに移動
    goToGlobalMatch(startTopicIdx, startMatchInTopic);
  }

  /**
   * グローバルセクションに移動
   * @param {number} topicIdx - 検索結果内のトピックインデックス
   * @param {number} sectionInTopic - トピック内のセクションインデックス
   */
  async function goToGlobalMatch(topicIdx, sectionInTopic) {
    const results = state.floatingSearchResults;
    if (results.length === 0) return;

    // 範囲チェック（トピックインデックス）
    if (topicIdx < 0) {
      topicIdx = results.length - 1;
      sectionInTopic = -1; // 末尾を指定
    } else if (topicIdx >= results.length) {
      topicIdx = 0;
      sectionInTopic = 0;
    }

    const result = results[topicIdx];
    const sectionCount = result.sectionCount || 1;

    // sectionInTopic = -1 は末尾を意味する
    if (sectionInTopic === -1) {
      sectionInTopic = sectionCount - 1;
    }

    // セクションインデックスの範囲チェック
    if (sectionInTopic < 0) {
      sectionInTopic = 0;
    } else if (sectionInTopic >= sectionCount) {
      // 次のトピックへ
      topicIdx++;
      if (topicIdx >= results.length) topicIdx = 0;
      sectionInTopic = 0;
      return goToGlobalMatch(topicIdx, sectionInTopic);
    }

    // 状態を更新
    state.floatingSearchCurrentTopicIdx = topicIdx;
    state.floatingSearchCurrentMatchInTopic = sectionInTopic;

    // 現在のトピックと違う場合はトピックを切り替え
    const currentTopicId = state.currentItem?.id;
    if (currentTopicId !== result.topicId) {
      // トピックを切り替え
      clearFloatingSearchHighlights();
      state.floatingSearchLocalMatches = [];
      state.floatingSearchSections = [];

      // selectItemを呼び出してトピックを読み込み
      // ハイライトは読み込み完了後に行う
      state.pendingFloatingSearch = {
        query: state.floatingSearchQuery,
        matchIndex: sectionInTopic
      };
      selectItem(result.topicId);
      return;
    }

    // 同じトピック内での移動：現在のページ内でハイライト
    highlightAndGoToMatchInCurrentPage(sectionInTopic);
  }

  /**
   * 現在のページ内でハイライトして指定マッチに移動
   */
  function highlightAndGoToMatchInCurrentPage(sectionIndex) {
    const query = state.floatingSearchQuery;
    if (!query) return;

    // 前回のハイライトをクリア
    clearFloatingSearchHighlights();

    const container = elements.htmlDisplay;
    if (!container) return;

    // テキストノードを走査してマッチを探す
    const walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          if (!node.textContent.trim()) return NodeFilter.FILTER_REJECT;
          const parent = node.parentNode;
          if (parent && parent.classList && parent.classList.contains('search-match-highlight')) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const matches = [];
    const lowerQuery = query.toLowerCase();

    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = node.textContent;
      const lowerText = text.toLowerCase();

      let startIndex = 0;
      let index;

      while ((index = lowerText.indexOf(lowerQuery, startIndex)) !== -1) {
        matches.push({
          node: node,
          index: index,
          length: query.length
        });
        startIndex = index + 1;
      }
    }

    if (matches.length === 0) return;

    // マッチをハイライト
    const processedNodes = new Map();

    for (let i = matches.length - 1; i >= 0; i--) {
      const match = matches[i];
      const node = match.node;

      if (!processedNodes.has(node)) {
        processedNodes.set(node, []);
      }
      processedNodes.get(node).unshift(match);
    }

    const highlightedSpans = [];

    processedNodes.forEach((nodeMatches, originalNode) => {
      const parent = originalNode.parentNode;
      if (!parent) return;

      const text = originalNode.textContent;
      const fragment = document.createDocumentFragment();
      let lastIndex = 0;

      nodeMatches.forEach((match) => {
        if (match.index > lastIndex) {
          fragment.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
        }

        const span = document.createElement('span');
        span.className = 'search-match-highlight';
        span.textContent = text.substring(match.index, match.index + match.length);
        fragment.appendChild(span);
        highlightedSpans.push(span);

        lastIndex = match.index + match.length;
      });

      if (lastIndex < text.length) {
        fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
      }

      parent.replaceChild(fragment, originalNode);
    });

    // DOM順序で再取得
    const orderedSpans = Array.from(container.querySelectorAll('.search-match-highlight'));
    state.floatingSearchLocalMatches = orderedSpans;

    // セクション（h2/h3）ごとにマッチをグループ化
    const sectionMap = new Map();
    orderedSpans.forEach(span => {
      const section = findParentSection(span);
      const sectionKey = section ? section.textContent : '__top__';
      if (!sectionMap.has(sectionKey)) {
        sectionMap.set(sectionKey, { heading: section, spans: [] });
      }
      sectionMap.get(sectionKey).spans.push(span);
    });

    // セクション配列を作成（DOM順序を維持）
    const sections = Array.from(sectionMap.values());
    state.floatingSearchSections = sections;

    // このトピックのセクション数を更新
    const topicIdx = state.floatingSearchCurrentTopicIdx;
    if (topicIdx >= 0 && state.floatingSearchResults[topicIdx]) {
      state.floatingSearchResults[topicIdx].sectionCount = sections.length;

      // 総セクション数を再計算
      let totalSections = 0;
      state.floatingSearchResults.forEach(r => {
        totalSections += r.sectionCount || 1;
      });
      state.floatingSearchTotalSections = totalSections;
    }

    // sectionIndexの範囲チェック
    const safeSectionIndex = Math.max(0, Math.min(sectionIndex, sections.length - 1));
    state.floatingSearchLocalMatchIdx = safeSectionIndex;

    // グローバルセクションインデックスを再計算
    let globalSectionIndex = 0;
    for (let i = 0; i < topicIdx; i++) {
      globalSectionIndex += state.floatingSearchResults[i].sectionCount || 1;
    }
    globalSectionIndex += safeSectionIndex + 1;
    state.floatingSearchCurrentSectionIdx = globalSectionIndex;

    // カウント表示を更新（セクション単位）
    updateFloatingSearchCount(globalSectionIndex, state.floatingSearchTotalSections);

    // 指定セクションに移動
    if (sections.length > 0 && safeSectionIndex >= 0) {
      const currentSection = sections[safeSectionIndex];
      if (currentSection) {
        // セクション内の全マッチをcurrentとしてハイライト
        currentSection.spans.forEach(span => span.classList.add('current'));

        // 過去問カード内にある場合は展開する
        const firstSpan = currentSection.spans[0];
        if (firstSpan) {
          const questionCard = firstSpan.closest('.question-card-wrapper');
          if (questionCard && !questionCard.classList.contains('expanded')) {
            questionCard.classList.add('expanded');
          }
        }

        // 見出しまたは最初のマッチにスクロール
        const scrollTarget = currentSection.heading || currentSection.spans[0];
        if (scrollTarget) {
          setTimeout(() => {
            // フローティング検索バーとヘッダーを考慮して画面中央に表示
            const headerHeight = 56 + 16;
            const searchBarHeight = 60;
            const containerRect = elements.htmlContent.getBoundingClientRect();
            const targetRect = scrollTarget.getBoundingClientRect();
            const viewportHeight = containerRect.height - searchBarHeight;
            // 画面の上から1/3の位置に表示
            const targetY = elements.htmlContent.scrollTop + targetRect.top - containerRect.top - headerHeight - (viewportHeight / 3);

            elements.htmlContent.scrollTo({
              top: Math.max(0, targetY),
              behavior: 'smooth'
            });
          }, 150);
        }
      }
    }
  }

  /**
   * 次のセクションに移動（全トピック横断）
   */
  function nextFloatingSearchMatch() {
    if (state.floatingSearchTotalSections === 0) return;

    const topicIdx = state.floatingSearchCurrentTopicIdx;
    let sectionInTopic = state.floatingSearchLocalMatchIdx + 1;

    // ローカルセクション数を使用
    const localSectionCount = state.floatingSearchSections.length;
    if (localSectionCount > 0 && sectionInTopic >= localSectionCount) {
      // 次のトピックへ
      goToGlobalMatch(topicIdx + 1, 0);
      return;
    }

    goToGlobalMatch(topicIdx, sectionInTopic);
  }

  /**
   * 前のセクションに移動（全トピック横断）
   */
  function prevFloatingSearchMatch() {
    if (state.floatingSearchTotalSections === 0) return;

    const topicIdx = state.floatingSearchCurrentTopicIdx;
    let sectionInTopic = state.floatingSearchLocalMatchIdx - 1;

    if (sectionInTopic < 0) {
      // 前のトピックへ
      goToGlobalMatch(topicIdx - 1, -1); // -1は末尾を意味
      return;
    }

    goToGlobalMatch(topicIdx, sectionInTopic);
  }

  /**
   * ハイライトをクリア
   */
  function clearFloatingSearchHighlights() {
    const highlights = document.querySelectorAll('.search-match-highlight');
    highlights.forEach(span => {
      const parent = span.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(span.textContent), span);
        parent.normalize();
      }
    });
    state.floatingSearchLocalMatches = [];
    state.floatingSearchLocalMatchIdx = -1;
    state.floatingSearchSections = [];
  }

  /**
   * カウント表示を更新
   */
  function updateFloatingSearchCount(current, total) {
    if (elements.floatingSearchCount) {
      elements.floatingSearchCount.textContent = total > 0 ? `${current}/${total}` : '0/0';
    }

    if (elements.floatingSearchPrev) {
      elements.floatingSearchPrev.disabled = total === 0;
    }
    if (elements.floatingSearchNext) {
      elements.floatingSearchNext.disabled = total === 0;
    }
  }

  /**
   * トピック読み込み完了後にフローティング検索を継続
   */
  function continueFloatingSearchAfterLoad() {
    if (!state.pendingFloatingSearch) return;

    const { query, matchIndex } = state.pendingFloatingSearch;
    state.pendingFloatingSearch = null;

    if (query === state.floatingSearchQuery) {
      setTimeout(() => {
        highlightAndGoToMatchInCurrentPage(matchIndex);
      }, 200);
    }
  }

  /**
   * フローティング検索バーのイベント設定
   */
  function setupFloatingSearchEvents() {
    if (!elements.floatingSearchBar) return;

    let searchTimeout;
    elements.floatingSearchInput.addEventListener('input', (e) => {
      const query = e.target.value.trim();

      elements.floatingSearchClear.style.display = query ? 'flex' : 'none';

      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        performGlobalSearch(query);
      }, 300);
    });

    elements.floatingSearchClear.addEventListener('click', () => {
      elements.floatingSearchInput.value = '';
      elements.floatingSearchClear.style.display = 'none';
      clearFloatingSearchHighlights();
      resetFloatingSearchState();
      updateFloatingSearchCount(0, 0);
      elements.floatingSearchInput.focus();
    });

    elements.floatingSearchPrev.addEventListener('click', nextFloatingSearchMatch);
    elements.floatingSearchNext.addEventListener('click', prevFloatingSearchMatch);
    elements.floatingSearchClose.addEventListener('click', hideFloatingSearch);

    elements.floatingSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          nextFloatingSearchMatch();
        } else {
          prevFloatingSearchMatch();
        }
      } else if (e.key === 'Escape') {
        hideFloatingSearch();
      }
    });
  }

  // グローバルAPIを公開（他モジュールから呼び出し用）
  window.selectItem = selectItem;
  window.switchTab = switchTab;

  // 起動
  document.addEventListener('DOMContentLoaded', init);
})();
