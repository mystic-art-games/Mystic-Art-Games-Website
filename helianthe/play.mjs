const defaultTableName = hostName => `${Array.from(String(hostName ?? '').trim() || 'Player').slice(0, 52).join("")}'s Table`;

export function playerOnline(timestamp, now = Date.now()) {
  return Boolean(timestamp && now - Date.parse(timestamp) < 45000);
}

export function createPlayView({ client, getUser, getDecks, getProfiles, makeAvatar, requireSignIn, renderCard, getArtworkUrl, getPatronCard }) {
  const root = document.querySelector('#play-view');
  const $ = id => root.querySelector(`#play-${id}`);
  let userId = null, room = null, channel = null, timer = null, visible = false;
  let lobbyTimer = null, directoryChannel = null, directoryUserId = null, listSerial = 0, tableListSignature = '';
  let busy = false, epoch = 0, fetchSerial = 0, live = false, lastHeartbeat = 0, autoDeckPending = false;
  let gameState = null, gameLoading = false, gameLoadFailed = false, handSignature = '', gameRenderSerial = 0;
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
      <div class="play-room-bar"><div class="play-room-identity"><span class="play-eyebrow">TABLE</span><div class="play-room-name-line"><strong id="play-room-name"></strong><button id="play-edit-name" class="action-cancel" type="button">Edit name</button></div><form id="play-name-form" hidden><input id="play-name-input" aria-label="Table name" maxlength="60" required><button type="submit">Save</button><button id="play-cancel-name" type="button">Cancel</button></form><span class="play-room-code-line">Code: <strong id="play-room-code"></strong></span></div><div class="play-room-actions"><details class="play-table-menu"><summary class="play-menu-toggle" aria-label="Table actions" title="Table actions"></summary><div class="play-table-menu-panel"><button id="play-leave" class="action-delete" type="button">Abandon Table</button></div></details></div></div>
      <div id="play-players" class="play-players"></div>
      <label id="play-deck-field" class="play-deck-field" for="play-deck">Your deck<select id="play-deck"><option value="">No decks available</option></select></label>
      <button id="play-ready" class="action-add-save" type="button">Ready</button>
      <div id="play-controls-parking" hidden></div>
      <p id="play-room-status" role="status"></p>
    </section>
    <section id="play-game" hidden>
      <div class="play-game-toolbar"><button id="play-game-back" class="back-to-decks" type="button"><span aria-hidden="true">←</span> Back to Lobby</button><strong id="play-game-name"></strong><div class="play-game-actions"><details class="play-table-menu"><summary class="play-menu-toggle" aria-label="Table actions" title="Table actions"></summary><div class="play-table-menu-panel"><button id="play-game-leave" class="action-delete" type="button">Smash Table</button></div></details></div></div>
      <section id="play-game-opponent" class="play-surface play-game-seat" aria-label="Opponent's area">
        <div class="play-game-seat-heading"><strong id="play-game-opponent-name"></strong></div>
        <div id="play-game-opponent-hand" class="play-game-opponent-hand" role="group" aria-label="Opponent's five face-down cards" hidden><span aria-hidden="true"></span><span aria-hidden="true"></span><span aria-hidden="true"></span><span aria-hidden="true"></span><span aria-hidden="true"></span></div>
      </section>
      <div class="play-game-board-wrap"><h2>The World</h2><div class="play-game-table">
        <div class="play-game-zones-left">
          <div class="play-game-zone play-game-zone-opponent-patron"><div id="play-game-opponent-patron-slot" class="play-game-patron-slot" role="img" aria-label="Opponent's Patron"><canvas id="play-game-opponent-patron" hidden></canvas><span id="play-game-opponent-patron-fallback" class="play-game-patron-fallback" aria-hidden="true"></span></div></div>
          <div class="play-game-zone play-game-zone-self-patron"><div id="play-game-self-patron-slot" class="play-game-patron-slot" role="img" aria-label="Your Patron"><canvas id="play-game-self-patron" hidden></canvas><span id="play-game-self-patron-fallback" class="play-game-patron-fallback" aria-hidden="true"></span></div></div>
        </div>
        <div id="play-game-board" class="play-game-board" role="group" aria-label="Shared 19-hex Terrain board"></div>
        <div class="play-game-zones-right">
          <div class="play-game-zone-pair play-game-zone-pair-opponent" aria-label="Opponent's card zones"><div class="play-game-zone"><div class="play-game-archive-card" role="img" aria-label="Opponent's Archive"></div><span class="play-game-zone-label">ARCHIVE</span></div><div class="play-game-zone"><div id="play-game-opponent-horizon" class="play-deck-stack" role="img" aria-label="Opponent's Horizon, draw deck"></div><span class="play-game-zone-label">HORIZON</span></div></div>
          <div class="play-game-zone-pair play-game-zone-pair-self" aria-label="Your card zones"><div class="play-game-zone"><div class="play-game-archive-card"><span id="play-game-archive-top">Empty</span></div><span class="play-game-zone-label">ARCHIVE <span id="play-game-archive-count"></span></span></div><div class="play-game-zone"><div class="play-deck-stack" role="img" aria-label="Your Horizon, draw deck"></div><span class="play-game-zone-label">HORIZON <span id="play-game-horizon-count"></span></span></div></div>
        </div>
      </div></div>
      <section id="play-game-self" class="play-surface play-game-seat" aria-label="Your area">
        <div class="play-game-seat-heading"><strong id="play-game-self-name"></strong><span id="play-game-counts"></span></div>
        <p id="play-game-loading" role="status">Preparing the opening hands…</p>
        <div id="play-game-hand" class="play-game-hand"></div>
        <p id="play-game-card-detail" class="play-game-card-detail" hidden></p>
      </section>
    </section>`;
  const deckField = $('deck-field');
  const readyButton = $('ready');
  function message(text = '', error = false) {
    $('message-text').textContent = text;
    $('message').hidden = !text;
    $('message').classList.toggle('error', error);
  }
  $('message-close').addEventListener('click', () => message());
  function storageKey() { return `helianthe-play-room:${userId}`; }
  function remember(id) { try { if (id) localStorage.setItem(storageKey(), id); else localStorage.removeItem(storageKey()); } catch {} }
  function savedRoom() { try { return localStorage.getItem(storageKey()); } catch { return null; } }
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
    if (timer) clearInterval(timer);
    timer = null;
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
    const profile = getProfiles().find(person => person.id === id);
    const deck = getDecks().find(item => item.id === deckId);
    $(`game-${seat}-name`).textContent = `${profile?.display_name || 'Player'}${own ? ' · You' : ''}`;
    if (!own) $('game-opponent-horizon').setAttribute('aria-label', `Opponent's Horizon, ${deck?.name || 'selected deck'}`);
    renderGamePatron(seat, own ? (gameState?.patron_name || deck?.patron_name) : deck?.patron_name);
  }
  function renderGamePatron(seat, patronName) {
    const card = getPatronCard?.(patronName) || (patronName ? { title: patronName, card_type: 'Patron' } : null);
    const preview = patronPreviews[seat];
    const key = `${patronName || ''}:${card?.id || ''}:${card?.artwork_id || ''}`;
    if (preview.key === key) return;
    preview.key = key;
    const serial = ++preview.serial;
    const canvas = $(`game-${seat}-patron`);
    const fallback = $(`game-${seat}-patron-fallback`);
    canvas.hidden = true;
    fallback.hidden = false;
    $(`game-${seat}-patron-slot`).setAttribute('aria-label', `${seat === 'self' ? 'Your' : "Opponent's"} Patron: ${patronName || 'unknown'}`);
    if (!card) return;
    void (async () => {
      const artwork = card.artwork_id ? await getArtworkUrl(card.artwork_id).catch(() => '') : '';
      const result = await renderCard(canvas, card, artwork, () => serial === preview.serial);
      if (serial === preview.serial && result && !result.cancelled) {
        canvas.hidden = false;
        fallback.hidden = true;
      }
    })().catch(() => {});
  }
  function renderGameHand() {
    const hand = Array.isArray(gameState?.hand) ? gameState.hand : [];
    const signature = JSON.stringify(hand);
    if (signature === handSignature) return;
    handSignature = signature;
    const serial = ++gameRenderSerial;
    const cards = hand.map(card => {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'play-hand-card';
      button.setAttribute('aria-label', `View ${card.title || 'card'}`);
      const canvas = document.createElement('canvas'); canvas.hidden = true;
      const fallback = document.createElement('span'); fallback.className = 'play-hand-fallback';
      fallback.textContent = card.title || 'Card';
      button.append(canvas, fallback);
      button.addEventListener('click', () => {
        $('game-card-detail').textContent = `${card.title || 'Card'} · ${card.card_type || 'Card'}${card.terrain ? ` · ${card.terrain}` : ''}${card.effect ? ` — ${card.effect}` : ''}`;
        $('game-card-detail').hidden = false;
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
    $('game-card-detail').hidden = true;
  }
  function renderGame() {
    if (!room || room.status !== 'active') return;
    $('game-name').textContent = room.name || 'Table';
    $('game-leave').textContent = room.host_id === userId ? 'Smash Table' : 'Abandon Table';
    gamePlayerCard(room.host_id === userId ? room.guest_id : room.host_id,
      room.host_id === userId ? room.guest_deck_id : room.host_deck_id, false);
    gamePlayerCard(userId, ownDeckId(), true);
    const nodes = [];
    for (let q = -2; q <= 2; q++) for (let r = -2; r <= 2; r++) {
      if (Math.abs(q + r) > 2) continue;
      const node = room.board?.[`${q},${r}`];
      const cell = document.createElement('div'); cell.className = 'play-game-node';
      cell.style.left = `${50 + 17.25 * q}%`;
      cell.style.top = `${50 + 19.918 * (r + q / 2)}%`;
      if (node?.terrain) {
        cell.classList.add(`terrain-${node.terrain.toLowerCase()}`);
        const terrain = document.createElement('strong'); terrain.textContent = node.terrain;
        cell.append(terrain);
        if (node.entity) {
          const entity = document.createElement('span'); entity.textContent = node.entity.title || 'Entity';
          cell.append(entity);
        }
      }
      cell.setAttribute('aria-label', node?.terrain ? `${node.terrain} Terrain at ${q}, ${r}` : `Empty space ${q}, ${r}`);
      nodes.push(cell);
    }
    $('game-board').replaceChildren(...nodes);
    $('game-loading').hidden = Boolean(gameState) || gameLoadFailed;
    $('game-opponent-hand').hidden = !gameState;
    const horizon = Array.isArray(gameState?.horizon) ? gameState.horizon : [];
    const archive = Array.isArray(gameState?.archive) ? gameState.archive : [];
    $('game-horizon-count').textContent = gameState ? `(${horizon.length})` : '';
    $('game-archive-count').textContent = gameState ? `(${archive.length})` : '';
    $('game-archive-top').textContent = archive.at(-1)?.title || 'Empty';
    $('game-counts').textContent = gameState ? `${gameState.hand.length} cards` : '';
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
    const directoryIdentity = visible && userId && !room ? userId : null;
    if (directoryIdentity !== directoryUserId) {
      if (directoryChannel) void client.removeChannel(directoryChannel);
      directoryChannel = null;
      directoryUserId = directoryIdentity;
      if (directoryIdentity) {
        directoryChannel = client.channel('play-table-directory')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'play_table_directory_signals' }, () => {
            if (!room) void listTables();
          })
          .subscribe(status => { if (status === 'SUBSCRIBED' && !room) void listTables(); });
      }
    }
    if (!visible || !userId || room) {
      if (lobbyTimer) clearInterval(lobbyTimer);
      lobbyTimer = null;
    } else if (!lobbyTimer) {
      lobbyTimer = setInterval(() => { if (!document.hidden && !busy) void listTables(); }, 3000);
    }
  }
  async function listTables() {
    if (!userId || room) return;
    const expected = epoch, serial = ++listSerial;
    const { data, error } = await client.rpc('play_list_tables');
    if (expected !== epoch || serial !== listSerial || room) return;
    if (error) { $('no-rooms').textContent = 'Tables could not be loaded. Retrying automatically…'; $('no-rooms').hidden = false; message(friendly(error), true); return; }
    $('no-rooms').hidden = Boolean(data.length);
    $('no-rooms').textContent = 'People are doing things right now. Nobody is playing cards.';
    const signature = JSON.stringify(data);
    if (signature === tableListSignature) return;
    tableListSignature = signature;
    $('room-list').replaceChildren();
    for (const entry of data) {
      const row = document.createElement('div'); row.className = 'play-table-entry';
      const details = document.createElement('div');
      const title = document.createElement('strong'); title.textContent = entry.name || defaultTableName(entry.host_name);
      const summary = document.createElement('span'); summary.textContent = `${entry.host_name} · ${entry.player_count} / 2 players`;
      details.append(title, summary);
      const b = document.createElement('button'); b.type = 'button';
      const full = !entry.is_participant && entry.player_count >= 2;
      b.textContent = entry.is_participant ? 'Sit down' : full ? 'Full' : 'Join table';
      if (entry.is_participant) b.classList.add('action-add-save');
      b.dataset.full = String(full); b.disabled = busy || full;
      b.setAttribute('aria-label', `${b.textContent} ${entry.code}`);
      b.addEventListener('click', () => run(async () => {
        try {
          const id = entry.is_participant ? entry.table_id : await rpc('play_join_room', { p_code: entry.code });
          await enter(id);
        } finally { if (!room) await listTables(); }
      }));
      if (entry.is_participant) {
        const action = document.createElement('div'); action.className = 'play-table-action';
        const hint = document.createElement('span'); hint.className = 'play-chair-note';
        hint.textContent = 'Your chair is missing you.';
        action.append(hint, b);
        row.append(details, action);
      } else row.append(details, b);
      $('room-list').append(row);
    }
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
      await disconnect(); room = null; remember(null); render(); await listTables();
      if (data) message('This table belongs to another account. Sign in with the account that joined it.');
      return;
    }
    userId = seatId;
    if (room.activated_at && !data.activated_at) {
      ++gameRenderSerial; gameState = null; gameLoading = false; gameLoadFailed = false; handSignature = '';
    }
    room = data; render();
    if (room.status === 'active') void loadGameState();
    if (room.status === 'closed') {
      const notice = 'The table was smashed.';
      await disconnect(); room = null; remember(null); render(); await listTables(); message(notice);
    }
  }
  async function heartbeat() {
    if (!visible || document.hidden || !room || room.status === 'closed' || busy) return;
    const expected = epoch;
    try {
      if (Date.now() - lastHeartbeat > 18000) {
        await rpc('play_room_action', { p_room_id: room.id, p_action: 'heartbeat' });
        lastHeartbeat = Date.now();
      }
      await refreshRoom();
    } catch (error) { if (expected === epoch) { live = false; message('Connection interrupted. Reconnecting to your saved table…', true); } }
  }
  async function enter(id, newTable = false) {
    await disconnect();
    const expected = epoch;
    const { data, error } = await client.from('play_rooms').select('*').eq('id', id).maybeSingle();
    if (expected !== epoch) return;
    if (error) throw error;
    if (!data || data.status === 'closed') { remember(null); throw new Error('Table not found or closed.'); }
    const seatId = await seatedUserId(data);
    if (expected !== epoch) return;
    if (!seatId) { remember(null); throw new Error('This table belongs to another account. Sign in with the account that joined it.'); }
    userId = seatId;
    let renameFailed = false;
    if (newTable && data.name?.endsWith(' table')) {
      const name = defaultTableName(data.name.slice(0, -6));
      try { await rpc('play_rename_table', { p_room_id: id, p_name: name }); data.name = name; }
      catch { renameFailed = true; }
      if (expected !== epoch) return;
    }
    room = data; lastHeartbeat = 0; remember(id); render(); maybeAutoSelectDeck();
    if (room.status === 'active') void loadGameState();
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
    void heartbeat();
  }
  async function action(name, payload = {}) {
    if (!room || !userId) return;
    const expected = epoch;
    await rpc('play_room_action', { p_room_id: room.id, p_action: name, p_payload: payload });
    if (expected === epoch) { message(); await refreshRoom(); }
  }
  function refreshCollections() {
    const decks = getDecks();
    const value = room ? ownDeckId() : $('deck').value;
    $('deck').replaceChildren(...(decks.length ? decks.map(deck => new Option(deck.name, deck.id)) : [new Option('No decks available', '')]));
    $('deck').value = decks.some(deck => deck.id === value) ? value : (decks[0]?.id || '');
    controls();
    maybeAutoSelectDeck();
  }
  function render() {
    syncLobbyRefresh();
    root.classList.toggle('is-at-table', Boolean(userId && room));
    const playing = Boolean(userId && room?.status === 'active');
    $('signin').hidden = Boolean(userId);
    $('lobby').hidden = !userId || Boolean(room);
    $('session').hidden = !userId || !room || playing;
    $('game').hidden = !playing;
    if (!room) { controls(); return; }
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
  $('back').addEventListener('click', () => run(async () => {
    await disconnect(); room = null; remember(null); render(); await listTables();
  }));
  $('game-back').addEventListener('click', () => run(async () => {
    await disconnect(); room = null; remember(null); render(); await listTables();
  }));
  $('leave').addEventListener('click', () => run(async () => {
    if (room.status !== 'closed') await action('leave');
    await disconnect(); room = null; remember(null); render(); message(); await listTables();
  }));
  $('game-leave').addEventListener('click', () => $('leave').click());
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
    userId = next; room = null; tableListSignature = '';
    const pendingDisconnect = disconnect();
    $('room-list').replaceChildren(); render(); refreshCollections();
    await pendingDisconnect;
    if (userId !== next) return;
    if (!userId) return;
    if (visible && !busy) { const id = savedRoom(); if (id) void run(() => enter(id)); else await listTables(); }
  }
  function setVisible(value) {
    visible = value;
    syncLobbyRefresh();
    if (!value) return;
    refreshCollections();
    if (!userId) { render(); return; }
    if (room) void heartbeat();
    else { const id = savedRoom(); if (id) void run(() => enter(id)); else void listTables(); }
  }
  render();
  return { refreshIdentity, refreshCollections, setVisible };
}
