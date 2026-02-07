/**
 * Node.js マイグレーションスクリプト
 * Firebase Admin SDK を使用（セキュリティルールをバイパス）
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// サービスアカウントキー
const serviceAccount = require('/Users/saitouryuuichi/Downloads/kokoshiclass-firebase-adminsdk-fbsvc-a1afcec584.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function migrate() {
  // 1. questions.json を読み込み
  const questionsPath = path.join(__dirname, 'questions.json');
  const raw = fs.readFileSync(questionsPath, 'utf-8');
  const data = JSON.parse(raw);
  const questions = data.questions || [];
  console.log(`questions.json: ${questions.length}問`);

  // 2. バッチ書き込み（500件ずつ）
  const BATCH_SIZE = 500;
  let totalWritten = 0;
  let errors = 0;

  for (let i = 0; i < questions.length; i += BATCH_SIZE) {
    const chunk = questions.slice(i, i + BATCH_SIZE);
    const batch = db.batch();

    for (const q of chunk) {
      if (!q.id) continue;
      const ref = db.collection('questions').doc(q.id);
      batch.set(ref, {
        ...q,
        deleted: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }

    try {
      await batch.commit();
      totalWritten += chunk.length;
      const pct = Math.round((totalWritten / questions.length) * 100);
      console.log(`バッチ ${Math.floor(i / BATCH_SIZE) + 1}: ${chunk.length}問 (${pct}%)`);
    } catch (e) {
      errors += chunk.length;
      console.error(`バッチエラー: ${e.message}`);
    }
  }

  console.log(`\n完了: ${totalWritten}問を書き込み${errors > 0 ? `, ${errors}問でエラー` : ''}`);
  process.exit(0);
}

migrate().catch(e => {
  console.error('致命的エラー:', e);
  process.exit(1);
});
