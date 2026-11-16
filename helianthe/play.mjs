const defaultTableName = hostName => `${Array.from(String(hostName ?? '').trim() || 'Player').slice(0, 52).join("")}'s Table`;

export function playerOnline(timestamp, now = Date.now()) {
  return Boolean(timestamp && now - Date.parse(timestamp) < 45000);
}

export function createPlayView({ client, getUser, getDecks, getCards, getProfiles, makeAvatar, requireSignIn, renderCard, getArtworkUrl, getPatronCard, getDefaultPatronName }) {
  const root = document.querySelector('#play-view');
  const $ = id => root.querySelector(`#play-${id}`);
  let userId = null, room = null, channel = null, timer = null, awayTicker = null, visible = false, inLobby = false;
  let lobbyTimer = null, directoryChannel = null, directoryUserId = null, listSerial = 0, tableListSignature = '';
  let busy = false, epoch = 0, fetchSerial = 0, live = false, lastHeartbeat = 0, autoDeckPending = false;
  let gameState = null, gameLoading = false, gameLoadFailed = false, gameReloadPending = false, handSignature = '', gameRenderSerial = 0, boardRenderSerial = 0, cardPreviewSerial = 0;
  let phaseBusy = false, selectedCardElement = null, patronDeckRequest = '', patronDeckLoadedAt = 0;
  let openingRollBusy = false, openingRollError = '', openingMatchKey = '', openingWasRolling = false;
  let openingRevealTimer = null, openingTieTimer = null, openingTieRound = 0, openingPanelAnimatedKey = '';
  let openingShuffleTimer = null, openingVisualDice = [1, 1];
  const openingAnimatedValues = { host: null, guest: null };
  let drawRetryAt = 0, activeDrawFlight = null, activeHandShifts = [];
  let beginningTurnKey = '', beginningOrder = [], beginningTargetSource = null;
  const beginningTargets = new Map();
  let archiveBrowserSeat = null, archiveBrowserCards = [], archiveBrowserIndex = 0;
  let archiveBrowserRequestSerial = 0, archiveBrowserCardSerial = 0, archiveBrowserOpener = null;
  let archiveBrowserLoading = false, archiveBrowserError = '';
  let archiveGalleryObserver = null;
  let selectedGameCard = null, selectedHandIndex = null, pendingEvent = null, pendingEntity = null, pendingFestival = null, arrivingEntityKey = null, zoneCounts = null, zoneCountsRevision = null, zoneCountsRequest = null, eventNoticeTimer = null;
  const discardSelections = new Set();
  const gameDeckPatrons = new Map(), gamePlayerPatrons = new Map();
  const patronPreviews = { self: { key: '', serial: 0 }, opponent: { key: '', serial: 0 } };
  const archivePreviews = { self: { key: null, serial: 0 }, opponent: { key: null, serial: 0 } };
  const diePips = Array.from({ length: 9 }, () => '<span></span>').join('');
  root.innerHTML = `
    <div class="play-heading"><h1>Lobby</h1></div>
    <div id="play-message" role="status" aria-live="polite" hidden><span id="play-message-text"></span><button id="play-message-close" type="button" aria-label="Dismiss message">×</button></div>
    <section id="play-signin" class="play-surface" hidden><h2>Your seat is waiting</h2><p>Sign in to create a table or join one from the list.</p><button id="play-signin-button" class="action-add-save" type="button">Sign in to play</button></section>
    <div id="play-lobby" class="play-lobby" hidden>
      <section class="play-surface play-create-panel"><div><span class="play-eyebrow">HOST A SESSION</span><button id="play-create" class="action-add-save" type="button">Build a table</button></div></section>
      <section class="play-surface play-recent"><div class="play-table-heading"><h2>All tables</h2></div><p id="play-no-rooms">Loading tables…</p><div id="play-room-list"></div></section>
    </div>
    <section id="play-session" hidden>
      <button id="play-back" class="back-to-decks" type="button"><span aria-hidden="true">←</span> Back to Lobby</button>
      <div class="play-room-bar"><div class="play-room-identity"><span class="play-eyebrow">TABLE</span><div class="play-room-name-line"><strong id="play-room-name"></strong><button id="play-edit-name" class="action-cancel" type="button">Edit name</button></div><form id="play-name-form" hidden><input id="play-name-input" aria-label="Table name" maxlength="60" required><button type="submit">Save</button><button id="play-cancel-name" type="button">Cancel</button></form><span class="play-room-code-line">Code: <strong id="play-room-code"></strong></span></div><div class="play-room-actions"><details class="play-table-menu"><summary class="play-menu-toggle" aria-label="Table actions" title="Table actions"><svg class="play-menu-bars" aria-hidden="true" viewBox="0 0 22 22"><path d="M3 5h16 M3 11h16 M3 17h16"/></svg></summary><div class="play-table-menu-panel"><button id="play-leave" class="action-delete" type="button">Concede &amp; Walk Out</button></div></details></div></div>
      <div id="play-players" class="play-players"></div>
      <label id="play-deck-field" class="play-deck-field" for="play-deck">Your deck<select id="play-deck"><option value="">No decks available</option></select></label>
      <button id="play-ready" class="action-add-save" type="button">Ready</button>
      <div id="play-controls-parking" hidden></div>
      <p id="play-room-status" role="status"></p>
    </section>
    <section id="play-game" hidden>
      <div class="play-game-player-block">
      <div class="play-game-opponent-footer"><div class="play-game-opponent-identity play-game-player-identity"><div class="play-game-identity-name"><strong id="play-game-opponent-name"></strong><span id="play-game-opponent-presence" class="play-away-pill" hidden></span></div><span id="play-game-opponent-hand-count" class="play-game-hand-count" aria-live="polite" hidden></span></div><div class="play-game-actions"><details class="play-table-menu"><summary class="play-menu-toggle" aria-label="Table actions" title="Table actions"><svg class="play-menu-bars" aria-hidden="true" viewBox="0 0 22 22"><path d="M3 5h16 M3 11h16 M3 17h16"/></svg></summary><div class="play-table-menu-panel"><strong id="play-game-name" class="play-menu-table-name"></strong><button id="play-game-back" class="play-menu-lobby" type="button">Back to Lobby</button><button id="play-game-restart" type="button">Restart</button><button id="play-game-leave" type="button">Smash Table</button></div></details></div></div>
      </div>
      <div class="play-game-board-wrap">
      <div id="play-game-event-notice" class="play-game-event-notice" role="status" aria-live="polite" hidden><span id="play-game-event-notice-text"></span><button id="play-game-event-notice-close" type="button" aria-label="Dismiss message" hidden>×</button></div>
      <div id="play-game-discard-bar" class="play-game-discard-bar" hidden><strong id="play-game-discard-text" role="status" aria-live="polite"></strong><button id="play-game-confirm-discard" type="button" disabled>Confirm Discard</button></div>
      <aside id="play-game-beginning-effects" class="play-beginning-effects" aria-label="Beginning of Turn Entity effects" hidden><strong>Beginning of Turn effects</strong><p id="play-game-beginning-instructions"></p><ol id="play-game-beginning-list"></ol><button id="play-game-resolve-beginning" type="button">Resolve effects in this order</button></aside>
      <aside id="play-game-card-preview" class="play-game-card-preview" aria-label="Card preview" hidden><button id="play-game-card-preview-close" class="play-game-card-preview-close action-delete" type="button" aria-label="Close card preview">×</button><canvas id="play-game-card-preview-canvas" hidden></canvas><span id="play-game-card-preview-fallback" class="play-hand-fallback"></span></aside>
      <div class="play-game-table">
        <div class="play-game-zones-left">
          <div class="play-game-zone play-game-zone-opponent-patron"><button id="play-game-opponent-patron-slot" class="play-game-patron-slot" type="button" aria-label="Preview opponent's Patron"><canvas id="play-game-opponent-patron" hidden></canvas><span id="play-game-opponent-patron-fallback" class="play-game-patron-fallback" aria-hidden="true"></span></button></div>
          <div class="play-game-zone-pair play-game-zone-pair-self" aria-label="Your card zones"><div class="play-game-zone play-game-zone-horizon"><div id="play-game-self-horizon" class="play-deck-stack" role="img" aria-label="Your Horizon, draw deck"></div></div><div class="play-game-zone play-game-zone-archive"><button id="play-game-self-archive" class="play-game-archive-card is-empty" type="button" aria-label="Browse your Archive"><canvas id="play-game-self-archive-canvas" aria-hidden="true" hidden></canvas><span id="play-game-archive-top"></span></button></div></div>
        </div>
        <div id="play-game-board" class="play-game-board" role="group" aria-label="Shared five-column, four-row Terrain board"></div>
        <div class="play-game-zones-right">
          <div class="play-game-zone-pair play-game-zone-pair-opponent" aria-label="Opponent's card zones"><div class="play-game-zone play-game-zone-archive"><button id="play-game-opponent-archive" class="play-game-archive-card is-empty" type="button" aria-label="Browse opponent's Archive"><canvas id="play-game-opponent-archive-canvas" aria-hidden="true" hidden></canvas><span id="play-game-opponent-archive-top"></span></button></div><div class="play-game-zone play-game-zone-horizon"><div id="play-game-opponent-horizon" class="play-deck-stack" role="img" aria-label="Opponent's Horizon, draw deck"></div></div></div>
          <div class="play-game-zone play-game-zone-self-patron"><button id="play-game-self-patron-slot" class="play-game-patron-slot" type="button" aria-label="Preview your Patron"><canvas id="play-game-self-patron" hidden></canvas><span id="play-game-self-patron-fallback" class="play-game-patron-fallback" aria-hidden="true"></span></button></div>
        </div>
      </div>
      <aside id="play-game-phases" class="play-game-phases" aria-label="Turn phases" hidden>
        <p id="play-game-turn-owner" class="play-game-turn-owner" aria-live="polite"></p>
        <ol class="play-game-phase-list">
          <li data-phase="0"><span class="play-game-phase-marker" aria-hidden="true"></span>Beginning of Turn</li>
          <li data-phase="1"><span class="play-game-phase-marker" aria-hidden="true"></span>Draw</li>
          <li data-phase="2"><span class="play-game-phase-marker" aria-hidden="true"></span>Main Phase</li>
          <li data-phase="3"><span class="play-game-phase-marker" aria-hidden="true"></span>End of Turn</li>
        </ol>
        <div class="play-game-phase-actions">
          <button id="play-game-extra-draw" class="play-game-next-phase play-game-extra-draw" type="button" aria-label="Draw one card instead of playing and go to End of Turn" hidden>Draw Instead</button>
          <button id="play-game-next-phase" class="play-game-next-phase" type="button">Next Phase</button>
        </div>
      </aside></div>
      <div id="play-opening-roll" class="play-opening-roll" role="dialog" aria-modal="true" aria-labelledby="play-opening-roll-title" hidden><div class="play-opening-roll-panel"><p class="play-eyebrow">WHO GOES FIRST?</p><h2 id="play-opening-roll-title">Opening Dice</h2><p id="play-opening-roll-status" class="play-opening-roll-status" role="status" aria-live="polite"></p><div id="play-opening-dice" class="play-opening-dice" hidden><div class="play-opening-die-seat"><strong id="play-opening-host-name"></strong><div id="play-opening-host-pair" class="play-opening-die-pair" hidden><div id="play-opening-host-die-1" class="play-opening-die" aria-label="Host's first die">${diePips}</div><div id="play-opening-host-die-2" class="play-opening-die" aria-label="Host's second die">${diePips}</div></div><span id="play-opening-host-total" class="play-opening-total" hidden></span></div><div class="play-opening-die-seat"><strong id="play-opening-guest-name"></strong><div id="play-opening-guest-pair" class="play-opening-die-pair" hidden><div id="play-opening-guest-die-1" class="play-opening-die" aria-label="Guest's first die">${diePips}</div><div id="play-opening-guest-die-2" class="play-opening-die" aria-label="Guest's second die">${diePips}</div></div><span id="play-opening-guest-total" class="play-opening-total" hidden></span></div></div><button id="play-opening-roll-button" type="button">Roll a Dice</button><p id="play-opening-roll-error" class="play-opening-roll-error" role="alert" hidden></p></div></div>
      <div id="play-game-archive-browser" class="play-archive-browser" hidden><div class="play-archive-browser-backdrop"></div><section class="play-archive-browser-panel" role="dialog" aria-modal="true" aria-labelledby="play-game-archive-browser-title"><header><div><h2 id="play-game-archive-browser-title">Archive</h2><p id="play-game-archive-browser-status" role="status" aria-live="polite"></p></div><button id="play-game-archive-browser-close" class="play-archive-browser-close" type="button" aria-label="Close Archive">×</button></header><div class="play-archive-browser-body"><div class="play-archive-browser-view"><div class="play-archive-browser-card"><canvas id="play-game-archive-browser-canvas" hidden></canvas><span id="play-game-archive-browser-fallback"></span></div><div class="play-archive-browser-navigation"><button id="play-game-archive-browser-previous" type="button">Previous</button><span id="play-game-archive-browser-position"></span><button id="play-game-archive-browser-next" type="button">Next</button></div></div><ol id="play-game-archive-browser-list" class="play-archive-browser-list" aria-label="Cards in Archive"></ol></div></section></div>
      <div class="play-game-player-block">
      <div class="play-game-self-identity play-game-player-identity"><div class="play-game-identity-name"><strong id="play-game-self-name"></strong><span id="play-game-self-presence" class="play-away-pill" hidden></span></div><span id="play-game-hand-count" class="play-game-hand-count" aria-live="polite" hidden></span></div>
      <section id="play-game-self" class="play-surface play-game-seat" aria-label="Your area">
        <div class="play-game-hand-wrap"><p id="play-game-loading" role="status">Preparing the opening hands…</p><div id="play-game-hand" class="play-game-hand"></div></div>
      </section>
      </div>
    </section>`;
  function syncZoneCardSize() {
    const cell = $('game-board').firstElementChild;
    if (!cell) return;
    const bounds = cell.getBoundingClientRect();
    const { width, height } = bounds;
    if (!width || !height) return;
    root.style.setProperty('--play-map-card-width', `${width}px`);
    root.style.setProperty('--play-map-card-height', `${height}px`);
    const boardWrap = root.querySelector('.play-game-board-wrap');
    const wrapBounds = boardWrap.getBoundingClientRect();
    const boardBounds = $('game-board').getBoundingClientRect();
    $('game-event-notice').style.top = `${bounds.top - wrapBounds.top - 8}px`;
    $('game-discard-bar').style.left = `${boardBounds.left + boardBounds.width / 2 - wrapBounds.left}px`;
    $('game-discard-bar').style.top = `${boardBounds.top + boardBounds.height / 2 - wrapBounds.top}px`;
  }
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(syncZoneCardSize).observe($('game-board'));
  }
  const deckField = $('deck-field');
  const readyButton = $('ready');
  const patronMarkerColors = { Flow: '#4b9ab7', Radiance: '#d4a13e', Symbiosis: '#9c71bc', Verdant: '#5d9c69' };
  const phaseOrder = ['beginning', 'draw', 'main', 'end'];
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
  function eventSupport(card) {
    if (card?.card_type === 'Event' && !String(card.effect || '').trim()) return ['', 'none', ''];
    const rule = eventEffects[card?.title];
    return rule && String(card?.effect || '').replace(/\s+/g, ' ').trim().toLowerCase() === rule[0] ? rule : null;
  }
  function eventNotice(text, temporary = false, error = false, dismissible = false) {
    if (eventNoticeTimer) clearTimeout(eventNoticeTimer);
    const notice = $('game-event-notice');
    $('game-event-notice-text').textContent = text || '';
    notice.hidden = !text;
    notice.classList.toggle('error', Boolean(text && error));
    notice.classList.toggle('is-message', Boolean(text && dismissible));
    $('game-event-notice-close').hidden = !text || !dismissible;
    if (text && temporary) eventNoticeTimer = setTimeout(() => { notice.hidden = true; eventNoticeTimer = null; }, 4500);
  }
  $('game-event-notice-close').addEventListener('click', () => eventNotice(''));
  function legalEventTarget(kind, node) {
    if (kind === 'fertilize_two' || kind === 'fertilize_draw') return !node?.terrain;
    if (kind === 'fertilize_existing_draw') return !node?.terrain && Boolean(node?.fertilize);
    if (!node?.terrain) return false;
    if (kind === 'protect') return true;
    if (kind === 'unprotect_entity') return Boolean(node.entity && node.protected);
    if (kind === 'protect_radiance_draw') return node.terrain === 'Radiance' && Number(node.lumens || 0) >= 1;
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
  function legalEntityAction(card, node, key) {
    if (room?.turn_player_id !== userId || room?.turn_phase !== 'main' || room?.main_played_entity
      || !terrainTypes.includes(card?.terrain)) return null;
    if (!node?.terrain) return node?.entity || !canCreateTerrainAt(key)
      ? null : (terrainTypes.includes(entityShapeTerrain(card)) ? 'shape' : null);
    if (node.entity) return null;
    if (!terrainTypes.includes(node.terrain)) return null;
    const effect = String(card.effect || '').replace(/\s+/g, ' ').toLowerCase();
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
    if (card?.title === 'Orchard Warden'
      && effect === 'at the beginning of your turn fertilize 1 on adjacent node.') return 'orchard_warden';
    if (card?.title === 'Expansive Ivy'
      && effect === 'at the beginning of your every turn fertilize an adjacent node with no terrain. then if there are 4 or more adjacent verdant terrains, draw a card.') return 'expansive_ivy';
    return null;
  }
  function beginningEffects() {
    if (room?.status !== 'active' || room.turn_phase !== 'beginning'
      || room.beginning_effects_resolved_turn === room.turn_number) return [];
    return Object.entries(room.board || {}).filter(([key, node]) => /^[0-4],[0-3]$/.test(key)
      && node?.entity?.owner_id === room.turn_player_id && beginningEffectKind(node.entity))
      .map(([source, node]) => ({ source, card: { ...resolveGameCard(node.entity),
        title: node.entity.title, effect: node.entity.effect } }))
      .sort((a, b) => Number(a.source.split(',')[1]) - Number(b.source.split(',')[1])
        || Number(a.source.split(',')[0]) - Number(b.source.split(',')[0]));
  }
  function beginningPlan() {
    const terrain = new Set(Object.entries(room?.board || {}).filter(([, node]) => node?.terrain).map(([key]) => key));
    const fertilized = new Set(Object.entries(room?.board || {}).filter(([, node]) => node?.fertilize).map(([key]) => key));
    const plan = new Map();
    for (const source of beginningOrder) {
      const [x, y] = source.split(',').map(Number);
      const options = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]
        .filter(([column, row]) => column >= 0 && column <= 4 && row >= 0 && row <= 3)
        .map(([column, row]) => `${column},${row}`).filter(key => !terrain.has(key));
      const target = beginningTargets.get(source);
      const valid = target ? options.includes(target) : options.length === 0;
      plan.set(source, { options, target, valid });
      if (target && valid) {
        if (fertilized.has(target)) { fertilized.delete(target); terrain.add(target); }
        else fertilized.add(target);
      }
    }
    return plan;
  }
  function syncEventTargets() {
    for (const cell of $('game-board').children) {
      const node = room?.board?.[cell.dataset.key];
      const legal = Boolean(cell.dataset.key && (
        (pendingEvent && legalEventTarget(pendingEvent.rule[1], node))
        || (pendingEntity && legalEntityAction(pendingEntity.card, node, cell.dataset.key))
        || (beginningTargetSource && beginningPlan().get(beginningTargetSource)?.options.includes(cell.dataset.key))));
      cell.classList.toggle('is-event-target', legal);
      if (legal || node?.entity) { cell.tabIndex = 0; cell.setAttribute('role', 'button'); }
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
    if (pendingFestival) {
      const choiceNeeded = pendingFestival.hand.length > 0;
      $('game-discard-text').textContent = choiceNeeded
        ? 'Festival of New Canopies: choose 1 card to discard after drawing 2. Press Esc to cancel.'
        : 'Festival of New Canopies: no card remains to discard.';
      $('game-confirm-discard').textContent = choiceNeeded ? 'Discard and Resolve' : 'Resolve Event';
      $('game-confirm-discard').disabled = phaseBusy || (choiceNeeded && discardSelections.size !== 1);
    } else if (required) {
      $('game-discard-text').textContent = `Discard ${required} card${required === 1 ? '' : 's'} so 7 remain. Selected ${discardSelections.size}/${required}.`;
      $('game-confirm-discard').textContent = 'Confirm Discard';
      $('game-confirm-discard').disabled = phaseBusy || discardSelections.size !== required;
    }
    for (const [index, item] of Array.from($('game-hand').children).entries()) {
      item.querySelector('.play-hand-card')?.classList.toggle('is-discard-selected', (required > 0 || pendingFestival) && discardSelections.has(index));
    }
  }
  function renderTurnPhase() {
    const phase = room?.turn_phase;
    const phaseIndex = phaseOrder.indexOf(phase);
    const own = Boolean(room?.turn_player_id && room.turn_player_id === userId);
    const patron = patronPreviews[own ? 'self' : 'opponent'].card;
    $('game-phases').style.setProperty('--play-phase-color', patronMarkerColors[patron?.terrain] || '#7ba98a');
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
    next.textContent = phase === 'end' ? 'Pass Turn' : 'Next Phase';
    const excess = requiredDiscards();
    next.hidden = phase === 'draw' || (phase === 'main' && (!own || !room?.main_played_card))
      || (own && phase === 'end' && (!gameState || excess > 0));
    next.disabled = !room || room.status !== 'active' || !own || phaseBusy || pendingFestival || phaseIndex < 0
      || (phase === 'beginning' && beginningEffects().length > 0)
      || (phase === 'beginning' && !gameState);
    syncDiscardBar();
    const extra = $('game-extra-draw');
    extra.hidden = !own || phase !== 'main' || Boolean(room?.main_played_card);
    extra.disabled = phaseBusy || pendingFestival || !Array.isArray(gameState?.horizon) || gameState.horizon.length === 0;
  }
  function renderOpeningRoll() {
    const overlay = $('opening-roll');
    const phases = $('game-phases');
    const key = room?.status === 'active' ? `${room.id}:${room.activated_at || ''}` : '';
    if (key !== openingMatchKey) {
      openingMatchKey = key;
      openingWasRolling = false;
      openingRollBusy = false;
      openingRollError = '';
      openingTieRound = 0;
      openingAnimatedValues.host = null;
      openingAnimatedValues.guest = null;
      clearTimeout(openingRevealTimer);
      clearTimeout(openingTieTimer);
      clearInterval(openingShuffleTimer);
      openingShuffleTimer = null;
      openingRevealTimer = openingTieTimer = null;
    }
    const rolling = room?.status === 'active' && room.turn_phase === 'roll' && room.opening_roll_round > 0;
    if (rolling) openingWasRolling = true;
    const revealing = !rolling && openingWasRolling && room?.turn_number === 1;
    overlay.hidden = !rolling && !revealing;
    phases.hidden = rolling || revealing;
    if (!overlay.hidden && revealing && !openingRevealTimer && !openingRollBusy) {
      openingRevealTimer = setTimeout(() => {
        openingRevealTimer = null;
        openingWasRolling = false;
        renderOpeningRoll();
      }, 2200);
    }
    if (overlay.hidden) {
      if (!phases.hidden && key && openingPanelAnimatedKey !== key && room?.turn_number === 1) {
        openingPanelAnimatedKey = key;
        phases.classList.add('is-appearing');
        setTimeout(() => phases.classList.remove('is-appearing'), 650);
      }
      return;
    }
    const tie = room.opening_last_tie;
    if (rolling && !openingRollBusy && tie?.round === room.opening_roll_round - 1 && tie.round !== openingTieRound) {
      openingTieRound = tie.round;
      openingTieTimer = setTimeout(() => { openingTieTimer = null; renderOpeningRoll(); }, 2200);
    }
    const showTie = rolling && tie?.round === openingTieRound && Boolean(openingTieTimer);
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
    button.hidden = !rolling || ownRolled || showTie;
    button.disabled = openingRollBusy;
    $('opening-roll-status').textContent = openingRollBusy ? 'Rolling two dice…'
      : revealing
      ? room.turn_player_id === userId ? 'You rolled higher. Your Main Phase begins!' : `${room.turn_player_id === room.host_id ? hostName : guestName} rolled higher and begins.`
      : showTie ? `Tie: ${tie.host}–${tie.guest}. Roll again!`
      : ownRolled ? `You rolled ${room[`opening_${ownSeat}_roll`]}. Waiting for the opponent to roll.`
      : room.opening_host_roll || room.opening_guest_roll ? 'The other player has rolled. Roll your dice!' : 'Roll two dice. Higher total starts.';
    $('opening-roll-error').hidden = !openingRollError;
    $('opening-roll-error').textContent = openingRollError;
  }
  async function rollOpeningDie() {
    if (openingRollBusy || !room || room.turn_phase !== 'roll') return;
    const seat = room.host_id === userId ? 'host' : 'guest';
    if (room[`opening_${seat}_roll`] != null || openingTieTimer) return;
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
  function renderBeginningEffects() {
    const effects = beginningEffects();
    const panel = $('game-beginning-effects');
    panel.hidden = effects.length === 0;
    if (!effects.length) { beginningTargetSource = null; return; }
    const own = room.turn_player_id === userId;
    panel.classList.toggle('is-read-only', !own);
    const saved = room.beginning_effects_plan;
    const shared = saved?.turn === room.turn_number && saved?.player_id === room.turn_player_id
      && Array.isArray(saved.effects) ? saved.effects : null;
    $('game-beginning-instructions').textContent = own
      ? 'Drag effects into the order you want. Choose an adjacent empty Node for each effect.'
      : 'Opponent is choosing the order and targets.';
    $('game-resolve-beginning').hidden = !own;
    const turnKey = `${room.id}:${room.turn_number}`;
    const sources = new Set(effects.map(effect => effect.source));
    if (turnKey !== beginningTurnKey) {
      beginningTurnKey = turnKey;
      beginningOrder = effects.map(effect => effect.source);
      beginningTargets.clear();
      beginningTargetSource = null;
      if (shared) {
        beginningOrder = shared.map(entry => entry.source).filter(source => sources.has(source));
        for (const entry of shared) if (sources.has(entry.source) && entry.target) beginningTargets.set(entry.source, entry.target);
      }
    } else {
      beginningOrder = beginningOrder.filter(source => sources.has(source));
      for (const effect of effects) if (!beginningOrder.includes(effect.source)) beginningOrder.push(effect.source);
      for (const source of beginningTargets.keys()) if (!sources.has(source)) beginningTargets.delete(source);
      if (beginningTargetSource && !sources.has(beginningTargetSource)) beginningTargetSource = null;
      if (!own && shared) {
        beginningOrder = shared.map(entry => entry.source).filter(source => sources.has(source));
        beginningTargets.clear();
        for (const entry of shared) if (sources.has(entry.source) && entry.target) beginningTargets.set(entry.source, entry.target);
      }
    }
    for (const effect of effects) if (!beginningOrder.includes(effect.source)) beginningOrder.push(effect.source);
    const bySource = new Map(effects.map(effect => [effect.source, effect]));
    const plan = beginningPlan();
    const rows = beginningOrder.map((source, index) => {
      const effect = bySource.get(source);
      const row = document.createElement('li');
      row.className = `play-beginning-effect${beginningTargetSource === source ? ' is-choosing' : ''}`;
      row.draggable = own && !phaseBusy;
      const heading = document.createElement('div'); heading.className = 'play-beginning-effect-heading';
      const title = document.createElement('strong'); title.textContent = `${effect.card.title} · ${source}`;
      if (own) {
        const handle = document.createElement('span'); handle.textContent = '⋮⋮'; handle.setAttribute('aria-hidden', 'true');
        heading.append(handle);
      }
      heading.append(title);
      const description = document.createElement('p'); description.textContent = effect.card.effect || '';
      const controls = document.createElement('div'); controls.className = 'play-beginning-effect-controls';
      const { options, target, valid } = plan.get(source);
      if (!own) {
        const status = document.createElement('span');
        status.textContent = target && valid ? `Target: Node ${target}` : options.length ? 'Waiting for target' : 'No adjacent empty Node';
        controls.append(status);
      } else if (options.length) {
        const choose = document.createElement('button'); choose.type = 'button';
        choose.textContent = target && valid ? `Node ${target}` : 'Choose Node';
        choose.disabled = phaseBusy;
        choose.addEventListener('click', () => {
          beginningTargetSource = beginningTargetSource === source ? null : source;
          eventNotice(beginningTargetSource ? `Choose an adjacent empty Node for ${effect.card.title}.` : '');
          renderBeginningEffects(); syncEventTargets();
        });
        controls.append(choose);
      } else if (target) {
        const clear = document.createElement('button'); clear.type = 'button'; clear.textContent = 'Clear Node';
        clear.disabled = phaseBusy;
        clear.addEventListener('click', () => { beginningTargets.delete(source); renderBeginningEffects(); void saveBeginningPlan(); });
        controls.append(clear);
      } else {
        const unavailable = document.createElement('span'); unavailable.textContent = 'No adjacent empty Node';
        controls.append(unavailable);
      }
      for (const [direction, label] of own ? [[-1, 'Move up'], [1, 'Move down']] : []) {
        const move = document.createElement('button'); move.type = 'button';
        move.textContent = direction < 0 ? '↑' : '↓'; move.setAttribute('aria-label', `${label}: ${effect.card.title}`);
        move.disabled = phaseBusy || index + direction < 0 || index + direction >= beginningOrder.length;
        move.addEventListener('click', () => {
          [beginningOrder[index], beginningOrder[index + direction]] = [beginningOrder[index + direction], beginningOrder[index]];
          renderBeginningEffects(); void saveBeginningPlan();
        });
        controls.append(move);
      }
      row.append(heading, description, controls);
      if (own) row.addEventListener('dragstart', event => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', source);
        row.classList.add('is-dragging');
      });
      if (own) row.addEventListener('dragend', () => row.classList.remove('is-dragging'));
      if (own) row.addEventListener('dragover', event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; });
      if (own) row.addEventListener('drop', event => {
        event.preventDefault();
        const dragged = event.dataTransfer.getData('text/plain');
        const from = beginningOrder.indexOf(dragged);
        const to = beginningOrder.indexOf(source);
        if (from < 0 || to < 0 || from === to) return;
        beginningOrder.splice(from, 1);
        beginningOrder.splice(to, 0, dragged);
        renderBeginningEffects(); void saveBeginningPlan();
      });
      return row;
    });
    $('game-beginning-list').replaceChildren(...rows);
    $('game-resolve-beginning').disabled = phaseBusy || beginningOrder.some(source => !plan.get(source)?.valid);
  }
  async function saveBeginningPlan() {
    if (phaseBusy || room?.turn_player_id !== userId || room.turn_phase !== 'beginning') return;
    const expected = epoch, roomId = room.id, turn = room.turn_number;
    const entries = beginningOrder.map(source => ({ source, target: beginningTargets.get(source) || null }));
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
    const entries = beginningOrder.map(source => ({ source, target: beginningTargets.get(source) || null }));
    const plan = beginningPlan();
    if (entries.some(({ source }) => !plan.get(source)?.valid)) return;
    const expected = epoch, roomId = room.id, turn = room.turn_number;
    phaseBusy = true;
    beginningTargetSource = null;
    renderBeginningEffects(); renderTurnPhase(); syncEventTargets();
    try {
      const result = await rpc('play_resolve_beginning_entity_effects', {
        p_room_id: roomId, p_expected_turn: turn, p_effects: entries,
      });
      if (expected !== epoch || room?.id !== roomId) return;
      await refreshRoom();
      if (expected === epoch && room?.id === roomId) await loadGameState(true);
      eventNotice(`${effects.length} Entity effect${effects.length === 1 ? '' : 's'} resolved${result?.drawn ? `; drew ${result.drawn} card${result.drawn === 1 ? '' : 's'}` : ''}.`, true);
    } catch (error) {
      if (expected === epoch && room?.id === roomId) {
        await refreshRoom().catch(() => {});
        message(friendly(error), true);
      }
    } finally {
      phaseBusy = false;
      renderBeginningEffects(); renderTurnPhase(); syncEventTargets();
    }
  }
  $('game-resolve-beginning').addEventListener('click', () => void resolveBeginningEffects());
  function clearDrawFlight() {
    activeDrawFlight?.remove();
    activeDrawFlight = null;
    for (const animation of activeHandShifts) animation.cancel();
    activeHandShifts = [];
  }
  async function animateDrawToHand(rawCard) {
    const source = $('game-self-horizon').getBoundingClientRect();
    const handElement = $('game-hand');
    const hand = handElement.getBoundingClientRect();
    if ($('game').hidden || !source.width || !source.height || !hand.width || !hand.height) return;
    clearDrawFlight();
    const items = Array.from(handElement.children);
    const first = items[0]?.getBoundingClientRect();
    const cardWidth = first?.width || Math.min(source.width, 100);
    const cardHeight = first?.height || cardWidth * 88 / 63;
    const style = getComputedStyle(handElement);
    const gap = parseFloat(style.columnGap) || 0;
    const paddingLeft = parseFloat(style.paddingLeft) || 0;
    const paddingRight = parseFloat(style.paddingRight) || 0;
    const available = hand.width - paddingLeft - paddingRight;
    const total = (items.length + 1) * cardWidth + items.length * gap;
    const startX = hand.left + paddingLeft + Math.max(0, (available - total) / 2) - handElement.scrollLeft;
    const destinationX = startX + items.length * (cardWidth + gap) + cardWidth / 2;
    const destinationY = first ? first.top + cardHeight / 2 : hand.top + hand.height / 2;
    const flight = document.createElement('div');
    flight.className = 'play-draw-flight';
    flight.setAttribute('aria-hidden', 'true');
    Object.assign(flight.style, { left: `${source.left}px`, top: `${source.top}px`, width: `${source.width}px`, height: `${source.height}px` });
    const inner = document.createElement('div'); inner.className = 'play-draw-flight-inner';
    const back = document.createElement('div'); back.className = 'play-draw-flight-face play-draw-flight-back';
    const front = document.createElement('div'); front.className = 'play-draw-flight-face play-draw-flight-front';
    const canvas = document.createElement('canvas'); canvas.hidden = true;
    const fallback = document.createElement('span'); fallback.textContent = rawCard?.title || 'Card';
    front.append(canvas, fallback); inner.append(back, front); flight.append(inner); document.body.append(flight);
    activeDrawFlight = flight;
    if (rawCard) void (async () => {
      const card = resolveGameCard(rawCard);
      fallback.textContent = card.title || 'Card';
      try {
        const artwork = card.artwork_id ? await getArtworkUrl(card.artwork_id) : '';
        const result = await renderCard(canvas, card, artwork, () => activeDrawFlight === flight);
        if (result && !result.cancelled) { canvas.hidden = false; fallback.hidden = true; }
      } catch { /* The title remains visible if card art cannot load. */ }
    })();
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    activeHandShifts = items.map((item, index) => {
      const current = item.getBoundingClientRect();
      const delta = startX + index * (cardWidth + gap) - current.left;
      return item.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${delta}px)` }],
        { duration: reducedMotion ? 80 : 470, easing: 'ease-in-out', fill: 'forwards' });
    });
    const dx = destinationX - source.left - source.width / 2;
    const dy = destinationY - source.top - source.height / 2;
    const scale = cardWidth / source.width;
    const duration = reducedMotion ? 100 : 850;
    const motion = flight.animate([
      { transform: 'translate(0, 0) rotate(0deg) scale(1)' },
      { transform: `translate(${dx * .65}px, ${dy * .65}px) rotate(-7deg) scale(${1 + (scale - 1) * .65})`, offset: .7 },
      { transform: `translate(${dx}px, ${dy}px) rotate(0deg) scale(${scale})` },
    ], { duration, easing: 'cubic-bezier(.22,.7,.18,1)', fill: 'forwards' });
    const flip = inner.animate([
      { transform: 'rotateY(0deg)' },
      { transform: 'rotateY(0deg)', offset: .25 },
      { transform: 'rotateY(180deg)', offset: .7 },
      { transform: 'rotateY(180deg)' },
    ], { duration, easing: 'ease-in-out', fill: 'forwards' });
    try {
      await Promise.all([motion.finished, flip.finished]);
    } catch { /* Leaving the table cancels the flight. */ }
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
      if (flightCard) await animateDrawToHand(flightCard);
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
  async function advanceTurnPhase(takeExtraCard = false) {
    if (!room || room.status !== 'active' || room.turn_player_id !== userId || phaseBusy) return;
    if (room.turn_phase === 'beginning' && !gameState) return;
    if (takeExtraCard && (room.turn_phase !== 'main' || !gameState?.horizon?.length)) return;
    const expected = epoch, roomId = room.id, turn = room.turn_number, phase = room.turn_phase;
    const drawnCard = gameState?.horizon?.[0] || null;
    phaseBusy = true;
    renderTurnPhase();
    try {
      if (takeExtraCard) await animateDrawToHand(drawnCard);
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
        await refreshRoom().catch(() => {});
        message(friendly(error), true);
      }
    } finally {
      clearDrawFlight();
      phaseBusy = false;
      renderTurnPhase();
    }
  }
  $('game-next-phase').addEventListener('click', () => void advanceTurnPhase());
  $('game-extra-draw').addEventListener('click', () => void advanceTurnPhase(true));
  for (const seat of ['self', 'opponent']) {
    const slot = $(`game-${seat}-patron-slot`);
    slot.addEventListener('click', () => {
      const card = patronPreviews[seat].card;
      if (card) toggleCardPreview(card, slot);
    });
    slot.addEventListener('contextmenu', event => {
      event.preventDefault();
      event.stopPropagation();
      const card = patronPreviews[seat].card;
      if (card) toggleCardPreview(card, slot);
    });
  }
  root.querySelector('.play-game-board-wrap').addEventListener('contextmenu', event => {
    if (event.target.closest('.play-game-card-preview')) return;
    event.preventDefault();
    hideCardPreview();
  });
  document.addEventListener('pointerdown', event => {
    for (const menu of root.querySelectorAll('.play-table-menu[open]')) {
      if (!menu.contains(event.target)) menu.open = false;
    }
    if (event.button !== 0 || $('game').hidden || !selectedGameCard) return;
    if (event.target.closest('.play-hand-card, .play-game-patron-slot, .play-game-card-preview, .play-game-archive-card, .play-deck-stack, .play-game-node.has-entity, .play-game-node.is-event-target')) return;
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
    if (event.key === 'Escape') {
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
      if (deadline) badge.textContent = `Away · ${awayTime(deadline)}`;
    }
    const note = $('away-note');
    if (note && inLobby && awayDeadline(true)) note.textContent = `Away · ${awayTime(awayDeadline(true))}`;
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
    ++gameRenderSerial; gameState = null; gameLoading = false; gameLoadFailed = false; gameReloadPending = false; handSignature = '';
    phaseBusy = false; drawRetryAt = 0; clearDrawFlight(); discardSelections.clear(); pendingFestival = null; arrivingEntityKey = null;
    beginningTurnKey = ''; beginningOrder = []; beginningTargetSource = null; beginningTargets.clear();
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
    timer = null; awayTicker = null;
    const previous = channel; channel = null; live = false;
    if (previous) await client.removeChannel(previous);
  }
  function canAct() { return Boolean(room && userId && (room.host_id === userId || room.guest_id === userId) && room.status !== 'closed' && !busy); }
  function ownDeckId() { return room?.[`${room.host_id === userId ? 'host' : 'guest'}_deck_id`]; }
  function ownReady() { return room?.[`${room.host_id === userId ? 'host' : 'guest'}_ready`]; }
  function controls() {
    $('create').disabled = busy;
    for (const b of $('room-list').querySelectorAll('button')) b.disabled = busy || b.dataset.full === 'true';
    $('deck').disabled = !canAct() || ownReady() || !getDecks().length;
    $('ready').disabled = !canAct() || (!ownReady() && !$('deck').value);
    $('edit-name').disabled = !canAct() || room?.host_id !== userId;
    $('back').disabled = busy || !room;
    $('leave').disabled = busy || !room;
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
    $(`game-${seat}-patron-slot`).setAttribute('aria-label', `Preview ${seat === 'self' ? 'your' : "opponent's"} Patron: ${card?.title || 'none selected'}`);
    if (!card) return;
    void (async () => {
      const artwork = card.artwork_id ? await getArtworkUrl(card.artwork_id).catch(() => '') : '';
      const stagedCanvas = document.createElement('canvas');
      const result = await renderCard(stagedCanvas, card, artwork, () => serial === preview.serial);
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
    ++cardPreviewSerial;
    pendingEvent = null;
    pendingEntity = null;
    selectedGameCard = null;
    selectedHandIndex = null;
    syncEventTargets();
    eventNotice('');
    selectedCardElement?.classList.remove('is-selected');
    selectedCardElement?.removeAttribute('aria-pressed');
    selectedCardElement = null;
    $('game-card-preview').hidden = true;
  }
  function showCardPreview(card, source, handIndex = null) {
    pendingEvent = null;
    pendingEntity = card.card_type === 'Entity' && handIndex !== null && !pendingFestival
      && !requiredDiscards() && room?.turn_player_id === userId && room?.turn_phase === 'main'
      && !room.main_played_entity ? { card, handIndex } : null;
    syncEventTargets();
    selectedGameCard = card;
    selectedHandIndex = handIndex;
    const support = card.card_type === 'Event' ? eventSupport(card) : null;
    eventNotice(pendingEntity ? 'Choose matching Terrain to Place, or a legal empty space to Shape. Press Esc to cancel.'
      : card.card_type === 'Entity' && handIndex !== null && room?.turn_player_id === userId
        && room?.turn_phase === 'main' && room.main_played_entity
        ? 'You have already played an Entity this turn.'
      : card.card_type === 'Event' && !support
        ? 'This Event effect is not available in online play yet.' : '');
    const serial = ++cardPreviewSerial;
    selectedCardElement?.classList.remove('is-selected');
    selectedCardElement?.removeAttribute('aria-pressed');
    selectedCardElement = source;
    selectedCardElement?.classList.add('is-selected');
    selectedCardElement?.setAttribute('aria-pressed', 'true');
    const panel = $('game-card-preview');
    const canvas = $('game-card-preview-canvas');
    const fallback = $('game-card-preview-fallback');
    canvas.hidden = true;
    fallback.hidden = false;
    fallback.textContent = card.title || 'Card';
    panel.setAttribute('aria-label', `Preview of ${card.title || 'card'}`);
    panel.hidden = false;
    renderTurnPhase();
    void (async () => {
      const artwork = card.artwork_id ? await getArtworkUrl(card.artwork_id).catch(() => '') : '';
      const result = await renderCard(canvas, card, artwork, () => serial === cardPreviewSerial);
      if (serial === cardPreviewSerial && result && !result.cancelled) {
        canvas.hidden = false;
        fallback.hidden = true;
      }
    })().catch(() => {});
  }
  function toggleCardPreview(card, source, handIndex = null) {
    if (selectedCardElement === source && !$('game-card-preview').hidden) hideCardPreview();
    else showCardPreview(card, source, handIndex);
  }
  function chooseHandCard(card, source, handIndex) {
    if (pendingFestival) {
      discardSelections.clear();
      discardSelections.add(handIndex);
      showCardPreview(card, source, handIndex);
      syncDiscardBar();
      return;
    }
    if (!requiredDiscards()) { toggleCardPreview(card, source, handIndex); return; }
    if (discardSelections.has(handIndex)) {
      discardSelections.delete(handIndex);
      if (selectedCardElement === source) hideCardPreview();
    } else {
      discardSelections.add(handIndex);
      showCardPreview(card, source, handIndex);
    }
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
  function stageFestival(card, handIndex) {
    const drawn = (gameState.horizon || []).slice(0, 2);
    const hand = gameState.hand.filter((_, index) => index !== handIndex).concat(drawn);
    pendingFestival = { card, handIndex, drawn, hand };
    discardSelections.clear();
    handSignature = '';
    renderGame();
    eventNotice(`Festival of New Canopies draws ${drawn.length} card${drawn.length === 1 ? '' : 's'}. Choose one to discard, then resolve the Event.`);
  }
  async function confirmFestival() {
    const festival = pendingFestival;
    if (!festival || !room || room.status !== 'active' || room.turn_player_id !== userId
      || room.turn_phase !== 'main' || phaseBusy || (festival.hand.length && discardSelections.size !== 1)) return;
    const discardIndex = festival.hand.length ? [...discardSelections][0] : null;
    const discarded = discardIndex === null ? null : festival.hand[discardIndex];
    if (discardIndex !== null && !discarded) return;
    const expected = epoch, roomId = room.id;
    phaseBusy = true;
    renderTurnPhase();
    try {
      const result = await rpc('play_evoke_festival', {
        p_room_id: roomId, p_expected_turn: room.turn_number,
        p_hand_index: festival.handIndex, p_card_id: festival.card.card_id || festival.card.id,
        p_expected_hand_count: gameState.hand.length,
        p_expected_draw_ids: festival.drawn.map(card => card.card_id || card.id),
        p_discard_index: discardIndex,
        p_discard_card_id: discarded?.card_id || discarded?.id || null,
      });
      if (expected !== epoch || room?.id !== roomId) return;
      if (discardIndex !== null) await animateDiscardToArchive([discardIndex]);
      if (expected !== epoch || room?.id !== roomId) return;
      pendingFestival = null;
      discardSelections.clear();
      await refreshRoom();
      if (expected === epoch && room?.id === roomId) await loadGameState(true);
      if (expected === epoch && room?.id === roomId) eventNotice(`Festival of New Canopies evoked · drew ${result?.drawn || 0}${result?.discarded ? ` · discarded ${result.discarded}` : ''}.`, true);
    } catch (error) {
      if (expected === epoch && room?.id === roomId) {
        pendingFestival = null;
        await refreshRoom().catch(() => {});
        await loadGameState(true).catch(() => {});
        message(friendly(error), true);
      }
    } finally {
      phaseBusy = false;
      renderTurnPhase();
    }
  }
  async function animateDiscardToArchive(indexes) {
    const destination = $('game-self-archive').getBoundingClientRect();
    if ($('game').hidden || !destination.width || !destination.height) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const flights = indexes.map((index, order) => {
      const source = $('game-hand').children[index]?.querySelector('.play-hand-card');
      const bounds = source?.getBoundingClientRect();
      if (!bounds?.width || !bounds.height) return null;
      const flight = source.cloneNode(true);
      flight.classList.remove('is-selected', 'is-discard-selected');
      flight.classList.add('play-discard-flight');
      flight.setAttribute('aria-hidden', 'true');
      flight.tabIndex = -1;
      Object.assign(flight.style, {
        left: `${bounds.left}px`, top: `${bounds.top}px`,
        width: `${bounds.width}px`, height: `${bounds.height}px`,
      });
      const sourceCanvas = source.querySelector('canvas');
      const flightCanvas = flight.querySelector('canvas');
      if (sourceCanvas && flightCanvas && !sourceCanvas.hidden && sourceCanvas.width) {
        flightCanvas.width = sourceCanvas.width;
        flightCanvas.height = sourceCanvas.height;
        flightCanvas.getContext('2d').drawImage(sourceCanvas, 0, 0);
      }
      document.body.append(flight);
      source.style.visibility = 'hidden';
      const dx = destination.left + destination.width / 2 - bounds.left - bounds.width / 2;
      const dy = destination.top + destination.height / 2 - bounds.top - bounds.height / 2;
      const scale = Math.min(destination.width / bounds.width, destination.height / bounds.height);
      const animation = flight.animate([
        { transform: 'translate(0, 0) rotate(0deg) scale(1)', opacity: 1 },
        { transform: `translate(${dx * .6}px, ${dy * .6}px) rotate(-8deg) scale(${1 + (scale - 1) * .6})`, opacity: 1, offset: .65 },
        { transform: `translate(${dx}px, ${dy}px) rotate(0deg) scale(${scale})`, opacity: .15 },
      ], { duration: reducedMotion ? 100 : 650, delay: reducedMotion ? 0 : order * 85,
        easing: 'cubic-bezier(.22,.7,.18,1)', fill: 'forwards' });
      return { source, flight, animation };
    }).filter(Boolean);
    try { await Promise.allSettled(flights.map(({ animation }) => animation.finished)); }
    finally {
      for (const { source, flight } of flights) {
        source.style.visibility = '';
        flight.remove();
      }
    }
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
    } catch (error) {
      if (expected === epoch && room?.id === roomId) {
        await refreshRoom().catch(() => {});
        await loadGameState(true).catch(() => {});
        message(friendly(error), true);
      }
    } finally {
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
    return full ? { ...card, ...full } : card;
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
      const caption = document.createElement('small');
      caption.textContent = item.title || 'Card';
      button.append(canvas, fallback, caption);
      button.addEventListener('click', () => { archiveBrowserIndex = index; renderArchiveBrowser(); });
      row.append(button);
      return { row, button, canvas, fallback, item };
    });
    list.replaceChildren(...entries.map(entry => entry.row));
    const drawThumbnail = entry => {
      void (async () => {
        const { button, canvas, fallback, item } = entry;
        const artwork = item.artwork_id ? await getArtworkUrl(item.artwork_id).catch(() => '') : '';
        const staged = document.createElement('canvas');
        const current = () => serial === archiveBrowserRequestSerial && list.contains(button);
        const result = await renderCard(staged, item, artwork, current);
        if (!current() || !result || result.cancelled) return;
        canvas.width = 189;
        canvas.height = 264;
        canvas.getContext('2d').drawImage(staged, 0, 0, canvas.width, canvas.height);
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
      : `${archiveBrowserCards.length} card${archiveBrowserCards.length === 1 ? '' : 's'} · newest first`);
    Array.from($('game-archive-browser-list').children).forEach((row, index) => {
      const button = row.firstElementChild;
      button.classList.toggle('is-current', index === archiveBrowserIndex);
      button.setAttribute('aria-current', index === archiveBrowserIndex ? 'true' : 'false');
    });
    $('game-archive-browser-position').textContent = card
      ? `${archiveBrowserIndex + 1} of ${archiveBrowserCards.length}` : '';
    $('game-archive-browser-previous').disabled = !card || archiveBrowserIndex === 0;
    $('game-archive-browser-next').disabled = !card || archiveBrowserIndex === archiveBrowserCards.length - 1;
    const canvas = $('game-archive-browser-canvas');
    const fallback = $('game-archive-browser-fallback');
    const serial = ++archiveBrowserCardSerial;
    canvas.hidden = true;
    fallback.hidden = false;
    fallback.textContent = card?.title || (archiveBrowserLoading ? 'Loading…' : 'No cards in this Archive.');
    if (!card) return;
    void (async () => {
      const artwork = card.artwork_id ? await getArtworkUrl(card.artwork_id).catch(() => '') : '';
      const result = await renderCard(canvas, card, artwork,
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
  $('game-archive-browser-previous').addEventListener('click', () => {
    if (archiveBrowserIndex > 0) { --archiveBrowserIndex; renderArchiveBrowser(); }
  });
  $('game-archive-browser-next').addEventListener('click', () => {
    if (archiveBrowserIndex < archiveBrowserCards.length - 1) { ++archiveBrowserIndex; renderArchiveBrowser(); }
  });
  function renderArchiveCard(seat, raw, count) {
    const preview = archivePreviews[seat];
    const card = count && raw ? resolveGameCard(raw) : null;
    const key = card ? JSON.stringify([card.id, card.title, card.card_type, card.terrain, card.effect, card.artwork_id]) : '';
    if (preview.key === key) return;
    preview.key = key;
    const serial = ++preview.serial;
    const canvas = $(`game-${seat}-archive-canvas`);
    const fallback = $(seat === 'self' ? 'game-archive-top' : 'game-opponent-archive-top');
    canvas.hidden = true;
    fallback.hidden = false;
    fallback.textContent = card?.title || 'ARCHIVE';
    if (!card) return;
    void (async () => {
      const artwork = card.artwork_id ? await getArtworkUrl(card.artwork_id).catch(() => '') : '';
      const result = await renderCard(canvas, card, artwork, () => serial === preview.serial);
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
    flight.classList.remove('is-selected', 'is-drag-source');
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
    const { flight, bounds } = snapshot;
    flight.classList.remove('play-event-drag-ghost');
    flight.classList.add('play-entity-flight');
    flight.style.left = `${bounds.left}px`;
    flight.style.top = `${bounds.top}px`;
    flight.style.width = `${bounds.width}px`;
    flight.style.height = `${bounds.height}px`;
    document.body.append(flight);
    try {
      await flight.animate([
        { left: `${bounds.left}px`, top: `${bounds.top}px`, width: `${bounds.width}px`, height: `${bounds.height}px`, transform: 'rotate(-5deg)' },
        { left: `${terrain.left + terrain.width * .1}px`, top: `${terrain.top + terrain.height * .1}px`, width: `${terrain.width}px`, height: `${terrain.height}px`, transform: 'rotate(0deg)' },
      ], { duration: 460, easing: 'cubic-bezier(.2,.8,.2,1)' }).finished;
    } catch { /* The table may have been left while the card was moving. */ }
    finally { flight.remove(); }
  }
  async function evokeEvent(card, handIndex, targetX = null, targetY = null, targetCells = null) {
    if (!room || room.status !== 'active' || room.turn_player_id !== userId
      || room.turn_phase !== 'main' || phaseBusy || pendingFestival || !Array.isArray(gameState?.hand)) return;
    const rule = eventSupport(card);
    if (!rule) { eventNotice('This Event effect is not available in online play yet.'); return; }
    if (rule[1] === 'draw_two_discard_one') { stageFestival(card, handIndex); return; }
    if (rule[1] === 'fertilize_two' && !targetCells) {
      const legalCells = Array.from($('game-board').children).filter(cell => cell.dataset.key
        && legalEventTarget(rule[1], room?.board?.[cell.dataset.key]));
      if (!legalCells.length) { eventNotice('There is no empty space to Fertilize.'); return; }
      const targets = targetX !== null && targetY !== null ? [[targetX, targetY]] : [];
      pendingEvent = { card, handIndex, rule, targets };
      syncEventTargets();
      eventNotice(targets.length ? 'Choose an empty space for the second Fertilize token. Press Esc to cancel.'
        : 'Choose an empty space for the first Fertilize token. Press Esc to cancel.');
      return;
    }
    if (targetX === null && targetY === null && !targetCells
      && !['none', 'draw_from_lumens', 'clear_lumens_draw'].includes(rule[1])) {
      const legalCells = Array.from($('game-board').children).filter(cell => cell.dataset.key
        && legalEventTarget(rule[1], room?.board?.[cell.dataset.key]));
      if (legalCells.length) {
        pendingEvent = { card, handIndex, rule };
        syncEventTargets();
        eventNotice(`Choose ${rule[2]} on the board. Press Esc to cancel.`);
        return;
      }
      if (rule[1].startsWith('fertilize')) { eventNotice('There is no valid space to Fertilize.'); return; }
    }
    const cardId = card.card_id || card.id;
    if (!cardId) return;
    const expected = epoch, roomId = room.id;
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
      await refreshRoom();
      if (expected === epoch && room?.id === roomId) await loadGameState(true);
      if (expected === epoch && room?.id === roomId) eventNotice(`${result?.title || card.title} evoked${result?.drawn ? ` · drew ${result.drawn}` : ''}${result?.applied ? ' · board updated' : ''}.`, true);
    } catch (error) {
      if (expected === epoch && room?.id === roomId) {
        await refreshRoom().catch(() => {});
        await loadGameState(true).catch(() => {});
        message(friendly(error), true);
      }
    } finally {
      phaseBusy = false;
      renderTurnPhase();
    }
  }
  async function playEntity(card, handIndex, targetX, targetY, draggedFlight = null) {
    if (!room || room.status !== 'active' || room.turn_player_id !== userId
      || room.turn_phase !== 'main' || room.main_played_entity || phaseBusy || pendingFestival
      || !Array.isArray(gameState?.hand)) return;
    const action = legalEntityAction(card, room.board?.[`${targetX},${targetY}`], `${targetX},${targetY}`);
    if (!action) { eventNotice('Choose an empty space or an unoccupied compatible Terrain.', true); return; }
    const cardId = card.card_id || card.id;
    if (!cardId) return;
    const flight = action === 'place' ? draggedFlight || captureEntityFlight(handIndex) : null;
    if (action === 'place') arrivingEntityKey = `${targetX},${targetY}`;
    const expected = epoch, roomId = room.id;
    phaseBusy = true;
    renderTurnPhase();
    try {
      const result = await rpc('play_entity_action', {
        p_room_id: roomId,
        p_expected_turn: room.turn_number,
        p_hand_index: handIndex,
        p_card_id: cardId,
        p_expected_hand_count: gameState.hand.length,
        p_target_x: targetX,
        p_target_y: targetY,
      });
      if (expected !== epoch || room?.id !== roomId) return;
      pendingEntity = null;
      if (result?.action === 'place') await animateEntityPlacement(flight, targetX, targetY);
      arrivingEntityKey = null;
      Array.from($('game-board').children).find(cell => cell.dataset.key === `${targetX},${targetY}`)
        ?.querySelector('.play-node-entity-card')?.classList.remove('is-arriving');
      if (expected !== epoch || room?.id !== roomId) return;
      await refreshRoom();
      if (expected === epoch && room?.id === roomId) await loadGameState(true);
      if (expected === epoch && room?.id === roomId) eventNotice(result?.action === 'shape'
        ? `${result?.title || card.title} shaped ${result?.terrain || entityShapeTerrain(card)} Terrain. Card-specific effects are not automated yet.`
        : `${result?.title || card.title} placed on ${result?.terrain || room.board?.[`${targetX},${targetY}`]?.terrain} Terrain. Card-specific effects are not automated yet.`, true);
    } catch (error) {
      if (expected === epoch && room?.id === roomId) {
        await refreshRoom().catch(() => {});
        await loadGameState(true).catch(() => {});
        message(friendly(error), true);
      }
    } finally {
      arrivingEntityKey = null;
      $('game-board').querySelector('.play-node-entity-card.is-arriving')?.classList.remove('is-arriving');
      phaseBusy = false;
      renderTurnPhase();
    }
  }
  function chooseEventTarget(column, row) {
    const event = pendingEvent;
    if (!event || !legalEventTarget(event.rule[1], room?.board?.[`${column},${row}`])) return;
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
  function chooseBoardTarget(column, row, source) {
    if (beginningTargetSource) {
      const target = `${column},${row}`;
      if (!beginningPlan().get(beginningTargetSource)?.options.includes(target)) return;
      beginningTargets.set(beginningTargetSource, target);
      beginningTargetSource = null;
      eventNotice('');
      renderBeginningEffects(); syncEventTargets(); void saveBeginningPlan();
      return;
    }
    if (pendingEvent) { chooseEventTarget(column, row); return; }
    const entity = pendingEntity;
    if (!entity) {
      const placed = room?.board?.[`${column},${row}`]?.entity;
      if (placed) toggleCardPreview(resolveGameCard(placed), source);
      return;
    }
    if (!legalEntityAction(entity.card, room?.board?.[`${column},${row}`], `${column},${row}`)) return;
    pendingEntity = null;
    syncEventTargets();
    void playEntity(entity.card, entity.handIndex, column, row);
  }
  function enableCardDrag(button, card, handIndex) {
    let drag = null, suppressClick = false;
    const isEntity = card.card_type === 'Entity';
    const rule = isEntity ? null : eventSupport(card);
    const boardWrap = root.querySelector('.play-game-board-wrap');
    const pointInside = (rect, x, y) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    const targetAt = (x, y) => Array.from($('game-board').children).find(cell =>
      cell.dataset.key && pointInside(cell.getBoundingClientRect(), x, y));
    const clearDragTarget = () => {
      boardWrap.querySelector('.is-event-drag-target')?.classList.remove('is-event-drag-target');
    };
    button.classList.add('is-draggable-card');
    button.setAttribute('aria-label', isEntity
      ? `Preview ${card.title || 'Entity'}; drag to compatible Terrain to Place or an empty space to Shape`
      : `Preview ${card.title || 'Event'}; drag toward the table to Evoke, or press E`);
    button.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !event.isPrimary || room?.turn_player_id !== userId
        || room.turn_phase !== 'main' || phaseBusy || pendingFestival || (isEntity && room.main_played_entity)) return;
      drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, ghost: null };
      button.setPointerCapture(event.pointerId);
    });
    button.addEventListener('pointermove', event => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (!drag.ghost && Math.hypot(dx, dy) < 8) return;
      if (!drag.ghost) {
        const bounds = button.getBoundingClientRect();
        const ghost = button.cloneNode(true);
        ghost.removeAttribute('aria-label');
        ghost.setAttribute('aria-hidden', 'true');
        ghost.classList.add('play-event-drag-ghost');
        ghost.style.left = `${bounds.left}px`;
        ghost.style.top = `${bounds.top}px`;
        ghost.style.width = `${bounds.width}px`;
        ghost.style.height = `${bounds.height}px`;
        const sourceCanvas = button.querySelector('canvas');
        const ghostCanvas = ghost.querySelector('canvas');
        if (sourceCanvas && ghostCanvas && !sourceCanvas.hidden && sourceCanvas.width) {
          ghostCanvas.width = sourceCanvas.width;
          ghostCanvas.height = sourceCanvas.height;
          ghostCanvas.getContext('2d').drawImage(sourceCanvas, 0, 0);
        }
        document.body.append(ghost);
        drag.ghost = ghost;
        drag.bounds = bounds;
        hideCardPreview();
        button.classList.add('is-drag-source');
        boardWrap.classList.add('is-event-drop-zone');
      }
      event.preventDefault();
      drag.ghost.style.left = `${drag.bounds.left + dx}px`;
      drag.ghost.style.top = `${drag.bounds.top + dy}px`;
      clearDragTarget();
      const target = targetAt(event.clientX, event.clientY);
      if (target && (isEntity ? legalEntityAction(card, room?.board?.[target.dataset.key], target.dataset.key)
        : rule && legalEventTarget(rule[1], room?.board?.[target.dataset.key]))) {
        target.classList.add('is-event-drag-target');
      }
    });
    const finish = (event, cancelled = false) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const moved = Boolean(drag.ghost);
      const draggedFlight = isEntity && drag.ghost
        ? { flight: drag.ghost, bounds: drag.ghost.getBoundingClientRect() } : null;
      drag.ghost?.remove();
      button.classList.remove('is-drag-source');
      boardWrap.classList.remove('is-event-drop-zone');
      clearDragTarget();
      drag = null;
      if (!moved) return;
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 0);
      if (cancelled) return;
      const table = boardWrap.getBoundingClientRect();
      const hand = $('game-self').getBoundingClientRect();
      const droppedOnTable = event.clientY < hand.top - 8
        && pointInside(table, event.clientX, event.clientY);
      if (!droppedOnTable) return;
      const target = targetAt(event.clientX, event.clientY);
      if (target && (isEntity ? legalEntityAction(card, room?.board?.[target.dataset.key], target.dataset.key)
        : rule && legalEventTarget(rule[1], room?.board?.[target.dataset.key]))) {
        const [x, y] = target.dataset.key.split(',').map(Number);
        if (isEntity) void playEntity(card, handIndex, x, y, draggedFlight);
        else void evokeEvent(card, handIndex, x, y);
      } else if (isEntity) eventNotice('Choose an empty space or an unoccupied compatible Terrain.', true);
      else void evokeEvent(card, handIndex);
    };
    button.addEventListener('pointerup', event => finish(event));
    button.addEventListener('pointercancel', event => finish(event, true));
    button.addEventListener('click', event => {
      if (suppressClick) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
    button.addEventListener('keydown', event => {
      if (isEntity || event.key.toLowerCase() !== 'e' || pendingFestival) return;
      event.preventDefault();
      showCardPreview(card, button, handIndex);
      void evokeEvent(card, handIndex);
    });
  }
  function renderGameHand() {
    const hand = (pendingFestival?.hand || (Array.isArray(gameState?.hand) ? gameState.hand : [])).map(resolveGameCard);
    const signature = JSON.stringify(hand);
    if (signature === handSignature) return;
    handSignature = signature;
    discardSelections.clear();
    const serial = ++gameRenderSerial;
    hideCardPreview();
    const cards = hand.map((card, index) => {
      const item = document.createElement('div'); item.className = 'play-hand-item';
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'play-hand-card';
      button.setAttribute('aria-label', `Preview ${card.title || 'card'}`);
      const canvas = document.createElement('canvas'); canvas.hidden = true;
      const fallback = document.createElement('span'); fallback.className = 'play-hand-fallback';
      fallback.textContent = card.title || 'Card';
      button.append(canvas, fallback);
      item.append(button);
      button.addEventListener('click', () => chooseHandCard(card, button, index));
      button.addEventListener('contextmenu', event => {
        event.preventDefault();
        chooseHandCard(card, button, index);
      });
      if (card.card_type === 'Event' || card.card_type === 'Entity') enableCardDrag(button, card, index);
      void (async () => {
        const artwork = card.artwork_id ? await getArtworkUrl(card.artwork_id).catch(() => '') : '';
        const result = await renderCard(canvas, card, artwork, () => serial === gameRenderSerial);
        if (serial === gameRenderSerial && result && !result.cancelled) {
          canvas.hidden = false; fallback.hidden = true;
        }
      })().catch(() => {});
      return item;
    });
    $('game-hand').replaceChildren(...cards);
  }
  function renderGame() {
    if (!room || room.status !== 'active') return;
    $('game-name').textContent = room.name || 'Table';
    $('game-leave').textContent = room.host_id === userId ? 'Smash Table' : 'Concede & Walk Out';
    $('game-restart').hidden = room.host_id !== userId;
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
      if (node?.terrain) {
        cell.classList.add(`terrain-${node.terrain.toLowerCase()}`);
        if (node.entity) {
          cell.classList.add('has-entity');
          const entityCard = resolveGameCard(node.entity);
          const entity = document.createElement('div'); entity.className = 'play-node-entity-card';
          if (arrivingEntityKey === cell.dataset.key) entity.classList.add('is-arriving');
          entity.setAttribute('aria-hidden', 'true');
          const canvas = document.createElement('canvas'); canvas.hidden = true;
          const fallback = document.createElement('span'); fallback.textContent = entityCard.title || 'Entity';
          entity.append(canvas, fallback);
          cell.append(entity);
          void (async () => {
            const artwork = entityCard.artwork_id ? await getArtworkUrl(entityCard.artwork_id).catch(() => '') : '';
            const result = await renderCard(canvas, entityCard, artwork,
              () => boardSerial === boardRenderSerial && entity.isConnected);
            if (boardSerial === boardRenderSerial && entity.isConnected && result && !result.cancelled) {
              canvas.hidden = false; fallback.hidden = true;
            }
          })().catch(() => {});
        }
        const markers = [];
        if (Number(node.lumens || 0) > 0) markers.push(`${node.lumens} ✦`);
        if (node.protected) markers.push('Protected');
        if (node.crisis) markers.push('Crisis');
        if (markers.length) {
          const badge = document.createElement('span'); badge.className = 'play-node-markers';
          badge.textContent = markers.join(' · '); cell.append(badge);
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
      cell.setAttribute('aria-label', node?.terrain ? `${node.terrain} Terrain at row ${row + 1}, column ${column + 1}${node.entity ? `, ${node.entity.title || 'Entity'} placed here` : ''}, ${node.lumens || 0} Lumens${node.protected ? ', Protected' : ''}${node.crisis ? ', Crisis' : ''}`
        : node?.fertilize ? `${node.fertilize.owner_id === userId ? 'Your' : "Opponent's"} Fertilize marker on empty space at row ${row + 1}, column ${column + 1}`
          : `${isCenter ? 'Center empty space' : 'Empty space'} at row ${row + 1}, column ${column + 1}`);
      cell.addEventListener('click', () => chooseBoardTarget(column, row, cell));
      cell.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); chooseBoardTarget(column, row, cell); }
      });
      nodes.push(cell);
    }
    $('game-board').replaceChildren(...nodes);
    renderBeginningEffects();
    syncEventTargets();
    requestAnimationFrame(syncZoneCardSize);
    $('game-loading').hidden = Boolean(gameState) || gameLoadFailed;
    const reportedCount = room.host_id === userId ? room.guest_hand_count : room.host_hand_count;
    const opponentHandCount = Number.isInteger(reportedCount) ? Math.max(0, Math.min(reportedCount, 100)) : 5;
    const opponentBadge = $('game-opponent-hand-count');
    opponentBadge.hidden = !gameState;
    if (gameState) {
      opponentBadge.textContent = `Hand Size: ${opponentHandCount}`;
      opponentBadge.setAttribute('aria-label', `${opponentHandCount} cards in the opponent's hand`);
    }
    const horizon = Array.isArray(gameState?.horizon) ? gameState.horizon : [];
    const archive = Array.isArray(gameState?.archive) ? gameState.archive : [];
    const handCount = pendingFestival?.hand.length ?? (Array.isArray(gameState?.hand) ? gameState.hand.length : null);
    const handBadge = $('game-hand-count');
    handBadge.hidden = handCount === null;
    if (handCount !== null) {
      handBadge.textContent = `Hand Size: ${handCount}`;
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
    const { data, error } = await client.rpc('play_list_tables');
    if (expected !== epoch || serial !== listSerial || (room && !inLobby)) return;
    if (error) { $('no-rooms').textContent = 'Tables could not be loaded. Retrying automatically…'; $('no-rooms').hidden = false; message(friendly(error), true); return; }
    $('no-rooms').hidden = Boolean(data.length);
    $('no-rooms').textContent = 'People are doing things right now. Nobody is playing cards.';
    const signature = JSON.stringify(data);
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
      artwork.src = './assets/fantasy-table-helianthe.png';
      artwork.alt = '';
      artwork.loading = 'lazy';
      scene.append(artwork);
      const details = document.createElement('div'); details.className = 'play-table-details';
      const title = document.createElement('strong'); title.textContent = entry.name || defaultTableName(entry.host_name);
      const summary = document.createElement('span'); summary.textContent = `${entry.host_name} · ${entry.player_count} / 2 players`;
      details.append(title, summary);
      const b = document.createElement('button'); b.type = 'button';
      const full = !entry.is_participant && entry.player_count >= 2;
      b.textContent = entry.is_participant ? 'Sit down' : full ? 'Full' : 'Sit at the table';
      if (!full) b.classList.add('action-add-save');
      b.dataset.full = String(full); b.disabled = busy || full;
      b.setAttribute('aria-label', `${b.textContent} ${entry.code}`);
      b.addEventListener('click', () => run(async () => {
        try {
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
      else if (wasAway) message('This table is no longer available.');
      return;
    }
    const turnChanged = room.turn_number !== data.turn_number || room.turn_phase !== data.turn_phase
      || room.turn_player_id !== data.turn_player_id;
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
    room = data; render();
    if (room.status === 'active') {
      void loadGameState(turnChanged && !phaseBusy);
      void loadGamePatrons().catch(() => { patronDeckRequest = ''; });
    }
    if (room.status === 'closed') {
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
    if (!data || data.status === 'closed') { remember(null); throw new Error('Table not found or closed.'); }
    const seatId = await seatedUserId(data);
    if (expected !== epoch) return;
    if (!seatId) { remember(null); throw new Error('This table belongs to another account. Sign in with the account that joined it.'); }
    userId = seatId;
    const seat = data.host_id === userId ? 'host' : 'guest';
    const ownDeadline = data[`${seat}_away_until`];
    const stayInLobby = !resume && awayLobbyRoom() === id && data.status === 'active' && Boolean(ownDeadline);
    if (data.status === 'active' && ownDeadline && !stayInLobby) {
      const returned = await rpc('play_set_away', { p_room_id: id, p_away: false });
      if (!returned) { remember(null); throw new Error('The away timer expired. The table closed.'); }
      ({ data, error } = await client.from('play_rooms').select('*').eq('id', id).maybeSingle());
      if (error) throw error;
      if (!data || data.status !== 'active') { remember(null); throw new Error('This table is no longer active.'); }
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
    if (renameFailed) message('The table was created, but its name could not be updated. Use Edit name to try again.', true);
    channel = client.channel(`play-room:${id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'play_rooms', filter: `id=eq.${id}` }, () => {
        if (expected === epoch) void refreshRoom().catch(error => message(friendly(error), true));
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
  async function goAway() {
    if (!room || room.status !== 'active' || inLobby) return;
    const id = room.id, expected = epoch;
    const accepted = await rpc('play_set_away', { p_room_id: id, p_away: true });
    if (expected !== epoch || room?.id !== id) return;
    if (!accepted) { await refreshRoom(); return; }
    const seat = room.host_id === userId ? 'host' : 'guest';
    room[`${seat}_away_until`] = new Date(Date.now() + 180000).toISOString();
    inLobby = true; tableListSignature = ''; rememberAwayLobby(id);
    $('game-back').closest('details').open = false;
    render();
    await refreshRoom();
    if (visible) await listTables();
  }
  async function restartGame() {
    if (!room || room.status !== 'active' || room.host_id !== userId) return;
    $('game-restart').closest('details').open = false;
    if (!window.confirm('Restart this match with the same players and decks? The current board, hands, and Archives will be cleared.')) return;
    const id = room.id, expected = epoch;
    await rpc('play_restart_game', { p_room_id: id, p_expected_revision: room.revision });
    if (expected !== epoch || room?.id !== id) return;
    gameState = null; gameLoadFailed = false; handSignature = '';
    pendingEvent = null; pendingEntity = null; pendingFestival = null; discardSelections.clear();
    hideCardPreview();
    await refreshRoom();
    if (expected === epoch && room?.id === id) await loadGameState(true);
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
  function refreshCollections() {
    const decks = getDecks();
    const value = room ? ownDeckId() : $('deck').value;
    $('deck').replaceChildren(...(decks.length ? decks.map(deck => new Option(deck.name, deck.id)) : [new Option('No decks available', '')]));
    $('deck').value = decks.some(deck => deck.id === value) ? value : (decks[0]?.id || '');
    controls();
    maybeAutoSelectDeck();
    if (room?.status === 'active' && !inLobby) renderGame();
  }
  function render() {
    syncLobbyRefresh();
    root.classList.toggle('is-at-table', Boolean(userId && room && !inLobby));
    const playing = Boolean(userId && room?.status === 'active' && !inLobby);
    if (!playing) { hideCardPreview(); closeArchiveBrowser(false); }
    $('signin').hidden = Boolean(userId);
    $('lobby').hidden = !userId || Boolean(room && !inLobby);
    $('session').hidden = !userId || !room || playing || inLobby;
    $('game').hidden = !playing;
    if (!room) { controls(); return; }
    if (inLobby) { updateAwayDisplays(); controls(); return; }
    $('room-code').textContent = room.code;
    $('room-name').textContent = room.name || defaultTableName(getProfiles().find(p => p.id === room.host_id)?.display_name);
    $('edit-name').hidden = room.host_id !== userId || room.status === 'closed';
    $('leave').textContent = room.host_id === userId ? 'Smash Table' : 'Concede & Walk Out';
    let hasSeat = false;
    const rows = ['host', 'guest'].map(seat => {
      const id = room[`${seat}_id`];
      const deck = getDecks().find(d => d.id === room[`${seat}_deck_id`]);
      const profile = getProfiles().find(p => p.id === id);
      const row = document.createElement('div'); row.className = 'play-player';
      const avatar = id ? makeAvatar(profile || { display_name: 'Player' }, 'play-avatar') : document.createElement('span');
      if (!id) { avatar.className = 'user-avatar play-avatar'; avatar.textContent = '?'; }
      avatar.setAttribute('aria-hidden', 'true');
      const details = document.createElement('div'); details.className = 'play-player-details';
      const name = document.createElement('strong'); name.textContent = id ? `${profile?.display_name || 'Player'}${id === userId ? ' · You' : ''}` : 'Waiting for someone to bring a chair.';
      details.append(name);
      if (id === userId) {
        hasSeat = true;
        const controls = document.createElement('div'); controls.className = 'play-player-controls';
        controls.append(deckField, readyButton); details.append(controls);
      }
      else { const deckName = document.createElement('span'); deckName.textContent = deck?.name || 'No deck selected'; details.append(deckName); }
      row.append(avatar, details);
      const state = room.status === 'closed' ? 'Closed' : room[`${seat}_ready`] ? 'Ready' : '';
      if (id && state && !(id === userId && state === 'Ready')) {
        const status = document.createElement('span'); status.className = `play-pill${state === 'Ready' ? ' is-live' : ''}`;
        status.textContent = state;
        row.append(status);
      }
      return row;
    });
    if (!hasSeat) $('controls-parking').append(deckField, readyButton);
    $('players').replaceChildren(...rows);
    const mine = room.host_id === userId ? 'host' : 'guest';
    $('deck').value = getDecks().some(deck => deck.id === room[`${mine}_deck_id`])
      ? room[`${mine}_deck_id`] : (getDecks()[0]?.id || '');
    const isReady = room[`${mine}_ready`];
    $('ready').textContent = isReady ? 'Not ready' : 'Ready';
    $('ready').classList.toggle('action-add-save', !isReady);
    $('ready').classList.toggle('action-delete', isReady);
    $('ready').setAttribute('aria-pressed', String(isReady));
    $('room-status').textContent = room.status === 'closed' ? 'Table closed' : room.status === 'active' ? 'Both players are ready for a duel to the death.' : room.guest_id ? "Pick your decks. The table won't play itself." : '';
    controls();
    if (room.status === 'closed') $('leave').disabled = false;
    if (playing) renderGame();
  }

  $('signin-button').addEventListener('click', requireSignIn);
  $('create').addEventListener('click', () => run(async () => {
    await refreshIdentity();
    if (!userId) throw new Error('Sign in to create a table.');
    const id = await rpc('play_create_room');
    await enter(id, true);
  }));
  $('back').addEventListener('click', () => run(leaveTable));
  $('game-back').addEventListener('click', () => run(leaveTable));
  $('game-restart').addEventListener('click', () => void run(restartGame));
  $('leave').addEventListener('click', () => run(leaveTable));
  $('game-leave').addEventListener('click', () => run(leaveTable));
  $('deck').addEventListener('change', () => {
    if (busy || ownReady()) { $('deck').value = ownDeckId() || ''; return; }
    if ($('deck').value) void run(() => action('deck', { deck_id: $('deck').value }));
  });
  $('ready').addEventListener('click', () => {
    const deckId = $('deck').value;
    if (!ownReady() && !deckId) return message('Create a deck before getting ready.', true);
    void run(async () => {
      if (!ownReady() && ownDeckId() !== deckId) await action('deck', { deck_id: deckId });
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
