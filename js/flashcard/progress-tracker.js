// Progress and daily stats utilities.
// Extracted from js/flashcard.js (no runtime wiring yet).

export function loadProgress(state, { storageKey, storageVersion }) {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      const data = JSON.parse(saved);
      if (data.version === storageVersion) {
        state.progress = data.cards || {};
        const cardCount = Object.keys(state.progress).length;
        console.log(`[loadProgress] 読み込み完了: ${cardCount}件`);
      } else {
        console.log(`[loadProgress] バージョン不一致: ${data.version} !== ${storageVersion}`);
      }
    } else {
      console.log('[loadProgress] 保存データなし');
    }
  } catch (e) {
    console.error('[loadProgress] 読み込みエラー:', e);
  }
}

export function saveProgress(state, { storageKey, storageVersion }) {
  try {
    const data = {
      version: storageVersion,
      cards: state.progress
    };
    localStorage.setItem(storageKey, JSON.stringify(data));
    const cardCount = Object.keys(state.progress).length;
    console.log(`[saveProgress] 保存完了: ${cardCount}件`);
  } catch (e) {
    console.error('[saveProgress] 保存エラー:', e);
  }
}

export function loadDailyStats({ dailyStatsKey, storageKey }) {
  try {
    const stored = localStorage.getItem(dailyStatsKey);
    if (stored) {
      const stats = JSON.parse(stored);

      // 勉強時間リセットマイグレーション（アイドル検知導入に伴い既存データをクリア）
      if (!stats.studyTimeReset_v2) {
        console.log('[DailyStats] 勉強時間をリセット（アイドル検知導入）');
        for (const dateStr of Object.keys(stats.days || {})) {
          if (stats.days[dateStr]) {
            stats.days[dateStr].studyTimeMs = 0;
          }
        }
        stats.studyTimeReset_v2 = true;
        saveDailyStats(stats, { dailyStatsKey });
      }

      // 既にマイグレーション済みか、データがある場合はそのまま返す
      if (stats.migrated || Object.keys(stats.days || {}).length > 0) {
        return stats;
      }
    }
  } catch (e) {
    console.error('[loadDailyStats] 読み込みエラー:', e);
  }

  // 新規または空のデータの場合、既存の進捗データから復元を試みる
  const reconstructed = reconstructDailyStatsFromProgress({ storageKey });
  if (reconstructed) {
    saveDailyStats(reconstructed, { dailyStatsKey });
    return reconstructed;
  }

  return {
    version: 1,
    days: {},
    streak: {
      current: 0,
      longest: 0,
      lastStudyDate: null
    }
  };
}

export function saveDailyStats(stats, { dailyStatsKey }) {
  try {
    localStorage.setItem(dailyStatsKey, JSON.stringify(stats));
  } catch (e) {
    console.error('[saveDailyStats] 保存エラー:', e);
  }
}

export function getTodayDateString(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function recordDailyActivity(
  type,
  { dailyStatsKey, storageKey, onPublicStatsUpdate }
) {
  const stats = loadDailyStats({ dailyStatsKey, storageKey });
  const today = getTodayDateString();

  if (!stats.days[today]) {
    stats.days[today] = {
      cardsReviewed: 0,
      memorized: 0,
      again: 0,
      studyTimeMs: 0,
      sessions: 0
    };
  }

  stats.days[today].cardsReviewed++;
  if (type === 'memorized') {
    stats.days[today].memorized++;
  } else if (type === 'again') {
    stats.days[today].again++;
  }

  // ストリーク更新
  updateStreak(stats, today);

  saveDailyStats(stats, { dailyStatsKey });

  // 公開統計を自動更新（ログインユーザーは強制参加）
  if (typeof onPublicStatsUpdate === 'function') {
    onPublicStatsUpdate();
  }

  return stats;
}

export function recordStudyTime(durationMs, { dailyStatsKey, storageKey }) {
  const stats = loadDailyStats({ dailyStatsKey, storageKey });
  const today = getTodayDateString();

  if (!stats.days[today]) {
    stats.days[today] = {
      cardsReviewed: 0,
      memorized: 0,
      again: 0,
      studyTimeMs: 0,
      sessions: 0
    };
  }

  stats.days[today].studyTimeMs += durationMs;
  stats.days[today].sessions++;

  saveDailyStats(stats, { dailyStatsKey });
  return stats;
}

export function updateStreak(stats, today) {
  const lastStudyDate = stats.streak.lastStudyDate;

  if (lastStudyDate === today) {
    // 今日既に学習済み - ストリーク変更なし
    return;
  }

  const todayDate = new Date(today);
  const yesterday = new Date(todayDate);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

  if (lastStudyDate === yesterdayStr) {
    // 昨日学習した - ストリーク継続
    stats.streak.current++;
  } else if (lastStudyDate === null) {
    // 初めての学習
    stats.streak.current = 1;
  } else {
    // 1日以上空いた - ストリークリセット
    stats.streak.current = 1;
  }

  // 最長記録更新
  if (stats.streak.current > stats.streak.longest) {
    stats.streak.longest = stats.streak.current;
  }

  stats.streak.lastStudyDate = today;
}

export function getDailyStats({ dailyStatsKey, storageKey }) {
  return loadDailyStats({ dailyStatsKey, storageKey });
}

export function getTodayStats({ dailyStatsKey, storageKey }) {
  const stats = loadDailyStats({ dailyStatsKey, storageKey });
  const today = getTodayDateString();
  return stats.days[today] || {
    cardsReviewed: 0,
    memorized: 0,
    again: 0,
    studyTimeMs: 0,
    sessions: 0
  };
}

export function getWeeklyCards({ dailyStatsKey, storageKey }, now = new Date()) {
  const stats = loadDailyStats({ dailyStatsKey, storageKey });
  let total = 0;

  for (let i = 0; i < 7; i++) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    if (stats.days[dateStr]) {
      total += stats.days[dateStr].cardsReviewed;
    }
  }

  return total;
}

export function calculateStreakFromDates(sortedDatesDesc) {
  if (sortedDatesDesc.length === 0) {
    return { current: 0, longest: 0, lastStudyDate: null };
  }

  const today = getTodayDateString();
  const yesterday = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();

  // 現在のストリークを計算
  let currentStreak = 0;
  let checkDate = sortedDatesDesc[0] === today ? today :
                  sortedDatesDesc[0] === yesterday ? yesterday : null;

  if (checkDate) {
    const dateSet = new Set(sortedDatesDesc);
    let d = new Date(checkDate);

    while (true) {
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (dateSet.has(dateStr)) {
        currentStreak++;
        d.setDate(d.getDate() - 1);
      } else {
        break;
      }
    }
  }

  // 最長ストリークを計算
  let longestStreak = 0;
  let tempStreak = 0;
  let prevDate = null;

  for (const dateStr of sortedDatesDesc) {
    if (prevDate === null) {
      tempStreak = 1;
    } else {
      const current = new Date(dateStr);
      const prev = new Date(prevDate);
      const diffDays = Math.round((prev - current) / (1000 * 60 * 60 * 24));

      if (diffDays === 1) {
        tempStreak++;
      } else {
        longestStreak = Math.max(longestStreak, tempStreak);
        tempStreak = 1;
      }
    }
    prevDate = dateStr;
  }
  longestStreak = Math.max(longestStreak, tempStreak);

  return {
    current: currentStreak,
    longest: longestStreak,
    lastStudyDate: sortedDatesDesc[0]
  };
}

export function reconstructDailyStatsFromProgress({ storageKey }) {
  const progressData = localStorage.getItem(storageKey);
  if (!progressData) return null;

  try {
    const parsed = JSON.parse(progressData);
    const cards = parsed.cards || {};

    // lastReviewを日付ごとにグループ化
    const daysCounts = {};

    for (const [key, value] of Object.entries(cards)) {
      if (value.lastReview) {
        const date = new Date(value.lastReview);
        const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

        if (!daysCounts[dateStr]) {
          daysCounts[dateStr] = {
            cardsReviewed: 0,
            memorized: 0,
            again: 0,
            studyTimeMs: 0,
            sessions: 0
          };
        }

        daysCounts[dateStr].cardsReviewed++;
        // ステータスに基づいて分類（最後の状態のみ）
        if (value.status === 'memorized') {
          daysCounts[dateStr].memorized++;
        } else if (value.status === 'again') {
          daysCounts[dateStr].again++;
        }
      }
    }

    // データがなければnull
    if (Object.keys(daysCounts).length === 0) return null;

    // ストリークを計算
    const sortedDates = Object.keys(daysCounts).sort().reverse();
    const streak = calculateStreakFromDates(sortedDates);

    const stats = {
      version: 1,
      migrated: true,  // マイグレーション済みフラグ
      days: daysCounts,
      streak: streak
    };

    console.log(`[reconstructDailyStats] ${Object.keys(daysCounts).length}日分のデータを復元しました`);
    return stats;

  } catch (e) {
    console.error('[reconstructDailyStats] 復元エラー:', e);
    return null;
  }
}

export function getTopicStats(state, topicId, { masteryThreshold = 14 } = {}) {
  // トピックに関連する進捗を集計（3分類: again/learning/mastered）
  const keys = Object.keys(state.progress).filter(k => k.startsWith(topicId + ':'));
  const now = Date.now();

  let again = 0;     // 要復習（期限切れ）
  let learning = 0;  // 定着中（interval < 14日）
  let mastered = 0;  // 習得済（interval >= 14日）

  for (const k of keys) {
    const p = state.progress[k];
    // 直前期モードでは全てのカードを「要復習」に
    const isDue = state.cramMode ? true : (p.nextReview && p.nextReview <= now);
    const interval = p.interval || 0;

    if (p.status === 'again' && (!p.nextReview || isDue)) {
      again++;
    } else if (p.status === 'memorized') {
      if (isDue) {
        again++;
      } else if (interval >= masteryThreshold) {
        mastered++;
      } else {
        learning++;
      }
    }
  }

  // 後方互換性のためmemorizedも返す（learning + mastered）
  return { again, learning, mastered, memorized: learning + mastered };
}

export function getSubjectStats(state, data, subject, { masteryThreshold = 14 } = {}) {
  // 科目配下の全トピックの統計を集計
  const topics = data.filter(d => d.subject === subject && (d.qaPath || d.localJsonData));
  let totalAgain = 0;
  let totalLearning = 0;
  let totalMastered = 0;

  for (const topic of topics) {
    const stats = getTopicStats(state, topic.id, { masteryThreshold });
    totalAgain += stats.again;
    totalLearning += stats.learning;
    totalMastered += stats.mastered;
  }

  const totalMemorized = totalLearning + totalMastered;
  const totalCards = totalAgain + totalMemorized;

  return { again: totalAgain, learning: totalLearning, mastered: totalMastered, memorized: totalMemorized, total: totalCards };
}

export function getOverallStats(state, { masteryThreshold = 14 } = {}) {
  // progressから直接カウント（全てのtopicIdを含む、3分類）
  const now = Date.now();

  let again = 0;
  let learning = 0;
  let mastered = 0;

  for (const value of Object.values(state.progress)) {
    // 直前期モードでは全てのカードを「要復習」に
    const isDue = state.cramMode ? true : (value.nextReview && value.nextReview <= now);
    const interval = value.interval || 0;

    if (value.status === 'again' && (!value.nextReview || isDue)) {
      again++;
    } else if (value.status === 'memorized') {
      if (isDue) {
        again++;
      } else if (interval >= masteryThreshold) {
        mastered++;
      } else {
        learning++;
      }
    }
  }

  const memorized = learning + mastered;
  const totalCards = memorized + again;
  return { total: totalCards, memorized, again, learning, mastered };
}
