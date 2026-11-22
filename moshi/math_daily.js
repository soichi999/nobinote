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
}

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

/* ---------- 外から使う ---------- */
export const MATH_TYPES = T;
export const MATH_BY_ID = Object.fromEntries(T.map(x => [x.id, x]));

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
      ri, pick: (arr) => arr[Math.floor(r() * arr.length)],
      shuffle: (arr) => { const b = arr.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; },
    };
    const F = new Form(false);
    try {
      const out = tpl.gen(t, F);
      const labels = Object.keys(F.ans);
      const p = { id, seed, f: tpl.f, field: MATH_FIELDS[tpl.f], title: tpl.title, ...out, labels, key: F.ans, sig: out.q + "|" + out.form };
      cache.set(key, p);
      return p;
    } catch (e) { if (!(e instanceof Retry)) throw e; }
  }
  throw new Error("問題を作れませんでした: " + id);
}
