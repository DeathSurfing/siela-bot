//! WAV encoding. Mirrors `server.py`:
//!   - `/synthesize-stream`: raw WAV header with 0xFFFFFFFF sizes, then
//!     `clip(audio) * 32767` little-endian i16 samples, chunk by chunk.
//!   - `/synthesize`: standard 16-bit PCM WAV (soundfile default subtype).

use crate::synthesis::SAMPLE_RATE;

pub fn wav_stream_header() -> Vec<u8> {
    // Mirrors `wav_header()`: RIFF/0xFFFFFFFF/WAVE/fmt /16/1ch/24k/…/data/0xFFFFFFFF.
    let mut h = Vec::with_capacity(44);
    h.extend_from_slice(b"RIFF");
    h.extend_from_slice(&0xFFFFFFFFu32.to_le_bytes());
    h.extend_from_slice(b"WAVE");
    h.extend_from_slice(b"fmt ");
    h.extend_from_slice(&16u32.to_le_bytes());
    h.extend_from_slice(&1u16.to_le_bytes()); // PCM
    h.extend_from_slice(&1u16.to_le_bytes()); // mono
    h.extend_from_slice(&SAMPLE_RATE.to_le_bytes());
    let byte_rate = SAMPLE_RATE * 2;
    h.extend_from_slice(&byte_rate.to_le_bytes());
    h.extend_from_slice(&2u16.to_le_bytes()); // block align
    h.extend_from_slice(&16u16.to_le_bytes()); // bits
    h.extend_from_slice(b"data");
    h.extend_from_slice(&0xFFFFFFFFu32.to_le_bytes());
    h
}

/// Mirrors `(audio * 32767.0).astype("<i2")` after `np.clip(audio, ±1)`.
pub fn to_i16_samples(audio: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(audio.len() * 2);
    for &s in audio {
        let clipped = s.clamp(-1.0, 1.0);
        out.extend_from_slice(&((clipped * 32767.0) as i16).to_le_bytes());
    }
    out
}

/// Buffered 16-bit PCM WAV, mirroring `sf.write(buffer, audio, 24000)`.
pub fn encode_wav_i16(audio: &[f32]) -> Vec<u8> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: SAMPLE_RATE,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut buf = Vec::new();
    {
        let mut writer = hound::WavWriter::new(std::io::Cursor::new(&mut buf), spec)
            .expect("wav writer");
        for &s in audio {
            let clipped = s.clamp(-1.0, 1.0);
            writer
                .write_sample((clipped * 32767.0) as i16)
                .expect("wav sample");
        }
        writer.finalize().expect("wav finalize");
    }
    buf
}
