// 今日の数学ⅠA：共通テスト形式（ア・イ…の枠に数字や符号をマーク）の短い問題。
// 問題文・解説はすべてこのアプリ用に自作（市販・過去問の文章は入れていない）。
// 各問題は「型」で、数値は seed（種）から決まる。まちがえた問題は別の seed で出すので、同じ問題にはならない。
//
// gen(t, F, P) が返すもの：
//   q：問題文（$…$ は数式）  form：答えの形（[ア] がマーク欄）  steps：解き方（式の流れ）  point：ポイント
//   F は答えの枠を作る（F.n(数) で1けたずつ枠を作り、負の数は先頭の枠が「−」）。P は同じ形を枠なしで書く（解説用）

export const MATH_FIELDS = {
  num: "数と式", quad: "2次関数", trig: "図形と計量", data: "データの分析",
  prob: "場合の数と確率", geo: "図形の性質", int: "整数",
};
export const MARK_OPTS = ["−", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
// 選択肢の番号（⓪①②…）。選ぶ問題の枠は "0"〜 の値で記録し、画面ではこの字で見せる
export const CIRC = [..."⓪①②③④⑤⑥⑦⑧⑨"];
const LBL = [..."アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモ"];

/* ---------- 道具 ---------- */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a; };
const fact = (n) => (n <= 1 ? 1 : n * fact(n - 1));
const comb = (n, k) => (k < 0 || k > n ? 0 : fact(n) / (fact(k) * fact(n - k)));
// n = k²·m（m はそれ以上平方因数をもたない）
function sqf(n) { let k = 1, m = n; for (let p = 2; p * p <= m; p++) while (m % (p * p) === 0) { m /= p * p; k *= p; } return [k, m]; }
class Retry extends Error {}
const need = (c) => { if (!c) throw new Retry(); };

// 答えの枠。plain=true なら枠を作らずに数字をそのまま書く（解説用）
class Form {
  constructor(plain) { this.plain = plain; this.k = 0; this.ans = {}; }
  box(ch) { if (this.plain) return ch === "−" ? "-" : ch; const l = LBL[this.k++]; this.ans[l] = ch; return `[${l}]`; }
  n(v) { return (v < 0 ? this.box("−") : "") + [...String(Math.abs(v))].map(c => this.box(c)).join(""); }
  // 既約分数（符号は分子の先頭）
  fr(p, q) {
    if (q < 0) { p = -p; q = -q; }
    const g = gcd(p, q) || 1; p /= g; q /= g;
    return q === 1 ? this.n(p) : `\\dfrac{${this.n(p)}}{${this.n(q)}}`;
  }
  // a√b / c（根号の中はできるだけ小さく、約分もする）
  rad(a, b, c = 1) {
    const [k, m] = sqf(b); a *= k;
    if (m === 1) return this.fr(a, c);
    const g = gcd(a, c); a /= g; c /= g;
    const num = (a < 0 ? this.box("−") : "") + (Math.abs(a) === 1 ? "" : this.n(Math.abs(a))) + `\\sqrt{${this.n(m)}}`;
    return c === 1 ? num : `\\dfrac{${num}}{${this.n(c)}}`;
  }
  // 比 p:q（最も簡単な整数の比）
  ratio(p, q) { const g = gcd(p, q); return `${this.n(p / g)}:${this.n(q / g)}`; }
  // 選ぶ問題の枠：⓪〜 の n 個から i 番を選ぶ
  ch(i, n) {
    if (this.plain) return CIRC[i];
    const l = LBL[this.k++];
    this.ans[l] = String(i);
    (this.opts ??= {})[l] = Array.from({ length: n }, (_, j) => String(j));
    return `[${l}]`;
  }
}

// 図（SVG）を作る道具。色は style.css の .mfig で決める（線＝navy、強調＝数学の色、補助線＝muted）
const f1 = (n) => Math.round(n * 10) / 10;
const sv = {
  svg: (w, h, body, label = "図") => `<svg viewBox="0 0 ${w} ${h}" class="mfig" role="img" aria-label="${label}">${body}</svg>`,
  line: (x1, y1, x2, y2, c = "") => `<line x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(x2)}" y2="${f1(y2)}" class="${c}"/>`,
  poly: (pts, c = "", closed = false) => `<${closed ? "polygon" : "polyline"} points="${pts.map(([x, y]) => `${f1(x)},${f1(y)}`).join(" ")}" class="${c}"/>`,
  circ: (x, y, r, c = "") => `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(r)}" class="${c}"/>`,
  rect: (x, y, w, h, c = "") => `<rect x="${f1(x)}" y="${f1(y)}" width="${f1(w)}" height="${f1(h)}" class="${c}"/>`,
  text: (x, y, s, c = "", a = "middle") => `<text x="${f1(x)}" y="${f1(y)}" text-anchor="${a}" class="${c}">${s}</text>`,
  // 角の印（中心 cx,cy、半径 r、角度は数学の向き＝反時計回り・度）
  arc: (cx, cy, r, a1, a2, c = "ang") => {
    const P = (a) => [cx + r * Math.cos(a * Math.PI / 180), cy - r * Math.sin(a * Math.PI / 180)];
    const [x1, y1] = P(a1), [x2, y2] = P(a2);
    return `<path d="M${f1(x1)},${f1(y1)} A${r},${r} 0 ${a2 - a1 > 180 ? 1 : 0} 0 ${f1(x2)},${f1(y2)}" class="${c}"/>`;
  },
};
// 箱ひげ図：five＝[最小, Q1, 中央値, Q3, 最大]、目盛りは lo〜hi を step ごと
function boxSVG(five, lo, hi, step, { w = 320, h = 96, grid = true, label = "箱ひげ図" } = {}) {
  const X = (v) => 16 + (v - lo) / (hi - lo) * (w - 32);
  const y0 = 10, y1 = h - 40, my = (y0 + y1) / 2, ay = h - 24;
  let b = "";
  if (grid) for (let v = lo; v <= hi; v += step / 2) b += sv.line(X(v), y0 - 4, X(v), ay, "grid");
  b += sv.line(X(lo), ay, X(hi), ay, "ax");
  for (let v = lo; v <= hi; v += step) b += sv.line(X(v), ay, X(v), ay + 4, "ax") + sv.text(X(v), ay + 16, v, "sm");
  const [mn, q1, q2, q3, mx] = five;
  b += sv.line(X(mn), my, X(q1), my) + sv.line(X(q3), my, X(mx), my);
  b += sv.line(X(mn), y0 + 8, X(mn), y1 - 8) + sv.line(X(mx), y0 + 8, X(mx), y1 - 8);
  b += sv.rect(X(q1), y0, X(q3) - X(q1), y1 - y0, "box") + sv.line(X(q2), y0, X(q2), y1, "hi");
  return sv.svg(w, h, b, label);
}
// 座標平面の放物線 y=a(x-p)^2+q。unit＝1目盛りの大きさ、R＝見せる範囲（−R〜R）
function parabolaSVG(a, p, q, { unit = 22, R = 4.5, grid = false, vertex = false, label = "グラフ" } = {}) {
  const W = 2 * R * unit + 16, c = W / 2, X = (x) => c + x * unit, Y = (y) => c - y * unit;
  let b = "";
  if (grid) for (let k = -Math.floor(R); k <= Math.floor(R); k++) b += sv.line(X(k), Y(R), X(k), Y(-R), "grid") + sv.line(X(-R), Y(k), X(R), Y(k), "grid");
  b += sv.line(X(-R), Y(0), X(R), Y(0), "ax") + sv.line(X(0), Y(R), X(0), Y(-R), "ax");
  b += sv.text(X(R) - 2, Y(0) - 5, "x", "sm", "end") + sv.text(X(0) + 6, Y(R) + 10, "y", "sm", "start") + sv.text(X(0) - 4, Y(0) + 12, "O", "sm", "end");
  let seg = [];
  for (let x = -R; x <= R + 1e-9; x += 0.05) {
    const y = a * (x - p) ** 2 + q;
    if (Math.abs(y) <= R) seg.push([X(x), Y(y)]);
    else { if (seg.length > 1) b += sv.poly(seg, "hi"); seg = []; }
  }
  if (seg.length > 1) b += sv.poly(seg, "hi");
  if (vertex) b += sv.circ(X(p), Y(q), 3, "dot");
  return sv.svg(W, W, b, label);
}
// 会話：[["太郎", "…"], ["花子", "…"]]
const talk = (...lines) => lines;
// 式を書く道具（TeX）
const cf1 = (a, v) => (a === 1 && v ? v : a === -1 && v ? `-${v}` : `${a}${v}`);           // 先頭の項
const cfn = (a, v) => (a === 0 ? "" : (a > 0 ? "+" : "-") + (Math.abs(a) === 1 && v ? "" : Math.abs(a)) + v); // 2つめ以降の項
function poly(cs, v = "x") {
  const d = cs.length - 1; let s = "";
  cs.forEach((c, i) => {
    if (!c) return;
    const p = d - i, w = p === 0 ? "" : p === 1 ? v : `${v}^${p}`;
    s += s ? cfn(c, w) : cf1(c, w);
  });
  return s || "0";
}
const xm = (p, v = "x") => (p === 0 ? v : `(${v}${p > 0 ? "-" : "+"}${Math.abs(p)})`);   // (x-p)
const sgn = (n) => (n < 0 ? `${n}` : `+${n}`);
const par = (n) => (n < 0 ? `(${n})` : `${n}`);
const P = () => new Form(true);
// 分数 p/q と、約分できるときはその結果（解説用）
const frEq = (p, q) => { const r = P().fr(p, q); return `\\dfrac{${p}}{${q}}` + (r === `\\dfrac{${p}}{${q}}` ? "" : `=${r}`); };

/* ---------- 問題の型 ---------- */
const T = [];
const add = (id, f, title, gen) => T.push({ id, f, title, gen });

/* 数と式 */
add("num-expand", "num", "式の展開", (t, F) => {
  const a = t.ri(1, 3), c = t.ri(1, 3), b = t.ri(1, 6), d = t.ri(1, 6);
  const mid = b * c - a * d; need(mid !== 0);
  const ac = a * c, bd = b * d;
  return {
    q: `$(${poly([a, b])})(${poly([c, -d])})$ を展開せよ。`,
    form: `$${F.n(ac)}x^2${mid < 0 ? "-" : "+"}${F.n(Math.abs(mid))}x-${F.n(bd)}$`,
    steps: [
      `前の式の各項を、後ろの式の各項に掛けて足す（分配法則）。`,
      `$=${ac}x^2${cfn(-a * d, "x")}${cfn(b * c, "x")}-${bd}$`,
      `$x$ の項をまとめる：$${cf1(-a * d, "x")} ${cfn(b * c, "x")} = ${cf1(mid, "x")}$`,
      `答え：$${poly([ac, mid, -bd])}$`,
    ],
    point: `$x$ の係数は「外側どうしの積＋内側どうしの積」。たすきがけと同じ計算です。符号（−）の付け忘れに注意。`,
  };
});

add("num-factor", "num", "因数分解（たすきがけ）", (t, F) => {
  const a = t.ri(2, 5), b = t.ri(1, 7), d = t.ri(1, 6);
  need(gcd(a, b) === 1);
  const mid = b - a * d; need(mid !== 0);
  return {
    q: `$${poly([a, mid, -b * d])}$ を因数分解せよ。`,
    form: `$(${F.n(a)}x+${F.n(b)})(x-${F.n(d)})$`,
    steps: [
      `$x^2$ の係数 $${a}$ を $${a}\\times 1$、定数項 $${-b * d}$ を $${b}\\times(${-d})$ に分ける。`,
      `ななめに掛けて足す：$${a}\\times(${-d}) + ${b}\\times 1 = ${mid}$。これが $x$ の係数 $${mid}$ と一致する。`,
      `答え：$(${poly([a, b])})(${poly([1, -d])})$`,
    ],
    point: `たすきがけは「$x^2$ の係数」と「定数項」を積に分け、ななめに掛けた和が $x$ の係数になる組を探す。最後に展開して確かめると安全。`,
  };
});

add("num-rational", "num", "分母の有理化", (t, F) => {
  const p = t.pick([3, 5, 6, 7]), q = t.pick([2, 3, 5, 6]); need(p > q);
  const k = t.ri(1, 4), m = (p - q) * k;
  return {
    q: `$\\dfrac{${m}}{\\sqrt{${p}}-\\sqrt{${q}}}$ の分母を有理化せよ。`,
    form: `$${k === 1 ? "" : F.n(k)}${k === 1 ? `\\sqrt{${F.n(p)}}+\\sqrt{${F.n(q)}}` : `(\\sqrt{${F.n(p)}}+\\sqrt{${F.n(q)}})`}$`,
    steps: [
      `分母と分子に $\\sqrt{${p}}+\\sqrt{${q}}$ を掛ける。`,
      `分母：$(\\sqrt{${p}}-\\sqrt{${q}})(\\sqrt{${p}}+\\sqrt{${q}}) = ${p}-${q} = ${p - q}$`,
      `$\\dfrac{${m}(\\sqrt{${p}}+\\sqrt{${q}})}{${p - q}} = ${k === 1 ? "" : k}${k === 1 ? `\\sqrt{${p}}+\\sqrt{${q}}` : `(\\sqrt{${p}}+\\sqrt{${q}})`}$`,
    ],
    point: `分母が $\\sqrt{a}-\\sqrt{b}$ なら $\\sqrt{a}+\\sqrt{b}$ を掛ける。$(a-b)(a+b)=a^2-b^2$ で根号が消えます。`,
  };
});

add("num-sym", "num", "対称式の値", (t, F) => {
  const s = t.ri(2, 6), p = t.ri(1, 6); need(s * s > 4 * p);
  const v2 = s * s - 2 * p, v3 = s ** 3 - 3 * p * s;
  return {
    q: `$x+y=${s}$、$xy=${p}$ のとき、$x^2+y^2$ と $x^3+y^3$ の値を求めよ。`,
    form: `$x^2+y^2=${F.n(v2)}$、$x^3+y^3=${F.n(v3)}$`,
    steps: [
      `$x^2+y^2=(x+y)^2-2xy = ${s}^2-2\\cdot ${p} = ${v2}$`,
      `$x^3+y^3=(x+y)^3-3xy(x+y) = ${s}^3-3\\cdot ${p}\\cdot ${s} = ${s ** 3}-${3 * p * s} = ${v3}$`,
    ],
    point: `$x$ と $y$ を入れかえても同じ式（対称式）は、$x+y$ と $xy$ だけで表せる。$x, y$ を求めなくてよい。`,
  };
});

add("num-abs", "num", "絶対値を含む不等式", (t, F) => {
  const a = t.ri(-3, 6), b = t.ri(2, 5), eq = t.ri(0, 1) === 1; need(a !== 0);
  const lo = a - b, hi = a + b, cnt = eq ? 2 * b + 1 : 2 * b - 1, op = eq ? "\\le" : "<";
  return {
    q: `不等式 $\\left|${poly([1, -a])}\\right| ${op} ${b}$ を解け。また、これを満たす整数 $x$ の個数を求めよ。`,
    form: `$${F.n(lo)} ${op} x ${op} ${F.n(hi)}$、整数は $${F.n(cnt)}$ 個`,
    steps: [
      `$|X| ${op} ${b}$ は $-${b} ${op} X ${op} ${b}$ と同じ。`,
      `$-${b} ${op} ${poly([1, -a])} ${op} ${b}$ の各辺${a > 0 ? `に $${a}$ を足す` : `から $${-a}$ を引く`}と $${lo} ${op} x ${op} ${hi}$`,
      `整数は $${eq ? lo : lo + 1}$ から $${eq ? hi : hi - 1}$ までの $${cnt}$ 個。`,
    ],
    point: `$|x-a|<b$ は「数直線で $a$ からの距離が $b$ より小さい」という意味。$a-b<x<a+b$ になる。等号の有無で整数の個数が変わる。`,
  };
});

/* 2次関数 */
add("quad-vertex", "quad", "放物線の頂点", (t, F) => {
  const a = t.pick([1, 2, 3, -1, -2]), p = t.ri(-4, 4), k = t.ri(-7, 7); need(p !== 0);
  const b = -2 * a * p, c = a * p * p + k;
  return {
    q: `放物線 $y=${poly([a, b, c])}$ の頂点の座標を求めよ。`,
    form: `$(${F.n(p)},\\ ${F.n(k)})$`,
    steps: [
      `$x$ の項までを $${a}$ でくくる：$y=${a === 1 ? "" : a === -1 ? "-" : a}(${poly([1, -2 * p, 0])})${cfn(c, "")}$`,
      `平方完成：$${poly([1, -2 * p, 0])} = ${xm(p)}^2-${p * p}$`,
      `$y=${cf1(a, `${xm(p)}^2`)}${cfn(-a * p * p, "")}${cfn(c, "")} = ${cf1(a, `${xm(p)}^2`)}${cfn(k, "")}$`,
      `頂点は $(${p},\\ ${k})$`,
    ],
    point: `$y=a(x-p)^2+q$ の形にすると頂点は $(p,\\ q)$。かっこの中が $x+3$ なら頂点の $x$ 座標は $-3$（符号が逆）。`,
  };
});

add("quad-maxmin", "quad", "範囲のある最大・最小", (t, F) => {
  const m = t.ri(3, 6), a = t.ri(1, m - 1), b = t.ri(-3, 6); need(2 * a !== m);
  const min = b - a * a, xmax = 2 * a < m ? m : 0, max = xmax * xmax - 2 * a * xmax + b;
  return {
    q: `関数 $y=${poly([1, -2 * a, b])}\\ (0\\le x\\le ${m})$ の最大値と最小値を求めよ。`,
    form: `最大値 $${F.n(max)}$（$x=${F.n(xmax)}$）、最小値 $${F.n(min)}$（$x=${F.n(a)}$）`,
    steps: [
      `平方完成：$y=${xm(a)}^2${cfn(min, "")}$。軸は $x=${a}$、グラフは下に凸。`,
      `軸 $x=${a}$ は範囲 $0\\le x\\le ${m}$ の中にあるので、最小値は頂点で $${min}$（$x=${a}$）。`,
      `最大値は軸から遠い端。$0$ までの距離 $${a}$、$${m}$ までの距離 $${m - a}$ なので $x=${xmax}$ のとき。`,
      `$x=${xmax}$ を代入：$y=${xmax}^2-${2 * a}\\cdot ${xmax}${cfn(b, "")}=${max}$`,
    ],
    point: `範囲つきの最大・最小は「軸の位置」と「範囲」を図にかいて考える。下に凸なら、最小は軸（範囲内のとき）、最大は軸から遠い方の端。`,
  };
});

add("quad-disc", "quad", "判別式と解の個数", (t, F) => {
  const al = t.ri(-5, -1), be = t.ri(1, 6), two = t.ri(0, 1) === 1;
  const s = al + be, c = -al * be;   // 定数項 (α+β)m − αβ
  const constTeX = poly([s, c], "m");
  return {
    q: `$x$ の2次方程式 $x^2-2mx${cfn(s, "m")}${cfn(c, "")}=0$ が${two ? "異なる2つの実数解をもつ" : "実数解をもたない"}ような定数 $m$ の値の範囲を求めよ。`,
    form: two ? `$m<${F.n(al)},\\ ${F.n(be)}<m$` : `$${F.n(al)}<m<${F.n(be)}$`,
    steps: [
      `判別式を $D$ とすると $\\dfrac{D}{4}=m^2-(${constTeX})=${poly([1, -s, -c], "m")}$`,
      `因数分解：$\\dfrac{D}{4}=${xm(al, "m")}${xm(be, "m")}$`,
      two ? `異なる2つの実数解 ⇔ $D>0$。$${xm(al, "m")}${xm(be, "m")}>0$ より $m<${al},\\ ${be}<m$`
        : `実数解をもたない ⇔ $D<0$。$${xm(al, "m")}${xm(be, "m")}<0$ より $${al}<m<${be}$`,
    ],
    point: `異なる2つの実数解 ⇔ $D>0$、重解 ⇔ $D=0$、実数解なし ⇔ $D<0$。$x$ の係数が $2b'$ のときは $\\dfrac{D}{4}=b'^2-ac$ が楽。`,
  };
});

add("quad-ineq", "quad", "2次不等式", (t, F) => {
  const al = t.ri(-5, 3), be = al + t.ri(1, 6), lt = t.ri(0, 1) === 1;
  return {
    q: `2次不等式 $${poly([1, -(al + be), al * be])} ${lt ? "<" : ">"} 0$ を解け。`,
    form: lt ? `$${F.n(al)}<x<${F.n(be)}$` : `$x<${F.n(al)},\\ ${F.n(be)}<x$`,
    steps: [
      `左辺を因数分解：$${xm(al)}${xm(be)} ${lt ? "<" : ">"} 0$`,
      `$y=${xm(al)}${xm(be)}$ のグラフは下に凸で、$x$ 軸と $x=${al},\\ ${be}$ で交わる。`,
      lt ? `$y<0$（$x$ 軸より下）になるのは2つの交点の間：$${al}<x<${be}$` : `$y>0$（$x$ 軸より上）になるのは2つの交点の外側：$x<${al},\\ ${be}<x$`,
    ],
    point: `$(x-\\alpha)(x-\\beta)<0$ なら「間」、$>0$ なら「外側」（$\\alpha<\\beta$）。迷ったらグラフをかく。`,
  };
});

add("quad-len", "quad", "x軸から切り取る線分", (t, F) => {
  const p = t.ri(-3, 4), n = t.pick([2, 3, 5, 6, 7, 8, 10, 12]);
  const c = p * p - n, [k, m] = sqf(n);
  const rootTeX = k === 1 ? `\\sqrt{${m}}` : `${k}\\sqrt{${m}}`;
  return {
    q: `放物線 $y=${poly([1, -2 * p, c])}$ が $x$ 軸から切り取る線分の長さを求めよ。`,
    form: `$${F.rad(2, n)}$`,
    steps: [
      `$y=0$ とおいた方程式 $${poly([1, -2 * p, c])}=0$ を解く。`,
      `解の公式（$b=2b'$ の形）：$x=${p}\\pm\\sqrt{${par(p)}^2-(${c})}=${p}\\pm\\sqrt{${n}}${k > 1 ? `=${p}\\pm ${rootTeX}` : ""}$`,
      `長さは2つの解の差：$(${p}+${rootTeX})-(${p}-${rootTeX})=${2 * k}\\sqrt{${m}}$`,
    ],
    point: `切り取る長さ＝2つの交点の $x$ 座標の差。$x=p\\pm\\sqrt{d}$ なら長さは $2\\sqrt{d}$。`,
  };
});

/* 図形と計量 */
const TRIPLES = [[3, 4, 5], [5, 12, 13], [8, 15, 17], [7, 24, 25]];
const SIN = { 30: [1, 1, 2], 45: [1, 2, 2], 60: [1, 3, 2], 120: [1, 3, 2], 135: [1, 2, 2], 150: [1, 1, 2] }; // sin = u√r / w
const sinTeX = (A) => { const [, r, w] = SIN[A]; return r === 1 ? `\\dfrac{1}{${w}}` : `\\dfrac{\\sqrt{${r}}}{${w}}`; };

add("trig-value", "trig", "三角比の相互関係", (t, F) => {
  let [a, b, c] = t.pick(TRIPLES); if (t.ri(0, 1)) [a, b] = [b, a];
  const obt = t.ri(0, 1) === 1, sg = obt ? -1 : 1;
  return {
    q: `$${obt ? "90^\\circ<\\theta<180^\\circ" : "0^\\circ<\\theta<90^\\circ"}$ で $\\sin\\theta=\\dfrac{${a}}{${c}}$ のとき、$\\cos\\theta$ と $\\tan\\theta$ の値を求めよ。`,
    form: `$\\cos\\theta=${F.fr(sg * b, c)}$、$\\tan\\theta=${F.fr(sg * a, b)}$`,
    steps: [
      `$\\cos^2\\theta=1-\\sin^2\\theta=1-\\dfrac{${a * a}}{${c * c}}=\\dfrac{${b * b}}{${c * c}}$`,
      obt ? `$\\theta$ は鈍角なので $\\cos\\theta<0$。$\\cos\\theta=-\\dfrac{${b}}{${c}}$` : `$\\theta$ は鋭角なので $\\cos\\theta>0$。$\\cos\\theta=\\dfrac{${b}}{${c}}$`,
      `$\\tan\\theta=\\dfrac{\\sin\\theta}{\\cos\\theta}=\\dfrac{${a}}{${c}}\\div\\left(${obt ? "-" : ""}\\dfrac{${b}}{${c}}\\right)=${obt ? "-" : ""}\\dfrac{${a}}{${b}}$`,
    ],
    point: `$\\sin^2\\theta+\\cos^2\\theta=1$ と $\\tan\\theta=\\dfrac{\\sin\\theta}{\\cos\\theta}$。$90^\\circ<\\theta<180^\\circ$ では $\\cos\\theta$ と $\\tan\\theta$ が負になる。`,
  };
});

add("trig-cos", "trig", "余弦定理", (t, F) => {
  const b = t.ri(2, 8), c = t.ri(2, 8), A = t.pick([60, 120]); need(b !== c || A === 120);
  const a2 = A === 60 ? b * b + c * c - b * c : b * b + c * c + b * c;
  const [k, m] = sqf(a2);
  return {
    q: `$\\triangle ABC$ で $b=${b}$、$c=${c}$、$A=${A}^\\circ$ のとき、辺 $a$ の長さを求めよ。`,
    form: `$a=${F.rad(1, a2)}$`,
    steps: [
      `余弦定理：$a^2=b^2+c^2-2bc\\cos A$`,
      `$\\cos ${A}^\\circ=${A === 60 ? "\\dfrac{1}{2}" : "-\\dfrac{1}{2}"}$ を代入：$a^2=${b * b}+${c * c}-2\\cdot ${b}\\cdot ${c}\\cdot\\left(${A === 60 ? "\\dfrac{1}{2}" : "-\\dfrac{1}{2}"}\\right)=${a2}$`,
      `$a>0$ より $a=\\sqrt{${a2}}${m === 1 ? `=${k}` : k > 1 ? `=${k}\\sqrt{${m}}` : ""}$`,
    ],
    point: `2辺とその間の角がわかれば余弦定理で残りの辺。$\\cos 120^\\circ=-\\dfrac{1}{2}$ なので、$120^\\circ$ のときは $+bc$ になる。`,
  };
});

add("trig-area", "trig", "三角形の面積", (t, F) => {
  const b = t.ri(2, 9), c = t.ri(2, 9), A = t.pick([30, 45, 60, 120, 135, 150]);
  const [u, r, w] = SIN[A];
  return {
    q: `$\\triangle ABC$ で $AB=${c}$、$AC=${b}$、$\\angle A=${A}^\\circ$ のとき、面積 $S$ を求めよ。`,
    form: `$S=${F.rad(b * c * u, r, 2 * w)}$`,
    steps: [
      `$S=\\dfrac{1}{2}\\cdot AB\\cdot AC\\cdot\\sin A$`,
      `$\\sin ${A}^\\circ=${sinTeX(A)}$`,
      `$S=\\dfrac{1}{2}\\cdot ${c}\\cdot ${b}\\cdot ${sinTeX(A)}=${P().rad(b * c * u, r, 2 * w)}$`,
    ],
    point: `2辺とその間の角から面積：$S=\\dfrac{1}{2}bc\\sin A$。$\\sin 150^\\circ=\\sin 30^\\circ$ のように、$\\sin(180^\\circ-\\theta)=\\sin\\theta$。`,
  };
});

add("trig-sine", "trig", "正弦定理と外接円", (t, F) => {
  const A = t.pick([30, 45, 60, 120, 135, 150]), [u, r, w] = SIN[A], findR = t.ri(0, 1) === 1;
  if (findR) {
    const a = t.ri(2, 9);
    return {
      q: `$\\triangle ABC$ で $a=${a}$、$A=${A}^\\circ$ のとき、外接円の半径 $R$ を求めよ。`,
      form: `$R=${F.rad(a * w, r, 2 * u * r)}$`,
      steps: [
        `正弦定理：$\\dfrac{a}{\\sin A}=2R$ より $R=\\dfrac{a}{2\\sin A}$`,
        `$\\sin ${A}^\\circ=${sinTeX(A)}$ を代入：$R=\\dfrac{${a}}{2\\cdot ${sinTeX(A)}}=${P().rad(a * w, r, 2 * u * r)}$${r > 1 ? "（分母を有理化）" : ""}`,
      ],
      point: `正弦定理 $\\dfrac{a}{\\sin A}=\\dfrac{b}{\\sin B}=\\dfrac{c}{\\sin C}=2R$。向かい合う辺と角の組と、外接円の半径を結びつける。`,
    };
  }
  const R = t.ri(2, 9);
  return {
    q: `$\\triangle ABC$ の外接円の半径が $${R}$、$A=${A}^\\circ$ のとき、辺 $a$ の長さを求めよ。`,
    form: `$a=${F.rad(2 * R * u, r, w)}$`,
    steps: [
      `正弦定理：$\\dfrac{a}{\\sin A}=2R$ より $a=2R\\sin A$`,
      `$a=2\\cdot ${R}\\cdot ${sinTeX(A)}=${P().rad(2 * R * u, r, w)}$`,
    ],
    point: `正弦定理 $\\dfrac{a}{\\sin A}=2R$。$a=2R\\sin A$ と変形して使う。`,
  };
});

/* データの分析 */
function devs(t, n, lim) {   // 合計0になる偏差 n 個
  const d = Array.from({ length: n - 1 }, () => t.ri(-lim, lim));
  const last = -d.reduce((s, x) => s + x, 0); need(Math.abs(last) <= lim);
  return [...d, last];
}
add("data-var", "data", "平均値・分散・標準偏差", (t, F) => {
  const m = t.ri(5, 12), d = devs(t, 5, 4), ss = d.reduce((s, x) => s + x * x, 0);
  need(ss > 0 && ss % 5 === 0);
  const v = ss / 5, xs = d.map(x => m + x), sum = xs.reduce((s, x) => s + x, 0);
  const [k, mm] = sqf(v);
  return {
    q: `5個のデータ $${xs.join(",\\ ")}$ の平均値、分散、標準偏差を求めよ。`,
    form: `平均値 $${F.n(m)}$、分散 $${F.n(v)}$、標準偏差 $${F.rad(1, v)}$`,
    steps: [
      `平均値：$\\dfrac{${xs.join("+")}}{5}=\\dfrac{${sum}}{5}=${m}$`,
      `偏差（各値−平均値）：$${d.join(",\\ ")}$`,
      `偏差の2乗の和：$${d.map(x => `${par(x)}^2`).join("+")}=${ss}$`,
      `分散：$\\dfrac{${ss}}{5}=${v}$、標準偏差：$\\sqrt{${v}}${mm === 1 ? `=${k}` : k > 1 ? `=${k}\\sqrt{${mm}}` : ""}$`,
    ],
    point: `分散＝「偏差の2乗」の平均。標準偏差は分散の正の平方根（もとのデータと同じ単位）。`,
  };
});

add("data-quart", "data", "四分位数と四分位範囲", (t, F) => {
  const v = [t.ri(1, 6)];
  for (let i = 1; i < 9; i++) v.push(v[i - 1] + t.ri(0, 5));
  need((v[1] + v[2]) % 2 === 0 && (v[6] + v[7]) % 2 === 0);
  const q1 = (v[1] + v[2]) / 2, q2 = v[4], q3 = (v[6] + v[7]) / 2;
  const shown = t.shuffle(v);
  return {
    q: `9個のデータ $${shown.join(",\\ ")}$ の第1四分位数 $Q_1$、中央値 $Q_2$、第3四分位数 $Q_3$ と四分位範囲を求めよ。`,
    form: `$Q_1=${F.n(q1)}$、$Q_2=${F.n(q2)}$、$Q_3=${F.n(q3)}$、四分位範囲 $${F.n(q3 - q1)}$`,
    steps: [
      `小さい順に並べる：$${v.join(",\\ ")}$`,
      `中央値は5番目：$Q_2=${q2}$`,
      `下の4個 $${v.slice(0, 4).join(",\\ ")}$ の中央値：$Q_1=\\dfrac{${v[1]}+${v[2]}}{2}=${q1}$`,
      `上の4個 $${v.slice(5).join(",\\ ")}$ の中央値：$Q_3=\\dfrac{${v[6]}+${v[7]}}{2}=${q3}$`,
      `四分位範囲：$Q_3-Q_1=${q3}-${q1}=${q3 - q1}$`,
    ],
    point: `まず小さい順に並べる。個数が奇数のときは、中央値を除いた下半分・上半分の中央値が $Q_1$・$Q_3$。`,
  };
});

add("data-trans", "data", "変量の変換", (t, F) => {
  const m = t.ri(3, 12), v = t.pick([2, 3, 4, 5, 9, 16]), a = t.pick([2, 3, 5, -1, -2, -3]), b = t.ri(-9, 9); need(b !== 0);
  const [k, mm] = sqf(v);
  return {
    q: `変量 $x$ の平均値が $${m}$、分散が $${v}$ である。$y=${poly([a, b])}$ で変量 $y$ を作るとき、$y$ の平均値・分散・標準偏差を求めよ。`,
    form: `平均値 $${F.n(a * m + b)}$、分散 $${F.n(a * a * v)}$、標準偏差 $${F.rad(Math.abs(a), v)}$`,
    steps: [
      `平均値：$a\\bar{x}+b=${a}\\cdot ${m}${cfn(b, "")}=${a * m + b}$`,
      `分散：$a^2$ 倍。$${par(a)}^2\\cdot ${v}=${a * a * v}$（$+b$ は分散に影響しない）`,
      `標準偏差：$|a|$ 倍。$${Math.abs(a)}\\sqrt{${v}}${mm === 1 ? `=${Math.abs(a) * k}` : k > 1 ? `=${Math.abs(a) * k}\\sqrt{${mm}}` : ""}$`,
    ],
    point: `$y=ax+b$ のとき、平均値は $a\\bar{x}+b$、分散は $a^2$ 倍、標準偏差は $|a|$ 倍。全体をずらす $b$ はちらばりを変えない。`,
  };
});

add("data-cov", "data", "共分散", (t, F) => {
  const mx = t.ri(3, 9), my = t.ri(3, 9), dx = devs(t, 5, 3), dy = devs(t, 5, 3);
  const sp = dx.reduce((s, x, i) => s + x * dy[i], 0); need(sp !== 0 && sp % 5 === 0);
  const xs = dx.map(x => mx + x), ys = dy.map(y => my + y);
  return {
    q: `次の5組のデータについて、$x$ の平均値、$y$ の平均値、$x$ と $y$ の共分散を求めよ。<br>$\\begin{array}{c|ccccc} x & ${xs.join(" & ")} \\\\ \\hline y & ${ys.join(" & ")} \\end{array}$`,
    form: `$\\bar{x}=${F.n(mx)}$、$\\bar{y}=${F.n(my)}$、共分散 $${F.n(sp / 5)}$`,
    steps: [
      `$\\bar{x}=\\dfrac{${xs.reduce((s, x) => s + x, 0)}}{5}=${mx}$、$\\bar{y}=\\dfrac{${ys.reduce((s, x) => s + x, 0)}}{5}=${my}$`,
      `偏差：$x$ は $${dx.join(",\\ ")}$、$y$ は $${dy.join(",\\ ")}$`,
      `偏差の積の和：$${dx.map((x, i) => `${par(x)}\\cdot${par(dy[i])}`).join("+")}=${sp}$`,
      `共分散：$\\dfrac{${sp}}{5}=${sp / 5}$`,
    ],
    point: `共分散＝「$x$ の偏差 × $y$ の偏差」の平均。正なら正の相関、負なら負の相関の傾向。相関係数は共分散 ÷（$x$ の標準偏差 × $y$ の標準偏差）。`,
  };
});

/* 場合の数と確率 */
add("prob-select", "prob", "組合せ（少なくとも）", (t, F) => {
  const a = t.ri(4, 7), b = t.ri(3, 6), atLeast = t.ri(0, 1) === 1;
  if (atLeast) {
    const all = comb(a + b, 3), none = comb(a, 3);
    return {
      q: `男子 $${a}$ 人、女子 $${b}$ 人の中から3人を選ぶ。女子が少なくとも1人含まれる選び方は何通りか。`,
      form: `$${F.n(all - none)}$ 通り`,
      steps: [
        `全体：$_{${a + b}}\\mathrm{C}_3=${all}$ 通り`,
        `女子が1人も入らない（男子だけ）：$_{${a}}\\mathrm{C}_3=${none}$ 通り`,
        `少なくとも1人＝全体−1人もいない：$${all}-${none}=${all - none}$`,
      ],
      point: `「少なくとも1つ」は、全体から「1つもない場合」を引く（余事象）と速い。`,
    };
  }
  const v = b * comb(a, 2);
  return {
    q: `男子 $${a}$ 人、女子 $${b}$ 人の中から3人を選ぶ。女子がちょうど1人含まれる選び方は何通りか。`,
    form: `$${F.n(v)}$ 通り`,
    steps: [
      `女子1人の選び方：$_{${b}}\\mathrm{C}_1=${b}$ 通り`,
      `男子2人の選び方：$_{${a}}\\mathrm{C}_2=${comb(a, 2)}$ 通り`,
      `積の法則：$${b}\\times ${comb(a, 2)}=${v}$`,
    ],
    point: `「女子から何人・男子から何人」と分けて選び、掛け合わせる（積の法則）。`,
  };
});

add("prob-circle", "prob", "円順列", (t, F) => {
  const n = t.ri(5, 7), all = fact(n - 1), adj = 2 * fact(n - 2), not = t.ri(0, 1) === 1;
  return {
    q: `$${n}$ 人が円形のテーブルに座る。座り方は全部で何通りか。また、特定の2人 A、B が隣り合${not ? "わない" : "う"}座り方は何通りか。`,
    form: `全部で $${F.n(all)}$ 通り、隣り合${not ? "わない" : "う"}のは $${F.n(not ? all - adj : adj)}$ 通り`,
    steps: [
      `円順列：回転して同じものは1通り。1人を固定して残りを並べる：$(${n}-1)!=${n - 1}!=${all}$`,
      `A と B をまとめて1人と考えると $${n - 1}$ 人の円順列：$(${n - 1}-1)!=${fact(n - 2)}$`,
      `まとめた中での A、B の並び方が $2$ 通り。隣り合うのは $${fact(n - 2)}\\times 2=${adj}$ 通り`,
      ...(not ? [`隣り合わない＝全体−隣り合う：$${all}-${adj}=${all - adj}$`] : []),
    ],
    point: `円順列は $(n-1)!$。「隣り合う」はひとまとめにして数え、最後に中の並び方を掛ける。「隣り合わない」は全体から引く。`,
  };
});

const DICE = []; for (let i = 1; i <= 6; i++) for (let j = 1; j <= 6; j++) DICE.push([i, j]);
add("prob-dice", "prob", "2つのさいころの確率", (t, F) => {
  const kind = t.ri(0, 2);
  let desc, ok, how;
  if (kind === 0) { const k = t.ri(3, 11); desc = `目の和が $${k}$`; ok = ([i, j]) => i + j === k; }
  else if (kind === 1) { const k = t.pick([3, 4, 5]); desc = `目の和が $${k}$ の倍数`; ok = ([i, j]) => (i + j) % k === 0; }
  else { const k = t.ri(2, 4); desc = `目の差が $${k}$`; ok = ([i, j]) => Math.abs(i - j) === k; }
  const hits = DICE.filter(ok);
  how = hits.length <= 8 ? `$${hits.map(([i, j]) => `(${i},${j})`).join(",")}$ の $${hits.length}$ 通り` : `表を作って数えると $${hits.length}$ 通り`;
  return {
    q: `大小2つのさいころを同時に投げるとき、${desc}になる確率を求めよ。`,
    form: `$${F.fr(hits.length, 36)}$`,
    steps: [
      `目の出方は全部で $6\\times 6=36$ 通り（どれも同じ確からしさ）。`,
      `(大, 小) で書くと ${how}。`,
      `確率：$${frEq(hits.length, 36)}$`,
    ],
    point: `2つのさいころは「大・小」を区別して $36$ 通り。表（6×6のマス）をかくと数えもれがない。答えは約分する。`,
  };
});

add("prob-draw", "prob", "玉を取り出す確率", (t, F) => {
  const a = t.ri(2, 6), b = t.ri(2, 6), same = t.ri(0, 1) === 1, all = comb(a + b, 2);
  const hit = same ? comb(a, 2) + comb(b, 2) : a * b;
  return {
    q: `赤玉 $${a}$ 個、白玉 $${b}$ 個が入った袋から2個を同時に取り出す。${same ? "2個が同じ色" : "赤玉と白玉が1個ずつ"}である確率を求めよ。`,
    form: `$${F.fr(hit, all)}$`,
    steps: [
      `全体：$${a + b}$ 個から2個で $_{${a + b}}\\mathrm{C}_2=${all}$ 通り`,
      same ? `2個とも赤 $_{${a}}\\mathrm{C}_2=${comb(a, 2)}$、2個とも白 $_{${b}}\\mathrm{C}_2=${comb(b, 2)}$。合わせて $${hit}$ 通り`
        : `赤1個 $${a}$ 通り × 白1個 $${b}$ 通り $=${hit}$ 通り`,
      `確率：$${frEq(hit, all)}$`,
    ],
    point: `同じ色の玉でも1個ずつ区別して数えると、どの取り出し方も同じ確からしさになる。`,
  };
});

add("prob-repeat", "prob", "反復試行", (t, F) => {
  const kind = t.ri(0, 2);
  if (kind === 0) {
    const n = t.ri(4, 6), k = t.ri(1, n - 1), c = comb(n, k);
    return {
      q: `1枚の硬貨を $${n}$ 回投げるとき、表がちょうど $${k}$ 回出る確率を求めよ。`,
      form: `$${F.fr(c, 2 ** n)}$`,
      steps: [
        `表の回数が $${k}$ 回になる「何回目が表か」の選び方：$_{${n}}\\mathrm{C}_{${k}}=${c}$ 通り`,
        `その1つの出方の確率：$\\left(\\dfrac{1}{2}\\right)^{${n}}=\\dfrac{1}{${2 ** n}}$`,
        `$${c}\\times\\dfrac{1}{${2 ** n}}=${P().fr(c, 2 ** n)}$`,
      ],
      point: `反復試行：$n$ 回中ちょうど $k$ 回起こる確率は $_n\\mathrm{C}_k\\,p^k(1-p)^{n-k}$。`,
    };
  }
  if (kind === 1) {
    const n = t.ri(3, 6);
    return {
      q: `1枚の硬貨を $${n}$ 回投げるとき、少なくとも1回は表が出る確率を求めよ。`,
      form: `$${F.fr(2 ** n - 1, 2 ** n)}$`,
      steps: [
        `余事象「$${n}$ 回とも裏」の確率：$\\left(\\dfrac{1}{2}\\right)^{${n}}=\\dfrac{1}{${2 ** n}}$`,
        `$1-\\dfrac{1}{${2 ** n}}=\\dfrac{${2 ** n - 1}}{${2 ** n}}$`,
      ],
      point: `「少なくとも1回」は余事象（1回も起こらない）を1から引く。`,
    };
  }
  const k = t.ri(1, 2), c = comb(3, k), num = c * 5 ** (3 - k);
  return {
    q: `1個のさいころを3回投げるとき、1の目がちょうど $${k}$ 回出る確率を求めよ。`,
    form: `$${F.fr(num, 216)}$`,
    steps: [
      `何回目に1が出るかの選び方：$_3\\mathrm{C}_{${k}}=${c}$ 通り`,
      `1つの出方の確率：$\\left(\\dfrac{1}{6}\\right)^{${k}}\\left(\\dfrac{5}{6}\\right)^{${3 - k}}=\\dfrac{${5 ** (3 - k)}}{216}$`,
      `$${c}\\times\\dfrac{${5 ** (3 - k)}}{216}=\\dfrac{${num}}{216}=${P().fr(num, 216)}$`,
    ],
    point: `反復試行：$_n\\mathrm{C}_k\\,p^k(1-p)^{n-k}$。「1が出る」$p=\\dfrac{1}{6}$、「1以外」$\\dfrac{5}{6}$。`,
  };
});

add("prob-cond", "prob", "条件付き確率", (t, F) => {
  const k = t.ri(1, 6), s = t.ri(7, 10);
  const A = DICE.filter(([i, j]) => i === k || j === k), AB = A.filter(([i, j]) => i + j >= s);
  need(AB.length > 0 && AB.length < A.length);
  return {
    q: `大小2つのさいころを投げる。少なくとも一方の目が $${k}$ であったとき、目の和が $${s}$ 以上である条件付き確率を求めよ。`,
    form: `$${F.fr(AB.length, A.length)}$`,
    steps: [
      `条件「少なくとも一方が $${k}$」：$36-25=${A.length}$ 通り（両方とも $${k}$ 以外の $5\\times5$ を引く）`,
      `そのうち和が $${s}$ 以上：$${AB.map(([i, j]) => `(${i},${j})`).join(",")}$ の $${AB.length}$ 通り`,
      `$P_A(B)=\\dfrac{n(A\\cap B)}{n(A)}=${frEq(AB.length, A.length)}$`,
    ],
    point: `条件付き確率は「条件を満たす場合」だけを全体として数え直す：$P_A(B)=\\dfrac{n(A\\cap B)}{n(A)}$。`,
  };
});

/* 図形の性質 */
add("geo-power", "geo", "方べきの定理", (t, F) => {
  if (t.ri(0, 1)) {
    const a = t.ri(2, 6), x = t.ri(2, 8), pr = a * (a + x);
    return {
      q: `円の外の点 P から引いた直線が円と2点 A、B で交わり（$PA<PB$）、$PA=${a}$、$AB=${x}$ である。P から円に引いた接線の接点を T とするとき、$PT$ の長さを求めよ。`,
      form: `$PT=${F.rad(1, pr)}$`,
      steps: [
        `$PB=PA+AB=${a}+${x}=${a + x}$`,
        `方べきの定理：$PT^2=PA\\cdot PB=${a}\\cdot ${a + x}=${pr}$`,
        `$PT>0$ より $PT=${P().rad(1, pr)}$`,
      ],
      point: `接線のときの方べきの定理：$PT^2=PA\\cdot PB$。$PB$ は「P から遠い方の交点まで」の長さ。`,
    };
  }
  const a = t.ri(2, 6), x = t.ri(1, 8), c = t.ri(2, 8), pr = a * (a + x);
  need(pr % c === 0 && pr / c > c);
  const pd = pr / c;
  return {
    q: `円の外の点 P から引いた2本の直線が、円とそれぞれ A、B と C、D で交わる（$PA<PB$、$PC<PD$）。$PA=${a}$、$AB=${x}$、$PC=${c}$ のとき、$CD$ の長さを求めよ。`,
    form: `$CD=${F.n(pd - c)}$`,
    steps: [
      `$PB=${a}+${x}=${a + x}$`,
      `方べきの定理：$PA\\cdot PB=PC\\cdot PD$ より $${a}\\cdot ${a + x}=${c}\\cdot PD$、$PD=${pd}$`,
      `$CD=PD-PC=${pd}-${c}=${pd - c}$`,
    ],
    point: `方べきの定理 $PA\\cdot PB=PC\\cdot PD$ は、どれも P から測った長さで使う。求めた $PD$ から $PC$ を引くのを忘れずに。`,
  };
});

add("geo-bisect", "geo", "角の二等分線と比", (t, F) => {
  const b = t.ri(3, 9), c = t.ri(3, 9), a = t.ri(3, 12);
  need(b !== c && a < b + c && b < a + c && c < a + b);
  return {
    q: `$\\triangle ABC$ で $AB=${c}$、$AC=${b}$、$BC=${a}$ である。$\\angle A$ の二等分線と辺 BC の交点を D とするとき、$BD$ の長さを求めよ。`,
    form: `$BD=${F.fr(a * c, b + c)}$`,
    steps: [
      `角の二等分線の性質：$BD:DC=AB:AC=${c}:${b}$`,
      `$BD=BC\\times\\dfrac{${c}}{${c}+${b}}=${a}\\times\\dfrac{${c}}{${b + c}}=${P().fr(a * c, b + c)}$`,
    ],
    point: `$\\angle A$ の二等分線は、対辺 BC を $AB:AC$ に分ける。比から長さは「全体 × 割合」で求める。`,
  };
});

add("geo-ceva", "geo", "チェバ・メネラウスの定理", (t, F) => {
  const p = t.ri(1, 5), q = t.ri(1, 5), r = t.ri(1, 5), s = t.ri(1, 5), men = t.ri(0, 1) === 1;
  need(gcd(p, q) === 1 && gcd(r, s) === 1 && !(p === q && r === s));
  if (men) need(r > s);
  return {
    q: men
      ? `$\\triangle ABC$ の辺 AB 上に点 R、辺 CA 上に点 Q、辺 BC の C の側の延長上に点 P があり、3点 P、Q、R は一直線上にある。$AR:RB=${p}:${q}$、$BP:PC=${r}:${s}$ のとき、$CQ:QA$ を求めよ。`
      : `$\\triangle ABC$ の辺 AB、BC、CA 上にそれぞれ点 R、P、Q があり、AP、BQ、CR は1点で交わる。$AR:RB=${p}:${q}$、$BP:PC=${r}:${s}$ のとき、$CQ:QA$ を求めよ。`,
    form: `$CQ:QA=${F.ratio(q * s, p * r)}$`,
    steps: [
      `${men ? "メネラウス" : "チェバ"}の定理：$\\dfrac{AR}{RB}\\cdot\\dfrac{BP}{PC}\\cdot\\dfrac{CQ}{QA}=1$`,
      `$\\dfrac{${p}}{${q}}\\cdot\\dfrac{${r}}{${s}}\\cdot\\dfrac{CQ}{QA}=1$ より $\\dfrac{CQ}{QA}=\\dfrac{${q * s}}{${p * r}}$`,
      `$CQ:QA=${q * s}:${p * r}${gcd(q * s, p * r) > 1 ? `=${P().ratio(q * s, p * r)}` : ""}$`,
    ],
    point: `頂点 → 分点 → 頂点 → … と三角形を一周する順に比を掛けると $1$。チェバ（3本の線が1点で交わる）もメネラウス（1本の直線）も式の形は同じ。`,
  };
});

add("geo-circle", "geo", "円周角・内接四角形", (t, F) => {
  if (t.ri(0, 1)) {
    const x = 5 * t.ri(8, 17);
    return {
      q: `円 O に内接する四角形 ABCD で、$\\angle BAD=${x}^\\circ$ のとき、$\\angle BCD$ と $\\angle BOD$（C を含む側の弧 BCD に対する中心角）を求めよ。`,
      form: `$\\angle BCD=${F.n(180 - x)}^\\circ$、$\\angle BOD=${F.n(2 * x)}^\\circ$`,
      steps: [
        `円に内接する四角形の向かい合う角の和は $180^\\circ$：$\\angle BCD=180^\\circ-${x}^\\circ=${180 - x}^\\circ$`,
        `$\\angle BAD$ は弧 BCD に対する円周角。中心角はその2倍：$\\angle BOD=2\\times ${x}^\\circ=${2 * x}^\\circ$`,
      ],
      point: `中心角＝円周角の2倍。円に内接する四角形では、向かい合う角の和が $180^\\circ$。`,
    };
  }
  const y = 5 * t.ri(6, 16);
  return {
    q: `円 O の周上に3点 A、B、C があり、A における接線と弦 AB のつくる角（C と反対側）が $${y}^\\circ$ である。$\\angle ACB$ と $\\angle AOB$（C と反対側の弧 AB に対する中心角）を求めよ。`,
    form: `$\\angle ACB=${F.n(y)}^\\circ$、$\\angle AOB=${F.n(2 * y)}^\\circ$`,
    steps: [
      `接弦定理：接線と弦のつくる角は、その内側の弧に対する円周角に等しい：$\\angle ACB=${y}^\\circ$`,
      `中心角は円周角の2倍：$\\angle AOB=2\\times ${y}^\\circ=${2 * y}^\\circ$`,
    ],
    point: `接弦定理：接線と弦の間の角＝その角の内側にある弧に対する円周角。中心角はその2倍。`,
  };
});

/* 整数 */
const factTeX = (n) => {
  const f = []; for (let p = 2; p <= n; p++) { let e = 0; while (n % p === 0) { n /= p; e++; } if (e) f.push(e === 1 ? `${p}` : `${p}^{${e}}`); }
  return f.join("\\cdot ");
};
add("int-gcd", "int", "最大公約数・最小公倍数", (t, F) => {
  const g = t.ri(2, 12), m = t.ri(2, 9), n = t.ri(2, 9); need(m < n && gcd(m, n) === 1);
  const A = g * m, B = g * n;
  return {
    q: `$${A}$ と $${B}$ の最大公約数と最小公倍数を求めよ。`,
    form: `最大公約数 $${F.n(g)}$、最小公倍数 $${F.n(g * m * n)}$`,
    steps: [
      `素因数分解：$${A}=${factTeX(A)}$、$${B}=${factTeX(B)}$`,
      `共通な素因数を、小さい方の指数で掛ける：最大公約数 $${g}$`,
      `最小公倍数＝最大公約数 × 残り：$${g}\\times ${m}\\times ${n}=${g * m * n}$`,
    ],
    point: `2数 $A=ga$、$B=gb$（$a, b$ は互いに素）なら、最小公倍数は $gab$。$A\\times B=$ 最大公約数 × 最小公倍数 も確かめに使える。`,
  };
});

add("int-divisor", "int", "約数の個数と総和", (t, F) => {
  const [p, q] = t.pick([[2, 3], [2, 5], [2, 7], [3, 5]]), a = t.ri(1, 4), b = t.ri(1, 2);
  const N = p ** a * q ** b; need(N >= 12 && N <= 400);
  const sp = (p ** (a + 1) - 1) / (p - 1), sq = (q ** (b + 1) - 1) / (q - 1);
  const terms = (x, e) => Array.from({ length: e + 1 }, (_, i) => (i === 0 ? "1" : i === 1 ? `${x}` : `${x}^{${i}}`)).join("+");
  return {
    q: `$${N}$ の正の約数の個数と、その総和を求めよ。`,
    form: `個数 $${F.n((a + 1) * (b + 1))}$ 個、総和 $${F.n(sp * sq)}$`,
    steps: [
      `素因数分解：$${N}=${factTeX(N)}$`,
      `個数：指数に1を足して掛ける：$(${a}+1)(${b}+1)=${(a + 1) * (b + 1)}$`,
      `総和：$(${terms(p, a)})(${terms(q, b)})=${sp}\\times ${sq}=${sp * sq}$`,
    ],
    point: `$N=p^aq^b$ の約数は $p^i q^j$ の形。個数は $(a+1)(b+1)$、総和は $(1+p+\\cdots+p^a)(1+q+\\cdots+q^b)$。`,
  };
});

add("int-dioph", "int", "1次不定方程式", (t, F) => {
  const a = t.ri(3, 11), b = t.ri(3, 11); need(a !== b && gcd(a, b) === 1);
  let x0 = 1; while ((a * x0 - 1) % b !== 0) x0++;
  const y0 = (a * x0 - 1) / b; need(y0 > 0);
  return {
    q: `方程式 $${a}x-${b}y=1$ の整数解のうち、$x$ が最も小さい正の整数であるものを求めよ。また、すべての整数解を $k$ を整数として表せ。`,
    form: `$x=${F.n(x0)}$、$y=${F.n(y0)}$。一般には $x=${F.n(b)}k+${F.n(x0)}$、$y=${F.n(a)}k+${F.n(y0)}$`,
    steps: [
      `$x=1,2,3,\\dots$ と代入し、$${a}x-1$ が $${b}$ で割り切れる最初の $x$ を探す：$x=${x0}$ のとき $${a * x0}-1=${a * x0 - 1}=${b}\\times ${y0}$、$y=${y0}$`,
      `$${a}x-${b}y=1$ から $${a}\\cdot ${x0}-${b}\\cdot ${y0}=1$ を引く：$${a}(x-${x0})=${b}(y-${y0})$`,
      `$${a}$ と $${b}$ は互いに素なので $x-${x0}=${b}k$、$y-${y0}=${a}k$`,
      `$x=${b}k+${x0}$、$y=${a}k+${y0}$（$k$ は整数）`,
    ],
    point: `1組の解を見つけ、もとの式から引いて「$a(x-x_0)=b(y-y_0)$」の形にする。$a, b$ が互いに素なら $x-x_0$ は $b$ の倍数。`,
  };
});

add("int-base", "int", "n進法", (t, F) => {
  const k = t.pick([2, 3, 5]), N = t.ri(k === 2 ? 9 : 10, k === 2 ? 31 : 120);
  const digits = N.toString(k);
  need(digits.length <= 5);
  if (t.ri(0, 1)) {
    const st = []; let x = N; while (x > 0) { st.push(`${x}\\div ${k}=${Math.floor(x / k)}\\ \\text{余り}\\ ${x % k}`); x = Math.floor(x / k); }
    return {
      q: `10進法で表された数 $${N}$ を ${k} 進法で表せ。`,
      form: `$${[...digits].map(d => F.box(d)).join("")}_{(${k})}$`,
      steps: [
        `$${k}$ で割り続け、余りを記録する：`,
        ...st.map(s => `$${s}$`),
        `余りを下から（最後の余りから）並べる：$${digits}_{(${k})}$`,
      ],
      point: `$k$ 進法へは「$k$ で割って余りを書く」をくり返し、余りを下から読む。`,
    };
  }
  const L = digits.length;
  return {
    q: `${k} 進法で表された数 $${digits}_{(${k})}$ を10進法で表せ。`,
    form: `$${F.n(N)}$`,
    steps: [
      `各位は右から $${k}^0, ${k}^1, ${k}^2, \\dots$ の位。`,
      `$${[...digits].map((d, i) => `${d}\\cdot ${k}^{${L - 1 - i}}`).join("+")}$`,
      `$=${[...digits].map((d, i) => Number(d) * k ** (L - 1 - i)).join("+")}=${N}$`,
    ],
    point: `$k$ 進法の各位の重みは、右から $1, k, k^2, \\dots$。各位の数字 × 重みを足すと10進法になる。`,
  };
});

add("int-mod", "int", "余りの計算", (t, F) => {
  const d = t.ri(5, 9), r1 = t.ri(1, d - 1), r2 = t.ri(1, d - 1);
  const prod = (r1 * r2) % d, sq = (r1 * r1 + r2) % d;
  return {
    q: `整数 $a$ を $${d}$ で割ると $${r1}$ 余り、整数 $b$ を $${d}$ で割ると $${r2}$ 余る。$ab$ と $a^2+b$ を $${d}$ で割った余りをそれぞれ求めよ。`,
    form: `$ab$ は $${F.n(prod)}$、$a^2+b$ は $${F.n(sq)}$`,
    steps: [
      `$a=${d}m+${r1}$、$b=${d}n+${r2}$（$m, n$ は整数）とおくと、余りは「余りどうしの計算」で求まる。`,
      `$ab$：$${r1}\\times ${r2}=${r1 * r2}$ を $${d}$ で割った余り → $${prod}$`,
      `$a^2+b$：$${r1}^2+${r2}=${r1 * r1 + r2}$ を $${d}$ で割った余り → $${sq}$`,
    ],
    point: `余りだけが知りたいときは、もとの数を余りに置きかえて計算してよい（合同式の考え方）。最後に割る数より小さくする。`,
  };
});

/* ---------- 追加の問題（2026-11-23） ---------- */
/* 数と式 */
add("num-dblroot", "num", "二重根号", (t, F) => {
  const p = t.ri(2, 9), q = t.ri(2, 8); need(p > q && sqf(p)[0] === 1 && sqf(q)[0] === 1 && sqf(p * q)[0] === 1);
  return {
    q: `$\\sqrt{${p + q}+2\\sqrt{${p * q}}}$ を簡単にせよ。`,
    form: `$\\sqrt{${F.n(p)}}+\\sqrt{${F.n(q)}}$`,
    steps: [
      `足して $${p + q}$、掛けて $${p * q}$ になる2数をさがす：$${p}$ と $${q}$`,
      `$${p + q}+2\\sqrt{${p * q}}=(\\sqrt{${p}})^2+2\\sqrt{${p}}\\sqrt{${q}}+(\\sqrt{${q}})^2=(\\sqrt{${p}}+\\sqrt{${q}})^2$`,
      `$\\sqrt{${p}}+\\sqrt{${q}}>0$ なので、答えは $\\sqrt{${p}}+\\sqrt{${q}}$`,
    ],
    point: `$\\sqrt{a+b+2\\sqrt{ab}}=\\sqrt{a}+\\sqrt{b}$。「足して○、掛けて△」の2数をさがす。$2\\sqrt{\\ }$ の形になっていなければ、先に分母分子を2倍して作る。`,
  };
});

add("num-ineq", "num", "連立1次不等式", (t, F) => {
  const lo = t.ri(-4, 3), hi = lo + t.ri(2, 6), p = t.ri(2, 5), q = t.ri(-9, 9), r = t.ri(2, 4), s = t.ri(1, 9);
  return {
    q: `連立不等式 $\\begin{cases} ${poly([p, q])} > ${p * lo + q} \\\\ ${poly([r, -s])} \\le ${r * hi - s} \\end{cases}$ を解け。また、これを満たす整数 $x$ の個数を求めよ。`,
    form: `$${F.n(lo)} < x \\le ${F.n(hi)}$、整数は $${F.n(hi - lo)}$ 個`,
    steps: [
      q === 0 ? `1つめ：$${p}x > ${p * lo}$ より $x > ${lo}$` : `1つめ：$${p}x > ${p * lo + q}${cfn(-q, "")} = ${p * lo}$ より $x > ${lo}$`,
      `2つめ：$${r}x \\le ${r * hi - s}+${s} = ${r * hi}$ より $x \\le ${hi}$`,
      `共通部分：$${lo} < x \\le ${hi}$。整数は $${lo + 1}$ から $${hi}$ までの $${hi - lo}$ 個`,
    ],
    point: `連立不等式は、それぞれを解いてから数直線で共通部分をとる。等号がつくか（$\\le$）つかないか（$<$）で端の整数が入るかが変わる。`,
  };
});

add("num-frac", "num", "整数部分と小数部分", (t, F) => {
  const n = t.ri(5, 60); const a = Math.floor(Math.sqrt(n)); need(a * a !== n);
  return {
    q: `$\\sqrt{${n}}$ の整数部分を $a$、小数部分を $b$ とする。$a$ の値と、$b^2+2ab$ の値を求めよ。`,
    form: `$a=${F.n(a)}$、$b^2+2ab=${F.n(n - a * a)}$`,
    steps: [
      `$${a}^2=${a * a}<${n}<${(a + 1) ** 2}=${a + 1}^2$ なので $${a}<\\sqrt{${n}}<${a + 1}$、$a=${a}$`,
      `$b=\\sqrt{${n}}-${a}$`,
      `$b^2+2ab=(a+b)^2-a^2=(\\sqrt{${n}})^2-${a}^2=${n}-${a * a}=${n - a * a}$`,
    ],
    point: `整数部分は「はさむ平方数」で決める。小数部分は「もとの数 − 整数部分」。$a+b$ がもとの数になることを使うと計算が楽。`,
  };
});

/* 2次関数 */
add("quad-shift", "quad", "放物線の平行移動", (t, F) => {
  const p = t.ri(-4, 4), q = t.ri(-6, 6), h = t.ri(-4, 4), k = t.ri(-5, 5); need(h !== 0 && k !== 0);
  return {
    q: `放物線 $y=${poly([1, -2 * p, p * p + q])}$ を $x$ 軸方向に $${h}$、$y$ 軸方向に $${k}$ だけ平行移動した放物線の頂点の座標を求めよ。`,
    form: `$(${F.n(p + h)},\\ ${F.n(q + k)})$`,
    steps: [
      `平方完成：$y=${xm(p)}^2${cfn(q, "")}$。もとの頂点は $(${p},\\ ${q})$`,
      `頂点を $x$ 方向に $${h}$、$y$ 方向に $${k}$ 動かす：$(${p}${cfn(h, "")},\\ ${q}${cfn(k, "")})=(${p + h},\\ ${q + k})$`,
    ],
    point: `平行移動はグラフの形を変えず、頂点だけが動く。式で考えるなら $x$ を $x-h$、$y$ を $y-k$ に置きかえる。`,
  };
});

add("quad-find", "quad", "2次関数の決定", (t, F) => {
  const p = t.ri(-3, 3), q = t.ri(-6, 6), a = t.pick([1, 2, 3, -1, -2]), x1 = p + t.pick([-2, -1, 1, 2]);
  const y1 = a * (x1 - p) ** 2 + q, c = a * p * p + q;
  return {
    q: `頂点が $(${p},\\ ${q})$ で、点 $(${x1},\\ ${y1})$ を通る放物線を $y=ax^2+bx+c$ とする。$a$ と $c$ の値を求めよ。`,
    form: `$a=${F.n(a)}$、$c=${F.n(c)}$`,
    steps: [
      `頂点が $(${p},\\ ${q})$ なので $y=a${xm(p)}^2${cfn(q, "")}$ とおける。`,
      `点 $(${x1},\\ ${y1})$ を代入：$${y1}=a\\cdot${par(x1 - p)}^2${cfn(q, "")}$ より $${cf1((x1 - p) ** 2, "a")}=${y1 - q}$${(x1 - p) ** 2 === 1 ? "" : `、$a=${a}$`}`,
      `展開すると定数項は $c=a\\cdot${par(p)}^2${cfn(q, "")}=${c}$`,
    ],
    point: `頂点がわかっているときは $y=a(x-p)^2+q$ とおくと、文字が $a$ だけになる。$c$ は $x=0$ のときの $y$（$y$ 切片）。`,
  };
});

add("quad-area", "quad", "最大・最小の文章題", (t, F) => {
  const L = 2 * t.ri(3, 15);
  return {
    q: `周の長さが $${2 * L}$ の長方形がある。縦の長さを $x$ とするとき、面積の最大値と、そのときの $x$ の値を求めよ。`,
    form: `最大値 $${F.n((L / 2) ** 2)}$（$x=${F.n(L / 2)}$）`,
    steps: [
      `縦 $x$ のとき、横は $${L}-x$（縦＋横＝周の半分 $${L}$）。$0<x<${L}$`,
      `面積 $S=x(${L}-x)=-x^2+${L}x=-(x-${L / 2})^2+${(L / 2) ** 2}$`,
      `$x=${L / 2}$（範囲内）のとき最大値 $${(L / 2) ** 2}$。正方形のとき`,
    ],
    point: `文章題は「何を $x$ にするか」と「$x$ の範囲」を決めてから2次関数にする。最大・最小は平方完成で。`,
  };
});

/* 図形と計量 */
add("trig-cosA", "trig", "3辺から角の余弦", (t, F) => {
  const a = t.ri(3, 9), b = t.ri(3, 9), c = t.ri(3, 9);
  need(a < b + c && b < a + c && c < a + b && !(a === b && b === c));
  const num = b * b + c * c - a * a, den = 2 * b * c; need(num !== 0);
  return {
    q: `$\\triangle ABC$ で $a=${a}$、$b=${b}$、$c=${c}$ のとき、$\\cos A$ の値を求めよ。また、$A$ は鋭角・直角・鈍角のどれか考えよ。`,
    form: `$\\cos A=${F.fr(num, den)}$`,
    steps: [
      `余弦定理を変形：$\\cos A=\\dfrac{b^2+c^2-a^2}{2bc}$`,
      `$=\\dfrac{${b * b}+${c * c}-${a * a}}{2\\cdot ${b}\\cdot ${c}}=${frEq(num, den)}$`,
      num > 0 ? `$\\cos A>0$ なので $A$ は鋭角。` : `$\\cos A<0$ なので $A$ は鈍角。`,
    ],
    point: `3辺がわかれば余弦定理で角の $\\cos$ が出る。$\\cos A$ の符号で、鋭角（$>0$）・直角（$=0$）・鈍角（$<0$）がわかる。`,
  };
});

add("trig-eq", "trig", "三角比の方程式", (t, F) => {
  const kind = t.ri(0, 2);
  if (kind === 0) {
    const [, a1, tex] = t.pick([[1, 30, "\\dfrac{1}{2}"], [2, 45, "\\dfrac{1}{\\sqrt{2}}"], [3, 60, "\\dfrac{\\sqrt{3}}{2}"]]);
    return {
      q: `$0^\\circ\\le\\theta\\le 180^\\circ$ のとき、$\\sin\\theta=${tex}$ を満たす $\\theta$ を小さい順に求めよ。`,
      form: `$\\theta=${F.n(a1)}^\\circ,\\ ${F.n(180 - a1)}^\\circ$`,
      steps: [
        `半径1の半円で、$y$ 座標が $${tex}$ になる点は左右に2つある。`,
        `右側の点：$\\theta=${a1}^\\circ$。左右対称なので左側の点：$\\theta=180^\\circ-${a1}^\\circ=${180 - a1}^\\circ$`,
      ],
      point: `$\\sin\\theta=k\\ (0<k<1)$ の解は $\\theta$ と $180^\\circ-\\theta$ の2つ。半円の図をかくと見落とさない。`,
    };
  }
  const [ang, tex] = kind === 1 ? t.pick([[60, "\\cos\\theta=\\dfrac{1}{2}"], [120, "\\cos\\theta=-\\dfrac{1}{2}"], [135, "\\cos\\theta=-\\dfrac{1}{\\sqrt{2}}"], [150, "\\cos\\theta=-\\dfrac{\\sqrt{3}}{2}"], [30, "\\cos\\theta=\\dfrac{\\sqrt{3}}{2}"]])
    : t.pick([[45, "\\tan\\theta=1"], [135, "\\tan\\theta=-1"], [60, "\\tan\\theta=\\sqrt{3}"], [120, "\\tan\\theta=-\\sqrt{3}"], [150, "\\tan\\theta=-\\dfrac{1}{\\sqrt{3}}"]]);
  return {
    q: `$0^\\circ\\le\\theta\\le 180^\\circ$ のとき、$${tex}$ を満たす $\\theta$ を求めよ。`,
    form: `$\\theta=${F.n(ang)}^\\circ$`,
    steps: [
      kind === 1 ? `半径1の半円で、$x$ 座標が右辺の値になる点は1つだけ。` : `$\\tan\\theta$ は原点と半円上の点を結ぶ直線の傾き。傾きが右辺の値になる点は1つだけ。`,
      `${ang > 90 ? "値が負なので鈍角。" : "値が正なので鋭角。"}$\\theta=${ang}^\\circ$`,
    ],
    point: `$0^\\circ\\le\\theta\\le180^\\circ$ では、$\\cos\\theta$ と $\\tan\\theta$ の値が決まると $\\theta$ は1つ（$\\tan$ は $90^\\circ$ を除く）。負なら鈍角。`,
  };
});

/* データの分析 */
add("data-median", "data", "中央値と範囲", (t, F) => {
  const v = [t.ri(1, 9)]; for (let i = 1; i < 8; i++) v.push(v[i - 1] + t.ri(0, 6));
  need((v[3] + v[4]) % 2 === 0);
  return {
    q: `8個のデータ $${t.shuffle(v).join(",\\ ")}$ の中央値と範囲を求めよ。`,
    form: `中央値 $${F.n((v[3] + v[4]) / 2)}$、範囲 $${F.n(v[7] - v[0])}$`,
    steps: [
      `小さい順に並べる：$${v.join(",\\ ")}$`,
      `個数が偶数（8個）なので、中央値は4番目と5番目の平均：$\\dfrac{${v[3]}+${v[4]}}{2}=${(v[3] + v[4]) / 2}$`,
      `範囲＝最大値−最小値：$${v[7]}-${v[0]}=${v[7] - v[0]}$`,
    ],
    point: `データが偶数個のとき、中央値は真ん中の2つの平均。範囲は最大値−最小値で、外れ値の影響を受けやすい。`,
  };
});

add("data-corr", "data", "相関係数", (t, F) => {
  const sx = t.ri(2, 9), sy = t.ri(2, 9), num = t.ri(-9, 9); need(num !== 0);
  const cov = num * sx * sy / 10; need(Number.isInteger(cov));
  return {
    q: `2つの変量 $x, y$ の標準偏差がそれぞれ $${sx}$、$${sy}$、共分散が $${cov}$ である。相関係数 $r$ を求めよ。`,
    form: `$r=${F.fr(num, 10)}$`,
    steps: [
      `相関係数：$r=\\dfrac{(x \\text{と} y \\text{の共分散})}{(x \\text{の標準偏差})\\times(y \\text{の標準偏差})}$`,
      `$r=\\dfrac{${cov}}{${sx}\\times ${sy}}=${frEq(cov, sx * sy)}$`,
      `${num > 0 ? "正の相関" : "負の相関"}。$|r|$ が1に近いほど相関が強い。`,
    ],
    point: `相関係数は共分散を2つの標準偏差の積で割る。いつも $-1\\le r\\le 1$。単位に関係しないので、ちがう種類のデータどうしでも比べられる。`,
  };
});

/* 場合の数と確率 */
add("prob-letters", "prob", "同じものを含む順列", (t, F) => {
  const [w, cnt] = t.pick([["AABBC", [2, 2, 1]], ["AAABB", [3, 2]], ["AABBBC", [2, 3, 1]], ["AAABBC", [3, 2, 1]], ["AABBCC", [2, 2, 2]], ["AAAABB", [4, 2]], ["AABCDE", [2, 1, 1, 1, 1]], ["AAABBBC", [3, 3, 1]]]);
  const n = w.length, v = fact(n) / cnt.reduce((s, c) => s * fact(c), 1);
  return {
    q: `${[...w].join("、")} の ${n} 文字を1列に並べる方法は何通りか。`,
    form: `$${F.n(v)}$ 通り`,
    steps: [
      `${n} 文字をすべて区別すると $${n}!=${fact(n)}$ 通り。`,
      `同じ文字どうしの入れかえ（${cnt.filter(c => c > 1).map(c => `$${c}!$`).join("、")}）では並びが変わらないので割る。`,
      `$\\dfrac{${n}!}{${cnt.filter(c => c > 1).map(c => `${c}!`).join("\\,")}}=${v}$`,
    ],
    point: `同じものを含む順列：$\\dfrac{n!}{p!\\,q!\\,r!\\cdots}$。「並べる場所を選ぶ」と考えて $_n\\mathrm{C}_p\\times\\cdots$ でも同じ答え。`,
  };
});

add("prob-path", "prob", "最短経路", (t, F) => {
  const m = t.ri(3, 6), n = t.ri(2, 5), via = t.ri(0, 1) === 1;
  if (!via) return {
    q: `東西に $${m}$ 区画、南北に $${n}$ 区画の碁盤の目の道がある。南西の角 A から北東の角 B まで、遠回りせずに行く道順は何通りか。`,
    form: `$${F.n(comb(m + n, n))}$ 通り`,
    steps: [
      `東へ1区画を「→」、北へ1区画を「↑」とすると、どの道順も → $${m}$ 個と ↑ $${n}$ 個の並べ方。`,
      `$${m + n}$ 個の場所から ↑ を置く $${n}$ 個を選ぶ：$_{${m + n}}\\mathrm{C}_{${n}}=${comb(m + n, n)}$`,
    ],
    point: `最短経路は「→ と ↑ の並べ方」。$_{m+n}\\mathrm{C}_n$ で数えられる。`,
  };
  const a = t.ri(1, m - 1), b = t.ri(1, n - 1), v1 = comb(a + b, b), v2 = comb(m - a + n - b, n - b);
  return {
    q: `東西に $${m}$ 区画、南北に $${n}$ 区画の碁盤の目の道がある。南西の角 A から北東の角 B まで遠回りせずに行くとき、A から東へ $${a}$、北へ $${b}$ 区画の交差点 P を通る道順は何通りか。`,
    form: `$${F.n(v1 * v2)}$ 通り`,
    steps: [
      `A → P：→ $${a}$ 個と ↑ $${b}$ 個の並べ方で $_{${a + b}}\\mathrm{C}_{${b}}=${v1}$ 通り`,
      `P → B：→ $${m - a}$ 個と ↑ $${n - b}$ 個で $_{${m - a + n - b}}\\mathrm{C}_{${n - b}}=${v2}$ 通り`,
      `積の法則：$${v1}\\times ${v2}=${v1 * v2}$`,
    ],
    point: `「P を通る」は、A→P と P→B に分けて掛ける。「P を通らない」なら全体から引く。`,
  };
});

add("prob-or", "prob", "和事象の確率", (t, F) => {
  const [a, b] = t.pick([[2, 3], [2, 5], [3, 4], [3, 5], [4, 6]]), N = 10 * t.ri(3, 10);
  const l = a * b / gcd(a, b), na = Math.floor(N / a), nb = Math.floor(N / b), nab = Math.floor(N / l), hit = na + nb - nab;
  return {
    q: `1 から $${N}$ までの番号を書いたカードが1枚ずつある。1枚引くとき、番号が $${a}$ の倍数または $${b}$ の倍数である確率を求めよ。`,
    form: `$${F.fr(hit, N)}$`,
    steps: [
      `$${a}$ の倍数：$${na}$ 枚、$${b}$ の倍数：$${nb}$ 枚`,
      `両方（$${l}$ の倍数）：$${nab}$ 枚。2回数えているので引く：$${na}+${nb}-${nab}=${hit}$ 枚`,
      `確率：$${frEq(hit, N)}$`,
    ],
    point: `「または」は $n(A\\cup B)=n(A)+n(B)-n(A\\cap B)$。両方にあてはまるもの（最小公倍数の倍数）を引くのを忘れない。`,
  };
});

/* 図形の性質 */
add("geo-centers", "geo", "外心・内心と角", (t, F) => {
  const A = 2 * t.ri(20, 40);
  return {
    q: `$\\triangle ABC$ で $\\angle A=${A}^\\circ$ である。外心を O、内心を I とするとき、$\\angle BOC$ と $\\angle BIC$ を求めよ（$\\angle A$ は鋭角）。`,
    form: `$\\angle BOC=${F.n(2 * A)}^\\circ$、$\\angle BIC=${F.n(90 + A / 2)}^\\circ$`,
    steps: [
      `外心 O は外接円の中心。$\\angle BOC$ は弧 BC の中心角で、円周角 $\\angle A$ の2倍：$2\\times ${A}^\\circ=${2 * A}^\\circ$`,
      `内心 I は角の二等分線の交点。$\\angle IBC+\\angle ICB=\\dfrac{1}{2}(\\angle B+\\angle C)=\\dfrac{1}{2}(180^\\circ-${A}^\\circ)=${(180 - A) / 2}^\\circ$`,
      `$\\angle BIC=180^\\circ-${(180 - A) / 2}^\\circ=${90 + A / 2}^\\circ$`,
    ],
    point: `外心：$\\angle BOC=2\\angle A$（$A$ が鋭角のとき）。内心：$\\angle BIC=90^\\circ+\\dfrac{1}{2}\\angle A$。どちらも理由から導けるようにしておく。`,
  };
});

add("geo-incircle", "geo", "内接円と接線の長さ", (t, F) => {
  const a = t.ri(4, 12), b = t.ri(4, 12), c = t.ri(4, 12);
  need(a < b + c && b < a + c && c < a + b && (a + c - b) % 2 === 0);
  const bd = (a + c - b) / 2;
  return {
    q: `$\\triangle ABC$ で $BC=${a}$、$CA=${b}$、$AB=${c}$ である。内接円と辺 BC の接点を D とするとき、$BD$ の長さを求めよ。`,
    form: `$BD=${F.n(bd)}$`,
    steps: [
      `内接円と AB、CA の接点を F、E とする。1点から引いた2本の接線の長さは等しい：$BD=BF=x$、$CD=CE$、$AE=AF$`,
      `$CD=${a}-x$、$AF=${c}-x$。$CA=CE+EA=(${a}-x)+(${c}-x)=${b}$`,
      `$${a + c}-2x=${b}$ より $x=${bd}$`,
    ],
    point: `円の外の1点から引いた2本の接線の長さは等しい。$BD=\\dfrac{AB+BC-CA}{2}$ と覚えておくと速い。`,
  };
});

add("geo-chord", "geo", "円の中で交わる弦", (t, F) => {
  const pa = t.ri(2, 9), pb = t.ri(2, 9), pc = t.ri(2, 9);
  return {
    q: `円の2つの弦 AB、CD が円の内部の点 P で交わっている。$PA=${pa}$、$PB=${pb}$、$PC=${pc}$ のとき、$PD$ の長さを求めよ。`,
    form: `$PD=${F.fr(pa * pb, pc)}$`,
    steps: [
      `方べきの定理（円の内部で交わる場合）：$PA\\cdot PB=PC\\cdot PD$`,
      `$${pa}\\cdot ${pb}=${pc}\\cdot PD$ より $PD=${frEq(pa * pb, pc)}$`,
    ],
    point: `弦が円の内部で交わるときも、外部で交わるときも、方べきの定理は「P から2つの交点までの長さの積が等しい」。`,
  };
});

/* 整数 */
add("int-square", "int", "平方数になる条件", (t, F) => {
  const n = t.pick([12, 18, 20, 24, 28, 40, 45, 48, 50, 54, 60, 63, 72, 75, 80, 84, 90, 98, 108, 120, 126, 135, 150, 180]);
  let k = 1, m = n; for (let p = 2; p <= m; p++) { let e = 0; while (m % p === 0) { m /= p; e++; } if (e % 2) k *= p; }
  return {
    q: `$\\sqrt{${n}k}$ が自然数となるような、最小の自然数 $k$ を求めよ。また、そのときの $\\sqrt{${n}k}$ の値を求めよ。`,
    form: `$k=${F.n(k)}$、$\\sqrt{${n}k}=${F.n(Math.sqrt(n * k))}$`,
    steps: [
      `素因数分解：$${n}=${factTeX(n)}$`,
      `平方数は、どの素因数の指数も偶数。指数が奇数の素因数をもう1つずつ掛ける：$k=${k}$`,
      `$\\sqrt{${n}\\cdot ${k}}=\\sqrt{${n * k}}=${Math.sqrt(n * k)}$`,
    ],
    point: `「$\\sqrt{\\ }$ が自然数」⇔「中身が平方数」⇔「素因数分解したときの指数がすべて偶数」。`,
  };
});

add("int-zeros", "int", "階乗の末尾の0", (t, F) => {
  const n = t.ri(20, 130), z = Math.floor(n / 5) + Math.floor(n / 25) + Math.floor(n / 125);
  return {
    q: `$${n}!$ を計算したとき、末尾に 0 は連続して何個並ぶか。`,
    form: `$${F.n(z)}$ 個`,
    steps: [
      `末尾の0の個数＝素因数 $10=2\\times5$ の個数。2は5より多いので、素因数5の個数を数える。`,
      `5の倍数：$${Math.floor(n / 5)}$ 個、25の倍数：$${Math.floor(n / 25)}$ 個${n >= 125 ? `、125の倍数：$${Math.floor(n / 125)}$ 個` : ""}`,
      `合計：$${[Math.floor(n / 5), Math.floor(n / 25), ...(n >= 125 ? [Math.floor(n / 125)] : [])].join("+")}=${z}$`,
    ],
    point: `末尾の0は「5がいくつあるか」で決まる。25の倍数は5を2つ含むので、もう1回数える。`,
  };
});

add("int-euclid", "int", "ユークリッドの互除法", (t, F) => {
  const g = t.ri(3, 19), m = t.ri(5, 20), n = t.ri(5, 20); need(m > n && gcd(m, n) === 1);
  let A = g * m, B = g * n; need(A < 400);
  const st = []; while (B) { st.push(`${A}=${B}\\times ${Math.floor(A / B)}+${A % B}`); [A, B] = [B, A % B]; }
  return {
    q: `ユークリッドの互除法を用いて、$${g * m}$ と $${g * n}$ の最大公約数を求めよ。`,
    form: `$${F.n(g)}$`,
    steps: [
      `大きい方を小さい方で割り、「割る数と余り」で割り算をくり返す：`,
      ...st.map(s => `$${s}$`),
      `余りが0になったときの割る数 $${g}$ が最大公約数。`,
    ],
    point: `$a=bq+r$ のとき、$a$ と $b$ の最大公約数は $b$ と $r$ の最大公約数に等しい。数が大きくて素因数分解しにくいときに便利。`,
  };
});

/* ---------- レベル3：共通テストの大問の後半・思考力型（場合分け・組み合わせ・条件の読みかえ） ---------- */
const add3 = (...a) => { add(...a); T[T.length - 1].lv = 3; };

/* 数と式 */
add3("num3-abs2", "num", "絶対値2つの不等式（場合分け）", (t, F) => {
  const a = t.ri(-3, 3), b = a + t.ri(1, 5), c = (b - a) + 2 * t.ri(1, 3);
  const lo = (a + b - c) / 2, hi = (a + b + c) / 2;
  return {
    q: `不等式 $\\left|${poly([1, -a])}\\right|+\\left|${poly([1, -b])}\\right|<${c}$ を解け。`,
    form: `$${F.n(lo)}<x<${F.n(hi)}$`,
    steps: [
      `絶対値の中が0になる $x=${a},\\ ${b}$ で場合分けする。`,
      `$x<${a}$ のとき：$-(${poly([1, -a])})-(${poly([1, -b])})<${c}$ より $-2x${cfn(a + b, "")}<${c}$、$x>${lo}$。合わせて $${lo}<x<${a}$`,
      `$${a}\\le x<${b}$ のとき：$(${poly([1, -a])})-(${poly([1, -b])})=${b - a}<${c}$ はいつも成り立つ。$${a}\\le x<${b}$`,
      `$x\\ge ${b}$ のとき：$2x${cfn(-(a + b), "")}<${c}$ より $x<${hi}$。合わせて $${b}\\le x<${hi}$`,
      `3つを合わせて $${lo}<x<${hi}$`,
    ],
    point: `絶対値が2つあるときは、中身が0になる点で数直線を3つに分けて、それぞれ絶対値を外す。各場合の「範囲の条件」と合わせるのを忘れない。数直線上の2点からの距離の和と考えることもできる。`,
  };
});

add3("num3-count", "num", "整数解の個数から定数の範囲", (t, F) => {
  const lo = t.ri(-3, 3), k = t.ri(2, 4), p = t.ri(2, 5), q = t.ri(-6, 6);
  return {
    q: `$x$ についての連立不等式 $\\begin{cases} ${poly([p, q])} > ${p * lo + q} \\\\ x < a \\end{cases}$ を満たす整数 $x$ がちょうど $${k}$ 個となるような定数 $a$ の値の範囲を求めよ。`,
    form: `$${F.n(lo + k)}<a\\le ${F.n(lo + k + 1)}$`,
    steps: [
      `1つめの不等式を解くと $x>${lo}$。よって $${lo}<x<a$`,
      `この範囲の整数は小さい方から $${lo + 1},\\ ${lo + 2},\\ \\dots$。ちょうど $${k}$ 個なら、入るのは $${lo + 1}$ から $${lo + k}$ まで。`,
      `$${lo + k}$ は入る（$${lo + k}<a$）、$${lo + k + 1}$ は入らない（$a\\le ${lo + k + 1}$）`,
      `よって $${lo + k}<a\\le ${lo + k + 1}$`,
    ],
    point: `「整数がちょうど k 個」は数直線をかき、端の整数が入るか入らないかを考える。$a$ がちょうど整数のとき（$a=${lo + k + 1}$ など）に等号が入るかを、実際に代入して確かめる。`,
  };
});

/* 2次関数 */
add3("quad3-param", "quad", "最小値から定数を決める（場合分け）", (t, F) => {
  const w = t.ri(2, 4), c = t.ri(-3, 5), inside = t.ri(0, 1) === 1;
  const a = inside ? t.ri(1, w) : w + t.ri(1, 3);
  const M = inside ? c - a * a : w * w - 2 * a * w + c;
  return {
    q: `$a$ を正の定数とする。関数 $y=x^2-2ax${cfn(c, "")}\\ (0\\le x\\le ${w})$ の最小値が $${M}$ であるとき、$a$ の値を求めよ。`,
    form: `$a=${F.n(a)}$`,
    steps: [
      `$y=(x-a)^2-a^2${cfn(c, "")}$。軸 $x=a$ と範囲 $0\\le x\\le ${w}$ の位置で場合分けする。`,
      `(i) $0<a\\le ${w}$：軸が範囲内なので最小値は $-a^2${cfn(c, "")}$（$x=a$）`,
      `(ii) $a>${w}$：軸が範囲の右なので最小値は $x=${w}$ のとき $${w * w}-${2 * w}a${cfn(c, "")}$`,
      inside ? `(i) で $-a^2${cfn(c, "")}=${M}$ とすると $a^2=${a * a}$、$0<a\\le ${w}$ より $a=${a}$`
        : `(i) の最小値は $${c - w * w}$ 以上なので $${M}$ にはならない。(ii) で $${w * w}-${2 * w}a${cfn(c, "")}=${M}$ とすると $a=${a}$（$a>${w}$ を満たす）`,
    ],
    point: `文字を含む最大・最小は「軸が範囲の中か外か」で場合分け。答えが出たら、その場合分けの条件を満たすか必ず確かめる。`,
  };
});

add3("quad3-pos", "quad", "解の配置（2つの正の解）", (t, F) => {
  const al = t.ri(-4, -1), be = t.ri(1, 6), s = al + be; need(s > 0);
  const c = -al * be;
  return {
    q: `$x$ の2次方程式 $x^2-2mx${cfn(s, "m")}${cfn(c, "")}=0$ が異なる2つの正の解をもつような定数 $m$ の値の範囲を求めよ。`,
    form: `$m>${F.n(be)}$`,
    steps: [
      `$f(x)=x^2-2mx${cfn(s, "m")}${cfn(c, "")}$ のグラフが $x$ 軸の正の部分と2点で交わる条件を考える。`,
      `① 判別式：$\\dfrac{D}{4}=m^2-(${poly([s, c], "m")})=${xm(al, "m")}${xm(be, "m")}>0$ より $m<${al},\\ ${be}<m$`,
      `② 軸 $x=m$ が正：$m>0$`,
      `③ $f(0)>0$：$${poly([s, c], "m")}>0$ より $m>${P().fr(-c, s)}$（負の数）`,
      `①②③をすべて満たすのは $m>${be}$`,
    ],
    point: `解の配置は「判別式・軸の位置・端の値 $f(k)$」の3つの条件で考える。グラフをかいて、どの条件が必要かを確かめる。`,
  };
});

/* 図形と計量 */
add3("trig3-inr", "trig", "3辺から面積と内接円の半径", (t, F) => {
  const a = t.ri(3, 9), b = t.ri(3, 9), c = t.ri(3, 9);
  need(a < b + c && b < a + c && c < a + b);
  const num = b * b + c * c - a * a, D = (2 * b * c) ** 2 - num * num;
  need(sqf(D)[1] <= 60 && num !== 0);
  const P2 = a + b + c;
  const form = `$\\cos A=${F.fr(num, 2 * b * c)}$、$S=${F.rad(1, D, 4)}$、$r=${F.rad(1, D, 2 * P2)}$`;
  need(F.k <= 11);   // 枠が多すぎる数値は使わない
  return {
    q: `$\\triangle ABC$ で $a=${a}$、$b=${b}$、$c=${c}$ である。$\\cos A$、面積 $S$、内接円の半径 $r$ を求めよ。`,
    form,
    steps: [
      `余弦定理：$\\cos A=\\dfrac{${b * b}+${c * c}-${a * a}}{2\\cdot ${b}\\cdot ${c}}=${frEq(num, 2 * b * c)}$`,
      `$\\sin A=\\sqrt{1-\\cos^2 A}=${P().rad(1, D, 2 * b * c)}$（$\\sin A>0$）`,
      `$S=\\dfrac{1}{2}bc\\sin A=\\dfrac{1}{2}\\cdot ${b}\\cdot ${c}\\cdot ${P().rad(1, D, 2 * b * c)}=${P().rad(1, D, 4)}$`,
      `$S=\\dfrac{1}{2}r(a+b+c)$ より $r=\\dfrac{2S}{${P2}}=${P().rad(1, D, 2 * P2)}$`,
    ],
    point: `3辺 → 余弦定理で $\\cos$ → $\\sin^2+\\cos^2=1$ で $\\sin$ → 面積 → 内接円の半径、の流れは共通テストの定番。$S=\\dfrac{1}{2}r(a+b+c)$ は「3つの三角形に分ける」と覚える。`,
  };
});

add3("trig3-cosR", "trig", "余弦定理と外接円", (t, F) => {
  const b = t.ri(2, 8), c = t.ri(2, 8), A = t.pick([60, 120]);
  const a2 = A === 60 ? b * b + c * c - b * c : b * b + c * c + b * c;
  return {
    q: `$\\triangle ABC$ で $b=${b}$、$c=${c}$、$A=${A}^\\circ$ である。辺 $a$ の長さと、外接円の半径 $R$ を求めよ。`,
    form: `$a=${F.rad(1, a2)}$、$R=${F.rad(1, 3 * a2, 3)}$`,
    steps: [
      `余弦定理：$a^2=${b * b}+${c * c}-2\\cdot ${b}\\cdot ${c}\\cos ${A}^\\circ=${a2}$、$a=${P().rad(1, a2)}$`,
      `正弦定理：$2R=\\dfrac{a}{\\sin ${A}^\\circ}=\\dfrac{a}{\\frac{\\sqrt{3}}{2}}$ より $R=\\dfrac{a}{\\sqrt{3}}$`,
      `$R=\\dfrac{${P().rad(1, a2)}}{\\sqrt{3}}=${P().rad(1, 3 * a2, 3)}$（分母を有理化）`,
    ],
    point: `「2辺とその間の角 → 余弦定理で残りの辺 → 正弦定理で外接円」とつなぐ。前の答えを次に使う流れは共通テストの大問でよく出る。`,
  };
});

/* データの分析 */
add3("data3-merge", "data", "2つのグループを合わせた平均と分散", (t, F) => {
  const n1 = t.ri(2, 8), n2 = t.ri(2, 8), m1 = t.ri(3, 12), m2 = t.ri(3, 12), v1 = t.ri(1, 12), v2 = t.ri(1, 12);
  const N = n1 + n2, S = n1 * m1 + n2 * m2; need(S % N === 0 && m1 !== m2);
  const M = S / N, Q = n1 * (v1 + m1 * m1) + n2 * (v2 + m2 * m2); need(Q % N === 0);
  const V = Q / N - M * M;
  return {
    q: `A 組 $${n1}$ 人の得点は平均値 $${m1}$、分散 $${v1}$、B 組 $${n2}$ 人の得点は平均値 $${m2}$、分散 $${v2}$ である。2組を合わせた $${N}$ 人の平均値と分散を求めよ。`,
    form: `平均値 $${F.n(M)}$、分散 $${F.n(V)}$`,
    steps: [
      `合計点：$${n1}\\times ${m1}+${n2}\\times ${m2}=${S}$。平均値 $\\dfrac{${S}}{${N}}=${M}$`,
      `（分散）＝（2乗の平均）−（平均の2乗）より、2乗の和は A 組 $${n1}(${v1}+${m1}^2)=${n1 * (v1 + m1 * m1)}$、B 組 $${n2}(${v2}+${m2}^2)=${n2 * (v2 + m2 * m2)}$`,
      `全体の2乗の平均：$\\dfrac{${Q}}{${N}}=${Q / N}$`,
      `分散：$${Q / N}-${M}^2=${V}$`,
    ],
    point: `分散 $=\\overline{x^2}-(\\bar{x})^2$ を使うと、グループの「2乗の和」が $n(v+m^2)$ で出せる。分散どうしをそのまま平均してはいけない。`,
  };
});

add3("data3-add", "data", "データを1つ加えたときの分散", (t, F) => {
  const n = t.pick([4, 5, 7, 9]), m = t.ri(3, 10), v = (n + 1) * t.ri(1, 3);
  const sq = n * (v + m * m), nv = n * v / (n + 1);
  return {
    q: `$${n}$ 個のデータの平均値が $${m}$、分散が $${v}$ である。このデータの2乗の和を求めよ。また、値 $${m}$ のデータを1つ加えた $${n + 1}$ 個のデータの分散を求めよ。`,
    form: `2乗の和 $${F.n(sq)}$、加えたあとの分散 $${F.n(nv)}$`,
    steps: [
      `（分散）＝（2乗の平均）−（平均の2乗）より、2乗の平均は $${v}+${m}^2=${v + m * m}$`,
      `2乗の和：$${n}\\times ${v + m * m}=${sq}$`,
      `$${m}$ を加えても合計は $${n * m}+${m}=${(n + 1) * m}$、平均値は $${m}$ のまま。2乗の和は $${sq}+${m * m}=${sq + m * m}$`,
      `分散：$\\dfrac{${sq + m * m}}{${n + 1}}-${m}^2=${(sq + m * m) / (n + 1)}-${m * m}=${nv}$`,
    ],
    point: `平均値と同じ値を加えると、平均は変わらず、偏差の2乗の和も変わらないので、分散は $\\dfrac{n}{n+1}$ 倍に小さくなる。`,
  };
});

/* 場合の数と確率 */
add3("prob3-cond", "prob", "順に取り出す確率と条件付き確率", (t, F) => {
  const a = t.ri(2, 6), b = t.ri(2, 6), N = a + b, d = N * (N - 1);
  return {
    q: `赤玉 $${a}$ 個、白玉 $${b}$ 個の入った袋から、玉を1個ずつ2回取り出す（取り出した玉は戻さない）。2回目が赤玉である確率と、2回目が赤玉であったときに1回目も赤玉である条件付き確率を求めよ。`,
    form: `2回目が赤 $${F.fr(a, N)}$、条件付き $${F.fr(a - 1, N - 1)}$`,
    steps: [
      `赤→赤：$\\dfrac{${a}}{${N}}\\times\\dfrac{${a - 1}}{${N - 1}}=\\dfrac{${a * (a - 1)}}{${d}}$、白→赤：$\\dfrac{${b}}{${N}}\\times\\dfrac{${a}}{${N - 1}}=\\dfrac{${a * b}}{${d}}$`,
      `2回目が赤：$\\dfrac{${a * (a - 1)}+${a * b}}{${d}}=${frEq(a * (a - 1) + a * b, d)}$（1回目と同じ確率になる）`,
      `条件付き確率：$\\dfrac{P(\\text{赤→赤})}{P(\\text{2回目が赤})}=\\dfrac{${a * (a - 1)}}{${a * (a - 1) + a * b}}=${P().fr(a - 1, N - 1)}$`,
    ],
    point: `くじ引きは順番によらず当たる確率が同じ。条件付き確率は $P_A(B)=\\dfrac{P(A\\cap B)}{P(A)}$。「何が起こったとわかっているか」を分母にする。`,
  };
});

add3("prob3-exp", "prob", "期待値", (t, F) => {
  const k = t.ri(2, 5), p = t.ri(1, 3), q = t.ri(2, 20);
  const num = p * k * (k + 1) / 2 + q * (6 - k);
  return {
    q: `1個のさいころを投げ、出た目が $${k}$ 以下ならその目の $${p}$ 倍の点、$${k + 1}$ 以上なら $${q}$ 点をもらう。もらえる点の期待値を求めよ。`,
    form: `$${F.fr(num, 6)}$ 点`,
    steps: [
      `目が $1$〜$${k}$ のとき、点は $${Array.from({ length: k }, (_, i) => p * (i + 1)).join(",\\ ")}$（それぞれ確率 $\\dfrac{1}{6}$）`,
      `目が $${k + 1}$〜$6$ のとき $${q}$ 点（確率 $\\dfrac{${6 - k}}{6}$）`,
      `期待値：$\\dfrac{${p * k * (k + 1) / 2}+${q}\\times ${6 - k}}{6}=${frEq(num, 6)}$`,
    ],
    point: `期待値＝（値 × その確率）の和。表を作って「値」と「確率」を並べると間違えにくい。確率の合計が1になるか確かめる。`,
  };
});

add3("prob3-max", "prob", "最大値の確率", (t, F) => {
  const n = t.ri(2, 3), k = t.ri(2, 6), num = k ** n - (k - 1) ** n, den = 6 ** n;
  return {
    q: `$${n}$ 個のさいころを同時に投げるとき、出る目の最大値が $${k}$ である確率を求めよ。`,
    form: `$${F.fr(num, den)}$`,
    steps: [
      `「最大値が $${k}$ 以下」＝すべての目が $${k}$ 以下：$\\left(\\dfrac{${k}}{6}\\right)^{${n}}=\\dfrac{${k ** n}}{${den}}$`,
      `「最大値が $${k - 1}$ 以下」：$\\left(\\dfrac{${k - 1}}{6}\\right)^{${n}}=\\dfrac{${(k - 1) ** n}}{${den}}$`,
      `最大値がちょうど $${k}$：$\\dfrac{${k ** n}-${(k - 1) ** n}}{${den}}=${frEq(num, den)}$`,
    ],
    point: `「最大値がちょうど k」＝「k 以下」−「k−1 以下」。直接数えるより、「以下」の確率の差で考えると速い。`,
  };
});

/* 図形の性質 */
add3("geo3-ratio", "geo", "メネラウスと面積比", (t, F) => {
  const p = t.ri(1, 5), q = t.ri(1, 5), r = t.ri(1, 5), s = t.ri(1, 5);
  need(gcd(p, q) === 1 && gcd(r, s) === 1);
  const ao = p * (r + s), op = q * s;
  return {
    q: `$\\triangle ABC$ の辺 AB を $${p}:${q}$ に分ける点を R、辺 BC を $${r}:${s}$ に分ける点を P とし、AP と CR の交点を O とする。$AO:OP$ と、$\\triangle OBC$ の面積は $\\triangle ABC$ の何倍かを求めよ。`,
    form: `$AO:OP=${F.ratio(ao, op)}$、$${F.fr(op, ao + op)}$ 倍`,
    steps: [
      `$\\triangle ABP$ と直線 RC でメネラウスの定理：$\\dfrac{AR}{RB}\\cdot\\dfrac{BC}{CP}\\cdot\\dfrac{PO}{OA}=1$`,
      `$\\dfrac{${p}}{${q}}\\cdot\\dfrac{${r + s}}{${s}}\\cdot\\dfrac{PO}{OA}=1$ より $AO:OP=${ao}:${op}${gcd(ao, op) > 1 ? `=${P().ratio(ao, op)}` : ""}$`,
      `$\\triangle OBC$ と $\\triangle ABC$ は底辺 BC が共通。高さの比は $OP:AP=${op}:${ao + op}$`,
      `よって $${frEq(op, ao + op)}$ 倍`,
    ],
    point: `交点の比はメネラウスの定理で、「どの三角形」と「どの直線」を使うかを決めるのがカギ。面積比は「底辺が共通なら高さの比」に言いかえる。`,
  };
});

add3("geo3-cyclic", "geo", "円に内接する四角形と対角線", (t, F) => {
  const a = t.ri(2, 8), b = t.ri(2, 8), c = t.ri(2, 8), d = t.ri(2, 8);
  const num = a * a + b * b - c * c - d * d, den = 2 * (a * b + c * d); need(num !== 0 && Math.abs(num) < den);
  const g = gcd(num, den), cn = num / g, cd = den / g;
  // AC² = a² + b² − 2ab cosB = X/Y
  let X = (a * a + b * b) * cd - 2 * a * b * cn, Y = cd; const gg = gcd(X, Y); X /= gg; Y /= gg;
  need(Y <= 9 && sqf(X * Y)[1] <= 99);
  return {
    q: `円に内接する四角形 ABCD で、$AB=${a}$、$BC=${b}$、$CD=${c}$、$DA=${d}$ である。$\\cos\\angle ABC$ と対角線 $AC$ の長さを求めよ。`,
    form: `$\\cos\\angle ABC=${F.fr(num, den)}$、$AC=${F.rad(1, X * Y, Y)}$`,
    steps: [
      `$\\angle ABC=\\theta$ とすると、内接四角形なので $\\angle ADC=180^\\circ-\\theta$、$\\cos\\angle ADC=-\\cos\\theta$`,
      `$\\triangle ABC$ で $AC^2=${a * a}+${b * b}-2\\cdot ${a}\\cdot ${b}\\cos\\theta$、$\\triangle ADC$ で $AC^2=${c * c}+${d * d}+2\\cdot ${c}\\cdot ${d}\\cos\\theta$`,
      `2式を等しいとおく：$${2 * (a * b + c * d)}\\cos\\theta=${num}$、$\\cos\\theta=${frEq(num, den)}$`,
      `$AC^2=${a * a + b * b}-${2 * a * b}\\cdot\\left(${P().fr(num, den)}\\right)=${P().fr(X, Y)}$、$AC=${P().rad(1, X * Y, Y)}$`,
    ],
    point: `内接四角形は「向かい合う角の和が $180^\\circ$」から $\\cos$ の符号が逆になる。対角線を2つの三角形で余弦定理に入れ、等しいとおく。`,
  };
});

/* 整数 */
add3("int3-count", "int", "不定方程式の正の整数解", (t, F) => {
  const a = t.ri(2, 9), b = t.ri(2, 9), c = t.ri(25, 90); need(a !== b && gcd(a, b) === 1);
  const sols = []; for (let x = 1; a * x < c; x++) if ((c - a * x) % b === 0 && (c - a * x) / b >= 1) sols.push([x, (c - a * x) / b]);
  need(sols.length >= 2);
  const [x0, y0] = sols[0];
  return {
    q: `方程式 $${a}x+${b}y=${c}$ を満たす正の整数の組 $(x,\\ y)$ は何組あるか。また、そのうち $x$ が最も小さい組を求めよ。`,
    form: `$${F.n(sols.length)}$ 組、$(x,\\ y)=(${F.n(x0)},\\ ${F.n(y0)})$`,
    steps: [
      `$x=1,2,\\dots$ と調べると $(x,y)=(${x0},${y0})$ が解。`,
      `$${a}(x-${x0})=-${b}(y-${y0})$。$${a}$ と $${b}$ は互いに素なので $x=${x0}+${b}k$、$y=${y0}-${a}k$（$k$ は整数）`,
      `$x\\ge 1$、$y\\ge 1$ となる $k$ は $0\\le k\\le ${sols.length - 1}$。解は $${sols.map(([x, y]) => `(${x},${y})`).join(",\\ ")}$`,
      `よって $${sols.length}$ 組`,
    ],
    point: `1組の解から一般解を作り、「正の整数」という条件を $k$ の不等式に直す。$x$ が $b$ ずつ増えると $y$ は $a$ ずつ減る。`,
  };
});

add3("int3-cycle", "int", "累乗の余りの周期", (t, F) => {
  const a = t.pick([2, 3, 5]), m = t.pick([5, 7, 9, 11, 13]), n = t.ri(20, 99); need(gcd(a, m) === 1);
  const rs = []; let v = 1; do { v = (v * a) % m; rs.push(v); } while (v !== 1);
  const L = rs.length; need(L >= 3 && L <= 6);
  const r = rs[(n - 1) % L];
  return {
    q: `$${a}^{${n}}$ を $${m}$ で割った余りを求めよ。`,
    form: `$${F.n(r)}$`,
    steps: [
      `$${a}^1, ${a}^2, \\dots$ を $${m}$ で割った余りを順に求める：$${rs.join(",\\ ")}$（$${a}^{${L}}$ の余りが1）`,
      `余りは $${L}$ 個ごとにくり返す。$${n}=${L}\\times ${Math.floor(n / L)}+${n % L}$`,
      n % L === 0 ? `$${a}^{${n}}=(${a}^{${L}})^{${n / L}}$ の余りは $1^{${n / L}}=1$` : `$${a}^{${n}}=(${a}^{${L}})^{${Math.floor(n / L)}}\\cdot ${a}^{${n % L}}$ の余りは $${a}^{${n % L}}$ の余りと同じで $${r}$`,
    ],
    point: `累乗の余りは必ずくり返す（周期がある）。余りが1になる累乗を見つけ、指数をその周期で割った余りを見る。`,
  };
});

/* ---------- 追加（2026-11-24）：図の問題・完全順列・会話や日常の形式・幾何 ---------- */
/* データの分析（図） */
add("data-boxread", "data", "箱ひげ図を読む", (t, F) => {
  const vs = t.shuffle(Array.from({ length: 21 }, (_, i) => i * 5)).slice(0, 5).sort((a, b) => a - b);
  need(vs[4] - vs[0] >= 40 && vs[3] - vs[1] >= 10);
  const [mn, q1, q2, q3, mx] = vs;
  return {
    q: `次の箱ひげ図は、あるクラスの小テスト（100点満点）の得点を表したものである。中央値、四分位範囲、範囲を求めよ。`,
    fig: boxSVG(vs, 0, 100, 10),
    form: `中央値 $${F.n(q2)}$ 点、四分位範囲 $${F.n(q3 - q1)}$ 点、範囲 $${F.n(mx - mn)}$ 点`,
    steps: [
      `箱の中の線が中央値：$${q2}$ 点`,
      `箱の左端が第1四分位数 $Q_1=${q1}$、右端が第3四分位数 $Q_3=${q3}$。四分位範囲は $${q3}-${q1}=${q3 - q1}$`,
      `ひげの両端が最小値 $${mn}$ と最大値 $${mx}$。範囲は $${mx}-${mn}=${mx - mn}$`,
    ],
    point: `箱ひげ図は左から「最小値・$Q_1$・中央値・$Q_3$・最大値」。箱の長さが四分位範囲（真ん中の約半分のデータのちらばり）。平均値は箱ひげ図からは読めない。`,
  };
});

add("data-boxmatch", "data", "データに合う箱ひげ図", (t, F) => {
  const v = [t.ri(2, 8)]; for (let i = 1; i < 11; i++) v.push(v[i - 1] + t.ri(1, 5));
  need(v[10] <= 50);
  const five = [v[0], v[2], v[5], v[8], v[10]];
  // まちがいの図：Q1・中央値・Q3・最大値のどれか1つを、見て分かるだけずらす
  const make = (k) => {
    const f = five.slice(), d = t.pick([-1, 1]) * t.ri(3, 6);
    f[k] += d;
    return f.every((x, i) => i === 0 || x >= f[i - 1]) && f[4] <= 50 && f[0] >= 0 ? f : null;
  };
  const wrong = [];
  for (const k of t.shuffle([1, 2, 3, 4, 1, 3])) {
    const f = make(k);
    if (f && !wrong.some(w => w.join() === f.join()) && f.join() !== five.join()) wrong.push(f);
    if (wrong.length === 3) break;
  }
  need(wrong.length === 3);
  const all = t.shuffle([five, ...wrong]), ans = all.findIndex(f => f === five);
  return {
    q: `次の11個のデータの箱ひげ図として正しいものを、⓪〜③のうちから一つ選べ。<br>$${t.shuffle(v).join(",\\ ")}$`,
    choices: all.map(f => boxSVG(f, 0, 50, 10, { w: 300, h: 78, grid: false, label: "箱ひげ図の選択肢" })),
    form: `正しいのは ${F.ch(ans, 4)}`,
    steps: [
      `小さい順に並べる：$${v.join(",\\ ")}$`,
      `11個なので中央値は6番目 $${five[2]}$。下の5個の中央値（3番目）$Q_1=${five[1]}$、上の5個の中央値（9番目）$Q_3=${five[3]}$`,
      `最小値 $${five[0]}$、最大値 $${five[4]}$。5つの値がすべて合うのは ${CIRC[ans]}`,
    ],
    point: `選ぶ問題は「5つの値」を先に求め、選択肢の図をひとつずつ消していく。ちがいが出やすいのは $Q_1$・$Q_3$（箱の端）と中央値。`,
  };
});

add("data-scatter", "data", "散布図と相関係数", (t, F) => {
  const targets = [-0.9, -0.5, 0, 0.5, 0.9], ti = t.ri(0, 4), rho = targets[ti];
  const nrm = () => Math.sqrt(-2 * Math.log(1 - t.rand())) * Math.cos(2 * Math.PI * t.rand());
  const pts = Array.from({ length: 24 }, () => { const x = nrm(); return [x, rho * x + Math.sqrt(1 - rho * rho) * nrm()]; });
  const mx = pts.reduce((s, p) => s + p[0], 0) / 24, my = pts.reduce((s, p) => s + p[1], 0) / 24;
  let sxy = 0, sxx = 0, syy = 0; pts.forEach(([x, y]) => { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; });
  const r = sxy / Math.sqrt(sxx * syy); need(Math.abs(r - rho) < 0.08);
  const W = 240, X = (x) => 20 + (x + 2.8) / 5.6 * (W - 30), Y = (y) => W - 20 - (y + 2.8) / 5.6 * (W - 30);
  need(pts.every(([x, y]) => Math.abs(x) < 2.7 && Math.abs(y) < 2.7));
  let b = sv.line(20, W - 20, W - 10, W - 20, "ax") + sv.line(20, 10, 20, W - 20, "ax") + sv.text(W - 10, W - 6, "x", "sm", "end") + sv.text(12, 16, "y", "sm");
  pts.forEach(([x, y]) => { b += sv.circ(X(x), Y(y), 3.2, "dot"); });
  const desc = rho > 0 ? "右上がり" : rho < 0 ? "右下がり" : "右上がりでも右下がりでもない";
  return {
    q: `次の散布図は、ある24人の2つの変量 $x, y$ の値を表したものである。$x$ と $y$ の相関係数に最も近い値を、⓪〜④のうちから一つ選べ。`,
    fig: sv.svg(W, W, b, "散布図"),
    choices: targets.map(v => `$${v}$`),
    form: `最も近いのは ${F.ch(ti, 5)}`,
    steps: [
      `点の並び方は${desc}。${rho > 0 ? "正の相関なので $r>0$" : rho < 0 ? "負の相関なので $r<0$" : "相関はほとんどないので $r$ は $0$ に近い"}`,
      rho === 0 ? `よって ${CIRC[ti]}（$0$）` : `点が直線のまわりに${Math.abs(rho) > 0.7 ? "ぎゅっと集まっている" : "ある程度ちらばっている"}ので、$|r|$ は${Math.abs(rho) > 0.7 ? "1に近い" : "中くらい"}。よって ${CIRC[ti]}（$${rho}$）`,
    ],
    point: `相関係数は「向き（＋か−か）」と「直線への集まり具合（$|r|$ の大きさ）」の2つで読む。$|r|$ が1に近いほど直線に近い。`,
  };
});

add("data-talk", "data", "記録のまちがいと平均値（会話）", (t, F) => {
  const n = 10, m = t.ri(52, 78), a = t.ri(30, 90), j = t.pick([-3, -2, -1, 1, 2, 3]), b = a + 10 * j; need(b >= 0 && b <= 100);
  return {
    talk: talk(["花子", `10人の小テストの平均値を計算したら $${m}$ 点だったよ。`], ["太郎", `あれ、ぼくの点は $${b}$ 点なのに、表には $${a}$ 点と書いてある。`], ["花子", `じゃあ、平均値を直さないといけないね。`]),
    q: `正しい平均値と、正しい合計点を求めよ。`,
    form: `平均値 $${F.n(m + j)}$ 点、合計 $${F.n(n * m + 10 * j)}$ 点`,
    steps: [
      `まちがった合計：$${m}\\times 10=${n * m}$ 点`,
      `正しい合計：$${n * m}${cfn(b - a, "")}=${n * m + 10 * j}$ 点（$${b}-${a}=${b - a}$ 点の差を直す）`,
      `正しい平均値：$${n * m + 10 * j}\\div 10=${m + j}$ 点`,
    ],
    point: `平均値の直しは「合計にもどして直す」。1人の点が $d$ 点ずれると、$n$ 人の平均値は $\\dfrac{d}{n}$ だけずれる。`,
  };
});

/* 2次関数（図） */
add("quad-sign", "quad", "グラフから係数の符号", (t, F) => {
  const a = t.pick([1, 0.5, -1, -0.5]), p = t.pick([-2, -1.5, -1, 1, 1.5, 2]), q = t.pick([-3, -2, -1.5, 1.5, 2, 3]);
  const b = -2 * a * p, c = a * p * p + q; need(Math.abs(c) >= 0.5 && Math.abs(c) <= 3.8);   // y 軸との交点が図の中に入るように
  const sg = (v) => (v > 0 ? ">" : "<");
  const combo = (sa, sb, sc) => `$a${sa}0,\\ b${sb}0,\\ c${sc}0$`;
  const right = combo(sg(a), sg(b), sg(c));
  const all8 = [];
  for (const x of [">", "<"]) for (const y of [">", "<"]) for (const z of [">", "<"]) all8.push(combo(x, y, z));
  const choices = t.shuffle([right, ...t.shuffle(all8.filter(s => s !== right)).slice(0, 3)]), ans = choices.indexOf(right);
  return {
    q: `2次関数 $y=ax^2+bx+c$ のグラフが下の図のようになるとき、$a, b, c$ の符号の組として正しいものを、⓪〜③のうちから一つ選べ。`,
    fig: parabolaSVG(a, p, q, { label: "放物線のグラフ" }),
    choices,
    form: `正しいのは ${F.ch(ans, 4)}`,
    steps: [
      `グラフが${a > 0 ? "下に凸" : "上に凸"}なので $a${sg(a)}0$`,
      `$y$ 軸との交点（$x=0$ のときの $y=c$）が $y$ 軸の${c > 0 ? "正" : "負"}の部分にあるので $c${sg(c)}0$`,
      `軸 $x=-\\dfrac{b}{2a}$ が $y$ 軸の${p > 0 ? "右" : "左"}にあるので $-\\dfrac{b}{2a}${p > 0 ? ">" : "<"}0$。$a${sg(a)}0$ だから $b${sg(b)}0$`,
      `よって ${CIRC[ans]}`,
    ],
    point: `$a$ は「凸の向き」、$c$ は「$y$ 切片」、$b$ は「軸の位置と $a$ の符号」で決まる。$b$ は $a$ と軸の位置の両方を見るのがコツ。`,
  };
});

add("quad-graph", "quad", "式に合うグラフ", (t, F) => {
  const a = t.pick([1, -1]), p = t.pick([-2, -1, 1, 2]), q = t.pick([-2, -1, 1, 2]);
  const sets = [[a, p, q], [-a, p, q], [a, -p, q], [a, p, -q]];
  const order = t.shuffle([0, 1, 2, 3]), ans = order.indexOf(0);
  return {
    q: `2次関数 $y=${cf1(a, `${xm(p)}^2`)}${cfn(q, "")}$ のグラフを、⓪〜③のうちから一つ選べ。（1目盛りは1）`,
    choices: order.map(k => parabolaSVG(...sets[k], { unit: 15, R: 4, grid: true, vertex: true, label: "グラフの選択肢" })),
    form: `正しいのは ${F.ch(ans, 4)}`,
    steps: [
      `$y=a(x-p)^2+q$ の形なので、頂点は $(${p},\\ ${q})$`,
      `$x^2$ の係数が${a > 0 ? "正なので下に凸" : "負なので上に凸"}`,
      `頂点が $(${p},\\ ${q})$ で${a > 0 ? "下に凸" : "上に凸"}のグラフは ${CIRC[ans]}`,
    ],
    point: `グラフを選ぶときは「頂点の位置」と「凸の向き」を先に決める。$(x-p)$ の符号は頂点の $x$ 座標と逆になることに注意。`,
  };
});

add3("quad-sales", "quad", "売上を最大にする値段（会話）", (t, F) => {
  const k = t.pick([2, 4, 5, 10]), ts = t.ri(1, 8), p0 = 10 * t.ri(8, 20), n0 = k * (2 * ts + p0 / 10);
  const price = p0 + 10 * ts, cnt = n0 - k * ts, R = price * cnt;
  return {
    talk: talk(["太郎", `文化祭の模擬店で、ジュースを1杯 $${p0}$ 円で売ると $${n0}$ 杯売れそうなんだ。`], ["花子", `去年の記録だと、10円値上げするごとに $${k}$ 杯ずつ売れる数が減っていたよ。`], ["太郎", `売上（値段×杯数）がいちばん多くなる値段を考えよう。`]),
    q: `10円ずつ値上げするとして、売上が最大になる1杯の値段と、そのときの売上を求めよ。`,
    form: `値段 $${F.n(price)}$ 円、売上 $${F.n(R)}$ 円`,
    steps: [
      `$x$ 回（$10x$ 円）値上げすると、値段は $${p0}+10x$ 円、杯数は $${n0}-${k}x$ 杯`,
      `売上 $y=(${p0}+10x)(${n0}-${k}x)=${poly([-10 * k, 10 * n0 - k * p0, p0 * n0])}$`,
      `平方完成：$y=-${10 * k}(x-${ts})^2+${R}$。$x=${ts}$ のとき最大`,
      `値段は $${p0}+${10 * ts}=${price}$ 円、杯数は $${cnt}$ 杯、売上は $${R}$ 円`,
    ],
    point: `文章題は「何を $x$ にするか」を決めて2次関数を作り、平方完成で最大を見る。$x$ が整数（値上げの回数）であることも確かめる。`,
  };
});

/* 図形と計量（日常・図） */
add("trig-height", "trig", "木の高さを測る（会話）", (t, F) => {
  const th = t.pick([30, 45, 60]), d = th === 30 ? 3 * t.ri(2, 8) : t.ri(4, 15);
  const W = 320, gy = 176, ix = 40, iy = gy - 22, tx = 270, ty = 46;
  const ang = Math.atan2(iy - ty, tx - ix) * 180 / Math.PI;
  let b = sv.line(10, gy, W - 10, gy, "ax") + sv.line(ix, gy, ix, iy) + sv.line(tx, gy, tx, ty) + sv.circ(tx, ty - 8, 10)
    + sv.line(ix, iy, tx, ty, "hi") + sv.line(ix, iy, tx, iy, "ax dash") + sv.arc(ix, iy, 30, 0, ang)
    + sv.text(ix + 46, iy - 6, `${th}°`, "") + sv.text((ix + tx) / 2, gy + 16, `${d} m`, "") + sv.text(ix - 6, gy - 8, "1 m", "sm", "end") + sv.text(tx + 8, (gy + ty) / 2, "木", "", "start");
  const formAns = th === 45 ? `$${F.n(d + 1)}$` : `$${F.rad(th === 30 ? d / 3 : d, 3)}+1$`;
  const top = th === 45 ? `${d}` : th === 30 ? `${d}\\times\\dfrac{1}{\\sqrt{3}}=${P().rad(d / 3, 3)}` : `${d}\\sqrt{3}`;
  return {
    talk: talk(["太郎", `木の高さを、木に登らずに測る方法はないかな。`], ["花子", `木から $${d}$ m はなれた所に、高さ $1$ m の台を置いて、木のてっぺんを見上げた角を測ったよ。$${th}^\\circ$ だった。`]),
    q: `木の高さを求めよ。ただし、地面は水平で、木はまっすぐ立っているものとする。`,
    fig: sv.svg(W, 196, b, "木の高さを測る図"),
    form: `${formAns} m`,
    steps: [
      `台の高さ（地面から $1$ m）の水平な線より上の部分を考える。直角三角形で、底辺 $${d}$ m、見上げた角 $${th}^\\circ$`,
      `高さ＝底辺 × $\\tan ${th}^\\circ$：$${top}$ m`,
      `台の高さ $1$ m を足す：$${th === 45 ? `${d}+1=${d + 1}` : `${top.split("=").pop()}+1`}$ m`,
    ],
    point: `「見上げた角」と「水平の距離」がわかれば、$\\tan$ で高さが出る。測る人（台）の高さを足すのを忘れない。`,
  };
});

add3("trig-survey", "trig", "2地点から塔の高さ（会話）", (t, F) => {
  const d = 2 * t.ri(5, 30);
  const gy = 176, ax = 40, bx = 170, hx = 300, py = 40;
  const a1 = Math.atan2(gy - py, hx - ax) * 180 / Math.PI, a2 = Math.atan2(gy - py, hx - bx) * 180 / Math.PI;
  const b = sv.line(10, gy, 330, gy, "ax") + sv.line(hx, gy, hx, py) + sv.line(ax, gy, hx, py, "hi") + sv.line(bx, gy, hx, py, "hi")
    + sv.arc(ax, gy, 34, 0, a1) + sv.arc(bx, gy, 26, 0, a2) + sv.text(ax + 48, gy - 6, "30°") + sv.text(bx + 38, gy - 8, "60°")
    + sv.text(ax, gy + 16, "A") + sv.text(bx, gy + 16, "B") + sv.text(hx, gy + 16, "H") + sv.text(hx + 8, py + 4, "P", "", "start")
    + sv.text((ax + bx) / 2, gy + 16, `${d} m`, "sm");
  return {
    talk: talk(["花子", `塔のふもとの H までは川があって行けないね。`], ["太郎", `H に向かってまっすぐ進みながら2回見上げよう。A では $30^\\circ$、そこから $${d}$ m 進んだ B では $60^\\circ$ だった。`]),
    q: `塔の高さ $PH$ と、B から塔のふもとまでの距離 $BH$ を求めよ（目の高さは考えない）。`,
    fig: sv.svg(340, 196, b, "塔の高さを測る図"),
    form: `$PH=${F.rad(d, 3, 2)}$ m、$BH=${F.n(d / 2)}$ m`,
    steps: [
      `$\\triangle ABP$ で、$\\angle PBH=60^\\circ$ は外角なので $\\angle APB=60^\\circ-30^\\circ=30^\\circ$`,
      `$\\angle PAB=\\angle APB=30^\\circ$ より、二等辺三角形で $BP=AB=${d}$ m`,
      `直角三角形 $PBH$ で $PH=BP\\sin 60^\\circ=${d}\\times\\dfrac{\\sqrt{3}}{2}=${P().rad(d, 3, 2)}$、$BH=BP\\cos 60^\\circ=${d / 2}$`,
    ],
    point: `2地点から見上げる問題は、外角で「間の三角形の角」を出すと二等辺三角形が見つかることが多い。見つからなければ $BH=x$ とおいて $\\tan$ の式を2つ立てる。`,
  };
});

/* 場合の数と確率（完全順列・日常） */
const DER = [1, 0, 1, 2, 9, 44, 265, 1854];
add("prob-derange", "prob", "完全順列（プレゼント交換）", (t, F) => {
  const n = t.ri(3, 6);
  return {
    talk: talk(["花子", `${n}人でプレゼントを1つずつ持ち寄って、交換会をしよう。`], ["太郎", `自分のプレゼントが自分に戻ってきたらつまらないね。`]),
    q: `${n}人全員が自分以外の人のプレゼントを受け取るような受け取り方は何通りか。`,
    form: `$${F.n(DER[n])}$ 通り`,
    steps: [
      `全員が自分のもの以外を受け取る並べ方を「完全順列」という。人数ごとに $1$人：$0$、$2$人：$1$、$3$人：$2$ 通り`,
      `$n$ 人の数を $W_n$ とすると $W_n=(n-1)(W_{n-1}+W_{n-2})$（1人目が受け取る相手を $n-1$ 通り選び、その相手が1人目のものを受け取るかどうかで分ける）`,
      ...[4, 5, 6].filter(k => k <= n).map(k => `$W_${k}=${k - 1}\\times(${DER[k - 1]}+${DER[k - 2]})=${DER[k]}$`),
      `よって $${DER[n]}$ 通り`,
    ],
    point: `完全順列の数 $2,\\ 9,\\ 44,\\ 265$（3〜6人）は覚えておくと速い。4人までなら樹形図でも数えられる。`,
  };
});

add3("prob-derange2", "prob", "ちょうど k 人が自分のものを受け取る", (t, F) => {
  const n = t.ri(4, 6), k = t.ri(1, n - 2), ways = comb(n, k) * DER[n - k];
  return {
    talk: talk(["太郎", `${n}人のプレゼント交換で、くじで受け取るプレゼントを決めたよ。`], ["花子", `自分のプレゼントが戻ってきた人が、ちょうど ${k} 人いたね。`]),
    q: `くじの引き方は全部で $${n}!$ 通りで、どれも同じ確からしさとする。ちょうど ${k} 人が自分のプレゼントを受け取る受け取り方は何通りか。また、その確率を求めよ。`,
    form: `$${F.n(ways)}$ 通り、確率 $${F.fr(ways, fact(n))}$`,
    steps: [
      `自分のものを受け取る ${k} 人の選び方：$_{${n}}\\mathrm{C}_{${k}}=${comb(n, k)}$ 通り`,
      `残りの ${n - k} 人は全員が自分以外を受け取る（完全順列）：$${DER[n - k]}$ 通り`,
      `$${comb(n, k)}\\times ${DER[n - k]}=${ways}$ 通り。確率は $\\dfrac{${ways}}{${fact(n)}}=${P().fr(ways, fact(n))}$`,
    ],
    point: `「ちょうど $k$ 人」は、その $k$ 人を選んでから、残りを完全順列にする。残りに自分のものを受け取る人が出ないようにするのがポイント。`,
  };
});

add("prob-janken", "prob", "じゃんけんの確率（会話）", (t, F) => {
  const n = t.ri(2, 4), one = t.ri(0, 1) === 1;
  const all = 3 ** n, win1 = n * 3, decided = 3 * (2 ** n - 2), aiko = all - decided;
  return {
    talk: talk(["太郎", `${n}人で1回じゃんけんをして、そうじ当番を決めよう。`], ["花子", `${one ? "1人だけが勝ったら、その人は当番なしにしよう。" : "あいこになったら、もう1回だね。"}`]),
    q: `${n}人が1回じゃんけんをするとき、${one ? "1人だけが勝つ" : "あいこになる"}確率を求めよ。ただし、どの手を出すことも同様に確からしいとする。`,
    form: `$${F.fr(one ? win1 : aiko, all)}$`,
    steps: [
      `手の出し方は全部で $3^{${n}}=${all}$ 通り`,
      one ? `勝つ人の選び方 $${n}$ 通り × 勝つ手（グー・チョキ・パー）$3$ 通り $=${win1}$ 通り（他の人はみんな負ける手）`
        : `勝負がつくのは「2種類の手だけが出る」とき。手の2種類の選び方 $3$ 通り × その2種類の出し方 $2^{${n}}-2$ 通り $=${decided}$ 通り`,
      one ? `確率：$${frEq(win1, all)}$` : `あいこは $${all}-${decided}=${aiko}$ 通り。確率：$${frEq(aiko, all)}$`,
    ],
    point: `じゃんけんは「どの手で、だれが勝つか」で数える。あいこは「全部同じ手」か「3種類全部出る」ときで、余事象（勝負がつく）から求めると速い。`,
  };
});

/* 整数（日常） */
add("int-calendar", "int", "何日後の曜日（日常）", (t, F) => {
  const WD = ["日", "月", "火", "水", "木", "金", "土"], w = t.ri(0, 6), n = t.ri(50, 400), r = n % 7, ans = (w + r) % 7;
  return {
    talk: talk(["花子", `今日は${WD[w]}曜日だね。`], ["太郎", `ちょうど $${n}$ 日後が試験日なんだ。何曜日になるかな。`]),
    q: `$${n}$ 日後は何曜日か。⓪〜⑥のうちから一つ選べ。`,
    choices: WD.map(x => `${x}曜日`),
    form: `${F.ch(ans, 7)}`,
    steps: [
      `曜日は7日ごとにくり返す。$${n}=7\\times ${Math.floor(n / 7)}+${r}$`,
      `$${n}$ 日後は、$${r}$ 日後と同じ曜日`,
      `${WD[w]}曜日の $${r}$ 日後は${WD[ans]}曜日。よって ${CIRC[ans]}`,
    ],
    point: `くり返すものは「割った余り」で考える。曜日なら7、時計なら12や24で割る。`,
  };
});

/* 図形の性質（図） */
add("geo-fig-angle", "geo", "円周角と中心角（図）", (t, F) => {
  const x = 5 * t.ri(5, 15), cx = 120, cy = 112, R = 84;
  const Pt = (a) => [cx + R * Math.cos(a * Math.PI / 180), cy - R * Math.sin(a * Math.PI / 180)];
  const A = Pt(125), D = Pt(55), B = Pt(-90 - x), C = Pt(-90 + x);
  const lab = (pt, s, a) => sv.text(pt[0] + 14 * Math.cos(a * Math.PI / 180), pt[1] - 14 * Math.sin(a * Math.PI / 180) + 4, s);
  const b = sv.circ(cx, cy, R) + sv.line(...A, ...B) + sv.line(...A, ...C) + sv.line(...D, ...B, "hi") + sv.line(...D, ...C, "hi")
    + sv.line(cx, cy, ...B, "ax") + sv.line(cx, cy, ...C, "ax") + sv.circ(cx, cy, 2.5, "dot")
    + lab(A, "A", 125) + lab(D, "D", 55) + lab(B, "B", -90 - x) + lab(C, "C", -90 + x) + sv.text(cx, cy + 16, "O", "sm")
    // 角の大きさは、A から BC の中点へ向かう向き（∠BAC の内側）に置く
    + (() => { const mx = (B[0] + C[0]) / 2 - A[0], my = (B[1] + C[1]) / 2 - A[1], L = Math.hypot(mx, my); return sv.text(A[0] + mx / L * 34, A[1] + my / L * 34 + 4, `${x}°`, "sm"); })();
  return {
    q: `図のように、円 O の周上に4点 A、B、C、D がある。$\\angle BAC=${x}^\\circ$ のとき、$\\angle BDC$ と $\\angle BOC$ を求めよ。`,
    fig: sv.svg(240, 224, b, "円周角の図"),
    form: `$\\angle BDC=${F.n(x)}^\\circ$、$\\angle BOC=${F.n(2 * x)}^\\circ$`,
    steps: [
      `$\\angle BAC$ と $\\angle BDC$ は、どちらも弧 BC に対する円周角なので等しい：$${x}^\\circ$`,
      `$\\angle BOC$ は弧 BC に対する中心角。円周角の2倍：$${2 * x}^\\circ$`,
    ],
    point: `同じ弧に対する円周角はすべて等しく、中心角はその2倍。図の中で「どの弧を見ている角か」を確かめる。`,
  };
});

add("geo-fig-parallel", "geo", "平行線と線分の比（図）", (t, F) => {
  const a = t.ri(2, 7), bb = t.ri(1, 6), c = t.ri(4, 15), e = t.ri(2, 9);
  const A = [160, 18], B = [30, 196], C = [300, 196], k = a / (a + bb);
  const D = [A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k], E = [A[0] + (C[0] - A[0]) * k, A[1] + (C[1] - A[1]) * k];
  const mid = (P1, P2, dx, dy, s) => sv.text((P1[0] + P2[0]) / 2 + dx, (P1[1] + P2[1]) / 2 + dy, s, "sm");
  const b = sv.poly([A, B, C], "", true) + sv.line(...D, ...E, "hi")
    + sv.text(A[0], A[1] - 4, "A") + sv.text(B[0] - 10, B[1] + 4, "B") + sv.text(C[0] + 10, C[1] + 4, "C") + sv.text(D[0] - 10, D[1] + 4, "D") + sv.text(E[0] + 10, E[1] + 4, "E")
    + mid(A, D, -14, 0, a) + mid(D, B, -14, 0, bb) + mid(B, C, 0, 16, c) + mid(A, E, 14, 0, e);
  return {
    q: `図の $\\triangle ABC$ で、辺 AB 上の点 D と辺 AC 上の点 E について $DE\\parallel BC$ である。$AD=${a}$、$DB=${bb}$、$BC=${c}$、$AE=${e}$ のとき、$DE$ と $EC$ の長さを求めよ。`,
    fig: sv.svg(330, 212, b, "平行線と三角形の図"),
    form: `$DE=${F.fr(a * c, a + bb)}$、$EC=${F.fr(e * bb, a)}$`,
    steps: [
      `$DE\\parallel BC$ より $\\triangle ADE$ と $\\triangle ABC$ は相似で、相似比は $AD:AB=${a}:${a + bb}$`,
      `$DE=BC\\times\\dfrac{${a}}{${a + bb}}=${c}\\times\\dfrac{${a}}{${a + bb}}=${P().fr(a * c, a + bb)}$`,
      `$AE:EC=AD:DB=${a}:${bb}$ より $EC=${e}\\times\\dfrac{${bb}}{${a}}=${P().fr(e * bb, a)}$`,
    ],
    point: `平行線があれば相似な三角形が見つかる。$DE:BC$ は $AD:AB$（全体との比）、$AE:EC$ は $AD:DB$（分けた比）。どちらの比を使うかを取りちがえない。`,
  };
});

add("geo-fig-centroid", "geo", "重心と面積（図）", (t, F) => {
  const k = t.ri(2, 7), S = 6 * t.ri(2, 12);
  const A = [130, 18], B = [24, 196], C = [290, 196], M = [(B[0] + C[0]) / 2, (B[1] + C[1]) / 2];
  const G = [A[0] + (M[0] - A[0]) * 2 / 3, A[1] + (M[1] - A[1]) * 2 / 3];
  const b = sv.poly([G, B, M], "shade", true) + sv.poly([A, B, C], "", true) + sv.line(...A, ...M) + sv.line(...G, ...B, "ax") + sv.line(...G, ...C, "ax") + sv.circ(...G, 3, "dot")
    + sv.text(A[0], A[1] - 4, "A") + sv.text(B[0] - 10, B[1] + 4, "B") + sv.text(C[0] + 10, C[1] + 4, "C") + sv.text(M[0], M[1] + 16, "M") + sv.text(G[0] + 12, G[1] - 2, "G", "", "start");
  return {
    q: `図の $\\triangle ABC$ で、M は辺 BC の中点、G は重心である。$AM=${3 * k}$、$\\triangle ABC$ の面積が $${S}$ のとき、$AG$ の長さと、色のついた $\\triangle GBM$ の面積を求めよ。`,
    fig: sv.svg(314, 212, b, "重心の図"),
    form: `$AG=${F.n(2 * k)}$、$\\triangle GBM=${F.n(S / 6)}$`,
    steps: [
      `重心は中線を $2:1$ に分ける：$AG=${3 * k}\\times\\dfrac{2}{3}=${2 * k}$`,
      `$\\triangle ABM=\\dfrac{1}{2}\\triangle ABC=${S / 2}$（BM と MC が等しい）`,
      `$\\triangle GBM$ と $\\triangle ABM$ は底辺 BM が共通で、高さの比は $GM:AM=1:3$。$\\triangle GBM=${S / 2}\\times\\dfrac{1}{3}=${S / 6}$`,
    ],
    point: `重心は中線を頂点側から $2:1$ に分ける。重心と3頂点を結ぶと面積は3等分、さらに中点で分けると6等分になる。`,
  };
});

add("geo-fig-tangent", "geo", "2本の接線と角（図）", (t, F) => {
  const x = 2 * t.ri(15, 50), cx = 92, cy = 110, half = x / 2 * Math.PI / 180;
  const R = Math.min(64, 220 * Math.sin(half)), dd = R / Math.sin(half), Pp = [cx + dd, cy], phi = Math.acos(R / dd);
  const A = [cx + R * Math.cos(phi), cy - R * Math.sin(phi)], B = [cx + R * Math.cos(phi), cy + R * Math.sin(phi)], C = [cx - R, cy];
  const b = sv.circ(cx, cy, R) + sv.line(...Pp, ...A) + sv.line(...Pp, ...B) + sv.line(cx, cy, ...A, "ax") + sv.line(cx, cy, ...B, "ax")
    + sv.line(...C, ...A, "hi") + sv.line(...C, ...B, "hi") + sv.circ(cx, cy, 2.5, "dot") + sv.arc(...Pp, 22, 180 - x / 2, 180 + x / 2)
    + sv.text(A[0], A[1] - 8, "A") + sv.text(B[0], B[1] + 16, "B") + sv.text(C[0] - 10, C[1] + 4, "C") + sv.text(Pp[0] + 10, Pp[1] + 4, "P", "", "start")
    + sv.text(cx - 6, cy - 6, "O", "sm", "end") + sv.text(Pp[0] - 30, Pp[1] + 4, `${x}°`, "sm", "end");
  const W = Math.ceil(Pp[0] + 26);
  return {
    q: `図のように、円 O の外の点 P から2本の接線を引き、接点を A、B とする。$\\angle APB=${x}^\\circ$ のとき、$\\angle AOB$ と、円周上の点 C（A、B を除く、大きい方の弧の上）に対する $\\angle ACB$ を求めよ。`,
    fig: sv.svg(W, 220, b, "接線と円の図"),
    form: `$\\angle AOB=${F.n(180 - x)}^\\circ$、$\\angle ACB=${F.n((180 - x) / 2)}^\\circ$`,
    steps: [
      `接線は接点を通る半径に垂直：$\\angle OAP=\\angle OBP=90^\\circ$`,
      `四角形 OAPB の内角の和 $360^\\circ$ より $\\angle AOB=360^\\circ-90^\\circ-90^\\circ-${x}^\\circ=${180 - x}^\\circ$`,
      `$\\angle ACB$ は弧 AB（小さい方）に対する円周角なので、中心角の半分：$${(180 - x) / 2}^\\circ$`,
    ],
    point: `接線と半径は垂直。円外の点から引いた2本の接線では、四角形 OAPB の向かい合う角の和が $180^\\circ$ になる。`,
  };
});

/* ---------- レベル ---------- */
// レベル1＝教科書の基本（公式をそのまま使う）、レベル2＝共通テストの小問・標準、レベル3＝共通テストの大問の後半・思考力型
export const MATH_LEVELS = {
  1: { name: "基本", note: "教科書の公式をそのまま使う問題" },
  2: { name: "標準", note: "共通テストの小問レベル" },
  3: { name: "発展", note: "共通テストの大問の後半・場合分けや組み合わせ" },
};
const LEVEL1 = new Set([
  "num-expand", "num-factor", "num-rational", "num-ineq",
  "quad-vertex", "quad-ineq", "quad-shift",
  "trig-value", "trig-cos", "trig-area", "trig-eq",
  "data-var", "data-median",
  "prob-select", "prob-letters", "prob-path",
  "geo-bisect", "geo-circle",
  "int-gcd", "int-divisor", "int-base", "int-mod",
  // 図・会話の問題（2026-11-24 追加）
  "data-boxread", "data-talk", "quad-graph", "trig-height", "int-calendar", "geo-fig-angle", "geo-fig-parallel",
]);
T.forEach(x => { x.lv ??= LEVEL1.has(x.id) ? 1 : 2; });

/* ---------- 外から使う ---------- */
export const MATH_TYPES = T;
export const MATH_BY_ID = Object.fromEntries(T.map(x => [x.id, x]));

const hashStr = (str) => { let x = 5381; for (const ch of str) x = (Math.imul(x, 33) + ch.codePointAt(0)) | 0; return "h" + (x >>> 0).toString(36) + str.length; };
// 型 id と seed から問題を作る。条件に合わない数値のときは、同じ seed から決まる次の候補を使う
const cache = new Map();
export function makeProblem(id, seed) {
  const key = `${id}:${seed}`;
  if (cache.has(key)) return cache.get(key);
  const tpl = MATH_BY_ID[id];
  if (!tpl) return null;
  for (let k = 0; k < 400; k++) {
    const r = rng((seed + k * 7919) >>> 0);
    const ri = (a, b) => a + Math.floor(r() * (b - a + 1));
    const t = {
      ri, rand: r, pick: (arr) => arr[Math.floor(r() * arr.length)],
      shuffle: (arr) => { const b = arr.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; },
    };
    const F = new Form(false);
    try {
      const out = tpl.gen(t, F);
      const labels = Object.keys(F.ans);
      // sig：同じ問題かどうかの目じるし（図・選択肢・会話も含めた短い文字列）
      const sig = hashStr([out.q, out.form, out.fig ?? "", (out.choices ?? []).join("|"), JSON.stringify(out.talk ?? [])].join("|"));
      const p = { id, seed, f: tpl.f, lv: tpl.lv, field: MATH_FIELDS[tpl.f], title: tpl.title, ...out, labels, key: F.ans, opts: F.opts ?? {}, sig };
      cache.set(key, p);
      return p;
    } catch (e) { if (!(e instanceof Retry)) throw e; }
  }
  throw new Error("問題を作れませんでした: " + id);
}
