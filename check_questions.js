const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
initializeApp({ projectId: "kokoshiclass" });
const db = getFirestore();

(async () => {
  const examPattern = /^\d{2,3}[A-Da-d]\d+$/;
  const all = await db.collection("questions").get();
  console.log("Total docs:", all.size);

  let custom = 0;
  all.docs.forEach(d => {
    if (examPattern.test(d.id)) return;
    custom++;
    const data = d.data();
    const ct = data.createdAt ? data.createdAt.toDate().toISOString() : "NONE";
    console.log(d.id, "| createdAt:", ct, "| deleted:", data.deleted, "| source:", data.source);
  });
  console.log("\nCustom questions found:", custom);
})();
