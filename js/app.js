/**
 * Study Viewer メインアプリケーション
 */
(function() {
  // 状態管理
  const state = {
    currentItem: null,
    currentTab: 'html',
    searchQuery: '',
    collapsedCategories: new Set()
  };

  // DOM要素
  const elements = {
    topicList: document.getElementById('topic-list'),
    searchInput: document.getElementById('search-input'),
    clearSearch: document.getElementById('clear-search'),
    tabs: document.querySelectorAll('.tab'),
    htmlContent: document.getElementById('html-content'),
    qaContent: document.getElementById('qa-content'),
    htmlFrame: document.getElementById('html-frame'),
    qaDisplay: document.getElementById('qa-display')
  };

  // 検索エンジン
  let searchEngine;

  /**
   * 初期化
   */
  function init() {
    if (typeof DATA === 'undefined') {
      elements.topicList.innerHTML = '<div class="no-results">データを読み込めませんでした。<br>build_index.py を実行してください。</div>';
      return;
    }

    searchEngine = new SearchEngine(DATA);
    renderTopicList(DATA);
    bindEvents();
    restoreState();
  }

  /**
   * イベントバインド
   */
  function bindEvents() {
    // 検索
    let debounceTimer;
    elements.searchInput.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        handleSearch(e.target.value);
      }, 200);
    });

    elements.clearSearch.addEventListener('click', () => {
      elements.searchInput.value = '';
      handleSearch('');
    });

    // タブ切り替え
    elements.tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        switchTab(tab.dataset.tab);
      });
    });

    // キーボードショートカット
    document.addEventListener('keydown', (e) => {
      // Ctrl+K or Cmd+K で検索フォーカス
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        elements.searchInput.focus();
        elements.searchInput.select();
      }
      // Escape で検索クリア
      if (e.key === 'Escape' && document.activeElement === elements.searchInput) {
        elements.searchInput.value = '';
        handleSearch('');
        elements.searchInput.blur();
      }
    });
  }

  /**
   * 検索処理
   */
  function handleSearch(query) {
    state.searchQuery = query;
    elements.clearSearch.style.display = query ? 'block' : 'none';

    const results = searchEngine.search(query);
    renderTopicList(results);
  }

  /**
   * トピックリストを描画
   */
  function renderTopicList(items) {
    if (items.length === 0) {
      elements.topicList.innerHTML = '<div class="no-results">検索結果がありません</div>';
      return;
    }

    // カテゴリでグループ化
    const groups = {};
    items.forEach(item => {
      const category = item.category || 'その他';
      if (!groups[category]) {
        groups[category] = [];
      }
      groups[category].push(item);
    });

    let html = '';
    Object.keys(groups).sort().forEach(category => {
      const isCollapsed = state.collapsedCategories.has(category);
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
        const badges = [];
        if (item.htmlPath) badges.push('HTML');
        if (item.qaPath) badges.push('Q&A');

        html += `
          <div class="topic-item${isActive ? ' active' : ''}" data-id="${escapeHtml(item.id)}">
            <span class="title">${searchEngine.highlight(escapeHtml(item.title), state.searchQuery)}</span>
            <span class="badges">
              ${badges.map(b => `<span class="badge">${b}</span>`).join('')}
            </span>
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
    const results = searchEngine.search(state.searchQuery);
    renderTopicList(results);
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
   * コンテンツを読み込み
   */
  function loadContent(item) {
    // HTML
    if (item.htmlPath) {
      elements.htmlFrame.src = item.htmlPath;
      elements.htmlFrame.style.display = 'block';
      elements.htmlContent.querySelector('.placeholder').style.display = 'none';
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
      elements.qaContent.querySelector('.placeholder').style.display = 'none';

      // Q&Aの折りたたみイベント
      elements.qaDisplay.querySelectorAll('.qa-question').forEach(q => {
        q.addEventListener('click', () => {
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

      // セクションヘッダ
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

      // セパレータ
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

      // 関連質問開始
      if (line === '[関連質問]') {
        inRelated = true;
        continue;
      }

      // 関連質問項目
      if (inRelated && line.startsWith('- ')) {
        relatedItems.push(line.slice(2));
        continue;
      }

      // Q&A
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
