const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function playerOnline(timestamp, now = Date.now()) {
  return Boolean(timestamp && now - Date.parse(timestamp) < 45000);
}

export function readyCountdown(createdAt, activatedAt, now = Date.now()) {
  if (activatedAt) return '';
  const remaining = Math.max(0, Math.ceil((Date.parse(createdAt) + 60000 - now) / 1000));
  return `Ready in ${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`;
}

export function createPlayView({ client, getUser, getDecks, getProfiles, makeAvatar, requireSignIn }) {
  const root = document.querySelector('#play-view');
  const $ = id => root.querySelector(`#play-${id}`);
  let userId = null, room = null, channel = null, timer = null, visible = false;
  let lobbyTimer = null, listSerial = 0, tableListSignature = '';
  let busy = false, epoch = 0, fetchSerial = 0, live = false, lastHeartbeat = 0, expiryPending = false;
  root.innerHTML = `
    <div class="play-heading"><div><span class="play-eyebrow">THE SHARED WORLD</span><h1>Play</h1><p>Meet another player at the same table.</p></div></div>
    <p id="play-message" role="status" aria-live="polite" hidden></p>
    <section id="play-signin" class="play-surface" hidden><h2>Your seat is waiting</h2><p>Sign in to create a table or join one from the list.</p><button id="play-signin-button" type="button">Sign in to play</button></section>
    <div id="play-lobby" class="play-lobby" hidden>
      <section class="play-surface play-create-panel"><div><span class="play-eyebrow">HOST A SESSION</span><h2>Create a table</h2></div><button id="play-create" type="button">Create table</button></section>
      <section class="play-surface play-recent"><div class="play-table-heading"><h2>All tables</h2><button id="play-refresh" type="button">Refresh</button></div><p id="play-no-rooms">Loading tables…</p><div id="play-room-list"></div></section>
    </div>
    <section id="play-session" hidden>
      <button id="play-back" class="back-to-decks" type="button"><span aria-hidden="true">←</span> Back</button>
      <div class="play-room-bar"><div class="play-room-identity"><span class="play-eyebrow">TABLE</span><div class="play-room-name-line"><strong id="play-room-name"></strong><button id="play-edit-name" type="button">Edit name</button></div><form id="play-name-form" hidden><input id="play-name-input" aria-label="Table name" maxlength="60" required><button type="submit">Save</button><button id="play-cancel-name" type="button">Cancel</button></form><span class="play-room-code-line">Code: <strong id="play-room-code"></strong></span></div><div class="play-room-actions"><button id="play-leave" type="button">Leave table</button></div></div>
      <div id="play-players" class="play-players"></div>
      <label id="play-deck-field" class="play-deck-field" for="play-deck">Your deck<select id="play-deck"><option value="">No deck selected</option></select></label>
      <button id="play-ready" type="button">Ready</button>
      <p id="play-ready-countdown" class="play-ready-countdown"></p><p id="play-room-status" role="status"></p>
    </section>`;
  const deckField = $('deck-field');
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
    for (const id of ['deck', 'ready']) $(id).disabled = !canAct();
    $('edit-name').disabled = !canAct() || room?.host_id !== userId;
    $('back').disabled = busy || !room;
    $('leave').disabled = busy || !room;
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
      const title = document.createElement('strong'); title.textContent = entry.name || `Table ${entry.code}`;
      const summary = document.createElement('span'); summary.textContent = `${entry.host_name} · ${entry.player_count} / 2 players`;
      const countdown = document.createElement('span'); countdown.className = 'play-ready-countdown';
      countdown.dataset.createdAt = entry.created_at;
      countdown.dataset.activatedAt = entry.activated_at || '';
      countdown.textContent = readyCountdown(entry.created_at, entry.activated_at);
      details.append(title, summary, countdown);
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
    if (room.status === 'closed') { remember(null); await disconnect(); message(room.activated_at ? 'The host closed this table. Return to the lobby to create or join another table.' : 'The table closed because both players did not get ready within 60 seconds.'); }
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
  async function enter(id) {
    await disconnect();
    const expected = epoch;
    const { data, error } = await client.from('play_rooms').select('*').eq('id', id).maybeSingle();
    if (expected !== epoch) return;
    if (error) throw error;
    if (!data || data.status === 'closed') { remember(null); throw new Error('Table not found or closed.'); }
    room = data; lastHeartbeat = 0; remember(id); render();
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
    const value = room ? (room.host_id === userId ? room.host_deck_id : room.guest_deck_id) : $('deck').value;
    $('deck').innerHTML = '<option value="">No deck selected</option>' + getDecks().map(d => `<option value="${escape(d.id)}">${escape(d.name)}</option>`).join('');
    $('deck').value = value || '';
  }
  function render() {
    syncLobbyRefresh();
    root.classList.toggle('is-at-table', Boolean(userId && room));
    $('signin').hidden = Boolean(userId);
    $('lobby').hidden = !userId || Boolean(room);
    $('session').hidden = !userId || !room;
    if (!room) { controls(); return; }
    $('room-code').textContent = room.code;
    $('room-name').textContent = room.name || `Table ${room.code}`;
    $('ready-countdown').textContent = room.status === 'closed' ? '' : readyCountdown(room.created_at, room.activated_at);
    $('edit-name').hidden = room.host_id !== userId || room.status === 'closed';
    $('leave').textContent = room.status === 'closed' ? 'Back to lobby' : room.host_id === userId ? 'Close table' : 'Leave table';
    $('leave').classList.toggle('action-delete', room.status !== 'closed' && room.host_id === userId);
    const rows = ['host', 'guest'].map(seat => {
      const id = room[`${seat}_id`], online = playerOnline(room[`${seat}_seen_at`]);
      const deck = getDecks().find(d => d.id === room[`${seat}_deck_id`]);
      const profile = getProfiles().find(p => p.id === id);
      const row = document.createElement('div'); row.className = 'play-player';
      const avatar = id ? makeAvatar(profile || { display_name: 'Player' }, 'play-avatar') : document.createElement('span');
      if (!id) { avatar.className = 'user-avatar play-avatar'; avatar.textContent = '?'; }
      avatar.setAttribute('aria-hidden', 'true');
      const details = document.createElement('div'); details.className = 'play-player-details';
      const name = document.createElement('strong'); name.textContent = id ? `${profile?.display_name || 'Player'}${id === userId ? ' · You' : ''}` : 'Waiting for a player';
      details.append(name);
      if (id === userId) details.append(deckField, $('ready'));
      else { const deckName = document.createElement('span'); deckName.textContent = deck?.name || 'No deck selected'; details.append(deckName); }
      row.append(avatar, details);
      const state = room.status === 'closed' ? 'Closed' : !online ? 'Away' : room[`${seat}_ready`] ? 'Ready' : '';
      if (id && state) {
        const status = document.createElement('span'); status.className = `play-pill${state === 'Ready' ? ' is-live' : ''}`;
        status.textContent = state;
        row.append(status);
      }
      return row;
    });
    $('players').replaceChildren(...rows);
    const mine = room.host_id === userId ? 'host' : 'guest';
    $('deck').value = room[`${mine}_deck_id`] || '';
    $('ready').textContent = room[`${mine}_ready`] ? 'Not ready' : 'Ready';
    $('ready').setAttribute('aria-pressed', String(room[`${mine}_ready`]));
    $('room-status').textContent = room.status === 'closed' ? 'Table closed' : room.status === 'active' ? 'Both players are ready.' : !room.guest_id ? 'Waiting for the second player.' : 'Choose your decks and get ready.';
    controls();
    if (room.status === 'closed') $('leave').disabled = false;
  }

  $('signin-button').addEventListener('click', requireSignIn);
  $('create').addEventListener('click', () => run(async () => { const id = await rpc('play_create_room'); await enter(id); }));
  $('refresh').addEventListener('click', () => run(listTables));
  $('back').addEventListener('click', () => run(async () => {
    await disconnect(); room = null; remember(null); render(); await listTables();
  }));
  $('leave').addEventListener('click', () => run(async () => {
    if (room.status !== 'closed') await action('leave');
    await disconnect(); room = null; remember(null); render(); message(); await listTables();
  }));
  $('deck').addEventListener('change', () => run(() => action('deck', { deck_id: $('deck').value })));
  $('ready').addEventListener('click', () => run(() => action('ready')));
  $('edit-name').addEventListener('click', () => {
    $('name-input').value = room.name || `Table ${room.code}`;
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
      $('name-form').hidden = true;
      await refreshRoom();
    });
  });
  setInterval(() => {
    if (!visible || document.hidden || !userId) return;
    for (const countdown of $('room-list').querySelectorAll('.play-ready-countdown')) {
      countdown.textContent = readyCountdown(countdown.dataset.createdAt, countdown.dataset.activatedAt);
    }
    if (room && room.status !== 'closed') $('ready-countdown').textContent = readyCountdown(room.created_at, room.activated_at);
    const deadlineReached = room
      ? room.status !== 'closed' && !room.activated_at && Date.now() >= Date.parse(room.created_at) + 60000
      : [...$('room-list').querySelectorAll('.play-ready-countdown')].some(el => el.textContent === 'Ready in 00:00');
    if (!deadlineReached || expiryPending || busy) return;
    expiryPending = true;
    void rpc('play_expire_tables').then(() => room ? refreshRoom() : listTables())
      .catch(error => message(friendly(error), true)).finally(() => { expiryPending = false; });
  }, 1000);
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
