/**
 * Firestore questions コレクション CRUD モジュール
 * ココシカ - 歯科国試対策アプリ
 *
 * firebase-sync.js の後に読み込むこと（Firebase初期化済みが前提）
 */

const FirestoreQuestions = (function() {
  // インメモリキャッシュ
  let questionsCache = null;

  // kokoshiclass 用の Firebase App（問題データ専用）
  let kokoshiclassApp = null;

  const KOKOSHICLASS_CONFIG = {
    apiKey: "AIzaSyBnFXyFJycOQT9psd_Ha5rAHg-6NIGae58",
    authDomain: "kokoshiclass.firebaseapp.com",
    projectId: "kokoshiclass",
    storageBucket: "kokoshiclass.firebasestorage.app",
    messagingSenderId: "689438092025",
    appId: "1:689438092025:web:47de8f506b561a74a51028",
    measurementId: "G-RJ581Y4VCT"
  };

  /**
   * Firestoreインスタンスを取得（kokoshiclass プロジェクト）
   */
  function getDb() {
    if (typeof firebase === 'undefined') {
      throw new Error('[FirestoreQuestions] Firebase SDK未読み込み');
    }
    // kokoshiclass 用の App を遅延初期化
    if (!kokoshiclassApp) {
      kokoshiclassApp = firebase.initializeApp(KOKOSHICLASS_CONFIG, 'kokoshiclass');
      console.log('[FirestoreQuestions] kokoshiclass App 初期化完了');
    }
    return firebase.firestore(kokoshiclassApp);
  }

  /**
   * 問題一覧を取得（キャッシュ付き）
   * @param {Object} [filters] - フィルタ条件
   * @param {string} [filters.subject] - 科目フィルタ
   * @param {boolean} [filters.skipCache] - キャッシュをスキップ
   * @returns {Promise<Array>} 問題の配列
   */
  async function getQuestions(filters = {}) {
    // キャッシュがあり、skipCacheでなければ返す
    if (questionsCache && !filters.skipCache) {
      let results = questionsCache;
      if (filters.subject) {
        results = results.filter(q => q.subject === filters.subject);
      }
      return results;
    }

    try {
      const db = getDb();
      let query = db.collection('questions').where('deleted', '==', false);

      const snapshot = await query.get();
      const questions = [];
      snapshot.forEach(doc => {
        questions.push({ id: doc.id, ...doc.data() });
      });

      // キャッシュに保存
      questionsCache = questions;

      // フィルタ適用
      let results = questions;
      if (filters.subject) {
        results = results.filter(q => q.subject === filters.subject);
      }

      console.log(`[FirestoreQuestions] ${questions.length}問を取得`);
      return results;
    } catch (error) {
      console.error('[FirestoreQuestions] 取得エラー:', error);
      throw error;
    }
  }

  /**
   * 1問追加
   * @param {Object} data - 問題データ
   * @returns {Promise<string>} 追加されたドキュメントID
   */
  async function addQuestion(data) {
    try {
      const db = getDb();
      const id = data.id || `imported_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      const docData = {
        ...data,
        deleted: false,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };

      await db.collection('questions').doc(id).set(docData, { merge: true });

      // キャッシュを破棄
      questionsCache = null;

      console.log(`[FirestoreQuestions] 1問追加: ${id}`);
      return id;
    } catch (error) {
      console.error('[FirestoreQuestions] 追加エラー:', error);
      throw error;
    }
  }

  /**
   * 複数問をバッチ追加（500件ずつ）
   * @param {Array} questions - 問題データの配列
   * @returns {Promise<number>} 追加された件数
   */
  async function addQuestionsBatch(questions) {
    if (!questions || questions.length === 0) return 0;

    try {
      const db = getDb();
      const BATCH_SIZE = 500;
      let totalAdded = 0;

      for (let i = 0; i < questions.length; i += BATCH_SIZE) {
        const chunk = questions.slice(i, i + BATCH_SIZE);
        const batch = db.batch();

        for (const q of chunk) {
          const id = q.id || `imported_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          const ref = db.collection('questions').doc(id);
          const docData = {
            ...q,
            deleted: false,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          };
          batch.set(ref, docData, { merge: true });
        }

        await batch.commit();
        totalAdded += chunk.length;
        console.log(`[FirestoreQuestions] バッチ ${Math.floor(i / BATCH_SIZE) + 1}: ${chunk.length}問コミット`);
      }

      // キャッシュを破棄
      questionsCache = null;

      console.log(`[FirestoreQuestions] バッチ追加完了: 合計${totalAdded}問`);
      return totalAdded;
    } catch (error) {
      console.error('[FirestoreQuestions] バッチ追加エラー:', error);
      throw error;
    }
  }

  /**
   * ソフトデリート（deleted: true に更新）
   * @param {Array<string>} ids - 削除する問題IDの配列
   * @returns {Promise<number>} 削除された件数
   */
  async function deleteQuestionsByIds(ids) {
    if (!ids || ids.length === 0) return 0;

    try {
      const db = getDb();
      const BATCH_SIZE = 500;
      let totalDeleted = 0;

      for (let i = 0; i < ids.length; i += BATCH_SIZE) {
        const chunk = ids.slice(i, i + BATCH_SIZE);
        const batch = db.batch();

        for (const id of chunk) {
          const ref = db.collection('questions').doc(id);
          batch.update(ref, {
            deleted: true,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        }

        await batch.commit();
        totalDeleted += chunk.length;
      }

      // キャッシュを破棄
      questionsCache = null;

      console.log(`[FirestoreQuestions] ${totalDeleted}問をソフトデリート`);
      return totalDeleted;
    } catch (error) {
      console.error('[FirestoreQuestions] 削除エラー:', error);
      throw error;
    }
  }

  /**
   * キャッシュを破棄
   */
  function invalidateQuestionsCache() {
    questionsCache = null;
    console.log('[FirestoreQuestions] キャッシュ破棄');
  }

  /**
   * ページネーション付きで問題を取得
   * @param {number} pageSize - 1ページあたりの件数
   * @param {Object|null} lastDoc - 前ページ最後のドキュメント（初回はnull）
   * @returns {Promise<{questions: Array, lastDoc: Object|null, hasMore: boolean}>}
   */
  async function getQuestionsPaginated(pageSize = 100, lastDoc = null) {
    try {
      const db = getDb();
      let query = db.collection('questions')
        .where('deleted', '==', false)
        .orderBy(firebase.firestore.FieldPath.documentId())
        .limit(pageSize);

      if (lastDoc) {
        query = query.startAfter(lastDoc);
      }

      const snapshot = await query.get();
      const questions = [];
      let newLastDoc = null;
      snapshot.forEach(doc => {
        questions.push({ id: doc.id, ...doc.data() });
        newLastDoc = doc;
      });

      return {
        questions,
        lastDoc: newLastDoc,
        hasMore: questions.length === pageSize
      };
    } catch (error) {
      console.error('[FirestoreQuestions] ページネーション取得エラー:', error);
      throw error;
    }
  }

  // === 審査キュー関連 ===

  /**
   * 現在ログイン中のユーザーが管理者かどうか判定
   * kokoshiclass の config/admins ドキュメントのメールリストと照合
   * @returns {Promise<boolean>}
   */
  async function isAdmin() {
    const user = FirebaseSync.getCurrentUser();
    if (!user || !user.email) return false;

    try {
      const db = getDb();
      const doc = await db.collection('config').doc('admins').get();
      if (!doc.exists) return false;
      const emails = doc.data().emails || [];
      return emails.includes(user.email);
    } catch (error) {
      console.error('[FirestoreQuestions] 管理者チェックエラー:', error);
      return false;
    }
  }

  /**
   * 審査キューを取得
   * @param {string|null} statusFilter - "pending", "approved", "rejected" またはnull（全件）
   * @returns {Promise<Array>} バッチの配列
   */
  async function getReviewQueue(statusFilter) {
    try {
      const db = getDb();
      let query = db.collection('reviewQueue').orderBy('submittedAt', 'desc');

      if (statusFilter) {
        query = db.collection('reviewQueue')
          .where('status', '==', statusFilter)
          .orderBy('submittedAt', 'desc');
      }

      const snapshot = await query.get();
      const batches = [];
      snapshot.forEach(doc => {
        batches.push({ id: doc.id, ...doc.data() });
      });

      console.log(`[FirestoreQuestions] 審査キュー取得: ${batches.length}件`);
      return batches;
    } catch (error) {
      console.error('[FirestoreQuestions] 審査キュー取得エラー:', error);
      throw error;
    }
  }

  /**
   * 新規バッチを審査キューに投稿
   * @param {string} title - バッチタイトル
   * @param {Array} questions - 問題データの配列
   * @returns {Promise<string>} 作成されたドキュメントID
   */
  async function submitToReviewQueue(title, questions) {
    const user = FirebaseSync.getCurrentUser();
    if (!user) throw new Error('ログインが必要です');

    try {
      const db = getDb();
      const docRef = await db.collection('reviewQueue').add({
        title: title,
        submittedBy: user.email,
        submittedAt: firebase.firestore.FieldValue.serverTimestamp(),
        status: 'pending',
        reviewedBy: null,
        reviewedAt: null,
        questions: questions,
        questionCount: questions.length
      });

      console.log(`[FirestoreQuestions] 審査キューに投稿: ${docRef.id}`);
      return docRef.id;
    } catch (error) {
      console.error('[FirestoreQuestions] 審査キュー投稿エラー:', error);
      throw error;
    }
  }

  /**
   * バッチを承認（ステータス更新 + 問題をquestionsコレクションにコピー）
   * @param {string} batchId - バッチドキュメントID
   * @returns {Promise<number>} 追加された問題数
   */
  async function approveBatch(batchId) {
    const user = FirebaseSync.getCurrentUser();
    if (!user) throw new Error('ログインが必要です');

    try {
      const db = getDb();
      const batchRef = db.collection('reviewQueue').doc(batchId);
      const batchDoc = await batchRef.get();

      if (!batchDoc.exists) throw new Error('バッチが見つかりません');

      const batchData = batchDoc.data();
      if (batchData.status !== 'pending') throw new Error('このバッチは既に処理済みです');

      // 問題をquestionsコレクションにコピー
      const addedCount = await addQuestionsBatch(batchData.questions);

      // ステータスを更新
      await batchRef.update({
        status: 'approved',
        reviewedBy: user.email,
        reviewedAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      console.log(`[FirestoreQuestions] バッチ承認完了: ${batchId} (${addedCount}問追加)`);
      return addedCount;
    } catch (error) {
      console.error('[FirestoreQuestions] バッチ承認エラー:', error);
      throw error;
    }
  }

  /**
   * バッチを却下
   * @param {string} batchId - バッチドキュメントID
   */
  async function rejectBatch(batchId) {
    const user = FirebaseSync.getCurrentUser();
    if (!user) throw new Error('ログインが必要です');

    try {
      const db = getDb();
      const batchRef = db.collection('reviewQueue').doc(batchId);
      const batchDoc = await batchRef.get();

      if (!batchDoc.exists) throw new Error('バッチが見つかりません');

      const batchData = batchDoc.data();
      if (batchData.status !== 'pending') throw new Error('このバッチは既に処理済みです');

      await batchRef.update({
        status: 'rejected',
        reviewedBy: user.email,
        reviewedAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      console.log(`[FirestoreQuestions] バッチ却下: ${batchId}`);
    } catch (error) {
      console.error('[FirestoreQuestions] バッチ却下エラー:', error);
      throw error;
    }
  }

  // 公開API
  return {
    getQuestions,
    getQuestionsPaginated,
    addQuestion,
    addQuestionsBatch,
    deleteQuestionsByIds,
    invalidateQuestionsCache,
    isAdmin,
    getReviewQueue,
    submitToReviewQueue,
    approveBatch,
    rejectBatch
  };
})();
