// Preloaded audio files — all CC0 / public domain recordings.
//
// Sources:
//   bach_prelude_c.mp3    — Kimiko Ishizaka, CC0  (archive.org/details/bach-well-tempered-clavier-book-1)
//   chopin_nocturne.mp3   — Musopen, CC0          (archive.org/details/musopen-chopin)
//   beethoven_fur_elise.mp3 — CC0 1.0             (archive.org/details/BagatellesOp.33AndFurElise)

export const AUDIO_FILES = [
  { name: 'Bach — Prelude in C major, BWV 846',  path: 'audio/bach_prelude_c.mp3' },
  { name: 'Chopin — Nocturne Op.9 No.2',         path: 'audio/chopin_nocturne.mp3' },
  { name: 'Beethoven — Für Elise, WoO 59',       path: 'audio/beethoven_fur_elise.mp3' },
  { name: 'Glenn Miller — In The Mood',           path: 'audio/Glenn Miller and His Orchestra -  - 01 - In The Mood.mp3' },
  { name: 'Glenn Miller — Rhapsody in Blue',      path: 'audio/Glenn Miller and His Orchestra -  - 06 - Rhapsody in Blue.mp3' },
  { name: 'Glenn Miller — Chattanooga Choo Choo', path: 'audio/Glenn Miller and His Orchestra -  - 12 - Chattanooga Choo Choo.mp3' },
];

export async function loadAudioFilePath(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${path}`);
  return res.arrayBuffer();
}
