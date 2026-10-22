import argparse
import os
import sys

import soundfile as sf
from kittenml import KittenTTS


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default=os.getenv("KITTEN_TTS_MODEL", "KittenML/kitten-tts-2"))
    parser.add_argument("--voice", default=os.getenv("TTS_VOICE", "Bruno"))
    parser.add_argument("--weights", default=os.getenv("KITTEN_TTS_WEIGHTS", "emb4"))
    parser.add_argument("--decoder", default=os.getenv("KITTEN_TTS_DECODER", "student_w4"))
    parser.add_argument("--text", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    model = KittenTTS(args.model, weights=args.weights, decoder=args.decoder)
    audio = model.generate(args.text, voice=args.voice)
    sf.write(args.output, audio, model.sample_rate)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
