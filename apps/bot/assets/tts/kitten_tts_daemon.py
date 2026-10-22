import json
import os
import sys

import soundfile as sf
from kittenml import KittenTTS

model_name = os.getenv("KITTEN_TTS_MODEL", "KittenML/kitten-tts-2")
weights = os.getenv("KITTEN_TTS_WEIGHTS", "emb4")
decoder = os.getenv("KITTEN_TTS_DECODER", "student_w4")
default_voice = os.getenv("TTS_VOICE", "Bruno")

model = KittenTTS(model_name, weights=weights, decoder=decoder)
print(json.dumps({"ready": True}), flush=True)

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        request = json.loads(line)
        text = request["text"]
        output = request["output"]
        voice = request.get("voice", default_voice)
        audio = model.generate(text, voice=voice)
        sf.write(output, audio, model.sample_rate)
        print(json.dumps({"ok": True, "output": output}), flush=True)
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(exc)}), flush=True)
