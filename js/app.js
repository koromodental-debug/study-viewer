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
    sidebarFilter: '',
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
    sidebarFilter: document.getElementById('sidebar-filter'),
    topicList: document.getElementById('topic-list'),
    searchBtn: document.getElementById('search-btn'),
    searchOverlay: document.getElementById('search-overlay'),
    searchInput: document.getElementById('search-input'),
    closeSearch: document.getElementById('close-search'),
    searchResults: document.getElementById('search-results'),
    tabs: document.querySelectorAll('.header-tab'),
    htmlContent: document.getElementById('html-content'),
    qaContent: document.getElementById('qa-content'),
    htmlFrame: document.getElementById('html-frame'),
    qaDisplay: document.getElementById('qa-display'),
    qaToolbar: document.getElementById('qa-toolbar'),
    qaToggleBtn: document.getElementById('qa-toggle-btn'),
    welcomeScreen: document.getElementById('welcome-screen'),
    welcomeStartBtn: document.getElementById('welcome-start-btn'),
    welcomeCardMenu: document.getElementById('welcome-card-menu'),
    homeBtn: document.getElementById('home-btn')
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

    // 科目をデフォルトで折りたたみ（科目カテゴリは展開）
    const subjects = new Set(DATA.map(item => item.subject || 'その他'));
    subjects.forEach(subj => state.collapsedCategories.add(`subj_${subj}`));

    renderTopicList(DATA);
    bindEvents();
    restoreState();
  }

  /**
   * イベントバインド
   */
  function bindEvents() {
    // サイドバー開閉
    elements.menuBtn.addEventListener('click', openSidebar);
    elements.sidebarClose.addEventListener('click', closeSidebar);
    elements.sidebarOverlay.addEventListener('click', closeSidebar);

    // サイドバーフィルター
    let filterDebounce;
    elements.sidebarFilter.addEventListener('input', (e) => {
      clearTimeout(filterDebounce);
      filterDebounce = setTimeout(() => {
        state.sidebarFilter = e.target.value;
        renderTopicList(DATA);
      }, 150);
    });

    // 検索ボタン → サイドバーを開いて検索にフォーカス（ボタンがある場合のみ）
    if (elements.searchBtn) {
      elements.searchBtn.addEventListener('click', openSidebarWithSearch);
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

    // Q&Aツールバーのスクロール表示/非表示
    setupQAToolbarScroll();

    // ウェルカム画面のボタン
    if (elements.welcomeStartBtn) {
      elements.welcomeStartBtn.addEventListener('click', openSidebar);
    }
    if (elements.welcomeCardMenu) {
      elements.welcomeCardMenu.addEventListener('click', openSidebar);
    }

    // ホームボタン
    if (elements.homeBtn) {
      elements.homeBtn.addEventListener('click', goHome);
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

      // 横方向の移動が縦より大きく、閾値を超えた場合
      if (Math.abs(diffX) > swipeThreshold && Math.abs(diffX) > Math.abs(diffY) * 1.5) {
        if (diffX < 0 && state.currentTab === 'html') {
          switchTab('qa');
        } else if (diffX > 0 && state.currentTab === 'qa') {
          switchTab('html');
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

          if (Math.abs(diffX) > swipeThreshold && Math.abs(diffX) > Math.abs(diffY) * 1.5) {
            if (diffX < 0 && state.currentTab === 'html') {
              switchTab('qa');
            } else if (diffX > 0 && state.currentTab === 'qa') {
              switchTab('html');
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
   * Q&Aツールバーをスクロール方向に応じて表示/非表示
   */
  function setupQAToolbarScroll() {
    let lastScrollTop = 0;
    const threshold = 10; // スクロール検知の閾値

    elements.qaContent.addEventListener('scroll', function() {
      if (!elements.qaToolbar) return;

      const scrollTop = elements.qaContent.scrollTop;
      const diff = scrollTop - lastScrollTop;

      // 下にスクロール（コンテンツを読み進める）→ ツールバーを隠す
      if (diff > threshold) {
        elements.qaToolbar.classList.add('hidden');
      }
      // 上にスクロール（戻る）→ ツールバーを表示
      else if (diff < -threshold) {
        elements.qaToolbar.classList.remove('hidden');
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
  }

  /**
   * サイドバーを閉じる
   */
  function closeSidebar() {
    state.sidebarOpen = false;
    elements.sidebar.classList.remove('open');
    elements.sidebarOverlay.classList.remove('show');
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
   * サイドバーを開いて検索にフォーカス
   */
  function openSidebarWithSearch() {
    openSidebar();
    // 少し待ってからフォーカス（アニメーション後）
    setTimeout(() => {
      elements.sidebarFilter.focus();
    }, 100);
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
      if (item.htmlPath) badges.push('HTML');
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
   * トピックリストを描画（科目別2階層）
   */
  function renderTopicList(items) {
    const filter = state.sidebarFilter.toLowerCase().trim();
    const isFiltering = filter.length > 0;

    // フィルタリング
    let filteredItems = items;
    if (isFiltering) {
      filteredItems = items.filter(item =>
        item.title.toLowerCase().includes(filter) ||
        (item.subject && item.subject.toLowerCase().includes(filter)) ||
        (item.subjectCategory && item.subjectCategory.toLowerCase().includes(filter))
      );
    }

    if (filteredItems.length === 0) {
      elements.topicList.innerHTML = '<div class="no-results">トピックがありません</div>';
      return;
    }

    // 科目カテゴリ → 科目 → トピック の3階層でグループ化
    const categoryOrder = ['基礎', '臨床', '必修', 'その他'];
    const groups = {};

    filteredItems.forEach(item => {
      const subjectCat = item.subjectCategory || 'その他';
      const subject = item.subject || 'その他';

      if (!groups[subjectCat]) {
        groups[subjectCat] = {};
      }
      if (!groups[subjectCat][subject]) {
        groups[subjectCat][subject] = [];
      }
      groups[subjectCat][subject].push(item);
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
      const isCatCollapsed = isFiltering ? false : state.collapsedCategories.has(subjectCatKey);

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
        const isSubjCollapsed = isFiltering ? false : state.collapsedCategories.has(subjectKey);
        const topicCount = groups[subjectCat][subject].length;

        html += `
          <div class="subject-group">
            <div class="subject-header" data-category="${escapeHtml(subjectKey)}">
              <span>${escapeHtml(subject)}</span>
              <span class="count">${topicCount}</span>
              <span class="toggle">${isSubjCollapsed ? '▶' : '▼'}</span>
            </div>
            <div class="subject-items${isSubjCollapsed ? ' collapsed' : ''}">
        `;

        groups[subjectCat][subject].forEach(item => {
          const isActive = state.currentItem && state.currentItem.id === item.id;
          html += `
            <div class="topic-item${isActive ? ' active' : ''}" data-id="${escapeHtml(item.id)}">
              <span class="title">${escapeHtml(item.title)}</span>
            </div>
          `;
        });

        html += '</div></div>';
      });

      html += '</div></div>';
    });

    elements.topicList.innerHTML = html;

    // イベント登録（科目カテゴリ）
    elements.topicList.querySelectorAll('.subject-category-header').forEach(header => {
      header.addEventListener('click', () => {
        const category = header.dataset.category;
        toggleCategory(category);
      });
    });

    // イベント登録（科目）
    elements.topicList.querySelectorAll('.subject-header').forEach(header => {
      header.addEventListener('click', () => {
        const category = header.dataset.category;
        toggleCategory(category);
      });
    });

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

      // モバイル用CSSを注入
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

        /* モバイル用：1カラム強制 */
        .container, [class*="column"], [style*="column"] {
          column-count: 1 !important;
          columns: 1 !important;
        }

        /* テーブルの横スクロール対応（親要素で） */
        .page {
          overflow-x: auto;
        }

        /* 全体の幅と余白を調整 */
        body {
          padding: 0 !important;
          padding-bottom: 150px !important;
          line-height: 1.8 !important;
        }

        .page, body > * {
          max-width: 100% !important;
        }

        /* 本文の読みやすさ向上 */
        p, li, td, th {
          line-height: 1.8 !important;
        }

        /* 見出しの余白 */
        h1, h2, h3, h4, h5, h6 {
          margin-top: 1.5em !important;
          margin-bottom: 0.8em !important;
        }

        /* 画像を幅に収める */
        img {
          max-width: 100% !important;
          height: auto !important;
        }

        /* ===== Apple風スタイル ===== */

        /* CSS変数の上書き */
        :root {
          --accent: #007AFF !important;
          --bg-blue-light: #f5f5f7 !important;
          --border-blue: #e5e5e7 !important;
          --text-primary: #1d1d1f !important;
        }

        /* 見出し */
        h1 {
          color: #1d1d1f !important;
        }
        h2 {
          color: #1d1d1f !important;
          border-color: #1d1d1f !important;
        }
        h2 .num {
          color: #1d1d1f !important;
        }

        /* ポイントボックス・サマリーボックス */
        .point-box, .summary-box {
          background: #fafafa !important;
        }
        .point-box-title, .summary-box-title {
          color: #1d1d1f !important;
        }

        /* 問題ボックスの正解表示 */
        .question-box .answer {
          color: #007AFF !important;
        }

        /* シラバスセクション */
        .syllabus-section {
          border-left-color: #007AFF !important;
        }

        /* 強調文字（赤→青） */
        .red, .highlight {
          color: #007AFF !important;
        }

        /* ===== カードレイアウト ===== */

        /* 背景（Apple風グレー） */
        body {
          background: #fafafa !important;
        }
        .page {
          max-width: 100% !important;
          margin: 0 !important;
          padding: 20px !important;
          padding-bottom: 150px !important;
        }

        /* h1タイトル */
        h1 {
          font-size: 20px !important;
          margin-bottom: 8px !important;
        }

        /* h2セクション見出し */
        h2 {
          font-size: 18px !important;
          padding-bottom: 12px !important;
          margin-top: 32px !important;
          margin-bottom: 16px !important;
          border-bottom: 2px solid #2c2c2c !important;
        }

        /* h3小見出し - ジャンプ率を上げる */
        h3 {
          background: transparent !important;
          padding: 0 !important;
          border-radius: 0 !important;
          margin: 24px 0 12px 0 !important;
          box-shadow: none !important;
          font-size: 17px !important;
          font-weight: 700 !important;
          color: #1d1d1f !important;
        }
        h3::before {
          content: none !important;
        }

        /* テーブルをカード風に（単独でカード化） */
        table {
          display: table !important;
          width: 100% !important;
          background: white !important;
          border-radius: 16px !important;
          box-shadow: 0 2px 8px rgba(0,0,0,0.06) !important;
          border: none !important;
          overflow: hidden !important;
          margin: 12px 0 !important;
          border-collapse: separate !important;
          border-spacing: 0 !important;
        }
        /* テーブルヘッダー（Apple風ライトグレー） */
        th {
          background: #f2f2f7 !important;
          color: #1d1d1f !important;
          padding: 10px 14px !important;
          font-weight: 600 !important;
          font-size: 13px !important;
        }
        td {
          padding: 12px 14px !important;
          font-size: 14px !important;
        }
        th, td {
          border: none !important;
          border-bottom: 1px solid #e8e8e8 !important;
        }
        tr:last-child td {
          border-bottom: none !important;
        }
        /* テーブル角丸対応 */
        tr:first-child th:first-child {
          border-top-left-radius: 16px !important;
        }
        tr:first-child th:last-child {
          border-top-right-radius: 16px !important;
        }
        tr:last-child td:first-child {
          border-bottom-left-radius: 16px !important;
        }
        tr:last-child td:last-child {
          border-bottom-right-radius: 16px !important;
        }

        /* ポイントボックス・サマリーボックスをカード風に */
        .point-box, .summary-box {
          background: white !important;
          border-radius: 16px !important;
          box-shadow: 0 2px 8px rgba(0,0,0,0.06) !important;
          padding: 16px 20px !important;
          margin: 16px 0 !important;
          border: none !important;
        }

        /* 問題ボックスをカード風に */
        .question-box {
          background: white !important;
          border-radius: 16px !important;
          box-shadow: 0 2px 8px rgba(0,0,0,0.06) !important;
          padding: 16px 20px !important;
          margin: 16px 0 !important;
          border: none !important;
          border-left: none !important;
        }

        /* シラバスセクションをカード風に */
        .syllabus-section {
          background: white !important;
          border-radius: 16px !important;
          box-shadow: 0 2px 8px rgba(0,0,0,0.06) !important;
          border: none !important;
          border-left: none !important;
          padding: 12px 16px !important;
          margin: 16px 0 !important;
        }

        /* 全てのボーダーラインを削除 */
        .syllabus-item,
        .definition-box,
        .exam-box,
        .note-box,
        blockquote,
        [class*="box"],
        [class*="item"] {
          border-left: none !important;
          border-right: none !important;
        }

        /* カード内の要素も */
        .syllabus-item,
        .exam-item {
          background: white !important;
          border-radius: 16px !important;
          box-shadow: 0 2px 8px rgba(0,0,0,0.06) !important;
          border: none !important;
          padding: 12px 16px !important;
          margin: 12px 0 !important;
        }

        /* カテゴリヘッダー（Apple風ライトグレー） */
        .category-header {
          background: #f2f2f7 !important;
          color: #1d1d1f !important;
          border-radius: 16px 16px 0 0 !important;
          padding: 12px 16px !important;
          margin-top: 16px !important;
          font-weight: 600 !important;
        }
        .category-content {
          background: white !important;
          border: none !important;
          border-radius: 0 0 16px 16px !important;
          box-shadow: 0 2px 8px rgba(0,0,0,0.06) !important;
          padding: 16px !important;
          margin-bottom: 16px !important;
        }

        /* 警告ボックスもLeicaスタイルに */
        .warning-box {
          background: #f5f5f5 !important;
          border: none !important;
          border-radius: 16px !important;
          box-shadow: 0 2px 8px rgba(0,0,0,0.06) !important;
        }

        /* accent色を使う要素を黒に統一 */
        [style*="background"][style*="accent"],
        [class*="header"][style*="background"] {
          background: #2c2c2c !important;
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

    } catch (e) {
      elements.qaDisplay.innerHTML = '<div class="no-results">Q&Aを読み込めませんでした</div>';
      elements.qaDisplay.style.display = 'block';
    }
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
        html += `<div class="qa-item"><div class="qa-question">${escapeHtml(question)}</div>`;
        continue;
      }

      if (line.startsWith('A: ')) {
        const answer = line.slice(3);
        html += `<div class="qa-answer">${escapeHtml(answer)}</div></div>`;
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

  // 起動
  document.addEventListener('DOMContentLoaded', init);
})();
