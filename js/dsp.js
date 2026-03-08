/**
 * Scan `data` in steps of subLen/2 and return the start frame of the
 * `windowLen`-frame window with the lowest RMS variance across its
 * `subLen`-frame sub-windows.  In other words: find the most
 * amplitude-stable region to use as a sustain loop.
 *
 * @param {Float32Array} data
 * @param {number} searchStart  first valid window-start frame (inclusive)
 * @param {number} searchEnd    last valid window-end   frame (exclusive)
 * @param {number} windowLen    loop window length in frames
 * @param {number} subLen       RMS sub-window length in frames
 * @returns {number} absolute frame index of the best window start
 */
export function findStableWindow(data, searchStart, searchEnd, windowLen, subLen) {
  let bestVar   = Infinity;
  let bestStart = searchStart;
  const step    = Math.max(1, Math.floor(subLen / 2));

  for (let s = searchStart; s + windowLen <= searchEnd; s += step) {
    const rms = [];
    for (let sub = s; sub + subLen <= s + windowLen; sub += subLen) {
      let sum = 0;
      for (let i = sub; i < sub + subLen; i++) sum += data[i] * data[i];
      rms.push(Math.sqrt(sum / subLen));
    }
    if (rms.length === 0) continue;
    const mean     = rms.reduce((a, b) => a + b, 0) / rms.length;
    const variance = rms.reduce((a, v) => a + (v - mean) ** 2, 0) / rms.length;
    if (variance < bestVar) { bestVar = variance; bestStart = s; }
  }
  return bestStart;
}

/**
 * Find the nearest zero-crossing to `frame` within ±`maxRadius` frames.
 * A zero crossing at index i means data[i-1] * data[i] <= 0 (sign change or
 * a sample sitting exactly on zero).  Ties within the same radius prefer the
 * forward direction.  Returns `frame` unchanged if nothing is found.
 *
 * @param {Float32Array} data
 * @param {number} frame      starting frame
 * @param {number} maxRadius  maximum search distance in frames
 * @returns {number} frame index of the nearest zero crossing
 */
export function nearestZeroCrossing(data, frame, maxRadius) {
  for (let r = 0; r <= maxRadius; r++) {
    const fwd = frame + r;
    if (fwd < data.length && fwd >= 1 && data[fwd - 1] * data[fwd] <= 0) return fwd;
    if (r > 0) {
      const bwd = frame - r;
      if (bwd >= 1 && data[bwd - 1] * data[bwd] <= 0) return bwd;
    }
  }
  return frame; // fallback — no crossing found within radius
}

/**
 * Smooth the loop seam by crossfading the loop tail into the loop head.
 * Mutates `data` in place.
 *
 * The last `crossFrames` samples before `leF` blend from their original
 * values toward the corresponding samples at the loop head, so the
 * wrap-around is click-free.  `crossFrames` is clamped to half the loop
 * length so we never crossfade more than we have.
 *
 * @param {Float32Array} data
 * @param {number} lsF         loop start frame (inclusive)
 * @param {number} leF         loop end frame (exclusive)
 * @param {number} crossFrames desired crossfade length in frames
 */
export function applyCrossfadeAtSeam(data, lsF, leF, crossFrames) {
  const loopLen = leF - lsF;
  const cf = Math.min(crossFrames, Math.floor(loopLen / 2));
  for (let i = 0; i < cf; i++) {
    const t = i / cf;                      // 0 at start of tail, ~1 at end
    data[leF - cf + i] = data[leF - cf + i] * (1 - t) + data[lsF + i] * t;
  }
}
