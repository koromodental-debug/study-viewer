/**
 * 検索エンジン
 */
class SearchEngine {
  constructor(data) {
    this.data = data;
    this.cache = new Map();
  }

  /**
   * 検索実行
   * @param {string} query 検索クエリ
   * @returns {Array} マッチしたアイテム
   */
  search(query) {
    if (!query || query.trim() === '') {
      return [];
    }

    const normalizedQuery = query.toLowerCase().trim();

    // キャッシュチェック
    if (this.cache.has(normalizedQuery)) {
      return this.cache.get(normalizedQuery);
    }

    const terms = normalizedQuery.split(/\s+/);
    const results = this.data.filter(item => {
      const searchText = (item.searchText || '').toLowerCase();
      const title = (item.title || '').toLowerCase();

      // すべてのタームがマッチするか
      return terms.every(term =>
        title.includes(term) || searchText.includes(term)
      );
    });

    // スコアリング（タイトルマッチを優先）
    results.sort((a, b) => {
      const aTitle = (a.title || '').toLowerCase();
      const bTitle = (b.title || '').toLowerCase();

      const aInTitle = terms.every(t => aTitle.includes(t));
      const bInTitle = terms.every(t => bTitle.includes(t));

      if (aInTitle && !bInTitle) return -1;
      if (!aInTitle && bInTitle) return 1;
      return 0;
    });

    // キャッシュに保存（最大100件）
    if (this.cache.size > 100) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(normalizedQuery, results);

    return results;
  }

  /**
   * テキスト内のキーワードをハイライト
   * @param {string} text 対象テキスト
   * @param {string} query 検索クエリ
   * @returns {string} ハイライト済みHTML
   */
  highlight(text, query) {
    if (!query || !text) return text;

    const terms = query.toLowerCase().trim().split(/\s+/);
    let result = text;

    terms.forEach(term => {
      if (term.length < 2) return;
      const regex = new RegExp(`(${this.escapeRegex(term)})`, 'gi');
      result = result.replace(regex, '<span class="highlight">$1</span>');
    });

    return result;
  }

  /**
   * 正規表現の特殊文字をエスケープ
   */
  escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * キャッシュをクリア
   */
  clearCache() {
    this.cache.clear();
  }
}
