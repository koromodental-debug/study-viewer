/**
 * 過去問モジュール（年度別・科目別選択 + 会話解説付き）
 */
const KakomonModule = (function() {
  // キャッシュ
  const dataCache = new Map();
  const explanationCache = new Map();
  let questionsData = null;

  // 状態
  const state = {
    currentQuestions: [],
    currentItem: null,
    viewMode: 'select', // 'select' | 'year' | 'subject' | 'questions'
    selectedYear: null,
    selectedSession: null,
    selectedSubject: null
  };

  // 定数
  const YEARS = Array.from({ length: 17 }, (_, i) => 118 - i); // 118〜102
  const SESSIONS = ['A', 'B', 'C', 'D'];
  const SUBJECTS = [
    '解剖学', '組織学', '生理学', '生化学', '病理学', '薬理学',
    '歯周病学', '歯内療法学', '保存修復学', '全部床義歯学', '部分床義歯学', '必修'
  ];

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
   * 科目の過去問データを読み込み
   */
  async function loadSubjectData(subject) {
    if (dataCache.has(subject)) {
      return dataCache.get(subject);
    }

    try {
      const response = await fetch(encodeURI(`kakomon/${subject}.json`));
      if (!response.ok) throw new Error('Failed to load');
      const data = await response.json();
      dataCache.set(subject, data);
      return data;
    } catch (e) {
      console.log('過去問データ読み込みエラー:', e);
      return null;
    }
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

        if (mode === 'year') {
          navContent.innerHTML = renderYearList();
          bindYearEvents(elements);
        } else {
          navContent.innerHTML = renderSubjectList();
          bindSubjectEvents(elements);
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
      imageFiles: q.images ? q.images.join(',') : ''
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
        initKakomonTab(elements);
      });
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

    const validChoices = Object.entries(choices)
      .filter(([key, value]) => value && value.trim() !== '');

    let imagesHtml = '';
    if (question.hasImage && question.imageFiles) {
      const examNum = question.examNum || code.match(/^\d+/)?.[0];
      const imageList = question.imageFiles.split(',').map(f => f.trim()).filter(f => f);
      if (imageList.length > 0 && examNum) {
        imagesHtml = `
          <div class="kakomon-images">
            ${imageList.map(file => `<img src="/images/${examNum}回_Web画像/${file}" alt="${file}">`).join('')}
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
        const paths = imageList.map(file => `/images/${examNum}回_Web画像/${file}`);
        imagePathsJson = JSON.stringify(paths);
      }
    }

    const questionText = question.text || question.questionText || '';

    return `
      <div class="kakomon-card" data-index="${index}" data-answer="${escapeHtml(question.answer)}" data-num="${numChoices}" data-answered="false" data-code="${escapeHtml(code)}" data-text="${escapeHtml(questionText)}" data-choices='${choicesJson.replace(/'/g, "&#39;")}' data-images='${imagePathsJson}'>
        <div class="kakomon-header">
          <span class="kakomon-code">${escapeHtml(code)}</span>
          <span class="kakomon-index">${index + 1} / ${total}</span>
          <button class="favorite-btn" aria-label="お気に入り">
            <svg viewBox="0 0 24 24">
              <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
            </svg>
          </button>
          <button class="save-image-btn" aria-label="画像保存">
            <svg viewBox="0 0 24 24" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </button>
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
          <div class="conversation-container"></div>
        </div>
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
   * 全カードにイベントをバインド
   */
  function bindAllQuizEvents(elements) {
    const display = elements.kakomonDisplay;

    bindKakomonFavoriteButtons(display);

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
  }

  /**
   * 解説ボタンのイベントをバインド
   */
  function bindExplanationBtn(card) {
    const btn = card.querySelector('.show-explanation-btn');
    const container = card.querySelector('.conversation-container');

    if (btn && container) {
      btn.addEventListener('click', async () => {
        btn.textContent = '読み込み中...';
        btn.disabled = true;

        const code = card.dataset.code;
        const year = parseInt(code.match(/^\d+/)?.[0]) || 0;

        const explanations = await loadExplanations(year);
        const explanation = explanations?.[code];

        if (explanation && explanation.conversation) {
          container.innerHTML = renderConversation(explanation);
          animateConversation(container);
        } else {
          container.innerHTML = `
            <div class="no-explanation">
              <p>この問題の解説は準備中です</p>
            </div>
          `;
        }

        btn.style.display = 'none';

        // 正解表示と解説の冒頭が見えるようスクロール
        setTimeout(() => {
          const resultDiv = card.querySelector('.kakomon-result');
          if (resultDiv) {
            resultDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }, 100);
      });
    }
  }

  /**
   * 会話形式の解説をレンダリング
   */
  function renderConversation(explanation) {
    const { conversation, keyPoints, relatedTopics } = explanation;

    // 問題ごとにランダムな生徒アイコンを選択（1, 2, 3のいずれか）
    const studentIconNum = Math.floor(Math.random() * 3) + 1;
    const teacherIcon = '/images/icons/teacher.jpg';
    const studentIcon = `/images/icons/student${studentIconNum}.png`;

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
