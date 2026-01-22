/**
 * 関連トピックモジュール + ネットワークグラフビュー
 * graph-data.jsonから関連トピック情報を取得し、D3.jsでグラフ表示
 */
const GraphModule = (function() {
  // 状態管理
  let graphData = null;
  let adjacencyMap = new Map();
  let searchTextMap = new Map(); // id -> searchText（本文検索用）
  let isLoaded = false;

  // グラフ表示状態
  let svg = null;
  let simulation = null;
  let zoomBehavior = null;
  let graphGroup = null;
  let nodesGroup = null;
  let edgesGroup = null;
  let selectedNodeId = null;
  let activeFilters = new Set();
  let searchQuery = '';
  let isGraphInitialized = false;

  // 科目別カラーマップ（実際のデータに合わせた名称）
  const subjectColors = {
    // 基礎系
    '解剖': '#FF6B6B',
    '生理': '#4ECDC4',
    '生化': '#45B7D1',
    '薬理': '#FFEAA7',
    '微生物・免疫': '#DDA0DD',
    // 臨床系
    '歯科理工': '#87CEEB',
    '保存修復': '#B8860B',
    '歯内療法': '#CD853F',
    '歯内療法学': '#CD853F',
    '歯周病': '#228B22',
    '口腔外科': '#DC143C',
    '全部床義歯': '#4169E1',
    '部分床義歯': '#6A5ACD',
    '摂食嚥下': '#FF69B4',
    // 社会系
    '公衆衛生': '#32CD32',
    '口腔衛生': '#3CB371',
    '疫学': '#20B2AA',
    '必修': '#FF8C00',
    // フォールバック（「学」付き）
    '解剖学': '#FF6B6B',
    '生理学': '#4ECDC4',
    '薬理学': '#FFEAA7',
    '歯科理工学': '#87CEEB',
    '保存修復学': '#B8860B',
    '歯周病学': '#228B22',
    '口腔外科学': '#DC143C'
  };

  /**
   * グラフデータを読み込み
   */
  async function loadGraphData() {
    if (isLoaded && graphData) return graphData;

    try {
      const response = await fetch('graph-data.json');
      if (!response.ok) throw new Error('Failed to load graph data');
      const rawData = await response.json();

      graphData = rawData;
      buildAdjacencyMap(rawData);
      buildSearchTextMap(); // 本文検索用マップを構築
      isLoaded = true;

      console.log(`関連データを読み込みました: ${rawData.nodes.length}ノード, ${rawData.edges.length}エッジ`);
      return graphData;
    } catch (error) {
      console.error('関連データの読み込みに失敗:', error);
      return null;
    }
  }

  /**
   * 隣接ノードマップを構築
   */
  function buildAdjacencyMap(rawData) {
    adjacencyMap.clear();
    if (!rawData) return;

    rawData.nodes.forEach(node => {
      adjacencyMap.set(node.data.id, new Set());
    });

    rawData.edges.forEach(edge => {
      const sourceId = edge.data.source;
      const targetId = edge.data.target;

      if (adjacencyMap.has(sourceId)) {
        adjacencyMap.get(sourceId).add(targetId);
      }
      if (adjacencyMap.has(targetId)) {
        adjacencyMap.get(targetId).add(sourceId);
      }
    });
  }

  /**
   * 本文検索用マップを構築（DATA配列から）
   */
  function buildSearchTextMap() {
    searchTextMap.clear();
    if (typeof DATA === 'undefined') {
      console.warn('DATA配列が見つかりません。本文検索は無効です。');
      return;
    }
    DATA.forEach(item => {
      if (item.id && item.searchText) {
        searchTextMap.set(item.id, item.searchText.toLowerCase());
      }
    });
    console.log(`本文検索マップを構築: ${searchTextMap.size}件`);
  }

  /**
   * 特定トピックの関連トピックを取得
   * @param {string} topicId - トピックID
   * @returns {Array} 関連トピック情報の配列
   */
  async function getRelatedTopics(topicId) {
    if (!isLoaded) {
      await loadGraphData();
    }

    if (!graphData || !adjacencyMap.has(topicId)) {
      return [];
    }

    const neighbors = adjacencyMap.get(topicId);
    if (!neighbors || neighbors.size === 0) {
      return [];
    }

    // 関連トピックの情報を取得
    const relatedTopics = [];
    neighbors.forEach(neighborId => {
      const nodeData = graphData.nodes.find(n => n.data.id === neighborId);
      if (nodeData) {
        relatedTopics.push({
          id: neighborId,
          label: nodeData.data.label,
          subject: nodeData.data.subject,
          color: nodeData.data.color || subjectColors[nodeData.data.subject] || '#A0A0A0'
        });
      }
    });

    return relatedTopics;
  }

  /**
   * 科目の色を取得
   * @param {string} subject - 科目名
   * @returns {string} 色コード
   */
  function getSubjectColor(subject) {
    return subjectColors[subject] || '#A0A0A0';
  }

  // ========================================
  // グラフ表示機能
  // ========================================

  /**
   * グラフを初期化・描画
   */
  async function initGraph() {
    if (isGraphInitialized) return;

    // D3.jsが読み込まれているか確認
    if (typeof d3 === 'undefined') {
      console.error('D3.js is not loaded');
      return;
    }

    // データを読み込む
    await loadGraphData();
    if (!graphData) {
      console.error('Graph data not available');
      return;
    }

    // SVG要素を取得
    const svgElement = document.getElementById('graph-svg');
    if (!svgElement) {
      console.error('SVG element not found');
      return;
    }

    svg = d3.select(svgElement);
    const container = document.getElementById('graph-viewport');
    const width = container.clientWidth;
    const height = container.clientHeight;

    // SVGをクリア
    svg.selectAll('*').remove();

    // ズーム用のグループを作成
    graphGroup = svg.append('g').attr('class', 'graph-group');
    edgesGroup = graphGroup.append('g').attr('class', 'edges-group');
    nodesGroup = graphGroup.append('g').attr('class', 'nodes-group');

    // ノードデータを準備（接続数を計算）
    const nodes = graphData.nodes.map(n => {
      const connections = adjacencyMap.get(n.data.id)?.size || 0;
      // 色の決定: subjectColorsを優先、なければデータの色、最後にグレー
      const dataColor = n.data.color;
      const subjectColor = subjectColors[n.data.subject];
      // グレー(#A0A0A0)はsubjectColorsで上書き
      const finalColor = subjectColor || (dataColor !== '#A0A0A0' ? dataColor : null) || '#A0A0A0';
      return {
        id: n.data.id,
        label: n.data.label,
        subject: n.data.subject,
        color: finalColor,
        connections: connections,
        radius: Math.max(8, Math.min(25, 8 + connections * 1.5))
      };
    });

    // エッジデータを準備
    const edges = graphData.edges.map(e => ({
      source: e.data.source,
      target: e.data.target
    }));

    // Force Simulationを設定
    simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(edges).id(d => d.id).distance(80).strength(0.5))
      .force('charge', d3.forceManyBody().strength(-200).distanceMax(300))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(d => d.radius + 5));

    // エッジを描画
    const edgeElements = edgesGroup.selectAll('line')
      .data(edges)
      .enter()
      .append('line')
      .attr('class', 'graph-edge');

    // ノードグループを描画
    const nodeElements = nodesGroup.selectAll('g')
      .data(nodes)
      .enter()
      .append('g')
      .attr('class', 'graph-node')
      .call(d3.drag()
        .on('start', dragStarted)
        .on('drag', dragged)
        .on('end', dragEnded));

    // ノードの円
    nodeElements.append('circle')
      .attr('r', d => d.radius)
      .attr('fill', d => d.color);

    // ノードのラベル
    nodeElements.append('text')
      .attr('class', 'graph-node-label')
      .attr('dy', d => d.radius + 14)
      .text(d => truncateLabel(d.label, 8));

    // ノードタップ/クリックイベント（シングル→ツールチップ、ダブル→トピック開く）
    let lastTapTime = 0;
    let lastTapNodeId = null;

    nodeElements.on('click', (event, d) => {
      event.stopPropagation();

      const currentTime = Date.now();
      const isDoubleTap = (currentTime - lastTapTime < 300) && (lastTapNodeId === d.id);

      if (isDoubleTap) {
        // ダブルタップ→トピックを開く
        openTopic(d.id);
        lastTapTime = 0;
        lastTapNodeId = null;
      } else {
        // シングルタップ→ツールチップ表示
        selectNode(d.id);
        lastTapTime = currentTime;
        lastTapNodeId = d.id;
      }
    });

    // 背景クリックで選択解除
    svg.on('click', () => {
      deselectNode();
    });

    // シミュレーションの更新
    simulation.on('tick', () => {
      edgeElements
        .attr('x1', d => d.source.x)
        .attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x)
        .attr('y2', d => d.target.y);

      nodeElements
        .attr('transform', d => `translate(${d.x}, ${d.y})`);
    });

    // ズーム設定
    setupZoom(width, height);

    // フィルタチップを生成
    setupFilterChips();

    // 検索設定
    setupSearch();

    isGraphInitialized = true;
    console.log('Graph initialized');
  }

  /**
   * ラベルを省略（「_」以降の部分を使用）
   */
  function truncateLabel(label, maxLen) {
    // 「_」が含まれていれば、最後の「_」以降を使用
    let displayLabel = label;
    const underscoreIndex = label.lastIndexOf('_');
    if (underscoreIndex !== -1 && underscoreIndex < label.length - 1) {
      displayLabel = label.substring(underscoreIndex + 1);
    }

    if (displayLabel.length <= maxLen) return displayLabel;
    return displayLabel.substring(0, maxLen) + '…';
  }

  /**
   * ズームを設定
   */
  function setupZoom(width, height) {
    zoomBehavior = d3.zoom()
      .scaleExtent([0.3, 4])
      .on('zoom', (event) => {
        graphGroup.attr('transform', event.transform);
        // ツールチップの位置も更新
        if (selectedNodeId) {
          updateTooltipPosition(selectedNodeId);
        }
      });

    svg.call(zoomBehavior);

    // 初期ズームレベルを設定（見やすい拡大率）
    const initialScale = 1.3;
    svg.call(zoomBehavior.transform, d3.zoomIdentity
      .translate(width * -0.3, height * -0.3)
      .scale(initialScale));
  }

  /**
   * ドラッグ開始
   */
  function dragStarted(event, d) {
    if (!event.active) simulation.alphaTarget(0.3).restart();
    d.fx = d.x;
    d.fy = d.y;
  }

  /**
   * ドラッグ中
   */
  function dragged(event, d) {
    d.fx = event.x;
    d.fy = event.y;
  }

  /**
   * ドラッグ終了
   */
  function dragEnded(event, d) {
    if (!event.active) simulation.alphaTarget(0);
    d.fx = null;
    d.fy = null;
  }

  /**
   * ノードを選択
   */
  function selectNode(nodeId) {
    if (selectedNodeId === nodeId) {
      deselectNode();
      return;
    }

    selectedNodeId = nodeId;
    const neighbors = adjacencyMap.get(nodeId) || new Set();

    // ノードのハイライト
    nodesGroup.selectAll('.graph-node')
      .classed('selected', d => d.id === nodeId)
      .classed('dimmed', d => d.id !== nodeId && !neighbors.has(d.id));

    // エッジのハイライト
    edgesGroup.selectAll('.graph-edge')
      .classed('highlighted', d => d.source.id === nodeId || d.target.id === nodeId)
      .classed('dimmed', d => d.source.id !== nodeId && d.target.id !== nodeId);

    // ツールチップを表示
    showTooltip(nodeId);

    // ノードを画面中央に移動
    centerOnNode(nodeId);
  }

  /**
   * ノードの選択を解除
   */
  function deselectNode() {
    selectedNodeId = null;

    nodesGroup.selectAll('.graph-node')
      .classed('selected', false)
      .classed('dimmed', false);

    edgesGroup.selectAll('.graph-edge')
      .classed('highlighted', false)
      .classed('dimmed', false);

    hideTooltip();
  }

  /**
   * ツールチップを表示（ノード横に吹き出し）
   */
  function showTooltip(nodeId) {
    const tooltip = document.getElementById('graph-tooltip');
    if (!tooltip) return;

    const nodeData = graphData.nodes.find(n => n.data.id === nodeId);
    if (!nodeData) return;

    const color = subjectColors[nodeData.data.subject] || nodeData.data.color || '#A0A0A0';

    tooltip.innerHTML = `
      <div class="tooltip-content">
        <span class="tooltip-dot" style="background: ${color}"></span>
        <div class="tooltip-text">
          <strong>${nodeData.data.label}</strong>
          <span>${nodeData.data.subject || '科目未設定'}</span>
        </div>
      </div>
    `;

    // 位置を計算して設定
    updateTooltipPosition(nodeId);
    tooltip.classList.add('visible');

    // ツールチップをタップでポップアップを表示
    tooltip.onclick = (e) => {
      e.stopPropagation();
      showTopicPopup(nodeId);
    };
  }

  /**
   * ツールチップの位置を更新
   */
  function updateTooltipPosition(nodeId) {
    const tooltip = document.getElementById('graph-tooltip');
    if (!tooltip || !selectedNodeId) return;

    const node = simulation.nodes().find(n => n.id === nodeId);
    if (!node) return;

    const container = document.getElementById('graph-viewport');
    const containerRect = container.getBoundingClientRect();

    // 現在のズームトランスフォームを取得
    const transform = d3.zoomTransform(svg.node());

    // ノードの画面座標を計算
    const screenX = transform.applyX(node.x);
    const screenY = transform.applyY(node.y);

    // ノードの半径（スケール考慮）
    const nodeRadius = (node.radius || 10) * transform.k;

    // ツールチップのサイズを取得
    const tooltipRect = tooltip.getBoundingClientRect();
    const tooltipWidth = tooltipRect.width || 180;
    const tooltipHeight = tooltipRect.height || 80;

    // 右側に十分なスペースがあるかチェック
    const spaceRight = containerRect.width - screenX - nodeRadius - 20;
    const showOnRight = spaceRight >= tooltipWidth;

    // 水平位置
    let left;
    if (showOnRight) {
      // ノードの右側に表示
      left = screenX + nodeRadius + 12;
      tooltip.classList.remove('tooltip-left');
    } else {
      // ノードの左側に表示
      left = screenX - nodeRadius - tooltipWidth - 12;
      tooltip.classList.add('tooltip-left');
    }

    // 垂直位置（中央揃え、画面外にはみ出さないよう調整）
    let top = screenY - tooltipHeight / 2;
    top = Math.max(10, Math.min(top, containerRect.height - tooltipHeight - 10));

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  /**
   * ツールチップを非表示
   */
  function hideTooltip() {
    const tooltip = document.getElementById('graph-tooltip');
    if (tooltip) {
      tooltip.classList.remove('visible');
    }
  }

  /**
   * トピックを開く
   */
  function openTopic(topicId) {
    // app.jsのselectItemを呼び出す
    if (typeof window.selectItem === 'function') {
      window.selectItem(topicId);
    } else {
      console.warn('selectItem function not available');
    }
  }

  /**
   * トピックプレビューポップアップを表示
   */
  async function showTopicPopup(topicId) {
    const overlay = document.getElementById('topic-popup-overlay');
    const titleEl = overlay.querySelector('.topic-popup-title');
    const bodyEl = document.getElementById('topic-popup-body');
    const openBtn = document.getElementById('topic-popup-open');
    const closeBtn = document.getElementById('topic-popup-close');
    const backdrop = overlay.querySelector('.topic-popup-backdrop');

    if (!overlay) return;

    // ノードデータを取得
    const nodeData = graphData.nodes.find(n => n.data.id === topicId);
    if (!nodeData) return;

    // タイトルを設定
    titleEl.textContent = nodeData.data.label;

    // ローディング表示
    bodyEl.innerHTML = '<div class="topic-popup-loading">読み込み中...</div>';

    // ポップアップを表示
    overlay.classList.add('visible');

    // DATAからhtmlPathを取得
    let htmlPath = null;
    if (typeof DATA !== 'undefined') {
      const dataItem = DATA.find(d => d.id === topicId || d.title === nodeData.data.label);
      if (dataItem && dataItem.htmlPath) {
        htmlPath = dataItem.htmlPath;
      }
    }

    // HTMLコンテンツを読み込み
    if (htmlPath) {
      try {
        const response = await fetch(encodeURI(htmlPath));
        if (response.ok) {
          const html = await response.text();
          // HTMLから本文だけを抽出（h1タイトルを除く）
          const tempDiv = document.createElement('div');
          tempDiv.innerHTML = html;
          // h1を削除
          const h1 = tempDiv.querySelector('h1');
          if (h1) h1.remove();
          bodyEl.innerHTML = tempDiv.innerHTML || '<p>コンテンツがありません</p>';
        } else {
          bodyEl.innerHTML = '<p>コンテンツを読み込めませんでした</p>';
        }
      } catch (error) {
        bodyEl.innerHTML = '<p>コンテンツを読み込めませんでした</p>';
      }
    } else {
      bodyEl.innerHTML = '<p>このトピックのコンテンツはまだありません</p>';
    }

    // タブバーを非表示
    const tabbar = document.querySelector('.floating-tabbar');
    if (tabbar) tabbar.style.display = 'none';

    // イベントハンドラを設定
    const closePopup = () => {
      overlay.classList.remove('visible');
      // タブバーを再表示
      if (tabbar) tabbar.style.display = '';
    };

    backdrop.onclick = closePopup;
    closeBtn.onclick = closePopup;
  }

  /**
   * トピックプレビューポップアップを非表示
   */
  function hideTopicPopup() {
    const overlay = document.getElementById('topic-popup-overlay');
    if (overlay) {
      overlay.classList.remove('visible');
    }
  }

  /**
   * ノードにフォーカス移動
   */
  function centerOnNode(nodeId) {
    const node = simulation.nodes().find(n => n.id === nodeId);
    if (!node || !svg || !zoomBehavior) return;

    const container = document.getElementById('graph-viewport');
    const width = container.clientWidth;
    const height = container.clientHeight;

    const scale = 1.2;
    const x = width / 2 - node.x * scale;
    const y = height / 2 - node.y * scale;

    svg.transition()
      .duration(500)
      .call(zoomBehavior.transform, d3.zoomIdentity.translate(x, y).scale(scale));
  }

  /**
   * フィルタチップを設定
   */
  function setupFilterChips() {
    const filtersContainer = document.getElementById('graph-filters');
    if (!filtersContainer) return;

    // 科目一覧を取得
    const subjects = new Set();
    graphData.nodes.forEach(n => {
      if (n.data.subject) subjects.add(n.data.subject);
    });

    // チップを生成
    filtersContainer.innerHTML = '';
    subjects.forEach(subject => {
      const chip = document.createElement('button');
      chip.className = 'graph-filter-chip';
      chip.dataset.subject = subject;

      const color = subjectColors[subject] || '#A0A0A0';
      chip.innerHTML = `<span class="chip-dot" style="background-color: ${color}"></span>${subject}`;

      chip.addEventListener('click', () => {
        toggleFilter(subject, chip);
      });

      filtersContainer.appendChild(chip);
    });
  }

  /**
   * フィルタをトグル
   */
  function toggleFilter(subject, chip) {
    if (activeFilters.has(subject)) {
      activeFilters.delete(subject);
      chip.classList.remove('active');
    } else {
      activeFilters.add(subject);
      chip.classList.add('active');
    }
    applyFilters();
  }

  /**
   * 検索を設定
   */
  function setupSearch() {
    const searchInput = document.getElementById('graph-search');
    if (!searchInput) return;

    let debounceTimer = null;

    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value.toLowerCase().trim();
      applyFilters(false); // 即時フィルタリング（中央移動なし）

      // デバウンスで中央移動（300ms後）
      clearTimeout(debounceTimer);
      if (searchQuery) {
        debounceTimer = setTimeout(() => {
          applyFilters(true); // 中央移動あり
        }, 300);
      }
    });
  }

  /**
   * 検索クエリにマッチするかチェック（タイトル + 本文）
   */
  function matchesSearch(nodeId, label) {
    if (!searchQuery) return true;

    // タイトルでマッチ
    if (label.toLowerCase().includes(searchQuery)) {
      return true;
    }

    // 本文でマッチ（searchTextMap使用）
    const searchText = searchTextMap.get(nodeId);
    if (searchText && searchText.includes(searchQuery)) {
      return true;
    }

    return false;
  }

  /**
   * フィルタと検索を適用
   */
  function applyFilters(shouldCenter = false) {
    if (!nodesGroup || !edgesGroup) return;

    let firstMatchedNodeId = null;

    nodesGroup.selectAll('.graph-node')
      .each(function(d) {
        const node = d3.select(this);
        let visible = true;

        // 科目フィルタ
        if (activeFilters.size > 0 && !activeFilters.has(d.subject)) {
          visible = false;
        }

        // 検索フィルタ（タイトル + 本文）
        if (searchQuery && !matchesSearch(d.id, d.label)) {
          visible = false;
        }

        node.style('display', visible ? null : 'none');

        // 検索でヒットした最初のノードを記録
        if (visible && searchQuery && !firstMatchedNodeId) {
          firstMatchedNodeId = d.id;
        }
      });

    // エッジの表示を更新
    edgesGroup.selectAll('.graph-edge')
      .each(function(d) {
        const edge = d3.select(this);
        const sourceNode = nodesGroup.select(`[data-id="${d.source.id}"]`);
        const targetNode = nodesGroup.select(`[data-id="${d.target.id}"]`);

        // 両端のノードが表示されている場合のみエッジを表示
        let sourceVisible = true;
        let targetVisible = true;

        // ソースノードの可視性チェック
        if (activeFilters.size > 0 && !activeFilters.has(d.source.subject)) {
          sourceVisible = false;
        }
        if (searchQuery && !matchesSearch(d.source.id, d.source.label || '')) {
          sourceVisible = false;
        }

        // ターゲットノードの可視性チェック
        if (activeFilters.size > 0 && !activeFilters.has(d.target.subject)) {
          targetVisible = false;
        }
        if (searchQuery && !matchesSearch(d.target.id, d.target.label || '')) {
          targetVisible = false;
        }

        edge.style('display', (sourceVisible && targetVisible) ? null : 'none');
      });

    // ヒットしたノードを画面中央に移動
    if (shouldCenter && firstMatchedNodeId) {
      centerOnNode(firstMatchedNodeId);
    }
  }

  /**
   * グラフを破棄
   */
  function destroyGraph() {
    if (simulation) {
      simulation.stop();
      simulation = null;
    }
    if (svg) {
      svg.selectAll('*').remove();
    }

    selectedNodeId = null;
    activeFilters.clear();
    searchQuery = '';
    isGraphInitialized = false;

    hideTooltip();

    // 検索入力をクリア
    const searchInput = document.getElementById('graph-search');
    if (searchInput) searchInput.value = '';

    // フィルタをクリア
    const chips = document.querySelectorAll('.graph-filter-chip');
    chips.forEach(chip => chip.classList.remove('active'));

    console.log('Graph destroyed');
  }

  /**
   * 初期化（互換性のため）
   */
  function init() {
    console.log('GraphModule initialized');
  }

  /**
   * 互換性のためのダミー関数
   */
  function show() {}
  function hide() {}
  function switchToListView() {}
  function switchToGraphView() {}

  // 公開API
  return {
    init,
    show,
    hide,
    switchToListView,
    switchToGraphView,
    loadGraphData,
    getRelatedTopics,
    getSubjectColor,
    // 新しいグラフ機能
    initGraph,
    destroyGraph,
    selectNode,
    deselectNode,
    centerOnNode
  };
})();

// DOMContentLoadedで初期化
document.addEventListener('DOMContentLoaded', () => {
  GraphModule.init();
});
