# 英単語のレベル1・3と、英検の空所補充用データ（EX）をまとめて moshi/vocab_more.js を作る
# 入力: tools/vocab_src/ の JSON
#   l1_*.json, l3_*.json … 新しい単語 {w,pos,ja,ex,exj,grp,tip,syn,synj,form,d:[[英語,日本語]x3]}
#   ex_*.json            … 既存317語（レベル2）の {id, d}（form は例文から求める）
# 使い方: python3 tools/build_vocab_levels.py
import json, re, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "tools" / "vocab_src"

def load_js_array(path, name):
    s = path.read_text()
    i = s.index("[", s.index(f"export const {name}"))
    return json.loads(re.sub(r",\s*\]\s*;?\s*$", "]", s[i:s.rindex("]") + 1]))

def appears_once(ex, form):
    return len(re.findall(r"(?<![A-Za-z])" + re.escape(form) + r"(?![A-Za-z])", ex)) == 1

base = load_js_array(ROOT / "moshi" / "vocab.js", "VOCAB")
base_ids = {f"{v[0]}:{v[1]}" for v in base}
base_words = {v[0].lower() for v in base}

def form_of(v):
    w = v[0]; stem = re.sub(r"(e|y)$", "", w) if len(w) >= 4 else w
    m = re.search(r"\b(" + re.escape(stem) + r"[a-z]*)", v[3], re.I)
    return m.group(1) if m else w

problems = []
# 既存語の空所補充データ
EX = {}
by_id = {f"{v[0]}:{v[1]}": v for v in base}
for f in sorted(SRC.glob("ex_*.json")):
    for o in json.loads(f.read_text()):
        v = by_id.get(o.get("id"))
        if not v: problems.append(f"{f.name}: 不明な id {o.get('id')}"); continue
        form = form_of(v)
        d = [x for x in o.get("d", []) if isinstance(x, list) and len(x) == 2 and x[0].lower() not in (v[0].lower(), form.lower())]
        if len(d) != 3: problems.append(f"{f.name}: {o['id']} の d が3つでない"); continue
        EX[o["id"]] = {"form": form, "d": d}

# 新しい単語（同じ語が複数のファイルにあれば、低いレベルを残す）
MORE, seen = [], set()
for lv, pat in ((1, "l1_*.json"), (3, "l3_*.json")):
    for f in sorted(SRC.glob(pat)):
        for o in json.loads(f.read_text()):
            key = f"{o['w']}:{o['pos']}"
            if o["w"].lower() in base_words or key in seen:
                problems.append(f"{f.name}: 重複のため除外 {key}"); continue
            if not appears_once(o["ex"], o["form"]) or len(o.get("d", [])) != 3:
                problems.append(f"{f.name}: 形式の不備で除外 {key}"); continue
            seen.add(key)
            MORE.append({"lv": lv, **{k: o[k] for k in ("w", "pos", "ja", "ex", "exj", "grp", "tip", "syn", "synj", "form", "d")}})

out = ROOT / "moshi" / "vocab_more.js"
lines = ["// tools/build_vocab_levels.py が作るファイル（手で直さない。元データは tools/vocab_src/）",
         "// MORE：レベル1（英検準2級）・レベル3（2級上位・熟語）の単語。EX：レベル2（vocab.js）の英検空所補充用 {form, d}",
         "export const MORE = ["] + [json.dumps(o, ensure_ascii=False) + "," for o in MORE] + ["];",
         "export const EX = {"] + [f"{json.dumps(k, ensure_ascii=False)}: {json.dumps(v, ensure_ascii=False)}," for k, v in EX.items()] + ["};", ""]
out.write_text("\n".join(lines))
cnt = {1: 0, 3: 0}
for o in MORE: cnt[o["lv"]] += 1
print(f"レベル1 {cnt[1]}語 / レベル2 {len(base)}語（空所補充 {len(EX)}語）/ レベル3 {cnt[3]}語（うち熟語 {sum(o['pos']=='熟' for o in MORE)}）")
print("\n".join(problems[:40]) + (f"\n…ほか {len(problems)-40}件" if len(problems) > 40 else ""))
