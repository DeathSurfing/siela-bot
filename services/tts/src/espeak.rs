//! Minimal FFI bindings to libespeak-ng, mirroring exactly what
//! phonemizer 3.4.0's `EspeakWrapper` uses:
//!   - `espeak_Initialize(0x02 /* AUDIO_OUTPUT_SYNCHRONOUS */, 0, NULL, 0)`
//!   - `espeak_SetVoiceByName("en-us")`
//!   - `espeak_TextToPhonemes(ptr, textmode=1 /* UTF-8 */, phonememode=0x02 | ('_' << 8) /* IPA, '_' separated */)`
//! looped until the text pointer goes NULL, results joined with ' '.
//!
//! NOTE: libespeak-ng keeps massive global state and is not thread-safe.
//! All calls must be serialized behind the pipeline mutex (see synthesis.rs).

use std::ffi::{CStr, CString};
use std::os::raw::{c_char, c_int, c_void};

unsafe extern "C" {
    fn espeak_Initialize(output: c_int, buflength: c_int, path: *const c_char, options: c_int)
        -> c_int;
    fn espeak_SetVoiceByName(name: *const c_char) -> c_int;
    fn espeak_Terminate() -> c_int;
    fn espeak_TextToPhonemes(
        textptr: *mut *const c_void,
        textmode: c_int,
        phonememode: c_int,
    ) -> *const c_char;
}

const AUDIO_OUTPUT_SYNCHRONOUS: c_int = 0x02;
const TEXTMODE_UTF8: c_int = 1;
const PHONEMEMODE_IPA_UNDERSCORE: c_int = 0x02 | ((b'_' as c_int) << 8);

/// Initialize the library. Mirrors `EspeakAPI.__init__`.
pub fn initialize() {
    let ret = unsafe { espeak_Initialize(AUDIO_OUTPUT_SYNCHRONOUS, 0, std::ptr::null(), 0) };
    assert!(ret > 0, "failed to initialize espeak shared library");
}

/// Select the voice. Mirrors `EspeakWrapper.set_voice("en-us")`.
pub fn set_voice(name: &str) {
    let cname = CString::new(name).expect("voice name contains NUL");
    let ret = unsafe { espeak_SetVoiceByName(cname.as_ptr()) };
    assert_eq!(ret, 0, "espeak voice '{name}' cannot be set");
}

pub fn terminate() {
    unsafe {
        espeak_Terminate();
    }
}

/// Raw `text_to_phonemes` loop. Returns espeak's output with '_' phoneme
/// separators and ' ' word separators, before phonemizer post-processing.
///
/// # Safety
/// libespeak-ng is not thread-safe; caller must hold the pipeline lock.
pub unsafe fn text_to_phonemes_unsafe(text: &str) -> String {
    let owned = CString::new(text).expect("text contains NUL");
    let bytes = owned.into_bytes_with_nul();
    // Stable pointer to the buffer start; espeak advances it as it consumes text.
    let mut ptr: *const c_void = bytes.as_ptr() as *const c_void;
    // Keep the buffer alive for the whole loop.
    let _keep_alive = &bytes;
    let mut parts: Vec<String> = Vec::new();
    loop {
        let out = unsafe {
            espeak_TextToPhonemes(
                &mut ptr as *mut *const c_void,
                TEXTMODE_UTF8,
                PHONEMEMODE_IPA_UNDERSCORE,
            )
        };
        if !out.is_null() {
            let s = unsafe { CStr::from_ptr(out) }.to_string_lossy().into_owned();
            // Mirrors phonemizer's `if phonemes:` — empty outputs are skipped.
            if !s.is_empty() {
                parts.push(s);
            }
        }
        if ptr.is_null() {
            break;
        }
    }
    parts.join(" ")
}
