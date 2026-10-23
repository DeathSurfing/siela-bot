import io
import os
import struct

import numpy as np
import soundfile as sf
from fastapi import FastAPI, Response
from fastapi.responses import StreamingResponse
from kittentts import KittenTTS
from kittentts.onnx_model import chunk_text
from pydantic import BaseModel

MODEL = os.getenv("KITTEN_TTS_MODEL", "KittenML/kitten-tts-nano-0.8")
VOICE = os.getenv("TTS_VOICE", "Bruno")
SPEED = float(os.getenv("TTS_SPEED", "1.0"))
SAMPLE_RATE = 24000

app = FastAPI()
model = KittenTTS(MODEL)


class SynthesisRequest(BaseModel):
    text: str
    voice: str | None = None


def wav_header(sample_rate: int, channels: int = 1, bits: int = 16) -> bytes:
    byte_rate = sample_rate * channels * bits // 8
    block_align = channels * bits // 8
    return struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        0xFFFFFFFF,
        b"WAVE",
        b"fmt ",
        16,
        1,
        channels,
        sample_rate,
        byte_rate,
        block_align,
        bits,
        b"data",
        0xFFFFFFFF,
    )


def synthesize_chunk(text: str, voice: str) -> np.ndarray:
    audio = model.model.generate_single_chunk(text, voice=voice, speed=SPEED)
    audio = np.asarray(audio, dtype=np.float32).reshape(-1)
    return np.clip(audio, -1.0, 1.0)


@app.get("/healthz")
def healthz():
    return {"status": "ok"}


@app.post("/synthesize")
def synthesize(request: SynthesisRequest):
    voice = request.voice or VOICE
    chunks = [synthesize_chunk(chunk, voice) for chunk in chunk_text(request.text)]
    audio = np.concatenate(chunks) if chunks else np.zeros(1, dtype=np.float32)
    buffer = io.BytesIO()
    sf.write(buffer, audio, SAMPLE_RATE, format="WAV")
    return Response(content=buffer.getvalue(), media_type="audio/wav")


@app.post("/synthesize-stream")
def synthesize_stream(request: SynthesisRequest):
    voice = request.voice or VOICE

    def generate():
        yield wav_header(SAMPLE_RATE)
        for chunk in chunk_text(request.text):
            audio = synthesize_chunk(chunk, voice)
            yield (audio * 32767.0).astype("<i2").tobytes()

    return StreamingResponse(generate(), media_type="audio/wav")
