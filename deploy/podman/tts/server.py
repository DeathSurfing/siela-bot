import io
import os

import soundfile as sf
from fastapi import FastAPI, Response
from pydantic import BaseModel
from kittenml import KittenTTS

MODEL = os.getenv("KITTEN_TTS_MODEL", "KittenML/kitten-tts-2")
WEIGHTS = os.getenv("KITTEN_TTS_WEIGHTS", "emb4")
DECODER = os.getenv("KITTEN_TTS_DECODER", "student_w4")
VOICE = os.getenv("TTS_VOICE", "Bruno")

app = FastAPI()
model = KittenTTS(MODEL, weights=WEIGHTS, decoder=DECODER)


class SynthesisRequest(BaseModel):
    text: str
    voice: str | None = None


@app.get("/healthz")
def healthz():
    return {"status": "ok"}


@app.post("/synthesize")
def synthesize(request: SynthesisRequest):
    audio = model.generate(request.text, voice=request.voice or VOICE)
    buffer = io.BytesIO()
    sf.write(buffer, audio, model.sample_rate, format="WAV")
    return Response(content=buffer.getvalue(), media_type="audio/wav")
