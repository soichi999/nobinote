import { firebaseConfig, vapidKey } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getMessaging, getToken, onMessage, isSupported
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";
import {
  getFirestore, collection, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  query, orderBy, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDate = (s) => { if (!s) return ""; const [y, m, d] = s.split("-"); return `${y}/${m}/${d}`; };
const today = () => new Date().toISOString().slice(0, 10);
const show = (v) => ["gate-view", "pass-view", "app-view"].forEach(id => { $(id).hidden = id !== v; });

const TUTOR_KEY = "tnote.tutorPass";     // 端末に覚えさせるチューターのパスコード
const FAMILY_KEY = "tnote.familyPass";   // 端末に覚えさせる学生・保護者のパスコード
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  del: (k) => { try { localStorage.removeItem(k); } catch {} }
};

let role = null;            // "tutor" | "family"
let students = [];          // [{id, name, passcode}]
let currentSid = null;
let tutorPass = "0000";
let pendingRole = null;
let unsubs = [];
const off = () => { unsubs.forEach(u => u()); unsubs = []; };

/* ---------- 起動 ---------- */
(async function boot() {
  await signInAnonymously(auth);
  // チューターのパスコード（未設定なら 0000 で作成）
  const cfgRef = doc(db, "config", "tutor");
  const cfg = await getDoc(cfgRef);
  if (!cfg.exists()) await setDoc(cfgRef, { passcode: "0000" });
  onSnapshot(cfgRef, s => { tutorPass = s.data()?.passcode ?? "0000"; });
  // 生徒一覧は常に購読（パスコード照合と生徒切り替えに使う）
  onSnapshot(query(collection(db, "students"), orderBy("name")), s => {
    students = s.docs.map(d => ({ id: d.id, ...d.data() }));
    if (role) refreshStudentUI();
    renderStudentAdmin();
  });
})();

/* ---------- 入口 ---------- */
$("go-family").addEventListener("click", () => enter("family"));
$("go-tutor").addEventListener("click", () => enter("tutor"));

function enter(r) {
  const saved = store.get(r === "tutor" ? TUTOR_KEY : FAMILY_KEY);
  if (saved && verify(r, saved)) return start(r, saved);   // この端末では入力不要
  pendingRole = r;
  $("pass-title").textContent = r === "tutor" ? "チューター" : "学生・保護者";
  $("pass-lead").textContent = "パスコードを入力してください";
  $("pass-input").value = ""; $("pass-error").textContent = "";
  show("pass-view");
  $("pass-input").focus();
}

function verify(r, code) {
  if (r === "tutor") return code === tutorPass;
  return students.some(s => s.passcode === code);
}

function start(r, code) {
  role = r;
  store.set(r === "tutor" ? TUTOR_KEY : FAMILY_KEY, code);
  $("whoami").textContent = r === "tutor" ? "チューター" : "学生・保護者";
  document.querySelectorAll(".tutor-only").forEach(el => { el.hidden = r !== "tutor"; });
  if (r === "family") {
    const s = students.find(x => x.passcode === code);
    currentSid = s?.id ?? null;
  } else {
    currentSid = students[0]?.id ?? null;
  }
  show("app-view"); $("topbar").hidden = false;
  refreshStudentUI();
  renderStudentAdmin();
  watchAll();
  updateNotifBar();
  registerPushToken().catch(() => {});
}

$("pass-ok").addEventListener("click", () => {
  const code = $("pass-input").value.trim();
  if (verify(pendingRole, code)) return start(pendingRole, code);
  $("pass-error").textContent = "パスコードが違います。";
  $("pass-input").select();
});
$("pass-input").addEventListener("keydown", e => { if (e.key === "Enter") $("pass-ok").click(); });
$("pass-back").addEventListener("click", () => { pendingRole = null; show("gate-view"); });

$("logout").addEventListener("click", () => {
  off(); role = null; currentSid = null;
  $("topbar").hidden = true; show("gate-view");
});

/* ---------- 生徒の切り替え（チューターのみ） ---------- */
function refreshStudentUI() {
  const sel = $("student-select");
  const list = role === "tutor" ? students : students.filter(s => s.id === currentSid);
  sel.innerHTML = list.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("");
  sel.value = currentSid ?? "";
  $("student-picker").hidden = !(role === "tutor" && list.length > 1);
  if (!currentSid && list.length) { currentSid = list[0].id; sel.value = currentSid; watchAll(); }
  if (!list.length) $("lesson-list").innerHTML = `<div class="empty">まず「設定」タブで生徒を追加してください。</div>`;
}
$("student-select").addEventListener("change", e => { currentSid = e.target.value; watchAll(); });

/* ---------- タブ ---------- */
document.querySelectorAll(".tabs button").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach(b => b.classList.toggle("active", b === btn));
    document.querySelectorAll(".tab").forEach(s => { s.hidden = s.id !== "tab-" + btn.dataset.tab; });
  });
});

/* ---------- 購読 ---------- */
const sub = (name, order, dir, render) => {
  const q = query(collection(db, "students", currentSid, name), orderBy(order, dir));
  unsubs.push(onSnapshot(q, s => render(s.docs.map(d => ({ id: d.id, ...d.data() })))));
};
function watchAll() {
  off();
  if (!currentSid) return;
  sub("lessons", "date", "desc", renderLessons);
  sub("homework", "dueDate", "asc", renderHomework);
  sub("tests", "date", "asc", renderTests);
  sub("messages", "createdAt", "asc", renderMessages);
}

/* ---------- 授業記録 ---------- */
function renderLessons(rows) {
  $("lesson-list").innerHTML = rows.length ? rows.map(r => `
    <article class="item">
      <div class="meta"><span class="date">${fmtDate(r.date)}</span><span class="badge">${esc(r.subject)}</span></div>
      ${r.range ? `<h4>${esc(r.range)}</h4>` : ""}
      ${r.content ? `<p class="label">授業内容</p><p>${esc(r.content)}</p>` : ""}
      ${r.notes ? `<p class="label">所感</p><p>${esc(r.notes)}</p>` : ""}
    </article>`).join("") : `<div class="empty">まだ授業記録がありません。</div>`;
}
$("lesson-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  await addDoc(collection(db, "students", currentSid, "lessons"), {
    date: $("l-date").value, subject: $("l-subject").value.trim(),
    range: $("l-range").value.trim(), content: $("l-content").value.trim(),
    notes: $("l-notes").value.trim(), createdAt: serverTimestamp()
  });
  e.target.reset(); $("l-date").value = today();
});

/* ---------- 宿題 ---------- */
function hwBadge(r) {
  if (r.done) return `<span class="badge done">提出済み</span>`;
  const left = (new Date(r.dueDate) - new Date(today())) / 86400000;
  if (left < 0) return `<span class="badge late">期限切れ</span>`;
  if (left <= 2) return `<span class="badge soon">まもなく期限</span>`;
  return `<span class="badge">未提出</span>`;
}
function renderHomework(rows) {
  $("hw-list").innerHTML = rows.length ? rows.map(r => `
    <article class="item">
      <div class="meta"><span class="date">期限 ${fmtDate(r.dueDate)}</span>${hwBadge(r)}</div>
      <h4>${esc(r.title)}</h4>
      ${r.detail ? `<p>${esc(r.detail)}</p>` : ""}
      ${r.question ? `<p class="label">生徒からの質問</p><p>${esc(r.question)}</p>` : ""}
      <div class="actions">
        <button class="small outline" data-toggle="${esc(r.id)}" data-done="${r.done ? 1 : 0}">
          ${r.done ? "未提出に戻す" : "提出した"}</button>
        <button class="small outline" data-ask="${esc(r.id)}">質問する</button>
        ${role === "tutor" ? `<button class="small outline danger" data-del="${esc(r.id)}">削除</button>` : ""}
      </div>
    </article>`).join("") : `<div class="empty">出されている宿題はありません。</div>`;
}
$("hw-list").addEventListener("click", async (e) => {
  const t = e.target.closest("[data-toggle]"), a = e.target.closest("[data-ask]"), d = e.target.closest("[data-del]");
  const ref = (id) => doc(db, "students", currentSid, "homework", id);
  if (t) await updateDoc(ref(t.dataset.toggle), { done: t.dataset.done !== "1", doneAt: serverTimestamp() });
  else if (a) { const q = prompt("先生への質問を入力してください"); if (q) await updateDoc(ref(a.dataset.ask), { question: q }); }
  else if (d && confirm("この宿題を削除しますか？")) await deleteDoc(ref(d.dataset.del));
});
$("hw-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  await addDoc(collection(db, "students", currentSid, "homework"), {
    title: $("h-title").value.trim(), detail: $("h-detail").value.trim(),
    dueDate: $("h-due").value, done: false, question: "", createdAt: serverTimestamp()
  });
  e.target.reset();
});

/* ---------- 成績 ---------- */
function renderTests(rows) {
  $("test-list").innerHTML = rows.slice().reverse().map(r => `
    <article class="item">
      <div class="meta"><span class="date">${fmtDate(r.date)}</span><span class="badge">${esc(r.subject)}</span></div>
      <h4>${esc(r.name || "テスト")}</h4>
      <p class="score">${r.score}<small> / ${r.max}点（${Math.round(r.score / r.max * 100)}%）</small></p>
    </article>`).join("") || `<div class="empty">まだテスト結果がありません。</div>`;
  drawChart(rows);
}
function drawChart(rows) {
  if (rows.length < 2) { $("chart").innerHTML = `<p class="hint">2件以上登録すると推移グラフが表示されます。</p>`; return; }
  const W = 640, H = 240, P = 36;
  const bySubject = {};
  rows.forEach(r => (bySubject[r.subject] ??= []).push(r));
  const colors = ["#1a5fd0", "#0f7a5a", "#b46a09", "#8a4fbf", "#c0392b"];
  const xs = (i, n) => P + (W - P * 2) * (n === 1 ? .5 : i / (n - 1));
  const ys = (p) => H - P - (H - P * 2) * (p / 100);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="得点率の推移">`;
  [0, 25, 50, 75, 100].forEach(p => {
    svg += `<line x1="${P}" y1="${ys(p)}" x2="${W - P}" y2="${ys(p)}" stroke="#e2eaf5"/>`
        +  `<text x="${P - 6}" y="${ys(p) + 4}" font-size="10" fill="#66748c" text-anchor="end">${p}</text>`;
  });
  Object.entries(bySubject).forEach(([subject, list], si) => {
    const c = colors[si % colors.length];
    const pts = list.map((r, i) => [xs(i, list.length), ys(r.score / r.max * 100)]);
    svg += `<polyline fill="none" stroke="${c}" stroke-width="2.5" stroke-linejoin="round"
      points="${pts.map(p => p.join(",")).join(" ")}"/>`;
    pts.forEach(([x, y]) => svg += `<circle cx="${x}" cy="${y}" r="4" fill="#fff" stroke="${c}" stroke-width="2.5"/>`);
    svg += `<text x="${P}" y="${16 + si * 15}" font-size="11" fill="${c}" font-weight="700">■ ${esc(subject)}</text>`;
  });
  $("chart").innerHTML = svg + `</svg>`;
}
$("test-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  await addDoc(collection(db, "students", currentSid, "tests"), {
    date: $("t-date").value, subject: $("t-subject").value.trim(),
    name: $("t-name").value.trim(), score: Number($("t-score").value),
    max: Number($("t-max").value), createdAt: serverTimestamp()
  });
  e.target.reset(); $("t-max").value = 100; $("t-date").value = today();
});

/* ---------- 連絡 ---------- */
function renderMessages(rows) {
  $("msg-list").innerHTML = rows.length ? rows.map(r => `
    <article class="item ${r.authorRole === role ? "me" : ""}">
      <div class="meta">
        <span class="date">${r.authorRole === "tutor" ? "チューター" : "学生・保護者"}</span>
        <span>${r.createdAt?.toDate ? r.createdAt.toDate().toLocaleString("ja-JP") : ""}</span>
      </div>
      <p>${esc(r.text)}</p>
    </article>`).join("") : `<div class="empty">まだメッセージはありません。</div>`;
  $("msg-list").lastElementChild?.scrollIntoView({ block: "nearest" });
}
$("msg-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  await addDoc(collection(db, "students", currentSid, "messages"), {
    text: $("m-text").value.trim(), authorRole: role, createdAt: serverTimestamp()
  });
  e.target.reset();
});

/* ---------- 設定（チューター） ---------- */
function renderStudentAdmin() {
  if (role !== "tutor") return;
  $("student-admin").innerHTML = students.length ? students.map(s => `
    <article class="item">
      <div class="meta"><span class="date">${esc(s.name)}</span></div>
      <div class="grid">
        <label>パスコード<input type="text" inputmode="numeric" value="${esc(s.passcode)}" data-pass="${esc(s.id)}"></label>
      </div>
      <div class="actions">
        <button class="small primary" data-save="${esc(s.id)}">保存</button>
        <button class="small outline danger" data-remove="${esc(s.id)}">この生徒を削除</button>
      </div>
    </article>`).join("") : `<div class="empty">生徒がまだ登録されていません。</div>`;
}
$("student-admin").addEventListener("click", async (e) => {
  const save = e.target.closest("[data-save]"), rm = e.target.closest("[data-remove]");
  if (save) {
    const id = save.dataset.save;
    const code = document.querySelector(`[data-pass="${id}"]`).value.trim();
    if (!code) return alert("パスコードを入力してください。");
    if (students.some(s => s.id !== id && s.passcode === code)) return alert("他の生徒と同じパスコードは使えません。");
    await updateDoc(doc(db, "students", id), { passcode: code });
    alert("保存しました。");
  } else if (rm) {
    const s = students.find(x => x.id === rm.dataset.remove);
    if (confirm(`${s?.name} を削除しますか？（記録は残りますが一覧から消えます）`)) {
      await deleteDoc(doc(db, "students", rm.dataset.remove));
      if (currentSid === rm.dataset.remove) { currentSid = null; refreshStudentUI(); }
    }
  }
});
$("add-student-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const code = $("s-pass").value.trim();
  if (students.some(s => s.passcode === code)) return alert("他の生徒と同じパスコードは使えません。");
  await addDoc(collection(db, "students"), { name: $("s-name").value.trim(), passcode: code });
  e.target.reset();
});
$("tutor-pass-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const code = $("tp-new").value.trim();
  if (!code) return;
  await setDoc(doc(db, "config", "tutor"), { passcode: code });
  store.set(TUTOR_KEY, code);   // この端末は入力不要のまま
  e.target.reset();
  alert("チューターのパスコードを変更しました。他の端末では再入力が必要です。");
});

/* ---------- 初期値 ---------- */
$("l-date").value = today();
$("t-date").value = today();

/* ---------- PWA / 通知 ---------- */
const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);
if (isIOS && !standalone) $("install-hint").hidden = false;

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
    navigator.serviceWorker.register("./firebase-messaging-sw.js").catch(() => {});
  });
}

function updateNotifBar() {
  const bar = $("notif-bar");
  if (!("Notification" in window) || !role) { bar.hidden = true; return; }
  if (Notification.permission === "granted") { bar.hidden = true; return; }
  if (isIOS && !standalone) {
    $("notif-text").textContent = "通知を使うには、共有ボタンから「ホーム画面に追加」してこのアプリを開いてください。";
    $("notif-enable").hidden = true;
  } else {
    $("notif-text").textContent = "新しい宿題や連絡を通知で受け取れます。";
    $("notif-enable").hidden = false;
  }
  bar.hidden = false;
}

$("notif-enable").addEventListener("click", async () => {
  try {
    if (await Notification.requestPermission() !== "granted") { updateNotifBar(); return; }
    await registerPushToken();
    $("notif-bar").hidden = true;
  } catch (e) {
    alert("通知を設定できませんでした（" + (e?.message ?? e) + "）");
  }
});

async function registerPushToken() {
  if (!currentSid || !(await isSupported())) return;
  if (Notification.permission !== "granted") return;
  const messaging = getMessaging(app);
  const reg = await navigator.serviceWorker.register("./firebase-messaging-sw.js");
  const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: reg });
  if (!token) return;
  await setDoc(doc(db, "students", currentSid, "tokens", token),
    { role, updatedAt: serverTimestamp() });
  // アプリを開いている間に届いた通知も表示する
  onMessage(messaging, ({ notification }) => {
    reg.showNotification(notification?.title ?? "ノビノート", {
      body: notification?.body ?? "", icon: "./icon-192.png"
    });
  });
}
