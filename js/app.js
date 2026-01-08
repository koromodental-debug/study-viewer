/**
 * Study Viewer メインアプリケーション
 */
(function() {
  // 状態管理
  const state = {
    currentItem: null,
    currentTab: 'html',
    searchQuery: '',
    collapsedCategories: new Set(),
    sidebarOpen: false,
    searchOpen: false,
    qaShowAll: false,
    lastScrollY: 0,
    headerHidden: false
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
    htmlFrame: document.getElementById('html-frame'),
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
    noteEmpty: document.getElementById('note-empty')
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
  }

  /**
   * スワイプでタブを切り替える
   */
  function setupSwipeTabSwitch() {
    const swipeThreshold = 80; // スワイプ判定の閾値（px）
    let touchStartX = 0;
    let touchStartY = 0;
    let isSwiping = false;

    // メインコンテンツ全体でスワイプを検出
    const mainContent = elements.mainContent;

    mainContent.addEventListener('touchstart', function(e) {
      if (e.touches && e.touches.length === 1) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        isSwiping = true;
      }
    }, { passive: true });

    mainContent.addEventListener('touchend', function(e) {
      if (!isSwiping || !e.changedTouches || e.changedTouches.length === 0) return;
      isSwiping = false;

      const touchEndX = e.changedTouches[0].clientX;
      const touchEndY = e.changedTouches[0].clientY;
      const diffX = touchEndX - touchStartX;
      const diffY = touchEndY - touchStartY;

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
          }
        }, { passive: true });

        iframeDoc.addEventListener('touchend', function(e) {
          if (!isSwiping || !e.changedTouches || e.changedTouches.length === 0) return;
          isSwiping = false;

          const touchEndX = e.changedTouches[0].clientX;
          const touchEndY = e.changedTouches[0].clientY;
          const diffX = touchEndX - touchStartX;
          const diffY = touchEndY - touchStartY;

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
   * ※現在は無効化（ヘッダー常に表示の方が使いやすい）
   */
  function setupScrollHideHeader() {
    // 無効化: ヘッダーは常に表示
    // スクロールの滑らかさとUI安定性を優先
    window.setupIframeScrollHandler = function(iframe) {
      // 無効化
    };
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

    // iframe を非表示
    elements.htmlFrame.src = '';
    elements.htmlFrame.style.display = 'none';

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
    renderSearchResults(results.slice(0, 30));
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
      const badges = [];
      if (item.htmlPath) badges.push('まとめ');
      if (item.qaPath) badges.push('Q&A');

      html += `
        <div class="search-result-item" data-id="${escapeHtml(item.id)}">
          <div>
            <div class="result-title">${searchEngine.highlight(escapeHtml(item.title), state.searchQuery)}</div>
            <div class="result-category">${escapeHtml(item.category)}</div>
          </div>
          <div class="result-badges">
            ${badges.map(b => `<span class="badge">${b}</span>`).join('')}
          </div>
        </div>
      `;
    });

    elements.searchResults.innerHTML = html;

    // 検索結果クリック
    elements.searchResults.querySelectorAll('.search-result-item').forEach(el => {
      el.addEventListener('click', () => {
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

      // 科目をソート
      const subjects = Object.keys(groups[subjectCat]).sort();

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

    // HTML
    if (item.htmlPath) {
      elements.htmlFrame.src = item.htmlPath;
      elements.htmlFrame.style.display = 'block';

      // iframeロード後にモバイル用CSSを注入 & スクロール監視
      elements.htmlFrame.onload = function() {
        injectMobileStyles(elements.htmlFrame);
        if (window.setupIframeScrollHandler) {
          window.setupIframeScrollHandler(elements.htmlFrame);
        }
        if (window.setupIframeSwipeHandler) {
          window.setupIframeSwipeHandler(elements.htmlFrame);
        }
        // まとめカードにお気に入りボタンを追加
        injectFavoriteButtons(elements.htmlFrame, item);
      };
    } else {
      elements.htmlFrame.src = '';
      elements.htmlFrame.style.display = 'none';
      // HTMLがない場合はウェルカム画面を表示（メッセージ付き）
      if (elements.welcomeScreen) {
        elements.welcomeScreen.classList.remove('hidden');
      }
    }

    // Q&A
    if (item.qaPath) {
      loadQA(item.qaPath);
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

    // 過去問
    if (typeof KakomonModule !== 'undefined') {
      KakomonModule.loadKakomon(item, elements);
    }
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
   * Q&Aのお気に入りボタンにイベントをバインド
   */
  function bindQAFavoriteButtons() {
    if (typeof FavoritesManager === 'undefined' || !state.currentItem) return;

    const topicId = state.currentItem.id;

    elements.qaDisplay.querySelectorAll('.qa-item').forEach(item => {
      const cardIndex = item.dataset.cardIndex;
      const favoriteBtn = item.querySelector('.favorite-btn');
      if (!favoriteBtn) return;

      // 既にお気に入りかどうかをチェックして状態を反映
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
        html += `<div class="qa-section"><div class="qa-section-title">${escapeHtml(currentSection)}</div>`;
        continue;
      }

      if (line === '---') {
        if (relatedItems.length > 0) {
          html += renderRelated(relatedItems);
          relatedItems = [];
        }
        if (currentSection) {
          html += '</div>';
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
        html += `<button class="favorite-btn" aria-label="お気に入り"><svg viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg></button>`;
        html += `<div class="qa-question">${escapeHtml(question)}</div>`;
        qaIndex++;
        continue;
      }

      if (line.startsWith('A: ')) {
        const answer = line.slice(3);
        html += `<div class="qa-answer" data-answer="${escapeHtml(answer)}">${escapeHtml(answer)}</div></div>`;
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
      html += '</div>';
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
      const iframeDoc = elements.htmlFrame.contentDocument;
      const iframeWin = elements.htmlFrame.contentWindow;
      if (!iframeDoc || !iframeWin) return null;

      const headings = iframeDoc.querySelectorAll('h1, h2, h3, h4');
      let currentSection = null;

      for (const heading of headings) {
        const rect = heading.getBoundingClientRect();
        // 画面上部から100px以内にある見出しを現在のセクションとする
        if (rect.top <= 100) {
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
    for (const section of sections) {
      const text = section.textContent.trim();
      // 完全一致または部分一致
      if (text === sectionName || text.includes(sectionName) || sectionName.includes(text)) {
        const containerRect = elements.qaContent.getBoundingClientRect();
        const sectionRect = section.getBoundingClientRect();
        const offset = sectionRect.top - containerRect.top + elements.qaContent.scrollTop - 20;
        elements.qaContent.scrollTo({ top: offset, behavior: 'auto' });
        return true;
      }
    }
    return false;
  }

  /**
   * HTMLで指定セクションにスクロール
   */
  function scrollToHTMLSection(sectionName) {
    if (!sectionName) return false;

    try {
      const iframeDoc = elements.htmlFrame.contentDocument;
      const iframeWin = elements.htmlFrame.contentWindow;
      if (!iframeDoc || !iframeWin) return false;

      const headings = iframeDoc.querySelectorAll('h1, h2, h3, h4');
      for (const heading of headings) {
        const text = heading.textContent.trim();
        // 完全一致または部分一致
        if (text === sectionName || text.includes(sectionName) || sectionName.includes(text)) {
          const rect = heading.getBoundingClientRect();
          const scrollY = iframeWin.scrollY || 0;
          iframeWin.scrollTo({ top: scrollY + rect.top - 20, behavior: 'auto' });
          return true;
        }
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
      try {
        const iframeWin = elements.htmlFrame.contentWindow;
        const iframeDoc = elements.htmlFrame.contentDocument;
        if (iframeWin && iframeDoc) {
          const scrollY = iframeWin.scrollY || 0;
          const maxScroll = iframeDoc.documentElement.scrollHeight - iframeWin.innerHeight;
          if (maxScroll > 0) {
            scrollPercent = scrollY / maxScroll;
          }
        }
      } catch (e) {}
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
          try {
            const iframeWin = elements.htmlFrame.contentWindow;
            const iframeDoc = elements.htmlFrame.contentDocument;
            if (iframeWin && iframeDoc) {
              const maxScroll = iframeDoc.documentElement.scrollHeight - iframeWin.innerHeight;
              iframeWin.scrollTo(0, maxScroll * scrollPercent);
            }
          } catch (e) {}
        }
      }
    }, 50);
  }

  /**
   * Q&A表示モードを切り替え
   */
  function toggleQAMode() {
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

  // ===== ノート（お気に入り）機能 =====

  /**
   * ノートオーバーレイを開く
   */
  function openNoteOverlay() {
    if (elements.noteOverlay) {
      elements.noteOverlay.classList.add('open');
      renderNoteTimeline();
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

    const count = FavoritesManager.count();
    if (count > 0) {
      elements.noteBadge.textContent = count > 99 ? '99+' : count;
      elements.noteBadge.style.display = 'flex';
    } else {
      elements.noteBadge.style.display = 'none';
    }

    // カウント表示も更新
    if (elements.noteCount) {
      elements.noteCount.textContent = count + '件';
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
      <button class="note-card-delete" data-id="${escapeHtml(item.id)}" aria-label="削除">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
    `;

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
      // Q&Aカード
      content.innerHTML = `
        <div class="qa-q">${escapeHtml(item.content.question)}</div>
        <div class="qa-a">${escapeHtml(item.content.answer)}</div>
      `;
    } else if (item.type === 'kakomon') {
      // 過去問カード
      const questionText = item.content.text || item.content.question || '';
      const answerText = item.content.answer || '';
      content.innerHTML = `
        <span class="kakomon-code-badge">${escapeHtml(item.content.code || item.cardIndex)}</span>
        <div class="kakomon-q">${escapeHtml(questionText.substring(0, 200))}${questionText.length > 200 ? '...' : ''}</div>
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
