// Rewrites help.html's "Hear ..." links from the demo files in songs/, so each link plays exactly what its
// file holds. Run after changing a demo file or the link format: node scripts/demo-links.js
import { readFileSync, writeFileSync } from 'node:fs';
import { fromMidi } from '../js/midi.js';
import { fitSong, LINK_CAP } from '../js/song.js';

const SET = { loopStart: 0.26, loopEnd: 0.46, crossfade: 0.02, grainDur: 0.1, grainOverlap: 0.5, tuning: 440 };
const ROOM = LINK_CAP - 'https://corey.sciu.to/meowpiano/#song='.length;
const help = new URL('../help.html', import.meta.url);
let html = readFileSync(help, 'utf8');

for (const [fileName, label] of [['canon-in-d.mid', 'Hear Canon in D'], ['brahms-lullaby.mid', "Hear Brahms' Lullaby"]]) {
  const file = fromMidi(new Uint8Array(readFileSync(new URL('../songs/' + fileName, import.meta.url))));
  const { events, end } = file.build(file.parts.map(p => p.id));
  const fit = await fitSong(events, end, { ...SET, title: file.title }, ROOM);
  if (fit.cut) throw new Error(fileName + ' does not fit in a link');
  const link = new RegExp(`href="\\./#song=[\\w-]+">▶ ${label}</a>`);
  if (!link.test(html)) throw new Error('no "' + label + '" link in help.html');
  html = html.replace(link, `href="./#song=${fit.text}">▶ ${label}</a>`);
  console.log(label, fit.text.length, 'characters');
}
writeFileSync(help, html);
