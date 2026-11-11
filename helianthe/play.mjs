const TERRAINS = ['Symbiosis', 'Flow', 'Verdant', 'Radiance'];
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function playerOnline(timestamp, now = Date.now()) {
  return Boolean(timestamp && now - Date.parse(timestamp) < 45000);
}

export function createPlayView({ client, getUser, getDecks, getCards, getProfiles, requireSignIn }) {
  const root = document.querySelector('#play-view');
  const $ = id => root.querySelector(`#play-${id}`);
  let userId = null, room = null, channel = null, timer = null, visible = false;
  let lobbyTimer = null, listSerial = 0, tableListSignature = '';
  let busy = false, epoch = 0, fetchSerial = 0, boardRevision = -1, live = false;
  let selected = { x: 0, y: 0 }, origin = { x: -3, y: -2 }, lastHeartbeat = 0;
  root.innerHTML = `
    <div class="play-heading"><div><span class="play-eyebrow">THE SHARED WORLD</span><h1>Play</h1><p>Meet another player at the same table.</p></div><span id="play-connection" class="play-pill" hidden></span></div>
    <p id="play-message" role="status" aria-live="polite" hidden></p>
    <section id="play-signin" class="play-surface" hidden><h2>Your seat is waiting</h2><p>Sign in to create a table or join one from the list.</p><button id="play-signin-button" type="button">Sign in to play</button></section>
    <div id="play-lobby" class="play-lobby" hidden>
      <section class="play-surface play-create-panel"><div><span class="play-eyebrow">HOST A SESSION</span><h2>Create a table</h2></div><button id="play-create" type="button">Create table</button></section>
      <section class="play-surface play-recent"><div class="play-table-heading"><h2>All tables</h2><button id="play-refresh" type="button">Refresh</button></div><p id="play-no-rooms">Loading tables…</p><div id="play-room-list"></div></section>
    </div>
    <section id="play-session" hidden>
      <div class="play-room-bar"><div><span class="play-eyebrow">TABLE</span><strong id="play-room-code"></strong></div><div class="play-room-actions"><button id="play-leave" type="button">Leave table</button></div></div>
      <div id="play-players" class="play-players"></div>
      <div class="play-setup play-surface"><label for="play-deck">Your deck<select id="play-deck"><option value="">Choose a deck</option></select></label><button id="play-ready" type="button">Ready</button><span id="play-room-status" role="status"></span></div>
      <div class="play-table-layout"><section class="play-surface play-table-panel" aria-label="Shared table">
        <div class="play-table-heading"><h2>Shared table</h2><span id="play-save-status" class="play-pill">Saved</span></div>
        <p class="play-table-hint">Select a space to create Terrain or update a Node. Both players can edit the table.</p>
        <div id="play-board" class="play-board" aria-label="Terrain layout"></div>
        <div class="play-pan" aria-label="Move table view"><button type="button" data-pan="left" aria-label="View left">←</button><button type="button" data-pan="up" aria-label="View up">↑</button><button type="button" data-pan="home">Center</button><button type="button" data-pan="down" aria-label="View down">↓</button><button type="button" data-pan="right" aria-label="View right">→</button></div>
      </section><aside class="play-surface play-node-panel"><h2 id="play-node-title">Node · 0, 0</h2>
        <label for="play-terrain">Terrain<select id="play-terrain">${TERRAINS.map(t => `<option>${t}</option>`).join('')}</select></label><button id="play-set-terrain" type="button">Create Terrain</button>
        <fieldset id="play-node-controls"><legend>On this Node</legend><label for="play-entity">Entity<select id="play-entity"><option value="">No Entity</option></select></label><button id="play-set-entity" type="button">Place Entity</button>
        <div class="play-node-actions"><button id="play-crisis" type="button" aria-pressed="false">Crisis</button><button id="play-protect" type="button" aria-pressed="false">Protection</button></div>
        <div class="play-lumens"><span id="play-lumen-count">Lumens: 0 / 2</span><button id="play-lumen-minus" type="button" aria-label="Remove one Lumen">−</button><button id="play-lumen-plus" type="button" aria-label="Add one Lumen">+</button></div>
        <button id="play-remove" type="button">Remove Node</button></fieldset>
        <div id="play-entity-detail" class="play-entity-detail" hidden></div>
      </aside></div>
      <p class="play-scope">Choose decks and edit Terrain, Entities and markers together. Drawing cards and private hands are coming next. Resolve card effects together.</p>
    </section>`;
  function message(text = '', error = false) {
    $('message').textContent = text;
    $('message').hidden = !text;
    $('message').classList.toggle('error', error);
  }
  function storageKey() { return `helianthe-play-room:${userId}`; }
  function remember(id) { try { if (id) localStorage.setItem(storageKey(), id); else localStorage.removeItem(storageKey()); } catch {} }
  function savedRoom() { try { return localStorage.getItem(storageKey()); } catch { return null; } }
  function friendly(error) {
    if (['PGRST202', 'PGRST205', '42P01', '42883'].includes(error.code)) return 'Play is not available yet. Please try again later.';
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
    if (timer) clearInterval(timer);
    timer = null;
    const previous = channel; channel = null; live = false;
    if (previous) await client.removeChannel(previous);
  }
  function canAct() { return Boolean(room && userId && room.status !== 'closed' && !busy); }
  function controls() {
    $('create').disabled = busy;
    $('refresh').disabled = busy;
    for (const b of $('room-list').querySelectorAll('button')) b.disabled = busy || b.dataset.full === 'true';
    for (const id of ['deck', 'ready', 'set-terrain']) $(id).disabled = !canAct();
    $('leave').disabled = busy || !room;
    $('node-controls').disabled = !canAct() || !room?.board?.[`${selected.x},${selected.y}`];
  }
  async function run(task) {
    if (busy) return;
    busy = true; controls(); message();
    try { await task(); }
    catch (error) { message(friendly(error), true); }
    finally { busy = false; controls(); }
  }
  function syncLobbyRefresh() {
    if (!visible || !userId || room) {
      if (lobbyTimer) clearInterval(lobbyTimer);
      lobbyTimer = null;
    } else if (!lobbyTimer) {
      lobbyTimer = setInterval(() => { if (!document.hidden && !busy) void listTables(); }, 8000);
    }
  }
  async function listTables() {
    if (!userId || room) return;
    const expected = epoch, serial = ++listSerial;
    const { data, error } = await client.rpc('play_list_tables');
    if (expected !== epoch || serial !== listSerial || room) return;
    if (error) { $('no-rooms').textContent = 'Tables could not be loaded. Try Refresh.'; $('no-rooms').hidden = false; message(friendly(error), true); return; }
    $('no-rooms').hidden = Boolean(data.length);
    $('no-rooms').textContent = 'No tables yet. Create the first one.';
    const signature = JSON.stringify(data);
    if (signature === tableListSignature) return;
    tableListSignature = signature;
    $('room-list').replaceChildren();
    for (const entry of data) {
      const row = document.createElement('div'); row.className = 'play-table-entry';
      const details = document.createElement('div');
      const title = document.createElement('strong'); title.textContent = `Table ${entry.code}`;
      const summary = document.createElement('span'); summary.textContent = `${entry.host_name} · ${entry.player_count} / 2 players`;
      details.append(title, summary);
      const b = document.createElement('button'); b.type = 'button';
      const full = !entry.is_participant && entry.player_count >= 2;
      b.textContent = entry.is_participant ? 'Return to table' : full ? 'Full' : 'Join table';
      b.dataset.full = String(full); b.disabled = busy || full;
      b.setAttribute('aria-label', `${b.textContent} ${entry.code}`);
      b.addEventListener('click', () => run(async () => {
        try {
          const id = entry.is_participant ? entry.table_id : await rpc('play_join_room', { p_code: entry.code });
          await enter(id);
        } finally { if (!room) await listTables(); }
      }));
      row.append(details, b); $('room-list').append(row);
    }
  }
  async function refreshRoom() {
    if (!room || !userId) return;
    const id = room.id, expected = epoch, serial = ++fetchSerial;
    const { data, error } = await client.from('play_rooms').select('*').eq('id', id).maybeSingle();
    if (expected !== epoch || serial !== fetchSerial || room?.id !== id) return;
    if (error) throw error;
    if (!data) { await disconnect(); room = null; remember(null); render(); await listTables(); return; }
    room = data; render();
    if (room.status === 'closed') { remember(null); await disconnect(); message('The host closed this table. Return to the lobby to create or join another table.'); }
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
    } catch (error) { if (expected === epoch) { live = false; renderConnection(); message('Connection interrupted. Reconnecting to your saved table…', true); } }
  }
  async function enter(id) {
    await disconnect();
    const expected = epoch;
    const { data, error } = await client.from('play_rooms').select('*').eq('id', id).maybeSingle();
    if (expected !== epoch) return;
    if (error) throw error;
    if (!data || data.status === 'closed') { remember(null); throw new Error('Table not found or closed.'); }
    room = data; boardRevision = -1; lastHeartbeat = 0; remember(id); render();
    channel = client.channel(`play-room:${id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'play_rooms', filter: `id=eq.${id}` }, () => {
        if (expected === epoch) void refreshRoom().catch(error => message(friendly(error), true));
      }).subscribe(status => {
        if (expected !== epoch) return;
        live = status === 'SUBSCRIBED'; renderConnection();
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
  function renderConnection() {
    $('connection').hidden = !room;
    $('connection').textContent = !room ? '' : room.status === 'closed' ? 'Table closed' : live ? 'Live connection' : 'Connecting…';
    $('connection').classList.toggle('is-live', Boolean(room && live));
  }
  function refreshCollections() {
    const value = room ? (room.host_id === userId ? room.host_deck_id : room.guest_deck_id) : $('deck').value;
    $('deck').innerHTML = '<option value="">Choose a deck</option>' + getDecks().map(d => `<option value="${escape(d.id)}">${escape(d.name)}</option>`).join('');
    $('deck').value = value || '';
    const entity = $('entity').value;
    $('entity').innerHTML = '<option value="">No Entity</option>' + getCards().filter(c => c.card_type === 'Entity').map(c => `<option value="${escape(c.id)}">${escape(c.title)}</option>`).join('');
    $('entity').value = entity;
  }
  function render() {
    syncLobbyRefresh();
    $('signin').hidden = Boolean(userId);
    $('lobby').hidden = !userId || Boolean(room);
    $('session').hidden = !userId || !room;
    renderConnection();
    if (!room) { controls(); return; }
    $('room-code').textContent = room.code;
    $('leave').textContent = room.status === 'closed' ? 'Back to lobby' : room.host_id === userId ? 'Close table' : 'Leave table';
    const profile = id => getProfiles().find(p => p.id === id)?.display_name || 'Player';
    $('players').innerHTML = ['host', 'guest'].map(seat => {
      const id = room[`${seat}_id`], online = playerOnline(room[`${seat}_seen_at`]);
      const deck = getDecks().find(d => d.id === room[`${seat}_deck_id`]);
      return `<div class="play-player"><span class="play-avatar" aria-hidden="true">${id ? escape(profile(id).slice(0, 1).toUpperCase()) : '+'}</span><div><strong>${id ? escape(profile(id)) + (id === userId ? ' · You' : '') : 'Waiting for a player'}</strong><span>${id ? escape(deck?.name || 'No deck selected') : 'Players can join from All tables.'}</span></div><span class="play-pill ${online ? 'is-live' : ''}">${!id ? 'Open seat' : room.status === 'closed' ? 'Closed' : online ? room[`${seat}_ready`] ? 'Ready' : 'Online' : 'Away'}</span></div>`;
    }).join('');
    const mine = room.host_id === userId ? 'host' : 'guest';
    $('deck').value = room[`${mine}_deck_id`] || '';
    $('ready').textContent = room[`${mine}_ready`] ? 'Not ready' : 'Ready';
    $('ready').setAttribute('aria-pressed', String(room[`${mine}_ready`]));
    $('room-status').textContent = room.status === 'closed' ? 'Table closed' : room.status === 'active' ? 'Both players are ready.' : !room.guest_id ? 'Waiting for the second player.' : 'Choose your decks and get ready.';
    if (room.revision !== boardRevision) { boardRevision = room.revision; renderBoard(); renderNode(); }
    $('save-status').textContent = `Saved · ${room.revision}`;
    controls();
    if (room.status === 'closed') $('leave').disabled = false;
  }
  function renderBoard() {
    if (!room) return;
    $('board').replaceChildren();
    for (let y = origin.y; y < origin.y + 5; y++) for (let x = origin.x; x < origin.x + 7; x++) {
      const n = room.board[`${x},${y}`];
      const b = document.createElement('button'); b.type = 'button';
      b.className = `play-cell ${n ? `play-terrain-${n.terrain.toLowerCase()}` : 'is-empty'}${selected.x === x && selected.y === y ? ' is-selected' : ''}`;
      b.setAttribute('aria-label', `${n?.terrain || 'Empty space'} at ${x}, ${y}${n?.entity ? `, ${n.entity.title}` : ''}`);
      b.setAttribute('aria-pressed', String(selected.x === x && selected.y === y));
      b.innerHTML = n ? `<span class="play-cell-terrain">${escape(n.terrain)}</span><strong>${escape(n.entity?.title || '')}</strong><span class="play-cell-markers">${n.crisis ? 'Crisis' : n.protected ? 'Protected' : ''}${n.lumens ? ` ☀ ${n.lumens}` : ''}</span>` : '<span aria-hidden="true">+</span>';
      b.addEventListener('click', () => { selected = { x, y }; renderBoard(); renderNode(); controls(); });
      $('board').append(b);
    }
  }
  function renderNode() {
    if (!room) return;
    const n = room.board[`${selected.x},${selected.y}`];
    $('node-title').textContent = `Node · ${selected.x}, ${selected.y}`;
    $('terrain').value = n?.terrain || 'Symbiosis';
    $('set-terrain').textContent = n ? 'Transform Terrain' : 'Create Terrain';
    $('entity').value = n?.entity?.id || '';
    $('set-entity').textContent = n?.entity ? 'Update Entity' : 'Place Entity';
    $('crisis').setAttribute('aria-pressed', String(Boolean(n?.crisis)));
    $('protect').setAttribute('aria-pressed', String(Boolean(n?.protected)));
    $('lumen-count').textContent = `Lumens: ${n?.lumens || 0} / 2`;
    $('lumen-minus').disabled = n?.terrain !== 'Radiance' || !n.lumens;
    $('lumen-plus').disabled = n?.terrain !== 'Radiance' || n.lumens >= 2;
    $('entity-detail').hidden = !n?.entity;
    $('entity-detail').innerHTML = n?.entity ? `<strong>${escape(n.entity.title)}</strong><p>${escape(n.entity.effect)}</p>` : '';
  }

  $('signin-button').addEventListener('click', requireSignIn);
  $('create').addEventListener('click', () => run(async () => { const id = await rpc('play_create_room'); await enter(id); }));
  $('refresh').addEventListener('click', () => run(listTables));
  $('leave').addEventListener('click', () => run(async () => {
    if (room.status !== 'closed') await action('leave');
    await disconnect(); room = null; remember(null); render(); message(); await listTables();
  }));
  $('deck').addEventListener('change', () => run(() => action('deck', { deck_id: $('deck').value })));
  $('ready').addEventListener('click', () => run(() => action('ready')));
  for (const name of ['terrain', 'entity', 'crisis', 'protect', 'lumen-minus', 'lumen-plus', 'remove']) {
    const target = name === 'terrain' || name === 'entity' ? `set-${name}` : name;
    $(target).addEventListener('click', () => run(() => action(name.startsWith('lumen') ? 'lumen' : name, {
      ...selected, terrain: $('terrain').value, card_id: $('entity').value, delta: name === 'lumen-minus' ? -1 : 1,
    })));
  }
  for (const b of root.querySelectorAll('[data-pan]')) b.addEventListener('click', () => {
    const d = b.dataset.pan;
    if (d === 'home') origin = { x: -3, y: -2 };
    else { origin.x = Math.max(-30, Math.min(24, origin.x + (d === 'left' ? -2 : d === 'right' ? 2 : 0))); origin.y = Math.max(-30, Math.min(26, origin.y + (d === 'up' ? -2 : d === 'down' ? 2 : 0))); }
    renderBoard();
  });
  async function refreshIdentity() {
    const next = getUser()?.id || null;
    if (next === userId) return;
    await disconnect(); room = null; userId = next; tableListSignature = ''; $('room-list').replaceChildren(); render(); refreshCollections();
    if (!userId) return;
    if (visible) { const id = savedRoom(); if (id) void run(() => enter(id)); else await listTables(); }
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
