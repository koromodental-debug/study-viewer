/**
 * 過去問モジュール（縦スクロール一覧形式）
 */
const KakomonModule = (function() {
  // キャッシュ
  const dataCache = new Map();

  // 状態（カードごとの状態はdata属性で管理）
  const state = {
    currentQuestions: []
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

    // 全問を一覧表示
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
   * 全問を一覧表示
   */
  function renderAllQuestions(elements) {
    const total = state.currentQuestions.length;

    // プレースホルダーを非表示
    if (elements.kakomonPlaceholder) {
      elements.kakomonPlaceholder.style.display = 'none';
    }

    // コンテンツを表示
    if (elements.kakomonDisplay) {
      elements.kakomonDisplay.style.display = 'block';

      // 問題数ヘッダー + 全問のHTML
      let html = `<div class="kakomon-list-header">${total}問</div>`;

      state.currentQuestions.forEach((question, index) => {
        html += renderQuizCard(question, index, total);
      });

      // クイックナビを追加（3問以上の場合）
      if (total >= 3) {
        html += renderQuickNav(total);
      }

      elements.kakomonDisplay.innerHTML = html;

      // イベントをバインド
      bindAllQuizEvents(elements);
      bindQuickNavEvents(elements);
    }
  }

  /**
   * クイックナビHTMLを生成
   */
  function renderQuickNav(total) {
    // ナビに表示する番号を決定
    const navNumbers = [1]; // 1は必ず表示

    // 5問ごとに表示
    for (let i = 5; i <= total; i += 5) {
      navNumbers.push(i);
    }

    // 最後の問題を追加（5の倍数でない場合）
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

    // スクロール時にナビを表示/非表示
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
   * クイズカードHTMLを生成（ナビなし）
   */
  function renderQuizCard(question, index, total) {
    const choices = question.choices || {};
    const numChoices = question.numChoices || 1;

    // 有効な選択肢のみフィルタ
    const validChoices = Object.entries(choices)
      .filter(([key, value]) => value && value.trim() !== '');

    // 画像HTMLを生成
    let imagesHtml = '';
    if (question.hasImage && question.imageFiles) {
      const examNum = question.examNum || question.code.match(/^\d+/)?.[0];
      const imageList = question.imageFiles.split(',').map(f => f.trim()).filter(f => f);
      if (imageList.length > 0 && examNum) {
        imagesHtml = `
          <div class="kakomon-images">
            ${imageList.map(file => `<img src="images/${examNum}回_Web画像/${file}" alt="${file}">`).join('')}
          </div>
        `;
      }
    }

    return `
      <div class="kakomon-card" data-index="${index}" data-answer="${escapeHtml(question.answer)}" data-num="${numChoices}" data-answered="false">
        <div class="kakomon-header">
          <span class="kakomon-code">${escapeHtml(question.code)}</span>
          <span class="kakomon-index">${index + 1} / ${total}</span>
        </div>

        <div class="kakomon-question">
          <p class="kakomon-text">${escapeHtml(question.text)}</p>
        </div>

        ${imagesHtml}

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

        <button class="kakomon-submit" disabled>解答</button>

        <div class="kakomon-result" style="display:none;">
          <div class="result-answer">正解: ${formatAnswer(question.answer)}</div>
          <div class="result-message"></div>
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
   * 全カードにイベントをバインド
   */
  function bindAllQuizEvents(elements) {
    const display = elements.kakomonDisplay;

    // 各カードごとにイベント設定
    display.querySelectorAll('.kakomon-card').forEach(card => {
      const numChoices = parseInt(card.dataset.num) || 1;
      let selectedChoices = new Set();

      // 選択肢クリック
      card.querySelectorAll('.kakomon-choice').forEach(btn => {
        btn.addEventListener('click', () => {
          if (card.dataset.answered === 'true') return;

          const choiceKey = btn.dataset.choice;

          // 選択状態の切り替え
          if (selectedChoices.has(choiceKey)) {
            selectedChoices.delete(choiceKey);
            btn.classList.remove('selected');
          } else {
            // 単一選択の場合は他を解除
            if (numChoices === 1) {
              card.querySelectorAll('.kakomon-choice').forEach(b => {
                b.classList.remove('selected');
              });
              selectedChoices.clear();
            }
            selectedChoices.add(choiceKey);
            btn.classList.add('selected');
          }

          // 選択数が必要数に達したら解答ボタンを有効化
          const submitBtn = card.querySelector('.kakomon-submit');
          if (submitBtn) {
            submitBtn.disabled = selectedChoices.size !== numChoices;
          }
        });
      });

      // 解答ボタン
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
