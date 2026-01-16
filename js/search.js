/**
 * 検索エンジン
 */
class SearchEngine {
  constructor(data) {
    this.data = data;
    this.cache = new Map();
    this.fulltextIndex = null;
    this.fulltextLoaded = false;
    this.fulltextLoading = false;

    // 全文インデックスをバックグラウンドで読み込み
    this.loadFulltextIndex();
  }

  /**
   * 全文インデックスを読み込み
   */
  async loadFulltextIndex() {
    if (this.fulltextLoading || this.fulltextLoaded) return;
    this.fulltextLoading = true;

    try {
      const response = await fetch('fulltext-index.json');
      if (response.ok) {
        this.fulltextIndex = await response.json();
        this.fulltextLoaded = true;
        // キャッシュをクリア（全文検索結果が変わるため）
        this.cache.clear();
      }
    } catch (e) {
      console.warn('全文インデックスの読み込みに失敗:', e);
    }
    this.fulltextLoading = false;
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

      // タイトルまたはsearchTextでマッチ
      const matchesBasic = terms.every(term =>
        title.includes(term) || searchText.includes(term)
      );
      if (matchesBasic) return true;

      // 全文インデックスでマッチ（読み込み済みの場合）
      if (this.fulltextIndex && item.htmlPath) {
        const fulltext = (this.fulltextIndex[item.htmlPath] || '').toLowerCase();
        return terms.every(term => fulltext.includes(term));
      }

      return false;
    });

    // スコアリング（タイトルマッチを優先、subjectをlegacyより優先）
    results.sort((a, b) => {
      const aTitle = (a.title || '').toLowerCase();
      const bTitle = (b.title || '').toLowerCase();

      const aInTitle = terms.every(t => aTitle.includes(t));
      const bInTitle = terms.every(t => bTitle.includes(t));

      if (aInTitle && !bInTitle) return -1;
      if (!aInTitle && bInTitle) return 1;

      // subjectをlegacyより優先
      if (a.source === 'subject' && b.source === 'legacy') return -1;
      if (a.source === 'legacy' && b.source === 'subject') return 1;

      return 0;
    });

    // 重複除外（同じコアタイトルを持つエントリはsubjectを優先して1つだけ残す）
    const deduped = this.deduplicateResults(results);

    // キャッシュに保存（最大100件）
    if (this.cache.size > 100) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(normalizedQuery, deduped);

    return deduped;
  }

  /**
   * 検索結果から重複を除外
   * 同じコアタイトルを持つエントリは最初の1つだけ残す（ソート済みなのでsubjectが優先される）
   * @param {Array} results ソート済み検索結果
   * @returns {Array} 重複除外済み結果
   */
  deduplicateResults(results) {
    const seen = new Set();
    return results.filter(item => {
      // タイトルからコアキーワードを抽出（プレフィックス「ア_」「イ_」等を除去）
      const coreTitle = this.extractCoreTitle(item.title || '');
      if (seen.has(coreTitle)) {
        return false;
      }
      seen.add(coreTitle);
      return true;
    });
  }

  /**
   * タイトルからコアキーワードを抽出
   * 例: "ア_新オレンジプラン" -> "新オレンジプラン"
   * 例: "05_倫理と法規_新オレンジプラン" -> "新オレンジプラン"
   * @param {string} title 元のタイトル
   * @returns {string} コアタイトル
   */
  extractCoreTitle(title) {
    // 先頭の「ア_」「イ_」等のカタカナ+アンダースコアを除去
    let core = title.replace(/^[ア-ン]_/, '');
    // 先頭の数字+アンダースコア部分を除去（例: "05_倫理と法規_"）
    core = core.replace(/^\d+_[^_]+_/, '');
    // さらに先頭の数字+アンダースコアを除去（例: "01_"）
    core = core.replace(/^\d+_/, '');
    return core.toLowerCase();
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
