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
    'studyViewer_favorites'
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
      // ログイン時：クラウドからデータを取得して同期
      await pullFromCloud();
    } else {
      console.log('[FirebaseSync] ログアウト状態');
    }

    // リスナーに通知
    authStateListeners.forEach(listener => listener(user));
  }

  /**
   * Googleでログイン
   */
  async function signInWithGoogle() {
    if (!auth) {
      console.error('[FirebaseSync] 未初期化');
      return null;
    }

    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      const result = await auth.signInWithPopup(provider);
      return result.user;
    } catch (error) {
      console.error('[FirebaseSync] ログインエラー:', error);

      // ポップアップブロック時はリダイレクト方式にフォールバック
      if (error.code === 'auth/popup-blocked') {
        const provider = new firebase.auth.GoogleAuthProvider();
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

      // Firestoreに保存
      await userDocRef.set(syncData, { merge: true });
      console.log('[FirebaseSync] クラウドにプッシュ完了');
    } catch (error) {
      console.error('[FirebaseSync] プッシュエラー:', error);
      throw error;
    }
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
      const doc = await userDocRef.get();

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
      } else if (key === 'studyViewer_favorites') {
        return JSON.stringify(mergeFavorites(localData, cloudData));
      }
    } catch (e) {
      console.error('[FirebaseSync] マージエラー:', e);
    }

    // パースできない場合はクラウドを優先
    return cloudValue;
  }

  /**
   * フラッシュカード進捗のマージ
   */
  function mergeFlashcardProgress(local, cloud) {
    const merged = { ...cloud };

    // ローカルのデータを追加・更新
    if (local.topics && cloud.topics) {
      merged.topics = { ...cloud.topics };

      for (const topicId in local.topics) {
        if (!merged.topics[topicId]) {
          merged.topics[topicId] = local.topics[topicId];
        } else {
          // 各カードの状態をマージ（より進んでいる方を採用）
          const localTopic = local.topics[topicId];
          const cloudTopic = merged.topics[topicId];

          if (localTopic.cards && cloudTopic.cards) {
            for (const cardId in localTopic.cards) {
              if (!cloudTopic.cards[cardId]) {
                cloudTopic.cards[cardId] = localTopic.cards[cardId];
              } else {
                // 正解回数が多い方を採用
                const localCard = localTopic.cards[cardId];
                const cloudCard = cloudTopic.cards[cardId];
                if ((localCard.correctCount || 0) > (cloudCard.correctCount || 0)) {
                  cloudTopic.cards[cardId] = localCard;
                }
              }
            }
          }
        }
      }
    } else if (local.topics) {
      merged.topics = local.topics;
    }

    merged.version = Math.max(local.version || 1, cloud.version || 1);
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

    // 定期同期（5分ごと）
    setInterval(async () => {
      if (isLoggedIn()) {
        await pushToCloud();
        console.log('[FirebaseSync] 定期同期完了');
      }
    }, 5 * 60 * 1000);

    // visibilitychange時に同期（タブがバックグラウンドから復帰時）
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible' && isLoggedIn()) {
        await pullFromCloud();
      }
    });
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
    isLoggedIn
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
  const accountIconLoggedIn = document.querySelector('.account-icon-logged-in');

  if (!accountOverlay) return;

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
    if (user) {
      // ログイン済み
      accountLoggedOut.style.display = 'none';
      accountLoggedIn.style.display = 'flex';
      accountIconLoggedOut.style.display = 'none';
      accountIconLoggedIn.style.display = 'block';

      // ユーザー情報を表示
      const userPhoto = document.getElementById('account-user-photo');
      const userName = document.getElementById('account-user-name');
      const userEmail = document.getElementById('account-user-email');

      if (user.photoURL) {
        userPhoto.src = user.photoURL;
        userPhoto.style.display = 'block';
      } else {
        userPhoto.style.display = 'none';
      }
      userName.textContent = user.displayName || 'ユーザー';
      userEmail.textContent = user.email || '';
    } else {
      // 未ログイン
      accountLoggedOut.style.display = 'flex';
      accountLoggedIn.style.display = 'none';
      accountIconLoggedOut.style.display = 'block';
      accountIconLoggedIn.style.display = 'none';
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

  // ログアウト
  signoutBtn?.addEventListener('click', async () => {
    try {
      await FirebaseSync.signOut();
      closeAccountSheet();
    } catch (error) {
      console.error('ログアウトエラー:', error);
    }
  });

  // 手動同期
  manualSyncBtn?.addEventListener('click', async () => {
    try {
      const statusText = document.getElementById('sync-status-text');
      statusText.textContent = '同期中...';
      manualSyncBtn.disabled = true;

      await FirebaseSync.sync();

      statusText.textContent = '同期完了';
      setTimeout(() => {
        statusText.textContent = '同期済み';
      }, 2000);
    } catch (error) {
      console.error('同期エラー:', error);
      document.getElementById('sync-status-text').textContent = '同期エラー';
    } finally {
      manualSyncBtn.disabled = false;
    }
  });

  // 認証状態の監視
  FirebaseSync.onAuthStateChanged(updateUI);

  // 初期状態を設定
  updateUI(FirebaseSync.getCurrentUser());
}
