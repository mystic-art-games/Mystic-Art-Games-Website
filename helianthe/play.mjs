const defaultTableName = hostName => `${Array.from(String(hostName ?? '').trim() || 'Player').slice(0, 52).join("")}'s Table`;

export function playerOnline(timestamp, now = Date.now()) {
  return Boolean(timestamp && now - Date.parse(timestamp) < 45000);
}

export function createPlayView({ client, getUser, getDecks, getCards, getProfiles, makeAvatar, requireSignIn, renderCard, getArtworkUrl, getPatronCard }) {
  const root = document.querySelector('#play-view');
  const $ = id => root.querySelector(`#play-${id}`);
  let userId = null, room = null, channel = null, timer = null, awayTicker = null, visible = false, inLobby = false;
  let lobbyTimer = null, directoryChannel = null, directoryUserId = null, listSerial = 0, tableListSignature = '';
  let busy = false, epoch = 0, fetchSerial = 0, live = false, lastHeartbeat = 0, autoDeckPending = false;
  let gameState = null, gameLoading = false, gameLoadFailed = false, handSignature = '', gameRenderSerial = 0, cardPreviewSerial = 0;
  let turnSeat = null, turnPhase = null, patronDeckRequest = '';
  const gameDeckPatrons = new Map(), gamePlayerPatrons = new Map();
  const patronPreviews = { self: { key: '', serial: 0 }, opponent: { key: '', serial: 0 } };
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
      <div class="play-room-bar"><div class="play-room-identity"><span class="play-eyebrow">TABLE</span><div class="play-room-name-line"><strong id="play-room-name"></strong><button id="play-edit-name" class="action-cancel" type="button">Edit name</button></div><form id="play-name-form" hidden><input id="play-name-input" aria-label="Table name" maxlength="60" required><button type="submit">Save</button><button id="play-cancel-name" type="button">Cancel</button></form><span class="play-room-code-line">Code: <strong id="play-room-code"></strong></span></div><div class="play-room-actions"><details class="play-table-menu"><summary class="play-menu-toggle" aria-label="Table actions" title="Table actions"><svg class="play-menu-bars" aria-hidden="true" viewBox="0 0 22 22"><path d="M3 5h16 M3 11h16 M3 17h16"/></svg></summary><div class="play-table-menu-panel"><button id="play-leave" class="action-delete" type="button">Abandon Table</button></div></details></div></div>
      <div id="play-players" class="play-players"></div>
      <label id="play-deck-field" class="play-deck-field" for="play-deck">Your deck<select id="play-deck"><option value="">No decks available</option></select></label>
      <button id="play-ready" class="action-add-save" type="button">Ready</button>
      <div id="play-controls-parking" hidden></div>
      <p id="play-room-status" role="status"></p>
    </section>
    <section id="play-game" hidden>
      <div class="play-game-player-block">
      <section id="play-game-opponent" class="play-surface play-game-seat" aria-label="Opponent's area">
        <div class="play-game-opponent-row">
          <span aria-hidden="true"></span>
          <div id="play-game-opponent-hand" class="play-game-opponent-hand" role="group" aria-label="Opponent's five face-down cards" hidden><span aria-hidden="true"></span><span aria-hidden="true"></span><span aria-hidden="true"></span><span aria-hidden="true"></span><span aria-hidden="true"></span></div>
          <div class="play-game-actions"><details class="play-table-menu"><summary class="play-menu-toggle" aria-label="Table actions" title="Table actions"><svg class="play-menu-bars" aria-hidden="true" viewBox="0 0 22 22"><path d="M3 5h16 M3 11h16 M3 17h16"/></svg></summary><div class="play-table-menu-panel"><strong id="play-game-name" class="play-menu-table-name"></strong><button id="play-game-back" class="play-menu-lobby" type="button">Back to Lobby</button><button id="play-game-leave" class="action-delete" type="button">Smash Table</button></div></details></div>
        </div>
      </section>
      <div class="play-game-opponent-identity play-game-player-identity"><strong id="play-game-opponent-name"></strong><span id="play-game-opponent-presence" class="play-away-pill" hidden></span></div>
      </div>
      <aside id="play-game-card-preview" class="play-game-card-preview" aria-label="Card preview" hidden><button id="play-game-card-preview-close" class="play-game-card-preview-close action-delete" type="button" aria-label="Close card preview">×</button><canvas id="play-game-card-preview-canvas" hidden></canvas><span id="play-game-card-preview-fallback" class="play-hand-fallback"></span></aside>
      <div class="play-game-board-wrap"><div class="play-game-table">
        <div class="play-game-zones-left">
          <div class="play-game-zone play-game-zone-opponent-patron"><div id="play-game-opponent-patron-slot" class="play-game-patron-slot" role="img" aria-label="Opponent's Patron"><canvas id="play-game-opponent-patron" hidden></canvas><span id="play-game-opponent-patron-fallback" class="play-game-patron-fallback" aria-hidden="true"></span></div></div>
          <div class="play-game-zone-pair play-game-zone-pair-self" aria-label="Your card zones"><div class="play-game-zone play-game-zone-horizon"><div id="play-game-self-horizon" class="play-deck-stack" role="img" aria-label="Your Horizon, draw deck"></div></div><div class="play-game-zone play-game-zone-archive"><div id="play-game-self-archive" class="play-game-archive-card" role="img" aria-label="Your Archive"><span id="play-game-archive-top"></span></div></div></div>
        </div>
        <div id="play-game-board" class="play-game-board" role="group" aria-label="Shared five-column, four-row Terrain board"></div>
        <div class="play-game-zones-right">
          <div class="play-game-zone-pair play-game-zone-pair-opponent" aria-label="Opponent's card zones"><div class="play-game-zone play-game-zone-archive"><div class="play-game-archive-card" role="img" aria-label="Opponent's Archive"></div></div><div class="play-game-zone play-game-zone-horizon"><div id="play-game-opponent-horizon" class="play-deck-stack" role="img" aria-label="Opponent's Horizon, draw deck"></div></div></div>
          <div class="play-game-zone play-game-zone-self-patron"><div id="play-game-self-patron-slot" class="play-game-patron-slot" role="img" aria-label="Your Patron"><canvas id="play-game-self-patron" hidden></canvas><span id="play-game-self-patron-fallback" class="play-game-patron-fallback" aria-hidden="true"></span></div></div>
        </div>
      </div>
      <aside id="play-game-phases" class="play-game-phases" aria-label="Turn phases">
        <span class="play-eyebrow">TURN PHASE</span>
        <p id="play-game-turn-owner" class="play-game-turn-owner" aria-live="polite"></p>
        <ol class="play-game-phase-list">
          <li data-phase="0"><span class="play-game-phase-marker" aria-hidden="true"></span>Beginning of Turn</li>
          <li data-phase="1"><span class="play-game-phase-marker" aria-hidden="true"></span>Draw</li>
          <li data-phase="2"><span class="play-game-phase-marker" aria-hidden="true"></span>Main Phase</li>
          <li data-phase="3"><span class="play-game-phase-marker" aria-hidden="true"></span>End of Turn</li>
        </ol>
        <button id="play-game-next-phase" class="play-game-next-phase" type="button">Next phase →</button>
      </aside></div>
      <div class="play-game-player-block">
      <div class="play-game-self-identity play-game-player-identity"><strong id="play-game-self-name"></strong><span id="play-game-self-presence" class="play-away-pill" hidden></span></div>
      <section id="play-game-self" class="play-surface play-game-seat" aria-label="Your area">
        <div class="play-game-hand-wrap"><p id="play-game-loading" role="status">Preparing the opening hands…</p><div id="play-game-hand" class="play-game-hand"></div></div>
      </section>
      </div>
    </section>`;
  function syncZoneCardSize() {
    const cell = $('game-board').firstElementChild;
    if (!cell) return;
    const { width, height } = cell.getBoundingClientRect();
    if (!width || !height) return;
    root.style.setProperty('--play-map-card-width', `${width}px`);
    root.style.setProperty('--play-map-card-height', `${height}px`);
  }
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(syncZoneCardSize).observe($('game-board'));
  }
  const deckField = $('deck-field');
  const readyButton = $('ready');
  const patronMarkerColors = { Flow: '#4b9ab7', Radiance: '#d4a13e', Symbiosis: '#9c71bc', Verdant: '#5d9c69' };
  function ownTurnSeat() { return room?.host_id === userId ? 'host' : 'guest'; }
  function renderTurnPhase() {
    const selected = turnSeat || 'host';
    const own = selected === ownTurnSeat();
    const patron = patronPreviews[own ? 'self' : 'opponent'].card;
    $('game-phases').style.setProperty('--play-phase-color', patronMarkerColors[patron?.terrain] || '#7ba98a');
    $('game-turn-owner').textContent = own ? 'Your turn' : "Opponent's turn";
    for (const step of root.querySelectorAll('.play-game-phase-list li')) {
      const active = Number(step.dataset.phase) === turnPhase;
      step.classList.toggle('is-current', active);
      if (active) step.setAttribute('aria-current', 'step');
      else step.removeAttribute('aria-current');
    }
    const next = $('game-next-phase');
    next.textContent = turnPhase === 3 ? 'Pass turn →' : 'Next phase →';
    next.disabled = !room || room.status !== 'active' || !own;
  }
  function restoreTurnPhase() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(`helianthe-play-phase:${room.id}`) || 'null'); } catch {}
    const startingSeat = room.starting_player_id === room.guest_id || room.first_player_id === room.guest_id ? 'guest' : 'host';
    turnSeat = ['host', 'guest'].includes(saved?.seat) ? saved.seat : startingSeat;
    turnPhase = Number.isInteger(saved?.phase) && saved.phase >= 0 && saved.phase < 4 ? saved.phase : 0;
  }
  function setTurnPhase(seat, phase, publish = true) {
    if (!room || !['host', 'guest'].includes(seat) || !(Number.isInteger(phase) && phase >= 0 && phase < 4)) return;
    turnSeat = seat; turnPhase = phase;
    try { localStorage.setItem(`helianthe-play-phase:${room.id}`, JSON.stringify({ seat, phase })); } catch {}
    renderTurnPhase();
    if (publish && channel) void channel.send({ type: 'broadcast', event: 'turn_phase', payload: { seat, phase } }).catch(() => {});
  }
  function advanceTurnPhase() {
    if (!room || room.status !== 'active' || turnSeat !== ownTurnSeat()) return;
    if (turnPhase === 3) setTurnPhase(turnSeat === 'host' ? 'guest' : 'host', 0);
    else setTurnPhase(turnSeat, turnPhase + 1);
  }
  $('game-next-phase').addEventListener('click', advanceTurnPhase);
  for (const seat of ['self', 'opponent']) {
    $(`game-${seat}-patron-slot`).addEventListener('contextmenu', event => {
      event.preventDefault();
      event.stopPropagation();
      const card = patronPreviews[seat].card;
      if (card) showCardPreview(card);
    });
  }
  root.querySelector('.play-game-board-wrap').addEventListener('contextmenu', event => {
    event.preventDefault();
    hideCardPreview();
  });
  document.addEventListener('pointerdown', event => {
    for (const menu of root.querySelectorAll('.play-table-menu[open]')) {
      if (!menu.contains(event.target)) menu.open = false;
    }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      for (const menu of root.querySelectorAll('.play-table-menu[open]')) menu.open = false;
      hideCardPreview();
    }
  });
  function message(text = '', error = false) {
    $('message-text').textContent = text;
    $('message').hidden = !text;
    $('message').classList.toggle('error', error);
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
    ++gameRenderSerial; gameState = null; gameLoading = false; gameLoadFailed = false; handSignature = '';
    turnSeat = null; turnPhase = null; patronDeckRequest = ''; gameDeckPatrons.clear(); gamePlayerPatrons.clear();
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
    $('deck').disabled = !canAct() || !getDecks().length;
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
    if (!room || !userId || room.status === 'closed' || room.activated_at || (room.host_id !== userId && room.guest_id !== userId)
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
    const selectedPatron = gamePlayerPatrons.get(String(id)) || gameDeckPatrons.get(String(deckId))
      || deck?.patron_name || (own ? gameState?.patron_name : null) || savedPatron;
    renderGamePatron(seat, selectedPatron);
  }
  async function loadGamePatrons() {
    if (!room || room.status !== 'active') return;
    const deckIds = [room.host_deck_id, room.guest_deck_id].filter(Boolean);
    const signature = deckIds.map(String).join(':');
    if (!signature || signature === patronDeckRequest) return;
    patronDeckRequest = signature;
    const expected = epoch, roomId = room.id;
    const [decks, gameDecks] = await Promise.all([
      client.from('decks').select('id,patron_name').in('id', deckIds),
      client.from('play_game_decks').select('player_id,patron_name').eq('room_id', roomId),
    ]);
    if (expected !== epoch || room?.id !== roomId) return;
    if (!decks.error) for (const deck of decks.data || []) gameDeckPatrons.set(String(deck.id), deck.patron_name);
    if (!gameDecks.error) for (const deck of gameDecks.data || []) gamePlayerPatrons.set(String(deck.player_id), deck.patron_name);
    if (decks.error && gameDecks.error) patronDeckRequest = '';
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
    $('game-card-preview').hidden = true;
  }
  function showCardPreview(card) {
    const serial = ++cardPreviewSerial;
    const panel = $('game-card-preview');
    const canvas = $('game-card-preview-canvas');
    const fallback = $('game-card-preview-fallback');
    canvas.hidden = true;
    fallback.hidden = false;
    fallback.textContent = card.title || 'Card';
    panel.setAttribute('aria-label', `Preview of ${card.title || 'card'}`);
    panel.hidden = false;
    void (async () => {
      const artwork = card.artwork_id ? await getArtworkUrl(card.artwork_id).catch(() => '') : '';
      const result = await renderCard(canvas, card, artwork, () => serial === cardPreviewSerial);
      if (serial === cardPreviewSerial && result && !result.cancelled) {
        canvas.hidden = false;
        fallback.hidden = true;
      }
    })().catch(() => {});
  }
  $('game-card-preview-close').addEventListener('click', hideCardPreview);
  function resolveGameCard(raw) {
    const card = raw && typeof raw === 'object' ? raw : { title: String(raw || '') };
    const catalog = getCards?.() || [];
    const id = card.card_id || card.id;
    const title = String(card.title || card.name || '').trim().toLocaleLowerCase();
    const full = catalog.find(item => id && String(item.id) === String(id))
      || catalog.find(item => title && item.title?.trim().toLocaleLowerCase() === title);
    return full ? { ...card, ...full } : card;
  }
  function renderGameHand() {
    const hand = Array.isArray(gameState?.hand) ? gameState.hand.map(resolveGameCard) : [];
    const signature = JSON.stringify(hand);
    if (signature === handSignature) return;
    handSignature = signature;
    const serial = ++gameRenderSerial;
    hideCardPreview();
    const cards = hand.map(card => {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'play-hand-card';
      button.setAttribute('aria-label', `Preview ${card.title || 'card'}`);
      const canvas = document.createElement('canvas'); canvas.hidden = true;
      const fallback = document.createElement('span'); fallback.className = 'play-hand-fallback';
      fallback.textContent = card.title || 'Card';
      button.append(canvas, fallback);
      button.addEventListener('click', () => showCardPreview(card));
      button.addEventListener('contextmenu', event => {
        event.preventDefault();
        showCardPreview(card);
      });
      void (async () => {
        const artwork = card.artwork_id ? await getArtworkUrl(card.artwork_id).catch(() => '') : '';
        const result = await renderCard(canvas, card, artwork, () => serial === gameRenderSerial);
        if (serial === gameRenderSerial && result && !result.cancelled) {
          canvas.hidden = false; fallback.hidden = true;
        }
      })().catch(() => {});
      return button;
    });
    $('game-hand').replaceChildren(...cards);
  }
  function renderGame() {
    if (!room || room.status !== 'active') return;
    $('game-name').textContent = room.name || 'Table';
    $('game-leave').textContent = room.host_id === userId ? 'Smash Table' : 'Abandon Table';
    gamePlayerCard(room.host_id === userId ? room.guest_id : room.host_id,
      room.host_id === userId ? room.guest_deck_id : room.host_deck_id, false);
    gamePlayerCard(userId, ownDeckId(), true);
    const nodes = [];
    for (let row = 0; row < 4; row++) for (let column = 0; column < 5; column++) {
      const isCenter = column === 2 && (row === 1 || row === 2);
      const node = isCenter ? null : room.board?.[`${column},${row}`];
      const cell = document.createElement('div'); cell.className = 'play-game-node';
      if (isCenter) {
        cell.classList.add('terrain-center');
        cell.setAttribute('aria-label', `Center card at row ${row + 1}, column ${column + 1}`);
        nodes.push(cell);
        continue;
      }
      if (node?.terrain) {
        cell.classList.add(`terrain-${node.terrain.toLowerCase()}`);
        const terrain = document.createElement('strong'); terrain.textContent = node.terrain;
        cell.append(terrain);
        if (node.entity) {
          const entity = document.createElement('span'); entity.textContent = node.entity.title || 'Entity';
          cell.append(entity);
        }
      }
      cell.setAttribute('aria-label', node?.terrain ? `${node.terrain} Terrain at row ${row + 1}, column ${column + 1}` : `Empty space at row ${row + 1}, column ${column + 1}`);
      nodes.push(cell);
    }
    $('game-board').replaceChildren(...nodes);
    requestAnimationFrame(syncZoneCardSize);
    $('game-loading').hidden = Boolean(gameState) || gameLoadFailed;
    $('game-opponent-hand').hidden = !gameState;
    const horizon = Array.isArray(gameState?.horizon) ? gameState.horizon : [];
    const archive = Array.isArray(gameState?.archive) ? gameState.archive : [];
    $('game-self-horizon').setAttribute('aria-label', gameState ? `Your Horizon, ${horizon.length} cards` : 'Your Horizon, draw deck');
    $('game-self-archive').setAttribute('aria-label', gameState ? `Your Archive, ${archive.length} cards` : 'Your Archive');
    $('game-archive-top').textContent = archive.at(-1)?.title || '';
    updateAwayDisplays();
    renderGameHand();
  }
  async function loadGameState() {
    if (!room || room.status !== 'active' || gameState?.room_id === room.id || gameLoading || gameLoadFailed) return;
    const id = room.id, expected = epoch, gameSerial = gameRenderSerial;
    gameLoading = true;
    const { data, error } = await client.from('play_game_decks').select('*').eq('room_id', id).eq('player_id', userId).maybeSingle();
    if (expected !== epoch || room?.id !== id || gameSerial !== gameRenderSerial) return;
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
    userId = seatId;
    if (room.activated_at && !data.activated_at) {
      ++gameRenderSerial; gameState = null; gameLoading = false; gameLoadFailed = false; handSignature = '';
      hideCardPreview();
    }
    room = data; render();
    if (room.status === 'active') {
      void loadGameState();
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
    const { data, error } = await client.from('play_rooms').select('*').eq('id', id).maybeSingle();
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
      data[`${seat}_away_until`] = null;
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
    room = data; lastHeartbeat = 0; remember(id); restoreTurnPhase(); render(); maybeAutoSelectDeck();
    if (room.status === 'active') {
      void loadGameState();
      void loadGamePatrons().catch(() => { patronDeckRequest = ''; });
    }
    if (renameFailed) message('The table was created, but its name could not be updated. Use Edit name to try again.', true);
    channel = client.channel(`play-room:${id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'play_rooms', filter: `id=eq.${id}` }, () => {
        if (expected === epoch) void refreshRoom().catch(error => message(friendly(error), true));
      })
      .on('broadcast', { event: 'turn_phase' }, ({ payload }) => {
        if (expected === epoch && room?.id === id) setTurnPhase(payload?.seat, payload?.phase, false);
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
    if (!playing) hideCardPreview();
    $('signin').hidden = Boolean(userId);
    $('lobby').hidden = !userId || Boolean(room && !inLobby);
    $('session').hidden = !userId || !room || playing || inLobby;
    $('game').hidden = !playing;
    if (!room) { controls(); return; }
    if (inLobby) { updateAwayDisplays(); controls(); return; }
    $('room-code').textContent = room.code;
    $('room-name').textContent = room.name || defaultTableName(getProfiles().find(p => p.id === room.host_id)?.display_name);
    $('edit-name').hidden = room.host_id !== userId || room.status === 'closed';
    $('leave').textContent = room.host_id === userId ? 'Smash Table' : 'Abandon Table';
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
  $('leave').addEventListener('click', () => run(leaveTable));
  $('game-leave').addEventListener('click', () => run(leaveTable));
  $('deck').addEventListener('change', () => {
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
