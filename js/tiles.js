/**
 * tiles.js — Tile definitions, deck creation, and utilities
 */

'use strict';

const SUIT = Object.freeze({
  MAN:    'man',    // 만수 (characters 1-9)
  PIN:    'pin',    // 통수 (circles 1-9)
  SOU:    'sou',    // 대나무 (bamboo 1-9)
  WIND:   'wind',   // 바람패 (1=동 2=남 3=서 4=북)
  DRAGON: 'dragon', // 삼원패 (1=백 2=발 3=중)
});

const WIND_LABEL   = ['동', '남', '서', '북'];
const DRAGON_LABEL = ['백', '발', '중'];

// Suit labels shown on the bottom of number tiles
const SUIT_LABEL = { man: '만', pin: '통', sou: '죽' };

class Tile {
  /**
   * @param {string} suit  - one of SUIT.*
   * @param {number} value - 1-9 for suited, 1-4 for wind, 1-3 for dragon
   * @param {number} id    - unique id within the 136-tile deck
   */
  constructor(suit, value, id) {
    this.suit  = suit;
    this.value = value;
    this.id    = id;
  }

  /**
   * Top text displayed on the tile face (large character).
   * Number tiles: Arabic numeral. Honor tiles: the full name.
   */
  get topChar() {
    if (this.suit === SUIT.MAN || this.suit === SUIT.PIN || this.suit === SUIT.SOU) {
      return String(this.value);
    }
    if (this.suit === SUIT.WIND)   return WIND_LABEL[this.value - 1];
    if (this.suit === SUIT.DRAGON) return DRAGON_LABEL[this.value - 1];
    return '?';
  }

  /**
   * Bottom text displayed on the tile face (small suit label).
   * Honor tiles return '' (the topChar already contains the full name).
   */
  get botChar() {
    if (this.suit === SUIT.MAN || this.suit === SUIT.PIN || this.suit === SUIT.SOU) {
      return SUIT_LABEL[this.suit];
    }
    return '';
  }

  /** Human-readable Korean name */
  get name() {
    if (this.suit === SUIT.MAN)    return `${this.value}만`;
    if (this.suit === SUIT.PIN)    return `${this.value}통`;
    if (this.suit === SUIT.SOU)    return `${this.value}대`;
    if (this.suit === SUIT.WIND)   return WIND_LABEL[this.value - 1] + '풍';
    if (this.suit === SUIT.DRAGON) return DRAGON_LABEL[this.value - 1];
    return '?';
  }

  /**
   * Index in the 34-type counts array:
   *   man  1-9  → 0-8
   *   pin  1-9  → 9-17
   *   sou  1-9  → 18-26
   *   wind 1-4  → 27-30
   *   drag 1-3  → 31-33
   */
  get index() {
    if (this.suit === SUIT.MAN)    return this.value - 1;
    if (this.suit === SUIT.PIN)    return 9  + this.value - 1;
    if (this.suit === SUIT.SOU)    return 18 + this.value - 1;
    if (this.suit === SUIT.WIND)   return 27 + this.value - 1;
    if (this.suit === SUIT.DRAGON) return 31 + this.value - 1;
    throw new Error(`Unknown suit: ${this.suit}`);
  }

  /** true if this is a number tile (man/pin/sou) */
  get isSuited() {
    return this.suit === SUIT.MAN || this.suit === SUIT.PIN || this.suit === SUIT.SOU;
  }

  /** true if wind or dragon */
  get isHonor() {
    return this.suit === SUIT.WIND || this.suit === SUIT.DRAGON;
  }

  equals(other) {
    return this.suit === other.suit && this.value === other.value;
  }
}

/**
 * Build and shuffle the full 136-tile deck (4 copies of each of 34 types).
 */
function createDeck() {
  const deck = [];
  let id = 0;

  for (const suit of [SUIT.MAN, SUIT.PIN, SUIT.SOU]) {
    for (let v = 1; v <= 9; v++) {
      for (let k = 0; k < 4; k++) deck.push(new Tile(suit, v, id++));
    }
  }
  for (let v = 1; v <= 4; v++) {
    for (let k = 0; k < 4; k++) deck.push(new Tile(SUIT.WIND, v, id++));
  }
  for (let v = 1; v <= 3; v++) {
    for (let k = 0; k < 4; k++) deck.push(new Tile(SUIT.DRAGON, v, id++));
  }

  // Fisher-Yates shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/**
 * Sort tiles in canonical mahjong order:
 *   man→pin→sou→wind→dragon, low→high within suit.
 */
function sortTiles(tiles) {
  const suitOrder = [SUIT.MAN, SUIT.PIN, SUIT.SOU, SUIT.WIND, SUIT.DRAGON];
  return [...tiles].sort((a, b) => {
    const sd = suitOrder.indexOf(a.suit) - suitOrder.indexOf(b.suit);
    return sd !== 0 ? sd : a.value - b.value;
  });
}

/**
 * Convert an array of Tiles into a 34-element counts array.
 */
function toCounts(tiles) {
  const c = new Array(34).fill(0);
  for (const t of tiles) c[t.index]++;
  return c;
}

/**
 * Given a tile index (0-33) reconstruct a Tile object (value only, no real id).
 */
function tileFromIndex(idx) {
  if (idx < 9)  return new Tile(SUIT.MAN,    idx + 1,       -1);
  if (idx < 18) return new Tile(SUIT.PIN,    idx - 9 + 1,   -1);
  if (idx < 27) return new Tile(SUIT.SOU,    idx - 18 + 1,  -1);
  if (idx < 31) return new Tile(SUIT.WIND,   idx - 27 + 1,  -1);
  return             new Tile(SUIT.DRAGON, idx - 31 + 1,  -1);
}
