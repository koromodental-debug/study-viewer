/**
 * 保存済み問題管理モジュール
 * ココシカ - 歯科国試対策アプリ
 *
 * Firestore questions コレクションから問題をページネーション取得・管理する
 * firestore.js の後に読み込むこと
 */

const SavedQuestions = (function() {
  let selectedIds = new Set();
  let lastDoc = null;
  let hasMore = false;
  let totalCount = 0;
  let loadedCount = 0;
  const PAGE_SIZE = 100;

  /**
   * 初期化: 総数を取得し、最初のページを読み込む
   */
  async function init() {
    try {
      showStatus('読み込み中...', 'info');
      selectedIds.clear();
      lastDoc = null;
      loadedCount = 0;
      document.getElementById('question-list').innerHTML = '';

      await loadNextPage();
      showStatus(`${loadedCount}問を表示中${hasMore ? '（さらに読み込み可）' : ''}`, 'success');
    } catch (error) {
      console.error('[SavedQuestions] 初期化エラー:', error);
      showStatus('読み込み失敗: ' + error.message, 'error');
    }
  }

  /**
   * 次のページを読み込んで追加描画
   */
  async function loadNextPage() {
    const result = await FirestoreQuestions.getQuestionsPaginated(PAGE_SIZE, lastDoc);
    lastDoc = result.lastDoc;
    hasMore = result.hasMore;
    loadedCount += result.questions.length;

    appendQuestions(result.questions);
    updateLoadMoreButton();
    updateDeleteButton();
  }

  /**
   * 問題リストに追加描画
   */
  function appendQuestions(questions) {
    const listEl = document.getElementById('question-list');
    if (!listEl) return;

    if (loadedCount === 0 && questions.length === 0) {
      listEl.innerHTML = '<div class="empty-state">問題がありません</div>';
      return;
    }

    // 「もっと読み込む」ボタンがあれば一旦除去
    const existingBtn = document.getElementById('load-more-btn');
    if (existingBtn) existingBtn.remove();

    const fragment = document.createDocumentFragment();
    for (const q of questions) {
      const div = document.createElement('div');
      div.className = 'question-item';
      div.dataset.id = q.id;
      div.innerHTML = `
        <label class="question-checkbox-label">
          <input type="checkbox" class="question-checkbox" data-id="${q.id}"
                 ${selectedIds.has(q.id) ? 'checked' : ''}>
          <span class="question-id">${q.id}</span>
          <span class="question-text">${escapeHtml(q.questionText || '')}</span>
        </label>
      `;
      div.querySelector('.question-checkbox').addEventListener('change', (e) => {
        if (e.target.checked) {
          selectedIds.add(e.target.dataset.id);
        } else {
          selectedIds.delete(e.target.dataset.id);
        }
        updateDeleteButton();
      });
      fragment.appendChild(div);
    }
    listEl.appendChild(fragment);
  }

  /**
   * 「もっと読み込む」ボタンの表示切替
   */
  function updateLoadMoreButton() {
    const existing = document.getElementById('load-more-btn');
    if (existing) existing.remove();

    if (!hasMore) return;

    const listEl = document.getElementById('question-list');
    const btn = document.createElement('button');
    btn.id = 'load-more-btn';
    btn.className = 'btn-secondary';
    btn.textContent = `さらに読み込む`;
    btn.style.cssText = 'width:100%;margin-top:12px;padding:12px;';
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = '読み込み中...';
      try {
        await loadNextPage();
        showStatus(`${loadedCount}問を表示中${hasMore ? '（さらに読み込み可）' : ''}`, 'success');
      } catch (error) {
        showStatus('追加読み込み失敗: ' + error.message, 'error');
      }
    });
    listEl.appendChild(btn);
  }

  /**
   * 削除ボタンの状態を更新
   */
  function updateDeleteButton() {
    const btn = document.getElementById('delete-selected-btn');
    if (btn) {
      btn.disabled = selectedIds.size === 0;
      btn.textContent = selectedIds.size > 0
        ? `選択した${selectedIds.size}問を削除`
        : '削除';
    }
  }

  /**
   * 選択された問題を削除（ソフトデリート）
   */
  async function deleteQuestions() {
    if (selectedIds.size === 0) return;

    const count = selectedIds.size;
    if (!confirm(`${count}問を削除しますか？`)) return;

    try {
      showStatus('削除中...', 'info');
      const ids = Array.from(selectedIds);
      await FirestoreQuestions.deleteQuestionsByIds(ids);
      selectedIds.clear();

      // 再読み込み
      await init();
      showStatus(`${count}問を削除しました`, 'success');
    } catch (error) {
      console.error('[SavedQuestions] 削除エラー:', error);
      showStatus('削除に失敗しました: ' + error.message, 'error');
    }
  }

  /**
   * ステータスメッセージを表示
   */
  function showStatus(message, type) {
    const statusEl = document.getElementById('saved-status');
    if (statusEl) {
      statusEl.textContent = message;
      statusEl.className = `status ${type}`;
    }
  }

  /**
   * HTMLエスケープ
   */
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  return {
    init,
    deleteQuestions
  };
})();
