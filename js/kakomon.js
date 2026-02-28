/**
 * 過去問モジュール（年度別・科目別選択 + 会話解説付き）
 */
const KakomonModule = (function() {
  // キャッシュ
  const dataCache = new Map();
  const explanationCache = new Map();
  const imageExplanationCache = new Map();
  const integratedExplanationCache = { data: null, loaded: false };
  const questionTopicMapCache = { data: null, loaded: false };
  const thinkingExplanationCache = { data: null, loaded: false };
  let questionsData = null;

  // 状態
  const state = {
    currentQuestions: [],
    currentItem: null,
    viewMode: 'select', // 'select' | 'year' | 'subject' | 'questions' | 'search'
    currentSegment: 'year', // 'year' | 'subject' | 'search' - 現在のセグメント
    selectedYear: null,
    selectedSession: null,
    selectedSubject: null,
    searchQuery: '',
    searchResults: [],
    searchDebounceTimer: null
  };

  // 定数
  const YEARS = Array.from({ length: 18 }, (_, i) => 119 - i); // 119〜102
  const SESSIONS = ['A', 'B', 'C', 'D'];
  const SUBJECTS = [
    '解剖学', '組織学', '生理学', '生化学', '病理学', '薬理学',
    '微生物学・免疫学', '歯科理工学', '歯科放射線学',
    '歯周病学', '歯内療法学', '保存修復学', '冠橋義歯学',
    '全部床義歯学', '部分床義歯学', 'インプラント',
    '口腔外科学', '小児歯科', '矯正', '歯科麻酔学',
    '高齢者歯科', '社会歯科', '摂食嚥下',
    '公衆衛生', '口腔衛生', '疫学',
    '必修'
  ];

  // フラッシュカード科目名 → 過去問科目名のマッピング
  const SUBJECT_MAPPING = {
    '解剖': '解剖学',
    '組織': '組織学',
    '生理': '生理学',
    '生化': '生化学',
    '病理': '病理学',
    '薬理': '薬理学',
    '微生物・免疫': '微生物学・免疫学',
    '歯科理工': '歯科理工学',
    '歯科放射線': '歯科放射線学',
    '歯周病': '歯周病学',
    '歯内療法学': '歯内療法学',
    '保存修復': '保存修復学',
    '冠橋義歯': '冠橋義歯学',
    '全部床義歯': '全部床義歯学',
    '部分床義歯': '部分床義歯学',
    'インプラント': 'インプラント',
    '口腔外科': '口腔外科学',
    '小児歯科': '小児歯科',
    '矯正': '矯正',
    '歯科麻酔': '歯科麻酔学',
    '高齢者歯科': '高齢者歯科',
    '社会歯科': '社会歯科',
    '摂食嚥下': '摂食嚥下',
    '公衆衛生': '公衆衛生',
    '口腔衛生': '口腔衛生',
    '疫学': '疫学',
    '必修': '必修'
  };

  // 逆マッピング（過去問科目名 → フラッシュカード科目名）
  const REVERSE_SUBJECT_MAPPING = Object.fromEntries(
    Object.entries(SUBJECT_MAPPING).map(([k, v]) => [v, k])
  );

  // セグメント定義
  const SEGMENTS = ['year', 'subject', 'search', 'analysis'];

  /**
   * questions.jsonを読み込み
   */
  async function loadQuestionsData() {
    if (questionsData) return questionsData;

    try {
      const response = await fetch('questions.json');
      if (!response.ok) throw new Error('Failed to load questions.json');
      questionsData = await response.json();
      return questionsData;
    } catch (e) {
      console.error('questions.json読み込みエラー:', e);
      return null;
    }
  }

  /**
   * 会話解説データを読み込み
   */
  async function loadExplanations(year) {
    if (explanationCache.has(year)) {
      return explanationCache.get(year);
    }

    try {
      const response = await fetch(`kakomon/explanations/${year}.json`);
      if (!response.ok) return null;
      const data = await response.json();
      explanationCache.set(year, data);
      return data;
    } catch (e) {
      console.log(`${year}回の解説データなし`);
      return null;
    }
  }

  /**
   * 画像解説データを読み込み
   */
  async function loadImageExplanations(year) {
    if (imageExplanationCache.has(year)) {
      return imageExplanationCache.get(year);
    }

    try {
      const response = await fetch(`kakomon/image-explanations/${year}.json`);
      if (!response.ok) return null;
      const data = await response.json();
      imageExplanationCache.set(year, data);
      return data;
    } catch (e) {
      console.log(`${year}回の画像解説データなし`);
      return null;
    }
  }

  /**
   * 統合解説データを読み込み（アプローチ・画像診断・選択肢解説）
   */
  async function loadIntegratedExplanations() {
    if (integratedExplanationCache.loaded) {
      return integratedExplanationCache.data;
    }

    try {
      const response = await fetch('kakomon/integrated-explanations.json');
      if (!response.ok) return null;
      const data = await response.json();
      integratedExplanationCache.data = data;
      integratedExplanationCache.loaded = true;
      return data;
    } catch (e) {
      console.log('統合解説データ読み込みエラー:', e);
      integratedExplanationCache.loaded = true;
      return null;
    }
  }

  /**
   * 問題-トピックマッピングを読み込み
   */
  async function loadQuestionTopicMap() {
    if (questionTopicMapCache.loaded) {
      return questionTopicMapCache.data;
    }

    try {
      const response = await fetch('question-topic-map.json');
      if (!response.ok) return null;
      const data = await response.json();
      questionTopicMapCache.data = data.mapping || {};
      questionTopicMapCache.loaded = true;
      return questionTopicMapCache.data;
    } catch (e) {
      console.log('question-topic-map.json読み込みエラー:', e);
      questionTopicMapCache.loaded = true;
      return null;
    }
  }

  /**
   * 思考プロセス型解説を読み込み
   */
  async function loadThinkingExplanations() {
    if (thinkingExplanationCache.loaded) {
      return thinkingExplanationCache.data;
    }

    try {
      const response = await fetch('kakomon/thinking-explanations.json');
      if (!response.ok) return null;
      const data = await response.json();
      thinkingExplanationCache.data = data.explanations || {};
      thinkingExplanationCache.loaded = true;
      return thinkingExplanationCache.data;
    } catch (e) {
      console.log('thinking-explanations.json読み込みスキップ');
      thinkingExplanationCache.loaded = true;
      return null;
    }
  }

  /**
   * 思考プロセス型解説をレンダリング
   */
  function renderThinkingExplanation(thinking) {
    if (!thinking || !thinking.thinking_process) return '';

    let html = '<div class="thinking-explanation">';

    // 思考の流れ
    html += `
      <div class="thinking-section thinking-process">
        <div class="thinking-section-title">
          <span class="thinking-icon">💭</span>
          <span>思考の流れ</span>
        </div>
        <div class="thinking-section-content">${escapeHtml(thinking.thinking_process)}</div>
      </div>
    `;

    // 核心知識
    if (thinking.core_knowledge) {
      html += `
        <div class="thinking-section core-knowledge">
          <div class="thinking-section-title">
            <span class="thinking-icon">📌</span>
            <span>核心知識</span>
          </div>
          <div class="thinking-section-content">${escapeHtml(thinking.core_knowledge)}</div>
        </div>
      `;
    }

    // 引っかけポイント
    if (thinking.trap_point) {
      html += `
        <div class="thinking-section trap-point">
          <div class="thinking-section-title">
            <span class="thinking-icon">⚠️</span>
            <span>間違えやすいポイント</span>
          </div>
          <div class="thinking-section-content">${escapeHtml(thinking.trap_point)}</div>
        </div>
      `;
    }

    html += '</div>';
    return html;
  }

  /**
   * htmlPathからDATAのトピックIDを逆引き
   */
  function findTopicIdByHtmlPath(htmlPath) {
    if (typeof DATA === 'undefined') return null;
    const item = DATA.find(d => d.htmlPath === htmlPath);
    return item ? item.id : null;
  }

  /**
   * 関連トピックのHTMLを生成
   */
  function renderRelatedTopics(topicEntries) {
    if (!topicEntries || topicEntries.length === 0) return '';

    const links = topicEntries.map(entry => {
      const topicId = findTopicIdByHtmlPath(entry.htmlFile);
      if (!topicId) return '';
      return `
        <button class="related-topic-link" data-topic-id="${escapeHtml(topicId)}" data-html-path="${escapeHtml(entry.htmlFile)}">
          <span class="related-topic-subject">${escapeHtml(entry.subject)}</span>
          <span class="related-topic-title">${escapeHtml(entry.topicTitle)}</span>
          <svg class="related-topic-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
            <path d="M9 18l6-6-6-6"/>
          </svg>
        </button>
      `;
    }).filter(html => html !== '');

    if (links.length === 0) return '';

    return `
      <div class="related-topics-section">
        <div class="related-topics-header">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
          </svg>
          <span>関連トピック</span>
        </div>
        <div class="related-topics-links">
          ${links.join('')}
        </div>
      </div>
    `;
  }

  /**
   * 関連トピックリンクのイベントをバインド
   */
  function bindRelatedTopicLinks(container) {
    container.querySelectorAll('.related-topic-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const topicId = link.dataset.topicId;
        if (topicId && typeof window.switchTab === 'function') {
          window.switchTab('html', false, true);
          if (typeof window.selectItem === 'function') {
            window.selectItem(topicId);
          }
        }
      });
    });
  }

  /**
   * 画像種類の日本語名
   */
  const IMAGE_TYPE_LABELS = {
    intraoral: '口腔内写真',
    extraoral: '顔面写真',
    xray_panorama: 'パノラマX線',
    xray_dental: 'デンタルX線',
    xray_ct: 'CT画像',
    xray_mri: 'MRI画像',
    xray_cephalometric: 'セファロX線',
    model: '模型写真',
    surgical: '術中写真',
    histology: '組織像',
    device: '器具・材料',
    diagram: '模式図',
    choice_images: '選択肢画像',
    other: 'その他'
  };

  /**
   * 科目の過去問データを読み込み
   */
  async function loadSubjectData(subject) {
    if (dataCache.has(subject)) {
      return dataCache.get(subject);
    }

    // まずkakomon/フォルダのJSONを試す
    try {
      const response = await fetch(encodeURI(`kakomon/${subject}.json`));
      if (response.ok) {
        const data = await response.json();
        dataCache.set(subject, data);
        return data;
      }
    } catch (e) {
      // 無視して次の方法を試す
    }

    // JSONファイルがない場合、data.jsとquestions.jsonから生成
    try {
      const data = await loadSubjectFromFlashcardData(subject);
      if (data && data.questions && data.questions.length > 0) {
        dataCache.set(subject, data);
        return data;
      }
    } catch (e) {
      console.log('フォールバック読み込みエラー:', e);
    }

    return null;
  }

  /**
   * フラッシュカードのdata.jsから科目の過去問を抽出
   */
  async function loadSubjectFromFlashcardData(subject) {
    // questions.jsonを読み込み
    const questionsData = await loadQuestionsData();
    if (!questionsData || !questionsData.questions) return null;

    // DATAがグローバルに存在するか確認
    if (typeof DATA === 'undefined') return null;

    // フラッシュカード科目名を取得
    const flashcardSubject = REVERSE_SUBJECT_MAPPING[subject] || subject;

    // この科目のトピックをフィルタリング
    const subjectTopics = DATA.filter(topic => topic.subject === flashcardSubject);
    if (subjectTopics.length === 0) return null;

    // searchTextから過去問番号を抽出
    const questionCodes = new Set();
    const codePattern = /(\d{3}[ABCDabcd]-?\d{1,2})/g;

    subjectTopics.forEach(topic => {
      const searchText = topic.searchText || '';
      let match;
      while ((match = codePattern.exec(searchText)) !== null) {
        // 形式を正規化: 117A-15 → 117A15
        const code = match[1].replace('-', '').toUpperCase();
        questionCodes.add(code);
      }
    });

    if (questionCodes.size === 0) return null;

    // questions.jsonから該当する問題を取得
    const questions = questionsData.questions.filter(q => {
      return questionCodes.has(q.id);
    }).map(q => convertQuestionFormat(q));

    // 年度でソート（新しい順）
    questions.sort((a, b) => {
      const yearA = a.examNum || parseInt(a.code);
      const yearB = b.examNum || parseInt(b.code);
      return yearB - yearA;
    });

    return { subject, questions };
  }

  /**
   * キーワードで問題をフィルタリング
   */
  function filterByKeyword(questions, keyword) {
    if (!keyword) return [];

    const normalizedKeyword = keyword.toLowerCase();

    return questions.filter(q => {
      const qKeyword = (q.keyword || '').toLowerCase();
      return qKeyword === normalizedKeyword ||
             qKeyword.includes(normalizedKeyword) ||
             normalizedKeyword.includes(qKeyword);
    });
  }

  /**
   * 過去問タブの初期化（ナビゲーション画面を表示）
   */
  function initKakomonTab(elements) {
    state.viewMode = 'select';
    state.selectedYear = null;
    state.selectedSession = null;
    state.selectedSubject = null;
    renderSelectScreen(elements);
  }

  /**
   * 選択画面を表示
   */
  function renderSelectScreen(elements) {
    if (elements.kakomonPlaceholder) {
      elements.kakomonPlaceholder.style.display = 'none';
    }
    if (elements.kakomonDisplay) {
      elements.kakomonDisplay.style.display = 'block';
      elements.kakomonDisplay.innerHTML = `
        <div class="kakomon-nav-screen">
          <div class="kakomon-segment-control">
            <button class="segment-btn active" data-mode="year">年度別</button>
            <button class="segment-btn" data-mode="subject">科目別</button>
            <button class="segment-btn" data-mode="search">検索</button>
            <button class="segment-btn" data-mode="analysis">分析</button>
          </div>
          <div class="kakomon-nav-content" id="kakomon-nav-content">
            ${renderYearList()}
          </div>
        </div>
      `;

      bindNavEvents(elements);
    }
  }

  /**
   * 年度リストをレンダリング
   */
  function renderYearList() {
    return `
      <div class="kakomon-year-list">
        ${YEARS.map(year => `
          <button class="kakomon-year-item" data-year="${year}">
            <span class="year-number">第${year}回</span>
            <svg class="year-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          </button>
        `).join('')}
      </div>
    `;
  }

  /**
   * セッション選択をレンダリング
   */
  function renderSessionSelect(year) {
    return `
      <div class="kakomon-session-screen">
        <button class="kakomon-back-btn" data-back="year">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
          <span>年度選択に戻る</span>
        </button>
        <h2 class="kakomon-session-title">第${year}回</h2>
        <div class="kakomon-session-list">
          ${SESSIONS.map(session => `
            <button class="kakomon-session-item" data-session="${session}">
              <span class="session-label">${session}問題</span>
              <svg class="session-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 18l6-6-6-6"/>
              </svg>
            </button>
          `).join('')}
        </div>
      </div>
    `;
  }

  /**
   * 科目リストをレンダリング
   */
  function renderSubjectList() {
    return `
      <div class="kakomon-subject-list">
        ${SUBJECTS.map(subject => `
          <button class="kakomon-subject-item" data-subject="${subject}">
            <span class="subject-name">${subject}</span>
            <svg class="subject-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          </button>
        `).join('')}
      </div>
    `;
  }

  /**
   * 検索画面をレンダリング
   */
  function renderSearchScreen() {
    return `
      <div class="kakomon-search-screen">
        <div class="kakomon-search-bar">
          <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/>
            <path d="M21 21l-4.35-4.35"/>
          </svg>
          <input type="text" class="kakomon-search-input" placeholder="問題番号・キーワードで検索" value="${escapeHtml(state.searchQuery)}">
          <button class="search-clear-btn" style="display: ${state.searchQuery ? 'flex' : 'none'}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
        <div class="kakomon-search-hints" style="display: ${state.searchQuery ? 'none' : 'block'}">
          <div class="search-hints-title">検索のヒント</div>
          <ul class="search-hints-list">
            <li><code>118A45</code> - 特定の問題を検索</li>
            <li><code>118A</code> - 118回A問題を一覧</li>
            <li><code>歯周病</code> - キーワードで検索</li>
          </ul>
        </div>
        <div class="kakomon-search-results"></div>
      </div>
    `;
  }

  /**
   * 検索イベントをバインド
   */
  function bindSearchEvents(elements) {
    const display = elements.kakomonDisplay;
    const input = display.querySelector('.kakomon-search-input');
    const clearBtn = display.querySelector('.search-clear-btn');
    const hintsDiv = display.querySelector('.kakomon-search-hints');
    const resultsDiv = display.querySelector('.kakomon-search-results');

    if (!input) return;

    // フォーカス
    input.focus();

    // 入力イベント（デバウンス付き）
    input.addEventListener('input', () => {
      const query = input.value.trim();
      state.searchQuery = query;

      // クリアボタンの表示制御
      clearBtn.style.display = query ? 'flex' : 'none';
      hintsDiv.style.display = query ? 'none' : 'block';

      // デバウンス
      if (state.searchDebounceTimer) {
        clearTimeout(state.searchDebounceTimer);
      }

      if (!query) {
        resultsDiv.innerHTML = '';
        return;
      }

      state.searchDebounceTimer = setTimeout(async () => {
        await performSearch(query, resultsDiv, elements);
      }, 300);
    });

    // クリアボタン
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        input.value = '';
        state.searchQuery = '';
        clearBtn.style.display = 'none';
        hintsDiv.style.display = 'block';
        resultsDiv.innerHTML = '';
        input.focus();
      });
    }

    // Enterキーで即時検索
    input.addEventListener('keypress', async (e) => {
      if (e.key === 'Enter') {
        const query = input.value.trim();
        if (query) {
          if (state.searchDebounceTimer) {
            clearTimeout(state.searchDebounceTimer);
          }
          await performSearch(query, resultsDiv, elements);
        }
      }
    });
  }

  /**
   * 問題番号パターンを解析
   * @returns { type: 'exact' | 'session' | 'year', year: number, session?: string, number?: number } | null
   */
  function parseQuestionCode(query) {
    // 完全一致: 118A45, 118a45
    const exactMatch = query.match(/^(\d{3})([ABCDabcd])(\d{1,2})$/);
    if (exactMatch) {
      return {
        type: 'exact',
        year: parseInt(exactMatch[1]),
        session: exactMatch[2].toUpperCase(),
        number: parseInt(exactMatch[3])
      };
    }

    // セッション: 118A, 118a
    const sessionMatch = query.match(/^(\d{3})([ABCDabcd])$/);
    if (sessionMatch) {
      return {
        type: 'session',
        year: parseInt(sessionMatch[1]),
        session: sessionMatch[2].toUpperCase()
      };
    }

    // 年度のみ: 118
    const yearMatch = query.match(/^(\d{3})$/);
    if (yearMatch) {
      return {
        type: 'year',
        year: parseInt(yearMatch[1])
      };
    }

    return null;
  }

  /**
   * 検索を実行
   */
  async function performSearch(query, resultsDiv, elements) {
    resultsDiv.innerHTML = `
      <div class="kakomon-loading">
        <div class="loading-spinner"></div>
        <p>検索中...</p>
      </div>
    `;

    const data = await loadQuestionsData();
    if (!data || !data.questions) {
      resultsDiv.innerHTML = '<div class="kakomon-search-empty">データを読み込めませんでした</div>';
      return;
    }

    let results = [];

    // 問題番号パターンを解析
    const codePattern = parseQuestionCode(query);

    if (codePattern) {
      // 問題番号による検索
      results = searchByCode(data.questions, codePattern);
    } else {
      // キーワード検索
      results = searchByKeywordFull(data.questions, query);
    }

    // 最大50件
    const limitedResults = results.slice(0, 50);

    if (limitedResults.length === 0) {
      resultsDiv.innerHTML = `
        <div class="kakomon-search-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="11" cy="11" r="8"/>
            <path d="M21 21l-4.35-4.35"/>
          </svg>
          <p>「${escapeHtml(query)}」に一致する問題が見つかりませんでした</p>
        </div>
      `;
      return;
    }

    // 結果表示
    state.searchResults = limitedResults;
    state.currentQuestions = limitedResults.map(q => convertQuestionFormat(q));
    state.currentItem = { subject: '検索結果', searchQuery: query };

    let html = `<div class="kakomon-search-count">${results.length > 50 ? '50+' : results.length}件の結果</div>`;
    html += '<div class="kakomon-search-results-list">';

    state.currentQuestions.forEach((question, index) => {
      html += renderQuizCard(question, index, state.currentQuestions.length);
    });

    html += '</div>';

    if (state.currentQuestions.length >= 3) {
      html += renderQuickNav(state.currentQuestions.length);
    }

    resultsDiv.innerHTML = html;

    // イベントをバインド
    bindAllQuizEvents(elements);
    bindQuickNavEvents(elements);
  }

  /**
   * 問題番号で検索
   */
  function searchByCode(questions, pattern) {
    return questions.filter(q => {
      if (pattern.type === 'exact') {
        return q.year === pattern.year &&
               q.session === pattern.session &&
               q.number === pattern.number;
      } else if (pattern.type === 'session') {
        return q.year === pattern.year &&
               q.session === pattern.session;
      } else if (pattern.type === 'year') {
        return q.year === pattern.year;
      }
      return false;
    }).sort((a, b) => {
      // セッション順 → 問題番号順
      if (a.session !== b.session) {
        return a.session.localeCompare(b.session);
      }
      return a.number - b.number;
    });
  }

  /**
   * キーワードで検索（問題文、選択肢、キーワードフィールド）
   */
  function searchByKeywordFull(questions, keyword) {
    const normalizedKeyword = keyword.toLowerCase();

    return questions.filter(q => {
      // 問題文
      if (q.questionText && q.questionText.toLowerCase().includes(normalizedKeyword)) {
        return true;
      }

      // 選択肢
      if (q.choices) {
        for (const choice of Object.values(q.choices)) {
          if (choice && choice.toLowerCase().includes(normalizedKeyword)) {
            return true;
          }
        }
      }

      // キーワードフィールド（科目別JSONにある場合）
      if (q.keyword && q.keyword.toLowerCase().includes(normalizedKeyword)) {
        return true;
      }

      return false;
    }).sort((a, b) => {
      // 新しい年度順
      if (a.year !== b.year) return b.year - a.year;
      if (a.session !== b.session) return a.session.localeCompare(b.session);
      return a.number - b.number;
    });
  }

  /**
   * ナビゲーションイベントをバインド
   */
  function bindNavEvents(elements) {
    const display = elements.kakomonDisplay;

    // セグメントコントロール
    display.querySelectorAll('.segment-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        display.querySelectorAll('.segment-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const mode = btn.dataset.mode;
        const navContent = display.querySelector('#kakomon-nav-content');
        state.currentSegment = mode; // セグメントを記憶

        if (mode === 'year') {
          navContent.innerHTML = renderYearList();
          bindYearEvents(elements);
        } else if (mode === 'subject') {
          navContent.innerHTML = renderSubjectList();
          bindSubjectEvents(elements);
        } else if (mode === 'search') {
          navContent.innerHTML = renderSearchScreen();
          bindSearchEvents(elements);
        } else if (mode === 'analysis') {
          navContent.innerHTML = '<div id="weakness-analysis-container" class="weakness-analysis-container"></div>';
          if (typeof WeaknessModule !== 'undefined') {
            const container = navContent.querySelector('#weakness-analysis-container');
            WeaknessModule.renderAnalysisView(container);
          }
        }
      });
    });

    // 年度イベントをバインド
    bindYearEvents(elements);
  }

  /**
   * 年度選択イベントをバインド
   */
  function bindYearEvents(elements) {
    const display = elements.kakomonDisplay;

    display.querySelectorAll('.kakomon-year-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const year = parseInt(btn.dataset.year);
        state.selectedYear = year;
        state.viewMode = 'year';

        const navContent = display.querySelector('#kakomon-nav-content');
        navContent.innerHTML = renderSessionSelect(year);
        bindSessionEvents(elements);
      });
    });
  }

  /**
   * セッション選択イベントをバインド
   */
  function bindSessionEvents(elements) {
    const display = elements.kakomonDisplay;

    // 戻るボタン
    const backBtn = display.querySelector('.kakomon-back-btn');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        const navContent = display.querySelector('#kakomon-nav-content');
        navContent.innerHTML = renderYearList();
        bindYearEvents(elements);
        state.viewMode = 'select';
      });
    }

    // セッション選択
    display.querySelectorAll('.kakomon-session-item').forEach(btn => {
      btn.addEventListener('click', async () => {
        const session = btn.dataset.session;
        state.selectedSession = session;
        state.viewMode = 'questions';

        await loadYearSessionQuestions(state.selectedYear, session, elements);
      });
    });
  }

  /**
   * 科目選択イベントをバインド
   */
  function bindSubjectEvents(elements) {
    const display = elements.kakomonDisplay;

    display.querySelectorAll('.kakomon-subject-item').forEach(btn => {
      btn.addEventListener('click', async () => {
        const subject = btn.dataset.subject;
        state.selectedSubject = subject;
        state.viewMode = 'questions';

        await loadSubjectQuestions(subject, elements);
      });
    });
  }

  /**
   * 年度・セッション別に問題を読み込み
   */
  async function loadYearSessionQuestions(year, session, elements) {
    // ローディング表示
    const display = elements.kakomonDisplay;
    display.innerHTML = `
      <div class="kakomon-loading">
        <div class="loading-spinner"></div>
        <p>読み込み中...</p>
      </div>
    `;

    const data = await loadQuestionsData();
    if (!data || !data.questions) {
      display.innerHTML = `<div class="kakomon-error">データを読み込めませんでした</div>`;
      return;
    }

    // 年度とセッションでフィルタリング
    const filtered = data.questions.filter(q => q.year === year && q.session === session);

    if (filtered.length === 0) {
      display.innerHTML = `<div class="kakomon-error">この回の${session}問題はありません</div>`;
      return;
    }

    // 問題番号でソート
    filtered.sort((a, b) => a.number - b.number);

    // 状態を更新
    state.currentQuestions = filtered.map(q => convertQuestionFormat(q));
    state.currentItem = { subject: `${year}${session}`, year, session };

    // 問題一覧を表示
    renderQuestionsWithHeader(elements, `第${year}回 ${session}問題`);
  }

  /**
   * 科目別に問題を読み込み
   */
  async function loadSubjectQuestions(subject, elements) {
    const display = elements.kakomonDisplay;
    display.innerHTML = `
      <div class="kakomon-loading">
        <div class="loading-spinner"></div>
        <p>読み込み中...</p>
      </div>
    `;

    const subjectData = await loadSubjectData(subject);
    if (!subjectData || !subjectData.questions) {
      display.innerHTML = `<div class="kakomon-error">この科目のデータがありません</div>`;
      return;
    }

    // 年度でソート（新しい順）
    const sorted = [...subjectData.questions].sort((a, b) => {
      const yearA = a.examNum || parseInt(a.code);
      const yearB = b.examNum || parseInt(b.code);
      return yearB - yearA;
    });

    state.currentQuestions = sorted;
    state.currentItem = { subject };

    renderQuestionsWithHeader(elements, subject);
  }

  /**
   * questions.jsonのフォーマットをkakomon形式に変換
   */
  function convertQuestionFormat(q) {
    // 画像パスからファイル名だけを抽出
    let imageFiles = '';
    if (q.images && q.images.length > 0) {
      imageFiles = q.images.map(path => path.split('/').pop()).join(',');
    }
    return {
      code: q.id,
      examNum: q.year,
      section: q.session,
      questionNum: q.number,
      text: q.questionText,
      choices: q.choices,
      answer: q.answer,
      numChoices: q.choiceCount || 1,
      hasImage: q.hasFigure,
      imageFiles: imageFiles
    };
  }

  /**
   * ヘッダー付きで問題一覧を表示
   */
  function renderQuestionsWithHeader(elements, title) {
    const total = state.currentQuestions.length;
    const display = elements.kakomonDisplay;

    let html = `
      <div class="kakomon-questions-screen">
        <div class="kakomon-questions-header">
          <button class="kakomon-back-btn" data-back="nav">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
            <span>戻る</span>
          </button>
          <h2 class="kakomon-questions-title">${escapeHtml(title)}</h2>
          <span class="kakomon-questions-count">${total}問</span>
        </div>
        <div class="kakomon-questions-list">
    `;

    state.currentQuestions.forEach((question, index) => {
      html += renderQuizCard(question, index, total);
    });

    if (total >= 3) {
      html += renderQuickNav(total);
    }

    html += `
        </div>
      </div>
    `;

    display.innerHTML = html;

    // イベントをバインド
    bindQuestionsBackBtn(elements);
    bindAllQuizEvents(elements);
    bindQuickNavEvents(elements);
  }

  /**
   * 問題画面の戻るボタンイベントをバインド
   */
  function bindQuestionsBackBtn(elements) {
    const display = elements.kakomonDisplay;
    const backBtn = display.querySelector('.kakomon-back-btn');

    if (backBtn) {
      backBtn.addEventListener('click', () => {
        // 現在のセグメントに応じた画面に戻る
        returnToSegment(elements, state.currentSegment);
      });
    }
  }

  /**
   * 指定されたセグメントの画面に戻る
   */
  function returnToSegment(elements, segment) {
    state.viewMode = 'select';
    state.selectedYear = null;
    state.selectedSession = null;
    state.selectedSubject = null;

    if (elements.kakomonPlaceholder) {
      elements.kakomonPlaceholder.style.display = 'none';
    }

    if (elements.kakomonDisplay) {
      elements.kakomonDisplay.style.display = 'block';
      elements.kakomonDisplay.innerHTML = `
        <div class="kakomon-nav-screen">
          <div class="kakomon-segment-control">
            <button class="segment-btn ${segment === 'year' ? 'active' : ''}" data-mode="year">年度別</button>
            <button class="segment-btn ${segment === 'subject' ? 'active' : ''}" data-mode="subject">科目別</button>
            <button class="segment-btn ${segment === 'search' ? 'active' : ''}" data-mode="search">検索</button>
          </div>
          <div class="kakomon-nav-content" id="kakomon-nav-content">
            ${segment === 'year' ? renderYearList() :
              segment === 'subject' ? renderSubjectList() :
              renderSearchScreen()}
          </div>
        </div>
      `;

      bindNavEvents(elements);

      // セグメントに応じたイベントをバインド
      if (segment === 'year') {
        bindYearEvents(elements);
      } else if (segment === 'subject') {
        bindSubjectEvents(elements);
      } else if (segment === 'search') {
        bindSearchEvents(elements);
      }
    }
  }

  /**
   * 従来のトピックベースの過去問読み込み
   */
  async function loadKakomon(item, elements) {
    const subject = item.subject;
    const keyword = item.title;

    if (elements.kakomonPlaceholder) {
      elements.kakomonPlaceholder.style.display = 'flex';
      elements.kakomonPlaceholder.querySelector('p').textContent = '読み込み中...';
    }
    if (elements.kakomonDisplay) {
      elements.kakomonDisplay.style.display = 'none';
    }
    if (elements.kakomonToolbar) {
      elements.kakomonToolbar.style.display = 'none';
    }

    const subjectData = await loadSubjectData(subject);
    if (!subjectData) {
      showPlaceholder(elements, 'この科目の過去問データがありません');
      return;
    }

    const filtered = filterByKeyword(subjectData.questions, keyword);

    if (filtered.length === 0) {
      showPlaceholder(elements, 'このトピックに該当する過去問がありません');
      return;
    }

    state.currentQuestions = filtered;
    state.currentItem = item;

    renderAllQuestions(elements);
  }

  /**
   * プレースホルダーを表示
   */
  function showPlaceholder(elements, message) {
    if (elements.kakomonPlaceholder) {
      elements.kakomonPlaceholder.style.display = 'flex';
      elements.kakomonPlaceholder.querySelector('p').textContent = message;
    }
    if (elements.kakomonDisplay) {
      elements.kakomonDisplay.style.display = 'none';
    }
    if (elements.kakomonToolbar) {
      elements.kakomonToolbar.style.display = 'none';
    }
  }

  /**
   * 全問を一覧表示（従来形式）
   */
  function renderAllQuestions(elements) {
    const total = state.currentQuestions.length;

    if (elements.kakomonPlaceholder) {
      elements.kakomonPlaceholder.style.display = 'none';
    }

    if (elements.kakomonDisplay) {
      elements.kakomonDisplay.style.display = 'block';

      let html = `<div class="kakomon-list-header">${total}問</div>`;

      state.currentQuestions.forEach((question, index) => {
        html += renderQuizCard(question, index, total);
      });

      if (total >= 3) {
        html += renderQuickNav(total);
      }

      elements.kakomonDisplay.innerHTML = html;

      bindAllQuizEvents(elements);
      bindQuickNavEvents(elements);
    }
  }

  /**
   * クイックナビHTMLを生成
   */
  function renderQuickNav(total) {
    const navNumbers = [1];

    for (let i = 5; i <= total; i += 5) {
      navNumbers.push(i);
    }

    if (total % 5 !== 0 && total > 1) {
      navNumbers.push(total);
    }

    return `
      <div class="kakomon-quick-nav">
        ${navNumbers.map(num => `
          <button class="quick-nav-item" data-target="${num - 1}">${num}</button>
        `).join('')}
      </div>
    `;
  }

  /**
   * クイックナビのイベントをバインド
   */
  function bindQuickNavEvents(elements) {
    const display = elements.kakomonDisplay;
    const quickNav = display.querySelector('.kakomon-quick-nav');
    if (!quickNav) return;

    const kakomonContent = elements.kakomonContent;

    quickNav.querySelectorAll('.quick-nav-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetIndex = parseInt(btn.dataset.target);
        const targetCard = display.querySelector(`.kakomon-card[data-index="${targetIndex}"]`);
        if (targetCard) {
          targetCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });

    let scrollTimer;
    kakomonContent.addEventListener('scroll', () => {
      quickNav.classList.add('show');
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        quickNav.classList.remove('show');
      }, 1500);
    }, { passive: true });
  }

  /**
   * クイズカードHTMLを生成
   */
  function renderQuizCard(question, index, total) {
    const choices = question.choices || {};
    const numChoices = question.numChoices || 1;
    const code = question.code || question.id || '';

    let validChoices = Object.entries(choices)
      .filter(([key, value]) => value && value.trim() !== '');

    // 画像参照型（選択肢テキストが空）の場合、a〜eのボタンを生成
    if (validChoices.length === 0 && Object.keys(choices).length === 0) {
      validChoices = ['a','b','c','d','e'].map(k => [k, k]);
    }

    let imagesHtml = '';
    const hasImage = question.hasImage && question.imageFiles;
    if (hasImage) {
      const examNum = question.examNum || code.match(/^\d+/)?.[0];
      const imageList = question.imageFiles.split(',').map(f => f.trim()).filter(f => f);
      if (imageList.length > 0 && examNum) {
        imagesHtml = `
          <div class="kakomon-images">
            ${imageList.map((file, idx) => `
              <div class="kakomon-image-wrapper" data-image-index="${idx}">
                <img src="${encodeURI(`images/${examNum}回_Web画像/${file}`)}" alt="${file}">
                <svg class="image-annotations" style="display:none;"></svg>
              </div>
            `).join('')}
          </div>
        `;
      }
    }

    const choicesJson = JSON.stringify(Object.fromEntries(validChoices));

    let imagePathsJson = '[]';
    if (question.hasImage && question.imageFiles) {
      const examNum = question.examNum || code.match(/^\d+/)?.[0];
      const imageList = question.imageFiles.split(',').map(f => f.trim()).filter(f => f);
      if (imageList.length > 0 && examNum) {
        const paths = imageList.map(file => encodeURI(`images/${examNum}回_Web画像/${file}`));
        imagePathsJson = JSON.stringify(paths);
      }
    }

    const questionText = question.text || question.questionText || '';

    return `
      <div class="kakomon-card" data-index="${index}" data-answer="${escapeHtml(question.answer)}" data-num="${numChoices}" data-answered="false" data-code="${escapeHtml(code)}" data-text="${escapeHtml(questionText)}" data-choices='${choicesJson.replace(/'/g, "&#39;")}' data-images='${imagePathsJson}'>
        <div class="kakomon-header">
          <span class="kakomon-code">${escapeHtml(code)}</span>
        </div>

        <div class="kakomon-question">
          <p class="kakomon-text">${escapeHtml(questionText)}</p>
        </div>

        ${imagesHtml}

        <div class="kakomon-instruction">
          ${numChoices > 1 ? `${numChoices}つ選べ。` : '1つ選べ。'}
        </div>

        <div class="kakomon-choices">
          ${validChoices.map(([key, value]) => {
            const cleanText = value
              .replace(/[：:]\s*○/g, '')
              .replace(/○/g, '')
              .trim();
            return `
            <button class="kakomon-choice" data-choice="${key}">
              <span class="choice-label">${key}</span>
              <span class="choice-text">${escapeHtml(cleanText)}</span>
            </button>
          `}).join('')}
        </div>

        <button class="kakomon-submit" disabled>解答</button>

        <div class="kakomon-result" style="display:none;">
          <div class="result-answer">正解: ${formatAnswer(question.answer)}</div>
          <div class="result-message"></div>
        </div>

        <div class="kakomon-explanation" style="display:none;">
          <button class="show-explanation-btn">解説を見る</button>
          <div class="integrated-explanation-container" style="display:none;"></div>
          <div class="image-explanation-container" style="display:none;"></div>
          <div class="conversation-container"></div>
        </div>

        <div class="related-topics-container" style="display:none;"></div>
      </div>
    `;
  }

  /**
   * 正解をフォーマット
   */
  function formatAnswer(answer) {
    if (!answer) return '';
    return answer.toLowerCase().split('').join(', ');
  }

  /**
   * 画像モーダルを表示
   */
  function showImageModal(imageSrc, allImages, currentIndex) {
    // 既存のモーダルがあれば削除
    const existingModal = document.getElementById('kakomon-image-modal');
    if (existingModal) {
      existingModal.remove();
    }

    let modalIndex = currentIndex;

    const modal = document.createElement('div');
    modal.id = 'kakomon-image-modal';
    modal.className = 'kakomon-image-modal';
    modal.innerHTML = `
      <div class="image-modal-backdrop"></div>
      <div class="image-modal-content">
        <button class="image-modal-close" aria-label="閉じる">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
        ${allImages.length > 1 ? `
          <button class="image-modal-nav prev" aria-label="前へ">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M15 18l-6-6 6-6"/>
            </svg>
          </button>
          <button class="image-modal-nav next" aria-label="次へ">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          </button>
        ` : ''}
        <div class="image-modal-img-wrapper">
          <img src="${imageSrc}" alt="拡大画像" class="image-modal-img">
        </div>
        ${allImages.length > 1 ? `
          <div class="image-modal-counter">${currentIndex + 1} / ${allImages.length}</div>
        ` : ''}
      </div>
    `;

    document.body.appendChild(modal);

    // アニメーション用
    requestAnimationFrame(() => {
      modal.classList.add('active');
    });

    const img = modal.querySelector('.image-modal-img');
    const counter = modal.querySelector('.image-modal-counter');

    // 画像切り替え関数
    function updateImage(newIndex) {
      if (newIndex < 0) newIndex = allImages.length - 1;
      if (newIndex >= allImages.length) newIndex = 0;
      modalIndex = newIndex;
      img.src = allImages[modalIndex];
      if (counter) {
        counter.textContent = `${modalIndex + 1} / ${allImages.length}`;
      }
    }

    // 閉じる
    const closeModal = () => {
      modal.classList.remove('active');
      setTimeout(() => modal.remove(), 200);
    };

    // 背景クリックで閉じる（画像やボタン以外をクリックした場合）
    modal.querySelector('.image-modal-content').addEventListener('click', (e) => {
      // クリックされた要素が画像やボタンでなければ閉じる
      if (e.target.closest('.image-modal-img-wrapper') ||
          e.target.closest('.image-modal-close') ||
          e.target.closest('.image-modal-nav') ||
          e.target.closest('.image-modal-counter')) {
        return;
      }
      closeModal();
    });
    modal.querySelector('.image-modal-close').addEventListener('click', closeModal);

    // ナビゲーション
    const prevBtn = modal.querySelector('.image-modal-nav.prev');
    const nextBtn = modal.querySelector('.image-modal-nav.next');
    if (prevBtn) prevBtn.addEventListener('click', () => updateImage(modalIndex - 1));
    if (nextBtn) nextBtn.addEventListener('click', () => updateImage(modalIndex + 1));

    // キーボード操作
    const handleKeydown = (e) => {
      if (e.key === 'Escape') closeModal();
      if (e.key === 'ArrowLeft' && allImages.length > 1) updateImage(modalIndex - 1);
      if (e.key === 'ArrowRight' && allImages.length > 1) updateImage(modalIndex + 1);
    };
    document.addEventListener('keydown', handleKeydown);

    // モーダルが閉じられたらイベントリスナーを削除
    const observer = new MutationObserver(() => {
      if (!document.getElementById('kakomon-image-modal')) {
        document.removeEventListener('keydown', handleKeydown);
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true });

    // ピンチズーム・パン・スワイプ対応
    let scale = 1;
    let translateX = 0;
    let translateY = 0;
    let initialDistance = 0;
    let initialScale = 1;
    let touchStartX = 0;
    let touchStartY = 0;
    let lastTap = 0;
    let isPinching = false;
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let initialTranslateX = 0;
    let initialTranslateY = 0;

    const imgWrapper = modal.querySelector('.image-modal-img-wrapper');

    function applyTransform() {
      img.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
    }

    function resetTransform() {
      scale = 1;
      translateX = 0;
      translateY = 0;
      img.style.transition = 'transform 0.2s ease';
      applyTransform();
      setTimeout(() => { img.style.transition = ''; }, 200);
    }

    function getDistance(touches) {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }

    // ダブルタップでズーム
    imgWrapper.addEventListener('click', (e) => {
      const now = Date.now();
      if (now - lastTap < 300) {
        // ダブルタップ
        if (scale > 1) {
          resetTransform();
        } else {
          scale = 2.5;
          img.style.transition = 'transform 0.2s ease';
          applyTransform();
          setTimeout(() => { img.style.transition = ''; }, 200);
        }
      }
      lastTap = now;
    });

    imgWrapper.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        // ピンチ開始
        isPinching = true;
        initialDistance = getDistance(e.touches);
        initialScale = scale;
      } else if (e.touches.length === 1) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        if (scale > 1) {
          // ドラッグ開始
          isDragging = true;
          dragStartX = e.touches[0].clientX;
          dragStartY = e.touches[0].clientY;
          initialTranslateX = translateX;
          initialTranslateY = translateY;
        }
      }
    }, { passive: true });

    imgWrapper.addEventListener('touchmove', (e) => {
      if (isPinching && e.touches.length === 2) {
        // ピンチズーム中
        const currentDistance = getDistance(e.touches);
        const newScale = initialScale * (currentDistance / initialDistance);
        scale = Math.min(Math.max(newScale, 0.5), 5); // 0.5〜5倍
        applyTransform();
      } else if (isDragging && e.touches.length === 1 && scale > 1) {
        // パン中
        const dx = e.touches[0].clientX - dragStartX;
        const dy = e.touches[0].clientY - dragStartY;
        translateX = initialTranslateX + dx;
        translateY = initialTranslateY + dy;
        applyTransform();
      }
    }, { passive: true });

    imgWrapper.addEventListener('touchend', (e) => {
      if (isPinching) {
        isPinching = false;
        if (scale < 1) {
          resetTransform();
        }
      } else if (isDragging) {
        isDragging = false;
      } else if (e.changedTouches.length === 1 && scale === 1 && allImages.length > 1) {
        // スワイプで画像切り替え（等倍時のみ）
        const touchEndX = e.changedTouches[0].clientX;
        const touchEndY = e.changedTouches[0].clientY;
        const diffX = touchStartX - touchEndX;
        const diffY = Math.abs(touchStartY - touchEndY);
        if (Math.abs(diffX) > 50 && diffY < 100) {
          if (diffX > 0) updateImage(modalIndex + 1);
          else updateImage(modalIndex - 1);
        }
      }
    }, { passive: true });

    // 画像切り替え時にズームリセット
    const originalUpdateImage = updateImage;
    updateImage = function(newIndex) {
      resetTransform();
      originalUpdateImage(newIndex);
    };
  }

  /**
   * 全カードにイベントをバインド
   */
  function bindAllQuizEvents(elements) {
    const display = elements.kakomonDisplay;

    bindKakomonFavoriteButtons(display);

    // 画像クリックイベントをバインド
    display.querySelectorAll('.kakomon-card').forEach(card => {
      const imageWrappers = card.querySelectorAll('.kakomon-image-wrapper');
      if (imageWrappers.length > 0) {
        const images = Array.from(imageWrappers).map(wrapper => {
          const img = wrapper.querySelector('img');
          return img ? img.src : null;
        }).filter(src => src);

        imageWrappers.forEach((wrapper, index) => {
          wrapper.style.cursor = 'zoom-in';
          wrapper.addEventListener('click', (e) => {
            e.stopPropagation();
            showImageModal(images[index], images, index);
          });
        });
      }
    });

    display.querySelectorAll('.kakomon-card').forEach(card => {
      const numChoices = parseInt(card.dataset.num) || 1;
      let selectedChoices = new Set();

      card.querySelectorAll('.kakomon-choice').forEach(btn => {
        btn.addEventListener('click', () => {
          if (card.dataset.answered === 'true') return;

          const choiceKey = btn.dataset.choice;

          if (selectedChoices.has(choiceKey)) {
            selectedChoices.delete(choiceKey);
            btn.classList.remove('selected');
          } else {
            if (numChoices === 1) {
              card.querySelectorAll('.kakomon-choice').forEach(b => {
                b.classList.remove('selected');
              });
              selectedChoices.clear();
            }
            selectedChoices.add(choiceKey);
            btn.classList.add('selected');
          }

          const submitBtn = card.querySelector('.kakomon-submit');
          if (submitBtn) {
            submitBtn.disabled = selectedChoices.size !== numChoices;
          }
        });
      });

      const submitBtn = card.querySelector('.kakomon-submit');
      if (submitBtn) {
        submitBtn.addEventListener('click', () => {
          if (card.dataset.answered === 'true') return;

          const correctAnswer = card.dataset.answer;
          checkAnswer(card, correctAnswer, selectedChoices);
          submitBtn.style.display = 'none';
        });
      }
    });
  }

  /**
   * 答え合わせ
   */
  function checkAnswer(card, correctAnswer, selectedChoices) {
    card.dataset.answered = 'true';

    const selectedKeys = Array.from(selectedChoices)
      .map(k => k.toUpperCase())
      .sort()
      .join('');

    const sortedCorrect = correctAnswer.toUpperCase().split('').sort().join('');
    const isCorrect = selectedKeys === sortedCorrect;

    card.querySelectorAll('.kakomon-choice').forEach(btn => {
      btn.disabled = true;
      const key = btn.dataset.choice.toUpperCase();

      if (correctAnswer.toUpperCase().includes(key)) {
        btn.classList.add('correct');
      } else if (btn.classList.contains('selected')) {
        btn.classList.add('incorrect');
      }
    });

    const resultDiv = card.querySelector('.kakomon-result');
    const messageDiv = resultDiv.querySelector('.result-message');

    messageDiv.textContent = isCorrect ? '正解！' : '不正解';
    messageDiv.className = 'result-message ' + (isCorrect ? 'correct' : 'incorrect');
    resultDiv.style.display = 'block';

    // 解説ボタンを表示
    const explanationDiv = card.querySelector('.kakomon-explanation');
    if (explanationDiv) {
      explanationDiv.style.display = 'block';
      bindExplanationBtn(card);
    }

    // 解答履歴を保存
    const code = card.dataset.code;
    if (code && typeof WeaknessModule !== 'undefined') {
      WeaknessModule.saveAnswer(code, selectedKeys, isCorrect);
    }

    // 関連トピックを表示
    showRelatedTopics(card);
  }

  /**
   * 関連トピックを非同期で表示
   */
  async function showRelatedTopics(card) {
    const code = card.dataset.code;
    if (!code) return;

    const topicMap = await loadQuestionTopicMap();
    if (!topicMap) return;

    const mapping = topicMap[code];
    if (!mapping) return;

    // 単一エントリかリストかを正規化
    const entries = Array.isArray(mapping) ? mapping : [mapping];

    const html = renderRelatedTopics(entries);
    if (!html) return;

    const container = card.querySelector('.related-topics-container');
    if (container) {
      container.innerHTML = html;
      container.style.display = 'block';
      bindRelatedTopicLinks(container);
    }
  }

  /**
   * 解説ボタンのイベントをバインド
   */
  function bindExplanationBtn(card) {
    const btn = card.querySelector('.show-explanation-btn');
    const container = card.querySelector('.conversation-container');
    const imageContainer = card.querySelector('.image-explanation-container');
    const integratedContainer = card.querySelector('.integrated-explanation-container');

    if (btn && container) {
      btn.addEventListener('click', async () => {
        btn.textContent = '読み込み中...';
        btn.disabled = true;

        const code = card.dataset.code;
        const year = parseInt(code.match(/^\d+/)?.[0]) || 0;
        const answer = (card.dataset.answer || '').toLowerCase();

        let hasAnyExplanation = false;

        // 思考プロセス型解説を読み込み（最優先で表示）
        const thinkingData = await loadThinkingExplanations();
        const thinking = thinkingData?.[code];

        if (thinking) {
          const thinkingHtml = renderThinkingExplanation(thinking);
          if (thinkingHtml) {
            // integratedContainerの前に挿入
            const thinkingDiv = document.createElement('div');
            thinkingDiv.className = 'thinking-explanation-container';
            thinkingDiv.innerHTML = thinkingHtml;
            integratedContainer.parentNode.insertBefore(thinkingDiv, integratedContainer);
            hasAnyExplanation = true;
          }
        }

        // 統合解説を読み込み（アプローチ・画像診断・選択肢解説）
        const integratedData = await loadIntegratedExplanations();
        const integrated = integratedData?.[code];

        if (integrated && integratedContainer) {
          const integratedHtml = renderIntegratedExplanation(integrated, answer);
          if (integratedHtml) {
            integratedContainer.innerHTML = integratedHtml;
            integratedContainer.style.display = 'block';
            hasAnyExplanation = true;
          }
        }

        // 画像解説を読み込み
        const imageExplanations = await loadImageExplanations(year);
        const imageExplanation = imageExplanations?.[code];

        if (imageExplanation && imageContainer) {
          imageContainer.innerHTML = renderImageExplanation(imageExplanation);
          imageContainer.style.display = 'block';
          applyAnnotations(card, imageExplanation.annotations);
          bindAnnotationToggle(card);
          hasAnyExplanation = true;
        }

        // 会話解説を読み込み
        const explanations = await loadExplanations(year);
        const explanation = explanations?.[code];

        if (explanation && explanation.conversation) {
          container.innerHTML = renderConversation(explanation);
          animateConversation(container);
          hasAnyExplanation = true;
        }

        if (!hasAnyExplanation) {
          container.innerHTML = `
            <div class="no-explanation">
              <p>この問題の解説は準備中です</p>
            </div>
          `;
        }

        btn.style.display = 'none';
      });
    }
  }

  /**
   * 統合解説をレンダリング（アプローチ・画像診断・選択肢解説）
   */
  function renderIntegratedExplanation(integrated, answer) {
    if (!integrated) return '';

    let html = '<div class="integrated-explanation">';
    let hasContent = false;

    // アプローチ
    if (integrated.approach && integrated.approach.trim()) {
      hasContent = true;
      html += `
        <div class="integrated-section approach-section">
          <div class="integrated-section-title">
            <span class="section-icon">📝</span>
            <span>アプローチ</span>
          </div>
          <div class="integrated-section-content approach-content">
            ${escapeHtml(integrated.approach)}
          </div>
        </div>
      `;
    }

    // 画像診断
    if (integrated.image_diagnosis && Object.keys(integrated.image_diagnosis).length > 0) {
      const diagEntries = Object.entries(integrated.image_diagnosis)
        .filter(([_, text]) => text && text.trim());

      if (diagEntries.length > 0) {
        hasContent = true;
        html += `
          <div class="integrated-section image-diagnosis-section">
            <div class="integrated-section-title">
              <span class="section-icon">🔍</span>
              <span>画像診断</span>
            </div>
            <div class="integrated-section-content">
              ${diagEntries.map(([label, text]) => `
                <div class="image-diagnosis-item">
                  <span class="image-diagnosis-label">${escapeHtml(label)}:</span>
                  <span class="image-diagnosis-text">${escapeHtml(text)}</span>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      }
    }

    // 選択肢解説
    if (integrated.choices && Object.keys(integrated.choices).length > 0) {
      const choiceEntries = Object.entries(integrated.choices)
        .filter(([_, text]) => text && text.trim())
        .sort(([a], [b]) => a.localeCompare(b));

      if (choiceEntries.length > 0) {
        hasContent = true;
        html += `
          <div class="integrated-section choices-section">
            <div class="integrated-section-title">
              <span class="section-icon">📋</span>
              <span>選択肢解説</span>
            </div>
            <div class="integrated-section-content">
              ${choiceEntries.map(([key, text]) => {
                const cleanKey = key.toLowerCase().trim();
                const isCorrect = answer.includes(cleanKey);
                return `
                  <div class="choice-explanation-item ${isCorrect ? 'correct' : 'incorrect'}">
                    <span class="choice-exp-marker">${isCorrect ? '○' : '×'}</span>
                    <span class="choice-exp-key">${cleanKey}</span>
                    <span class="choice-exp-text">${escapeHtml(text)}</span>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `;
      }
    }

    html += '</div>';

    return hasContent ? html : '';
  }

  /**
   * 画像解説をレンダリング
   */
  function renderImageExplanation(imgExp) {
    const typeLabel = IMAGE_TYPE_LABELS[imgExp.imageType] || imgExp.imageType;

    let html = `
      <div class="image-explanation">
        <div class="image-exp-header">
          <span class="image-type-badge">${escapeHtml(typeLabel)}</span>
          <button class="annotation-toggle-btn active" title="アノテーション表示切替">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 8v4M12 16h.01"/>
            </svg>
          </button>
        </div>
    `;

    // 所見
    if (imgExp.findings && imgExp.findings.length > 0) {
      html += `
        <div class="image-findings">
          <div class="findings-title">画像所見</div>
          <ul class="findings-list">
            ${imgExp.findings.map(f => `
              <li>
                <span class="finding-location">${escapeHtml(f.location)}</span>
                <span class="finding-observation">${escapeHtml(f.observation)}</span>
                ${f.significance ? `<span class="finding-significance">${escapeHtml(f.significance)}</span>` : ''}
              </li>
            `).join('')}
          </ul>
        </div>
      `;
    }

    // 読影ガイド
    if (imgExp.readingGuide && imgExp.readingGuide.length > 0) {
      html += `
        <div class="reading-guide">
          <div class="guide-title">読影の手順</div>
          <ol class="guide-steps">
            ${imgExp.readingGuide.map(step => `<li>${escapeHtml(step)}</li>`).join('')}
          </ol>
        </div>
      `;
    }

    // キーポイント
    if (imgExp.keyFeatures && imgExp.keyFeatures.length > 0) {
      html += `
        <div class="image-key-features">
          <div class="features-title">注目ポイント</div>
          <div class="features-tags">
            ${imgExp.keyFeatures.map(f => `<span class="feature-tag">${escapeHtml(f)}</span>`).join('')}
          </div>
        </div>
      `;
    }

    html += '</div>';
    return html;
  }

  /**
   * SVGアノテーションを画像に適用
   */
  function applyAnnotations(card, annotations) {
    if (!annotations || annotations.length === 0) return;

    const imageWrappers = card.querySelectorAll('.kakomon-image-wrapper');
    if (imageWrappers.length === 0) return;

    // 画像ごとにアノテーションをグループ化
    const annotationsByImage = {};
    annotations.forEach(ann => {
      const imgIdx = ann.imageIndex || 0;
      if (!annotationsByImage[imgIdx]) {
        annotationsByImage[imgIdx] = [];
      }
      annotationsByImage[imgIdx].push(ann);
    });

    // 各画像にアノテーションを適用
    Object.keys(annotationsByImage).forEach(imgIdxStr => {
      const imgIdx = parseInt(imgIdxStr);
      const wrapper = imageWrappers[imgIdx];
      if (!wrapper) return;

      const svg = wrapper.querySelector('.image-annotations');
      if (!svg) return;

      svg.style.display = 'block';

      let svgContent = '';
      annotationsByImage[imgIdx].forEach((ann, idx) => {
        const x = ann.position.x;
        const y = ann.position.y;
        const color = ann.color || '#FF6B6B';
        const label = ann.label || '';
        const uniqueId = `${imgIdx}-${idx}`;

        if (ann.type === 'arrow') {
          svgContent += `
            <g class="annotation-group" data-index="${uniqueId}">
              <line x1="${x}%" y1="${y - 8}%" x2="${x}%" y2="${y}%"
                    stroke="${color}" stroke-width="2" marker-end="url(#arrowhead-${uniqueId})"/>
              <defs>
                <marker id="arrowhead-${uniqueId}" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                  <polygon points="0 0, 10 3.5, 0 7" fill="${color}"/>
                </marker>
              </defs>
              <text x="${x}%" y="${y - 10}%" fill="${color}" font-size="11" text-anchor="middle" class="annotation-label">${escapeHtml(label)}</text>
            </g>
          `;
        } else if (ann.type === 'circle') {
          svgContent += `
            <g class="annotation-group" data-index="${uniqueId}">
              <circle cx="${x}%" cy="${y}%" r="15" stroke="${color}" stroke-width="2" fill="none"/>
              <text x="${x}%" y="${y + 8}%" fill="${color}" font-size="11" text-anchor="middle" class="annotation-label">${escapeHtml(label)}</text>
            </g>
          `;
        } else if (ann.type === 'line') {
          svgContent += `
            <g class="annotation-group" data-index="${uniqueId}">
              <line x1="${x - 5}%" y1="${y}%" x2="${x + 5}%" y2="${y}%" stroke="${color}" stroke-width="2"/>
              <text x="${x}%" y="${y - 3}%" fill="${color}" font-size="11" text-anchor="middle" class="annotation-label">${escapeHtml(label)}</text>
            </g>
          `;
        }
      });

      svg.innerHTML = svgContent;
    });
  }

  /**
   * アノテーション表示切替をバインド
   */
  function bindAnnotationToggle(card) {
    const toggleBtn = card.querySelector('.annotation-toggle-btn');
    if (!toggleBtn) return;

    toggleBtn.addEventListener('click', () => {
      const svgs = card.querySelectorAll('.image-annotations');
      const isActive = toggleBtn.classList.toggle('active');

      svgs.forEach(svg => {
        svg.style.display = isActive ? 'block' : 'none';
      });
    });
  }

  /**
   * 会話形式の解説をレンダリング
   */
  function renderConversation(explanation) {
    const { conversation, keyPoints, relatedTopics } = explanation;

    // 問題ごとにランダムな生徒アイコンを選択（1, 2, 3のいずれか）
    const studentIconNum = Math.floor(Math.random() * 3) + 1;
    const teacherIcon = 'images/icons/teacher.jpg';
    const studentIcon = `images/icons/student${studentIconNum}.png`;

    let html = '<div class="conversation-messages">';

    conversation.forEach((msg, index) => {
      const isTeacher = msg.speaker === 'teacher';
      const iconSrc = isTeacher ? teacherIcon : studentIcon;
      html += `
        <div class="chat-bubble ${isTeacher ? 'teacher' : 'student'}" style="opacity: 0; transform: translateY(10px);">
          <div class="chat-avatar"><img src="${iconSrc}" alt="${isTeacher ? '先生' : '生徒'}" class="avatar-icon"></div>
          <div class="chat-content">
            <div class="chat-text">${escapeHtml(msg.text)}</div>
          </div>
        </div>
      `;
    });

    html += '</div>';

    if (keyPoints && keyPoints.length > 0) {
      html += `
        <div class="key-points">
          <div class="key-points-title">ポイント</div>
          <ul class="key-points-list">
            ${keyPoints.map(point => `<li>${escapeHtml(point)}</li>`).join('')}
          </ul>
        </div>
      `;
    }

    if (relatedTopics && relatedTopics.length > 0) {
      html += `
        <div class="related-topics">
          <div class="related-topics-title">関連トピック</div>
          <div class="related-topics-tags">
            ${relatedTopics.map(topic => `<span class="topic-tag">${escapeHtml(topic)}</span>`).join('')}
          </div>
        </div>
      `;
    }

    return html;
  }

  /**
   * 会話をアニメーション表示
   */
  function animateConversation(container) {
    const bubbles = container.querySelectorAll('.chat-bubble');
    bubbles.forEach((bubble, index) => {
      setTimeout(() => {
        bubble.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
        bubble.style.opacity = '1';
        bubble.style.transform = 'translateY(0)';
      }, index * 300);
    });
  }

  /**
   * HTMLエスケープ
   */
  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * 過去問カードのお気に入りボタンと画像保存ボタンにイベントをバインド
   */
  function bindKakomonFavoriteButtons(display) {
    const topicId = state.currentItem ? (state.currentItem.subject || state.currentItem.id) : '';

    display.querySelectorAll('.kakomon-card').forEach(card => {
      const code = card.dataset.code;

      if (typeof FavoritesManager !== 'undefined' && state.currentItem) {
        const favoriteBtn = card.querySelector('.favorite-btn');
        if (favoriteBtn) {
          const isFav = FavoritesManager.isFavoriteByParams('kakomon', topicId, code);
          favoriteBtn.classList.toggle('active', isFav);

          favoriteBtn.addEventListener('click', function(e) {
            e.stopPropagation();

            const questionText = card.dataset.text || '';
            const answer = card.dataset.answer || '';
            const numChoices = card.dataset.num || '1';

            let choices = {};
            let images = [];
            try {
              choices = JSON.parse(card.dataset.choices || '{}');
              images = JSON.parse(card.dataset.images || '[]');
            } catch (err) {
              console.log('パースエラー:', err);
            }

            const content = {
              code: code,
              text: questionText,
              answer: answer,
              numChoices: numChoices,
              choices: choices,
              images: images
            };

            const isNowFavorite = FavoritesManager.toggle('kakomon', topicId, code, content);
            this.classList.toggle('active', isNowFavorite);
          });
        }
      }

      const saveBtn = card.querySelector('.save-image-btn');
      if (saveBtn && typeof window.saveCardAsImage === 'function') {
        saveBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          const filename = `過去問_${code}`;
          window.saveCardAsImage(card, filename);
        });
      }
    });
  }

  // 公開API
  return {
    loadKakomon,
    loadSubjectData,
    filterByKeyword,
    initKakomonTab
  };
})();
