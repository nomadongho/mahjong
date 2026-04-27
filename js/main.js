/**
 * main.js — UI rendering, event binding, and game loop orchestration.
 */

'use strict';

const $ = id => document.getElementById(id);

/* ── UI state ─────────────────────────────── */
let game           = null;
let selectedTile   = null;
let numComputers   = 1;
let difficulty     = 'easy';

/* ── Screen management ───────────────────── */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(id).classList.add('active');
}

/* ── Setup screen ────────────────────────── */
function initSetup() {
  // Player count toggle
  $('player-count-group').querySelectorAll('.toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $('player-count-group').querySelectorAll('.toggle-btn')
        .forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      numComputers = parseInt(btn.dataset.value, 10);
    });
  });

  // Difficulty toggle
  $('difficulty-group').querySelectorAll('.toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $('difficulty-group').querySelectorAll('.toggle-btn')
        .forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      difficulty = btn.dataset.value;
    });
  });

  $('start-btn').addEventListener('click', startGame);
  $('restart-btn').addEventListener('click', () => showScreen('setup-screen'));

  // Game action buttons — registered once here, reference `game` via closure
  $('btn-tsumo').addEventListener('click', () => { if (game) game.humanTsumo(); });
  $('next-round-btn').addEventListener('click', nextRound);
  $('end-game-btn').addEventListener('click', endGame);
}

/* ── Game start / round ──────────────────── */
function startGame() {
  selectedTile = null;
  game = new Game();
  game.configure(numComputers, difficulty);
  game.onStateChange = handleStateChange;
  game.onMessage     = showMessage;
  game.onCallPrompt  = showCallPrompt;

  updatePlayerZoneVisibility();
  showScreen('game-screen');
  game.startRound();
}

function nextRound() {
  hideWinPopup();
  selectedTile = null;
  if (game) game.startRound();
}

function endGame() {
  hideWinPopup();
  renderFinalScores();
  showScreen('result-screen');
}

/* ── State change handler ────────────────── */
function handleStateChange(state, extra) {
  renderAll();
  highlightCurrentPlayer();

  if (state === STATE.WAITING_DISCARD) {
    if (extra === 'tsumo_available') {
      $('btn-tsumo').classList.remove('hidden');
    } else {
      $('btn-tsumo').classList.add('hidden');
    }
  } else {
    $('btn-tsumo').classList.add('hidden');
    selectedTile = null; // clear selection when it's no longer our turn
  }

  if (state === STATE.WIN)       { setTimeout(() => showWinPopup(extra), 300); }
  if (state === STATE.EXHAUSTED) { setTimeout(() => showExhaustedPopup(), 300); }
}

/* ── Rendering ───────────────────────────── */
function renderAll() {
  if (!game) return;
  renderInfo();
  for (let p = 0; p < game.numPlayers; p++) {
    renderHand(p);
    renderDiscards(p);
    renderMelds(p);
  }
  renderScores();
}

function renderInfo() {
  $('round-info').textContent  = `${game.round}국`;
  $('wall-count').textContent  = `남은 패: ${game.wall.length}`;
  $('wall-number').textContent = game.wall.length;

  const cur = game.currentPlayer;
  if (game.state === STATE.WAITING_DISCARD && cur === 0) {
    $('current-turn').textContent = '🟡 내 차례 — 버릴 패를 선택하세요';
  } else {
    $('current-turn').textContent = `${game.playerName(cur)} 차례`;
  }
}

function renderHand(playerIdx) {
  const pos    = PLAYER_POS[playerIdx];
  const handEl = $(`${pos}-hand`);
  if (!handEl) return;

  handEl.innerHTML = '';
  const hand   = sortTiles(game.hands[playerIdx]);
  const faceUp = playerIdx === 0;
  const canAct = faceUp && game.state === STATE.WAITING_DISCARD;

  hand.forEach(tile => {
    const el = makeTileEl(tile, {
      faceDown: !faceUp,
      drawn:    faceUp && game.drawnTile && tile.id === game.drawnTile.id,
      selected: faceUp && selectedTile && tile.id === selectedTile.id,
    });

    if (canAct) {
      el.classList.add('clickable');
      el.addEventListener('click', () => onTileClick(tile));
    }

    handEl.appendChild(el);
  });
}

function renderDiscards(playerIdx) {
  const pos    = PLAYER_POS[playerIdx];
  const discEl = $(`${pos}-discards`);
  if (!discEl) return;

  discEl.innerHTML = '';
  game.discards[playerIdx].forEach(tile => {
    const isLast = game.lastDiscard &&
                   tile.id === game.lastDiscard.tile.id &&
                   game.lastDiscard.playerIdx === playerIdx;
    const el = makeTileEl(tile, { small: true });
    if (isLast) el.classList.add('last-discarded');
    discEl.appendChild(el);
  });
}

function renderMelds(playerIdx) {
  const pos    = PLAYER_POS[playerIdx];
  const meldEl = $(`${pos}-melds`);
  if (!meldEl) return;

  meldEl.innerHTML = '';
  game.melds[playerIdx].forEach(meld => {
    const group = document.createElement('div');
    group.classList.add('meld-group');
    meld.forEach(tile => group.appendChild(makeTileEl(tile, { small: true })));
    meldEl.appendChild(group);
  });
}

function renderScores() {
  const el = $('scores');
  el.innerHTML = '';
  for (let p = 0; p < game.numPlayers; p++) {
    const span = document.createElement('span');
    span.classList.add('score-entry');
    if (p === game.currentPlayer) span.classList.add('active-player');
    span.textContent = `${game.playerName(p)}(${game.windName(p)}): ${game.scores[p]}점`;
    el.appendChild(span);
  }
}

function highlightCurrentPlayer() {
  if (!game) return;
  const cur = game.currentPlayer;
  PLAYER_POS.forEach((pos, idx) => {
    const labelEl = $(`${pos}-label`);
    if (!labelEl) return;
    if (idx === cur) labelEl.classList.add('active-turn');
    else             labelEl.classList.remove('active-turn');
  });
}

/* ── Player-zone visibility ──────────────── */
function updatePlayerZoneVisibility() {
  const n = game.numPlayers;

  $('right-player').style.display = '';
  $('right-label').textContent    = `${game.playerName(1)} (${game.windName(1)})`;

  if (n >= 3) {
    $('top-player').style.display = '';
    $('top-label').textContent    = `${game.playerName(2)} (${game.windName(2)})`;
  } else {
    $('top-player').style.display = 'none';
  }

  if (n >= 4) {
    $('left-player').style.display = '';
    $('left-label').textContent    = `${game.playerName(3)} (${game.windName(3)})`;
  } else {
    $('left-player').style.display = 'none';
  }

  $('bottom-label').textContent = `${game.playerName(0)} (${game.windName(0)})`;
}

/** Create a styled tile DOM element from a Tile object. */
function makeTileEl(tile, { small = false, faceDown = false, drawn = false, selected = false } = {}) {
  const el = document.createElement('div');
  el.classList.add('tile');
  if (small)    el.classList.add('small');
  if (faceDown) {
    el.classList.add('face-down');
    return el;
  }
  el.classList.add(tile.suit);
  if (drawn)    el.classList.add('drawn');
  if (selected) el.classList.add('selected');

  if (tile.botChar) {
    // Suited tile: number on top, suit label below
    const top = document.createElement('span');
    top.classList.add('tile-top');
    top.textContent = tile.topChar;
    const bot = document.createElement('span');
    bot.classList.add('tile-bot');
    bot.textContent = tile.botChar;
    el.appendChild(top);
    el.appendChild(bot);
  } else {
    // Honor tile: single character centred
    const honor = document.createElement('span');
    honor.classList.add('tile-honor');
    honor.textContent = tile.topChar;
    el.appendChild(honor);
  }
  return el;
}

function onTileClick(tile) {
  if (!game || game.state !== STATE.WAITING_DISCARD) return;

  if (selectedTile && selectedTile.id === tile.id) {
    // Double-click same tile → discard
    const id = tile.id;
    selectedTile = null;
    game.humanDiscard(id);
  } else {
    selectedTile = tile;
    renderHand(0);
  }
}

/* ── Message display ─────────────────────── */
function showMessage(text) {
  const el = $('game-message');
  el.textContent = text;
  el.classList.remove('flash');
  void el.offsetWidth; // force reflow to restart animation
  el.classList.add('flash');
}

/* ── Call prompt popup ───────────────────── */
let callAutoCloseTimer = null;

function showCallPrompt(type, tile, options, resolve) {
  if (callAutoCloseTimer) clearTimeout(callAutoCloseTimer);

  const popup = $('call-popup');
  $('call-title').textContent = callTitle(type, tile);

  // Show the tile
  const tileEl = $('call-tile-display');
  tileEl.innerHTML = '';
  tileEl.appendChild(makeTileEl(tile));

  // Build option buttons
  const optsEl = $('call-options');
  optsEl.innerHTML = '';

  const done = (opt) => {
    clearTimeout(callAutoCloseTimer);
    popup.classList.add('hidden');
    resolve(opt);
  };

  options.forEach(opt => {
    const btn = document.createElement('button');
    btn.classList.add('call-btn');
    btn.textContent = opt;
    btn.addEventListener('click', () => done(opt));
    optsEl.appendChild(btn);
  });

  // Reset timer animation
  const fill = $('call-timer-fill');
  fill.style.animation = 'none';
  void fill.offsetWidth;
  fill.style.animation = '';

  popup.classList.remove('hidden');

  // Auto-pass after 8 s
  callAutoCloseTimer = setTimeout(() => done(options[options.length - 1]), 8000);
}

function callTitle(type, tile) {
  if (type === 'RON') return `론 선언? (${tile.name})`;
  if (type === 'PON') return `퐁 선언? (${tile.name}×3)`;
  if (type === 'CHI') return `치 선언? (${tile.name} 포함 순자)`;
  return type;
}

/* ── Win popup ───────────────────────────── */
function showWinPopup(winnerIdx) {
  const popup = $('win-popup');
  if (winnerIdx === 0) {
    $('win-title').textContent = '🎉 화료! 승리했습니다!';
  } else {
    $('win-title').textContent = `${game.playerName(winnerIdx)} 화료!`;
  }

  const handEl = $('win-hand-display');
  handEl.innerHTML = '';
  sortTiles(game.hands[winnerIdx]).forEach(tile => {
    handEl.appendChild(makeTileEl(tile));
  });
  // Show melds too
  game.melds[winnerIdx].forEach(meld => {
    const sep = document.createElement('span');
    sep.textContent = ' ';
    handEl.appendChild(sep);
    meld.forEach(tile => {
      const el = makeTileEl(tile);
      el.style.opacity = '0.75';
      handEl.appendChild(el);
    });
  });

  $('win-details').textContent =
    `${game.playerName(winnerIdx)} 승리! (현재 점수: ${game.scores[winnerIdx]}점)`;

  popup.classList.remove('hidden');
}

function hideWinPopup() { $('win-popup').classList.add('hidden'); }

function showExhaustedPopup() {
  $('win-title').textContent      = '유국 (패산 소진)';
  $('win-hand-display').innerHTML = '';
  $('win-details').textContent    = '아무도 화료하지 못했습니다.';
  $('win-popup').classList.remove('hidden');
}

/* ── Final score ─────────────────────────── */
function renderFinalScores() {
  const el = $('final-scores');
  el.innerHTML = '<h3>최종 점수</h3>';
  const order = Array.from({ length: game.numPlayers }, (_, i) => i)
    .sort((a, b) => game.scores[b] - game.scores[a]);

  order.forEach((playerIdx, rank) => {
    const row = document.createElement('div');
    row.classList.add('final-score-row');
    row.innerHTML = `
      <span class="rank">${rank + 1}위</span>
      <span class="pname">${game.playerName(playerIdx)}</span>
      <span class="pscore">${game.scores[playerIdx]}점</span>
    `;
    el.appendChild(row);
  });
}

/* ── Init ────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  initSetup();
  showScreen('setup-screen');
});
