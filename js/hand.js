/**
 * hand.js — Win detection, shanten calculation, tenpai helpers.
 *
 * Tile index layout (34 slots):
 *   man  1-9  →  0- 8
 *   pin  1-9  →  9-17
 *   sou  1-9  → 18-26
 *   wind 1-4  → 27-30
 *   drag 1-3  → 31-33
 */

'use strict';

/* ─────────────────────────────────────────
   Win detection  (exactly 14 tile equivalents)
───────────────────────────────────────── */

/**
 * Returns true if the tile array forms a complete winning hand.
 * Pass the player's hand tiles PLUS their locked meld tiles:
 *   isWinningHand([...hand, ...melds.flat()])
 * Total must equal 14 tiles.
 */
function isWinningHand(tiles) {
  const c = toCounts(tiles);
  return checkStandardWin(c) || checkChiitoitsu(c);
}

function checkChiitoitsu(counts) {
  let pairs = 0;
  for (const n of counts) {
    if (n === 0) continue;
    if (n === 2) { pairs++; continue; }
    return false;
  }
  return pairs === 7;
}

function checkStandardWin(counts) {
  for (let i = 0; i < 34; i++) {
    if (counts[i] >= 2) {
      counts[i] -= 2;
      if (canFormSets(counts, 4)) { counts[i] += 2; return true; }
      counts[i] += 2;
    }
  }
  return false;
}

function canFormSets(counts, needed) {
  if (needed === 0) return counts.every(n => n === 0);
  let i = 0;
  while (i < 34 && counts[i] === 0) i++;
  if (i >= 34) return false;

  if (counts[i] >= 3) {
    counts[i] -= 3;
    if (canFormSets(counts, needed - 1)) { counts[i] += 3; return true; }
    counts[i] += 3;
  }

  if (i < 27) {
    const suitEnd = Math.floor(i / 9) * 9 + 8;
    if (i + 2 <= suitEnd && counts[i + 1] >= 1 && counts[i + 2] >= 1) {
      counts[i]--; counts[i + 1]--; counts[i + 2]--;
      if (canFormSets(counts, needed - 1)) {
        counts[i]++; counts[i + 1]++; counts[i + 2]++;
        return true;
      }
      counts[i]++; counts[i + 1]++; counts[i + 2]++;
    }
  }
  return false;
}

/* ─────────────────────────────────────────
   Shanten calculation (13 tile equivalents)
───────────────────────────────────────── */

/**
 * Returns the shanten number for the given tiles (hand + melds.flat()).
 * Total tiles should equal 13.
 *   -1 = complete hand
 *    0 = tenpai
 *    1 = 1-shanten, etc.
 */
function calculateShanten(tiles) {
  const c = toCounts(tiles);
  const s1 = standardShanten(c);
  const s2 = chiitoitsuShanten(c);
  return Math.min(s1, s2);
}

function chiitoitsuShanten(counts) {
  let pairs = 0;
  for (const n of counts) if (n >= 2) pairs++;
  return 6 - pairs;
}

function standardShanten(counts) {
  let best = 8;
  const c = counts.slice();

  function search(idx, mentsu, partial, hasPair) {
    const s = 8 - 2 * mentsu - partial - (hasPair ? 1 : 0);
    if (s < best) best = s;
    if (s < 0) return;

    while (idx < 34 && c[idx] === 0) idx++;
    if (idx >= 34) return;

    const orig = c[idx];

    if (orig >= 2 && !hasPair) {
      c[idx] -= 2; search(idx, mentsu, partial, true); c[idx] += 2;
    }
    if (orig >= 3) {
      c[idx] -= 3; search(idx, mentsu + 1, partial, hasPair); c[idx] += 3;
    }
    if (orig >= 2) {
      c[idx] -= 2; search(idx, mentsu, Math.min(partial + 1, 4 - mentsu), hasPair); c[idx] += 2;
    }

    if (idx < 27) {
      const suitEnd = Math.floor(idx / 9) * 9 + 8;
      if (idx + 2 <= suitEnd && c[idx + 1] >= 1 && c[idx + 2] >= 1) {
        c[idx]--; c[idx + 1]--; c[idx + 2]--;
        search(idx, mentsu + 1, partial, hasPair);
        c[idx]++; c[idx + 1]++; c[idx + 2]++;
      }
      if (idx + 1 <= suitEnd && c[idx + 1] >= 1) {
        c[idx]--; c[idx + 1]--;
        search(idx, mentsu, Math.min(partial + 1, 4 - mentsu), hasPair);
        c[idx]++; c[idx + 1]++;
      }
      if (idx + 2 <= suitEnd && c[idx + 2] >= 1) {
        c[idx]--; c[idx + 2]--;
        search(idx, mentsu, Math.min(partial + 1, 4 - mentsu), hasPair);
        c[idx]++; c[idx + 2]++;
      }
    }

    // skip isolated tile
    c[idx] = 0; search(idx + 1, mentsu, partial, hasPair); c[idx] = orig;
  }

  search(0, 0, 0, false);
  return best;
}

/* ─────────────────────────────────────────
   Tenpai / discard helpers
───────────────────────────────────────── */

/**
 * For each tile in `hand14`, compute shanten after removing it.
 * Pass locked meld tiles in `meldFlat` so shanten is accurate.
 * Returns array of { tile, idx, shanten }.
 */
function discardOptions(hand14, meldFlat = []) {
  return hand14.map((discard, idx) => {
    const remaining = hand14.filter((_, i) => i !== idx);
    const full = [...remaining, ...meldFlat];  // should be 13 tiles
    return { tile: discard, idx, shanten: calculateShanten(full) };
  });
}

/**
 * Returns tile types (Tile objects) that would complete a 13-tile hand.
 * Pass the combined hand+meld tiles (13 total).
 */
function getTenpaiTiles(tiles13) {
  const waiting = [];
  for (let i = 0; i < 34; i++) {
    const probe = tileFromIndex(i);
    if (isWinningHand([...tiles13, probe])) waiting.push(probe);
  }
  return waiting;
}

/** True if the combined 13 tiles are tenpai. */
function isTenpai(tiles13) {
  return calculateShanten(tiles13) === 0;
}
