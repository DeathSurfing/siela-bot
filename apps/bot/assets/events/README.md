# Scheduled voice event audio

Place licensed audio files here. The scheduler skips a file-based phase if its file is missing.

Required filenames (one of `.ogg`, `.mp3`, `.wav`, `.m4a`, `.flac`):

- `azan` — played at the selected Delhi prayer time in a VC named `masjid`
- `anthem` — played one hour later in a VC named `parliament`
- `hanuman-chalisa` — played two hours later in a VC named `mandir`

YouTube-streamed phases (no local file needed, streamed via yt-dlp + ffmpeg):

- `church` — played three hours later in a VC named `church`
  (`https://www.youtube.com/watch?v=nCxqjEz5hJ4` — The Lord's Prayer, Hillsong Worship)
- `monastery` — played four hours later in a VC named `monastery`
  (`https://www.youtube.com/watch?v=O3tqJfgYWOs` — Om mani padme hum)
- `gurudwara` — played five hours later in a VC named `gurudwara`
  (`https://www.youtube.com/watch?v=QJwu2BMnf2I` — Gurbani, Daler Mehndi)

Only use recordings you have the rights to use. The bot does not download or bundle
copyrighted recordings.

The prayer time is fetched from Aladhan for Delhi. Set `EVENT_PRAYER` to
`Fajr`, `Dhuhr`, `Asr`, `Maghrib`, or `Isha` (default `Dhuhr`), and set
`EVENT_SCHEDULE_ENABLED=true` to enable the schedule.

Only members already connected to a voice channel can be moved. The bot creates or
reuses a voice channel inside a `Scheduled Events` category.
