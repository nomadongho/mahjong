/**
 * game.js — Core game engine / state machine.
 *
 * Player indices:
 *   0 = human (bottom)
 *   1 = computer right
 *   2 = computer top   (if numPlayers >= 3)
 *   3 = computer left  (if numPlayers === 4)
 */

'use strict';

const STATE = Object.freeze({
  SETUP:           'setup',
  DEALING:         'dealing',
  PLAYER_TURN:     'player_turn',
  WAITING_DISCARD: 'waiting_discard',
  CALL_WINDOW:     'call_window',
  WIN:             'win',
  EXHAUSTED:       'exhausted',
});

const PLAYER_POS = ['bottom', 'right', 'top', 'left'];

class Game {
  constructor() {
    this.numPlayers  = 2;
    this.aiLevel     = 'easy';
    this.state       = STATE.SETUP;
    this.round       = 0;
    this.scores      = [];

    // per-round
    this.wall        = [];
    this.hands       = [];   // hands[i] = Tile[]  (the live tiles in hand)
    this.melds       = [];   // melds[i] = Tile[][] (locked meld sets)
    this.discards    = [];   // discards[i] = Tile[]
    this.currentPlayer = 0;
    this.drawnTile   = null;
    this.lastDiscard = null; // { tile, playerIdx }

    // Callbacks wired by main.js
    this.onStateChange = null;
    this.onMessage     = null;
    this.onCallPrompt  = null;
  }

  /* ─── setup ──────────────────────────────── */
  configure(numComputers, aiLevel) {
    this.numPlayers = 1 + numComputers;
    this.aiLevel    = aiLevel;
    this.round      = 0;
    this.scores     = new Array(this.numPlayers).fill(0);
  }

  playerName(idx) {
    return idx === 0 ? '나' : `컴퓨터 ${idx}`;
  }

  windName(idx) {
    return ['동', '남', '서', '북'][idx % 4];
  }

  /** Full 13-tile-equivalent array used for shanten/tenpai checks. */
  _fullHand13(playerIdx) {
    // hand (10-13 tiles) + melds.flat() = 13 total
    return [...this.hands[playerIdx], ...this.melds[playerIdx].flat()];
  }

  /** Full 14-tile-equivalent array used for win checks (after drawing). */
  _fullHand14(playerIdx) {
    return [...this.hands[playerIdx], ...this.melds[playerIdx].flat()];
  }

  /* ─── round management ───────────────────── */
  startRound() {
    this.round++;
    const deck    = createDeck();
    this.wall     = deck;
    this.hands    = Array.from({ length: this.numPlayers }, () => []);
    this.melds    = Array.from({ length: this.numPlayers }, () => []);
    this.discards = Array.from({ length: this.numPlayers }, () => []);
    this.drawnTile   = null;
    this.lastDiscard = null;

    // Deal 13 tiles to each player
    for (let i = 0; i < 13; i++) {
      for (let p = 0; p < this.numPlayers; p++) {
        this.hands[p].push(this.wall.pop());
      }
    }

    // East player (0) draws the 14th tile to open
    this.currentPlayer = 0;
    this._drawTile(0);

    this._setState(STATE.PLAYER_TURN);
    this._notify();
    this._triggerPlayerAction(0);  // ← crucial: start the first turn
  }

  /* ─── draw / discard ─────────────────────── */
  _drawTile(playerIdx) {
    if (this.wall.length === 0) {
      this._setState(STATE.EXHAUSTED);
      this._notify();
      return false;
    }
    const tile = this.wall.pop();
    this.hands[playerIdx].push(tile);
    this.drawnTile = tile;
    return true;
  }

  /** Called by UI when the human clicks a tile to discard. */
  humanDiscard(tileId) {
    if (this.state !== STATE.WAITING_DISCARD) return;
    const hand = this.hands[0];
    const idx  = hand.findIndex(t => t.id === tileId);
    if (idx === -1) return;
    const tile = hand.splice(idx, 1)[0];
    this._afterDiscard(0, tile);
  }

  /** Internal discard for computer players. */
  _discard(playerIdx, tile) {
    const hand = this.hands[playerIdx];
    const idx  = hand.findIndex(t => t.id === tile.id);
    if (idx !== -1) hand.splice(idx, 1);
    this._afterDiscard(playerIdx, tile);
  }

  _afterDiscard(playerIdx, tile) {
    this.discards[playerIdx].push(tile);
    this.lastDiscard = { tile, playerIdx };
    this.drawnTile   = null;
    this._setState(STATE.CALL_WINDOW);
    this._notify();
    setTimeout(() => this._resolveCallWindow(playerIdx, tile), 700);
  }

  /* ─── call window ────────────────────────── */
  async _resolveCallWindow(discardPlayerIdx, tile) {
    if (this.state === STATE.WIN) return; // someone already won

    // 1. RON — any other player whose combined hand wins with this tile
    for (let p = 0; p < this.numPlayers; p++) {
      if (p === discardPlayerIdx) continue;
      const fullWith = [...this._fullHand13(p), tile]; // 14 tiles
      if (isWinningHand(fullWith)) {
        if (p === 0) {
          const answer = await this._promptHuman('RON', tile, ['론', '패스']);
          if (answer === '론') { this._declareWin(p, tile, discardPlayerIdx); return; }
        } else {
          if (AI.shouldRon(this._fullHand13(p), tile, this.aiLevel)) {
            this._declareWin(p, tile, discardPlayerIdx); return;
          }
        }
      }
    }

    // 2. PON — any other player with ≥2 copies in their hand (not melds)
    let ponCaller = -1;
    for (let p = 0; p < this.numPlayers; p++) {
      if (p === discardPlayerIdx) continue;
      if (this.hands[p].filter(t => t.equals(tile)).length >= 2) {
        if (p === 0) {
          const answer = await this._promptHuman('PON', tile, ['퐁', '패스']);
          if (answer === '퐁') { ponCaller = p; break; }
        } else {
          if (AI.shouldPon(this._fullHand13(p), tile, this.aiLevel)) { ponCaller = p; break; }
        }
      }
    }
    if (ponCaller !== -1) { this._applyPon(ponCaller, tile); return; }

    // 3. CHI — only the next player (and only from suited tiles)
    const chiPlayer = (discardPlayerIdx + 1) % this.numPlayers;
    const chiSets   = this._findChiSets(this.hands[chiPlayer], tile);
    if (chiSets.length > 0) {
      if (chiPlayer === 0) {
        const labels = chiSets.map(set =>
          `치 [${set.map(t => t.name).join('+')}+${tile.name}]`
        ).concat(['패스']);
        const answer = await this._promptHuman('CHI', tile, labels);
        const chosen = chiSets.findIndex((_, i) => labels[i] === answer);
        if (chosen !== -1) { this._applyChi(chiPlayer, tile, chiSets[chosen]); return; }
      } else {
        // Pass copies of sets to AI so it can't mutate ours
        const chosenSet = AI.shouldChi(
          this.hands[chiPlayer],
          tile,
          chiSets.map(s => [...s]),
          this.aiLevel
        );
        if (chosenSet) { this._applyChi(chiPlayer, tile, chosenSet); return; }
      }
    }

    // 4. No calls → next player's turn
    this._nextTurn(discardPlayerIdx);
  }

  /** Return arrays of 2 hand-tiles that form a valid sequence with `tile`. */
  _findChiSets(hand, tile) {
    if (!tile.isSuited) return [];
    const sets = [];
    const v    = tile.value;

    const has = (value) =>
      value >= 1 && value <= 9 && hand.some(t => t.suit === tile.suit && t.value === value);
    const get = (value) =>
      hand.find(t => t.suit === tile.suit && t.value === value);

    if (has(v - 2) && has(v - 1)) sets.push([get(v - 2), get(v - 1)]);
    if (has(v - 1) && has(v + 1)) sets.push([get(v - 1), get(v + 1)]);
    if (has(v + 1) && has(v + 2)) sets.push([get(v + 1), get(v + 2)]);
    return sets;
  }

  /* ─── pon / chi ──────────────────────────── */
  _applyPon(playerIdx, tile) {
    // Remove exactly 2 matching tiles from hand; save them for meld display
    let removed = 0;
    const usedFromHand = [];
    this.hands[playerIdx] = this.hands[playerIdx].filter(t => {
      if (removed < 2 && t.equals(tile)) { usedFromHand.push(t); removed++; return false; }
      return true;
    });

    // Lock meld: the discarded tile + 2 from hand
    const meldTiles = [tile, ...usedFromHand];
    this.melds[playerIdx].push(meldTiles);

    this._msg(`${this.playerName(playerIdx)}: 퐁! (${tile.name}×3)`);
    this.currentPlayer = playerIdx;
    this._setState(STATE.PLAYER_TURN);
    this._notify();
    this._triggerPlayerAction(playerIdx);
  }

  _applyChi(playerIdx, tile, pairFromHand) {
    const ids = new Set(pairFromHand.map(t => t.id));
    this.hands[playerIdx] = this.hands[playerIdx].filter(t => !ids.has(t.id));

    const meldTiles = sortTiles([tile, ...pairFromHand]);
    this.melds[playerIdx].push(meldTiles);

    this._msg(`${this.playerName(playerIdx)}: 치! (${meldTiles.map(t => t.name).join('')})`);
    this.currentPlayer = playerIdx;
    this._setState(STATE.PLAYER_TURN);
    this._notify();
    this._triggerPlayerAction(playerIdx);
  }

  /* ─── win declaration ────────────────────── */
  _declareWin(winnerIdx, winTile, fromPlayerIdx) {
    // Ensure win tile is visible in hand for display
    if (!this.hands[winnerIdx].some(t => t.id === winTile.id)) {
      this.hands[winnerIdx].push(winTile);
    }
    this.scores[winnerIdx]++;
    const winType = fromPlayerIdx === winnerIdx ? '쯔모' : '론';
    const from    = fromPlayerIdx !== winnerIdx
      ? ` ← ${this.playerName(fromPlayerIdx)}`
      : '';
    this._msg(`🎉 ${this.playerName(winnerIdx)} 화료! (${winType}${from})`);
    this._setState(STATE.WIN);
    this._notify(winnerIdx, winTile);
  }

  /* ─── turn progression ───────────────────── */
  _nextTurn(lastDiscardPlayerIdx) {
    const next = (lastDiscardPlayerIdx + 1) % this.numPlayers;
    this.currentPlayer = next;
    if (!this._drawTile(next)) return; // wall exhausted
    this._setState(STATE.PLAYER_TURN);
    this._notify();
    this._triggerPlayerAction(next);
  }

  _triggerPlayerAction(playerIdx) {
    if (playerIdx === 0) {
      // Human turn — check tsumo opportunity
      const full14 = this._fullHand14(0);
      if (full14.length === 14 && isWinningHand(full14)) {
        this._setState(STATE.WAITING_DISCARD);
        this._notify('tsumo_available');
      } else {
        this._setState(STATE.WAITING_DISCARD);
        this._notify();
      }
    } else {
      const delay = 700 + Math.random() * 700;
      setTimeout(() => this._computerTurn(playerIdx), delay);
    }
  }

  _computerTurn(playerIdx) {
    if (this.state === STATE.WIN || this.state === STATE.EXHAUSTED) return;
    const full14 = this._fullHand14(playerIdx);

    // Tsumo check
    if (full14.length === 14 && isWinningHand(full14)) {
      this._declareWin(playerIdx, this.drawnTile, playerIdx);
      return;
    }

    const meldFlat = this.melds[playerIdx].flat();
    const tile = AI.chooseDiscard(this.hands[playerIdx], meldFlat, this.aiLevel);
    this._msg(`${this.playerName(playerIdx)}: ${tile.name} 버림`);
    this._discard(playerIdx, tile);
  }

  /* ─── human tsumo ────────────────────────── */
  humanTsumo() {
    if (this.state !== STATE.WAITING_DISCARD) return;
    const full14 = this._fullHand14(0);
    if (full14.length === 14 && isWinningHand(full14)) {
      this._declareWin(0, this.drawnTile, 0);
    }
  }

  /* ─── promise-based human prompt ────────── */
  _promptHuman(type, tile, options) {
    return new Promise(resolve => {
      if (this.onCallPrompt) this.onCallPrompt(type, tile, options, resolve);
      else resolve(options[options.length - 1]); // auto-pass
    });
  }

  /* ─── internals ──────────────────────────── */
  _setState(s)            { this.state = s; }
  _msg(text)              { if (this.onMessage) this.onMessage(text); }
  _notify(extra, extra2)  { if (this.onStateChange) this.onStateChange(this.state, extra, extra2); }
}
