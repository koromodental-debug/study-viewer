/**
 * Study Viewer メインアプリケーション
 */
(function() {
  // 状態管理
  const state = {
    currentItem: null,
    currentTab: 'html',
    searchQuery: '',
    highlightQuery: null,  // 検索結果からジャンプ時のハイライト用
    collapsedCategories: new Set(),
    sidebarOpen: false,
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
    lastNoteViewTime: parseInt(localStorage.getItem('studyViewer_lastNoteViewTime') || '0')
  };

  // DOM要素
  const elements = {
    header: document.querySelector('.header'),
    mainContent: document.querySelector('.main-content'),
    menuBtn: document.getElementById('menu-btn'),
    sidebar: document.getElementById('sidebar'),
    sidebarClose: document.getElementById('sidebar-close'),
    sidebarOverlay: document.getElementById('sidebar-overlay'),
    sidebarSearchBtn: document.getElementById('sidebar-search-btn'),
    topicList: document.getElementById('topic-list'),
    searchBtn: document.getElementById('search-btn'),
    searchOverlay: document.getElementById('search-overlay'),
    searchInput: document.getElementById('search-input'),
    closeSearch: document.getElementById('close-search'),
    searchResults: document.getElementById('search-results'),
    tabs: document.querySelectorAll('.floating-tab'),
    htmlContent: document.getElementById('html-content'),
    qaContent: document.getElementById('qa-content'),
    htmlDisplay: document.getElementById('html-display'),
    qaDisplay: document.getElementById('qa-display'),
    qaToolbar: document.getElementById('qa-toolbar'),
    qaToggleBtn: document.getElementById('qa-toggle-btn'),
    qaFloatingToggle: document.getElementById('qa-floating-toggle'),
    welcomeScreen: document.getElementById('welcome-screen'),
    welcomeStartBtn: document.getElementById('welcome-start-btn'),
    welcomeCardMenu: document.getElementById('welcome-card-menu'),
    // 過去問
    kakomonContent: document.getElementById('kakomon-content'),
    kakomonDisplay: document.getElementById('kakomon-display'),
    kakomonToolbar: document.getElementById('kakomon-toolbar'),
    kakomonPlaceholder: document.getElementById('kakomon-placeholder'),
    kakomonCurrent: document.getElementById('kakomon-current'),
    kakomonTotal: document.getElementById('kakomon-total'),
    kakomonReset: document.getElementById('kakomon-reset'),
    // ノート（お気に入り）
    noteBtn: document.getElementById('note-btn'),
    noteBadge: document.getElementById('note-badge'),
    noteOverlay: document.getElementById('note-overlay'),
    closeNote: document.getElementById('close-note'),
    noteTimeline: document.getElementById('note-timeline'),
    noteCount: document.getElementById('note-count'),
    noteEmpty: document.getElementById('note-empty'),
    // 画像ライトボックス
    imageLightbox: document.getElementById('image-lightbox'),
    lightboxImage: document.getElementById('lightbox-image'),
    lightboxClose: document.getElementById('lightbox-close')
  };

  // 検索エンジン
  let searchEngine;

  /**
   * 初期化
   */
  function init() {
    if (typeof DATA === 'undefined') {
      elements.topicList.innerHTML = '<div class="no-results">データを読み込めませんでした。</div>';
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

    renderTopicList(DATA);
    bindEvents();
    restoreState();
    setupKeyboardHandler();

    // お気に入り機能の初期化
    if (typeof FavoritesManager !== 'undefined') {
      FavoritesManager.init();
      updateNoteBadge();
      // お気に入りの追加・削除時にバッジを更新
      FavoritesManager.addListener(function() {
        updateNoteBadge();
      });
    }
  }

  /**
   * キーボード表示時の処理（iOS対応）
   */
  function setupKeyboardHandler() {
    const sidebarHome = document.querySelector('.sidebar-home');

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => {
        const keyboardHeight = window.innerHeight - window.visualViewport.height;
        if (keyboardHeight > 100) {
          // キーボードが表示されている
          elements.sidebar.style.maxHeight = `${window.visualViewport.height - 20}px`;
          elements.sidebar.style.bottom = `${keyboardHeight}px`;
          // ホームボタンを非表示
          if (sidebarHome) sidebarHome.style.display = 'none';
        } else {
          // キーボードが非表示
          elements.sidebar.style.maxHeight = '';
          elements.sidebar.style.bottom = '';
          // ホームボタンを再表示
          if (sidebarHome) sidebarHome.style.display = '';
        }
      });
    }
  }

  /**
   * イベントバインド
   */
  function bindEvents() {
    // サイドバー開閉
    elements.menuBtn.addEventListener('click', toggleSidebar);
    elements.sidebarClose.addEventListener('click', closeSidebar);
    elements.sidebarOverlay.addEventListener('click', closeSidebar);

    // サイドバー内の検索ボタン → 検索オーバーレイを開く
    if (elements.sidebarSearchBtn) {
      elements.sidebarSearchBtn.addEventListener('click', () => {
        closeSidebar();
        setTimeout(openSearch, 100);
      });
    }

    // 検索ボタン（ヘッダーにある場合）
    if (elements.searchBtn) {
      elements.searchBtn.addEventListener('click', openSearch);
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
        switchTab(tab.dataset.tab);
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
      // Ctrl+K or Cmd+K でサイドバー検索を開く
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        if (state.sidebarOpen) {
          closeSidebar();
        } else {
          openSidebarWithSearch();
        }
      }
      // Escape で閉じる
      if (e.key === 'Escape') {
        if (state.sidebarOpen) {
          closeSidebar();
        }
      }
    });

    // スクロールでヘッダー表示/非表示
    setupScrollHideHeader();

    // スワイプでタブ切り替え
    setupSwipeTabSwitch();

    // Q&Aフローティングトグルボタンのスクロール表示/非表示
    setupQAFloatingToggleScroll();

    // ウェルカム画面のボタン
    if (elements.welcomeStartBtn) {
      elements.welcomeStartBtn.addEventListener('click', openSidebar);
    }
    if (elements.welcomeCardMenu) {
      elements.welcomeCardMenu.addEventListener('click', openSidebar);
    }

    // ノートボタン
    if (elements.noteBtn) {
      elements.noteBtn.addEventListener('click', openNoteOverlay);
    }
    if (elements.closeNote) {
      elements.closeNote.addEventListener('click', closeNoteOverlay);
    }
    if (elements.noteOverlay) {
      elements.noteOverlay.addEventListener('click', function(e) {
        if (e.target === elements.noteOverlay) {
          closeNoteOverlay();
        }
      });
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
   * スワイプでタブを切り替える
   */
  function setupSwipeTabSwitch() {
    const swipeThreshold = 80; // スワイプ判定の閾値（px）
    const edgeSwipeThreshold = 30; // 左端と判定する範囲（px）
    let touchStartX = 0;
    let touchStartY = 0;
    let isSwiping = false;
    let isEdgeSwipe = false; // 左端からのスワイプか

    // メインコンテンツ全体でスワイプを検出
    const mainContent = elements.mainContent;

    mainContent.addEventListener('touchstart', function(e) {
      if (e.touches && e.touches.length === 1) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        isSwiping = true;
        // 左端からのスワイプ開始を検出
        isEdgeSwipe = (touchStartX < edgeSwipeThreshold);
      }
    }, { passive: true });

    mainContent.addEventListener('touchend', function(e) {
      if (!isSwiping || !e.changedTouches || e.changedTouches.length === 0) return;
      isSwiping = false;

      const touchEndX = e.changedTouches[0].clientX;
      const touchEndY = e.changedTouches[0].clientY;
      const diffX = touchEndX - touchStartX;
      const diffY = touchEndY - touchStartY;

      // 左端から右スワイプ → サイドバーを開く
      if (isEdgeSwipe && diffX > swipeThreshold && !state.sidebarOpen) {
        if (Math.abs(diffX) > Math.abs(diffY) * 1.5) {
          openSidebar();
          isEdgeSwipe = false;
          return;
        }
      }
      isEdgeSwipe = false;

      // 横方向の移動が縦より大きく、閾値を超えた場合（3タブ対応）
      const tabOrder = ['html', 'qa', 'kakomon'];
      if (Math.abs(diffX) > swipeThreshold && Math.abs(diffX) > Math.abs(diffY) * 1.5) {
        const currentIndex = tabOrder.indexOf(state.currentTab);
        if (diffX < 0 && currentIndex < tabOrder.length - 1) {
          // 左スワイプ → 次のタブ
          switchTab(tabOrder[currentIndex + 1]);
        } else if (diffX > 0 && currentIndex > 0) {
          // 右スワイプ → 前のタブ
          switchTab(tabOrder[currentIndex - 1]);
        }
      }
    }, { passive: true });

    // iframe内のスワイプも検出
    window.setupIframeSwipeHandler = function(iframe) {
      try {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;

        iframeDoc.addEventListener('touchstart', function(e) {
          if (e.touches && e.touches.length === 1) {
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
            isSwiping = true;
            // 左端からのスワイプ開始を検出
            isEdgeSwipe = (touchStartX < edgeSwipeThreshold);
          }
        }, { passive: true });

        iframeDoc.addEventListener('touchend', function(e) {
          if (!isSwiping || !e.changedTouches || e.changedTouches.length === 0) return;
          isSwiping = false;

          const touchEndX = e.changedTouches[0].clientX;
          const touchEndY = e.changedTouches[0].clientY;
          const diffX = touchEndX - touchStartX;
          const diffY = touchEndY - touchStartY;

          // 左端から右スワイプ → サイドバーを開く
          if (isEdgeSwipe && diffX > swipeThreshold && !state.sidebarOpen) {
            if (Math.abs(diffX) > Math.abs(diffY) * 1.5) {
              openSidebar();
              isEdgeSwipe = false;
              return;
            }
          }
          isEdgeSwipe = false;

          // 3タブ対応
          const tabOrder = ['html', 'qa', 'kakomon'];
          if (Math.abs(diffX) > swipeThreshold && Math.abs(diffX) > Math.abs(diffY) * 1.5) {
            const currentIndex = tabOrder.indexOf(state.currentTab);
            if (diffX < 0 && currentIndex < tabOrder.length - 1) {
              switchTab(tabOrder[currentIndex + 1]);
            } else if (diffX > 0 && currentIndex > 0) {
              switchTab(tabOrder[currentIndex - 1]);
            }
          }
        }, { passive: true });
      } catch (e) {
        console.log('Could not setup iframe swipe handler:', e.message);
      }
    };
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
   * サイドバーを開く
   */
  function openSidebar() {
    state.sidebarOpen = true;
    elements.sidebar.classList.add('open');
    elements.sidebarOverlay.classList.add('show');
    // フローティング要素を非表示
    document.querySelector('.floating-tabbar').classList.add('hidden');
  }

  /**
   * サイドバーをトグル
   */
  function toggleSidebar() {
    if (state.sidebarOpen) {
      closeSidebar();
    } else {
      openSidebar();
    }
  }

  /**
   * サイドバーを閉じる
   */
  function closeSidebar() {
    state.sidebarOpen = false;
    elements.sidebar.classList.remove('open');
    elements.sidebarOverlay.classList.remove('show');
    // フローティング要素を再表示
    document.querySelector('.floating-tabbar').classList.remove('hidden');
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

    // トピックリストのアクティブ状態をクリア
    elements.topicList.querySelectorAll('.topic-item').forEach(el => {
      el.classList.remove('active');
    });

    // サイドバーを閉じる
    closeSidebar();

    // HTMLタブに切り替え
    switchTab('html');
  }

  /**
   * 検索を開く
   */
  function openSearch() {
    state.searchOpen = true;
    elements.searchOverlay.classList.add('show');
    elements.searchInput.value = '';
    elements.searchInput.focus();
    elements.searchResults.innerHTML = '<div class="search-hint">キーワードを入力して検索</div>';
  }

  /**
   * 検索を閉じる
   */
  function closeSearch() {
    state.searchOpen = false;
    elements.searchOverlay.classList.remove('show');
    elements.searchInput.value = '';
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

        // まとめタブに切り替えてから選択
        switchTab('html');
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
   * トピックリストを描画（科目別4階層）
   */
  function renderTopicList(items) {
    if (items.length === 0) {
      elements.topicList.innerHTML = '<div class="no-results">トピックがありません</div>';
      return;
    }

    // 科目カテゴリ → 科目 → チャプター → トピック の4階層でグループ化
    const categoryOrder = ['基礎', '臨床', '必修', 'その他'];
    // 科目の表示順序（基礎科目）
    const subjectOrder = [
      '解剖学', '組織学', '病理学', '生理学', '生化学',
      '微生物学・免疫学', '薬理学', '理工学', '衛生学', '口腔衛生', '疫学',
      // 臨床科目
      '保存修復学', '歯内療法学', '歯周病学', 'クラウンブリッジ',
      '部分床義歯学', '全部床義歯学', 'インプラント',
      '口腔外科学', '歯科放射線学', '歯科麻酔学',
      '小児歯科学', '矯正歯科学', '高齢者歯科学', '摂食嚥下', '公衆衛生'
    ];
    const groups = {};

    items.forEach(item => {
      const subjectCat = item.subjectCategory || 'その他';
      const subject = item.subject || 'その他';
      const chapter = extractChapter(item) || 'その他';

      if (!groups[subjectCat]) groups[subjectCat] = {};
      if (!groups[subjectCat][subject]) groups[subjectCat][subject] = {};
      if (!groups[subjectCat][subject][chapter]) groups[subjectCat][subject][chapter] = [];
      groups[subjectCat][subject][chapter].push(item);
    });

    let html = '';

    // 科目カテゴリ順にソート
    const sortedCategories = Object.keys(groups).sort((a, b) => {
      const idxA = categoryOrder.indexOf(a);
      const idxB = categoryOrder.indexOf(b);
      return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
    });

    sortedCategories.forEach(subjectCat => {
      const subjectCatKey = `cat_${subjectCat}`;
      const isCatCollapsed = state.collapsedCategories.has(subjectCatKey);

      html += `
        <div class="subject-category-group">
          <div class="subject-category-header" data-category="${escapeHtml(subjectCatKey)}">
            <span>${escapeHtml(subjectCat)}</span>
            <span class="toggle">${isCatCollapsed ? '▶' : '▼'}</span>
          </div>
          <div class="subject-category-items${isCatCollapsed ? ' collapsed' : ''}">
      `;

      // 科目を指定順序でソート
      const subjects = Object.keys(groups[subjectCat]).sort((a, b) => {
        const idxA = subjectOrder.indexOf(a);
        const idxB = subjectOrder.indexOf(b);
        // 順序に含まれない科目は末尾に（アルファベット順）
        if (idxA === -1 && idxB === -1) return a.localeCompare(b);
        if (idxA === -1) return 1;
        if (idxB === -1) return -1;
        return idxA - idxB;
      });

      subjects.forEach(subject => {
        const subjectKey = `subj_${subject}`;
        const isSubjCollapsed = state.collapsedCategories.has(subjectKey);
        const chapters = groups[subjectCat][subject];
        const chapterKeys = Object.keys(chapters).sort();
        const hasMultipleChapters = chapterKeys.length > 1 || (chapterKeys.length === 1 && chapterKeys[0] !== 'その他');

        html += `
          <div class="subject-group">
            <div class="subject-header" data-category="${escapeHtml(subjectKey)}">
              <span>${escapeHtml(subject)}</span>
              <span class="toggle">${isSubjCollapsed ? '▶' : '▼'}</span>
            </div>
            <div class="subject-items${isSubjCollapsed ? ' collapsed' : ''}">
        `;

        // チャプターが複数ある場合のみチャプター階層を表示
        if (hasMultipleChapters) {
          chapterKeys.forEach(chapter => {
            const chapterKey = `chap_${subject}_${chapter}`;
            const isChapCollapsed = state.collapsedCategories.has(chapterKey);
            const chapterDisplay = chapter === 'その他' ? 'その他' : chapter.replace(/_/g, ' ');

            html += `
              <div class="chapter-group">
                <div class="chapter-header" data-category="${escapeHtml(chapterKey)}">
                  <span>${escapeHtml(chapterDisplay)}</span>
                  <span class="toggle">${isChapCollapsed ? '▶' : '▼'}</span>
                </div>
                <div class="chapter-items${isChapCollapsed ? ' collapsed' : ''}">
            `;

            chapters[chapter].forEach(item => {
              const isActive = state.currentItem && state.currentItem.id === item.id;
              html += `
                <div class="topic-item${isActive ? ' active' : ''}" data-id="${escapeHtml(item.id)}">
                  <span class="title">${escapeHtml(item.title)}</span>
                </div>
              `;
            });

            html += '</div></div>';
          });
        } else {
          // チャプターが1つだけ（その他）の場合は直接トピックを表示
          chapterKeys.forEach(chapter => {
            chapters[chapter].forEach(item => {
              const isActive = state.currentItem && state.currentItem.id === item.id;
              html += `
                <div class="topic-item${isActive ? ' active' : ''}" data-id="${escapeHtml(item.id)}">
                  <span class="title">${escapeHtml(item.title)}</span>
                </div>
              `;
            });
          });
        }

        html += '</div></div>';
      });

      html += '</div></div>';
    });

    elements.topicList.innerHTML = html;

    // イベント登録（科目カテゴリ）
    elements.topicList.querySelectorAll('.subject-category-header').forEach(header => {
      header.addEventListener('click', () => toggleCategory(header.dataset.category));
    });

    // イベント登録（科目）
    elements.topicList.querySelectorAll('.subject-header').forEach(header => {
      header.addEventListener('click', () => toggleCategory(header.dataset.category));
    });

    // イベント登録（チャプター）
    elements.topicList.querySelectorAll('.chapter-header').forEach(header => {
      header.addEventListener('click', () => toggleCategory(header.dataset.category));
    });

    // イベント登録（トピック）
    elements.topicList.querySelectorAll('.topic-item').forEach(item => {
      item.addEventListener('click', () => {
        selectItem(item.dataset.id);
        closeSidebar();
      });
    });
  }

  /**
   * カテゴリの折りたたみ切り替え
   */
  function toggleCategory(category) {
    if (state.collapsedCategories.has(category)) {
      state.collapsedCategories.delete(category);
    } else {
      state.collapsedCategories.add(category);
    }
    renderTopicList(DATA);
  }

  /**
   * アイテムを選択
   */
  function selectItem(id) {
    const item = DATA.find(i => i.id === id);
    if (!item) return;

    state.currentItem = item;
    saveState();

    // リストのアクティブ状態を更新
    elements.topicList.querySelectorAll('.topic-item').forEach(el => {
      el.classList.toggle('active', el.dataset.id === id);
    });

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
      const response = await fetch(item.htmlPath);
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

      // お気に入りボタンを追加（セクション内のh3に対して）- 遅延実行でパフォーマンス改善
      requestAnimationFrame(() => {
        injectFavoriteButtonsToSection(section, item);
      });

      // 検索からのジャンプ時：該当箇所をハイライト＆スクロール
      if (isFirst && state.highlightQuery) {
        setTimeout(() => {
          highlightAndScrollToMatch(section, state.highlightQuery);
          state.highlightQuery = null;
        }, 100);
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
      const response = await fetch(item.htmlPath);
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
    const h2Elements = section.querySelectorAll('.topic-section-content h2');

    h2Elements.forEach((h2, index) => {
      // 既にラッパーがあればスキップ
      if (h2.parentElement.classList.contains('html-card-wrapper')) return;

      // h2をラッパーで囲む
      const wrapper = document.createElement('div');
      wrapper.className = 'html-card-wrapper';
      wrapper.dataset.cardIndex = index;
      wrapper.dataset.title = h2.textContent || '';

      // h2の後の要素を含める（次のh2またはh1まで）
      const elements = [];
      let sibling = h2.nextElementSibling;
      while (sibling && sibling.tagName !== 'H2' && sibling.tagName !== 'H1') {
        elements.push(sibling);
        sibling = sibling.nextElementSibling;
      }

      h2.parentNode.insertBefore(wrapper, h2);
      wrapper.appendChild(h2);
      elements.forEach(el => wrapper.appendChild(el));

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
          title: h2.textContent || '',
          html: wrapper.innerHTML
        };
        const isNowFavorite = FavoritesManager.toggle('html', topicId, index, content);
        this.classList.toggle('active', isNowFavorite);
        updateNoteBadge();
      });

      // 画像保存ボタンを追加
      const saveBtn = document.createElement('button');
      saveBtn.className = 'save-image-btn';
      saveBtn.setAttribute('aria-label', '画像保存');
      saveBtn.innerHTML = createSaveButtonSVG();
      saveBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        const filename = `まとめ_${topicId}_${h2.textContent || index}`;
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
      const response = await fetch(item.qaPath);
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
      const response = await fetch(item.qaPath);
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

    const prevIndex = state.qaFirstLoadedTopicIndex - 1;
    if (prevIndex < 0) return;

    state.isLoadingMoreQA = true;

    const prevItem = DATA[prevIndex];
    if (prevItem && prevItem.qaPath) {
      const container = elements.qaContent;
      const scrollHeightBefore = container.scrollHeight;

      await loadQATopicPrepend(prevItem);
      state.qaFirstLoadedTopicIndex = prevIndex;

      const scrollHeightAfter = container.scrollHeight;
      const heightDiff = scrollHeightAfter - scrollHeightBefore;
      container.scrollTop += heightDiff;
    } else {
      // qaPathがない場合、さらに前を探す
      state.qaFirstLoadedTopicIndex = prevIndex;
    }

    state.isLoadingMoreQA = false;
  }

  /**
   * Q&A：次のトピックを読み込み
   */
  async function loadNextQATopic() {
    if (state.isLoadingMoreQA) return;

    const nextIndex = state.qaLoadedTopicIndex + 1;
    if (nextIndex >= DATA.length) return;

    state.isLoadingMoreQA = true;

    const nextItem = DATA[nextIndex];
    if (nextItem && nextItem.qaPath) {
      await loadQATopic(nextItem, false);
      state.qaLoadedTopicIndex = nextIndex;
    } else {
      // qaPathがない場合、さらに次を探す
      state.qaLoadedTopicIndex = nextIndex;
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
   * タブを切り替え
   */
  function switchTab(tab) {
    const prevTab = state.currentTab;

    // 切り替え前のセクション名を取得
    let currentSection = null;
    let scrollPercent = 0;

    if (prevTab === 'qa') {
      currentSection = getCurrentQASection();
      // フォールバック用に%も取得
      const el = elements.qaContent;
      const maxScroll = el.scrollHeight - el.clientHeight;
      if (maxScroll > 0) {
        scrollPercent = el.scrollTop / maxScroll;
      }
    } else if (prevTab === 'html') {
      currentSection = getCurrentHTMLSection();
      // フォールバック用に%も取得
      const el = elements.htmlContent;
      const maxScroll = el.scrollHeight - el.clientHeight;
      if (maxScroll > 0) {
        scrollPercent = el.scrollTop / maxScroll;
      }
    }

    state.currentTab = tab;

    elements.tabs.forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tab);
    });

    elements.htmlContent.classList.toggle('active', tab === 'html');
    elements.qaContent.classList.toggle('active', tab === 'qa');
    if (elements.kakomonContent) {
      elements.kakomonContent.classList.toggle('active', tab === 'kakomon');
    }

    // Q&Aフローティングトグルボタンの表示制御
    if (elements.qaFloatingToggle) {
      elements.qaFloatingToggle.classList.toggle('show', tab === 'qa');
    }

    // 新しいタブにスクロール（セクション優先、フォールバックで%）
    setTimeout(() => {
      let scrolled = false;

      if (tab === 'qa' && currentSection) {
        scrolled = scrollToQASection(currentSection);
      } else if (tab === 'html' && currentSection) {
        scrolled = scrollToHTMLSection(currentSection);
      }

      // セクションが見つからなければ%でスクロール
      if (!scrolled) {
        if (tab === 'qa') {
          const el = elements.qaContent;
          const maxScroll = el.scrollHeight - el.clientHeight;
          el.scrollTop = maxScroll * scrollPercent;
        } else if (tab === 'html') {
          const el = elements.htmlContent;
          const maxScroll = el.scrollHeight - el.clientHeight;
          el.scrollTop = maxScroll * scrollPercent;
        }
      }
    }, 50);
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
      return;
    }

    // 2回目以降は前回のトピックを復元
    if (lastItemId) {
      selectItem(lastItemId);
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
   * カードを画像として保存
   */
  async function saveCardAsImage(element, filename) {
    if (typeof html2canvas === 'undefined') {
      alert('画像保存機能を読み込めませんでした');
      return;
    }

    // ローディング表示
    const overlay = document.createElement('div');
    overlay.className = 'saving-overlay';
    overlay.innerHTML = '<div class="saving-spinner">画像を生成中...</div>';
    document.body.appendChild(overlay);

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
        logging: false
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

      // iOS Safari対応: ライトボックスで画像を表示（長押しで保存可能）
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      if (isIOS) {
        // 既存のライトボックスを使用（ポップアップブロック回避）
        elements.lightboxImage.src = dataUrl;
        elements.imageLightbox.classList.add('open', 'show-hint');
        document.body.style.overflow = 'hidden';
      } else {
        // その他のブラウザ: ダウンロード
        const link = document.createElement('a');
        link.href = dataUrl;
        link.download = filename + '.png';
        link.click();
      }
    } catch (err) {
      console.error('画像保存エラー:', err);
      alert('画像の生成に失敗しました');
    } finally {
      // 一時的に表示した答えを非表示に戻す
      hiddenAnswers.forEach(answer => {
        answer.style.display = '';
      });
      overlay.remove();
    }
  }

  /**
   * 保存ボタンのSVGアイコンを生成
   */
  function createSaveButtonSVG() {
    return `<svg viewBox="0 0 24 24" stroke-width="2">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="7 10 12 15 17 10"/>
      <line x1="12" y1="15" x2="12" y2="3"/>
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
    updateNoteBadge: updateNoteBadge,
    renderNoteTimeline: renderNoteTimeline
  };

  // 起動
  document.addEventListener('DOMContentLoaded', init);
})();
