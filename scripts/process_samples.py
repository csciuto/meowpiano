#!/usr/bin/env python3
"""
Generate per-note meow samples with consistent duration and smooth loop points.

What it does
------------
1. Loads sounds/meow.ogg (the source Silas recording).
2. Finds the steady-state "oh" vowel region via RMS energy, then snaps the
   loop IN and OUT points to zero-crossings so the waveform joins cleanly.
3. High-passes at 200 Hz: the recording has rumble (8-80 Hz, room or handling
   noise) under the whole clip, heard as a faint beat. The meow itself never
   goes below ~600 Hz, so nothing of the cat is lost.
4. Removes a steady hum (~120 Hz fundamental, overtones at 237, 361, 478,
   597 Hz...; likely a fan or motor in the room) by spectral subtraction:
   whatever is steady through the whole clip (each frequency's quiet level,
   its 20th percentile over time) is subtracted. The meow is far louder than
   that background, so it loses only ~0.6 dB. Notch filters wouldn't do: the
   597 Hz overtone sits on the meow's own pitch (600-650 Hz).
5. Bakes a short crossfade at the loop boundary so the looping tail blends
   seamlessly into the loop head — no more meowowow.
6. Uses librosa's phase-vocoder pitch_shift to generate one OGG per note.
   Because the phase vocoder preserves duration, every note plays for exactly
   the same length of time regardless of pitch.
7. Writes sounds/notes/{name}.ogg  (# → s, e.g. Cs4.ogg).
8. Prints the detected loop points so you can paste them into state.js.

Usage
-----
    pip install librosa soundfile numpy scipy
    python scripts/process_samples.py

    # the other pitch shifter (see shift_keeping_formants), into a folder of its own to compare by ear:
    pip install praat-parselmouth
    python scripts/process_samples.py --formant --out /tmp/notes-formant

After running, update js/state.js with the printed loopStart / loopEnd values.
"""

import os
import sys
import numpy as np

try:
    import librosa
    from scipy.signal import butter, sosfiltfilt, stft, istft
    import soundfile as sf
except ImportError:
    raise SystemExit(
        "Missing dependencies. Run:\n  pip install librosa soundfile numpy scipy"
    )

# ── Note table (mirrors js/notes.js) ─────────────────────────────────────────

HIGHPASS_HZ = 200.0  # below the meow (~600 Hz), above the rumble (8-80 Hz)

SAMPLE_ROOT = 630.0  # Hz: the measured pitch of the held part of the meow (0.26-0.46 s), so keys sound at their names

# Every semitone from C2 to C8 (MIDI 36-108): the piano's five ranges, each note with its own file.
_NAMES = ["C", "Cs", "D", "Ds", "E", "F", "Fs", "G", "Gs", "A", "As", "B"]
NOTES = [(f"{_NAMES[m % 12]}{m // 12 - 1}", 440.0 * 2 ** ((m - 69) / 12)) for m in range(36, 109)]

# ── Helpers ───────────────────────────────────────────────────────────────────

def find_loop_region(y, sr, min_dur=0.15):
    """
    Return (loop_start_samples, loop_end_samples) for the steady-state vowel.

    Strategy:
      - Compute short-time RMS.
      - Define "loud" as >= 70 % of peak RMS.
      - Take the first and last loud frames as the loop boundaries.
      - Enforce a minimum loop duration.
      - Snap both boundaries to the nearest zero-crossing.
    """
    hop = 256
    frame_len = 1024
    rms = librosa.feature.rms(y=y, frame_length=frame_len, hop_length=hop)[0]

    peak = rms.max()
    threshold = peak * 0.70
    loud = np.where(rms >= threshold)[0]

    if loud.size < 2:
        # Fallback: use the middle 50 % of the sample
        n = len(y)
        return int(n * 0.25), int(n * 0.75)

    s_samples = librosa.frames_to_samples(loud[0],  hop_length=hop)
    e_samples = librosa.frames_to_samples(loud[-1], hop_length=hop)

    # Enforce minimum loop duration
    min_samp = int(min_dur * sr)
    if e_samples - s_samples < min_samp:
        mid = (s_samples + e_samples) // 2
        s_samples = max(0, mid - min_samp // 2)
        e_samples = min(len(y), mid + min_samp // 2)

    # Snap to nearest zero-crossing within a small search window
    def snap_zc(sig, pos, window=int(0.01 * 44100)):
        lo = max(0, pos - window)
        hi = min(len(sig), pos + window)
        zc = np.where(np.diff(np.signbit(sig[lo:hi])))[0]
        if zc.size == 0:
            return pos
        return lo + zc[np.argmin(np.abs(zc - (pos - lo)))]

    s_samples = snap_zc(y, s_samples)
    e_samples = snap_zc(y, e_samples)

    return int(s_samples), int(e_samples)


def bake_crossfade(y, loop_start, loop_end, fade_ms=15):
    """
    Blend the very end of the loop region back into the very start so that
    when the audio loops from loop_end → loop_start the transition is smooth.

    The crossfade is baked *before* loop_end: the tail of the loop fades out
    while the head of the loop (offset-copied to that position) fades in.
    This means playback of the loop region itself sounds identical — the
    blend only affects the invisible join.
    """
    sr_est = 44100  # will be overridden by actual sr in main()
    fade_samples = int(fade_ms * sr_est / 1000)
    fade_samples = min(fade_samples, (loop_end - loop_start) // 4)
    if fade_samples < 2:
        return y

    out = y.copy()
    tail  = out[loop_end   - fade_samples : loop_end].copy()
    head  = out[loop_start : loop_start + fade_samples].copy()

    fade_out = np.linspace(1.0, 0.0, fade_samples)
    fade_in  = np.linspace(0.0, 1.0, fade_samples)

    out[loop_end - fade_samples : loop_end] = tail * fade_out + head * fade_in
    return out


def remove_hum(y, sr, over=2.0, floor=0.05, n_fft=4096, hop=1024):
    """Spectral subtraction of the clip's steady background (the hum)."""
    _, _, Z = stft(y, sr, nperseg=n_fft, noverlap=n_fft - hop)
    mag = np.abs(Z)
    steady = np.percentile(mag, 20, axis=1, keepdims=True)
    gain = np.maximum(1 - over * steady / (mag + 1e-12), floor)
    _, out = istft(Z * gain, sr, nperseg=n_fft, noverlap=n_fft - hop)
    return out[:len(y)]


def shift_keeping_formants(y, sr, n_steps):
    """
    Pitch-shift by re-spacing the meow's own pitch periods (PSOLA, through Praat), which moves the
    pitch but leaves the voice's resonances (formants) where they are.

    The phase vocoder moves everything together: up an octave, the cat's 3 kHz resonance lands at 6 kHz
    and the top keys measure about 15 dB hotter above 4 kHz than the recording, while the bottom keys
    go dull. This keeps that band within a few dB of the recording on every key.
    """
    import parselmouth
    from parselmouth.praat import call
    snd = parselmouth.Sound(y.astype(np.float64), sampling_frequency=sr)
    # the meow runs about 600-650 Hz; look for pitch between 300 and 1200
    man = call(snd, "To Manipulation", 0.005, 300, 1200)
    tier = call(man, "Extract pitch tier")
    call(tier, "Multiply frequencies", snd.xmin, snd.xmax, 2 ** (n_steps / 12))
    call([tier, man], "Replace pitch tier")
    out = call(man, "Get resynthesis (overlap-add)").values[0]
    return out[:len(y)] if len(out) >= len(y) else np.pad(out, (0, len(y) - len(out)))


def semitones_from_root(freq, root=SAMPLE_ROOT):
    return 12.0 * np.log2(freq / root)


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    root_dir   = os.path.join(script_dir, '..')
    src_path   = os.path.join(root_dir, 'sounds', 'meow.ogg')
    out_dir    = os.path.join(root_dir, 'sounds', 'notes')
    formant    = '--formant' in sys.argv
    if '--out' in sys.argv:
        out_dir = sys.argv[sys.argv.index('--out') + 1]
    os.makedirs(out_dir, exist_ok=True)

    print(f"Loading {src_path} ...")
    y, sr = librosa.load(src_path, sr=None, mono=True)
    duration = len(y) / sr
    print(f"  sr={sr}  duration={duration:.3f}s  samples={len(y)}")

    ls, le = find_loop_region(y, sr)
    ls_sec = ls / sr
    le_sec = le / sr
    print(f"\nDetected loop region: {ls_sec:.3f}s – {le_sec:.3f}s")
    print(f"  *** Update js/state.js: loopStart={ls_sec:.2f}, loopEnd={le_sec:.2f} ***\n")

    # After loop detection (which the rumble has always been part of), so the
    # baked crossfade stays where it was. Zero-phase, so timing doesn't move.
    y = sosfiltfilt(butter(8, HIGHPASS_HZ, 'highpass', fs=sr, output='sos'), y)
    print(f"  high-passed at {HIGHPASS_HZ:.0f} Hz")
    y = remove_hum(y, sr)
    print("  removed the steady hum")

    # Override fade_ms sr estimate with actual sr
    def bake(y_in):
        fade_samples = int(15 * sr / 1000)
        fade_samples = min(fade_samples, (le - ls) // 4)
        if fade_samples < 2:
            return y_in
        out = y_in.copy()
        tail = out[le - fade_samples : le].copy()
        head = out[ls : ls + fade_samples].copy()
        fo = np.linspace(1.0, 0.0, fade_samples)
        fi = np.linspace(0.0, 1.0, fade_samples)
        out[le - fade_samples : le] = tail * fo + head * fi
        return out

    for name, freq in NOTES:
        n_steps = semitones_from_root(freq)
        shifted = shift_keeping_formants(y, sr, n_steps) if formant else librosa.effects.pitch_shift(y, sr=sr, n_steps=n_steps)
        shifted = bake(shifted)

        out_path = os.path.join(out_dir, f"{name}.ogg")
        sf.write(out_path, shifted, sr, format='OGG', subtype='VORBIS')
        print(f"  {name}.ogg  ({n_steps:+.2f} semitones)")

    print(f"\nDone. {len(NOTES)} files written to {out_dir}")
    print(f"\nNext steps:")
    print(f"  1. In js/state.js set loopStart={ls_sec:.2f}, loopEnd={le_sec:.2f}")
    print(f"  2. Refresh the browser — no other JS changes needed.")


if __name__ == '__main__':
    main()
