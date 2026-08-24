/**
 * Captures the active tab's own audio (see main/index.ts's
 * setDisplayMediaRequestHandler, which fulfills the request below by
 * handing back the active tab's WebFrameMain for both video and audio, no
 * picker UI since there's only ever one thing to capture) for live
 * translate, chunking it into whisper.cpp-ready 16kHz mono WAV blobs sent
 * to main over IPC.
 *
 * This is genuinely per-tab, not whole-window loopback - a background tab
 * playing something else doesn't bleed in. Whole-window loopback (the
 * `audio: 'loopback'` string form) was tried first and dropped: Electron's
 * own docs say that string is Windows-only, and on macOS it silently
 * resolves with an audio track that's permanently all zeroes - no error,
 * no warning, confirmed by hand with a raw AnalyserNode reading straight
 * off the stream.
 *
 * Chunk boundaries are voice-activity-detected, not a fixed clock: a chunk
 * ends when a real pause in speech is found, so whisper almost always sees
 * a complete thought instead of a sentence sliced at an arbitrary instant -
 * confirmed by hand to be the single biggest lever on both transcription
 * and downstream translation accuracy, well ahead of model choice. See
 * the VAD section below for how "is this actually speech, not just
 * background noise" is decided, and MAX_CHUNK_MS for the hard guarantee
 * that a stretch of continuous noise (or continuous speech with no pause)
 * can never stall the pipeline waiting for a "silence" that never comes.
 */
const TARGET_SAMPLE_RATE = 16000;
const PROCESSOR_BUFFER_SIZE = 4096;

// --- Voice-activity detection (chunk boundaries) ---
//
// Energy-based VAD against an ADAPTIVE noise floor, not a single fixed
// RMS threshold - deliberately, because there's no one absolute number
// that works across "a quiet screencast" and "a video with a music bed
// under the dialogue." The floor slowly tracks whatever the ambient
// level actually is during non-speech stretches, and a frame only counts
// as speech once it's meaningfully ABOVE that tracked floor - so steady
// background noise gets absorbed into the baseline instead of
// permanently reading as "someone's talking," which is exactly the
// failure mode that would otherwise starve the pipeline of any detected
// pause at all (see MAX_CHUNK_MS below for the belt-and-suspenders
// guarantee on top of this).
//
// Measured on a band-limited copy of the signal (roughly the classic
// 300Hz-3400Hz telephone/speech-intelligibility band - see the biquad
// filter chain below), not the raw full-band audio, so a low hum or
// high-frequency hiss outside that band doesn't factor into "is this
// speech" at all, on top of the adaptive-floor protection above.
const SPEECH_MULTIPLIER = 2.5; // how far above the tracked floor counts as speech
const NOISE_FLOOR_ADAPT_RATE = 0.02; // per-frame EMA weight when adapting the floor during quiet stretches
const MIN_NOISE_FLOOR = 0.0005; // floor for the floor itself, so near-total digital silence can't make any faint noise trivially "speech"

// Never cut earlier than this even on an early pause - confirmed by hand
// (back when chunking was a fixed clock): whisper's smaller models need a
// couple of seconds of non-English audio before attempting a real
// transcription at all; too little and it falls back to literally
// emitting the bracketed placeholder "(Speaking foreign language)"
// instead of trying. That constraint doesn't go away just because
// chunking is now boundary-aware, so this stays comfortably above it.
const MIN_CHUNK_MS = 2000;
// The actual deadlock guard the VAD's adaptive floor is backup insurance
// for, not a replacement for: cut here regardless of VAD state, so
// continuous noise the floor hasn't adapted to yet, or someone genuinely
// talking for a long stretch with no pause, can never grow the buffer
// unboundedly or stall translation waiting for a pause that never comes.
const MAX_CHUNK_MS = 7000;
// How long a real pause (per the VAD, not raw RMS) must hold before it
// counts as a sentence boundary worth cutting on - long enough to be a
// genuine gap, short enough not to add much latency on top of it.
const SILENCE_HOLD_MS = 400;
// A chunk needs at least this much CUMULATIVE speech-classified time before
// it's worth sending to whisper at all - not just "did any single frame
// ever cross the threshold." Without this, one brief transient (a music
// beat, a knock, a noise blip a bit louder than the tracked floor) latches
// "this chunk has speech" for the whole buffer, and an otherwise-silent or
// pure-music chunk gets shipped to whisper anyway - which, given audio with
// no real speech in it, doesn't just come back empty, it hallucinates
// plausible-sounding gibberish (whisper models are trained to always
// produce SOME text). ~4 VAD frames' worth at typical settings - long
// enough to filter transients, short enough not to drop genuinely brief
// real utterances ("yes", "no").
const MIN_SPEECH_MS_TO_EMIT = 350;

// Electron's systemPreferences.getMediaAccessStatus('screen') is not
// trustworthy for this - confirmed by hand: it reported 'granted' while
// System Settings showed Electron wasn't even in the Screen & System Audio
// Recording list. Since Chromium hands back a *resolved* audio track that's
// just pure silence when this permission is missing (no error, no signal
// anything's wrong), the only reliable tell is measuring the actual audio -
// real digital silence for a while, not just a quiet moment in whatever's
// playing. RMS this low is silence, not "quiet" - even a soft-spoken video
// has a noise floor well above it. Deliberately separate from the VAD
// above (full-band, not the speech-band-filtered signal, and a fixed
// threshold rather than adaptive) - this is checking "is any real audio
// reaching this app at all," a different question from "is someone
// talking right now."
const SILENCE_RMS_THRESHOLD = 0.001;
// 14s of unbroken silence before concluding this isn't just a pause -
// long enough that a real gap in dialogue won't false-positive. Tracked
// in real time now (chunks are variable-length) rather than a fixed
// chunk count, to keep the same ~14s trigger point regardless of how long
// any individual chunk happened to be.
const SILENT_MS_BEFORE_WARNING = 14_000;

export interface AudioCaptureHandle {
  stop: () => void;
}

function rms(samples: Float32Array): number {
  let sumSquares = 0;
  for (let i = 0; i < samples.length; i++) sumSquares += samples[i] * samples[i];
  return Math.sqrt(sumSquares / samples.length);
}

export async function startAudioCapture(
  onChunk: (wavBytes: Uint8Array) => void,
  onPersistentSilence?: () => void,
): Promise<AudioCaptureHandle> {
  // video: true is required even though only audio matters - getDisplayMedia
  // has no audio-only mode. The video track is stopped immediately below
  // without ever being rendered anywhere.
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  stream.getVideoTracks().forEach((track) => {
    track.stop();
    stream.removeTrack(track);
  });

  if (stream.getAudioTracks().length === 0) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error("Couldn't capture system audio - no audio track was granted.");
  }

  const captureCtx = new AudioContext();
  const source = captureCtx.createMediaStreamSource(stream);
  // ScriptProcessorNode is deprecated in favor of AudioWorkletNode, but
  // needs no separate module file to load - simplicity wins here given
  // live translate already accepts several seconds of pipeline latency,
  // so this node's own small extra overhead is immaterial.
  const processor = captureCtx.createScriptProcessor(PROCESSOR_BUFFER_SIZE, 1, 1);

  // onaudioprocess (and, per the same pull-based-graph requirement, the
  // VAD analyser below) only fires/updates while connected all the way to
  // a destination - route both through this shared silent sink so nothing
  // is actually audible twice (the real audio is already playing on its
  // own) while still keeping the whole chain "live."
  const silentSink = captureCtx.createGain();
  silentSink.gain.value = 0;
  silentSink.connect(captureCtx.destination);

  // VAD tap: a parallel branch off `source`, band-limited to roughly
  // speech-intelligibility range before being measured - the audio sent
  // to whisper (via `processor`, below) stays full-band; only the
  // boundary-detection signal is filtered.
  const highpass = captureCtx.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 300;
  const lowpass = captureCtx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 3400;
  const vadAnalyser = captureCtx.createAnalyser();
  vadAnalyser.fftSize = 2048;
  const vadScratch = new Float32Array(vadAnalyser.fftSize);
  source.connect(highpass);
  highpass.connect(lowpass);
  lowpass.connect(vadAnalyser);
  vadAnalyser.connect(silentSink);

  let buffered: Float32Array[] = [];
  let bufferedSamples = 0;
  let chunkDurationMs = 0;
  let silenceMs = 0;
  let hasSpeechInBuffer = false;
  // Cumulative time classified as speech in the CURRENT buffer - the
  // stricter, duration-based signal MIN_SPEECH_MS_TO_EMIT gates on;
  // hasSpeechInBuffer stays a plain boolean latch, used only to decide
  // whether a pause is worth treating as a natural cut point at all (see
  // naturalBoundary below), a looser bar than "worth actually
  // transcribing."
  let speechMs = 0;
  let noiseFloor = MIN_NOISE_FLOOR;

  let silentMsAccumulated = 0;
  let silenceWarned = false;

  processor.onaudioprocess = (event) => {
    // The input buffer is reused by the browser after this callback
    // returns, so it has to be copied, not just referenced.
    const channelData = event.inputBuffer.getChannelData(0);
    buffered.push(new Float32Array(channelData));
    bufferedSamples += channelData.length;
    const frameMs = (channelData.length / captureCtx.sampleRate) * 1000;
    chunkDurationMs += frameMs;

    vadAnalyser.getFloatTimeDomainData(vadScratch);
    const bandRms = rms(vadScratch);
    const isSpeechFrame = bandRms >= noiseFloor * SPEECH_MULTIPLIER;

    if (isSpeechFrame) {
      hasSpeechInBuffer = true;
      speechMs += frameMs;
      silenceMs = 0;
    } else {
      silenceMs += frameMs;
      // Only adapt during presumed non-speech - adapting on loud speech
      // too would let the floor chase the speech itself upward and
      // defeat the whole point of a stable baseline to compare against.
      noiseFloor = Math.max(MIN_NOISE_FLOOR, noiseFloor * (1 - NOISE_FLOOR_ADAPT_RATE) + bandRms * NOISE_FLOOR_ADAPT_RATE);
    }

    const naturalBoundary = hasSpeechInBuffer && chunkDurationMs >= MIN_CHUNK_MS && silenceMs >= SILENCE_HOLD_MS;
    const forcedBoundary = chunkDurationMs >= MAX_CHUNK_MS;

    if (naturalBoundary || forcedBoundary) {
      const merged = mergeChunks(buffered, bufferedSamples);
      const shouldEmit = speechMs >= MIN_SPEECH_MS_TO_EMIT;

      if (onPersistentSilence && !silenceWarned) {
        if (rms(merged) < SILENCE_RMS_THRESHOLD) {
          silentMsAccumulated += chunkDurationMs;
          if (silentMsAccumulated >= SILENT_MS_BEFORE_WARNING) {
            silenceWarned = true;
            onPersistentSilence();
          }
        } else {
          silentMsAccumulated = 0;
        }
      }

      // A chunk without enough cumulative speech - pure silence/noise, or a
      // stretch of music/ambient sound with at most a brief transient that
      // crossed the floor - has nothing real worth transcribing; skip the
      // whisper call entirely rather than feeding it audio that (being
      // mostly non-speech) it can only hallucinate an answer for.
      if (shouldEmit) {
        void resampleTo16kMonoWav(merged, captureCtx.sampleRate).then(onChunk);
      }

      buffered = [];
      bufferedSamples = 0;
      chunkDurationMs = 0;
      silenceMs = 0;
      hasSpeechInBuffer = false;
      speechMs = 0;
    }
  };

  source.connect(processor);
  processor.connect(silentSink);

  return {
    stop: () => {
      processor.disconnect();
      vadAnalyser.disconnect();
      lowpass.disconnect();
      highpass.disconnect();
      source.disconnect();
      silentSink.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      void captureCtx.close();
    },
  };
}

function mergeChunks(chunks: Float32Array[], totalSamples: number): Float32Array {
  const merged = new Float32Array(totalSamples);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

/** Uses an OfflineAudioContext for the actual resampling - the browser's
 * own conversion, rather than hand-rolled linear interpolation, so the
 * result doesn't introduce aliasing artifacts whisper's accuracy would be
 * sensitive to. whisper.cpp requires 16kHz mono input; this is a hard
 * requirement of the model itself, not a suggestion. */
async function resampleTo16kMonoWav(samples: Float32Array, sourceSampleRate: number): Promise<Uint8Array> {
  if (sourceSampleRate === TARGET_SAMPLE_RATE) return encodeWav(samples, TARGET_SAMPLE_RATE);

  const durationSeconds = samples.length / sourceSampleRate;
  const offlineCtx = new OfflineAudioContext(1, Math.ceil(durationSeconds * TARGET_SAMPLE_RATE), TARGET_SAMPLE_RATE);
  const buffer = offlineCtx.createBuffer(1, samples.length, sourceSampleRate);
  // TS 5.7+'s typed-array generics infer plain `Float32Array` as
  // ArrayBufferLike-backed, while AudioBuffer.copyToChannel's DOM types
  // specifically want the concrete ArrayBuffer-backed variant - a known
  // friction point between the two, not an actual type mismatch at runtime.
  buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
  const bufferSource = offlineCtx.createBufferSource();
  bufferSource.buffer = buffer;
  bufferSource.connect(offlineCtx.destination);
  bufferSource.start();
  const rendered = await offlineCtx.startRendering();
  return encodeWav(rendered.getChannelData(0), TARGET_SAMPLE_RATE);
}

/** Hand-rolled 16-bit PCM mono WAV encoding - a 44-byte header is simple
 * enough that pulling in a library for it isn't worth it. */
function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true); // byte rate
  view.setUint16(32, bytesPerSample, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }

  return new Uint8Array(buffer);
}
