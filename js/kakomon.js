/**
 * 過去問モジュール
 */
const KakomonModule = (function() {
  // キャッシュ
  const dataCache = new Map();

  // 状態
  const state = {
    currentQuestions: [],
    currentIndex: 0,
    selectedChoices: new Set(),
    answered: false
  };

  /**
   * 科目の過去問データを読み込み
   */
  async function loadSubjectData(subject) {
    if (dataCache.has(subject)) {
      return dataCache.get(subject);
    }

    try {
      const response = await fetch(`kakomon/${subject}.json`);
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
      // 完全一致または部分一致
      return qKeyword === normalizedKeyword ||
             qKeyword.includes(normalizedKeyword) ||
             normalizedKeyword.includes(qKeyword);
    });
  }

  /**
   * 過去問を読み込んで表示
   */
  async function loadKakomon(item, elements) {
    const subject = item.subject;
    const keyword = item.title; // トピックタイトルをキーワードとして使用

    // プレースホルダーを表示
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

    // 科目データを読み込み
    const subjectData = await loadSubjectData(subject);
    if (!subjectData) {
      showPlaceholder(elements, 'この科目の過去問データがありません');
      return;
    }

    // キーワードでフィルタリング
    const filtered = filterByKeyword(subjectData.questions, keyword);

    if (filtered.length === 0) {
      showPlaceholder(elements, 'このトピックに該当する過去問がありません');
      return;
    }

    // 状態を更新
    state.currentQuestions = filtered;
    state.currentIndex = 0;
    state.selectedChoices = new Set();
    state.answered = false;

    // 表示
    renderCurrentQuestion(elements);
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
   * 現在の問題を描画
   */
  function renderCurrentQuestion(elements) {
    const question = state.currentQuestions[state.currentIndex];
    const total = state.currentQuestions.length;

    // プレースホルダーを非表示
    if (elements.kakomonPlaceholder) {
      elements.kakomonPlaceholder.style.display = 'none';
    }

    // ツールバーを表示
    if (elements.kakomonToolbar) {
      elements.kakomonToolbar.style.display = 'flex';
    }
    if (elements.kakomonCurrent) {
      elements.kakomonCurrent.textContent = state.currentIndex + 1;
    }
    if (elements.kakomonTotal) {
      elements.kakomonTotal.textContent = total;
    }

    // コンテンツを表示
    if (elements.kakomonDisplay) {
      elements.kakomonDisplay.style.display = 'block';
      elements.kakomonDisplay.innerHTML = renderQuiz(question, state.currentIndex, total);

      // イベントをバインド
      bindQuizEvents(elements);
    }
  }

  /**
   * クイズHTMLを生成
   */
  function renderQuiz(question, index, total) {
    const choices = question.choices || {};
    const numChoices = question.numChoices || 1;

    // 有効な選択肢のみフィルタ
    const validChoices = Object.entries(choices)
      .filter(([key, value]) => value && value.trim() !== '');

    return `
      <div class="kakomon-card" data-answer="${escapeHtml(question.answer)}" data-num="${numChoices}">
        <div class="kakomon-header">
          <span class="kakomon-code">${escapeHtml(question.code)}</span>
          <span class="kakomon-meta">第${question.examNum}回 ${question.section}問題</span>
        </div>

        <div class="kakomon-question">
          <p class="kakomon-text">${escapeHtml(question.text)}</p>
        </div>

        <div class="kakomon-instruction">
          ${numChoices > 1 ? `${numChoices}つ選べ。` : '1つ選べ。'}
        </div>

        <div class="kakomon-choices">
          ${validChoices.map(([key, value]) => `
            <button class="kakomon-choice" data-choice="${key}">
              <span class="choice-label">${key}</span>
              <span class="choice-text">${escapeHtml(value)}</span>
            </button>
          `).join('')}
        </div>

        <div class="kakomon-result" style="display:none;">
          <div class="result-answer">正解: ${formatAnswer(question.answer)}</div>
          <div class="result-message"></div>
        </div>

        <div class="kakomon-nav">
          <button class="kakomon-prev" ${index === 0 ? 'disabled' : ''}>前へ</button>
          <span class="kakomon-progress-text">${index + 1} / ${total}</span>
          <button class="kakomon-next" ${index === total - 1 ? 'disabled' : ''}>次へ</button>
        </div>
      </div>
    `;
  }

  /**
   * 正解をフォーマット
   */
  function formatAnswer(answer) {
    if (!answer) return '';
    // 大文字を小文字に変換し、カンマ区切りに
    return answer.toLowerCase().split('').join(', ');
  }

  /**
   * クイズイベントをバインド
   */
  function bindQuizEvents(elements) {
    const display = elements.kakomonDisplay;

    // 選択肢クリック
    display.querySelectorAll('.kakomon-choice').forEach(btn => {
      btn.addEventListener('click', () => handleChoiceClick(btn, elements));
    });

    // ナビゲーション
    const prevBtn = display.querySelector('.kakomon-prev');
    const nextBtn = display.querySelector('.kakomon-next');

    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        if (state.currentIndex > 0) {
          state.currentIndex--;
          state.selectedChoices = new Set();
          state.answered = false;
          renderCurrentQuestion(elements);
        }
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        if (state.currentIndex < state.currentQuestions.length - 1) {
          state.currentIndex++;
          state.selectedChoices = new Set();
          state.answered = false;
          renderCurrentQuestion(elements);
        }
      });
    }

    // リセットボタン
    if (elements.kakomonReset) {
      elements.kakomonReset.onclick = () => {
        state.currentIndex = 0;
        state.selectedChoices = new Set();
        state.answered = false;
        renderCurrentQuestion(elements);
      };
    }
  }

  /**
   * 選択肢クリック処理
   */
  function handleChoiceClick(btn, elements) {
    if (state.answered) return;

    const card = btn.closest('.kakomon-card');
    const answer = card.dataset.answer;
    const numChoices = parseInt(card.dataset.num) || 1;
    const choiceKey = btn.dataset.choice;

    // 選択状態の切り替え
    if (state.selectedChoices.has(choiceKey)) {
      state.selectedChoices.delete(choiceKey);
      btn.classList.remove('selected');
    } else {
      // 単一選択の場合は他を解除
      if (numChoices === 1) {
        card.querySelectorAll('.kakomon-choice').forEach(b => {
          b.classList.remove('selected');
        });
        state.selectedChoices.clear();
      }
      state.selectedChoices.add(choiceKey);
      btn.classList.add('selected');
    }

    // 選択数が必要数に達したら答え合わせ
    if (state.selectedChoices.size === numChoices) {
      checkAnswer(card, answer);
    }
  }

  /**
   * 答え合わせ
   */
  function checkAnswer(card, correctAnswer) {
    state.answered = true;

    const selectedKeys = Array.from(state.selectedChoices)
      .map(k => k.toUpperCase())
      .sort()
      .join('');

    const sortedCorrect = correctAnswer.toUpperCase().split('').sort().join('');
    const isCorrect = selectedKeys === sortedCorrect;

    // 全選択肢を無効化し、正解/不正解を表示
    card.querySelectorAll('.kakomon-choice').forEach(btn => {
      btn.disabled = true;
      const key = btn.dataset.choice.toUpperCase();

      if (correctAnswer.toUpperCase().includes(key)) {
        btn.classList.add('correct');
      } else if (btn.classList.contains('selected')) {
        btn.classList.add('incorrect');
      }
    });

    // 結果表示
    const resultDiv = card.querySelector('.kakomon-result');
    const messageDiv = resultDiv.querySelector('.result-message');

    messageDiv.textContent = isCorrect ? '正解！' : '不正解';
    messageDiv.className = 'result-message ' + (isCorrect ? 'correct' : 'incorrect');
    resultDiv.style.display = 'block';
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

  // 公開API
  return {
    loadKakomon,
    loadSubjectData,
    filterByKeyword
  };
})();
