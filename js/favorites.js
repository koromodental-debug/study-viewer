/**
 * お気に入りノート機能 - FavoritesManager
 * カード単位でお気に入り登録し、タイムライン形式で表示
 */

const FavoritesManager = (function() {
  // ストレージキー
  const STORAGE_KEY = 'studyViewer_favorites';
  const STORAGE_VERSION = 1;

  // 内部状態
  let favorites = [];
  let listeners = [];

  /**
   * 初期化 - localStorageから読み込み
   */
  function init() {
    load();
    console.log('[Favorites] 初期化完了:', favorites.length, '件');
  }

  /**
   * localStorageから読み込み
   */
  function load() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        if (data.version === STORAGE_VERSION) {
          favorites = data.items || [];
        } else {
          // バージョン違いの場合はマイグレーション（今は単純にリセット）
          favorites = [];
        }
      }
    } catch (e) {
      console.error('[Favorites] 読み込みエラー:', e);
      favorites = [];
    }
  }

  /**
   * localStorageに保存
   */
  function save() {
    try {
      const data = {
        version: STORAGE_VERSION,
        items: favorites
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.error('[Favorites] 保存エラー:', e);
    }
  }

  /**
   * カードIDを生成
   * @param {string} type - 'html' | 'qa' | 'kakomon'
   * @param {string} topicId - トピックID
   * @param {string|number} cardIndex - カードのインデックスまたはコード
   * @returns {string} カードID
   */
  function generateId(type, topicId, cardIndex) {
    return `${type}:${topicId}:${cardIndex}`;
  }

  /**
   * カードIDをパース
   * @param {string} id - カードID
   * @returns {object} { type, topicId, cardIndex }
   */
  function parseId(id) {
    const parts = id.split(':');
    return {
      type: parts[0],
      topicId: parts[1],
      cardIndex: parts.slice(2).join(':') // cardIndexに:が含まれる可能性
    };
  }

  /**
   * お気に入りに追加
   * @param {string} type - 'html' | 'qa' | 'kakomon'
   * @param {string} topicId - トピックID
   * @param {string|number} cardIndex - カードのインデックスまたはコード
   * @param {object} content - カードの内容（スナップショット）
   * @returns {boolean} 成功したかどうか
   */
  function add(type, topicId, cardIndex, content) {
    const id = generateId(type, topicId, cardIndex);

    // 既に存在する場合は追加しない
    if (favorites.some(item => item.id === id)) {
      console.log('[Favorites] 既に登録済み:', id);
      return false;
    }

    const item = {
      id: id,
      type: type,
      topicId: topicId,
      cardIndex: cardIndex,
      addedAt: Date.now(),
      content: content
    };

    favorites.unshift(item); // 先頭に追加（新しい順）
    save();
    notifyListeners('add', item);
    console.log('[Favorites] 追加:', id);
    return true;
  }

  /**
   * お気に入りから削除
   * @param {string} id - カードID
   * @returns {boolean} 成功したかどうか
   */
  function remove(id) {
    const index = favorites.findIndex(item => item.id === id);
    if (index === -1) {
      return false;
    }

    const removed = favorites.splice(index, 1)[0];
    save();
    notifyListeners('remove', removed);
    console.log('[Favorites] 削除:', id);
    return true;
  }

  /**
   * お気に入りかどうかを確認
   * @param {string} id - カードID
   * @returns {boolean}
   */
  function isFavorite(id) {
    return favorites.some(item => item.id === id);
  }

  /**
   * お気に入りかどうかを確認（パラメータ版）
   * @param {string} type - 'html' | 'qa' | 'kakomon'
   * @param {string} topicId - トピックID
   * @param {string|number} cardIndex - カードのインデックスまたはコード
   * @returns {boolean}
   */
  function isFavoriteByParams(type, topicId, cardIndex) {
    const id = generateId(type, topicId, cardIndex);
    return isFavorite(id);
  }

  /**
   * お気に入りをトグル
   * @param {string} type - 'html' | 'qa' | 'kakomon'
   * @param {string} topicId - トピックID
   * @param {string|number} cardIndex - カードのインデックスまたはコード
   * @param {object} content - カードの内容（追加時のみ使用）
   * @returns {boolean} トグル後の状態（true=お気に入り）
   */
  function toggle(type, topicId, cardIndex, content) {
    const id = generateId(type, topicId, cardIndex);

    if (isFavorite(id)) {
      remove(id);
      return false;
    } else {
      add(type, topicId, cardIndex, content);
      return true;
    }
  }

  /**
   * 全てのお気に入りを取得
   * @returns {array} お気に入りリスト
   */
  function getAll() {
    return [...favorites];
  }

  /**
   * お気に入りの件数を取得
   * @returns {number}
   */
  function count() {
    return favorites.length;
  }

  /**
   * タイプ別にお気に入りを取得
   * @param {string} type - 'html' | 'qa' | 'kakomon'
   * @returns {array}
   */
  function getByType(type) {
    return favorites.filter(item => item.type === type);
  }

  /**
   * トピック別にお気に入りを取得
   * @param {string} topicId - トピックID
   * @returns {array}
   */
  function getByTopic(topicId) {
    return favorites.filter(item => item.topicId === topicId);
  }

  /**
   * 全てクリア
   */
  function clear() {
    favorites = [];
    save();
    notifyListeners('clear', null);
    console.log('[Favorites] 全削除');
  }

  /**
   * 変更リスナーを追加
   * @param {function} callback - コールバック関数 (action, item) => {}
   */
  function addListener(callback) {
    listeners.push(callback);
  }

  /**
   * 変更リスナーを削除
   * @param {function} callback
   */
  function removeListener(callback) {
    listeners = listeners.filter(l => l !== callback);
  }

  /**
   * リスナーに通知
   * @param {string} action - 'add' | 'remove' | 'clear'
   * @param {object} item - 対象アイテム
   */
  function notifyListeners(action, item) {
    listeners.forEach(callback => {
      try {
        callback(action, item);
      } catch (e) {
        console.error('[Favorites] リスナーエラー:', e);
      }
    });
  }

  // 公開API
  return {
    init,
    generateId,
    parseId,
    add,
    remove,
    toggle,
    isFavorite,
    isFavoriteByParams,
    getAll,
    count,
    getByType,
    getByTopic,
    clear,
    addListener,
    removeListener
  };
})();
