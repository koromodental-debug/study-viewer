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
 * 科目からカラーを決定
 */
function getSubjectColor(subject) {
  const colorMap = {
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
    '医療法規': '#696969',
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
const SIMILARITY_THRESHOLD = 0.15; // 類似度の閾値
const MIN_COMMON_KEYWORDS = 3; // 最低共通キーワード数

for (let i = 0; i < topicKeywords.length; i++) {
  for (let j = i + 1; j < topicKeywords.length; j++) {
    const topic1 = topicKeywords[i];
    const topic2 = topicKeywords[j];

    // 共通キーワードを計算
    const commonKeywords = [...topic1.keywords].filter(k => topic2.keywords.has(k));

    // 最低共通キーワード数を満たさない場合はスキップ
    if (commonKeywords.length < MIN_COMMON_KEYWORDS) continue;

    // Jaccard類似度を計算
    const similarity = jaccardSimilarity(topic1.keywords, topic2.keywords);

    if (similarity >= SIMILARITY_THRESHOLD) {
      edges.push({
        data: {
          id: `${topic1.id}-${topic2.id}`,
          source: topic1.id,
          target: topic2.id,
          weight: similarity,
          commonCount: commonKeywords.length
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

// グラフデータを出力
const graphData = {
  nodes,
  edges,
  metadata: {
    generatedAt: new Date().toISOString(),
    topicCount: nodes.length,
    edgeCount: edges.length,
    similarityThreshold: SIMILARITY_THRESHOLD,
    minCommonKeywords: MIN_COMMON_KEYWORDS
  }
};

const outputPath = path.join(__dirname, '..', 'graph-data.json');
fs.writeFileSync(outputPath, JSON.stringify(graphData, null, 2), 'utf-8');
console.log(`グラフデータを出力しました: ${outputPath}`);

// 統計情報を表示
const edgeCountByNode = {};
edges.forEach(edge => {
  edgeCountByNode[edge.data.source] = (edgeCountByNode[edge.data.source] || 0) + 1;
  edgeCountByNode[edge.data.target] = (edgeCountByNode[edge.data.target] || 0) + 1;
});

const connectedNodes = Object.keys(edgeCountByNode).length;
const isolatedNodes = nodes.length - connectedNodes;
const avgEdgesPerNode = edges.length * 2 / connectedNodes;

console.log('\n=== 統計情報 ===');
console.log(`接続されたノード数: ${connectedNodes}`);
console.log(`孤立したノード数: ${isolatedNodes}`);
console.log(`平均エッジ数/ノード: ${avgEdgesPerNode.toFixed(2)}`);
