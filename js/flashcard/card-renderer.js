// Card rendering and interaction logic.
// Extracted from js/flashcard.js (no runtime wiring yet).

export function createCardRenderer(deps) {
  const state = deps.state;
  const tableOcclusionState = deps.tableOcclusionState;
  const getDATA = deps.getDATA || (() => []);
  const FavoritesManager = deps.FavoritesManager || (typeof globalThis !== 'undefined' ? globalThis.FavoritesManager : undefined);
  const html2canvasRef = deps.html2canvas || (typeof globalThis !== 'undefined' ? globalThis.html2canvas : undefined);

  const getNextInterval = deps.getNextInterval || ((n) => n);
  const DAY_MS = deps.DAY_MS || 24 * 60 * 60 * 1000;

  const recordDailyActivity = deps.recordDailyActivity || (() => {});
  const saveProgress = deps.saveProgress || (() => {});
  const getTopicStats = deps.getTopicStats || (() => ({ memorized: 0, again: 0 }));
  const markDailyTenCompleted = deps.markDailyTenCompleted || (() => {});
  const clearSession = deps.clearSession || (() => {});
  const startRecommendedDeck = deps.startRecommendedDeck || (() => {});
  const shuffleArray = deps.shuffleArray || ((cards) => cards);
  const goBack = deps.goBack || (() => {});
  const renderDeckList = deps.renderDeckList || (() => {});
  const isCollaborator = deps.isCollaborator || (() => false);

  let container = deps.container || null;
  function setContainer(el) {
    container = el;
  }

  // === 演習モード制御 ===
  function enterPracticeMode() {
    document.body.classList.add('is-practice');
    const tabbar = document.querySelector('.floating-tabbar');
    if (tabbar) tabbar.classList.add('exercise-hidden');
  }

  function exitPracticeMode() {
    document.body.classList.remove('is-practice');
    const tabbar = document.querySelector('.floating-tabbar');
    if (tabbar) tabbar.classList.remove('exercise-hidden');
  }

  // === 特殊デッキ判定 ===
  function isSpecialDeck() {
    if (!state.currentTopicId) return false;
    if (state.currentTopicId.startsWith('__search_')) return false;
    if (state.currentTopicId === '__daily_ten') return false;
    return state.currentTopicId.startsWith('__');
  }

  // === 選択問題用UI ===
  function renderChoicesUI(card) {
    const choices = card.choices || {};
    const validChoices = Object.entries(choices)
      .filter(([key, value]) => value && value.trim() !== '');

    if (validChoices.length === 0) return '';

    const cleanChoiceText = (text) => {
      return text
        .replace(/[：:]\s*○/g, '')
        .replace(/○/g, '')
        .trim();
    };

    return `
      <div class="flashcard-choices" data-num="${card.numChoices || 1}">
        ${validChoices.map(([key, value]) => `
          <button class="flashcard-choice-btn" data-choice="${key}">
            <span class="choice-label">${key.toUpperCase()}</span>
            <span class="choice-text">${escapeHtml(cleanChoiceText(value))}</span>
          </button>
        `).join('')}
      </div>
      <button class="flashcard-submit-btn" id="flashcard-submit-btn" disabled>
        解答
      </button>
    `;
  }

  function onChoiceSelect(e) {
    if (state.choiceAnswered) return;

    const btn = e.currentTarget;
    const choiceKey = btn.dataset.choice;
    const card = state.filteredCards[state.currentIndex];
    const numChoices = card.numChoices || 1;

    if (state.selectedChoices.has(choiceKey)) {
      state.selectedChoices.delete(choiceKey);
      btn.classList.remove('selected');
    } else {
      if (numChoices === 1) {
        document.querySelectorAll('.flashcard-choice-btn').forEach(b => {
          b.classList.remove('selected');
        });
        state.selectedChoices.clear();
      }
      state.selectedChoices.add(choiceKey);
      btn.classList.add('selected');
    }

    const submitBtn = document.getElementById('flashcard-submit-btn');
    if (submitBtn) {
      submitBtn.disabled = state.selectedChoices.size !== numChoices;
    }
  }

  function onSubmitAnswer() {
    if (state.choiceAnswered) return;

    const card = state.filteredCards[state.currentIndex];
    const correctAnswer = (card.correctAnswer || '').toUpperCase();

    const selectedKeys = Array.from(state.selectedChoices)
      .map(k => k.toUpperCase())
      .sort()
      .join('');
    const sortedCorrect = correctAnswer.replace(/[^A-E]/g, '').split('').sort().join('');
    const isCorrect = selectedKeys === sortedCorrect;

    state.choiceAnswered = true;

    showChoiceFeedback(correctAnswer, isCorrect);

    flipToAnswer();
  }

  function showChoiceFeedback(correctAnswer, isCorrect) {
    document.querySelectorAll('.flashcard-choice-btn').forEach(btn => {
      btn.disabled = true;
      const key = btn.dataset.choice.toUpperCase();

      if (correctAnswer.includes(key)) {
        btn.classList.add('correct');
      } else if (btn.classList.contains('selected')) {
        btn.classList.add('incorrect');
      }
    });

    const submitBtn = document.getElementById('flashcard-submit-btn');
    if (submitBtn) {
      submitBtn.style.display = 'none';
    }

    const feedback = document.createElement('div');
    feedback.className = `flashcard-result-feedback ${isCorrect ? 'correct' : 'incorrect'}`;
    feedback.textContent = isCorrect ? '正解!' : '不正解';

    const choicesDiv = document.querySelector('.flashcard-choices');
    if (choicesDiv) {
      choicesDiv.after(feedback);
    }
  }

  function flipToAnswer() {
    state.isFlipped = true;
    const exercise = document.querySelector('.flashcard-exercise');
    const card = document.getElementById('flashcard-card');
    const actionBar = document.querySelector('.flashcard-action-bar');
    const summary = document.getElementById('flashcard-summary');

    if (exercise) exercise.classList.add('flipped');
    if (card) card.classList.add('flipped');
    if (actionBar) actionBar.classList.add('show');
    if (summary && summary.classList.contains('has-content')) {
      summary.classList.add('show');
    }
  }

  // === カード表示 ===
  function renderCard() {
    enterPracticeMode();

    const card = state.filteredCards[state.currentIndex];
    if (!card) return;

    if (card.type === 'table-occlusion') {
      state.isFlipped = false;
      renderInlineTableCard(card);
      return;
    }

    const keyTopicId = card.topicId || state.currentTopicId;
    const key = `${keyTopicId}:${card.originalIndex}`;
    const progress = state.progress[key];

    const current = state.currentIndex + 1;
    const total = state.filteredCards.length;
    const progressPercent = (current / total) * 100;
    const pendingAgain = state.filteredCards.slice(state.currentIndex + 1).filter(c => c._reinsertCount).length;
    const showSizeBtn = isSpecialDeck();
    const isFavorite = FavoritesManager && FavoritesManager.isFavoriteByParams('qa', keyTopicId, card.originalIndex);

    if (!container) return;
    container.innerHTML = `
      <div class="flashcard-exercise ${state.isFlipped ? 'flipped' : ''}">
        <div class="flashcard-header">
          <button class="flashcard-back-btn" id="flashcard-back-btn" aria-label="戻る">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
          </button>
          <div class="flashcard-progress-bar">
            <div class="flashcard-progress-fill" style="width: ${progressPercent}%"></div>
            <span class="flashcard-progress-text">${current} / ${total}${pendingAgain > 0 ? ` <span class=\"progress-pending\">再${pendingAgain}</span>` : ''}</span>
            ${showSizeBtn ? `<button class=\"flashcard-size-btn\" id=\"flashcard-size-btn\" aria-label=\"問数変更\">${state.sessionSize >= 9999 ? '全' : state.sessionSize}</button>` : ''}
          </div>
          <div class="flashcard-header-actions">
            ${(!showSizeBtn || state.currentTopicId === '__favorites') ? `<button class=\"flashcard-text-btn ${state.shuffleEnabled ? 'active' : ''}\" id=\"flashcard-shuffle-btn\">シャッフル</button>` : ''}
            <button class="flashcard-favorite-btn ${isFavorite ? 'active' : ''}" id="flashcard-favorite-btn" aria-label="お気に入り" title="お気に入り">
              <svg viewBox="0 0 24 24" fill="${isFavorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
              </svg>
            </button>
          </div>
        </div>

        <div class="flashcard-stage">
          <div class="flashcard-card-container" id="flashcard-card-container">
            <div class="flashcard-card ${state.isFlipped ? 'flipped' : ''}" id="flashcard-card">
              <div class="flashcard-card-inner">
                <div class="flashcard-question">
                  ${card.question}
                </div>
                ${card.isChoiceCard ? renderChoicesUI(card) : `
                <div class="flashcard-tap-hint ${state.isFlipped ? 'hide' : ''}" id="tap-hint">
                  タップで答え
                </div>
                `}
                <div class="flashcard-answer">
                  ${card.answer}
                </div>
                ${card.topicTitle ? `
                <div class="flashcard-deck-pill-wrap">
                  <button class="flashcard-deck-pill" data-topic-id="${card.topicId}">
                    ${card.topicTitle}
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                      <polyline points="15 3 21 3 21 9"></polyline>
                      <line x1="10" y1="14" x2="21" y2="3"></line>
                    </svg>
                  </button>
                </div>
                ` : ''}
              </div>
              <div class="swipe-overlay swipe-left" id="swipe-overlay-left">
                <span>もう一度</span>
              </div>
              <div class="swipe-overlay swipe-right" id="swipe-overlay-right">
                <span>覚えた</span>
              </div>
            </div>
          </div>

          <div class="flashcard-summary ${state.summaryCollapsed ? 'collapsed' : ''}" id="flashcard-summary">
            <div class="flashcard-summary-header" id="flashcard-summary-toggle">
              <span>まとめ</span>
              <div class="summary-header-actions">
                <button class="summary-save-btn" id="summary-save-btn" title="画像として保存">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="3" y="3" width="18" height="18" rx="2"/>
                    <circle cx="8.5" cy="8.5" r="1.5"/>
                    <path d="M21 15l-5-5L5 21"/>
                  </svg>
                </button>
                <svg class="summary-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M6 9l6 6 6-6"/>
                </svg>
              </div>
            </div>
            <div class="flashcard-summary-content" id="flashcard-summary-content">
            </div>
          </div>
        </div>

        <div class="flashcard-action-bar ${state.isFlipped ? 'show' : ''}">
          <button class="flashcard-btn again" id="flashcard-again-btn">
            もう一度
          </button>
          ${isCollaborator() ? `<button class=\"flashcard-btn report\" id=\"flashcard-report-btn\">報告</button>` : ''}
          <button class="flashcard-btn memorized" id="flashcard-memorized-btn">
            覚えた
          </button>
        </div>

      </div>

      <div class="flashcard-snackbar" id="flashcard-snackbar">
        <span class="snackbar-message" id="snackbar-message"></span>
        <button class="snackbar-undo" id="flashcard-undo-btn">元に戻す</button>
      </div>
    `;

    bindCardEvents();

    const cardEl = document.getElementById('flashcard-card');
    if (cardEl) {
      cardEl.classList.add('entering');
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          cardEl.classList.remove('entering');
        });
      });
    }

    if (!localStorage.getItem('flashcard-hint-shown')) {
      const hint = document.getElementById('tap-hint');
      if (hint) {
        hint.classList.add('pulse');
        setTimeout(() => {
          hint.classList.remove('pulse');
          localStorage.setItem('flashcard-hint-shown', 'true');
        }, 2000);
      }
    }

    const htmlPath = card.htmlPath || (state.currentTopic && state.currentTopic.htmlPath);
    if (htmlPath) {
      loadHtmlSummary(htmlPath, card.section);
    }
  }

  function renderNoCardsMessage() {
    if (!container) return;
    container.innerHTML = `
      <div class="flashcard-no-cards">
        <div class="flashcard-no-cards-icon">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
          </svg>
        </div>
        <h3>復習するカードがありません</h3>
        <p>「もう一度」のカードがないか、まだ学習を開始していません。</p>
        <button class="flashcard-back-btn-large" id="flashcard-back-btn">
          トピック選択に戻る
        </button>
      </div>
    `;

    document.getElementById('flashcard-back-btn').addEventListener('click', goBack);
  }

  function bindCardEvents() {
    document.getElementById('flashcard-back-btn').addEventListener('click', goBack);

    const sizeBtn = document.getElementById('flashcard-size-btn');
    if (sizeBtn) sizeBtn.addEventListener('click', cycleSessionSize);

    const shuffleBtn = document.getElementById('flashcard-shuffle-btn');
    if (shuffleBtn) shuffleBtn.addEventListener('click', toggleShuffle);

    const reportBtn = document.getElementById('flashcard-report-btn');
    if (reportBtn) {
      reportBtn.addEventListener('click', reportCurrentCard);
    }

    document.getElementById('flashcard-favorite-btn').addEventListener('click', toggleFavoriteCurrentCard);

    const gotoDeckBtn = document.querySelector('.flashcard-deck-pill');
    if (gotoDeckBtn) {
      gotoDeckBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const topicId = gotoDeckBtn.dataset.topicId;

        let topic = getDATA().find(d => d.id === topicId);
        if (!topic) {
          topic = getDATA().find(d => d.id.includes(topicId) || d.id.endsWith('_' + topicId.toLowerCase()));
        }
        if (!topic) {
          topic = getDATA().find(d => d.title === topicId || topicId.includes(d.title));
        }

        if (topic) {
          state.highlightTopicId = topic.id;
          if (topic.subject) {
            state.expandedSubjects.add(topic.subject);
            localStorage.setItem('flashcard-expanded-subjects', JSON.stringify([...state.expandedSubjects]));
          }
        }

        state.isActive = false;
        exitPracticeMode();
        renderDeckList();

        setTimeout(() => {
          const highlightedTopic = container.querySelector('.deck-topic.highlighted');
          if (highlightedTopic) {
            highlightedTopic.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
          setTimeout(() => {
            state.highlightTopicId = null;
            if (highlightedTopic) {
              highlightedTopic.classList.remove('highlighted');
            }
          }, 3000);
        }, 100);
      });
    }

    const currentCard = state.filteredCards[state.currentIndex];

    if (currentCard && currentCard.isChoiceCard) {
      document.querySelectorAll('.flashcard-choice-btn').forEach(btn => {
        btn.addEventListener('click', onChoiceSelect);
      });

      const submitBtn = document.getElementById('flashcard-submit-btn');
      if (submitBtn) {
        submitBtn.addEventListener('click', onSubmitAnswer);
      }
    } else {
      const cardContainer = document.getElementById('flashcard-card-container');
      cardContainer.addEventListener('click', flip);
    }

    const stage = document.querySelector('.flashcard-stage');
    stage.addEventListener('touchstart', onTouchStart, { passive: true });
    stage.addEventListener('touchmove', onTouchMove, { passive: true });
    stage.addEventListener('touchend', onTouchEnd, { passive: true });

    document.getElementById('flashcard-memorized-btn').addEventListener('click', markMemorized);
    document.getElementById('flashcard-again-btn').addEventListener('click', markAgain);

    document.getElementById('flashcard-undo-btn').addEventListener('click', undo);

    document.getElementById('flashcard-summary-toggle').addEventListener('click', toggleSummary);

    document.getElementById('summary-save-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      saveSummaryAsImage();
    });
  }

  // === まとめ折りたたみ ===
  function toggleSummary() {
    state.summaryCollapsed = !state.summaryCollapsed;
    localStorage.setItem('flashcard-summary-collapsed', state.summaryCollapsed);

    const summary = document.getElementById('flashcard-summary');
    if (summary) {
      summary.classList.toggle('collapsed', state.summaryCollapsed);
    }
  }

  async function saveSummaryAsImage() {
    const content = document.getElementById('flashcard-summary-content');
    if (!content || !html2canvasRef) return;

    const originalOverflow = content.style.overflow;
    const originalMaxHeight = content.style.maxHeight;
    content.style.overflow = 'visible';
    content.style.maxHeight = 'none';

    try {
      const canvas = await html2canvasRef(content, {
        backgroundColor: '#ffffff',
        scale: 2,
        useCORS: true,
        onclone: (clonedDoc, clonedEl) => {
          clonedDoc.documentElement.classList.remove('dark');
          clonedDoc.body.classList.remove('dark');

          const applyLightStyle = (el) => {
            el.style.setProperty('color', '#1c1c1e', 'important');
            el.style.setProperty('-webkit-text-fill-color', '#1c1c1e', 'important');
            el.style.setProperty('border-color', '#c6c6c8', 'important');
          };

          clonedEl.style.setProperty('background-color', '#ffffff', 'important');
          applyLightStyle(clonedEl);

          const elements = clonedEl.querySelectorAll('*');
          elements.forEach(el => {
            applyLightStyle(el);
            const tagName = el.tagName.toUpperCase();
            if (tagName === 'TH') {
              el.style.setProperty('background-color', '#f2f2f7', 'important');
            } else if (tagName === 'TD') {
              el.style.setProperty('background-color', '#ffffff', 'important');
            } else if (tagName === 'TABLE' || tagName === 'TBODY' || tagName === 'THEAD' || tagName === 'TR') {
              el.style.setProperty('background-color', '#ffffff', 'important');
            } else if (tagName === 'MARK' || el.classList.contains('highlight') || el.classList.contains('keyword-highlight')) {
              el.style.setProperty('background-color', 'transparent', 'important');
            } else {
              el.style.setProperty('background-color', 'transparent', 'important');
            }
          });
        }
      });

      const dataUrl = canvas.toDataURL('image/png');

      const overlay = document.createElement('div');
      overlay.className = 'image-preview-overlay';
      overlay.innerHTML = `
        <div class="image-preview-container">
          <div class="image-preview-header">
            <span>長押しで写真に保存</span>
            <button class="image-preview-close" id="image-preview-close">✕</button>
          </div>
          <div class="image-preview-body">
            <img src="${dataUrl}" alt="まとめ" />
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      document.getElementById('image-preview-close').addEventListener('click', () => {
        overlay.remove();
      });

      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          overlay.remove();
        }
      });

    } finally {
      content.style.overflow = originalOverflow;
      content.style.maxHeight = originalMaxHeight;
    }
  }

  // === スワイプ処理 ===
  const SWIPE_THRESHOLD = 72;
  let swipeRAF = null;
  let swipeDiffX = 0;
  let swipeDiffY = 0;

  function onTouchStart(e) {
    state.touchStartX = e.touches[0].clientX;
    state.touchStartY = e.touches[0].clientY;
    swipeDiffX = 0;
    swipeDiffY = 0;

    const card = document.getElementById('flashcard-card');
    if (card) {
      card.classList.add('swiping');
      card.style.transition = 'none';
    }
  }

  function onTouchMove(e) {
    swipeDiffX = e.touches[0].clientX - state.touchStartX;
    swipeDiffY = e.touches[0].clientY - state.touchStartY;

    if (Math.abs(swipeDiffY) > Math.abs(swipeDiffX) * 0.8) return;

    if (!swipeRAF) {
      swipeRAF = requestAnimationFrame(updateSwipeVisuals);
    }
  }

  function updateSwipeVisuals() {
    swipeRAF = null;

    const card = document.getElementById('flashcard-card');
    const overlayLeft = document.getElementById('swipe-overlay-left');
    const overlayRight = document.getElementById('swipe-overlay-right');

    if (!card || !overlayLeft || !overlayRight) return;

    const moveX = Math.max(-150, Math.min(150, swipeDiffX * 0.6));
    const moveY = swipeDiffY * 0.1;
    const rotation = Math.max(-6, Math.min(6, moveX / 18));
    card.style.transform = `translate3d(${moveX}px,${moveY}px,0) rotate(${rotation}deg)`;

    const progress = Math.min(1, Math.abs(swipeDiffX) / SWIPE_THRESHOLD);
    const exceeded = Math.abs(swipeDiffX) >= SWIPE_THRESHOLD;

    if (swipeDiffX < -20) {
      overlayLeft.style.opacity = progress;
      overlayRight.style.opacity = 0;
      overlayLeft.classList.toggle('pop', exceeded);
      overlayRight.classList.remove('pop');
    } else if (swipeDiffX > 20) {
      overlayRight.style.opacity = progress;
      overlayLeft.style.opacity = 0;
      overlayRight.classList.toggle('pop', exceeded);
      overlayLeft.classList.remove('pop');
    } else {
      overlayLeft.style.opacity = 0;
      overlayRight.style.opacity = 0;
      overlayLeft.classList.remove('pop');
      overlayRight.classList.remove('pop');
    }
  }

  function onTouchEnd(e) {
    if (swipeRAF) {
      cancelAnimationFrame(swipeRAF);
      swipeRAF = null;
    }

    const diffX = e.changedTouches[0].clientX - state.touchStartX;
    const diffY = e.changedTouches[0].clientY - state.touchStartY;

    const card = document.getElementById('flashcard-card');
    const overlayLeft = document.getElementById('swipe-overlay-left');
    const overlayRight = document.getElementById('swipe-overlay-right');

    if (card) {
      card.classList.remove('swiping');
      card.style.transition = 'transform 180ms cubic-bezier(.2,.9,.2,1)';
      card.style.transform = '';
    }
    if (overlayLeft) {
      overlayLeft.style.opacity = 0;
      overlayLeft.classList.remove('pop');
    }
    if (overlayRight) {
      overlayRight.style.opacity = 0;
      overlayRight.classList.remove('pop');
    }

    if (Math.abs(diffX) > SWIPE_THRESHOLD && Math.abs(diffX) > Math.abs(diffY) * 1.5) {
      if (diffX < 0) {
        markAgain();
      } else {
        markMemorized();
      }
    }
  }

  // === カード操作 ===
  function flip() {
    hideSnackbar();
    state.undoState = null;

    state.isFlipped = !state.isFlipped;
    const exercise = document.querySelector('.flashcard-exercise');
    const card = document.getElementById('flashcard-card');
    const actionBar = document.querySelector('.flashcard-action-bar');
    const summary = document.getElementById('flashcard-summary');
    const tapHint = document.querySelector('.flashcard-tap-hint');

    if (state.isFlipped) {
      if (exercise) exercise.classList.add('flipped');
      if (card) card.classList.add('flipped');
      if (actionBar) actionBar.classList.add('show');
      if (summary && summary.classList.contains('has-content')) {
        summary.classList.add('show');
      }
      if (tapHint) tapHint.classList.add('hide');
    } else {
      if (exercise) exercise.classList.remove('flipped');
      if (card) card.classList.remove('flipped');
      if (actionBar) actionBar.classList.remove('show');
      if (summary) summary.classList.remove('show');
      if (tapHint) tapHint.classList.remove('hide');
    }
  }

  function next() {
    if (state.currentIndex < state.filteredCards.length - 1) {
      state.currentIndex++;
      state.isFlipped = false;
      state.selectedChoices.clear();
      state.choiceAnswered = false;
      renderCard();
    }
  }

  function prev() {
    if (state.currentIndex > 0) {
      state.currentIndex--;
      state.isFlipped = false;
      state.selectedChoices.clear();
      state.choiceAnswered = false;
      renderCard();
    }
  }

  function saveUndoState(action) {
    const card = state.filteredCards[state.currentIndex];
    state.undoState = {
      action: action,
      index: state.currentIndex,
      filteredCards: [...state.filteredCards],
      progressSnapshot: { ...state.progress },
      card: card
    };
  }

  function undo() {
    if (!state.undoState) return;

    hideSnackbar();

    state.filteredCards = state.undoState.filteredCards;
    state.currentIndex = state.undoState.index;
    state.progress = state.undoState.progressSnapshot;
    state.isFlipped = false;

    saveProgress();

    state.undoState = null;
    if (state.undoTimer) {
      clearTimeout(state.undoTimer);
      state.undoTimer = null;
    }

    renderCard();
  }

  // === トースト表示 ===
  function showToast(message, duration = 1200) {
    const existingToast = document.querySelector('.flashcard-toast');
    if (existingToast) {
      existingToast.remove();
    }

    const toast = document.createElement('div');
    toast.className = 'flashcard-toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add('show');
    });

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  // === カード報告機能 ===
  const GOOGLE_FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSfNxFF5NrMxgNdhFq24jGTd1pGBd5-dlAWQOb1eX1kqDqz4WA/formResponse';
  const FORM_ENTRIES = {
    subject: 'entry.164360725',
    topic: 'entry.300876290',
    section: 'entry.676904274',
    question: 'entry.338182143',
    answer: 'entry.1207584254'
  };

  function reportCurrentCard() {
    const card = state.filteredCards[state.currentIndex];
    if (!card) return;

    const keyTopicId = card.topicId || state.currentTopicId;
    const topicData = getDATA().find(d => d.id === keyTopicId);

    const reportData = {
      subject: topicData?.subject || '',
      topic: card.topicTitle || topicData?.title || keyTopicId,
      section: card.section || '',
      question: card.question,
      answer: card.answer
    };

    const btn = document.getElementById('flashcard-report-btn');
    if (btn) {
      btn.classList.add('sending');
    }

    const formData = new FormData();
    formData.append(FORM_ENTRIES.subject, reportData.subject);
    formData.append(FORM_ENTRIES.topic, reportData.topic);
    formData.append(FORM_ENTRIES.section, reportData.section);
    formData.append(FORM_ENTRIES.question, reportData.question);
    formData.append(FORM_ENTRIES.answer, reportData.answer);

    fetch(GOOGLE_FORM_URL, {
      method: 'POST',
      mode: 'no-cors',
      body: formData
    }).then(() => {
      if (btn) {
        btn.classList.remove('sending');
        btn.classList.add('reported');
        setTimeout(() => btn.classList.remove('reported'), 1500);
      }
      showToast('報告しました', 1200);
    }).catch(() => {
      if (btn) {
        btn.classList.remove('sending');
      }
      showToast('送信に失敗しました', 1500);
    });
  }

  function reportCardFromList(btn) {
    const topicId = btn.dataset.topicId;
    const topicData = getDATA().find(d => d.id === topicId);

    const reportData = {
      subject: topicData?.subject || '',
      topic: topicData?.title || topicId,
      section: btn.dataset.section || '',
      question: btn.dataset.question,
      answer: btn.dataset.answer
    };

    btn.classList.add('sending');

    const formData = new FormData();
    formData.append(FORM_ENTRIES.subject, reportData.subject);
    formData.append(FORM_ENTRIES.topic, reportData.topic);
    formData.append(FORM_ENTRIES.section, reportData.section);
    formData.append(FORM_ENTRIES.question, reportData.question);
    formData.append(FORM_ENTRIES.answer, reportData.answer);

    fetch(GOOGLE_FORM_URL, {
      method: 'POST',
      mode: 'no-cors',
      body: formData
    }).then(() => {
      btn.classList.remove('sending');
      btn.classList.add('reported');
      setTimeout(() => btn.classList.remove('reported'), 1500);
      showToast('報告しました', 1200);
    }).catch(() => {
      btn.classList.remove('sending');
      showToast('送信に失敗しました', 1500);
    });
  }

  function toggleFavoriteCurrentCard() {
    const card = state.filteredCards[state.currentIndex];
    if (!card || !FavoritesManager) return;

    const keyTopicId = card.topicId || state.currentTopicId;
    const topicData = getDATA().find(d => d.id === keyTopicId);

    const content = {
      question: card.question,
      answer: card.answer,
      section: card.section || '',
      topicTitle: card.topicTitle || topicData?.title || keyTopicId,
      subject: topicData?.subject || ''
    };

    const isNowFavorite = FavoritesManager.toggle('qa', keyTopicId, card.originalIndex, content);

    const btn = document.getElementById('flashcard-favorite-btn');
    if (btn) {
      btn.classList.toggle('active', isNowFavorite);
      const svg = btn.querySelector('svg');
      if (svg) {
        svg.setAttribute('fill', isNowFavorite ? 'currentColor' : 'none');
      }
    }

    showToast(isNowFavorite ? 'お気に入りに追加' : 'お気に入りから削除', 1000);
  }

  // === 報告管理 ===
  const REPORTS_KEY = deps.REPORTS_KEY || 'studyViewer_cardReports';

  function getReports() {
    try {
      const stored = localStorage.getItem(REPORTS_KEY);
      if (stored) return JSON.parse(stored);
    } catch (e) {}
    return [];
  }

  function removeReport(reportId) {
    let reports = getReports();
    reports = reports.filter(r => r.id !== reportId);
    localStorage.setItem(REPORTS_KEY, JSON.stringify(reports));
    return reports;
  }

  function clearAllReports() {
    localStorage.removeItem(REPORTS_KEY);
  }

  function exportReportsAsText() {
    const reports = getReports();
    if (reports.length === 0) return '報告されたカードはありません';

    const lines = ['# 報告されたカード一覧', ''];
    for (const r of reports) {
      lines.push(`## ${r.topicTitle} - ${r.section || '(セクションなし)'}`);
      lines.push(`Q: ${r.question}`);
      lines.push(`A: ${r.answer}`);
      lines.push(`報告日時: ${new Date(r.reportedAt).toLocaleString('ja-JP')}`);
      lines.push('');
    }
    return lines.join('\n');
  }

  // === ステータス説明モーダル ===
  function showStatusHelpModal() {
    const overlay = document.createElement('div');
    overlay.className = 'status-help-overlay';
    overlay.id = 'status-help-overlay';
    overlay.innerHTML = `
      <div class="status-help-modal">
        <div class="status-help-header">
          <h3>学習ステータスについて</h3>
          <button class="status-help-close" id="status-help-close">✕</button>
        </div>
        <div class="status-help-body">
          <div class="status-help-item">
            <div class="status-help-badge again">要復習</div>
            <div class="status-help-desc">
              「もう一度」を押したカード、または復習期限を過ぎたカード。
            </div>
          </div>
          <div class="status-help-item">
            <div class="status-help-badge learning">定着中</div>
            <div class="status-help-desc">
              「覚えた」を押したカード。まだ忘れやすい状態です。
            </div>
          </div>
          <div class="status-help-item">
            <div class="status-help-badge mastered">習得済</div>
            <div class="status-help-desc">
              「覚えた」を4回以上続けて押したカード。十分に定着しています。
            </div>
          </div>
          <div class="status-help-flow">
            <div class="status-help-flow-title">「覚えた」を押し続けると...</div>
            <div class="status-help-flow-steps">
              <span>1日後</span><span class="arrow">→</span>
              <span>3日後</span><span class="arrow">→</span>
              <span>7日後</span><span class="arrow">→</span>
              <span class="highlight">14日後で習得済に</span>
            </div>
            <div class="status-help-note">※「もう一度」を押すと最初からやり直し</div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById('status-help-close').addEventListener('click', () => {
      overlay.remove();
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
      }
    });
  }

  // === 報告一覧オーバーレイ ===
  function openReportsOverlay() {
    const reports = getReports();

    const overlay = document.createElement('div');
    overlay.className = 'reports-overlay';
    overlay.id = 'reports-overlay';
    overlay.innerHTML = `
      <div class="reports-modal">
        <div class="reports-modal-header">
          <h3>報告されたカード</h3>
          <button class="reports-close-btn" id="reports-close-btn">✕</button>
        </div>
        <div class="reports-modal-body">
          ${reports.length === 0 ? `
            <div class="reports-empty">
              報告されたカードはありません
            </div>
          ` : `
            <div class="reports-list">
              ${reports.map(r => `
                <div class="reports-item" data-report-id="${escapeHtml(r.id)}">
                  <div class="reports-item-header">
                    <span class="reports-item-topic">${escapeHtml(r.topicTitle)}</span>
                    <button class="reports-item-delete" data-id="${escapeHtml(r.id)}" title="削除">✕</button>
                  </div>
                  ${r.section ? `<span class=\"reports-item-section\">${escapeHtml(r.section)}</span>` : ''}
                  <div class="reports-item-qa">
                    <div class="reports-item-q">Q: ${escapeHtml(r.question)}</div>
                    <div class="reports-item-a">A: ${escapeHtml(r.answer)}</div>
                  </div>
                </div>
              `).join('')}
            </div>
          `}
        </div>
        ${reports.length > 0 ? `
        <div class="reports-modal-footer">
          <button class="reports-copy-btn" id="reports-copy-btn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
            テキストをコピー
          </button>
          <button class="reports-clear-btn" id="reports-clear-btn">全て削除</button>
        </div>
        ` : ''}
      </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById('reports-close-btn').addEventListener('click', closeReportsOverlay);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeReportsOverlay();
    });

    const copyBtn = document.getElementById('reports-copy-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        const text = exportReportsAsText();
        try {
          await navigator.clipboard.writeText(text);
          copyBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M20 6L9 17l-5-5"/>
            </svg>
            コピーしました
          `;
          copyBtn.classList.add('copied');
          setTimeout(() => {
            copyBtn.innerHTML = `
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
              テキストをコピー
            `;
            copyBtn.classList.remove('copied');
          }, 2000);
        } catch (e) {
          showToast('コピーに失敗しました', 1500);
        }
      });
    }

    const clearBtn = document.getElementById('reports-clear-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (confirm('報告を全て削除しますか？')) {
          clearAllReports();
          closeReportsOverlay();
          renderDeckList();
        }
      });
    }

    overlay.querySelectorAll('.reports-item-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        removeReport(id);
        const item = btn.closest('.reports-item');
        if (item) {
          item.style.animation = 'fadeOut 0.2s ease forwards';
          setTimeout(() => {
            item.remove();
            const remaining = overlay.querySelectorAll('.reports-item');
            if (remaining.length === 0) {
              closeReportsOverlay();
              renderDeckList();
            }
          }, 200);
        }
      });
    });

    requestAnimationFrame(() => {
      overlay.classList.add('show');
    });
  }

  function closeReportsOverlay() {
    const overlay = document.getElementById('reports-overlay');
    if (overlay) {
      overlay.classList.remove('show');
      setTimeout(() => overlay.remove(), 200);
    }
  }

  // === スナックバー ===
  function showSnackbar(message) {
    const snackbar = document.getElementById('flashcard-snackbar');
    const messageEl = document.getElementById('snackbar-message');
    if (snackbar && messageEl) {
      messageEl.textContent = message;
      snackbar.classList.add('show');

      if (state.undoTimer) {
        clearTimeout(state.undoTimer);
      }

      state.undoTimer = setTimeout(() => {
        hideSnackbar();
        state.undoState = null;
      }, 8000);
    }
  }

  function hideSnackbar() {
    const snackbar = document.getElementById('flashcard-snackbar');
    if (snackbar) {
      snackbar.classList.remove('show');
    }
  }

  // === 学習記録 ===
  function markMemorized() {
    const card = state.filteredCards[state.currentIndex];
    if (!card) return;

    saveUndoState('memorized');

    const keyTopicId = card.topicId || state.currentTopicId;
    const key = `${keyTopicId}:${card.originalIndex}`;
    const now = Date.now();
    const prev = state.progress[key] || {};

    const currentInterval = prev.interval || 0;
    const newInterval = currentInterval === 0 ? state.initialInterval : getNextInterval(currentInterval);
    const successCount = (prev.successCount || 0) + 1;

    state.progress[key] = {
      status: 'memorized',
      lastReview: now,
      nextReview: now + newInterval * DAY_MS,
      interval: newInterval,
      successCount: successCount
    };
    saveProgress();
    recordDailyActivity('memorized');

    if (state.currentIndex < state.filteredCards.length - 1) {
      flyCardOut('right', () => {
        next();
        bumpProgress();
        state.combo++;
        updateComboDisplay();
        showSnackbar('覚えたに分類');
      });
    } else {
      if (state.againMode === 'afterRound' && state.againCards.length > 0) {
        startNextRound();
      } else {
        renderCompletionScreen();
      }
    }
  }

  function markAgain() {
    const card = state.filteredCards[state.currentIndex];
    if (!card) return;

    saveUndoState('again');

    const keyTopicId = card.topicId || state.currentTopicId;
    const key = `${keyTopicId}:${card.originalIndex}`;
    const now = Date.now();

    const nextReviewDelay = state.againDelay === 'immediate' ? 0 : DAY_MS;
    state.progress[key] = {
      status: 'again',
      lastReview: now,
      nextReview: now + nextReviewDelay,
      interval: state.againDelay === 'immediate' ? 0 : 1,
      successCount: 0
    };
    saveProgress();
    recordDailyActivity('again');

    if (state.againMode === 'afterRound') {
      state.againCards.push({ ...card, _reinsertCount: 0 });
    } else {
      const reinsertCount = card._reinsertCount || 0;
      if (reinsertCount < 2) {
        const reinsertCard = { ...card, _reinsertCount: reinsertCount + 1 };
        state.filteredCards.push(reinsertCard);
      }
    }

    const isLastCard = state.currentIndex >= state.filteredCards.length - 1;

    if (!isLastCard) {
      flyCardOut('left', () => {
        next();
        bumpProgress();
        state.combo = Math.max(0, state.combo - 3);
        updateComboDisplay();
        showSnackbar(state.againMode === 'afterRound' ? '一周後に再出題' : '最後に再出題');
      });
    } else {
      if (state.againMode === 'afterRound' && state.againCards.length > 0) {
        startNextRound();
      } else {
        renderCompletionScreen();
      }
    }
  }

  function startNextRound() {
    state.currentRound++;
    state.filteredCards = [...state.againCards];
    state.againCards = [];
    state.currentIndex = 0;
    state.isFlipped = false;

    if (state.shuffleEnabled) {
      shuffleArray(state.filteredCards);
    }

    showSnackbar(`${state.currentRound}周目開始（${state.filteredCards.length}枚）`);
    renderCard();
  }

  // === 進捗ポンアニメーション ===
  function bumpProgress() {
    const progressText = document.querySelector('.flashcard-progress-text');
    const progressFill = document.querySelector('.flashcard-progress-fill');
    state.answeredInSession++;
    const isMilestone = state.answeredInSession % 5 === 0;

    if (progressText) {
      progressText.classList.remove('bump', 'milestone-bump');
      if (progressFill) progressFill.classList.remove('milestone');
      void progressText.offsetWidth;

      if (isMilestone) {
        progressText.classList.add('milestone-bump');
        if (progressFill) progressFill.classList.add('milestone');
        spawnMilestoneStars(progressText);
      } else {
        progressText.classList.add('bump');
      }
    }
  }

  function spawnMilestoneStars(anchor) {
    const rect = anchor.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const stars = ['⭐', '✨', '🌟', '💫'];

    for (let i = 0; i < 6; i++) {
      const star = document.createElement('span');
      star.className = 'milestone-star';
      star.textContent = stars[Math.floor(Math.random() * stars.length)];
      star.style.left = centerX + 'px';
      star.style.top = centerY + 'px';
      const angle = (Math.PI * 2 / 6) * i + Math.random() * 0.5;
      const distance = 40 + Math.random() * 30;
      star.style.setProperty('--tx', Math.cos(angle) * distance + 'px');
      star.style.setProperty('--ty', Math.sin(angle) * distance + 'px');
      document.body.appendChild(star);
      setTimeout(() => star.remove(), 700);
    }
  }

  function updateComboDisplay() {
    if (state.combo >= 1) {
      const starCount = Math.min(state.combo, 10);
      spawnComboStars(starCount);
    }
  }

  function spawnComboStars(count) {
    const progressBar = document.querySelector('.flashcard-progress-bar');
    if (!progressBar) return;

    const rect = progressBar.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const stars = ['⭐', '✨', '🌟'];

    for (let i = 0; i < count; i++) {
      const star = document.createElement('span');
      star.className = 'combo-star';
      star.textContent = stars[Math.floor(Math.random() * stars.length)];
      star.style.left = centerX + 'px';
      star.style.top = centerY + 'px';
      const angle = (Math.PI * 2 / count) * i + Math.random() * 0.3;
      const distance = 30 + Math.random() * 20;
      star.style.setProperty('--tx', Math.cos(angle) * distance + 'px');
      star.style.setProperty('--ty', Math.sin(angle) * distance + 'px');
      document.body.appendChild(star);
      setTimeout(() => star.remove(), 500);
    }
  }

  function flyCardOut(direction, callback) {
    const card = document.getElementById('flashcard-card');
    if (!card) {
      callback();
      return;
    }

    card.style.transition = '';
    card.style.transform = '';
    void card.offsetWidth;

    card.classList.add('is-commit', `commit-${direction}`);

    setTimeout(() => {
      card.classList.remove('is-commit', `commit-${direction}`);
      card.classList.add('flying', `fly-${direction}`);

      setTimeout(() => {
        callback();
      }, 280);
    }, 80);
  }

  function renderCompletionScreen() {
    clearSession(state.currentTopicId);
    state.completed = true;

    if (state.currentTopicId === '__daily_ten') {
      markDailyTenCompleted();
    }

    const stats = getTopicStats(state.currentTopicId);
    const cardCount = state.filteredCards.length;

    const specialDeck = isSpecialDeck();

    if (!container) return;
    container.innerHTML = `
      <div class="flashcard-completion">
        <div class="completion-check">
          <svg class="completion-check-svg" viewBox="0 0 52 52">
            <circle class="completion-check-circle" cx="26" cy="26" r="24" fill="none" stroke="currentColor" stroke-width="2"/>
            <path class="completion-check-mark" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" d="M14 27l8 8 16-16"/>
          </svg>
        </div>
        <h2 class="completion-title">おつかれさま</h2>
        <div class="completion-stats">
          <div class="completion-stat">
            <span class="completion-stat-value">${cardCount}</span>
            <span class="completion-stat-label">枚</span>
          </div>
          <div class="completion-stat memorized">
            <span class="completion-stat-value">${stats.memorized}</span>
            <span class="completion-stat-label">覚えた</span>
          </div>
          <div class="completion-stat again">
            <span class="completion-stat-value">${stats.again}</span>
            <span class="completion-stat-label">もう一度</span>
          </div>
        </div>
        <div class="completion-actions">
          ${specialDeck ? `<button class=\"completion-btn primary\" id=\"completion-continue-btn\">もう${state.sessionSize >= 9999 ? '全問' : state.sessionSize + '枚'}やる</button>` : ''}
          <button class="completion-btn ${specialDeck ? 'secondary' : 'primary'}" id="completion-back-btn">デッキに戻る</button>
        </div>
      </div>
    `;

    setTimeout(() => {
      const svg = container.querySelector('.completion-check-svg');
      if (svg) svg.classList.add('animate');
    }, 100);

    document.getElementById('completion-back-btn').addEventListener('click', goBack);

    const continueBtn = document.getElementById('completion-continue-btn');
    if (continueBtn) {
      continueBtn.addEventListener('click', () => {
        startRecommendedDeck();
      });
    }
  }

  // === HTMLまとめ埋め込み ===
  async function loadHtmlSummary(htmlPath, sectionName) {
    const summaryContent = document.getElementById('flashcard-summary-content');
    if (!summaryContent) return;

    try {
      const response = await fetch(encodeURI(htmlPath));
      const html = await response.text();

      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      const summaryEl = document.getElementById('flashcard-summary');

      if (sectionName) {
        const sectionContent = extractSection(doc, sectionName);
        if (sectionContent) {
          summaryContent.innerHTML = sectionContent;
          if (summaryEl) {
            summaryEl.classList.add('has-content');
            if (state.isFlipped) summaryEl.classList.add('show');
          }
          return;
        }
        return;
      }

      summaryContent.innerHTML = doc.body ? doc.body.innerHTML : html;
      if (summaryEl) {
        summaryEl.classList.add('has-content');
        if (state.isFlipped) summaryEl.classList.add('show');
      }
    } catch (e) {
      summaryContent.innerHTML = '<p>まとめの読み込みに失敗しました</p>';
    }
  }

  function normalizeForMatch(str) {
    if (!str) return '';
    return str
      .toLowerCase()
      .replace(/[\s　・、。（）()「」『』【】\-_]/g, '')
      .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
      .replace(/[Ａ-Ｚａ-ｚ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  }

  function extractSection(doc, sectionName) {
    if (!sectionName) return null;

    const normalizedSection = normalizeForMatch(sectionName);

    const keywords = sectionName
      .split(/[\s　・、。（）()「」『』【】\-_]+/)
      .filter(k => k.length >= 2);

    function calcScore(headingText) {
      const normalizedHeading = normalizeForMatch(headingText);

      if (normalizedHeading === normalizedSection) {
        return 100;
      }
      if (normalizedHeading.includes(normalizedSection) || normalizedSection.includes(normalizedHeading)) {
        return 80;
      }
      const matchedKeywords = keywords.filter(k =>
        normalizedHeading.includes(normalizeForMatch(k))
      );
      if (matchedKeywords.length > 0) {
        return (matchedKeywords.length / keywords.length) * 60;
      }
      return 0;
    }

    const h3Elements = doc.querySelectorAll('h3');
    let bestMatch = null;
    let bestScore = 0;
    let matchLevel = 'h3';

    for (const h3 of h3Elements) {
      const h3Text = h3.childNodes[0]?.textContent?.trim() || h3.textContent.trim();
      const score = calcScore(h3Text);

      if (score > bestScore) {
        bestScore = score;
        bestMatch = h3;
      }
      if (score === 100) break;
    }

    if (bestScore < 30) {
      const h2Elements = doc.querySelectorAll('h2');
      for (const h2 of h2Elements) {
        const h2Text = h2.childNodes[0]?.textContent?.trim() || h2.textContent.trim();
        const score = calcScore(h2Text);

        if (score > bestScore) {
          bestScore = score;
          bestMatch = h2;
          matchLevel = 'h2';
        }
        if (score === 100) break;
      }
    }

    if (bestMatch && bestScore >= 30) {
      const content = [bestMatch.outerHTML];
      let sibling = bestMatch.nextElementSibling;
      const stopTags = matchLevel === 'h2' ? ['H2'] : ['H3', 'H2'];

      while (sibling && !stopTags.includes(sibling.tagName)) {
        if (sibling.classList?.contains('question-box')) {
          sibling = sibling.nextElementSibling;
          continue;
        }
        content.push(sibling.outerHTML);
        sibling = sibling.nextElementSibling;
      }

      return content.join('');
    }

    return null;
  }

  // === 問数サイクル切り替え ===
  function cycleSessionSize() {
    const sizes = [10, 20, Infinity];
    const currentIdx = sizes.findIndex(s =>
      s === Infinity ? state.sessionSize >= 9999 : s === state.sessionSize
    );
    const nextIdx = (currentIdx + 1) % sizes.length;
    const newSize = sizes[nextIdx];
    state.sessionSize = newSize === Infinity ? 9999 : newSize;
    localStorage.setItem('flashcard-session-size', state.sessionSize);

    const currentTotal = state.filteredCards.length;
    const effectiveSize = newSize === Infinity ? state.cards.length : newSize;

    if (effectiveSize < currentTotal) {
      const keepCount = Math.max(effectiveSize, state.currentIndex + 1);
      state.filteredCards = state.filteredCards.slice(0, keepCount);
    } else if (effectiveSize > currentTotal && state.cards.length > currentTotal) {
      const currentKeys = new Set(state.filteredCards.map(c =>
        `${c.topicId || state.currentTopicId}:${c.originalIndex}`
      ));
      const additionalCards = state.cards
        .filter(c => !currentKeys.has(`${c.topicId || state.currentTopicId}:${c.originalIndex}`))
        .slice(0, effectiveSize - currentTotal);
      state.filteredCards = [...state.filteredCards, ...additionalCards];
    }

    renderCard();
    const sizeLabel = newSize === Infinity ? '全問' : `${newSize}問`;
    showSnackbar(`${sizeLabel}に変更`);
  }

  // === シャッフルトグル ===
  function toggleShuffle() {
    state.shuffleEnabled = !state.shuffleEnabled;
    localStorage.setItem('flashcard-shuffle', state.shuffleEnabled);

    const btn = document.getElementById('flashcard-shuffle-btn');
    if (btn) {
      btn.classList.toggle('active', state.shuffleEnabled);
    }

    if (state.isActive && state.filteredCards.length > 0) {
      const remainingCards = state.filteredCards.slice(state.currentIndex + 1);

      if (state.shuffleEnabled) {
        for (let i = remainingCards.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [remainingCards[i], remainingCards[j]] = [remainingCards[j], remainingCards[i]];
        }
      } else {
        remainingCards.sort((a, b) => a.originalIndex - b.originalIndex);
      }

      state.filteredCards = [
        ...state.filteredCards.slice(0, state.currentIndex + 1),
        ...remainingCards
      ];
    }
  }

  // === テーブル穴埋めカード関連 ===
  function renderTableOcclusionHTML() {
    const card = tableOcclusionState.currentCard;
    if (!card) return '';

    const { table, occlusions } = card;
    const currentOcc = occlusions[tableOcclusionState.currentOcclusionIndex];

    let html = '<table class="occlusion-table">';

    html += '<tr>';
    for (const header of table.headers) {
      html += '<th>' + header + '</th>';
    }
    html += '</tr>';

    for (let rowIdx = 0; rowIdx < table.rows.length; rowIdx++) {
      const row = table.rows[rowIdx];
      const isCurrentRow = currentOcc && currentOcc.row === rowIdx;
      html += '<tr class="' + (isCurrentRow ? 'current-row' : '') + '">';

      for (let colIdx = 0; colIdx < row.length; colIdx++) {
        const cellValue = row[colIdx];
        const cellKey = rowIdx + '-' + colIdx;
        const isOccluded = currentOcc && currentOcc.row === rowIdx && currentOcc.col === colIdx;
        const isRevealed = tableOcclusionState.revealedCells.has(cellKey);

        if (colIdx === 0) {
          html += '<td class="key-cell">' + cellValue + '</td>';
        } else if (isOccluded && !isRevealed) {
          html += '<td class="occluded-cell">' + cellValue + '</td>';
        } else if (isRevealed) {
          html += '<td class="revealed-cell">' + cellValue + '</td>';
        } else {
          html += '<td>' + cellValue + '</td>';
        }
      }
      html += '</tr>';
    }
    html += '</table>';

    return html;
  }

  function renderTableOcclusionCard() {
    const card = tableOcclusionState.currentCard;
    if (!card) return;

    enterPracticeMode();

    const current = tableOcclusionState.globalOcclusionIndex + 1;
    const total = tableOcclusionState.totalOcclusions;
    const progressPercent = (current / total) * 100;
    const isRevealed = state.isFlipped;

    const currentOcc = card.occlusions[tableOcclusionState.currentOcclusionIndex];
    const rowLabel = card.table.rows[currentOcc.row][0];
    const colLabel = card.table.headers[currentOcc.col];

    if (!container) return;
    container.innerHTML = `
      <div class="flashcard-exercise table-occlusion-mode">
        <div class="flashcard-header">
          <button class="flashcard-back-btn" id="flashcard-back-btn" aria-label="戻る">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
          </button>
          <div class="flashcard-progress-bar">
            <div class="flashcard-progress-fill" style="width: ${progressPercent}%"></div>
            <span class="flashcard-progress-text">${current} / ${total}</span>
          </div>
          <div class="flashcard-header-actions"></div>
        </div>

        <div class="flashcard-stage table-stage">
          <div class="table-card-container">
            <div class="table-card-title">${card.title}</div>
            <div class="table-card-question">
              <span class="question-key">${rowLabel}</span>の<span class="question-label">${colLabel}</span>は？
            </div>
            <div class="table-card-table" id="table-card-table">
              ${renderTableOcclusionHTML()}
            </div>
            ${isRevealed ? '' : '<div class="table-tap-hint">タップで答え</div>'}
          </div>
        </div>

        <div class="flashcard-action-bar ${isRevealed ? 'show' : ''}">
          <button class="flashcard-btn again" id="flashcard-again-btn">もう一度</button>
          <button class="flashcard-btn memorized" id="flashcard-memorized-btn">覚えた</button>
        </div>
      </div>
    `;

    bindTableOcclusionEvents();
  }

  function bindTableOcclusionEvents() {
    document.getElementById('flashcard-back-btn').addEventListener('click', goBack);

    const stageEl = document.querySelector('.table-stage');
    if (stageEl) {
      stageEl.addEventListener('click', function() {
        if (!state.isFlipped) {
          revealTableOcclusion();
        }
      });
    }

    document.getElementById('flashcard-again-btn').addEventListener('click', handleTableAgain);
    document.getElementById('flashcard-memorized-btn').addEventListener('click', handleTableMemorized);
  }

  function revealTableOcclusion() {
    const card = tableOcclusionState.currentCard;
    state.isFlipped = true;
    const currentOcc = card.occlusions[tableOcclusionState.currentOcclusionIndex];
    const cellKey = currentOcc.row + '-' + currentOcc.col;
    tableOcclusionState.revealedCells.add(cellKey);
    renderTableOcclusionCard();
  }

  function advanceTableOcclusion() {
    const card = tableOcclusionState.currentCard;
    tableOcclusionState.currentOcclusionIndex++;
    tableOcclusionState.globalOcclusionIndex++;
    state.isFlipped = false;

    if (tableOcclusionState.currentOcclusionIndex >= card.occlusions.length) {
      const deck = tableOcclusionState.currentDeck;
      tableOcclusionState.currentCardIndex++;
      if (tableOcclusionState.currentCardIndex < deck.cards.length) {
        tableOcclusionState.currentCard = deck.cards[tableOcclusionState.currentCardIndex];
        tableOcclusionState.currentOcclusionIndex = 0;
        tableOcclusionState.revealedCells.clear();
        renderTableOcclusionCard();
      } else {
        renderTableDeckComplete();
      }
    } else {
      renderTableOcclusionCard();
    }
  }

  function handleTableAgain() {
    advanceTableOcclusion();
  }

  function handleTableMemorized() {
    advanceTableOcclusion();
  }

  function renderTableDeckComplete() {
    tableOcclusionState.isTableCard = false;
    if (!container) return;
    container.innerHTML = `
      <div class="flashcard-complete">
        <div class="complete-icon">✓</div>
        <h2>完了！</h2>
        <p>すべての穴埋めを終了しました</p>
        <button class="flashcard-back-btn-large" id="flashcard-back-btn">戻る</button>
      </div>
    `;
    document.getElementById('flashcard-back-btn').addEventListener('click', goBack);
  }

  function renderInlineTableCard(card) {
    const { table, occlusions, currentOcclusionIndex } = card;
    const currentOcc = occlusions[currentOcclusionIndex];
    const current = state.currentIndex + 1;
    const total = state.filteredCards.length;
    const progressPercent = (current / total) * 100;
    const isRevealed = state.isFlipped;

    const rowLabel = table.rows[currentOcc.row][0];
    const colLabel = table.headers[currentOcc.col];

    let tableHtml = '<table class="occlusion-table">';
    tableHtml += '<tr>';
    for (const header of table.headers) {
      tableHtml += '<th>' + header + '</th>';
    }
    tableHtml += '</tr>';

    for (let rowIdx = 0; rowIdx < table.rows.length; rowIdx++) {
      const row = table.rows[rowIdx];
      const isCurrentRow = currentOcc && currentOcc.row === rowIdx;
      tableHtml += '<tr class="' + (isCurrentRow ? 'current-row' : '') + '">';

      for (let colIdx = 0; colIdx < row.length; colIdx++) {
        const cellValue = row[colIdx];
        const isOccluded = currentOcc && currentOcc.row === rowIdx && currentOcc.col === colIdx;

        if (colIdx === 0) {
          tableHtml += '<td class="key-cell">' + cellValue + '</td>';
        } else if (isOccluded && !isRevealed) {
          tableHtml += '<td class="occluded-cell">' + cellValue + '</td>';
        } else if (isOccluded && isRevealed) {
          tableHtml += '<td class="revealed-cell">' + cellValue + '</td>';
        } else {
          tableHtml += '<td>' + cellValue + '</td>';
        }
      }
      tableHtml += '</tr>';
    }
    tableHtml += '</table>';

    if (!container) return;
    container.innerHTML = `
      <div class="flashcard-exercise table-occlusion-mode">
        <div class="flashcard-header">
          <button class="flashcard-back-btn" id="flashcard-back-btn" aria-label="戻る">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
          </button>
          <div class="flashcard-progress-bar">
            <div class="flashcard-progress-fill" style="width: ${progressPercent}%"></div>
            <span class="flashcard-progress-text">${current} / ${total}</span>
          </div>
          <div class="flashcard-header-actions"></div>
        </div>

        <div class="flashcard-stage table-stage">
          <div class="table-card-container">
            <div class="table-card-title">${card.title}</div>
            <div class="table-card-question">
              <span class="question-key">${rowLabel}</span>の<span class="question-label">${colLabel}</span>は？
            </div>
            <div class="table-card-table" id="table-card-table">
              ${tableHtml}
            </div>
            ${isRevealed ? '' : '<div class="table-tap-hint">タップで答え</div>'}
          </div>
        </div>

        <div class="flashcard-action-bar ${isRevealed ? 'show' : ''}">
          <button class="flashcard-btn again" id="flashcard-again-btn">もう一度</button>
          <button class="flashcard-btn memorized" id="flashcard-memorized-btn">覚えた</button>
        </div>
      </div>
    `;

    bindInlineTableEvents();
  }

  function bindInlineTableEvents() {
    document.getElementById('flashcard-back-btn').addEventListener('click', goBack);

    const stageEl = document.querySelector('.table-stage');
    if (stageEl) {
      stageEl.addEventListener('click', function() {
        if (!state.isFlipped) {
          revealInlineTableCell();
        }
      });
    }

    document.getElementById('flashcard-again-btn').addEventListener('click', advanceInlineTable);
    document.getElementById('flashcard-memorized-btn').addEventListener('click', advanceInlineTable);
  }

  function revealInlineTableCell() {
    state.isFlipped = true;
    const card = state.filteredCards[state.currentIndex];
    renderInlineTableCard(card);
  }

  function advanceInlineTable() {
    state.isFlipped = false;
    state.currentIndex++;

    if (state.currentIndex >= state.filteredCards.length) {
      renderCompletionScreen();
    } else {
      renderCard();
    }
  }

  // === Utilities ===
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  return {
    setContainer,
    renderCard,
    renderNoCardsMessage,
    enterPracticeMode,
    exitPracticeMode,
    flip,
    next,
    prev,
    markMemorized,
    markAgain,
    startNextRound,
    bumpProgress,
    updateComboDisplay,
    showToast,
    showSnackbar,
    hideSnackbar,
    reportCurrentCard,
    reportCardFromList,
    toggleFavoriteCurrentCard,
    getReports,
    removeReport,
    clearAllReports,
    exportReportsAsText,
    showStatusHelpModal,
    openReportsOverlay,
    closeReportsOverlay,
    loadHtmlSummary,
    renderTableOcclusionCard,
    renderInlineTableCard
  };
}
