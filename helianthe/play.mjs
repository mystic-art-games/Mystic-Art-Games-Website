import { extendedEventRules, extendedKinds, extendedEventStep } from './play-extended-events.mjs?v=3';
import { entityEffectKind, entityEffectStep } from './play-entity-effects.mjs?v=2';

const terrainFullArtUrl = terrain => new URL(`./assets/Terrain_${terrain}_Full_Art.png`, import.meta.url).href;
const defaultTableName = hostName => `${Array.from(String(hostName ?? '').trim() || 'Player').slice(0, 52).join("")}'s Table`;

export function playerOnline(timestamp, now = Date.now()) {
  return Boolean(timestamp && now - Date.parse(timestamp) < 45000);
}

export function createPlayView({ client, getUser, getDecks, getCards, getProfiles, makeAvatar, requireSignIn, renderCard, getArtworkUrl, getPatronCard, getPatronFactionIcon, getDefaultPatronName }) {
  const root = document.querySelector('#play-view');
  const $ = id => root.querySelector(`#play-${id}`);
  function renderPlayCard(canvas, card, artwork, current, display = canvas.parentElement) {
    return renderCard(canvas, card, artwork, current, {
      largerText: true,
      // Spare resolution keeps faces sharp as the hand reflows or cards animate.
      getPixelWidth: () => Math.max(120, display?.clientWidth || 0) * (window.devicePixelRatio || 1) * 1.2,
    });
  }
  let userId = null, room = null, channel = null, timer = null, awayTicker = null, awayExpiryBusy = false, visible = false, inLobby = false;
  let lobbyTimer = null, directoryChannel = null, directoryUserId = null, listSerial = 0, tableListSignature = '';
  let busy = false, epoch = 0, fetchSerial = 0, live = false, lastHeartbeat = 0, autoDeckPending = false;
  const sitAtTableSoundUrl = new URL('./assets/Sit_At_The_Table.wav?v=2', import.meta.url);
  const tableSoundVolume = 0.3;
  const TableAudioContext = window.AudioContext || window.webkitAudioContext;
  const buildTableSoundData = TableAudioContext && fetch(sitAtTableSoundUrl)
    .then(response => response.ok ? response.arrayBuffer() : null)
    .catch(() => null);
  let tableAudioContext;
  let buildTableSoundBuffer;
  const smashTableSound = new Audio(new URL('./assets/Smash_Table.mp3', import.meta.url));
  const leaveTableSound = new Audio(new URL('./assets/Leave_Table.wav?v=2', import.meta.url));
  const sitAtTableSound = new Audio(sitAtTableSoundUrl);
  const readySound = new Audio(new URL('./assets/Ready.mp3', import.meta.url));
  const notReadySound = new Audio(new URL('./assets/Not_Ready.mp3', import.meta.url));
  const openingDiceSound = new Audio(new URL('./assets/Play.mp3', import.meta.url));
  const rollDiceSound = new Audio(new URL('./assets/Roll_Dices.mp3', import.meta.url));
  const drawCardSound = new Audio(new URL('./assets/Draw_Card.mp3', import.meta.url));
  const massiveDrawSound = new Audio(new URL('./assets/Massive_Draw.mp3', import.meta.url));
  const shapeSound = new Audio(new URL('./assets/Shape.mp3', import.meta.url));
  const changeTurnSound = new Audio(new URL('./assets/Change_Turn.mp3', import.meta.url));
  const nextPhaseSound = new Audio(new URL('./assets/Next_Phase.mp3', import.meta.url));
  const selectCardSound = new Audio(new URL('./assets/Select_Card.wav', import.meta.url));
  const playCardSound = new Audio(new URL('./assets/Play_Card.mp3', import.meta.url));
  rollDiceSound.preload = 'auto';
  const OfflineContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const rollDiceClip = TableAudioContext && OfflineContext ? fetch(rollDiceSound.src)
    .then(response => {
      if (!response.ok) throw new Error('Dice sound unavailable.');
      return response.arrayBuffer();
    })
    .then(data => new OfflineContext(1, 1, 44100).decodeAudioData(data))
    .then(buffer => {
      const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
      const onset = channels.reduce((first, samples) => {
        const index = samples.findIndex(sample => Math.abs(sample) >= 0.01);
        return index < 0 ? first : Math.min(first, index);
      }, buffer.length);
      const offset = onset === buffer.length ? 0 : Math.max(0, onset / buffer.sampleRate - 0.008);
      return { buffer, offset };
    })
    .catch(() => null) : null;
  const winSound = new Audio(new URL('./assets/Win.wav', import.meta.url));
  const loseSound = new Audio(new URL('./assets/Lose.mp3', import.meta.url));
  const backToLobbySound = new Audio(new URL('./assets/Back_To_Lobby.mp3', import.meta.url));
  let pendingDeckId = null, deckSaveInFlight = false;
  let gameState = null, gameLoading = false, gameLoadFailed = false, gameReloadPending = false, handSignature = '', gameRenderSerial = 0, boardRenderSerial = 0, cardPreviewSerial = 0;
  let phaseBusy = false, selectedCardElement = null, hoveredCardElement = null, hoveredCardKey = '', mousePosition = null, patronDeckRequest = '', patronDeckLoadedAt = 0;
  let openingRollBusy = false, openingChoiceBusy = false, openingRollError = '', openingMatchKey = '';
  let openingDealPendingKey = '', openingDealRunningKey = '', openingDealDoneKey = '';
  let mulliganBusy = false, mulliganStepKey = '';
  const mulliganOrder = [];
  const mulliganFlights = new Set(), mulliganHiddenCards = new Set(), mulliganAnimations = new Set();
  const mulliganFlightDuration = 550, mulliganFlightStagger = 90;
  let openingRevealTimer = null, openingPanelAnimatedKey = '', openingRevealDoneKey = '';
  let openingShuffleTimer = null, openingVisualDice = [1, 1];
  const openingAnimatedValues = { host: null, guest: null };
  let drawRetryAt = 0, activeHandShifts = [];
  const activeDrawFlights = new Set();
  const terrainArrivals = new Map();
  const opponentCardFlights = new Set();
  const opponentArrivingEntities = new Set();
  const drawHiddenItems = new Set();
  const discardFlights = new Set();
  const discardHandShifts = [], discardHiddenCards = new Set();
  const arrivingCardCanvases = new Map();
  let beginningTurnKey = '', beginningOrder = [], beginningTargetSource = null;
  const beginningSkipped = new Set();
  const beginningTargets = new Map();
  const beginningChoices = new Map();
  const beginningBrambleTargets = new Map();
  const beginningBrambleEvents = new Map();
  let archiveBrowserSeat = null, archiveBrowserCards = [], archiveBrowserIndex = 0;
  let archiveBrowserRequestSerial = 0, archiveBrowserCardSerial = 0, archiveBrowserOpener = null;
  let archiveBrowserLoading = false, archiveBrowserError = '';
  const gameLogPageSize = 120;
  let gameLogKey = '', gameLogRevision = null, gameLogRequest = null, gameLogRetryAt = 0;
  let gameLogEntries = [], localGameLog = [], gameLogHasOlder = false, gameLogError = '';
  const loggedHandPrompts = new Map();
  let followGameLog = true;
  let unreadGameLogCount = 0;
  let archiveGalleryObserver = null;
  let selectedGameCard = null, pendingEvent = null, pendingEntity = null, pendingFestival = null, arrivingEntityKey = null, zoneCounts = null, zoneCountsRevision = null, zoneCountsRequest = null, eventNoticeTimer = null;
  const discardSelections = new Set();
  const gameDeckPatrons = new Map(), gamePlayerPatrons = new Map();
  const patronPreviews = { self: { key: '', serial: 0 }, opponent: { key: '', serial: 0 } };
  const archivePreviews = { self: { key: null, serial: 0 }, opponent: { key: null, serial: 0 } };
  const diePips = Array.from({ length: 9 }, () => '<span></span>').join('');
  const handCountIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="5" width="11" height="14" rx="1.5" transform="rotate(-19 8 12)" fill="#1b352b"/><rect x="10.5" y="5" width="11" height="14" rx="1.5" transform="rotate(19 16 12)" fill="#1b352b"/><rect x="6.5" y="3.5" width="11" height="16" rx="1.5" fill="#1b352b"/></svg>';
  root.innerHTML = `
    <div class="play-heading"><h1>Lobby</h1></div>
    <div id="play-message" role="status" aria-live="polite" hidden><span id="play-message-text"></span><button id="play-message-close" type="button" aria-label="Dismiss message">×</button></div>
    <section id="play-signin" class="play-surface" hidden><h2>Your seat is waiting</h2><p>Sign in to create a table or join one from the list.</p><button id="play-signin-button" class="action-add-save" type="button">Sign in to play</button></section>
    <div id="play-lobby" class="play-lobby" hidden>
      <section class="play-surface play-create-panel"><div><span class="play-eyebrow">HOST A SESSION</span><button id="play-create" class="action-add-save" type="button">Build Table</button></div></section>
      <section class="play-surface play-recent"><div class="play-table-heading"><h2>All tables</h2></div><p id="play-no-rooms">Loading tables…</p><div id="play-room-list"></div></section>
    </div>
    <section id="play-session" hidden>
      <button id="play-back" class="back-to-decks" type="button"><span aria-hidden="true">←</span> Back to Lobby</button>
      <div class="play-room-bar"><div class="play-room-identity"><div class="play-room-name-line"><strong id="play-room-name"></strong><button id="play-edit-name" class="action-add-save" type="button">Edit Name</button></div><form id="play-name-form" hidden><input id="play-name-input" aria-label="Table name" maxlength="60" required><button type="submit">Save</button><button id="play-cancel-name" type="button">Cancel</button></form><span class="play-room-code-line">Code: <strong id="play-room-code"></strong></span></div><div class="play-room-actions"><button id="play-leave" class="action-delete" type="button">Smash Table</button></div></div>
      <div id="play-players" class="play-players"></div>
      <div id="play-deck-field" class="play-deck-field"><span id="play-deck-label" hidden>Your deck</span><div class="play-deck-choice"><img id="play-deck-cover" class="play-deck-cover" alt="" hidden><select id="play-deck" hidden></select><details id="play-deck-picker" class="play-deck-picker"><summary id="play-deck-trigger" aria-labelledby="play-deck-label play-deck-trigger">No decks available</summary><div id="play-deck-options" class="play-deck-options"></div></details></div><span id="play-deck-patron" class="play-deck-patron" hidden></span></div>
      <button id="play-ready" class="action-add-save" type="button">Ready</button>
      <div id="play-controls-parking" hidden></div>
      <p id="play-room-status" role="status"></p>
    </section>
    <section id="play-game" hidden>
      <div class="play-game-player-block">
      <div class="play-game-opponent-footer"><div class="play-game-opponent-identity play-game-player-identity"><div class="play-game-identity-name"><span class="play-game-player-label"><span id="play-game-opponent-avatar" class="user-avatar play-game-player-avatar" aria-hidden="true"></span><strong id="play-game-opponent-name"></strong></span></div><span id="play-game-opponent-hand-count" class="play-game-hand-count" aria-live="polite" hidden></span></div><span id="play-game-opponent-presence" class="play-away-pill" hidden></span><div class="play-game-actions"><details class="play-table-menu"><summary class="play-menu-toggle" aria-label="Table actions" title="Table actions"><svg class="play-menu-bars" aria-hidden="true" viewBox="0 0 22 22"><path d="M3 5h16 M3 11h16 M3 17h16"/></svg></summary><div class="play-table-menu-panel"><strong id="play-game-name" class="play-menu-table-name"></strong><button id="play-game-leave" type="button">Concede</button><button id="play-game-back" class="play-menu-lobby" type="button">Back to Lobby</button></div></details></div></div>
      </div>
      <div class="play-game-board-wrap">
      <div class="play-game-left-stack">
        <aside id="play-game-card-preview" class="play-game-card-preview" aria-label="Card preview" hidden><button id="play-game-card-preview-close" class="play-game-card-preview-close action-delete" type="button" aria-label="Close card preview">×</button><canvas id="play-game-card-preview-canvas" hidden></canvas><img id="play-game-card-preview-image" alt="" hidden><span id="play-game-card-preview-fallback" class="play-hand-fallback"></span></aside>
        <aside id="play-game-beginning-effects" class="play-beginning-effects" aria-label="Beginning of Turn Entity effects" hidden><strong>Beginning of Turn effects</strong><p id="play-game-beginning-opponent-status" hidden>Opponent is choosing the order, targets, and optional effects to skip.</p><section class="play-beginning-zone" aria-labelledby="play-game-beginning-active-title"><h3 id="play-game-beginning-active-title">Resolve in this order</h3><ol id="play-game-beginning-list"></ol></section><section class="play-beginning-zone play-beginning-skipped-zone" aria-labelledby="play-game-beginning-skipped-title"><h3 id="play-game-beginning-skipped-title">Skip this turn</h3><ol id="play-game-beginning-skipped-list"></ol></section><button id="play-game-resolve-beginning" type="button">Resolve Effects</button></aside>
      </div>
      <svg class="play-beginning-connector" aria-hidden="true"><path id="play-game-beginning-connector"></path></svg>
      <div class="play-game-table">
        <div class="play-game-zones-left">
          <div class="play-game-zone play-game-zone-opponent-patron"><div id="play-game-opponent-patron-slot" class="play-game-patron-slot" role="img" aria-label="Opponent's Patron"><canvas id="play-game-opponent-patron" hidden></canvas><span id="play-game-opponent-patron-fallback" class="play-game-patron-fallback" aria-hidden="true"></span></div></div>
          <div class="play-game-zone-pair play-game-zone-pair-self" aria-label="Your card zones"><div class="play-game-zone play-game-zone-horizon"><div id="play-game-self-horizon" class="play-deck-stack" role="img" aria-label="Your Horizon, draw deck"></div></div><div class="play-game-zone play-game-zone-archive"><button id="play-game-self-archive" class="play-game-archive-card is-empty" type="button" aria-label="Browse your Archive"><canvas id="play-game-self-archive-canvas" aria-hidden="true" hidden></canvas><span id="play-game-archive-top"></span></button></div></div>
        </div>
        <div id="play-game-board" class="play-game-board" role="group" aria-label="Shared five-column, four-row Terrain board"></div>
        <div id="play-game-entanglements" class="play-game-entanglements" aria-hidden="true"></div>
        <div class="play-game-zones-right">
          <div class="play-game-zone-pair play-game-zone-pair-opponent" aria-label="Opponent's card zones"><div class="play-game-zone play-game-zone-archive"><button id="play-game-opponent-archive" class="play-game-archive-card is-empty" type="button" aria-label="Browse opponent's Archive"><canvas id="play-game-opponent-archive-canvas" aria-hidden="true" hidden></canvas><span id="play-game-opponent-archive-top"></span></button></div><div class="play-game-zone play-game-zone-horizon"><div id="play-game-opponent-horizon" class="play-deck-stack" role="img" aria-label="Opponent's Horizon, draw deck"></div></div></div>
          <div class="play-game-zone play-game-zone-self-patron"><div id="play-game-self-patron-slot" class="play-game-patron-slot" role="img" aria-label="Your Patron"><canvas id="play-game-self-patron" hidden></canvas><span id="play-game-self-patron-fallback" class="play-game-patron-fallback" aria-hidden="true"></span></div></div>
        </div>
      </div>
      <div class="play-game-phase-stack" hidden>
      <section class="play-game-log" aria-labelledby="play-game-log-title">
        <header class="play-game-log-header">
          <h2 id="play-game-log-title">Game Log</h2>
          <div class="play-game-log-jump">
            <span id="play-game-log-unread" class="play-game-log-unread" aria-hidden="true" hidden></span>
            <button id="play-game-log-latest" class="play-game-log-latest action-add-save" type="button" aria-label="Go to the latest log entry" title="Go to latest entry" aria-controls="play-game-log-scroll" hidden><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3v9m-4-4 4 4 4-4"/></svg></button>
          </div>
        </header>
        <div id="play-game-log-scroll" class="play-game-log-scroll" tabindex="0" aria-label="Game log entries">
          <button id="play-game-log-older" type="button" hidden>Load older</button>
          <p id="play-game-log-status">No activity yet.</p>
          <ol id="play-game-log-list"></ol>
        </div>
      </section>
      <aside id="play-game-phases" class="play-game-phases" aria-label="Turn phases" hidden>
        <p id="play-game-turn-owner" class="play-game-turn-owner" aria-live="polite"></p>
        <ol class="play-game-phase-list">
          <li data-phase="0"><span class="play-game-phase-marker" aria-hidden="true"></span>Beginning of Turn</li>
          <li data-phase="1"><span class="play-game-phase-marker" aria-hidden="true"></span>Draw</li>
          <li data-phase="2"><span class="play-game-phase-marker" aria-hidden="true"></span>Main Phase</li>
          <li data-phase="3"><span class="play-game-phase-marker" aria-hidden="true"></span>End of Turn</li>
        </ol>
      </aside>
        <div class="play-game-phase-actions">
          <button id="play-game-extra-draw" class="action-add-save play-game-next-phase play-game-extra-draw" type="button" aria-label="Draw one card instead of playing and go to End of Turn" hidden>Draw Instead</button>
          <button id="play-game-next-phase" class="action-add-save play-game-next-phase" type="button">Next Phase</button>
        </div>
      </div></div>
      <div id="play-opening-roll" class="play-opening-roll" role="dialog" aria-modal="true" aria-labelledby="play-opening-roll-title" hidden><div class="play-opening-roll-panel"><h2 id="play-opening-roll-title">Opening Dice</h2><p id="play-opening-roll-status" class="play-opening-roll-status" role="status" aria-live="polite"></p><div id="play-opening-dice" class="play-opening-dice" hidden><div id="play-opening-die-seat-host" class="play-opening-die-seat"><strong id="play-opening-host-name"></strong><div id="play-opening-host-pair" class="play-opening-die-pair" hidden><div id="play-opening-host-die-1" class="play-opening-die" aria-label="Host's first die">${diePips}</div><div id="play-opening-host-die-2" class="play-opening-die" aria-label="Host's second die">${diePips}</div></div><span id="play-opening-host-total" class="play-opening-total" hidden></span></div><div id="play-opening-die-seat-guest" class="play-opening-die-seat"><strong id="play-opening-guest-name"></strong><div id="play-opening-guest-pair" class="play-opening-die-pair" hidden><div id="play-opening-guest-die-1" class="play-opening-die" aria-label="Guest's first die">${diePips}</div><div id="play-opening-guest-die-2" class="play-opening-die" aria-label="Guest's second die">${diePips}</div></div><span id="play-opening-guest-total" class="play-opening-total" hidden></span></div></div><button id="play-opening-roll-button" class="action-add-save" type="button">Roll Dices</button><p id="play-opening-roll-error" class="play-opening-roll-error" role="alert" hidden></p></div></div>
      <div id="play-game-archive-browser" class="play-archive-browser" hidden><div class="play-archive-browser-backdrop"></div><section class="play-archive-browser-panel" role="dialog" aria-modal="true" aria-labelledby="play-game-archive-browser-title"><header><div><h2 id="play-game-archive-browser-title">Archive</h2><p id="play-game-archive-browser-status" role="status" aria-live="polite"></p></div><button id="play-game-archive-browser-close" class="play-archive-browser-close" type="button" aria-label="Close Archive">×</button></header><div class="play-archive-browser-body"><div class="play-archive-browser-view"><div class="play-archive-browser-card"><canvas id="play-game-archive-browser-canvas" hidden></canvas><span id="play-game-archive-browser-fallback"></span></div></div><ol id="play-game-archive-browser-list" class="play-archive-browser-list" aria-label="Cards in Archive"></ol></div></section></div>
      <div class="play-game-player-block">
      <div class="play-game-self-identity play-game-player-identity"><div class="play-game-identity-name"><span class="play-game-player-label"><span id="play-game-self-avatar" class="user-avatar play-game-player-avatar" aria-hidden="true"></span><strong id="play-game-self-name"></strong></span><span id="play-game-self-presence" class="play-away-pill" hidden></span></div><span id="play-game-hand-count" class="play-game-hand-count" aria-live="polite" hidden></span></div>
      <section id="play-game-self" class="play-surface play-game-seat" aria-label="Your area">
        <div class="play-hand-notices">
          <div id="play-opening-choice" class="play-opening-choice" role="status" hidden><strong id="play-opening-choice-message"></strong><div id="play-opening-choice-actions"><button id="play-opening-choose-self" type="button">I start</button><button id="play-opening-choose-opponent" type="button">Opponent starts</button></div></div>
          <div id="play-opening-mulligan" class="play-opening-choice play-opening-mulligan" role="status" aria-live="polite" hidden><strong id="play-opening-mulligan-message"></strong><p id="play-opening-mulligan-instructions" hidden>Select cards in the order they should go to the bottom of your Horizon. Then draw the same number.</p><div id="play-opening-mulligan-actions" hidden><button id="play-opening-mulligan-keep" type="button">Keep</button><button id="play-opening-mulligan-confirm" type="button" hidden>Replace selected cards</button></div></div>
          <div id="play-game-event-notice" class="play-game-event-notice" role="status" aria-live="polite" hidden><span id="play-game-event-notice-text"></span><button id="play-game-event-notice-close" type="button" aria-label="Dismiss message" hidden>×</button></div>
          <div id="play-game-discard-bar" class="play-game-discard-bar" hidden><strong id="play-game-discard-text" role="status" aria-live="polite"></strong><button id="play-game-confirm-discard" type="button" disabled>Confirm Discard</button></div>
        </div>
        <div class="play-game-hand-wrap"><p id="play-game-loading" role="status">Preparing the opening hands…</p><div id="play-game-hand" class="play-game-hand"></div></div>
      </section>
      </div>
      <div id="play-game-result" class="play-game-result" role="status" aria-live="polite" hidden><div class="play-game-result-panel"><h2 id="play-game-result-title"></h2><p id="play-game-result-detail"></p><button id="play-game-result-back" type="button">Back to Lobby</button></div></div>
    </section>`;
  function syncZoneCardSize() {
    const cell = $('game-board').firstElementChild;
    if (!cell) return;
    const board = $('game-board');
    const table = board.closest('.play-game-table');
    const hand = $('game-hand');
    const previousHandCardWidth = Math.max(94, Math.min(innerHeight * .182, innerWidth * .14, 172));
    const handStyle = getComputedStyle(hand);
    const verticalPadding = parseFloat(handStyle.paddingTop) + parseFloat(handStyle.paddingBottom);
    // Keep the table's sizing area independent of the extra height used by the hand.
    const previousHandHeight = previousHandCardWidth * 88 / 63 + verticalPadding;
    const extraHandHeight = Math.max(0, hand.offsetHeight - Math.ceil(previousHandHeight));
    root.style.setProperty('--play-extra-hand-height', `${extraHandHeight}px`);
    const handTop = $('game-self').getBoundingClientRect().top;
    if (handTop > 0) root.style.setProperty('--play-hand-top', `${handTop}px`);
    const boardWrap = root.querySelector('.play-game-board-wrap');
    const desktop = window.matchMedia('(min-width: 901px)').matches;
    const sidebarBounds = boardWrap.getBoundingClientRect();
    const menu = $('game').querySelector('.play-game-opponent-footer .play-menu-toggle');
    const menuBottom = menu?.getBoundingClientRect().bottom ?? sidebarBounds.top;
    const sidebarGap = Math.max(0, sidebarBounds.bottom - handTop + 8);
    root.style.setProperty('--play-sidebar-top-gap', `${Math.max(0, menuBottom + 8 - sidebarBounds.top)}px`);
    root.style.setProperty('--play-sidebar-bottom-gap', `${sidebarGap}px`);
    const currentOffset = parseFloat(table.style.getPropertyValue('--play-table-offset-y')) || 0;
    const boardRect = board.getBoundingClientRect();
    if (boardRect.height) {
      const centeredOffset = desktop ? handTop / 2 - (boardRect.top + boardRect.height / 2 - currentOffset) : 0;
      table.style.setProperty('--play-table-offset-y', `${centeredOffset}px`);
    }
    const bounds = cell.getBoundingClientRect();
    const { width, height } = bounds;
    if (!width || !height) return;
    root.style.setProperty('--play-map-card-width', `${width}px`);
    root.style.setProperty('--play-map-card-height', `${height}px`);
    const wrapBounds = boardWrap.getBoundingClientRect();
    const boardBounds = $('game-board').getBoundingClientRect();
    root.style.setProperty('--play-map-board-height', `${boardBounds.height}px`);
    positionEntanglementTokens();
    if (desktop) {
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const badgeLeft = element => {
        const badge = getComputedStyle(element, '::after');
        const badgeWidth = Math.max(parseFloat(badge.width) || 0, 1.4 * rem)
          + (parseFloat(badge.paddingLeft) || 0) + (parseFloat(badge.paddingRight) || 0)
          + (parseFloat(badge.borderLeftWidth) || 0) + (parseFloat(badge.borderRightWidth) || 0);
        return element.getBoundingClientRect().left - .5 * rem - badgeWidth;
      };
      const edgeGap = Math.max(8, wrapBounds.left - root.getBoundingClientRect().left);
      const horizontalWidth = Math.min(badgeLeft($('game-self-horizon')), badgeLeft($('game-self-archive')))
        - wrapBounds.left - edgeGap;
      const playerBlocks = $('game').querySelectorAll(':scope > .play-game-player-block');
      const topBoundary = Math.max(playerBlocks[0].getBoundingClientRect().bottom,
        $('game-opponent-hand-count').getBoundingClientRect().bottom);
      const bottomBoundary = $('game-self-name').getBoundingClientRect().top;
      const verticalCenter = (topBoundary + bottomBoundary) / 2;
      const verticalWidth = Math.max(0, (bottomBoundary - topBoundary - edgeGap * 2) * 63 / 88);
      root.style.setProperty('--play-preview-width', `${Math.max(0, Math.floor(Math.min(horizontalWidth, verticalWidth)))}px`);
      root.style.setProperty('--play-preview-offset-y', `${verticalCenter - wrapBounds.top - wrapBounds.height / 2}px`);
    } else {
      root.style.removeProperty('--play-preview-width');
      root.style.removeProperty('--play-preview-offset-y');
    }
    if (discardFlights.size) syncLandedDiscards();
  }
  if (typeof ResizeObserver === 'function') {
    const zoneResizeObserver = new ResizeObserver(syncZoneCardSize);
    zoneResizeObserver.observe($('game-board'));
    zoneResizeObserver.observe($('game-self'));
    zoneResizeObserver.observe(root.querySelector('.play-game-board-wrap'));
  }
  const deckField = $('deck-field');
  const readyButton = $('ready');
  const phaseOrder = ['beginning', 'draw', 'main', 'end'];
  let phaseAdvanceTimer = null, phaseAdvanceKey = '', phaseAdvanceRetryAt = 0;
  const eventEffects = {
    'Static Insulation': ['protect any terrain.', 'protect', 'Terrain'],
    'Verdant Faultline': ['unprotect any entity.', 'unprotect_entity', 'protected Entity'],
    'Beacon Grid': ['add 2 lumens on any radiance terrain.', 'lumens_two', 'Radiance Terrain'],
    'Breachside Repairs': ['add 1 lumen on any radiance terrain. draw 1 card.', 'lumen_draw', 'Radiance Terrain'],
    'Controlled Overload': ['add 3 lumens on any radiance terrain. unprotect it.', 'lumens_three_unprotect', 'Radiance Terrain'],
    'Grid Stabilization': ['protect any radiance terrain with at least 1 lumen. draw 1 card.', 'protect_radiance_draw', 'Radiance Terrain with at least 1 Lumen'],
    'Feel the Power': ['draw a card for every 4 lumen counters in the world', 'draw_from_lumens', ''],
    'Path of Radiance': ['remove all lumen counters from the world, draw that many cards minus 8', 'clear_lumens_draw', ''],
    'Greenway Advance': ['fertilize 2.', 'fertilize_two', 'empty space for the first Fertilize token'],
    'Verdant Vineroots': ['fertilize 1. draw 1 card.', 'fertilize_draw', 'empty space to Fertilize'],
    'Seed Convoy': ['put a fertilize counter on an fertilized node, after that draw a card.', 'fertilize_existing_draw', 'already fertilized empty space'],
    'Festival of New Canopies': ['draw 2 cards, then discard 1 card.', 'draw_two_discard_one', ''],
  };
  const printedEventEffects = {
    'Festival of New Canopies': [['draw 2 cards. discard 2 cards.', 'draw_two_discard_two', '']],
    'Spark of Invention': [['recall any event from archive to your hand.', 'recall_event', '']],
    'Grid Reconfiguration': [["transform terrain to different type if there's no entity.", 'reconfigure', 'unoccupied Terrain']],
    'Greenway Advance': [['create verdant terrain on a legal blank node. then create verdant terrain on a legal blank node adjacent to it.', 'greenway', 'empty space adjacent to Terrain']],
    'Greenway Accord': [['choose one connected group of symbiosis fields. remove crisis from one field in that group. if the group contains at least 3 fields, draw 1 card.', 'accord', 'Symbiosis Terrain']],
    'Tangle': [['choose a node with 2 adjacent verdant terrains. remove all counters from that node, then dissolve the terrain and the entity on that node.', 'tangle', 'Node next to at least two Verdant Terrain cards']],
    'Fertile Rain': [['dissolve entity from verdant terrain to fertilize 2 on adjacent nodes.', 'fertile_rain', 'Verdant Terrain with an Entity']],
    'Seed Caravan': [['create verdant terrain on a legal blank node adjacent to a verdant node. draw 2 cards, then discard 1 card.', 'seed_caravan', 'empty space adjacent to Verdant Terrain']],
    'Static Insulation': [['create 1 shield token on any terrain.', 'protect', 'Terrain']],
    'Beacon Grid': [['add 2 lumens on radiance terrain.', 'lumens_two', 'Radiance Terrain']],
    'Breachside Repairs': [['add 1 lumen on radiance terrain. draw 1 card.', 'lumen_draw', 'Radiance Terrain']],
    'Grid Stabilization': [['remove crisis from radiance terrain with at least 1 lumen. draw 1 card.', 'restore_radiance_draw', 'Radiance Terrain with at least 1 Lumen']],
    'Restoration Nursery': [['remove crisis from terrain. draw 1 card.', 'restore_draw', 'Terrain']],
    'Scatter the Seeds': [['fertilize target node with no terrain on it. draw a card.', 'fertilize_draw', 'empty space to Fertilize']],
    'Verdant Vineroots': [['fertilize target node with no terrain. draw a card', 'fertilize_draw', 'empty space to Fertilize']],
    'Controlled Overload': [['add 3 lumens on radiance terrain and mark this terrain with crisis.', 'lumens_three_crisis', 'Radiance Terrain']],
    'Rootline Breach': [['transform a radiance node into verdant. remove crisis from it.', 'rootline', 'Radiance Terrain']],
    'Skyfire': [['dissolve any terrain along with entity on it.', 'dissolve_terrain', 'Terrain'], ['dissolve any terrain.', 'dissolve_terrain', 'Terrain'], ['dissolve any entity.', 'dissolve_entity', 'Entity']],
  };
  function eventSupport(card) {
    if (card?.card_type === 'Event' && !String(card.effect || '').trim()) return ['', 'none', ''];
    const effect = String(card?.effect || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const rule = eventEffects[card?.title];
    if (rule?.[0] === effect) return rule;
    return printedEventEffects[card?.title]?.find(([text]) => text === effect)
      ?? (extendedEventRules[card?.title]?.[0] === effect ? extendedEventRules[card.title] : null);
  }
  function unavailableEventReason(card) {
    if (card?.title === 'Skyfire') {
      const dissolvesTerrain = /dissolve\b[^.]*\bterrain\b/i.test(card.effect || '');
      const target = dissolvesTerrain ? 'Terrain' : 'Entity';
      const hasTarget = Object.values(room?.board || {}).some(node => dissolvesTerrain ? node?.terrain : node?.entity);
      if (!hasTarget) return `There is no legal ${target} to Dissolve. Skyfire's effect is not available in online play yet.`;
      return `Skyfire's Dissolve effect is not available in online play yet.`;
    }
    return 'This Event effect is not available in online play yet.';
  }
  function matchLogKey() {
    return userId && room?.activated_at ? `${userId}:${room.id}:${room.activated_at}` : '';
  }
  function syncGameLogScope() {
    const key = matchLogKey();
    if (key === gameLogKey) return;
    gameLogKey = key;
    gameLogEntries = [];
    localGameLog = [];
    loggedHandPrompts.clear();
    gameLogRevision = null;
    gameLogRequest = null;
    gameLogRetryAt = 0;
    gameLogHasOlder = false;
    gameLogError = '';
    renderGameLog(true);
  }
  function appendGameLogMessage(container, message, cards) {
    const lower = message.toLocaleLowerCase();
    const letterOrDigit = character => Boolean(character && /[\p{L}\p{N}]/u.test(character));
    let position = 0;
    while (position < message.length) {
      let match = null;
      for (const entry of cards) {
        let index = lower.indexOf(entry.lower, position);
        while (index >= 0 && (letterOrDigit(message[index - 1])
          || letterOrDigit(message[index + entry.title.length]))) {
          index = lower.indexOf(entry.lower, index + 1);
        }
        if (index < 0) continue;
        if (!match || index < match.index || (index === match.index && entry.title.length > match.entry.title.length)) {
          match = { index, entry };
        }
      }
      if (!match) break;
      if (match.index > position) container.append(message.slice(position, match.index));
      const name = document.createElement('span');
      name.className = 'play-game-log-card';
      name.textContent = message.slice(match.index, match.index + match.entry.title.length);
      name._playCard = match.entry.card;
      container.append(name);
      position = match.index + match.entry.title.length;
    }
    if (position < message.length) container.append(message.slice(position));
  }
  function renderGameLog(scrollToLatest = false, prepended = false) {
    const scroll = $('game-log-scroll');
    const list = $('game-log-list');
    const previousHeight = scroll.scrollHeight;
    const previousTop = scroll.scrollTop;
    const cards = (getCards?.() || []).filter(card => card?.title)
      .map(card => ({ card, title: card.title, lower: card.title.toLocaleLowerCase() }));
    if (scrollToLatest) followGameLog = true;
    const entries = [...gameLogEntries, ...localGameLog]
      .sort((a, b) => a.time - b.time || Number(a.id || 0) - Number(b.id || 0));
    for (let index = 0; index < entries.length - 1; index++) {
      if (!entries[index].local && entries[index].message === 'drew 1 card.'
        && /^Turn \d+ · Draw$/.test(entries[index + 1].message)) {
        [entries[index], entries[index + 1]] = [entries[index + 1], entries[index]];
        index++;
      }
    }
    const groups = [];
    for (const entry of entries) {
      const last = groups.at(-1);
      if (last && last.message === entry.message && last.actor_id === entry.actor_id && last.local === entry.local) {
        last.count += entry.count || 1;
      } else {
        groups.push({ ...entry, count: entry.count || 1 });
      }
    }
    const seats = [room?.host_id, room?.guest_id];
    const firstTurn = gameLogEntries.find(entry => entry.message === 'will take the first turn.');
    const knownTurn = seats.includes(room?.turn_player_id) && room?.turn_player_id && room.turn_number > 0
      ? { number: room.turn_number, player: room.turn_player_id }
      : firstTurn ? { number: 1, player: firstTurn.actor_id } : null;
    let loggedTurnOwner = null;
    list.replaceChildren(...groups.map(entry => {
      const row = document.createElement('li');
      row.classList.toggle('is-private', Boolean(entry.local));
      let prefix = entry.local ? 'Only you · ' : entry.actor_id ? `${entry.actor_id === userId ? 'You' : 'Opponent'} ` : '';
      const text = document.createElement('span');
      const turn = !entry.local && entry.message.match(/^Turn (\d+)(?: · (.+)| began\.)$/);
      let owner = entry.local ? userId : entry.actor_id;
      let message = entry.message === 'Opening dice resolved. Choose who starts.'
        ? openingDiceResultText(openingDiceWinner()) : entry.message;
      if (turn && knownTurn && seats.every(Boolean)) {
        const sameSeat = Math.abs(Number(turn[1]) - knownTurn.number) % 2 === 0;
        owner = sameSeat ? knownTurn.player : seats.find(id => id !== knownTurn.player);
        loggedTurnOwner = owner;
        const label = owner === userId ? 'Yours' : "Opp's";
        prefix = `Turn ${turn[1]} (${label})${turn[2] ? ' · ' : ''}`;
        message = turn[2] || '';
      } else {
        if (!owner && /^R[1-4] C[1-5] · /.test(entry.message)) owner = loggedTurnOwner;
      }
      if (owner) row.classList.add(owner === userId ? 'is-own-action' : 'is-opponent-action');
      if (prefix) {
        const lead = document.createElement('span');
        lead.className = 'play-game-log-prefix';
        lead.textContent = prefix;
        text.append(lead);
      }
      appendGameLogMessage(text, message, cards);
      row.append(text);
      if (entry.count > 1) {
        const count = document.createElement('span');
        count.className = 'play-game-log-count';
        count.textContent = `x${entry.count}`;
        row.append(count);
      }
      return row;
    }));
    const status = $('game-log-status');
    status.textContent = gameLogError || (entries.length ? '' : 'No activity yet.');
    status.hidden = !status.textContent;
    $('game-log-older').hidden = !gameLogHasOlder;
    if (followGameLog) scroll.scrollTop = scroll.scrollHeight;
    else if (prepended) scroll.scrollTop = Math.max(0, previousTop + scroll.scrollHeight - previousHeight);
    else scroll.scrollTop = previousTop;
    updateGameLogLatest();
  }
  function updateGameLogLatest() {
    if (followGameLog) unreadGameLogCount = 0;
    const latest = $('game-log-latest');
    const badge = $('game-log-unread');
    latest.hidden = followGameLog;
    badge.hidden = unreadGameLogCount === 0;
    badge.textContent = unreadGameLogCount ? String(unreadGameLogCount) : '';
    latest.setAttribute('aria-label', unreadGameLogCount
      ? `Go to the latest log entry, ${unreadGameLogCount} new ${unreadGameLogCount === 1 ? 'entry' : 'entries'}`
      : 'Go to the latest log entry');
  }
  const gameLogScroll = $('game-log-scroll');
  gameLogScroll.addEventListener('scroll', () => {
    if (!gameLogScroll.clientHeight) return;
    followGameLog = gameLogScroll.scrollHeight - gameLogScroll.clientHeight - gameLogScroll.scrollTop <= 2;
    updateGameLogLatest();
  }, { passive: true });
  $('game-log-latest').addEventListener('click', () => {
    followGameLog = true;
    gameLogScroll.scrollTop = gameLogScroll.scrollHeight;
    gameLogScroll.focus({ preventScroll: true });
    updateGameLogLatest();
  });
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => {
      if (followGameLog && gameLogScroll.clientHeight) gameLogScroll.scrollTop = gameLogScroll.scrollHeight;
    }).observe(gameLogScroll);
  }
  function logPrivateNotice(text) {
    if (!text || inLobby || room?.status !== 'active' || !matchLogKey()) return;
    syncGameLogScope();
    const last = localGameLog.at(-1);
    if (last?.message === text && last.seenRevision === room.revision
      && !(gameLogEntries.at(-1)?.time > last.time)) {
      last.count++;
    } else {
      localGameLog.push({ message: text, local: true, time: Date.now(), seenRevision: room.revision, count: 1 });
    }
    if (!followGameLog) unreadGameLogCount++;
    renderGameLog();
  }
  function logHandPrompt(panel, text) {
    if (!text || panel.hidden) {
      loggedHandPrompts.delete(panel);
      return;
    }
    if (inLobby || $('game').hidden || room?.status !== 'active' || !matchLogKey()) return;
    syncGameLogScope();
    if (loggedHandPrompts.get(panel) === text) return;
    loggedHandPrompts.set(panel, text);
    logPrivateNotice(text);
  }
  async function loadGameLog(older = false) {
    syncGameLogScope();
    if (!gameLogKey || gameLogRequest || Date.now() < gameLogRetryAt) return;
    const revision = room.revision;
    if (older ? !gameLogHasOlder : gameLogRevision === revision) return;
    const request = { key: gameLogKey };
    gameLogRequest = request;
    let builder = client.from('play_game_log').select('id,actor_id,message,created_at')
      .eq('room_id', room.id).eq('match_started_at', room.activated_at)
      .neq('message', 'Match started. Opening hands dealt.');
    const latest = gameLogEntries.at(-1);
    if (older) builder = builder.lt('id', gameLogEntries[0].id);
    else if (latest) builder = builder.gt('id', latest.id);
    const ascending = !older && Boolean(latest);
    const { data, error } = await builder.order('id', { ascending }).limit(gameLogPageSize);
    if (gameLogRequest !== request || matchLogKey() !== request.key) return;
    gameLogRequest = null;
    if (error) {
      gameLogRetryAt = Date.now() + 10000;
      gameLogError = 'Shared activity is unavailable.';
      renderGameLog();
      return;
    }
    gameLogError = '';
    let rows = (data || []).map(row => ({ ...row, time: Date.parse(row.created_at) }));
    if (!ascending) rows = rows.reverse();
    if (older || !latest) gameLogHasOlder = rows.length === gameLogPageSize;
    gameLogEntries = older ? [...rows, ...gameLogEntries] : [...gameLogEntries, ...rows];
    if (ascending && visible && !inLobby && !$('game').hidden) animateOpponentLogActions(rows);
    if (!older && latest && !followGameLog) unreadGameLogCount += rows.length;
    if (!older && (!ascending || rows.length < gameLogPageSize)) gameLogRevision = revision;
    renderGameLog(false, older);
    if (gameLogRevision !== room.revision) void loadGameLog();
  }
  $('game-log-older').addEventListener('click', () => void loadGameLog(true));
  function eventNotice(text, temporary = false, error = false, dismissible = false, duration = 4500) {
    logPrivateNotice(text);
    if (eventNoticeTimer) clearTimeout(eventNoticeTimer);
    const notice = $('game-event-notice');
    $('game-event-notice-text').textContent = text || '';
    notice.hidden = !text;
    notice.classList.toggle('error', Boolean(text && error));
    notice.classList.toggle('is-message', Boolean(text && dismissible));
    $('game-event-notice-close').hidden = !text || !dismissible;
    if (text && temporary) eventNoticeTimer = setTimeout(() => { notice.hidden = true; eventNoticeTimer = null; }, duration);
  }
  function blockedPlayNotice(reason) {
    eventNotice(reason, true, false, false, 2000);
  }
  $('game-event-notice-close').addEventListener('click', () => eventNotice(''));
  function eventNeighbors(key) {
    const [x, y] = key.split(',').map(Number);
    return [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]
      .filter(([column, row]) => column >= 0 && column <= 4 && row >= 0 && row <= 3)
      .map(([column, row]) => `${column},${row}`);
  }
  function legalEventTarget(kind, node, key) {
    const board = room?.board || {};
    if (extendedKinds.has(kind)) return Boolean(extendedEventStep(kind, [], { board })?.options
      .some(option => option.value.type === 'cell' && option.value.key === key));
    if (kind === 'recall_event') return false;
    if (kind === 'greenway') return !node?.terrain && (eventNeighbors(key).some(k => board[k]?.terrain)
      || !Object.values(board).some(entry => entry?.terrain));
    if (kind === 'seed_caravan') return !node?.terrain && eventNeighbors(key).some(k => board[k]?.terrain === 'Verdant');
    if (kind === 'tangle') return eventNeighbors(key).filter(k => board[k]?.terrain === 'Verdant').length >= 2;
    if (kind === 'accord') return node?.terrain === 'Symbiosis';
    if (kind === 'reconfigure') return Boolean(node?.terrain && !node.entity);
    if (kind === 'fertile_rain') return node?.terrain === 'Verdant' && Boolean(node.entity);
    if (kind === 'fertilize_two' || kind === 'fertilize_draw') return !node?.terrain;
    if (kind === 'fertilize_existing_draw') return !node?.terrain && Boolean(node?.fertilize);
    if (!node?.terrain) return false;
    if (kind === 'protect' || kind === 'restore_draw' || kind === 'dissolve_terrain') return true;
    if (kind === 'dissolve_entity') return Boolean(node.entity);
    if (kind === 'unprotect_entity') return Boolean(node.entity && node.protected);
    if (kind === 'protect_radiance_draw' || kind === 'restore_radiance_draw') return node.terrain === 'Radiance' && Number(node.lumens || 0) >= 1;
    return node.terrain === 'Radiance';
  }
  const terrainTypes = ['Symbiosis', 'Flow', 'Verdant', 'Radiance'];
  function canCreateTerrainAt(key) {
    if (!key) return false;
    const [x, y] = key.split(',').map(Number);
    return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x <= 4 && y >= 0 && y <= 3;
  }
  function entityShapeTerrain(card) {
    const effect = String(card?.effect || '').replace(/\s+/g, ' ').toLowerCase();
    const override = effect.match(/when shaped: create (symbiosis|flow|verdant|radiance) terrain instead\b/)
      || effect.match(/shape this entity (?:into|to create) (symbiosis|flow|verdant|radiance) terrain instead\b/);
    return override ? terrainTypes.find(type => type.toLowerCase() === override[1]) : card?.terrain;
  }
  function dreamwellCreatesTerrain(card) {
    const effect = String(card?.effect || '').replace(/\s+/g, ' ').trim().toLowerCase();
    return card?.title === 'Dreamwell Courtyard' && ['Verdant', 'Evergreen'].includes(card.terrain)
      && effect === 'create verdant terrain, then put this entity there.';
  }
  function workshopCreatesTerrain(card) {
    return card?.title === 'Lumen Workshop District' && card.terrain === 'Radiance'
      && /^create radiance terrain, then place this entity there\.$/i.test(String(card.effect || '').replace(/\s+/g, ' ').trim());
  }
  function legalEntityAction(card, node, key) {
    if (room?.turn_player_id !== userId || room?.turn_phase !== 'main' || room?.main_played_entity
      || (!terrainTypes.includes(card?.terrain) && !dreamwellCreatesTerrain(card))) return null;
    if (!node?.terrain) return node?.entity || !canCreateTerrainAt(key)
      ? null : dreamwellCreatesTerrain(card) || workshopCreatesTerrain(card) ? 'create_place'
        : (terrainTypes.includes(entityShapeTerrain(card)) ? 'shape' : null);
    if (dreamwellCreatesTerrain(card) || workshopCreatesTerrain(card)) return null;
    if (node.entity) return null;
    if (!terrainTypes.includes(node.terrain)) return null;
    const effect = String(card.effect || '').replace(/\s+/g, ' ').toLowerCase();
    if (effect.includes('this entity can be evoked only on a non-flow terrain')) {
      return node.terrain === 'Flow' ? null : 'place';
    }
    const prefix = '(?:this entity (?:can|may) be placed|place this entity) on ';
    const target = String(node.terrain).toLowerCase();
    const allowed = node.terrain === card.terrain
      || new RegExp(`${prefix}any terrain\\b`).test(effect)
      || new RegExp(`${prefix}(?:a )?${target} terrain\\b`).test(effect)
      || new RegExp(`${prefix}non-${String(card.terrain).toLowerCase()} terrain\\b`).test(effect);
    return allowed ? 'place' : null;
  }
  function beginningEffectKind(card) {
    const effect = String(card?.effect || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (['March of Mashrooms', 'March of Marshrooms', 'Marsh of Marshrooms'].includes(card?.title)
      && /^at the (?:beginning|begining|beginnig) of your turn, you may move this entity to (?:an )?adjacent empty symbiosis terrain\. then,? entangle (?:the )?terrain under this entity\.?$/.test(effect)) return 'march_of_marshrooms';
    if (card?.title === 'Efficient Grid'
      && /^at the (?:beginning|begining|beginnig) of (?:the )?radiant patron(?:'s)? turn, luminate 1\b/.test(effect)) return 'efficient_grid';
    if (card?.title === 'Solar Converter'
      && /^at the (?:beginning|begining|beginnig) of your turn, you (?:can|may) remove 2 lumen counters? from terrain this entity is placed on,? to put a shield or crisis counter on any adjacent terrain\.?$/.test(effect)) return 'solar_converter';
    if (card?.title === 'Orchard Warden'
      && ['at the beginning of your turn fertilize 1 on adjacent node.',
        "at the beginning of verdant patron's turn, fertilize 1 on any adjacent empty node."].includes(effect)) return 'orchard_warden';
    if (card?.title === 'Expansive Ivy'
      && ['at the beginning of your every turn fertilize an adjacent node with no terrain. then if there are 4 or more adjacent verdant terrains, draw a card.',
        "at the beginning of the verdant patron's turn, fertilize 1 on any adjacent node. then if there are 4 or more adjacent verdant terrains, draw 1 card."].includes(effect)) return 'expansive_ivy';
    if (card?.title === 'Bramble Briar'
      && effect === "at the beginning of the verdant patron's turn, dissolve two empty verdant terrains to recall any event from the archive to your hand. if you can't, dissolve this entity.") return 'bramble_briar';
    if (card?.title === 'Garden of Shared Roots'
      && effect === 'when placed, create any terrain on adjacent empty node. at the beginning of your turn, draw 1 card if terrain under this entity is entangled.') return 'garden_shared_roots';
    if (card?.title === 'Mirrorpool Shrine'
      && effect === 'at the beginning of your turn, draw 1 card for each adjacent flow entity on a flow terrain.') return 'mirrorpool_shrine';
    return null;
  }
  function beginningEffectAvailable(card) {
    const effect = String(card?.effect || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const patron = room.turn_player_id === room.host_id ? room.host_patron_name : room.guest_patron_name;
    if (beginningEffectKind(card) === 'efficient_grid') return getPatronFactionIcon(patron).faction === 'Brightworks';
    if (!/^at the beginning of (?:the )?verdant patron's turn/.test(effect)) return true;
    return getPatronFactionIcon(patron).faction === 'Verdant';
  }
  function beginningEffectOptional(card) {
    return beginningEffectKind(card) === 'solar_converter' || /\byou may\b/i.test(String(card?.effect || ''));
  }
  function beginningEffects() {
    if (room?.status !== 'active' || room.turn_phase !== 'beginning'
      || room.beginning_effects_resolved_turn === room.turn_number) return [];
    return Object.entries(room.board || {}).filter(([key, node]) => /^[0-4],[0-3]$/.test(key)
      && node?.entity?.owner_id === room.turn_player_id && beginningEffectKind(node.entity)
      && beginningEffectAvailable(node.entity))
      .map(([source, node]) => ({ source, kind: beginningEffectKind(node.entity), card: { ...resolveGameCard(node.entity),
        title: node.entity.title, effect: node.entity.effect }, optional: beginningEffectOptional(node.entity) }))
      .sort((a, b) => Number(a.source.split(',')[1]) - Number(b.source.split(',')[1])
        || Number(a.source.split(',')[0]) - Number(b.source.split(',')[0]));
  }
  function beginningPlan() {
    const terrain = new Map(Object.entries(room?.board || {}).filter(([, node]) => node?.terrain)
      .map(([key, node]) => [key, node.terrain]));
    const fertilized = new Set(Object.entries(room?.board || {}).filter(([, node]) => node?.fertilize).map(([key]) => key));
    const occupied = new Set(Object.entries(room?.board || {}).filter(([, node]) => node?.entity).map(([key]) => key));
    const protectedNodes = new Set(Object.entries(room?.board || {}).filter(([, node]) => node?.protected).map(([key]) => key));
    const crisisNodes = new Set(Object.entries(room?.board || {}).filter(([, node]) => node?.crisis).map(([key]) => key));
    const links = new Map(Object.entries(room?.board || {}).map(([key, node]) => [key, new Set(node?.entanglements || [])]));
    const lumens = new Map(Object.entries(room?.board || {}).map(([key, node]) => [key, Number(node?.lumens || 0)]));
    const archiveEvents = (gameState?.archive || []).filter(card => card?.card_type === 'Event' && card.id).slice();
    const effectsBySource = new Map(beginningEffects().map(effect => [effect.source, effect]));
    const plan = new Map();
    for (const source of beginningOrder) {
      if (beginningSkipped.has(source)) { plan.set(source, { options: [], target: null, valid: true }); continue; }
      const kind = effectsBySource.get(source)?.kind;
      if (['march_of_marshrooms', 'efficient_grid', 'solar_converter'].includes(kind)) {
        const neighbors = eventNeighbors(source);
        const target = beginningTargets.get(source);
        const choice = beginningChoices.get(source);
        let options = [];
        if (kind === 'march_of_marshrooms') {
          options = neighbors.filter(key => terrain.get(key) === 'Symbiosis' && !occupied.has(key));
        } else if (kind === 'efficient_grid') {
          options = [...terrain].filter(([key, type]) => /^[0-4],[0-3]$/.test(key) && type === 'Radiance').map(([key]) => key);
        } else if ((lumens.get(source) || 0) >= 2) {
          options = neighbors.filter(key => terrain.has(key));
        }
        const targetValid = options.includes(target);
        const choices = !targetValid ? [] : kind === 'solar_converter'
          ? [{ value: 'protect', label: 'Protect' }, { value: 'crisis', label: 'Affect with Crisis' }]
          : kind === 'march_of_marshrooms' && !links.get(target)?.size
            ? eventNeighbors(target).filter(key => ['Flow', 'Radiance', 'Verdant'].includes(terrain.get(key)))
              .map(key => ({ value: key, label: `${terrain.get(key)} · Node ${key}` }))
            : [];
        const valid = targetValid ? choices.length === 0 || choices.some(option => option.value === choice) : !target && options.length === 0;
        plan.set(source, { options, target, choices, choice, valid });
        if (targetValid && valid) {
          if (kind === 'march_of_marshrooms') {
            occupied.delete(source); occupied.add(target);
            if (choices.length) {
              if (!links.has(target)) links.set(target, new Set());
              if (!links.has(choice)) links.set(choice, new Set());
              links.get(target).add(choice);
              links.get(choice).add(target);
            }
          } else if (kind === 'efficient_grid') {
            const count = lumens.get(target) || 0;
            lumens.set(target, Math.min(5, count + 1));
            if (count >= 5 && !protectedNodes.delete(target)) crisisNodes.add(target);
          } else {
            lumens.set(source, lumens.get(source) - 2);
            if (choice === 'crisis') {
              if (!protectedNodes.delete(target)) crisisNodes.add(target);
            } else if (!crisisNodes.delete(target)) {
              protectedNodes.add(target);
            }
          }
        }
        continue;
      }
      if (kind === 'garden_shared_roots') {
        plan.set(source, { options: [], target: null, valid: true, draws: (links.get(source)?.size || 0) > 0 });
        continue;
      }
      if (kind === 'mirrorpool_shrine') {
        const draws = eventNeighbors(source).filter(key => terrain.get(key) === 'Flow'
          && occupied.has(key) && room.board?.[key]?.entity?.terrain === 'Flow').length;
        plan.set(source, { options: [], target: null, valid: true, draws });
        continue;
      }
      if (kind === 'bramble_briar') {
        if (room.turn_player_id === userId && gameState?.room_id !== room.id) {
          plan.set(source, { options: [], target: null, valid: false, loading: true });
          continue;
        }
        if (room.turn_player_id !== userId) {
          const targets = beginningBrambleTargets.get(source) || [];
          for (const key of targets) {
            terrain.delete(key); fertilized.delete(key); links.delete(key);
            for (const linked of links.values()) linked.delete(key);
          }
          plan.set(source, { options: [], target: null, valid: true, targets, eventOptions: [] });
          continue;
        }
        const terrainOptions = [...terrain].filter(([key, type]) => /^[0-4],[0-3]$/.test(key)
          && type === 'Verdant' && !occupied.has(key) && !protectedNodes.has(key)).map(([key]) => key);
        const eventOptions = [...new Map(archiveEvents.map(card => [String(card.id), card])).values()];
        const fallback = terrainOptions.length < 2 || eventOptions.length === 0;
        const targets = beginningBrambleTargets.get(source) || [];
        const eventId = beginningBrambleEvents.get(source) || '';
        const valid = fallback || (targets.length === 2 && targets[0] !== targets[1]
          && targets.every(key => terrainOptions.includes(key)) && eventOptions.some(card => String(card.id) === eventId));
        plan.set(source, { options: [], target: null, valid, terrainOptions, eventOptions, fallback, targets, eventId });
        if (fallback) {
          if (protectedNodes.has(source)) protectedNodes.delete(source);
          else occupied.delete(source);
        } else if (valid) {
          for (const key of targets) {
            terrain.delete(key); fertilized.delete(key); links.delete(key);
            for (const linked of links.values()) linked.delete(key);
          }
          archiveEvents.splice(archiveEvents.findIndex(card => String(card.id) === eventId), 1);
        }
        continue;
      }
      const [x, y] = source.split(',').map(Number);
      const options = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]
        .filter(([column, row]) => column >= 0 && column <= 4 && row >= 0 && row <= 3)
        .map(([column, row]) => `${column},${row}`).filter(key => !terrain.has(key));
      const target = beginningTargets.get(source);
      const valid = target ? options.includes(target) : options.length === 0;
      plan.set(source, { options, target, valid });
      if (target && valid) {
        if (fertilized.has(target)) { fertilized.delete(target); terrain.set(target, 'Verdant'); }
        else fertilized.add(target);
      }
    }
    return plan;
  }
  function syncEventTargets() {
    const beginningOptions = beginningTargetSource ? beginningPlan().get(beginningTargetSource)?.options : null;
    for (const cell of $('game-board').children) {
      const node = room?.board?.[cell.dataset.key];
      const legal = Boolean(cell.dataset.key && (
        (pendingEvent && (pendingEvent.extended
          ? pendingEvent.step.options.some(option => option.value.type === 'cell' && option.value.key === cell.dataset.key)
          : pendingEvent.nextKeys ? pendingEvent.nextKeys.includes(cell.dataset.key)
            : legalEventTarget(pendingEvent.rule[1], node, cell.dataset.key)))
        || (pendingEntity && legalEntityAction(pendingEntity.card, node, cell.dataset.key))
        || beginningOptions?.includes(cell.dataset.key)));
      cell.classList.toggle('is-event-target', legal);
      const entityInteraction = legal && node?.entity;
      cell.classList.toggle('is-entity-target', Boolean(entityInteraction));
      if (legal) { cell.tabIndex = 0; cell.setAttribute('role', 'button'); }
      else { cell.removeAttribute('tabindex'); cell.removeAttribute('role'); }
    }
  }
  function requiredDiscards() {
    return room?.status === 'active' && room.turn_player_id === userId && room.turn_phase === 'end'
      ? Math.max(0, (gameState?.hand?.length || 0) - 7) : 0;
  }
  function syncDiscardBar() {
    const required = requiredDiscards();
    if (!required && !pendingFestival) discardSelections.clear();
    const bar = $('game-discard-bar');
    bar.hidden = required === 0 && !pendingFestival;
    let prompt = '';
    if (pendingFestival) {
      const { card, discardCount, drawn } = pendingFestival;
      const choiceNeeded = discardCount > 0;
      prompt = choiceNeeded
        ? `${card.title}: draw ${drawn.length}, then choose ${discardCount} to discard.`
        : `${card.title}: no card remains to discard.`;
      $('game-discard-text').textContent = choiceNeeded
        ? `${prompt} Selected ${discardSelections.size}/${discardCount}. Press Esc to cancel.`
        : prompt;
      if (choiceNeeded) prompt += ' Press Esc to cancel.';
      $('game-confirm-discard').textContent = choiceNeeded ? 'Discard and Resolve' : 'Resolve Event';
      $('game-confirm-discard').disabled = phaseBusy || discardSelections.size !== discardCount;
    } else if (required) {
      prompt = `Discard ${required} card${required === 1 ? '' : 's'} so 7 remain.`;
      $('game-discard-text').textContent = `${prompt} Selected ${discardSelections.size}/${required}.`;
      $('game-confirm-discard').textContent = 'Confirm Discard';
      $('game-confirm-discard').disabled = phaseBusy || discardSelections.size !== required;
    }
    logHandPrompt(bar, prompt);
    for (const [index, item] of Array.from($('game-hand').children).entries()) {
      item.querySelector('.play-hand-card')?.classList.toggle('is-discard-selected', (required > 0 || pendingFestival) && discardSelections.has(index));
    }
  }
  function automaticPhaseKey() {
    if (!visible || inLobby || $('game').hidden || room?.status !== 'active'
      || room.turn_player_id !== userId || !gameState || phaseBusy || pendingFestival) return '';
    const phase = room.turn_phase;
    if ((phase === 'beginning' && beginningEffects().length === 0)
      || (phase === 'end' && requiredDiscards() === 0)) return `${epoch}:${room.id}:${room.turn_number}:${phase}`;
    return '';
  }
  function syncAutomaticPhase() {
    const key = automaticPhaseKey();
    if (key === phaseAdvanceKey) return;
    clearTimeout(phaseAdvanceTimer);
    phaseAdvanceKey = key;
    phaseAdvanceTimer = key ? setTimeout(() => {
      phaseAdvanceTimer = null;
      phaseAdvanceKey = '';
      if (automaticPhaseKey() === key) void advanceTurnPhase(false, true);
    }, Math.max(500, phaseAdvanceRetryAt - Date.now())) : null;
  }
  function renderTurnPhase() {
    const phase = room?.turn_phase;
    const phaseIndex = phaseOrder.indexOf(phase);
    const own = Boolean(room?.turn_player_id && room.turn_player_id === userId);
    const activeTurn = room?.status === 'active' && phaseIndex >= 0 && room.turn_player_id;
    const game = $('game');
    game.dataset.canPlayCards = String(Boolean(activeTurn && own && phase === 'main' && !phaseBusy && !pendingFestival));
    const previousAura = game.dataset.turnAura;
    const turnAura = activeTurn ? (own ? 'own' : 'opponent') : '';
    game.dataset.turnAura = turnAura;
    if (visible && !inLobby && !game.hidden && previousAura && turnAura && previousAura !== turnAura) {
      playTableSound(changeTurnSound);
    }
    const phases = $('game-phases');
    phases.classList.toggle('is-your-turn', own);
    phases.classList.toggle('is-opponent-turn', Boolean(room?.turn_player_id) && !own);
    $('game-turn-owner').textContent = !room?.turn_player_id ? 'Turn setup pending' : own ? 'Your turn' : "Opponent's turn";
    for (const step of root.querySelectorAll('.play-game-phase-list li')) {
      const active = Number(step.dataset.phase) === phaseIndex;
      const skipped = room?.turn_number === 1 && phaseIndex >= 2 && Number(step.dataset.phase) < 2;
      step.classList.toggle('is-current', active);
      step.classList.toggle('is-skipped', skipped);
      step.title = skipped ? 'Skipped on the first turn' : '';
      if (active) step.setAttribute('aria-current', 'step');
      else step.removeAttribute('aria-current');
    }
    const next = $('game-next-phase');
    const hasBeginningEffects = phase === 'beginning' && beginningEffects().length > 0;
    next.hidden = !own || (phase === 'main' ? !room?.main_played_card : phase !== 'beginning');
    next.textContent = hasBeginningEffects ? 'Resolve Effects' : 'Next Phase';
    next.disabled = !activeTurn || !own || phaseBusy || Boolean(pendingFestival)
      || (phase === 'beginning' && !gameState);
    syncDiscardBar();
    const extra = $('game-extra-draw');
    extra.hidden = !own || phase !== 'main' || Boolean(room?.main_played_card);
    extra.disabled = phaseBusy || pendingFestival || !Array.isArray(gameState?.horizon) || gameState.horizon.length === 0;
    next.parentElement.hidden = phases.hidden;
    syncAutomaticPhase();
  }
  function openingDealPending() {
    if (room?.status !== 'active') return false;
    if (room.turn_phase === 'roll') return true;
    const key = `${room.id}:${room.activated_at || ''}`;
    return key !== openingDealDoneKey && (room.turn_phase === 'choose_first'
      || (openingDealPendingKey === key && ['mulligan_first', 'mulligan_second'].includes(room.turn_phase)));
  }
  async function dealOpeningHand(key) {
    openingDealRunningKey = key;
    const expected = epoch;
    try {
      await animateCardsToHand(gameState.hand.slice(0, 5), [], 115, massiveDrawSound);
    } finally {
      if (expected === epoch && openingMatchKey === key) {
        openingDealRunningKey = '';
        openingDealDoneKey = key;
        renderGameHand();
        clearDrawFlight();
        renderOpeningRoll();
      }
    }
  }
  function openingDiceWinner() {
    return room?.opening_roll_winner_id || (room?.opening_host_roll != null && room?.opening_guest_roll != null
      && room.opening_host_roll !== room.opening_guest_roll
      ? room.opening_host_roll > room.opening_guest_roll ? room.host_id : room.guest_id : null);
  }
  function openingDiceResultText(winnerId) {
    return winnerId === userId ? 'You decide who plays first' : 'Opponent decides who plays first';
  }
  function renderOpeningRoll() {
    const overlay = $('opening-roll');
    const phases = $('game-phases');
    const phaseStack = phases.parentElement;
    const key = room?.status === 'active' ? `${room.id}:${room.activated_at || ''}` : '';
    if (key !== openingMatchKey) {
      openingMatchKey = key;
      openingRollBusy = false;
      openingChoiceBusy = false;
      openingRollError = '';
      openingAnimatedValues.host = null;
      openingAnimatedValues.guest = null;
      clearTimeout(openingRevealTimer);
      clearInterval(openingShuffleTimer);
      openingShuffleTimer = null;
      openingRevealTimer = null;
    }
    const rolling = room?.status === 'active' && room.turn_phase === 'roll' && room.opening_roll_round > 0;
    const choosing = room?.status === 'active' && room.turn_phase === 'choose_first';
    if (rolling || choosing) openingDealPendingKey = key;
    const winnerId = openingDiceWinner();
    const revealStorageKey = `helianthe-opening-result:${userId}:${key}`;
    let revealSeen = false;
    try { revealSeen = sessionStorage.getItem(revealStorageKey) === 'shown'; } catch {}
    const revealing = !rolling && Boolean(winnerId) && room.turn_number <= 1
      && (choosing || room.turn_phase === 'main') && openingRevealDoneKey !== key && !revealSeen;
    overlay.hidden = !rolling && !revealing;
    const gameActions = $('game').querySelector('.play-game-actions');
    const gameFooter = $('game').querySelector('.play-game-opponent-footer');
    if (!overlay.hidden && gameActions.parentElement !== overlay) {
      gameActions.querySelector('details').open = false;
      overlay.append(gameActions);
    } else if (overlay.hidden && gameActions.parentElement === overlay) {
      gameActions.querySelector('details').open = false;
      gameFooter.append(gameActions);
      requestAnimationFrame(syncZoneCardSize);
    }
    const mulligan = room?.status === 'active' && ['mulligan_first', 'mulligan_second'].includes(room.turn_phase);
    phases.hidden = rolling || revealing || choosing || mulligan || mulliganBusy;
    phaseStack.hidden = !overlay.hidden;
    renderTurnPhase();
    const choice = $('opening-choice');
    choice.hidden = !choosing || revealing;
    renderMulligan();
    if (visible && !inLobby && !rolling && !revealing && !openingRollBusy && openingDealPending()
      && openingDealRunningKey !== key && gameState?.hand?.length) {
      void dealOpeningHand(key).catch(() => {});
    }
    if (choosing) {
      const ownWin = winnerId === userId;
      $('opening-choice-message').textContent = ownWin
        ? 'You won the roll. Review your hand, then choose who starts.'
        : 'Opponent won the roll and is choosing who starts.';
      $('opening-choice-actions').hidden = !ownWin;
      $('opening-choose-self').disabled = openingChoiceBusy || !gameState || openingDealPending();
      $('opening-choose-opponent').disabled = openingChoiceBusy || !gameState || openingDealPending();
    }
    logHandPrompt(choice, $('opening-choice-message').textContent);
    if (!overlay.hidden && revealing && !openingRevealTimer && !openingRollBusy) {
      openingRevealTimer = setTimeout(() => {
        openingRevealTimer = null;
        openingRevealDoneKey = key;
        try { sessionStorage.setItem(revealStorageKey, 'shown'); } catch {}
        renderOpeningRoll();
      }, 3000);
    }
    if (overlay.hidden) {
      if (!phases.hidden && key && openingPanelAnimatedKey !== key && room?.turn_number === 1) {
        openingPanelAnimatedKey = key;
        phaseStack.classList.add('is-appearing');
        setTimeout(() => phaseStack.classList.remove('is-appearing'), 650);
      }
      return;
    }
    const tie = room.opening_last_tie;
    const reroll = rolling && tie?.round === room.opening_roll_round - 1;
    const showTie = reroll && !openingRollBusy && room.opening_host_roll == null && room.opening_guest_roll == null;
    const hostRoll = showTie ? tie.host : room.opening_host_roll;
    const guestRoll = showTie ? tie.guest : room.opening_guest_roll;
    const hostDice = showTie ? tie.host_dice : room.opening_host_dice;
    const guestDice = showTie ? tie.guest_dice : room.opening_guest_dice;
    const hostName = getProfiles().find(person => person.id === room.host_id)?.display_name || 'Host';
    const guestName = getProfiles().find(person => person.id === room.guest_id)?.display_name || 'Guest';
    $('opening-host-name').textContent = `${hostName}${room.host_id === userId ? ' · You' : ''}`;
    $('opening-guest-name').textContent = `${guestName}${room.guest_id === userId ? ' · You' : ''}`;
    for (const [seat, savedDice, total, name] of [['host', hostDice, hostRoll, hostName], ['guest', guestDice, guestRoll, guestName]]) {
      const animating = openingRollBusy && room[`${seat}_id`] === userId;
      const dice = animating ? openingVisualDice : savedDice;
      const visible = Array.isArray(dice) && dice.length === 2;
      const pair = $(`opening-${seat}-pair`);
      pair.hidden = !visible;
      const score = $(`opening-${seat}-total`);
      score.hidden = !visible || animating || total == null;
      if (!score.hidden) score.textContent = `Total: ${total}`;
      const signature = Array.isArray(savedDice) ? savedDice.join(',') : null;
      for (let index = 0; index < 2; index++) {
        const die = $(`opening-${seat}-die-${index + 1}`);
        die.dataset.value = String(visible ? dice[index] : 0);
        die.setAttribute('aria-label', visible ? `${name} rolled ${dice[index]} on die ${index + 1}` : `${name} has not rolled die ${index + 1}`);
        die.classList.toggle('is-rolling', animating);
        if (animating || !visible) die.classList.remove('is-landing');
        if (visible && !animating && signature !== openingAnimatedValues[seat]) {
          die.classList.remove('is-landing');
          void die.offsetWidth;
          die.classList.add('is-landing');
        }
      }
      if (!animating) openingAnimatedValues[seat] = signature;
    }
    $('opening-dice').hidden = $('opening-host-pair').hidden && $('opening-guest-pair').hidden;
    const ownSeat = room.host_id === userId ? 'host' : 'guest';
    const ownRolled = room[`opening_${ownSeat}_roll`] != null;
    const button = $('opening-roll-button');
    button.hidden = !rolling || ownRolled;
    button.disabled = openingRollBusy;
    button.textContent = reroll ? 'Roll Dices Again' : 'Roll Dices';
    $('opening-roll-status').classList.toggle('is-result', Boolean(revealing));
    $('opening-roll-status').textContent = openingRollBusy ? 'Rolling dices…' : revealing
      ? openingDiceResultText(winnerId)
      : '';
    $('opening-roll-error').hidden = !openingRollError;
    $('opening-roll-error').textContent = openingRollError;
  }
  async function rollOpeningDie() {
    if (openingRollBusy || !room || room.turn_phase !== 'roll') return;
    const seat = room.host_id === userId ? 'host' : 'guest';
    if (room[`opening_${seat}_roll`] != null) return;
    void playRollDiceSound();
    const expected = epoch, roomId = room.id, round = room.opening_roll_round;
    openingRollBusy = true;
    openingRollError = '';
    openingVisualDice = [Math.ceil(Math.random() * 6), Math.ceil(Math.random() * 6)];
    openingShuffleTimer = setInterval(() => {
      openingVisualDice = [Math.ceil(Math.random() * 6), Math.ceil(Math.random() * 6)];
      for (let index = 0; index < 2; index++) $(`opening-${seat}-die-${index + 1}`).dataset.value = String(openingVisualDice[index]);
    }, 90);
    renderOpeningRoll();
    try {
      await Promise.all([
        rpc('play_roll_dice', { p_room_id: roomId, p_expected_round: round }),
        new Promise(resolve => setTimeout(resolve, 1350)),
      ]);
      if (expected === epoch && room?.id === roomId) await refreshRoom();
    } catch (error) {
      if (expected === epoch && room?.id === roomId) {
        openingRollError = friendly(error);
        logPrivateNotice(openingRollError);
        await refreshRoom().catch(() => {});
      }
    } finally {
      clearInterval(openingShuffleTimer);
      openingShuffleTimer = null;
      openingRollBusy = false;
      if (expected === epoch && room?.id === roomId) renderOpeningRoll();
    }
  }
  $('opening-roll-button').addEventListener('click', () => void rollOpeningDie());
  async function chooseFirstPlayer(firstPlayerId) {
    if (openingChoiceBusy || !gameState || room?.status !== 'active' || room.turn_phase !== 'choose_first'
      || room.opening_roll_winner_id !== userId) return;
    const expected = epoch, roomId = room.id;
    openingChoiceBusy = true;
    renderOpeningRoll();
    try {
      await rpc('play_choose_first_player', { p_room_id: roomId, p_first_player_id: firstPlayerId });
      if (expected === epoch && room?.id === roomId) await refreshRoom();
    } catch (error) {
      if (expected === epoch && room?.id === roomId) message(friendly(error), true);
    } finally {
      openingChoiceBusy = false;
      if (expected === epoch && room?.id === roomId) renderOpeningRoll();
    }
  }
  $('opening-choose-self').addEventListener('click', () => void chooseFirstPlayer(userId));
  $('opening-choose-opponent').addEventListener('click', () => void chooseFirstPlayer(room?.host_id === userId ? room?.guest_id : room?.host_id));
  function renderMulligan() {
    const active = room?.status === 'active' && ['mulligan_first', 'mulligan_second'].includes(room.turn_phase);
    const stepKey = active ? `${room.id}:${room.activated_at}:${room.turn_phase}` : '';
    if (stepKey !== mulliganStepKey && !mulliganBusy) {
      mulliganStepKey = stepKey;
      mulliganOrder.length = 0;
      mulliganBusy = false;
    }
    const panel = $('opening-mulligan');
    panel.hidden = !active;
    for (const [index, item] of Array.from($('game-hand').children).entries()) {
      const position = active ? mulliganOrder.indexOf(index) + 1 : 0;
      const button = item.querySelector('.play-hand-card');
      button?.classList.toggle('is-mulligan-selected', position > 0);
      if (button) button.setAttribute('aria-pressed', String(position > 0));
      const badge = item.querySelector('.play-mulligan-order');
      if (badge) { badge.hidden = !position; badge.textContent = String(position); }
    }
    if (!active) {
      logHandPrompt(panel, '');
      return;
    }
    const actorId = room.turn_phase === 'mulligan_first' ? room.turn_player_id
      : room.turn_player_id === room.host_id ? room.guest_id : room.host_id;
    const own = actorId === userId;
    const message = own
      ? room.turn_phase === 'mulligan_first' ? 'You start. Choose your mulligan.' : 'Your mulligan decision.'
      : 'Your opponent is making their mulligan decision.';
    $('opening-mulligan-message').textContent = message;
    const instructions = $('opening-mulligan-instructions');
    instructions.hidden = !own;
    logHandPrompt(panel, own ? `${message} ${instructions.textContent}` : message);
    $('opening-mulligan-actions').hidden = !own || !gameState || openingDealPending();
    $('opening-mulligan-keep').hidden = mulliganOrder.length > 0;
    $('opening-mulligan-confirm').hidden = mulliganOrder.length === 0;
    $('opening-mulligan-confirm').textContent = `Replace ${mulliganOrder.length} ${mulliganOrder.length === 1 ? 'card' : 'cards'}`;
    $('opening-mulligan-keep').disabled = mulliganBusy;
    $('opening-mulligan-confirm').disabled = mulliganBusy;
  }
  function clearMulliganFlights() {
    for (const animation of mulliganAnimations) animation.cancel();
    mulliganAnimations.clear();
    for (const flight of mulliganFlights) flight.remove();
    mulliganFlights.clear();
    for (const card of mulliganHiddenCards) card.style.visibility = '';
    mulliganHiddenCards.clear();
    arrivingCardCanvases.clear();
  }
  function mulliganFlight(bounds, front) {
    const flight = document.createElement('div');
    flight.className = 'play-draw-flight play-mulligan-flight';
    flight.setAttribute('aria-hidden', 'true');
    Object.assign(flight.style, {
      left: `${bounds.left}px`, top: `${bounds.top}px`,
      width: `${bounds.width}px`, height: `${bounds.height}px`,
    });
    const inner = document.createElement('div'); inner.className = 'play-draw-flight-inner';
    const back = document.createElement('div'); back.className = 'play-draw-flight-face play-draw-flight-back';
    const face = document.createElement('div'); face.className = 'play-draw-flight-face play-draw-flight-front';
    face.append(front); inner.append(back, face); flight.append(inner);
    document.body.append(flight);
    mulliganFlights.add(flight);
    return { flight, inner };
  }
  function animateMulliganBottom(indices) {
    const destination = $('game-self-horizon').getBoundingClientRect();
    if ($('game').hidden || !destination.width || !destination.height) return Promise.resolve();
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const flights = indices.map((index, order) => {
      const source = $('game-hand').children[index]?.querySelector('.play-hand-card');
      const bounds = source?.getBoundingClientRect();
      if (!bounds?.width || !bounds.height) return null;
      const front = source.cloneNode(true);
      front.classList.remove('is-selected', 'is-mulligan-selected');
      front.removeAttribute('aria-pressed');
      const sourceCanvas = source.querySelector('canvas');
      const flightCanvas = front.querySelector('canvas');
      if (sourceCanvas && flightCanvas && !sourceCanvas.hidden && sourceCanvas.width) {
        flightCanvas.width = sourceCanvas.width;
        flightCanvas.height = sourceCanvas.height;
        flightCanvas.getContext('2d').drawImage(sourceCanvas, 0, 0);
      }
      const { flight, inner } = mulliganFlight(bounds, front);
      source.style.visibility = 'hidden';
      mulliganHiddenCards.add(source);
      const dx = destination.left + destination.width / 2 - bounds.left - bounds.width / 2;
      const dy = destination.top + destination.height / 2 - bounds.top - bounds.height / 2;
      const scale = Math.min(destination.width / bounds.width, destination.height / bounds.height);
      const timing = { duration: reduced ? 100 : mulliganFlightDuration,
        delay: reduced ? 0 : order * mulliganFlightStagger,
        easing: 'cubic-bezier(.22,.7,.18,1)', fill: 'forwards' };
      const motion = flight.animate([
        { transform: 'translate(0, 0) rotate(0deg) scale(1)', opacity: 1 },
        { transform: `translate(${dx * .62}px, ${dy * .62}px) rotate(-8deg) scale(${1 + (scale - 1) * .62})`, opacity: 1, offset: .65 },
        { transform: `translate(${dx}px, ${dy}px) rotate(0deg) scale(${scale})`, opacity: .3 },
      ], timing);
      const flip = inner.animate([
        { transform: 'rotateY(180deg)' },
        { transform: 'rotateY(180deg)', offset: .3 },
        { transform: 'rotateY(0deg)', offset: .82 },
        { transform: 'rotateY(0deg)' },
      ], timing);
      mulliganAnimations.add(motion); mulliganAnimations.add(flip);
      return { flight, motion, flip };
    }).filter(Boolean);
    return Promise.allSettled(flights.flatMap(({ motion, flip }) => [motion.finished, flip.finished]))
      .then(() => { for (const { flight } of flights) { flight.remove(); mulliganFlights.delete(flight); } });
  }
  async function finishMulligan(indices) {
    if (mulliganBusy || !gameState || room?.status !== 'active'
      || !['mulligan_first', 'mulligan_second'].includes(room.turn_phase)) return;
    const actorId = room.turn_phase === 'mulligan_first' ? room.turn_player_id
      : room.turn_player_id === room.host_id ? room.guest_id : room.host_id;
    if (actorId !== userId || indices.length > gameState.horizon.length) return;
    const expected = epoch, roomId = room.id, phase = room.turn_phase;
    const drawnCards = gameState.horizon.slice(0, indices.length);
    mulliganBusy = true;
    renderMulligan();
    try {
      if (indices.length) await animateMulliganBottom(indices);
      if (expected !== epoch || room?.id !== roomId || room.status !== 'active') return;
      await rpc('play_finish_mulligan', { p_room_id: roomId, p_expected_phase: phase, p_hand_indices: indices });
      if (expected === epoch && room?.id === roomId) {
        if (indices.length) await animateCardsToHand(drawnCards, indices, mulliganFlightStagger);
        await refreshRoom();
        await loadGameState(true);
      }
    } catch (error) {
      if (expected === epoch && room?.id === roomId) {
        message(friendly(error), true);
        await refreshRoom().catch(() => {});
        await loadGameState(true).catch(() => {});
      }
    } finally {
      clearMulliganFlights();
      clearDrawFlight();
      mulliganBusy = false;
      if (expected === epoch && room?.id === roomId) renderOpeningRoll();
    }
  }
  $('opening-mulligan-keep').addEventListener('click', () => void finishMulligan([]));
  $('opening-mulligan-confirm').addEventListener('click', () => void finishMulligan([...mulliganOrder]));
  function moveBeginningEffect(source, skip, beforeSource = null) {
    const effect = beginningEffects().find(entry => entry.source === source);
    if (!effect || (skip && !effect.optional) || phaseBusy) return;
    beginningOrder.splice(beginningOrder.indexOf(source), 1);
    if (skip) { beginningSkipped.add(source); beginningTargets.delete(source); beginningChoices.delete(source); beginningBrambleTargets.delete(source); beginningBrambleEvents.delete(source); }
    else beginningSkipped.delete(source);
    if (beginningTargetSource === source) beginningTargetSource = null;
    const before = beforeSource && beginningSkipped.has(beforeSource) === skip
      ? beginningOrder.indexOf(beforeSource) : -1;
    if (before >= 0) beginningOrder.splice(before, 0, source);
    else if (skip) beginningOrder.push(source);
    else {
      const lastActive = beginningOrder.findLastIndex(item => !beginningSkipped.has(item));
      beginningOrder.splice(lastActive + 1, 0, source);
    }
    renderBeginningEffects(); syncEventTargets(); void saveBeginningPlan();
  }
  function clearBeginningConnector() {
    $('game-beginning-connector').removeAttribute('d');
  }
  function showBeginningConnector(row, source) {
    const card = $('game-board').querySelector(`[data-key="${CSS.escape(source)}"] .play-node-entity-card`);
    if (!card) return;
    const from = row.getBoundingClientRect();
    const to = card.getBoundingClientRect();
    let path;
    if (from.right <= to.left || to.right <= from.left) {
      const direction = from.right <= to.left ? 1 : -1;
      const start = direction === 1 ? from.right : from.left;
      const end = direction === 1 ? to.left : to.right;
      const middle = (start + end) / 2;
      const y1 = (from.top + from.bottom) / 2;
      const y2 = (to.top + to.bottom) / 2;
      path = `M ${start} ${y1} C ${middle} ${y1}, ${middle} ${y2}, ${end} ${y2}`;
    } else {
      const above = to.top < from.top;
      const start = above ? from.top : from.bottom;
      const end = above ? to.bottom : to.top;
      const middle = (start + end) / 2;
      const x1 = (from.left + from.right) / 2;
      const x2 = (to.left + to.right) / 2;
      path = `M ${x1} ${start} C ${x1} ${middle}, ${x2} ${middle}, ${x2} ${end}`;
    }
    $('game-beginning-connector').setAttribute('d', path);
  }
  $('game-beginning-effects').addEventListener('scroll', clearBeginningConnector, true);
  window.addEventListener('resize', clearBeginningConnector);
  function renderBeginningEffects() {
    clearBeginningConnector();
    const effects = beginningEffects();
    const panel = $('game-beginning-effects');
    panel.hidden = effects.length === 0;
    if (panel.hidden) { beginningTargetSource = null; return; }
    const own = room.turn_player_id === userId;
    panel.classList.toggle('is-read-only', !own);
    const saved = room.beginning_effects_plan;
    const shared = saved?.turn === room.turn_number && saved?.player_id === room.turn_player_id
      && Array.isArray(saved.effects) ? saved.effects : null;
    $('game-beginning-opponent-status').hidden = own;
    $('game-resolve-beginning').hidden = !own;
    const turnKey = `${room.id}:${room.turn_number}`;
    const sources = new Set(effects.map(effect => effect.source));
    if (turnKey !== beginningTurnKey) {
      beginningTurnKey = turnKey;
      beginningOrder = effects.map(effect => effect.source);
      beginningSkipped.clear();
      beginningTargets.clear();
      beginningChoices.clear();
      beginningBrambleTargets.clear();
      beginningBrambleEvents.clear();
      beginningTargetSource = null;
      if (shared) {
        beginningOrder = shared.map(entry => entry.source).filter(source => sources.has(source));
        for (const entry of shared) if (sources.has(entry.source)) {
          if (entry.target) beginningTargets.set(entry.source, entry.target);
          if (entry.choice) beginningChoices.set(entry.source, entry.choice);
          if (Array.isArray(entry.targets)) beginningBrambleTargets.set(entry.source, entry.targets);
          if (entry.event_id) beginningBrambleEvents.set(entry.source, entry.event_id);
        }
        for (const entry of shared) if (sources.has(entry.source) && entry.skip) beginningSkipped.add(entry.source);
      }
    } else {
      beginningOrder = beginningOrder.filter(source => sources.has(source));
      for (const effect of effects) if (!beginningOrder.includes(effect.source)) beginningOrder.push(effect.source);
      for (const source of beginningTargets.keys()) if (!sources.has(source)) beginningTargets.delete(source);
      for (const source of beginningChoices.keys()) if (!sources.has(source)) beginningChoices.delete(source);
      for (const source of beginningBrambleTargets.keys()) if (!sources.has(source)) beginningBrambleTargets.delete(source);
      for (const source of beginningBrambleEvents.keys()) if (!sources.has(source)) beginningBrambleEvents.delete(source);
      for (const source of beginningSkipped) if (!sources.has(source)) beginningSkipped.delete(source);
      if (beginningTargetSource && !sources.has(beginningTargetSource)) beginningTargetSource = null;
      if (!own && shared) {
        beginningOrder = shared.map(entry => entry.source).filter(source => sources.has(source));
        beginningTargets.clear();
        beginningChoices.clear();
        beginningBrambleTargets.clear();
        beginningBrambleEvents.clear();
        beginningSkipped.clear();
        for (const entry of shared) if (sources.has(entry.source)) {
          if (entry.target) beginningTargets.set(entry.source, entry.target);
          if (entry.choice) beginningChoices.set(entry.source, entry.choice);
          if (Array.isArray(entry.targets)) beginningBrambleTargets.set(entry.source, entry.targets);
          if (entry.event_id) beginningBrambleEvents.set(entry.source, entry.event_id);
        }
        for (const entry of shared) if (sources.has(entry.source) && entry.skip) beginningSkipped.add(entry.source);
      }
    }
    for (const effect of effects) if (!beginningOrder.includes(effect.source)) beginningOrder.push(effect.source);
    const bySource = new Map(effects.map(effect => [effect.source, effect]));
    const plan = beginningPlan();
    const activeSources = beginningOrder.filter(source => !beginningSkipped.has(source));
    const skippedSources = beginningOrder.filter(source => beginningSkipped.has(source));
    const rows = beginningOrder.map(source => {
      const effect = bySource.get(source);
      const skipped = beginningSkipped.has(source);
      const zoneSources = skipped ? skippedSources : activeSources;
      const index = zoneSources.indexOf(source);
      const row = document.createElement('li');
      row.className = `play-beginning-effect${beginningTargetSource === source ? ' is-choosing' : ''}${skipped ? ' is-skipped' : ''}`;
      row.draggable = own && !phaseBusy;
      const heading = document.createElement('div'); heading.className = 'play-beginning-effect-heading';
      const title = document.createElement('strong'); title.textContent = effect.card.title;
      if (own) {
        const handle = document.createElement('span'); handle.textContent = '⋮⋮'; handle.setAttribute('aria-hidden', 'true');
        heading.append(handle);
      }
      heading.append(title);
      const controls = document.createElement('div'); controls.className = 'play-beginning-effect-controls';
      const { options, target, choices, choice, valid, terrainOptions, eventOptions, fallback, targets, eventId, draws, loading } = plan.get(source);
      const targetPrompt = {
        march_of_marshrooms: 'Choose an adjacent unoccupied Symbiosis Terrain',
        efficient_grid: 'Choose a Radiance Terrain',
        solar_converter: 'Choose an adjacent Terrain',
      }[effect.kind] || 'Choose an adjacent empty Node';
      const unavailableText = {
        march_of_marshrooms: 'No adjacent unoccupied Symbiosis Terrain',
        efficient_grid: 'No Radiance Terrain',
        solar_converter: 'Requires 2 Lumens and an adjacent Terrain',
      }[effect.kind] || 'No adjacent empty Node';
      if (skipped) {
        const status = document.createElement('span'); status.textContent = 'Skipped this turn'; controls.append(status);
      } else if (effect.kind === 'garden_shared_roots') {
        const status = document.createElement('span');
        status.textContent = draws ? 'Entangled Terrain: draw 1 card' : 'Terrain not entangled: no card drawn';
        controls.append(status);
      } else if (effect.kind === 'mirrorpool_shrine') {
        const status = document.createElement('span');
        status.textContent = draws ? `Draw ${draws} card${draws === 1 ? '' : 's'}` : 'No adjacent Flow Entity on Flow Terrain';
        controls.append(status);
      } else if (effect.kind === 'bramble_briar') {
        if (loading) {
          const status = document.createElement('span');
          status.textContent = 'Loading Archive...';
          controls.append(status);
        } else if (!own) {
          const status = document.createElement('span');
          status.textContent = targets?.length === 2
            ? `Dissolve Nodes ${targets.join(' and ')}; recall an Event.`
            : 'Opponent is resolving this effect.';
          controls.append(status);
        } else if (fallback) {
          const status = document.createElement('span');
          status.textContent = 'Cannot pay: dissolve this Entity (or remove its Protection).';
          controls.append(status);
        } else {
          for (const index of [0, 1]) {
            const select = document.createElement('select');
            select.setAttribute('aria-label', `${index ? 'Second' : 'First'} empty Verdant Terrain for ${effect.card.title}`);
            select.add(new Option(`${index ? 'Second' : 'First'} empty Verdant Terrain`, ''));
            for (const key of terrainOptions) select.add(new Option(`Node ${key}`, key));
            select.value = targets[index] || '';
            select.disabled = phaseBusy;
            select.addEventListener('change', () => {
              const selected = [...(beginningBrambleTargets.get(source) || [])];
              selected[index] = select.value;
              beginningBrambleTargets.set(source, selected);
              renderBeginningEffects(); void saveBeginningPlan();
            });
            controls.append(select);
          }
          const select = document.createElement('select');
          select.setAttribute('aria-label', `Event to recall for ${effect.card.title}`);
          select.add(new Option('Event to recall from Archive', ''));
          for (const card of eventOptions) select.add(new Option(card.title, String(card.id)));
          select.value = eventId;
          select.disabled = phaseBusy;
          select.addEventListener('change', () => {
            beginningBrambleEvents.set(source, select.value);
            renderBeginningEffects(); void saveBeginningPlan();
          });
          controls.append(select);
        }
      } else if (!own) {
        const status = document.createElement('span');
        status.textContent = options.includes(target) ? `Target: Node ${target}` : options.length ? 'Waiting for target' : unavailableText;
        controls.append(status);
      } else if (options.length) {
        const choose = document.createElement('button'); choose.type = 'button';
        choose.textContent = options.includes(target) ? `Node ${target}` : 'Choose Node';
        choose.disabled = phaseBusy;
        choose.addEventListener('click', () => {
          beginningTargetSource = beginningTargetSource === source ? null : source;
          eventNotice(beginningTargetSource ? `${targetPrompt} for ${effect.card.title}.` : '');
          renderBeginningEffects(); syncEventTargets();
        });
        controls.append(choose);
      } else if (target) {
        const clear = document.createElement('button'); clear.type = 'button'; clear.textContent = 'Clear Node';
        clear.disabled = phaseBusy;
        clear.addEventListener('click', () => { beginningTargets.delete(source); beginningChoices.delete(source); renderBeginningEffects(); void saveBeginningPlan(); });
        controls.append(clear);
      } else {
        const unavailable = document.createElement('span'); unavailable.textContent = unavailableText;
        controls.append(unavailable);
      }
      if (choices?.length) {
        const label = effect.kind === 'march_of_marshrooms' ? 'Terrain to Entangle' : 'Choose Protect or Crisis';
        if (own) {
          const select = document.createElement('select');
          select.setAttribute('aria-label', label);
          select.add(new Option(label, ''));
          for (const option of choices) select.add(new Option(option.label, option.value));
          select.value = choice || '';
          select.disabled = phaseBusy;
          select.addEventListener('change', () => {
            beginningChoices.set(source, select.value);
            renderBeginningEffects(); void saveBeginningPlan();
          });
          controls.append(select);
        } else {
          const selected = choices.find(option => option.value === choice);
          if (selected) {
            const status = document.createElement('span');
            status.textContent = selected.label;
            controls.append(status);
          }
        }
      }
      if (own && effect.optional) {
        const toggle = document.createElement('button'); toggle.type = 'button';
        toggle.textContent = skipped ? 'Restore' : 'Skip';
        toggle.setAttribute('aria-label', `${skipped ? 'Restore' : 'Skip'} ${effect.card.title} this turn`);
        toggle.disabled = phaseBusy;
        toggle.addEventListener('click', () => moveBeginningEffect(source, !skipped));
        controls.append(toggle);
      }
      for (const [direction, label] of own ? [[-1, 'Move up'], [1, 'Move down']] : []) {
        const move = document.createElement('button'); move.type = 'button';
        move.textContent = direction < 0 ? '↑' : '↓'; move.setAttribute('aria-label', `${label}: ${effect.card.title}`);
        move.disabled = phaseBusy || index + direction < 0 || index + direction >= zoneSources.length;
        move.addEventListener('click', () => {
          const next = zoneSources[index + direction];
          const from = beginningOrder.indexOf(source), to = beginningOrder.indexOf(next);
          [beginningOrder[from], beginningOrder[to]] = [beginningOrder[to], beginningOrder[from]];
          renderBeginningEffects(); void saveBeginningPlan();
        });
        controls.append(move);
      }
      row.append(heading, controls);
      row.addEventListener('pointerenter', event => {
        if (event.pointerType === 'mouse' && !row.classList.contains('is-dragging')) showBeginningConnector(row, source);
      });
      row.addEventListener('pointerleave', clearBeginningConnector);
      if (own) row.addEventListener('dragstart', event => {
        clearBeginningConnector();
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', source);
        row.classList.add('is-dragging');
      });
      if (own) row.addEventListener('dragend', () => row.classList.remove('is-dragging'));
      if (own) row.addEventListener('dragover', event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; });
      if (own) row.addEventListener('drop', event => {
        event.preventDefault(); event.stopPropagation();
        const dragged = event.dataTransfer.getData('text/plain');
        if (!bySource.has(dragged) || dragged === source) return;
        moveBeginningEffect(dragged, skipped, source);
      });
      return row;
    });
    $('game-beginning-list').replaceChildren(...rows.filter(row => !row.classList.contains('is-skipped')));
    $('game-beginning-skipped-list').replaceChildren(...rows.filter(row => row.classList.contains('is-skipped')));
    $('game-resolve-beginning').disabled = phaseBusy || beginningOrder.some(source => !plan.get(source)?.valid);
  }
  function beginningPlanEntries() {
    const plan = beginningPlan();
    return beginningOrder.map(source => ({ source,
      target: beginningSkipped.has(source) ? null : beginningTargets.get(source) || null,
      choice: plan.get(source)?.choices?.some(option => option.value === beginningChoices.get(source))
        ? beginningChoices.get(source) : null,
      targets: beginningSkipped.has(source) ? [] : beginningBrambleTargets.get(source) || [],
      event_id: beginningSkipped.has(source) ? null : beginningBrambleEvents.get(source) || null,
      skip: beginningSkipped.has(source),
    }));
  }
  async function saveBeginningPlan() {
    if (phaseBusy || room?.turn_player_id !== userId || room.turn_phase !== 'beginning') return;
    const expected = epoch, roomId = room.id, turn = room.turn_number;
    const entries = beginningPlanEntries();
    phaseBusy = true;
    renderBeginningEffects();
    try {
      await rpc('play_save_beginning_entity_plan', { p_room_id: roomId, p_expected_turn: turn, p_effects: entries });
      if (expected === epoch && room?.id === roomId) await refreshRoom();
    } catch (error) {
      if (expected === epoch && room?.id === roomId) {
        beginningTurnKey = '';
        await refreshRoom().catch(() => {});
        message(friendly(error), true);
      }
    } finally {
      phaseBusy = false;
      renderBeginningEffects();
    }
  }
  async function resolveBeginningEffects() {
    if (phaseBusy || room?.turn_player_id !== userId || room.turn_phase !== 'beginning') return;
    const effects = beginningEffects();
    if (!effects.length || beginningOrder.length !== effects.length) return;
    const entries = beginningPlanEntries();
    const plan = beginningPlan();
    if (entries.some(({ source }) => !plan.get(source)?.valid)) {
      eventNotice('Complete the required choices before resolving.');
      return;
    }
    const expected = epoch, roomId = room.id, turn = room.turn_number;
    const horizon = gameState?.horizon || [];
    phaseBusy = true;
    beginningTargetSource = null;
    renderBeginningEffects(); renderTurnPhase(); syncEventTargets();
    try {
      const result = await rpc('play_resolve_beginning_entity_effects', {
        p_room_id: roomId, p_expected_turn: turn, p_effects: entries,
      });
      if (expected !== epoch || room?.id !== roomId) return;
      if (result?.drawn > 0) await animateCardsToHand(horizon.slice(0, result.drawn));
      if (expected !== epoch || room?.id !== roomId) return;
      await refreshRoom();
      if (expected === epoch && room?.id === roomId) await loadGameState(true);
      const resolvedCount = effects.length - beginningSkipped.size;
      eventNotice(`${resolvedCount} Entity effect${resolvedCount === 1 ? '' : 's'} resolved${beginningSkipped.size ? `; ${beginningSkipped.size} skipped` : ''}${result?.drawn ? `; drew ${result.drawn} card${result.drawn === 1 ? '' : 's'}` : ''}${result?.recalled ? `; recalled ${result.recalled} Event${result.recalled === 1 ? '' : 's'}` : ''}.`, true);
    } catch (error) {
      if (expected === epoch && room?.id === roomId) {
        await refreshRoom().catch(() => {});
        message(friendly(error), true);
      }
    } finally {
      clearDrawFlight();
      phaseBusy = false;
      renderBeginningEffects(); renderTurnPhase(); syncEventTargets();
    }
  }
  $('game-resolve-beginning').addEventListener('click', () => void resolveBeginningEffects());
  for (const [id, skip] of [['game-beginning-list', false], ['game-beginning-skipped-list', true]]) {
    const zone = $(id).closest('.play-beginning-zone');
    zone.addEventListener('dragover', event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; });
    zone.addEventListener('drop', event => {
      event.preventDefault();
      const source = event.dataTransfer.getData('text/plain');
      if (beginningOrder.includes(source)) moveBeginningEffect(source, skip);
    });
  }
  function clearDrawFlight() {
    for (const flight of activeDrawFlights) flight.remove();
    activeDrawFlights.clear();
    for (const item of drawHiddenItems) item.style.visibility = '';
    drawHiddenItems.clear();
    for (const animation of activeHandShifts) animation.cancel();
    activeHandShifts = [];
    arrivingCardCanvases.clear();
  }
  async function prepareArrivingCard(card, canvas, fallback, current) {
    try {
      const artwork = card.artwork_id ? await getArtworkUrl(card.artwork_id).catch(() => '') : '';
      const result = await renderPlayCard(canvas, card, artwork, current);
      if (!current() || !result || result.cancelled) return false;
      canvas.hidden = false; fallback.hidden = true;
      const key = JSON.stringify(card);
      if (!arrivingCardCanvases.has(key)) arrivingCardCanvases.set(key, []);
      arrivingCardCanvases.get(key).push(canvas);
      return true;
    } catch { return false; }
  }
  function sizeHandGaps(hand, cardCount) {
    hand.style.setProperty('--play-hand-gap-count', String(Math.max(1, cardCount - 1)));
  }
  async function animateCardsToHand(rawCards, removedIndexes = [], stagger = 0, batchSound = null) {
    const source = $('game-self-horizon').getBoundingClientRect();
    const handElement = $('game-hand');
    const hand = handElement.getBoundingClientRect();
    if ($('game').hidden || !source.width || !source.height || !hand.width || !hand.height) return;
    clearDrawFlight();
    if (!rawCards.length) return;
    const removedItems = removedIndexes.map(index => handElement.children[index]).filter(Boolean);
    const items = Array.from(handElement.children).filter(item => !removedItems.includes(item));
    const originalBounds = items.map(item => item.getBoundingClientRect());
    // Let the same flex layout size and position the incoming card before the flight.
    for (const item of removedItems) item.hidden = true;
    const placeholders = rawCards.map(() => {
      const item = document.createElement('div');
      item.className = 'play-hand-item';
      item.setAttribute('aria-hidden', 'true');
      item.style.visibility = 'hidden';
      const card = document.createElement('button');
      card.className = 'play-hand-card';
      card.type = 'button';
      card.tabIndex = -1;
      item.append(card);
      handElement.append(item);
      return item;
    });
    sizeHandGaps(handElement, items.length + placeholders.length);
    const destinations = placeholders.map(item => item.firstElementChild.getBoundingClientRect());
    const finalBounds = items.map(item => item.getBoundingClientRect());
    for (const item of placeholders) item.remove();
    for (const item of removedItems) item.hidden = false;
    sizeHandGaps(handElement, items.length + removedItems.length);
    if (destinations.some(bounds => !bounds.width || !bounds.height)) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const duration = reduced ? 100 : 850;
    const flights = rawCards.map((rawCard, index) =>
      createIncomingCardFlight(resolveHandCard(rawCard), source, destinations[index], duration, reduced ? 0 : index * stagger));
    const ready = await Promise.all(flights.map(flight => flight.ready));
    if (flights.some(({ element }) => !activeDrawFlights.has(element))) return;
    const drawRoomId = room?.id;
    const drawEpoch = epoch;
    if (batchSound) {
      if (visible && !inLobby) playTableSound(batchSound);
      animateOpponentDraws(5);
    } else rawCards.forEach((_, index) => {
      const playDraw = () => {
        if (drawEpoch === epoch && room?.id === drawRoomId && visible && !inLobby) {
          playTableSound(drawCardSound.cloneNode());
        }
      };
      if (index === 0) playDraw();
      else setTimeout(playDraw, index * (stagger || 110));
    });
    if (ready.some(result => !result)) { clearDrawFlight(); return; }

    for (const item of removedItems) {
      item.style.visibility = 'hidden';
      drawHiddenItems.add(item);
    }
    activeHandShifts = items.map((item, index) => {
      const from = originalBounds[index];
      const to = finalBounds[index];
      return item.animate([
        { transform: 'translate(0, 0) scale(1)', transformOrigin: 'top left' },
        { transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${from.width ? to.width / from.width : 1}, ${from.height ? to.height / from.height : 1})`, transformOrigin: 'top left' },
      ], { duration: duration * .75, easing: 'ease-in-out', fill: 'forwards' });
    });
    await Promise.allSettled(flights.flatMap(flight => flight.start()));
  }
  function createIncomingCardFlight(card, source, destination, duration, delay) {
    const flight = document.createElement('div');
    flight.className = 'play-draw-flight';
    flight.setAttribute('aria-hidden', 'true');
    Object.assign(flight.style, {
      left: `${destination.left}px`, top: `${destination.top}px`,
      width: `${destination.width}px`, height: `${destination.height}px`,
      visibility: 'hidden',
    });
    const inner = document.createElement('div'); inner.className = 'play-draw-flight-inner';
    const back = document.createElement('div'); back.className = 'play-draw-flight-face play-draw-flight-back';
    const front = document.createElement('div'); front.className = 'play-draw-flight-face play-draw-flight-front';
    const canvas = document.createElement('canvas'); canvas.hidden = true;
    const fallback = document.createElement('span'); fallback.textContent = card.title || 'Card';
    front.append(canvas, fallback); inner.append(back, front); flight.append(inner); document.body.append(flight);
    activeDrawFlights.add(flight);
    const ready = prepareArrivingCard(card, canvas, fallback, () => activeDrawFlights.has(flight));
    const dx = source.left + source.width / 2 - destination.left - destination.width / 2;
    const dy = source.top + source.height / 2 - destination.top - destination.height / 2;
    return {
      element: flight, ready,
      start() {
        const motion = flight.animate([
          { transform: `translate(${dx}px, ${dy}px) scale(${source.width / destination.width}, ${source.height / destination.height})` },
          { transform: `translate(${dx * .45}px, ${dy * .45}px) rotate(-5deg)`, offset: .45 },
          { transform: 'translate(0, 0) rotate(0deg)' },
        ], { duration, delay, easing: 'cubic-bezier(.22,.7,.18,1)', fill: 'both' });
        const flip = inner.animate([
          { transform: 'rotateY(0deg)', offset: 0 },
          { transform: 'rotateY(0deg)', offset: .22 },
          { transform: 'rotateY(180deg)', offset: .68 },
          { transform: 'rotateY(180deg)', offset: 1 },
        ], { duration, delay, easing: 'ease-in-out', fill: 'both' });
        flight.style.visibility = '';
        return [motion.finished, flip.finished];
      },
    };
  }
  async function finishDrawPhase(drawnCard = undefined) {
    if (!room || room.status !== 'active' || room.turn_player_id !== userId
      || room.turn_phase !== 'draw' || phaseBusy || Date.now() < drawRetryAt) return;
    const expected = epoch, roomId = room.id, turn = room.turn_number;
    phaseBusy = true;
    renderTurnPhase();
    try {
      const flightCard = drawnCard === undefined
        ? (gameState?.horizon?.length ? gameState.hand.at(-1) : null) : drawnCard;
      if (flightCard) await animateCardsToHand([flightCard]);
      if (expected !== epoch || room?.id !== roomId || room.turn_phase !== 'draw') return;
      await rpc('play_advance_turn_phase', {
        p_room_id: roomId, p_expected_turn: turn, p_expected_phase: 'draw', p_take_extra_card: false,
      });
      if (expected !== epoch || room?.id !== roomId) return;
      await refreshRoom();
      if (expected === epoch && room?.id === roomId) await loadGameState(true);
    } catch (error) {
      if (expected === epoch && room?.id === roomId) {
        drawRetryAt = Date.now() + 5000;
        await refreshRoom().catch(() => {});
        message(friendly(error), true);
      }
    } finally {
      clearDrawFlight();
      phaseBusy = false;
      renderTurnPhase();
    }
  }
  async function advanceTurnPhase(takeExtraCard = false, automatic = false) {
    if (!room || room.status !== 'active' || room.turn_player_id !== userId || phaseBusy) return;
    if (room.turn_phase === 'beginning' && !gameState) return;
    if (takeExtraCard && (room.turn_phase !== 'main' || !gameState?.horizon?.length)) return;
    const expected = epoch, roomId = room.id, turn = room.turn_number, phase = room.turn_phase;
    const drawnCard = gameState?.horizon?.[0] || null;
    phaseBusy = true;
    renderTurnPhase();
    try {
      if (takeExtraCard) await animateCardsToHand([drawnCard]);
      if (expected !== epoch || room?.id !== roomId) return;
      await rpc('play_advance_turn_phase', {
        p_room_id: roomId,
        p_expected_turn: turn,
        p_expected_phase: phase,
        p_take_extra_card: takeExtraCard,
      });
      if (expected !== epoch || room?.id !== roomId) return;
      await refreshRoom();
      if (expected === epoch && room?.id === roomId && phase === 'beginning' && room.turn_phase === 'draw') {
        phaseBusy = false;
        await finishDrawPhase(drawnCard);
        return;
      }
      if (expected === epoch && room?.id === roomId && takeExtraCard) {
        await loadGameState(true);
      }
    } catch (error) {
      if (expected === epoch && room?.id === roomId) {
        if (automatic) phaseAdvanceRetryAt = Date.now() + 5000;
        await refreshRoom().catch(() => {});
        message(friendly(error), true);
      }
    } finally {
      clearDrawFlight();
      phaseBusy = false;
      renderTurnPhase();
    }
  }
  $('game-next-phase').addEventListener('click', () => {
    if (room?.turn_phase === 'beginning' && beginningEffects().length) void resolveBeginningEffects();
    else void advanceTurnPhase();
  });
  $('game-extra-draw').addEventListener('click', () => void advanceTurnPhase(true));
  document.addEventListener('pointerdown', event => {
    for (const menu of root.querySelectorAll('.play-table-menu[open]')) {
      if (!menu.contains(event.target)) menu.open = false;
    }
    if (event.button !== 0 || $('game').hidden || !selectedGameCard) return;
    if (event.target.closest('.play-hand-card, .play-event-choice-dialog, .play-game-patron-slot, .play-game-card-preview, .play-beginning-effects, .play-game-archive-card, .play-deck-stack, .play-game-node.has-entity, .play-game-node.is-event-target')) return;
    hideCardPreview();
  });
  document.addEventListener('keydown', event => {
    if (!$('game-archive-browser').hidden) {
      if (event.key === 'Escape') { event.preventDefault(); closeArchiveBrowser(); }
      else if (event.key === 'ArrowLeft' && archiveBrowserIndex > 0) {
        event.preventDefault(); --archiveBrowserIndex; renderArchiveBrowser();
      } else if (event.key === 'ArrowRight' && archiveBrowserIndex < archiveBrowserCards.length - 1) {
        event.preventDefault(); ++archiveBrowserIndex; renderArchiveBrowser();
      } else if (event.key === 'Tab') {
        const buttons = Array.from($('game-archive-browser').querySelectorAll('button:not(:disabled)'));
        if (event.shiftKey && document.activeElement === buttons[0]) {
          event.preventDefault(); buttons.at(-1)?.focus();
        } else if (!event.shiftKey && document.activeElement === buttons.at(-1)) {
          event.preventDefault(); buttons[0]?.focus();
        }
      }
      return;
    }
    if (event.key === 'Escape' && !root.querySelector('.play-event-choice-dialog[open]')) {
      for (const menu of root.querySelectorAll('.play-table-menu[open]')) menu.open = false;
      if (beginningTargetSource) {
        beginningTargetSource = null;
        eventNotice(''); renderBeginningEffects(); syncEventTargets();
      } else if (pendingFestival && !phaseBusy) cancelFestival();
      else hideCardPreview();
    }
  });
  function message(text = '', error = false) {
    const inGame = !$('game').hidden && room?.status === 'active' && !inLobby;
    $('message-text').textContent = text;
    $('message').hidden = !text || inGame;
    $('message').classList.toggle('error', error);
    if (inGame) {
      if (text) eventNotice(text, false, error, true);
      else if ($('game-event-notice').classList.contains('is-message')) eventNotice('');
    }
  }
  $('message-close').addEventListener('click', () => message());
  function storageKey() { return `helianthe-play-room:${userId}`; }
  function awayStorageKey() { return `helianthe-play-away-lobby:${userId}`; }
  function rememberAwayLobby(id) { try { if (id) localStorage.setItem(awayStorageKey(), id); else localStorage.removeItem(awayStorageKey()); } catch {} }
  function awayLobbyRoom() { try { return localStorage.getItem(awayStorageKey()); } catch { return null; } }
  function remember(id) { try { if (id) localStorage.setItem(storageKey(), id); else { localStorage.removeItem(storageKey()); rememberAwayLobby(null); } } catch {} }
  function savedRoom() { try { return localStorage.getItem(storageKey()); } catch { return null; } }
  function awayDeadline(own) {
    if (!room || !userId) return null;
    const seat = (room.host_id === userId) === own ? 'host' : 'guest';
    return room[`${seat}_away_until`];
  }
  function awayTime(deadline) {
    const seconds = Math.max(0, Math.ceil((Date.parse(deadline) - Date.now()) / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }
  function updateAwayDisplays() {
    for (const [seat, own] of [['self', true], ['opponent', false]]) {
      const deadline = awayDeadline(own);
      const badge = $(`game-${seat}-presence`);
      badge.hidden = !deadline;
      if (deadline) badge.textContent = own ? `Away · ${awayTime(deadline)}` : `Opponent left the table · ${awayTime(deadline)}`;
    }
    const note = $('away-note');
    if (note && inLobby && awayDeadline(true)) note.textContent = `Away · ${awayTime(awayDeadline(true))}`;
    const expired = [awayDeadline(true), awayDeadline(false)].some(deadline => deadline && Date.now() >= Date.parse(deadline));
    if (room?.status === 'active' && expired && !awayExpiryBusy) {
      awayExpiryBusy = true;
      void rpc('play_expire_away_tables').then(() => refreshRoom()).catch(() => {}).finally(() => { awayExpiryBusy = false; });
    }
  }
  async function seatedUserId(data) {
    if (!data) return null;
    if (data.host_id === userId || data.guest_id === userId) return userId;
    const { data: auth } = await client.auth.getUser();
    return auth?.user && (auth.user.id === data.host_id || auth.user.id === data.guest_id) ? auth.user.id : null;
  }
  function friendly(error) {
    if (['PGRST202', 'PGRST205', '42P01', '42883'].includes(error.code)) return 'Play is not available yet. Please try again later.';
    if (error instanceof TypeError) return 'Something went wrong while showing the table. Return to the Lobby and try again.';
    if (error.message?.includes('play_rooms_host_ready_requires_deck') || error.message?.includes('play_rooms_guest_ready_requires_deck')) {
      return 'Choose a deck before getting ready.';
    }
    if (error.message?.includes('You already have an open table.') || error.message?.includes('Close an existing room before creating another one.')) {
      return 'You already have an open table. Close it before creating another.';
    }
    return (error.message || 'The table could not be updated. Try again.')
      .replace(/\bRooms\b/g, 'Tables').replace(/\bRoom\b/g, 'Table')
      .replace(/\brooms\b/g, 'tables').replace(/\broom\b/g, 'table');
  }
  async function rpc(name, args = {}) {
    const { data, error } = await client.rpc(name, args);
    if (error) throw error;
    return data;
  }
  async function disconnect() {
    ++epoch; ++fetchSerial;
    delete $('game').dataset.turnAura;
    clearTerrainArrivals();
    clearOpponentCardFlights();
    openingDealRunningKey = '';
    clearTimeout(phaseAdvanceTimer);
    phaseAdvanceTimer = null;
    phaseAdvanceKey = '';
    phaseAdvanceRetryAt = 0;
    gameLogKey = '';
    gameLogRequest = null;
    pendingDeckId = null;
    ++gameRenderSerial; gameState = null; gameLoading = false; gameLoadFailed = false; gameReloadPending = false; handSignature = '';
    phaseBusy = false; drawRetryAt = 0; clearDrawFlight(); clearMulliganFlights(); clearDiscardHandMotion(); discardSelections.clear(); pendingFestival = null; arrivingEntityKey = null;
    beginningTurnKey = ''; beginningOrder = []; beginningTargetSource = null; beginningTargets.clear();
    beginningChoices.clear();
    beginningBrambleTargets.clear(); beginningBrambleEvents.clear();
    patronDeckRequest = ''; patronDeckLoadedAt = 0; gameDeckPatrons.clear(); gamePlayerPatrons.clear();
    zoneCounts = null; zoneCountsRevision = null; zoneCountsRequest = null;
    for (const seat of ['self', 'opponent']) {
      const preview = patronPreviews[seat];
      preview.key = ''; preview.card = null; ++preview.serial;
      $(`game-${seat}-patron`).hidden = true;
      $(`game-${seat}-patron-fallback`).hidden = false;
    }
    hideCardPreview();
    if (timer) clearInterval(timer);
    if (awayTicker) clearInterval(awayTicker);
    timer = null; awayTicker = null; awayExpiryBusy = false;
    const previous = channel; channel = null; live = false;
    if (previous) await client.removeChannel(previous);
  }
  function canAct() { return Boolean(room && userId && (room.host_id === userId || room.guest_id === userId) && room.status !== 'closed' && !busy); }
  function ownDeckId() { return room?.[`${room.host_id === userId ? 'host' : 'guest'}_deck_id`]; }
  function ownReady() { return room?.[`${room.host_id === userId ? 'host' : 'guest'}_ready`]; }
  function controls() {
    $('create').disabled = busy;
    for (const b of $('room-list').querySelectorAll('button')) b.disabled = busy || b.dataset.full === 'true';
    const deckLocked = Boolean(ownReady());
    $('deck').disabled = !canAct() || deckLocked || !getDecks().length;
    $('deck').title = deckLocked ? 'Click Not Ready to change your deck.' : '';
    const disabled = $('deck').disabled;
    $('deck-trigger').setAttribute('aria-disabled', String(disabled));
    $('deck-trigger').tabIndex = disabled ? -1 : 0;
    $('deck-trigger').title = $('deck').title;
    if (disabled) $('deck-picker').open = false;
    deckField.classList.toggle('is-locked', deckLocked);
    $('ready').disabled = !canAct() || deckSaveInFlight || (!ownReady() && !$('deck').value);
    $('edit-name').disabled = !canAct() || room?.host_id !== userId;
    $('back').disabled = busy || !room;
    $('leave').disabled = busy || !room;
  }
  function playTableSound(sound) {
    sound.currentTime = 0;
    sound.volume = tableSoundVolume;
    void sound.play().catch(() => {});
  }
  function connectTableSound(source, context) {
    const gain = context.createGain();
    gain.gain.value = tableSoundVolume;
    source.connect(gain);
    gain.connect(context.destination);
    source.addEventListener('ended', () => { source.disconnect(); gain.disconnect(); }, { once: true });
  }
  async function playRollDiceSound() {
    if (rollDiceClip) {
      try {
        const context = tableAudioContext ||= new TableAudioContext();
        const [clip] = await Promise.all([rollDiceClip, context.resume()]);
        if (clip) {
          const source = context.createBufferSource();
          source.buffer = clip.buffer;
          connectTableSound(source, context);
          source.start(0, clip.offset);
          return;
        }
      } catch { /* Fall back to the preloaded media element. */ }
    }
    playTableSound(rollDiceSound);
  }
  async function playBuildTableSound() {
    if (TableAudioContext) {
      try {
        const context = tableAudioContext ||= new TableAudioContext();
        // Resume during the click so audio remains allowed after decoding.
        const ready = context.resume();
        buildTableSoundBuffer ||= buildTableSoundData.then(data => {
          if (!data) throw new Error('Build Table audio could not be loaded.');
          return context.decodeAudioData(data.slice(0));
        });
        const [buffer] = await Promise.all([buildTableSoundBuffer, ready]);
        const source = context.createBufferSource();
        source.buffer = buffer;
        connectTableSound(source, context);
        source.start(context.currentTime + 0.02);
        return;
      } catch {
        // Use the regular audio element if the browser cannot use Web Audio.
      }
    }
    playTableSound(sitAtTableSound);
  }
  async function run(task) {
    if (busy) return;
    busy = true; controls(); message();
    try { await task(); }
    catch (error) { message(friendly(error), true); }
    finally { busy = false; controls(); if (autoDeckPending) maybeAutoSelectDeck(); }
  }
  function maybeAutoSelectDeck() {
    const first = getDecks()[0];
    if (!room || !userId || room.status === 'closed' || room.activated_at || ownReady() || (room.host_id !== userId && room.guest_id !== userId)
      || !first || getDecks().some(deck => deck.id === ownDeckId())) { autoDeckPending = false; return; }
    if (busy) { autoDeckPending = true; return; }
    autoDeckPending = false;
    void run(() => action('deck', { deck_id: first.id }));
  }
  function gamePlayerCard(id, deckId, own) {
    const seat = own ? 'self' : 'opponent';
    const roomSeat = room.host_id === id ? 'host' : 'guest';
    const profile = getProfiles().find(person => person.id === id);
    const deck = getDecks().find(item => String(item.id) === String(deckId));
    $(`game-${seat}-name`).textContent = `${profile?.display_name || 'Player'}${own ? ' · You' : ''}`;
    const avatar = $(`game-${seat}-avatar`);
    const avatarKey = JSON.stringify([id, profile?.avatar_id, profile?.display_name]);
    if (avatar.dataset.profileKey !== avatarKey) {
      const updatedAvatar = makeAvatar(profile || { display_name: 'Player' }, 'play-game-player-avatar');
      updatedAvatar.id = avatar.id;
      updatedAvatar.dataset.profileKey = avatarKey;
      updatedAvatar.setAttribute('aria-hidden', 'true');
      avatar.replaceWith(updatedAvatar);
    }
    if (!own) $('game-opponent-horizon').setAttribute('aria-label', `Opponent's Horizon, ${deck?.name || 'selected deck'}`);
    const savedPatron = room[`${roomSeat}_patron_name`];
    const selectedPatron = gamePlayerPatrons.get(String(id)) || (own ? gameState?.patron_name : null)
      || savedPatron || gameDeckPatrons.get(String(deckId)) || deck?.patron_name || getDefaultPatronName();
    renderGamePatron(seat, selectedPatron);
  }
  async function loadGamePatrons() {
    if (!room || room.status !== 'active') return;
    const deckIds = [room.host_deck_id, room.guest_deck_id].filter(Boolean);
    const signature = deckIds.map(String).join(':');
    if (!signature || (signature === patronDeckRequest && Date.now() - patronDeckLoadedAt < 10000)) return;
    patronDeckRequest = signature;
    patronDeckLoadedAt = Date.now();
    const expected = epoch, roomId = room.id;
    const [decks, gameDecks] = await Promise.all([
      client.from('decks').select('id,patron_name').in('id', deckIds),
      client.from('play_game_decks').select('player_id,patron_name').eq('room_id', roomId),
    ]);
    if (expected !== epoch || room?.id !== roomId) return;
    if (!decks.error) {
      gameDeckPatrons.clear();
      for (const deck of decks.data || []) {
        gameDeckPatrons.set(String(deck.id), deck.patron_name);
      }
    }
    if (!gameDecks.error) {
      gamePlayerPatrons.clear();
      for (const deck of gameDecks.data || []) gamePlayerPatrons.set(String(deck.player_id), deck.patron_name);
    }
    if (decks.error && gameDecks.error) { patronDeckRequest = ''; patronDeckLoadedAt = 0; }
    if (!inLobby) renderGame();
  }
  function renderGamePatron(seat, patronName) {
    const card = patronName ? (getPatronCard?.(patronName) || { title: patronName, card_type: 'Patron' }) : null;
    const preview = patronPreviews[seat];
    preview.card = card;
    renderTurnPhase();
    const key = `${patronName || ''}:${card?.id || ''}:${card?.artwork_id || ''}`;
    if (preview.key === key) return;
    preview.key = key;
    const serial = ++preview.serial;
    const canvas = $(`game-${seat}-patron`);
    const fallback = $(`game-${seat}-patron-fallback`);
    canvas.hidden = true;
    fallback.hidden = false;
    fallback.textContent = card?.title?.split(',')[0] || '';
    const terrain = ['Flow', 'Verdant', 'Symbiosis', 'Radiance'].includes(card?.terrain) ? card.terrain : 'Nomads';
    const frame = terrain === 'Radiance' ? 'Radiance_CardFrame_v2.png' : terrain === 'Nomads' ? 'Nomads_CardFrame_v2.png' : `${terrain}_CardFrame.png`;
    fallback.style.backgroundImage = card
      ? `url('./assets/Type_Patron_${terrain}_Arcane.png'), url('./assets/${frame}')`
      : `url('./assets/${frame}')`;
    fallback.style.backgroundSize = card ? '44% auto, 100% 100%' : '100% 100%';
    $(`game-${seat}-patron-slot`).setAttribute('aria-label', `${seat === 'self' ? 'Your' : "Opponent's"} Patron: ${card?.title || 'none selected'}`);
    if (!card) return;
    void (async () => {
      const artwork = card.artwork_id ? await getArtworkUrl(card.artwork_id).catch(() => '') : '';
      const stagedCanvas = document.createElement('canvas');
      const result = await renderPlayCard(stagedCanvas, card, artwork, () => serial === preview.serial, canvas.parentElement);
      if (serial === preview.serial && result && !result.cancelled) {
        canvas.width = stagedCanvas.width;
        canvas.height = stagedCanvas.height;
        canvas.getContext('2d').drawImage(stagedCanvas, 0, 0);
        canvas.setAttribute('aria-label', stagedCanvas.getAttribute('aria-label') || `${card.title} Patron card`);
        canvas.hidden = false;
        fallback.hidden = true;
      }
    })().catch(() => { if (serial === preview.serial) preview.key = ''; });
  }
  function hideCardPreview() {
    hideHoveredCardPreview();
    pendingEvent = null;
    pendingEntity = null;
    selectedGameCard = null;
    syncEventTargets();
    eventNotice('');
    selectedCardElement?.classList.remove('is-selected', 'is-queued');
    selectedCardElement?.removeAttribute('aria-pressed');
    selectedCardElement = null;
    requestAnimationFrame(syncHoveredCardPreview);
  }
  function hideHoveredCardPreview() {
    ++cardPreviewSerial;
    hoveredCardElement = null;
    hoveredCardKey = '';
    $('game-card-preview').hidden = true;
  }
  function showHoveredCardPreview(card, source) {
    const key = JSON.stringify([card.id, card.title, card.card_type, card.terrain, card.effect, card.artwork_id, card.fullArtUrl]);
    if (hoveredCardElement === source && hoveredCardKey === key) return;
    hoveredCardElement = source;
    hoveredCardKey = key;
    const serial = ++cardPreviewSerial;
    const panel = $('game-card-preview');
    const canvas = $('game-card-preview-canvas');
    const image = $('game-card-preview-image');
    const fallback = $('game-card-preview-fallback');
    canvas.hidden = true;
    image.hidden = true;
    fallback.hidden = false;
    fallback.textContent = card.title || 'Card';
    panel.setAttribute('aria-label', `Preview of ${card.title || 'card'}`);
    panel.hidden = false;
    if (card.fullArtTerrain && card.fullArtUrl) {
      image.src = card.fullArtUrl;
      image.hidden = false;
      fallback.hidden = true;
      return;
    }
    void (async () => {
      const artwork = card.artwork_id ? await getArtworkUrl(card.artwork_id).catch(() => '') : '';
      const result = await renderPlayCard(canvas, card, artwork, () => serial === cardPreviewSerial);
      if (serial === cardPreviewSerial && result && !result.cancelled) {
        canvas.hidden = false;
        fallback.hidden = true;
      }
    })().catch(() => {});
  }
  function syncHoveredCardPreview() {
    if (!mousePosition || $('game').hidden || !$('game-archive-browser').hidden) {
      if (hoveredCardElement) hideHoveredCardPreview();
      return;
    }
    const target = document.elementFromPoint(mousePosition.x, mousePosition.y);
    const source = target?.closest?.('.play-hand-card, .play-game-archive-card, .play-node-entity-card, .play-game-node[class*="terrain-"], .play-game-patron-slot, .play-game-log-card');
    if (!source || !root.contains(source)) {
      if (hoveredCardElement) hideHoveredCardPreview();
      return;
    }
    let card = null;
    if (source.matches('.play-hand-card')) card = displayedHand()[Number(source.dataset.handIndex)];
    else if (source.matches('.play-game-archive-card, .play-node-entity-card, .play-game-log-card')) card = source._playCard;
    else if (source.matches('.play-game-node')) card = source._playTerrain;
    else card = patronPreviews[source.id.includes('opponent') ? 'opponent' : 'self'].card;
    if (card) showHoveredCardPreview(resolveGameCard(card), source);
    else if (hoveredCardElement) hideHoveredCardPreview();
  }
  document.addEventListener('pointermove', event => {
    if (event.pointerType !== 'mouse') return;
    mousePosition = { x: event.clientX, y: event.clientY };
    syncHoveredCardPreview();
  });
  document.addEventListener('pointerout', event => {
    if (event.pointerType === 'mouse' && !event.relatedTarget) {
      mousePosition = null;
      hideHoveredCardPreview();
    }
  });
  window.addEventListener('blur', hideHoveredCardPreview);
  function cardPlayBlockReason(card) {
    if (['mulligan_first', 'mulligan_second'].includes(room?.turn_phase)) return 'You can play cards after both players finish their mulligans.';
    if (room?.turn_player_id !== userId) return "You can play cards only on your turn.";
    if (room?.turn_phase !== 'main') return 'You can play cards only during your Main Phase.';
    if (pendingFestival) return `Finish resolving ${pendingFestival.card.title} first.`;
    if (phaseBusy) return 'Wait for the current action to finish.';
    if (card.card_type === 'Entity') {
      if (room.main_played_entity) return 'You have already played an Entity this turn.';
      const hasTarget = Array.from($('game-board').children).some(cell => cell.dataset.key
        && legalEntityAction(card, room?.board?.[cell.dataset.key], cell.dataset.key));
      return hasTarget ? ''
        : 'There is no matching unoccupied Terrain or legal empty space to Shape.';
    }
    if (card.card_type !== 'Event') return '';
    const support = eventSupport(card);
    if (!support) return unavailableEventReason(card);
    if (support[1] === 'shared_canal_gathering'
      && !extendedEventStep(support[1], [], { board: room.board })?.options.length) {
      return 'Shared Canal Gathering needs an unoccupied, unentangled Symbiosis Terrain next to a different Terrain.';
    }
    if (card.title === 'Beacon Grid' && support[1] === 'lumens_two') {
      const hasTarget = Array.from($('game-board').children).some(cell => cell.dataset.key
        && legalEventTarget(support[1], room?.board?.[cell.dataset.key]));
      if (!hasTarget) return card.title === 'Beacon Grid' ? 'Beacon Grid needs Radiance Terrain.'
        : support[1] === 'fertilize_existing_draw' ? 'There is no fertilized empty space to choose.'
          : support[1].startsWith('fertilize') ? 'There is no legal empty space to Fertilize.'
            : `There is no legal target. This Event needs ${support[2]}.`;
    }
    return '';
  }
  function selectHandCard(card, source, queued = false) {
    selectedGameCard = card;
    selectedCardElement?.classList.remove('is-selected', 'is-queued');
    selectedCardElement?.removeAttribute('aria-pressed');
    selectedCardElement = source;
    selectedCardElement?.classList.add('is-selected');
    selectedCardElement?.classList.toggle('is-queued', queued);
    selectedCardElement?.setAttribute('aria-pressed', 'true');
    renderTurnPhase();
  }
  function chooseHandCard(card, source, handIndex) {
    if (['mulligan_first', 'mulligan_second'].includes(room?.turn_phase)) {
      const actorId = room.turn_phase === 'mulligan_first' ? room.turn_player_id
        : room.turn_player_id === room.host_id ? room.guest_id : room.host_id;
      if (actorId !== userId) { blockedPlayNotice(cardPlayBlockReason(card)); return; }
      if (mulliganBusy || !gameState) return;
      const position = mulliganOrder.indexOf(handIndex);
      if (position >= 0) {
        mulliganOrder.splice(position, 1);
        playTableSound(selectCardSound);
      }
      else if (mulliganOrder.length < gameState.horizon.length) {
        mulliganOrder.push(handIndex);
        playTableSound(selectCardSound);
      }
      selectHandCard(card, source);
      renderMulligan();
      return;
    }
    if (pendingFestival) {
      if (phaseBusy || handIndex === pendingFestival.handIndex) return;
      if (!discardSelections.delete(handIndex)) {
        if (discardSelections.size >= pendingFestival.discardCount) return;
        discardSelections.add(handIndex);
      }
      playTableSound(selectCardSound);
      syncDiscardBar();
      return;
    }
    if (!requiredDiscards()) {
      if (!phaseBusy && selectedCardElement === source && source.classList.contains('is-queued')) {
        hideCardPreview();
        playTableSound(selectCardSound);
        return;
      }
      const reason = cardPlayBlockReason(card);
      if (reason) { blockedPlayNotice(reason); return; }
      hideCardPreview();
      if (card.card_type === 'Entity') {
        pendingEntity = { card, handIndex };
        selectHandCard(card, source, true);
        syncEventTargets();
        eventNotice('Choose compatible Terrain to Place, or an empty space to Shape.');
        playTableSound(selectCardSound);
      } else if (card.card_type === 'Event') {
        void evokeEvent(card, handIndex);
        if (pendingEvent || root.querySelector('.play-event-choice-dialog[open]')) {
          selectHandCard(card, source, true);
          playTableSound(selectCardSound);
        }
      }
      return;
    }
    if (discardSelections.has(handIndex)) {
      discardSelections.delete(handIndex);
      if (selectedCardElement === source) hideCardPreview();
    } else {
      discardSelections.add(handIndex);
      selectHandCard(card, source);
    }
    playTableSound(selectCardSound);
    syncDiscardBar();
  }
  $('game-card-preview-close').addEventListener('click', hideCardPreview);
  function cancelFestival() {
    pendingFestival = null;
    discardSelections.clear();
    handSignature = '';
    renderGame();
    eventNotice('');
  }
  async function stageFestival(card, handIndex, targetX = null, targetY = null) {
    pendingEvent = null;
    const originalState = gameState, expected = epoch, roomId = room.id;
    const drawn = (originalState.horizon || []).slice(0, 2);
    const hand = originalState.hand.concat(drawn);
    const twoDiscards = eventSupport(card)?.[1] === 'draw_two_discard_two';
    const discardCount = Math.min(twoDiscards ? 2 : 1, hand.length - 1);
    eventNotice('');
    phaseBusy = true;
    renderTurnPhase();
    try {
      await animateCardsToHand(drawn, [], 110);
      if (expected !== epoch || room?.id !== roomId || room.turn_player_id !== userId || room.turn_phase !== 'main') return;
      pendingFestival = { card, handIndex, drawn, hand, targetX, targetY, twoDiscards, discardCount };
      discardSelections.clear();
      handSignature = '';
      renderGame();
    } finally {
      clearDrawFlight();
      phaseBusy = false;
      renderTurnPhase();
    }
  }
  async function confirmFestival() {
    const festival = pendingFestival;
    if (!festival || !room || room.status !== 'active' || room.turn_player_id !== userId
      || room.turn_phase !== 'main' || phaseBusy || discardSelections.size !== festival.discardCount) return;
    const indexes = [...discardSelections];
    const discards = indexes.map(index => {
      const card = festival.hand[index];
      return { index: index > festival.handIndex ? index - 1 : index, id: card?.card_id || card?.id };
    });
    if (discards.some(choice => !choice.id)) return;
    const expected = epoch, roomId = room.id;
    phaseBusy = true;
    renderTurnPhase();
    try {
      const seedCaravan = festival.card.title === 'Seed Caravan';
      const action = seedCaravan ? 'play_evoke_seed_caravan'
        : festival.twoDiscards ? 'play_evoke_festival_two_discards' : 'play_evoke_festival';
      const result = await rpc(action, {
        ...(seedCaravan ? { p_target_x: festival.targetX, p_target_y: festival.targetY } : {}),
        p_room_id: roomId, p_expected_turn: room.turn_number,
        p_hand_index: festival.handIndex, p_card_id: festival.card.card_id || festival.card.id,
        p_expected_hand_count: gameState.hand.length,
        p_expected_draw_ids: festival.drawn.map(card => card.card_id || card.id),
        ...(festival.twoDiscards ? { p_discards: discards }
          : { p_discard_index: discards[0]?.index ?? null, p_discard_card_id: discards[0]?.id || null }),
      });
      if (expected !== epoch || room?.id !== roomId) return;
      playTableSound(playCardSound);
      await animateDiscardToArchive([festival.handIndex, ...indexes]);
      if (expected !== epoch || room?.id !== roomId) return;
      discardSelections.clear();
      await refreshRoom();
      pendingFestival = null;
      if (expected === epoch && room?.id === roomId) await loadGameState(true);
      if (expected === epoch && room?.id === roomId && discardFlights.size) await archivePreviews.self.ready;
      if (expected === epoch && room?.id === roomId) eventNotice(`${festival.card.title} evoked · drew ${result?.drawn || 0}${result?.discarded ? ` · discarded ${result.discarded}` : ''}.`, true);
    } catch (error) {
      if (expected === epoch && room?.id === roomId) {
        pendingFestival = null;
        await refreshRoom().catch(() => {});
        await loadGameState(true).catch(() => {});
        message(friendly(error), true);
      }
    } finally {
      clearDiscardHandMotion();
      phaseBusy = false;
      renderTurnPhase();
    }
  }
  function clearDiscardHandMotion() {
    for (const flight of discardFlights) flight.remove();
    discardFlights.clear();
    for (const animation of discardHandShifts) animation.cancel();
    discardHandShifts.length = 0;
    for (const card of discardHiddenCards) card.style.visibility = '';
    discardHiddenCards.clear();
  }
  function syncLandedDiscards() {
    const bounds = $('game-self-archive').getBoundingClientRect();
    for (const flight of discardFlights) {
      if (flight.dataset.landed !== 'true') continue;
      Object.assign(flight.style, {
        left: `${bounds.left}px`, top: `${bounds.top}px`,
        width: `${bounds.width}px`, height: `${bounds.height}px`,
      });
    }
  }
  async function animateDiscardToArchive(indexes, { reflowHand = true } = {}) {
    const archive = $('game-self-archive');
    const destination = archive.getBoundingClientRect();
    if ($('game').hidden || !destination.width || !destination.height) return;
    clearDiscardHandMotion();
    const hand = $('game-hand');
    const items = Array.from(hand.children);
    const remaining = items.filter((_, index) => !indexes.includes(index));
    const handBounds = hand.getBoundingClientRect();
    const handStyle = getComputedStyle(hand);
    const gap = parseFloat(handStyle.columnGap) || 0;
    const paddingLeft = parseFloat(handStyle.paddingLeft) || 0;
    const paddingRight = parseFloat(handStyle.paddingRight) || 0;
    const available = handBounds.width - paddingLeft - paddingRight;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const archiveRadius = getComputedStyle(archive).borderRadius;
    const handCards = displayedHand();
    const flights = indexes.map((index, order) => {
      const source = items[index]?.querySelector('.play-hand-card');
      const bounds = source?.getBoundingClientRect();
      if (!bounds?.width || !bounds.height) return null;
      const flight = source.cloneNode(true);
      flight.classList.remove('is-selected', 'is-discard-selected', 'is-queued');
      flight.classList.add('play-discard-flight');
      flight._archiveCardKey = archiveCardKey(resolveHandCard(handCards[index]));
      flight.setAttribute('aria-hidden', 'true');
      flight.tabIndex = -1;
      Object.assign(flight.style, {
        left: `${destination.left}px`, top: `${destination.top}px`,
        width: `${destination.width}px`, height: `${destination.height}px`,
        borderRadius: archiveRadius,
      });
      const sourceCanvas = source.querySelector('canvas');
      const flightCanvas = flight.querySelector('canvas');
      if (sourceCanvas && flightCanvas && !sourceCanvas.hidden && sourceCanvas.width) {
        flightCanvas.width = sourceCanvas.width;
        flightCanvas.height = sourceCanvas.height;
        flightCanvas.getContext('2d').drawImage(sourceCanvas, 0, 0);
      }
      document.body.append(flight);
      discardFlights.add(flight);
      source.style.visibility = 'hidden';
      discardHiddenCards.add(source);
      const dx = bounds.left + bounds.width / 2 - destination.left - destination.width / 2;
      const dy = bounds.top + bounds.height / 2 - destination.top - destination.height / 2;
      const scaleX = bounds.width / destination.width;
      const scaleY = bounds.height / destination.height;
      const animation = flight.animate([
        { transform: `translate(${dx}px, ${dy}px) rotate(0deg) scale(${scaleX}, ${scaleY})` },
        { transform: `translate(${dx * .4}px, ${dy * .4}px) rotate(-5deg) scale(${1 + (scaleX - 1) * .4}, ${1 + (scaleY - 1) * .4})`, offset: .65 },
        { transform: 'translate(0, 0) rotate(0deg) scale(1)' },
      ], { duration: reducedMotion ? 100 : 650, delay: reducedMotion ? 0 : order * 85,
        easing: 'cubic-bezier(.22,.7,.18,1)', fill: 'both' });
      void animation.finished.then(() => {
        if (!discardFlights.has(flight)) return;
        flight.dataset.landed = 'true';
        syncLandedDiscards();
      }, () => {});
      return { source, flight, animation };
    }).filter(Boolean);
    if (reflowHand && remaining.length) {
      const preferredWidth = parseFloat(getComputedStyle(items[0]).flexBasis) || items[0].getBoundingClientRect().width;
      const targetWidth = Math.min(preferredWidth,
        Math.max(1, (available - (remaining.length - 1) * gap) / remaining.length));
      const totalWidth = remaining.length * targetWidth + (remaining.length - 1) * gap;
      const startX = handBounds.left + paddingLeft + Math.max(0, (available - totalWidth) / 2) - hand.scrollLeft;
      for (const [index, item] of remaining.entries()) {
        const current = item.getBoundingClientRect();
        const delta = startX + index * (targetWidth + gap) - current.left;
        const ratio = targetWidth / current.width;
        discardHandShifts.push(item.animate([
          { transform: 'translateX(0) scale(1)', transformOrigin: 'top left' },
          { transform: `translateX(${delta}px) scale(${ratio})`, transformOrigin: 'top left' },
        ], { duration: reducedMotion ? 100 : 650 + (indexes.length - 1) * 85,
          easing: 'ease-in-out', fill: 'forwards' }));
      }
    }
    await Promise.allSettled(flights.map(({ animation }) => animation.finished));
  }
  async function confirmDiscardSelection() {
    if (pendingFestival) { await confirmFestival(); return; }
    if (!room || room.status !== 'active' || room.turn_player_id !== userId
      || room.turn_phase !== 'end' || phaseBusy || discardSelections.size !== requiredDiscards()
      || !requiredDiscards()) return;
    const indexes = Array.from(discardSelections).sort((a, b) => a - b);
    const cardIds = indexes.map(index => gameState.hand[index]?.card_id || gameState.hand[index]?.id);
    if (cardIds.some(id => !id)) return;
    const expected = epoch, roomId = room.id;
    phaseBusy = true;
    renderTurnPhase();
    try {
      await rpc('play_discard_to_limit_batch', {
        p_room_id: roomId, p_expected_turn: room.turn_number,
        p_hand_indexes: indexes, p_card_ids: cardIds,
        p_expected_hand_count: gameState.hand.length,
      });
      if (expected !== epoch || room?.id !== roomId) return;
      await animateDiscardToArchive(indexes);
      if (expected !== epoch || room?.id !== roomId) return;
      discardSelections.clear();
      await refreshRoom();
      if (expected === epoch && room?.id === roomId) await loadGameState(true);
      if (expected === epoch && room?.id === roomId && discardFlights.size) await archivePreviews.self.ready;
    } catch (error) {
      if (expected === epoch && room?.id === roomId) {
        await refreshRoom().catch(() => {});
        await loadGameState(true).catch(() => {});
        message(friendly(error), true);
      }
    } finally {
      clearDiscardHandMotion();
      phaseBusy = false;
      renderTurnPhase();
    }
  }
  $('game-confirm-discard').addEventListener('click', () => void confirmDiscardSelection());
  function resolveGameCard(raw) {
    const card = raw && typeof raw === 'object' ? raw : { title: String(raw || '') };
    const catalog = getCards?.() || [];
    const id = card.card_id || card.id;
    const title = String(card.title || card.name || '').trim().toLocaleLowerCase();
    const full = catalog.find(item => id && String(item.id) === String(id))
      || catalog.find(item => title && item.title?.trim().toLocaleLowerCase() === title);
    return full ? { ...card, ...full,
      ...(card.card_type === 'Entity' && card.terrain ? { terrain: card.terrain } : {}) } : card;
  }
  function resolveHandCard(raw) {
    const card = resolveGameCard(raw);
    return ['Entity', 'Event'].includes(raw?.card_type) && typeof raw.effect === 'string'
      ? { ...card, effect: raw.effect } : card;
  }
  function renderArchiveGallery() {
    archiveGalleryObserver?.disconnect();
    archiveGalleryObserver = null;
    const list = $('game-archive-browser-list');
    const serial = archiveBrowserRequestSerial;
    const entries = archiveBrowserCards.map((item, index) => {
      const row = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-label', `Preview ${item.title || 'card'} in Archive`);
      const canvas = document.createElement('canvas');
      canvas.hidden = true;
      canvas.setAttribute('aria-hidden', 'true');
      const fallback = document.createElement('span');
      fallback.className = 'play-archive-gallery-fallback';
      fallback.textContent = item.title || 'Card';
      button.append(canvas, fallback);
      const showCard = () => {
        if (archiveBrowserIndex === index) return;
        archiveBrowserIndex = index;
        renderArchiveBrowser();
      };
      button.addEventListener('click', showCard);
      button.addEventListener('pointerenter', event => {
        if (event.pointerType === 'mouse') showCard();
      });
      row.append(button);
      return { row, button, canvas, fallback, item };
    });
    list.replaceChildren(...entries.map(entry => entry.row));
    const drawThumbnail = entry => {
      void (async () => {
        const { button, canvas, fallback, item } = entry;
        const artwork = item.artwork_id ? await getArtworkUrl(item.artwork_id).catch(() => '') : '';
        const current = () => serial === archiveBrowserRequestSerial && list.contains(button);
        const result = await renderPlayCard(canvas, item, artwork, current);
        if (!current() || !result || result.cancelled) return;
        canvas.hidden = false;
        fallback.hidden = true;
      })().catch(() => {});
    };
    if (typeof IntersectionObserver === 'function') {
      const galleryEntries = new Map(entries.map(entry => [entry.button, entry]));
      archiveGalleryObserver = new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          archiveGalleryObserver?.unobserve(entry.target);
          const item = galleryEntries.get(entry.target);
          if (item) drawThumbnail(item);
        }
      }, { root: list, rootMargin: '120px' });
      for (const entry of entries) archiveGalleryObserver.observe(entry.button);
    } else {
      for (const entry of entries) drawThumbnail(entry);
    }
  }
  function renderArchiveBrowser() {
    if ($('game-archive-browser').hidden) return;
    const card = archiveBrowserCards[archiveBrowserIndex];
    const status = $('game-archive-browser-status');
    status.textContent = archiveBrowserError || (archiveBrowserLoading ? 'Loading cards…'
      : `${archiveBrowserCards.length} card${archiveBrowserCards.length === 1 ? '' : 's'}`);
    Array.from($('game-archive-browser-list').children).forEach((row, index) => {
      const button = row.firstElementChild;
      button.setAttribute('aria-current', index === archiveBrowserIndex ? 'true' : 'false');
    });
    const canvas = $('game-archive-browser-canvas');
    const fallback = $('game-archive-browser-fallback');
    const serial = ++archiveBrowserCardSerial;
    canvas.hidden = true;
    fallback.hidden = false;
    fallback.textContent = card?.title || (archiveBrowserLoading ? 'Loading…'
      : 'No cards in this Archive.');
    if (!card) return;
    void (async () => {
      const artwork = card.artwork_id ? await getArtworkUrl(card.artwork_id).catch(() => '') : '';
      const result = await renderPlayCard(canvas, card, artwork,
        () => serial === archiveBrowserCardSerial && !$('game-archive-browser').hidden);
      if (serial === archiveBrowserCardSerial && result && !result.cancelled) {
        canvas.hidden = false;
        fallback.hidden = true;
      }
    })().catch(() => {});
  }
  function closeArchiveBrowser(restoreFocus = true) {
    if ($('game-archive-browser').hidden) return;
    archiveGalleryObserver?.disconnect();
    archiveGalleryObserver = null;
    ++archiveBrowserRequestSerial;
    ++archiveBrowserCardSerial;
    $('game-archive-browser').hidden = true;
    archiveBrowserSeat = null;
    archiveBrowserCards = [];
    $('game-archive-browser-list').replaceChildren();
    archiveBrowserLoading = false;
    archiveBrowserError = '';
    if (restoreFocus && archiveBrowserOpener?.isConnected) archiveBrowserOpener.focus();
    archiveBrowserOpener = null;
  }
  async function openArchiveBrowser(seat) {
    if (room?.status !== 'active' || !userId) return;
    hideCardPreview();
    archiveBrowserSeat = seat;
    archiveBrowserCards = [];
    $('game-archive-browser-list').replaceChildren();
    archiveBrowserIndex = 0;
    archiveBrowserLoading = true;
    archiveBrowserError = '';
    archiveBrowserOpener = $(`game-${seat}-archive`);
    $('game-archive-browser-title').textContent = seat === 'self' ? 'Your Archive' : "Opponent's Archive";
    $('game-archive-browser').hidden = false;
    renderArchiveBrowser();
    $('game-archive-browser-close').focus();
    const serial = ++archiveBrowserRequestSerial, roomId = room.id;
    try {
      let cards;
      if (seat === 'self') {
        if (!gameState) await loadGameState(true);
        if (!gameState) throw new Error('Your Archive is unavailable right now.');
        cards = gameState.archive;
      } else {
        const opponentId = room.host_id === userId ? room.guest_id : room.host_id;
        cards = await rpc('play_archive_cards', { p_room_id: roomId, p_player_id: opponentId });
      }
      if (serial !== archiveBrowserRequestSerial || room?.id !== roomId) return;
      archiveBrowserCards = (Array.isArray(cards) ? cards : []).slice().reverse().map(resolveGameCard);
      renderArchiveGallery();
    } catch (error) {
      if (serial !== archiveBrowserRequestSerial || room?.id !== roomId) return;
      archiveBrowserError = friendly(error);
    } finally {
      if (serial === archiveBrowserRequestSerial && room?.id === roomId) {
        archiveBrowserLoading = false;
        renderArchiveBrowser();
      }
    }
  }
  for (const seat of ['self', 'opponent']) {
    $(`game-${seat}-archive`).addEventListener('click', () => void openArchiveBrowser(seat));
  }
  $('game-archive-browser-close').addEventListener('click', () => closeArchiveBrowser());
  $('game-archive-browser').querySelector('.play-archive-browser-backdrop')
    .addEventListener('click', () => closeArchiveBrowser());
  function archiveCardKey(card) {
    return JSON.stringify([card.id, card.title, card.card_type, card.terrain, card.effect, card.artwork_id]);
  }
  function renderArchiveCard(seat, raw, count) {
    const preview = archivePreviews[seat];
    const card = count && raw ? (seat === 'self' ? resolveHandCard(raw) : resolveGameCard(raw)) : null;
    $(`game-${seat}-archive`)._playCard = card;
    const key = card ? archiveCardKey(card) : '';
    if (preview.key === key) return;
    preview.key = key;
    const serial = ++preview.serial;
    const canvas = $(`game-${seat}-archive-canvas`);
    const fallback = $(seat === 'self' ? 'game-archive-top' : 'game-opponent-archive-top');
    canvas.hidden = true;
    fallback.hidden = false;
    fallback.textContent = card?.title || 'ARCHIVE';
    preview.ready = null;
    if (!card) return;
    const flight = seat === 'self' ? Array.from(discardFlights).at(-1) : null;
    const landedCanvas = flight?.dataset.landed === 'true' && flight._archiveCardKey === key
      ? flight.querySelector('canvas:not([hidden])') : null;
    if (landedCanvas) {
      canvas.width = landedCanvas.width;
      canvas.height = landedCanvas.height;
      canvas.getContext('2d').drawImage(landedCanvas, 0, 0);
      canvas.hidden = false;
      fallback.hidden = true;
      return;
    }
    preview.ready = (async () => {
      const artwork = card.artwork_id ? await getArtworkUrl(card.artwork_id).catch(() => '') : '';
      const result = await renderPlayCard(canvas, card, artwork, () => serial === preview.serial);
      if (serial === preview.serial && result && !result.cancelled) {
        canvas.hidden = false;
        fallback.hidden = true;
      }
    })().catch(() => { if (serial === preview.serial) preview.key = ''; });
  }
  function captureEntityFlight(handIndex) {
    const source = $('game-hand').children[handIndex]?.querySelector('.play-hand-card');
    if (!source || $('game').hidden) return null;
    const bounds = source.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return null;
    const flight = source.cloneNode(true);
    flight.classList.remove('is-selected', 'is-queued');
    flight.classList.add('play-entity-flight');
    flight.removeAttribute('aria-label');
    flight.setAttribute('aria-hidden', 'true');
    const sourceCanvas = source.querySelector('canvas');
    const flightCanvas = flight.querySelector('canvas');
    if (sourceCanvas && flightCanvas && !sourceCanvas.hidden && sourceCanvas.width) {
      flightCanvas.width = sourceCanvas.width;
      flightCanvas.height = sourceCanvas.height;
      flightCanvas.getContext('2d').drawImage(sourceCanvas, 0, 0);
    }
    return { flight, bounds };
  }
  async function animateEntityPlacement(snapshot, targetX, targetY) {
    if (!snapshot || $('game').hidden || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const target = Array.from($('game-board').children).find(cell => cell.dataset.key === `${targetX},${targetY}`);
    if (!target) return;
    const terrain = target.getBoundingClientRect();
    if (!terrain.width || !terrain.height) return;
    const offset = parseFloat(getComputedStyle(target).getPropertyValue('--play-entity-offset')) || 0;
    const landing = target.querySelector('.play-node-entity-card')?.getBoundingClientRect() ?? {
      left: terrain.left + target.clientLeft + offset,
      top: terrain.top + target.clientTop + offset,
      width: target.clientWidth,
      height: target.clientHeight,
    };
    const { flight, bounds } = snapshot;
    flight.classList.add('play-entity-flight');
    flight.style.left = `${bounds.left}px`;
    flight.style.top = `${bounds.top}px`;
    flight.style.width = `${bounds.width}px`;
    flight.style.height = `${bounds.height}px`;
    document.body.append(flight);
    try {
      await flight.animate([
        { left: `${bounds.left}px`, top: `${bounds.top}px`, width: `${bounds.width}px`, height: `${bounds.height}px`, transform: 'rotate(-5deg)' },
        { left: `${landing.left}px`, top: `${landing.top}px`, width: `${landing.width}px`, height: `${landing.height}px`, transform: 'rotate(0deg)' },
      ], { duration: 460, easing: 'cubic-bezier(.2,.8,.2,1)' }).finished;
    } catch { /* The table may have been left while the card was moving. */ }
    finally { flight.remove(); }
  }
  function chooseEventOption(title, options, onConfirm, onCancel = hideCardPreview) {
    const dialog = document.createElement('dialog');
    dialog.className = 'play-event-choice-dialog';
    dialog.setAttribute('aria-label', title);
    const form = document.createElement('form');
    form.method = 'dialog';
    const terrainChoices = options.length > 0 && options.every(({ value }) => terrainTypes.includes(value?.terrain));
    let select;
    if (terrainChoices) {
      dialog.classList.add('play-terrain-choice-dialog');
      const heading = document.createElement('h2');
      heading.textContent = title;
      const cards = document.createElement('div');
      cards.className = 'play-terrain-choices';
      for (const [index, option] of options.entries()) {
        const card = document.createElement('button');
        card.type = 'submit';
        card.value = String(index);
        const art = document.createElement('img');
        art.src = terrainFullArtUrl(option.value.terrain);
        art.alt = '';
        const caption = document.createElement('span');
        caption.textContent = option.label;
        card.append(art, caption);
        cards.append(card);
      }
      form.append(heading, cards);
    } else {
      const label = document.createElement('label');
      label.textContent = title;
      select = document.createElement('select');
      for (const [index, option] of options.entries()) select.add(new Option(option.label, String(index)));
      label.append(select);
      const confirm = document.createElement('button');
      confirm.value = 'confirm';
      confirm.textContent = 'Confirm';
      form.append(label, confirm);
    }
    const cancel = document.createElement('button');
    cancel.value = 'cancel';
    cancel.textContent = 'Cancel';
    form.append(cancel);
    dialog.append(form);
    root.append(dialog);
    const roomId = room.id, turn = room.turn_number;
    dialog.addEventListener('close', () => {
      const index = select && dialog.returnValue === 'confirm' ? select.value : dialog.returnValue;
      const chosen = /^\d+$/.test(index) ? options[Number(index)] : null;
      dialog.remove();
      if (chosen && room?.id === roomId && room.turn_number === turn) onConfirm(chosen.value);
      else onCancel();
    }, { once: true });
    dialog.showModal();
  }
  async function chooseEntityEffect(kind, source, terrain) {
    const choices = {};
    const board = kind === 'relocate'
      ? { ...room.board, [source]: { ...room.board?.[source], terrain } }
      : room.board || {};
    const archive = gameState?.archive || [];
    for (let step = entityEffectStep(kind, board, source, choices, archive); step?.options.length;
      step = entityEffectStep(kind, board, source, choices, archive)) {
      const options = step.optional ? [{ label: 'Skip this choice', value: null }, ...step.options] : step.options;
      const choice = await new Promise(resolve => chooseEventOption(step.label, options, resolve, () => resolve()));
      if (choice === undefined) return null;
      choices[step.field] = choice?.terrain ?? choice;
    }
    return choices;
  }
  function continueExtendedEvent(event) {
    const step = extendedEventStep(event.rule[1], event.selected, {
      board: room?.board || {}, archive: gameState?.archive || [], hand: gameState?.hand || [], eventIndex: event.handIndex,
    });
    if (event.rule[1] === 'shared_canal_gathering' && event.selected.length < 2 && !step?.options.length) {
      hideCardPreview();
      blockedPlayNotice(cardPlayBlockReason(event.card) || 'Choose an adjacent Terrain to complete the Entanglement.');
      return;
    }
    if (!step || !step.options.length) {
      pendingEvent = null;
      syncEventTargets();
      eventNotice('');
      void resolveExtendedEvent(event);
      return;
    }
    if (step.options.some(option => option.value.type === 'cell')) {
      event.step = step;
      pendingEvent = event;
      syncEventTargets();
      eventNotice(`${step.label}. Press Esc to cancel.`);
      return;
    }
    pendingEvent = null;
    syncEventTargets();
    eventNotice('');
    chooseEventOption(step.label, step.options, choice => {
      event.selected.push(choice);
      continueExtendedEvent(event);
    });
  }
  function startExtendedEvent(card, handIndex, rule, targetX, targetY) {
    const event = { extended: true, card, handIndex, rule, selected: [] };
    if (targetX !== null && targetY !== null) {
      const key = `${targetX},${targetY}`;
      const first = extendedEventStep(rule[1], [], { board: room?.board || {} });
      const choice = first?.options.find(option => option.value.type === 'cell' && option.value.key === key);
      if (!choice) { blockedPlayNotice(`Choose ${rule[2]}.`); return; }
      event.selected.push(choice.value);
    }
    continueExtendedEvent(event);
  }
  async function resolveExtendedEvent(event) {
    if (!room || room.status !== 'active' || room.turn_player_id !== userId || room.turn_phase !== 'main'
      || phaseBusy || !Array.isArray(gameState?.hand)) return;
    const cardId = event.card.card_id || event.card.id;
    if (!cardId) return;
    const choices = { cells: [] };
    for (const choice of event.selected) {
      if (choice.type === 'cell') choices.cells.push(choice.key);
      else if (choice.type === 'terrain') choices.terrain = choice.terrain;
      else if (choice.type === 'archive') { choices.archive_index = choice.index; choices.archive_card_id = choice.id; }
      else if (choice.type === 'discard') { choices.discard_index = choice.index; choices.discard_card_id = choice.id; }
      else if (choice.type === 'skip') choices.skip = true;
    }
    const expected = epoch, roomId = room.id, horizon = gameState.horizon || [];
    phaseBusy = true;
    renderTurnPhase();
    try {
      const result = await rpc('play_evoke_extended_event', {
        p_room_id: roomId, p_expected_turn: room.turn_number,
        p_hand_index: event.handIndex, p_card_id: cardId,
        p_expected_hand_count: gameState.hand.length, p_choices: choices,
      });
      if (expected !== epoch || room?.id !== roomId) return;
      playTableSound(playCardSound);
      const archiveMotion = animateDiscardToArchive([event.handIndex], { reflowHand: !(result?.drawn > 0) });
      hideCardPreview();
      await archiveMotion;
      if (expected !== epoch || room?.id !== roomId) return;
      if (result?.drawn > 0) await animateCardsToHand(horizon.slice(0, result.drawn), [event.handIndex], 110);
      if (expected !== epoch || room?.id !== roomId) return;
      await refreshRoom();
      if (expected === epoch && room?.id === roomId) await loadGameState(true);
      if (expected === epoch && room?.id === roomId && discardFlights.size) await archivePreviews.self.ready;
      if (expected === epoch && room?.id === roomId) eventNotice(`${result?.title || event.card.title} evoked${result?.drawn ? ` · drew ${result.drawn}` : ''}.`, true);
    } catch (error) {
      if (expected === epoch && room?.id === roomId) {
        await refreshRoom().catch(() => {});
        await loadGameState(true).catch(() => {});
        message(friendly(error), true);
      }
    } finally {
      clearDrawFlight();
      if (expected === epoch) clearDiscardHandMotion();
      phaseBusy = false;
      renderTurnPhase();
    }
  }
  async function evokeEvent(card, handIndex, targetX = null, targetY = null, targetCells = null) {
    if (!room || room.status !== 'active' || room.turn_player_id !== userId
      || room.turn_phase !== 'main' || phaseBusy || pendingFestival || !Array.isArray(gameState?.hand)) return;
    const rule = eventSupport(card);
    if (!rule) { eventNotice(unavailableEventReason(card)); return; }
    if (extendedKinds.has(rule[1])) return startExtendedEvent(card, handIndex, rule, targetX, targetY);
    if (rule[1] === 'draw_two_discard_one' || rule[1] === 'draw_two_discard_two') return stageFestival(card, handIndex);
    if (rule[1] === 'recall_event' && !targetCells) {
      const options = (gameState.archive || []).flatMap((item, archiveIndex) => {
        const cardId = item.card_id || item.id;
        return item.card_type === 'Event' && cardId
          ? [{ label: item.title, value: { archiveIndex, cardId } }] : [];
      }).reverse();
      if (options.length) {
        chooseEventOption('Choose an Event from your Archive', options,
          choice => void evokeEvent(card, handIndex, null, null, choice));
        return;
      }
    }
    if (targetX !== null && targetY !== null && targetCells === null) {
      const key = `${targetX},${targetY}`;
      const node = room.board?.[key];
      if (rule[1] === 'reconfigure') {
        const options = terrainTypes.filter(type => type !== node?.terrain)
          .map(type => ({ label: type, value: { terrain: type } }));
        chooseEventOption('Choose the replacement Terrain', options,
          choice => void evokeEvent(card, handIndex, targetX, targetY, choice));
        return;
      }
      if (rule[1] === 'greenway' || rule[1] === 'fertile_rain') {
        const nextKeys = rule[1] === 'fertile_rain' && node?.protected ? []
          : eventNeighbors(key).filter(k => !room.board?.[k]?.terrain);
        if (nextKeys.length) {
          pendingEvent = { card, handIndex, rule, origin: [targetX, targetY], nextKeys, targets: [] };
          syncEventTargets();
          eventNotice(rule[1] === 'greenway' ? 'Choose an adjacent empty Node for the second Verdant Terrain.'
            : 'Choose an adjacent empty Node for the first Fertilize token.');
          return;
        }
        targetCells = [];
      }
    }
    if (rule[1] === 'fertilize_two' && !targetCells) {
      const legalCells = Array.from($('game-board').children).filter(cell => cell.dataset.key
        && legalEventTarget(rule[1], room?.board?.[cell.dataset.key], cell.dataset.key));
      if (legalCells.length) {
        const targets = targetX !== null && targetY !== null ? [[targetX, targetY]] : [];
        pendingEvent = { card, handIndex, rule, targets };
        syncEventTargets();
        eventNotice(targets.length ? 'Choose an empty space for the second Fertilize token. Press Esc to cancel.'
          : 'Choose an empty space for the first Fertilize token. Press Esc to cancel.');
        return;
      }
    }
    if (targetX === null && targetY === null && !targetCells
      && !['none', 'draw_from_lumens', 'clear_lumens_draw'].includes(rule[1])) {
      const legalCells = Array.from($('game-board').children).filter(cell => cell.dataset.key
        && legalEventTarget(rule[1], room?.board?.[cell.dataset.key], cell.dataset.key));
      if (legalCells.length) {
        pendingEvent = { card, handIndex, rule };
        syncEventTargets();
        eventNotice(`Choose ${rule[2]} on the board. Press Esc to cancel.`);
        return;
      }
      if (card.title === 'Beacon Grid' && rule[1] === 'lumens_two') {
        eventNotice('Beacon Grid needs Radiance Terrain.'); return;
      }
    }
    if (rule[1] === 'seed_caravan') return stageFestival(card, handIndex, targetX, targetY);
    const cardId = card.card_id || card.id;
    if (!cardId) return;
    const expected = epoch, roomId = room.id;
    const horizon = gameState.horizon || [];
    phaseBusy = true;
    renderTurnPhase();
    try {
      const result = await rpc('play_evoke_event', {
        p_room_id: roomId,
        p_expected_turn: room.turn_number,
        p_hand_index: handIndex,
        p_card_id: cardId,
        p_expected_hand_count: gameState.hand.length,
        p_target_x: targetX,
        p_target_y: targetY,
        p_target_cells: targetCells,
      });
      if (expected !== epoch || room?.id !== roomId) return;
      pendingEvent = null;
      playTableSound(playCardSound);
      const archiveMotion = animateDiscardToArchive([handIndex], { reflowHand: !(result?.drawn > 0) });
      hideCardPreview();
      await archiveMotion;
      if (expected !== epoch || room?.id !== roomId) return;
      if (result?.drawn > 0) await animateCardsToHand(horizon.slice(0, result.drawn), [handIndex], 110);
      if (expected !== epoch || room?.id !== roomId) return;
      await refreshRoom();
      if (expected === epoch && room?.id === roomId) await loadGameState(true);
      if (expected === epoch && room?.id === roomId && discardFlights.size) await archivePreviews.self.ready;
      if (expected === epoch && room?.id === roomId) eventNotice(`${result?.title || card.title} evoked${result?.drawn ? ` · drew ${result.drawn}` : ''}${result?.applied ? ' · board updated' : ''}.`, true);
    } catch (error) {
      if (expected === epoch && room?.id === roomId) {
        await refreshRoom().catch(() => {});
        await loadGameState(true).catch(() => {});
        message(friendly(error), true);
      }
    } finally {
      clearDrawFlight();
      if (expected === epoch) clearDiscardHandMotion();
      phaseBusy = false;
      renderTurnPhase();
    }
  }
  async function playEntity(card, handIndex, targetX, targetY) {
    if (!room || room.status !== 'active' || room.turn_player_id !== userId
      || room.turn_phase !== 'main' || room.main_played_entity || phaseBusy || pendingFestival
      || !Array.isArray(gameState?.hand)) return;
    const source = `${targetX},${targetY}`;
    const action = legalEntityAction(card, room.board?.[source], source);
    if (!action) { eventNotice('Choose an empty space or an unoccupied compatible Terrain.', true); return; }
    const cardId = card.card_id || card.id;
    if (!cardId) return;
    const expected = epoch, roomId = room.id, turn = room.turn_number;
    const effectKind = entityEffectKind(card, action);
    let choices = {};
    if (effectKind) {
      phaseBusy = true;
      renderTurnPhase();
      try { choices = await chooseEntityEffect(effectKind, source, entityShapeTerrain(card)); }
      finally { if (expected === epoch) { phaseBusy = false; renderTurnPhase(); } }
      if (expected !== epoch || room?.id !== roomId || room.turn_number !== turn) return;
      if (choices === null) { hideCardPreview(); return; }
      if (legalEntityAction(card, room.board?.[source], source) !== action) {
        hideCardPreview();
        blockedPlayNotice('The board has changed. Select the Entity again.');
        return;
      }
    }
    const placesEntity = action === 'place' || action === 'create_place';
    const flight = placesEntity ? captureEntityFlight(handIndex) : null;
    if (placesEntity) hideCardPreview();
    const entryEffects = {
      'Battery Orchard': 'when placed, add 2 lumens on terrain under this entity.',
      'Wood Wide Web': 'when placed, draw 1 card for each different adjacent terrain.',
      'Mossveil Settlement': 'draw 1 card for each different adjacent terrain.',
      'Solar Commons': 'draw 1 card.',
      'Terrace Keepers': 'draw 1 card. if there are 3 or more verdant adjacent terrains, draw 1 additional card.',
      'The High Seas': 'draw 1 card. if there are 3 or more adjacent flow entities, draw 1 additional card.',
      'Electrostatic Spread': 'add 1 solar counter on terrain under this entity and on each adjacent radiance terrain.',
      'Sunwire Avenue': 'add 1 lumen on each radiance terrain that has none yet.',
      'Radiant Lock': 'put a shield counter on terrain under this entity.',
      'River Pact Crossing': 'this entity can be evoked only on a non-flow terrain. both patrons draw 1 card. when shaped, draw 1 card.',
    };
    const normalizedEffect = String(card.effect || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const knownEntryEffect = entryEffects[card.title] === normalizedEffect;
    const hasOngoingEffect = beginningEffectKind(card) || (card.title === 'Depthcloak' && entityEffectKind(card, 'shape') === 'unprotect')
      || (card.title === "Nautilus's Thought" && normalizedEffect === 'while this entity is on flow terrain, it counts as 2 toward your patron’s victory goal.');
    const kupalaNight = action === 'place' && card.title === 'Kupala Night'
      && normalizedEffect === 'draw cards equal to the amount of your entanglements.';
    const previousHandCount = gameState.hand.length;
    const horizon = [...(gameState.horizon || [])];
    if (placesEntity) arrivingEntityKey = `${targetX},${targetY}`;
    phaseBusy = true;
    renderTurnPhase();
    try {
      const usesChoices = effectKind || workshopCreatesTerrain(card);
      const endpoint = usesChoices ? 'play_entity_action_with_choices'
        : action === 'create_place' ? 'play_dreamwell_courtyard' : 'play_entity_action';
      const result = await rpc(endpoint, {
        p_room_id: roomId,
        p_expected_turn: room.turn_number,
        p_hand_index: handIndex,
        p_card_id: cardId,
        p_expected_hand_count: gameState.hand.length,
        p_target_x: targetX,
        p_target_y: targetY,
        ...(usesChoices ? { p_choices: choices } : {}),
      });
      if (expected !== epoch || room?.id !== roomId) return;
      pendingEntity = null;
      if (result?.action === 'place' || result?.action === 'create_place') {
        playTableSound(playCardSound);
        await animateEntityPlacement(flight, targetX, targetY);
      }
      arrivingEntityKey = null;
      Array.from($('game-board').children).find(cell => cell.dataset.key === `${targetX},${targetY}`)
        ?.querySelector('.play-node-entity-card')?.classList.remove('is-arriving');
      if (expected !== epoch || room?.id !== roomId) return;
      await refreshRoom();
      let entityDrawn = 0;
      if (expected === epoch && room?.id === roomId && room.status === 'active' && effectKind !== 'dissolve_recall') {
        const handCount = room.host_id === userId ? room.host_hand_count : room.guest_hand_count;
        entityDrawn = Math.max(0, Math.min(horizon.length, Number(handCount) - previousHandCount + 1));
      }
      if (expected !== epoch || room?.id !== roomId) return;
      if (result?.action === 'shape') {
        const archiveMotion = animateDiscardToArchive([handIndex], { reflowHand: !entityDrawn });
        hideCardPreview();
        await archiveMotion;
      }
      if (expected === epoch && room?.id === roomId && entityDrawn) {
        await animateCardsToHand(horizon.slice(0, entityDrawn), [handIndex], 110);
      }
      if (expected === epoch && room?.id === roomId) await loadGameState(true);
      if (expected === epoch && room?.id === roomId && discardFlights.size) await archivePreviews.self.ready;
      if (expected === epoch && room?.id === roomId) eventNotice(result?.action === 'create_place'
        ? `${result?.title || card.title} created ${result?.terrain || card.terrain} Terrain and landed on it.`
        : result?.action === 'shape'
          ? knownEntryEffect && card.title === 'River Pact Crossing'
            ? `${result?.title || card.title} shaped ${result?.terrain || entityShapeTerrain(card)} Terrain · drew ${entityDrawn} card${entityDrawn === 1 ? '' : 's'}.`
            : `${result?.title || card.title} shaped ${result?.terrain || entityShapeTerrain(card)} Terrain.${effectKind ? ' Shape effect resolved.' : /\bwhen shaped\b/i.test(normalizedEffect) ? ' This Shape effect is not automated yet.' : ''}`
          : kupalaNight
            ? `${result?.title || card.title} placed · drew ${entityDrawn} card${entityDrawn === 1 ? '' : 's'} for Entanglements.`
            : knownEntryEffect || effectKind
              ? `${result?.title || card.title} placed · effect resolved${entityDrawn ? ` · drew ${entityDrawn}` : ''}.`
            : `${result?.title || card.title} placed on ${result?.terrain || room.board?.[source]?.terrain} Terrain.${normalizedEffect && !hasOngoingEffect ? ' Card-specific effects are not automated yet.' : ''}`, true);
    } catch (error) {
      if (expected === epoch && room?.id === roomId) {
        await refreshRoom().catch(() => {});
        await loadGameState(true).catch(() => {});
        message(friendly(error), true);
      }
    } finally {
      arrivingEntityKey = null;
      $('game-board').querySelector('.play-node-entity-card.is-arriving')?.classList.remove('is-arriving');
      if (expected === epoch) { clearDrawFlight(); clearDiscardHandMotion(); }
      phaseBusy = false;
      renderTurnPhase();
    }
  }
  function chooseEventTarget(column, row) {
    const event = pendingEvent;
    if (!event) return;
    const key = `${column},${row}`;
    if (event.extended) {
      const choice = event.step.options.find(option => option.value.type === 'cell' && option.value.key === key);
      if (!choice) return;
      event.selected.push(choice.value);
      pendingEvent = null;
      syncEventTargets();
      continueExtendedEvent(event);
      return;
    }
    if (event.nextKeys) {
      if (!event.nextKeys.includes(key)) return;
      event.targets.push([column, row]);
      if (event.rule[1] === 'fertile_rain' && event.targets.length === 1) {
        if (room.board?.[key]?.fertilize) event.nextKeys = event.nextKeys.filter(k => k !== key);
        if (event.nextKeys.length) {
          syncEventTargets();
          eventNotice('Choose an adjacent empty Node for the second Fertilize token.');
          return;
        }
      }
      pendingEvent = null;
      syncEventTargets();
      void evokeEvent(event.card, event.handIndex, ...event.origin, event.targets);
      return;
    }
    if (!legalEventTarget(event.rule[1], room?.board?.[key], key)) return;
    if (event.rule[1] === 'fertilize_two') {
      event.targets.push([column, row]);
      if (event.targets.length < 2) {
        eventNotice('Choose an empty space for the second Fertilize token. You may choose the same space again.');
        return;
      }
      pendingEvent = null;
      syncEventTargets();
      void evokeEvent(event.card, event.handIndex, null, null, event.targets);
      return;
    }
    pendingEvent = null;
    syncEventTargets();
    void evokeEvent(event.card, event.handIndex, column, row);
  }
  function chooseBoardTarget(column, row) {
    if (beginningTargetSource) {
      const target = `${column},${row}`;
      if (!beginningPlan().get(beginningTargetSource)?.options.includes(target)) return;
      if (beginningTargets.get(beginningTargetSource) !== target) beginningChoices.delete(beginningTargetSource);
      beginningTargets.set(beginningTargetSource, target);
      beginningTargetSource = null;
      eventNotice('');
      renderBeginningEffects(); syncEventTargets(); void saveBeginningPlan();
      return;
    }
    if (pendingEvent) { chooseEventTarget(column, row); return; }
    const entity = pendingEntity;
    if (!entity) return;
    if (!legalEntityAction(entity.card, room?.board?.[`${column},${row}`], `${column},${row}`)) return;
    pendingEntity = null;
    syncEventTargets();
    void playEntity(entity.card, entity.handIndex, column, row);
  }
  function displayedHand() {
    return pendingFestival?.hand || (Array.isArray(gameState?.hand) ? gameState.hand : []);
  }
  function renderGameHand() {
    const hand = openingDealPending() ? []
      : displayedHand().map(resolveHandCard);
    const festivalIndex = pendingFestival?.handIndex;
    const signature = JSON.stringify([hand, festivalIndex]);
    if (signature === handSignature) return;
    const previousCanvases = new Map();
    for (const item of $('game-hand').children) {
      const canvas = item.querySelector('.play-hand-card canvas');
      if (!item._cardSignature || !canvas || canvas.hidden || !canvas.width) continue;
      if (!previousCanvases.has(item._cardSignature)) previousCanvases.set(item._cardSignature, []);
      previousCanvases.get(item._cardSignature).push(canvas);
    }
    handSignature = signature;
    discardSelections.clear();
    const serial = ++gameRenderSerial;
    hideCardPreview();
    const cards = hand.map((card, index) => {
      const item = document.createElement('div'); item.className = 'play-hand-item';
      const cardSignature = JSON.stringify(card);
      item._cardSignature = cardSignature;
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'play-hand-card';
      button.dataset.handIndex = String(index);
      button.dataset.customClickSound = '';
      button.setAttribute('aria-label', card.card_type === 'Event'
        ? `Evoke ${card.title || 'Event'}` : `Select ${card.title || 'Entity'}`);
      if (index === festivalIndex) {
        button.classList.add('is-queued');
        button.setAttribute('aria-disabled', 'true');
      }
      const previousCanvas = previousCanvases.get(cardSignature)?.shift();
      const arrivingCanvas = previousCanvas ? null : arrivingCardCanvases.get(cardSignature)?.shift();
      const canvas = previousCanvas || document.createElement('canvas');
      if (arrivingCanvas) {
        canvas.width = arrivingCanvas.width;
        canvas.height = arrivingCanvas.height;
        canvas.getContext('2d').drawImage(arrivingCanvas, 0, 0);
      }
      canvas.hidden = !previousCanvas && !arrivingCanvas;
      const fallback = document.createElement('span'); fallback.className = 'play-hand-fallback';
      fallback.textContent = card.title || 'Card';
      fallback.hidden = !canvas.hidden;
      button.append(canvas, fallback);
      item.append(button);
      const mulliganBadge = document.createElement('span');
      mulliganBadge.className = 'play-mulligan-order'; mulliganBadge.hidden = true;
      item.append(mulliganBadge);
      button.addEventListener('click', () => chooseHandCard(card, button, index));
      if (canvas.hidden) void (async () => {
        const artwork = card.artwork_id ? await getArtworkUrl(card.artwork_id).catch(() => '') : '';
        const result = await renderPlayCard(canvas, card, artwork, () => serial === gameRenderSerial);
        if (serial === gameRenderSerial && result && !result.cancelled) {
          canvas.hidden = false; fallback.hidden = true;
        }
      })().catch(() => {});
      return item;
    });
    const handElement = $('game-hand');
    sizeHandGaps(handElement, cards.length);
    handElement.replaceChildren(...cards);
    arrivingCardCanvases.clear();
    requestAnimationFrame(syncHoveredCardPreview);
  }
  function clearOpponentCardFlights() {
    for (const animation of opponentCardFlights) animation.cancel();
    opponentArrivingEntities.clear();
    $('game-board').querySelectorAll('.play-node-entity-card.is-opponent-arriving')
      .forEach(entity => entity.classList.remove('is-arriving', 'is-opponent-arriving'));
  }
  async function animateOpponentCard(zone, { draw = false, card = null, title = '', delay = 0 } = {}) {
    const game = $('game');
    const canPlayLandingSound = () => !draw && visible && !inLobby && !game.hidden && !document.hidden;
    if (!visible || inLobby || game.hidden || document.hidden) return;
    const bounds = zone?.getBoundingClientRect();
    if (!bounds?.width || !bounds.height || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      if (canPlayLandingSound()) playTableSound(playCardSound);
      return;
    }
    const gameBounds = game.getBoundingClientRect();
    const top = Math.max(0, gameBounds.top);
    const dx = gameBounds.left + gameBounds.width / 2 - bounds.left - bounds.width / 2;
    const dy = top - bounds.height - bounds.top;
    const flight = document.createElement('div');
    flight.className = `play-opponent-card-flight${draw ? ' is-face-down' : ''}`;
    flight.setAttribute('aria-hidden', 'true');
    Object.assign(flight.style, {
      left: `${bounds.left}px`, top: `${bounds.top}px`,
      width: `${bounds.width}px`, height: `${bounds.height}px`,
    });
    if (!draw) flight.textContent = title || card?.title || '';
    document.body.append(flight);
    const atEdge = { transform: `translate(${dx}px, ${dy}px) rotate(${draw ? 10 : -8}deg)`, opacity: 1 };
    const atZone = { transform: 'translate(0, 0) rotate(0deg)', opacity: 1 };
    const animation = flight.animate(draw ? [atZone, atEdge] : [atEdge, atZone], {
      duration: 460, delay, easing: 'cubic-bezier(.25,.7,.25,1)', fill: 'both',
    });
    opponentCardFlights.add(animation);
    let drawSoundTimer;
    if (draw) {
      const playDrawSound = () => {
        if (opponentCardFlights.has(animation) && animation.playState === 'running'
          && visible && !inLobby && !game.hidden && !document.hidden) {
          playTableSound(drawCardSound.cloneNode());
        }
      };
      if (delay > 0) drawSoundTimer = setTimeout(playDrawSound, delay);
      else playDrawSound();
    }
    if (card && !draw) {
      const canvas = document.createElement('canvas');
      void (async () => {
        const artwork = card.artwork_id ? await getArtworkUrl(card.artwork_id).catch(() => '') : '';
        if (!flight.isConnected) return;
        const result = await renderPlayCard(canvas, card, artwork, () => flight.isConnected, flight);
        if (result && !result.cancelled && flight.isConnected) flight.replaceChildren(canvas);
      })().catch(() => {});
    }
    try {
      await animation.finished;
      if (canPlayLandingSound()) playTableSound(playCardSound);
    }
    catch { /* The match view may close during the flight. */ }
    finally {
      clearTimeout(drawSoundTimer);
      opponentCardFlights.delete(animation);
      flight.remove();
    }
  }
  function animateOpponentDraws(count, delay = 0) {
    const horizon = $('game-opponent-horizon');
    const stagger = Math.min(110, 650 / Math.max(1, count - 1));
    for (let index = 0; index < count; index++) {
      void animateOpponentCard(horizon, { draw: true, delay: delay + index * stagger });
    }
    return Math.min(650, count * 110);
  }
  function animateOpponentLogActions(rows) {
    let delay = 0;
    for (const row of rows) {
      if (!row.actor_id || row.actor_id === userId) continue;
      const draw = /^drew (\d+) cards?\.$/.exec(row.message);
      if (draw) {
        delay += animateOpponentDraws(Number(draw[1]), delay);
        continue;
      }
      const played = /^(evoked|shaped with) (.+)\.$/.exec(row.message);
      if (!played) continue;
      const card = getCards().find(item => item.title === played[2]
        && item.card_type === (played[1] === 'evoked' ? 'Event' : 'Entity'));
      void animateOpponentCard($('game-opponent-archive'), { card, title: played[2], delay });
      delay += 150;
    }
  }
  function renderEntanglementTokens() {
    const board = room.board || {};
    const links = new Set();
    const tokens = [];
    for (const [from, node] of Object.entries(board)) {
      if (!node?.terrain || !Array.isArray(node.entanglements)) continue;
      for (const to of node.entanglements) {
        if (typeof to !== 'string' || from === to || !board[to]?.terrain) continue;
        const link = [from, to].sort().join(':');
        if (links.has(link)) continue;
        links.add(link);
        const token = document.createElement('img');
        token.className = 'play-entanglement-token';
        token.src = './assets/Entanglement_Simple.png';
        token.alt = '';
        token.dataset.from = from;
        token.dataset.to = to;
        token.hidden = true;
        tokens.push(token);
      }
    }
    $('game-entanglements').replaceChildren(...tokens);
  }
  function positionEntanglementTokens() {
    const layer = $('game-entanglements');
    if (!layer.childElementCount) return;
    const frame = layer.getBoundingClientRect();
    const cells = new Map(Array.from($('game-board').children, cell => [cell.dataset.key, cell]));
    for (const token of layer.children) {
      const from = cells.get(token.dataset.from);
      const to = cells.get(token.dataset.to);
      token.hidden = !from || !to || !frame.width || !frame.height
        || from.classList.contains('is-terrain-arriving') || to.classList.contains('is-terrain-arriving');
      if (token.hidden) continue;
      const a = from.getBoundingClientRect();
      const b = to.getBoundingClientRect();
      token.style.left = `${(a.left + a.width / 2 + b.left + b.width / 2) / 2 - frame.left}px`;
      token.style.top = `${(a.top + a.height / 2 + b.top + b.height / 2) / 2 - frame.top}px`;
    }
  }
  function finishTerrainArrival(key, arrival) {
    if (terrainArrivals.get(key) !== arrival) return;
    terrainArrivals.delete(key);
    arrival.animation?.cancel();
    arrival.flight?.remove();
    $('game-board').querySelector(`[data-key="${CSS.escape(key)}"]`)?.classList.remove('is-terrain-arriving');
    positionEntanglementTokens();
  }
  function clearTerrainArrivals() {
    for (const [key, arrival] of terrainArrivals) finishTerrainArrival(key, arrival);
  }
  function animateTerrainArrivals() {
    if (!visible || inLobby || $('game').hidden) { clearTerrainArrivals(); return; }
    for (const [key, arrival] of terrainArrivals) {
      if (arrival.animation) continue;
      const cell = $('game-board').querySelector(`[data-key="${CSS.escape(key)}"]`);
      const bounds = cell?.getBoundingClientRect();
      if (!bounds?.width || !bounds.height || !cell._playTerrain) {
        finishTerrainArrival(key, arrival);
        continue;
      }
      const flight = document.createElement('img');
      flight.className = 'play-terrain-flight';
      flight.alt = '';
      flight.src = cell._playTerrain.fullArtUrl;
      Object.assign(flight.style, {
        left: `${bounds.left}px`, top: `${bounds.top}px`,
        width: `${bounds.width}px`, height: `${bounds.height}px`,
      });
      const startTop = arrival.ownTurn
        ? $('game-hand').getBoundingClientRect().top
        : Math.max(0, $('game').getBoundingClientRect().top) - bounds.height;
      document.body.append(flight);
      arrival.flight = flight;
      arrival.animation = flight.animate([
        { transform: `translateY(${startTop - bounds.top}px) scale(.92)`, opacity: .65 },
        { transform: 'translateY(0) scale(1)', opacity: 1 },
      ], { duration: 430, easing: 'cubic-bezier(.18,.7,.27,1)', fill: 'both' });
      void arrival.animation.finished.then(() => {
        if (terrainArrivals.get(key) === arrival && arrival.shaped) playTableSound(shapeSound);
        finishTerrainArrival(key, arrival);
      }, () => finishTerrainArrival(key, arrival));
    }
  }
  function renderGame() {
    if (!room || room.status !== 'active') return;
    $('game-name').textContent = room.name || 'Table';
    $('game-leave').textContent = 'Concede';
    gamePlayerCard(room.host_id === userId ? room.guest_id : room.host_id,
      room.host_id === userId ? room.guest_deck_id : room.host_deck_id, false);
    gamePlayerCard(userId, ownDeckId(), true);
    const nodes = [];
    const boardSerial = ++boardRenderSerial;
    for (let row = 0; row < 4; row++) for (let column = 0; column < 5; column++) {
      const isCenter = column === 2 && (row === 1 || row === 2);
      const node = room.board?.[`${column},${row}`];
      const cell = document.createElement('div'); cell.className = 'play-game-node';
      if (isCenter && !node?.terrain) cell.classList.add('terrain-center');
      cell.dataset.key = `${column},${row}`;
      const arrival = terrainArrivals.get(cell.dataset.key);
      if (arrival && arrival.terrain === node?.terrain) cell.classList.add('is-terrain-arriving');
      else if (arrival) finishTerrainArrival(cell.dataset.key, arrival);
      if (node?.terrain) {
        cell.classList.add(`terrain-${node.terrain.toLowerCase()}`);
        cell._playTerrain = { id: `terrain:${node.terrain.toLowerCase()}`, title: node.terrain,
          card_type: 'Terrain', terrain: node.terrain, fullArtTerrain: true,
          fullArtUrl: terrainFullArtUrl(node.terrain) };
        if (node.entity) {
          cell.classList.add('has-entity');
          const entityCard = resolveGameCard(node.entity);
          const entity = document.createElement('div'); entity.className = 'play-node-entity-card';
          entity._playCard = entityCard;
          if (arrivingEntityKey === cell.dataset.key) entity.classList.add('is-arriving');
          if (opponentArrivingEntities.has(cell.dataset.key)) entity.classList.add('is-arriving', 'is-opponent-arriving');
          entity.setAttribute('aria-hidden', 'true');
          const canvas = document.createElement('canvas'); canvas.hidden = true;
          const fallback = document.createElement('span'); fallback.textContent = entityCard.title || 'Entity';
          entity.append(canvas, fallback);
          cell.append(entity);
          void (async () => {
            const artwork = entityCard.artwork_id ? await getArtworkUrl(entityCard.artwork_id).catch(() => '') : '';
            const result = await renderPlayCard(canvas, entityCard, artwork,
              () => boardSerial === boardRenderSerial && entity.isConnected);
            if (boardSerial === boardRenderSerial && entity.isConnected && result && !result.cancelled) {
              canvas.hidden = false; fallback.hidden = true;
            }
          })().catch(() => {});
        }
        const labels = [];
        if (Number(node.lumens || 0) > 0) labels.push(`${node.lumens} ✦`);
        if (node.crisis) labels.push('Crisis');
        if (node.protected || labels.length) {
          const markers = document.createElement('div');
          markers.className = 'play-node-markers';
          markers.setAttribute('aria-hidden', 'true');
          if (node.protected) {
            const token = document.createElement('img');
            token.className = 'play-protection-token';
            token.src = './assets/Protection_Simple.png';
            token.alt = '';
            markers.append(token);
          }
          if (labels.length) {
            const badge = document.createElement('span');
            badge.className = 'play-node-marker-badge';
            badge.textContent = labels.join(' · ');
            markers.append(badge);
          }
          cell.append(markers);
        }
      }
      if (!node?.terrain && node?.fertilize) {
        cell.classList.add('is-fertilized');
        const token = document.createElement('img');
        token.className = 'play-fertilize-token';
        token.src = './assets/Fertilize_Simple.png';
        token.alt = '';
        cell.append(token);
      }
      cell.setAttribute('aria-label', node?.terrain ? `${node.terrain} Terrain at row ${row + 1}, column ${column + 1}${node.entity ? `, ${node.entity.title || 'Entity'} placed here` : ''}, ${node.lumens || 0} Lumens${node.protected ? ', Protected' : ''}${node.crisis ? ', Crisis' : ''}${node.entanglements?.length ? `, ${node.entanglements.length} Entanglement${node.entanglements.length === 1 ? '' : 's'}` : ''}`
        : node?.fertilize ? `${node.fertilize.owner_id === userId ? 'Your' : "Opponent's"} Fertilize marker on empty space at row ${row + 1}, column ${column + 1}`
          : `${isCenter ? 'Center empty space' : 'Empty space'} at row ${row + 1}, column ${column + 1}`);
      cell.addEventListener('click', event => {
        if (event.target.closest('.play-node-entity-card') && !cell.classList.contains('is-entity-target')) return;
        chooseBoardTarget(column, row);
      });
      cell.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); chooseBoardTarget(column, row); }
      });
      nodes.push(cell);
    }
    $('game-board').replaceChildren(...nodes);
    renderEntanglementTokens();
    requestAnimationFrame(syncHoveredCardPreview);
    renderBeginningEffects();
    syncEventTargets();
    requestAnimationFrame(() => {
      syncZoneCardSize();
      animateTerrainArrivals();
    });
    $('game-loading').hidden = Boolean(gameState) || gameLoadFailed;
    const reportedCount = room.host_id === userId ? room.guest_hand_count : room.host_hand_count;
    const opponentHandCount = Number.isInteger(reportedCount) ? Math.max(0, Math.min(reportedCount, 100)) : 5;
    const opponentBadge = $('game-opponent-hand-count');
    opponentBadge.hidden = !gameState;
    if (gameState) {
      opponentBadge.innerHTML = handCountIcon + String(opponentHandCount);
      opponentBadge.setAttribute('aria-label', `${opponentHandCount} cards in the opponent's hand`);
    }
    const horizon = Array.isArray(gameState?.horizon) ? gameState.horizon : [];
    const archive = Array.isArray(gameState?.archive) ? gameState.archive : [];
    const handCount = pendingFestival ? pendingFestival.hand.length - 1
      : (Array.isArray(gameState?.hand) ? gameState.hand.length : null);
    const handBadge = $('game-hand-count');
    handBadge.hidden = handCount === null;
    if (handCount !== null) {
      handBadge.innerHTML = handCountIcon + String(handCount);
      handBadge.setAttribute('aria-label', `${handCount} cards in your hand`);
    }
    $('game-self-horizon').setAttribute('aria-label', gameState ? `Your Horizon, ${horizon.length} cards` : 'Your Horizon, draw deck');
    $('game-self-horizon').dataset.count = gameState ? String(horizon.length) : '';
    $('game-self-archive').setAttribute('aria-label', gameState ? `Your Archive, ${archive.length} cards` : 'Your Archive');
    $('game-self-archive').dataset.count = gameState ? String(archive.length) : '';
    $('game-self-archive').classList.toggle('is-empty', archive.length === 0);
    $('game-self-archive').classList.toggle('has-stack', archive.length > 1);
    renderArchiveCard('self', archive.at(-1), archive.length);
    const opponentSeat = room.host_id === userId ? 'guest' : 'host';
    const opponentArchiveCount = room[`${opponentSeat}_archive_count`] || 0;
    const opponentHorizonCount = zoneCounts?.[opponentSeat]?.horizon_count;
    $('game-opponent-horizon').dataset.count = Number.isInteger(opponentHorizonCount) ? String(opponentHorizonCount) : '';
    $('game-opponent-horizon').setAttribute('aria-label', Number.isInteger(opponentHorizonCount) ? `Opponent's Horizon, ${opponentHorizonCount} cards` : "Opponent's Horizon, draw deck");
    $('game-opponent-archive').setAttribute('aria-label', `Opponent's Archive, ${opponentArchiveCount} cards`);
    $('game-opponent-archive').dataset.count = String(opponentArchiveCount);
    $('game-opponent-archive').classList.toggle('is-empty', opponentArchiveCount === 0);
    $('game-opponent-archive').classList.toggle('has-stack', opponentArchiveCount > 1);
    renderArchiveCard('opponent', room[`${opponentSeat}_archive_top`], opponentArchiveCount);
    updateAwayDisplays();
    renderGameHand();
    renderTurnPhase();
    renderOpeningRoll();
    if (gameState && room.turn_player_id === userId && room.turn_phase === 'draw' && !phaseBusy) {
      queueMicrotask(() => void finishDrawPhase());
    }
    void loadZoneCounts();
  }
  async function loadZoneCounts() {
    if (!room || room.status !== 'active' || zoneCountsRevision === room.revision || zoneCountsRequest === `${room.id}:${room.revision}`) return;
    const expected = epoch, roomId = room.id, revision = room.revision;
    zoneCountsRequest = `${roomId}:${revision}`;
    try {
      const rows = await rpc('play_zone_counts', { p_room_id: roomId });
      if (expected !== epoch || room?.id !== roomId || room.revision !== revision) return;
      zoneCounts = Object.fromEntries((rows || []).map(entry => [entry.seat, entry]));
      zoneCountsRevision = revision;
      const opponentSeat = room.host_id === userId ? 'guest' : 'host';
      const count = zoneCounts[opponentSeat]?.horizon_count;
      if (Number.isInteger(count)) {
        $('game-opponent-horizon').dataset.count = String(count);
        $('game-opponent-horizon').setAttribute('aria-label', `Opponent's Horizon, ${count} cards`);
      }
    } catch { /* The room and archive counters remain available during rollout. */ }
    finally { if (zoneCountsRequest === `${roomId}:${revision}`) zoneCountsRequest = null; }
  }
  async function loadGameState(force = false) {
    if (!room || room.status !== 'active' || gameLoadFailed) return;
    if (gameLoading) { if (force) gameReloadPending = true; return; }
    if (!force && gameState?.room_id === room.id) return;
    const id = room.id, expected = epoch;
    gameLoading = true;
    const { data, error } = await client.from('play_game_decks').select('*').eq('room_id', id).eq('player_id', userId).maybeSingle();
    if (expected !== epoch || room?.id !== id) return;
    gameLoading = false;
    if (error || !data) {
      gameLoadFailed = true;
      const setupMissing = ['42P01', 'PGRST205'].includes(error?.code)
        || /play_game_decks|schema cache/i.test(error?.message || '');
      message(setupMissing
        ? 'Opening hands are not available on the server yet. The game database update still needs to be applied.'
        : error
          ? 'Your opening hand could not be loaded. Return to the Lobby and try entering the table again.'
          : 'This table has no opening hands. Start a new table after game setup is available.', true);
    } else gameState = data;
    renderGame();
    if (gameReloadPending) { gameReloadPending = false; void loadGameState(true); }
  }
  function syncLobbyRefresh() {
    const directoryIdentity = visible && userId && (!room || inLobby) ? userId : null;
    if (directoryIdentity !== directoryUserId) {
      if (directoryChannel) void client.removeChannel(directoryChannel);
      directoryChannel = null;
      directoryUserId = directoryIdentity;
      if (directoryIdentity) {
        directoryChannel = client.channel('play-table-directory')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'play_table_directory_signals' }, () => {
            if (!room || inLobby) void listTables();
          })
          .subscribe(status => { if (status === 'SUBSCRIBED' && (!room || inLobby)) void listTables(); });
      }
    }
    if (!visible || !userId || (room && !inLobby)) {
      if (lobbyTimer) clearInterval(lobbyTimer);
      lobbyTimer = null;
    } else if (!lobbyTimer) {
      lobbyTimer = setInterval(() => { if (!document.hidden && !busy) void listTables(); }, 3000);
    }
  }
  async function listTables() {
    if (!userId || (room && !inLobby)) return;
    const expected = epoch, serial = ++listSerial;
    const { data, error } = await client.rpc('play_list_tables_with_hosts');
    if (expected !== epoch || serial !== listSerial || (room && !inLobby)) return;
    if (error) { $('no-rooms').textContent = 'Tables could not be loaded. Retrying automatically…'; $('no-rooms').hidden = false; message(friendly(error), true); return; }
    $('no-rooms').hidden = Boolean(data.length);
    $('no-rooms').textContent = 'People are doing things right now. Nobody is playing cards.';
    const signature = JSON.stringify([data, getProfiles().map(profile => [profile.id, profile.avatar_id])]);
    if (signature === tableListSignature) return;
    tableListSignature = signature;
    $('room-list').replaceChildren();
    for (const entry of data) {
      const row = document.createElement('article'); row.className = 'play-table-entry';
      row.classList.toggle('is-full', entry.player_count >= 2);
      row.classList.toggle('is-yours', entry.is_participant);
      const scene = document.createElement('div'); scene.className = 'play-table-scene';
      scene.setAttribute('aria-hidden', 'true');
      const artwork = document.createElement('img');
      artwork.className = 'play-table-art';
      artwork.src = './assets/lobby-table-host-wood-cards.png';
      artwork.alt = '';
      artwork.loading = 'lazy';
      const hostProfile = getProfiles().find(profile => profile.id === entry.host_id);
      const hostAvatar = makeAvatar(hostProfile || { display_name: entry.host_name }, 'play-table-host-avatar');
      scene.append(artwork, hostAvatar);
      const details = document.createElement('div'); details.className = 'play-table-details';
      const title = document.createElement('strong'); title.textContent = entry.name || defaultTableName(entry.host_name);
      const summary = document.createElement('span'); summary.textContent = `${entry.host_name} · ${entry.player_count} / 2 players`;
      details.append(title, summary);
      const b = document.createElement('button'); b.type = 'button';
      const full = !entry.is_participant && entry.player_count >= 2;
      b.textContent = entry.is_participant ? 'Sit down' : full ? 'Full' : 'Sit at the table';
      if (!full) b.classList.add('action-add-save');
      b.dataset.full = String(full); b.disabled = busy || full;
      if (!entry.is_participant && !full) b.dataset.customClickSound = '';
      b.setAttribute('aria-label', `${b.textContent} ${entry.code}`);
      b.addEventListener('click', () => run(async () => {
        try {
          if (!entry.is_participant) playTableSound(sitAtTableSound);
          const id = entry.is_participant ? entry.table_id : await rpc('play_join_room', { p_code: entry.code });
          await enter(id, false, true);
        } finally { if (!room) await listTables(); }
      }));
      if (entry.is_participant) {
        const action = document.createElement('div'); action.className = 'play-table-action';
        if (inLobby && room?.id === entry.table_id && awayDeadline(true)) {
          const hint = document.createElement('span'); hint.className = 'play-chair-note'; hint.id = 'play-away-note';
          hint.textContent = `Away · ${awayTime(awayDeadline(true))}`;
          action.append(hint);
        }
        action.append(b);
        row.append(scene, details, action);
      } else row.append(scene, details, b);
      $('room-list').append(row);
    }
    updateAwayDisplays();
  }
  async function refreshRoom() {
    if (!room || !userId) return;
    const id = room.id, expected = epoch, serial = ++fetchSerial;
    const { data, error } = await client.from('play_rooms').select('*').eq('id', id).maybeSingle();
    if (expected !== epoch || serial !== fetchSerial || room?.id !== id) return;
    if (error) throw error;
    const seatId = await seatedUserId(data);
    if (expected !== epoch || serial !== fetchSerial || room?.id !== id) return;
    if (!data || !seatId) {
      const wasAway = inLobby;
      await disconnect(); room = null; inLobby = false; remember(null); render(); await listTables();
      if (data) message('This table belongs to another account. Sign in with the account that joined it.');
      else message(wasAway ? 'This table is no longer available.' : 'The table was smashed.');
      return;
    }
    const turnChanged = room.turn_number !== data.turn_number || room.turn_phase !== data.turn_phase
      || room.turn_player_id !== data.turn_player_id;
    const phaseChangedWithinTurn = visible && !inLobby && !document.hidden
      && room.status === 'active' && data.status === 'active'
      && data.turn_player_id && room.turn_player_id === data.turn_player_id
      && room.turn_number === data.turn_number && room.turn_phase !== data.turn_phase
      && phaseOrder.includes(room.turn_phase) && phaseOrder.includes(data.turn_phase);
    if (pendingFestival && (data.turn_player_id !== userId || data.turn_phase !== 'main' || data.status !== 'active')) {
      pendingFestival = null;
      discardSelections.clear();
      handSignature = '';
    }
    userId = seatId;
    if (room.activated_at && !data.activated_at) {
      ++gameRenderSerial; gameState = null; gameLoading = false; gameLoadFailed = false; gameReloadPending = false; handSignature = '';
      hideCardPreview();
    }
    if (data.status === 'closed' && (data.conceded_by || data.victory_winner_id || data.victory_shared)) {
      inLobby = false;
      rememberAwayLobby(null);
    }
    const openingDiceStarted = visible && !inLobby && room.status === 'waiting'
      && data.status === 'active' && data.turn_phase === 'roll';
    const matchEnded = room.status === 'active' && data.status === 'closed'
      && Boolean(data.conceded_by || data.victory_winner_id || data.victory_shared);
    const opponentPlacement = visible && !inLobby && room.status === 'active' && data.status === 'active'
      && data.turn_player_id !== userId && data.turn_player_id === room.turn_player_id
      && data.turn_number === room.turn_number && !room.main_played_entity && data.main_played_entity
      && Object.entries(data.board || {}).find(([key, node]) =>
        node?.entity && !room.board?.[key]?.entity);
    if (opponentPlacement && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      opponentArrivingEntities.add(opponentPlacement[0]);
    }
    let playShapeImmediately = false;
    if (visible && !inLobby && room.status === 'active' && data.status === 'active') {
      const arrivals = Object.entries(data.board || {}).filter(([key, node]) => node?.terrain && !room.board?.[key]?.terrain);
      const seat = data.turn_player_id === data.host_id ? 'host' : 'guest';
      // Shape uses the turn's Entity play and puts that Entity in the Archive.
      const shaped = arrivals.length === 1 && room.turn_number === data.turn_number
        && room.turn_player_id === data.turn_player_id
        && !room.main_played_entity && data.main_played_entity
        && data[`${seat}_archive_top`]?.card_type === 'Entity'
        && data[`${seat}_archive_count`] > room[`${seat}_archive_count`];
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) playShapeImmediately = shaped;
      else {
        for (const [key, node] of arrivals) {
          terrainArrivals.set(key, { terrain: node.terrain, ownTurn: data.turn_player_id === userId, shaped });
        }
      }
    }
    if (data.status !== 'active' || inLobby) clearTerrainArrivals();
    room = data; render();
    if (phaseChangedWithinTurn) playTableSound(nextPhaseSound);
    if (opponentPlacement) {
      const [key, node] = opponentPlacement;
      const target = () => $('game-board').querySelector(`[data-key="${CSS.escape(key)}"] .play-node-entity-card`);
      const expected = epoch;
      void animateOpponentCard(target(), { card: resolveGameCard(node.entity) }).finally(() => {
        if (expected !== epoch) return;
        opponentArrivingEntities.delete(key);
        target()?.classList.remove('is-arriving', 'is-opponent-arriving');
      });
    }
    if (playShapeImmediately) playTableSound(shapeSound);
    if (openingDiceStarted) playTableSound(openingDiceSound);
    if (matchEnded) playTableSound(data.victory_shared || data.victory_winner_id === userId
      || (data.conceded_by && data.conceded_by !== userId) ? winSound : loseSound);
    if (room.status === 'active') {
      void loadGameState(turnChanged && !phaseBusy && !mulliganBusy);
      void loadGamePatrons().catch(() => { patronDeckRequest = ''; });
    }
    if (room.status === 'closed' && !room.conceded_by && !room.victory_winner_id && !room.victory_shared) {
      const timedOut = [room.host_away_until, room.guest_away_until].some(deadline => deadline && Date.parse(deadline) <= Date.now());
      const notice = timedOut ? 'The away timer expired. The table closed.' : 'The table was smashed.';
      await disconnect(); room = null; inLobby = false; remember(null); render(); await listTables(); message(notice);
    }
  }
  async function heartbeat() {
    if (!visible || document.hidden || !room || room.status === 'closed' || busy) return;
    const expected = epoch;
    try {
      if ([room.host_away_until, room.guest_away_until].some(deadline => deadline && Date.parse(deadline) <= Date.now())) {
        await rpc('play_expire_away_tables');
        await refreshRoom();
        return;
      }
      if (!inLobby && !awayDeadline(true) && Date.now() - lastHeartbeat > 18000) {
        await rpc('play_room_action', { p_room_id: room.id, p_action: 'heartbeat' });
        lastHeartbeat = Date.now();
      }
      await refreshRoom();
    } catch (error) {
      if (expected !== epoch) return;
      try { await refreshRoom(); } catch {}
      if (expected === epoch && room) { live = false; message('Connection interrupted. Reconnecting to your saved table…', true); }
    }
  }
  async function enter(id, newTable = false, resume = false) {
    await disconnect();
    room = null; inLobby = false;
    const expected = epoch;
    let { data, error } = await client.from('play_rooms').select('*').eq('id', id).maybeSingle();
    if (expected !== epoch) return;
    if (error) throw error;
    if (!data || (data.status === 'closed' && !data.conceded_by && !data.victory_winner_id && !data.victory_shared)) {
      remember(null); throw new Error('Table not found or closed.');
    }
    const seatId = await seatedUserId(data);
    if (expected !== epoch) return;
    if (!seatId) { remember(null); throw new Error('This table belongs to another account. Sign in with the account that joined it.'); }
    userId = seatId;
    const seat = data.host_id === userId ? 'host' : 'guest';
    const ownDeadline = data[`${seat}_away_until`];
    const stayInLobby = !resume && awayLobbyRoom() === id && data.status === 'active' && Boolean(ownDeadline);
    if (data.status === 'active' && ownDeadline && !stayInLobby) {
      const returned = await rpc('play_set_away', { p_room_id: id, p_away: false });
      if (!returned) {
        ({ data, error } = await client.from('play_rooms').select('*').eq('id', id).maybeSingle());
        if (error) throw error;
        if (!data || data.status !== 'closed' || (!data.conceded_by && !data.victory_winner_id && !data.victory_shared)) {
          remember(null); throw new Error('The away timer expired. The table closed.');
        }
      } else {
      ({ data, error } = await client.from('play_rooms').select('*').eq('id', id).maybeSingle());
      if (error) throw error;
      if (!data || data.status !== 'active') { remember(null); throw new Error('This table is no longer active.'); }
      }
    }
    if (!stayInLobby) rememberAwayLobby(null);
    inLobby = stayInLobby;
    let renameFailed = false;
    if (newTable && data.name?.endsWith(' table')) {
      const name = defaultTableName(data.name.slice(0, -6));
      try { await rpc('play_rename_table', { p_room_id: id, p_name: name }); data.name = name; }
      catch { renameFailed = true; }
      if (expected !== epoch) return;
    }
    room = data; lastHeartbeat = 0; remember(id); render(); maybeAutoSelectDeck();
    if (room.status === 'active') {
      void loadGameState();
      void loadGamePatrons().catch(() => { patronDeckRequest = ''; });
    }
    if (renameFailed) message('The table was created, but its name could not be updated. Use Edit Name to try again.', true);
    channel = client.channel(`play-room:${id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'play_rooms', filter: `id=eq.${id}` }, () => {
        if (expected === epoch) void refreshRoom().catch(error => message(friendly(error), true));
      }).on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'play_rooms' }, payload => {
        if (expected === epoch && payload.old?.id === id) void refreshRoom().catch(error => message(friendly(error), true));
      }).subscribe(status => {
        if (expected !== epoch) return;
        live = status === 'SUBSCRIBED';
        if (live) void refreshRoom().catch(error => message(friendly(error), true));
      });
    timer = setInterval(() => void heartbeat(), 10000);
    awayTicker = setInterval(updateAwayDisplays, 1000);
    void heartbeat();
  }
  async function action(name, payload = {}) {
    if (!room || !userId) return;
    const expected = epoch;
    await rpc('play_room_action', { p_room_id: room.id, p_action: name, p_payload: payload });
    if (expected === epoch) { message(); await refreshRoom(); }
  }
  async function concedeGame() {
    if (!room || room.status !== 'active') return;
    $('game-leave').closest('details').open = false;
    const id = room.id, expected = epoch;
    await rpc('play_concede', { p_room_id: id });
    if (expected === epoch && room?.id === id) await refreshRoom();
  }
  async function leaveGameForLobby() {
    if (!room || room.status !== 'active') return;
    $('game-back').closest('details').open = false;
    const id = room.id, expected = epoch;
    const markedAway = await rpc('play_set_away', { p_room_id: id, p_away: true });
    if (!markedAway) { await refreshRoom(); return; }
    if (expected !== epoch || room?.id !== id) return;
    rememberAwayLobby(id);
    inLobby = true;
    tableListSignature = '';
    await refreshRoom();
    if (expected === epoch && room?.id === id && inLobby) await listTables();
  }
  async function returnToLobby() {
    if (!room || room.status !== 'closed' || (!room.conceded_by && !room.victory_winner_id && !room.victory_shared)) return;
    const id = room.id;
    await rpc('play_return_to_lobby', { p_room_id: id });
    await disconnect();
    room = null; inLobby = false; tableListSignature = '';
    remember(null); rememberAwayLobby(null); render(); message();
    await listTables();
  }
  async function leaveTable() {
    if (!room) return;
    const id = room.id;
    if (room.status !== 'closed') await rpc('play_room_action', { p_room_id: id, p_action: 'leave', p_payload: {} });
    await disconnect();
    room = null; inLobby = false; tableListSignature = '';
    remember(null); render(); message();
    await listTables();
  }
  async function smashWaitingTable() {
    if (!room || room.status !== 'waiting' || room.host_id !== userId) return;
    playTableSound(smashTableSound);
    await rpc('play_smash_waiting_table', { p_room_id: room.id });
    await disconnect();
    room = null; inLobby = false; tableListSignature = '';
    remember(null); render(); message();
    await listTables();
  }
  function makeDeckFactionLabel(text, { faction, src }) {
    const label = document.createElement('span');
    label.className = 'play-deck-faction-label';
    if (src) {
      const icon = document.createElement('img');
      icon.className = 'play-deck-faction';
      icon.src = src;
      icon.alt = faction;
      label.append(icon);
    }
    const name = document.createElement('span');
    name.textContent = text;
    label.append(name);
    return label;
  }
  function refreshCollections() {
    const decks = getDecks();
    const value = pendingDeckId || (deckSaveInFlight ? $('deck').value : room ? ownDeckId() : $('deck').value);
    const factionIcons = decks.map(deck => getPatronFactionIcon(deck.patron_name));
    if (decks.length !== $('deck').options.length || decks.some((deck, index) =>
      String(deck.id) !== $('deck').options[index]?.value || deck.name !== $('deck').options[index]?.text
      || factionIcons[index].src !== $('deck').options[index]?.dataset.factionIcon)) {
      const options = decks.map((deck, index) => {
        const option = new Option(deck.name, deck.id);
        option.dataset.factionIcon = factionIcons[index].src;
        return option;
      });
      $('deck').replaceChildren(...options);
      $('deck-options').replaceChildren(...options.map((option, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.deckId = option.value;
        button.append(makeDeckFactionLabel(option.text, factionIcons[index]));
        button.addEventListener('click', () => {
          if ($('deck').disabled) return;
          $('deck-picker').open = false;
          $('deck-trigger').focus();
          if ($('deck').value === option.value) return;
          $('deck').value = option.value;
          $('deck').dispatchEvent(new Event('change'));
        });
        return button;
      }));
    }
    $('deck').value = decks.some(deck => deck.id === value) ? value : (decks[0]?.id || '');
    updateDeckCover();
    controls();
    maybeAutoSelectDeck();
    if (room?.status === 'active' && !inLobby) renderGame();
  }
  function updateDeckCover() {
    const deck = getDecks().find(item => String(item.id) === $('deck').value);
    const patron = $('deck-patron');
    patron.hidden = !deck;
    patron.textContent = deck ? deck.patron_name || 'Patron unavailable' : '';
    $('deck-trigger').replaceChildren(
      makeDeckFactionLabel(deck?.name || 'No decks available', getPatronFactionIcon(deck?.patron_name))
    );
    for (const button of $('deck-options').children) {
      if (button.dataset.deckId === $('deck').value) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    }
    const image = $('deck-cover');
    image.hidden = !deck;
    if (!deck) return;
    image.src = './assets/site-background.jpg';
    if (!deck.cover_artwork_id) return;
    const artworkId = deck.cover_artwork_id;
    void getArtworkUrl(artworkId).then(url => {
      if ($('deck').value === String(deck.id) && getDecks().some(item => String(item.id) === String(deck.id) && item.cover_artwork_id === artworkId)) image.src = url;
    }).catch(() => {});
  }
  function render() {
    syncLobbyRefresh();
    root.classList.toggle('is-at-table', Boolean(userId && room && !inLobby));
    const finished = Boolean(userId && room?.status === 'closed'
      && (room.conceded_by || room.victory_winner_id || room.victory_shared));
    const playing = Boolean(userId && ((room?.status === 'active' && !inLobby) || finished));
    if (!playing) { hideCardPreview(); closeArchiveBrowser(false); }
    if (!playing || finished) clearOpponentCardFlights();
    $('signin').hidden = Boolean(userId);
    $('lobby').hidden = !userId || Boolean(room && !inLobby);
    $('session').hidden = !userId || !room || playing || inLobby;
    $('game').hidden = !playing;
    $('game-result').hidden = !finished;
    if (playing) void loadGameLog();
    if (finished) {
      const winnerId = room.victory_winner_id || (room.conceded_by === room.host_id ? room.guest_id : room.host_id);
      const loserId = winnerId === room.host_id ? room.guest_id : room.host_id;
      const playerName = id => getProfiles().find(profile => profile.id === id)?.display_name || 'Player';
      $('game-result-title').textContent = room.victory_shared ? 'Shared Victory'
        : winnerId === userId ? 'You Won' : 'You Lost';
      $('game-result-detail').textContent = room.victory_shared
        ? `${playerName(room.host_id)} and ${playerName(room.guest_id)} fulfilled their Patron visions together.`
        : `${playerName(winnerId)} won. ${playerName(loserId)} lost.${room.victory_winner_id ? ' A Patron vision was fulfilled.' : ''}`;
    }
    if (!room) { controls(); return; }
    if (inLobby) { updateAwayDisplays(); controls(); return; }
    $('room-code').textContent = room.code;
    $('room-name').textContent = room.name || defaultTableName(getProfiles().find(p => p.id === room.host_id)?.display_name);
    $('edit-name').hidden = room.host_id !== userId || room.status === 'closed';
    $('leave').textContent = room.host_id === userId ? 'Smash Table' : 'Leave Table';
    let hasSeat = false;
    const playerRows = $('players');
    const rows = ['host', 'guest'].map(seat => {
      const id = room[`${seat}_id`];
      const deck = getDecks().find(d => d.id === room[`${seat}_deck_id`]);
      const profile = getProfiles().find(p => p.id === id);
      const own = id === userId;
      let row = Array.from(playerRows.children).find(item => item.dataset.seat === seat
        && item.dataset.playerId === String(id || '') && item.dataset.own === String(own));
      if (!row) {
        row = document.createElement('div'); row.className = 'play-player';
        row.dataset.seat = seat; row.dataset.playerId = String(id || ''); row.dataset.own = String(own);
        const avatar = id ? makeAvatar(profile || { display_name: 'Player' }, 'play-avatar') : document.createElement('span');
        if (!id) { avatar.className = 'user-avatar play-avatar'; avatar.textContent = '?'; }
        avatar.setAttribute('aria-hidden', 'true');
        const details = document.createElement('div'); details.className = 'play-player-details';
        details.append(document.createElement('strong'));
        if (own) {
          const controls = document.createElement('div'); controls.className = 'play-player-controls';
          controls.append(deckField, readyButton); details.append(controls);
        } else details.append(document.createElement('span'));
        row.append(avatar, details);
      }
      row.querySelector('.play-player-details > strong').textContent = id
        ? `${profile?.display_name || 'Player'}${own ? ' · You' : ''}` : 'Waiting for someone to bring a chair.';
      if (own) hasSeat = true;
      else {
        const patronName = room[`${seat}_deck_id`] ? room[`${seat}_patron_name`] || deck?.patron_name : '';
        const label = patronName || (room[`${seat}_deck_id`] ? 'Patron unavailable' : 'No deck selected');
        row.querySelector('.play-player-details > span').replaceChildren(
          makeDeckFactionLabel(label, getPatronFactionIcon(patronName))
        );
      }
      const state = room.status === 'closed' ? 'Closed' : room[`${seat}_ready`] ? 'Ready' : '';
      let status = row.querySelector(':scope > .play-pill');
      if (id && state && !(own && state === 'Ready')) {
        if (!status) { status = document.createElement('span'); row.append(status); }
        status.className = `play-pill${state === 'Ready' ? ' is-live' : ''}`;
        status.textContent = state;
      } else status?.remove();
      return row;
    });
    if (!hasSeat && deckField.parentElement !== $('controls-parking')) $('controls-parking').append(deckField, readyButton);
    rows.forEach((row, index) => {
      const current = playerRows.children[index];
      if (current && current !== row) current.replaceWith(row);
      else if (!current) playerRows.append(row);
    });
    while (playerRows.children.length > rows.length) playerRows.lastElementChild.remove();
    const mine = room.host_id === userId ? 'host' : 'guest';
    const selectedDeckId = pendingDeckId || (deckSaveInFlight ? $('deck').value : room[`${mine}_deck_id`]);
    $('deck').value = getDecks().some(deck => String(deck.id) === String(selectedDeckId))
      ? selectedDeckId : (getDecks()[0]?.id || '');
    updateDeckCover();
    const isReady = room[`${mine}_ready`];
    $('ready').textContent = isReady ? 'Not Ready' : 'Ready';
    $('ready').classList.toggle('action-add-save', !isReady);
    $('ready').classList.toggle('action-delete', isReady);
    $('ready').setAttribute('aria-pressed', String(isReady));
    $('room-status').textContent = room.status === 'closed' ? 'Table closed' : room.status === 'active' ? 'Both players are ready for a duel to the death.' : room.guest_id ? "Pick your decks. The table won't play itself." : '';
    controls();
    if (room.status === 'closed') $('leave').disabled = false;
    if (playing && !finished) renderGame();
  }

  for (const id of ['create', 'back', 'leave', 'ready', 'opening-roll-button', 'game-back', 'game-result-back', 'game-next-phase', 'game-extra-draw']) {
    $(id).dataset.customClickSound = '';
  }
  $('signin-button').addEventListener('click', requireSignIn);
  $('create').addEventListener('click', () => {
    if (busy) return;
    void playBuildTableSound();
    void run(async () => {
      await refreshIdentity();
      if (!userId) throw new Error('Sign in to create a table.');
      const id = await rpc('play_create_room');
      await enter(id, true);
    });
  });
  for (const [button, action] of [['back', leaveTable], ['game-back', leaveGameForLobby], ['game-result-back', returnToLobby]]) {
    $(button).addEventListener('click', () => run(() => {
      playTableSound(backToLobbySound);
      return action();
    }));
  }
  $('leave').addEventListener('click', () => run(() => {
    if (!room) return;
    if (room.host_id === userId) return smashWaitingTable();
    playTableSound(leaveTableSound);
    return leaveTable();
  }));
  $('game-leave').addEventListener('click', () => run(concedeGame));
  async function saveDeckSelection() {
    if (deckSaveInFlight) return;
    deckSaveInFlight = true;
    controls();
    const expected = epoch, roomId = room?.id;
    try {
      while (pendingDeckId && expected === epoch && room?.id === roomId && !ownReady()) {
        const deckId = pendingDeckId;
        pendingDeckId = null;
        if (String(ownDeckId()) !== String(deckId)) await action('deck', { deck_id: deckId });
      }
    } catch (error) {
      pendingDeckId = null;
      message(friendly(error), true);
      await refreshRoom().catch(() => {});
    } finally {
      deckSaveInFlight = false;
      controls();
    }
  }
  $('deck-trigger').addEventListener('click', event => {
    if ($('deck').disabled) event.preventDefault();
  });
  $('deck-picker').addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !$('deck-picker').open) return;
    event.stopPropagation();
    $('deck-picker').open = false;
    $('deck-trigger').focus();
  });
  document.addEventListener('click', event => {
    if (!$('deck-picker').contains(event.target)) $('deck-picker').open = false;
  });
  $('deck').addEventListener('change', () => {
    if (busy || ownReady()) { $('deck').value = ownDeckId() || ''; updateDeckCover(); return; }
    updateDeckCover();
    if ($('deck').value) {
      pendingDeckId = $('deck').value;
      void saveDeckSelection();
    }
  });
  $('ready').addEventListener('click', () => {
    const deckId = $('deck').value;
    if (!ownReady() && !deckId) return message('Create a deck before getting ready.', true);
    void run(async () => {
      const wasReady = ownReady();
      playTableSound(wasReady ? notReadySound : readySound);
      if (!wasReady && ownDeckId() !== deckId) await action('deck', { deck_id: deckId });
      await action('ready');
    });
  });
  $('edit-name').addEventListener('click', () => {
    $('name-input').value = $('room-name').textContent;
    $('name-form').hidden = false;
    $('name-input').focus();
    $('name-input').select();
  });
  $('cancel-name').addEventListener('click', () => { $('name-form').hidden = true; });
  $('name-form').addEventListener('submit', event => {
    event.preventDefault();
    const name = $('name-input').value.trim();
    if (!name || !canAct()) return;
    void run(async () => {
      await rpc('play_rename_table', { p_room_id: room.id, p_name: name });
      $('room-name').textContent = name;
      $('name-form').hidden = true;
      await refreshRoom();
    });
  });
  async function refreshIdentity() {
    const next = getUser()?.id || null;
    if (next === userId) return;
    userId = next; room = null; inLobby = false; tableListSignature = '';
    const pendingDisconnect = disconnect();
    $('room-list').replaceChildren(); render(); refreshCollections();
    await pendingDisconnect;
    if (userId !== next) return;
    if (!userId) return;
    if (visible && !busy) { const id = savedRoom(); if (id) void run(() => enter(id)); else await listTables(); }
  }
  function setVisible(value) {
    const wasVisible = visible;
    visible = value;
    syncLobbyRefresh();
    if (!value) {
      clearTerrainArrivals();
      clearOpponentCardFlights();
      if (wasVisible && room?.status === 'active' && !inLobby) void run(goAway);
      return;
    }
    refreshCollections();
    if (!userId) { render(); return; }
    if (room) {
      void heartbeat();
      if (inLobby) void listTables();
    }
    else { const id = savedRoom(); if (id) void run(() => enter(id)); else void listTables(); }
  }
  render();
  return { refreshIdentity, refreshCollections, setVisible };
}
