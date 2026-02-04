/**
 * 弱点分析モジュール（過去問の科目・トピック別正答率）
 */
const WeaknessModule = (function() {
  const STORAGE_KEY = 'studyViewer_kakomonHistory';
  let topicMapCache = null;

  // --- localStorage I/O ---

  function loadHistory() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return createEmptyHistory();
      const data = JSON.parse(raw);
      if (!data || data.version !== 1) return createEmptyHistory();
      return data;
    } catch (e) {
      console.error('[Weakness] 履歴読み込みエラー:', e);
      return createEmptyHistory();
    }
  }

  function saveHistory(history) {
    try {
      history.lastUpdated = Date.now();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    } catch (e) {
      console.error('[Weakness] 履歴保存エラー:', e);
    }
  }

  function createEmptyHistory() {
    return { version: 1, answers: {}, lastUpdated: 0 };
  }

  // --- 解答記録 ---

  function saveAnswer(code, selected, isCorrect) {
    if (!code) return;
    const history = loadHistory();
    if (!history.answers[code]) {
      history.answers[code] = {
        attempts: [],
        lastAttempt: 0,
        correctCount: 0,
        totalCount: 0
      };
    }
    const entry = history.answers[code];
    const now = Date.now();
    entry.attempts.push({
      timestamp: now,
      selected: selected,
      isCorrect: isCorrect
    });
    entry.lastAttempt = now;
    entry.totalCount++;
    if (isCorrect) entry.correctCount++;
    saveHistory(history);
  }

  // --- トピックマップ読み込み ---

  async function loadTopicMap() {
    if (topicMapCache) return topicMapCache;
    try {
      const response = await fetch('question-topic-map.json');
      if (!response.ok) return null;
      const data = await response.json();
      topicMapCache = data.mapping || {};
      return topicMapCache;
    } catch (e) {
      console.error('[Weakness] トピックマップ読み込みエラー:', e);
      return null;
    }
  }

  // --- 集計 ---

  /**
   * 科目別の集計データを正答率の低い順で返す
   */
  async function getAllSubjectsRanked() {
    const topicMap = await loadTopicMap();
    if (!topicMap) return [];

    const history = loadHistory();
    const subjectStats = {};

    // トピックマップの全問題を科目で集計
    for (const [code, info] of Object.entries(topicMap)) {
      const entry = Array.isArray(info) ? info[0] : info;
      const subject = entry.subject;
      if (!subject) continue;

      if (!subjectStats[subject]) {
        subjectStats[subject] = {
          subject: subject,
          totalQuestions: 0,
          answered: 0,
          correct: 0,
          incorrect: 0
        };
      }
      subjectStats[subject].totalQuestions++;

      const ans = history.answers[code];
      if (ans && ans.totalCount > 0) {
        subjectStats[subject].answered++;
        // 最新の解答結果を使用
        const lastAttempt = ans.attempts[ans.attempts.length - 1];
        if (lastAttempt && lastAttempt.isCorrect) {
          subjectStats[subject].correct++;
        } else {
          subjectStats[subject].incorrect++;
        }
      }
    }

    // 配列に変換してソート
    const result = Object.values(subjectStats);
    result.sort((a, b) => {
      // 未挑戦を後ろに
      if (a.answered < 5 && b.answered >= 5) return 1;
      if (a.answered >= 5 && b.answered < 5) return -1;
      if (a.answered < 5 && b.answered < 5) return a.subject.localeCompare(b.subject);
      // 正答率の低い順
      const rateA = a.answered > 0 ? a.correct / a.answered : 0;
      const rateB = b.answered > 0 ? b.correct / b.answered : 0;
      return rateA - rateB;
    });

    return result;
  }

  /**
   * 特定科目のトピック別集計
   */
  async function getTopicAccuracy(subject) {
    const topicMap = await loadTopicMap();
    if (!topicMap) return [];

    const history = loadHistory();
    const topicStats = {};

    for (const [code, info] of Object.entries(topicMap)) {
      const entry = Array.isArray(info) ? info[0] : info;
      if (entry.subject !== subject) continue;

      const topicTitle = entry.topicTitle || '不明';
      const htmlFile = entry.htmlFile || '';

      if (!topicStats[topicTitle]) {
        topicStats[topicTitle] = {
          topicTitle: topicTitle,
          htmlFile: htmlFile,
          totalQuestions: 0,
          answered: 0,
          correct: 0,
          wrongCodes: []
        };
      }
      topicStats[topicTitle].totalQuestions++;

      const ans = history.answers[code];
      if (ans && ans.totalCount > 0) {
        topicStats[topicTitle].answered++;
        const lastAttempt = ans.attempts[ans.attempts.length - 1];
        if (lastAttempt && lastAttempt.isCorrect) {
          topicStats[topicTitle].correct++;
        } else {
          topicStats[topicTitle].wrongCodes.push(code);
        }
      }
    }

    const result = Object.values(topicStats);
    result.sort((a, b) => {
      if (a.answered === 0 && b.answered === 0) return a.topicTitle.localeCompare(b.topicTitle);
      if (a.answered === 0) return 1;
      if (b.answered === 0) return -1;
      const rateA = a.correct / a.answered;
      const rateB = b.correct / b.answered;
      return rateA - rateB;
    });

    return result;
  }

  // --- バッジ判定 ---

  function getBadge(answered, correct) {
    if (answered < 5) return { label: '未挑戦', cls: 'grey' };
    const rate = correct / answered;
    if (rate >= 0.8) return { label: '得意', cls: 'green' };
    if (rate >= 0.6) return { label: '要注意', cls: 'yellow' };
    return { label: '弱点', cls: 'red' };
  }

  // --- レンダリング ---

  async function renderAnalysisView(container) {
    const subjects = await getAllSubjectsRanked();
    const history = loadHistory();

    // 全体集計
    let totalAnswered = 0;
    let totalCorrect = 0;
    let totalQuestions = 0;
    subjects.forEach(s => {
      totalAnswered += s.answered;
      totalCorrect += s.correct;
      totalQuestions += s.totalQuestions;
    });

    const overallRate = totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 100) : 0;

    // 挑戦済み科目と未挑戦科目を分離
    const attempted = subjects.filter(s => s.answered >= 5);
    const unattempted = subjects.filter(s => s.answered < 5);

    let html = `
      <div class="weakness-analysis">
        <button class="weakness-back-btn" id="weakness-back-to-select" style="display:none;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
          <span>分析に戻る</span>
        </button>

        <div class="weakness-overview" id="weakness-overview">
          <h3 class="weakness-section-title">全体サマリー</h3>
          <div class="weakness-overall">
            <div class="weakness-overall-rate">${overallRate}<span class="weakness-rate-unit">%</span></div>
            <div class="weakness-overall-label">総合正答率</div>
            <div class="weakness-bar">
              <div class="weakness-bar-fill" style="width: ${overallRate}%; background: ${overallRate >= 80 ? 'var(--system-green, #34C759)' : overallRate >= 60 ? 'var(--system-orange, #FF9F0A)' : 'var(--accent-color, #e52222)'}"></div>
            </div>
            <div class="weakness-overall-counts">${totalAnswered}問解答 / ${totalQuestions}問中</div>
          </div>`;

    // 挑戦済み科目カード
    if (attempted.length > 0) {
      html += `<h3 class="weakness-section-title">科目別（正答率順）</h3>`;
      html += `<div class="weakness-subject-list">`;
      attempted.forEach(s => {
        const rate = Math.round((s.correct / s.answered) * 100);
        const badge = getBadge(s.answered, s.correct);
        html += renderSubjectCard(s, rate, badge);
      });
      html += `</div>`;
    }

    // 未挑戦科目
    if (unattempted.length > 0) {
      html += `<h3 class="weakness-section-title weakness-unattempted-title">未挑戦の科目</h3>`;
      html += `<div class="weakness-subject-list weakness-unattempted-list">`;
      unattempted.forEach(s => {
        const badge = getBadge(s.answered, s.correct);
        html += `
          <div class="weakness-subject-card weakness-unattempted" data-subject="${escapeHtml(s.subject)}">
            <div class="weakness-subject-header">
              <span class="weakness-subject-name">${escapeHtml(s.subject)}</span>
              <span class="weakness-badge ${badge.cls}">${badge.label}</span>
            </div>
            <div class="weakness-subject-counts">${s.answered}問解答 / ${s.totalQuestions}問</div>
          </div>`;
      });
      html += `</div>`;
    }

    if (totalAnswered === 0) {
      html += `
        <div class="weakness-empty">
          <div class="weakness-empty-icon">
            <svg viewBox="0 0 24 24" fill="currentColor" width="48" height="48">
              <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>
            </svg>
          </div>
          <p class="weakness-empty-text">まだ解答データがありません</p>
          <p class="weakness-empty-hint">過去問タブで問題を解くと、ここに弱点分析が表示されます</p>
        </div>`;
    }

    html += `</div></div>`;
    html += `<div class="weakness-detail" id="weakness-detail" style="display:none;"></div>`;

    container.innerHTML = html;
    bindAnalysisEvents(container);
  }

  function renderSubjectCard(s, rate, badge) {
    const barColor = rate >= 80 ? 'var(--system-green, #34C759)' : rate >= 60 ? 'var(--system-orange, #FF9F0A)' : 'var(--accent-color, #e52222)';
    return `
      <div class="weakness-subject-card" data-subject="${escapeHtml(s.subject)}">
        <div class="weakness-subject-header">
          <span class="weakness-subject-name">${escapeHtml(s.subject)}</span>
          <span class="weakness-badge ${badge.cls}">${badge.label}</span>
        </div>
        <div class="weakness-bar">
          <div class="weakness-bar-fill" style="width: ${rate}%; background: ${barColor}"></div>
        </div>
        <div class="weakness-subject-footer">
          <span class="weakness-rate-text">${rate}%</span>
          <span class="weakness-subject-counts">${s.correct}/${s.answered}問正解 · 未挑戦${s.totalQuestions - s.answered}問</span>
        </div>
        <div class="weakness-subject-arrow">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
            <path d="M9 18l6-6-6-6"/>
          </svg>
        </div>
      </div>`;
  }

  async function renderSubjectDetail(container, subject) {
    const topics = await getTopicAccuracy(subject);

    let html = `
      <h3 class="weakness-detail-title">${escapeHtml(subject)}</h3>
      <div class="weakness-topic-list">`;

    if (topics.length === 0) {
      html += `<p class="weakness-empty-text">トピックデータがありません</p>`;
    } else {
      topics.forEach(t => {
        const rate = t.answered > 0 ? Math.round((t.correct / t.answered) * 100) : -1;
        const barColor = rate === -1 ? 'var(--border-color, #e8e8e8)' :
          rate >= 80 ? 'var(--system-green, #34C759)' :
          rate >= 60 ? 'var(--system-orange, #FF9F0A)' : 'var(--accent-color, #e52222)';

        html += `
          <div class="weakness-topic-row">
            <div class="weakness-topic-header">
              <span class="weakness-topic-name">${escapeHtml(t.topicTitle)}</span>
              <span class="weakness-topic-rate">${rate >= 0 ? rate + '%' : '-'}</span>
            </div>
            <div class="weakness-bar weakness-bar-sm">
              <div class="weakness-bar-fill" style="width: ${rate >= 0 ? rate : 0}%; background: ${barColor}"></div>
            </div>
            <div class="weakness-topic-footer">
              <span class="weakness-topic-counts">${t.correct}/${t.answered}問正解 (全${t.totalQuestions}問)</span>`;

        // 教材リンク
        if (t.htmlFile) {
          const topicId = extractTopicId(t.htmlFile);
          if (topicId) {
            html += `<a class="weakness-material-link" data-topic-id="${escapeHtml(topicId)}" href="#">教材を見る</a>`;
          }
        }
        html += `</div>`;

        // 間違えた問題コード
        if (t.wrongCodes.length > 0) {
          html += `<div class="weakness-wrong-codes">`;
          html += `<span class="weakness-wrong-label">間違えた問題:</span>`;
          t.wrongCodes.forEach(code => {
            html += `<a class="weakness-code-link" data-code="${escapeHtml(code)}" href="#">${escapeHtml(code)}</a>`;
          });
          html += `</div>`;
        }

        html += `</div>`;
      });
    }

    html += `</div>`;
    container.innerHTML = html;
    bindDetailEvents(container);
  }

  // --- イベントバインド ---

  function bindAnalysisEvents(container) {
    // 科目カードのクリック
    container.querySelectorAll('.weakness-subject-card:not(.weakness-unattempted)').forEach(card => {
      card.addEventListener('click', async () => {
        const subject = card.dataset.subject;
        const overview = container.querySelector('#weakness-overview');
        const detail = container.querySelector('#weakness-detail');
        const backBtn = container.querySelector('#weakness-back-to-select');

        if (overview) overview.style.display = 'none';
        if (detail) {
          detail.style.display = 'block';
          await renderSubjectDetail(detail, subject);
        }
        if (backBtn) backBtn.style.display = 'flex';
      });
    });

    // 戻るボタン
    const backBtn = container.querySelector('#weakness-back-to-select');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        const overview = container.querySelector('#weakness-overview');
        const detail = container.querySelector('#weakness-detail');
        if (overview) overview.style.display = 'block';
        if (detail) {
          detail.style.display = 'none';
          detail.innerHTML = '';
        }
        backBtn.style.display = 'none';
      });
    }
  }

  function bindDetailEvents(container) {
    // 教材リンク
    container.querySelectorAll('.weakness-material-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const topicId = link.dataset.topicId;
        if (topicId && typeof window.switchTab === 'function') {
          window.switchTab('html');
          if (typeof window.selectItem === 'function') {
            window.selectItem(topicId);
          }
        }
      });
    });

    // 問題コードリンク
    container.querySelectorAll('.weakness-code-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const code = link.dataset.code;
        if (code) {
          openQuestionByCode(code);
        }
      });
    });
  }

  // --- ヘルパー ---

  function extractTopicId(htmlFile) {
    // 例: "html/subject/インプラント/01_構成と要件_治療の適応.html"
    // → ファイル名部分を取得
    if (!htmlFile) return null;
    const parts = htmlFile.split('/');
    const filename = parts[parts.length - 1];
    return filename.replace('.html', '');
  }

  function openQuestionByCode(code) {
    // 検索機能を使って該当問題を開く
    const searchInput = document.querySelector('#kakomon-search-input');
    if (searchInput) {
      // 過去問タブに切り替え
      if (typeof window.switchTab === 'function') {
        window.switchTab('kakomon');
      }
      // 検索セグメントに切り替えて検索
      setTimeout(() => {
        const searchBtn = document.querySelector('.segment-btn[data-mode="search"]');
        if (searchBtn) searchBtn.click();
        setTimeout(() => {
          const input = document.querySelector('#kakomon-search-input');
          if (input) {
            input.value = code;
            input.dispatchEvent(new Event('input'));
          }
        }, 100);
      }, 100);
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // 公開API
  return {
    saveAnswer,
    loadHistory,
    saveHistory,
    renderAnalysisView,
    renderSubjectDetail,
    getAllSubjectsRanked,
    getTopicAccuracy
  };
})();
