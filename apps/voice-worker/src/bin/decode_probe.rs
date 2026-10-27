//! Decode probe: proves in-process decoding works on real captures.
//!
//! Run with a media file to confirm symphonia handles the formats yt-dlp
//! returns, so the worker can avoid spawning a decoder process per stream.

use std::fs::File;
use std::path::PathBuf;

use symphonia::core::codecs::DecoderOptions;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let path: PathBuf = std::env::args()
        .nth(1)
        .expect("usage: decode_probe <media file>")
        .into();

    let file = File::open(&path)?;
    let stream = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|value| value.to_str()) {
        hint.with_extension(ext);
    }

    let probed = symphonia::default::get_probe().format(
        &hint,
        stream,
        &FormatOptions::default(),
        &MetadataOptions::default(),
    )?;

    let mut format = probed.format;
    let track = format
        .default_track()
        .ok_or("no default track")?;
    let track_id = track.id;
    let codec = track.codec_params.codec;

    let mut decoder =
        symphonia::default::get_codecs().make(&track.codec_params, &DecoderOptions::default())?;

    let mut frames: u64 = 0;
    let mut samples: u64 = 0;
    let sample_rate = track.codec_params.sample_rate.unwrap_or(0);
    let channels = track.codec_params.channels.map(|c| c.count()).unwrap_or(0);

    loop {
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(symphonia::core::errors::Error::IoError(error))
                if error.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(symphonia::core::errors::Error::ResetRequired) => break,
            Err(error) => return Err(error.into()),
        };
        if packet.track_id() != track_id {
            continue;
        }
        match decoder.decode(&packet) {
            Ok(decoded) => {
                frames += 1;
                samples += decoded.frames() as u64;
            }
            Err(symphonia::core::errors::Error::DecodeError(_)) => continue,
            Err(error) => return Err(error.into()),
        }
    }

    let seconds = if sample_rate > 0 {
        samples as f64 / sample_rate as f64
    } else {
        0.0
    };

    println!(
        "decoded ok: codec={codec:?} rate={sample_rate}Hz channels={channels} packets={frames} seconds={seconds:.1}"
    );

    if samples == 0 {
        return Err("decoder produced no audio".into());
    }
    Ok(())
}
