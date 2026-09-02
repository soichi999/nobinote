import { firebaseConfig, vapidKey } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getMessaging, getToken, onMessage, isSupported
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";
import {
  getFirestore, collection, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  query, orderBy, onSnapshot, serverTimestamp, arrayUnion, arrayRemove
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { SUBJECTS, subjectLabel, subjectColor, subjectOptionsHTML, subjectPickerHTML } from "./subjects.js";

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
$("h-subject").insertAdjacentHTML("afterbegin", `<option value="">なし</option>`);
$("p-good").innerHTML = subjectPickerHTML();
$("p-weak").innerHTML = subjectPickerHTML();
$("h-type").addEventListener("change", () => {
  const isCount = $("h-type").value === "count";
  $("h-count-range").hidden = !isCount;
  $("h-count-numbers").hidden = !isCount;
});
$("h-unit-select").addEventListener("change", () => {
  $("h-unit-custom-wrap").hidden = $("h-unit-select").value !== "custom";
});

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
  return students.some(s => s.studentPasscode === code || s.parentPasscode === code);
}
const ROLE_LABEL = { tutor: "チューター", student: "生徒", parent: "保護者" };
function start(r, code) {
  if (r === "tutor") {
    role = "tutor";
    currentSid = students[0]?.id ?? null;
  } else {
    const s = students.find(x => x.studentPasscode === code);
    if (s) { role = "student"; currentSid = s.id; }
    else { role = "parent"; currentSid = students.find(x => x.parentPasscode === code)?.id ?? null; }
  }
  store.set(r === "tutor" ? TUTOR_KEY : FAMILY_KEY, code);
  $("whoami").textContent = ROLE_LABEL[role];
  document.querySelectorAll(".tutor-only").forEach(el => { el.hidden = role !== "tutor"; });
  document.querySelectorAll(".student-hide").forEach(el => { el.hidden = role === "student"; });
  document.querySelectorAll(".parent-hide").forEach(el => { el.hidden = role === "parent"; });
  document.querySelectorAll(".student-only-form").forEach(el => { el.hidden = role !== "student"; });
  show("app-view"); $("topbar").hidden = false;
  refreshStudentUI();
  renderStudentAdmin();
  watchAll();
  updateNotifBar();
  registerPushToken().catch(() => {});
  scrollTodayIntoView("calendar");
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
  if (!list.length) $("calendar-feed").innerHTML = `<div class="empty">まず「設定」タブで生徒を追加してください。</div>`;
}
$("student-select").addEventListener("change", e => { currentSid = e.target.value; watchAll(); });

/* ---------- タブ ---------- */
function scrollTodayIntoView(calendarId) {
  requestAnimationFrame(() => {
    $(calendarId).querySelector(".cal-cell.today")?.scrollIntoView({ block: "center", behavior: "smooth" });
  });
}
document.querySelectorAll(".tabs button").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach(b => b.classList.toggle("active", b === btn));
    document.querySelectorAll(".tab").forEach(s => { s.hidden = s.id !== "tab-" + btn.dataset.tab; });
    if (btn.dataset.tab === "calendar") scrollTodayIntoView("calendar");
  });
});

/* ---------- 購読 ---------- */
let lessons = [], homework = [], tests = [], books = [], studyLogs = [], schedule = [], examMeta = {}, tuition = [];
const examSlug = (date, name) => encodeURIComponent(`${date}__${name}`).slice(0, 400);
const sub = (name, order, dir, apply) => {
  const q = query(collection(db, "students", currentSid, name), orderBy(order, dir));
  unsubs.push(onSnapshot(q, s => apply(s.docs.map(d => ({ id: d.id, ...d.data() })))));
};
function watchAll() {
  off();
  // 生徒切り替え時に前の生徒のデータが一瞬でも表示され続けないよう、即座に状態をリセットしてから再描画する
  lessons = []; homework = []; tests = []; books = []; studyLogs = []; schedule = []; examMeta = {}; tuition = [];
  tuitionDates = []; renderTuitionChips();
  renderHomework(); renderCalendarFeed(); renderCalendars(); renderTests(); renderBooks(); refreshBookSelect();
  renderStudy(); renderTuition(); $("msg-list").innerHTML = "";
  if (!currentSid) return;
  sub("lessons", "date", "desc", rows => { lessons = rows; renderCalendarFeed(); renderCalendars(); });
  sub("homework", "dueDate", "asc", rows => { homework = rows; renderHomework(); renderCalendarFeed(); renderCalendars(); });
  sub("tests", "date", "asc", rows => { tests = rows; renderTests(); });
  sub("messages", "createdAt", "asc", renderMessages);
  sub("books", "createdAt", "desc", rows => { books = rows; renderBooks(); refreshBookSelect(); });
  sub("studyLogs", "date", "desc", rows => { studyLogs = rows; renderStudy(); });
  sub("schedule", "date", "asc", rows => { schedule = rows; renderCalendarFeed(); renderCalendars(); });
  sub("tuition", "createdAt", "desc", rows => { tuition = rows; renderTuition(); });
  unsubs.push(onSnapshot(collection(db, "students", currentSid, "examMeta"), s => {
    examMeta = Object.fromEntries(s.docs.map(d => [d.id, d.data()]));
    renderTests();
  }));
  loadProfile();
}

/* ---------- 宿題（単位ごとにチェック / 完了・未完了） ---------- */
function hwCounts(r) {
  const from = Number(r.countFrom) || 1, to = Number(r.countTo) || from;
  return Array.from({ length: Math.max(1, to - from + 1) }, (_, i) => from + i);
}
function hwProgress(r) {
  if (r.type === "count") {
    const counts = hwCounts(r);
    const cleared = (r.clearedCounts ?? []).length;
    return counts.length ? Math.round(cleared / counts.length * 100) : 0;
  }
  return r.done ? 100 : 0;
}
function hwBadge(r) {
  const pct = hwProgress(r);
  const left = (new Date(r.dueDate) - new Date(today())) / 86400000;
  const soonTag = left < 0 ? `<span class="badge late">期限切れ</span>` : left <= 2 ? `<span class="badge soon">まもなく期限</span>` : "";
  if (r.type === "count") {
    const cleared = (r.clearedCounts ?? []).length, total = hwCounts(r).length;
    return `<span class="badge${pct >= 100 ? " done" : ""}">${cleared}/${total}${esc(r.unit ?? "")}</span>${pct >= 100 ? "" : soonTag}`;
  }
  return `<span class="badge${pct >= 100 ? " done" : ""}">${pct >= 100 ? "達成 100%" : "未提出"}</span>${pct >= 100 ? "" : soonTag}`;
}
function renderHomework() {
  const rows = homework;
  const avgPct = rows.length ? Math.round(rows.reduce((s, r) => s + hwProgress(r), 0) / rows.length) : 0;
  const doneCount = rows.filter(r => hwProgress(r) >= 100).length;
  drawRing("hw-ring", avgPct);
  $("hw-ring-label").textContent = avgPct + "%";
  $("hw-ring-sub").textContent = rows.length ? `${doneCount} / ${rows.length} 件 達成（平均 ${avgPct}%）` : "まだ宿題がありません。";

  const bySubject = {};
  rows.forEach(r => { if (r.subject) (bySubject[r.subject] ??= []).push(r); });
  const subjectRows = Object.entries(bySubject);
  $("hw-subject-card").hidden = subjectRows.length === 0;
  $("hw-subject-bars").innerHTML = subjectRows.map(([subj, list]) => {
    const c = subjectColor(subj);
    const p = Math.round(list.reduce((s, r) => s + hwProgress(r), 0) / list.length);
    const d = list.filter(r => hwProgress(r) >= 100).length;
    return `<div class="subject-bar-row">
      ${subjectChip(subj)}
      <div class="subject-bar-track"><div class="subject-bar-fill" style="width:${p}%;background:${c.line}"></div></div>
      <span class="subject-bar-pct">${d}/${list.length}</span>
    </div>`;
  }).join("");
}
function homeworkItemHTML(r) {
  return `
    <article class="item">
      <div class="meta"><span class="date">期限 ${fmtDate(r.dueDate)}</span>${hwBadge(r)}</div>
      <h4>${esc(r.title)} ${subjectChip(r.subject)}</h4>
      ${r.detail ? `<p>${esc(r.detail)}</p>` : ""}
      ${r.question ? `<p class="label">生徒からの質問</p><p>${esc(r.question)}</p>` : ""}
      ${r.type === "count" ? `
        <div class="page-grid">${hwCounts(r).map(p => {
          const on = (r.clearedCounts ?? []).includes(p);
          return role === "parent" || role === "tutor"
            ? `<span class="page-chip${on ? " on" : ""} readonly">${p}</span>`
            : `<button type="button" class="page-chip${on ? " on" : ""}" data-count-toggle="${esc(r.id)}" data-count="${p}">${p}</button>`;
        }).join("")}</div>
      ` : role === "parent" || role === "tutor" ? "" : `
        <div class="actions">
          <button class="small outline" data-toggle="${esc(r.id)}" data-done="${r.done ? 1 : 0}">
            ${r.done ? "未完了に戻す" : "完了にする"}</button>
        </div>
      `}
      ${r.photo ? `<img class="hw-photo" src="${r.photo}" alt="提出写真">` : ""}
      <div class="actions">
        <button class="small outline" data-photo="${esc(r.id)}">写真を添付</button>
        <button class="small outline" data-ask="${esc(r.id)}">質問する</button>
        ${role === "tutor" ? `<button class="small outline danger" data-del="${esc(r.id)}">削除</button>` : ""}
      </div>
      <input type="file" accept="image/*" capture="environment" class="hidden-file" data-photo-input="${esc(r.id)}">
    </article>`;
}
$("hw-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const type = $("h-type").value;
  const base = {
    title: $("h-title").value.trim(), subject: $("h-subject").value, type,
    detail: $("h-detail").value.trim(), dueDate: $("h-due").value,
    question: "", createdAt: serverTimestamp()
  };
  if (type === "count") {
    const unit = $("h-unit-select").value === "custom" ? $("h-unit-custom").value.trim() : $("h-unit-select").value;
    base.unit = unit || "回";
    base.countFrom = Number($("h-count-from").value) || 1;
    base.countTo = Number($("h-count-to").value) || base.countFrom;
    base.clearedCounts = [];
  } else {
    base.done = false;
  }
  await addDoc(collection(db, "students", currentSid, "homework"), base);
  e.target.reset();
  $("h-count-range").hidden = true;
  $("h-count-numbers").hidden = true;
  $("h-unit-custom-wrap").hidden = true;
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
function lessonItemHTML(r) {
  return `
    <article class="item">
      <div class="meta"><span class="date">指導記録</span>${subjectChip(r.subject)}</div>
      ${r.range ? `<h4>${esc(r.range)}</h4>` : ""}
      ${r.content ? `<p class="label">授業内容</p><p>${esc(r.content)}</p>` : ""}
      ${r.notes ? `<p class="label">所感</p><p>${esc(r.notes)}</p>` : ""}
    </article>`;
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
function scheduleItemHTML(s) {
  return `
    <article class="item">
      <div class="meta"><span class="date">指導予定${s.time ? " " + s.time : ""}</span>
        ${role === "tutor" ? `<button class="small outline danger" data-sc-del="${esc(s.id)}">削除</button>` : ""}</div>
      ${s.memo ? `<p>${esc(s.memo)}</p>` : ""}
      ${s.zoomUrl ? `<p><a href="${esc(s.zoomUrl)}" target="_blank" rel="noopener" class="zoom-link">Zoomで参加 →</a></p>` : ""}
    </article>`;
}
$("schedule-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  await addDoc(collection(db, "students", currentSid, "schedule"), {
    date: $("sc-date").value, time: $("sc-time").value, zoomUrl: $("sc-zoom").value.trim(),
    memo: $("sc-memo").value.trim(), reminded: false, createdAt: serverTimestamp()
  });
  e.target.reset();
});

/* ---------- カレンダー下：日付別フィード（宿題・指導予定・指導記録を統合、新しい日付が上） ---------- */
function renderCalendarFeed() {
  const dateMap = {};
  const ensure = (date) => (dateMap[date] ??= { hw: [], lesson: [], sched: [] });
  homework.forEach(h => { if (h.dueDate) ensure(h.dueDate).hw.push(h); });
  lessons.forEach(l => { if (l.date) ensure(l.date).lesson.push(l); });
  schedule.forEach(s => { if (s.date) ensure(s.date).sched.push(s); });
  const dates = Object.keys(dateMap).sort((a, b) => b.localeCompare(a));
  $("calendar-feed").innerHTML = dates.length ? dates.map(date => {
    const { hw, lesson, sched } = dateMap[date];
    return `<div class="feed-date-group">
      <h4 class="feed-date-heading">${fmtDateLong(date)}</h4>
      ${sched.map(scheduleItemHTML).join("")}
      ${lesson.map(lessonItemHTML).join("")}
      ${hw.map(homeworkItemHTML).join("")}
    </div>`;
  }).join("") : `<div class="empty">まだ予定・記録がありません。</div>`;
}
$("calendar-feed").addEventListener("click", async (e) => {
  const t = e.target.closest("[data-toggle]"), a = e.target.closest("[data-ask]"), d = e.target.closest("[data-del]");
  const p = e.target.closest("[data-photo]"), pg = e.target.closest("[data-count-toggle]");
  const scd = e.target.closest("[data-sc-del]");
  const hwRef = (id) => doc(db, "students", currentSid, "homework", id);
  if (t) await updateDoc(hwRef(t.dataset.toggle), { done: t.dataset.done !== "1", doneAt: serverTimestamp() });
  else if (a) { const q = prompt("先生への質問を入力してください"); if (q) await updateDoc(hwRef(a.dataset.ask), { question: q }); }
  else if (d && confirm("この宿題を削除しますか？")) await deleteDoc(hwRef(d.dataset.del));
  else if (p) document.querySelector(`[data-photo-input="${p.dataset.photo}"]`).click();
  else if (pg) {
    const count = Number(pg.dataset.count);
    const op = pg.classList.contains("on") ? arrayRemove(count) : arrayUnion(count);
    await updateDoc(hwRef(pg.dataset.countToggle), { clearedCounts: op });
  } else if (scd && confirm("この指導予定を削除しますか？")) {
    await deleteDoc(doc(db, "students", currentSid, "schedule", scd.dataset.scDel));
  }
});
$("calendar-feed").addEventListener("change", async (e) => {
  const input = e.target.closest("[data-photo-input]");
  if (!input || !input.files[0]) return;
  const photo = await fileToDataUrl(input.files[0]).catch(() => "");
  if (photo) await updateDoc(doc(db, "students", currentSid, "homework", input.dataset.photoInput), { photo });
});

/* ---------- 月謝 ---------- */
const fmtMD = (s) => { if (!s) return ""; const [, m, d] = s.split("-"); return `${Number(m)}/${Number(d)}`; };
let tuitionDates = [];
function renderTuitionChips() {
  $("tu-date-chips").innerHTML = tuitionDates.slice().sort().map(d =>
    `<span class="tuition-chip">${fmtMD(d)}<button type="button" data-remove-date="${d}">×</button></span>`
  ).join("");
}
$("tu-date-add").addEventListener("click", () => {
  const v = $("tu-date-input").value;
  if (v && !tuitionDates.includes(v)) { tuitionDates.push(v); renderTuitionChips(); }
  $("tu-date-input").value = "";
});
$("tu-date-chips").addEventListener("click", (e) => {
  const b = e.target.closest("[data-remove-date]");
  if (b) { tuitionDates = tuitionDates.filter(d => d !== b.dataset.removeDate); renderTuitionChips(); }
});
$("tuition-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!tuitionDates.length) return alert("対象日を1つ以上追加してください。");
  await addDoc(collection(db, "students", currentSid, "tuition"), {
    dates: tuitionDates.slice().sort(), amount: Number($("tu-amount").value),
    paid: false, createdAt: serverTimestamp()
  });
  tuitionDates = []; renderTuitionChips();
  e.target.reset();
});
function renderTuition() {
  $("tuition-list").innerHTML = tuition.length ? tuition.map(t => `
    <article class="item">
      <div class="meta">
        <span class="date">${(t.dates ?? []).map(fmtMD).join(" ")}</span>
        <span class="badge ${t.paid ? "done" : ""}">${t.paid ? "T（振込確認済み）" : "未確認"}</span>
      </div>
      <p class="score">${Number(t.amount).toLocaleString()}<small>円</small></p>
      ${role === "tutor" ? `<div class="actions">
        <button class="small outline" data-tuition-toggle="${esc(t.id)}" data-paid="${t.paid ? 1 : 0}">
          ${t.paid ? "未確認に戻す" : "振込確認"}</button>
        <button class="small outline danger" data-tuition-del="${esc(t.id)}">削除</button>
      </div>` : ""}
    </article>`).join("") : `<div class="empty">まだ月謝の登録がありません。</div>`;
}
$("tuition-list").addEventListener("click", async (e) => {
  const t = e.target.closest("[data-tuition-toggle]"), d = e.target.closest("[data-tuition-del]");
  if (t) await updateDoc(doc(db, "students", currentSid, "tuition", t.dataset.tuitionToggle), { paid: t.dataset.paid !== "1" });
  else if (d && confirm("この月謝の記録を削除しますか？")) await deleteDoc(doc(db, "students", currentSid, "tuition", d.dataset.tuitionDel));
});

/* ---------- カレンダー（宿題・指導記録・指導予定を統合） ---------- */
const calState = { main: new Date() };
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
    const shown = marks.slice(0, 2);
    const extra = marks.length - shown.length;
    const isToday = iso === today();
    return `<div class="cal-cell${isToday ? " today" : ""}" data-date="${iso}">
      <span class="cal-day">${d}</span>
      <span class="cal-pills">${shown.map(k => `<span class="pill ${k.kind}">${esc(k.text)}</span>`).join("")}${extra > 0 ? `<span class="pill more">+${extra}</span>` : ""}</span>
    </div>`;
  }).join("");
  return html;
}
function renderCalendars() {
  const raw = {};
  const add = (date, kind, text) => { if (!date) return; (raw[date] ??= []).push({ kind, text }); };
  homework.forEach(h => add(h.dueDate, "due", "期限"));
  lessons.forEach(l => add(l.date, "lesson", "指導日"));
  schedule.forEach(s => add(s.date, "lesson", s.time || "指導日"));
  if (role === "tutor") tuition.forEach(t => (t.dates ?? []).forEach(d => add(d, "tuition", "月謝")));
  const marks = {};
  Object.entries(raw).forEach(([date, list]) => {
    const dueCount = list.filter(k => k.kind === "due").length;
    const tuitionCount = list.filter(k => k.kind === "tuition").length;
    const merged = list.filter(k => k.kind === "lesson");
    if (dueCount) merged.unshift({ kind: "due", text: dueCount > 1 ? `期限×${dueCount}` : "期限" });
    if (tuitionCount) merged.push({ kind: "tuition", text: "月謝" });
    marks[date] = merged;
  });
  $("calendar").innerHTML = buildCalendar(calState.main, marks);
  const label = (d) => `${d.getFullYear()}年 ${d.getMonth() + 1}月`;
  $("cal-title").textContent = label(calState.main);
  if (!initialScrollDone) { initialScrollDone = true; scrollTodayIntoView("calendar"); }
}
let initialScrollDone = false;

/* ---------- 日付の詳細モーダル ---------- */
const weekdayJP = ["日", "月", "火", "水", "木", "金", "土"];
function fmtDateLong(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${m}月${d}日（${weekdayJP[new Date(y, m - 1, d).getDay()]}）`;
}
function openDayModal(iso) {
  $("day-modal-title").textContent = fmtDateLong(iso);
  const daySchedule = schedule.filter(s => s.date === iso);
  const dayLessons = lessons.filter(l => l.date === iso);
  const dayHomework = homework.filter(h => h.dueDate === iso);
  const dayTuition = tuition.filter(t => (t.dates ?? []).includes(iso));
  const sections = [];

  if (daySchedule.length || dayLessons.length) {
    sections.push(`<div class="modal-section"><h4 class="modal-sub">指導日</h4>
      ${daySchedule.map(s => `<div class="item">
        <div class="meta"><span class="date">${esc(s.time || "時間未設定")}</span></div>
        ${s.memo ? `<p>${esc(s.memo)}</p>` : ""}
        ${s.zoomUrl ? `<p><a href="${esc(s.zoomUrl)}" target="_blank" rel="noopener" class="zoom-link">Zoomで参加 →</a></p>` : ""}
      </div>`).join("")}
      ${dayLessons.map(l => `<div class="item">
        <div class="meta">${subjectChip(l.subject)}</div>
        ${l.range ? `<h4>${esc(l.range)}</h4>` : ""}
        ${l.notes ? `<p>${esc(l.notes)}</p>` : ""}
      </div>`).join("")}
    </div>`);
  }
  if (role !== "parent" && dayHomework.length) {
    sections.push(`<div class="modal-section"><h4 class="modal-sub">宿題期限</h4>
      ${dayHomework.map(h => `<div class="item">
        <div class="meta">${subjectChip(h.subject)}</div><h4>${esc(h.title)}</h4>
      </div>`).join("")}
    </div>`);
  }
  if (role !== "student" && dayTuition.length) {
    sections.push(`<div class="modal-section"><h4 class="modal-sub">月謝</h4>
      ${dayTuition.map(t => `<div class="item">
        <p class="score">${Number(t.amount).toLocaleString()}<small>円</small></p>
        <span class="badge ${t.paid ? "done" : ""}">${t.paid ? "T（振込確認済み）" : "未確認"}</span>
      </div>`).join("")}
    </div>`);
  }
  $("day-modal-body").innerHTML = sections.length ? sections.join("") : `<div class="empty">この日の予定はありません。</div>`;
  $("day-modal").hidden = false;
}
function handleCalClick(e) {
  const cell = e.target.closest("[data-date]");
  if (cell) openDayModal(cell.dataset.date);
}
$("calendar").addEventListener("click", handleCalClick);
$("day-modal-close").addEventListener("click", () => { $("day-modal").hidden = true; });
$("day-modal").addEventListener("click", (e) => { if (e.target.id === "day-modal") $("day-modal").hidden = true; });

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
        ${role === "student" ? `<button class="small outline danger" data-book-del="${esc(b.id)}">削除</button>` : ""}
      </div>
    </article>`).join("") : `<div class="empty">まだ参考書が登録されていません。</div>`;
}
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
    createdAt: serverTimestamp()
  });
  e.target.reset();
});

/* ---------- 勉強時間 ---------- */
function renderStudy() {
  const byMonth = {};
  studyLogs.forEach(l => { const ym = (l.date || "").slice(0, 7); if (ym) byMonth[ym] = (byMonth[ym] || 0) + Number(l.minutes || 0); });
  const months = Object.keys(byMonth).sort().slice(-6);
  $("study-monthly-card").hidden = months.length === 0;
  const maxMinutes = Math.max(1, ...months.map(m => byMonth[m]));
  $("study-monthly").innerHTML = months.map(m => {
    const [y, mo] = m.split("-");
    const mins = byMonth[m];
    const w = Math.round(mins / maxMinutes * 100);
    return `<div class="month-bar-row">
      <span class="month-bar-label">${y}/${Number(mo)}月</span>
      <div class="month-bar-track"><div class="month-bar-fill" style="width:${w}%"></div></div>
      <span class="month-bar-val">${Math.floor(mins / 60)}時間${mins % 60}分</span>
    </div>`;
  }).join("");

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
            ${role === "student" ? `<button class="small outline danger" data-study-del="${esc(l.id)}">削除</button>` : ""}</div>`).join("")}
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
const JUDGMENT_RANKS = ["A", "B", "C", "D", "E"];
function renderTests() {
  const byExam = {};
  tests.forEach(t => { (byExam[t.examName || "模試"] ??= { date: t.date, rows: [] }).rows.push(t); });
  const exams = Object.entries(byExam).sort((a, b) => b[1].date.localeCompare(a[1].date));
  const canEdit = role === "student";
  $("test-list").innerHTML = exams.length ? exams.map(([name, ex]) => {
    const totalScore = ex.rows.reduce((s, r) => s + Number(r.score), 0);
    const totalMax = ex.rows.reduce((s, r) => s + Number(r.max), 0);
    const slug = examSlug(ex.date, name);
    const meta = examMeta[slug] ?? {};
    const judgments = meta.judgments ?? [];
    return `
    <article class="item">
      <div class="meta"><span class="date">${fmtDate(ex.date)}</span><span class="label">${esc(name)}</span></div>
      <p class="score">${totalScore}<small> / ${totalMax}（${Math.round(totalScore / totalMax * 100)}%）合計</small></p>
      <p class="hint left rank-row">順位：<span data-rank-view>${esc(meta.rank || "未登録")}</span>
        ${canEdit ? `<button type="button" class="small outline" data-rank-edit="${slug}">編集</button>` : ""}</p>
      <div class="test-rows">
        ${ex.rows.map(r => `<div class="test-row">
          ${subjectChip(r.subject)}
          <span class="score">${r.score}<small> / ${r.max}（${Math.round(r.score / r.max * 100)}%）</small>${r.deviation != null ? `<small> 偏差値${r.deviation}</small>` : ""}</span>
          ${role === "student" ? `<button class="small outline danger" data-test-del="${esc(r.id)}">削除</button>` : ""}
        </div>`).join("")}
      </div>
      <div class="judgment-block">
        <p class="label">志望校判定</p>
        ${judgments.length ? judgments.map((j, i) => `<div class="judgment-row">
          <span class="badge">${esc(j.school)}</span><span class="judgment-rank">${esc(j.rank)}判定</span>
          ${canEdit ? `<button type="button" class="small outline danger" data-judgment-del="${slug}" data-idx="${i}">削除</button>` : ""}
        </div>`).join("") : `<p class="hint left">まだ登録がありません。</p>`}
        ${canEdit ? `<div class="judgment-add">
          <select data-judgment-school="${slug}">
            ${targetSchools.length ? targetSchools.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join("") : `<option value="">（設定タブで志望校を登録）</option>`}
          </select>
          <select data-judgment-rank="${slug}">${JUDGMENT_RANKS.map(r => `<option value="${r}">${r}判定</option>`).join("")}</select>
          <button type="button" class="small outline" data-judgment-add="${slug}">追加</button>
        </div>` : ""}
      </div>
    </article>`;
  }).join("") : `<div class="empty">まだ模試結果がありません。</div>`;
  drawChart(tests);
}
$("test-list").addEventListener("click", async (e) => {
  const d = e.target.closest("[data-test-del]");
  const r = e.target.closest("[data-rank-edit]");
  const ja = e.target.closest("[data-judgment-add]");
  const jd = e.target.closest("[data-judgment-del]");
  if (d && confirm("削除しますか？")) await deleteDoc(doc(db, "students", currentSid, "tests", d.dataset.testDel));
  else if (r) {
    const cur = r.parentElement.querySelector("[data-rank-view]").textContent;
    const val = prompt("順位を入力してください（例：12/120）", cur === "未登録" ? "" : cur);
    if (val !== null) await setDoc(doc(db, "students", currentSid, "examMeta", r.dataset.rankEdit), { rank: val.trim() }, { merge: true });
  } else if (ja) {
    const slug = ja.dataset.judgmentAdd;
    const school = document.querySelector(`[data-judgment-school="${slug}"]`).value;
    const rank = document.querySelector(`[data-judgment-rank="${slug}"]`).value;
    if (!school) return alert("設定タブで志望校を登録してください。");
    const cur = (examMeta[slug]?.judgments) ?? [];
    await setDoc(doc(db, "students", currentSid, "examMeta", slug), { judgments: [...cur, { school, rank }] }, { merge: true });
  } else if (jd) {
    const slug = jd.dataset.judgmentDel, idx = Number(jd.dataset.idx);
    const cur = (examMeta[slug]?.judgments) ?? [];
    await setDoc(doc(db, "students", currentSid, "examMeta", slug), { judgments: cur.filter((_, i) => i !== idx) }, { merge: true });
  }
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
  const deviation = $("t-deviation").value.trim();
  await addDoc(collection(db, "students", currentSid, "tests"), {
    examName: $("t-exam").value.trim(), date: $("t-date").value, subject: $("t-subject").value,
    score: Number($("t-score").value), max: Number($("t-max").value),
    deviation: deviation ? Number(deviation) : null, createdAt: serverTimestamp()
  });
  $("t-score").value = ""; $("t-deviation").value = ""; $("t-subject").selectedIndex = 0;
});

/* ---------- 連絡（役割別の既読つき） ---------- */
function renderMessages(rows) {
  $("msg-list").innerHTML = rows.length ? rows.map(r => {
    const readBy = r.readBy ?? {};
    const readers = ["tutor", "student", "parent"]
      .filter(k => k !== r.authorRole && readBy[k])
      .map(k => ROLE_LABEL[k]);
    const readLine = readers.length ? `既読：${readers.join("・")}` : "未読";
    return `
    <article class="item ${r.authorRole === role ? "me" : ""}">
      <div class="meta">
        <span class="date">${esc(ROLE_LABEL[r.authorRole] ?? r.authorRole)}</span>
        <span>${r.createdAt?.toDate ? r.createdAt.toDate().toLocaleString("ja-JP") : ""}</span>
      </div>
      <p>${esc(r.text)}</p>
      ${r.authorRole === role ? `<p class="hint left msg-read">${readLine}</p>` : ""}
      ${r.authorRole === role ? `<div class="actions"><button class="small outline danger" data-msg-del="${esc(r.id)}">削除</button></div>` : ""}
    </article>`;
  }).join("") : `<div class="empty">まだメッセージはありません。</div>`;
  $("msg-list").lastElementChild?.scrollIntoView({ block: "nearest" });
  markMessagesRead(rows);
}
$("msg-list").addEventListener("click", async (e) => {
  const d = e.target.closest("[data-msg-del]");
  if (d && confirm("このメッセージを削除しますか？")) {
    await deleteDoc(doc(db, "students", currentSid, "messages", d.dataset.msgDel));
  }
});
function markMessagesRead(rows) {
  if (!role) return;
  rows.filter(r => r.authorRole !== role && !(r.readBy ?? {})[role]).forEach(r => {
    updateDoc(doc(db, "students", currentSid, "messages", r.id), { [`readBy.${role}`]: true }).catch(() => {});
  });
}
$("msg-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  await addDoc(collection(db, "students", currentSid, "messages"), {
    text: $("m-text").value.trim(), authorRole: role, createdAt: serverTimestamp(),
    readBy: { [role]: true }
  });
  e.target.reset();
});

/* ---------- 設定：プロフィール ---------- */
// 名前・誕生日：生徒とチューターが編集可、保護者は閲覧のみ
// 志望校・得意/苦手科目：生徒のみ編集可、チューター・保護者は閲覧のみ
let targetSchools = [];
function renderTargetChips() {
  const editable = role === "student";
  $("p-target-chips").innerHTML = targetSchools.map((t, i) =>
    `<span class="tuition-chip">${esc(t)}${editable ? `<button type="button" data-remove-target="${i}">×</button>` : ""}</span>`
  ).join("");
}
$("p-target-add").addEventListener("click", () => {
  const v = $("p-target-input").value.trim();
  if (!v) return;
  if (targetSchools.length >= 10) return alert("志望校は最大10件までです。");
  targetSchools.push(v);
  renderTargetChips();
  $("p-target-input").value = "";
});
$("p-target-input").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); $("p-target-add").click(); } });
$("p-target-chips").addEventListener("click", (e) => {
  const b = e.target.closest("[data-remove-target]");
  if (b) { targetSchools.splice(Number(b.dataset.removeTarget), 1); renderTargetChips(); }
});
async function loadProfile() {
  const snap = await getDoc(doc(db, "students", currentSid));
  const d = snap.data() ?? {};
  const nameEditable = role !== "parent";
  const targetSubjectsEditable = role === "student";

  $("p-name").value = d.name ?? "";
  $("p-name").disabled = !nameEditable;
  $("p-birthday").value = d.birthday ?? "";
  $("p-birthday").disabled = !targetSubjectsEditable;

  targetSchools = Array.isArray(d.targetSchools) ? d.targetSchools.slice(0, 10) : (d.targetSchool ? [d.targetSchool] : []);
  renderTargetChips();
  $("p-target-input").hidden = !targetSubjectsEditable;
  $("p-target-add").hidden = !targetSubjectsEditable;

  setMultiSelect("p-good", d.goodSubjects ?? []);
  setMultiSelect("p-weak", d.weakSubjects ?? []);
  setPickerDisabled("p-good", !targetSubjectsEditable);
  setPickerDisabled("p-weak", !targetSubjectsEditable);

  $("p-save-btn").hidden = !(nameEditable || targetSubjectsEditable);
  $("p-save-btn").classList.remove("dirty");
}
function setMultiSelect(id, values) {
  $(id).querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = values.includes(cb.value); });
}
function getMultiSelect(id) { return [...$(id).querySelectorAll('input[type="checkbox"]:checked')].map(cb => cb.value); }
function setPickerDisabled(id, disabled) {
  $(id).querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.disabled = disabled; });
}
$("profile-form").addEventListener("input", () => $("p-save-btn").classList.add("dirty"));
$("profile-form").addEventListener("change", () => $("p-save-btn").classList.add("dirty"));
$("p-target-chips").addEventListener("click", () => $("p-save-btn").classList.add("dirty"));
$("profile-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = {};
  if (role !== "parent") {
    data.name = $("p-name").value.trim();
  }
  if (role === "student") {
    data.birthday = $("p-birthday").value;
    data.targetSchools = targetSchools.slice(0, 10);
    data.goodSubjects = getMultiSelect("p-good");
    data.weakSubjects = getMultiSelect("p-weak");
  }
  await updateDoc(doc(db, "students", currentSid), data);
  $("p-save-btn").classList.remove("dirty");
  alert("保存しました。");
});

/* ---------- 設定：チューター管理 ---------- */
function codeTaken(code, exceptId) {
  return students.some(s => s.id !== exceptId && (s.studentPasscode === code || s.parentPasscode === code));
}
function renderStudentAdmin() {
  if (role !== "tutor") return;
  $("student-admin").innerHTML = students.length ? students.map(s => `
    <article class="item">
      <div class="meta"><span class="date">${esc(s.name)}</span></div>
      <div class="grid">
        <label>生徒用パスコード<input type="text" inputmode="numeric" value="${esc(s.studentPasscode ?? "")}" data-pass-student="${esc(s.id)}"></label>
        <label>保護者用パスコード<input type="text" inputmode="numeric" value="${esc(s.parentPasscode ?? "")}" data-pass-parent="${esc(s.id)}"></label>
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
    const studentPasscode = document.querySelector(`[data-pass-student="${id}"]`).value.trim();
    const parentPasscode = document.querySelector(`[data-pass-parent="${id}"]`).value.trim();
    if (!studentPasscode || !parentPasscode) return alert("両方のパスコードを入力してください。");
    if (studentPasscode === parentPasscode) return alert("生徒用と保護者用は別のパスコードにしてください。");
    if (codeTaken(studentPasscode, id) || codeTaken(parentPasscode, id)) return alert("他の生徒と同じパスコードは使えません。");
    await updateDoc(doc(db, "students", id), { studentPasscode, parentPasscode });
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
  const studentPasscode = $("s-pass-student").value.trim();
  const parentPasscode = $("s-pass-parent").value.trim();
  if (studentPasscode === parentPasscode) return alert("生徒用と保護者用は別のパスコードにしてください。");
  if (codeTaken(studentPasscode) || codeTaken(parentPasscode)) return alert("他の生徒と同じパスコードは使えません。");
  await addDoc(collection(db, "students"), { name: $("s-name").value.trim(), studentPasscode, parentPasscode });
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
