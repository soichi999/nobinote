// 宿題・連絡・指導記録が追加されたら、その生徒に紐づく端末へプッシュ通知を送ります。
// 毎日決まった時刻に、翌日が期限の未提出宿題があれば生徒・保護者にリマインド通知も送ります。
// デプロイには Blaze（従量課金）プランが必要です： firebase deploy --only functions
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
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
  const label = { tutor: "チューター", student: "生徒", parent: "保護者" };
  const who = label[d.authorRole] ?? d.authorRole;
  return notify(e.params.sid, `${who}からの連絡`, d.text, d.authorRole);
});

// 毎朝8時（日本時間）に、翌日が提出期限の未提出宿題をチェックしてリマインド通知を送る
exports.homeworkReminder = onSchedule(
  { schedule: "0 8 * * *", timeZone: "Asia/Tokyo" },
  async () => {
    const db = admin.firestore();
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const snap = await db.collectionGroup("homework")
      .where("dueDate", "==", tomorrow)
      .where("done", "==", false)
      .get();
    await Promise.all(snap.docs.map(d => {
      const sid = d.ref.parent.parent.id;
      return notify(sid, "宿題の期限が明日です", d.data().title ?? "宿題", "tutor");
    }));
  }
);

// 5分おきに、1時間以内に始まる指導予定をチェックしてリマインド通知を送る（1件につき1回だけ）
exports.lessonReminder = onSchedule(
  { schedule: "every 5 minutes", timeZone: "Asia/Tokyo" },
  async () => {
    const db = admin.firestore();
    const now = new Date();
    const todayStr = now.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }); // YYYY-MM-DD
    const snap = await db.collectionGroup("schedule")
      .where("date", "==", todayStr)
      .where("reminded", "==", false)
      .get();
    await Promise.all(snap.docs.map(async (d) => {
      const data = d.data();
      if (!data.time) return;
      const lessonAt = new Date(`${data.date}T${data.time}:00+09:00`);
      const diffMin = (lessonAt.getTime() - now.getTime()) / 60000;
      if (diffMin > 0 && diffMin <= 60) {
        const sid = d.ref.parent.parent.id;
        await notify(sid, "まもなく指導開始です（1時間前）", `${data.time} 〜${data.memo ? " " + data.memo : ""}`, "tutor");
        await d.ref.update({ reminded: true });
      }
    }));
  }
);
