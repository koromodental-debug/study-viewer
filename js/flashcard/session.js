// Session and deck start logic.
// Extracted from js/flashcard.js (no runtime wiring yet).

export function createSessionManager(deps) {
  const state = deps.state;
  const tableOcclusionState = deps.tableOcclusionState;
  const getDATA = deps.getDATA || (() => []);
  const SESSIONS_KEY = deps.SESSIONS_KEY || 'studyViewer_flashcardSessions';
  const DAY_MS = deps.DAY_MS || 24 * 60 * 60 * 1000;

  const parseQAToCards = deps.parseQAToCards || (() => []);
  const parseJSONToCards = deps.parseJSONToCards || (() => []);
  const applyCustomizations = deps.applyCustomizations || ((cards) => cards);
  const loadAllCardsIndex = deps.loadAllCardsIndex || (async () => []);
  const searchCards = deps.searchCards || (() => []);

  const renderCard = deps.renderCard || (() => {});
  const renderNoCardsMessage = deps.renderNoCardsMessage || (() => {});
  const renderDeckList = deps.renderDeckList || (() => {});
  const exitPracticeMode = deps.exitPracticeMode || (() => {});
  const updateAccordionPillVisibility = deps.updateAccordionPillVisibility || (() => {});
  const showToast = deps.showToast || (() => {});

  const getSession = deps.getSession || ((topicId) => internalGetSession(topicId));
  const saveSession = deps.saveSession || (() => internalSaveSession());

  const getNextInterval = deps.getNextInterval || ((n) => n);
  const saveProgress = deps.saveProgress || (() => {});

  const FirebaseSyncRef = deps.FirebaseSyncRef;
  const FirebaseSync = FirebaseSyncRef || (typeof globalThis !== 'undefined' ? globalThis.FirebaseSync : undefined);

  let container = deps.container || null;
  function setContainer(el) {
    container = el;
  }

  // === トピック読み込み ===
  async function loadTopic(topicId, shuffle = false) {
    if (topicId === 'kokoshika_hisshu') {
      state.currentTopicId = topicId;
      state.currentTopic = {
        id: 'kokoshika_hisshu',
        title: '必修ココシカ',
        subject: '必修',
        qaPath: 'deck/必修ココシカ.txt'
      };
      try {
        const response = await fetch('deck/必修ココシカ.txt');
        const text = await response.text();
        return loadTopicFromText(text, topicId, shuffle);
      } catch (e) {
        console.log('ココシカ読み込みエラー:', e);
        if (container) {
          container.innerHTML = `<div class="flashcard-error">ココシカの読み込みに失敗しました</div>`;
        }
        return;
      }
    }

    const topic = getDATA().find(d => d.id === topicId);
    if (!topic) return;

    state.currentTopicId = topicId;
    state.currentTopic = topic;

    if (topic.localJsonData) {
      try {
        const cards = parseJSONToCards(topic.localJsonData, topicId);
        loadTopicFromCards(cards, topicId, shuffle);
      } catch (e) {
        console.log('ローカルJSON読み込みエラー:', e);
        if (container) {
          container.innerHTML = `<div class="flashcard-error">デッキの読み込みに失敗しました</div>`;
        }
      }
      return;
    }

    if (!topic.qaPath) return;

    try {
      const response = await fetch(encodeURI(topic.qaPath));

      if (topic.qaPath.endsWith('.json')) {
        const jsonData = await response.json();
        const cards = parseJSONToCards(jsonData, topicId);
        loadTopicFromCards(cards, topicId, shuffle);
      } else {
        const text = await response.text();
        loadTopicFromText(text, topicId, shuffle);
      }
    } catch (e) {
      console.log('Q&A読み込みエラー:', e);
      if (container) {
        container.innerHTML = `<div class="flashcard-error">Q&Aの読み込みに失敗しました</div>`;
      }
    }
  }

  function loadTopicFromCards(cards, topicId, shuffle = false) {
    state.cards = cards;

    if (state.isReviewMode) {
      state.filteredCards = state.cards.filter((card, idx) => {
        const key = `${topicId}:${idx}`;
        return state.progress[key] && state.progress[key].status === 'again';
      });
    } else {
      state.filteredCards = [...state.cards];
    }

    let savedIndex = 0;
    const session = getSession(topicId);

    if (session) {
      if (session.order && session.order.length === state.filteredCards.length) {
        const orderMap = new Map(state.filteredCards.map(c => [c.originalIndex, c]));
        const reordered = session.order.map(idx => orderMap.get(idx)).filter(Boolean);
        if (reordered.length === state.filteredCards.length) {
          state.filteredCards = reordered;
        }
      }
      if (session.index !== undefined && session.index > 0) {
        savedIndex = Math.min(session.index, state.filteredCards.length - 1);
      }
    } else if (state.shuffleEnabled && state.filteredCards.length > 0) {
      shuffleArray(state.filteredCards);
    }

    state.currentIndex = savedIndex;
    state.isFlipped = false;
    state.isActive = true;
    state.completed = false;
    state.answeredInSession = 0;
    state.combo = 0;
    state.againCards = [];
    state.currentRound = 1;

    if (state.filteredCards.length === 0) {
      renderNoCardsMessage();
    } else {
      renderCard();
    }
  }

  function loadTopicFromText(text, topicId, shuffle = false) {
    let cards = parseQAToCards(text, topicId);
    cards = applyCustomizations(cards, topicId);
    state.cards = cards;

    if (state.isReviewMode) {
      state.filteredCards = state.cards.filter((card, idx) => {
        const key = `${topicId}:${idx}`;
        return state.progress[key] && state.progress[key].status === 'again';
      });
    } else {
      state.filteredCards = [...state.cards];
    }

    let savedIndex = 0;
    const session = getSession(topicId);

    if (session) {
      if (session.order && session.order.length === state.filteredCards.length) {
        const orderMap = new Map(state.filteredCards.map(c => [c.originalIndex, c]));
        const reordered = session.order.map(idx => orderMap.get(idx)).filter(Boolean);
        if (reordered.length === state.filteredCards.length) {
          state.filteredCards = reordered;
        }
      }
      if (session.index !== undefined && session.index > 0) {
        savedIndex = Math.min(session.index, state.filteredCards.length - 1);
      }
    } else if (state.shuffleEnabled && state.filteredCards.length > 0) {
      shuffleArray(state.filteredCards);
    }

    state.currentIndex = savedIndex;
    state.isFlipped = false;
    state.isActive = true;
    state.completed = false;
    state.answeredInSession = 0;
    state.combo = 0;
    state.againCards = [];
    state.currentRound = 1;

    if (state.filteredCards.length === 0) {
      renderNoCardsMessage();
    } else {
      renderCard();
    }
  }

  async function startDeck(topicId) {
    const topic = getDATA().find(d => d.id === topicId);
    if (!topic || !topic.qaPath) return;

    state.isActive = true;
    state.completed = false;
    state.answeredInSession = 0;
    state.combo = 0;
    state.againCards = [];
    state.currentRound = 1;
    state.isReviewMode = false;
    state.currentIndex = 0;

    await loadTopic(topicId, state.shuffleEnabled);

    renderCard();
  }

  // === 今日の10問 ===
  function getDailyRandomSeed() {
    const today = new Date().toDateString();
    let hash = 0;
    for (let i = 0; i < today.length; i++) {
      hash = ((hash << 5) - hash) + today.charCodeAt(i);
      hash = hash & hash;
    }
    return hash;
  }

  function isDailyTenCompleted() {
    const completedDate = localStorage.getItem('flashcard-daily-ten-completed');
    const today = new Date().toDateString();
    return completedDate === today;
  }

  function markDailyTenCompleted() {
    const today = new Date().toDateString();
    localStorage.setItem('flashcard-daily-ten-completed', today);
  }

  function seededRandom(seed) {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
  }

  async function collectDailyTenCardRefs() {
    const seed = getDailyRandomSeed();

    const topicsWithQA = getDATA().filter(item => item.qaPath);

    if (topicsWithQA.length === 0) {
      return [];
    }

    const shuffledTopics = [...topicsWithQA];
    let currentSeed = seed;
    for (let i = shuffledTopics.length - 1; i > 0; i--) {
      currentSeed = (currentSeed * 9301 + 49297) % 233280;
      const j = Math.floor((currentSeed / 233280) * (i + 1));
      [shuffledTopics[i], shuffledTopics[j]] = [shuffledTopics[j], shuffledTopics[i]];
    }

    const selectedTopics = shuffledTopics.slice(0, 10);

    const cardRefs = await Promise.all(selectedTopics.map(async (topic, idx) => {
      try {
        let qaPath = topic.qaPath;
        if (qaPath.endsWith('.json')) {
          const txtPath = qaPath.replace('.json', '.txt');
          try {
            const txtResponse = await fetch(txtPath);
            if (txtResponse.ok) {
              qaPath = txtPath;
            }
          } catch (e) {
            // fallback
          }
        }

        const response = await fetch(qaPath);
        if (!response.ok) return null;

        let allQA = [];

        if (qaPath.endsWith('.json')) {
          const qaData = await response.json();
          let cardIdx = 0;
          for (const section of qaData.sections || []) {
            for (let i = 0; i < (section.qa || []).length; i++) {
              const qa = section.qa[i];
              if (!qa.choices) {
                allQA.push({ cardIndex: cardIdx });
              }
              cardIdx++;
            }
          }
        } else {
          const text = await response.text();
          const lines = text.split('\n');
          let cardIdx = 0;
          for (const line of lines) {
            if (line.startsWith('Q:') || line.startsWith('Q：')) {
              allQA.push({ cardIndex: cardIdx });
              cardIdx++;
            }
          }
        }

        if (allQA.length === 0) return null;

        const topicSeed = seed + idx * 12345;
        const randomIndex = Math.abs(topicSeed) % allQA.length;
        const selected = allQA[randomIndex];

        return {
          topicId: topic.id,
          cardIndex: selected.cardIndex,
          key: `${topic.id}:${selected.cardIndex}`
        };
      } catch (e) {
        console.warn(`[collectDailyTenCardRefs] ${topic.id}の読み込みに失敗:`, e);
        return null;
      }
    }));

    return cardRefs.filter(ref => ref !== null);
  }

  async function fetchCardsFromRefs(cardRefs) {
    const validRefs = cardRefs.filter(r => r && r.topicId);
    const uniqueTopicIds = [...new Set(validRefs.map(r => r.topicId))];
    const topicCardsMap = new Map();

    const fetchTasks = [];
    for (const topicId of uniqueTopicIds) {
      let topic, qaPath;

      if (topicId === 'kokoshika_hisshu') {
        topic = { id: 'kokoshika_hisshu', title: '必修ココシカ', subject: '必修' };
        qaPath = 'deck/必修ココシカ.txt';
      } else {
        topic = getDATA().find(d => d.id === topicId);
        if (!topic) {
          topic = getDATA().find(d => d.id.includes(topicId) || d.id.endsWith('_' + topicId.toLowerCase()));
        }
        if (!topic) {
          topic = getDATA().find(d => d.title === topicId || topicId.includes(d.title));
        }
        qaPath = topic?.qaPath;
      }

      if (topic && topic.localJsonData) {
        try {
          const cards = parseJSONToCards(topic.localJsonData, topicId);
          topicCardsMap.set(topicId, { cards, topic });
        } catch (e) {
          console.log(`ローカルJSON読み込みエラー (${topicId}):`, e);
        }
        continue;
      }

      if (!qaPath && topic && topic.category) {
        const parts = topic.category.split('/');
        const subject = parts[0];
        const idParts = topic.id.split('_');
        const fileName = idParts.slice(1).join('_');
        qaPath = `qa/subject/${subject}/${fileName}.json`;
      }

      if (!topic || !qaPath) continue;

      fetchTasks.push({ topicId, topic, qaPath });
    }

    await Promise.all(fetchTasks.map(async ({ topicId, topic, qaPath }) => {
      try {
        let allCards = [];

        const response = await fetch(encodeURI(qaPath));
        if (response.ok) {
          const contentType = response.headers.get('content-type');
          if (qaPath.endsWith('.json') || (contentType && contentType.includes('json'))) {
            const jsonData = await response.json();
            allCards = parseJSONToCards(jsonData, topicId);
          } else {
            const text = await response.text();
            allCards = parseQAToCards(text, topicId);
          }
        }

        if (qaPath.endsWith('.json')) {
          const txtPath = qaPath.replace('.json', '.txt');
          try {
            const txtResponse = await fetch(encodeURI(txtPath));
            if (txtResponse.ok) {
              const text = await txtResponse.text();
              const altCards = parseQAToCards(text, topicId);
              allCards = mergeCardsPreserveIndex(allCards, altCards);
            }
          } catch (e) {
            // ignore
          }
        }

        if (allCards.length > 0) {
          allCards.forEach((card, idx) => {
            card.topicId = topicId;
            card.originalIndex = card.originalIndex ?? idx;
            card.progressKey = `${topicId}:${card.originalIndex}`;
            card.topicTitle = topic.title;
            card.htmlPath = card.htmlPath || topic.htmlPath;
          });
          topicCardsMap.set(topicId, { cards: allCards, topic });
        }
      } catch (e) {
        console.log(`QA読み込みエラー (${topicId}):`, e);
      }
    }));

    const filteredCards = [];
    for (const ref of validRefs) {
      const topicData = topicCardsMap.get(ref.topicId);
      if (topicData) {
        const card = topicData.cards.find(c => c.originalIndex === ref.cardIndex);
        if (card) {
          filteredCards.push({
            ...card,
            topicTitle: topicData.topic.title,
            htmlPath: topicData.topic.htmlPath
          });
        }
      }
    }

    return filteredCards;
  }

  function mergeCardsPreserveIndex(primaryCards, altCards) {
    if (!primaryCards || primaryCards.length === 0) return altCards || [];
    if (!altCards || altCards.length === 0) return primaryCards || [];

    const merged = [...primaryCards];
    const byIndex = new Map(altCards.map(c => [c.originalIndex, c]));
    for (let i = 0; i < merged.length; i++) {
      const alt = byIndex.get(merged[i].originalIndex);
      if (alt) {
        merged[i] = { ...merged[i], ...alt };
      }
    }
    return merged;
  }

  async function startDailyTenDeck() {
    console.log('[startDailyTenDeck] 開始');
    const cardRefs = await collectDailyTenCardRefs();

    if (cardRefs.length === 0) {
      showToast('カードの読み込みに失敗しました', 2000);
      return;
    }

    const filteredCards = await fetchCardsFromRefs(cardRefs);
    if (filteredCards.length === 0) {
      showToast('カードの読み込みに失敗しました', 2000);
      return;
    }

    state.currentTopicId = '__daily_ten';
    state.currentTopic = { title: '今日の10問' };
    state.cards = filteredCards;
    state.filteredCards = [...filteredCards];
    state.currentIndex = 0;
    state.isFlipped = false;
    state.isActive = true;
    state.completed = false;
    state.answeredInSession = 0;
    state.combo = 0;
    state.againCards = [];
    state.currentRound = 1;

    for (let i = state.filteredCards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [state.filteredCards[i], state.filteredCards[j]] = [state.filteredCards[j], state.filteredCards[i]];
    }

    renderCard();
  }

  // === ステータスデッキ ===
  function collectStatusCardRefs(status) {
    const cardRefs = [];
    const now = Date.now();
    const MASTERY_THRESHOLD = 14;

    for (const [key, value] of Object.entries(state.progress)) {
      const isDue = state.cramMode ? true : (value.nextReview && value.nextReview <= now);
      const interval = value.interval || 0;

      if (status === 'again') {
        if (value.status === 'again') {
          if (!value.nextReview || isDue) {
            const [topicId, cardIndex] = key.split(':');
            cardRefs.push({ topicId, cardIndex: parseInt(cardIndex), key });
          }
        } else if (value.status === 'memorized' && isDue) {
          const [topicId, cardIndex] = key.split(':');
          cardRefs.push({ topicId, cardIndex: parseInt(cardIndex), key });
        }
      } else if (status === 'learning') {
        if (value.status === 'memorized' && !isDue && interval < MASTERY_THRESHOLD) {
          const [topicId, cardIndex] = key.split(':');
          cardRefs.push({ topicId, cardIndex: parseInt(cardIndex), key });
        }
      } else if (status === 'mastered') {
        if (value.status === 'memorized' && !isDue && interval >= MASTERY_THRESHOLD) {
          const [topicId, cardIndex] = key.split(':');
          cardRefs.push({ topicId, cardIndex: parseInt(cardIndex), key });
        }
      } else if (status === 'memorized') {
        if (value.status === 'memorized' && !isDue) {
          const [topicId, cardIndex] = key.split(':');
          cardRefs.push({ topicId, cardIndex: parseInt(cardIndex), key });
        }
      }
    }
    return cardRefs;
  }

  async function startStatusDeck(status) {
    console.log('[startStatusDeck] 開始:', status);
    const cardRefs = collectStatusCardRefs(status);
    console.log('[startStatusDeck] cardRefs:', cardRefs.length);

    if (cardRefs.length === 0) {
      showToast('対象のカードがありません', 2000);
      return;
    }

    const filteredCards = await fetchCardsFromRefs(cardRefs);
    if (filteredCards.length === 0) {
      showToast('カードの読み込みに失敗しました', 2000);
      return;
    }

    state.currentTopicId = `__status_${status}`;
    state.currentTopic = { title: status };
    state.cards = filteredCards;
    state.filteredCards = [...filteredCards];
    state.currentIndex = 0;
    state.isFlipped = false;
    state.isActive = true;
    state.completed = false;
    state.answeredInSession = 0;
    state.combo = 0;
    state.againCards = [];
    state.currentRound = 1;

    for (let i = state.filteredCards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [state.filteredCards[i], state.filteredCards[j]] = [state.filteredCards[j], state.filteredCards[i]];
    }

    renderCard();
  }

  async function startSubjectDeck(subject) {
    console.log('[startSubjectDeck] 開始:', subject);

    const topics = getDATA().filter(d => d.subject === subject);
    if (topics.length === 0) {
      showToast('対象のトピックがありません', 2000);
      return;
    }

    const allCards = await fetchAllCardsFromTopics(topics);
    if (allCards.length === 0) {
      showToast('カードの読み込みに失敗しました', 2000);
      return;
    }

    state.currentTopicId = '__subject_' + subject;
    state.currentTopic = { title: subject + '（全体）' };
    state.cards = allCards;
    state.filteredCards = [...allCards];
    state.currentIndex = 0;
    state.isFlipped = false;
    state.isActive = true;
    state.completed = false;
    state.answeredInSession = 0;
    state.combo = 0;
    state.againCards = [];
    state.currentRound = 1;

    for (let i = state.filteredCards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [state.filteredCards[i], state.filteredCards[j]] = [state.filteredCards[j], state.filteredCards[i]];
    }

    console.log('[startSubjectDeck] カード数:', state.filteredCards.length);
    renderCard();
  }

  async function startGroupDeck(topicIds, groupName) {
    console.log('[startGroupDeck] 開始:', groupName, topicIds);

    const topics = topicIds.map(id => getDATA().find(d => d.id === id)).filter(Boolean);
    if (topics.length === 0) {
      showToast('対象のトピックがありません', 2000);
      return;
    }

    const allCards = await fetchAllCardsFromTopics(topics);
    if (allCards.length === 0) {
      showToast('カードの読み込みに失敗しました', 2000);
      return;
    }

    state.currentTopicId = '__group_' + groupName;
    state.currentTopic = { title: groupName };
    state.cards = allCards;
    state.filteredCards = [...allCards];
    state.currentIndex = 0;
    state.isFlipped = false;
    state.isActive = true;
    state.completed = false;
    state.answeredInSession = 0;
    state.combo = 0;
    state.againCards = [];
    state.currentRound = 1;

    for (let i = state.filteredCards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [state.filteredCards[i], state.filteredCards[j]] = [state.filteredCards[j], state.filteredCards[i]];
    }

    console.log('[startGroupDeck] カード数:', state.filteredCards.length);
    renderCard();
  }

  async function fetchAllCardsFromTopics(topics) {
    const allCards = [];

    for (const topic of topics) {
      try {
        let cards;

        if (topic.localJsonData) {
          cards = parseJSONToCards(topic.localJsonData, topic.id);
        } else {
          let qaPath = topic.qaPath;

          if (!qaPath && topic.category) {
            const parts = topic.category.split('/');
            const subject = parts[0];
            const idParts = topic.id.split('_');
            const fileName = idParts.slice(1).join('_');
            qaPath = `qa/subject/${subject}/${fileName}.json`;
          }

          if (!qaPath) continue;

          const response = await fetch(encodeURI(qaPath));
          if (!response.ok) continue;

          const contentType = response.headers.get('content-type');

          if (qaPath.endsWith('.json') || (contentType && contentType.includes('json'))) {
            const jsonData = await response.json();
            cards = parseJSONToCards(jsonData, topic.id);
          } else {
            const text = await response.text();
            cards = parseQAToCards(text, topic.id);
          }
        }

        cards.forEach((card, idx) => {
          card.topicId = topic.id;
          card.originalIndex = idx;
          card.progressKey = `${topic.id}:${idx}`;
          card.topicTitle = topic.title;
        });

        allCards.push(...cards);
      } catch (e) {
        console.log(`QA読み込みエラー (${topic.id}):`, e);
      }
    }

    return allCards;
  }

  // === 検索結果デッキ ===
  function startSearchResultsDeck() {
    const results = state.cardSearch.results;
    const query = state.cardSearch.query;

    if (results.length === 0 || !query) {
      return;
    }

    const cardResults = results.filter(item => item.type !== 'summary');
    if (cardResults.length === 0) {
      return;
    }

    const filteredCards = cardResults.map(card => ({
      ...card,
      htmlPath: getDATA().find(d => d.id === card.topicId)?.htmlPath || null
    }));

    state.currentTopicId = `__search_${query}`;
    state.currentTopic = { title: `検索:${query}` };
    state.cards = filteredCards;
    state.filteredCards = [...filteredCards];
    state.currentIndex = 0;
    state.isFlipped = false;
    state.isActive = true;
    state.completed = false;
    state.answeredInSession = 0;
    state.combo = 0;
    state.againCards = [];
    state.currentRound = 1;

    const session = getSession(state.currentTopicId);
    if (session && session.order && session.order.length === state.filteredCards.length) {
      const orderMap = new Map(state.filteredCards.map(c => [c.searchKey, c]));
      const reordered = session.order.map(key => orderMap.get(key)).filter(Boolean);
      if (reordered.length === state.filteredCards.length) {
        state.filteredCards = reordered;
      }
      if (session.index !== undefined && session.index > 0) {
        state.currentIndex = Math.min(session.index, state.filteredCards.length - 1);
      }
    } else if (state.shuffleEnabled) {
      for (let i = state.filteredCards.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [state.filteredCards[i], state.filteredCards[j]] = [state.filteredCards[j], state.filteredCards[i]];
      }
    }

    state.cardSearch.query = '';
    state.cardSearch.results = [];
    state.cardSearch.expandedKeys = new Set();

    renderCard();
  }

  async function resumeSearchDeck(topicId) {
    const query = topicId.replace('__search_', '');
    const session = getSession(topicId);

    if (!session || !session.order || session.order.length === 0) {
      renderDeckList();
      return;
    }

    if (!state.cardSearch.allCardsIndex) {
      if (container) {
        container.innerHTML = `
          <div class="card-search-screen">
            <div class="card-search-loading">カードを読み込み中...</div>
          </div>
        `;
      }
      await loadAllCardsIndex();
    }

    const allCards = state.cardSearch.allCardsIndex;
    const cardMap = new Map(allCards.map(c => [c.searchKey, c]));

    const filteredCards = session.order
      .map(key => cardMap.get(key))
      .filter(Boolean)
      .map(card => ({
        ...card,
        htmlPath: getDATA().find(d => d.id === card.topicId)?.htmlPath || null
      }));

    if (filteredCards.length === 0) {
      renderDeckList();
      return;
    }

    state.currentTopicId = topicId;
    state.currentTopic = { title: `検索:${query}` };
    state.cards = filteredCards;
    state.filteredCards = [...filteredCards];
    state.currentIndex = session.index !== undefined ? Math.min(session.index, filteredCards.length - 1) : 0;
    state.isFlipped = false;
    state.isActive = true;
    state.completed = false;
    state.answeredInSession = 0;
    state.combo = 0;
    state.againCards = [];
    state.currentRound = 1;

    state.cardSearch.query = '';
    state.cardSearch.results = [];
    state.cardSearch.expandedKeys = new Set();

    renderCard();
  }

  // === 新規のみデッキ ===
  async function startNewOnlyDeck() {
    const targetCount = state.sessionSize;
    const cardRefs = [];

    const topicsWithQa = getDATA().filter(d => d.qaPath || d.localJsonData);
    for (const topic of topicsWithQa) {
      if (cardRefs.length >= targetCount) break;

      const topicKeys = Object.keys(state.progress).filter(k => k.startsWith(topic.id + ':'));
      const learnedIndices = new Set(topicKeys.map(k => parseInt(k.split(':')[1])));

      for (let i = 0; i < 100 && cardRefs.length < targetCount; i++) {
        if (!learnedIndices.has(i)) {
          cardRefs.push({ topicId: topic.id, cardIndex: i, key: `${topic.id}:${i}` });
        }
      }
    }

    if (cardRefs.length === 0) return;

    const uniqueTopicIds = [...new Set(cardRefs.map(r => r.topicId))];
    const topicCardsMap = new Map();

    for (const topicId of uniqueTopicIds) {
      const topic = getDATA().find(d => d.id === topicId);
      if (!topic || !topic.qaPath) continue;

      try {
        const response = await fetch(encodeURI(topic.qaPath));
        let cards;
        if (topic.qaPath.endsWith('.json')) {
          const jsonData = await response.json();
          cards = parseJSONToCards(jsonData, topicId);
        } else {
          const text = await response.text();
          cards = parseQAToCards(text, topicId);
        }
        topicCardsMap.set(topicId, { cards, topic });
      } catch (e) {
        console.log(`QA読み込みエラー (${topicId}):`, e);
      }
    }

    const filteredCards = [];
    for (const ref of cardRefs) {
      const topicData = topicCardsMap.get(ref.topicId);
      if (topicData) {
        const card = topicData.cards.find(c => c.originalIndex === ref.cardIndex);
        if (card) {
          filteredCards.push({
            ...card,
            topicTitle: topicData.topic.title,
            htmlPath: topicData.topic.htmlPath
          });
        }
      }
    }

    if (filteredCards.length === 0) return;

    state.currentTopicId = '__new_only';
    state.currentTopic = { title: '新規カード' };
    state.cards = filteredCards;
    state.filteredCards = [...filteredCards];
    state.currentIndex = 0;
    state.isFlipped = false;
    state.isActive = true;
    state.completed = false;
    state.answeredInSession = 0;
    state.combo = 0;
    state.againCards = [];
    state.currentRound = 1;

    for (let i = state.filteredCards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [state.filteredCards[i], state.filteredCards[j]] = [state.filteredCards[j], state.filteredCards[i]];
    }

    if (state.filteredCards.length > state.sessionSize) {
      state.filteredCards = state.filteredCards.slice(0, state.sessionSize);
    }

    renderCard();
  }

  // === お気に入りデッキ（演習開始） ===
  async function startFavoriteDeck(cleanupOrphanedFavorites = () => 0) {
    const removedCount = cleanupOrphanedFavorites();
    if (removedCount > 0) {
      console.log('[Favorites] クリーンアップ完了:', removedCount, '件');
    }

    const FavoritesManager = deps.FavoritesManager || (typeof globalThis !== 'undefined' ? globalThis.FavoritesManager : undefined);
    if (!FavoritesManager) return;

    const allFavorites = FavoritesManager.getAll();
    const favorites = allFavorites.filter(f => f.type === 'qa');
    if (favorites.length === 0) return;

    const cardRefs = favorites.map(f => ({
      topicId: f.topicId,
      cardIndex: parseInt(f.cardIndex),
      key: `${f.topicId}:${f.cardIndex}`
    }));

    const filteredCards = await fetchCardsFromRefs(cardRefs);
    if (filteredCards.length === 0) return;

    state.currentTopicId = '__favorites';
    state.currentTopic = { title: 'お気に入り' };
    state.cards = filteredCards;
    state.filteredCards = [...filteredCards];
    state.currentIndex = 0;
    state.isFlipped = false;
    state.isActive = true;
    state.completed = false;
    state.answeredInSession = 0;
    state.combo = 0;
    state.againCards = [];
    state.currentRound = 1;

    for (let i = state.filteredCards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [state.filteredCards[i], state.filteredCards[j]] = [state.filteredCards[j], state.filteredCards[i]];
    }

    if (state.filteredCards.length > state.sessionSize) {
      state.filteredCards = state.filteredCards.slice(0, state.sessionSize);
    }

    renderCard();
  }

  function startSubjectDeckFromCards(allCards, subject) {
    state.currentTopicId = '__subject_' + subject;
    state.currentTopic = { title: subject + '（全体）' };
    state.cards = allCards;
    state.filteredCards = [...allCards];
    state.currentIndex = 0;
    state.isFlipped = false;
    state.isActive = true;
    state.completed = false;
    state.answeredInSession = 0;
    state.combo = 0;
    state.againCards = [];
    state.currentRound = 1;

    for (let i = state.filteredCards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [state.filteredCards[i], state.filteredCards[j]] = [state.filteredCards[j], state.filteredCards[i]];
    }

    if (state.filteredCards.length > state.sessionSize) {
      state.filteredCards = state.filteredCards.slice(0, state.sessionSize);
    }

    renderCard();
  }

  function startGroupDeckFromCards(allCards, groupName) {
    state.currentTopicId = '__group_' + groupName;
    state.currentTopic = { title: groupName };
    state.cards = allCards;
    state.filteredCards = [...allCards];
    state.currentIndex = 0;
    state.isFlipped = false;
    state.isActive = true;
    state.completed = false;
    state.answeredInSession = 0;
    state.combo = 0;
    state.againCards = [];
    state.currentRound = 1;

    for (let i = state.filteredCards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [state.filteredCards[i], state.filteredCards[j]] = [state.filteredCards[j], state.filteredCards[i]];
    }

    if (state.filteredCards.length > state.sessionSize) {
      state.filteredCards = state.filteredCards.slice(0, state.sessionSize);
    }

    renderCard();
  }

  // === セッション保存 ===
  function internalSaveSession() {
    if (state.currentTopicId && state.isActive && state.currentIndex > 0 && !state.completed) {
      const isSearchDeck = state.currentTopicId.startsWith('__search_');
      const saveData = {
        index: state.currentIndex,
        order: state.filteredCards.map(c => isSearchDeck ? c.searchKey : c.originalIndex),
        shuffled: state.shuffleEnabled,
        timestamp: Date.now()
      };

      let allSessions = {};
      try {
        const stored = localStorage.getItem(SESSIONS_KEY);
        if (stored) allSessions = JSON.parse(stored);
      } catch (e) {}

      allSessions[state.currentTopicId] = saveData;
      localStorage.setItem(SESSIONS_KEY, JSON.stringify(allSessions));

      localStorage.setItem(`flashcard-session-${state.currentTopicId}`, JSON.stringify(saveData));
      return true;
    }
    return false;
  }

  function internalGetSession(topicId) {
    try {
      const stored = localStorage.getItem(SESSIONS_KEY);
      if (stored) {
        const allSessions = JSON.parse(stored);
        if (allSessions[topicId]) return allSessions[topicId];
      }
    } catch (e) {}

    try {
      const old = localStorage.getItem(`flashcard-session-${topicId}`);
      if (old) return JSON.parse(old);
    } catch (e) {}

    return null;
  }

  function clearSession(topicId) {
    try {
      const stored = localStorage.getItem(SESSIONS_KEY);
      if (stored) {
        const allSessions = JSON.parse(stored);
        delete allSessions[topicId];
        localStorage.setItem(SESSIONS_KEY, JSON.stringify(allSessions));
      }
    } catch (e) {}

    localStorage.removeItem(`flashcard-session-${topicId}`);
  }

  // === 戻る ===
  function goBack() {
    if (tableOcclusionState && tableOcclusionState.isTableCard) {
      tableOcclusionState.isTableCard = false;
      tableOcclusionState.currentCard = null;
      tableOcclusionState.currentDeck = null;
      tableOcclusionState.currentOcclusionIndex = 0;
      tableOcclusionState.currentCardIndex = 0;
      tableOcclusionState.totalOcclusions = 0;
      tableOcclusionState.globalOcclusionIndex = 0;
      tableOcclusionState.revealedCells.clear();
      state.isFlipped = false;
      exitPracticeMode();
      const tabbar = document.querySelector('.floating-tabbar');
      if (tabbar) tabbar.classList.remove('hidden');
      renderDeckList();
      return;
    }

    if (state.currentTopicId && state.currentIndex > 0 && !state.completed) {
      const isSearchDeck = state.currentTopicId.startsWith('__search_');
      const saveData = {
        index: state.currentIndex,
        order: state.filteredCards.map(c => isSearchDeck ? c.searchKey : c.originalIndex),
        shuffled: state.shuffleEnabled,
        timestamp: Date.now()
      };

      let allSessions = {};
      try {
        const stored = localStorage.getItem(SESSIONS_KEY);
        if (stored) allSessions = JSON.parse(stored);
      } catch (e) {}
      allSessions[state.currentTopicId] = saveData;
      localStorage.setItem(SESSIONS_KEY, JSON.stringify(allSessions));

      localStorage.setItem(`flashcard-session-${state.currentTopicId}`, JSON.stringify(saveData));
    }

    state.isActive = false;
    state.completed = false;
    state.currentTopicId = null;
    state.currentTopic = null;
    state.cards = [];
    state.filteredCards = [];
    state.currentIndex = 0;
    state.isFlipped = false;

    exitPracticeMode();
    const tabbar = document.querySelector('.floating-tabbar');
    if (tabbar) tabbar.classList.remove('hidden');
    renderDeckList();
  }

  // === グループ対応シャッフル関数 ===
  function shuffleArray(cards) {
    if (!cards || cards.length === 0) return;

    const groups = new Map();
    const ungrouped = [];

    cards.forEach((card, idx) => {
      if (card.groupId) {
        if (!groups.has(card.groupId)) {
          groups.set(card.groupId, []);
        }
        groups.get(card.groupId).push({ card, originalIdx: idx });
      } else {
        ungrouped.push({ card, originalIdx: idx });
      }
    });

    const units = [];

    groups.forEach((groupCards, groupId) => {
      groupCards.sort((a, b) => a.card.originalIndex - b.card.originalIndex);
      units.push({
        type: 'group',
        groupId: groupId,
        cards: groupCards.map(g => g.card)
      });
    });

    ungrouped.forEach(item => {
      units.push({
        type: 'single',
        cards: [item.card]
      });
    });

    for (let i = units.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [units[i], units[j]] = [units[j], units[i]];
    }

    let newIndex = 0;
    for (const unit of units) {
      for (const card of unit.cards) {
        cards[newIndex] = card;
        newIndex++;
      }
    }
  }

  return {
    setContainer,
    loadTopic,
    loadTopicFromCards,
    loadTopicFromText,
    startDeck,
    startDailyTenDeck,
    collectDailyTenCardRefs,
    fetchCardsFromRefs,
    collectStatusCardRefs,
    startStatusDeck,
    startSubjectDeck,
    startGroupDeck,
    fetchAllCardsFromTopics,
    startSubjectDeckFromCards,
    startGroupDeckFromCards,
    startNewOnlyDeck,
    startFavoriteDeck,
    startSearchResultsDeck,
    resumeSearchDeck,
    saveSession: internalSaveSession,
    getSession: internalGetSession,
    clearSession,
    goBack,
    shuffleArray,
    isDailyTenCompleted,
    markDailyTenCompleted
  };
}
