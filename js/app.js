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
    sidebarFilter: ''
  };

  // DOM要素
  const elements = {
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
    tabs: document.querySelectorAll('.tab'),
    htmlContent: document.getElementById('html-content'),
    qaContent: document.getElementById('qa-content'),
    htmlFrame: document.getElementById('html-frame'),
    qaModeToggle: document.getElementById('qa-mode-toggle'),
    qaDisplay: document.getElementById('qa-display')
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

    // 全カテゴリをデフォルトで折りたたみ
    const categories = new Set(DATA.map(item => item.category || 'その他'));
    categories.forEach(cat => state.collapsedCategories.add(cat));

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

    // 検索ボタン
    elements.searchBtn.addEventListener('click', openSearch);

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

    // Q&Aモード切り替え
    elements.qaModeToggle.addEventListener('click', toggleQAMode);

    // キーボードショートカット
    document.addEventListener('keydown', (e) => {
      // Ctrl+K or Cmd+K で検索を開く
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        if (state.searchOpen) {
          closeSearch();
        } else {
          openSearch();
        }
      }
      // Escape で閉じる
      if (e.key === 'Escape') {
        if (state.searchOpen) {
          closeSearch();
        } else if (state.sidebarOpen) {
          closeSidebar();
        }
      }
    });
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
   * 検索を開く
   */
  function openSearch() {
    state.searchOpen = true;
    elements.searchOverlay.classList.add('show');
    elements.searchInput.value = '';
    elements.searchInput.focus();
    renderSearchResults(DATA.slice(0, 20));
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
   * トピックリストを描画
   */
  function renderTopicList(items) {
    const filter = state.sidebarFilter.toLowerCase().trim();
    const isFiltering = filter.length > 0;

    // フィルタリング
    let filteredItems = items;
    if (isFiltering) {
      filteredItems = items.filter(item =>
        item.title.toLowerCase().includes(filter) ||
        (item.category && item.category.toLowerCase().includes(filter))
      );
    }

    if (filteredItems.length === 0) {
      elements.topicList.innerHTML = '<div class="no-results">トピックがありません</div>';
      return;
    }

    // カテゴリでグループ化
    const groups = {};
    filteredItems.forEach(item => {
      const category = item.category || 'その他';
      if (!groups[category]) {
        groups[category] = [];
      }
      groups[category].push(item);
    });

    let html = '';
    Object.keys(groups).sort().forEach(category => {
      // フィルター中は全カテゴリを展開
      const isCollapsed = isFiltering ? false : state.collapsedCategories.has(category);
      html += `
        <div class="category-group">
          <div class="category-header" data-category="${escapeHtml(category)}">
            <span>${escapeHtml(category)}</span>
            <span class="toggle">${isCollapsed ? '▶' : '▼'}</span>
          </div>
          <div class="category-items${isCollapsed ? ' collapsed' : ''}">
      `;

      groups[category].forEach(item => {
        const isActive = state.currentItem && state.currentItem.id === item.id;
        html += `
          <div class="topic-item${isActive ? ' active' : ''}" data-id="${escapeHtml(item.id)}">
            <span class="title">${escapeHtml(item.title)}</span>
          </div>
        `;
      });

      html += '</div></div>';
    });

    elements.topicList.innerHTML = html;

    // イベント登録
    elements.topicList.querySelectorAll('.category-header').forEach(header => {
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
        /* モバイル用：1カラム強制 */
        .container, [class*="column"], [style*="column"] {
          column-count: 1 !important;
          columns: 1 !important;
        }

        /* テーブルをスクロール可能に */
        table {
          display: block;
          overflow-x: auto;
          max-width: 100%;
        }

        /* 全体の幅と余白を調整 */
        body {
          padding: 20px !important;
          padding-bottom: 120px !important;
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
    // HTML
    if (item.htmlPath) {
      elements.htmlFrame.src = item.htmlPath;
      elements.htmlFrame.style.display = 'block';
      elements.htmlContent.querySelector('.placeholder').style.display = 'none';

      // iframeロード後にモバイル用CSSを注入
      elements.htmlFrame.onload = function() {
        injectMobileStyles(elements.htmlFrame);
      };
    } else {
      elements.htmlFrame.src = '';
      elements.htmlFrame.style.display = 'none';
      elements.htmlContent.querySelector('.placeholder').style.display = 'flex';
      elements.htmlContent.querySelector('.placeholder p').textContent = 'このトピックにはHTMLがありません';
    }

    // Q&A
    if (item.qaPath) {
      loadQA(item.qaPath);
    } else {
      elements.qaDisplay.innerHTML = '';
      elements.qaDisplay.style.display = 'none';
      elements.qaModeToggle.style.display = 'none';
      elements.qaContent.querySelector('.placeholder').style.display = 'flex';
      elements.qaContent.querySelector('.placeholder p').textContent = 'このトピックにはQ&Aがありません';
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
      elements.qaModeToggle.style.display = 'flex';
      elements.qaContent.querySelector('.placeholder').style.display = 'none';

      // 現在のモードを適用
      if (state.qaShowAll) {
        elements.qaDisplay.classList.add('show-all');
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

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

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

    if (relatedItems.length > 0) {
      html += renderRelated(relatedItems);
    }
    if (currentSection) {
      html += '</div>';
    }

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
   * タブを切り替え
   */
  function switchTab(tab) {
    state.currentTab = tab;

    elements.tabs.forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tab);
    });

    elements.htmlContent.classList.toggle('active', tab === 'html');
    elements.qaContent.classList.toggle('active', tab === 'qa');
  }

  /**
   * Q&A表示モードを切り替え
   */
  function toggleQAMode() {
    state.qaShowAll = !state.qaShowAll;

    elements.qaModeToggle.classList.toggle('active', state.qaShowAll);
    elements.qaDisplay.classList.toggle('show-all', state.qaShowAll);

    // ボタンテキストを更新
    elements.qaModeToggle.textContent = state.qaShowAll ? '折りたたむ' : '全て表示';
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
    const lastItemId = localStorage.getItem('studyViewer_lastItem');
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
