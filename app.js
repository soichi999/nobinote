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
import { SUBJECTS, subjectLabel, subjectColor, subjectOptionsHTML } from "./subjects.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c));
const fmtDate = (s) => { if (!s) return ""; const [y, m, d] = s.split("-"); return `${y}/${m}/${d}`; };
const today = () => new Date().toISOString().slice(0, 10);
const show = (v) => ["gate-view", "pass-view", "app-view"].forEach(id => { $(id).hidden = id !== v; });
const subjectChip = (id) => {
  if (!id) return "";
  const c = subjectColor(id);
  return `<span class="badge subj" style="color:${c.fg};background:${c.bg};border-color:${c.border}">
    <span class="dotmark" style="background:${c.dot}"></span>${esc(subjectLabel(id))}</span>`;
};

const TUTOR_KEY = "tnote.tutorPass";
const FAMILY_KEY = "tnote.familyPass";
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};

let role = null;
let students = [];
let currentSid = null;
let tutorPass = "0000";
let pendingRole = null;
let unsubs = [];
const off = () => { unsubs.forEach(u => u()); unsubs = []; };

// 教科セレクトの初期化
["h-subject", "l-subject", "b-subject", "t-subject"].forEach(id => {
  $(id).innerHTML = subjectOptionsHTML();
});
$("p-good").innerHTML = subjectOptionsHTML();
$("p-weak").innerHTML = subjectOptionsHTML();

/* ---------- 起動 ---------- */
(async function boot() {
  await signInAnonymously(auth);
  const cfgRef = doc(db, "config", "tutor");
  const cfg = await getDoc(cfgRef);
  if (!cfg.exists()) await setDoc(cfgRef, { passcode: "0000" });
  onSnapshot(cfgRef, s => { tutorPass = s.data()?.passcode ?? "0000"; });
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
  if (saved && verify(r, saved)) return start(r, saved);
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
  currentSid = r === "family" ? (students.find(x => x.passcode === code)?.id ?? null) : (students[0]?.id ?? null);
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

/* ---------- 生徒の切り替え ---------- */
function refreshStudentUI() {
  const sel = $("student-select");
  const list = role === "tutor" ? students : students.filter(s => s.id === currentSid);
  sel.innerHTML = list.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("");
  sel.value = currentSid ?? "";
  $("student-picker").hidden = !(role === "tutor" && list.length > 1);
  if (!currentSid && list.length) { currentSid = list[0].id; sel.value = currentSid; watchAll(); }
  if (!list.length) $("hw-list").innerHTML = `<div class="empty">まず「設定」タブで生徒を追加してください。</div>`;
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
let lessons = [], homework = [], tests = [], books = [], studyLogs = [], schedule = [];
const sub = (name, order, dir, apply) => {
  const q = query(collection(db, "students", currentSid, name), orderBy(order, dir));
  unsubs.push(onSnapshot(q, s => apply(s.docs.map(d => ({ id: d.id, ...d.data() })))));
};
function watchAll() {
  off();
  if (!currentSid) return;
  sub("lessons", "date", "desc", rows => { lessons = rows; renderLessons(); renderCalendars(); });
  sub("homework", "dueDate", "asc", rows => { homework = rows; renderHomework(); renderCalendars(); });
  sub("tests", "date", "asc", rows => { tests = rows; renderTests(); });
  sub("messages", "createdAt", "asc", renderMessages);
  sub("books", "createdAt", "desc", rows => { books = rows; renderBooks(); refreshBookSelect(); });
  sub("studyLogs", "date", "desc", rows => { studyLogs = rows; renderStudy(); });
  sub("schedule", "date", "asc", rows => { schedule = rows; renderSchedule(); renderCalendars(); });
  loadProfile();
}

/* ---------- 宿題 ---------- */
function hwBadge(r) {
  if (r.done) return `<span class="badge done">提出済み</span>`;
  const left = (new Date(r.dueDate) - new Date(today())) / 86400000;
  if (left < 0) return `<span class="badge late">期限切れ</span>`;
  if (left <= 2) return `<span class="badge soon">まもなく期限</span>`;
  return `<span class="badge">未提出</span>`;
}
function renderHomework() {
  const rows = homework;
  const done = rows.filter(r => r.done).length;
  const pct = rows.length ? Math.round(done / rows.length * 100) : 0;
  drawRing("hw-ring", pct);
  $("hw-ring-label").textContent = pct + "%";
  $("hw-ring-sub").textContent = rows.length ? `${done} / ${rows.length} 件 提出済み` : "まだ宿題がありません。";

  $("hw-list").innerHTML = rows.length ? rows.map(r => `
    <article class="item">
      <div class="meta"><span class="date">期限 ${fmtDate(r.dueDate)}</span>${hwBadge(r)}</div>
      <h4>${esc(r.title)} ${subjectChip(r.subject)}</h4>
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
    title: $("h-title").value.trim(), subject: $("h-subject").value,
    detail: $("h-detail").value.trim(), dueDate: $("h-due").value,
    done: false, question: "", createdAt: serverTimestamp()
  });
  e.target.reset();
});

/* ---------- 円形の達成率リング ---------- */
function drawRing(id, pct) {
  const svg = $(id), r = 50, c = 2 * Math.PI * r;
  svg.innerHTML = `
    <circle cx="60" cy="60" r="${r}" fill="none" stroke="var(--blue-line)" stroke-width="12"/>
    <circle cx="60" cy="60" r="${r}" fill="none" stroke="var(--blue)" stroke-width="12"
      stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct / 100)}"
      transform="rotate(-90 60 60)"/>`;
}

/* ---------- 指導記録 ---------- */
function renderLessons() {
  $("lesson-list").innerHTML = lessons.length ? lessons.map(r => `
    <article class="item">
      <div class="meta"><span class="date">${fmtDate(r.date)}</span>${subjectChip(r.subject)}</div>
      ${r.range ? `<h4>${esc(r.range)}</h4>` : ""}
      ${r.content ? `<p class="label">授業内容</p><p>${esc(r.content)}</p>` : ""}
      ${r.notes ? `<p class="label">所感</p><p>${esc(r.notes)}</p>` : ""}
    </article>`).join("") : `<div class="empty">まだ指導記録がありません。</div>`;
}
$("lesson-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  await addDoc(collection(db, "students", currentSid, "lessons"), {
    date: $("l-date").value, subject: $("l-subject").value,
    range: $("l-range").value.trim(), content: $("l-content").value.trim(),
    notes: $("l-notes").value.trim(), createdAt: serverTimestamp()
  });
  e.target.reset(); $("l-date").value = today();
});

/* ---------- 指導予定（Zoom URL付き） ---------- */
function renderSchedule() {
  const upcoming = schedule.filter(s => s.date >= today());
  $("schedule-list").innerHTML = upcoming.length ? upcoming.map(s => `
    <article class="item">
      <div class="meta"><span class="date">${fmtDate(s.date)}${s.time ? " " + s.time : ""}</span>
        ${role === "tutor" ? `<button class="small outline danger" data-sc-del="${esc(s.id)}">削除</button>` : ""}</div>
      ${s.memo ? `<p>${esc(s.memo)}</p>` : ""}
      ${s.zoomUrl ? `<p><a href="${esc(s.zoomUrl)}" target="_blank" rel="noopener" class="zoom-link">Zoomで参加 →</a></p>` : ""}
    </article>`).join("") : `<div class="empty">次回の指導予定はまだ登録されていません。</div>`;
}
$("schedule-list").addEventListener("click", async (e) => {
  const d = e.target.closest("[data-sc-del]");
  if (d && confirm("この指導予定を削除しますか？")) await deleteDoc(doc(db, "students", currentSid, "schedule", d.dataset.scDel));
});
$("schedule-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  await addDoc(collection(db, "students", currentSid, "schedule"), {
    date: $("sc-date").value, time: $("sc-time").value, zoomUrl: $("sc-zoom").value.trim(),
    memo: $("sc-memo").value.trim(), createdAt: serverTimestamp()
  });
  e.target.reset();
});

/* ---------- カレンダー（宿題タブ・指導記録タブ共通） ---------- */
const calState = { hw: new Date(), lesson: new Date() };
document.querySelectorAll("[data-cal]").forEach(btn => {
  btn.addEventListener("click", () => {
    const key = btn.dataset.cal;
    calState[key].setMonth(calState[key].getMonth() + Number(btn.dataset.nav));
    renderCalendars();
  });
});
function buildCalendar(baseDate, marksByDate) {
  const y = baseDate.getFullYear(), m = baseDate.getMonth();
  const first = new Date(y, m, 1), startWeekday = first.getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push("");
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  const weekLabels = ["日", "月", "火", "水", "木", "金", "土"];
  let html = weekLabels.map(w => `<div class="cal-dow">${w}</div>`).join("");
  html += cells.map(d => {
    if (!d) return `<div class="cal-cell empty"></div>`;
    const iso = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const marks = marksByDate[iso] ?? [];
    const isToday = iso === today();
    return `<div class="cal-cell${isToday ? " today" : ""}">
      <span class="cal-day">${d}</span>
      <span class="cal-dots">${marks.map(k => `<span class="dot ${k}"></span>`).join("")}</span>
    </div>`;
  }).join("");
  return html;
}
function renderCalendars() {
  const marks = {};
  const add = (date, kind) => { if (!date) return; (marks[date] ??= []).push(kind); };
  homework.forEach(h => add(h.dueDate, "due"));
  lessons.forEach(l => add(l.date, "lesson"));
  schedule.forEach(s => add(s.date, "lesson"));
  $("hw-calendar").innerHTML = buildCalendar(calState.hw, marks);
  $("lesson-calendar").innerHTML = buildCalendar(calState.lesson, marks);
  const label = (d) => `${d.getFullYear()}年 ${d.getMonth() + 1}月`;
  $("hw-cal-title").textContent = label(calState.hw);
  $("lesson-cal-title").textContent = label(calState.lesson);
}

/* ---------- 参考書 ---------- */
function refreshBookSelect() {
  $("st-book").innerHTML = books.length
    ? books.map(b => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join("")
    : `<option value="">（参考書を先に登録してください）</option>`;
}
function renderBooks() {
  $("book-list").innerHTML = books.length ? books.map(b => `
    <article class="book-card">
      <div class="book-thumb">${b.image ? `<img src="${b.image}" alt="">` : `<div class="book-noimg">${esc(b.name.slice(0, 2))}</div>`}</div>
      <div class="book-body">
        <h4>${esc(b.name)}</h4>
        ${subjectChip(b.subject)}
        <div class="ring-wrap small"><svg class="book-ring" data-ring="${esc(b.id)}" viewBox="0 0 120 120"></svg>
          <div class="ring-label small">${b.progress ?? 0}%</div></div>
        <label class="hint left" style="margin-top:.4rem">進捗を更新
          <input type="range" min="0" max="100" value="${b.progress ?? 0}" data-progress="${esc(b.id)}"></label>
        ${role === "family" || role === "tutor" ? `<button class="small outline danger" data-book-del="${esc(b.id)}">削除</button>` : ""}
      </div>
    </article>`).join("") : `<div class="empty">まだ参考書が登録されていません。</div>`;
  books.forEach(b => drawRing2(`.book-ring[data-ring="${b.id}"]`, b.progress ?? 0));
}
function drawRing2(selector, pct) {
  const svg = document.querySelector(selector); if (!svg) return;
  const r = 50, c = 2 * Math.PI * r;
  svg.innerHTML = `
    <circle cx="60" cy="60" r="${r}" fill="none" stroke="var(--blue-line)" stroke-width="12"/>
    <circle cx="60" cy="60" r="${r}" fill="none" stroke="var(--blue)" stroke-width="12"
      stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct / 100)}"
      transform="rotate(-90 60 60)"/>`;
}
$("b-progress").addEventListener("input", () => { $("b-progress-out").textContent = $("b-progress").value + "%"; });
$("book-list").addEventListener("input", async (e) => {
  const p = e.target.closest("[data-progress]");
  if (p) {
    drawRing2(`.book-ring[data-ring="${p.dataset.progress}"]`, Number(p.value));
    p.closest(".book-card").querySelector(".ring-label").textContent = p.value + "%";
  }
});
$("book-list").addEventListener("change", async (e) => {
  const p = e.target.closest("[data-progress]");
  if (p) await updateDoc(doc(db, "students", currentSid, "books", p.dataset.progress), { progress: Number(p.value) });
});
$("book-list").addEventListener("click", async (e) => {
  const d = e.target.closest("[data-book-del]");
  if (d && confirm("この参考書を削除しますか？（勉強時間の記録は残ります）"))
    await deleteDoc(doc(db, "students", currentSid, "books", d.dataset.bookDel));
});
function fileToDataUrl(file, maxSize = 480) {
  return new Promise((resolve, reject) => {
    const img = new Image(); const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
        cv.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(cv.toDataURL("image/jpeg", 0.8));
      };
      img.onerror = reject; img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
$("book-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const file = $("b-image").files[0];
  const image = file ? await fileToDataUrl(file).catch(() => "") : "";
  await addDoc(collection(db, "students", currentSid, "books"), {
    name: $("b-name").value.trim(), subject: $("b-subject").value, image,
    progress: Number($("b-progress").value), createdAt: serverTimestamp()
  });
  e.target.reset(); $("b-progress-out").textContent = "0%";
});

/* ---------- 勉強時間 ---------- */
function renderStudy() {
  const byBook = {};
  studyLogs.forEach(l => { (byBook[l.bookId] ??= []).push(l); });
  const rows = Object.entries(byBook).map(([bookId, logs]) => {
    const book = books.find(b => b.id === bookId);
    const total = logs.reduce((s, l) => s + Number(l.minutes || 0), 0);
    return { bookId, book, logs, total };
  }).sort((a, b) => b.total - a.total);
  $("study-summary").innerHTML = rows.length ? rows.map(r => `
    <article class="item">
      <div class="meta"><span class="date">${esc(r.book?.name ?? "（削除された参考書）")}</span>${subjectChip(r.book?.subject)}</div>
      <p class="score">${Math.floor(r.total / 60)}<small>時間</small>${r.total % 60}<small>分</small></p>
      <details><summary class="hint" style="cursor:pointer">記録一覧（${r.logs.length}件）</summary>
        <div class="list" style="margin-top:.6rem">
          ${r.logs.map(l => `<div class="study-row"><span>${fmtDate(l.date)}</span><span>${l.minutes}分</span>
            ${role === "tutor" ? "" : `<button class="small outline danger" data-study-del="${esc(l.id)}">削除</button>`}</div>`).join("")}
        </div>
      </details>
    </article>`).join("") : `<div class="empty">まだ勉強時間の記録がありません。</div>`;
}
$("study-summary").addEventListener("click", async (e) => {
  const d = e.target.closest("[data-study-del]");
  if (d && confirm("この記録を削除しますか？")) await deleteDoc(doc(db, "students", currentSid, "studyLogs", d.dataset.studyDel));
});
$("study-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const bookId = $("st-book").value;
  if (!bookId) return alert("先に「参考書」タブで参考書を登録してください。");
  await addDoc(collection(db, "students", currentSid, "studyLogs"), {
    bookId, date: $("st-date").value, minutes: Number($("st-minutes").value), createdAt: serverTimestamp()
  });
  e.target.reset(); $("st-date").value = today();
});

/* ---------- 成績（模試） ---------- */
function renderTests() {
  const byExam = {};
  tests.forEach(t => { (byExam[t.examName || "模試"] ??= { date: t.date, rows: [] }).rows.push(t); });
  const exams = Object.entries(byExam).sort((a, b) => b[1].date.localeCompare(a[1].date));
  $("test-list").innerHTML = exams.length ? exams.map(([name, ex]) => `
    <article class="item">
      <div class="meta"><span class="date">${fmtDate(ex.date)}</span><span class="label">${esc(name)}</span></div>
      <div class="test-rows">
        ${ex.rows.map(r => `<div class="test-row">
          ${subjectChip(r.subject)}
          <span class="score">${r.score}<small> / ${r.max}（${Math.round(r.score / r.max * 100)}%）</small></span>
          ${role === "family" ? `<button class="small outline danger" data-test-del="${esc(r.id)}">削除</button>` : ""}
        </div>`).join("")}
      </div>
    </article>`).join("") : `<div class="empty">まだ模試結果がありません。</div>`;
  drawChart(tests);
}
$("test-list").addEventListener("click", async (e) => {
  const d = e.target.closest("[data-test-del]");
  if (d && confirm("削除しますか？")) await deleteDoc(doc(db, "students", currentSid, "tests", d.dataset.testDel));
});
function drawChart(rows) {
  if (rows.length < 2) { $("chart").innerHTML = `<p class="hint">2件以上登録すると推移グラフが表示されます。</p>`; return; }
  const W = 640, H = 240, P = 36;
  const bySubject = {};
  rows.forEach(r => (bySubject[r.subject] ??= []).push(r));
  const xs = (i, n) => P + (W - P * 2) * (n === 1 ? .5 : i / (n - 1));
  const ys = (p) => H - P - (H - P * 2) * (p / 100);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="得点率の推移">`;
  [0, 25, 50, 75, 100].forEach(p => {
    svg += `<line x1="${P}" y1="${ys(p)}" x2="${W - P}" y2="${ys(p)}" stroke="#e2eaf5"/>`
        +  `<text x="${P - 6}" y="${ys(p) + 4}" font-size="10" fill="#66748c" text-anchor="end">${p}</text>`;
  });
  Object.entries(bySubject).forEach(([subject, list], si) => {
    const c = subjectColor(subject).line;
    const pts = list.map((r, i) => [xs(i, list.length), ys(r.score / r.max * 100)]);
    svg += `<polyline fill="none" stroke="${c}" stroke-width="2.5" stroke-linejoin="round"
      points="${pts.map(p => p.join(",")).join(" ")}"/>`;
    pts.forEach(([x, y]) => svg += `<circle cx="${x}" cy="${y}" r="4" fill="#fff" stroke="${c}" stroke-width="2.5"/>`);
    svg += `<text x="${P}" y="${16 + si * 15}" font-size="11" fill="${c}" font-weight="700">■ ${esc(subjectLabel(subject))}</text>`;
  });
  $("chart").innerHTML = svg + `</svg>`;
}
$("test-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  await addDoc(collection(db, "students", currentSid, "tests"), {
    examName: $("t-exam").value.trim(), date: $("t-date").value, subject: $("t-subject").value,
    score: Number($("t-score").value), max: Number($("t-max").value), createdAt: serverTimestamp()
  });
  $("t-score").value = ""; $("t-subject").selectedIndex = 0;
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

/* ---------- 設定：プロフィール ---------- */
async function loadProfile() {
  const snap = await getDoc(doc(db, "students", currentSid));
  const d = snap.data() ?? {};
  $("p-name").value = d.name ?? "";
  $("p-birthday").value = d.birthday ?? "";
  $("p-target").value = d.targetSchool ?? "";
  setMultiSelect("p-good", d.goodSubjects ?? []);
  setMultiSelect("p-weak", d.weakSubjects ?? []);
}
function setMultiSelect(id, values) {
  [...$(id).options].forEach(o => { o.selected = values.includes(o.value); });
}
function getMultiSelect(id) { return [...$(id).selectedOptions].map(o => o.value); }
$("profile-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  await updateDoc(doc(db, "students", currentSid), {
    name: $("p-name").value.trim(), birthday: $("p-birthday").value,
    targetSchool: $("p-target").value.trim(),
    goodSubjects: getMultiSelect("p-good"), weakSubjects: getMultiSelect("p-weak")
  });
  alert("保存しました。");
});

/* ---------- 設定：チューター管理 ---------- */
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
  store.set(TUTOR_KEY, code);
  e.target.reset();
  alert("チューターのパスコードを変更しました。他の端末では再入力が必要です。");
});

/* ---------- 初期値 ---------- */
$("l-date").value = today();
$("t-date").value = today();
$("st-date").value = today();
$("sc-date").value = today();

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
  const tokenVal = await getToken(messaging, { vapidKey, serviceWorkerRegistration: reg });
  if (!tokenVal) return;
  await setDoc(doc(db, "students", currentSid, "tokens", tokenVal), { role, updatedAt: serverTimestamp() });
  onMessage(messaging, ({ notification }) => {
    reg.showNotification(notification?.title ?? "ノビノート", {
      body: notification?.body ?? "", icon: "./icon-192.png"
    });
  });
}
