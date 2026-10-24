pub mod espeak;
pub mod phonemizer;
pub mod pipeline;
pub mod server;
pub mod synthesis;
pub mod wav;

pub use pipeline::{basic_english_tokenize, chunk_text, text_to_ids};

/// Test-only helpers (also used by `tests/`). Everything runs through the
/// real espeak FFI, so callers must ensure single-threaded use.

pub fn espeak_init_for_tests() {
    espeak::initialize();
    espeak::set_voice("en-us");
}

/// Mirrors `EspeakBackend(...).phonemize([chunk])[0]`.
pub fn phonemize_for_tests(chunk: &str) -> String {
    let (pieces, marks) = phonemizer::preserve_chunk(chunk);
    let mut phonemized = Vec::with_capacity(pieces.len());
    for piece in &pieces {
        let raw = unsafe { espeak::text_to_phonemes_unsafe(piece) };
        phonemized.push(phonemizer::postprocess_espeak_line(&raw));
    }
    phonemizer::phonemize_chunk(phonemized, marks)
        .into_iter()
        .next()
        .unwrap_or_default()
}

pub fn tokenize_for_tests(phonemes: &str) -> Vec<String> {
    basic_english_tokenize(phonemes)
        .split(' ')
        .map(|s| s.to_string())
        .collect()
}

pub fn ids_for_tests(joined_tokens: &str) -> Vec<i64> {
    text_to_ids(joined_tokens)
}

/// Load voices the same way the server does (validates the npz reader).
pub fn voices_for_tests(path: &str) -> std::collections::HashMap<String, Vec<f32>> {
    let voices = synthesis::read_voices_for_tests(path);
    voices
        .into_iter()
        .map(|(k, v)| (k, v.into_raw_vec_and_offset().0))
        .collect()
}
