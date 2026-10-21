import os
import re
import threading
from typing import Optional

import torch
from fastapi import FastAPI, HTTPException
from indic_transliteration import sanscript
from indic_transliteration.sanscript import transliterate
from langdetect import DetectorFactory, LangDetectException, detect_langs
from pydantic import BaseModel, Field
from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

DetectorFactory.seed = 0

MODEL_ID = os.getenv("TRANSLATOR_MODEL", "facebook/nllb-200-distilled-600M")
TARGET_LANG = "eng_Latn"
MAX_INPUT_TOKENS = 512
NUM_BEAMS = int(os.getenv("TRANSLATOR_BEAMS", "4"))
THREADS = int(os.getenv("TRANSLATOR_THREADS", "4"))

if THREADS > 0:
    torch.set_num_threads(THREADS)

# ISO-639-1 (and a few common variants) -> NLLB language code.
NLLB_LANGUAGE_CODES = {
    "af": "afr_Latn",
    "am": "amh_Ethi",
    "ar": "arb_Arab",
    "az": "azj_Latn",
    "be": "bel_Cyrl",
    "bg": "bul_Cyrl",
    "bn": "ben_Beng",
    "bs": "bos_Latn",
    "ca": "cat_Latn",
    "cs": "ces_Latn",
    "cy": "cym_Latn",
    "da": "dan_Latn",
    "de": "deu_Latn",
    "el": "ell_Grek",
    "en": "eng_Latn",
    "es": "spa_Latn",
    "et": "est_Latn",
    "eu": "eus_Latn",
    "fa": "pes_Arab",
    "fi": "fin_Latn",
    "fr": "fra_Latn",
    "ga": "gle_Latn",
    "gl": "glg_Latn",
    "gu": "guj_Gujr",
    "he": "heb_Hebr",
    "hi": "hin_Deva",
    "hr": "hrv_Latn",
    "hu": "hun_Latn",
    "hy": "hye_Armn",
    "id": "ind_Latn",
    "is": "isl_Latn",
    "it": "ita_Latn",
    "ja": "jpn_Jpan",
    "ka": "kat_Geor",
    "kk": "kaz_Cyrl",
    "km": "khm_Khmr",
    "kn": "kan_Knda",
    "ko": "kor_Hang",
    "ky": "kir_Cyrl",
    "lo": "lao_Laoo",
    "lt": "lit_Latn",
    "lv": "lav_Latn",
    "mk": "mkd_Cyrl",
    "ml": "mal_Mlym",
    "mn": "khk_Cyrl",
    "mr": "mar_Deva",
    "ms": "zsm_Latn",
    "my": "mya_Mymr",
    "ne": "npi_Deva",
    "nl": "nld_Latn",
    "no": "nob_Latn",
    "pa": "pan_Guru",
    "pl": "pol_Latn",
    "ps": "pbt_Arab",
    "pt": "por_Latn",
    "ro": "ron_Latn",
    "ru": "rus_Cyrl",
    "si": "sin_Sinh",
    "sk": "slk_Latn",
    "sl": "slv_Latn",
    "so": "som_Latn",
    "sq": "sqi_Latn",
    "sr": "srp_Cyrl",
    "sv": "swe_Latn",
    "sw": "swh_Latn",
    "ta": "tam_Taml",
    "te": "tel_Telu",
    "th": "tha_Thai",
    "tl": "tgl_Latn",
    "tr": "tur_Latn",
    "uk": "ukr_Cyrl",
    "ur": "urd_Arab",
    "uz": "uzn_Latn",
    "vi": "vie_Latn",
    "zh": "zho_Hans",
    "zh-cn": "zho_Hans",
    "zh-tw": "zho_Hant",
    "zu": "zul_Latn",
}

ENGLISH_MARKERS = {
    "and",
    "are",
    "but",
    "cannot",
    "do",
    "does",
    "for",
    "from",
    "had",
    "has",
    "have",
    "he",
    "hello",
    "her",
    "him",
    "his",
    "how",
    "i",
    "is",
    "it",
    "its",
    "like",
    "love",
    "hate",
    "my",
    "not",
    "our",
    "please",
    "she",
    "thanks",
    "that",
    "the",
    "their",
    "them",
    "they",
    "this",
    "was",
    "we",
    "were",
    "what",
    "when",
    "where",
    "who",
    "why",
    "with",
    "you",
    "your",
}

HINGLISH_MARKERS = {
    "aap",
    "abhi",
    "acha",
    "accha",
    "achha",
    "agar",
    "aisa",
    "aise",
    "aur",
    "bas",
    "bahut",
    "bhai",
    "bohot",
    "chahiye",
    "cheez",
    "didi",
    "fir",
    "ghar",
    "hai",
    "hain",
    "hoga",
    "hogi",
    "honge",
    "hum",
    "ka",
    "kabhi",
    "kal",
    "karo",
    "kar",
    "ke",
    "ki",
    "ko",
    "kyun",
    "kyu",
    "kya",
    "lekin",
    "liye",
    "log",
    "magar",
    "main",
    "mein",
    "mera",
    "meri",
    "mujhe",
    "nahi",
    "nahin",
    "par",
    "pasand",
    "phir",
    "raha",
    "rahe",
    "rahi",
    "roz",
    "se",
    "sun",
    "suno",
    "tum",
    "tumhe",
    "tera",
    "teri",
    "tha",
    "thi",
    "tujhe",
    "yaar",
    "ye",
    "yeh",
}

# Special handling for scripts that langdetect often confuses or that need a
# different NLLB code than the ISO language code.
SCRIPT_PATTERNS = [
    ("kor_Hang", re.compile(r"[\uac00-\ud7af]")),
    ("jpn_Jpan", re.compile(r"[\u3040-\u30ff]")),
    ("zho_Hans", re.compile(r"[\u4e00-\u9fff]")),
    ("arb_Arab", re.compile(r"[\u0600-\u06ff]")),
    ("hin_Deva", re.compile(r"[\u0900-\u097f]")),
    ("rus_Cyrl", re.compile(r"[\u0400-\u04ff]")),
]


class TranslateRequest(BaseModel):
    text: str = Field(min_length=1, max_length=10_000)


class TranslateResponse(BaseModel):
    translatedText: str
    detectedLanguage: Optional[str] = None
    provider: str = MODEL_ID


class Translator:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
        self.model = AutoModelForSeq2SeqLM.from_pretrained(MODEL_ID)
        self.model.eval()
        self.target_token_id = self.tokenizer.convert_tokens_to_ids(TARGET_LANG)
        if self.target_token_id is None:
            raise RuntimeError(f"Target language token {TARGET_LANG} is unavailable")

    def detect(self, text: str) -> tuple[str, str, bool]:
        for code, pattern in SCRIPT_PATTERNS:
            if pattern.search(text):
                # A Han-only string is Chinese; kana takes precedence above.
                iso = {
                    "kor_Hang": "ko",
                    "jpn_Jpan": "ja",
                    "zho_Hans": "zh",
                    "arb_Arab": "ar",
                    "hin_Deva": "hi",
                    "rus_Cyrl": "ru",
                }[code]
                return iso, code, False

        # Romanized Hindi is not reliably detected as Hindi by langdetect.
        words = set(re.findall(r"[A-Za-z]+", text.lower()))
        hinglish_hits = words & HINGLISH_MARKERS
        if len(hinglish_hits) >= 2:
            return "hi", "hin_Deva", True

        # Short English sentences are often misdetected as another Germanic
        # language. Prefer English when a clear English word is present.
        if words & ENGLISH_MARKERS:
            return "en", "eng_Latn", False

        try:
            candidates = detect_langs(text)
        except LangDetectException:
            return "en", "eng_Latn", False
        if not candidates:
            return "en", "eng_Latn", False

        best = candidates[0].lang.lower()
        if best.startswith("zh"):
            return "zh", "zho_Hans" if best != "zh-tw" else "zho_Hant", False
        return best, NLLB_LANGUAGE_CODES.get(best, "eng_Latn"), False

    def translate(self, text: str) -> TranslateResponse:
        source_iso, source_code, hinglish = self.detect(text)
        # English is already the target. Avoid a needless model pass.
        if source_code == "eng_Latn":
            return TranslateResponse(translatedText=text, detectedLanguage=source_iso)

        model_text = text
        if hinglish:
            # NLLB has a Devanagari Hindi input for this; romanized Hinglish is
            # not translated reliably without transliteration.
            try:
                model_text = transliterate(text, sanscript.ITRANS, sanscript.DEVANAGARI)
            except Exception as error:
                print(f"hinglish transliteration failed: {type(error).__name__}: {error}", flush=True)

        with self.lock:
            self.tokenizer.src_lang = source_code
            inputs = self.tokenizer(
                model_text,
                return_tensors="pt",
                truncation=True,
                max_length=MAX_INPUT_TOKENS,
            )
            with torch.inference_mode():
                output = self.model.generate(
                    **inputs,
                    forced_bos_token_id=self.target_token_id,
                    max_new_tokens=MAX_INPUT_TOKENS,
                    num_beams=NUM_BEAMS,
                )
            translated = self.tokenizer.batch_decode(output, skip_special_tokens=True)[0].strip()
        if not translated:
            raise RuntimeError("The model returned an empty translation")
        return TranslateResponse(translatedText=translated, detectedLanguage=source_iso)


print(f"Loading translation model: {MODEL_ID}", flush=True)
translator = Translator()
print("Translation model ready", flush=True)

app = FastAPI(title="Siela Translator", version="1.0.0")


@app.get("/health")
def health() -> dict[str, object]:
    return {"status": "ok", "ready": True, "model": MODEL_ID}


@app.post("/translate", response_model=TranslateResponse)
def translate(request: TranslateRequest) -> TranslateResponse:
    text = request.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text is empty")
    try:
        return translator.translate(text)
    except HTTPException:
        raise
    except Exception as error:
        print(f"translation failed: {type(error).__name__}: {error}", flush=True)
        raise HTTPException(status_code=500, detail="Translation failed") from error
