/**
 * kokoshika-f24eb の questions コレクションを全削除するスクリプト
 * （誤って投入した6165問を削除）
 */

const admin = require('firebase-admin');

// kokoshika のサービスアカウントキー
const serviceAccount = require('/Users/saitouryuuichi/Downloads/kokoshika-f24eb-firebase-adminsdk-fbsvc-3a896429fe.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function cleanup() {
  const collectionRef = db.collection('questions');
  const snapshot = await collectionRef.get();
  console.log(`kokoshika-f24eb の questions: ${snapshot.size}ドキュメント`);

  if (snapshot.size === 0) {
    console.log('削除対象なし');
    process.exit(0);
  }

  const BATCH_SIZE = 500;
  let totalDeleted = 0;
  const docs = snapshot.docs;

  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const chunk = docs.slice(i, i + BATCH_SIZE);
    const batch = db.batch();

    for (const doc of chunk) {
      batch.delete(doc.ref);
    }

    await batch.commit();
    totalDeleted += chunk.length;
    const pct = Math.round((totalDeleted / docs.length) * 100);
    console.log(`削除バッチ ${Math.floor(i / BATCH_SIZE) + 1}: ${chunk.length}件 (${pct}%)`);
  }

  console.log(`\n完了: ${totalDeleted}ドキュメントを削除`);
  process.exit(0);
}

cleanup().catch(e => {
  console.error('エラー:', e);
  process.exit(1);
});
