//! ONNX synthesis. Mirrors `KittenTTS_1_Onnx.generate_single_chunk`:
//! inputs `{input_ids: int64[1, seq], style: float32[1, 256], speed: float32[1]}`,
//! output `audio[0][..., :-5000]`.
//!
//! The session (and libespeak-ng) are not thread-safe; everything runs behind
//! one mutex, which also matches the single-voice usage (and the old Python
//! GIL effectively serialized requests the same way).

use ndarray::{Array1, Array2};
use ort::session::Session;
use ort::value::Tensor;
use std::collections::HashMap;
use std::io::Read;
use std::sync::{Arc, Mutex, OnceLock};

use crate::espeak;
use crate::phonemizer;
use crate::pipeline;

pub const SAMPLE_RATE: u32 = 24_000;
/// Mirrors `outputs[0][..., :-5000]`.
const TRIM_SAMPLES: usize = 5000;

/// ONNX Runtime allows one environment per process, and the `ort` crate
/// refuses a second `init()` even after the first is dropped. Build it once
/// and reuse it for every lazy load and unload.
fn shared_environment() -> Result<Arc<ort::environment::Environment>, String> {
    static ENV: OnceLock<Result<Arc<ort::environment::Environment>, String>> = OnceLock::new();
    ENV.get_or_init(|| {
        ort::init()
            .with_name("siela-tts")
            // CPU-only everywhere: default platform EPs (e.g. CoreML on
            // macOS) reject the model's dynamic shapes. The server target
            // is x86_64 Linux CPU anyway.
            .with_execution_providers([ort::ep::CPU::default().build()])
            .build()
            .map(Arc::new)
            .map_err(|e| format!("ort env: {e}"))
    })
    .clone()
}

pub struct Synthesizer {
    _env: std::sync::Arc<ort::environment::Environment>,
    session: Session,
    voices: HashMap<String, Array2<f32>>,
    default_voice: String,
    default_speed: f32,
}

/// Minimal `.npy` (v1.0/v2.0, C-order float32) reader for the voices file.
/// Avoids an extra ndarray-version-coupled dependency: `.npz` is a zip of
/// `.npy` entries, one per voice, each `[N, 256]` little-endian float32.
fn parse_npy_f32(bytes: &[u8]) -> Result<(Vec<usize>, Vec<f32>), String> {
    if bytes.len() < 10 || &bytes[0..6] != b"\x93NUMPY" {
        return Err("bad npy magic".to_string());
    }
    let (hlen_size, hlen) = match (bytes[6], bytes[7]) {
        (1, 0) => (2, u16::from_le_bytes([bytes[8], bytes[9]]) as usize),
        (2, 0) => (4, u32::from_le_bytes([bytes[8], bytes[9], bytes[10], bytes[11]]) as usize),
        (maj, min) => return Err(format!("unsupported npy version {maj}.{min}")),
    };
    let hstart = 8 + hlen_size;
    let header = std::str::from_utf8(
        bytes.get(hstart..hstart + hlen).ok_or("npy header OOB")?,
    )
    .map_err(|_| "npy header not utf-8".to_string())?;
    if !header.contains("<f4") && !header.contains("|f4") {
        return Err(format!("unsupported npy dtype in {header}"));
    }
    if header.contains("True") {
        return Err("fortran-order npy unsupported".to_string());
    }
    // shape: (75, 256),  — parse the ints inside the parens.
    let l = header.find('(').ok_or("npy shape missing")?;
    let r = header.find(')').ok_or("npy shape missing")?;
    let mut dims = Vec::new();
    for part in header[l + 1..r].split(',') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        dims.push(
            part.parse::<usize>()
                .map_err(|_| format!("bad npy dim {part:?}"))?,
        );
    }
    if dims.len() != 2 {
        return Err(format!("expected 2-D voice array, got {dims:?}"));
    }
    let data = &bytes[hstart + hlen..];
    let want = dims[0] * dims[1] * 4;
    if data.len() < want {
        return Err("npy data truncated".to_string());
    }
    let mut out = Vec::with_capacity(dims[0] * dims[1]);
    for chunk in data[..want].chunks_exact(4) {
        out.push(f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]));
    }
    Ok((dims, out))
}

pub fn read_voices_for_tests(path: &str) -> HashMap<String, Array2<f32>> {
    read_voices_npz(path).expect("load voices")
}

fn read_voices_npz(path: &str) -> Result<HashMap<String, Array2<f32>>, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("open {path}: {e}"))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("open zip {path}: {e}"))?;
    let mut voices = HashMap::new();
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| format!("zip entry {i}: {e}"))?;
        let name = entry
            .name()
            .trim_end_matches(".npy")
            .to_string();
        let mut buf = Vec::new();
        entry
            .read_to_end(&mut buf)
            .map_err(|e| format!("read {name}: {e}"))?;
        let (dims, data) = parse_npy_f32(&buf).map_err(|e| format!("{name}: {e}"))?;
        let arr = Array2::from_shape_vec((dims[0], dims[1]), data)
            .map_err(|e| format!("shape {name}: {e}"))?;
        voices.insert(name, arr);
    }
    Ok(voices)
}

impl Synthesizer {
    pub fn load(
        model_path: &str,
        voices_path: &str,
        default_voice: String,
        default_speed: f32,
    ) -> Result<Self, String> {
        let env = shared_environment()?;
        let session = Session::builder(&env)
            .map_err(|e| format!("ort builder: {e}"))?
            .with_intra_threads(1)
            .map_err(|e| format!("ort intra threads: {e}"))?
            .with_inter_threads(1)
            .map_err(|e| format!("ort inter threads: {e}"))?
            // Never auto-register platform EPs: macOS defaults to CoreML,
            // which rejects this model's dynamic shapes.
            .with_auto_device(ort::session::builder::AutoDevicePolicy::PreferCPU)
            .map_err(|e| format!("ort device policy: {e}"))?
            .commit_from_file(model_path)
            .map_err(|e| format!("load {model_path}: {e}"))?;

        let voices = read_voices_npz(voices_path)?;
        if voices.is_empty() {
            return Err(format!("no voices in {voices_path}"));
        }

        espeak::initialize();
        espeak::set_voice("en-us");

        Ok(Self {
            _env: env,
            session,
            voices,
            default_voice,
            default_speed,
        })
    }

    pub fn voice_names(&self) -> Vec<String> {
        let mut names: Vec<String> = self.voices.keys().cloned().collect();
        names.sort();
        names
    }

    pub fn default_voice(&self) -> &str {
        &self.default_voice
    }

    pub fn default_speed(&self) -> f32 {
        self.default_speed
    }

    /// Phonemize one chunk exactly like
    /// `EspeakBackend(language='en-us', preserve_punctuation=True,
    /// with_stress=True).phonemize([chunk])[0]`.
    ///
    /// Caller must hold the pipeline lock (libespeak-ng has global state).
    fn phonemize_chunk(&self, chunk: &str) -> String {
        let (pieces, marks) = phonemizer::preserve_chunk(chunk);
        let mut phonemized = Vec::with_capacity(pieces.len());
        for piece in &pieces {
            let raw = unsafe { espeak::text_to_phonemes_unsafe(piece) };
            phonemized.push(phonemizer::postprocess_espeak_line(&raw));
        }
        let out = phonemizer::phonemize_chunk(phonemized, marks);
        out.into_iter().next().unwrap_or_default()
    }

    /// Mirrors `_prepare_inputs` + `generate_single_chunk`.
    fn synthesize_chunk(
        &mut self,
        chunk: &str,
        voice: &str,
        speed: f32,
    ) -> Result<Vec<f32>, String> {
        let voice_data = self
            .voices
            .get(voice)
            .ok_or_else(|| format!("Voice '{voice}' not available."))?;
        // ref_id = min(len(text), voices[voice].shape[0] - 1) — Python len()
        // counts Unicode scalar values.
        let ref_id = chunk
            .chars()
            .count()
            .min(voice_data.shape()[0].saturating_sub(1));
        let style: Array2<f32> = voice_data
            .slice(ndarray::s![ref_id..ref_id + 1, ..])
            .to_owned();

        let phonemes = self.phonemize_chunk(chunk);
        tracing::debug!(chunk, phonemes, "phonemized chunk");
        let joined = pipeline::basic_english_tokenize(&phonemes);
        let ids = pipeline::text_to_ids(&joined);
        tracing::debug!(ids = ?ids, "input ids");
        let seq = ids.len();
        let input_ids =
            Array2::from_shape_vec((1, seq), ids).map_err(|e| format!("input_ids: {e}"))?;
        let speed_arr = Array1::from_vec(vec![speed]);

        let outputs = self
            .session
            .run(ort::inputs![
                "input_ids" => Tensor::from_array(input_ids).map_err(|e| format!("tensor input_ids: {e}"))?,
                "style" => Tensor::from_array(style).map_err(|e| format!("tensor style: {e}"))?,
                "speed" => Tensor::from_array(speed_arr).map_err(|e| format!("tensor speed: {e}"))?,
            ])
            .map_err(|e| format!("inference: {e}"))?;
        let mut out_iter = outputs.iter();
        let (out_name, value) = out_iter.next().ok_or("no model outputs")?;
        tracing::debug!(output = out_name, "model output name");
        let (_shape, data) = value
            .try_extract_tensor::<f32>()
            .map_err(|e| format!("extract output: {e}"))?;
        let take = data.len().saturating_sub(TRIM_SAMPLES.min(data.len()));
        Ok(data[..take].to_vec())
    }

    /// Mirrors `generate` over `chunk_text(text)` (without the Python
    /// `TextPreprocessor`, matching `server.py` which calls
    /// `generate_single_chunk` directly).
    pub fn synthesize(&mut self, text: &str, voice: &str, speed: f32) -> Result<Vec<f32>, String> {
        let mut out = Vec::new();
        for chunk in pipeline::chunk_text(text) {
            out.extend(self.synthesize_chunk(&chunk, voice, speed)?);
        }
        if out.is_empty() {
            out.push(0.0);
        }
        Ok(out)
    }
}

pub type SharedSynthesizer = Arc<Mutex<Synthesizer>>;
