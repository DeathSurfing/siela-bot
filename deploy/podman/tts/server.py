import io
import json
import os
import struct

import numpy as np

import soundfile as sf
from fastapi import FastAPI, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from kittenml import KittenTTS

MODEL = os.getenv("KITTEN_TTS_MODEL", "KittenML/kitten-tts-2")
WEIGHTS = os.getenv("KITTEN_TTS_WEIGHTS", "emb4")
DECODER = os.getenv("KITTEN_TTS_DECODER", "student_w4")
VOICE = os.getenv("TTS_VOICE", "Bruno")
BACKEND = os.getenv("KITTEN_TTS_BACKEND", "vllm")
VLLM_OPTIONS = json.loads(os.getenv("KITTEN_TTS_VLLM_OPTIONS", "{\"quantization\":\"w4a16\"}"))

app = FastAPI()
model = KittenTTS(
    MODEL,
    weights=WEIGHTS,
    decoder=DECODER,
    backend=BACKEND,
    vllm_options=VLLM_OPTIONS if BACKEND == "vllm" else None,
)


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


def wav_header(sample_rate: int, channels: int = 1, bits: int = 16) -> bytes:
    data_size = 0xFFFFFFFF
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
        data_size,
    )


@app.post("/synthesize-stream")
def synthesize_stream(request: SynthesisRequest):
    def generate():
        yield wav_header(model.sample_rate)
        for chunk in model.generate_stream(request.text, voice=request.voice or VOICE):
            audio = np.asarray(chunk)
            if np.issubdtype(audio.dtype, np.floating):
                audio = np.clip(audio, -1.0, 1.0) * 32767.0
            yield audio.astype("<i2").tobytes()

    return StreamingResponse(generate(), media_type="audio/wav")
