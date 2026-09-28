# 2026-09-23 ALSA native runtime change review

> Last updated: 2026-09-28

This is a partial build of the current source working tree plus an FC4 smoke test, not a clean
Core artifact or final device acceptance.
It is recorded separately from the installed `3e420f78` artifact used by the
[fix package re-verification](./alsa-acceptance-2026-09-23.md).

- Ran `cargo build -p audio-engine --release --features diretta` with Diretta SDK 150 and CPU v3.
  The resulting `target/release/libaudio_engine.so` SHA256 is
  `f9da8cda20fa75e40ce28dc0e15e8479e520a507343549d1d2c8e694f77989a1`.
  The module was copied to a temporary `.node`, and Node loading and device enumeration succeeded.
  At build time the working tree contained uncommitted source, so this hash only identifies this
  local module, not a release artifact.
- The regular `audio-engine-core` 172 unit tests pass; the 167 with the Diretta feature pass.
  `cargo check -p audio-engine --features diretta` passes.
- Core was originally FC4 Direct with a single track paused at 2961 ms. The old output was first
  stopped through the Core API, then the native module above was used to open that same FC4 and a
  local 44.1 kHz / 16-bit stereo FLAC on its own.
  After Processed playback, seeking to 30 s kept the state at playing and `processed-pcm`, with
  the position then observed at 30.45 s; after stopping and switching to Direct, playback had
  state playing and path `exact-pcm`.
- On test exit the native output was released, then the Core API restored FC4 Direct with a
  single track paused, position 2961 ms, path `exact-pcm`. The installed Core artifact was not
  replaced.

This round covers Processed seek and basic Direct playback under the new runtime; it does not
cover long playback, the full mode/format matrix, the final digital output, or the completion
criteria of the full ALSA plan.
