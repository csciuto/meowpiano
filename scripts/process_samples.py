#!/usr/bin/env python3
"""
Generate per-note meow samples with consistent duration and smooth loop points.

What it does
------------
1. Loads sounds/meow.ogg (the source Silas recording).
2. Finds the steady-state "oh" vowel region via RMS energy, then snaps the
   loop IN and OUT points to zero-crossings so the waveform joins cleanly.
3. Bakes a short crossfade at the loop boundary so the looping tail blends
   seamlessly into the loop head — no more meowowow.
4. Uses librosa's phase-vocoder pitch_shift to generate one OGG per note.
   Because the phase vocoder preserves duration, every note plays for exactly
   the same length of time regardless of pitch.
5. Writes sounds/notes/{name}.ogg  (# → s, e.g. Cs4.ogg).
6. Prints the detected loop points so you can paste them into state.js.

Usage
-----
    pip install librosa soundfile numpy
    python scripts/process_samples.py

After running, update js/state.js with the printed loopStart / loopEnd values.
"""

import os
import numpy as np

try:
    import librosa
    import soundfile as sf
except ImportError:
    raise SystemExit(
        "Missing dependencies. Run:\n  pip install librosa soundfile numpy"
    )

# ── Note table (mirrors js/notes.js) ─────────────────────────────────────────

SAMPLE_ROOT = 440.0  # Hz — the pitch the source recording is treated as

NOTES = [
    ("C4",  261.63), ("Cs4", 277.18), ("D4",  293.66), ("Ds4", 311.13),
    ("E4",  329.63), ("F4",  349.23), ("Fs4", 369.99), ("G4",  392.00),
    ("Gs4", 415.30), ("A4",  440.00), ("As4", 466.16), ("B4",  493.88),
    ("C5",  523.25), ("Cs5", 554.37), ("D5",  587.33), ("Ds5", 622.25),
    ("E5",  659.25), ("F5",  698.46), ("Fs5", 739.99), ("G5",  783.99),
    ("Gs5", 830.61), ("A5",  880.00), ("As5", 932.33), ("B5",  987.77),
    ("C6", 1046.50),
]

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


def semitones_from_root(freq, root=SAMPLE_ROOT):
    return 12.0 * np.log2(freq / root)


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    root_dir   = os.path.join(script_dir, '..')
    src_path   = os.path.join(root_dir, 'sounds', 'meow.ogg')
    out_dir    = os.path.join(root_dir, 'sounds', 'notes')
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
        shifted = librosa.effects.pitch_shift(y, sr=sr, n_steps=n_steps)
        shifted = bake(shifted)

        out_path = os.path.join(out_dir, f"{name}.ogg")
        sf.write(out_path, shifted, sr, format='OGG', subtype='VORBIS')
        print(f"  {name}.ogg  ({n_steps:+.2f} semitones)")

    print(f"\nDone. {len(NOTES)} files written to sounds/notes/")
    print(f"\nNext steps:")
    print(f"  1. In js/state.js set loopStart={ls_sec:.2f}, loopEnd={le_sec:.2f}")
    print(f"  2. Refresh the browser — no other JS changes needed.")


if __name__ == '__main__':
    main()
