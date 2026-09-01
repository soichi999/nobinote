// 宿題・連絡・授業記録が追加されたら、その生徒に紐づく端末へプッシュ通知を送ります。
// デプロイには Blaze（従量課金）プランが必要です： firebase deploy --only functions
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");
admin.initializeApp();

async function notify(sid, title, body, exceptRole) {
  const db = admin.firestore();
  const tokens = await db.collection("students").doc(sid).collection("tokens").get();
  const targets = tokens.docs
    .filter(d => d.data().role !== exceptRole)   // 書いた本人には送らない
    .map(d => d.id);
  if (!targets.length) return;

  const res = await admin.messaging().sendEachForMulticast({
    tokens: targets,
    notification: { title, body },
    webpush: { fcmOptions: { link: "/index.html" } }
  });
  // 無効になったトークンを掃除する
  await Promise.all(res.responses.map((r, i) =>
    r.success ? null : tokens.docs[i].ref.delete().catch(() => {})));
}

exports.onHomework = onDocumentCreated("students/{sid}/homework/{id}", (e) => {
  const d = e.data.data();
  return notify(e.params.sid, "新しい宿題", `${d.title}（期限 ${d.dueDate}）`, "tutor");
});

exports.onLesson = onDocumentCreated("students/{sid}/lessons/{id}", (e) => {
  const d = e.data.data();
  return notify(e.params.sid, "授業記録が追加されました", `${d.subject} ${d.range ?? ""}`.trim(), "tutor");
});

exports.onMessage = onDocumentCreated("students/{sid}/messages/{id}", (e) => {
  const d = e.data.data();
  const who = d.authorRole === "tutor" ? "チューター" : "学生・保護者";
  return notify(e.params.sid, `${who}からの連絡`, d.text, d.authorRole);
});
