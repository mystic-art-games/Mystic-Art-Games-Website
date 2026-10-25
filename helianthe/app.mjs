import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.mjs';
import { createCommunityApi } from './community-api.mjs';
import { renderCard, downloadCardPNG } from './card-renderer.mjs';

const $ = selector => document.querySelector(selector);
if (!window.supabase?.createClient) throw new Error('The Supabase client could not be loaded.');
const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
const api = createCommunityApi(client);
const state = { user: null, cards: [], decks: [], profiles: [], card: null, deck: null, profile: null, deckCards: [], artworkUrl: null, artworkSerial: 0, renderSerial: 0, authVersion: 0 };

function status(message, error = false) {
  const element = $('#app-status');
  element.textContent = message;
  element.classList.toggle('error', error);
}

function ownerName(id) {
  if (!id) return 'Helianthe';
  return state.profiles.find(profile => profile.id === id)?.display_name || 'Player';
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

function renderCardList() {
  const query = $('#card-search').value.trim().toLocaleLowerCase();
  const list = $('#card-list');
  list.replaceChildren();
  for (const card of state.cards.filter(item => `${item.title} ${item.effect}`.toLocaleLowerCase().includes(query))) {
    const row = button(card.title, () => selectCard(card), state.card?.id === card.id ? 'selected' : '');
    const meta = document.createElement('small');
    meta.textContent = `${card.card_type}${card.terrain ? ` · ${card.terrain}` : ''} · ${ownerName(card.owner_id)}`;
    row.append(meta);
    list.append(row);
  }
  if (!list.childElementCount) list.textContent = 'No cards found.';
}

function setCardFormEditable(canEdit) {
  for (const field of $('#card-form').querySelectorAll('input,select,textarea,button')) field.disabled = !canEdit;
}

function showSignIn() {
  $('#auth-view').hidden = false;
  for (const tab of ['cards', 'decks', 'profiles']) $(`#${tab}-view`).hidden = true;
  $('#tabs').hidden = true;
  status('Sign in or create an account to contribute.');
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

function selectCard(card) {
  ++state.artworkSerial;
  releaseArtwork();
  state.card = card;
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
  setCardFormEditable(Boolean(state.user && (!card || mine)));
  syncTerrain();
  renderPreview();
  void showArtwork(card);
  renderCardList();
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
  renderCardList(); renderDeckList(); renderProfileList();
}

async function loadWorkspace() {
  const version = ++state.authVersion;
  status('Loading your Helianthe workspace…');
  try {
    const user = await api.currentUser();
    if (!user || version !== state.authVersion) return;
    state.user = user;
    await api.ensureProfile(user);
    await reloadCollections();
    if (version !== state.authVersion) return;
    $('#auth-view').hidden = true;
    $('#tabs').hidden = false;
    $('#sign-in').hidden = true;
    $('#sign-out').hidden = false;
    selectCard(state.cards[0] || null);
    await selectDeck(state.decks.find(deck => deck.owner_id === user.id) || state.decks[0] || null);
    selectProfile(state.profiles.find(profile => profile.id === user.id) || state.profiles[0]);
    showTab('cards');
    status('Ready.');
  } catch (cause) { status(cause.message, true); }
}

async function loadPublicWorkspace() {
  ++state.authVersion;
  state.user = null; state.cards = []; state.decks = []; state.profiles = [];
  state.card = null; state.deck = null; state.profile = null; ++state.artworkSerial; ++state.renderSerial;
  releaseArtwork();
  status('Loading public Helianthe cards…');
  try {
    await reloadCollections();
    $('#auth-view').hidden = true;
    $('#tabs').hidden = false;
    $('#sign-in').hidden = false;
    $('#sign-out').hidden = true;
    selectCard(state.cards[0] || null);
    await selectDeck(state.decks[0] || null);
    if (state.profiles[0]) selectProfile(state.profiles[0]);
    showTab('cards');
    status('Browsing publicly. Sign in to create cards and decks.');
  } catch (cause) { status(cause.message, true); }
}

$('#auth-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  status('Signing in…');
  const { error } = await client.auth.signInWithPassword({ email: form.elements.email.value.trim(), password: form.elements.password.value });
  if (error) status(error.message, true);
  else await loadWorkspace();
});

$('#sign-up').addEventListener('click', async () => {
  const form = $('#auth-form');
  if (!form.reportValidity()) return;
  status('Creating account…');
  const { data, error } = await client.auth.signUp({
    email: form.elements.email.value.trim(), password: form.elements.password.value,
    options: { emailRedirectTo: 'https://mysticart.games/helianthe/' },
  });
  if (error) status(error.message, true);
  else if (data.session) await loadWorkspace();
  else status('Account created. Check your email to confirm it, then sign in.');
});

$('#sign-out').addEventListener('click', async () => {
  const { error } = await client.auth.signOut();
  if (error) status(error.message, true);
  else await loadPublicWorkspace();
});

$('#sign-in').addEventListener('click', showSignIn);
$('#browse-without-account').addEventListener('click', loadPublicWorkspace);

for (const tab of $('#tabs').querySelectorAll('button[data-tab]')) tab.addEventListener('click', () => showTab(tab.dataset.tab));
$('#card-search').addEventListener('input', renderCardList);
$('#new-card').addEventListener('click', () => { if (requireAccount()) selectCard(null); });
$('#card-form').addEventListener('input', renderPreview);
$('#card-form').elements.card_type.addEventListener('change', () => { if ($('#card-form').elements.card_type.value === 'Event') $('#card-form').elements.terrain.value = ''; syncTerrain(); renderPreview(); });
$('#card-artwork').addEventListener('change', event => {
  const file = event.target.files?.[0];
  if (!file) return;
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
  try {
    const values = Object.fromEntries(new FormData(form));
    const file = $('#card-artwork').files?.[0];
    if (file && file.size > 5 * 1024 * 1024) throw new Error('Artwork must be 5 MB or smaller.');
    let card = state.card
      ? await api.saveCard(state.user.id, state.card.id, values)
      : await api.createCard(state.user.id, values);
    persistedCard = card;
    if (file) {
      const artwork = await api.uploadArtwork(file);
      card = await api.saveCard(state.user.id, card.id, { ...values, artwork_id: artwork.id });
      persistedCard = card;
    }
    await reloadCollections();
    selectCard(state.cards.find(item => item.id === card.id) || card);
    status('Card saved.');
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
