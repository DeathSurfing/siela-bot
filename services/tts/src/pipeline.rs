//! Text pipeline mirroring `kittentts/onnx_model.py`:
//! `chunk_text` -> espeak phonemize -> `basic_english_tokenize` ->
//! `TextCleaner` -> `[0] + ids + [0]`, plus voice/style/speed resolution
//! from the model's `config.json`.

use regex::Regex;
use std::collections::HashMap;
use std::sync::OnceLock;

mod symbols {
    include!("symbols_generated.rs");
}

/// Split text for long inputs. Mirrors `chunk_text(text, max_len=400)`.
pub fn chunk_text(text: &str) -> Vec<String> {
    const MAX_LEN: usize = 400;
    // re.split(r'[.!?]+', text) — byte splitting is safe: '.'/'!'/'?' are ASCII.
    let mut chunks = Vec::new();
    for sentence in text.split(|c| c == '.' || c == '!' || c == '?') {
        let sentence = sentence.trim();
        if sentence.is_empty() {
            continue;
        }
        if sentence.len() <= MAX_LEN {
            chunks.push(ensure_punctuation(sentence));
        } else {
            let mut temp = String::new();
            for word in sentence.split_whitespace() {
                let add = if temp.is_empty() {
                    word.len()
                } else {
                    temp.len() + 1 + word.len()
                };
                if add <= MAX_LEN {
                    if !temp.is_empty() {
                        temp.push(' ');
                    }
                    temp.push_str(word);
                } else {
                    if !temp.is_empty() {
                        chunks.push(ensure_punctuation(temp.trim()));
                    }
                    temp = word.to_string();
                }
            }
            if !temp.trim().is_empty() {
                chunks.push(ensure_punctuation(temp.trim()));
            }
        }
    }
    chunks
}

/// Mirror `ensure_punctuation`: append ',' when the chunk ends without
/// `.!?,;:`.
fn ensure_punctuation(sentence: &str) -> String {
    let s = sentence.trim();
    if s.is_empty() {
        return String::new();
    }
    match s.chars().last() {
        Some(c) if matches!(c, '.' | '!' | '?' | ',' | ';' | ':') => s.to_string(),
        _ => format!("{s},"),
    }
}

fn token_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    // Mirrors re.findall(r"\w+|[^\w\s]", text). Python and Rust regex `\w`
    // are both Unicode-aware word classes.
    RE.get_or_init(|| Regex::new(r"\w+|[^\w\s]").expect("token regex"))
}

/// Mirrors `basic_english_tokenize` + `' '.join(...)`.
pub fn basic_english_tokenize(phonemes: &str) -> String {
    token_re()
        .find_iter(phonemes)
        .map(|m| m.as_str())
        .collect::<Vec<_>>()
        .join(" ")
}

fn cleaner_map() -> &'static HashMap<char, i64> {
    static MAP: OnceLock<HashMap<char, i64>> = OnceLock::new();
    MAP.get_or_init(|| symbols::SYMBOL_IDS.iter().copied().collect())
}

/// Mirrors `TextCleaner.__call__` with `[0]`/`[0]` framing. Unknown chars are
/// skipped, exactly like the Python `KeyError: pass`.
pub fn text_to_ids(joined_tokens: &str) -> Vec<i64> {
    let map = cleaner_map();
    let mut ids = Vec::with_capacity(joined_tokens.len() + 2);
    ids.push(0);
    for c in joined_tokens.chars() {
        if let Some(&id) = map.get(&c) {
            ids.push(id);
        }
    }
    ids.push(0);
    ids
}

/// Voice + speed resolution. Mirrors `_prepare_inputs` voice handling:
/// aliases first, then `speed * speed_priors.get(voice, 1.0)`.
/// (The `ValueError` for unknown voices is preserved as an `Err`.)
pub fn resolve_voice(
    config: &ModelConfigJson,
    voice: &str,
    speed: f32,
) -> Result<(String, f32), String> {
    let canonical = config
        .voice_aliases
        .get(voice)
        .cloned()
        .unwrap_or_else(|| voice.to_string());
    if !config.available_voices.iter().any(|v| v == &canonical) {
        return Err(format!("Voice '{voice}' not available."));
    }
    let prior = config.speed_priors.get(&canonical).copied().unwrap_or(1.0);
    Ok((canonical, speed * prior))
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct ModelConfigJson {
    #[serde(default)]
    pub speed_priors: HashMap<String, f32>,
    #[serde(default)]
    pub voice_aliases: HashMap<String, String>,
    #[serde(default)]
    pub available_voices_fallback: Vec<String>,
    /// Not in config.json; filled from the voices file at load time.
    #[serde(skip)]
    pub available_voices: Vec<String>,
}

impl ModelConfigJson {
    pub fn load(path: &str, available_voices: Vec<String>) -> Result<Self, String> {
        let raw = std::fs::read_to_string(path).map_err(|e| format!("read {path}: {e}"))?;
        let mut cfg: ModelConfigJson =
            serde_json::from_str(&raw).map_err(|e| format!("parse {path}: {e}"))?;
        cfg.available_voices = available_voices;
        Ok(cfg)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunking_matches_python() {
        assert_eq!(
            chunk_text("Hello. World! How are you?"),
            vec!["Hello,", "World,", "How are you,"]
        );
        assert_eq!(chunk_text("..."), Vec::<String>::new());
        assert_eq!(chunk_text("Hi; there: ok"), vec!["Hi; there: ok,"]);
        let long = "word ".repeat(200);
        let chunks = chunk_text(&long);
        assert!(chunks.iter().all(|c| c.len() <= 400));
        assert!(chunks.len() > 1);
    }

    #[test]
    fn tokenizer_matches_python() {
        assert_eq!(
            basic_english_tokenize("ˈæni sˈɛd, həlˈoʊ"),
            "ˈæni sˈɛd , həlˈoʊ"
        );
    }
}
