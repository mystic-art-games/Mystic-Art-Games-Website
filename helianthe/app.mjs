import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.mjs';
import { createCommunityApi, resolveLegacyCardAuthors } from './community-api.mjs';
import { renderCard, downloadCardPNG } from './card-renderer.mjs';
import { PATRONS } from './patrons.mjs';

document.title = ['127.0.0.1', 'localhost', '::1'].includes(window.location.hostname)
  ? 'Helianthe — Local Preview'
  : 'Helianthe';

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
const DECK_PATRONS_KEY = 'helianthe-deck-patrons';
const PATRON_CARD_OVERRIDES_KEY = 'helianthe-patron-card-overrides';
const PATRON_TERRAIN = { Flowbound: 'Flow', Brightworks: 'Radiance', Dreamwardens: 'Symbiosis', Verdant: 'Verdant' };
const patronCards = PATRONS.map(patron => ({
  id: `patron:${patron.name}`,
  title: patron.name,
  card_type: 'Patron',
  terrain: PATRON_TERRAIN[patron.faction],
  effect: [`Credo: “${patron.credo}”`, `Scoring: ${patron.scoring}`, patron.ability ? `Ability: ${patron.ability}` : ''].filter(Boolean).join('\n\n'),
  author: 'Helianthe',
  author_ids: [],
  patron,
}));
try {
  const overrides = JSON.parse(localStorage.getItem(PATRON_CARD_OVERRIDES_KEY) || '{}');
  for (const card of patronCards) Object.assign(card, overrides[card.id] || {});
} catch {}

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
  const method = error ? 'error' : 'info';
  console[method](`[Helianthe] ${message}`);
}

function ownerName(id) {
  if (!id) return 'Helianthe';
  return state.profiles.find(profile => profile.id === id)?.display_name || 'Player';
}

function patronByName(name) {
  const normalized = String(name || '').trim().toLowerCase();
  if (!normalized) return null;
  return PATRONS.find(patron => {
    const fullName = patron.name.toLowerCase();
    const shortName = patron.name.split(',')[0].trim().toLowerCase();
    return fullName === normalized || shortName === normalized;
  }) || null;
}

function savedDeckPatrons() {
  try { return JSON.parse(localStorage.getItem(DECK_PATRONS_KEY) || '{}'); } catch { return {}; }
}

function rememberDeckPatron(deckId, patronName) {
  const saved = savedDeckPatrons();
  if (patronName) saved[deckId] = patronName;
  else delete saved[deckId];
  localStorage.setItem(DECK_PATRONS_KEY, JSON.stringify(saved));
}

function patronFactionClass(faction) {
  return `patron-faction-${String(faction || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

function deckPatronElement(deck, className = 'deck-patron') {
  const patron = patronByName(deck?.patron_name);
  const label = document.createElement('span');
  label.className = `${className}${patron ? ` ${patronFactionClass(patron.faction)}` : ''}`;
  label.textContent = patron ? patron.name : 'No Patron';
  return label;
}

function profileById(id) {
  return state.profiles.find(profile => profile.id === id) || null;
}

const avatarArtworkUrls = new Map();

function avatarElement(profile, className = '') {
  const avatar = document.createElement('span');
  avatar.className = `user-avatar ${className}`.trim();
  avatar.textContent = (profile?.display_name || 'P').trim().charAt(0).toUpperCase() || 'P';
  if (profile?.avatar_id) {
    const image = document.createElement('img');
    image.alt = '';
    avatar.append(image);
    const cachedUrl = avatarArtworkUrls.get(profile.avatar_id);
    if (cachedUrl) {
      image.src = cachedUrl;
    } else {
      void api.fetchArtwork(profile.avatar_id).then(blob => {
        const url = URL.createObjectURL(blob);
        avatarArtworkUrls.set(profile.avatar_id, url);
        image.src = url;
      }).catch(() => image.remove());
    }
    image.addEventListener('load', () => avatar.classList.add('has-image'));
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

function favoriteCardName(cardId) {
  return state.cards.find(card => card.id === cardId)?.title || 'Not selected';
}

let favoritePreviewSerial = 0;
let favoritePreviewCard = null;
const favoritePickerStates = new WeakMap();

function hideFavoriteCardPreview() {
  favoritePreviewSerial += 1;
  favoritePreviewCard = null;
  $('#favorite-card-preview').hidden = true;
}

function positionFavoriteCardPreview(x, y) {
  const preview = $('#favorite-card-preview');
  const width = 250;
  const height = 350;
  preview.style.left = `${Math.max(12, Math.min(x + 16, window.innerWidth - width - 12))}px`;
  preview.style.top = `${Math.max(12, Math.min(y + 16, window.innerHeight - height - 12))}px`;
}

async function showFavoriteCardPreview(card, event) {
  const preview = $('#favorite-card-preview');
  const canvas = $('#favorite-card-preview-canvas');
  favoritePreviewCard = card;
  const serial = ++favoritePreviewSerial;
  positionFavoriteCardPreview(event.clientX, event.clientY);
  preview.hidden = false;
  const previewCard = { ...card, author: authorNames(card.author_ids, card.owner_id).join(', ') };
  await renderCard(canvas, previewCard, '', () => serial === favoritePreviewSerial).catch(() => {});
  if (serial !== favoritePreviewSerial || !card.artwork_id) return;
  try {
    const blob = await api.fetchArtwork(card.artwork_id);
    if (serial !== favoritePreviewSerial) return;
    const artworkUrl = URL.createObjectURL(blob);
    await renderCard(canvas, previewCard, artworkUrl, () => serial === favoritePreviewSerial);
    URL.revokeObjectURL(artworkUrl);
  } catch {}
}

function setupFavoriteCardPicker(select) {
  if (favoritePickerStates.has(select)) return favoritePickerStates.get(select);
  const wrapper = document.createElement('div');
  wrapper.className = 'favorite-card-picker';
  select.classList.add('favorite-card-native');
  select.parentElement.insertBefore(wrapper, select);
  wrapper.append(select);
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'favorite-card-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  const menu = document.createElement('div');
  menu.className = 'favorite-card-menu';
  menu.setAttribute('role', 'listbox');
  menu.hidden = true;
  wrapper.append(trigger, menu);
  const stateForPicker = { wrapper, trigger, menu };
  favoritePickerStates.set(select, stateForPicker);
  trigger.addEventListener('click', event => {
    event.stopPropagation();
    const open = !menu.hidden;
    document.querySelectorAll('.favorite-card-menu').forEach(item => { item.hidden = true; });
    menu.hidden = open;
    trigger.setAttribute('aria-expanded', String(!open));
  });
  wrapper.addEventListener('mouseleave', hideFavoriteCardPreview);
  return stateForPicker;
}

function populateFavoriteCards(select, selectedId = '') {
  const picker = setupFavoriteCardPicker(select);
  select.replaceChildren(new Option('Choose a card', ''));
  for (const card of state.cards) select.append(new Option(card.title, card.id));
  select.value = selectedId || '';
  picker.menu.replaceChildren();
  const addOption = (card, value = '') => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'favorite-card-option';
    option.setAttribute('role', 'option');
    option.append(card ? cardTypeIconElement(card) : document.createElement('span'));
    const label = document.createElement('span');
    label.className = card ? `favorite-card-option-label card-list-title ${terrainClass(card.terrain)}` : 'favorite-card-option-label';
    label.textContent = card ? card.title : 'Choose a card';
    option.append(label);
    option.addEventListener('mouseenter', event => card && void showFavoriteCardPreview(card, event));
    option.addEventListener('mousemove', event => {
      if (favoritePreviewCard === card && !$('#favorite-card-preview').hidden) positionFavoriteCardPreview(event.clientX, event.clientY);
    });
    option.addEventListener('click', () => {
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      updateFavoriteCardTrigger(select);
      picker.menu.hidden = true;
      picker.trigger.setAttribute('aria-expanded', 'false');
      hideFavoriteCardPreview();
    });
    picker.menu.append(option);
  };
  addOption(null);
  for (const card of state.cards) addOption(card, card.id);
  updateFavoriteCardTrigger(select);
}

function updateFavoriteCardTrigger(select) {
  const picker = favoritePickerStates.get(select);
  if (!picker) return;
  const card = state.cards.find(item => item.id === select.value);
  picker.trigger.replaceChildren();
  if (card) {
    picker.trigger.append(cardTypeIconElement(card));
    const label = document.createElement('span');
    label.className = `favorite-card-option-label ${terrainClass(card.terrain)}`;
    label.textContent = card.title;
    picker.trigger.append(label);
  } else picker.trigger.textContent = 'Choose a card';
}

document.addEventListener('click', event => {
  if (event.target.closest('.favorite-card-picker')) return;
  document.querySelectorAll('.favorite-card-menu').forEach(menu => { menu.hidden = true; });
});

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

function renderDeckAuthorSelect(selectedId) {
  const select = $('#deck-author-select');
  select.replaceChildren();
  for (const profile of state.profiles) select.append(new Option(profile.display_name || ownerName(profile.id), profile.id));
  select.value = selectedId && [...select.options].some(option => option.value === selectedId) ? selectedId : (state.user?.id || '');
}

function cardTypeIconElement(card) {
  const radianceEntity = card.card_type === 'Entity' && card.terrain === 'Radiance';
  const icon = card.card_type === 'Event' || radianceEntity ? document.createElement('span') : document.createElement('img');
  icon.className = `card-type-icon${card.card_type === 'Event' ? ' event-type-icon' : ''}${radianceEntity ? ' radiance-entity-type-icon' : ''}`;
  if (card.card_type === 'Event') icon.style.setProperty('--event-icon-color', eventIconColor(card.terrain));
  else if (radianceEntity) icon.style.setProperty('--event-icon-color', eventIconColor(card.terrain));
  else { icon.src = cardTypeIcon(card); icon.alt = ''; }
  icon.title = card.card_type;
  return icon;
}

function cardTypeIcon(card) {
  if (card.card_type === 'Event') return './assets/Event.png';
  const terrain = ['Symbiosis', 'Flow', 'Verdant', 'Radiance'].includes(card.terrain) ? card.terrain : 'Flow';
  return `./assets/Entity_${terrain}.png`;
}

function eventIconColor(terrain) {
  return {
    Symbiosis: '#b88425', Flow: '#6996bf', Verdant: '#65a838', Radiance: '#b88425',
  }[terrain] || '#909592';
}

function terrainClass(terrain) {
  return ['Symbiosis', 'Flow', 'Verdant', 'Radiance'].includes(terrain) ? `terrain-${terrain.toLowerCase()}` : 'terrain-event';
}

function button(label, action, className = '') {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.className = className;
  element.addEventListener('click', action);
  return element;
}

const TAB_NAMES = ['cards', 'decks', 'profiles', 'about'];

function requestedTab() {
  const name = window.location.hash.slice(1).toLowerCase();
  if (name === 'patrons') return 'cards';
  return TAB_NAMES.includes(name) ? name : 'about';
}

function showTab(name, { updateUrl = true } = {}) {
  if (!TAB_NAMES.includes(name)) name = 'about';
  const enteringDecks = name === 'decks' && $('#decks-view').hidden;
  if (enteringDecks && state.deck) void selectDeck(null);
  closeMobileMenu();
  if (name !== 'decks') closeDeckCardPreview();
  for (const tab of TAB_NAMES) {
    $(`#${tab}-view`).hidden = tab !== name;
    $(`[data-tab="${tab}"]`).classList.toggle('active', tab === name);
  }
  if (updateUrl && window.location.hash !== `#${name}`) window.history.replaceState(null, '', `#${name}`);
}

function closeMobileMenu() {
  const menu = $('#tabs');
  const toggle = $('#mobile-menu-toggle');
  if (!menu || !toggle) return;
  menu.classList.remove('mobile-menu-open');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-label', 'Open navigation menu');
}

function refreshCardAuthorFilter() {
  const select = $('#card-filter-author');
  const current = select.value;
  const authors = [...new Set([
    ...patronCards.flatMap(card => authorNames(card.author_ids).length ? authorNames(card.author_ids) : [card.author]),
    ...state.profiles.map(profile => profile.display_name || ownerName(profile.id)),
    ...state.cards.flatMap(card => authorNames(card.author_ids, card.owner_id)),
  ].filter(Boolean))].sort((a, b) => a.localeCompare(b));
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
  for (const card of [...state.cards, ...patronCards].sort((a, b) => a.title.localeCompare(b.title)).filter(item => {
    const matchesSearch = `${item.title} ${item.effect}`.toLocaleLowerCase().includes(query);
    const matchesType = !type || item.card_type === type;
    const matchesAuthor = !author || (item.patron ? (authorNames(item.author_ids).includes(author) || (!item.author_ids?.length && item.author === author)) : authorNames(item.author_ids, item.owner_id).includes(author));
    const matchesTerrain = !terrain || (terrain === 'none' ? !item.terrain : item.terrain === terrain);
    return matchesSearch && matchesType && matchesAuthor && matchesTerrain;
  })) {
    const row = button('', () => selectCard(card, { openMobile: true }), `card-list-item${state.card?.id === card.id ? ' selected' : ''}`);
    row.dataset.cardId = card.id;
    row.setAttribute('aria-label', `${card.card_type}: ${card.title}`);
    const icon = card.patron ? document.createElement('span') : cardTypeIconElement(card);
    if (card.patron) { icon.className = `card-type-icon patron-type-icon ${terrainClass(card.terrain)}`; icon.setAttribute('aria-hidden', 'true'); }
    const title = document.createElement('span');
    title.className = `card-list-title ${terrainClass(card.terrain)}`;
    title.textContent = card.title;
    row.append(icon, title);
    const meta = document.createElement('small');
    meta.className = 'card-list-owner';
    if (card.patron && card.author_ids?.length) meta.append(authorDisplayElement(card.author_ids));
    else if (card.patron) meta.textContent = card.author;
    else meta.append(authorDisplayElement(card.author_ids, card.owner_id));
    row.append(meta);
    list.append(row);
  }
  if (!list.childElementCount) list.textContent = 'No cards found.';
}

function scrollToCardRow(cardId) {
  requestAnimationFrame(() => {
    const list = $('#card-list');
    const row = [...list.children].find(item => item.dataset.cardId === cardId);
    if (!row) return;
    const distance = row.getBoundingClientRect().top - list.getBoundingClientRect().top;
    list.scrollTo({ top: list.scrollTop + distance - (list.clientHeight - row.clientHeight) / 2, behavior: 'smooth' });
  });
}

function setCardFormEditable(canEdit) {
  for (const field of $('#card-form').querySelectorAll('input,select,textarea,button')) field.disabled = !canEdit;
}

function canEditCard(card) {
  if (card?.patron) return true;
  if (!state.user) return false;
  if (!card) return true;
  return state.isAdmin || card.owner_id === state.user.id || card.author_ids?.includes(state.user.id);
}

function canEditDeck(deck) {
  return Boolean(state.user && deck && deck.owner_id === state.user.id);
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
    author: state.card?.patron ? authorNames(selectedAuthorIds($('#card-author-options'))).join(', ') || state.card.author : authorNames(selectedAuthorIds($('#card-author-options')), state.user?.id).join(', '),
  };
  $('#download-png').disabled = true;
  void renderCard($('#card-canvas'), card, state.artworkUrl || '', () => serial === state.renderSerial)
    .then(result => {
      if (serial !== state.renderSerial || result.cancelled) return;
      $('#preview-note').textContent = result.clipped ? 'Text is too long — shorten the effect before exporting.' : '';
      $('#download-png').disabled = result.clipped;
      $('#delete-card').disabled = !state.card || !!state.card.patron || !state.user || (state.card.owner_id !== state.user.id && !state.isAdmin);
    })
    .catch(cause => { if (serial === state.renderSerial) $('#preview-note').textContent = cause.message; });
}

let cardFieldDraft = null;

function closeCardField(commit = false) {
  if (!commit && cardFieldDraft) {
    const form = $('#card-form');
    for (const [name, value] of Object.entries(cardFieldDraft.values)) form.elements[name].value = value;
    for (const input of $('#card-author-options').querySelectorAll('input')) input.checked = cardFieldDraft.authors.includes(input.value);
    if (cardFieldDraft.artworkChanged) {
      $('#card-artwork').value = '';
      ++state.artworkSerial;
      releaseArtwork();
      void showArtwork(state.card);
    }
    renderPreview();
  }
  $('#card-field-modal').hidden = true;
  $('#card-field-content').replaceChildren();
  $('#card-field-status').hidden = true;
  cardFieldDraft = null;
  $('#card-canvas').focus({ preventScroll: true });
}

function openCardField(field) {
  const form = $('#card-form');
  if (form.elements.title.disabled) return;
  const sources = {
    title: form.elements.title.closest('label'),
    identity: form.elements.card_type.closest('.two-cols'),
    artwork: $('#card-artwork').closest('label'),
    effect: form.elements.effect.closest('label'),
    authors: $('#card-author-options').closest('fieldset'),
  };
  const titles = { title: 'Edit title', identity: 'Edit type and color', artwork: 'Choose artwork', effect: 'Edit effect', authors: 'Edit authors' };
  const source = sources[field];
  if (!source) return;
  cardFieldDraft = {
    values: Object.fromEntries(['title', 'card_type', 'terrain', 'effect'].map(name => [name, form.elements[name].value])),
    authors: selectedAuthorIds($('#card-author-options')),
    artworkChanged: false,
  };
  const content = $('#card-field-content');
  $('#card-field-status').hidden = true;
  content.replaceChildren(source.cloneNode(true));
  if (field === 'artwork') {
    const hint = document.createElement('p');
    hint.className = 'form-hint';
    hint.textContent = 'Artwork is automatically compressed to 100 KB before upload. Source files can be up to 20 MB.';
    content.append(hint);
  }
  $('#card-field-title').textContent = titles[field];
  const copies = content.querySelectorAll('input, select, textarea');
  for (const [index, original] of [...source.querySelectorAll('input, select, textarea')].entries()) {
    const copy = copies[index];
    if (!copy) continue;
    if (copy.type === 'checkbox') copy.checked = original.checked;
    else if (copy.type !== 'file') copy.value = original.value;
    copy.removeAttribute('id');
    copy.addEventListener(copy.type === 'file' ? 'change' : 'input', () => {
      if (copy.type === 'file') {
        original.files = copy.files;
        if (cardFieldDraft) cardFieldDraft.artworkChanged = true;
        original.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        if (copy.type === 'checkbox') original.checked = copy.checked;
        else original.value = copy.value;
        original.dispatchEvent(new Event('input', { bubbles: true }));
        if (original.name === 'card_type') {
          syncTerrain();
          content.querySelector('[name="terrain"]').value = form.elements.terrain.value;
          renderPreview();
        }
      }
    });
  }
  $('#card-field-modal').hidden = false;
  content.querySelector('input:not([type="checkbox"]), select, textarea, input[type="checkbox"]')?.focus();
}

function cardFieldAt(event) {
  const box = event.currentTarget.getBoundingClientRect();
  const x = (event.clientX - box.left) * 750 / box.width;
  const y = (event.clientY - box.top) * 1050 / box.height;
  if (y < 155) return x < 145 || x > 605 ? 'identity' : 'title';
  if (y < 765) return 'artwork';
  if (y < 955) return 'effect';
  return 'authors';
}

function selectCard(card, { openMobile = false } = {}) {
  if (!$('#card-field-modal').hidden) closeCardField();
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
  setCardFormEditable(canEditCard(card));
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
    const cover = document.createElement('span');
    cover.className = 'deck-tile-cover';
    cover.setAttribute('aria-hidden', 'true');
    const image = document.createElement('img');
    image.src = './assets/site-background.jpg';
    image.alt = '';
    cover.append(image);
    const title = document.createElement('span');
    title.className = 'deck-list-title-wrap';
    const name = document.createElement('strong');
    name.className = 'deck-list-title';
    name.textContent = deck.name;
    title.append(name);
    const meta = document.createElement('small');
    meta.className = 'deck-list-owner';
    meta.append(authorDisplayElement(deck.author_ids, deck.owner_id));
    row.append(cover, title, meta);
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
       select.addEventListener('click', event => event.stopPropagation());
      row.append(select);
    } else {
      const count = document.createElement('strong'); count.textContent = `×${copies}`; row.append(count);
    }
    list.append(row);
  }
  if (!list.childElementCount) list.textContent = 'This deck has no cards.';
}

function renderDeckPatron(patron) {
  const shell = $('.deck-patron-preview-shell');
  shell.className = `deck-patron-preview-shell patron-faction-${(patron?.faction || 'none').toLowerCase().replaceAll(/[^a-z]+/g, '-')}`;
  $('#deck-patron-name').textContent = patron?.name || 'No Patron';
  $('#deck-patron-faction').textContent = patron?.faction || '';
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
  if (!deck) $('#decks-view').classList.remove('deck-detail-open');
  renderDeckList();
  const canDelete = Boolean(deck && state.user && (deck.owner_id === state.user.id || state.isAdmin));
  $('#duplicate-deck').disabled = !deck || !state.user;
  $('#delete-deck').disabled = !canDelete;
  await showDeckCardPreview(null);
  const form = $('#deck-form');
  form.reset();
  form.elements.name.value = deck?.name || '';
  const patronSelect = form.elements.patron_name;
  patronSelect.replaceChildren(new Option('No Patron', ''));
  for (const patron of PATRONS) patronSelect.append(new Option(patron.name, patron.name));
  patronSelect.value = patronByName(deck?.patron_name)?.name || '';
  renderDeckPatron(patronByName(deck?.patron_name));
  renderDeckAuthorSelect(deck?.author_ids?.[0] || deck?.owner_id || state.user?.id);
  const mine = Boolean(state.user && (!deck || deck.owner_id === state.user.id));
  for (const field of form.querySelectorAll('input,button,select')) field.disabled = !mine;
  $('#duplicate-deck').disabled = !deck || !state.user;
  $('#delete-deck').disabled = !deck || !state.user || (!mine && !state.isAdmin);
  const deckCards = deck ? await api.listDeckCards(deck.id) : [];
  if (deck && state.deck?.id !== deck.id) return;
  state.deckCards = deckCards;
  const deckIsMine = Boolean(state.deck && state.deck.owner_id === state.user?.id);
  const firstDeckCard = state.cards.find(card => deckIsMine || state.deckCards.some(item => item.card_id === card.id && item.copies > 0));
  state.deckPreviewCard = firstDeckCard || null;
  renderDeckCards();
  if (deck) $('#decks-view').classList.add('deck-detail-open');
  if (firstDeckCard) await showDeckCardPreview(firstDeckCard);
}

function nextNewDeckName() {
  const existingNames = new Set(state.decks.map(deck => deck.name));
  let suffix = 0;
  let name = 'New Deck';
  while (existingNames.has(name)) {
    suffix += 1;
    name = `New Deck ${suffix}`;
  }
  return name;
}

function nextDuplicateDeckName(deck) {
  const sourceName = String(deck?.name || 'Deck').trim() || 'Deck';
  const numbered = sourceName.match(/^(.*) (\d+)$/);
  const baseName = (numbered ? numbered[1] : sourceName).trim() || 'Deck';
  let suffix = numbered ? Number(numbered[2]) + 1 : 2;
  const existingNames = new Set(state.decks.map(item => item.name));
  let name = `${baseName} ${suffix}`;
  while (existingNames.has(name)) name = `${baseName} ${++suffix}`;
  return name.slice(0, 100);
}

async function createNewDeck() {
  deckSaveQueue = deckSaveQueue.catch(() => {}).then(async () => {
    await selectDeck(null);
    $('#deck-form').elements.name.value = nextNewDeckName();
    const values = deckFormValues();
    const saved = await api.createDeck(state.user.id, values);
    rememberDeckPatron(saved.id, values.patron_name);
    state.decks = [saved, ...state.decks.filter(deck => deck.id !== saved.id)];
    await selectDeck(saved);
    if (state.profile) selectProfile(state.profiles.find(profile => profile.id === state.profile.id) || null);
    status('Deck created.');
  });
  return deckSaveQueue;
}

let deckSaveQueue = Promise.resolve();

function deckFormValues() {
  const form = $('#deck-form');
  return { ...Object.fromEntries(new FormData(form)), is_public: true, author_ids: [$('#deck-author-select').value].filter(Boolean) };
}

async function autosaveDeck() {
  if (!state.user) return;
  const values = deckFormValues();
  const saved = state.deck
    ? await api.saveDeck(state.user.id, state.deck.id, values)
    : await api.createDeck(state.user.id, values);
  rememberDeckPatron(saved.id, values.patron_name);
  if (!state.deck) {
    state.decks = [saved, ...state.decks.filter(deck => deck.id !== saved.id)];
    renderDeckList();
  }
  await reloadCollections();
  await selectDeck(state.decks.find(item => item.id === saved.id) || saved);
  status('Deck saved.');
}

function queueDeckSave() {
  if (state.deck) {
    const updatedDeck = { ...state.deck, ...deckFormValues() };
    rememberDeckPatron(updatedDeck.id, updatedDeck.patron_name);
    state.deck = updatedDeck;
    state.decks = state.decks.map(deck => deck.id === updatedDeck.id ? updatedDeck : deck);
    renderDeckList();
    if (state.profile) selectProfile(state.profiles.find(profile => profile.id === state.profile.id) || null);
  }
  deckSaveQueue = deckSaveQueue.catch(() => {}).then(autosaveDeck);
  return deckSaveQueue;
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
  state.cards = resolveLegacyCardAuthors(state.cards, state.profiles);
  const savedPatrons = savedDeckPatrons();
  state.decks = state.decks.map(deck => deck.patron_name || !savedPatrons[deck.id] ? deck : { ...deck, patron_name: savedPatrons[deck.id] });
  refreshCardAuthorFilter();
  renderCardList(); renderDeckList(); renderDeckCards(); renderProfileList();
  if (state.profile) selectProfile(state.profiles.find(profile => profile.id === state.profile.id) || null);
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
  const refreshCards = async () => {
    const selectedId = state.card?.id;
    try {
      await reloadCollections();
      if (selectedId && !state.cardFormDirty && $('#card-field-modal').hidden) selectCard([...state.cards, ...patronCards].find(card => card.id === selectedId) || state.cards[0] || patronCards[0]);
      else renderCardList();
    } catch (cause) { status(cause.message, true); }
  };
  const refreshProfiles = async () => {
    const selectedCardAuthors = selectedAuthorIds($('#card-author-options'));
    const selectedDeckAuthor = $('#deck-author-select').value;
    try {
      await reloadCollections();
      renderAuthorOptions($('#card-author-options'), selectedCardAuthors);
      renderDeckAuthorSelect(selectedDeckAuthor);
      const cardEditable = canEditCard(state.card);
      const deckEditable = Boolean(state.user && (!state.deck || state.deck.owner_id === state.user.id));
      for (const input of $('#card-author-options').querySelectorAll('input')) input.disabled = !cardEditable;
      $('#deck-author-select').disabled = !deckEditable;
    } catch (cause) { status(cause.message, true); }
  };
  const refreshDecks = async () => {
    const selectedDeckId = state.deck?.id;
    const selectedPreviewId = state.deckPreviewCard?.id;
    try {
      await reloadCollections();
      if (!selectedDeckId) return;
      const updatedDeck = state.decks.find(deck => deck.id === selectedDeckId);
      if (!updatedDeck) { state.deck = null; renderDeckCards(); return; }
      state.deck = updatedDeck;
      state.deckCards = await api.listDeckCards(updatedDeck.id);
      const previewCard = state.cards.find(card => card.id === selectedPreviewId);
      if (previewCard) await showDeckCardPreview(previewCard);
      else renderDeckCards();
    } catch (cause) { status(cause.message, true); }
  };
  state.realtimeChannel = client.channel('helianthe-workspace')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'cards' }, refreshCards)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, refreshProfiles)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'decks' }, refreshDecks)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'deck_cards' }, refreshDecks)
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
    showTab(requestedTab());
    selectCard(state.cards[0] || patronCards[0]);
    await selectDeck(null);
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
      showTab(requestedTab());
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
    selectCard(state.cards[0] || patronCards[0]);
    await selectDeck(null);
    if (state.profiles[0]) selectProfile(state.profiles[0]);
    showTab(requestedTab());
    status('Browsing publicly. Sign in to create cards and decks.');
  } catch (cause) {
    console.error(cause);
    $('#auth-view').hidden = true;
    $('#tabs').hidden = false;
    $('#sign-in').hidden = false;
    $('#sign-out').hidden = true;
    $('#account-name').hidden = true;
    showTab(requestedTab());
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
window.addEventListener('hashchange', () => showTab(requestedTab(), { updateUrl: false }));
$('#mobile-menu-toggle').addEventListener('click', () => {
  const menu = $('#tabs');
  const toggle = $('#mobile-menu-toggle');
  const open = !menu.classList.contains('mobile-menu-open');
  menu.classList.toggle('mobile-menu-open', open);
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? 'Close navigation menu' : 'Open navigation menu');
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeMobileMenu();
});
document.addEventListener('click', event => {
  if (!event.target.closest('.header-controls')) closeMobileMenu();
});
$('#card-search').addEventListener('input', renderCardList);
for (const filter of document.querySelectorAll('#card-filter-type, #card-filter-author, #card-filter-terrain')) filter.addEventListener('change', renderCardList);
$('#new-card').addEventListener('click', async () => {
  if (!requireAccount()) return;
  const create = $('#new-card');
  create.disabled = true;
  try {
    const names = new Set(state.cards.map(card => card.title.trim().toLocaleLowerCase()));
    let title = 'New Card';
    for (let suffix = 2; names.has(title.toLocaleLowerCase()); suffix++) title = `New Card ${suffix}`;
    const created = await api.createCard(state.user.id, {
      title, card_type: 'Entity', terrain: 'Symbiosis', effect: '',
      author: authorNames([state.user.id], state.user.id).join(', '), author_ids: [state.user.id],
    });
    await reloadCollections();
    $('#card-search').value = '';
    $('#card-filter-type').value = '';
    $('#card-filter-author').value = '';
    $('#card-filter-terrain').value = '';
    selectCard(state.cards.find(card => card.id === created.id) || created);
    scrollToCardRow(created.id);
    status('Card created. Select it to edit.');
  } catch (cause) { status(cause.message, true); }
  finally { create.disabled = false; }
});
$('#close-mobile-editor').addEventListener('click', closeMobileEditor);
$('#card-canvas').tabIndex = 0;
$('#card-canvas').addEventListener('click', event => openCardField(cardFieldAt(event)));
$('#card-canvas').addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openCardField('identity'); } });
$('#close-card-field').addEventListener('click', closeCardField);
$('#card-field-save').addEventListener('click', () => { void saveCardForm(); });
$('#card-field-cancel').addEventListener('click', () => closeCardField(false));
$('#card-field-modal .card-field-backdrop').addEventListener('click', closeCardField);
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('#card-field-modal').hidden) { event.stopPropagation(); closeCardField(false); } });
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
$('#delete-card').addEventListener('click', async () => {
  const card = state.card;
  if (!card || !state.user) return;
  $('#delete-card-description').textContent = `Delete “${card.title}”? This cannot be undone.`;
  $('#delete-card-modal').hidden = false;
  document.body.classList.add('auth-modal-open');
  $('#cancel-delete-card').focus();
});

const closeDeleteCardModal = () => {
  $('#delete-card-modal').hidden = true;
  document.body.classList.remove('auth-modal-open');
};

$('#delete-card-backdrop').addEventListener('click', closeDeleteCardModal);
$('#close-delete-card').addEventListener('click', closeDeleteCardModal);
$('#cancel-delete-card').addEventListener('click', closeDeleteCardModal);

$('#confirm-delete-card').addEventListener('click', async () => {
  const card = state.card;
  if (!card || !state.user) return closeDeleteCardModal();
  const artworkId = card.artwork_id;
  const deleteButton = $('#delete-card');
  const confirmButton = $('#confirm-delete-card');
  let deleted = false;
  deleteButton.disabled = true;
  confirmButton.disabled = true;
  try {
    await api.deleteCard(state.user.id, card.id, state.isAdmin);
    deleted = true;
    state.cards = state.cards.filter(item => item.id !== card.id);
    state.card = null;
    closeDeleteCardModal();
    renderCardList();
    selectCard(state.cards[0] || patronCards[0]);
    await reloadCollections();
    status('Card deleted.');
  } catch (cause) {
    closeDeleteCardModal();
    status(cause.message, true);
  } finally {
    confirmButton.disabled = false;
    deleteButton.disabled = !state.card || !state.user || (state.card.owner_id !== state.user.id && !state.isAdmin);
  }
  if (artworkId && deleted) {
    await api.deleteArtwork(artworkId).catch(error => console.error('Artwork cleanup failed', error));
  }
});

let savingCard = false;
async function saveCardForm() {
  if (savingCard) return;
  const form = $('#card-form');
  const modalOpen = !$('#card-field-modal').hidden;
  const modalStatus = $('#card-field-status');
  modalStatus.hidden = true;
  const invalidField = [...form.elements].find(field => !field.checkValidity());
  if (invalidField) {
    if (modalOpen) {
      modalStatus.textContent = invalidField.validationMessage || 'Check the card fields before saving.';
      modalStatus.hidden = false;
    } else status(invalidField.validationMessage || 'Check the card fields before saving.', true);
    return;
  }
  savingCard = true;
  const isNewCard = !state.card;
  const save = $('#save-card'); save.disabled = true;
  const modalSave = $('#card-field-save'); modalSave.disabled = true;
  let persistedCard = null;
  let cleanupWarning = '';
  try {
    const values = Object.fromEntries(new FormData(form));
    values.author_ids = selectedAuthorIds($('#card-author-options'));
    values.author = authorNames(values.author_ids, state.user?.id).join(', ');
    const sourceFile = $('#card-artwork').files?.[0];
    const file = sourceFile ? await compressedArtwork(sourceFile) : null;
    const previousArtworkId = state.card?.artwork_id || null;
    let card;
    if (state.card?.patron) {
      const authorIds = selectedAuthorIds($('#card-author-options'));
      const updates = { title: values.title, terrain: values.terrain, effect: values.effect, author_ids: authorIds, author: authorNames(authorIds).join(', ') || 'Helianthe' };
      Object.assign(state.card, updates);
      const overrides = JSON.parse(localStorage.getItem(PATRON_CARD_OVERRIDES_KEY) || '{}');
      overrides[state.card.id] = updates;
      localStorage.setItem(PATRON_CARD_OVERRIDES_KEY, JSON.stringify(overrides));
      card = state.card;
    } else {
      card = state.card
        ? await api.saveCard(state.user.id, state.card.id, values)
        : await api.createCard(state.user.id, values);
    }
    persistedCard = card;
    if (file && !state.card?.patron) {
      const artwork = await api.uploadArtwork(file);
      try { card = await api.saveCard(state.user.id, card.id, { ...values, artwork_id: artwork.id }); }
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
    if (!state.card?.patron) await reloadCollections();
    if (isNewCard) {
      $('#card-search').value = '';
      $('#card-filter-type').value = '';
      $('#card-filter-author').value = '';
      $('#card-filter-terrain').value = '';
    }
    if (modalOpen) closeCardField(true);
    selectCard(state.cards.find(item => item.id === card.id) || patronCards.find(item => item.id === card.id) || card);
    renderCardList();
    scrollToCardRow(card.id);
    status(cleanupWarning ? `Card saved. ${cleanupWarning}` : 'Card saved.', Boolean(cleanupWarning));
  } catch (cause) {
    if (persistedCard) {
      await reloadCollections().catch(console.error);
      state.card = persistedCard;
    }
    status(cause.message, true);
    if (modalOpen) {
      modalStatus.textContent = cause.message || 'Card could not be saved. Try again.';
      modalStatus.hidden = false;
    }
  }
  finally { savingCard = false; save.disabled = false; modalSave.disabled = false; }
}
$('#card-form').addEventListener('submit', event => { event.preventDefault(); void saveCardForm(); });

$('#new-deck').addEventListener('click', () => {
  if (requireAccount()) void createNewDeck().catch(cause => status(cause.message, true));
});
$('#back-to-decks').addEventListener('click', () => { void selectDeck(null); });
$('#profile-new-deck').addEventListener('click', () => {
  if (!requireAccount()) return;
  showTab('decks');
  void createNewDeck().catch(cause => status(cause.message, true));
});
$('#duplicate-deck').addEventListener('click', async () => {
  if (!state.user || !state.deck) return;
  const duplicate = $('#duplicate-deck'); duplicate.disabled = true;
  try {
    const deck = await api.duplicateDeck(state.user.id, state.deck, state.deckCards, nextDuplicateDeckName(state.deck));
    await reloadCollections();
    await selectDeck(state.decks.find(item => item.id === deck.id) || deck);
    status('Deck duplicated.');
  } catch (cause) { status(cause.message, true); }
  finally { duplicate.disabled = !state.deck || !state.user; }
});
$('#delete-deck').addEventListener('click', () => {
  const deck = state.deck;
  if (!deck || !state.user || (!canEditDeck(deck) && !state.isAdmin)) return;
  $('#delete-deck-description').textContent = `Delete “${deck.name}”? This cannot be undone.`;
  $('#delete-deck-modal').hidden = false;
  document.body.classList.add('auth-modal-open');
  $('#cancel-delete-deck').focus();
});
const closeDeleteDeckModal = () => {
  $('#delete-deck-modal').hidden = true;
  document.body.classList.remove('auth-modal-open');
};
$('#delete-deck-backdrop').addEventListener('click', closeDeleteDeckModal);
$('#close-delete-deck').addEventListener('click', closeDeleteDeckModal);
$('#cancel-delete-deck').addEventListener('click', closeDeleteDeckModal);
$('#confirm-delete-deck').addEventListener('click', async () => {
  const deck = state.deck;
  if (!deck || !state.user) return closeDeleteDeckModal();
  const button = $('#delete-deck');
  const confirmButton = $('#confirm-delete-deck');
  button.disabled = true;
  confirmButton.disabled = true;
  try {
    await api.deleteDeck(state.user.id, deck.id, state.isAdmin);
    state.deck = null;
    state.deckCards = [];
    state.decks = state.decks.filter(item => item.id !== deck.id);
    closeDeleteDeckModal();
    await selectDeck(null);
    if (state.profile) selectProfile(state.profiles.find(profile => profile.id === state.profile.id) || null);
    status('Deck deleted.');
  } catch (cause) {
    closeDeleteDeckModal();
    status(cause.message, true);
  } finally {
    confirmButton.disabled = false;
    button.disabled = !state.deck || !state.user || (!canEditDeck(state.deck) && !state.isAdmin);
  }
});
for (const field of [$('#deck-form').elements.name, $('#deck-form').elements.patron_name]) {
  field.addEventListener('change', () => {
    if (field.name === 'patron_name') renderDeckPatron(patronByName(field.value));
    void queueDeckSave().catch(cause => status(cause.message, true));
  });
}
$('#deck-author-select').addEventListener('change', () => { void queueDeckSave().catch(cause => status(cause.message, true)); });
$('#deck-form').addEventListener('submit', event => event.preventDefault());

$('#profile-form').addEventListener('submit', async event => {
  event.preventDefault();
  const submitButton = event.currentTarget.querySelector('button[type="submit"]');
  const originalLabel = submitButton.textContent;
  submitButton.disabled = true;
  submitButton.textContent = 'Saving…';
  showProfileSaveStatus('Saving…');
  let uploadedAvatar = null;
  try {
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const previousAvatarId = state.profile?.avatar_id || null;
    const sourceAvatar = $('#profile-avatar').files?.[0];
    if (sourceAvatar) uploadedAvatar = await api.uploadArtwork(await compressedAvatar(sourceAvatar));
    values.avatar_id = uploadedAvatar?.id || previousAvatarId;
    const savedProfile = await api.saveProfile(state.user.id, values);
    state.profiles = state.profiles.map(profile => profile.id === savedProfile.id ? savedProfile : profile);
    const ownProfile = savedProfile;
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
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = originalLabel;
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
  if (event.key === 'Escape' && !$('#delete-card-modal').hidden) closeDeleteCardModal();
  if (event.key === 'Escape' && !$('#delete-deck-modal').hidden) closeDeleteDeckModal();
});

function initArtDecoScrollbars() {
  for (const element of document.querySelectorAll('.item-list, .deck-cards, .about-content')) {
    const existingWrapper = element.parentElement?.classList.contains('art-scroll-wrap') ? element.parentElement : null;
    if (existingWrapper && element.dataset.artScrollReady === 'true') continue;
    const wrapper = existingWrapper || document.createElement('div');
    if (!existingWrapper) {
      wrapper.className = 'art-scroll-wrap';
      element.parentNode.insertBefore(wrapper, element);
      wrapper.append(element);
    }
    const rail = existingWrapper?.querySelector('.art-scroll-rail') || document.createElement('div');
    rail.className = 'art-scroll-rail';
    rail.setAttribute('aria-hidden', 'true');
    const thumb = existingWrapper?.querySelector('.art-scroll-thumb') || document.createElement('button');
    thumb.className = 'art-scroll-thumb';
    thumb.type = 'button';
    thumb.tabIndex = -1;
    if (!existingWrapper) {
      rail.append(thumb);
      wrapper.append(rail);
    }
    element.dataset.artScrollReady = 'true';
    const update = () => {
      const maxScroll = element.scrollHeight - element.clientHeight;
      const railHeight = rail.clientHeight;
      const thumbHeight = Math.min(railHeight, 44);
      thumb.style.height = `${thumbHeight}px`;
      rail.style.display = maxScroll > 0 ? '' : 'none';
      thumb.style.display = maxScroll > 0 ? '' : 'none';
      thumb.style.transform = `translateY(${maxScroll > 0 ? (element.scrollTop / maxScroll) * (railHeight - thumbHeight) : 0}px)`;
    };
    element.addEventListener('scroll', update, { passive: true });
    new ResizeObserver(update).observe(element);
    new ResizeObserver(update).observe(wrapper);
    new MutationObserver(update).observe(element, { childList: true, subtree: true });
    thumb.addEventListener('pointerdown', event => {
      event.preventDefault();
      thumb.setPointerCapture(event.pointerId);
      const startY = event.clientY;
      const startScroll = element.scrollTop;
      const move = moveEvent => {
        const maxScroll = element.scrollHeight - element.clientHeight;
        const travel = rail.clientHeight - thumb.offsetHeight;
        if (maxScroll > 0 && travel > 0) element.scrollTop = startScroll + (moveEvent.clientY - startY) * maxScroll / travel;
      };
      thumb.addEventListener('pointermove', move);
      thumb.addEventListener('pointerup', () => thumb.removeEventListener('pointermove', move), { once: true });
    });
    update();
    requestAnimationFrame(update);
    requestAnimationFrame(() => requestAnimationFrame(update));
  }
}

initArtDecoScrollbars();

client.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT') void loadPublicWorkspace();
});
const { data: { session }, error } = await client.auth.getSession();
if (error) status(error.message, true);
else if (session) await loadWorkspace();
else await loadPublicWorkspace();
