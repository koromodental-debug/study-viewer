/**
 * グラフビューモジュール
 * Cytoscape.jsを使用してトピック間の関連性をネットワークグラフで表示
 */
const GraphModule = (function() {
  // 状態管理
  let cy = null;
  let graphData = null;
  let isInitialized = false;
  let selectedNodeId = null;

  // DOM要素
  const elements = {
    graphContainer: null,
    graphCanvas: null,
    graphLegend: null,
    viewToggleContainer: null,
    listViewBtn: null,
    graphViewBtn: null,
    previewOverlay: null,
    previewSubject: null,
    previewTitle: null,
    previewBody: null,
    previewClose: null,
    previewOpen: null,
    previewRelatedList: null,
    zoomInBtn: null,
    zoomOutBtn: null,
    fitBtn: null,
    // リストビュー要素
    historySection: null,
    recommendSection: null,
    topicsSection: null
  };

  // 科目別カラーマップ
  const subjectColors = {
    '解剖学': '#FF6B6B',
    '生理学': '#4ECDC4',
    '生化学': '#45B7D1',
    '病理学': '#96CEB4',
    '薬理学': '#FFEAA7',
    '微生物学': '#DDA0DD',
    '口腔解剖学': '#FF8C69',
    '口腔生理学': '#20B2AA',
    '口腔生化学': '#87CEEB',
    '口腔病理学': '#98D8C8',
    '歯科薬理学': '#FFD700',
    '歯科理工学': '#C0C0C0',
    '保存修復学': '#B8860B',
    '歯内療法学': '#CD853F',
    '歯周病学': '#228B22',
    '冠橋義歯学': '#4169E1',
    '有床義歯学': '#6A5ACD',
    '口腔外科学': '#DC143C',
    '歯科矯正学': '#FF69B4',
    '小児歯科学': '#FFB6C1',
    '高齢者歯科学': '#8B4513',
    '障害者歯科学': '#9370DB',
    '歯科放射線学': '#708090',
    '歯科麻酔学': '#2F4F4F',
    '公衆衛生': '#32CD32',
    '社会歯科学': '#3CB371',
    '医療倫理': '#778899',
    '医療法規': '#696969'
  };

  /**
   * DOM要素を取得
   */
  function getElements() {
    elements.graphContainer = document.getElementById('graph-view-container');
    elements.graphCanvas = document.getElementById('graph-canvas');
    elements.graphLegend = document.getElementById('graph-legend');
    elements.viewToggleContainer = document.getElementById('view-toggle-container');
    elements.listViewBtn = document.getElementById('view-list-btn');
    elements.graphViewBtn = document.getElementById('view-graph-btn');
    elements.previewOverlay = document.getElementById('graph-preview-overlay');
    elements.previewSubject = document.getElementById('graph-preview-subject');
    elements.previewTitle = document.getElementById('graph-preview-title');
    elements.previewBody = document.getElementById('graph-preview-body');
    elements.previewClose = document.getElementById('graph-preview-close');
    elements.previewOpen = document.getElementById('graph-preview-open');
    elements.previewRelatedList = document.getElementById('graph-preview-related-list');
    elements.zoomInBtn = document.getElementById('graph-zoom-in');
    elements.zoomOutBtn = document.getElementById('graph-zoom-out');
    elements.fitBtn = document.getElementById('graph-fit');
    elements.historySection = document.getElementById('welcome-history-section');
    elements.recommendSection = document.getElementById('welcome-recommend-section');
    elements.topicsSection = document.getElementById('welcome-topics');
  }

  /**
   * グラフデータを読み込み
   */
  async function loadGraphData() {
    if (graphData) return graphData;

    try {
      const response = await fetch('graph-data.json');
      if (!response.ok) throw new Error('Failed to load graph data');
      graphData = await response.json();
      console.log(`グラフデータを読み込みました: ${graphData.nodes.length}ノード, ${graphData.edges.length}エッジ`);
      return graphData;
    } catch (error) {
      console.error('グラフデータの読み込みに失敗:', error);
      return null;
    }
  }

  /**
   * Cytoscapeを初期化
   */
  async function initCytoscape() {
    if (isInitialized || !elements.graphCanvas) return;

    const data = await loadGraphData();
    if (!data) {
      elements.graphCanvas.innerHTML = '<p style="text-align:center;padding:20px;color:var(--text-secondary);">グラフデータを読み込めませんでした</p>';
      return;
    }

    cy = cytoscape({
      container: elements.graphCanvas,
      elements: [...data.nodes, ...data.edges],
      style: [
        {
          selector: 'node',
          style: {
            'background-color': 'data(color)',
            'label': 'data(label)',
            'font-size': '10px',
            'color': 'var(--text-primary)',
            'text-valign': 'bottom',
            'text-halign': 'center',
            'text-margin-y': '5px',
            'width': 20,
            'height': 20,
            'border-width': 2,
            'border-color': '#fff',
            'text-max-width': '80px',
            'text-wrap': 'ellipsis',
            'text-overflow-wrap': 'anywhere',
            'min-zoomed-font-size': 8
          }
        },
        {
          selector: 'node:selected',
          style: {
            'border-width': 4,
            'border-color': '#007AFF',
            'width': 30,
            'height': 30
          }
        },
        {
          selector: 'node.highlighted',
          style: {
            'border-width': 3,
            'border-color': '#FF9500',
            'z-index': 999
          }
        },
        {
          selector: 'edge',
          style: {
            'width': 'mapData(weight, 0.15, 0.5, 1, 4)',
            'line-color': 'var(--border-color)',
            'opacity': 0.4,
            'curve-style': 'bezier'
          }
        },
        {
          selector: 'edge.highlighted',
          style: {
            'line-color': '#007AFF',
            'opacity': 0.8,
            'z-index': 998
          }
        },
        {
          selector: 'node.dimmed',
          style: {
            'opacity': 0.2
          }
        },
        {
          selector: 'edge.dimmed',
          style: {
            'opacity': 0.1
          }
        }
      ],
      layout: {
        name: 'cose',
        animate: false,
        nodeRepulsion: 8000,
        nodeOverlap: 20,
        idealEdgeLength: 100,
        edgeElasticity: 100,
        nestingFactor: 5,
        gravity: 80,
        numIter: 1000,
        initialTemp: 200,
        coolingFactor: 0.95,
        minTemp: 1.0
      },
      minZoom: 0.2,
      maxZoom: 3,
      wheelSensitivity: 0.3
    });

    // イベントバインド
    bindCytoscapeEvents();

    // 凡例を生成
    generateLegend();

    isInitialized = true;
    console.log('Cytoscapeを初期化しました');
  }

  /**
   * Cytoscapeのイベントをバインド
   */
  function bindCytoscapeEvents() {
    if (!cy) return;

    // ノードタップ
    cy.on('tap', 'node', function(evt) {
      const node = evt.target;
      selectedNodeId = node.id();
      highlightConnections(node);
      showPreview(node.data());
    });

    // ノードダブルタップ（トピックを開く）
    cy.on('dbltap', 'node', function(evt) {
      const node = evt.target;
      openTopic(node.id());
    });

    // 背景タップ（選択解除）
    cy.on('tap', function(evt) {
      if (evt.target === cy) {
        clearHighlight();
        closePreview();
      }
    });

    // マウスオーバー（PC用）
    cy.on('mouseover', 'node', function(evt) {
      const node = evt.target;
      node.style('cursor', 'pointer');
    });

    cy.on('mouseout', 'node', function(evt) {
      const node = evt.target;
      node.style('cursor', 'default');
    });
  }

  /**
   * 接続されたノード・エッジをハイライト
   */
  function highlightConnections(node) {
    // 全要素を暗くする
    cy.elements().addClass('dimmed');

    // 選択ノードとその接続をハイライト
    const neighborhood = node.neighborhood();
    node.removeClass('dimmed').addClass('highlighted');
    neighborhood.removeClass('dimmed');
    neighborhood.edges().addClass('highlighted');
    neighborhood.nodes().addClass('highlighted');
  }

  /**
   * ハイライトをクリア
   */
  function clearHighlight() {
    if (!cy) return;
    cy.elements().removeClass('dimmed highlighted');
    selectedNodeId = null;
  }

  /**
   * プレビューを表示
   */
  function showPreview(nodeData) {
    if (!elements.previewOverlay) return;

    elements.previewSubject.textContent = nodeData.subject || '';
    elements.previewSubject.style.backgroundColor = nodeData.color || '#A0A0A0';
    elements.previewTitle.textContent = nodeData.label || '';

    // DATAからトピック情報を取得
    const topic = DATA.find(item => item.id === nodeData.id);
    if (topic) {
      // プレビュー本文（searchTextの一部を表示）
      const previewText = topic.searchText
        ? topic.searchText.substring(0, 200) + (topic.searchText.length > 200 ? '...' : '')
        : 'プレビューなし';
      elements.previewBody.innerHTML = `<p>${previewText}</p>`;
    } else {
      elements.previewBody.innerHTML = '<p>プレビューなし</p>';
    }

    // 関連トピックを表示
    renderRelatedTopics(nodeData.id);

    // モーダルを開く
    elements.previewOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  /**
   * 関連トピックを表示
   */
  function renderRelatedTopics(nodeId) {
    if (!cy || !elements.previewRelatedList) return;

    const node = cy.getElementById(nodeId);
    const neighbors = node.neighborhood('node');

    if (neighbors.length === 0) {
      elements.previewRelatedList.innerHTML = '<span class="no-related">関連トピックなし</span>';
      return;
    }

    const html = neighbors.map(n => {
      const data = n.data();
      return `
        <button class="related-topic-chip" data-topic-id="${data.id}" style="border-color: ${data.color}">
          <span class="related-topic-dot" style="background-color: ${data.color}"></span>
          <span class="related-topic-label">${data.label}</span>
        </button>
      `;
    }).join('');

    elements.previewRelatedList.innerHTML = html;
  }

  /**
   * プレビューを閉じる
   */
  function closePreview() {
    if (!elements.previewOverlay) return;
    elements.previewOverlay.classList.remove('active');
    document.body.style.overflow = '';
  }

  /**
   * トピックを開く
   */
  function openTopic(topicId) {
    closePreview();
    switchToListView();

    // app.jsのselectItem関数を呼び出し
    if (typeof window.selectItem === 'function') {
      window.selectItem(topicId);
    }
  }

  /**
   * 凡例を生成
   */
  function generateLegend() {
    if (!graphData || !elements.graphLegend) return;

    // 使用されている科目を収集
    const usedSubjects = new Set();
    graphData.nodes.forEach(node => {
      if (node.data.subject) {
        usedSubjects.add(node.data.subject);
      }
    });

    // 凡例HTML生成
    const legendItems = Array.from(usedSubjects).sort().map(subject => {
      const color = subjectColors[subject] || '#A0A0A0';
      return `
        <button class="legend-item" data-subject="${subject}">
          <span class="legend-dot" style="background-color: ${color}"></span>
          <span class="legend-label">${subject}</span>
        </button>
      `;
    }).join('');

    elements.graphLegend.innerHTML = `
      <button class="legend-toggle" id="legend-toggle">
        <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
          <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
        </svg>
      </button>
      <div class="legend-content" id="legend-content" style="display:none;">
        ${legendItems}
      </div>
    `;

    // 凡例トグル
    const legendToggle = document.getElementById('legend-toggle');
    const legendContent = document.getElementById('legend-content');
    if (legendToggle && legendContent) {
      legendToggle.addEventListener('click', () => {
        const isVisible = legendContent.style.display !== 'none';
        legendContent.style.display = isVisible ? 'none' : 'flex';
      });
    }

    // 凡例アイテムクリック（フィルタリング）
    elements.graphLegend.querySelectorAll('.legend-item').forEach(item => {
      item.addEventListener('click', () => {
        const subject = item.dataset.subject;
        filterBySubject(subject);
      });
    });
  }

  /**
   * 科目でフィルタリング
   */
  function filterBySubject(subject) {
    if (!cy) return;

    // トグル処理
    const item = elements.graphLegend.querySelector(`[data-subject="${subject}"]`);
    const isActive = item.classList.contains('active');

    if (isActive) {
      // フィルタ解除
      item.classList.remove('active');
      cy.elements().removeClass('dimmed');
    } else {
      // フィルタ適用
      elements.graphLegend.querySelectorAll('.legend-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');

      cy.elements().addClass('dimmed');
      cy.nodes().filter(n => n.data('subject') === subject).removeClass('dimmed');
      cy.nodes().filter(n => n.data('subject') === subject).connectedEdges().removeClass('dimmed');
    }
  }

  /**
   * リストビューに切り替え
   */
  function switchToListView() {
    if (elements.graphContainer) elements.graphContainer.style.display = 'none';
    if (elements.historySection) elements.historySection.style.display = '';
    if (elements.recommendSection) elements.recommendSection.style.display = '';

    if (elements.listViewBtn) elements.listViewBtn.classList.add('active');
    if (elements.graphViewBtn) elements.graphViewBtn.classList.remove('active');

    localStorage.setItem('studyViewer_welcomeView', 'list');
  }

  /**
   * グラフビューに切り替え
   */
  async function switchToGraphView() {
    if (elements.historySection) elements.historySection.style.display = 'none';
    if (elements.recommendSection) elements.recommendSection.style.display = 'none';
    if (elements.topicsSection) elements.topicsSection.style.display = 'none';
    if (elements.graphContainer) elements.graphContainer.style.display = '';

    if (elements.listViewBtn) elements.listViewBtn.classList.remove('active');
    if (elements.graphViewBtn) elements.graphViewBtn.classList.add('active');

    localStorage.setItem('studyViewer_welcomeView', 'graph');

    // 遅延初期化
    if (!isInitialized) {
      await initCytoscape();
    }

    // レイアウトを再調整
    if (cy) {
      cy.resize();
      cy.fit(undefined, 30);
    }
  }

  /**
   * イベントをバインド
   */
  function bindEvents() {
    // ビュー切り替え
    if (elements.listViewBtn) {
      elements.listViewBtn.addEventListener('click', switchToListView);
    }
    if (elements.graphViewBtn) {
      elements.graphViewBtn.addEventListener('click', switchToGraphView);
    }

    // プレビュー閉じる
    if (elements.previewClose) {
      elements.previewClose.addEventListener('click', closePreview);
    }

    // プレビューバックドロップ
    if (elements.previewOverlay) {
      elements.previewOverlay.querySelector('.graph-preview-backdrop')?.addEventListener('click', closePreview);
    }

    // トピックを開く
    if (elements.previewOpen) {
      elements.previewOpen.addEventListener('click', () => {
        if (selectedNodeId) {
          openTopic(selectedNodeId);
        }
      });
    }

    // 関連トピッククリック
    if (elements.previewRelatedList) {
      elements.previewRelatedList.addEventListener('click', (e) => {
        const chip = e.target.closest('.related-topic-chip');
        if (chip) {
          const topicId = chip.dataset.topicId;
          if (topicId && cy) {
            closePreview();
            const node = cy.getElementById(topicId);
            if (node.length > 0) {
              selectedNodeId = topicId;
              highlightConnections(node);
              cy.animate({
                center: { eles: node },
                zoom: 1.5
              }, {
                duration: 300
              });
              setTimeout(() => showPreview(node.data()), 350);
            }
          }
        }
      });
    }

    // ズームコントロール
    if (elements.zoomInBtn) {
      elements.zoomInBtn.addEventListener('click', () => {
        if (cy) cy.zoom(cy.zoom() * 1.3);
      });
    }
    if (elements.zoomOutBtn) {
      elements.zoomOutBtn.addEventListener('click', () => {
        if (cy) cy.zoom(cy.zoom() / 1.3);
      });
    }
    if (elements.fitBtn) {
      elements.fitBtn.addEventListener('click', () => {
        if (cy) cy.fit(undefined, 30);
      });
    }
  }

  /**
   * 初期化
   */
  function init() {
    getElements();
    bindEvents();

    // 前回のビューを復元
    const savedView = localStorage.getItem('studyViewer_welcomeView');
    if (savedView === 'graph') {
      switchToGraphView();
    }

    console.log('GraphModule initialized');
  }

  /**
   * グラフを表示（外部から呼び出し用）
   */
  function show() {
    switchToGraphView();
  }

  /**
   * グラフを非表示（外部から呼び出し用）
   */
  function hide() {
    switchToListView();
  }

  // 公開API
  return {
    init,
    show,
    hide,
    switchToListView,
    switchToGraphView
  };
})();

// DOMContentLoadedで初期化
document.addEventListener('DOMContentLoaded', () => {
  GraphModule.init();
});
