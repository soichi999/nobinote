# 今日の英単語の読み上げ音声を作る（単語・例文＝Kokoro の英語、意味＝VOICEVOX の日本語）
# 使い方: VOICEVOX を起動しておき、teruteru_howto の .venv_tts（kokoro 入り）の Python で実行
#   /Users/m-sko/Japan/output/teruteru_howto/.venv_tts/bin/python tools/make_vocab_audio.py
# 対象: レベル1〜3の全単語（vocab.js と vocab_more.js）
# 出力: moshi/audio/<id>-w.mp3（単語）・-m.mp3（意味）・-s.mp3（例文）。あるファイルは作り直さない（--force で全部）
import json, re, subprocess as sp, sys, urllib.request, urllib.parse
from pathlib import Path
import numpy as np, soundfile as sf

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "moshi" / "audio"
EN_VOICE = "am_michael"      # Kokoro の声（アメリカ英語・男性）
JA_SPEAKER = 14              # VOICEVOX: 冥鳴ひまり（ノーマル）。アプリに「VOICEVOX:冥鳴ひまり」と表示する
POS = {"動": "v", "名": "n", "形": "a", "副": "r", "熟": "i"}
FORCE = "--force" in sys.argv

def vocab():
    """レベル2（vocab.js）とレベル1・3（vocab_more.js の MORE）をまとめて [単語, 品詞, 意味, 例文] の並びにする"""
    src = (ROOT / "moshi" / "vocab.js").read_text()
    body = src[src.index("[", src.index("export const VOCAB")):src.rindex("]") + 1]
    out = json.loads(re.sub(r",\s*\]$", "]", body))
    more = ROOT / "moshi" / "vocab_more.js"
    if more.exists():
        m = more.read_text(); i = m.index("[", m.index("export const MORE")); j = m.index("\n];", i)
        out += [[o["w"], o["pos"], o["ja"], o["ex"]] for o in json.loads(re.sub(r",\s*$", "", m[i:j]) + "]")]
    return out

def audio_id(w, pos):
    return re.sub(r"[^a-z0-9]+", "-", w.lower()).strip("-") + "-" + POS[pos]

def to_mp3(wav, sr, path):
    sp.run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(sr), "-ac", "1", "-i", "-",
            "-af", "silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse,loudnorm=I=-18:TP=-2",
            "-ar", "24000", "-ac", "1", "-b:a", "48k", str(path)], input=np.asarray(wav, np.float32).tobytes(), check=True)

def ja_read(m):
    return re.sub(r"[（）()～〜]", "", m)

def voicevox(text):
    q = urllib.request.urlopen(urllib.request.Request(
        f"http://127.0.0.1:50021/audio_query?text={urllib.parse.quote(text)}&speaker={JA_SPEAKER}", method="POST")).read()
    qj = json.loads(q); qj["speedScale"] = 1.05; qj["prePhonemeLength"] = 0.05; qj["postPhonemeLength"] = 0.05
    wav = urllib.request.urlopen(urllib.request.Request(f"http://127.0.0.1:50021/synthesis?speaker={JA_SPEAKER}",
        data=json.dumps(qj).encode(), headers={"Content-Type": "application/json"})).read()
    tmp = OUT / "_ja.wav"; tmp.write_bytes(wav)
    a, sr = sf.read(tmp, dtype="float32"); tmp.unlink()
    return a, sr

if __name__ == "__main__":
    from kokoro import KPipeline
    OUT.mkdir(parents=True, exist_ok=True)
    pipe = KPipeline(lang_code="a", repo_id="hexgrad/Kokoro-82M")
    def en(text, speed):
        return np.concatenate([x.audio.numpy() for x in pipe(text, voice=EN_VOICE, speed=speed)])
    V = vocab()
    if "--limit" in sys.argv: V = V[:int(sys.argv[sys.argv.index("--limit") + 1])]
    for i, v in enumerate(V):
        aid = audio_id(v[0], v[1])
        for kind, make in (("w", lambda: (en(v[0], 0.9), 24000)), ("m", lambda: voicevox(ja_read(v[2]))), ("s", lambda: (en(v[3], 0.92), 24000))):
            p = OUT / f"{aid}-{kind}.mp3"
            if p.exists() and not FORCE: continue
            a, sr = make(); to_mp3(a, sr, p)
        print(f"{i + 1}/{len(V)} {aid}", flush=True)
