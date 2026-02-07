/**
 * 問題セット管理モジュール（管理者用）
 * ココシカ - 歯科国試対策アプリ
 *
 * Firestore questions コレクションから問題プールを読み込む
 * firestore.js の後に読み込むこと
 */

const AdminSets = (function() {
  let questionPool = [];

  /**
   * 問題プールを読み込み
   * @returns {Promise<Array>} 問題の配列
   */
  async function loadQuestionPool() {
    try {
      questionPool = await FirestoreQuestions.getQuestions();
      console.log(`[AdminSets] 問題プール: ${questionPool.length}問`);
      return questionPool;
    } catch (error) {
      console.error('[AdminSets] 問題プール読み込みエラー:', error);
      throw error;
    }
  }

  /**
   * 現在の問題プールを取得
   */
  function getPool() {
    return questionPool;
  }

  return {
    loadQuestionPool,
    getPool
  };
})();
