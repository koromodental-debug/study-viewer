// Flashcard stats, ranking, and UI helpers.
// Extracted from js/flashcard.js (no runtime wiring yet).

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export function formatStudyTime(ms) {
  const totalMinutes = Math.floor(ms / 60000);
  if (totalMinutes < 60) {
    return `${totalMinutes}分`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}時間${minutes}分` : `${hours}時間`;
}

export function createStatsModule({
  state,
  getDailyStats,
  getTodayStats,
  getWeeklyCards,
  FirebaseSyncRef
}) {
  // Allow dependency injection, fallback to global FirebaseSync.
  const firebase = FirebaseSyncRef || (typeof FirebaseSync !== 'undefined' ? FirebaseSync : undefined);

  // === 統計表示 ===
  function renderStats() {
    const statsEl = document.getElementById('flashcard-stats');
    if (!statsEl) return;

    const total = Object.keys(state.progress).length;
    const memorized = Object.values(state.progress).filter(p => p.status === 'memorized').length;
    const again = Object.values(state.progress).filter(p => p.status === 'again').length;

    if (total === 0) {
      statsEl.innerHTML = '<p class="flashcard-stats-empty">まだ学習履歴がありません</p>';
      return;
    }

    statsEl.innerHTML = `
      <div class="flashcard-stats-content">
        <h3>学習統計</h3>
        <div class="flashcard-stats-grid">
          <div class="flashcard-stat">
            <span class="flashcard-stat-value">${total}</span>
            <span class="flashcard-stat-label">学習済み</span>
          </div>
          <div class="flashcard-stat memorized">
            <span class="flashcard-stat-value">${memorized}</span>
            <span class="flashcard-stat-label">覚えた</span>
          </div>
          <div class="flashcard-stat again">
            <span class="flashcard-stat-value">${again}</span>
            <span class="flashcard-stat-label">もう一度</span>
          </div>
        </div>
      </div>
    `;
  }

  // === 統計詳細シート ===
  function openStatsDetailSheet() {
    const existing = document.querySelector('.stats-detail-overlay');
    if (existing) existing.remove();

    const stats = getDailyStats();
    const todayStats = getTodayStats();
    const weeklyCards = getWeeklyCards();

    const overlay = document.createElement('div');
    overlay.className = 'stats-detail-overlay';
    overlay.innerHTML = `
      <div class="stats-detail-backdrop"></div>
      <div class="stats-detail-sheet">
        <div class="stats-detail-header">
          <h2 class="stats-detail-title">学習統計</h2>
          <button class="stats-detail-close" id="stats-detail-close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
        <div class="stats-detail-content">
          <!-- ストリーク表示 -->
          <div class="stats-streak-section">
            <div class="stats-streak-current">
              <span class="stats-streak-fire">${stats.streak.current > 0 ? '🔥' : '💤'}</span>
              <span class="stats-streak-number">${stats.streak.current}</span>
              <span class="stats-streak-label">日連続</span>
            </div>
            <div class="stats-streak-best">
              最長記録: ${stats.streak.longest}日
            </div>
          </div>

          <!-- 今日の統計 -->
          <div class="stats-today-section">
            <h3 class="stats-section-title">今日</h3>
            <div class="stats-today-grid">
              <div class="stats-today-item">
                <span class="stats-today-value">${todayStats.cardsReviewed}</span>
                <span class="stats-today-label">枚</span>
              </div>
              <div class="stats-today-item memorized">
                <span class="stats-today-value">${todayStats.memorized}</span>
                <span class="stats-today-label">覚えた</span>
              </div>
              <div class="stats-today-item again">
                <span class="stats-today-value">${todayStats.again}</span>
                <span class="stats-today-label">もう一度</span>
              </div>
              <div class="stats-today-item time">
                <span class="stats-today-value">${formatStudyTime(todayStats.studyTimeMs) || '0分'}</span>
                <span class="stats-today-label">勉強時間</span>
              </div>
            </div>
          </div>

          <!-- 期間別統計 -->
          <div class="stats-period-section">
            <div class="stats-period-tabs">
              <button class="stats-period-tab active" data-period="week">今週</button>
              <button class="stats-period-tab" data-period="month">今月</button>
              <button class="stats-period-tab" data-period="90days">90日</button>
              <button class="stats-period-tab" data-period="6months">6ヶ月</button>
            </div>
            <div class="stats-period-total" id="stats-period-total"></div>
            <div class="stats-period-chart-wrap">
              <div class="stats-period-chart" id="stats-period-chart"></div>
            </div>
          </div>

          <!-- みんなの学習状況（直接表示） -->
          <div class="stats-ranking-section">
            <h3 class="stats-section-title">👥 みんなの学習状況</h3>
            <p class="stats-ranking-desc">週間学習量ランキング（匿名）</p>
            <div class="stats-ranking-list" id="stats-ranking-list">
              <div class="ranking-loading">読み込み中...</div>
            </div>
            <div class="stats-ranking-average" id="stats-ranking-average" style="display:none;">
              <span class="stats-ranking-average-label">全体平均:</span>
              <span class="stats-ranking-average-value" id="stats-ranking-average-value">-</span>
              <span class="stats-ranking-average-unit">枚/週</span>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // アニメーション
    requestAnimationFrame(() => {
      overlay.classList.add('active');
    });

    // 閉じるボタン
    overlay.querySelector('#stats-detail-close').addEventListener('click', closeStatsDetailSheet);
    overlay.querySelector('.stats-detail-backdrop').addEventListener('click', closeStatsDetailSheet);

    // 期間別グラフ描画（デフォルトは今週）
    renderPeriodChart('week');

    // 期間タブ切り替え
    overlay.querySelectorAll('.stats-period-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        overlay.querySelectorAll('.stats-period-tab').forEach(t => t.classList.remove('active'));
        e.target.classList.add('active');
        renderPeriodChart(e.target.dataset.period);
      });
    });

    // ランキング読み込み
    loadRankingInStats();
  }

  function closeStatsDetailSheet() {
    const overlay = document.querySelector('.stats-detail-overlay');
    if (overlay) {
      overlay.classList.remove('active');
      setTimeout(() => overlay.remove(), 300);
    }
  }

  function renderPeriodChart(period = 'week') {
    const chartEl = document.getElementById('stats-period-chart');
    const totalEl = document.getElementById('stats-period-total');
    if (!chartEl) return;

    const stats = getDailyStats();
    const today = new Date();
    const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
    const monthNames = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

    let data = [];
    let totalCards = 0;
    let studyDays = 0;
    let maxCards = 1;

    if (period === 'week') {
      // 今週：日ごとの棒グラフ
      for (let i = 6; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        const dayData = stats.days[dateStr] || { cardsReviewed: 0 };
        const cards = dayData.cardsReviewed;
        totalCards += cards;
        if (cards > 0) studyDays++;
        maxCards = Math.max(maxCards, cards);
        data.push({ label: dayNames[date.getDay()], cards, isToday: i === 0 });
      }
    } else if (period === 'month') {
      // 今月：週ごとにまとめる（4週間）
      for (let week = 3; week >= 0; week--) {
        let weekCards = 0;
        let weekStart = null;
        for (let d = 0; d < 7; d++) {
          const date = new Date(today);
          date.setDate(date.getDate() - (week * 7 + (6 - d)));
          if (d === 0) weekStart = date;
          const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
          const dayData = stats.days[dateStr] || { cardsReviewed: 0 };
          weekCards += dayData.cardsReviewed;
          if (dayData.cardsReviewed > 0) studyDays++;
        }
        totalCards += weekCards;
        maxCards = Math.max(maxCards, weekCards);
        const label = `${weekStart.getMonth() + 1}/${weekStart.getDate()}〜`;
        data.push({ label, cards: weekCards, isToday: week === 0 });
      }
    } else if (period === '90days') {
      // 90日：週ごとにまとめる（13週間）
      for (let week = 12; week >= 0; week--) {
        let weekCards = 0;
        let weekStart = null;
        for (let d = 0; d < 7; d++) {
          const date = new Date(today);
          date.setDate(date.getDate() - (week * 7 + (6 - d)));
          if (d === 0) weekStart = date;
          const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
          const dayData = stats.days[dateStr] || { cardsReviewed: 0 };
          weekCards += dayData.cardsReviewed;
          if (dayData.cardsReviewed > 0) studyDays++;
        }
        totalCards += weekCards;
        maxCards = Math.max(maxCards, weekCards);
        const label = `${weekStart.getMonth() + 1}/${weekStart.getDate()}`;
        data.push({ label, cards: weekCards, isToday: week === 0 });
      }
    } else if (period === '6months') {
      // 6ヶ月：月ごとにまとめる
      for (let m = 5; m >= 0; m--) {
        const targetMonth = new Date(today.getFullYear(), today.getMonth() - m, 1);
        const nextMonth = new Date(today.getFullYear(), today.getMonth() - m + 1, 1);
        let monthCards = 0;

        for (const [dateStr, dayData] of Object.entries(stats.days)) {
          const date = new Date(dateStr);
          if (date >= targetMonth && date < nextMonth) {
            monthCards += dayData.cardsReviewed || 0;
            if (dayData.cardsReviewed > 0) studyDays++;
          }
        }
        totalCards += monthCards;
        maxCards = Math.max(maxCards, monthCards);
        const label = monthNames[targetMonth.getMonth()];
        data.push({ label, cards: monthCards, isToday: m === 0 });
      }
    }

    // 合計表示
    if (totalEl) {
      totalEl.innerHTML = `
        <span class="period-total-value">${totalCards}</span>
        <span class="period-total-unit">枚</span>
        <span class="period-total-days">${studyDays}日学習</span>
      `;
    }

    // 棒グラフで表示
    chartEl.className = 'stats-period-chart bar-chart';
    chartEl.innerHTML = data.map(d => `
      <div class="period-bar-container">
        <div class="period-bar ${d.isToday ? 'today' : ''}" style="height: ${maxCards > 0 ? (d.cards / maxCards) * 100 : 0}%">
          ${d.cards > 0 ? `<span class=\"period-bar-value\">${d.cards}</span>` : ''}
        </div>
        <span class="period-bar-label">${d.label}</span>
      </div>
    `).join('');
  }

  // === ランキングシート ===
  function openRankingSheet() {
    const existing = document.querySelector('.ranking-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'ranking-overlay';
    overlay.innerHTML = `
      <div class="ranking-backdrop"></div>
      <div class="ranking-sheet">
        <div class="ranking-header">
          <h2 class="ranking-title">みんなの学習状況</h2>
          <button class="ranking-close" id="ranking-close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
        <div class="ranking-content">
          <!-- 説明 -->
          <div class="ranking-info-section">
            <p class="ranking-info-desc">ログインユーザーの週間学習量ランキングです。表示名は匿名です。</p>
          </div>

          <!-- ランキングリスト -->
          <div class="ranking-list-section">
            <h3 class="ranking-list-title">週間学習量ランキング</h3>
            <div class="ranking-list" id="ranking-list">
              <div class="ranking-loading">読み込み中...</div>
            </div>
          </div>

          <!-- 全体平均 -->
          <div class="ranking-average-section" id="ranking-average-section" style="display:none;">
            <div class="ranking-average-card">
              <span class="ranking-average-label">全体平均</span>
              <span class="ranking-average-value" id="ranking-average-value">-</span>
              <span class="ranking-average-unit">枚/週</span>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // アニメーション
    requestAnimationFrame(() => {
      overlay.classList.add('active');
    });

    // イベント
    overlay.querySelector('#ranking-close').addEventListener('click', closeRankingSheet);
    overlay.querySelector('.ranking-backdrop').addEventListener('click', closeRankingSheet);

    // ランキング読み込み
    loadRanking();
  }

  function closeRankingSheet() {
    const overlay = document.querySelector('.ranking-overlay');
    if (overlay) {
      overlay.classList.remove('active');
      setTimeout(() => overlay.remove(), 300);
    }
  }

  // 公開統計を自動更新（ログインユーザーは強制参加）
  let lastPublicStatsUpdate = 0;
  const PUBLIC_STATS_UPDATE_INTERVAL = 60000; // 1分に1回まで
  const DISPLAY_NAME_KEY = 'studyViewer_displayName';

  // カスタム表示名を取得
  function getCustomDisplayName() {
    try {
      return localStorage.getItem(DISPLAY_NAME_KEY);
    } catch (e) {
      return null;
    }
  }

  // カスタム表示名を保存
  function setCustomDisplayName(name) {
    try {
      if (name) {
        localStorage.setItem(DISPLAY_NAME_KEY, name);
      } else {
        localStorage.removeItem(DISPLAY_NAME_KEY);
      }
    } catch (e) {
      console.error('[DisplayName] 保存エラー:', e);
    }
  }

  // 表示名を取得（カスタム名があればそれを使用）
  function getDisplayName() {
    const customName = getCustomDisplayName();
    if (customName) return customName;

    // デフォルトの匿名名を生成
    if (firebase && firebase.isLoggedIn()) {
      const user = firebase.getCurrentUser();
      if (user) {
        return '匿名' + user.uid.substring(0, 4).toUpperCase();
      }
    }
    return '匿名';
  }

  // 表示名変更ダイアログを表示
  function showDisplayNameEditor() {
    const currentName = getCustomDisplayName() || '';
    const defaultName = (() => {
      if (firebase && firebase.isLoggedIn()) {
        const user = firebase.getCurrentUser();
        if (user) return '匿名' + user.uid.substring(0, 4).toUpperCase();
      }
      return '匿名';
    })();

    const overlay = document.createElement('div');
    overlay.className = 'display-name-overlay';
    overlay.innerHTML = `
      <div class="display-name-modal">
        <h3 class="display-name-title">表示名を変更</h3>
        <p class="display-name-desc">ランキングに表示される名前を設定できます</p>
        <input type="text" class="display-name-input" id="display-name-input"
               value="${escapeHtml(currentName)}"
               placeholder="${escapeHtml(defaultName)}"
               maxlength="20">
        <p class="display-name-hint">空欄にすると自動生成の名前（${escapeHtml(defaultName)}）になります</p>
        <div class="display-name-actions">
          <button class="display-name-cancel" id="display-name-cancel">キャンセル</button>
          <button class="display-name-save" id="display-name-save">保存</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    setTimeout(() => overlay.classList.add('active'), 10);

    const input = document.getElementById('display-name-input');
    input.focus();
    input.select();

    // キャンセル
    document.getElementById('display-name-cancel').addEventListener('click', () => {
      overlay.classList.remove('active');
      setTimeout(() => overlay.remove(), 300);
    });

    // 保存
    document.getElementById('display-name-save').addEventListener('click', async () => {
      const newName = input.value.trim();
      setCustomDisplayName(newName || null);

      // 即座に公開統計を更新
      lastPublicStatsUpdate = 0; // 強制更新
      await updatePublicStats();

      overlay.classList.remove('active');
      setTimeout(() => {
        overlay.remove();
        // ランキングを再読み込み
        loadRankingInStats();
      }, 300);
    });

    // Enterキーで保存
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        document.getElementById('display-name-save').click();
      }
    });

    // オーバーレイクリックで閉じる
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        document.getElementById('display-name-cancel').click();
      }
    });
  }

  async function updatePublicStats() {
    if (!firebase || !firebase.isLoggedIn()) {
      return;
    }

    // 更新頻度を制限（1分に1回まで）
    const now = Date.now();
    if (now - lastPublicStatsUpdate < PUBLIC_STATS_UPDATE_INTERVAL) {
      return;
    }
    lastPublicStatsUpdate = now;

    const user = firebase.getCurrentUser();
    if (!user) return;

    const stats = getDailyStats();
    const weeklyCards = getWeeklyCards();

    // カスタム表示名または自動生成名を使用
    const displayName = getDisplayName();

    const publicStats = {
      displayName: displayName,
      weeklyCards: weeklyCards,
      currentStreak: stats.streak.current,
      lastUpdated: Date.now(),
      isPublic: true
    };

    try {
      await firebase.updatePublicStats(publicStats);
      console.log('[Ranking] 公開統計を更新しました');
    } catch (e) {
      console.error('[Ranking] 公開統計の更新に失敗:', e);
    }
  }

  async function loadRanking() {
    const listEl = document.getElementById('ranking-list');
    const avgSection = document.getElementById('ranking-average-section');
    const avgValue = document.getElementById('ranking-average-value');

    if (!listEl || !firebase) return;

    try {
      const ranking = await firebase.getRanking();

      if (ranking.length === 0) {
        listEl.innerHTML = `
          <div class="ranking-empty">
            <p>まだランキングに参加者がいません。</p>
            <p>学習状況を公開して、最初の参加者になりましょう！</p>
          </div>
        `;
        return;
      }

      // 平均を計算
      const totalCards = ranking.reduce((sum, r) => sum + r.weeklyCards, 0);
      const average = Math.round(totalCards / ranking.length);

      if (avgSection && avgValue) {
        avgSection.style.display = 'block';
        avgValue.textContent = average;
      }

      // 現在のユーザーIDを取得
      const currentUserId = firebase.isLoggedIn() ? firebase.getCurrentUser()?.uid : null;

      listEl.innerHTML = ranking.map((item, index) => {
        const isMe = currentUserId && item.userId === currentUserId;
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}`;
        return `
          <div class="ranking-item ${isMe ? 'is-me' : ''}">
            <span class="ranking-rank">${medal}</span>
            <span class="ranking-name">${escapeHtml(item.displayName)}${isMe ? ' (自分)' : ''}</span>
            <span class="ranking-cards">${item.weeklyCards}枚</span>
            ${item.currentStreak > 0 ? `<span class=\"ranking-streak\">🔥${item.currentStreak}</span>` : ''}
          </div>
        `;
      }).join('');

    } catch (e) {
      console.error('[Ranking] ランキング読み込みエラー:', e);
      listEl.innerHTML = `
        <div class="ranking-error">
          <p>ランキングの読み込みに失敗しました。</p>
          <p>ネットワーク接続を確認してください。</p>
        </div>
      `;
    }
  }

  // 統計シート内にランキングを表示
  async function loadRankingInStats() {
    const listEl = document.getElementById('stats-ranking-list');
    const avgEl = document.getElementById('stats-ranking-average');
    const avgValueEl = document.getElementById('stats-ranking-average-value');

    if (!listEl || !firebase) return;

    try {
      const ranking = await firebase.getRanking();

      if (ranking.length === 0) {
        listEl.innerHTML = `
          <div class="ranking-empty-inline">
            まだ参加者がいません。学習を始めましょう！
          </div>
        `;
        return;
      }

      // 平均を計算
      const totalCards = ranking.reduce((sum, r) => sum + r.weeklyCards, 0);
      const average = Math.round(totalCards / ranking.length);

      if (avgEl && avgValueEl) {
        avgEl.style.display = 'flex';
        avgValueEl.textContent = average;
      }

      // 現在のユーザーIDを取得
      const currentUserId = firebase.isLoggedIn() ? firebase.getCurrentUser()?.uid : null;

      listEl.innerHTML = ranking.map((item, index) => {
        const isMe = currentUserId && item.userId === currentUserId;
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}`;
        return `
          <div class="stats-ranking-item ${isMe ? 'is-me' : ''}">
            <span class="stats-ranking-rank">${medal}</span>
            <span class="stats-ranking-name ${isMe ? 'editable' : ''}" ${isMe ? 'data-editable=\"true\"' : ''}>${escapeHtml(item.displayName)}${isMe ? ' (自分) ✏️' : ''}</span>
            <span class="stats-ranking-cards">${item.weeklyCards}枚</span>
            ${item.currentStreak > 0 ? `<span class=\"stats-ranking-streak\">🔥${item.currentStreak}</span>` : ''}
          </div>
        `;
      }).join('');

      // 名前編集のクリックイベント
      listEl.querySelectorAll('.stats-ranking-name[data-editable="true"]').forEach(el => {
        el.addEventListener('click', () => showDisplayNameEditor());
      });

    } catch (e) {
      console.error('[Ranking] ランキング読み込みエラー:', e);
      listEl.innerHTML = `
        <div class="ranking-error-inline">
          読み込みに失敗しました
        </div>
      `;
    }
  }

  return {
    renderStats,
    openStatsDetailSheet,
    closeStatsDetailSheet,
    renderPeriodChart,
    openRankingSheet,
    closeRankingSheet,
    updatePublicStats,
    loadRanking,
    loadRankingInStats,
    getCustomDisplayName,
    setCustomDisplayName,
    getDisplayName,
    showDisplayNameEditor
  };
}
