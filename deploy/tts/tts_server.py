import io
import os
import tempfile
from pathlib import Path

import soundfile as sf
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import Response

from pocket_tts_onnx import PocketTTSOnnx

app = FastAPI()
tts: PocketTTSOnnx | None = None


@app.on_event("startup")
def load_model() -> None:
    global tts
    tts = PocketTTSOnnx(
        models_dir="/app",
        language="english_2026-04",
        precision="int8",
        temperature=0.7,
        lsd_steps=1,
    )


@app.get("/health")
def health() -> dict[str, bool]:
    return {"ok": tts is not None}


@app.post("/tts")
def synthesize(
    text: str = Form(...),
    voice_url: str | None = Form(None),
    voice_wav: UploadFile | None = File(None),
) -> Response:
    if tts is None:
        raise HTTPException(status_code=503, detail="TTS model is still loading")
    if not text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")

    cleanup: str | None = None
    try:
        if voice_wav is not None:
            suffix = Path(voice_wav.filename or "voice.wav").suffix or ".wav"
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as handle:
                handle.write(voice_wav.file.read())
                cleanup = handle.name
            voice: str = cleanup
        elif voice_url:
            candidate = Path("/app/voices") / f"{voice_url}.wav"
            voice = str(candidate if candidate.exists() else Path("/app/fallback.wav"))
        else:
            voice = "/app/fallback.wav"

        audio = tts.generate(text, voice=voice)
        buffer = io.BytesIO()
        sf.write(buffer, audio, tts.sample_rate, format="WAV")
        return Response(content=buffer.getvalue(), media_type="audio/wav")
    finally:
        if cleanup:
            os.unlink(cleanup)


@app.get("/")
def index() -> dict[str, str]:
    return {"service": "pocket-tts-onnx", "model": "english_2026-04"}
