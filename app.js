import { firebaseConfig, vapidKey } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getMessaging, getToken, onMessage, isSupported
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";
import {
  getFirestore, collection, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  query, orderBy, onSnapshot, serverTimestamp, arrayUnion, arrayRemove, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { SUBJECTS, SUBJECT_GROUPS, subjectLabel, subjectColor, subjectOptionsHTML, subjectPickerHTML } from "./subjects.js";
import { MOCKS } from "./moshi/catalog.js";
import { VOCAB as VOCAB_BASE } from "./moshi/vocab.js";
import { SYN as SYN_BASE } from "./moshi/vocab_syn.js";
import { MORE, EX as EX_BASE } from "./moshi/vocab_more.js";
import { MATH_TYPES, MATH_BY_ID, MATH_FIELDS, MATH_LEVELS, MARK_OPTS, makeProblem } from "./moshi/math_daily.js";
// 英単語：レベル2＝vocab.js（英検2級の中心）、レベル1・3＝vocab_more.js（MORE）。ひとつの並びにまとめて使う
// EX：英検の空所補充用（例文中の形 form と、まちがいの選択肢 d）
const VOCAB = [...VOCAB_BASE, ...MORE.map(o => [o.w, o.pos, o.ja, o.ex, o.exj, o.grp, o.tip])];
const SYN = { ...SYN_BASE, ...Object.fromEntries(MORE.map(o => [`${o.w}:${o.pos}`, [o.syn, o.synj]])) };
const EX = { ...EX_BASE, ...Object.fromEntries(MORE.map(o => [`${o.w}:${o.pos}`, { form: o.form, d: o.d }])) };
const LEVEL_OF = Object.fromEntries([...VOCAB_BASE.map(v => [`${v[0]}:${v[1]}`, 2]), ...MORE.map(o => [`${o.w}:${o.pos}`, o.lv])]);

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c));
const fmtDate = (s) => { if (!s) return ""; const [y, m, d] = s.split("-"); return `${y}/${m}/${d}`; };
// 端末の日付で「今日」を決める（toISOString は世界標準時なので、日本の朝9時前に前日になってしまう）
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const show = (v) => ["gate-view", "pass-view", "app-view"].forEach(id => { $(id).hidden = id !== v; });
// フォームに変更が入るまで保存/追加ボタンをグレーのままにし、変更が入ったら青くする
function wireDirtySave(formId, btnId) {
  const form = $(formId), btn = $(btnId);
  const markDirty = () => btn.classList.add("dirty");
  form.addEventListener("input", markDirty);
  form.addEventListener("change", markDirty);
  form.addEventListener("submit", () => setTimeout(() => btn.classList.remove("dirty"), 0));
}
const subjectChip = (id) => {
  if (!id) return "";
  const c = subjectColor(id);
  return `<span class="badge subj" style="color:${c.fg};background:${c.bg};border-color:${c.border}">
    ${esc(subjectLabel(id))}</span>`;
};

const TUTOR_KEY = "tnote.tutorPass";
const FAMILY_KEY = "tnote.familyPass";
const LAST_STUDENT_KEY = "tnote.lastStudentSid";
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  del: (k) => { try { localStorage.removeItem(k); } catch {} },
};

let role = null;
let students = [];
let currentSid = null;
let tutorPass = "0000";
let pendingRole = null;
let unsubs = [];
const off = () => { unsubs.forEach(u => u()); unsubs = []; };

// 教科セレクトの初期化
["h-subject", "l-subject", "t-subject"].forEach(id => {
  $(id).innerHTML = subjectOptionsHTML();
});
$("h-subject").insertAdjacentHTML("afterbegin", `<option value="">なし</option>`);
$("p-good").innerHTML = subjectPickerHTML();
$("p-weak").innerHTML = subjectPickerHTML();
// 毎日の宿題は1週間（期限の6日前から期限まで）を初期値にする
function hwSetWeek() {
  const due = $("h-due").value;
  if (due) $("h-start").value = addDays(due, -6);
  else { $("h-start").value = today(); $("h-due").value = addDays(today(), 6); }
}
$("h-type").addEventListener("change", () => {
  const ty = $("h-type").value, isCount = ty === "count", daily = DAILY_HW[ty];
  $("h-count-range").hidden = !isCount;
  $("h-count-numbers").hidden = !isCount;
  $("h-daily-range").hidden = !daily;
  if (daily) {
    if (!$("h-start").value) hwSetWeek();
    $("h-subject").value = daily.subject;
    $("h-quota-unit").textContent = daily.unit;
    if (!editingHwId) $("h-quota").value = daily.quota;
    const tt = $("h-title").value.trim();
    if (!tt || Object.values(DAILY_HW).some(x => tt === x.title || tt.startsWith(x.title + "（"))) $("h-title").value = daily.title;
  }
});
$("h-due").addEventListener("change", () => { if (DAILY_HW[$("h-type").value] && !editingHwId) hwSetWeek(); });
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
  $("pass-title").textContent = r === "tutor" ? "先生" : "学生・保護者";
  $("pass-lead").textContent = "パスコードを入力してください";
  $("pass-input").value = ""; $("pass-error").textContent = "";
  show("pass-view");
  $("pass-input").focus();
}
function verify(r, code) {
  if (r === "tutor") return code === tutorPass;
  return students.some(s => s.studentPasscode === code || s.parentPasscode === code);
}
const ROLE_LABEL = { tutor: "先生", student: "生徒", parent: "保護者" };
function start(r, code) {
  if (r === "tutor") {
    role = "tutor";
    const lastSid = store.get(LAST_STUDENT_KEY);
    currentSid = (lastSid && students.some(s => s.id === lastSid)) ? lastSid : (students[0]?.id ?? null);
  } else {
    const s = students.find(x => x.studentPasscode === code);
    if (s) { role = "student"; currentSid = s.id; }
    else { role = "parent"; currentSid = students.find(x => x.parentPasscode === code)?.id ?? null; }
  }
  store.set(r === "tutor" ? TUTOR_KEY : FAMILY_KEY, code);
  $("whoami").textContent = ROLE_LABEL[role];
  $("account-who").textContent = `${ROLE_LABEL[role]}としてログインしています。`;
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
  off(); store.del(TUTOR_KEY); store.del(FAMILY_KEY);
  role = null; currentSid = null;
  $("topbar").hidden = true; show("gate-view");
});

/* ---------- 生徒の切り替え ---------- */
function refreshStudentUI() {
  const sel = $("student-select");
  const list = role === "tutor" ? students : students.filter(s => s.id === currentSid);
  sel.innerHTML = list.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("");
  sel.value = currentSid ?? "";
  $("student-picker").hidden = !(role === "tutor" && list.length > 1);
  if (!currentSid && list.length) {
    const lastSid = role === "tutor" ? store.get(LAST_STUDENT_KEY) : null;
    currentSid = (lastSid && list.some(s => s.id === lastSid)) ? lastSid : list[0].id;
    sel.value = currentSid; watchAll();
  }
  if (!list.length) $("calendar-feed").innerHTML = `<div class="empty">まず「設定」タブで生徒を追加してください。</div>`;
  if (role === "tutor" && currentSid) store.set(LAST_STUDENT_KEY, currentSid);
}
$("student-select").addEventListener("change", e => {
  currentSid = e.target.value;
  if (role === "tutor") store.set(LAST_STUDENT_KEY, currentSid);
  watchAll();
});

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
    btn.scrollIntoView({ block: "nearest", inline: "nearest" });
    if (btn.dataset.tab === "calendar") scrollTodayIntoView("calendar");
    if (btn.dataset.tab === "messages") { markMessagesRead(messages); }
    updateMsgBadge();
  });
});

/* ---------- 購読 ---------- */
let lessons = [], homework = [], tests = [], schedule = [], examMeta = {}, tuition = [], plans = [], mocks = [];
const examSlug = (date, name) => encodeURIComponent(`${date}__${name}`).slice(0, 400);
const sub = (name, order, dir, apply) => {
  const q = query(collection(db, "students", currentSid, name), orderBy(order, dir));
  unsubs.push(onSnapshot(q, s => apply(s.docs.map(d => ({ id: d.id, ...d.data() })))));
};
function watchAll() {
  off();
  // 生徒切り替え時に前の生徒のデータが一瞬でも表示され続けないよう、即座に状態をリセットしてから再描画する
  lessons = []; homework = []; tests = []; schedule = []; examMeta = {}; tuition = []; plans = []; mocks = [];
  vocab = { words: {}, days: {}, today: null }; renderVocabCard();
  math = { items: {}, days: {}, today: null }; renderMathCard();
  Object.keys(photoCache).forEach(k => delete photoCache[k]);
  tuitionDates = []; renderTuitionChips();
  renderHomework(); renderCalendarFeed(); renderCalendars(); renderTests(); renderMocks();
  renderTuition(); $("msg-list").innerHTML = "";
  if (!currentSid) return;
  sub("lessons", "date", "desc", rows => { lessons = rows; renderCalendarFeed(); renderCalendars(); });
  sub("homework", "dueDate", "asc", rows => { homework = rows; renderHomework(); renderCalendarFeed(); renderCalendars(); renderVocabCard(); renderMathCard(); });
  sub("tests", "date", "asc", rows => { tests = rows; renderTests(); });
  sub("messages", "createdAt", "asc", renderMessages);
  unsubs.push(onSnapshot(doc(db, "students", currentSid, "vocab", "state"), snap => {
    const d = snap.exists() ? snap.data() : {};
    const data = { words: d.words ?? {}, days: d.days ?? {}, today: d.today ?? null, level: d.level ?? null };
    if (vocabTrial) { vocabReal = data; return; }
    // 自分が答えている最中は、画面の内容を上書きしない
    if (role === "student" && !$("vocab-view").hidden) return;
    vocab = data;
    renderVocabCard();
    renderTodayCard();
    renderCalendars();
    if (homework.some(r => r.type === "daily-vocab")) { renderHomework(); renderCalendarFeed(); }
  }));
  unsubs.push(onSnapshot(doc(db, "students", currentSid, "math", "state"), snap => {
    const d = snap.exists() ? snap.data() : {};
    const data = { items: d.items ?? {}, days: d.days ?? {}, today: d.today ?? null, level: d.level ?? 1 };
    if (mathTrial) { mathReal = data; return; }
    // 自分が解いている最中は、画面の内容を上書きしない
    if (role === "student" && !$("math-view").hidden) return;
    math = data;
    renderMathCard();
    renderTodayCard();
    renderCalendars();
    if (homework.some(r => r.type === "daily-math")) { renderHomework(); renderCalendarFeed(); }
  }));
  sub("mocks", "dueDate", "desc", rows => { mocks = rows; renderMocks(); renderCalendars(); renderCalendarFeed(); renderTests(); });
  sub("schedule", "date", "asc", rows => { schedule = rows; renderHomework(); renderCalendarFeed(); renderCalendars(); });
  sub("plans", "date", "asc", rows => { plans = rows; renderCalendarFeed(); renderCalendars(); });
  sub("tuition", "createdAt", "desc", rows => { tuition = rows; renderTuition(); });
  unsubs.push(onSnapshot(collection(db, "students", currentSid, "examMeta"), s => {
    examMeta = Object.fromEntries(s.docs.map(d => [d.id, d.data()]));
    renderTests();
  }));
  loadProfile();
}

/* ---------- 宿題（単位ごとにチェック / 完了・未完了 / 毎日の英単語・数学） ---------- */
// 毎日の英単語・数学ⅠA を宿題として出す：開始日〜期限の毎日、その日の分をやり切ったら1日分（記録は vocab.days / math.days から自動）
const DAILY_HW = {
  "daily-vocab": { subject: "english", title: "毎日の英単語", name: "今日の英単語", unit: "語", quota: 20, days: () => vocab.days, open: () => openVocab() },
  "daily-math": { subject: "math", title: "毎日の数学ⅠA", name: "今日の数学ⅠA", unit: "問", quota: 5, days: () => math.days, open: () => openMath() },
};
function hwDays(r) {
  const from = r.startDate || r.dueDate, to = r.dueDate || from, out = [];
  if (!from) return out;
  for (let d = from; d <= to && out.length < 120; d = addDays(d, 1)) out.push(d);
  return out;
}
// 毎日の数（quota）：その日に終えた数（days[日付].total）が quota 以上で、直しまでやり切った日を1日分とする
const hwQuota = (r) => Number(r.quota) || 0;
const hwDayOk = (r, day) => !!day?.done && (day.total ?? 0) >= hwQuota(r);
const hwDailyDone = (r) => { const days = DAILY_HW[r.type].days() ?? {}; return hwDays(r).filter(d => hwDayOk(r, days[d])); };
// 今日が期間に入っている「毎日の○○」の宿題のうち、いちばん多い毎日の数（なければ null）。今日の問題数に使う
function hwQuotaToday(type) {
  const t = today(), qs = homework.filter(r => r.type === type && hwDays(r).includes(t)).map(hwQuota).filter(n => n > 0);
  return qs.length ? Math.max(...qs) : null;
}
function hwCounts(r) {
  const from = Number(r.countFrom) || 1, to = Number(r.countTo) || from;
  return Array.from({ length: Math.max(1, to - from + 1) }, (_, i) => from + i);
}
function hwProgress(r) {
  if (DAILY_HW[r.type]) { const n = hwDays(r).length; return n ? Math.round(hwDailyDone(r).length / n * 100) : 0; }
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
  if (DAILY_HW[r.type]) {
    return `<span class="badge${pct >= 100 ? " done" : ""}">${hwDailyDone(r).length}/${hwDays(r).length}日</span>${pct >= 100 ? "" : soonTag}`;
  }
  if (r.type === "count") {
    const cleared = (r.clearedCounts ?? []).length, total = hwCounts(r).length;
    return `<span class="badge${pct >= 100 ? " done" : ""}">${cleared}/${total}${esc(r.unit ?? "")}</span>${pct >= 100 ? "" : soonTag}`;
  }
  return `<span class="badge${pct >= 100 ? " done" : ""}">${pct >= 100 ? "達成 100%" : "未提出"}</span>${pct >= 100 ? "" : soonTag}`;
}
// 達成度に含める宿題：先週以前の分は除外し、次回の指導日（あれば）までの締切分だけを対象にする
function startOfWeekISO() {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay());
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function homeworkForAchievement() {
  const weekStart = startOfWeekISO();
  const nextCoaching = schedule.find(s => s.date >= today())?.date ?? null;
  return homework.filter(r => {
    if (!r.dueDate || r.dueDate < weekStart) return false;
    if (nextCoaching && r.dueDate > nextCoaching) return false;
    return true;
  });
}
function renderHomework() {
  renderHwTab();
  const rows = homeworkForAchievement();
  const avgPct = rows.length ? Math.round(rows.reduce((s, r) => s + hwProgress(r), 0) / rows.length) : 0;
  const doneCount = rows.filter(r => hwProgress(r) >= 100).length;
  drawRing("hw-ring", avgPct);
  $("hw-ring-label").textContent = avgPct + "%";
  $("hw-ring-sub").textContent = rows.length ? `${rows.length}件中 ${doneCount}件 できた` : "まだ宿題がありません。";

}
/* ---------- 宿題タブ：締め切り前／締め切り済み（または科目別）。やっていないものを上に、終わったものはたたむ ---------- */
let hwView = "due", hwSubject = "all";
try { hwView = localStorage.getItem("hwView") === "subject" ? "subject" : "due"; } catch {}
const hwDone = (r) => hwProgress(r) >= 100;
const hwLate = (r) => !!r.dueDate && r.dueDate < today();
const byDueAsc = (a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? "");
const byDueDesc = (a, b) => (b.dueDate ?? "").localeCompare(a.dueDate ?? "");
// 1つのかたまり：見出し → やっていない宿題 → 終わった宿題（たたむ）
function hwGroupHTML(title, rows, { tone = "", note = "", sortTodo = byDueAsc, sortDone = byDueDesc } = {}) {
  const todo = rows.filter(r => !hwDone(r)).sort(sortTodo), done = rows.filter(hwDone).sort(sortDone);
  return `<section class="hw-group ${tone}">
      <div class="hw-group-head"><p class="hw-gtitle">${title}</p>
        <span class="hw-count">${todo.length ? `<b>まだ ${todo.length}件</b>` : rows.length ? "全部できた" : ""}${done.length ? ` ・ できた ${done.length}件` : ""}</span></div>
      ${note ? `<p class="hint left">${note}</p>` : ""}
      ${todo.length ? `<div class="list">${todo.map(homeworkItemHTML).join("")}</div>` : `<div class="hw-empty">${rows.length ? "ここの宿題は全部終わっています" : "宿題はありません"}</div>`}
      ${done.length ? `<details class="hw-done"><summary>できた宿題 ${done.length}件を見る</summary><div class="list">${done.map(homeworkItemHTML).join("")}</div></details>` : ""}
    </section>`;
}
function renderHwTab() {
  const box = $("hw-list");
  if (!box) return;
  // タブのバッジ：やっていない宿題のうち、期限切れか2日以内のもの
  const soon = addDays(today(), 2);
  const urgent = homework.filter(r => !hwDone(r) && r.dueDate && r.dueDate <= soon).length;
  $("hw-badge").hidden = !urgent || role === "tutor"; $("hw-badge").textContent = urgent;
  const upcoming = homework.filter(r => !hwLate(r)), past = homework.filter(hwLate);
  const todoN = homework.filter(r => !hwDone(r)).length, lateN = past.filter(r => !hwDone(r)).length;
  $("hw-summary").innerHTML = `
    <div class="${todoN ? "warn" : "ok"}"><b>${todoN}</b><span>まだの宿題</span></div>
    <div class="${lateN ? "ng" : ""}"><b>${lateN}</b><span>期限切れでまだ</span></div>
    <div class="ok"><b>${homework.filter(hwDone).length}</b><span>できた宿題</span></div>`;
  document.querySelectorAll("[data-hw-view]").forEach(b => b.classList.toggle("active", b.dataset.hwView === hwView));
  const filter = $("hw-subject-filter");
  if (!homework.length) { filter.hidden = true; box.innerHTML = `<div class="empty">まだ宿題はありません。</div>`; return; }
  if (hwView === "due") {
    filter.hidden = true;
    box.innerHTML = hwGroupHTML("締め切り前", upcoming, { tone: "upcoming", note: "期限の近い順" })
      + hwGroupHTML("締め切り済み", past, { tone: "past", note: "まだの宿題は新しい順。早めに終わらせよう", sortTodo: byDueDesc });
    return;
  }
  // 科目別（教科ごとにまとめる）：やっていない宿題が多い教科を上に、教科なしは最後
  const grpOf = (r) => SUBJECTS.find(x => x.id === r.subject)?.group ?? "";
  const grpLabel = (g) => g ? (SUBJECT_GROUPS.find(x => x.id === g)?.label ?? g) : "教科なし";
  const grps = [...new Set(homework.map(grpOf))];
  const todoOf = (g) => homework.filter(r => grpOf(r) === g && !hwDone(r)).length;
  grps.sort((a, b) => (!a) - (!b) || todoOf(b) - todoOf(a) || SUBJECT_GROUPS.findIndex(x => x.id === a) - SUBJECT_GROUPS.findIndex(x => x.id === b));
  if (hwSubject !== "all" && !grps.includes(hwSubject)) hwSubject = "all";
  filter.hidden = false;
  filter.innerHTML = [["all", "すべて", homework.filter(r => !hwDone(r)).length], ...grps.map(g => [g, grpLabel(g), todoOf(g)])]
    .map(([g, label, n]) => `<button type="button" class="hw-chip${hwSubject === g ? " active" : ""}" data-hw-subject="${esc(g)}">${esc(label)}${n ? `<b>${n}</b>` : ""}</button>`).join("");
  box.innerHTML = grps.filter(g => hwSubject === "all" || g === hwSubject).map(g => {
    const rows = homework.filter(r => grpOf(r) === g);
    // 期限切れでまだの宿題を先頭に、そのあと期限の近い順
    const sortTodo = (a, b) => (hwLate(b) - hwLate(a)) || byDueAsc(a, b);
    return hwGroupHTML(g ? (SUBJECTS.some(x => x.id === g) ? subjectChip(g) : esc(grpLabel(g))) : "教科なし", rows, { tone: "subject", sortTodo });
  }).join("");
}
document.querySelector(".hw-view").addEventListener("click", (e) => {
  const b = e.target.closest("[data-hw-view]"); if (!b) return;
  hwView = b.dataset.hwView;
  try { localStorage.setItem("hwView", hwView); } catch {}
  renderHwTab();
});
$("hw-subject-filter").addEventListener("click", (e) => {
  const b = e.target.closest("[data-hw-subject]"); if (!b) return;
  hwSubject = b.dataset.hwSubject; renderHwTab();
});
function miniRingSVG(pct) {
  const r = 26, c = 2 * Math.PI * r;
  return `<svg viewBox="0 0 64 64" class="mini-ring">
    <circle cx="32" cy="32" r="${r}" fill="none" stroke="var(--blue-line)" stroke-width="7"/>
    <circle cx="32" cy="32" r="${r}" fill="none" stroke="var(--blue)" stroke-width="7"
      stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct / 100)}"
      transform="rotate(-90 32 32)"/>
    <text x="32" y="36" text-anchor="middle" font-size="15" font-weight="700" fill="var(--navy)">${pct}%</text>
  </svg>`;
}
function renderHwOverview() {
  const pending = homeworkForAchievement().filter(r => hwProgress(r) < 100).sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
  $("hw-overview-body").innerHTML = pending.length ? pending.map(r => `
    <article class="item hw-overview-row">
      ${miniRingSVG(hwProgress(r))}
      <div class="hw-overview-info">
        <div class="meta"><span class="date">期限 ${fmtDate(r.dueDate)}</span>${subjectChip(r.subject)}</div>
        <h4>${esc(r.title)}</h4>
      </div>
    </article>`).join("") : `<div class="empty">たまっている宿題はありません。</div>`;
}
$("hw-ring-card").addEventListener("click", () => {
  renderHwOverview();
  $("hw-overview-modal").hidden = false;
});
$("hw-ring-card").addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("hw-ring-card").click(); }
});
$("hw-overview-close").addEventListener("click", () => { $("hw-overview-modal").hidden = true; });
$("hw-overview-modal").addEventListener("click", (e) => { if (e.target.id === "hw-overview-modal") $("hw-overview-modal").hidden = true; });
function hwPdfList(r) {
  const list = Array.isArray(r.pdfs) ? r.pdfs.slice() : [];
  if (r.pdf) list.unshift({ name: "添付PDF", url: r.pdf });
  return list;
}
function hwPhotoList(r) {
  const list = Array.isArray(r.photos) ? r.photos.slice() : [];
  if (r.photo) list.unshift(r.photo);
  return list;
}
const ICON_CLIP = `<svg viewBox="0 0 24 24" class="ic-inline" aria-hidden="true"><path d="M8 12.5l6.2-6.2a3 3 0 0 1 4.3 4.2l-7.8 7.8a5 5 0 0 1-7.1-7.1l7-7"/></svg>`;
function homeworkItemHTML(r) {
  return `
    <article class="item">
      <div class="meta meta-lg"><span class="date">期限 ${fmtDate(r.dueDate)}</span>${hwBadge(r)}</div>
      <h4>${subjectChip(r.subject)} ${esc(r.title)}</h4>
      ${r.detail ? `<p>${esc(r.detail)}</p>` : ""}
      ${r.question ? `<p class="label">生徒からの質問</p><p>${esc(r.question)}</p>` : ""}
      ${DAILY_HW[r.type] ? hwDailyHTML(r) : r.type === "count" ? `
        <div class="page-grid">${hwCounts(r).map(p => {
          const on = (r.clearedCounts ?? []).includes(p);
          return role === "parent" || role === "tutor"
            ? `<span class="page-chip${on ? " on" : ""} readonly">${p}</span>`
            : `<button type="button" class="page-chip${on ? " on" : ""}" data-count-toggle="${esc(r.id)}" data-count="${p}">${p}</button>`;
        }).join("")}</div>
      ` : role === "parent" || role === "tutor" ? "" : `
        <div class="actions">
          <button class="${r.done ? "small outline" : "primary"}" data-toggle="${esc(r.id)}" data-done="${r.done ? 1 : 0}">
            ${r.done ? "未完了に戻す" : "完了にする"}</button>
        </div>
      `}
      ${role === "parent" && !hwPdfList(r).length && !hwPhotoList(r).length ? "" : `<details class="more">
        <summary>くわしく${hwPdfList(r).length ? `（添付 ${hwPdfList(r).length}）` : ""}${hwPhotoList(r).length ? `（写真 ${hwPhotoList(r).length}）` : ""}</summary>
        ${hwPdfList(r).length ? `<div class="pdf-list">${hwPdfList(r).map((p, i) =>
          `<p><a href="${p.url}" class="zoom-link pdf-open-link">${ICON_CLIP}${esc(p.name || `添付PDF${i + 1}`)}</a></p>`
        ).join("")}</div>` : ""}
        ${hwPhotoList(r).length ? `<div class="hw-photo-grid">${hwPhotoList(r).map(src => `<img class="hw-photo" src="${src}" alt="提出写真">`).join("")}</div>` : ""}
        <div class="actions">
          ${role !== "parent" ? `<button class="small outline" data-photo="${esc(r.id)}">写真を添付</button>` : ""}
          ${role === "student" ? `<button class="small outline" data-ask="${esc(r.id)}">先生に質問する</button>` : ""}
          ${role === "tutor" ? `<button class="small outline" data-hw-edit="${esc(r.id)}">編集</button>
          <button class="small outline danger" data-del="${esc(r.id)}">削除</button>` : ""}
        </div>
      </details>`}
      <input type="file" accept="image/*" multiple class="hidden-file" data-photo-input="${esc(r.id)}">
    </article>`;
}
function hwDailyHTML(r) {
  const dh = DAILY_HW[r.type], days = dh.days() ?? {}, t = today(), wk = ["日", "月", "火", "水", "木", "金", "土"], q = hwQuota(r);
  const todayIn = hwDays(r).includes(t), todayOk = hwDayOk(r, days[t]);
  return `<p class="hw-quota">毎日 <b>${q || dh.quota}${dh.unit}</b>（${hwDays(r).length}日間）・できた日 <b>${hwDailyDone(r).length}</b> / ${hwDays(r).length}日</p>
    <div class="hw-days">${hwDays(r).map(d => {
      const [y, m, dd] = d.split("-").map(Number), day = days[d], ok = hwDayOk(r, day), short = !ok && day?.done;
      const cls = ok ? "done" : short ? "short" : d < t ? "miss" : d === t ? "today" : "";
      const mark = ok ? ICON_CHECK : short ? `<b>${day.total ?? 0}/${q}</b>` : d < t ? ICON_CROSS : "";
      return `<span class="hw-day ${cls}" title="${d}${ok ? " できた" : short ? ` ${day.total ?? 0}${dh.unit}（${q}${dh.unit}に足りない）` : ""}"><small>${m}/${dd}(${wk[new Date(y, m - 1, dd).getDay()]})</small>${mark}</span>`;
    }).join("")}</div>
    ${role === "student" && todayIn ? `<div class="actions"><button type="button" class="${todayOk ? "small outline" : "primary"}" data-hw-daily="${esc(r.type)}">${todayOk ? `${dh.name}を見直す` : `${dh.name}をはじめる（${q || dh.quota}${dh.unit}）`}</button></div>` : ""}`;
}
let editingHwId = null;
function startEditHomework(r) {
  editingHwId = r.id;
  $("h-title").value = r.title ?? "";
  $("h-subject").value = r.subject ?? "";
  $("h-type").value = r.type ?? "tf";
  $("h-type").dispatchEvent(new Event("change"));
  if (r.type === "count") {
    $("h-unit-select").value = ["問", "ページ", "回"].includes(r.unit) ? r.unit : "custom";
    $("h-unit-select").dispatchEvent(new Event("change"));
    if ($("h-unit-select").value === "custom") $("h-unit-custom").value = r.unit ?? "";
    $("h-count-from").value = r.countFrom ?? 1;
    $("h-count-to").value = r.countTo ?? 10;
  }
  $("h-start").value = r.startDate ?? "";
  if (DAILY_HW[r.type]) { $("h-quota").value = r.quota ?? DAILY_HW[r.type].quota; $("h-quota-unit").textContent = DAILY_HW[r.type].unit; }
  $("h-detail").value = r.detail ?? "";
  $("h-due").value = r.dueDate ?? "";
  const existingPdfs = hwPdfList(r);
  if (existingPdfs.length) {
    $("h-pdf-current").hidden = false;
    $("h-pdf-current-list").innerHTML = existingPdfs.map((p, i) =>
      `<a href="${p.url}" target="_blank" rel="noopener">${esc(p.name || `PDF${i + 1}`)}</a>`).join("　");
  } else {
    $("h-pdf-current").hidden = true;
  }
  $("h-save-btn").textContent = "更新";
  $("hw-modal").hidden = false;
}
function fileToDataUrlRaw(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
$("hw-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const pdfFiles = [...$("h-pdf").files];
  const totalSize = pdfFiles.reduce((s, f) => s + f.size, 0);
  if (totalSize > 750 * 1024) {
    alert("PDFは合計750KBまでです。ファイルサイズを小さくするか、枚数を減らしてください。");
    return;
  }
  const type = $("h-type").value;
  const base = {
    title: $("h-title").value.trim(), subject: $("h-subject").value, type,
    detail: $("h-detail").value.trim(), dueDate: $("h-due").value
  };
  if (DAILY_HW[type]) {
    base.startDate = $("h-start").value || today();
    if (base.startDate > base.dueDate) { alert("開始日は提出期限より前にしてください。"); return; }
    base.quota = Math.max(1, Math.min(100, Math.round(Number($("h-quota").value) || DAILY_HW[type].quota)));
    // タイトルが初期値のままなら「毎日の英単語（毎日20語）」のように数を入れる
    if (base.title === DAILY_HW[type].title || base.title.startsWith(DAILY_HW[type].title + "（")) base.title = `${DAILY_HW[type].title}（毎日${base.quota}${DAILY_HW[type].unit}）`;
  }
  if (type === "count") {
    const unit = $("h-unit-select").value === "custom" ? $("h-unit-custom").value.trim() : $("h-unit-select").value;
    base.unit = unit || "回";
    base.countFrom = Number($("h-count-from").value) || 1;
    base.countTo = Number($("h-count-to").value) || base.countFrom;
  }
  const newPdfs = pdfFiles.length
    ? (await Promise.all(pdfFiles.map(async f => ({ name: f.name, url: await fileToDataUrlRaw(f).catch(() => null) }))))
      .filter(p => p.url)
    : [];
  try {
    if (editingHwId) {
      if (newPdfs.length) base.pdfs = arrayUnion(...newPdfs);
      await updateDoc(doc(db, "students", currentSid, "homework", editingHwId), base);
      editingHwId = null;
      $("h-save-btn").textContent = "追加";
    } else {
      base.question = ""; base.createdAt = serverTimestamp(); base.pdfs = newPdfs;
      if (type === "count") base.clearedCounts = []; else base.done = false;
      await addDoc(collection(db, "students", currentSid, "homework"), base);
    }
  } catch (err) {
    if (String(err?.message ?? err).includes("longer than")) {
      alert("データが大きすぎて保存できませんでした。PDFのファイルサイズを小さくするか、枚数を減らしてください。");
    } else {
      alert("保存に失敗しました（" + (err?.message ?? err) + "）");
    }
    return;
  }
  e.target.reset();
  $("h-pdf-current").hidden = true;
  $("h-count-range").hidden = true;
  $("h-count-numbers").hidden = true;
  $("h-unit-custom-wrap").hidden = true;
  $("hw-modal").hidden = true;
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
  const hasDetail = r.content || r.notes;
  return `
    <article class="item">
      <div class="meta"><span class="date">指導記録</span>${subjectChip(r.subject)}</div>
      ${r.range ? `<h4>${esc(r.range)}</h4>` : ""}
      ${hasDetail ? `
        <div class="detail-wrap" data-detail-wrap>
          <div class="detail-inner">
            ${r.content ? `<p class="label">授業内容</p><p>${esc(r.content)}</p>` : ""}
            ${r.notes ? `<p class="label">所感</p><p>${esc(r.notes)}</p>` : ""}
          </div>
        </div>` : ""}
      <div class="actions">
        ${hasDetail ? `<button type="button" class="small filled" data-detail-toggle>詳細</button>` : ""}
        ${role === "tutor" ? `<button class="small outline" data-lesson-edit="${esc(r.id)}">編集</button>` : ""}
      </div>
    </article>`;
}
let editingLessonId = null;
function startEditLesson(r) {
  editingLessonId = r.id;
  $("l-date").value = r.date ?? ""; $("l-subject").value = r.subject ?? "";
  $("l-range").value = r.range ?? ""; $("l-content").value = r.content ?? ""; $("l-notes").value = r.notes ?? "";
  $("l-save-btn").textContent = "更新";
  $("lesson-modal").hidden = false;
}
$("lesson-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const base = {
    date: $("l-date").value, subject: $("l-subject").value,
    range: $("l-range").value.trim(), content: $("l-content").value.trim(),
    notes: $("l-notes").value.trim()
  };
  if (editingLessonId) {
    await updateDoc(doc(db, "students", currentSid, "lessons", editingLessonId), base);
    editingLessonId = null;
    $("l-save-btn").textContent = "保存";
  } else {
    base.createdAt = serverTimestamp();
    await addDoc(collection(db, "students", currentSid, "lessons"), base);
  }
  e.target.reset(); $("l-date").value = today();
  $("lesson-modal").hidden = true;
});

/* ---------- 指導予定（Zoom URL付き） ---------- */
function scheduleItemHTML(s) {
  return `
    <article class="item">
      <div class="meta"><span class="date">指導予定${s.time ? " " + s.time : ""}</span>
        ${role === "tutor" ? `<button class="small outline" data-sc-edit="${esc(s.id)}">編集</button>
        <button class="small outline danger" data-sc-del="${esc(s.id)}">削除</button>` : ""}</div>
      ${s.memo ? `<p>${esc(s.memo)}</p>` : ""}
      ${s.zoomUrl ? `<p><a href="${esc(s.zoomUrl)}" target="_blank" rel="noopener" class="zoom-btn">ZOOMで参加</a></p>` : ""}
    </article>`;
}
const ZOOM_KEY = "tnote.lastZoomUrl";
if ($("sc-zoom").value === "") { const savedZoom = store.get(ZOOM_KEY); if (savedZoom) $("sc-zoom").value = savedZoom; }
let editingScheduleId = null;
function startEditSchedule(s) {
  editingScheduleId = s.id;
  $("sc-date").value = s.date ?? ""; $("sc-time").value = s.time ?? "";
  $("sc-zoom").value = s.zoomUrl ?? ""; $("sc-memo").value = s.memo ?? "";
  $("sc-save-btn").textContent = "更新";
  $("schedule-modal").hidden = false;
}
$("schedule-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const zoomUrl = $("sc-zoom").value.trim();
  const base = { date: $("sc-date").value, time: $("sc-time").value, zoomUrl, memo: $("sc-memo").value.trim() };
  if (editingScheduleId) {
    await updateDoc(doc(db, "students", currentSid, "schedule", editingScheduleId), { ...base, reminded: false });
    editingScheduleId = null;
    $("sc-save-btn").textContent = "登録";
  } else {
    await addDoc(collection(db, "students", currentSid, "schedule"), { ...base, reminded: false, createdAt: serverTimestamp() });
  }
  if (zoomUrl) store.set(ZOOM_KEY, zoomUrl);
  e.target.reset();
  $("sc-zoom").value = zoomUrl; // 次回も同じZoom URLを使えるよう、リセット後も残す
  $("schedule-modal").hidden = true;
});

/* ---------- 予定（生徒・保護者・チューター誰でも追加可） ---------- */
// カレンダー下の一覧に出す模試（期限の日に表示）
function mockFeedItemHTML(r) {
  const def = mockDef(r.mockId);
  if (!def) return "";
  const st = r.status ?? "assigned";
  const late = st === "assigned" && r.dueDate && r.dueDate < today();
  const s = st === "graded" ? mockStats(def, r.scores) : null;
  const web = isWeb(r);
  const label = role === "student"
    ? ({ assigned: "模試を開いて解く", started: web ? "解答画面を開く" : "模試を開く", graded: "結果を見る" }[st] ?? "模試を開く")
    : (st === "graded" ? "結果を見る" : "模試を開く");
  return `
    <article class="item feed-mock st-${st}">
      <p class="plan-line"><span class="date mock">模試の期限</span><span class="plan-line-text">${esc(def.title)}</span></p>
      <p class="feed-mock-meta">
        <span class="status-chip ${st}${late ? " late" : ""}">${late ? "期限切れ" : MOCK_STATUS[st]}</span>
        <span>${esc(def.scope)}・${def.minutes}分${web ? "・ウェブでマーク" : "・紙に記述"}</span>
        ${s ? `<b class="feed-mock-score">${s.got}/${s.max}点（${pct(s.got, s.max)}%）</b>` : ""}
      </p>
      ${r.memo ? `<p>${esc(r.memo)}</p>` : ""}
      <div class="actions"><button class="small filled" data-feed-mock="${esc(r.id)}">${label}</button></div>
    </article>`;
}
function planItemHTML(p) {
  return `
    <article class="item">
      <p class="plan-line"><span class="date">予定${p.time ? " " + p.time : ""}</span><span class="plan-line-text">${esc(p.title)}</span></p>
      ${p.memo ? `<p>${esc(p.memo)}</p>` : ""}
      ${p.authorRole === role ? `<div class="actions">
        <button class="small outline" data-plan-edit="${esc(p.id)}">編集</button>
        <button class="small outline danger" data-plan-del="${esc(p.id)}">削除</button>
      </div>` : ""}
    </article>`;
}
let editingPlanId = null;
function startEditPlan(p) {
  editingPlanId = p.id;
  $("pl-title").value = p.title ?? ""; $("pl-date").value = p.date ?? "";
  $("pl-time").value = p.time ?? ""; $("pl-memo").value = p.memo ?? "";
  $("pl-save-btn").textContent = "更新";
  $("plan-modal").hidden = false;
}
$("plan-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const base = { title: $("pl-title").value.trim(), date: $("pl-date").value, time: $("pl-time").value, memo: $("pl-memo").value.trim() };
  if (editingPlanId) {
    await updateDoc(doc(db, "students", currentSid, "plans", editingPlanId), base);
    editingPlanId = null;
    $("pl-save-btn").textContent = "追加";
  } else {
    await addDoc(collection(db, "students", currentSid, "plans"), { ...base, authorRole: role, createdAt: serverTimestamp() });
  }
  e.target.reset();
  $("plan-modal").hidden = true;
});

/* ---------- ホームの「今日やること」：今日の指導・期限が近い宿題・今日の英単語・模試 ---------- */
function renderTodayCard() {
  const box = $("today-card");
  if (!box) return;
  if (!currentSid) { box.hidden = true; return; }
  const t = today(), tmr = addDays(t, 1);
  const rows = [];
  schedule.filter(s => s.date === t).forEach(s => rows.push(`<li class="td-row lesson">
      <span class="td-dot"></span><div class="td-main"><b>今日の指導 ${esc(s.time || "")}</b>${s.memo ? `<small>${esc(s.memo)}</small>` : ""}</div>
      ${s.zoomUrl ? `<a class="zoom-btn" href="${esc(s.zoomUrl)}" target="_blank" rel="noopener">ZOOM</a>` : ""}</li>`));
  const lateHw = homework.filter(h => h.dueDate && h.dueDate < t && h.dueDate >= startOfWeekISO() && hwProgress(h) < 100);
  if (lateHw.length) rows.push(`<li class="td-row due late"><span class="td-dot"></span>
      <div class="td-main"><b>期限切れの宿題 ${lateHw.length}件</b><small>${lateHw.map(h => esc(h.title)).slice(0, 2).join("、")}${lateHw.length > 2 ? " ほか" : ""}</small></div>
      <button type="button" class="small outline" data-td-late>見る</button></li>`);
  homework.filter(h => h.dueDate && h.dueDate >= t && h.dueDate <= tmr && hwProgress(h) < 100)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate)).forEach(h => {
      const late = h.dueDate < t;
      rows.push(`<li class="td-row due${late ? " late" : ""}"><span class="td-dot"></span>
        <div class="td-main"><b>${esc(h.title)}</b><small>${late ? "期限切れ" : h.dueDate === t ? "今日まで" : "明日まで"}・宿題${h.type === "count" ? `（${(h.clearedCounts ?? []).length}/${hwCounts(h).length}）` : ""}</small></div>
        <button type="button" class="small outline" data-td-hw="${esc(h.id)}">見る</button></li>`);
    });
  mocks.filter(m => m.status === "started" || (m.status === "assigned" && m.dueDate && m.dueDate <= addDays(t, 2))).forEach(m => {
    const late = m.status === "assigned" && m.dueDate < t;
    rows.push(`<li class="td-row mock${late ? " late" : ""}"><span class="td-dot"></span>
      <div class="td-main"><b>${esc(mockDef(m.mockId)?.title ?? "模試")}</b><small>${m.status === "started" ? "受験中" : late ? "期限切れ" : `期限 ${fmtMD(m.dueDate)}`}・模試</small></div>
      <button type="button" class="small outline" data-feed-mock="${esc(m.id)}">開く</button></li>`);
  });
  const vdone = vocab.days?.[localToday()]?.done;
  if (role === "student") rows.push(`<li class="td-row vocab${vdone ? " done" : ""}"><span class="td-dot"></span>
      <div class="td-main"><b>今日の英単語</b><small>${vdone ? "完了しました" : `${vocabN()}問`}</small></div>
      ${vdone ? "" : `<button type="button" class="small primary" data-vocab-open>はじめる</button>`}</li>`);
  const mdone = math.days?.[localToday()]?.done;
  if (role === "student") rows.push(`<li class="td-row math${mdone ? " done" : ""}"><span class="td-dot"></span>
      <div class="td-main"><b>今日の数学ⅠA</b><small>${mdone ? "完了しました" : `${MATH_N}問`}</small></div>
      ${mdone ? "" : `<button type="button" class="small primary" data-math-open>はじめる</button>`}</li>`);
  box.hidden = false;
  box.innerHTML = `<p class="td-title">今日やること<span>${fmtDateLong(t)}</span></p>
    ${rows.length ? `<ul class="td-list">${rows.join("")}</ul>` : `<p class="td-empty">今日やることはありません。</p>`}`;
}
$("today-card")?.addEventListener("click", (e) => {
  if (e.target.closest("[data-vocab-open]")) return openVocab();
  if (e.target.closest("[data-math-open]")) return openMath();
  const fm = e.target.closest("[data-feed-mock]");
  if (fm) return handleHomeworkFeedClick(e);
  if (e.target.closest("[data-td-late]")) { $("hw-ring-card").click(); return; }
  const hw = e.target.closest("[data-td-hw]");
  if (hw) {
    const h = homework.find(x => x.id === hw.dataset.tdHw);
    if (h) openDayModal(h.dueDate);
  }
});

/* ---------- カレンダー下：日付別フィード（宿題・指導予定・指導記録・予定を統合、新しい日付が上） ---------- */
function renderCalendarFeed() {
  const monthPrefix = `${calState.main.getFullYear()}-${String(calState.main.getMonth() + 1).padStart(2, "0")}`;
  const dateMap = {};
  const ensure = (date) => (dateMap[date] ??= { hw: [], lesson: [], sched: [], plan: [], mock: [] });
  homework.forEach(h => { if (h.dueDate?.startsWith(monthPrefix)) ensure(h.dueDate).hw.push(h); });
  lessons.forEach(l => { if (l.date?.startsWith(monthPrefix)) ensure(l.date).lesson.push(l); });
  schedule.forEach(s => { if (s.date?.startsWith(monthPrefix)) ensure(s.date).sched.push(s); });
  plans.forEach(p => { if (p.date?.startsWith(monthPrefix)) ensure(p.date).plan.push(p); });
  mocks.forEach(m => { if (m.dueDate?.startsWith(monthPrefix)) ensure(m.dueDate).mock.push(m); });
  // 今月を見ているときは、月をまたいだすぐ先（7日分）の予定も出す
  if (today().startsWith(monthPrefix)) {
    const lim = addDays(today(), 7), inNext = (d) => d && !d.startsWith(monthPrefix) && d > today() && d <= lim;
    homework.forEach(h => { if (inNext(h.dueDate)) ensure(h.dueDate).hw.push(h); });
    schedule.forEach(x => { if (inNext(x.date)) ensure(x.date).sched.push(x); });
    plans.forEach(x => { if (inNext(x.date)) ensure(x.date).plan.push(x); });
    mocks.forEach(m => { if (inNext(m.dueDate)) ensure(m.dueDate).mock.push(m); });
  }
  const t = today();
  const upcoming = Object.keys(dateMap).filter(d => d >= t).sort();
  const past = Object.keys(dateMap).filter(d => d < t).sort((a, b) => b.localeCompare(a));
  const group = (date) => {
    const { hw, lesson, sched, plan, mock } = dateMap[date];
    return `<div class="feed-date-group">
      <h4 class="feed-date-heading">${date === t ? "今日・" : ""}${fmtDateLong(date)}</h4>
      ${mock.map(mockFeedItemHTML).join("")}
      ${sched.map(scheduleItemHTML).join("")}
      ${lesson.map(lessonItemHTML).join("")}
      ${hw.map(homeworkItemHTML).join("")}
      ${plan.map(planItemHTML).join("")}
    </div>`;
  };
  $("calendar-feed").innerHTML = (upcoming.length || past.length)
    ? `${upcoming.length ? `<p class="feed-section">これからの予定</p>${upcoming.map(group).join("")}` : ""}
       ${past.length ? `<details class="feed-past"><summary>これまでの記録（${past.length}日分）</summary>${past.map(group).join("")}</details>` : ""}`
    : `<div class="empty">この月の予定・記録はまだありません。</div>`;
  renderTodayCard();
}
// data: URLへの直接ナビゲーションはブラウザ（特にChrome）にブロックされることがあるため、
// 一度Blobに変換してからblob: URLで開く
async function openDataUrlAsBlob(dataUrl) {
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const win = window.open(url, "_blank");
    if (!win) alert("ポップアップがブロックされました。ブラウザの設定でこのサイトのポップアップを許可してください。");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch {
    alert("PDFを開けませんでした。");
  }
}
async function handleHomeworkFeedClick(e) {
  const fm = e.target.closest("[data-feed-mock]");
  if (fm) {
    const r = mocks.find(m => m.id === fm.dataset.feedMock);
    $("day-modal").hidden = true;
    if (r && role === "student" && r.status === "started" && isWeb(r)) { openExam(r.id); return; }
    mockOpen.add(fm.dataset.feedMock);
    document.querySelector('.tabs [data-tab="mock"]').click();
    renderMocks();
    requestAnimationFrame(() => {
      const card = document.getElementById("mock-card-" + fm.dataset.feedMock);
      card?.scrollIntoView({ block: "center", behavior: "smooth" });
      card?.classList.add("flash");
      setTimeout(() => card?.classList.remove("flash"), 1600);
    });
    return;
  }
  const pdfLink = e.target.closest(".pdf-open-link");
  if (pdfLink) { e.preventDefault(); openDataUrlAsBlob(pdfLink.getAttribute("href")); return; }
  const detailBtn = e.target.closest("[data-detail-toggle]");
  if (detailBtn) {
    const wrap = detailBtn.closest("article").querySelector("[data-detail-wrap]");
    const open = wrap.classList.toggle("open");
    detailBtn.textContent = open ? "閉じる" : "詳細";
    return;
  }
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
  const pld = e.target.closest("[data-plan-del]");
  if (pld && confirm("この予定を削除しますか？")) {
    await deleteDoc(doc(db, "students", currentSid, "plans", pld.dataset.planDel));
  }
  const ple = e.target.closest("[data-plan-edit]");
  if (ple) { const p = plans.find(x => x.id === ple.dataset.planEdit); if (p) startEditPlan(p); }
  const hwd = e.target.closest("[data-hw-daily]");
  if (hwd) { DAILY_HW[hwd.dataset.hwDaily]?.open(); return; }
  const hwe = e.target.closest("[data-hw-edit]");
  if (hwe) { const h = homework.find(x => x.id === hwe.dataset.hwEdit); if (h) startEditHomework(h); }
  const le = e.target.closest("[data-lesson-edit]");
  if (le) { const l = lessons.find(x => x.id === le.dataset.lessonEdit); if (l) startEditLesson(l); }
  const sce = e.target.closest("[data-sc-edit]");
  if (sce) { const s = schedule.find(x => x.id === sce.dataset.scEdit); if (s) startEditSchedule(s); }
}
async function handleHomeworkFeedChange(e) {
  const input = e.target.closest("[data-photo-input]");
  if (!input || !input.files.length) return;
  const urls = (await Promise.all([...input.files].map(f => fileToDataUrl(f).catch(() => "")))).filter(Boolean);
  if (urls.length) await updateDoc(doc(db, "students", currentSid, "homework", input.dataset.photoInput), { photos: arrayUnion(...urls) });
}
$("calendar-feed").addEventListener("click", handleHomeworkFeedClick);
$("hw-list").addEventListener("click", handleHomeworkFeedClick);
$("hw-list").addEventListener("change", handleHomeworkFeedChange);
$("calendar-feed").addEventListener("change", handleHomeworkFeedChange);
$("day-modal-body").addEventListener("click", handleHomeworkFeedClick);
$("day-modal-body").addEventListener("change", handleHomeworkFeedChange);

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
function renderTuitionSummary() {
  const byMonth = {};
  tuition.forEach(t => {
    const dates = t.dates ?? [];
    const share = Number(t.amount || 0) / (dates.length || 1);
    dates.forEach(d => {
      const ym = d.slice(0, 7);
      if (!ym) return;
      byMonth[ym] ??= { paid: 0, unpaid: 0 };
      byMonth[ym][t.paid ? "paid" : "unpaid"] += share;
    });
  });
  const months = Object.keys(byMonth).sort().slice(-6);
  $("tuition-summary-card").hidden = months.length === 0;
  const maxTotal = Math.max(1, ...months.map(m => byMonth[m].paid + byMonth[m].unpaid));
  $("tuition-summary").innerHTML = months.map(m => {
    const { paid, unpaid } = byMonth[m];
    const [y, mo] = m.split("-");
    const pW = Math.round(paid / maxTotal * 100);
    const uW = Math.round(unpaid / maxTotal * 100);
    return `<div class="month-bar-row">
      <span class="month-bar-label">${y}/${Number(mo)}月</span>
      <div class="month-bar-track">
        <div class="month-bar-fill paid" style="width:${pW}%"></div>
        <div class="month-bar-fill unpaid" style="width:${uW}%;left:${pW}%"></div>
      </div>
      <span class="month-bar-val">${Math.round(paid + unpaid).toLocaleString()}<small>円</small></span>
    </div>`;
  }).join("");
}
function renderTuition() {
  renderTuitionSummary();
  $("tuition-list").innerHTML = tuition.length ? tuition.map(t => `
    <article class="item">
      <div class="meta">
        <span class="date">${(t.dates ?? []).map(fmtMD).join(" ")}</span>
        <span class="badge ${t.paid ? "done" : ""}">${t.paid ? "振込確認済み" : "未確認"}</span>
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
    if (key === "main") renderCalendarFeed();
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
  const isoOf = (d) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const sameMark = (a, b) => a && b && a.kind === "plan" && b.kind === "plan" && a.text === b.text;
  html += cells.map((d, idx) => {
    if (!d) return `<div class="cal-cell empty"></div>`;
    const iso = isoOf(d);
    const marks = marksByDate[iso] ?? [];
    const shown = marks.slice(0, 2);
    const extra = marks.length - shown.length;
    const isToday = iso === today();
    const weekday = idx % 7;
    const prevMarks = weekday > 0 && d > 1 ? (marksByDate[isoOf(d - 1)] ?? []) : null;
    const nextMarks = weekday < 6 && d < daysInMonth ? (marksByDate[isoOf(d + 1)] ?? []) : null;
    // 今日の英単語を（直しまで）やり切った日は、マスを薄い黄色にする
    // 今日の数学ⅠAをやり切った日は、マスの下に線を引く（色だけに頼らず形でも分かるように）
    const vdone = vocab.days?.[iso]?.done, mdone = math.days?.[iso]?.done;
    const tip = [vdone ? "今日の英単語 完了" : "", mdone ? "今日の数学ⅠA 完了" : ""].filter(Boolean).join("・");
    return `<div class="cal-cell${isToday ? " today" : ""}${vdone ? " vocab-done" : ""}${mdone ? " math-done" : ""}" data-date="${iso}"${tip ? ` title="${tip}"` : ""}>
      <span class="cal-day">${d}</span>
      <span class="cal-pills">${shown.map((k, i) => {
        const joinLeft = sameMark(k, prevMarks?.[i]);
        const joinRight = sameMark(k, nextMarks?.[i]);
        const cls = ["pill", k.kind, joinLeft ? "join-left" : "", joinRight ? "join-right" : ""].filter(Boolean).join(" ");
        return `<span class="${cls}">${esc(k.text)}</span>`;
      }).join("")}${extra > 0 ? `<span class="pill more">+${extra}</span>` : ""}</span>
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
  plans.forEach(p => add(p.date, "plan", p.title || "予定"));
  if (role === "tutor") tuition.forEach(t => (t.dates ?? []).forEach(d => add(d, "tuition", "月謝")));
  mocks.forEach(m => { if (m.status !== "graded") add(m.dueDate, "mock", "模試"); });
  const marks = {};
  Object.entries(raw).forEach(([date, list]) => {
    const dueCount = list.filter(k => k.kind === "due").length;
    const tuitionCount = list.filter(k => k.kind === "tuition").length;
    const merged = list.filter(k => k.kind === "lesson" || k.kind === "plan" || k.kind === "mock");
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
        ${s.zoomUrl ? `<p><a href="${esc(s.zoomUrl)}" target="_blank" rel="noopener" class="zoom-btn">ZOOMで参加</a></p>` : ""}
      </div>`).join("")}
      ${dayLessons.map(l => `<div class="item">
        <div class="meta">${subjectChip(l.subject)}</div>
        ${l.range ? `<h4>${esc(l.range)}</h4>` : ""}
        ${l.notes ? `<p>${esc(l.notes)}</p>` : ""}
      </div>`).join("")}
    </div>`);
  }
  if (dayHomework.length) {
    sections.push(`<div class="modal-section"><h4 class="modal-sub">宿題期限</h4>
      ${dayHomework.map(h => `<details class="modal-hw-item">
        <summary>${subjectChip(h.subject)}<span class="modal-hw-title">${esc(h.title)}</span>${hwBadge(h)}</summary>
        ${homeworkItemHTML(h)}
      </details>`).join("")}
    </div>`);
  }
  if (role !== "student" && dayTuition.length) {
    sections.push(`<div class="modal-section"><h4 class="modal-sub">月謝</h4>
      ${dayTuition.map(t => `<div class="item">
        <p class="score">${Number(t.amount).toLocaleString()}<small>円</small></p>
        <span class="badge ${t.paid ? "done" : ""}">${t.paid ? "振込確認済み" : "未確認"}</span>
      </div>`).join("")}
    </div>`);
  }
  const dayMocks = mocks.filter(m => m.dueDate === iso);
  if (dayMocks.length) {
    sections.push(`<div class="modal-section"><h4 class="modal-sub">模試の期限</h4>${dayMocks.map(m => `<div class="item">
      <h4>${esc(mockDef(m.mockId)?.title ?? "模試")}</h4><span class="status-chip ${m.status}">${MOCK_STATUS[m.status] ?? ""}</span>
      <div class="actions"><button class="small filled" data-feed-mock="${esc(m.id)}">模試を開く</button></div></div>`).join("")}</div>`);
  }
  const dayPlans = plans.filter(p => p.date === iso);
  if (dayPlans.length) {
    sections.push(`<div class="modal-section"><h4 class="modal-sub">予定</h4>${dayPlans.map(planItemHTML).join("")}</div>`);
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

/* ---------- カレンダーの登録フォーム用モーダル（宿題を出す／指導予定／指導記録／予定を追加） ---------- */
document.querySelectorAll("[data-open-modal]").forEach(btn => {
  btn.addEventListener("click", () => { $(btn.dataset.openModal).hidden = false; });
});
document.querySelectorAll("[data-modal-close]").forEach(btn => {
  btn.addEventListener("click", () => { $(btn.dataset.modalClose).hidden = true; });
});
["hw-modal", "schedule-modal", "lesson-modal", "plan-modal", "mock-modal", "mock-grade-modal", "mock-result-modal", "mock-photo-modal"].forEach(id => {
  $(id).addEventListener("click", (e) => { if (e.target.id === id) $(id).hidden = true; });
});

/* ---------- 写真の縮小（連絡・宿題・模試の提出で使う） ---------- */
function fileToDataUrl(file, maxSize = 480, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const img = new Image(); const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
        cv.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(cv.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject; img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
/* ---------- 模試（実力テスト：出題 → 受験 → 提出 → 採点 → 弱点分析） ---------- */
const mockDef = (id) => MOCKS.find(m => m.id === id);
const MOCK_STATUS = { assigned: "未受験", started: "受験中", submitted: "採点待ち", grading: "採点中", graded: "採点済み" };
const mockRef = (id) => doc(db, "students", currentSid, "mocks", id);
let mockTimer = null;

$("mk-test").innerHTML = MOCKS.map(m => `<option value="${m.id}">${esc(m.title)}</option>`).join("");
function showMockInfo() {
  const m = mockDef($("mk-test").value);
  $("mk-test-info").textContent = m ? `${m.scope}／${m.minutes}分／${m.items.length}問・${m.total}点` : "";
  // ウェブ（マーク）用のデータがないテストは紙だけ
  const webOpt = $("mk-mode").querySelector('option[value="web"]');
  webOpt.disabled = !m?.web;
  webOpt.textContent = m?.web ? "ウェブでマークする（提出するとすぐ自動採点）" : "ウェブでマークする（このテストはまだ準備中）";
  if (!m?.web) $("mk-mode").value = "paper";
}
$("mk-test").addEventListener("change", showMockInfo);
showMockInfo();
$("mk-due").value = today();

// 出す／編集する（編集はチューターのみ）
let editingMockId = null;
function setMockFormMode(r) {
  editingMockId = r?.id ?? null;
  const st = r?.status ?? "assigned";
  $("mock-modal-title").textContent = r ? "模試を編集" : "模試を出す";
  $("mk-save-btn").textContent = r ? "更新" : "出す";
  $("mk-test").value = r?.mockId ?? MOCKS[0].id;
  $("mk-mode").value = r?.mode ?? (mockDef($("mk-test").value)?.web ? "web" : "paper");
  $("mk-due").value = r?.dueDate ?? today();
  $("mk-memo").value = r?.memo ?? "";
  $("mk-reset").checked = false;
  // 受験が始まったあとはテストを変えられない（変えるときは「受験前の状態に戻す」）
  $("mk-reset-wrap").hidden = !r || st === "assigned";
  $("mk-status-text").textContent = r && st !== "assigned" ? `いまの状態：${MOCK_STATUS[st]}。テストを変えるには「受験前の状態に戻す」にチェックを入れてください。` : "";
  $("mk-test").disabled = !!r && st !== "assigned";
  $("mk-mode").disabled = !!r && st !== "assigned";
  showMockInfo();
}
$("mock-add-btn")?.addEventListener("click", () => setMockFormMode(null));
$("mk-reset")?.addEventListener("change", () => {
  const r = mocks.find(m => m.id === editingMockId);
  $("mk-test").disabled = !$("mk-reset").checked && (r?.status ?? "assigned") !== "assigned";
  $("mk-mode").disabled = $("mk-test").disabled;
});
function startEditMock(r) {
  setMockFormMode(r);
  $("mock-modal").hidden = false;
}
async function deleteMockPhotos(id) {
  const ph = await getDocs(collection(db, "students", currentSid, "mocks", id, "photos"));
  await Promise.all(ph.docs.map(d => deleteDoc(d.ref)));
}
$("mock-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentSid) return alert("先に生徒を選んでください。");
  const base = { mockId: $("mk-test").value, mode: $("mk-mode").value, dueDate: $("mk-due").value, memo: $("mk-memo").value.trim() };
  try {
    if (editingMockId) {
      const r = mocks.find(m => m.id === editingMockId);
      const reset = $("mk-reset").checked;
      if (reset && !confirm("タイマー・提出写真・採点を消して、受験前の状態に戻します。よろしいですか？")) return;
      const data = { dueDate: base.dueDate, memo: base.memo };
      if (reset || (r?.status ?? "assigned") === "assigned") { data.mockId = base.mockId; data.mode = base.mode; }
      if (reset) {
        await deleteMockPhotos(editingMockId);
        Object.assign(data, { status: "assigned", scores: {}, answers: {}, photoCount: 0, startedAt: null, submittedAt: null, gradedAt: null });
        try { localStorage.removeItem("tnote.examAns." + editingMockId); } catch {}
        try { sessionStorage.removeItem("tnote.mockTimeUp." + editingMockId); } catch {}
      }
      await updateDoc(mockRef(editingMockId), data);
    } else {
      await addDoc(collection(db, "students", currentSid, "mocks"), {
        ...base, status: "assigned", scores: {}, photoCount: 0, createdAt: serverTimestamp()
      });
    }
  } catch (err) {
    return alert("保存できませんでした（" + (err?.message ?? err) + "）");
  }
  setMockFormMode(null);
  $("mock-modal").hidden = true;
});

// 得点の集計：採点済みの問題だけで率を出す
function mockStats(def, scores) {
  const group = (key) => {
    const out = {};
    def.items.forEach(it => {
      const g = (out[it[key]] ??= { got: 0, max: 0, all: 0, n: 0 });
      g.all += it.pts;
      const v = scores?.[it.id];
      if (v === undefined || v === null || v === "") return;
      g.got += Number(v); g.max += it.pts; g.n++;
    });
    return out;
  };
  const graded = def.items.filter(it => scores?.[it.id] !== undefined && scores?.[it.id] !== null && scores?.[it.id] !== "");
  const got = graded.reduce((s, it) => s + Number(scores[it.id]), 0);
  const max = graded.reduce((s, it) => s + it.pts, 0);
  // 弱点：分野＋内容ごとの得点率が低い順
  const tags = {};
  graded.forEach(it => {
    const k = `${it.field}｜${it.tag}`;
    const t = (tags[k] ??= { field: it.field, tag: it.tag, got: 0, max: 0, items: [] });
    t.got += Number(scores[it.id]); t.max += it.pts; t.items.push(it);
  });
  const weak = Object.values(tags).filter(t => Math.round(t.got / t.max * 100) < 60).sort((a, b) => a.got / a.max - b.got / b.max);
  return { got, max, gradedCount: graded.length, fields: group("field"), levels: group("level"), weak };
}
// 表示する%（四捨五入）と色をそろえる
// 内容名から分野名の重なりを取る（例：語彙 ＋ 語彙-動詞 → 語彙：動詞）
const tagLabel = (field, tag) => {
  const t = String(tag ?? ""); const f = String(field ?? "");
  return t.startsWith(f + "-") ? `${f}：${t.slice(f.length + 1)}` : t.startsWith(f) ? t : `${f}：${t}`;
};
const rateClass = (r) => { const p = Math.round(r * 100); return p < 60 ? "low" : p < 80 ? "mid" : "high"; };
const pct = (got, max) => max ? Math.round(got / max * 100) : 0;
function rateBars(groups, order) {
  const keys = order ? order.filter(k => groups[k]) : Object.keys(groups);
  return `<div class="rate-bars">${keys.map(k => {
    const g = groups[k];
    if (!g.max) return `<div class="rate-row"><span class="rate-label">${esc(k)}</span><div class="rate-track"></div><span class="rate-val muted">未採点</span></div>`;
    const r = g.got / g.max;
    return `<div class="rate-row"><span class="rate-label">${esc(k)}</span>
      <div class="rate-track"><div class="rate-fill ${rateClass(r)}" style="width:${pct(g.got, g.max)}%"></div></div>
      <span class="rate-val">${pct(g.got, g.max)}%</span></div>`;
  }).join("")}</div>`;
}
// 正答率の円グラフ：中央に得点率、まわりに 正解／部分点／不正解 の問題数の割合
function donutHTML(def, scores, big) {
  let ok = 0, part = 0, ng = 0, got = 0, max = 0;
  def.items.forEach(it => {
    const v = scores?.[it.id];
    if (v === undefined || v === null || v === "") return;
    const n = Number(v); got += n; max += it.pts;
    if (n >= it.pts) ok++; else if (n > 0) part++; else ng++;
  });
  const total = ok + part + ng || 1, r = 42, c = 2 * Math.PI * r;
  let off = 0;
  const seg = (n, color) => {
    const len = c * n / total;
    const out = n ? `<circle cx="60" cy="60" r="${r}" fill="none" style="stroke:${color}" stroke-width="16"
      stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-off}" transform="rotate(-90 60 60)"/>` : "";
    off += len; return out;
  };
  const p = pct(got, max);
  return `<div class="donut-wrap${big ? " big" : ""}">
    <svg viewBox="0 0 120 120" class="donut" role="img" aria-label="正答率 ${p}%">
      <circle cx="60" cy="60" r="${r}" fill="none" stroke="var(--line)" stroke-width="16"/>
      ${seg(ok, "var(--ok-mid)")}${seg(part, "var(--warn-mid)")}${seg(ng, "var(--err-mid)")}
      <text x="60" y="58" text-anchor="middle" font-size="22" font-weight="800" fill="var(--navy)">${p}%</text>
      <text x="60" y="76" text-anchor="middle" font-size="10" fill="var(--muted)">正答率</text>
    </svg>
    <div class="donut-legend">
      <p class="donut-score">${got}<small>点</small></p>
      <p><span class="lg ok"></span>正解 ${ok}問</p>
      ${part ? `<p><span class="lg part"></span>部分点 ${part}問</p>` : ""}
      <p><span class="lg ng"></span>不正解 ${ng}問</p>
    </div>
  </div>`;
}
function fmtElapsed(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  return m >= 60 ? `${Math.floor(m / 60)}時間${m % 60}分` : `${m}分`;
}
function mockTimeLeft(r, def) {
  if (!r.startedAt) return "";
  const left = r.startedAt + def.minutes * 60000 - Date.now();
  if (left <= 0) return `<span class="timer over">時間切れ（${fmtElapsed(-left)}オーバー）</span>`;
  const mm = Math.floor(left / 60000), ss = Math.floor(left % 60000 / 1000);
  return `<span class="timer">残り ${mm}:${String(ss).padStart(2, "0")}</span>`;
}

const mockOpen = new Set();   // 「詳細」を開いている模試
// 模試全体の難易度：各問の難易度を配点で重みづけした平均
function mockLevel(def) {
  const W = { 基本: 1, 標準: 2, 応用: 3 };
  let sum = 0, pts = 0;
  def.items.forEach(it => { sum += (W[it.level] ?? 2) * it.pts; pts += it.pts; });
  const a = pts ? sum / pts : 2;
  return a < 1.6 ? "基本" : a < 2.2 ? "標準" : a < 2.5 ? "やや難" : "難";
}
function mockCardHTML(r) {
  const def = mockDef(r.mockId);
  if (!def) return "";
  const st = r.status ?? "assigned";
  const stats = mockStats(def, r.scores);
  const late = st === "assigned" && r.dueDate && r.dueDate < today();
  const afterSubmit = ["submitted", "grading", "graded"].includes(st);
  const canKey = role === "tutor" || afterSubmit;
  const web = isWeb(r);
  const pdfs = `<div class="mock-pdfs">
      <a class="pdf-btn" href="${def.q}" download="${esc(def.title)}_問題用紙.pdf">問題（PDF）</a>
      ${web ? "" : `<a class="pdf-btn" href="${def.a}" download="${esc(def.title)}_解答用紙.pdf">解答用紙（PDF）</a>`}
      ${canKey ? `<button type="button" class="pdf-btn key" data-mock-key="${esc(def.id)}">解答・解説（PDF）</button>` : ""}
    </div>`;
  let body = "";
  if (web) {
    body = webCardBody(r, def, st, stats, pdfs);
  } else if (st === "assigned") {
    body = `${role === "student" ? `<button class="primary block-btn" data-mock-start="${esc(r.id)}">受験する</button>` : ""}
      <p class="mock-note">問題と解答用紙を印刷してから始めてください。途中式も書くこと。</p>
      ${pdfs}`;
  } else if (st === "started") {
    const end = new Date(r.startedAt + def.minutes * 60000);
    body = `${pdfs}
      <p class="mock-timer-line" data-mock-timer="${esc(r.id)}">${mockTimeLeft(r, def)}</p>
      <p class="mock-note">${end.getHours()}:${String(end.getMinutes()).padStart(2, "0")} 終了</p>
      ${role === "student" ? photoPanelHTML(r, true) : `<p class="mock-note">生徒が受験中です。</p>`}`;
  } else if (st === "submitted" || st === "grading") {
    body = `${pdfs}<p class="mock-note">提出：${r.submittedAt ? new Date(r.submittedAt).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}${r.startedAt && r.submittedAt ? `（かかった時間 ${fmtElapsed(r.submittedAt - r.startedAt)}）` : ""}　写真 ${r.photoCount ?? 0}枚</p>
      ${st === "grading" ? `<p class="mock-note">採点中：${stats.gradedCount}/${def.items.length}問</p>` : ""}
      ${role === "student" ? `<p class="mock-note">提出済み。先生の採点を待っています。</p>
        ${photoPanelHTML(r, false)}` : ""}`;
  } else if (st === "graded") {
    const fieldOrder = [...new Set(def.items.map(i => i.field))];
    body = `${pdfs}${donutHTML(def, r.scores)}
      ${rateBars(stats.fields, fieldOrder)}
      ${stats.weak.length ? `<p class="label mock-label">苦手な単元</p>
        <div class="weak-chips">${stats.weak.slice(0, 6).map(w => `<span class="weak-chip">${esc(tagLabel(w.field, w.tag))}</span>`).join("")}</div>` : `<p class="mock-note">弱点として目立つ内容はありません。</p>`}
      ${role !== "tutor" && stats.weak.length ? `<p class="mock-note">解答・解説で見直す問題：${stats.weak.slice(0, 3).flatMap(w => w.items.map(it => it.no)).slice(0, 8).map(esc).join("、")}</p>` : ""}
      <div class="actions"><button class="small filled" data-mock-result="${esc(r.id)}">くわしい分析を見る</button></div>`;
  }
  const tutorActions = role === "tutor" ? `<div class="actions tutor-actions">
      ${(r.photoCount ?? 0) > 0 ? `<button class="small outline" data-mock-photos="${esc(r.id)}">提出写真を見る</button>` : ""}
      ${web && ["submitted", "grading"].includes(st) ? `<button class="small outline" data-exam-review="${esc(r.id)}">答案を見る</button>` : ""}
      ${st !== "assigned" && !(web && st === "started") ? `<button class="small outline" data-mock-grade="${esc(r.id)}">${st === "graded" ? "採点を直す" : "採点する"}</button>` : ""}
      <button class="small outline" data-mock-edit="${esc(r.id)}">編集</button>
      <button class="small outline danger" data-mock-del="${esc(r.id)}">削除</button>
    </div>` : "";
  const open = mockOpen.has(r.id) || st === "started";
  return `<article class="item mock-card st-${st}${open ? " open" : ""}" id="mock-card-${esc(r.id)}">
    <div class="mock-head">
      <h4>${esc(def.title)}</h4>
      <span class="status-chip ${st}${late ? " late" : ""}">${late ? "期限切れ" : MOCK_STATUS[st]}</span>
    </div>
    <dl class="mock-info">
      <div><dt>制限時間</dt><dd>${def.minutes}分</dd></div>
      <div><dt>出題範囲</dt><dd>${esc(def.scope)}</dd></div>
      <div><dt>期限</dt><dd class="${late ? "late" : ""}">${r.dueDate ? fmtMD(r.dueDate) : "なし"}</dd></div>
      <div><dt>難易度</dt><dd>${mockLevel(def)}</dd></div>
    </dl>
    ${open ? `<div class="mock-body">
      ${r.memo ? `<p class="mock-memo">${esc(r.memo)}</p>` : ""}
      ${body}
      ${tutorActions}
    </div>` : ""}
    ${st === "started" ? "" : `<button type="button" class="mock-toggle" data-mock-toggle="${esc(r.id)}" aria-expanded="${open}">${open ? "閉じる" : "詳細"}</button>`}
  </article>`;
}
const STEPS = ["印刷", "解く", "写真提出", "採点", "結果"];
const WEB_STEPS = ["解き始める", "マークする", "提出", "結果"];
function stepperHTML(st, web) {
  const cur = web ? ({ assigned: 0, started: 1, submitted: 3, grading: 3, graded: 4 }[st] ?? 0)
    : ({ assigned: 0, started: 1, submitted: 3, grading: 3, graded: 5 }[st] ?? 0);
  return `<ol class="stepper">${(web ? WEB_STEPS : STEPS).map((t, i) => `<li class="${i < cur ? "done" : i === cur ? "now" : ""}"><span>${i + 1}</span>${t}</li>`).join("")}</ol>`;
}
// 生徒：撮った写真を確かめてから提出する
const photoCache = {};   // 模試id → [{ id, src }]
function photoPanelHTML(r, beforeSubmit) {
  const list = photoCache[r.id];
  const n = list ? list.length : (r.photoCount ?? 0);
  const thumbs = list ? list.map(p => `<div class="thumb"><img src="${p.src}" alt="">
      ${beforeSubmit ? `<button type="button" class="thumb-del" data-photo-del="${esc(r.id)}" data-pid="${esc(p.id)}" aria-label="この写真を消す">×</button>` : ""}</div>`).join("")
    : (n ? `<p class="hint left">写真を読み込み中…</p>` : "");
  return `<div class="photo-panel">
      <p class="label">${beforeSubmit ? "③ 解き終わったら、解答用紙を1ページずつ撮影" : `提出した写真（${n}枚）`}</p>
      <div class="thumbs">${thumbs}</div>
      <div class="actions">
        <button type="button" class="${beforeSubmit ? "outline" : "small outline"}" data-mock-submit="${esc(r.id)}">${n ? "写真を追加" : "写真を撮る・選ぶ"}</button>
        ${beforeSubmit ? `<button type="button" class="primary" data-mock-finish="${esc(r.id)}" ${n ? "" : "disabled"}>${n ? `${n}枚で提出する` : "写真を撮ると提出できます"}</button>` : ""}
      </div>
      <p class="upload-status" data-upload-status="${esc(r.id)}"></p>
      <input type="file" accept="image/*" multiple class="hidden-file" data-mock-photo-input="${esc(r.id)}">
    </div>`;
}
const photoLoading = new Set();
async function loadPhotoThumbs(id, force = false) {
  if ((photoCache[id] && !force) || photoLoading.has(id)) return;
  photoLoading.add(id);
  try {
  const snap = await getDocs(query(collection(db, "students", currentSid, "mocks", id, "photos"), orderBy("createdAt", "asc")));
  photoCache[id] = snap.docs.map(d => ({ id: d.id, src: d.data().src }));
  } finally { photoLoading.delete(id); }
  renderMocks();
}
// 画面上部のお知らせ：受験中は残り時間、まだ受けていない模試があればその案内
function renderMockBanner() {
  const bar = $("mock-banner"), pend = $("mock-pending");
  pend.hidden = true;
  if (role === "tutor") { bar.hidden = true; return; }
  const running = mocks.find(m => m.status === "started");
  const soon = addDays(today(), 2);
  const pending = mocks.filter(m => m.status === "assigned" && !(m.dueDate && m.dueDate <= soon))   // 期限が近いものは「今日やること」に出す
    .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
  if (running && role === "student") {
    const def = mockDef(running.mockId);
    bar.className = "mock-banner running";
    bar.innerHTML = `<span>受験中：${esc(def?.title ?? "")}</span><span class="banner-timer" data-mock-timer="${esc(running.id)}"></span>
      <button type="button" class="small" ${isWeb(running) ? `data-exam-open="${esc(running.id)}"` : "data-go-mock"}>開く</button>`;
    bar.hidden = false;
  } else {
    bar.hidden = true;
    // まだ受けていない模試は、カレンダーの「宿題の達成度」の下に赤で目立たせて出す
    if (pending.length) {
      const def = mockDef(pending[0].mockId);
      pend.innerHTML = `<span>未受験の模試 ${pending.length}件｜${esc(def?.title ?? "")}（${fmtMD(pending[0].dueDate)}まで）</span>
        <button type="button" class="small" data-go-mock>模試へ</button>`;
      pend.hidden = false;
    }
  }
}
for (const id of ["mock-banner", "mock-pending"]) $(id).addEventListener("click", (e) => {
  if (e.target.closest("[data-go-mock]")) document.querySelector('.tabs [data-tab="mock"]').click();
  const o = e.target.closest("[data-exam-open]");
  if (o) openExam(o.dataset.examOpen);
});

function renderTrialCard() {
  const box = $("mock-trial");
  if (!box) return;
  box.hidden = role !== "tutor";
  if (role !== "tutor") return;
  box.innerHTML = `<p class="trial-tag">先生用：お試し受験（記録されません・何度でも）</p>
    <div class="trial-list">${MOCKS.filter(m => m.web).map(m => `<button type="button" class="outline" data-trial-start="${m.id}">${esc(m.title)}</button>`).join("")}</div>`;
}
$("mock-trial")?.addEventListener("click", (e) => {
  const b = e.target.closest("[data-trial-start]");
  if (b) startTrial(b.dataset.trialStart);
});
function renderMocks() {
  renderTrialCard();
  const ORDER = { started: 0, assigned: 1, submitted: 2, grading: 2, graded: 3 };
  const list = mocks.slice().sort((a, b) =>
    (ORDER[a.status] ?? 1) - (ORDER[b.status] ?? 1) || (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
  const isDone = (m) => ["submitted", "grading", "graded"].includes(m.status);
  const todo = list.filter(m => !isDone(m)), done = list.filter(isDone);
  $("mock-list").innerHTML = list.length
    ? `${todo.length ? todo.map(mockCardHTML).join("") : `<div class="empty">今受けられる模試はありません。</div>`}
       ${done.length ? `<h3 class="mock-zone">解き終えた模試</h3>${done.map(mockCardHTML).join("")}` : ""}`
    : `<div class="empty">${role === "tutor" ? "右上の「模試を出す」から、生徒に実力テストを出せます。" : "まだ模試は出ていません。"}</div>`;
  clearInterval(mockTimer);
  const running = mocks.some(m => m.status === "started");
  if (running) { tickMockTimers(); mockTimer = setInterval(tickMockTimers, 1000); }
  updateWakeLock(running && role === "student");
  renderMockBanner();
  if (role === "student") list.filter(m => !isWeb(m) && ["started", "submitted", "grading"].includes(m.status)).forEach(m => loadPhotoThumbs(m.id));
  if (examMockId) refreshExamHead();
}
// 残り時間は「開始した時刻」からの経過で毎回計算する（タイマーを数えるのではない）ので、
// アプリが裏に回っても、閉じて開き直しても、時間は途切れずに正しく進む
function tickMockTimers() {
  document.querySelectorAll("[data-mock-timer]").forEach(el => {
    const r = mocks.find(m => m.id === el.dataset.mockTimer), def = mockDef(r?.mockId);
    if (!r || !def) return;
    el.innerHTML = el.classList.contains("banner-timer")
      ? mockTimeLeft(r, def).replace(/<[^>]+>/g, "") : mockTimeLeft(r, def);
    const over = Date.now() >= r.startedAt + def.minutes * 60000;
    const key = "tnote.mockTimeUp." + r.id;
    let told = false;
    try { told = sessionStorage.getItem(key) === "1"; } catch {}
    if (over && role === "student" && !told && document.visibilityState === "visible" && r.status === "started" && !isWeb(r)) {
      try { sessionStorage.setItem(key, "1"); } catch {}
      navigator.vibrate?.([300, 150, 300]);
      setTimeout(() => alert(`${def.title}の制限時間（${def.minutes}分）になりました。解答用紙の写真を撮って提出しましょう。`), 50);
    }
  });
  // ウェブ形式は、時間になったらその時点のマークで自動提出（アプリを閉じていたときは、次に開いたときに提出）
  if (role === "student") mocks.forEach(r => {
    const def = mockDef(r.mockId);
    if (!def || r.status !== "started" || !isWeb(r) || Date.now() < r.startedAt + def.minutes * 60000) return;
    if (autoSubmitting.has(r.id)) return;
    autoSubmitting.add(r.id);
    navigator.vibrate?.([300, 150, 300]);
    submitWeb(r.id, true).finally(() => autoSubmitting.delete(r.id));
  });
  if (examMockId) refreshExamHead();
}
const autoSubmitting = new Set();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && role) { renderCalendarFeed(); renderCalendars(); renderVocabCard(); renderMathCard(); renderHwTab(); }
  if (document.visibilityState === "visible") { tickMockTimers(); updateWakeLock(mocks.some(m => m.status === "started") && role === "student"); }
});
// 受験中は画面が自動で消えないようにする（対応している端末だけ）
let wakeLock = null;
async function updateWakeLock(on) {
  try {
    if (on && !wakeLock && "wakeLock" in navigator && document.visibilityState === "visible") {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    } else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { wakeLock = null; }
}

// 解答・解説PDFはデータベースに分割して保存してある（1件1MBの上限のため）。提出後だけ取り出す
async function downloadMockKey(mockId, btn) {
  const def = mockDef(mockId);
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = "読み込み中…";
  try {
    const meta = await getDoc(doc(db, "config", "mockkey-" + mockId));
    if (!meta.exists()) throw new Error("解答・解説がまだ登録されていません");
    const { chunks } = meta.data();
    const parts = await Promise.all(Array.from({ length: chunks }, (_, i) => getDoc(doc(db, "config", `mockkey-${mockId}-${i}`))));
    const b64 = parts.map(p => p.data()?.data ?? "").join("");
    const bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    const a = document.createElement("a");
    a.href = url; a.download = `${def?.title ?? "模試"}_解答・解説.pdf`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (err) {
    alert("解答・解説を開けませんでした（" + (err?.message ?? err) + "）");
  } finally {
    btn.disabled = false; btn.textContent = label;
  }
}

$("mock-list").addEventListener("click", async (e) => {
  const b = (k) => e.target.closest(`[data-${k}]`);
  let x;
  if ((x = b("mock-toggle"))) {
    const id = x.dataset.mockToggle;
    mockOpen.has(id) ? mockOpen.delete(id) : mockOpen.add(id);
    renderMocks();
    return;
  }
  if ((x = b("mock-key"))) {
    downloadMockKey(x.dataset.mockKey, x);
  } else if ((x = b("exam-open"))) {
    openExam(x.dataset.examOpen);
  } else if ((x = b("exam-review"))) {
    openExam(x.dataset.examReview, true);
  } else if ((x = b("practice-open"))) {
    openExam(x.dataset.practiceOpen, false, "practice");
  } else if ((x = b("exam-grade"))) {
    x.disabled = true; await autoGrade(x.dataset.examGrade, true); x.disabled = false;
  } else if ((x = b("mock-edit"))) {
    const r = mocks.find(m => m.id === x.dataset.mockEdit);
    if (r) startEditMock(r);
  } else if ((x = b("mock-start"))) {
    const r = mocks.find(m => m.id === x.dataset.mockStart), def = mockDef(r?.mockId);
    if (def && confirm(`${def.title}\n制限時間 ${def.minutes}分。始めると時間は止まりません。${isWeb(r) ? "時間になると自動で提出されます。" : "\n問題と解答用紙は印刷しましたか？"}\n始めますか？`)) {
      await updateDoc(mockRef(r.id), { status: "started", startedAt: Date.now() });
      if (isWeb(r)) openExam(r.id);
    }
  } else if ((x = b("mock-submit"))) {
    document.querySelector(`[data-mock-photo-input="${x.dataset.mockSubmit}"]`)?.click();
  } else if ((x = b("mock-finish"))) {
    const r = mocks.find(m => m.id === x.dataset.mockFinish);
    const n = photoCache[r?.id]?.length ?? r?.photoCount ?? 0;
    if (r && n && confirm(`写真${n}枚で提出します。\n提出すると解答・解説が見られるようになり、もう解き直しはできません。よろしいですか？`))
      await updateDoc(mockRef(r.id), { status: "submitted", submittedAt: Date.now() });
  } else if ((x = b("photo-del"))) {
    const id = x.dataset.photoDel;
    if (confirm("この写真を消しますか？")) {
      await deleteDoc(doc(db, "students", currentSid, "mocks", id, "photos", x.dataset.pid));
      photoCache[id] = (photoCache[id] ?? []).filter(p => p.id !== x.dataset.pid);
      await updateDoc(mockRef(id), { photoCount: photoCache[id].length });
    }
  } else if ((x = b("mock-del"))) {
    if (confirm("この模試を削除しますか？（提出写真と採点も消えます）")) {
      const id = x.dataset.mockDel;
      await deleteMockPhotos(id);
      await deleteDoc(mockRef(id));
    }
  } else if ((x = b("mock-photos"))) {
    openMockPhotos(x.dataset.mockPhotos, "mock-photo-body");
    $("mock-photo-modal").hidden = false;
  } else if ((x = b("mock-grade"))) {
    openGrade(x.dataset.mockGrade);
  } else if ((x = b("mock-result"))) {
    openResult(x.dataset.mockResult);
  }
});
$("mock-list").addEventListener("change", async (e) => {
  const input = e.target.closest("[data-mock-photo-input]");
  if (!input || !input.files.length) return;
  const id = input.dataset.mockPhotoInput;
  const files = [...input.files];
  const status = () => document.querySelector(`[data-upload-status="${id}"]`);
  try {
    // 文字が読めるように大きめに縮小し、1枚ずつ別の記録として保存する（1件1MBの上限を避けるため）
    let i = 0;
    for (const f of files) {
      i++;
      if (status()) status().textContent = `写真を送信中… ${i}/${files.length}`;
      const src = await fileToDataUrl(f, 1600, 0.72);
      const ref = await addDoc(collection(db, "students", currentSid, "mocks", id, "photos"), { src, createdAt: serverTimestamp() });
      (photoCache[id] ??= []).push({ id: ref.id, src });
    }
    await updateDoc(mockRef(id), { photoCount: photoCache[id].length });
  } catch (err) {
    alert("写真を送れませんでした（" + (err?.message ?? err) + "）。電波のよい場所でもう一度試してください。");
    loadPhotoThumbs(id, true);
  } finally {
    input.value = "";
  }
});
async function openMockPhotos(id, targetId) {
  $(targetId).innerHTML = `<p class="hint">読み込み中…</p>`;
  const snap = await getDocs(query(collection(db, "students", currentSid, "mocks", id, "photos"), orderBy("createdAt", "asc")));
  $(targetId).innerHTML = snap.docs.length
    ? snap.docs.map((d, i) => `<a href="#" data-open-img="${i}"><img src="${d.data().src}" alt="解答用紙 ${i + 1}枚目"></a>`).join("")
    : `<p class="hint">写真はまだありません。</p>`;
}
document.addEventListener("click", (e) => {
  const a = e.target.closest("[data-open-img]");
  if (!a) return;
  e.preventDefault();
  openDataUrlAsBlob(a.querySelector("img").src);
});

// 採点
let gradingId = null;
function openGrade(id) {
  const r = mocks.find(m => m.id === id), def = mockDef(r?.mockId);
  if (!def) return;
  gradingId = id;
  $("mock-grade-title").textContent = `採点：${def.title}`;
  const byField = {};
  def.items.forEach(it => (byField[it.field] ??= []).push(it));
  $("mock-grade-body").innerHTML = Object.entries(byField).map(([field, list]) => `
    <fieldset class="grade-group"><legend>${esc(field)}</legend>
      ${list.map(it => {
        const v = r.scores?.[it.id];
        return `<div class="grade-row">
          <span class="grade-no">${esc(it.no)}</span>
          <span class="grade-tag">${esc(it.tag)}<small>${esc(it.level)}</small></span>
          <span class="grade-input">
            <button type="button" class="ox" data-ox="max" data-item="${esc(it.id)}">○</button>
            <button type="button" class="ox" data-ox="zero" data-item="${esc(it.id)}">×</button>
            <input type="number" min="0" max="${it.pts}" step="0.5" inputmode="decimal" data-score="${esc(it.id)}" value="${v ?? ""}">
            <small>/${it.pts}</small>
          </span>
        </div>`;
      }).join("")}
    </fieldset>`).join("");
  $("mock-grade-photos").innerHTML = (r.photoCount ?? 0) ? `<button type="button" class="small outline" id="mock-grade-load-photos">提出写真を表示（${r.photoCount}枚）</button>` : "";
  updateGradeTotal();
  $("mock-grade-modal").hidden = false;
}
function updateGradeTotal() {
  const r = mocks.find(m => m.id === gradingId), def = mockDef(r?.mockId);
  if (!def) return;
  let got = 0, n = 0;
  $("mock-grade-body").querySelectorAll("[data-score]").forEach(inp => {
    const it = def.items.find(i => i.id === inp.dataset.score);
    inp.closest(".grade-row").classList.toggle("done", inp.value !== "");
    if (inp.value !== "") { got += Math.min(Number(inp.value), it.pts); n++; }
  });
  $("mock-grade-total").textContent = `採点 ${n}/${def.items.length}問　合計 ${got}点`;
}
$("mock-grade-body").addEventListener("click", (e) => {
  const b = e.target.closest("[data-ox]");
  if (!b) return;
  const r = mocks.find(m => m.id === gradingId), def = mockDef(r?.mockId);
  const it = def.items.find(i => i.id === b.dataset.item);
  const inp = $("mock-grade-body").querySelector(`[data-score="${CSS.escape(b.dataset.item)}"]`);
  inp.value = b.dataset.ox === "max" ? it.pts : 0;
  updateGradeTotal();
});
$("mock-grade-body").addEventListener("input", updateGradeTotal);
$("mock-grade-photos").addEventListener("click", (e) => {
  if (e.target.id === "mock-grade-load-photos") openMockPhotos(gradingId, "mock-grade-photos");
});
$("mock-grade-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const r = mocks.find(m => m.id === gradingId), def = mockDef(r?.mockId);
  const scores = {};
  $("mock-grade-body").querySelectorAll("[data-score]").forEach(inp => {
    if (inp.value === "") return;
    const it = def.items.find(i => i.id === inp.dataset.score);
    scores[it.id] = Math.max(0, Math.min(Number(inp.value), it.pts));
  });
  const all = Object.keys(scores).length === def.items.length;
  await updateDoc(mockRef(gradingId), { scores, status: all ? "graded" : "grading", ...(all ? { gradedAt: Date.now() } : {}) });
  $("mock-grade-modal").hidden = true;
  if (!all) alert(`途中まで保存しました（${Object.keys(scores).length}/${def.items.length}問）。全問入れると結果が生徒にも表示されます。`);
});

// くわしい分析
function openResult(id) {
  const r = mocks.find(m => m.id === id), def = mockDef(r?.mockId);
  if (!def) return;
  const s = mockStats(def, r.scores);
  const fieldOrder = [...new Set(def.items.map(i => i.field))];
  const byField = {};
  def.items.forEach(it => (byField[it.field] ??= []).push(it));
  $("mock-result-title").textContent = def.title;
  $("mock-result-body").innerHTML = `
    ${donutHTML(def, r.scores, true)}
    ${r.startedAt && r.submittedAt ? `<p class="mock-note">解答時間 ${fmtElapsed(r.submittedAt - r.startedAt)}／制限 ${def.minutes}分</p>` : ""}
    <h4 class="modal-sub">分野別</h4>${rateBars(s.fields, fieldOrder)}
    <h4 class="modal-sub">難易度別</h4>${rateBars(s.levels, ["基本", "標準", "応用"])}
    <h4 class="modal-sub">苦手な単元（得点率60%未満）</h4>
    ${s.weak.length ? `<div class="weak-list">${s.weak.map(w => `<div class="weak-row">
        <span class="weak-name">${esc(tagLabel(w.field, w.tag))}</span>
        <span class="weak-items">${w.items.map(it => esc(it.no)).join("、")}</span>
        <span class="rate-val">${pct(w.got, w.max)}%</span></div>`).join("")}</div>`
      : `<p class="mock-note">得点率60%未満の内容はありません。</p>`}
    <h4 class="modal-sub">問題ごとの結果</h4>
    ${Object.entries(byField).map(([field, list]) => `<details class="item-detail"><summary>${esc(field)}</summary>
      <div class="item-grid">${list.map(it => {
        const v = r.scores?.[it.id];
        const cls = v === undefined ? "" : Number(v) >= it.pts ? "ok" : Number(v) > 0 ? "part" : "ng";
        return `<div class="item-cell ${cls}"><span>${esc(it.no)}</span><small>${esc(it.tag)}</small><b>${v ?? "－"}/${it.pts}</b></div>`;
      }).join("")}</div></details>`).join("")}`;
  $("mock-result-modal").hidden = false;
}

/* ---------- ウェブ受験（マーク式）：画面でマーク → 自動保存 → 提出 → 自動採点 ---------- */
const isWeb = (r) => r?.mode === "web" && !!mockDef(r?.mockId)?.web;
const webCache = {};
const loadWeb = (def) => (webCache[def.id] ??= fetch(def.web).then(res => { if (!res.ok) throw new Error("問題データを読み込めませんでした"); return res.json(); }));
const KATEX_MACROS = { "\\le": "\\leqq", "\\ge": "\\geqq", "\\paren": "\\left(#1\\right)", "\\nCr": "{}_{#1}\\mathrm{C}_{#2}" };
function renderTex(tex) {
  if (!window.katex) return esc(tex);
  try { return window.katex.renderToString(tex, { throwOnError: false, strict: false, macros: { ...KATEX_MACROS } }); }
  catch { return esc(tex); }
}
// 問題文・答えの型：$…$ は数式、[ア] はマーク欄の枠、<br> と <u>…</u> は使ってよい
function richText(src, labels = []) {
  const blank = /\[([^\]\s]{1,4})\]/g;
  return String(src ?? "").split("$").map((seg, i) => {
    if (i % 2) return renderTex(seg.replace(blank, (m, l) => labels.includes(l) ? `\\boxed{\\text{${l}}}` : m));
    return esc(seg).replace(/\n/g, "<br>").replace(/&lt;br&gt;/g, "<br>").replace(/&lt;(\/?)u&gt;/g, "<$1u>")
      .replace(blank, (m, l) => labels.includes(l) ? `<span class="blank">${esc(l)}</span>` : m);
  }).join("");
}
function scoreWebItem(item, pts, keyStr, ans) {
  const keyChars = Array.from(keyStr ?? "");
  const labels = item.blanks.map(b => b.label);
  const ok = {};
  labels.forEach((l, i) => { ok[l] = (ans?.[l] ?? "") === keyChars[i]; });
  const groups = item.parts?.length ? item.parts : [labels];
  const good = groups.filter(g => g.every(l => ok[l])).length;
  return { score: Math.round(pts * good / groups.length * 2) / 2, ok };
}
// 問題ごとの解説（提出後にだけ読み出す）。なければ空
async function loadExplanations(mockId) {
  try {
    const k = await getDoc(doc(db, "config", "mockexp-" + mockId));
    return k.exists() ? JSON.parse(k.data().data) : {};
  } catch { return {}; }
}
async function loadAnswerKey(mockId) {
  const k = await getDoc(doc(db, "config", "mockans-" + mockId));
  if (!k.exists()) throw new Error("自動採点のデータがまだ登録されていません");
  return JSON.parse(k.data().data);
}

let examMockId = null, examData = null, examAnswers = {}, examKey = null, examReview = false, examSaveTimer = null;
// examMode: "exam"（受験）／"review"（答案と正解）／"practice"（弱点の復習）
let examMode = "exam", examSec = 0, practiceIds = null, practiceChecked = {}, practiceIdx = 0, examExp = null;
// 先生のお試し受験：データベースには何も書かない。何度でもやり直せる
const TRIAL_ID = "__trial__";
let trialMock = null, trialTimer = null;
const isTrial = () => examMockId === TRIAL_ID;
const curMock = () => isTrial() ? trialMock : mocks.find(m => m.id === examMockId);
const backupKey = (id) => "tnote.examAns." + id;
function readBackup(id) { try { return JSON.parse(localStorage.getItem(backupKey(id)) || "{}"); } catch { return {}; } }
function writeBackup(id, ans) { try { localStorage.setItem(backupKey(id), JSON.stringify(ans)); } catch {} }
// その端末に残っている最新のマークを優先して合わせる
function mergedAnswers(r) {
  const out = JSON.parse(JSON.stringify(r?.answers ?? {}));
  const b = readBackup(r.id);
  Object.entries(b).forEach(([iid, m]) => { out[iid] = { ...(out[iid] ?? {}), ...m }; });
  return out;
}

async function openExam(id, review = false, mode) {
  const r = id === TRIAL_ID ? trialMock : mocks.find(m => m.id === id), def = mockDef(r?.mockId);
  if (!def?.web) return;
  examMockId = id; examMode = mode ?? (review ? "review" : "exam"); examReview = examMode !== "exam";
  examKey = null; examSec = 0; practiceChecked = {};
  $("exam-view").hidden = false;
  document.body.classList.add("exam-open");
  $("exam-title").textContent = (id === TRIAL_ID ? "【お試し】" : "") + (examMode === "practice" ? `弱点の復習：${def.title}` : def.title);
  clearInterval(trialTimer);
  if (id === TRIAL_ID && examMode === "exam") trialTimer = setInterval(refreshExamHead, 1000);
  $("exam-body").innerHTML = `<p class="hint">読み込み中…</p>`;
  $("exam-nav").innerHTML = "";
  closeSecMenu();
  try {
    examData = await loadWeb(def);
    if (examMode === "exam") examAnswers = id === TRIAL_ID ? (r.answers ?? {}) : mergedAnswers(r);
    else if (examMode === "review") examAnswers = JSON.parse(JSON.stringify(r.answers ?? {}));
    else examAnswers = {};
    if (examMode !== "exam") examKey = await loadAnswerKey(def.id).catch(() => null);
    if (examMode === "practice") {
      practiceIds = practiceSet(r, def).map(it => it.id);
      practiceIdx = 0;
      if (!examKey) throw new Error("正解データを読み込めませんでした");
      examExp = await loadExplanations(def.id);
    }
  } catch (err) {
    $("exam-body").innerHTML = `<p class="error">${esc(err?.message ?? err)}</p>`;
    return;
  }
  renderExam();
}
function closeExam() {
  flushExamSave();
  clearInterval(trialTimer);
  examMockId = null; examData = null; examKey = null; practiceIds = null;
  $("exam-view").hidden = true;
  closeSecMenu();
  document.body.classList.remove("exam-open");
}
$("exam-close").addEventListener("click", closeExam);

// 復習で出す問題：まちがえた（部分点を含む）問題と、得点率の低い内容の問題
function practiceSet(r, def) {
  const s = mockStats(def, r.scores);
  const weakTags = new Set(s.weak.map(w => `${w.field}｜${w.tag}`));
  return def.items.filter(it => {
    const v = r.scores?.[it.id];
    return (v !== undefined && Number(v) < it.pts) || weakTags.has(`${it.field}｜${it.tag}`);
  });
}
// いま表示する大問（復習のときは、出題する問題がある大問だけ）
function examSections() {
  if (!examData) return [];
  if (examMode !== "practice") return examData.sections;
  const ids = new Set(practiceIds ?? []);
  return examData.sections.map(sec => ({ ...sec, items: sec.items.filter(it => ids.has(it.id)) })).filter(sec => sec.items.length);
}
const isBlankFilled = (iid, lab) => (examAnswers[iid]?.[lab] ?? "") !== "";
function secProgress(sec) {
  if (examMode === "practice") {
    const ok = sec.items.filter(it => practiceChecked[it.id]?.ok).length;
    return `${ok}/${sec.items.length}`;
  }
  if (examMode === "review") {
    const def = mockDef(curMock()?.mockId);
    const r = curMock();
    let got = 0, max = 0;
    sec.items.forEach(it => { const p = def?.items.find(i => i.id === it.id)?.pts ?? 0; max += p; got += Number(r?.scores?.[it.id] ?? 0); });
    return `${got}/${max}点`;
  }
  let done = 0, total = 0;
  sec.items.forEach(it => it.blanks.forEach(b => { total++; if (isBlankFilled(it.id, b.label)) done++; }));
  return `${done}/${total}`;
}
function examCounts() {
  let done = 0, total = 0;
  examData.sections.forEach(sec => sec.items.forEach(it => it.blanks.forEach(b => {
    total++; if (isBlankFilled(it.id, b.label)) done++;
  })));
  return { done, total };
}
function refreshExamHead() {
  if (!examMockId || !examData) return;
  const r = curMock(), def = mockDef(r?.mockId);
  if (!r || !def) return;
  if (examMode === "practice") {
    const n = practiceIds?.length ?? 0, ok = practiceIds?.filter(id => practiceChecked[id]?.ok).length ?? 0;
    $("exam-timer").textContent = "";
    $("exam-submit").hidden = true;
    $("exam-progress").textContent = practiceIdx < n ? `問題 ${practiceIdx + 1}/${n}・正解 ${ok}` : `正解 ${ok}/${n}問`;
  } else if (examReview || r.status !== "started") {
    $("exam-timer").textContent = "";
    $("exam-submit").hidden = true;
    const s = mockStats(def, r.scores);
    $("exam-progress").textContent = r.status === "graded" ? `${s.got} / ${s.max}点（${pct(s.got, s.max)}%）` : "提出済み";
  } else {
    const { done, total } = examCounts();
    $("exam-timer").innerHTML = mockTimeLeft(r, def).replace(/<[^>]+>/g, "");
    $("exam-submit").hidden = role !== "student" && !isTrial();
    $("exam-progress").textContent = `マーク ${done}/${total}`;
  }
  renderSecFab();
}
function itemHTML(it, metaById) {
  const labels = it.blanks.map(b => b.label);
  const ans = examAnswers[it.id] ?? {};
  const key = examKey?.[it.id];
  const keyChars = Array.from(key ?? "");
  const pts = metaById[it.id]?.pts ?? 0;
  const checked = examMode === "practice" ? practiceChecked[it.id] : null;
  const showKey = (examMode === "review" && key) || !!checked;
  const res = showKey ? scoreWebItem(it, pts, key, ans) : null;
  const mark = res ? (res.score >= pts ? "ok" : res.score > 0 ? "part" : "ng") : "";
  const locked = examMode === "review" || !!checked;
  // 欄が1つだけの問題（英語の4択など）は「ア」を見せず、文中の空所は下線の空欄にする
  const single = it.blanks.length === 1 && !it.t;
  let q = it.q;
  if (single) q = String(q).replace(/[（(]\s*ア\s*[)）]/g, "〔空所〕");
  const qHTML = richText(q, single ? [] : labels).replace(/〔空所〕/g, `<span class="ans-blank"></span>`);
  const choices = it.choices ? `<ol class="exam-choices">${it.choices.map((c, i) => `<li><span class="cnum">${i + 1}</span>${richText(c)}</li>`).join("")}</ol>` : "";
  const notes = it.notes ? `<div class="exam-notes">${it.notes.map(n => `<p>${richText(n)}</p>`).join("")}</div>` : "";
  // 枠だけの型（選択問題）は、マーク欄と同じなので表示しない
  const onlyBlanks = !String(it.t ?? "").replace(/\[[^\]\s]{1,4}\]|[\s　]/g, "");
  const t = it.t && !onlyBlanks ? `<div class="exam-t">${richText(it.t, labels)}</div>` : "";
  const rows = it.blanks.map((b, bi) => {
    const v = ans[b.label] ?? "";
    return `<div class="mark-row${single ? " single" : ""}">
      ${single ? `<span class="mark-label plain">解答</span>` : `<span class="mark-label">${esc(b.label)}</span>`}
      <div class="bubbles">${b.opts.map(o => {
        const cls = ["bubble", v === o ? "on" : "", res && keyChars[bi] === o ? "correct" : "", res && v === o && keyChars[bi] !== o ? "wrong" : ""].filter(Boolean).join(" ");
        return `<button type="button" class="${cls}" ${locked ? "disabled" : ""} data-ex-item="${esc(it.id)}" data-ex-label="${esc(b.label)}" data-ex-opt="${esc(o)}">${esc(o)}</button>`;
      }).join("")}</div>
    </div>`;
  }).join("");
  const practiceBtns = "";
  return `<article class="exam-item ${mark}" id="ex-${esc(it.id)}">
    <div class="exam-q"><span class="exam-no">${esc(it.no)}</span>
      <span class="exam-tag">${esc(tagLabel(metaById[it.id]?.field, metaById[it.id]?.tag))}</span>
      ${res ? `<span class="exam-res ${mark}">${mark === "ok" ? "正解" : mark === "part" ? "部分点" : "不正解"}${examMode === "review" ? ` ${res.score}/${pts}` : ""}</span>` : ""}
      <div>${qHTML}</div></div>
    ${choices}${notes}${t}
    <div class="marks">${rows}</div>
    ${practiceBtns}
  </article>`;
}
// 解き直し：1問ずつ出題 → 答え合わせ → その問題の解説 → 次の問題
function renderPractice(r, def) {
  const metaById = Object.fromEntries(def.items.map(i => [i.id, i]));
  const ids = practiceIds ?? [];
  if (!ids.length) {
    $("exam-body").innerHTML = `<div class="empty">解き直す問題はありません。</div>`;
    return refreshExamHead();
  }
  if (practiceIdx >= ids.length) {
    const ok = ids.filter(id => practiceChecked[id]?.ok).length;
    const wrong = ids.filter(id => !practiceChecked[id]?.ok);
    $("exam-body").innerHTML = `<div class="pr-done">
        <p class="pr-done-title">おつかれさま！</p>
        <p class="pr-done-score">${ok}<small> / ${ids.length}問 正解</small></p>
        <div class="pr-done-list">${ids.map(id => `<span class="pr-dot ${practiceChecked[id]?.ok ? "ok" : "ng"}">${esc(metaById[id]?.no ?? id)}</span>`).join("")}</div>
        <div class="pr-done-actions">
          ${wrong.length ? `<button type="button" class="primary" data-pr-again="wrong">まちがえた${wrong.length}問をもう一度</button>` : `<p class="mock-note">全部正解できました！</p>`}
          <button type="button" class="outline" data-pr-again="all">最初から全部</button>
          ${isTrial() ? `<button type="button" class="outline" data-trial-again="${esc(trialMock.mockId)}">模試をもう一度受ける</button>` : ""}
          <button type="button" class="outline" data-pr-close>閉じる</button>
        </div>
      </div>`;
    return refreshExamHead();
  }
  const id = ids[practiceIdx];
  const sec = examData.sections.find(sc => sc.items.some(x => x.id === id));
  const it = sec?.items.find(x => x.id === id);
  if (!it) { practiceIdx++; return renderPractice(r, def); }
  const checked = practiceChecked[id];
  const exp = examExp?.[id];
  const last = practiceIdx === ids.length - 1;
  $("exam-body").innerHTML = `
    <div class="pr-progress"><div style="width:${Math.round(practiceIdx / ids.length * 100)}%"></div></div>
    <p class="pr-sec">${esc(sec.title)}</p>
    ${sec.instructions ? `<p class="exam-inst">${richText(String(sec.instructions).replace(/[（(]\s*ア\s*[)）]/g, "空所"))}</p>` : ""}
    ${sec.passage ? `<details class="pr-passage" open><summary>本文</summary><div class="exam-passage">${sec.passage.map(pp => `<p>${richText(pp)}</p>`).join("")}</div></details>` : ""}
    ${itemHTML(it, metaById)}
    ${checked ? `<div class="exp-box ${checked.ok ? "ok" : "ng"}">
        <p class="exp-result">${checked.ok ? "正解！" : "不正解"}</p>
        <p class="exp-label">解説</p>
        <div class="exp-text">${exp ? richText(exp) : "この問題の解説は、解答・解説PDFを見てください。"}</div>
      </div>
      <div class="pr-nav"><button type="button" class="primary big-action" data-pr-next>${last ? "結果を見る" : "次の問題へ →"}</button></div>`
    : `<div class="pr-nav"><button type="button" class="primary big-action" data-pr-check="${esc(id)}">答え合わせ</button></div>`}`;
  $("exam-body").scrollTop = 0;
  refreshExamHead();
}
function renderExam() {
  const r = curMock(), def = mockDef(r?.mockId);
  if (!r || !def || !examData) return;
  if (examMode === "practice") return renderPractice(r, def);
  const metaById = Object.fromEntries(def.items.map(i => [i.id, i]));
  const secs = examSections();
  if (!secs.length) {
    $("exam-body").innerHTML = `<div class="empty">解き直す問題はありません。</div>`;
    refreshExamHead();
    return;
  }
  examSec = Math.max(0, Math.min(examSec, secs.length - 1));
  const sec = secs[examSec];
  const trialBox = isTrial() && examMode === "review" && examSec === 0 ? `<div class="trial-result">
      <p class="trial-tag">お試し受験の結果（記録されません）</p>
      ${donutHTML(def, r.scores)}
      <div class="actions">
        ${practiceSet(r, def).length ? `<button type="button" class="primary" data-trial-practice>解き直し（${practiceSet(r, def).length}問）</button>` : ""}
        <button type="button" class="outline" data-trial-again="${esc(r.mockId)}">もう一度受ける</button>
      </div></div>` : "";
  const intro = examSec !== 0 ? "" : examMode === "review"
      ? `${trialBox}<p class="exam-intro">${examKey ? "あなたのマーク（紺色）と正解（緑の枠）です。右下のボタンで大問を切り替えられます。" : "正解はまだ表示できません。"}</p>`
      : examMode === "practice"
        ? `<p class="exam-intro">解き直し ${practiceIds.length}問。</p>`
        : `<p class="exam-intro">${examData.intro ? esc(examData.intro) + "<br>" : ""}マークは自動保存。時間になると自動で提出されます。</p>`;
  const prev = examSec > 0 ? `<button type="button" class="outline" data-sec-go="${examSec - 1}">← ${esc(secs[examSec - 1].title)}</button>` : "<span></span>";
  const next = examSec < secs.length - 1 ? `<button type="button" class="primary" data-sec-go="${examSec + 1}">${esc(secs[examSec + 1].title)} →</button>`
    : (examMode === "exam" && (role === "student" || isTrial()) ? `<button type="button" class="primary" data-ex-submit>提出する</button>` : "<span></span>");
  $("exam-body").innerHTML = `${intro}
    <section class="exam-sec">
      <h3>${esc(sec.title)}<small class="sec-count">大問 ${examSec + 1}/${secs.length}</small></h3>
      ${sec.instructions ? `<p class="exam-inst">${richText(String(sec.instructions).replace(/[（(]\s*ア\s*[)）]/g, "空所"))}</p>` : ""}
      ${sec.passage ? `<div class="exam-passage">${sec.passage.map(pp => `<p>${richText(pp)}</p>`).join("")}</div>` : ""}
      ${sec.items.map(it => itemHTML(it, metaById)).join("")}
    </section>
    <div class="sec-pager">${prev}${next}</div>`;
  $("exam-body").scrollTop = 0;
  refreshExamHead();
}
// 右下の「大問を切り替える」ボタン
function renderSecFab() {
  const secs = examSections();
  const fab = $("exam-fab");
  if (!examData || secs.length < 2 || examMode === "practice") { fab.hidden = true; return; }
  fab.hidden = false;
  fab.innerHTML = `<span class="fab-sub">大問 ${examSec + 1}/${secs.length}</span><span class="fab-main">${esc(secs[examSec]?.title ?? "")}</span><span class="fab-arrow">▲</span>`;
  if (!$("exam-secmenu").hidden) renderSecMenu();
}
function renderSecMenu() {
  const secs = examSections();
  $("exam-secmenu").innerHTML = `<p class="secmenu-head">大問を選ぶ</p>` + secs.map((s, i) => `
    <button type="button" class="secmenu-item${i === examSec ? " now" : ""}" data-sec-go="${i}">
      <span>${esc(s.title)}</span><small>${secProgress(s)}</small></button>`).join("");
}
function closeSecMenu() { $("exam-secmenu").hidden = true; $("exam-fab").classList.remove("open"); }
$("exam-fab").addEventListener("click", () => {
  const open = $("exam-secmenu").hidden;
  if (open) { renderSecMenu(); $("exam-secmenu").hidden = false; $("exam-fab").classList.add("open"); }
  else closeSecMenu();
});
$("exam-secmenu").addEventListener("click", (e) => {
  const b = e.target.closest("[data-sec-go]");
  if (b) { examSec = Number(b.dataset.secGo); closeSecMenu(); renderExam(); }
});
$("exam-body").addEventListener("click", async (e) => {
  if (e.target.closest("[data-ex-submit]")) return confirmSubmitWeb();
  if (e.target.closest("[data-trial-practice]")) return openExam(TRIAL_ID, false, "practice");
  const ta = e.target.closest("[data-trial-again]");
  if (ta) return startTrial(ta.dataset.trialAgain);
  const go = e.target.closest("[data-sec-go]");
  if (go) { examSec = Number(go.dataset.secGo); renderExam(); return; }
  const chk = e.target.closest("[data-pr-check]");
  if (chk) return practiceCheck(chk.dataset.prCheck);
  if (e.target.closest("[data-pr-next]")) { practiceIdx++; return renderExam(); }
  if (e.target.closest("[data-pr-close]")) return closeExam();
  const again = e.target.closest("[data-pr-again]");
  if (again) {
    const r = curMock(), def = mockDef(r?.mockId);
    const all = practiceSet(r, def).map(it => it.id);
    practiceIds = again.dataset.prAgain === "wrong" ? practiceIds.filter(id => !practiceChecked[id]?.ok) : all;
    practiceIds.forEach(id => { delete practiceChecked[id]; delete examAnswers[id]; });
    practiceIdx = 0;
    return renderExam();
  }
  const bt = e.target.closest("[data-ex-opt]");
  if (!bt || bt.disabled) return;
  const { exItem: iid, exLabel: lab, exOpt: opt } = bt.dataset;
  if (examMode === "exam") {
    const r = curMock();
    if ((role !== "student" && !isTrial()) || r?.status !== "started") return;
  } else if (examMode !== "practice") return;
  const cur = examAnswers[iid]?.[lab] ?? "";
  (examAnswers[iid] ??= {})[lab] = cur === opt ? "" : opt;   // もう一度押すと取り消し
  bt.parentElement.querySelectorAll(".bubble").forEach(x => x.classList.toggle("on", x.dataset.exOpt === examAnswers[iid][lab]));
  if (examMode !== "exam") return;
  if (isTrial()) { trialMock.answers = examAnswers; refreshExamHead(); return; }
  writeBackup(examMockId, examAnswers);
  refreshExamHead();
  clearTimeout(examSaveTimer);
  examSaveTimer = setTimeout(flushExamSave, 1200);
});
// 復習：その場で答え合わせ。結果は模試の記録に残す（模試の点数は変わらない）
async function practiceCheck(iid) {
  const r = curMock(), def = mockDef(r?.mockId);
  const it = examData.sections.flatMap(s => s.items).find(x => x.id === iid);
  if (!it || !def) return;
  const missing = it.blanks.filter(b => !isBlankFilled(iid, b.label)).length;
  if (missing) return alert(it.blanks.length > 1 ? `まだマークしていない欄が${missing}か所あります。` : "答えをマークしてから「答え合わせ」を押してください。");
  const pts = def.items.find(i => i.id === iid)?.pts ?? 1;
  const res = scoreWebItem(it, pts, examKey[iid], examAnswers[iid]);
  practiceChecked[iid] = { ok: res.score >= pts };
  renderExam();
  requestAnimationFrame(() => document.querySelector(".exp-box")?.scrollIntoView({ block: "start", behavior: "smooth" }));
  if (role === "student" && !isTrial()) {
    try { await updateDoc(mockRef(examMockId), { [`practice.${iid}`]: practiceChecked[iid].ok, practiceAt: Date.now() }); } catch {}
  }
}
async function flushExamSave() {
  clearTimeout(examSaveTimer);
  const id = examMockId;
  const r = mocks.find(m => m.id === id);
  if (!id || examMode !== "exam" || r?.status !== "started" || role !== "student") return;
  try { await updateDoc(mockRef(id), { answers: examAnswers, answeredAt: Date.now() }); } catch {}
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushExamSave(); });
$("exam-submit").addEventListener("click", confirmSubmitWeb);
function confirmSubmitWeb() {
  const { done, total } = examCounts();
  const msg = done < total ? `まだマークしていない欄が ${total - done} か所あります。\nこのまま提出しますか？` : "提出しますか？";
  if (confirm(msg + "\n提出すると答えは変えられません。すぐに採点結果と解答・解説が見られます。")) submitWeb(examMockId, false);
}
async function submitWeb(id, auto) {
  if (id === TRIAL_ID) return submitTrial();
  const r = mocks.find(m => m.id === id);
  if (!r || r.status !== "started") return;
  const answers = id === examMockId ? examAnswers : mergedAnswers(r);
  try {
    await updateDoc(mockRef(id), { answers, status: "submitted", submittedAt: Date.now(), autoSubmitted: !!auto });
    try { localStorage.removeItem(backupKey(id)); } catch {}
  } catch (err) {
    alert("提出できませんでした（" + (err?.message ?? err) + "）。電波のよい場所でもう一度提出してください。");
    return;
  }
  if (id === examMockId) closeExam();
  if (auto) alert(`${mockDef(r.mockId)?.title ?? "模試"}の時間になったので、自動で提出しました。`);
  await autoGrade(id, false, answers);
  document.querySelector('.tabs [data-tab="mock"]')?.click();
}
async function submitTrial() {
  const def = mockDef(trialMock.mockId);
  try {
    const [data, key] = await Promise.all([loadWeb(def), loadAnswerKey(def.id)]);
    const metaById = Object.fromEntries(def.items.map(i => [i.id, i]));
    const scores = {};
    data.sections.forEach(sec => sec.items.forEach(it => {
      if (metaById[it.id] && key[it.id] !== undefined) scores[it.id] = scoreWebItem(it, metaById[it.id].pts, key[it.id], examAnswers[it.id]).score;
    }));
    Object.assign(trialMock, { answers: examAnswers, scores, status: "graded", submittedAt: Date.now() });
    openExam(TRIAL_ID, true);
  } catch (err) {
    alert("採点できませんでした（" + (err?.message ?? err) + "）");
  }
}
function startTrial(mockId) {
  trialMock = { id: TRIAL_ID, mockId, mode: "web", status: "started", startedAt: Date.now(), answers: {}, scores: {} };
  openExam(TRIAL_ID);
}
// 自動採点：正解は提出後にだけデータベースから読み出す
async function autoGrade(id, showError, answersOverride) {
  const r = mocks.find(m => m.id === id), def = mockDef(r?.mockId);
  if (!def?.web) return;
  try {
    const [data, key] = await Promise.all([loadWeb(def), loadAnswerKey(def.id)]);
    const answers = answersOverride ?? r.answers ?? {};
    const metaById = Object.fromEntries(def.items.map(i => [i.id, i]));
    const scores = {};
    data.sections.forEach(sec => sec.items.forEach(it => {
      if (!metaById[it.id] || key[it.id] === undefined) return;
      scores[it.id] = scoreWebItem(it, metaById[it.id].pts, key[it.id], answers[it.id]).score;
    }));
    await updateDoc(mockRef(id), { scores, status: "graded", gradedAt: Date.now(), autoGraded: true });
  } catch (err) {
    if (showError) alert("自動採点できませんでした（" + (err?.message ?? err) + "）");
  }
}
function webCardBody(r, def, st, stats, pdfs) {
  const answers = r.answers ?? {};
  const answered = Object.values(answers).reduce((n, m) => n + Object.values(m ?? {}).filter(v => v !== "").length, 0);
  if (st === "assigned") {
    return `${role === "student" ? `<button class="primary block-btn" data-mock-start="${esc(r.id)}">受験する</button>` : ""}
      ${pdfs}`;
  }
  if (st === "started") {
    const end = new Date(r.startedAt + def.minutes * 60000);
    return `<p class="mock-timer-line" data-mock-timer="${esc(r.id)}">${mockTimeLeft(r, def)}</p>
      <p class="mock-note">${end.getHours()}:${String(end.getMinutes()).padStart(2, "0")} に自動で提出されます</p>
      ${role === "student" ? `<button class="primary block-btn" data-exam-open="${esc(r.id)}">続きから解く</button>`
        : `<p class="mock-note">受験中（マーク ${answered}か所）</p>`}
      ${pdfs}`;
  }
  if (st === "submitted" || st === "grading") {
    return `<p class="mock-note">採点中</p>
      <div class="actions"><button class="small outline" data-exam-grade="${esc(r.id)}">採点し直す</button></div>${pdfs}`;
  }
  const fieldOrder = [...new Set(def.items.map(i => i.field))];
  const pset = practiceSet(r, def);
  const pdone = pset.filter(it => r.practice?.[it.id]).length;
  return `${donutHTML(def, r.scores)}
    ${r.startedAt && r.submittedAt ? `<p class="mock-note">解答時間 ${fmtElapsed(r.submittedAt - r.startedAt)}${r.autoSubmitted ? "（時間切れ）" : ""}</p>` : ""}
    <p class="label mock-label">分野別</p>
    ${rateBars(stats.fields, fieldOrder)}
    ${stats.weak.length ? `<p class="label mock-label">苦手な単元</p>
      <div class="weak-chips">${stats.weak.slice(0, 6).map(w => `<span class="weak-chip">${esc(tagLabel(w.field, w.tag))}</span>`).join("")}</div>` : ""}
    ${pset.length && role !== "parent" ? `<button class="primary block-btn" data-practice-open="${esc(r.id)}">解き直し（${pset.length}問）${pdone ? `　${pdone}問できた` : ""}</button>` : ""}
    <div class="actions">
      <button class="small outline" data-exam-review="${esc(r.id)}">答案を見る</button>
      <button class="small outline" data-mock-result="${esc(r.id)}">成績表</button>
    </div>
    ${pdfs}`;
}

/* ---------- 毎日の単語帳：1日20問 → 1問ずつ4択 → 解説 → まちがえた単語は全部正解するまで復習 ---------- */
const VOCAB_BY_ID = Object.fromEntries(VOCAB.map(v => [`${v[0]}:${v[1]}`, v]));
const VOCAB_IDS = VOCAB.map(v => `${v[0]}:${v[1]}`);
const DAILY_N = 20;
// 今日の問題数：「毎日の英単語」の宿題の期間中は、その毎日の数（いちばん多いもの）。なければ20問
const vocabN = () => hwQuotaToday("daily-vocab") ?? DAILY_N;
const VOCAB_LEVELS = [{ lv: 1, name: "レベル1", sub: "英検準2級" }, { lv: 2, name: "レベル2", sub: "英検2級" }, { lv: 3, name: "レベル3", sub: "2級上位・熟語" }];
const idsOfLevel = (lv) => VOCAB_IDS.filter(id => LEVEL_OF[id] === lv);
// いま選んでいるレベル（決めていなければ、これまで解いた記録があれば2、なければ1）
const vocabLevel = () => vocab.level ?? (Object.keys(vocab.words ?? {}).length ? 2 : 1);
const BOX_DAYS = [1, 2, 4, 7, 15, 30];   // 正解するたびに次の出題までの日数をのばす（まちがえたら翌日）
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const addDays = (iso, n) => { const [y, m, d] = iso.split("-").map(Number); const t = new Date(y, m - 1, d + n); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`; };
let vocab = { words: {}, days: {}, today: null };
let vocabChoices = null;   // いま出している問題の選択肢
// 先生のお試し：本物の記録（vocabReal）はそのままにして、別の入れ物で解く
let vocabTrial = false, vocabReal = null;
const vocabRef = () => doc(db, "students", currentSid, "vocab", "state");
const senses = (m) => String(m).replace(/（[^）]*）/g, "").split(/[、,]/).map(x => x.trim()).filter(Boolean);
const shuffle = (a) => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };

// 今日の問題：復習の時期が来た単語 → まだ出していない単語 の順
function pickDaily(n = vocabN()) {
  const t = localToday();
  const due = Object.entries(vocab.words).filter(([id, w]) => VOCAB_BY_ID[id] && w.due <= t)
    .sort((a, b) => a[1].due.localeCompare(b[1].due) || (a[1].box ?? 0) - (b[1].box ?? 0)).map(([id]) => id);
  // 新しい単語は選んだレベルから（使い切ったら次のレベル→ほかのレベル）。復習は全レベルから
  const lv = vocabLevel(), order = [lv, ...[1, 2, 3].filter(x => x > lv), ...[1, 2, 3].filter(x => x < lv)];
  const fresh = order.flatMap(x => idsOfLevel(x).filter(id => !vocab.words[id]));
  const reviewN = Math.min(due.length, fresh.length ? Math.round(n * 0.6) : n);
  let ids = [...due.slice(0, reviewN), ...fresh.slice(0, n - reviewN)];
  if (ids.length < n) {
    const extra = Object.entries(vocab.words).filter(([id]) => VOCAB_BY_ID[id] && !ids.includes(id))
      .sort((a, b) => (a[1].box ?? 0) - (b[1].box ?? 0)).map(([id]) => id);
    ids = [...ids, ...extra].slice(0, n);
  }
  return shuffle(ids);
}
// 選択肢（英検形式）：下線の語に最も意味が近い語＋同じ品詞の別の語3つ（英語）。
// まぎらわしい語（同じグループ・意味が重なる語・同じつづり）は入れない。各選択肢には解説用に日本語の意味をつける
const VOCAB_CANDS = VOCAB.flatMap(c => {
  const id = `${c[0]}:${c[1]}`, s = SYN[id];
  return [{ t: c[0], ja: c[2], pos: c[1], grp: c[5], src: id }, ...(s ? [{ t: s[0], ja: s[1], pos: c[1], grp: c[5], src: id }] : [])];
});
const synOf = (id) => { const s = SYN[id]; return s ? { t: s[0], ja: s[1] } : { t: VOCAB_BY_ID[id][0], ja: VOCAB_BY_ID[id][2] }; };
// prev：前に出したときの選択肢（{ ch: まちがいの3語, pos: 正解の位置 }）。
// まちがえた単語をもう一度出すときに同じ問題にならないよう、まちがいの語をすべて入れかえ、正解の位置も変える
function makeChoices(id, prev) {
  const v = VOCAB_BY_ID[id], right = synOf(id);
  const mine = new Set([...senses(v[2]), ...senses(right.ja)]);
  const bad = new Set([v[0], right.t].map(x => x.toLowerCase()));
  // 正解と同じ語・この単語を類義語にもつ単語は、その単語ごと（見出し語も類義語も）外す
  const near = new Set(VOCAB_CANDS.filter(c => bad.has(c.t.toLowerCase())).map(c => c.src));
  const ok = (c) => c.src !== id && !near.has(c.src) && !bad.has(c.t.toLowerCase()) && !(v[5] && c.grp === v[5]) && !senses(c.ja).some(s => mine.has(s));
  let pool = shuffle(VOCAB_CANDS.filter(c => c.pos === v[1] && ok(c)));
  if (pool.length < 3) pool = pool.concat(shuffle(VOCAB_CANDS.filter(c => c.pos !== v[1] && ok(c))));
  const used = new Set(prev?.ch ?? []);
  pool = [...pool.filter(c => !used.has(c.t)), ...pool.filter(c => used.has(c.t))];
  const picked = [];
  for (const c of pool) {
    if (picked.length === 3) break;
    // 同じ単語から2つ出したり、同じ語を2回出したりしない
    if (!picked.some(p => p.t === c.t || p.src === c.src || p.ja === c.ja)) picked.push(c);
  }
  const list = shuffle([right, ...picked.map(c => ({ t: c.t, ja: c.ja }))]);
  const at = list.indexOf(right);
  if (prev && at === prev.pos) { const j = (at + 1 + Math.floor(Math.random() * 3)) % 4; [list[at], list[j]] = [list[j], list[at]]; }
  return list;
}
async function saveVocab() {
  if (role !== "student" || vocabTrial) return;
  try { await setDoc(vocabRef(), vocab); } catch {}
}
function vocabStreak() {
  let n = 0, d = localToday();
  if (!vocab.days?.[d]?.done) d = addDays(d, -1);
  while (vocab.days?.[d]?.done) { n++; d = addDays(d, -1); }
  return n;
}
// 習得の円グラフ：全単語のうち 定着（3回つづけて正解）・学習中（出たがまだ定着していない）・未学習
function vocabProgressHTML(learned, mastered, total = VOCAB_IDS.length) {
  const doing = learned - mastered, rest = total - learned;
  const pct = Math.round(mastered / total * 100);
  const C = 2 * Math.PI * 40, seg = (n) => n / total * C;
  const arc = (cls, len, off) => len > 0 ? `<circle class="${cls}" cx="50" cy="50" r="40" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}"/>` : "";
  return `<div class="vc-progress">
      <svg viewBox="0 0 100 100" class="vc-donut" role="img" aria-label="定着 ${pct}%">
        <circle class="bg" cx="50" cy="50" r="40"/>
        ${arc("m", seg(mastered), 0)}${arc("l", seg(doing), seg(mastered))}
        <text x="50" y="45" class="pct">${pct}<tspan class="unit">%</tspan></text>
        <text x="50" y="67" class="cap">定着</text>
      </svg>
      <div class="vc-legend">
        <p><i class="m"></i>定着<b>${mastered}</b>語</p>
        <p><i class="l"></i>学習中<b>${doing}</b>語</p>
        <p><i class="u"></i>未出題<b>${rest}</b>語</p>
        <p class="vc-total">全${total}語のうち <b>${Math.round(learned / total * 100)}%</b> が出題済み</p>
      </div>
    </div>
`;
}
// 英語・数学カードの見出し：タイトルの横に今日の分の横ゲージ（未実施 0/20 → とちゅう 7/20 → 復習 あと3 → 完了）
function cardHead(name, state, prog, text) {
  return `<div class="vc-head"><p class="vc-kicker">${name}</p>
      <div class="vc-gauge ${state}" role="img" aria-label="${esc(text)}"><div class="vc-bar"><div style="width:${prog}%"></div></div><span>${esc(text)}</span></div></div>`;
}
// レベルのボタン：「レベル1」と定着％だけ（英語・数学で同じ形）
const levelButtons = (kind, cur, pcts, disabled) => `<div class="mc-levels ${kind}" role="group" aria-label="レベル">${[1, 2, 3].map(l =>
  `<button type="button" class="mc-lv${l === cur ? " on" : ""}" data-${kind}-level="${l}" aria-pressed="${l === cur}" ${disabled ? "disabled" : ""}><b>レベル${l}</b><span>${pcts[l - 1]}%</span></button>`).join("")}</div>`;
// 英語・数学カードの「レベル・定着・この1週間」をたたむ。開いたかどうかは描き直しても残す
const cardMoreOpen = { vocab: false, math: false };
document.addEventListener("toggle", (e) => { const k = e.target?.dataset?.more; if (k) cardMoreOpen[k] = e.target.open; }, true);
const moreDetails = (key, label, html) => `<details class="vc-more" data-more="${key}" ${cardMoreOpen[key] ? "open" : ""}>
    <summary><span class="vc-more-t">くわしく見る</span><span class="vc-more-s">${label}</span></summary>${html}</details>`;
function renderVocabCard() {
  const card = $("vocab-card");
  if (!card) return;
  if (!currentSid) { card.hidden = true; return; }
  card.hidden = false;
  const t = localToday(), td = vocab.today?.date === t ? vocab.today : null, day = vocab.days?.[t];
  // 円グラフは選んでいるレベルの単語で数える。レベルのボタンにも各レベルの定着％
  const lv = vocabLevel(), statOf = (x) => { const ids = idsOfLevel(x); return { total: ids.length, learned: ids.filter(id => vocab.words?.[id]).length, mastered: ids.filter(id => (vocab.words?.[id]?.box ?? 0) >= 3).length }; };
  const cur = statOf(lv);
  const levelRow = levelButtons("vocab", lv, [1, 2, 3].map(x => { const st = statOf(x); return st.total ? Math.round(st.mastered / st.total * 100) : 0; }), role === "parent");
  const week = Array.from({ length: 7 }, (_, i) => addDays(t, i - 6));
  const wk = ["日", "月", "火", "水", "木", "金", "土"];
  const weekRow = `<div class="vc-week">${week.map(d => {
    const [y, m, dd] = d.split("-").map(Number);
    return `<span class="vc-day${vocab.days?.[d]?.done ? " done" : ""}${d === t ? " today" : ""}"><small>${wk[new Date(y, m - 1, dd).getDay()]}</small>${vocab.days?.[d]?.done ? ICON_CHECK : "・"}</span>`;
  }).join("")}</div>`;
  // 今日の状態と横ゲージ
  const n = td?.ids.length ?? vocabN();
  let state, prog = 0, gtext;
  if (day?.done) { state = "done"; prog = 100; gtext = "完了"; }
  else if (td?.phase === "review") { state = "review"; prog = 100; gtext = `復習 あと${td.queue.length}`; }
  else if (td && (td.idx > 0 || td.answered)) { const k = td.idx + (td.answered ? 1 : 0); state = "doing"; prog = Math.round(k / n * 100); gtext = `${k}/${n}`; }
  else { state = "todo"; gtext = `0/${n}`; }
  let btn = "";
  if (role === "student") {
    btn = day?.done ? `<button type="button" class="outline vc-btn" data-vocab-open>今日の単語を見直す</button>`
      : `<button type="button" class="primary vc-btn" data-vocab-open>${state === "review" ? "復習を続ける" : state === "doing" ? "続きから" : "はじめる"}</button>`;
  } else if (role === "tutor") btn = `<button type="button" class="outline vc-btn" data-vocab-trial>お試しで解く（記録されません）</button>`;
  card.innerHTML = `
    ${cardHead("今日の英単語", state, prog, gtext)}
    ${levelRow}
    ${btn}
    ${vocabProgressHTML(cur.learned, cur.mastered, cur.total)}
    ${moreDetails("vocab", `${vocabStreak()}日連続・この1週間 ${week.filter(d => vocab.days?.[d]?.done).length}/7日`, `
    <div class="vc-stats two">
      <div><b>${vocabStreak()}</b><span>日連続</span></div>
      <div><b>${week.filter(d => vocab.days?.[d]?.done).length}<small> / 7日</small></b><span>この1週間</span></div>
    </div>
    <p class="vc-label">この1週間</p>
    ${weekRow}`)}`;
}
$("vocab-card")?.addEventListener("click", (e) => {
  if (e.target.closest("[data-vocab-open]")) openVocab();
  const lvb = e.target.closest("[data-vocab-level]");
  if (lvb && role !== "parent") setVocabLevel(Number(lvb.dataset.vocabLevel));
  if (e.target.closest("[data-vocab-trial]")) startVocabTrial();
});
// レベルを変える：今日の分をまだ始めていなければ、新しいレベルで作り直す。先生も生徒のレベルを決められる
async function setVocabLevel(lv) {
  if (!VOCAB_LEVELS.some(L => L.lv === lv) || lv === vocabLevel()) return;
  vocab.level = lv;
  const td = vocab.today;
  if (td && td.date === localToday() && td.phase === "main" && td.idx === 0 && !td.answered) vocab.today = null;
  renderVocabCard();
  if (role === "student") return saveVocab();
  if (role === "tutor") { try { await setDoc(vocabRef(), { level: lv, ...(vocab.today ? {} : { today: null }) }, { merge: true }); } catch {} }
}
function startVocabTrial() {
  if (!vocabTrial) vocabReal = vocab;
  vocabTrial = true;
  const lv = vocabLevel();
  vocab = { level: lv, words: {}, days: {}, today: { date: localToday(), ids: shuffle(idsOfLevel(lv)).slice(0, DAILY_N), idx: 0, results: {}, phase: "main", queue: [], answered: null } };
  vocabChoices = null;
  $("vocab-view").hidden = false;
  document.body.classList.add("exam-open");
  renderVocab();
}

function openVocab() {
  const t = localToday();
  if (vocab.today?.date !== t) {
    vocab.today = { date: t, ids: pickDaily(), idx: 0, results: {}, phase: "main", queue: [], answered: null };
    saveVocab();
  }
  vocabChoices = null;
  $("vocab-view").hidden = false;
  document.body.classList.add("exam-open");
  renderVocab();
}
function closeVocab() {
  stopSpeak();
  setTimeout(() => { renderHomework(); renderCalendarFeed(); }, 0);
  setTimeout(renderCalendars, 0);
  if (vocabTrial) { vocab = vocabReal ?? { words: {}, days: {}, today: null }; vocabTrial = false; }
  $("vocab-view").hidden = true;
  document.body.classList.remove("exam-open");
  renderVocabCard();
}
$("vocab-close").addEventListener("click", closeVocab);

// 例文の中のその単語（活用形も）を目立たせる
// 例文の中のその単語の形（EX の form。なければ活用形を推測）
function formOf(id) {
  if (EX[id]?.form) return EX[id].form;
  const v = VOCAB_BY_ID[id], word = v[0], stem = word.length >= 4 ? word.replace(/(e|y)$/, "") : word;
  return v[3].match(new RegExp(`\\b(${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[a-z]*)`, "i"))?.[1] ?? word;
}
// 例文の form の部分（1か所）を html に置きかえる
function markForm(sentence, form, html) {
  const e = esc(sentence), f = esc(form);
  const re = new RegExp(`(^|[^A-Za-z])(${f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(?=[^A-Za-z]|$)`);
  return re.test(e) ? e.replace(re, (m, a, b) => a + html(b)) : e;
}
function highlightWord(sentence, word) {
  const stem = word.length >= 4 ? word.replace(/(e|y)$/, "") : word;
  const re = new RegExp(`\\b(${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[a-z]*)`, "gi");
  return esc(sentence).replace(re, "<mark>$1</mark>");
}
// 問題文：例文の中のその単語に下線を引く（英検の形）
function underlineWord(sentence, word) {
  const stem = word.length >= 4 ? word.replace(/(e|y)$/, "") : word;
  const re = new RegExp(`\\b(${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[a-z]*)`, "i");
  return esc(sentence).replace(re, `<u class="vq-ul">$1</u>`);
}
// 英語の読み上げ（端末の音声。使えない端末ではボタンを出さない）
const canSpeak = "speechSynthesis" in window;
// 端末にある英語の声のうち、なめらかな声を優先して選ぶ（がさがさした簡易音声を避ける）
let bestVoice = null;
function pickVoice() {
  const vs = speechSynthesis.getVoices().filter(v => /^en[-_]/i.test(v.lang));
  if (!vs.length) return null;
  const score = (v) => {
    const n = v.name;
    let p = 0;
    if (/premium|enhanced|neural|natural/i.test(n)) p += 50;          // 高品質版
    if (/Google US English|Samantha|Ava|Allison|Susan|Zoe|Nicky|Evan|Tom|Karen|Daniel|Serena|Moira/i.test(n)) p += 20;
    if (/en[-_]US/i.test(v.lang)) p += 10;
    if (v.localService) p += 3;
    if (/compact|eloquence|Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Wobble|Whisper|Zarvox|Trinoids|Organ|Junior|Ralph|Fred|Kathy|Jester|Superstar|Grandma|Grandpa|Flo|Reed|Rocko|Sandy|Shelley|Eddy|Good News/i.test(n)) p -= 60;  // 機械的・おもしろ系の声
    if (/[^\x00-\x7F]/.test(n.replace(/\s*\(.*\)$/, ""))) p -= 60;   // 「ささやき声」など日本語名の効果音系の声
    return p;
  };
  return vs.sort((a, b) => score(b) - score(a))[0];
}
if (canSpeak) {
  bestVoice = pickVoice();
  speechSynthesis.addEventListener?.("voiceschanged", () => { bestVoice = pickVoice(); });
}
// 日本語の声（意味の読み上げ用）：高品質で自然な声を優先
let jaVoice = null;
function pickJaVoice() {
  const vs = speechSynthesis.getVoices().filter(v => /^ja[-_]/i.test(v.lang));
  const score = (v) => (/premium|enhanced|neural|natural/i.test(v.name) ? 50 : 0) + (/Kyoko|O-ren|Otoya|Hattori|Google/i.test(v.name) ? 20 : 0) + (v.localService ? 3 : 0);
  return vs.sort((a, b) => score(b) - score(a))[0] ?? null;
}
if (canSpeak) speechSynthesis.addEventListener?.("voiceschanged", () => { jaVoice = pickJaVoice(); });
// 英語と日本語をつづけて読む（[文, "en" | "ja"] の並び）
function speakSeq(parts) {
  if (!canSpeak) return;
  speechSynthesis.cancel();
  bestVoice ??= pickVoice(); jaVoice ??= pickJaVoice();
  for (const [text, lang] of parts) {
    const u = new SpeechSynthesisUtterance(text);
    const vo = lang === "ja" ? jaVoice : bestVoice;
    if (vo) u.voice = vo;
    u.lang = vo?.lang ?? (lang === "ja" ? "ja-JP" : "en-US");
    u.rate = lang === "ja" ? 1 : 0.88;
    speechSynthesis.speak(u);
  }
}
// 自然な声の音声ファイル（tools/make_vocab_audio.py で作成）：単語・例文＝Kokoro（英語）、意味＝VOICEVOX:冥鳴ひまり（日本語）
// ファイルが読めないときだけ端末の読み上げに切り替える
const POS_ABBR = { 動: "v", 名: "n", 形: "a", 副: "r", 熟: "i" };
const audioUrl = (v, k) => `./moshi/audio/${v[0].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${POS_ABBR[v[1]]}-${k}.mp3`;
const AUDIO_BY_TEXT = new Map();
VOCAB.forEach(v => { AUDIO_BY_TEXT.set(v[0], audioUrl(v, "w")); AUDIO_BY_TEXT.set(v[3], audioUrl(v, "s")); });
const player = typeof Audio === "function" ? new Audio() : null;
let playQueue = [], playTimer = null;
function playClips(items) {   // items: [{ url, text, lang }]
  stopSpeak();
  if (!player) return speakSeq(items.map(it => [it.text, it.lang]));
  playQueue = items.slice();
  playNext();
}
function playNext() {
  const it = playQueue.shift();
  if (!it) return;
  const fallback = () => { const rest = [it, ...playQueue]; playQueue = []; speakSeq(rest.map(x => [x.text, x.lang])); };
  player.onended = () => { playTimer = setTimeout(playNext, 250); };
  player.onerror = fallback;
  player.src = it.url;
  player.play()?.catch?.(e => { if (e?.name !== "AbortError") fallback(); });
}
// 解説に入ったら「単語 → 意味 → 例文」を自動で読み上げる（オフにもできる。端末に記憶）
const autoSpeakOn = () => { try { return localStorage.getItem("vocabAutoSpeak") !== "0"; } catch { return true; } };
const jaRead = (m) => String(m).replace(/[（）()～〜]/g, "");
function autoSpeakVocab(v) {
  if (!autoSpeakOn()) return;
  playClips([{ url: audioUrl(v, "w"), text: v[0], lang: "en" }, { url: audioUrl(v, "m"), text: jaRead(v[2]), lang: "ja" }, { url: audioUrl(v, "s"), text: v[3], lang: "en" }]);
}
function stopSpeak() {
  if (canSpeak) speechSynthesis.cancel();
  playQueue = []; clearTimeout(playTimer);
  if (player) { player.onended = player.onerror = null; player.pause(); }
}
function speak(text) {
  const url = AUDIO_BY_TEXT.get(text);
  if (url) return playClips([{ url, text, lang: "en" }]);
  if (!canSpeak) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  bestVoice ??= pickVoice();
  if (bestVoice) u.voice = bestVoice;
  u.lang = bestVoice?.lang ?? "en-US"; u.rate = 0.88; u.pitch = 1;
  speechSynthesis.speak(u);
}
// 絵文字は使わず、線の図形（SVG）で表す
const ICON_SPEAK = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>`;
const ICON_CHECK = `<svg viewBox="0 0 24 24" class="ic-check" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;
const ICON_CROSS = `<svg viewBox="0 0 24 24" class="ic-check" aria-hidden="true"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>`;
const POS_NAME = { 動: "動詞", 名: "名詞", 形: "形容詞", 副: "副詞", 熟: "熟語" };
const speakBtn = (text, label) => canSpeak || AUDIO_BY_TEXT.has(text) ? `<button type="button" class="speak-btn" data-speak="${esc(text)}">${ICON_SPEAK}<span>${label}</span></button>` : "";
// 豆知識は「。」ごとに区切って箇条書きにする
const tipList = (tip) => String(tip).split("。").map(x => x.trim()).filter(Boolean).map(x => `<li>${esc(x)}</li>`).join("");
// 出題の形式：英検の「空所補充」（blank）と「下線の語に近い意味」（syn）。
// 初めては空所補充。そのあとは前回とちがう形式にし、同じ日のまちがい直しでは空所補充を2回出さない（同じ問題にしない）
function vocabFmt(id) {
  if (!EX[id]?.d?.length) return "syn";
  const td = vocab.today, w = vocab.words?.[id];
  if (td?.phase === "review") return (td.blankSeen ?? []).includes(id) ? "syn" : "blank";
  return w?.lastFmt === "blank" ? "syn" : "blank";
}
function makeBlankChoices(id, prevPos) {
  const v = VOCAB_BY_ID[id];
  const list = shuffle([{ t: formOf(id), ja: v[2] }, ...EX[id].d.map(([t, ja]) => ({ t, ja }))]);
  const at = list.findIndex(c => c.t === formOf(id));
  if (prevPos != null && at === prevPos) { const j = (at + 1 + Math.floor(Math.random() * 3)) % 4; [list[at], list[j]] = [list[j], list[at]]; }
  return list;
}
const rightOf = (id, fmt) => fmt === "blank" ? { t: formOf(id), ja: VOCAB_BY_ID[id][2] } : synOf(id);
function vocabQuestionHTML(id, answered) {
  const v = VOCAB_BY_ID[id];
  if (!vocabChoices || vocabChoices.id !== id) {
    const fmt = vocabFmt(id), w = vocab.words?.[id];
    vocabChoices = { id, fmt, list: fmt === "blank" ? makeBlankChoices(id, w?.bpos) : makeChoices(id, w?.prev) };
  }
  const list = vocabChoices.list;
  if (answered) return vocabAnswerHTML(v, answered, answered.list ?? list);
  if (vocabChoices.fmt === "blank") return `<div class="vq">
      <p class="vq-ask">次の英文の（　　）に入れるのに最も適切なものを、1から4の中から一つ選びなさい。</p>
      <div class="vq-sentence"><p class="vq-stem">${markForm(v[3], formOf(id), () => `<span class="vq-blank">(　　　　)</span>`)}</p></div>
      <div class="vq-choices">${list.map((c, i) =>
        `<button type="button" class="vq-choice en" data-vq-pick="${i}"><span class="cnum">${i + 1}</span>${esc(c.t)}</button>`).join("")}</div>
    </div>`;
  return `<div class="vq">
      <p class="vq-ask">次の英文の下線部の語に最も意味が近いものを、1から4の中から一つ選びなさい。</p>
      <div class="vq-sentence"><p class="vq-stem">${markForm(v[3], formOf(id), (b) => `<u class="vq-ul">${b}</u>`)}</p>${speakBtn(v[3], "例文を聞く")}</div>
      <div class="vq-choices">${list.map((c, i) =>
        `<button type="button" class="vq-choice en" data-vq-pick="${i}"><span class="cnum">${i + 1}</span>${esc(c.t)}</button>`).join("")}</div>
    </div>`;
}
// 解答・解説の画面（問題とは別の画面）
// 上から「結果 → 覚える1枚（単語 ≒ 類義語・意味）→ 例文 → 選択肢のふり返り → 覚え方」の順
function vocabAnswerHTML(v, answered, list) {
  const right = rightOf(`${v[0]}:${v[1]}`, answered.fmt ?? "syn");
  const rightNo = list.findIndex(c => c.t === right.t) + 1;
  return `<div class="vq vx-page">
      ${player || canSpeak ? `<button type="button" class="vx-auto${autoSpeakOn() ? " on" : ""}" data-auto-speak aria-pressed="${autoSpeakOn()}">${ICON_SPEAK}<span>自動読み上げ ${autoSpeakOn() ? "オン" : "オフ"}</span></button>` : ""}
      <div class="vx-result ${answered.ok ? "ok" : "ng"}">${answered.ok ? ICON_CIRCLE : ICON_CROSS}<span>${answered.ok ? "正解！" : "不正解"}</span>
        ${answered.ok ? "" : `<small>あなたの答え <s>${esc(answered.pick)}</s>　→　正解は <b>${rightNo} ${esc(right.t)}</b></small>`}</div>
      <div class="vx-card">
        <p class="vx-label">この組み合わせで覚えよう</p>
        <div class="vx-pair">
          <div><p class="vx-w">${esc(v[0])}</p><p class="vx-wj">${esc(v[2])}</p></div>
          <span class="vx-eq">≒</span>
          <div><p class="vx-w syn">${esc(synOf(`${v[0]}:${v[1]}`).t)}</p><p class="vx-wj">${esc(synOf(`${v[0]}:${v[1]}`).ja)}</p></div>
        </div>
        <div class="vx-card-foot"><span class="vx-pos">${esc(POS_NAME[v[1]] ?? v[1])}</span>${speakBtn(v[0], "発音")}</div>
      </div>
      <section class="vx-sec">
        <div class="vx-h"><span>例文</span>${speakBtn(v[3], "例文を聞く")}</div>
        <p class="vq-ex">${markForm(v[3], formOf(`${v[0]}:${v[1]}`), (b) => `<mark>${b}</mark>`)}</p>
        <p class="vq-exj">${esc(v[4])}</p>
      </section>
      <section class="vx-sec plain">
        <div class="vx-h"><span>選択肢をふり返る</span></div>
        <ul class="vx-choices">${list.map((c, i) => {
          const cls = c.t === right.t ? "ok" : c.t === answered.pick ? "ng" : "";
          return `<li class="${cls}"><span class="cnum">${i + 1}</span><b>${esc(c.t)}</b><span class="vx-cj">${esc(c.ja)}</span>${cls === "ok" ? ICON_CHECK : cls === "ng" ? ICON_CROSS : ""}</li>`;
        }).join("")}</ul>
      </section>
      ${v[6] ? `<section class="vx-sec tip"><div class="vx-h"><span>覚え方のポイント</span></div><ul class="vx-tips">${tipList(v[6])}</ul></section>` : ""}
      <p class="vx-credit">音声：Kokoro（英語）／VOICEVOX:冥鳴ひまり（日本語）</p>
    </div>`;
}
// 結果画面の単語リスト（単語 ≒ 類義語・意味）
function vocabWordRows(ids, td) {
  return `<ul class="vx-rows">${ids.map(id => {
    const v = VOCAB_BY_ID[id], ok = td.results[id];
    return `<li class="${ok ? "ok" : "ng"}">${ok ? ICON_CHECK : ICON_CROSS}<span class="vr-w">${esc(v[0])}<small> ≒ ${esc(synOf(id).t)}</small></span><span class="vr-j">${esc(v[2])}</span></li>`;
  }).join("")}</ul>`;
}
// 正解は ○、不正解は ✕ を、線を描くアニメーションで大きく見せる
const ICON_CIRCLE = `<svg viewBox="0 0 24 24" class="ic-check" aria-hidden="true"><circle cx="12" cy="12" r="7.5"/></svg>`;
function showMark(ok, host = "vocab-view") {
  return new Promise(resolve => {
    const el = document.createElement("div");
    el.className = "mark-pop " + (ok ? "ok" : "ng");
    el.innerHTML = ok
      ? `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="36"/></svg><p>正解</p>`
      : `<svg viewBox="0 0 100 100"><path d="M26 26 L74 74"/><path d="M74 26 L26 74" class="second"/></svg><p>不正解</p>`;
    $(host).appendChild(el);
    setTimeout(() => { el.classList.add("out"); }, 750);
    setTimeout(() => { el.remove(); resolve(); }, 1000);
  });
}
function renderVocab() {
  const td = vocab.today;
  if (!td) return;
  $("vocab-title").textContent = vocabTrial ? "【お試し】今日の英単語（記録されません）" : "今日の英単語";
  const n = td.ids.length;
  const body = $("vocab-body");
  if (td.phase === "main" && td.idx < n) {
    const id = td.ids[td.idx];
    $("vocab-progress").textContent = `${td.idx + 1} / ${n}問`;
    const answered = td.answered?.id === id ? td.answered : null;
    body.innerHTML = `<div class="pr-progress"><div style="width:${Math.round(td.idx / n * 100)}%"></div></div>
      ${vocabQuestionHTML(id, answered)}
      ${answered ? `<div class="pr-nav"><button type="button" class="primary big-action" data-vq-next>${td.idx === n - 1 ? "結果を見る" : "次の問題へ →"}</button></div>` : ""}`;
  } else if (td.phase === "main") {
    const wrong = td.ids.filter(id => td.results[id] === false);
    const ok = n - wrong.length;
    $("vocab-progress").textContent = `${ok} / ${n}問 正解`;
    body.innerHTML = `<div class="pr-done">
        <p class="pr-done-title">${wrong.length ? `${n}問おわり！` : "全問正解！"}</p>
        <p class="pr-done-score">${ok}<small> / ${n}問 正解</small></p>
        ${wrong.length ? `<p class="mock-note">まちがえた単語 ${wrong.length}語を、全部正解するまで復習します。</p>
          ${vocabWordRows(wrong, td)}
          <div class="pr-done-actions"><button type="button" class="primary big-action" data-vq-review>復習をはじめる</button></div>`
        : `<div class="pr-done-actions"><button type="button" class="primary big-action" data-vq-finish>完了にする</button></div>`}
      </div>`;
  } else if (td.phase === "review" && td.queue.length) {
    const id = td.queue[0];
    const answered = td.answered?.id === id ? td.answered : null;
    $("vocab-progress").textContent = `復習 のこり${td.queue.length}語`;
    body.innerHTML = `<p class="vq-review-tag">まちがえた単語の復習（全部正解するまで続きます）</p>
      ${vocabQuestionHTML(id, answered)}
      ${answered ? `<div class="pr-nav"><button type="button" class="primary big-action" data-vq-next>${answered.ok && td.queue.length === 1 ? "完了！" : "次へ →"}</button></div>` : ""}`;
  } else {
    const day = vocab.days?.[td.date];
    $("vocab-progress").textContent = "完了";
    body.innerHTML = `<div class="pr-done">
        <p class="pr-done-title">${vocabTrial ? "お試し 完了！" : "今日の英単語 完了！"}</p>
        ${vocabTrial ? "" : `<p class="pr-done-score">${vocabStreak()}<small> 日連続</small></p>`}
        <p class="mock-note">1回目で ${day?.first ?? "-"}/${day?.total ?? n} 問正解。また明日！</p>
        <p class="vx-rows-h">今日の${td.ids.length}語（まちがえた単語は、次は別の選択肢で出ます）</p>
        ${vocabWordRows(td.ids, td)}
        <div class="pr-done-actions">
          ${vocabTrial ? `<button type="button" class="primary" data-vq-trial-again>もう一度（別の${DAILY_N}問）</button>` : ""}
          <button type="button" class="outline" data-vq-close>閉じる</button></div>
      </div>`;
  }
  body.scrollTop = 0;
}
$("vocab-body").addEventListener("click", async (e) => {
  const sp = e.target.closest("[data-speak]");
  if (sp) { speak(sp.dataset.speak); return; }
  const td = vocab.today;
  if (e.target.closest("[data-vq-trial-again]")) return startVocabTrial();
  if (!td || (role !== "student" && !vocabTrial)) { if (e.target.closest("[data-vq-close]")) closeVocab(); return; }
  const pick = e.target.closest("[data-vq-pick]");
  if (pick && !td.answered) {
    const id = td.phase === "main" ? td.ids[td.idx] : td.queue[0];
    const v = VOCAB_BY_ID[id];
    const fmt = vocabChoices.fmt ?? "syn";
    const right = rightOf(id, fmt).t;
    const choice = vocabChoices.list[Number(pick.dataset.vqPick)].t;
    const ok = choice === right;
    td.answered = { id, pick: choice, ok, list: vocabChoices.list, fmt };
    if (fmt === "blank") td.blankSeen = [...new Set([...(td.blankSeen ?? []), id])];
    if (td.phase === "main") {
      td.results[id] = ok;
      // 次に出す日：正解なら間をあけ、まちがえたら翌日
      const w = vocab.words[id] ?? { box: 0, ok: 0, ng: 0 };
      w.box = ok ? Math.min((w.box ?? 0) + 1, BOX_DAYS.length - 1) : 0;
      w.due = addDays(td.date, ok ? BOX_DAYS[w.box] : 1);
      w[ok ? "ok" : "ng"] = (w[ok ? "ok" : "ng"] ?? 0) + 1;
      w.last = td.date;
      vocab.words[id] = w;
    }
    // 今回の選択肢を覚えておき、次に出すとき（復習・後日）は別の選択肢にする
    const ww = vocab.words[id];
    if (ww) {
      ww.lastFmt = fmt;
      if (fmt === "blank") ww.bpos = vocabChoices.list.findIndex(c => c.t === right);
      else ww.prev = { ch: vocabChoices.list.filter(c => c.t !== right).map(c => c.t), pos: vocabChoices.list.findIndex(c => c.t === right) };
    }
    navigator.vibrate?.(ok ? 30 : [60, 40, 60]);
    $("vocab-body").querySelectorAll("[data-vq-pick]").forEach(b => {
      b.disabled = true;
      const c = vocabChoices.list[Number(b.dataset.vqPick)].t;
      if (c === right) b.classList.add("correct"); else if (b === pick) b.classList.add("wrong");
    });
    saveVocab();
    autoSpeakVocab(v);
    await showMark(ok);
    renderVocab();
    return;
  }
  const auto = e.target.closest("[data-auto-speak]");
  if (auto) {
    const on = !autoSpeakOn();
    try { localStorage.setItem("vocabAutoSpeak", on ? "1" : "0"); } catch {}
    auto.classList.toggle("on", on); auto.setAttribute("aria-pressed", on);
    auto.querySelector("span").textContent = `自動読み上げ ${on ? "オン" : "オフ"}`;
    const id = td.answered?.id;
    if (on && id) autoSpeakVocab(VOCAB_BY_ID[id]); else stopSpeak();
    return;
  }
  if (e.target.closest("[data-vq-next]") && td.answered) {
    stopSpeak();
    if (td.phase === "main") td.idx++;
    else {
      // 復習：正解ならその単語は終わり、まちがえたら列の最後へ
      const id = td.queue.shift();
      if (!td.answered.ok) td.queue.push(id);
      if (!td.queue.length) finishVocab();
    }
    td.answered = null; vocabChoices = null;
    renderVocab(); saveVocab();
    return;
  }
  if (e.target.closest("[data-vq-review]")) {
    td.phase = "review";
    td.queue = shuffle(td.ids.filter(id => td.results[id] === false));
    td.answered = null; vocabChoices = null;
    renderVocab(); saveVocab();
    return;
  }
  if (e.target.closest("[data-vq-finish]")) { finishVocab(); renderVocab(); saveVocab(); return; }
  if (e.target.closest("[data-vq-close]")) closeVocab();
});
function finishVocab() {
  const td = vocab.today;
  td.phase = "done";
  const first = td.ids.filter(id => td.results[id]).length;
  vocab.days = { ...(vocab.days ?? {}), [td.date]: { done: true, first, total: td.ids.length, finishedAt: Date.now() } };
}

/* ---------- 今日の数学ⅠA：1日5問 → 1問ずつマーク → 答え合わせ → 解答・解説 → まちがえた問題は数値を変えて全部正解するまで ---------- */
// 問題の型と数値の作り方は moshi/math_daily.js。出題は「型 id ＋ seed（数値の種）」で記録し、同じ seed なら同じ問題になる
const MATH_N = 5;
// 1日の問題数：宿題「毎日の数学ⅠA」の期間中は、その宿題の数（毎日○問）。なければ5問
const mathN = () => {
  const q = typeof hwQuotaToday === "function" ? hwQuotaToday("daily-math") : null;
  return Number.isInteger(q) && q > 0 ? Math.min(q, 30) : MATH_N;
};
// まだ出していない型は、分野が順番にまわるように並べておく
const MATH_IDS = (() => {
  const by = {};
  MATH_TYPES.forEach(x => (by[x.f] ??= []).push(x.id));
  const keys = Object.keys(by), out = [];
  for (let i = 0; out.length < MATH_TYPES.length; i++) keys.forEach(k => { if (by[k][i]) out.push(by[k][i]); });
  return out;
})();
let math = { items: {}, days: {}, today: null, level: 1 };
// レベル（1 基本／2 標準／3 発展）。新しい問題は選んだレベルから、復習は全レベルから出す。
// 生徒が選ぶと記録する。先生・保護者は見るだけ（mathViewLv で表示だけ切りかえる）
const mathLevel = () => ([1, 2, 3].includes(math.level) ? math.level : 1);
let mathViewLv = null;
const mathIdsOf = (lv) => MATH_IDS.filter(id => MATH_BY_ID[id].lv === lv);
let mathMarks = {};                       // いま解いている問題のマーク
let mathTrial = false, mathReal = null;   // 先生のお試し（記録しない）
const mathRef = () => doc(db, "students", currentSid, "math", "state");
// 前に出した問題（sig）と同じにならない seed を選ぶ
function freshSeed(id, avoid = []) {
  let s = 0;
  for (let k = 0; k < 40; k++) {
    s = Math.floor(Math.random() * 2 ** 31);
    if (!avoid.includes(makeProblem(id, s).sig)) return s;
  }
  return s;
}
const mathProb = (e) => makeProblem(e.id, e.seed);
const mathEntry = (td) => (td.phase === "main" ? td.list[td.idx] : td.queue[0]);
// 今日の5問：復習の時期が来た問題（全レベルから最大3つ）→ 選んだレベルのまだ出していない問題。どちらも前回とは別の数値で出す
// 選んだレベルを出しつくしたら、そのレベルの定着していない問題 → ほかのレベルのまだの問題 の順で補う
function pickMathDaily(lv = mathLevel(), n = mathN()) {
  const t = localToday();
  const due = Object.entries(math.items).filter(([id, w]) => MATH_BY_ID[id] && w.due <= t)
    .sort((a, b) => a[1].due.localeCompare(b[1].due) || (a[1].box ?? 0) - (b[1].box ?? 0)).map(([id]) => id);
  const fresh = mathIdsOf(lv).filter(id => !math.items[id]);
  const reviewN = Math.min(due.length, fresh.length ? Math.max(3, Math.round(n * .4)) : n);
  let ids = [...due.slice(0, reviewN), ...fresh.slice(0, n - reviewN)];
  if (ids.length < n) {
    const byBox = (a, b) => (math.items[a].box ?? 0) - (math.items[b].box ?? 0) || (math.items[a].last ?? "").localeCompare(math.items[b].last ?? "");
    const sameLv = mathIdsOf(lv).filter(id => math.items[id] && !ids.includes(id)).sort(byBox);
    const otherFresh = [1, 2, 3].filter(l => l !== lv).sort((a, b) => Math.abs(a - lv) - Math.abs(b - lv) || a - b)
      .flatMap(l => mathIdsOf(l).filter(id => !math.items[id]));
    const rest = Object.keys(math.items).filter(id => MATH_BY_ID[id] && !ids.includes(id)).sort(byBox);
    ids = [...new Set([...ids, ...sameLv, ...otherFresh, ...rest])].slice(0, n);
  }
  return shuffle(ids).map(id => ({ id, seed: freshSeed(id, [math.items[id]?.sig].filter(Boolean)) }));
}
const newMathToday = (list, level = mathLevel()) => ({ date: localToday(), level, list, idx: 0, results: {}, phase: "main", queue: [], answered: null });
const mathUntouched = (td) => td && td.phase === "main" && td.idx === 0 && !td.answered;
async function saveMath() {
  if (role !== "student" || mathTrial) return;
  try { await setDoc(mathRef(), math); } catch {}
}
function mathStreak() {
  let n = 0, d = localToday();
  if (!math.days?.[d]?.done) d = addDays(d, -1);
  while (math.days?.[d]?.done) { n++; d = addDays(d, -1); }
  return n;
}
// 分野ごとの正答率（1回目の答え）。2回以上解いた分野のうち、いちばん低いもの
function mathWeakField() {
  const by = {};
  Object.entries(math.items ?? {}).forEach(([id, w]) => {
    const f = MATH_BY_ID[id]?.f; if (!f) return;
    const b = (by[f] ??= { ok: 0, n: 0 }); b.ok += w.ok ?? 0; b.n += (w.ok ?? 0) + (w.ng ?? 0);
  });
  const list = Object.entries(by).filter(([, b]) => b.n >= 2).map(([f, b]) => ({ f, rate: b.ok / b.n }))
    .sort((a, b) => a.rate - b.rate);
  return list[0] && list[0].rate < .8 ? list[0] : null;
}
// レベルごとの数：出た問題・定着した問題（定着＝間をあけて3回つづけて正解）
function mathLvStats(lv) {
  const ids = mathIdsOf(lv);
  const seen = ids.filter(id => math.items?.[id]).length, mastered = ids.filter(id => (math.items?.[id]?.box ?? 0) >= 3).length;
  return { total: ids.length, seen, mastered, pct: Math.round(mastered / ids.length * 100) };
}
// 習得率の円グラフ（英単語カードと同じ見た目）：定着・学習中・まだ出ていない問題
function mathProgressHTML(lv) {
  const { total, seen, mastered } = mathLvStats(lv), doing = seen - mastered, rest = total - seen;
  const pct = Math.round(mastered / total * 100);
  const C = 2 * Math.PI * 40, seg = (n) => n / total * C;
  const arc = (cls, len, off) => len > 0 ? `<circle class="${cls}" cx="50" cy="50" r="40" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}"/>` : "";
  return `<div class="vc-progress">
      <svg viewBox="0 0 100 100" class="vc-donut" role="img" aria-label="定着 ${pct}%">
        <circle class="bg" cx="50" cy="50" r="40"/>
        ${arc("m", seg(mastered), 0)}${arc("l", seg(doing), seg(mastered))}
        <text x="50" y="45" class="pct">${pct}<tspan class="unit">%</tspan></text>
        <text x="50" y="67" class="cap">定着</text>
      </svg>
      <div class="vc-legend">
        <p><i class="m"></i>定着<b>${mastered}</b>問</p>
        <p><i class="l"></i>学習中<b>${doing}</b>問</p>
        <p><i class="u"></i>未出題<b>${rest}</b>問</p>
        <p class="vc-total">レベル${lv}の${total}問のうち <b>${Math.round(seen / total * 100)}%</b> が出題済み</p>
      </div>
    </div>
`;
}
function renderMathCard() {
  const card = $("math-card");
  if (!card) return;
  if (!currentSid) { card.hidden = true; return; }
  card.hidden = false;
  const t = localToday(), td = math.today?.date === t ? math.today : null, day = math.days?.[t];
  const lv = role === "student" ? mathLevel() : (mathViewLv ?? mathLevel());
  const week = Array.from({ length: 7 }, (_, i) => addDays(t, i - 6));
  const wk = ["日", "月", "火", "水", "木", "金", "土"];
  const weekRow = `<div class="vc-week">${week.map(d => {
    const [y, m, dd] = d.split("-").map(Number);
    return `<span class="vc-day${math.days?.[d]?.done ? " done" : ""}${d === t ? " today" : ""}"><small>${wk[new Date(y, m - 1, dd).getDay()]}</small>${math.days?.[d]?.done ? ICON_CHECK : "・"}</span>`;
  }).join("")}</div>`;
  const n = td && !mathUntouched(td) ? td.list.length : mathN();
  let state, prog = 0, gtext;
  if (day?.done) { state = "done"; prog = 100; gtext = "完了"; }
  else if (td?.phase === "review") { state = "review"; prog = 100; gtext = `復習 あと${td.queue.length}`; }
  else if (td && (td.idx > 0 || td.answered)) { const k = td.idx + (td.answered ? 1 : 0); state = "doing"; prog = Math.round(k / td.list.length * 100); gtext = `${k}/${td.list.length}`; }
  else { state = "todo"; gtext = `0/${n}`; }
  let btn = "";
  if (role === "student") {
    btn = day?.done ? `<button type="button" class="outline vc-btn" data-math-open>今日の問題を見直す</button>`
      : `<button type="button" class="primary vc-btn" data-math-open>${state === "review" ? "復習を続ける" : state === "doing" ? "続きから" : "はじめる"}</button>`;
  } else if (role === "tutor") btn = `<button type="button" class="outline vc-btn" data-math-trial>お試しで解く（記録されません）</button>`;
  const weak = mathWeakField();
  card.innerHTML = `
    ${cardHead("今日の数学ⅠA", state, prog, gtext)}
    ${levelButtons("math", lv, [1, 2, 3].map(l => mathLvStats(l).pct), false)}
    ${btn}
    ${mathProgressHTML(lv)}
    ${moreDetails("math", `${mathStreak()}日連続・この1週間 ${week.filter(d => math.days?.[d]?.done).length}/7日`, `
    <div class="vc-stats two">
      <div><b>${mathStreak()}</b><span>日連続</span></div>
      <div><b>${week.filter(d => math.days?.[d]?.done).length}<small> / 7日</small></b><span>この1週間</span></div>
    </div>
    ${weak ? `<p class="mc-weak">苦手な分野：<b>${esc(MATH_FIELDS[weak.f])}</b>（正答率 ${Math.round(weak.rate * 100)}%）</p>` : ""}
    <p class="vc-label">この1週間</p>
    ${weekRow}`)}`;
}
$("math-card")?.addEventListener("click", (e) => {
  if (e.target.closest("[data-math-open]")) openMath();
  if (e.target.closest("[data-math-trial]")) startMathTrial();
  const lb = e.target.closest("[data-math-level]");
  if (lb) {
    const l = Number(lb.dataset.mathLevel);
    if (role === "student") {
      math.level = l;
      // まだ1問も解いていなければ、今日の問題を新しいレベルで作り直す（開いたときに作る）
      if (math.today?.date === localToday() && mathUntouched(math.today) && math.today.level !== l) math.today = null;
      saveMath();
    } else mathViewLv = l;
    renderMathCard();
  }
});
function startMathTrial() {
  if (!mathTrial) mathReal = math;
  mathTrial = true;
  const lv = mathViewLv ?? mathLevel();
  math = { items: {}, days: {}, level: lv, today: newMathToday(shuffle(mathIdsOf(lv)).slice(0, mathN()).map(id => ({ id, seed: freshSeed(id) })), lv) };
  showMathView();
}
function openMath() {
  const td = math.today;
  if (td?.date !== localToday() || (mathUntouched(td) && ((td.level ?? 1) !== mathLevel() || td.list.length !== mathN()))) { math.today = newMathToday(pickMathDaily()); saveMath(); }
  showMathView();
}
function showMathView() {
  mathMarks = {};
  $("math-view").hidden = false;
  document.body.classList.add("exam-open");
  renderMath();
}
function closeMath() {
  setTimeout(renderCalendars, 0);
  if (mathTrial) { math = mathReal ?? { items: {}, days: {}, today: null, level: 1 }; mathTrial = false; }
  $("math-view").hidden = true;
  document.body.classList.remove("exam-open");
  renderMathCard(); renderTodayCard();
  renderHomework(); renderCalendarFeed();
}
$("math-close").addEventListener("click", closeMath);

// 答えの形：[ア] を枠にする。マークした枠には数字を入れ、まだの枠は記号（ア・イ…）のまま
const MQ_BLANK = /\[([^\]\s]{1,4})\]/g;
function mathFormHTML(p, vals) {
  // 枠の大きさをそろえる：幅は全角1文字分で中身を中央に、高さは「ア」と数字の両方が入る分。中身は \smash で高さを0にして、
  // − のように上下の出っ張りがちがう文字でも枠が伸びないようにする（ア・3・− のどれでも同じ大きさ）
  const box = (x) => `\\boxed{\\vphantom{\\text{ア}0}\\kern0.55em\\mathclap{\\smash{${x}}}\\kern0.55em}`;
  const boxTeX = (l) => { const v = vals?.[l]; return box(v ? (v === "−" ? "{-}" : `\\mathbf{${v}}`) : `\\text{${l}}`); };
  return String(p.form).split("$").map((seg, i) => {
    if (i % 2) return renderTex(seg.replace(MQ_BLANK, (m, l) => (p.labels.includes(l) ? boxTeX(l) : m)));
    // 答えが2つ以上あるときは「、」「。」で行を分け、式の途中で折り返さないようにする
    return esc(seg).replace(/[、。]\s*/g, "<br>").replace(MQ_BLANK, (m, l) => (p.labels.includes(l) ? `<span class="blank">${esc(vals?.[l] || l)}</span>` : m));
  }).join("");
}
const mqHead = (p) => `<div class="mq-head"><span class="mq-field">${esc(p.field)}</span><span class="mq-lv">レベル${p.lv}</span><span class="mq-title">${esc(p.title)}</span></div>`;
function mathMarkRows(p, vals, locked) {
  return p.labels.map(l => `<div class="mark-row">
      <span class="mark-label">${esc(l)}</span>
      <div class="bubbles">${MARK_OPTS.map(o => {
        const cls = ["bubble", vals[l] === o ? "on" : "", locked && p.key[l] === o ? "correct" : "", locked && vals[l] === o && p.key[l] !== o ? "wrong" : ""].filter(Boolean).join(" ");
        return `<button type="button" class="${cls}" ${locked ? "disabled" : ""} data-mq-label="${esc(l)}" data-mq-opt="${esc(o)}" aria-label="${esc(l)} に ${esc(o)}">${esc(o)}</button>`;
      }).join("")}</div>
    </div>`).join("");
}
const mqMissing = (p) => p.labels.filter(l => !mathMarks[l]).length;
const mqCheckLabel = (n) => (n ? `あと${n}か所マークすると答え合わせ` : "答え合わせ");
function mathQuestionHTML(p) {
  const n = mqMissing(p);
  return `<div class="vq mq">
      ${mqHead(p)}
      <div class="mq-text">${richText(p.q)}</div>
      <p class="mq-label">答えの形 <small>（枠ごとにマーク・もう一度押すと取り消し）</small></p>
      <div class="exam-t mq-form" id="mq-form">${mathFormHTML(p, mathMarks)}</div>
      <div class="marks mq-marks">${mathMarkRows(p, mathMarks, false)}</div>
      <button type="button" class="primary big-action mq-check" data-mq-check ${n ? "disabled" : ""}>${mqCheckLabel(n)}</button>
    </div>`;
}
// 解答・解説の画面（問題とは別の画面）：結果 → 正しい答え（とあなたの答え）→ 解き方 → ポイント
function mathAnswerHTML(p, a) {
  const wrong = p.labels.filter(l => a.marks[l] !== p.key[l]);
  return `<div class="vq vx-page mq-ans">
      <div class="vx-result ${a.ok ? "ok" : "ng"}">${a.ok ? ICON_CIRCLE : ICON_CROSS}<span>${a.ok ? "正解！" : "不正解"}</span>
        ${a.ok ? "" : `<small>まちがえた枠：${wrong.map(l => `<span class="mq-miss">${esc(l)}　<s>${esc(a.marks[l] ?? "")}</s> → <b>${esc(p.key[l])}</b></span>`).join("")}</small>`}</div>
      <section class="mq-card">
        ${mqHead(p)}
        <div class="mq-text sm">${richText(p.q)}</div>
        <p class="mq-label ok">正しい答え</p>
        <div class="exam-t mq-form key">${mathFormHTML(p, p.key)}</div>
        ${a.ok ? "" : `<p class="mq-label ng">あなたの答え</p><div class="exam-t mq-form mine">${mathFormHTML(p, a.marks)}</div>`}
      </section>
      <section class="vx-sec">
        <div class="vx-h"><span>解き方（式の流れ）</span></div>
        <ol class="mq-steps">${p.steps.map(s => `<li><div>${richText(s)}</div></li>`).join("")}</ol>
      </section>
      <section class="vx-sec tip"><div class="vx-h"><span>ポイント</span></div><p class="mq-point">${richText(p.point)}</p></section>
    </div>`;
}
// 結果画面の一覧（分野・型）
function mathRows(list, td) {
  return `<ul class="vx-rows">${list.map(e => {
    const p = mathProb(e), ok = td.results[e.id];
    return `<li class="${ok ? "ok" : "ng"}">${ok ? ICON_CHECK : ICON_CROSS}<span class="vr-w mq-rw">${esc(p.title)}</span><span class="vr-j">${esc(p.field)}</span></li>`;
  }).join("")}</ul>`;
}
function renderMath() {
  const td = math.today;
  if (!td) return;
  $("math-title").textContent = mathTrial ? "【お試し】今日の数学ⅠA（記録されません）" : "今日の数学ⅠA";
  const n = td.list.length, body = $("math-body");
  if ((td.phase === "main" && td.idx < n) || (td.phase === "review" && td.queue.length)) {
    const e = mathEntry(td), p = mathProb(e);
    const answered = td.answered && td.answered.id === e.id && td.answered.seed === e.seed ? td.answered : null;
    const main = td.phase === "main";
    $("math-progress").textContent = main ? `${td.idx + 1} / ${n}問` : `復習 のこり${td.queue.length}問`;
    const last = main ? td.idx === n - 1 : answered?.ok && td.queue.length === 1;
    body.innerHTML = `${main ? `<div class="pr-progress"><div style="width:${Math.round(td.idx / n * 100)}%"></div></div>`
        : `<p class="vq-review-tag">まちがえた問題の復習（数値を変えて出します。全部正解するまで続きます）</p>`}
      ${answered ? mathAnswerHTML(p, answered) : mathQuestionHTML(p)}
      ${answered ? `<div class="pr-nav"><button type="button" class="primary big-action" data-mq-next>${main ? (last ? "結果を見る" : "次の問題へ →") : (last ? "完了！" : "次へ →")}</button></div>` : ""}`;
  } else if (td.phase === "main") {
    const wrong = td.list.filter(e => td.results[e.id] === false), ok = n - wrong.length;
    $("math-progress").textContent = `${ok} / ${n}問 正解`;
    body.innerHTML = `<div class="pr-done">
        <p class="pr-done-title">${wrong.length ? `${n}問おわり！` : "全問正解！"}</p>
        <p class="pr-done-score">${ok}<small> / ${n}問 正解</small></p>
        ${mathRows(td.list, td)}
        ${wrong.length ? `<p class="mock-note">まちがえた ${wrong.length}問は、数値を変えた問題で全部正解するまで復習します。</p>
          <div class="pr-done-actions"><button type="button" class="primary big-action" data-mq-review>復習をはじめる</button></div>`
        : `<div class="pr-done-actions"><button type="button" class="primary big-action" data-mq-finish>完了にする</button></div>`}
      </div>`;
  } else {
    const day = math.days?.[td.date];
    $("math-progress").textContent = "完了";
    body.innerHTML = `<div class="pr-done">
        <p class="pr-done-title">${mathTrial ? "お試し 完了！" : "今日の数学ⅠA 完了！"}</p>
        ${mathTrial ? "" : `<p class="pr-done-score">${mathStreak()}<small> 日連続</small></p>`}
        <p class="mock-note">1回目で ${day?.first ?? td.list.filter(e => td.results[e.id]).length}/${day?.total ?? n} 問正解。また明日！</p>
        <p class="vx-rows-h">今日の${n}問（まちがえた問題は、次は別の数値で出ます）</p>
        ${mathRows(td.list, td)}
        <div class="pr-done-actions">
          ${mathTrial ? `<button type="button" class="primary" data-mq-trial-again>もう一度（別の${mathN()}問）</button>` : ""}
          <button type="button" class="outline" data-mq-close>閉じる</button></div>
      </div>`;
  }
  body.scrollTop = 0;
}
$("math-body").addEventListener("click", async (ev) => {
  const td = math.today;
  if (ev.target.closest("[data-mq-trial-again]")) return startMathTrial();
  if (ev.target.closest("[data-mq-close]")) return closeMath();
  if (!td || (role !== "student" && !mathTrial)) return;
  const bt = ev.target.closest("[data-mq-opt]");
  if (bt && !bt.disabled && !td.answered) {
    const { mqLabel: l, mqOpt: o } = bt.dataset;
    mathMarks[l] = mathMarks[l] === o ? "" : o;   // もう一度押すと取り消し
    bt.parentElement.querySelectorAll(".bubble").forEach(x => x.classList.toggle("on", x.dataset.mqOpt === mathMarks[l]));
    const p = mathProb(mathEntry(td));
    $("mq-form").innerHTML = mathFormHTML(p, mathMarks);
    const n = mqMissing(p), ck = $("math-body").querySelector("[data-mq-check]");
    ck.disabled = !!n; ck.textContent = mqCheckLabel(n);
    return;
  }
  if (ev.target.closest("[data-mq-check]") && !td.answered) {
    const e = mathEntry(td), p = mathProb(e);
    if (mqMissing(p)) return;
    const marks = Object.fromEntries(p.labels.map(l => [l, mathMarks[l]]));
    const ok = p.labels.every(l => marks[l] === p.key[l]);
    td.answered = { id: e.id, seed: e.seed, marks, ok };
    const w = math.items[e.id] ?? { box: 0, ok: 0, ng: 0 };
    if (td.phase === "main") {
      td.results[e.id] = ok;
      // 次に出す日：正解なら間をあけ、まちがえたら翌日（1→2→4→7→15→30日）
      w.box = ok ? Math.min((w.box ?? 0) + 1, BOX_DAYS.length - 1) : 0;
      w.due = addDays(td.date, ok ? BOX_DAYS[w.box] : 1);
      w[ok ? "ok" : "ng"] = (w[ok ? "ok" : "ng"] ?? 0) + 1;
      w.last = td.date;
    }
    w.sig = p.sig;   // 次に出すときは、これと違う数値にする
    math.items[e.id] = w;
    navigator.vibrate?.(ok ? 30 : [60, 40, 60]);
    $("math-body").querySelectorAll("[data-mq-opt]").forEach(b => {
      b.disabled = true;
      const { mqLabel: l, mqOpt: o } = b.dataset;
      if (p.key[l] === o) b.classList.add("correct"); else if (marks[l] === o) b.classList.add("wrong");
    });
    ev.target.closest("[data-mq-check]").disabled = true;
    saveMath();
    await showMark(ok, "math-view");
    renderMath();
    return;
  }
  if (ev.target.closest("[data-mq-next]") && td.answered) {
    if (td.phase === "main") td.idx++;
    else {
      // 復習：正解ならその問題は終わり。まちがえたら数値を変えて列の最後へ
      const e = td.queue.shift();
      if (!td.answered.ok) td.queue.push({ id: e.id, seed: freshSeed(e.id, [mathProb(e).sig]) });
      if (!td.queue.length) finishMath();
    }
    td.answered = null; mathMarks = {};
    renderMath(); saveMath();
    return;
  }
  if (ev.target.closest("[data-mq-review]")) {
    td.phase = "review";
    // その日に出した問題とは別の数値で出す
    td.queue = shuffle(td.list.filter(e => td.results[e.id] === false)).map(e => ({ id: e.id, seed: freshSeed(e.id, [mathProb(e).sig]) }));
    td.answered = null; mathMarks = {};
    renderMath(); saveMath();
    return;
  }
  if (ev.target.closest("[data-mq-finish]")) { finishMath(); renderMath(); saveMath(); }
});
function finishMath() {
  const td = math.today;
  td.phase = "done";
  const first = td.list.filter(e => td.results[e.id]).length;
  math.days = { ...(math.days ?? {}), [td.date]: { done: true, first, total: td.list.length, finishedAt: Date.now() } };
}

/* ---------- 成績（外部の模試・テスト） ---------- */
const JUDGMENT_RANKS = ["A", "B", "C", "D", "E"];
// 採点済みの模試（このアプリの実力テスト）を、成績の行として加える（保存はしない・表示だけ）
// 今回の実力テスト（数学第1〜3部・英語）は、成績では「1回の模試」として数える
const MOCK_SERIES = { math1: "jitsu1", math2: "jitsu1", math3: "jitsu1", eng: "jitsu1" };
const MOCK_SERIES_NAME = { jitsu1: "ノビノート実力テスト" };
function mockTestRows() {
  const isoOf = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  return mocks.filter(m => m.status === "graded").map(m => {
    const def = mockDef(m.mockId);
    if (!def) return null;
    const st = mockStats(def, m.scores);
    const series = MOCK_SERIES[def.id] ?? def.id;
    return { id: "mock-" + m.id, mockRow: true, series, examName: MOCK_SERIES_NAME[series] ?? def.title, partName: def.title,
      date: isoOf(m.submittedAt ?? m.gradedAt ?? Date.now()),
      subject: def.subject === "english" ? "english" : "math", score: st.got, max: st.max || def.total };
  }).filter(Boolean);
}
// グラフ用：同じ回の模試は教科ごとに合計して1点にする
function chartRows(rows) {
  const out = [], agg = {};
  rows.forEach(r => {
    if (!r.mockRow) { out.push(r); return; }
    const k = r.series + "|" + r.subject;
    if (!agg[k]) { agg[k] = { ...r, score: 0, max: 0 }; out.push(agg[k]); }
    agg[k].score += r.score; agg[k].max += r.max;
    if (r.date > agg[k].date) agg[k].date = r.date;
  });
  return out.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
}
function renderTests() {
  const byExam = {};
  const allTests = [...tests, ...mockTestRows()].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  allTests.forEach(t => {
    const key = t.mockRow ? "mock:" + t.series : (t.examName || "模試");
    const ex = (byExam[key] ??= { date: t.date, name: t.examName || "模試", mock: !!t.mockRow, rows: [] });
    ex.rows.push(t);
    if (t.date > ex.date) ex.date = t.date;
  });
  const exams = Object.entries(byExam).sort((a, b) => b[1].date.localeCompare(a[1].date));
  const canEdit = role === "student";
  $("test-list").innerHTML = exams.length ? exams.map(([key, ex]) => {
    const name = ex.name;
    if (ex.mock) {
      const got = ex.rows.reduce((s, r) => s + r.score, 0), max = ex.rows.reduce((s, r) => s + r.max, 0);
      const parts = Object.entries(MOCK_SERIES).filter(([, v]) => v === ex.rows[0].series).length || ex.rows.length;
      const order = (r) => MOCKS.findIndex(m => m.title === r.partName);
      const rows = [...ex.rows].sort((a, b) => order(a) - order(b));
      return `<article class="item">
        <div class="meta"><span class="date">${fmtDate(ex.date)}</span><span class="label">${esc(name)}</span></div>
        <p class="score">${got}<small> / ${max}（${pct(got, max)}%）合計</small></p>
        ${ex.rows.length < parts ? `<p class="hint left">採点済み ${ex.rows.length} / ${parts}</p>` : ""}
        <div class="test-rows">
          ${rows.map(r => `<div class="test-row">
            ${subjectChip(r.subject)}
            <span class="score">${r.partName.replace(/^.*実力テスト\s*/, "") ? `<small>${esc(r.partName.replace(/^.*実力テスト\s*/, ""))}</small> ` : ""}${r.score}<small> / ${r.max}（${pct(r.score, r.max)}%）</small></span>
            <button type="button" class="small outline" data-go-mock-result="${esc(r.id.slice(5))}">成績表</button>
          </div>`).join("")}
        </div>
      </article>`;
    }
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
  }).join("") : `<div class="empty">まだ成績がありません。</div>`;
  drawChart(chartRows(allTests));
}
$("test-list").addEventListener("click", async (e) => {
  const gm = e.target.closest("[data-go-mock-result]");
  if (gm) { openResult(gm.dataset.goMockResult); return; }
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
  $("chart-legend").innerHTML = "";
  if (rows.length < 2) { $("chart").innerHTML = `<p class="hint">2件以上登録すると推移グラフが表示されます。</p>`; return; }
  // スマホの幅（約340px）で、文字が実寸で12px以上になる大きさで描く
  const W = 340, H = 220, P = 30, PT = 12;
  const bySubject = {};
  rows.forEach(r => (bySubject[r.subject] ??= []).push(r));
  const xs = (i, n) => P + (W - P - 12) * (n === 1 ? .5 : i / (n - 1));
  const ys = (p) => H - 24 - (H - 24 - PT) * (p / 100);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="得点率の推移">`;
  [0, 50, 100].forEach(p => {
    svg += `<line x1="${P}" y1="${ys(p)}" x2="${W - 8}" y2="${ys(p)}" style="stroke:var(--line)"/>`
        +  `<text x="${P - 5}" y="${ys(p) + 4}" font-size="12" style="fill:var(--muted)" text-anchor="end">${p}</text>`;
  });
  Object.entries(bySubject).forEach(([subject, list]) => {
    const c = subjectColor(subject).line;
    const pts = list.map((r, i) => [xs(i, list.length), ys(r.score / r.max * 100)]);
    svg += `<polyline fill="none" stroke="${c}" stroke-width="3" stroke-linejoin="round" points="${pts.map(p => p.join(",")).join(" ")}"/>`;
    pts.forEach(([x, y]) => svg += `<circle cx="${x}" cy="${y}" r="5" fill="#fff" stroke="${c}" stroke-width="3"/>`);
  });
  $("chart").innerHTML = svg + `</svg>`;
  $("chart-legend").innerHTML = Object.keys(bySubject).map(sub =>
    `<span><i style="background:${subjectColor(sub).line}"></i>${esc(subjectLabel(sub))}</span>`).join("");
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
let messages = [];
let replyTo = null;
function renderMessages(rows) {
  messages = rows;
  const byId = Object.fromEntries(rows.map(r => [r.id, r]));
  const byDate = {};
  rows.forEach(r => {
    const d = r.createdAt?.toDate ? r.createdAt.toDate() : new Date();
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    (byDate[iso] ??= []).push(r);
  });
  const dates = Object.keys(byDate).sort();
  $("msg-list").innerHTML = dates.length ? dates.map(iso => `
    <div class="feed-date-group">
      <h4 class="feed-date-heading">${fmtDateLong(iso)}</h4>
      ${byDate[iso].map(r => {
        const readBy = r.readBy ?? {};
        const readers = ["tutor", "student", "parent"]
          .filter(k => k !== r.authorRole && readBy[k])
          .map(k => ROLE_LABEL[k]);
        const readLine = readers.length ? `既読：${readers.join("・")}` : "未読";
        const time = r.createdAt?.toDate ? r.createdAt.toDate().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" }) : "";
        const quoted = r.replyTo && byId[r.replyTo];
        return `
        <article class="item ${r.authorRole === role ? "me" : ""}">
          <div class="meta">
            <span class="date">${esc(ROLE_LABEL[r.authorRole] ?? r.authorRole)}</span>
            <span>${time}</span>
          </div>
          ${quoted ? `<div class="reply-quote"><span class="label">${esc(ROLE_LABEL[quoted.authorRole])}への返信</span><p>${esc(quoted.text ?? "")}</p></div>` : ""}
          <p>${esc(r.text)}</p>
          ${(r.photos ?? (r.photo ? [r.photo] : [])).length ? `<div class="hw-photo-grid">${(r.photos ?? [r.photo]).map(src => `<img class="hw-photo" src="${src}" alt="添付写真">`).join("")}</div>` : ""}
          <div class="actions">
            <button class="small outline" data-msg-reply="${esc(r.id)}">返信する</button>
            ${r.authorRole === role ? `<button class="small outline" data-msg-edit="${esc(r.id)}">編集</button>
            <button class="small outline danger" data-msg-del="${esc(r.id)}">送信取り消し</button>` : ""}
          </div>
          ${r.authorRole === role ? `<p class="hint left msg-read">${readLine}</p>` : ""}
        </article>`;
      }).join("")}
    </div>`).join("") : `<div class="empty">まだメッセージはありません。</div>`;
  $("msg-list").lastElementChild?.scrollIntoView({ block: "nearest" });
  // 連絡タブを見ているときだけ既読にし、見ていないときはタブに未読の数を出す
  if (!$("tab-messages").hidden) markMessagesRead(rows);
  updateMsgBadge();
}
$("msg-list").addEventListener("click", async (e) => {
  const d = e.target.closest("[data-msg-del]");
  const r = e.target.closest("[data-msg-reply]");
  const ed = e.target.closest("[data-msg-edit]");
  if (d && confirm("このメッセージを削除しますか？")) {
    await deleteDoc(doc(db, "students", currentSid, "messages", d.dataset.msgDel));
  } else if (ed) {
    const target = messages.find(m => m.id === ed.dataset.msgEdit);
    if (!target) return;
    const val = prompt("メッセージを編集", target.text ?? "");
    if (val !== null && val.trim()) await updateDoc(doc(db, "students", currentSid, "messages", target.id), { text: val.trim(), editedAt: serverTimestamp() });
  } else if (r) {
    const target = messages.find(m => m.id === r.dataset.msgReply);
    if (!target) return;
    replyTo = target.id;
    $("m-reply-text").textContent = `${ROLE_LABEL[target.authorRole]}「${target.text}」への返信`;
    $("m-reply-preview").hidden = false;
    $("m-text").focus();
  }
});
$("m-reply-cancel").addEventListener("click", () => {
  replyTo = null;
  $("m-reply-preview").hidden = true;
});
document.querySelectorAll(".quick-reply-btn").forEach(btn => {
  btn.addEventListener("click", async () => {
    const data = { text: btn.dataset.quick, authorRole: role, createdAt: serverTimestamp(), readBy: { [role]: true } };
    if (replyTo) data.replyTo = replyTo;
    await addDoc(collection(db, "students", currentSid, "messages"), data);
    replyTo = null;
    $("m-reply-preview").hidden = true;
  });
});
function updateMsgBadge() {
  const n = messages.filter(m => m.authorRole !== role && !m.readBy?.[role]).length;
  const b = $("msg-badge");
  if (!b) return;
  b.hidden = !n || !$("tab-messages").hidden;
  b.textContent = n > 9 ? "9+" : String(n);
}
function markMessagesRead(rows) {
  if (!role) return;
  rows.filter(r => r.authorRole !== role && !(r.readBy ?? {})[role]).forEach(r => {
    r.readBy = { ...(r.readBy ?? {}), [role]: true };   // 画面の未読の数はすぐに消す
    updateDoc(doc(db, "students", currentSid, "messages", r.id), { [`readBy.${role}`]: true }).catch(() => {});
  });
  updateMsgBadge();
}
$("msg-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const files = [...$("m-photo").files];
  const photos = (await Promise.all(files.map(f => fileToDataUrl(f).catch(() => "")))).filter(Boolean);
  const data = {
    text: $("m-text").value.trim(), authorRole: role, createdAt: serverTimestamp(),
    readBy: { [role]: true }
  };
  if (photos.length) data.photos = photos;
  if (replyTo) data.replyTo = replyTo;
  await addDoc(collection(db, "students", currentSid, "messages"), data);
  e.target.reset();
  replyTo = null;
  $("m-reply-preview").hidden = true;
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
        <button class="small save-btn" data-save="${esc(s.id)}">保存</button>
        <button class="small outline danger" data-remove="${esc(s.id)}">この生徒を削除</button>
      </div>
    </article>`).join("") : `<div class="empty">生徒がまだ登録されていません。</div>`;
}
$("student-admin").addEventListener("input", (e) => {
  const btn = e.target.closest("article")?.querySelector("[data-save]");
  if (btn) btn.classList.add("dirty");
});
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
$("sc-date").value = today();

/* ---------- PWA / 通知 ---------- */
const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);
if (isIOS && !standalone) $("install-hint").hidden = false;

if ("serviceWorker" in navigator) {
  // clients.claim()は初回読み込み時にも発火しうるため、「既にこのタブがSWに制御されていた状態から
  // 切り替わった」場合（＝本当のバージョン更新）だけリロードする。
  // さらにsessionStorageで1タブにつき1回しかリロードしないように制限し、
  // 万一controllerchangeが繰り返し発火してもリロードが連鎖しないようにする。
  const hadController = !!navigator.serviceWorker.controller;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
    navigator.serviceWorker.register("./firebase-messaging-sw.js").catch(() => {});
  });
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController) return; // 初回制御開始（初訪問・初回インストール）ではリロードしない
    let alreadyReloaded = false;
    try { alreadyReloaded = sessionStorage.getItem("tnote.swReloaded") === "1"; } catch {}
    if (alreadyReloaded) return;
    try { sessionStorage.setItem("tnote.swReloaded", "1"); } catch {}
    location.reload();
  });
}
const NOTIF_DISMISS_KEY = "tnote.notifDismissed";
function updateNotifBar() {
  const bar = $("notif-bar");
  const settingsBtn = $("settings-notif");
  if (settingsBtn) settingsBtn.hidden = !("Notification" in window) || Notification.permission === "granted";
  if (!("Notification" in window) || !role) { bar.hidden = true; return; }
  if (Notification.permission === "granted" || store.get(NOTIF_DISMISS_KEY) === "1") { bar.hidden = true; return; }
  if (isIOS && !standalone) {
    $("notif-text").textContent = "通知を使うには、共有ボタンから「ホーム画面に追加」してこのアプリを開いてください。";
    $("notif-enable").hidden = true;
  } else {
    $("notif-text").textContent = "新しい宿題や連絡を通知で受け取れます。";
    $("notif-enable").hidden = false;
  }
  bar.hidden = false;
}
$("notif-dismiss")?.addEventListener("click", () => { store.set(NOTIF_DISMISS_KEY, "1"); $("notif-bar").hidden = true; });
$("settings-notif")?.addEventListener("click", () => { store.del(NOTIF_DISMISS_KEY); $("notif-enable").click(); });
$("logout-settings")?.addEventListener("click", () => { if (confirm("ログアウトしますか？")) $("logout").click(); });
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

/* ---------- 保存/追加ボタン：変更が入るまでグレー、変更後は青 ---------- */
wireDirtySave("hw-form", "h-save-btn");
wireDirtySave("schedule-form", "sc-save-btn");
wireDirtySave("lesson-form", "l-save-btn");
wireDirtySave("mock-form", "mk-save-btn");
wireDirtySave("test-form", "t-save-btn");
wireDirtySave("tuition-form", "tu-save-btn");
wireDirtySave("plan-form", "pl-save-btn");
wireDirtySave("msg-form", "m-save-btn");
wireDirtySave("add-student-form", "s-save-btn");
wireDirtySave("tutor-pass-form", "tp-save-btn");
