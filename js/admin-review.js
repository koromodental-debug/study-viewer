/**
 * 管理者向け問題審査モジュール
 * ココシカ - 歯科国試対策アプリ
 *
 * firestore.js, firebase-sync.js の後に読み込むこと
 */

const AdminReview = (function() {
  let currentFilter = null; // null = 全て
  let isAdminUser = false;

  /**
   * 初期化: 管理者チェック → キュー読み込み
   */
  async function init() {
    try {
      showStatus('管理者権限を確認中...', 'info');

      isAdminUser = await FirestoreQuestions.isAdmin();
      if (!isAdminUser) {
        showStatus('管理者権限がありません', 'error');
        document.getElementById('admin-content').style.display = 'none';
        return;
      }

      document.getElementById('admin-content').style.display = 'block';
      showStatus('読み込み中...', 'info');
      await loadQueue();
    } catch (error) {
      console.error('[AdminReview] 初期化エラー:', error);
      showStatus('初期化に失敗しました: ' + error.message, 'error');
    }
  }

  /**
   * 審査キューを取得して描画
   */
  async function loadQueue() {
    try {
      const batches = await FirestoreQuestions.getReviewQueue(currentFilter);
      const listEl = document.getElementById('batch-list');
      listEl.innerHTML = '';

      if (batches.length === 0) {
        listEl.innerHTML = '<div class="empty-state">該当するバッチはありません</div>';
        showStatus(currentFilter ? `${getFilterLabel(currentFilter)}: 0件` : '0件', 'info');
        return;
      }

      const fragment = document.createDocumentFragment();
      for (const batch of batches) {
        fragment.appendChild(renderBatchCard(batch));
      }
      listEl.appendChild(fragment);

      showStatus(`${batches.length}件のバッチを表示中`, 'success');
    } catch (error) {
      console.error('[AdminReview] キュー読み込みエラー:', error);
      showStatus('読み込みに失敗しました: ' + error.message, 'error');
    }
  }

  /**
   * バッチカードを描画
   */
  function renderBatchCard(batch) {
    const card = document.createElement('div');
    card.className = 'batch-card';
    card.dataset.id = batch.id;

    const statusLabel = getStatusBadge(batch.status);
    const dateStr = batch.submittedAt
      ? new Date(batch.submittedAt.seconds * 1000).toLocaleString('ja-JP')
      : '不明';

    card.innerHTML = `
      <div class="batch-header" onclick="AdminReview.expandBatch('${batch.id}')">
        <div class="batch-info">
          <div class="batch-title">${escapeHtml(batch.title || '無題')}</div>
          <div class="batch-meta">
            <span>${escapeHtml(batch.submittedBy || '不明')}</span>
            <span>${dateStr}</span>
            <span>${batch.questionCount || 0}問</span>
          </div>
        </div>
        ${statusLabel}
      </div>
      <div class="batch-detail" id="detail-${batch.id}" style="display:none;">
        <div class="batch-questions"></div>
        ${batch.status === 'pending' ? `
          <div class="batch-actions">
            <button class="btn-approve" onclick="AdminReview.approve('${batch.id}')">承認する</button>
            <button class="btn-reject" onclick="AdminReview.reject('${batch.id}')">却下する</button>
          </div>
        ` : `
          <div class="batch-review-info">
            ${batch.reviewedBy ? `審査者: ${escapeHtml(batch.reviewedBy)}` : ''}
            ${batch.reviewedAt ? ` (${new Date(batch.reviewedAt.seconds * 1000).toLocaleString('ja-JP')})` : ''}
          </div>
        `}
      </div>
    `;

    return card;
  }

  /**
   * バッチを展開して問題プレビューを表示
   */
  async function expandBatch(batchId) {
    const detailEl = document.getElementById(`detail-${batchId}`);
    if (!detailEl) return;

    // トグル表示
    if (detailEl.style.display !== 'none') {
      detailEl.style.display = 'none';
      return;
    }

    detailEl.style.display = 'block';

    // 既に描画済みならスキップ
    const questionsEl = detailEl.querySelector('.batch-questions');
    if (questionsEl.children.length > 0) return;

    // バッチデータを再取得して問題を描画
    try {
      const db = FirestoreQuestions.getReviewQueue ? null : null; // getDbは非公開
      // カードのデータ属性からではなく、Firestoreから取得
      const batches = await FirestoreQuestions.getReviewQueue(null);
      const batch = batches.find(b => b.id === batchId);
      if (!batch || !batch.questions) {
        questionsEl.innerHTML = '<div class="empty-state">問題データがありません</div>';
        return;
      }

      const fragment = document.createDocumentFragment();
      batch.questions.forEach((q, i) => {
        fragment.appendChild(renderQuestion(q, i + 1));
      });
      questionsEl.appendChild(fragment);
    } catch (error) {
      console.error('[AdminReview] 問題展開エラー:', error);
      questionsEl.innerHTML = '<div class="empty-state">問題の読み込みに失敗しました</div>';
    }
  }

  /**
   * 1問分の表示
   */
  function renderQuestion(q, num) {
    const div = document.createElement('div');
    div.className = 'preview-question';

    const choicesHtml = q.choices
      ? Object.entries(q.choices).map(([key, val]) => {
          const isAnswer = q.answer && q.answer.toLowerCase() === key.toLowerCase();
          return `<div class="preview-choice ${isAnswer ? 'correct' : ''}">${key}) ${escapeHtml(val)}</div>`;
        }).join('')
      : '';

    div.innerHTML = `
      <div class="preview-q-header">
        <span class="preview-q-num">Q${num}</span>
        ${q.subject ? `<span class="preview-q-subject">${escapeHtml(q.subject)}</span>` : ''}
        ${q.id ? `<span class="preview-q-id">${escapeHtml(q.id)}</span>` : ''}
      </div>
      <div class="preview-q-text">${escapeHtml(q.questionText || '')}</div>
      <div class="preview-choices">${choicesHtml}</div>
      <div class="preview-answer">正解: ${escapeHtml(q.answer || '不明')}${q.choiceCount ? ` (${q.choiceCount}つ選べ)` : ''}</div>
    `;
    return div;
  }

  /**
   * 承認処理
   */
  async function approve(batchId) {
    if (!confirm('このバッチを承認しますか？\n問題がquestionsコレクションに追加されます。')) return;

    try {
      showStatus('承認処理中...', 'info');
      const count = await FirestoreQuestions.approveBatch(batchId);
      showStatus(`承認完了: ${count}問を追加しました`, 'success');
      await loadQueue();
    } catch (error) {
      console.error('[AdminReview] 承認エラー:', error);
      showStatus('承認に失敗しました: ' + error.message, 'error');
    }
  }

  /**
   * 却下処理
   */
  async function reject(batchId) {
    if (!confirm('このバッチを却下しますか？')) return;

    try {
      showStatus('却下処理中...', 'info');
      await FirestoreQuestions.rejectBatch(batchId);
      showStatus('却下しました', 'success');
      await loadQueue();
    } catch (error) {
      console.error('[AdminReview] 却下エラー:', error);
      showStatus('却下に失敗しました: ' + error.message, 'error');
    }
  }

  /**
   * JSON貼り付けで新規バッチを投稿
   */
  async function submitBatch() {
    const titleInput = document.getElementById('submit-title');
    const jsonInput = document.getElementById('submit-json');
    const title = titleInput.value.trim();
    const jsonText = jsonInput.value.trim();

    if (!title) {
      showStatus('タイトルを入力してください', 'error');
      return;
    }
    if (!jsonText) {
      showStatus('JSONを貼り付けてください', 'error');
      return;
    }

    try {
      // JSONクリーニング（firebase-sync.jsのパターンを参考）
      let cleanText = jsonText;
      cleanText = cleanText.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '');

      // JSON配列を抽出
      const arrayMatch = cleanText.match(/\[[\s\S]*\]/);
      if (arrayMatch) {
        cleanText = arrayMatch[0];
      }

      // 全角→半角変換
      cleanText = cleanText
        .replace(/\u300c/g, '"').replace(/\u300d/g, '"')
        .replace(/\u201c/g, '"').replace(/\u201d/g, '"')
        .replace(/\uff02/g, '"')
        .replace(/\uff1a/g, ':').replace(/\uff3b/g, '[').replace(/\uff3d/g, ']')
        .replace(/\uff5b/g, '{').replace(/\uff5d/g, '}').replace(/\uff0c/g, ',');

      // 末尾カンマ除去
      cleanText = cleanText.replace(/,\s*]/g, ']').replace(/,\s*}/g, '}');

      const questions = JSON.parse(cleanText);

      if (!Array.isArray(questions) || questions.length === 0) {
        showStatus('問題の配列が空です', 'error');
        return;
      }

      // 必須フィールドの簡易バリデーション
      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        if (!q.questionText) {
          showStatus(`問題${i + 1}: questionText が必要です`, 'error');
          return;
        }
        if (!q.choices || typeof q.choices !== 'object') {
          showStatus(`問題${i + 1}: choices が必要です`, 'error');
          return;
        }
        if (!q.answer) {
          showStatus(`問題${i + 1}: answer が必要です`, 'error');
          return;
        }
      }

      showStatus('投稿中...', 'info');
      const docId = await FirestoreQuestions.submitToReviewQueue(title, questions);
      showStatus(`投稿完了: ${questions.length}問 (ID: ${docId})`, 'success');

      // 入力をクリア
      titleInput.value = '';
      jsonInput.value = '';

      // リストを再読み込み
      await loadQueue();
    } catch (error) {
      console.error('[AdminReview] 投稿エラー:', error);
      if (error instanceof SyntaxError) {
        showStatus('JSONの形式が正しくありません', 'error');
      } else {
        showStatus('投稿に失敗しました: ' + error.message, 'error');
      }
    }
  }

  /**
   * フィルタを変更
   */
  function setFilter(filter) {
    currentFilter = filter;
    // タブの選択状態を更新
    document.querySelectorAll('.filter-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.filter === (filter || ''));
    });
    loadQueue();
  }

  /**
   * ステータスバッジを生成
   */
  function getStatusBadge(status) {
    const map = {
      pending:  '<span class="status-badge pending">保留中</span>',
      approved: '<span class="status-badge approved">承認済み</span>',
      rejected: '<span class="status-badge rejected">却下</span>'
    };
    return map[status] || '';
  }

  /**
   * フィルタラベル
   */
  function getFilterLabel(filter) {
    const map = { pending: '保留中', approved: '承認済み', rejected: '却下' };
    return map[filter] || '全て';
  }

  /**
   * ステータスメッセージを表示
   */
  function showStatus(message, type) {
    const statusEl = document.getElementById('review-status');
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
    loadQueue,
    expandBatch,
    approve,
    reject,
    submitBatch,
    setFilter
  };
})();
