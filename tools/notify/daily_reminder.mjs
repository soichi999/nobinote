// 毎晩20時（日本時間）に、今日の英単語・数学ⅠAがまだ終わっていない生徒にだけ通知する。
// Firebase が無料の Spark プランで Cloud Functions を使えないため、GitHub Actions（.github/workflows/daily-reminder.yml）から動かす。
// 必要なもの：環境変数 FIREBASE_SERVICE_ACCOUNT に Firebase のサービスアカウントの鍵（JSON の中身そのまま）
// 試し実行：DRY_RUN=1 にすると、送らずに「誰に何を送るか」だけを表示する
import admin from "firebase-admin";

const key = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!key) { console.error("FIREBASE_SERVICE_ACCOUNT がありません（GitHub の Secrets に登録してください）"); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(key)) });
const db = admin.firestore();
const DRY = process.env.DRY_RUN === "1";
const APP_URL = "https://soichi999.github.io/nobinote/";

// targetRole の端末だけに送る。届かなくなった端末の登録は消す
async function notifyRole(sid, title, body, targetRole) {
  const snap = await db.collection("students").doc(sid).collection("tokens").get();
  const docs = snap.docs.filter(d => d.data().role === targetRole);
  if (!docs.length) return 0;
  if (DRY) { console.log(`[送らない試し] ${sid}: ${title}（${docs.length}台）`); return docs.length; }
  const res = await admin.messaging().sendEachForMulticast({
    tokens: docs.map(d => d.id),
    notification: { title, body },
    webpush: { fcmOptions: { link: APP_URL } },
  });
  await Promise.all(res.responses.map((r, i) => {
    const code = r.error?.code ?? "";
    return !r.success && /registration-token-not-registered|invalid-registration-token|invalid-argument/.test(code) ? docs[i].ref.delete().catch(() => {}) : null;
  }));
  return res.successCount;
}

const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }); // YYYY-MM-DD
const students = await db.collection("students").get();
let sent = 0;
for (const st of students.docs) {
  const [vocab, math, hw] = await Promise.all([
    st.ref.collection("vocab").doc("state").get(),
    st.ref.collection("math").doc("state").get(),
    st.ref.collection("homework").where("dueDate", ">=", today).get(),
  ]);
  // その教科を使い始めている（記録がある）か、今日が期間に入っている「毎日の英単語／数学」の宿題がある生徒が対象
  const dailyHw = (type) => hw.docs.some(d => { const h = d.data(); return h.type === type && (h.startDate ?? h.dueDate) <= today; });
  const left = [];
  if ((vocab.exists || dailyHw("daily-vocab")) && !vocab.data()?.days?.[today]?.done) left.push("英単語");
  if ((math.exists || dailyHw("daily-math")) && !math.data()?.days?.[today]?.done) left.push("数学ⅠA");
  if (!left.length) continue;
  sent += await notifyRole(st.id, `今日の${left.join("・")}がまだです`, "寝る前に終わらせよう。毎日続けるのがいちばんの近道です", "student");
}
console.log(`${today}：${students.size}人を確認、${sent}台に${DRY ? "送る予定（試し）" : "送信"}`);
process.exit(0);
