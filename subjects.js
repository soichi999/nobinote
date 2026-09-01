// 科目マスタ：グループごとに色相(hue)を固定し、抽象度(level)が上がるほど
// 表示を淡く・明るくすることで「同じ教科は同系色、細かい科目ほど淡い色」を実現する。
// select要素は開くと全項目（大項目＋詳細）が見える仕組みなので、
// 詳細科目は大項目の下にインデントして格納し、プルダウンを開いたときだけ見える形にしている。

export const SUBJECT_GROUPS = [
  { id: "math",          label: "数学",   hue: 221 }, // 青
  { id: "english",       label: "英語",   hue: 152 }, // 緑
  { id: "japanese",      label: "国語",   hue: 350 }, // 紅
  { id: "science",       label: "理科",   hue: 271 }, // 紫
  { id: "science_basic", label: "理科基礎", hue: 255 }, // 藍
  { id: "info",          label: "情報",   hue: 190 }, // 青緑
  { id: "essay",         label: "小論文", hue: 10  }, // 臙脂
  { id: "social",        label: "社会",   hue: 30  }, // 橙
];

export const SUBJECTS = [
  // 数学（１２３ＡＢＣ）
  { id: "math",  group: "math", label: "数学",  level: 0 },
  { id: "math1", group: "math", label: "数学Ⅰ", level: 1 },
  { id: "math2", group: "math", label: "数学Ⅱ", level: 1 },
  { id: "math3", group: "math", label: "数学Ⅲ", level: 1 },
  { id: "mathA", group: "math", label: "数学A", level: 1 },
  { id: "mathB", group: "math", label: "数学B", level: 1 },
  { id: "mathC", group: "math", label: "数学C", level: 1 },
  // 英語（RLSW）
  { id: "english",       group: "english", label: "英語",     level: 0 },
  { id: "eng_reading",   group: "english", label: "リーディング", level: 1 },
  { id: "eng_listening", group: "english", label: "リスニング", level: 1 },
  { id: "eng_speaking",  group: "english", label: "スピーキング", level: 1 },
  { id: "eng_writing",   group: "english", label: "ライティング", level: 1 },
  // 国語（現代文・古文・漢文）
  { id: "japanese",  group: "japanese", label: "国語",   level: 0 },
  { id: "gendaibun", group: "japanese", label: "現代文", level: 1 },
  { id: "kobun",     group: "japanese", label: "古文",   level: 1 },
  { id: "kanbun",    group: "japanese", label: "漢文",   level: 1 },
  // 理科（物理・化学・生物・地学）
  { id: "science",   group: "science", label: "理科", level: 0 },
  { id: "physics",   group: "science", label: "物理", level: 1 },
  { id: "chemistry", group: "science", label: "化学", level: 1 },
  { id: "biology",   group: "science", label: "生物", level: 1 },
  { id: "earth",     group: "science", label: "地学", level: 1 },
  // 理科基礎（物理基礎・化学基礎・生物基礎・地学基礎）
  { id: "science_basic",   group: "science_basic", label: "理科基礎",   level: 0 },
  { id: "physics_basic",   group: "science_basic", label: "物理基礎",   level: 1 },
  { id: "chemistry_basic", group: "science_basic", label: "化学基礎",   level: 1 },
  { id: "biology_basic",   group: "science_basic", label: "生物基礎",   level: 1 },
  { id: "earth_basic",     group: "science_basic", label: "地学基礎",   level: 1 },
  // 情報
  { id: "info", group: "info", label: "情報", level: 0 },
  // 小論文
  { id: "essay", group: "essay", label: "小論文", level: 0 },
  // 社会（日本史・世界史・地理・公民・歴史総合・地理総合）
  { id: "social",               group: "social", label: "社会",     level: 0 },
  { id: "japan_history",        group: "social", label: "日本史",   level: 1 },
  { id: "world_history",        group: "social", label: "世界史",   level: 1 },
  { id: "geography",            group: "social", label: "地理",     level: 1 },
  { id: "civics",               group: "social", label: "公民",     level: 1 },
  { id: "integrated_history",   group: "social", label: "歴史総合", level: 1 },
  { id: "integrated_geography", group: "social", label: "地理総合", level: 1 },
];

const byId = new Map(SUBJECTS.map(s => [s.id, s]));
const groupById = new Map(SUBJECT_GROUPS.map(g => [g.id, g]));

export function subjectLabel(id) { return byId.get(id)?.label ?? id ?? ""; }

export function subjectColor(id) {
  const s = byId.get(id);
  const hue = s ? groupById.get(s.group).hue : 210;
  const level = s?.level ?? 0;
  return {
    dot: `hsl(${hue} 62% ${44 - level * 9}%)`,
    fg: `hsl(${hue} 55% 30%)`,
    bg: `hsl(${hue} 70% 95%)`,
    border: `hsl(${hue} 55% 84%)`,
    line: `hsl(${hue} 62% 46%)`
  };
}

export function subjectOptionsHTML(selected = "") {
  return SUBJECT_GROUPS.map(g => {
    const opts = SUBJECTS.filter(s => s.group === g.id).map(s =>
      `<option value="${s.id}" ${s.id === selected ? "selected" : ""}>${"　".repeat(s.level)}${s.label}</option>`
    ).join("");
    return `<optgroup label="${g.label}">${opts}</optgroup>`;
  }).join("");
}
