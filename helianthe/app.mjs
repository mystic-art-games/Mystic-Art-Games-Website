import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.mjs';
import { createCommunityApi } from './community-api.mjs';
import { renderCard, downloadCardPNG } from './card-renderer.mjs';

const $ = selector => document.querySelector(selector);
if (!window.supabase?.createClient) throw new Error('The Supabase client could not be loaded.');
const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
const api = createCommunityApi(client);
const ADMIN_EMAIL = 'dominik.zielinski3@gmail.com';
const ADMIN_USER_ID = '7422e970-f1c1-4618-aa73-ea191d97e141';
const state = { user: null, isAdmin: false, cards: [], decks: [], profiles: [], card: null, deck: null, profile: null, deckCards: [], artworkUrl: null, artworkSerial: 0, renderSerial: 0, authVersion: 0, realtimeChannel: null, cardFormDirty: false };
const ARTWORK_UPLOAD_LIMIT = 100 * 1024;

async function compressedArtwork(file) {
  if (!file) return null;
  if (file.size > 20 * 1024 * 1024) throw new Error('Artwork must be 20 MB or smaller before compression.');
  const image = await createImageBitmap(file);
  try {
    let scale = 1;
    for (let pass = 0; pass < 8; pass++) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext('2d', { alpha: true });
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.88, 0.8, 0.72, 0.64, 0.56, 0.48, 0.4]) {
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality));
        if (blob && blob.size <= ARTWORK_UPLOAD_LIMIT) {
          const name = file.name.replace(/\.[^.]+$/, '') + '.webp';
          return new File([blob], name, { type: 'image/webp', lastModified: file.lastModified });
        }
      }
      scale *= 0.82;
    }
  } finally { image.close(); }
  throw new Error('Artwork could not be compressed below 100 KB.');
}

function status(message, error = false) {
  // Status messages are intentionally not rendered in the public editor.
}

function ownerName(id) {
  if (!id) return 'Helianthe';
  return state.profiles.find(profile => profile.id === id)?.display_name || 'Player';
}

function cardTypeIcon(card) {
  if (card.card_type === 'Event') return './assets/Event.png';
  const terrain = ['Symbiosis', 'Flow', 'Evergreen', 'Radiance'].includes(card.terrain) ? card.terrain : 'Flow';
  return `./assets/Entity_${terrain}.png`;
}

function eventIconColor(terrain) {
  return {
    Symbiosis: '#9a61b0', Flow: '#6996bf', Evergreen: '#65a838', Radiance: '#d2c23f',
  }[terrain] || '#909592';
}

function terrainClass(terrain) {
  return ['Symbiosis', 'Flow', 'Evergreen', 'Radiance'].includes(terrain) ? `terrain-${terrain.toLowerCase()}` : 'terrain-event';
}

function button(label, action, className = '') {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.className = className;
  element.addEventListener('click', action);
  return element;
}

function showTab(name) {
  for (const tab of ['cards', 'decks', 'profiles']) {
    $(`#${tab}-view`).hidden = tab !== name;
    $(`[data-tab="${tab}"]`).classList.toggle('active', tab === name);
  }
}

function refreshCardAuthorFilter() {
  const select = $('#card-filter-author');
  const current = select.value;
  const authors = [...new Set(state.cards.map(card => ownerName(card.owner_id)))].sort((a, b) => a.localeCompare(b));
  select.replaceChildren(new Option('All authors', ''));
  for (const author of authors) select.append(new Option(author, author));
  select.value = authors.includes(current) ? current : '';
}

function renderCardList() {
  const query = $('#card-search').value.trim().toLocaleLowerCase();
  const type = $('#card-filter-type').value;
  const author = $('#card-filter-author').value;
  const terrain = $('#card-filter-terrain').value;
  const list = $('#card-list');
  list.replaceChildren();
  for (const card of state.cards.filter(item => {
    const matchesSearch = `${item.title} ${item.effect}`.toLocaleLowerCase().includes(query);
    const matchesType = !type || item.card_type === type;
    const matchesAuthor = !author || ownerName(item.owner_id) === author;
    const matchesTerrain = !terrain || (terrain === 'none' ? !item.terrain : item.terrain === terrain);
    return matchesSearch && matchesType && matchesAuthor && matchesTerrain;
  })) {
    const row = button('', () => selectCard(card, { openMobile: true }), `card-list-item${state.card?.id === card.id ? ' selected' : ''}`);
    row.setAttribute('aria-label', `${card.card_type}: ${card.title}`);
    const icon = card.card_type === 'Event' ? document.createElement('span') : document.createElement('img');
    icon.className = `card-type-icon${card.card_type === 'Event' ? ' event-type-icon' : ''}`;
    if (card.card_type === 'Event') icon.style.setProperty('--event-icon-color', eventIconColor(card.terrain));
    else { icon.src = cardTypeIcon(card); icon.alt = ''; }
    icon.title = card.card_type;
    const title = document.createElement('span');
    title.className = `card-list-title ${terrainClass(card.terrain)}`;
    title.textContent = card.title;
    row.append(icon, title);
    const meta = document.createElement('small');
    meta.textContent = ownerName(card.owner_id);
    meta.className = 'card-list-owner';
    row.append(meta);
    list.append(row);
  }
  if (!list.childElementCount) list.textContent = 'No cards found.';
}

function setCardFormEditable(canEdit) {
  for (const field of $('#card-form').querySelectorAll('input,select,textarea,button')) field.disabled = !canEdit;
}

function showSignIn() {
  $('#auth-modal').hidden = false;
  $('#auth-error-message').hidden = true;
  $('#auth-error-message').textContent = '';
  document.body.classList.add('auth-modal-open');
  $('#auth-modal-form').elements.email.focus();
  status('Sign in or create an account to contribute.');
}

function hideSignIn() {
  $('#auth-modal').hidden = true;
  document.body.classList.remove('auth-modal-open');
}

function requireAccount() {
  if (state.user) return true;
  showSignIn();
  return false;
}

function syncTerrain() {
  const form = $('#card-form');
  const required = form.elements.card_type.value === 'Entity';
  form.elements.terrain.required = required;
  if (required && !form.elements.terrain.value) form.elements.terrain.value = 'Symbiosis';
}

function releaseArtwork() {
  if (state.artworkUrl) URL.revokeObjectURL(state.artworkUrl);
  state.artworkUrl = null;
}

async function showArtwork(card) {
  const serial = ++state.artworkSerial;
  releaseArtwork();
  if (!card?.artwork_id) return;
  try {
    const blob = await api.fetchArtwork(card.artwork_id);
    if (serial !== state.artworkSerial) return;
    state.artworkUrl = URL.createObjectURL(blob);
    renderPreview();
  } catch (cause) { if (serial === state.artworkSerial) status(cause.message, true); }
}

function renderPreview() {
  const form = $('#card-form');
  const serial = ++state.renderSerial;
  const card = {
    title: form.elements.title.value,
    card_type: form.elements.card_type.value,
    terrain: form.elements.terrain.value,
    effect: form.elements.effect.value,
    author: form.elements.author.value,
  };
  $('#download-png').disabled = true;
  void renderCard($('#card-canvas'), card, state.artworkUrl || '', () => serial === state.renderSerial)
    .then(result => {
      if (serial !== state.renderSerial || result.cancelled) return;
      $('#preview-note').textContent = result.clipped ? 'Text is too long — shorten the effect before exporting.' : '';
      $('#download-png').disabled = result.clipped;
    })
    .catch(cause => { if (serial === state.renderSerial) $('#preview-note').textContent = cause.message; });
}

function selectCard(card, { openMobile = false } = {}) {
  ++state.artworkSerial;
  releaseArtwork();
  state.card = card;
  state.cardFormDirty = false;
  const form = $('#card-form');
  form.reset();
  form.elements.title.value = card?.title || '';
  form.elements.card_type.value = card?.card_type || 'Entity';
  form.elements.terrain.value = card?.terrain || (card?.card_type === 'Event' ? '' : 'Symbiosis');
  form.elements.effect.value = card?.effect || '';
  form.elements.author.value = card?.author || '';
  $('#card-heading').textContent = card?.title || 'New card';
  const mine = Boolean(state.user && card?.owner_id === state.user.id);
  $('#card-owner').textContent = card ? (mine ? 'Your card' : `By ${ownerName(card.owner_id)}`) : (state.user ? 'Your new card' : 'Sign in to create a card');
  setCardFormEditable(Boolean(state.user && (!card || mine || state.isAdmin)));
  syncTerrain();
  renderPreview();
  void showArtwork(card);
  renderCardList();
  if (openMobile) {
    $('#cards-view').classList.add('mobile-editor-open');
    document.body.classList.add('mobile-editor-visible');
  }
}

function closeMobileEditor() {
  $('#cards-view').classList.remove('mobile-editor-open');
  document.body.classList.remove('mobile-editor-visible');
}

function renderDeckList() {
  const list = $('#deck-list');
  list.replaceChildren();
  for (const deck of state.decks) {
    const row = button(deck.name, () => void selectDeck(deck), state.deck?.id === deck.id ? 'selected' : '');
    const meta = document.createElement('small');
    meta.textContent = `${deck.is_public ? 'Public' : 'Private'} · ${ownerName(deck.owner_id)}`;
    row.append(meta);
    list.append(row);
  }
  if (!list.childElementCount) list.textContent = 'No decks yet.';
}

function renderDeckCards() {
  const list = $('#deck-cards');
  list.replaceChildren();
  if (!state.deck) return;
  const mine = state.deck.owner_id === state.user?.id;
  for (const card of state.cards) {
    const copies = state.deckCards.find(item => item.card_id === card.id)?.copies || 0;
    if (!mine && !copies) continue;
    const row = document.createElement('div'); row.className = 'deck-card-row';
    const label = document.createElement('span'); label.textContent = `${card.title} · ${card.card_type}${card.terrain ? ` · ${card.terrain}` : ''}`;
    row.append(label);
    if (mine) {
      const select = document.createElement('select');
      select.setAttribute('aria-label', `Copies of ${card.title}`);
      for (let count = 0; count <= 3; count++) {
        const choice = document.createElement('option'); choice.value = String(count); choice.textContent = String(count); select.append(choice);
      }
      select.value = String(copies);
      select.addEventListener('change', async () => {
        select.disabled = true;
        try {
          await api.setDeckCard(state.user.id, state.deck, card.id, Number(select.value));
          state.deckCards = await api.listDeckCards(state.deck.id);
          status(`Saved ${card.title} in ${state.deck.name}.`);
        } catch (cause) { status(cause.message, true); }
        renderDeckCards();
      });
      row.append(select);
    } else {
      const count = document.createElement('strong'); count.textContent = `×${copies}`; row.append(count);
    }
    list.append(row);
  }
  if (!list.childElementCount) list.textContent = 'This deck has no cards.';
}

async function selectDeck(deck) {
  state.deck = deck;
  const form = $('#deck-form');
  form.reset();
  form.elements.name.value = deck?.name || '';
  form.elements.patron_name.value = deck?.patron_name || '';
  form.elements.is_public.checked = deck?.is_public || false;
  const mine = Boolean(state.user && (!deck || deck.owner_id === state.user.id));
  for (const field of form.querySelectorAll('input,button')) field.disabled = !mine;
  $('#deck-heading').textContent = deck?.name || 'New deck';
  $('#deck-owner').textContent = deck ? (mine ? 'Your deck' : `By ${ownerName(deck.owner_id)}`) : (state.user ? 'Private by default' : 'Sign in to create a deck');
  state.deckCards = deck ? await api.listDeckCards(deck.id) : [];
  renderDeckList();
  renderDeckCards();
}

function renderProfileList() {
  const list = $('#profile-list');
  list.replaceChildren();
  for (const profile of state.profiles) list.append(button(profile.display_name || 'Player', () => selectProfile(profile), state.profile?.id === profile.id ? 'selected' : ''));
}

function selectProfile(profile) {
  state.profile = profile;
  $('#profile-heading').textContent = profile.display_name || 'Player';
  const mine = profile.id === state.user?.id;
  $('#profile-form').hidden = !mine;
  $('#profile-form').elements.display_name.value = profile.display_name;
  $('#profile-form').elements.bio.value = profile.bio;
  $('#profile-bio').textContent = profile.bio || (mine ? 'Add a short bio to your profile.' : 'No bio yet.');
  const list = $('#profile-decks'); list.replaceChildren();
  for (const deck of state.decks.filter(item => item.owner_id === profile.id && item.is_public)) {
    list.append(button(deck.name, () => { showTab('decks'); void selectDeck(deck); }));
  }
  if (!list.childElementCount) list.textContent = 'No public decks yet.';
  renderProfileList();
}

async function reloadCollections() {
  [state.cards, state.decks, state.profiles] = await Promise.all([api.listCards(), api.listDecks(), api.listProfiles()]);
  refreshCardAuthorFilter();
  renderCardList(); renderDeckList(); renderProfileList();
}

function startRealtimeSync() {
  if (state.realtimeChannel) return;
  state.realtimeChannel = client.channel('helianthe-cards')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'cards' }, async () => {
      const selectedId = state.card?.id;
      try {
        await reloadCollections();
        if (selectedId && !state.cardFormDirty) selectCard(state.cards.find(card => card.id === selectedId) || state.cards[0] || null);
        else renderCardList();
      } catch (cause) { status(cause.message, true); }
    })
    .subscribe();
}

function stopRealtimeSync() {
  if (!state.realtimeChannel) return;
  void client.removeChannel(state.realtimeChannel);
  state.realtimeChannel = null;
}

async function loadWorkspace() {
  const version = ++state.authVersion;
  status('Loading your Helianthe workspace…');
  try {
    const user = await api.currentUser();
    if (!user || version !== state.authVersion) return;
    state.user = user;
    state.isAdmin = user.id === ADMIN_USER_ID || user.email?.trim().toLowerCase() === ADMIN_EMAIL;
    await api.ensureProfile(user);
    await reloadCollections();
    startRealtimeSync();
    if (version !== state.authVersion) return;
    $('#auth-view').hidden = true;
    hideSignIn();
    $('#tabs').hidden = false;
    $('#sign-in').hidden = true;
    $('#sign-out').hidden = false;
    selectCard(state.cards[0] || null);
    await selectDeck(state.decks.find(deck => deck.owner_id === user.id) || state.decks[0] || null);
    const profile = state.profiles.find(profile => profile.id === user.id) || state.profiles[0];
    selectProfile(profile);
    $('#account-name').textContent = profile?.display_name || user.email || 'Profile';
    $('#account-name').hidden = false;
    showTab('cards');
    status('Ready.');
  } catch (cause) { console.error(cause); showSignIn(); }
}

async function loadPublicWorkspace() {
  ++state.authVersion;
  stopRealtimeSync();
  state.user = null; state.isAdmin = false; state.cards = []; state.decks = []; state.profiles = [];
  state.card = null; state.deck = null; state.profile = null; ++state.artworkSerial; ++state.renderSerial;
  releaseArtwork();
  status('Loading public Helianthe cards…');
  try {
    await reloadCollections();
    startRealtimeSync();
    $('#auth-view').hidden = true;
    $('#tabs').hidden = false;
    $('#sign-in').hidden = false;
    $('#sign-out').hidden = true;
    $('#account-name').hidden = true;
    selectCard(state.cards[0] || null);
    await selectDeck(state.decks[0] || null);
    if (state.profiles[0]) selectProfile(state.profiles[0]);
    showTab('cards');
    status('Browsing publicly. Sign in to create cards and decks.');
  } catch (cause) { console.error(cause); showSignIn(); }
}

async function submitAuthForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  status('Signing in…');
  const { error } = await client.auth.signInWithPassword({ email: form.elements.email.value.trim(), password: form.elements.password.value });
  if (error) {
    const message = 'No account was found for this email address, or the password is incorrect.';
    $('#auth-error-message').textContent = message;
    $('#auth-error-message').hidden = false;
  } else await loadWorkspace();
}

$('#auth-form').addEventListener('submit', submitAuthForm);
$('#auth-modal-form').addEventListener('submit', submitAuthForm);

async function submitSignUp() {
  const form = document.activeElement?.form?.id === 'auth-modal-form' ? $('#auth-modal-form') : $('#auth-form');
  if (!form.reportValidity()) return;
  status('Creating account…');
  const { data, error } = await client.auth.signUp({
    email: form.elements.email.value.trim(), password: form.elements.password.value,
    options: { emailRedirectTo: 'https://mysticart.games/helianthe/' },
  });
  if (error) status(error.message, true);
  else if (data.session) await loadWorkspace();
  else status('Account created. Check your email to confirm it, then sign in.');
}

$('#sign-up').addEventListener('click', submitSignUp);
$('#modal-sign-up').addEventListener('click', submitSignUp);

$('#sign-out').addEventListener('click', async () => {
  const { error } = await client.auth.signOut();
  if (error) status(error.message, true);
  else await loadPublicWorkspace();
});

$('#sign-in').addEventListener('click', showSignIn);
$('#account-name').addEventListener('click', () => {
  if (!state.user) return;
  showTab('profiles');
  const ownProfile = state.profiles.find(profile => profile.id === state.user.id);
  if (ownProfile) selectProfile(ownProfile);
});
$('#close-auth-modal').addEventListener('click', hideSignIn);
$('#close-auth-dialog').addEventListener('click', hideSignIn);
$('#browse-without-account').addEventListener('click', loadPublicWorkspace);

for (const tab of $('#tabs').querySelectorAll('button[data-tab]')) tab.addEventListener('click', () => showTab(tab.dataset.tab));
$('#card-search').addEventListener('input', renderCardList);
for (const filter of document.querySelectorAll('#card-filter-type, #card-filter-author, #card-filter-terrain')) filter.addEventListener('change', renderCardList);
$('#new-card').addEventListener('click', () => { if (requireAccount()) selectCard(null, { openMobile: true }); });
$('#close-mobile-editor').addEventListener('click', closeMobileEditor);
$('#card-form').addEventListener('input', () => { state.cardFormDirty = true; renderPreview(); });
$('#card-form').elements.card_type.addEventListener('change', () => { syncTerrain(); renderPreview(); });
$('#card-artwork').addEventListener('change', event => {
  const file = event.target.files?.[0];
  if (!file) return;
  state.cardFormDirty = true;
  ++state.artworkSerial; releaseArtwork();
  state.artworkUrl = URL.createObjectURL(file);
  renderPreview();
});
$('#download-png').addEventListener('click', async () => {
  try { await downloadCardPNG($('#card-canvas'), $('#card-form').elements.title.value); }
  catch (cause) { status(cause.message, true); }
});

$('#card-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const save = $('#save-card'); save.disabled = true;
  let persistedCard = null;
  let cleanupWarning = '';
  try {
    const values = Object.fromEntries(new FormData(form));
    const sourceFile = $('#card-artwork').files?.[0];
    const file = sourceFile ? await compressedArtwork(sourceFile) : null;
    const previousArtworkId = state.card?.artwork_id || null;
    let card = state.card
      ? await api.saveCard(state.user.id, state.card.id, values, state.isAdmin)
      : await api.createCard(state.user.id, values);
    persistedCard = card;
    if (file) {
      const artwork = await api.uploadArtwork(file);
      try { card = await api.saveCard(state.user.id, card.id, { ...values, artwork_id: artwork.id }, state.isAdmin); }
      catch (cause) {
        await api.deleteArtwork(artwork.id).catch(error => console.error('New artwork cleanup failed', error));
        throw cause;
      }
      persistedCard = card;
      if (previousArtworkId && previousArtworkId !== artwork.id) {
        try { await api.deleteArtwork(previousArtworkId); }
        catch (cause) { cleanupWarning = cause.message; console.error('Old artwork cleanup failed', cause); }
      }
    }
    state.cardFormDirty = false;
    await reloadCollections();
    selectCard(state.cards.find(item => item.id === card.id) || card);
    status(cleanupWarning ? `Card saved. ${cleanupWarning}` : 'Card saved.', Boolean(cleanupWarning));
  } catch (cause) {
    if (persistedCard) {
      await reloadCollections().catch(console.error);
      state.card = persistedCard;
    }
    status(cause.message, true);
  }
  finally { save.disabled = false; }
});

$('#new-deck').addEventListener('click', () => { if (requireAccount()) void selectDeck(null); });
$('#deck-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const save = $('#save-deck'); save.disabled = true;
  try {
    const values = { ...Object.fromEntries(new FormData(form)), is_public: form.elements.is_public.checked };
    const wasNew = !state.deck;
    const deck = state.deck ? await api.saveDeck(state.user.id, state.deck.id, values) : await api.createDeck(state.user.id, values);
    await reloadCollections();
    await selectDeck(state.decks.find(item => item.id === deck.id) || deck);
    status(wasNew ? 'Private deck created. Turn on Public and save when you want to share it.' : 'Deck saved.');
  } catch (cause) { status(cause.message, true); }
  finally { save.disabled = false; }
});

$('#profile-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    await api.saveProfile(state.user.id, Object.fromEntries(new FormData(event.currentTarget)));
    await reloadCollections();
    selectProfile(state.profiles.find(item => item.id === state.user.id));
    status('Profile saved.');
  } catch (cause) { status(cause.message, true); }
});

client.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT') void loadPublicWorkspace();
});
const { data: { session }, error } = await client.auth.getSession();
if (error) status(error.message, true);
else if (session) await loadWorkspace();
else await loadPublicWorkspace();
