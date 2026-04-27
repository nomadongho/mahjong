/**
 * ai.js — Computer player decision-making (Easy / Medium / Hard).
 *
 * Public API:
 *   AI.chooseDiscard(hand14, meldFlat, level)      → Tile to discard
 *   AI.shouldPon(hand13full, tile, level)           → boolean
 *   AI.shouldChi(hand13, tile, chiSets, level)      → Tile[] pair | null
 *   AI.shouldRon(hand13full, tile, level)           → boolean
 *
 * `hand13full` = [...hand, ...melds.flat()]  (13 tile equivalents total)
 */

'use strict';

const AI = (() => {

  /* ── helpers ─────────────────────────────────── */

  function connectivity(tile, hand) {
    let score = 0;
    for (const t of hand) {
      if (t.id === tile.id) continue;
      if (t.equals(tile)) { score += 2; continue; }
      if (t.isSuited && tile.isSuited && t.suit === tile.suit) {
        const d = Math.abs(t.value - tile.value);
        if (d === 1) score += 2;
        else if (d === 2) score += 1;
      }
    }
    return score;
  }

  /** Best discard using shanten minimisation. */
  function bestDiscard(hand14, meldFlat) {
    const opts = discardOptions(hand14, meldFlat);
    opts.sort((a, b) => {
      if (a.shanten !== b.shanten) return a.shanten - b.shanten;
      // prefer discarding honour tiles (lower connectivity / flexibility)
      const aH = a.tile.isHonor ? 0 : 1;
      const bH = b.tile.isHonor ? 0 : 1;
      if (aH !== bH) return aH - bH;
      return connectivity(a.tile, hand14) - connectivity(b.tile, hand14);
    });
    return opts[0].tile;
  }

  /** Heuristic: discard least-connected tile. */
  function heuristicDiscard(hand14) {
    const scored = hand14.map(tile => ({
      tile,
      score: tile.isHonor ? 0 : connectivity(tile, hand14),
    }));
    scored.sort((a, b) => a.score - b.score);
    return scored[0].tile;
  }

  /* ── Public methods ──────────────────────────── */

  /**
   * Choose which tile to discard from a 14-tile hand.
   * @param {Tile[]}  hand14    - tiles in hand (NOT including locked melds)
   * @param {Tile[]}  meldFlat  - locked meld tiles flattened ([...melds.flat()])
   * @param {string}  level
   * @returns {Tile}
   */
  function chooseDiscard(hand14, meldFlat = [], level) {
    if (level === 'easy') {
      return hand14[Math.floor(Math.random() * hand14.length)];
    }
    if (level === 'medium') {
      return heuristicDiscard(hand14);
    }
    return bestDiscard(hand14, meldFlat || []);
  }

  /**
   * Decide whether to call Pon.
   * @param {Tile[]} hand13full  - hand + melds.flat() (13 tile equivalents)
   * @param {Tile}   tile        - the discarded tile to pon
   * @param {string} level
   */
  function shouldPon(hand13full, tile, level) {
    // hand13full includes the meld tiles; count matching tiles in it
    const copies = hand13full.filter(t => t.equals(tile)).length;
    if (copies < 2) return false;

    if (level === 'easy') return Math.random() < 0.4;

    // medium / hard: pon if it reduces shanten
    const shantenBefore = calculateShanten(hand13full);
    // After pon: remove 2 copies of tile (they join the meld), add the pon meld (3 tiles)
    // The new full hand13 = hand13full - 2*tile + 3*tile = hand13full + 1*tile
    // But that's 14 tiles total if we started with 13... 
    // Actually: pon replaces 2 hand tiles with a locked meld of 3.
    // hand13full (13 tiles) - 2 tiles + (meld 3 tiles for free, but meld counts as set) = net +1
    // For shanten: the player now has 11 tiles in hand + locked meld of 3 = 14 equivalents,
    // but must discard one → 13 equivalents.
    // The pon tile (from discard) + 2 hand tiles form the locked meld.
    // Approximate: shanten of (hand13full with 2 copies removed + the pon tile added once) = 12 tiles
    // This isn't perfect, but good enough for AI.
    const withoutTwo = removeN(hand13full, tile, 2);      // 11 tiles
    const withPon    = [...withoutTwo, tile, tile, tile];  // 14 tiles - simulate with meld included
    // After pon, player must discard one from the 11-tile hand
    // Shanten of (11 tiles in hand + 3 pon tiles = 14), discarding one → 13 tiles
    // Best we can do: compute shanten of (11 non-meld tiles discarding 1 optimally)
    const shantenAfter = bestShantenAfterDiscard(withoutTwo, [tile, tile, tile]);
    return shantenAfter < shantenBefore;
  }

  /**
   * Decide whether to call Chi.
   * @param {Tile[]}    hand13     - hand tiles only (not including locked melds)
   * @param {Tile}      tile       - discarded tile
   * @param {Tile[][]}  chiSets    - each element is 2 tiles from hand to form chi with tile
   * @param {string}    level
   * @returns {Tile[]|null}
   */
  function shouldChi(hand13, tile, chiSets, level) {
    if (!chiSets || chiSets.length === 0) return null;
    if (level === 'easy') {
      return Math.random() < 0.35
        ? chiSets[Math.floor(Math.random() * chiSets.length)]
        : null;
    }

    const shantenBefore = calculateShanten(hand13);
    for (const set of chiSets) {
      const setIds = new Set(set.map(t => t.id));
      const remaining = hand13.filter(t => !setIds.has(t.id)); // 11 tiles
      const meldTiles = [tile, ...set];                         // chi meld (3 tiles)
      const shantenAfter = bestShantenAfterDiscard(remaining, meldTiles);
      if (shantenAfter < shantenBefore) return set;
    }
    return null;
  }

  /**
   * Decide whether to call Ron.
   * hand13full = hand tiles + melds.flat() (13 total)
   */
  function shouldRon(hand13full, tile, level) {
    return isWinningHand([...hand13full, tile]);
  }

  /* ── private helpers ──────────────────────────── */

  function removeN(arr, tile, n) {
    let removed = 0;
    return arr.filter(t => {
      if (removed < n && t.equals(tile)) { removed++; return false; }
      return true;
    });
  }

  /**
   * Compute the best shanten achievable after discarding one tile from `handN`,
   * assuming `meldFlat` are already-locked tiles.
   */
  function bestShantenAfterDiscard(handN, meldFlat) {
    const opts = discardOptions(handN, meldFlat);
    return Math.min(...opts.map(o => o.shanten));
  }

  return { chooseDiscard, shouldPon, shouldChi, shouldRon };
})();
