/**
 * Returns all notes that are sounding at the given transport time.
 * allNotes must be sorted by note.time ascending.
 *
 * @param {Array} allNotes
 * @param {number} currentTime  seconds
 * @returns {Array}
 */
export function getActiveNotes(allNotes, currentTime) {
  // Binary search for the first note that could still be active
  let lo = 0, hi = allNotes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (allNotes[mid].time <= currentTime) lo = mid + 1;
    else hi = mid;
  }
  // lo is now the index of the first note with time > currentTime
  // Walk backwards to collect all notes that started ≤ currentTime and end > currentTime
  const active = [];
  for (let i = lo - 1; i >= 0; i--) {
    const n = allNotes[i];
    if (n.time + n.duration <= currentTime) continue; // this note finished; earlier ones may still sound
    if (n.time <= currentTime) active.push(n);
  }
  return active;
}
