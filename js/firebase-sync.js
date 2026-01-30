/**
 * Firebase認証・データ同期モジュール
 * ココシカ - 歯科国試対策アプリ
 */

const FirebaseSync = (function() {
  // Firebase設定
  const firebaseConfig = {
    apiKey: "AIzaSyBm_B8YC7OtjFWf867KdQ1ndJSAozWWvlI",
    authDomain: "kokoshika-f24eb.firebaseapp.com",
    projectId: "kokoshika-f24eb",
    storageBucket: "kokoshika-f24eb.firebasestorage.app",
    messagingSenderId: "210684714683",
    appId: "1:210684714683:web:ab3ac5bd409d313427139e",
    measurementId: "G-ZKMBSCJPTD"
  };

  // 状態
  let app = null;
  let auth = null;
  let db = null;
  let currentUser = null;
  let isInitialized = false;
  let authStateListeners = [];

  // 同期対象のlocalStorageキー
  const SYNC_KEYS = [
    'studyViewer_flashcardProgress',
    'studyViewer_flashcardSessions',
    'studyViewer_favorites',
    'studyViewer_searchHistory',
    'studyViewer_importedDecks',
    'studyViewer_deckCustomizations',
    'studyViewer_dailyStats'
  ];

  // 設定キー（デバイスごとに保持、同期しない）
  const LOCAL_ONLY_KEYS = [
    'studyViewer_theme',
    'studyViewer_lastTab',
    'reading-font-size',
    'reading-line-height',
    'reading-density'
  ];

  /**
   * Firebase初期化
   */
  async function init() {
    if (isInitialized) return;

    try {
      // Firebase SDKの読み込みを待つ
      await waitForFirebaseSDK();

      // Firebase初期化
      app = firebase.initializeApp(firebaseConfig);
      auth = firebase.auth();
      db = firebase.firestore();

      // 認証状態の監視
      auth.onAuthStateChanged(handleAuthStateChange);

      // 自動同期をセットアップ
      setupAutoSync();

      isInitialized = true;
      console.log('[FirebaseSync] 初期化完了');
    } catch (error) {
      console.error('[FirebaseSync] 初期化エラー:', error);
    }
  }

  /**
   * Firebase SDKの読み込みを待つ
   */
  function waitForFirebaseSDK() {
    return new Promise((resolve, reject) => {
      if (typeof firebase !== 'undefined' && firebase.app) {
        resolve();
        return;
      }

      let attempts = 0;
      const maxAttempts = 50;
      const interval = setInterval(() => {
        attempts++;
        if (typeof firebase !== 'undefined' && firebase.app) {
          clearInterval(interval);
          resolve();
        } else if (attempts >= maxAttempts) {
          clearInterval(interval);
          reject(new Error('Firebase SDK の読み込みタイムアウト'));
        }
      }, 100);
    });
  }

  /**
   * 認証状態変更ハンドラ
   */
  async function handleAuthStateChange(user) {
    currentUser = user;

    if (user) {
      console.log('[FirebaseSync] ログイン:', user.email);
      // リスナーに先に通知（UIを即座に更新）
      authStateListeners.forEach(listener => listener(user));
      // 同期はバックグラウンドで実行（エラーでもブロックしない）
      pullFromCloud().catch(err => {
        console.warn('[FirebaseSync] バックグラウンド同期エラー（無視）:', err.message);
      });
    } else {
      console.log('[FirebaseSync] ログアウト状態');
      // リスナーに通知
      authStateListeners.forEach(listener => listener(user));
    }
  }

  /**
   * Googleでログイン
   */
  async function signInWithGoogle(forceAccountSelect = false) {
    if (!auth) {
      console.error('[FirebaseSync] 未初期化');
      return null;
    }

    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      // アカウント選択を強制する場合
      if (forceAccountSelect) {
        provider.setCustomParameters({ prompt: 'select_account' });
      }
      const result = await auth.signInWithPopup(provider);
      return result.user;
    } catch (error) {
      console.error('[FirebaseSync] ログインエラー:', error);

      // ポップアップブロック時はリダイレクト方式にフォールバック
      if (error.code === 'auth/popup-blocked') {
        const provider = new firebase.auth.GoogleAuthProvider();
        if (forceAccountSelect) {
          provider.setCustomParameters({ prompt: 'select_account' });
        }
        await auth.signInWithRedirect(provider);
      }

      throw error;
    }
  }

  /**
   * ログアウト
   */
  async function signOut() {
    if (!auth) return;

    try {
      await auth.signOut();
      console.log('[FirebaseSync] ログアウト完了');
    } catch (error) {
      console.error('[FirebaseSync] ログアウトエラー:', error);
      throw error;
    }
  }

  /**
   * クラウドにデータをプッシュ
   */
  async function pushToCloud() {
    if (!currentUser || !db) {
      console.log('[FirebaseSync] 未ログインのためスキップ');
      return;
    }

    try {
      const userDocRef = db.collection('users').doc(currentUser.uid);

      // 同期対象のデータを収集
      const syncData = {
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };

      SYNC_KEYS.forEach(key => {
        const value = localStorage.getItem(key);
        if (value) {
          syncData[key] = value;
        }
      });

      // Firestoreに保存（10秒タイムアウト）
      await withTimeout(userDocRef.set(syncData, { merge: true }), 10000, 'Firestore書き込みタイムアウト');
      console.log('[FirebaseSync] クラウドにプッシュ完了');
    } catch (error) {
      console.error('[FirebaseSync] プッシュエラー:', error);
      // オフラインエラーは警告として扱う（投げない）
      if (error.message?.includes('offline') || error.message?.includes('タイムアウト')) {
        console.warn('[FirebaseSync] オフラインまたはタイムアウト - 後で再試行');
        return;
      }
      throw error;
    }
  }

  /**
   * タイムアウト付きPromise
   */
  function withTimeout(promise, ms, errorMsg = 'タイムアウト') {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(errorMsg)), ms))
    ]);
  }

  /**
   * クラウドからデータをプル
   */
  async function pullFromCloud() {
    if (!currentUser || !db) {
      console.log('[FirebaseSync] 未ログインのためスキップ');
      return;
    }

    try {
      const userDocRef = db.collection('users').doc(currentUser.uid);
      // 10秒でタイムアウト
      const doc = await withTimeout(userDocRef.get(), 10000, 'Firestore接続タイムアウト');

      if (doc.exists) {
        const cloudData = doc.data();
        console.log('[FirebaseSync] クラウドデータ取得:', Object.keys(cloudData));

        // ローカルとクラウドのデータをマージ
        await mergeData(cloudData);
      } else {
        // クラウドにデータがない場合、ローカルデータをプッシュ
        console.log('[FirebaseSync] クラウドにデータなし、ローカルをプッシュ');
        await pushToCloud();
      }
    } catch (error) {
      console.error('[FirebaseSync] プルエラー:', error);
      // オフラインエラーは警告として扱う（投げない）
      if (error.message?.includes('offline') || error.message?.includes('タイムアウト')) {
        console.warn('[FirebaseSync] オフラインまたはタイムアウト - ローカルデータを使用');
        return;
      }
      throw error;
    }
  }

  /**
   * ローカルとクラウドのデータをマージ
   */
  async function mergeData(cloudData) {
    let needsPush = false;

    for (const key of SYNC_KEYS) {
      const localValue = localStorage.getItem(key);
      const cloudValue = cloudData[key];

      if (cloudValue && !localValue) {
        // クラウドにだけある → ローカルに保存
        localStorage.setItem(key, cloudValue);
        console.log(`[FirebaseSync] ${key}: クラウド → ローカル`);
      } else if (localValue && !cloudValue) {
        // ローカルにだけある → プッシュが必要
        needsPush = true;
        console.log(`[FirebaseSync] ${key}: ローカル → クラウド（後でプッシュ）`);
      } else if (localValue && cloudValue) {
        // 両方にある → マージ処理
        const merged = mergeByKey(key, localValue, cloudValue);
        if (merged !== localValue) {
          localStorage.setItem(key, merged);
          needsPush = true;
          console.log(`[FirebaseSync] ${key}: マージ完了`);
        }
      }
    }

    if (needsPush) {
      await pushToCloud();
      // プッシュ後、最新データを再取得してローカルを更新
      const userDocRef = db.collection('users').doc(currentUser.uid);
      const latestDoc = await userDocRef.get();
      if (latestDoc.exists) {
        const latestData = latestDoc.data();
        for (const key of SYNC_KEYS) {
          if (latestData[key]) {
            localStorage.setItem(key, latestData[key]);
          }
        }
        console.log('[FirebaseSync] プッシュ後に最新データを反映');
      }
    }

    // UIを更新するためにイベントを発火
    window.dispatchEvent(new CustomEvent('firebaseSyncComplete'));
  }

  /**
   * キーごとのマージ処理
   */
  function mergeByKey(key, localValue, cloudValue) {
    try {
      const localData = JSON.parse(localValue);
      const cloudData = JSON.parse(cloudValue);

      if (key === 'studyViewer_flashcardProgress') {
        return JSON.stringify(mergeFlashcardProgress(localData, cloudData));
      } else if (key === 'studyViewer_flashcardSessions') {
        return JSON.stringify(mergeFlashcardSessions(localData, cloudData));
      } else if (key === 'studyViewer_favorites') {
        return JSON.stringify(mergeFavorites(localData, cloudData));
      } else if (key === 'studyViewer_importedDecks') {
        return JSON.stringify(mergeImportedDecks(localData, cloudData));
      } else if (key === 'studyViewer_deckCustomizations') {
        return JSON.stringify(mergeDeckCustomizations(localData, cloudData));
      } else if (key === 'studyViewer_dailyStats') {
        return JSON.stringify(mergeDailyStats(localData, cloudData));
      }
    } catch (e) {
      console.error('[FirebaseSync] マージエラー:', e);
    }

    // パースできない場合はクラウドを優先
    return cloudValue;
  }

  /**
   * 日別統計のマージ
   * データ形式: { version: 1, days: { "2026-01-30": { cardsReviewed, memorized, again, studyTimeMs, sessions } }, streak: { current, longest, lastStudyDate } }
   */
  function mergeDailyStats(local, cloud) {
    const merged = {
      version: Math.max(local.version || 1, cloud.version || 1),
      days: {},
      streak: {
        current: 0,
        longest: 0,
        lastStudyDate: null
      }
    };

    const localDays = local.days || {};
    const cloudDays = cloud.days || {};

    // 全ての日付を収集
    const allDates = new Set([...Object.keys(localDays), ...Object.keys(cloudDays)]);

    for (const date of allDates) {
      const localDay = localDays[date];
      const cloudDay = cloudDays[date];

      if (localDay && !cloudDay) {
        merged.days[date] = localDay;
      } else if (!localDay && cloudDay) {
        merged.days[date] = cloudDay;
      } else if (localDay && cloudDay) {
        // 両方にある場合は各値の大きい方を採用（学習量は累積するため）
        merged.days[date] = {
          cardsReviewed: Math.max(localDay.cardsReviewed || 0, cloudDay.cardsReviewed || 0),
          memorized: Math.max(localDay.memorized || 0, cloudDay.memorized || 0),
          again: Math.max(localDay.again || 0, cloudDay.again || 0),
          studyTimeMs: Math.max(localDay.studyTimeMs || 0, cloudDay.studyTimeMs || 0),
          sessions: Math.max(localDay.sessions || 0, cloudDay.sessions || 0)
        };
      }
    }

    // ストリークは再計算（日別データから正確に算出）
    merged.streak = recalculateStreak(merged.days);

    console.log(`[FirebaseSync] 日別統計マージ: ローカル${Object.keys(localDays).length}日, クラウド${Object.keys(cloudDays).length}日 → マージ後${Object.keys(merged.days).length}日`);
    return merged;
  }

  /**
   * 日別データからストリークを再計算
   */
  function recalculateStreak(days) {
    const sortedDates = Object.keys(days).sort().reverse(); // 新しい順
    if (sortedDates.length === 0) {
      return { current: 0, longest: 0, lastStudyDate: null };
    }

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

    // 今日か昨日に学習していなければストリークは0
    const lastStudyDate = sortedDates[0];
    if (lastStudyDate !== todayStr && lastStudyDate !== yesterdayStr) {
      return { current: 0, longest: calculateLongestStreak(days), lastStudyDate };
    }

    // 連続日数をカウント
    let current = 0;
    let checkDate = new Date(lastStudyDate);

    while (true) {
      const dateStr = `${checkDate.getFullYear()}-${String(checkDate.getMonth() + 1).padStart(2, '0')}-${String(checkDate.getDate()).padStart(2, '0')}`;
      if (days[dateStr] && days[dateStr].cardsReviewed > 0) {
        current++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else {
        break;
      }
    }

    const longest = Math.max(current, calculateLongestStreak(days));

    return { current, longest, lastStudyDate };
  }

  /**
   * 最長ストリークを計算
   */
  function calculateLongestStreak(days) {
    const sortedDates = Object.keys(days).sort();
    if (sortedDates.length === 0) return 0;

    let longest = 0;
    let currentStreak = 0;
    let prevDate = null;

    for (const dateStr of sortedDates) {
      if (days[dateStr].cardsReviewed === 0) continue;

      const date = new Date(dateStr);
      if (prevDate) {
        const diffDays = (date - prevDate) / (1000 * 60 * 60 * 24);
        if (diffDays === 1) {
          currentStreak++;
        } else {
          currentStreak = 1;
        }
      } else {
        currentStreak = 1;
      }

      longest = Math.max(longest, currentStreak);
      prevDate = date;
    }

    return longest;
  }

  /**
   * フラッシュカード進捗のマージ
   * データ形式: { version: 1, cards: { "topicId:index": { status, lastReview } } }
   */
  function mergeFlashcardProgress(local, cloud) {
    const merged = {
      version: Math.max(local.version || 1, cloud.version || 1),
      cards: {}
    };

    const localCards = local.cards || {};
    const cloudCards = cloud.cards || {};

    // 全てのキーを収集
    const allKeys = new Set([...Object.keys(localCards), ...Object.keys(cloudCards)]);

    for (const key of allKeys) {
      const localCard = localCards[key];
      const cloudCard = cloudCards[key];

      if (localCard && !cloudCard) {
        // ローカルにのみ存在
        merged.cards[key] = localCard;
      } else if (!localCard && cloudCard) {
        // クラウドにのみ存在
        merged.cards[key] = cloudCard;
      } else if (localCard && cloudCard) {
        // 両方に存在 → より新しい方（lastReview が大きい方）を採用
        const localTime = localCard.lastReview || 0;
        const cloudTime = cloudCard.lastReview || 0;
        merged.cards[key] = localTime >= cloudTime ? localCard : cloudCard;
      }
    }

    console.log(`[FirebaseSync] 進捗マージ: ローカル${Object.keys(localCards).length}件, クラウド${Object.keys(cloudCards).length}件 → マージ後${Object.keys(merged.cards).length}件`);
    return merged;
  }

  /**
   * お気に入りのマージ
   */
  function mergeFavorites(local, cloud) {
    const merged = { ...cloud };

    // お気に入りアイテムを統合（重複排除）
    if (local.items && cloud.items) {
      const itemMap = new Map();

      // クラウドのアイテムを先に追加
      cloud.items.forEach(item => {
        itemMap.set(item.id || item.topicId, item);
      });

      // ローカルのアイテムを追加（なければ）
      local.items.forEach(item => {
        const key = item.id || item.topicId;
        if (!itemMap.has(key)) {
          itemMap.set(key, item);
        }
      });

      merged.items = Array.from(itemMap.values());
    } else if (local.items) {
      merged.items = local.items;
    }

    merged.version = Math.max(local.version || 1, cloud.version || 1);
    return merged;
  }

  /**
   * フラッシュカードセッションのマージ
   */
  function mergeFlashcardSessions(local, cloud) {
    const merged = { ...cloud };

    // ローカルのセッションを追加・更新（新しい方を優先）
    for (const topicId in local) {
      const localSession = local[topicId];
      const cloudSession = merged[topicId];

      if (!cloudSession) {
        // クラウドにない → ローカルを採用
        merged[topicId] = localSession;
      } else {
        // 両方にある → タイムスタンプが新しい方を採用
        const localTime = localSession.timestamp || 0;
        const cloudTime = cloudSession.timestamp || 0;
        if (localTime > cloudTime) {
          merged[topicId] = localSession;
        }
      }
    }

    return merged;
  }

  /**
   * インポート済みデッキのマージ
   * データ形式: [{ id, title, category, cardCount, jsonData, importedAt, isLocal }]
   */
  function mergeImportedDecks(local, cloud) {
    // 両方が配列であることを確認
    const localDecks = Array.isArray(local) ? local : [];
    const cloudDecks = Array.isArray(cloud) ? cloud : [];

    // IDでマップを作成
    const deckMap = new Map();

    // クラウドのデッキを先に追加
    for (const deck of cloudDecks) {
      if (deck.id) {
        deckMap.set(deck.id, deck);
      }
    }

    // ローカルのデッキをマージ（より新しい方を優先）
    for (const deck of localDecks) {
      if (!deck.id) continue;

      const existing = deckMap.get(deck.id);
      if (!existing) {
        // クラウドにない → ローカルを追加
        deckMap.set(deck.id, deck);
      } else {
        // 両方にある → より新しい方を採用
        const localTime = deck.importedAt || 0;
        const cloudTime = existing.importedAt || 0;
        if (localTime > cloudTime) {
          deckMap.set(deck.id, deck);
        }
      }
    }

    const merged = Array.from(deckMap.values());
    console.log(`[FirebaseSync] デッキマージ: ローカル${localDecks.length}件, クラウド${cloudDecks.length}件 → マージ後${merged.length}件`);
    return merged;
  }

  /**
   * デッキカスタマイズのマージ
   * データ形式: { "topicId": { "edited": { "index": { "q": "...", "a": "..." } }, "deleted": [index...] } }
   */
  function mergeDeckCustomizations(local, cloud) {
    const localData = local || {};
    const cloudData = cloud || {};

    // 全てのトピックIDを収集
    const allTopicIds = new Set([...Object.keys(localData), ...Object.keys(cloudData)]);
    const merged = {};

    for (const topicId of allTopicIds) {
      const localCustom = localData[topicId];
      const cloudCustom = cloudData[topicId];

      if (localCustom && !cloudCustom) {
        // ローカルにのみ存在
        merged[topicId] = localCustom;
      } else if (!localCustom && cloudCustom) {
        // クラウドにのみ存在
        merged[topicId] = cloudCustom;
      } else if (localCustom && cloudCustom) {
        // 両方に存在 → 各要素をマージ
        const mergedEdited = { ...cloudCustom.edited };
        for (const idx in localCustom.edited || {}) {
          if (!mergedEdited[idx]) {
            mergedEdited[idx] = localCustom.edited[idx];
          }
        }

        const mergedDeleted = [...new Set([
          ...(cloudCustom.deleted || []),
          ...(localCustom.deleted || [])
        ])].sort((a, b) => a - b);

        merged[topicId] = {
          edited: mergedEdited,
          deleted: mergedDeleted
        };
      }
    }

    console.log(`[FirebaseSync] カスタマイズマージ: ローカル${Object.keys(localData).length}件, クラウド${Object.keys(cloudData).length}件 → マージ後${Object.keys(merged).length}件`);
    return merged;
  }

  /**
   * 認証状態リスナーを追加
   */
  function onAuthStateChanged(listener) {
    authStateListeners.push(listener);

    // 既にログイン済みなら即座に通知
    if (currentUser) {
      listener(currentUser);
    }

    // リスナー解除関数を返す
    return () => {
      authStateListeners = authStateListeners.filter(l => l !== listener);
    };
  }

  /**
   * 現在のユーザーを取得
   */
  function getCurrentUser() {
    return currentUser;
  }

  /**
   * ログイン済みかどうか
   */
  function isLoggedIn() {
    return currentUser !== null;
  }

  /**
   * 手動で同期を実行
   */
  async function sync() {
    if (!isLoggedIn()) {
      console.log('[FirebaseSync] 未ログインのため同期スキップ');
      return;
    }

    await pushToCloud();
    console.log('[FirebaseSync] 手動同期完了');
  }

  /**
   * 自動同期のセットアップ
   */
  function setupAutoSync() {
    // ページを離れる時に同期
    window.addEventListener('beforeunload', () => {
      if (isLoggedIn()) {
        // sendBeaconで非同期保存（ページ離脱時でも確実に送信）
        const data = {};
        SYNC_KEYS.forEach(key => {
          const value = localStorage.getItem(key);
          if (value) data[key] = value;
        });

        if (Object.keys(data).length > 0 && currentUser) {
          // Firestoreへの直接送信はbeforeunloadでは難しいので、
          // localStorageに最終更新時刻を記録して次回起動時に同期
          localStorage.setItem('firebaseSync_pendingSync', 'true');
        }
      }
    });

    // ページ表示時に保留中の同期があれば実行
    window.addEventListener('pageshow', async () => {
      if (localStorage.getItem('firebaseSync_pendingSync') === 'true' && isLoggedIn()) {
        localStorage.removeItem('firebaseSync_pendingSync');
        await pushToCloud();
      }
    });

    // 定期同期（5分ごと）- 双方向同期
    setInterval(async () => {
      if (isLoggedIn()) {
        await pullFromCloud();  // まずプルして最新を取得
        await pushToCloud();    // その後プッシュ
        console.log('[FirebaseSync] 定期同期完了（双方向）');
      }
    }, 5 * 60 * 1000);

    // visibilitychange時に同期（タブがバックグラウンドから復帰時）
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible' && isLoggedIn()) {
        await pullFromCloud();
      }
    });
  }

  // === デッキインポート機能 ===

  /**
   * アクセスコードでデッキをインポート
   * @param {string} code - アクセスコード
   * @returns {Promise<{success: boolean, deck?: object, error?: string}>}
   */
  async function importDeckWithCode(code) {
    if (!isLoggedIn()) {
      return { success: false, error: 'ログインが必要です' };
    }

    if (!db) {
      return { success: false, error: 'データベース未接続' };
    }

    const normalizedCode = code.trim().toUpperCase();

    try {
      // 1. アクセスコードを検索
      const codesRef = db.collection('accessCodes');
      const snapshot = await codesRef.where('code', '==', normalizedCode).get();

      if (snapshot.empty) {
        return { success: false, error: '無効なアクセスコードです' };
      }

      const codeDoc = snapshot.docs[0];
      const codeData = codeDoc.data();

      // 2. 使用済みチェック
      if (codeData.usedBy) {
        if (codeData.usedBy === currentUser.uid) {
          return { success: false, error: 'このコードは既に使用済みです' };
        } else {
          return { success: false, error: 'このコードは既に他のユーザーに使用されています' };
        }
      }

      // 3. デッキデータを取得
      const deckRef = db.collection('decks').doc(codeData.deckId);
      const deckDoc = await deckRef.get();

      if (!deckDoc.exists) {
        return { success: false, error: 'デッキが見つかりません' };
      }

      const deckData = { id: deckDoc.id, ...deckDoc.data() };

      // 4. コードを使用済みに更新
      await codeDoc.ref.update({
        usedBy: currentUser.uid,
        usedAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      // 5. ユーザーの購入済みデッキリストに追加
      const userRef = db.collection('users').doc(currentUser.uid);
      await userRef.set({
        purchasedDecks: firebase.firestore.FieldValue.arrayUnion(codeData.deckId)
      }, { merge: true });

      // 6. ローカルにキャッシュ
      saveImportedDeckToLocal(deckData);

      console.log('[FirebaseSync] デッキインポート成功:', deckData.title);
      return { success: true, deck: deckData };

    } catch (error) {
      console.error('[FirebaseSync] デッキインポートエラー:', error);
      return { success: false, error: 'インポート中にエラーが発生しました' };
    }
  }

  /**
   * インポート済みデッキをローカルに保存
   */
  function saveImportedDeckToLocal(deck) {
    const IMPORTED_DECKS_KEY = 'studyViewer_importedDecks';
    let importedDecks = [];

    try {
      const stored = localStorage.getItem(IMPORTED_DECKS_KEY);
      if (stored) {
        importedDecks = JSON.parse(stored);
      }
    } catch (e) {
      console.error('ローカルデッキ読み込みエラー:', e);
    }

    // 既存のデッキを更新または追加
    const existingIndex = importedDecks.findIndex(d => d.id === deck.id);
    if (existingIndex >= 0) {
      importedDecks[existingIndex] = deck;
    } else {
      importedDecks.push(deck);
    }

    localStorage.setItem(IMPORTED_DECKS_KEY, JSON.stringify(importedDecks));
  }

  /**
   * ローカルのインポート済みデッキを取得
   */
  function getImportedDecks() {
    const IMPORTED_DECKS_KEY = 'studyViewer_importedDecks';
    try {
      const stored = localStorage.getItem(IMPORTED_DECKS_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (e) {
      console.error('ローカルデッキ読み込みエラー:', e);
    }
    return [];
  }

  /**
   * ユーザーの購入済みデッキをクラウドから同期
   */
  async function syncPurchasedDecks() {
    if (!isLoggedIn() || !db) return [];

    try {
      const userRef = db.collection('users').doc(currentUser.uid);
      const userDoc = await userRef.get();

      if (!userDoc.exists) return [];

      const userData = userDoc.data();
      const purchasedDeckIds = userData.purchasedDecks || [];

      if (purchasedDeckIds.length === 0) return [];

      // 各デッキのデータを取得
      const decks = [];
      for (const deckId of purchasedDeckIds) {
        const deckDoc = await db.collection('decks').doc(deckId).get();
        if (deckDoc.exists) {
          decks.push({ id: deckDoc.id, ...deckDoc.data() });
        }
      }

      // ローカルにキャッシュ
      decks.forEach(deck => saveImportedDeckToLocal(deck));

      console.log('[FirebaseSync] 購入済みデッキ同期完了:', decks.length);
      return decks;

    } catch (error) {
      console.error('[FirebaseSync] 購入済みデッキ同期エラー:', error);
      return getImportedDecks(); // エラー時はローカルキャッシュを返す
    }
  }

  // === 公開統計（ランキング機能） ===

  // ランキングキャッシュ（1時間有効）
  let rankingCache = null;
  let rankingCacheTime = 0;
  const RANKING_CACHE_DURATION = 60 * 60 * 1000; // 1時間

  /**
   * 公開統計を更新
   */
  async function updatePublicStats(stats) {
    if (!currentUser || !db) {
      console.log('[FirebaseSync] 未ログインのためスキップ');
      return;
    }

    try {
      const publicStatsRef = db.collection('publicStats').doc(currentUser.uid);
      await publicStatsRef.set({
        ...stats,
        userId: currentUser.uid,
        lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      console.log('[FirebaseSync] 公開統計を更新しました');

      // キャッシュをクリア
      rankingCache = null;
    } catch (error) {
      console.error('[FirebaseSync] 公開統計更新エラー:', error);
      throw error;
    }
  }

  /**
   * ランキングを取得（上位20件）
   */
  async function getRanking() {
    if (!db) {
      console.log('[FirebaseSync] DB未初期化');
      return [];
    }

    // キャッシュが有効な場合はキャッシュを返す
    if (rankingCache && (Date.now() - rankingCacheTime) < RANKING_CACHE_DURATION) {
      console.log('[FirebaseSync] ランキングキャッシュを使用');
      return rankingCache;
    }

    try {
      const publicStatsRef = db.collection('publicStats');
      const snapshot = await publicStatsRef
        .where('isPublic', '==', true)
        .orderBy('weeklyCards', 'desc')
        .limit(20)
        .get();

      const ranking = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        ranking.push({
          userId: doc.id,
          displayName: data.displayName || '匿名',
          weeklyCards: data.weeklyCards || 0,
          currentStreak: data.currentStreak || 0
        });
      });

      // キャッシュを更新
      rankingCache = ranking;
      rankingCacheTime = Date.now();

      console.log('[FirebaseSync] ランキング取得完了:', ranking.length);
      return ranking;
    } catch (error) {
      console.error('[FirebaseSync] ランキング取得エラー:', error);
      return rankingCache || [];
    }
  }

  /**
   * 自分の公開統計を取得
   */
  async function getMyPublicStats() {
    if (!currentUser || !db) {
      return null;
    }

    try {
      const publicStatsRef = db.collection('publicStats').doc(currentUser.uid);
      const doc = await publicStatsRef.get();
      if (doc.exists) {
        return doc.data();
      }
      return null;
    } catch (error) {
      console.error('[FirebaseSync] 公開統計取得エラー:', error);
      return null;
    }
  }

  // 公開API
  return {
    init,
    signInWithGoogle,
    signOut,
    pushToCloud,
    pullFromCloud,
    sync,
    onAuthStateChanged,
    getCurrentUser,
    isLoggedIn,
    // デッキインポート
    importDeckWithCode,
    getImportedDecks,
    syncPurchasedDecks,
    // 公開統計（ランキング）
    updatePublicStats,
    getRanking,
    getMyPublicStats
  };
})();

// DOMContentLoadedで初期化
document.addEventListener('DOMContentLoaded', () => {
  FirebaseSync.init();
  initAccountUI();
});

/**
 * アカウントUIの初期化
 */
function initAccountUI() {
  const accountBtn = document.getElementById('account-btn');
  const accountOverlay = document.getElementById('account-overlay');
  const accountBackdrop = accountOverlay?.querySelector('.account-backdrop');
  const accountClose = document.getElementById('account-close');
  const googleSigninBtn = document.getElementById('google-signin-btn');
  const signoutBtn = document.getElementById('signout-btn');
  const manualSyncBtn = document.getElementById('manual-sync-btn');
  const accountLoggedOut = document.getElementById('account-logged-out');
  const accountLoggedIn = document.getElementById('account-logged-in');
  const accountIconLoggedOut = document.querySelector('.account-icon-logged-out');

  if (!accountOverlay) return;

  // キャッシュされた画像を即座に表示（認証完了を待たずに）
  const cachedPhotoURL = localStorage.getItem('cachedUserPhotoURL');
  if (cachedPhotoURL) {
    const headerUserPhoto = document.getElementById('header-user-photo');
    if (headerUserPhoto) {
      headerUserPhoto.src = cachedPhotoURL;
      headerUserPhoto.style.display = 'block';
    }
    if (accountIconLoggedOut) accountIconLoggedOut.style.display = 'none';
  }

  // アカウントシートを開く
  function openAccountSheet() {
    accountOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  // アカウントシートを閉じる
  function closeAccountSheet() {
    accountOverlay.classList.remove('active');
    document.body.style.overflow = '';
  }

  // UI状態を更新
  function updateUI(user) {
    const logoutSection = document.getElementById('account-logout-section');
    const headerUserPhoto = document.getElementById('header-user-photo');

    if (user) {
      // ログイン済み
      accountLoggedOut.style.display = 'none';
      accountLoggedIn.style.display = 'flex';
      if (logoutSection) logoutSection.style.display = 'block';

      // ユーザー情報を表示
      const userPhoto = document.getElementById('account-user-photo');
      const userName = document.getElementById('account-user-name');
      const userEmail = document.getElementById('account-user-email');

      if (user.photoURL) {
        // 画像URLをキャッシュに保存（次回起動時に即表示用）
        localStorage.setItem('cachedUserPhotoURL', user.photoURL);
        userPhoto.src = user.photoURL;
        userPhoto.style.display = 'block';
        // ヘッダーにもプロフィール画像を表示
        if (headerUserPhoto) {
          headerUserPhoto.src = user.photoURL;
          headerUserPhoto.style.display = 'block';
        }
        if (accountIconLoggedOut) accountIconLoggedOut.style.display = 'none';
      } else {
        userPhoto.style.display = 'none';
        // 画像がない場合はデフォルトアイコンを表示
        if (headerUserPhoto) headerUserPhoto.style.display = 'none';
        if (accountIconLoggedOut) accountIconLoggedOut.style.display = 'block';
      }
      userName.textContent = user.displayName || 'ユーザー';
      userEmail.textContent = user.email || '';
    } else {
      // 未ログイン - キャッシュもクリア
      localStorage.removeItem('cachedUserPhotoURL');
      accountLoggedOut.style.display = 'flex';
      accountLoggedIn.style.display = 'none';
      if (accountIconLoggedOut) accountIconLoggedOut.style.display = 'block';
      if (headerUserPhoto) headerUserPhoto.style.display = 'none';
      if (logoutSection) logoutSection.style.display = 'none';
    }
  }

  // イベントリスナー
  accountBtn?.addEventListener('click', openAccountSheet);
  accountBackdrop?.addEventListener('click', closeAccountSheet);
  accountClose?.addEventListener('click', closeAccountSheet);

  // Googleログイン
  googleSigninBtn?.addEventListener('click', async () => {
    try {
      googleSigninBtn.disabled = true;
      googleSigninBtn.querySelector('span').textContent = 'ログイン中...';
      await FirebaseSync.signInWithGoogle();
      closeAccountSheet();
    } catch (error) {
      console.error('ログインエラー:', error);
      alert('ログインに失敗しました。もう一度お試しください。');
    } finally {
      googleSigninBtn.disabled = false;
      googleSigninBtn.querySelector('span').textContent = 'Googleでログイン';
    }
  });

  // ログアウト（確認ダイアログ付き）
  signoutBtn?.addEventListener('click', async () => {
    if (!confirm('ログアウトしますか？\n\n学習データはこのデバイスに残りますが、他のデバイスとの同期は停止します。')) {
      return;
    }
    try {
      await FirebaseSync.signOut();
      closeAccountSheet();
    } catch (error) {
      console.error('ログアウトエラー:', error);
    }
  });

  // アカウント切り替え
  const switchAccountBtn = document.getElementById('switch-account-btn');
  switchAccountBtn?.addEventListener('click', async () => {
    try {
      switchAccountBtn.disabled = true;
      switchAccountBtn.querySelector('span').textContent = '切り替え中...';
      // アカウント選択画面を強制表示
      await FirebaseSync.signInWithGoogle(true);
      closeAccountSheet();
    } catch (error) {
      console.error('アカウント切り替えエラー:', error);
      alert('アカウントの切り替えに失敗しました。');
    } finally {
      switchAccountBtn.disabled = false;
      switchAccountBtn.querySelector('span').textContent = 'アカウントを切り替え';
    }
  });

  // === デッキインポートモーダル ===
  const importDeckBtn = document.getElementById('import-deck-btn');
  const importOverlay = document.getElementById('import-overlay');
  const importBackdrop = importOverlay?.querySelector('.import-backdrop');
  const importClose = document.getElementById('import-close');
  const importCodeInput = document.getElementById('import-code-input');
  const importSubmitBtn = document.getElementById('import-submit-btn');
  const importStatus = document.getElementById('import-status');

  function openImportModal() {
    if (importOverlay) {
      importOverlay.classList.add('active');
      document.body.style.overflow = 'hidden';
      importCodeInput?.focus();
    }
  }

  function closeImportModal() {
    if (importOverlay) {
      importOverlay.classList.remove('active');
      document.body.style.overflow = '';
      // リセット
      if (importCodeInput) importCodeInput.value = '';
      if (importStatus) {
        importStatus.className = 'import-status';
        importStatus.textContent = '';
      }
    }
  }

  function showImportStatus(message, type) {
    if (importStatus) {
      importStatus.textContent = message;
      importStatus.className = `import-status show ${type}`;
    }
  }

  // インポートボタン
  importDeckBtn?.addEventListener('click', () => {
    closeAccountSheet();
    setTimeout(openImportModal, 300);
  });

  // モーダルを閉じる
  importBackdrop?.addEventListener('click', closeImportModal);
  importClose?.addEventListener('click', closeImportModal);

  // インポート実行
  async function executeImport() {
    const code = importCodeInput?.value?.trim()?.toUpperCase();
    if (!code) {
      showImportStatus('アクセスコードを入力してください', 'error');
      return;
    }

    try {
      importSubmitBtn.disabled = true;
      importSubmitBtn.querySelector('span').textContent = 'インポート中...';
      showImportStatus('デッキを取得しています...', 'loading');

      const result = await FirebaseSync.importDeckWithCode(code);

      if (result.success) {
        showImportStatus(`「${result.deck.title}」をインポートしました！`, 'success');
        // 成功したらインポートデッキ更新イベントを発火
        window.dispatchEvent(new CustomEvent('deckImported', { detail: result.deck }));
        // 2秒後にモーダルを閉じる
        setTimeout(closeImportModal, 2000);
      } else {
        showImportStatus(result.error, 'error');
      }
    } catch (error) {
      console.error('インポートエラー:', error);
      showImportStatus('インポートに失敗しました。もう一度お試しください。', 'error');
    } finally {
      importSubmitBtn.disabled = false;
      importSubmitBtn.querySelector('span').textContent = 'インポート';
    }
  }

  importSubmitBtn?.addEventListener('click', executeImport);

  // Enterキーでもインポート
  importCodeInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      executeImport();
    }
  });

  // === プロンプトコピー ===
  const IMPORT_PROMPT = `この画像からフラッシュカード用Q&Aを作成。JSONのみ出力。

{"metadata":{"title":"タイトル","category":"カテゴリ"},"sections":[{"section":"セクション名","qa":[{"question":"質問","answer":"回答"}]}]}

ルール: 1問1答、答えは簡潔に、内容でsection分類`;

  const copyPromptBtn = document.getElementById('copy-prompt-btn');
  const copyPromptStatus = document.getElementById('copy-prompt-status');

  copyPromptBtn?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(IMPORT_PROMPT);
      if (copyPromptStatus) {
        copyPromptStatus.textContent = 'コピーしました';
        copyPromptStatus.classList.add('show');
        setTimeout(() => {
          copyPromptStatus.classList.remove('show');
        }, 2000);
      }
    } catch (e) {
      console.error('コピーエラー:', e);
    }
  });

  // === セクショントグル ===
  document.querySelectorAll('.import-section-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target;
      const targetEl = document.getElementById(targetId);
      const arrow = btn.querySelector('svg');
      if (targetEl) {
        const isOpen = targetEl.style.display !== 'none';
        targetEl.style.display = isOpen ? 'none' : 'block';
        if (arrow) {
          arrow.style.transform = isOpen ? '' : 'rotate(180deg)';
        }
      }
    });
  });

  // === JSON貼り付けインポート ===
  const importPasteInput = document.getElementById('import-paste-input');
  const importPasteBtn = document.getElementById('import-paste-btn');

  importPasteBtn?.addEventListener('click', async () => {
    const text = importPasteInput?.value?.trim();
    if (!text) {
      showImportStatus('JSONを貼り付けてください', 'error');
      return;
    }

    try {
      showImportStatus('インポート中...', 'loading');

      // JSONをパース（AIの出力ミスを自動修正）
      let cleanText = text;

      // 1. コードブロックを除去 ```json ... ```
      cleanText = cleanText.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '');

      // 2. 前後の説明文を除去してJSONのみ抽出
      const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        cleanText = jsonMatch[0];
      }

      // 3. 全角文字を半角に修正（Unicodeエスケープで確実に変換）
      cleanText = cleanText
        .replace(/\u300c/g, '"')  // 「
        .replace(/\u300d/g, '"')  // 」
        .replace(/\u201c/g, '"')  // " LEFT DOUBLE QUOTATION MARK
        .replace(/\u201d/g, '"')  // " RIGHT DOUBLE QUOTATION MARK
        .replace(/\uff02/g, '"')  // ＂ FULLWIDTH QUOTATION MARK
        .replace(/\u2033/g, '"')  // ″ DOUBLE PRIME
        .replace(/\u301d/g, '"')  // 〝
        .replace(/\u301e/g, '"')  // 〞
        .replace(/\u2018/g, "'")  // ' LEFT SINGLE QUOTATION MARK
        .replace(/\u2019/g, "'")  // ' RIGHT SINGLE QUOTATION MARK
        .replace(/\uff07/g, "'")  // ＇ FULLWIDTH APOSTROPHE
        .replace(/\uff1a/g, ':')  // ：
        .replace(/\uff3b/g, '[')  // ［
        .replace(/\uff3d/g, ']')  // ］
        .replace(/\uff5b/g, '{')  // ｛
        .replace(/\uff5d/g, '}')  // ｝
        .replace(/\uff0c/g, ','); // ，

      // 4. 末尾カンマを除去 (,] や ,} を修正)
      cleanText = cleanText.replace(/,\s*]/g, ']').replace(/,\s*}/g, '}');

      // 4.5. 文字列値内のエスケープされていないダブルクォートを「」に変換
      // パターン: の"xxx"で or の"xxx"を などを検出して変換
      // 日本語文字の後の"と、"の後の日本語文字で閉じるパターン
      cleanText = cleanText.replace(/([\u3000-\u9fff])"([^"]{1,20})"([\u3000-\u9fff])/g, '$1「$2」$3');

      // 5. コメントを除去 (// comment や /* comment */)
      cleanText = cleanText.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

      // 6. 文字列外のシングルクォートをダブルクォートに変換
      // （文字列内のシングルクォートは維持）
      cleanText = cleanText.replace(/'([^']*)'(?=\s*[:,\]\}])/g, '"$1"');

      // 7. 制御文字を除去（タブ・改行は維持）
      cleanText = cleanText.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

      // デバッグ: パース前のテキストをログ出力
      console.log('[JSON Import] クリーン後のテキスト:', cleanText.substring(0, 200));

      let jsonData;
      try {
        jsonData = JSON.parse(cleanText);
      } catch (parseError) {
        // エラー位置周辺のテキストを表示
        const match = parseError.message.match(/position (\d+)/);
        if (match) {
          const pos = parseInt(match[1]);
          const start = Math.max(0, pos - 50);
          const end = Math.min(cleanText.length, pos + 50);
          console.error('[JSON Import] エラー位置周辺:', cleanText.substring(start, end));
          console.error('[JSON Import] エラー位置の文字:', cleanText[pos], '(charCode:', cleanText.charCodeAt(pos)?.toString(16), ')');
        }
        throw parseError;
      }

      // JSONの検証
      if (!jsonData.sections || !Array.isArray(jsonData.sections)) {
        throw new Error('無効なJSON形式です。sectionsが見つかりません。');
      }

      // デッキタイトルを取得
      const title = jsonData.metadata?.title || '貼り付けデッキ';
      const category = jsonData.metadata?.category || 'インポート';

      // カード数をカウント
      let cardCount = 0;
      for (const section of jsonData.sections) {
        cardCount += (section.qa || []).length;
      }

      if (cardCount === 0) {
        throw new Error('カードが見つかりません。');
      }

      // ユニークなIDを生成
      const deckId = `paste_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // デッキデータを構築
      const deck = {
        id: deckId,
        title: title,
        category: category,
        cardCount: cardCount,
        jsonData: jsonData,
        importedAt: Date.now(),
        isLocal: true
      };

      // ローカルストレージに保存
      saveImportedDeckToLocal(deck);

      // Firebaseに同期（ログイン中の場合）
      if (FirebaseSync.isLoggedIn()) {
        FirebaseSync.sync().catch(e => console.error('同期エラー:', e));
      }

      showImportStatus(`「${title}」をインポートしました！（${cardCount}問）`, 'success');

      // イベントを発火してUIを更新
      window.dispatchEvent(new CustomEvent('deckImported', { detail: deck }));

      // テキストエリアをクリア
      if (importPasteInput) importPasteInput.value = '';

      // 2秒後にモーダルを閉じる
      setTimeout(closeImportModal, 2000);

    } catch (error) {
      console.error('JSON貼り付けインポートエラー:', error);
      if (error instanceof SyntaxError) {
        showImportStatus('JSONの形式が正しくありません。', 'error');
      } else {
        showImportStatus(error.message || 'インポートに失敗しました。', 'error');
      }
    }
  });

  // === ローカルファイルインポート ===
  const importFileBtn = document.getElementById('import-file-btn');
  const importFileInput = document.getElementById('import-file-input');

  importFileBtn?.addEventListener('click', () => {
    importFileInput?.click();
  });

  importFileInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      showImportStatus('ファイルを読み込み中...', 'loading');

      const text = await file.text();
      const jsonData = JSON.parse(text);

      // JSONの検証
      if (!jsonData.sections || !Array.isArray(jsonData.sections)) {
        throw new Error('無効なJSON形式です。sectionsが見つかりません。');
      }

      // デッキタイトルを取得（メタデータから or ファイル名から）
      const title = jsonData.metadata?.title || file.name.replace('.json', '').replace(/_QA$/, '');
      const category = jsonData.metadata?.category || 'インポート';

      // カード数をカウント
      let cardCount = 0;
      for (const section of jsonData.sections) {
        cardCount += (section.qa || []).length;
      }

      if (cardCount === 0) {
        throw new Error('カードが見つかりません。');
      }

      // ユニークなIDを生成
      const deckId = `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // デッキデータを構築
      const deck = {
        id: deckId,
        title: title,
        category: category,
        cardCount: cardCount,
        jsonData: jsonData,
        importedAt: Date.now(),
        isLocal: true
      };

      // ローカルストレージに保存
      saveImportedDeckToLocal(deck);

      // Firebaseに同期（ログイン中の場合）
      if (FirebaseSync.isLoggedIn()) {
        FirebaseSync.sync().catch(e => console.error('同期エラー:', e));
      }

      showImportStatus(`「${title}」をインポートしました！（${cardCount}問）`, 'success');

      // イベントを発火してUIを更新
      window.dispatchEvent(new CustomEvent('deckImported', { detail: deck }));

      // 2秒後にモーダルを閉じる
      setTimeout(closeImportModal, 2000);

    } catch (error) {
      console.error('ローカルインポートエラー:', error);
      showImportStatus(error.message || 'ファイルの読み込みに失敗しました。', 'error');
    } finally {
      // ファイル選択をリセット
      if (importFileInput) importFileInput.value = '';
    }
  });

  // ローカルデッキをlocalStorageに保存（FirebaseSyncと同じ関数を再利用）
  function saveImportedDeckToLocal(deck) {
    const IMPORTED_DECKS_KEY = 'studyViewer_importedDecks';
    let importedDecks = [];

    try {
      const stored = localStorage.getItem(IMPORTED_DECKS_KEY);
      if (stored) {
        importedDecks = JSON.parse(stored);
      }
    } catch (e) {
      console.error('ローカルデッキ読み込みエラー:', e);
    }

    // 既存のデッキを更新または追加
    const existingIndex = importedDecks.findIndex(d => d.id === deck.id);
    if (existingIndex >= 0) {
      importedDecks[existingIndex] = deck;
    } else {
      importedDecks.push(deck);
    }

    localStorage.setItem(IMPORTED_DECKS_KEY, JSON.stringify(importedDecks));
  }

  // 相対時間を取得
  function getRelativeTime(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'たった今';
    if (minutes < 60) return `${minutes}分前`;
    if (hours < 24) return `${hours}時間前`;
    return `${days}日前`;
  }

  // 最終同期時刻を更新
  function updateLastSyncTime() {
    const lastSyncEl = document.getElementById('last-sync-time');
    if (!lastSyncEl) return;

    const lastSync = localStorage.getItem('studyViewer_lastSyncTime');
    if (lastSync) {
      lastSyncEl.textContent = getRelativeTime(parseInt(lastSync, 10));
    } else {
      lastSyncEl.textContent = '';
    }
  }

  // 同期バッジの状態を更新
  function updateSyncBadge(status) {
    const badge = document.getElementById('sync-status-badge');
    const statusText = document.getElementById('sync-status-text');
    if (!badge || !statusText) return;

    badge.classList.remove('syncing', 'error');

    switch (status) {
      case 'syncing':
        badge.classList.add('syncing');
        statusText.textContent = '同期中...';
        if (manualSyncBtn) manualSyncBtn.style.display = 'none';
        break;
      case 'success':
        statusText.textContent = '同期済み';
        if (manualSyncBtn) manualSyncBtn.style.display = 'none';
        // 最終同期時刻を保存・表示
        localStorage.setItem('studyViewer_lastSyncTime', Date.now().toString());
        updateLastSyncTime();
        break;
      case 'error':
        badge.classList.add('error');
        statusText.textContent = 'エラー';
        if (manualSyncBtn) manualSyncBtn.style.display = 'flex';
        break;
    }
  }

  // 定期的に相対時間を更新（1分ごと）
  setInterval(updateLastSyncTime, 60000);
  // 初期表示
  updateLastSyncTime();

  // 手動同期
  manualSyncBtn?.addEventListener('click', async () => {
    try {
      updateSyncBadge('syncing');
      manualSyncBtn.disabled = true;

      await FirebaseSync.sync();

      updateSyncBadge('success');
    } catch (error) {
      console.error('同期エラー:', error);
      updateSyncBadge('error');
    } finally {
      manualSyncBtn.disabled = false;
    }
  });

  // 認証状態の監視
  FirebaseSync.onAuthStateChanged(updateUI);

  // 初期状態を設定
  updateUI(FirebaseSync.getCurrentUser());
}
