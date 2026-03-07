export const SAMPLE_ROOT = 440.0;

export const NOTES = [
  {note:"C4",  freq:261.63, key:"a",  type:"white", wi:0  },
  {note:"C#4", freq:277.18, key:"w",  type:"black", lwi:0 },
  {note:"D4",  freq:293.66, key:"s",  type:"white", wi:1  },
  {note:"D#4", freq:311.13, key:"e",  type:"black", lwi:1 },
  {note:"E4",  freq:329.63, key:"d",  type:"white", wi:2  },
  {note:"F4",  freq:349.23, key:"f",  type:"white", wi:3  },
  {note:"F#4", freq:369.99, key:"t",  type:"black", lwi:3 },
  {note:"G4",  freq:392.00, key:"g",  type:"white", wi:4  },
  {note:"G#4", freq:415.30, key:"y",  type:"black", lwi:4 },
  {note:"A4",  freq:440.00, key:"h",  type:"white", wi:5  },
  {note:"A#4", freq:466.16, key:"u",  type:"black", lwi:5 },
  {note:"B4",  freq:493.88, key:"j",  type:"white", wi:6  },
  {note:"C5",  freq:523.25, key:"k",  type:"white", wi:7  },
  {note:"C#5", freq:554.37, key:"o",  type:"black", lwi:7 },
  {note:"D5",  freq:587.33, key:"l",  type:"white", wi:8  },
  {note:"D#5", freq:622.25, key:"p",  type:"black", lwi:8 },
  {note:"E5",  freq:659.25, key:";",  type:"white", wi:9  },
  {note:"F5",  freq:698.46, key:"'",  type:"white", wi:10 },
  {note:"F#5", freq:739.99, key:"[",  type:"black", lwi:10},
  {note:"G5",  freq:783.99, key:"z",  type:"white", wi:11 },
  {note:"G#5", freq:830.61, key:"]",  type:"black", lwi:11},
  {note:"A5",  freq:880.00, key:"x",  type:"white", wi:12 },
  {note:"A#5", freq:932.33, key:"\\", type:"black", lwi:12},
  {note:"B5",  freq:987.77, key:"c",  type:"white", wi:13 },
  {note:"C6",  freq:1046.5, key:"v",  type:"white", wi:14 },
];

// Canonical base frequencies — never mutated
export const BASE_FREQS = Object.fromEntries(NOTES.map(n => [n.note, n.freq]));

export const keyMap  = Object.fromEntries(NOTES.map(n => [n.key,  n]));
export const noteMap = Object.fromEntries(NOTES.map(n => [n.note, n]));

/** Shift all note frequencies by `shift` octaves (-2, -1, or 0). Pure side-effect on NOTES array. */
export function applyOctaveShift(shift) {
  const mult = Math.pow(2, shift);
  NOTES.forEach(n => { n.freq = BASE_FREQS[n.note] * mult; });
}

export const OCTAVE_LABELS = {
  "-2": "C2 <-- C3 --> C4",
  "-1": "C3 <-- C4 --> C5",
  "0":  "C4 <------- C5 --------> C6",
};
