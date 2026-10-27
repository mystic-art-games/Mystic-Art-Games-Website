import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.mjs';
import { createCommunityApi } from './community-api.mjs';
import { renderCard, downloadCardPNG } from './card-renderer.mjs';
import { PATRONS } from './patrons.mjs';

const $ = selector => document.querySelector(selector);
if (!window.supabase?.createClient) throw new Error('The Supabase client could not be loaded.');
const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});
const api = createCommunityApi(client);
const ADMIN_EMAIL = 'dominik.zielinski3@gmail.com';
const ADMIN_USER_ID = '7422e970-f1c1-4618-aa73-ea191d97e141';
let authMode = 'sign-in';
let profileSaveStatusTimer = null;
const state = { user: null, isAdmin: false, cards: [], decks: [], profiles: [], card: null, deck: null, profile: null, deckCards: [], deckPreviewCard: null, deckPreviewArtworkUrl: null, deckPreviewSerial: 0, artworkUrl: null, artworkSerial: 0, renderSerial: 0, authVersion: 0, realtimeChannel: null, cardFormDirty: false };
const ARTWORK_UPLOAD_LIMIT = 100 * 1024;
const AVATAR_UPLOAD_LIMIT = 80 * 1024;

function applyTheme(dark) {
  document.body.classList.toggle('dark-mode', dark);
  const toggle = $('#theme-toggle');
  toggle.querySelector('.theme-state').textContent = dark ? 'On' : 'Off';
  toggle.setAttribute('aria-pressed', String(dark));
  document.querySelector('meta[name="theme-color"]').content = dark ? '#102f27' : '#153f34';
}

applyTheme(localStorage.getItem('mystic-art-theme') === 'dark');
$('#theme-toggle').addEventListener('click', () => {
  const dark = !document.body.classList.contains('dark-mode');
  localStorage.setItem('mystic-art-theme', dark ? 'dark' : 'light');
  applyTheme(dark);
});

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
  } finally { image.close?.(); }
  throw new Error('Artwork could not be compressed below 100 KB.');
}

async function compressedAvatar(file) {
  if (!file) return null;
  if (file.size > 10 * 1024 * 1024) throw new Error('Profile photo must be 10 MB or smaller before compression.');
  const image = await decodeImage(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext('2d', { alpha: false });
    const sourceSize = Math.min(image.width, image.height);
    const sourceX = (image.width - sourceSize) / 2;
    const sourceY = (image.height - sourceSize) / 2;
    context.fillStyle = '#fffdf5';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.86, 0.76, 0.66, 0.56, 0.46]) {
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality));
      if (blob && blob.size <= AVATAR_UPLOAD_LIMIT) return new File([blob], 'profile-photo.webp', { type: 'image/webp' });
    }
  } finally { image.close?.(); }
  throw new Error('Profile photo could not be compressed below 80 KB.');
}

async function decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file); } catch {}
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally { URL.revokeObjectURL(url); }
}

function fileDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not prepare the profile photo.'));
    reader.readAsDataURL(file);
  });
}

function fileFromDataUrl(dataUrl) {
  const [header, encoded] = dataUrl.split(',');
  const type = header.match(/^data:([^;]+);base64$/)?.[1] || 'image/webp';
  const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
  return new File([bytes], 'profile-photo.webp', { type });
}

function pendingAvatarKey(email) {
  return `helianthe-pending-avatar:${String(email || '').trim().toLowerCase()}`;
}

function status(message, error = false) {
  // Status messages are intentionally not rendered in the public editor.
}

function ownerName(id) {
  if (!id) return 'Helianthe';
  return state.profiles.find(profile => profile.id === id)?.display_name || 'Player';
}

function patronByName(name) {
  return PATRONS.find(patron => patron.name === name) || null;
}

function patronFactionClass(faction) {
  return `patron-faction-${String(faction || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

function deckPatronElement(deck, className = 'deck-patron') {
  const patron = patronByName(deck?.patron_name);
  const label = document.createElement('span');
  label.className = `${className}${patron ? ` ${patronFactionClass(patron.faction)}` : ''}`;
  label.textContent = patron ? `Patron: ${patron.name} · ${patron.faction}` : 'No Patron';
  return label;
}

function profileById(id) {
  return state.profiles.find(profile => profile.id === id) || null;
}

function avatarElement(profile, className = '') {
  const avatar = document.createElement('span');
  avatar.className = `user-avatar ${className}`.trim();
  avatar.textContent = (profile?.display_name || 'P').trim().charAt(0).toUpperCase() || 'P';
  if (profile?.avatar_id) {
    const image = document.createElement('img');
    image.src = api.mediaUrl(profile.avatar_id);
    image.alt = '';
    image.addEventListener('load', () => avatar.classList.add('has-image'));
    image.addEventListener('error', () => image.remove());
    avatar.append(image);
  }
  return avatar;
}

function authorDisplayElement(ids, fallbackId) {
  const display = document.createElement('span');
  display.className = 'author-display';
  const profileIds = Array.isArray(ids) && ids.length ? ids : (fallbackId ? [fallbackId] : []);
  for (const id of profileIds) {
    const profile = profileById(id);
    const person = document.createElement('span');
    person.className = 'author-person';
    person.append(avatarElement(profile, 'small'), document.createTextNode(profile?.display_name || ownerName(id)));
    display.append(person);
  }
  return display;
}

function renderAccountButton(profile) {
  const account = $('#account-name');
  account.replaceChildren(avatarElement(profile, 'header-avatar'), document.createTextNode(profile?.display_name || 'Profile'));
  account.setAttribute('aria-label', `Open profile for ${profile?.display_name || 'current user'}`);
}

function renderOwnerTag(element, label, profileId = null) {
  element.replaceChildren();
  if (profileId) element.append(avatarElement(profileById(profileId), 'small'));
  element.append(document.createTextNode(label));
}

function favoriteCardName(cardId) {
  return state.cards.find(card => card.id === cardId)?.title || 'Not selected';
}

function populateFavoriteCards(select, selectedId = '') {
  select.replaceChildren(new Option('Choose a card', ''));
  for (const card of state.cards) select.append(new Option(card.title, card.id));
  select.value = selectedId || '';
}

function authorNames(ids, fallbackId) {
  const profileIds = Array.isArray(ids) && ids.length ? ids : (fallbackId ? [fallbackId] : []);
  return profileIds.map(id => ownerName(id)).filter(Boolean);
}

function renderAuthorOptions(container, selectedIds) {
  container.replaceChildren();
  for (const profile of state.profiles) {
    const label = document.createElement('label');
    label.className = 'author-option';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = profile.id;
    input.checked = selectedIds.includes(profile.id);
    label.append(input, avatarElement(profile, 'small'), document.createTextNode(profile.display_name || 'Player'));
    container.append(label);
  }
}

function selectedAuthorIds(container) {
  return [...container.querySelectorAll('input:checked')].map(input => input.value);
}

function cardTypeIconElement(card) {
  const icon = card.card_type === 'Event' ? document.createElement('span') : document.createElement('img');
  icon.className = `card-type-icon${card.card_type === 'Event' ? ' event-type-icon' : ''}`;
  if (card.card_type === 'Event') icon.style.setProperty('--event-icon-color', eventIconColor(card.terrain));
  else { icon.src = cardTypeIcon(card); icon.alt = ''; }
  icon.title = card.card_type;
  return icon;
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
  if (name !== 'decks') closeDeckCardPreview();
  for (const tab of ['cards', 'decks', 'profiles', 'patrons']) {
    $(`#${tab}-view`).hidden = tab !== name;
    $(`[data-tab="${tab}"]`).classList.toggle('active', tab === name);
  }
  if (name === 'patrons') renderPatrons();
}

function renderPatrons() {
  const list = $('#patron-list');
  list.replaceChildren();
  for (const patron of PATRONS) {
    const article = document.createElement('article');
    article.className = 'patron-card';
    article.innerHTML = `<h3></h3><p class="patron-faction"></p><blockquote></blockquote><h4>Scoring</h4><p class="patron-scoring"></p><h4 class="patron-ability-heading">Ability</h4><p class="patron-ability"></p>`;
    article.querySelector('h3').textContent = patron.name;
    article.querySelector('.patron-faction').textContent = patron.faction;
    article.querySelector('blockquote').textContent = `“${patron.credo}”`;
    article.querySelector('.patron-scoring').textContent = patron.scoring;
    article.querySelector('.patron-ability').textContent = patron.ability || '—';
    article.querySelector('.patron-ability-heading').hidden = !patron.ability;
    article.querySelector('.patron-ability').hidden = !patron.ability;
    list.append(article);
  }
}

function refreshCardAuthorFilter() {
  const select = $('#card-filter-author');
  const current = select.value;
  const authors = [...new Set(state.cards.flatMap(card => authorNames(card.author_ids, card.owner_id)))].sort((a, b) => a.localeCompare(b));
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
    const matchesAuthor = !author || authorNames(item.author_ids, item.owner_id).includes(author);
    const matchesTerrain = !terrain || (terrain === 'none' ? !item.terrain : item.terrain === terrain);
    return matchesSearch && matchesType && matchesAuthor && matchesTerrain;
  })) {
    const row = button('', () => selectCard(card, { openMobile: true }), `card-list-item${state.card?.id === card.id ? ' selected' : ''}`);
    row.setAttribute('aria-label', `${card.card_type}: ${card.title}`);
    const icon = cardTypeIconElement(card);
    const title = document.createElement('span');
    title.className = `card-list-title ${terrainClass(card.terrain)}`;
    title.textContent = card.title;
    row.append(icon, title);
    const meta = document.createElement('small');
    meta.className = 'card-list-owner';
    meta.append(authorDisplayElement(card.author_ids, card.owner_id));
    row.append(meta);
    list.append(row);
  }
  if (!list.childElementCount) list.textContent = 'No cards found.';
}

function setCardFormEditable(canEdit) {
  for (const field of $('#card-form').querySelectorAll('input,select,textarea,button')) field.disabled = !canEdit;
}

function showSignIn() {
  state.user = null;
  state.isAdmin = false;
  stopRealtimeSync();
  $('#sign-in').hidden = false;
  $('#sign-out').hidden = true;
  $('#account-name').hidden = true;
  $('#auth-modal').hidden = false;
  setAuthMode('sign-in');
  document.body.classList.add('auth-modal-open');
  $('#auth-modal-form').elements.email.focus();
  status('Sign in or create an account to contribute.');
}

function showAuthMessage(message, error = false) {
  const element = $('#auth-error-message');
  element.textContent = message;
  element.classList.toggle('success', !error);
  element.hidden = !message;
}

function validateSignUpForm(form) {
  const fields = [form.elements.email, form.elements.password, form.elements.display_name, form.elements.favorite_card_id];
  const issues = [];
  const markInvalid = (field, message) => { field.setAttribute('aria-invalid', 'true'); issues.push([field, message]); };
  for (const field of fields) field.removeAttribute('aria-invalid');

  const email = form.elements.email.value.trim();
  if (!email) markInvalid(form.elements.email, 'Email is required.');
  else if (!form.elements.email.checkValidity()) markInvalid(form.elements.email, 'Email must be a valid email address.');

  const password = form.elements.password.value;
  if (!password) markInvalid(form.elements.password, 'Password is required.');
  else if (password.length < form.elements.password.minLength) markInvalid(form.elements.password, `Password must contain at least ${form.elements.password.minLength} characters.`);

  const displayName = form.elements.display_name.value.trim();
  if (!displayName) markInvalid(form.elements.display_name, 'Display name is required.');
  else if (displayName.length < form.elements.display_name.minLength) markInvalid(form.elements.display_name, `Display name must contain at least ${form.elements.display_name.minLength} characters.`);

  if (!form.elements.favorite_card_id.value) markInvalid(form.elements.favorite_card_id, 'Favorite card is required.');
  if (!issues.length) return true;
  showAuthMessage(`Please correct the highlighted fields: ${issues.map(([, message]) => message).join(' ')}`, true);
  issues[0][0].focus();
  return false;
}

function signUpErrorMessage(error) {
  const message = String(error?.message || 'The request failed.');
  if (/already registered|already exists/i.test(message)) return 'An account already exists for this email address. Sign in instead.';
  if (/rate limit/i.test(message)) return 'Too many registration attempts were made. Wait a few minutes and try again.';
  if (/email/i.test(message)) return `Email could not be accepted: ${message}`;
  if (/password/i.test(message)) return `Password could not be accepted: ${message}`;
  return `Could not create the account: ${message}`;
}

function setAuthMode(mode) {
  authMode = mode;
  const signingUp = mode === 'sign-up';
  const form = $('#auth-modal-form');
  $('#auth-modal-title').textContent = signingUp ? 'Create your Helianthe account' : 'Sign in to Helianthe';
  $('#auth-modal-description').textContent = signingUp
    ? 'Create your profile and choose the card that represents you best.'
    : 'Sign in to create cards and build your own decks.';
  $('#sign-up-fields').hidden = !signingUp;
  form.elements.display_name.required = signingUp;
  form.elements.favorite_card_id.required = signingUp;
  form.elements.password.autocomplete = signingUp ? 'new-password' : 'current-password';
  $('#auth-submit').textContent = signingUp ? 'Create account' : 'Sign in';
  $('#auth-mode-toggle').textContent = signingUp ? 'Back to sign in' : 'Create account';
  if (signingUp) populateFavoriteCards(form.elements.favorite_card_id, form.elements.favorite_card_id.value);
  showAuthMessage('');
}

function showSignUp() {
  if ($('#auth-modal').hidden) showSignIn();
  setAuthMode('sign-up');
  $('#auth-modal-form').elements.email.focus();
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
    author: authorNames(selectedAuthorIds($('#card-author-options')), state.user?.id).join(', '),
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
  renderAuthorOptions($('#card-author-options'), card?.author_ids || (card?.owner_id ? [card.owner_id] : [state.user?.id].filter(Boolean)));
  $('#card-heading').textContent = card?.title || 'New card';
  const mine = Boolean(state.user && card?.owner_id === state.user.id);
  renderOwnerTag($('#card-owner'), card ? (mine ? 'Your card' : `By ${ownerName(card.owner_id)}`) : (state.user ? 'Your new card' : 'Sign in to create a card'), card && !mine ? card.owner_id : null);
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

function openDeckCardPreview() {
  if (!window.matchMedia('(max-width: 850px)').matches) return;
  $('#decks-view').classList.add('mobile-card-preview-open');
  document.body.classList.add('mobile-card-preview-visible');
}

function closeDeckCardPreview() {
  $('#decks-view')?.classList.remove('mobile-card-preview-open');
  document.body.classList.remove('mobile-card-preview-visible');
}

function renderDeckList() {
  const list = $('#deck-list');
  list.replaceChildren();
  for (const deck of state.decks) {
    const row = button('', () => void selectDeck(deck), `deck-list-item${state.deck?.id === deck.id ? ' selected' : ''}`);
    const title = document.createElement('span');
    title.className = 'deck-list-title-wrap';
    const name = document.createElement('strong');
    name.className = 'deck-list-title';
    name.textContent = deck.name;
    title.append(name, deckPatronElement(deck));
    const meta = document.createElement('small');
    meta.className = 'deck-list-owner';
    meta.append(authorDisplayElement(deck.author_ids, deck.owner_id));
    row.append(title, meta);
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
    const row = document.createElement('div'); row.className = `card-list-item deck-card-row${state.deckPreviewCard?.id === card.id ? ' selected' : ''}`;
    row.setAttribute('role', 'button');
    row.tabIndex = 0;
    row.addEventListener('click', () => showDeckCardPreview(card));
    row.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); showDeckCardPreview(card); } });
    row.append(cardTypeIconElement(card));
    const label = document.createElement('span'); label.className = `card-list-title ${terrainClass(card.terrain)}`; label.textContent = card.title;
    const author = document.createElement('small'); author.className = 'card-list-owner'; author.append(authorDisplayElement(card.author_ids, card.owner_id));
    row.append(label, author);
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
       select.addEventListener('click', event => event.stopPropagation());
      row.append(select);
    } else {
      const count = document.createElement('strong'); count.textContent = `×${copies}`; row.append(count);
    }
    list.append(row);
  }
  if (!list.childElementCount) list.textContent = 'This deck has no cards.';
}

async function showDeckCardPreview(card) {
  const serial = ++state.deckPreviewSerial;
  state.deckPreviewCard = card;
  if (state.deckPreviewArtworkUrl) URL.revokeObjectURL(state.deckPreviewArtworkUrl);
  state.deckPreviewArtworkUrl = null;
  renderDeckCards();
  if (!card) {
    closeDeckCardPreview();
    $('#deck-card-preview-note').textContent = 'Select a card to preview it.';
    return;
  }
  openDeckCardPreview();
  const previewCard = { ...card, author: authorNames(card.author_ids, card.owner_id).join(', ') };
  $('#deck-card-preview-note').textContent = '';
  await renderCard($('#deck-card-canvas'), previewCard, '', () => serial === state.deckPreviewSerial).catch(() => {});
  if (!card.artwork_id) return;
  try {
    const blob = await api.fetchArtwork(card.artwork_id);
    if (serial !== state.deckPreviewSerial) return;
    state.deckPreviewArtworkUrl = URL.createObjectURL(blob);
    await renderCard($('#deck-card-canvas'), previewCard, state.deckPreviewArtworkUrl, () => serial === state.deckPreviewSerial);
  } catch (cause) {
    if (serial === state.deckPreviewSerial) $('#deck-card-preview-note').textContent = cause.message;
  }
}

async function selectDeck(deck) {
  state.deck = deck;
  await showDeckCardPreview(null);
  const form = $('#deck-form');
  form.reset();
  form.elements.name.value = deck?.name || '';
  const patronSelect = form.elements.patron_name;
  patronSelect.replaceChildren(new Option('No Patron', ''));
  for (const patron of PATRONS) patronSelect.append(new Option(patron.name, patron.name));
  patronSelect.value = deck?.patron_name || '';
  renderAuthorOptions($('#deck-author-options'), deck?.author_ids || (deck?.owner_id ? [deck.owner_id] : [state.user?.id].filter(Boolean)));
  const mine = Boolean(state.user && (!deck || deck.owner_id === state.user.id));
  for (const field of form.querySelectorAll('input,button')) field.disabled = !mine;
  $('#duplicate-deck').disabled = !deck || !state.user;
  $('#deck-heading').textContent = deck?.name || 'New deck';
  renderOwnerTag($('#deck-owner'), deck ? (mine ? 'Your deck' : `By ${ownerName(deck.owner_id)}`) : (state.user ? 'Your new deck' : 'Sign in to create a deck'), deck && !mine ? deck.owner_id : null);
  state.deckCards = deck ? await api.listDeckCards(deck.id) : [];
  renderDeckList();
  renderDeckCards();
}

function renderProfileList() {
  const list = $('#profile-list');
  list.replaceChildren();
  const ownProfile = state.profiles.find(profile => profile.id === state.user?.id);
  const otherProfiles = state.profiles.filter(profile => profile.id !== state.user?.id);
  const addGroup = (label, profiles, className = '') => {
    if (!profiles.length) return;
    const heading = document.createElement('div');
    heading.className = 'profile-group-title';
    heading.textContent = label;
    list.append(heading);
    for (const profile of profiles) {
      const classes = [className, state.profile?.id === profile.id ? 'selected' : ''].filter(Boolean).join(' ');
      const entry = button('', () => selectProfile(profile), `profile-list-entry ${classes}`.trim());
      const main = document.createElement('span');
      main.className = 'profile-list-main';
      const name = document.createElement('span');
      name.textContent = profile.display_name || 'Player';
      main.append(avatarElement(profile), name);
      entry.append(main);
      list.append(entry);
    }
  };
  addGroup('Your profile', ownProfile ? [ownProfile] : [], 'profile-own');
  addGroup('Other profiles', otherProfiles);
}

function selectProfile(profile) {
  state.profile = profile;
  $('#profile-heading').replaceChildren(avatarElement(profile), document.createTextNode(profile.display_name || 'Player'));
  const mine = profile.id === state.user?.id;
  $('#profile-form').hidden = !mine;
  $('#profile-new-deck').hidden = !mine;
  $('#profile-form').elements.display_name.value = profile.display_name;
  $('#profile-form').elements.bio.value = profile.bio;
  populateFavoriteCards($('#profile-form').elements.favorite_card_id, profile.favorite_card_id);
  $('#profile-bio').hidden = mine;
  $('#profile-bio').textContent = profile.bio || (mine ? 'Add a short bio to your profile.' : 'No bio yet.');
  $('#profile-favorite-card').hidden = mine;
  $('#profile-favorite-card').textContent = `Favorite card: ${favoriteCardName(profile.favorite_card_id)}`;
  const list = $('#profile-decks'); list.replaceChildren();
  for (const deck of state.decks.filter(item => item.owner_id === profile.id && item.is_public)) {
    const deckButton = button('', () => { showTab('decks'); void selectDeck(deck); });
    const deckName = document.createElement('strong');
    deckName.className = 'profile-deck-name';
    deckName.textContent = deck.name;
    deckButton.append(deckName, deckPatronElement(deck, 'profile-deck-patron'));
    list.append(deckButton);
  }
  if (!list.childElementCount) list.textContent = 'No decks yet.';
  renderProfileList();
}

async function reloadCollections() {
  [state.cards, state.decks, state.profiles] = await Promise.all([api.listCards(), api.listDecks(), api.listProfiles()]);
  refreshCardAuthorFilter();
  renderCardList(); renderDeckList(); renderDeckCards(); renderProfileList();
}

function showProfileSaveStatus(message = 'Saved ✓', error = false) {
  const statusElement = $('#profile-save-status');
  statusElement.textContent = message;
  statusElement.classList.toggle('error', error);
  statusElement.hidden = false;
  clearTimeout(profileSaveStatusTimer);
  profileSaveStatusTimer = setTimeout(() => { statusElement.hidden = true; }, error ? 6000 : 2600);
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

async function applyPendingAvatar(user, profile) {
  let dataUrl = '';
  try { dataUrl = localStorage.getItem(pendingAvatarKey(user.email)) || ''; }
  catch { return profile; }
  if (!dataUrl) return profile;
  let artwork = null;
  try {
    artwork = await api.uploadArtwork(fileFromDataUrl(dataUrl));
    const saved = await api.saveProfile(user.id, {
      display_name: profile.display_name,
      bio: profile.bio,
      favorite_card_id: profile.favorite_card_id,
      avatar_id: artwork.id,
    });
    localStorage.removeItem(pendingAvatarKey(user.email));
    return saved;
  } catch (cause) {
    if (artwork) await api.deleteArtwork(artwork.id).catch(console.error);
    console.error('Pending profile photo upload failed', cause);
    return profile;
  }
}

async function loadWorkspace() {
  const version = ++state.authVersion;
  status('Loading your Helianthe workspace…');
  try {
    const user = await api.currentUser();
    if (!user || version !== state.authVersion) return;
    state.user = user;
    state.isAdmin = user.id === ADMIN_USER_ID || user.email?.trim().toLowerCase() === ADMIN_EMAIL;
    let ensuredProfile = await api.ensureProfile(user);
    ensuredProfile = await applyPendingAvatar(user, ensuredProfile);
    await api.publishOwnedDecks(user.id).catch(error => console.error('Could not publish existing decks:', error));
    await reloadCollections();
    startRealtimeSync();
    if (version !== state.authVersion) return;
    $('#auth-view').hidden = true;
    hideSignIn();
    $('#tabs').hidden = false;
    $('#sign-in').hidden = true;
    $('#sign-out').hidden = false;
    showTab('cards');
    selectCard(state.cards[0] || null);
    await selectDeck(state.decks.find(deck => deck.owner_id === user.id) || state.decks[0] || null);
    const profile = state.profiles.find(profile => profile.id === user.id) || state.profiles[0];
    selectProfile(profile);
    renderAccountButton(profile);
    $('#account-name').hidden = false;
    status('Ready.');
  } catch (cause) {
    console.error(cause);
    if (state.user) {
      hideSignIn();
      $('#auth-view').hidden = true;
      $('#tabs').hidden = false;
      $('#sign-in').hidden = true;
      $('#sign-out').hidden = false;
      renderAccountButton(state.profiles.find(profile => profile.id === state.user.id));
      $('#account-name').hidden = false;
      showTab('cards');
      renderCardList();
      status('Your session is active, but some workspace data could not be loaded.', true);
    } else {
      await loadPublicWorkspace();
    }
  }
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
  } catch (cause) {
    console.error(cause);
    $('#auth-view').hidden = true;
    $('#tabs').hidden = false;
    $('#sign-in').hidden = false;
    $('#sign-out').hidden = true;
    $('#account-name').hidden = true;
    showTab('cards');
    hideSignIn();
  }
}

async function submitAuthForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  status('Signing in…');
  const { error } = await client.auth.signInWithPassword({ email: form.elements.email.value.trim(), password: form.elements.password.value });
  if (error) {
    const message = 'No account was found for this email address, or the password is incorrect.';
    showAuthMessage(message, true);
  } else await loadWorkspace();
}

$('#auth-form').addEventListener('submit', submitAuthForm);
$('#auth-modal-form').addEventListener('submit', event => authMode === 'sign-up' ? submitSignUp(event) : submitAuthForm(event));
for (const field of $('#auth-modal-form').querySelectorAll('input, select, textarea')) {
  const clearError = () => { field.removeAttribute('aria-invalid'); showAuthMessage(''); };
  field.addEventListener('input', clearError);
  field.addEventListener('change', clearError);
}

async function submitSignUp(event) {
  event?.preventDefault();
  const form = event?.currentTarget || $('#auth-modal-form');
  if (!validateSignUpForm(form)) return;
  status('Creating account…');
  let avatar = null;
  try {
    const sourceAvatar = $('#sign-up-avatar').files?.[0];
    avatar = sourceAvatar ? await compressedAvatar(sourceAvatar) : null;
  } catch (cause) {
    showAuthMessage(cause.message, true);
    return;
  }
  let response;
  try {
    response = await client.auth.signUp({
      email: form.elements.email.value.trim(), password: form.elements.password.value,
      options: {
        emailRedirectTo: 'https://mysticart.games/helianthe/',
        data: {
          display_name: form.elements.display_name.value.trim(),
          bio: form.elements.bio.value.trim(),
          favorite_card_id: form.elements.favorite_card_id.value,
        },
      },
    });
  } catch (cause) {
    showAuthMessage(signUpErrorMessage(cause), true);
    return;
  }
  const { data, error } = response;
  if (error) showAuthMessage(signUpErrorMessage(error), true);
  else {
    if (avatar) {
      try { localStorage.setItem(pendingAvatarKey(form.elements.email.value), await fileDataUrl(avatar)); }
      catch { showAuthMessage('Account created, but the profile photo could not be retained. Add it after signing in.', true); return; }
    }
    if (data.session) await loadWorkspace();
    else showAuthMessage('Account created. Check your email to confirm it, then sign in. Your profile photo will be uploaded after sign-in.');
  }
}

$('#sign-up').addEventListener('click', showSignUp);
$('#auth-mode-toggle').addEventListener('click', () => authMode === 'sign-up' ? setAuthMode('sign-in') : showSignUp());

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
$('#close-deck-card-preview').addEventListener('click', closeDeckCardPreview);
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
    values.author_ids = selectedAuthorIds($('#card-author-options'));
    values.author = authorNames(values.author_ids, state.user?.id).join(', ');
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
$('#profile-new-deck').addEventListener('click', () => {
  if (!requireAccount()) return;
  showTab('decks');
  void selectDeck(null);
});
$('#duplicate-deck').addEventListener('click', async () => {
  if (!state.user || !state.deck) return;
  const duplicate = $('#duplicate-deck'); duplicate.disabled = true;
  try {
    const deck = await api.duplicateDeck(state.user.id, state.deck, state.deckCards);
    await reloadCollections();
    await selectDeck(state.decks.find(item => item.id === deck.id) || deck);
    status('Deck duplicated.');
  } catch (cause) { status(cause.message, true); }
  finally { duplicate.disabled = !state.deck || !state.user; }
});
$('#deck-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const save = $('#save-deck'); save.disabled = true;
  try {
    const values = { ...Object.fromEntries(new FormData(form)), is_public: true, author_ids: selectedAuthorIds($('#deck-author-options')) };
    const wasNew = !state.deck;
    const deck = state.deck ? await api.saveDeck(state.user.id, state.deck.id, values) : await api.createDeck(state.user.id, values);
    await reloadCollections();
    await selectDeck(state.decks.find(item => item.id === deck.id) || deck);
    status(wasNew ? 'Public deck created.' : 'Deck saved.');
  } catch (cause) { status(cause.message, true); }
  finally { save.disabled = false; }
});

$('#profile-form').addEventListener('submit', async event => {
  event.preventDefault();
  let uploadedAvatar = null;
  try {
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const previousAvatarId = state.profile?.avatar_id || null;
    const sourceAvatar = $('#profile-avatar').files?.[0];
    if (sourceAvatar) uploadedAvatar = await api.uploadArtwork(await compressedAvatar(sourceAvatar));
    values.avatar_id = uploadedAvatar?.id || previousAvatarId;
    await api.saveProfile(state.user.id, values);
    await reloadCollections();
    const ownProfile = state.profiles.find(item => item.id === state.user.id);
    selectProfile(ownProfile);
    renderAccountButton(ownProfile);
    $('#profile-avatar').value = '';
    if (uploadedAvatar && previousAvatarId && previousAvatarId !== uploadedAvatar.id) await api.deleteArtwork(previousAvatarId).catch(console.error);
    showProfileSaveStatus();
    status('Profile saved.');
  } catch (cause) {
    if (uploadedAvatar) await api.deleteArtwork(uploadedAvatar.id).catch(console.error);
    showProfileSaveStatus(cause.message || 'Could not save profile.', true);
    status(cause.message, true);
  }
});

$('#profile-form').addEventListener('input', () => {
  $('#profile-save-status').hidden = true;
  clearTimeout(profileSaveStatusTimer);
});

const closeDeleteAccountModal = () => {
  $('#delete-account-modal').hidden = true;
  document.body.classList.remove('auth-modal-open');
};

const openDeleteAccountModal = () => {
  $('#delete-account-modal').hidden = false;
  document.body.classList.add('auth-modal-open');
  $('#cancel-delete-account').focus();
};

$('#delete-account').addEventListener('click', () => {
  if (!state.user) return;
  openDeleteAccountModal();
});

$('#delete-account-backdrop').addEventListener('click', closeDeleteAccountModal);
$('#close-delete-account').addEventListener('click', closeDeleteAccountModal);
$('#cancel-delete-account').addEventListener('click', closeDeleteAccountModal);

$('#confirm-delete-account').addEventListener('click', async () => {
  if (!state.user) return;
  const button = $('#delete-account');
  const confirmButton = $('#confirm-delete-account');
  closeDeleteAccountModal();
  button.disabled = true;
  confirmButton.disabled = true;
  try {
    const { error } = await client.rpc('delete_current_user');
    if (error) throw new Error(error.message || 'Could not delete the account.');
    try { localStorage.removeItem(pendingAvatarKey(state.user.email)); } catch {}
    await client.auth.signOut({ scope: 'local' }).catch(() => {});
    await loadPublicWorkspace();
  } catch (cause) {
    showProfileSaveStatus(cause.message || 'Could not delete the account.', true);
    button.disabled = false;
    confirmButton.disabled = false;
  }
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !$('#delete-account-modal').hidden) closeDeleteAccountModal();
});

client.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT') void loadPublicWorkspace();
});
const { data: { session }, error } = await client.auth.getSession();
if (error) status(error.message, true);
else if (session) await loadWorkspace();
else await loadPublicWorkspace();
