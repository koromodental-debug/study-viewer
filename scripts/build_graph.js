/**
 * グラフデータ生成スクリプト
 * DATA配列からノード・エッジを生成し、graph-data.jsonとして出力
 */

const fs = require('fs');
const path = require('path');

// data.jsを読み込む
const dataPath = path.join(__dirname, '..', 'js', 'data.js');
const dataContent = fs.readFileSync(dataPath, 'utf-8');

// DATA配列を抽出（const DATA = [...]の部分）
const match = dataContent.match(/const DATA = (\[[\s\S]*\]);?\s*$/);
if (!match) {
  console.error('DATA配列が見つかりません');
  process.exit(1);
}

let DATA;
try {
  DATA = eval(match[1]);
} catch (e) {
  console.error('DATA配列のパースに失敗しました:', e.message);
  process.exit(1);
}

console.log(`読み込んだトピック数: ${DATA.length}`);

/**
 * searchTextからキーワードを抽出
 */
function extractKeywords(searchText) {
  if (!searchText) return [];

  // 日本語の重要キーワードを抽出（2文字以上のカタカナ・漢字・英数字）
  const keywords = new Set();

  // カタカナ語（3文字以上）
  const katakana = searchText.match(/[ァ-ヶー]{3,}/g) || [];
  katakana.forEach(k => keywords.add(k));

  // 漢字語（2文字以上）
  const kanji = searchText.match(/[一-龯]{2,}/g) || [];
  kanji.forEach(k => keywords.add(k));

  // 英語（3文字以上、大文字小文字混在OK）
  const english = searchText.match(/[A-Za-z]{3,}/g) || [];
  english.forEach(e => keywords.add(e.toLowerCase()));

  // 数字付き用語（例: COVID-19, 5-HT）
  const alphaNum = searchText.match(/[A-Za-z0-9\-]{3,}/g) || [];
  alphaNum.forEach(a => keywords.add(a.toLowerCase()));

  return Array.from(keywords);
}

/**
 * Jaccard類似度を計算
 */
function jaccardSimilarity(set1, set2) {
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  return union.size > 0 ? intersection.size / union.size : 0;
}

/**
 * 科目からカラーを決定（実際のデータの科目名に対応）
 */
function getSubjectColor(subject) {
  const colorMap = {
    // 実際のデータで使われている科目名
    '解剖': '#FF6B6B',
    '生理': '#4ECDC4',
    '生化': '#45B7D1',
    '薬理': '#FFEAA7',
    '微生物・免疫': '#DDA0DD',
    '歯科理工': '#87CEEB',
    '保存修復': '#B8860B',
    '歯内療法': '#CD853F',
    '歯内療法学': '#CD853F',
    '歯周病': '#228B22',
    '口腔外科': '#DC143C',
    '全部床義歯': '#4169E1',
    '部分床義歯': '#6A5ACD',
    '摂食嚥下': '#FF69B4',
    '公衆衛生': '#32CD32',
    '口腔衛生': '#3CB371',
    '疫学': '#20B2AA',
    '必修': '#FF8C00',
    // フォールバック用の旧名称
    '解剖学': '#FF6B6B',
    '生理学': '#4ECDC4',
    '生化学': '#45B7D1',
    '薬理学': '#FFEAA7',
    '歯科理工学': '#87CEEB',
    '保存修復学': '#B8860B',
    '歯内療法学': '#CD853F',
    '歯周病学': '#228B22',
    '口腔外科学': '#DC143C',
  };
  return colorMap[subject] || '#A0A0A0';
}

// 各トピックのキーワードを抽出
console.log('キーワードを抽出中...');
const topicKeywords = DATA.map(item => ({
  id: item.id,
  title: item.title,
  subject: item.subject || 'その他',
  category: item.category,
  keywords: new Set(extractKeywords(item.searchText || item.title))
}));

// ノードを生成
console.log('ノードを生成中...');
const nodes = topicKeywords.map(topic => ({
  data: {
    id: topic.id,
    label: topic.title,
    subject: topic.subject,
    category: topic.category,
    color: getSubjectColor(topic.subject),
    keywordCount: topic.keywords.size
  }
}));

// エッジを生成（類似度が閾値以上のペアのみ）
console.log('エッジを計算中...');
const edges = [];
const edgeSet = new Set(); // 重複防止

// 閾値設定（バランス調整）
const SIMILARITY_THRESHOLD = 0.10; // 類似度の閾値
const MIN_COMMON_KEYWORDS = 4; // 最低共通キーワード数
const SAME_CATEGORY_BONUS = 0.02; // 同カテゴリボーナス

// タイトルからキーワードを抽出する関数
function extractTitleKeywords(title) {
  const keywords = new Set();
  // 括弧内の内容も含めて抽出
  const katakana = title.match(/[ァ-ヶー]{2,}/g) || [];
  const kanji = title.match(/[一-龯]{2,}/g) || [];
  const english = title.match(/[A-Za-z]{2,}/g) || [];
  katakana.forEach(k => keywords.add(k));
  kanji.forEach(k => keywords.add(k));
  english.forEach(e => keywords.add(e.toLowerCase()));
  return keywords;
}

// 各トピックのタイトルキーワードを抽出
const topicTitleKeywords = DATA.map(item => ({
  id: item.id,
  titleKeywords: extractTitleKeywords(item.title)
}));

for (let i = 0; i < topicKeywords.length; i++) {
  for (let j = i + 1; j < topicKeywords.length; j++) {
    const topic1 = topicKeywords[i];
    const topic2 = topicKeywords[j];
    const edgeId = `${topic1.id}-${topic2.id}`;

    // 共通キーワードを計算
    const commonKeywords = [...topic1.keywords].filter(k => topic2.keywords.has(k));

    // タイトルキーワードの共通性もチェック
    const title1 = topicTitleKeywords[i].titleKeywords;
    const title2 = topicTitleKeywords[j].titleKeywords;
    const commonTitleKeywords = [...title1].filter(k => title2.has(k));

    // 同じカテゴリかどうか
    const sameCategory = topic1.category === topic2.category;
    const sameSubject = topic1.subject === topic2.subject;

    // Jaccard類似度を計算
    let similarity = jaccardSimilarity(topic1.keywords, topic2.keywords);

    // 同カテゴリ・同科目の場合はボーナス
    if (sameCategory) {
      similarity += SAME_CATEGORY_BONUS * 2;
    } else if (sameSubject) {
      similarity += SAME_CATEGORY_BONUS;
    }

    // タイトルに共通キーワードがある場合もボーナス
    if (commonTitleKeywords.length > 0) {
      similarity += 0.03 * commonTitleKeywords.length;
    }

    // エッジ生成条件（バランス重視）
    const shouldConnect =
      (similarity >= SIMILARITY_THRESHOLD && commonKeywords.length >= MIN_COMMON_KEYWORDS) ||
      (commonTitleKeywords.length >= 1 && commonKeywords.length >= 4) || // タイトルに共通キーワードがあり、内容で4つ以上共通なら接続
      (sameCategory && commonKeywords.length >= 3); // 同カテゴリで3つ以上共通キーワードがあれば接続

    if (shouldConnect && !edgeSet.has(edgeId)) {
      edgeSet.add(edgeId);
      edges.push({
        data: {
          id: edgeId,
          source: topic1.id,
          target: topic2.id,
          weight: Math.min(similarity, 1.0), // 最大1.0に制限
          commonCount: commonKeywords.length,
          commonTitleCount: commonTitleKeywords.length
        }
      });
    }
  }

  // 進捗表示
  if ((i + 1) % 50 === 0) {
    console.log(`  ${i + 1}/${topicKeywords.length} トピック処理済み`);
  }
}

console.log(`生成されたノード数: ${nodes.length}`);
console.log(`生成されたエッジ数: ${edges.length}`);

// 孤立ノードを検出し、同じ科目の最も近いノードに接続
console.log('孤立ノードを接続中...');
const connectedNodeIds = new Set();
edges.forEach(edge => {
  connectedNodeIds.add(edge.data.source);
  connectedNodeIds.add(edge.data.target);
});

const isolatedTopics = topicKeywords.filter(t => !connectedNodeIds.has(t.id));
console.log(`孤立ノード数（フォールバック前）: ${isolatedTopics.length}`);

// 孤立ノードを同じ科目の最も類似度の高いノードに接続
isolatedTopics.forEach(isolatedTopic => {
  let bestMatch = null;
  let bestSimilarity = 0;
  let bestCommonCount = 0;

  topicKeywords.forEach(otherTopic => {
    if (isolatedTopic.id === otherTopic.id) return;

    // 同じ科目を優先
    const sameSubject = isolatedTopic.subject === otherTopic.subject;
    if (!sameSubject) return;

    const commonKeywords = [...isolatedTopic.keywords].filter(k => otherTopic.keywords.has(k));
    const similarity = jaccardSimilarity(isolatedTopic.keywords, otherTopic.keywords);

    if (similarity > bestSimilarity || (similarity === bestSimilarity && commonKeywords.length > bestCommonCount)) {
      bestSimilarity = similarity;
      bestCommonCount = commonKeywords.length;
      bestMatch = otherTopic;
    }
  });

  // 同じ科目で見つからない場合、全体から探す
  if (!bestMatch) {
    topicKeywords.forEach(otherTopic => {
      if (isolatedTopic.id === otherTopic.id) return;

      const commonKeywords = [...isolatedTopic.keywords].filter(k => otherTopic.keywords.has(k));
      const similarity = jaccardSimilarity(isolatedTopic.keywords, otherTopic.keywords);

      if (similarity > bestSimilarity || (similarity === bestSimilarity && commonKeywords.length > bestCommonCount)) {
        bestSimilarity = similarity;
        bestCommonCount = commonKeywords.length;
        bestMatch = otherTopic;
      }
    });
  }

  if (bestMatch && bestCommonCount >= 1) {
    const edgeId = `${isolatedTopic.id}-${bestMatch.id}`;
    const reverseEdgeId = `${bestMatch.id}-${isolatedTopic.id}`;
    if (!edgeSet.has(edgeId) && !edgeSet.has(reverseEdgeId)) {
      edgeSet.add(edgeId);
      edges.push({
        data: {
          id: edgeId,
          source: isolatedTopic.id,
          target: bestMatch.id,
          weight: Math.min(bestSimilarity + 0.05, 1.0), // フォールバックボーナス
          commonCount: bestCommonCount,
          fallback: true // フォールバック接続フラグ
        }
      });
    }
  }
});

console.log(`フォールバック後のエッジ数: ${edges.length}`);

// エッジを各ノードの上位N本に制限
console.log('エッジを上位接続に制限中...');
const MAX_EDGES_PER_NODE = 3; // 各ノードから最大3本の接続

// 各ノードの最強エッジを特定
const nodeEdges = new Map(); // nodeId -> [{edge, weight}]
edges.forEach(edge => {
  const src = edge.data.source;
  const tgt = edge.data.target;
  const weight = edge.data.weight;

  if (!nodeEdges.has(src)) nodeEdges.set(src, []);
  if (!nodeEdges.has(tgt)) nodeEdges.set(tgt, []);

  nodeEdges.get(src).push({ edge, weight, other: tgt });
  nodeEdges.get(tgt).push({ edge, weight, other: src });
});

// 各ノードの上位N本を選択
const selectedEdgeIds = new Set();
nodeEdges.forEach((edgeList, nodeId) => {
  // weightでソートして上位N本を選択
  edgeList.sort((a, b) => b.weight - a.weight);
  const topEdges = edgeList.slice(0, MAX_EDGES_PER_NODE);
  topEdges.forEach(e => selectedEdgeIds.add(e.edge.data.id));
});

// 選択されたエッジのみ残す
const filteredEdges = edges.filter(e => selectedEdgeIds.has(e.data.id));
console.log(`制限後のエッジ数: ${filteredEdges.length}`);

// グラフデータを出力
const graphData = {
  nodes,
  edges: filteredEdges,
  metadata: {
    generatedAt: new Date().toISOString(),
    topicCount: nodes.length,
    edgeCount: filteredEdges.length,
    originalEdgeCount: edges.length,
    maxEdgesPerNode: MAX_EDGES_PER_NODE,
    similarityThreshold: SIMILARITY_THRESHOLD,
    minCommonKeywords: MIN_COMMON_KEYWORDS
  }
};

const outputPath = path.join(__dirname, '..', 'graph-data.json');
fs.writeFileSync(outputPath, JSON.stringify(graphData, null, 2), 'utf-8');
console.log(`グラフデータを出力しました: ${outputPath}`);

// 統計情報を表示
const edgeCountByNode = {};
filteredEdges.forEach(edge => {
  edgeCountByNode[edge.data.source] = (edgeCountByNode[edge.data.source] || 0) + 1;
  edgeCountByNode[edge.data.target] = (edgeCountByNode[edge.data.target] || 0) + 1;
});

const connectedNodes = Object.keys(edgeCountByNode).length;
const isolatedNodes = nodes.length - connectedNodes;
const avgEdgesPerNode = filteredEdges.length * 2 / connectedNodes;

console.log('\n=== 統計情報 ===');
console.log(`接続されたノード数: ${connectedNodes}`);
console.log(`孤立したノード数: ${isolatedNodes}`);
console.log(`平均エッジ数/ノード: ${avgEdgesPerNode.toFixed(2)}`);
