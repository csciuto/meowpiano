import { describe, it, expect } from 'vitest';
import { applyCrossfadeAtSeam, findStableWindow, nearestZeroCrossing } from '../js/dsp.js';

describe('applyCrossfadeAtSeam', () => {
  it('does nothing when crossFrames is 0', () => {
    const data = new Float32Array([0, 1, 2, 3, 4]);
    applyCrossfadeAtSeam(data, 0, 5, 0);
    expect([...data]).toEqual([0, 1, 2, 3, 4]);
  });

  it('does not touch samples outside the loop tail', () => {
    // sentinel=99 outside loop, head=0, tail=1
    // loop [2,6), cf = min(2, floor(4/2)) = 2 → tail=[4,5], head=[2,3]
    const data = new Float32Array([99, 99, 0, 0, 1, 1, 99, 99]);
    applyCrossfadeAtSeam(data, 2, 6, 2);
    expect(data[0]).toBe(99);   // before loop — untouched
    expect(data[1]).toBe(99);   // before loop — untouched
    expect(data[6]).toBe(99);   // after loop  — untouched
    expect(data[7]).toBe(99);   // after loop  — untouched
    expect(data[2]).toBe(0);    // head frame  — untouched
    expect(data[3]).toBe(0);    // head frame  — untouched
  });

  it('blends the loop tail toward the loop head', () => {
    // head=[0,0,0,0], tail=[1,1,1,1], loop [0,8), cf=4
    // t = i/cf: 0, 0.25, 0.5, 0.75
    const data = new Float32Array([0, 0, 0, 0, 1, 1, 1, 1]);
    applyCrossfadeAtSeam(data, 0, 8, 4);
    expect(data[4]).toBeCloseTo(1.0);   // t=0:    1*(1) + 0*0 = 1.0 (no change)
    expect(data[5]).toBeCloseTo(0.75);  // t=0.25: 1*0.75 + 0*0.25 = 0.75
    expect(data[6]).toBeCloseTo(0.5);   // t=0.5:  1*0.5  + 0*0.5  = 0.5
    expect(data[7]).toBeCloseTo(0.25);  // t=0.75: 1*0.25 + 0*0.75 = 0.25
  });

  it('clamps crossFrames to half the loop length', () => {
    // loopLen=4, crossFrames=10 → clamped to 2
    // loop [1,5): tail=[3,4], head=[1,2]
    const data = new Float32Array([99, 0, 0, 1, 1, 99]);
    applyCrossfadeAtSeam(data, 1, 5, 10);
    expect(data[0]).toBe(99);           // sentinel — untouched
    expect(data[5]).toBe(99);           // sentinel — untouched
    expect(data[3]).toBeCloseTo(1.0);   // i=0, t=0:   no change
    expect(data[4]).toBeCloseTo(0.5);   // i=1, t=0.5: 1*0.5 + 0*0.5 = 0.5
  });

  it('handles a one-frame loop without throwing', () => {
    const data = new Float32Array([0.5, 0.3]);
    expect(() => applyCrossfadeAtSeam(data, 0, 2, 5)).not.toThrow();
  });
});

describe('findStableWindow', () => {
  it('returns searchStart when all windows are equally stable (constant signal)', () => {
    const data = new Float32Array(60).fill(0.5);
    // Every window has variance=0; the first one wins
    expect(findStableWindow(data, 0, 60, 20, 5)).toBe(0);
  });

  it('finds the stable constant region over a ramping region', () => {
    // frames 0-29: ramp 0→1 (varying RMS across sub-windows)
    // frames 30-59: constant 0.5 (all sub-window RMS identical → variance=0)
    const data = new Float32Array(60);
    for (let i = 0; i < 30; i++) data[i] = i / 29;
    for (let i = 30; i < 60; i++) data[i] = 0.5;
    const result = findStableWindow(data, 0, 60, 20, 5);
    // First window fully inside constant region starts at 30
    expect(result).toBe(30);
  });

  it('respects searchStart and searchEnd bounds', () => {
    // constant signal but only search the second half
    const data = new Float32Array(80).fill(0.5);
    const result = findStableWindow(data, 40, 80, 20, 5);
    expect(result).toBeGreaterThanOrEqual(40);
    expect(result + 20).toBeLessThanOrEqual(80);
  });

  it('prefers lower variance over higher variance windows', () => {
    // Three regions: noisy | stable | noisy
    const data = new Float32Array(90);
    for (let i = 0;  i < 30; i++) data[i] = (i % 2 === 0) ? 0.9 : 0.1; // alternating
    for (let i = 30; i < 60; i++) data[i] = 0.5;                          // constant
    for (let i = 60; i < 90; i++) data[i] = (i % 3 === 0) ? 0.8 : 0.2; // alternating
    const result = findStableWindow(data, 0, 90, 20, 5);
    expect(result).toBeGreaterThanOrEqual(30);
    expect(result).toBeLessThanOrEqual(40); // window must end by frame 60
  });

  it('does not crash when windowLen >= searchEnd - searchStart', () => {
    const data = new Float32Array(20).fill(0.3);
    // window exactly fits the search range
    expect(() => findStableWindow(data, 0, 20, 20, 5)).not.toThrow();
  });
});

describe('nearestZeroCrossing', () => {
  // data = [0.5, 0.3, -0.1, -0.4]  →  crossing at index 2
  //   (data[1]=0.3, data[2]=-0.1, sign change between them)

  it('finds a crossing ahead of the frame', () => {
    const data = new Float32Array([0.5, 0.3, -0.1, -0.4]);
    expect(nearestZeroCrossing(data, 0, 5)).toBe(2);
  });

  it('finds a crossing behind the frame', () => {
    const data = new Float32Array([0.5, 0.3, -0.1, -0.4]);
    expect(nearestZeroCrossing(data, 3, 5)).toBe(2);
  });

  it('returns the frame itself when it is already a zero crossing', () => {
    // data[0]*data[1] = 0.5*(-0.3) < 0  →  crossing at index 1
    const data = new Float32Array([0.5, -0.3, -0.1]);
    expect(nearestZeroCrossing(data, 1, 3)).toBe(1);
  });

  it('returns the original frame when no crossing exists within radius', () => {
    const data = new Float32Array([0.5, 0.3, 0.1]);  // all positive
    expect(nearestZeroCrossing(data, 1, 0)).toBe(1);
  });

  it('treats a sample of exactly zero as a crossing', () => {
    // data[0]*data[1] = 0.5*0 = 0 <= 0  →  crossing at index 1 (r=1, fwd)
    const data = new Float32Array([0.5, 0.0, -0.3]);
    expect(nearestZeroCrossing(data, 0, 3)).toBe(1);
  });

  it('prefers the closer crossing over a farther one', () => {
    // crossings at index 2 (r=1 from frame 3) and index 5 (r=2 from frame 3)
    // [0.2, 0.1, -0.1, -0.2, -0.1, 0.1]
    const data = new Float32Array([0.2, 0.1, -0.1, -0.2, -0.1, 0.1]);
    // from frame 3: fwd r=1 → idx 4, data[3]*data[4]=-0.2*-0.1>0 no
    //               bwd r=1 → idx 2, data[1]*data[2]=0.1*-0.1<0  yes → 2
    expect(nearestZeroCrossing(data, 3, 5)).toBe(2);
  });
});
