import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.mjs';
import { createCommunityApi, resolveLegacyCardAuthors } from './community-api.mjs?v=tags-3';
import { renderCard, downloadCardPNG } from './card-renderer.mjs?v=patron-labels-1';
import { zipFiles } from './zip.mjs';
import { PATRONS, FACTION_VISIONS, PATRON_RULES_REVISION, updatePatronVision } from './patrons.mjs?v=faction-visions-2';
import { CARD_TAGS, normalizeCardTags, seedTagsForCard, tagLabel } from './card-tags.mjs?v=tags-3';
import { createPlayView } from './play.mjs?v=play-20';

document.title = ['127.0.0.1', 'localhost', '::1'].includes(window.location.hostname)
  ? 'Helianthe — Local Preview'
  : 'Helianthe';

const $ = selector => document.querySelector(selector);
const arrivedFromPasswordRecovery = new URLSearchParams(window.location.hash.slice(1)).get('type') === 'recovery';
if (!window.supabase?.createClient) throw new Error('The Supabase client could not be loaded.');
const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
const api = createCommunityApi(client);
const ADMIN_EMAIL = 'dominik.zielinski3@gmail.com';
let authMode = 'sign-in';
let recoveryPending = arrivedFromPasswordRecovery, authReady = false;
let profileSaveStatusTimer = null;
const state = { user: null, isAdmin: false, cards: [], decks: [], profiles: [], card: null, deck: null, profile: null, deckCards: [], deckPreviewCard: null, deckPreviewSerial: 0, deckPatronSerial: 0, artworkUrl: null, artworkLoading: false, artworkError: '', artworkSerial: 0, renderSerial: 0, authVersion: 0, realtimeChannel: null, cardFormDirty: false, cardAuthorEdited: false };
const play = createPlayView({ client, getUser: () => state.user, getDecks: () => state.decks, getProfiles: () => state.profiles, makeAvatar: avatarElement, requireSignIn: showSignIn });
let addToDeckCard = null;
let recentDeckCardAddition = null;
const ARTWORK_UPLOAD_LIMIT = 100 * 1024;
const AVATAR_UPLOAD_LIMIT = 80 * 1024;
const DECK_PATRONS_KEY = 'helianthe-deck-patrons';
const PATRON_CARD_OVERRIDES_KEY = 'helianthe-patron-card-overrides';
const DELETED_PATRON_CARDS_KEY = 'helianthe-deleted-patron-cards';
const PATRON_TERRAIN = { Flowbound: 'Flow', Brightworks: 'Radiance', Dreamwardens: 'Symbiosis', Verdant: 'Verdant' };
let patronCards = PATRONS.map(patron => ({
  id: `patron:${patron.name}`,
  title: patron.name,
  card_type: 'Patron',
  terrain: PATRON_TERRAIN[patron.faction],
  testing_status: 'draft',
  effect: [`Credo: “${patron.credo}”`, `Vision: ${patron.scoring}`, patron.ability ? `Ability: ${patron.ability}` : ''].filter(Boolean).join('\n\n'),
  author: 'El Delfin',
  author_ids: [],
  tags: seedTagsForCard(patron.name),
  patron,
}));
try {
  const overrides = JSON.parse(localStorage.getItem(PATRON_CARD_OVERRIDES_KEY) || '{}');
  let updated = false;
  for (const card of patronCards) {
    const override = overrides[card.id];
    if (override && override.rules_revision !== PATRON_RULES_REVISION) {
      override.effect = updatePatronVision(override.effect || card.effect, card.patron);
      override.rules_revision = PATRON_RULES_REVISION;
      updated = true;
    }
    Object.assign(card, override || {});
  }
  if (updated) localStorage.setItem(PATRON_CARD_OVERRIDES_KEY, JSON.stringify(overrides));
} catch {}
for (const text of document.querySelectorAll('[data-faction-vision]')) text.textContent = FACTION_VISIONS[text.dataset.factionVision];
try {
  const deletedPatrons = new Set(JSON.parse(localStorage.getItem(DELETED_PATRON_CARDS_KEY) || '[]'));
  patronCards = patronCards.filter(card => !deletedPatrons.has(card.id));
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
  if (patronPicker) syncPatronPicker($('#deck-form').elements.patron_name);
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
  if (!id) return 'El Delfin';
  return state.profiles.find(profile => profile.id === id)?.display_name || 'Player';
}

function availablePatrons() {
  const custom = state.cards.filter(card => card.card_type === 'Patron').map(card => ({ name: card.title, terrain: card.terrain }));
  const customNames = new Set(custom.map(patron => patron.name.toLowerCase()));
  return [...PATRONS.filter(patron => !customNames.has(patron.name.toLowerCase())), ...custom];
}

function patronCardByName(name) {
  return state.cards.find(card => card.card_type === 'Patron' && card.title.toLowerCase() === name?.toLowerCase())
    || patronCards.find(card => card.patron?.name === name);
}

function patronByName(name) {
  const normalized = String(name || '').trim().toLowerCase();
  if (!normalized) return null;
  return availablePatrons().find(patron => {
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

function patronPickerTerrain(patron) {
  if (!patron) return '';
  return patron.terrain || patronCardByName(patron.name)?.terrain || PATRON_TERRAIN[patron.faction] || '';
}

function refreshDeckPatronOptions() {
  const select = $('#deck-form').elements.patron_name;
  const selected = select.value;
  select.replaceChildren(new Option('No Patron', ''));
  for (const patron of availablePatrons()) select.append(new Option(patron.name, patron.name));
  select.value = selected;
  if (patronPicker) syncPatronPicker(select);
}

function patronPickerColor(patron) {
  if (!patron) return '';
  const dark = document.body.classList.contains('dark-mode');
  const colors = dark
    ? { Flow: '#77b8d1', Radiance: '#e0b65a', Symbiosis: '#bc91dc', Verdant: '#91c99e' }
    : { Flow: '#35758e', Radiance: '#a87318', Symbiosis: '#784997', Verdant: '#488057' };
  return colors[patronPickerTerrain(patron)] || '';
}

let patronPicker = null;
function syncPatronPicker(select) {
  if (!patronPicker) {
    const wrapper = document.createElement('span');
    wrapper.className = 'patron-picker';
    select.before(wrapper);
    wrapper.append(select);
    select.classList.add('patron-select-native');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'patron-picker-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    const menu = document.createElement('span');
    menu.className = 'patron-picker-menu';
    menu.setAttribute('role', 'listbox');
    menu.hidden = true;
    wrapper.append(trigger, menu);
    patronPicker = { trigger, menu };
    const close = () => { menu.hidden = true; trigger.setAttribute('aria-expanded', 'false'); };
    const open = () => { menu.hidden = false; trigger.setAttribute('aria-expanded', 'true'); };
    trigger.addEventListener('click', () => menu.hidden ? open() : close());
    trigger.addEventListener('keydown', event => {
      if (event.key === 'Escape') { close(); return; }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      open();
      const options = [...menu.querySelectorAll('button')];
      (event.key === 'ArrowUp' ? options.at(-1) : options[0])?.focus();
    });
    menu.addEventListener('keydown', event => {
      const options = [...menu.querySelectorAll('button')];
      const index = options.indexOf(document.activeElement);
      if (event.key === 'Escape') { event.preventDefault(); close(); trigger.focus(); }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        options[(index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length]?.focus();
      }
    });
    document.addEventListener('click', event => { if (!wrapper.contains(event.target)) close(); });
    wrapper.addEventListener('focusout', event => { if (!wrapper.contains(event.relatedTarget)) close(); });
  }
  const { trigger, menu } = patronPicker;
  const selected = patronByName(select.value);
  trigger.replaceChildren();
  trigger.className = `patron-picker-trigger${selected ? ` is-patron patron-picker-terrain-${patronPickerTerrain(selected).toLowerCase()}` : ''}`;
  trigger.style.color = patronPickerColor(selected);
  if (selected) {
    const icon = document.createElement('span');
    icon.className = 'patron-picker-icon';
    icon.setAttribute('aria-hidden', 'true');
    trigger.append(icon);
  }
  const selectedName = document.createElement('span');
  selectedName.className = 'patron-picker-name';
  selectedName.textContent = selected?.name || 'No Patron';
  selectedName.style.color = patronPickerColor(selected);
  trigger.append(selectedName);
  trigger.setAttribute('aria-label', `Patron: ${selected?.name || 'No Patron'}`);
  trigger.disabled = select.disabled;
  menu.replaceChildren();
  for (const patron of [null, ...availablePatrons()]) {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = `patron-picker-option${patron ? ` is-patron patron-picker-terrain-${patronPickerTerrain(patron).toLowerCase()}` : ''}`;
    option.style.color = patronPickerColor(patron);
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', String((patron?.name || '') === select.value));
    if (patron) {
      const icon = document.createElement('span');
      icon.className = 'patron-picker-icon';
      icon.setAttribute('aria-hidden', 'true');
      option.append(icon);
    }
    const name = document.createElement('span');
    name.className = 'patron-picker-name';
    name.textContent = patron?.name || 'No Patron';
    name.style.color = patronPickerColor(patron);
    option.append(name);
    option.addEventListener('click', () => {
      select.value = patron?.name || '';
      menu.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      syncPatronPicker(select);
      trigger.focus();
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    menu.append(option);
  }
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
const deckCoverArtworkUrls = new Map();

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
      void getArtworkUrl(profile.avatar_id).then(url => {
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
  const previewCard = { ...card, author: cardAuthorText(card) };
  await renderCard(canvas, previewCard, '', () => serial === favoritePreviewSerial).catch(() => {});
  if (serial !== favoritePreviewSerial || !card.artwork_id) return;
  try {
    const artworkUrl = await getArtworkUrl(card.artwork_id);
    if (serial !== favoritePreviewSerial) return;
    await renderCard(canvas, previewCard, artworkUrl, () => serial === favoritePreviewSerial);
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
  trigger.className = 'favorite-card-trigger action-choose';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  const menu = document.createElement('div');
  menu.className = 'favorite-card-menu';
  menu.setAttribute('role', 'listbox');
  menu.hidden = true;
  wrapper.append(trigger, menu);
  initArtDecoScrollbars();
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
    option.className = card ? 'favorite-card-option' : 'favorite-card-option action-choose';
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

function cardAuthorNames(card) {
  if (card.author) return card.author.split(',').map(name => name.trim()).filter(Boolean);
  const names = authorNames(card.author_ids);
  if (names.length) return names;
  return authorNames([], card.owner_id);
}

function cardAuthorText(card) {
  return cardAuthorNames(card).join(', ');
}

function initialCardAuthorIds(card) {
  if (!card) return [state.user?.id].filter(Boolean);
  if (card.author) {
    const names = cardAuthorNames(card);
    const ids = names.map(name => state.profiles.find(profile => (profile.display_name || '').trim().toLocaleLowerCase() === name.toLocaleLowerCase())?.id);
    return ids.every(Boolean) ? ids : [];
  }
  if (card.author_ids?.length) return card.author_ids;
  return [card.owner_id].filter(Boolean);
}

function renderAuthorOptions(container, selectedIds, originalAuthor = '') {
  container.replaceChildren();
  if (originalAuthor && !selectedIds.length) {
    const current = document.createElement('p');
    current.className = 'form-hint';
    current.textContent = `Current author: ${originalAuthor}`;
    container.append(current);
  }
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
  const icon = document.createElement('span');
  icon.className = `card-type-icon card-kind-icon kind-${card.card_type.toLowerCase()} ${terrainClass(card.terrain)}`;
  icon.title = card.card_type;
  return icon;
}

function eventIconColor(terrain) {
  return {
    Symbiosis: '#784997', Flow: '#35758e', Verdant: '#488057', Radiance: '#b88425',
  }[terrain] || '#909592';
}

function terrainClass(terrain) {
  return ['Symbiosis', 'Flow', 'Verdant', 'Radiance'].includes(terrain) ? `terrain-${terrain.toLowerCase()}` : 'terrain-event';
}

function cardListIcons(card) {
  const icons = document.createElement('span');
  icons.className = 'card-list-icons';
  const faction = document.createElement('span');
  faction.className = `card-faction-icon ${terrainClass(card.terrain)}`;
  faction.title = card.terrain || 'No Terrain';
  faction.setAttribute('aria-hidden', 'true');
  const type = document.createElement('span');
  type.className = `card-kind-icon kind-${card.card_type.toLowerCase()} ${terrainClass(card.terrain)}`;
  type.title = card.card_type;
  type.setAttribute('aria-hidden', 'true');
  icons.append(faction, type);
  return icons;
}

function button(label, action, className = '') {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.className = className;
  element.addEventListener('click', action);
  return element;
}

const TAB_NAMES = ['about', 'rules', 'factions', 'glossary', 'cards', 'decks', 'play', 'profiles'];
const ABOUT_TAB_NAMES = ['about', 'rules', 'factions', 'glossary'];
function requestedTab() {
  const name = window.location.hash.slice(1).toLowerCase() || (new URL(location.href).searchParams.has('room') ? 'play' : 'about');
  if (name === 'patrons') return 'cards';
  if (name === 'rules-glossary') return 'glossary';
  return TAB_NAMES.includes(name) ? name : 'about';
}

function showTab(name, { updateUrl = true } = {}) {
  if (!TAB_NAMES.includes(name)) name = 'about';
  if (name === 'decks' && state.deck) void selectDeck(null);
  closeMobileMenu();
  if (name !== 'decks') closeDeckCardPreview();
  for (const tab of TAB_NAMES) {
    $(`#${tab}-view`).hidden = tab !== name;
  }
  const inAbout = ABOUT_TAB_NAMES.includes(name);
  $('#about-section').hidden = !inAbout;
  const primaryTab = inAbout ? 'about' : name;
  for (const tab of $('#tabs').querySelectorAll('[data-tab]')) {
    const active = tab.dataset.tab === primaryTab;
    tab.classList.toggle('active', active);
    if (active) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  for (const tab of document.querySelectorAll('[data-about-tab]')) {
    const active = tab.dataset.aboutTab === name;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
  }
  $('.about-content').scrollTop = 0;
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  if (updateUrl && window.location.hash !== `#${name}`) window.history.replaceState(null, '', `#${name}`);
  play.setVisible(name === 'play');
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
  const authors = [...new Set([
    ...patronCards.flatMap(cardAuthorNames),
    ...state.profiles.map(profile => profile.display_name || ownerName(profile.id)),
    ...state.cards.flatMap(cardAuthorNames),
  ].filter(Boolean))].sort((a, b) => a.localeCompare(b));
  for (const select of [$('#card-filter-author'), $('#deck-card-filter-author')]) {
    const current = select.value;
    select.replaceChildren(new Option('All Authors', ''));
    for (const author of authors) select.append(new Option(author, author));
    select.value = authors.includes(current) ? current : '';
  }
}

function initializeFilterTiles(groupId, values, kind, render) {
  const tiles = $(`#${groupId} .filter-icon-tiles`);
  for (const value of values) {
    const label = value === 'none' ? 'Nomads' : value;
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'filter-icon-tile';
    tile.dataset.value = value;
    tile.dataset.kind = kind;
    tile.setAttribute('aria-label', label);
    tile.setAttribute('aria-pressed', 'false');
    tile.title = label;
    const icon = document.createElement('span');
    icon.className = kind === 'type'
      ? `card-kind-icon kind-${value.toLowerCase()} terrain-event`
      : `card-faction-icon ${terrainClass(value === 'none' ? '' : value)}`;
    icon.setAttribute('aria-hidden', 'true');
    tile.append(icon);
    tile.addEventListener('click', () => {
      tile.setAttribute('aria-pressed', String(tile.getAttribute('aria-pressed') !== 'true'));
      render();
    });
    tiles.append(tile);
  }
}

function selectedFilterValues(groupId) {
  return new Set([...$(`#${groupId}`).querySelectorAll('.filter-icon-tile[aria-pressed="true"]')].map(tile => tile.dataset.value));
}

function clearFilterTiles(groupId) {
  for (const tile of $(`#${groupId}`).querySelectorAll('.filter-icon-tile')) tile.setAttribute('aria-pressed', 'false');
}

function cardTags(card) {
  return Array.isArray(card?.tags) ? card.tags : [];
}

function selectedTagFilters(groupId) {
  return new Set([...$(`#${groupId}`).querySelectorAll('.tag-filter-option[aria-pressed="true"]')].map(button => button.dataset.tag));
}

function clearTagFilters(groupId) {
  for (const button of $(`#${groupId}`).querySelectorAll('.tag-filter-option')) button.setAttribute('aria-pressed', 'false');
}

function renderTagFilters(groupId, cards, render) {
  const options = $(`#${groupId} .tag-filter-options`);
  const selected = selectedTagFilters(groupId);
  const tags = [...new Set(cards.flatMap(cardTags))].sort((a, b) => tagLabel(a).localeCompare(tagLabel(b)));
  options.replaceChildren();
  if (!tags.length) {
    const empty = document.createElement('span');
    empty.className = 'tag-filter-empty';
    empty.textContent = 'No tags yet';
    options.append(empty);
    return;
  }
  for (const tag of tags) {
    const tile = button(tagLabel(tag), () => {
      tile.setAttribute('aria-pressed', String(tile.getAttribute('aria-pressed') !== 'true'));
      render();
    }, 'tag-filter-option');
    tile.dataset.tag = tag;
    tile.setAttribute('aria-pressed', String(selected.has(tag)));
    options.append(tile);
  }
}

function matchesCardTags(card, selected) {
  return [...selected].every(tag => cardTags(card).includes(tag));
}

function renderCardTags(card) {
  const tags = $('#card-tags');
  tags.replaceChildren();
  if (!cardTags(card).length) tags.textContent = 'No tags';
  else for (const tag of cardTags(card)) {
    const chip = document.createElement('span');
    chip.className = 'card-tag';
    chip.textContent = tagLabel(tag);
    tags.append(chip);
  }
  $('#edit-card-tags').disabled = !card || !canEditCard(card);
}

function matchesCardTerrainFilter(card, terrains) {
  return !terrains.size || terrains.has(card.terrain || 'none');
}

function cardTestingStatusLabel(status) {
  return status === 'ready' ? 'Ready' : 'Draft';
}

const pendingStatusUpdates = new Set();

function updateTestingStatusButton(selector, card, hideWhenEmpty = false) {
  const button = $(selector);
  const ready = card?.testing_status === 'ready';
  button.parentElement.hidden = hideWhenEmpty && !card;
  button.querySelector('.card-status-state').textContent = ready ? 'Ready' : 'Draft';
  button.setAttribute('aria-label', `Status: ${ready ? 'Ready' : 'Draft'}`);
  button.setAttribute('aria-pressed', String(ready));
  button.dataset.status = ready ? 'ready' : 'draft';
  button.disabled = !card || !canEditCard(card) || pendingStatusUpdates.has(card.id);
}

async function toggleCardTestingStatus(card) {
  if (!card || pendingStatusUpdates.has(card.id) || !requireCardEdit(card)) return;
  const nextStatus = card.testing_status === 'ready' ? 'draft' : 'ready';
  pendingStatusUpdates.add(card.id);
  for (const selector of ['#card-test-status', '#deck-card-test-status', '#deck-patron-test-status']) {
    const shownCard = selector === '#card-test-status' ? state.card : selector === '#deck-card-test-status' ? state.deckPreviewCard : patronCardByName(patronByName(state.deck?.patron_name)?.name);
    if (shownCard?.id === card.id) $(selector).disabled = true;
  }
  try {
    if (card.patron) {
      const overrides = JSON.parse(localStorage.getItem(PATRON_CARD_OVERRIDES_KEY) || '{}');
      overrides[card.id] = { ...(overrides[card.id] || {}), testing_status: nextStatus };
      localStorage.setItem(PATRON_CARD_OVERRIDES_KEY, JSON.stringify(overrides));
    } else await api.saveCardStatus(state.user.id, card.id, nextStatus);
    for (const item of [...state.cards, ...patronCards, state.card, state.deckPreviewCard]) {
      if (item?.id === card.id) item.testing_status = nextStatus;
    }
    if (state.card?.id === card.id) $('#card-form').elements.testing_status.value = nextStatus;
    renderCardList();
    renderDeckCards();
    status(`Status set to ${cardTestingStatusLabel(nextStatus)}.`);
  } catch (cause) { status(cause.message, true); }
  finally {
    pendingStatusUpdates.delete(card.id);
    updateTestingStatusButton('#card-test-status', state.card);
    updateTestingStatusButton('#deck-card-test-status', state.deckPreviewCard, true);
    updateTestingStatusButton('#deck-patron-test-status', patronCardByName(patronByName(state.deck?.patron_name)?.name), true);
  }
}

function selectCardFromList(card) {
  if (state.card === card) {
    $('#cards-view').classList.add('mobile-editor-open');
    document.body.classList.add('mobile-editor-visible');
    return;
  }
  selectCard(card, { openMobile: true });
}

function syncSelectedCardRow(cardId) {
  const list = $('#card-list');
  list.querySelector('.card-list-item.selected')?.classList.remove('selected');
  if (cardId != null) [...list.children].find(row => row.dataset.cardId === String(cardId))?.classList.add('selected');
}

function renderCardList() {
  const query = $('#card-search').value.trim().toLocaleLowerCase();
  const types = selectedFilterValues('card-filter-type');
  const testingStatus = $('#card-filter-status').value;
  const author = $('#card-filter-author').value;
  const terrains = selectedFilterValues('card-filter-terrain');
  const list = $('#card-list');
  list.replaceChildren();
  const allCards = [...state.cards, ...patronCards];
  renderTagFilters('card-filter-tags', allCards, renderCardList);
  const selectedTags = selectedTagFilters('card-filter-tags');
  renderCollectionSummary(allCards);
  for (const card of allCards.sort((a, b) => a.title.localeCompare(b.title)).filter(item => {
    const matchesSearch = item.title.toLocaleLowerCase().includes(query);
    const matchesType = !types.size || types.has(item.card_type);
    const matchesStatus = !testingStatus || (item.testing_status === 'ready' ? 'ready' : 'draft') === testingStatus;
    const matchesAuthor = !author || cardAuthorNames(item).includes(author);
    const matchesTerrain = matchesCardTerrainFilter(item, terrains);
    return matchesSearch && matchesType && matchesStatus && matchesAuthor && matchesTerrain && matchesCardTags(item, selectedTags);
  })) {
    const row = button('', () => selectCardFromList(card), `card-list-item${state.card?.id === card.id ? ' selected' : ''}`);
    row.dataset.cardId = card.id;
    row.setAttribute('aria-label', `${card.terrain || 'Neutral'} ${card.card_type}: ${card.title}, ${cardTestingStatusLabel(card.testing_status)}`);
    if (card.artwork_id) {
      const preloadArtwork = () => { void getArtworkUrl(card.artwork_id).catch(() => {}); };
      row.addEventListener('pointerenter', preloadArtwork, { once: true });
      row.addEventListener('focus', preloadArtwork, { once: true });
    }
    const title = document.createElement('span');
    title.className = `card-list-title ${terrainClass(card.terrain)}`;
    title.textContent = card.title;
    row.append(cardListIcons(card), title);
    const testingStatus = document.createElement('span');
    testingStatus.className = `card-testing-status${card.testing_status === 'ready' ? ' ready' : ''}`;
    testingStatus.textContent = card.testing_status === 'ready' ? 'Ready' : 'Draft';
    row.append(testingStatus);
    const meta = document.createElement('small');
    meta.className = 'card-list-owner';
    const authorIds = initialCardAuthorIds(card);
    if (authorIds.length) meta.append(authorDisplayElement(authorIds));
    else meta.textContent = cardAuthorText(card);
    row.append(meta);
    list.append(row);
  }
  if (!list.childElementCount) list.textContent = 'No cards found.';
}

function scrollToCardRow(cardId) {
  requestAnimationFrame(() => {
    const list = $('#card-list');
    const row = [...list.children].find(item => item.dataset.cardId === String(cardId));
    if (!row) return;
    const distance = row.getBoundingClientRect().top - list.getBoundingClientRect().top;
    list.scrollTo({ top: list.scrollTop + distance - (list.clientHeight - row.clientHeight) / 2, behavior: 'smooth' });
  });
}

function navigateCardList(direction) {
  const list = $('#card-list');
  const rows = [...list.children].filter(row => row.dataset.cardId);
  if (!rows.length) return;
  const currentIndex = rows.findIndex(row => row.dataset.cardId === String(state.card?.id));
  const nextIndex = currentIndex < 0 ? (direction > 0 ? 0 : rows.length - 1) : currentIndex + direction;
  const nextRow = rows[nextIndex];
  if (!nextRow) return;
  const card = [...state.cards, ...patronCards].find(item => String(item.id) === nextRow.dataset.cardId);
  if (!card) return;
  const focusList = list.contains(document.activeElement);
  selectCardFromList(card);
  if (focusList) [...list.children].find(row => row.dataset.cardId === String(card.id))?.focus();
  scrollToCardRow(card.id);
}

function setCardFormEditable(canEdit) {
  for (const field of $('#card-form').querySelectorAll('input,select,textarea,button')) field.disabled = !canEdit;
}

function canEditCard(card) {
  if (!state.user) return false;
  if (!card) return true;
  return state.isAdmin || card.author_ids?.includes(state.user.id);
}

function closeCardEditDenied() {
  $('#card-edit-denied-modal').hidden = true;
  document.body.classList.remove('auth-modal-open');
}

function requireCardEdit(card) {
  if (!card) return false;
  if (!state.user) return requireAccount();
  if (canEditCard(card)) return true;
  $('#card-edit-denied-modal').hidden = false;
  document.body.classList.add('auth-modal-open');
  $('#confirm-card-edit-denied').focus();
  return false;
}

function canEditDeck(deck) {
  return Boolean(state.user && deck && (deck.owner_id === state.user.id || state.isAdmin));
}

function updateAddToDeckButtons(card) {
  const isPatron = Boolean(card?.patron);
  const disabled = !state.user || !card || isPatron || !state.decks.some(deck => state.isAdmin || deck.owner_id === state.user.id);
  for (const id of ['add-to-deck', 'deck-add-to-deck', 'patron-add-to-deck']) {
    $(`#${id}`).hidden = id !== 'add-to-deck' || isPatron;
    $(`#${id}`).disabled = disabled;
  }
}

function openAddToDeckModal(card) {
  if (!card || card.patron || !requireAccount()) return;
  const decks = state.decks.filter(deck => state.isAdmin || deck.owner_id === state.user.id);
  if (!decks.length) return status('Create a deck before adding cards.', true);
  addToDeckCard = card;
  $('#add-to-deck-title').textContent = `Add ${card.title} to Deck`;
  const select = $('#add-to-deck-select');
  select.replaceChildren(...decks.map(deck => new Option(deck.name, deck.id)));
  $('#add-to-deck-modal').hidden = false;
  document.body.classList.add('auth-modal-open');
  select.focus();
}

function closeAddToDeckModal() {
  addToDeckCard = null;
  $('#add-to-deck-modal').hidden = true;
  document.body.classList.remove('auth-modal-open');
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
  const requestingReset = mode === 'reset-request';
  const settingPassword = mode === 'new-password';
  const form = $('#auth-modal-form');
  $('#auth-modal-title').textContent = signingUp ? 'Create your Helianthe account' : requestingReset ? 'Reset your password' : settingPassword ? 'Choose a new password' : 'Sign in to Helianthe';
  $('#auth-modal-description').textContent = signingUp ? 'Create your profile and choose the card that represents you best.'
    : requestingReset ? 'Enter your email address and we will send you a recovery link.'
    : settingPassword ? 'Enter and confirm your new password.' : 'Sign in to create cards and build your own decks.';
  $('#sign-up-fields').hidden = !signingUp;
  form.elements.email.closest('label').hidden = settingPassword;
  form.elements.password.closest('label').hidden = requestingReset;
  form.elements.email.required = !settingPassword;
  form.elements.password.required = !requestingReset;
  $('#auth-confirm-password-field').hidden = !settingPassword;
  form.elements.confirm_password.required = settingPassword;
  form.elements.display_name.required = signingUp;
  form.elements.favorite_card_id.required = signingUp;
  form.elements.password.autocomplete = signingUp || settingPassword ? 'new-password' : 'current-password';
  $('#auth-submit').textContent = signingUp ? 'Create account' : requestingReset ? 'Send recovery link' : settingPassword ? 'Save new password' : 'Sign in';
  $('#auth-mode-toggle').textContent = signingUp || requestingReset ? 'Back to sign in' : 'Create account';
  $('#auth-mode-toggle').hidden = settingPassword;
  $('#auth-forgot').hidden = mode !== 'sign-in';
  if (signingUp) populateFavoriteCards(form.elements.favorite_card_id, form.elements.favorite_card_id.value);
  showAuthMessage('');
}

function showSignUp() {
  if ($('#auth-modal').hidden) showSignIn();
  setAuthMode('sign-up');
  $('#auth-modal-form').elements.email.focus();
}

function showResetRequest() {
  if ($('#auth-modal').hidden) showSignIn();
  setAuthMode('reset-request');
  $('#auth-modal-form').elements.email.focus();
}

function showNewPassword() {
  $('#auth-modal').hidden = false;
  setAuthMode('new-password');
  document.body.classList.add('auth-modal-open');
  $('#auth-modal-form').elements.password.value = '';
  $('#auth-modal-form').elements.confirm_password.value = '';
  $('#auth-modal-form').elements.password.focus();
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
  const required = ['Entity', 'Patron'].includes(form.elements.card_type.value);
  form.elements.terrain.required = required;
  if (required && !form.elements.terrain.value) form.elements.terrain.value = 'Symbiosis';
}

function releaseArtwork() {
  state.artworkUrl = null;
}

const artworkUrlCache = new Map();
const artworkRequests = new Map();
function getArtworkUrl(artworkId) {
  if (artworkUrlCache.has(artworkId)) return Promise.resolve(artworkUrlCache.get(artworkId));
  if (!artworkRequests.has(artworkId)) {
    const request = api.fetchArtwork(artworkId).then(blob => {
      if (artworkUrlCache.has(artworkId)) return artworkUrlCache.get(artworkId);
      const url = URL.createObjectURL(blob);
      artworkUrlCache.set(artworkId, url);
      return url;
    }).finally(() => artworkRequests.delete(artworkId));
    artworkRequests.set(artworkId, request);
  }
  return artworkRequests.get(artworkId);
}

async function showArtwork(card) {
  const serial = ++state.artworkSerial;
  releaseArtwork();
  state.artworkError = '';
  state.artworkLoading = Boolean(card?.artwork_id);
  if (!card?.artwork_id) {
    renderPreview();
    return;
  }
  const cachedUrl = artworkUrlCache.get(card.artwork_id);
  if (cachedUrl) {
    state.artworkUrl = cachedUrl;
    state.artworkLoading = false;
    renderPreview();
    return;
  }
  renderPreview();
  try {
    const artworkUrl = await getArtworkUrl(card.artwork_id);
    if (serial !== state.artworkSerial) return;
    state.artworkUrl = artworkUrl;
  } catch {
    if (serial !== state.artworkSerial) return;
    state.artworkError = 'Artwork could not be loaded. The image storage may be temporarily unavailable.';
  }
  if (serial !== state.artworkSerial) return;
  state.artworkLoading = false;
  renderPreview();
}

function renderPreview() {
  const form = $('#card-form');
  const serial = ++state.renderSerial;
  const skipArtwork = state.artworkLoading || Boolean(state.artworkError);
  const card = {
    title: form.elements.title.value,
    card_type: form.elements.card_type.value,
    terrain: form.elements.terrain.value,
    effect: form.elements.effect.value,
    author: state.card && !state.cardAuthorEdited ? cardAuthorText(state.card) : authorNames(selectedAuthorIds($('#card-author-options'))).join(', '),
  };
  const downloadButton = $('#download-png');
  downloadButton.classList.toggle('is-rendering', !downloadButton.disabled || downloadButton.classList.contains('is-rendering'));
  downloadButton.disabled = true;
  void renderCard($('#card-canvas'), card, state.artworkUrl || '', () => serial === state.renderSerial, { skipArtwork })
    .then(result => {
      if (serial !== state.renderSerial || result.cancelled) return;
      $('#preview-note').textContent = state.artworkLoading ? 'Loading artwork…' : state.artworkError || (result.clipped ? 'Text is too long — shorten the effect before exporting.' : '');
      downloadButton.classList.remove('is-rendering');
      downloadButton.disabled = skipArtwork || result.clipped;
      $('#delete-card').disabled = !state.card || !state.user || (!state.card.patron && state.card.owner_id !== state.user.id && !state.isAdmin);
    })
    .catch(cause => {
      if (serial !== state.renderSerial) return;
      downloadButton.classList.remove('is-rendering');
      $('#preview-note').textContent = cause.message;
    });
}

let cardFieldArtworkFile = null;
let cardFieldReturnFocus = null;

function closeCardField() {
  $('#card-field-modal').hidden = true;
  $('#card-field-content').replaceChildren();
  $('#card-field-status').hidden = true;
  cardFieldArtworkFile = null;
  const focusTarget = cardFieldReturnFocus?.isConnected && cardFieldReturnFocus.getClientRects().length
    ? cardFieldReturnFocus : $('#card-canvas');
  cardFieldReturnFocus = null;
  focusTarget.focus({ preventScroll: true });
}

function openCardField(field) {
  if (!requireCardEdit(state.card)) return;
  cardFieldReturnFocus = document.activeElement;
  const form = $('#card-form');
  const sources = {
    title: form.elements.title.closest('label'),
    type: form.elements.card_type.closest('label'),
    terrain: form.elements.terrain.closest('label'),
    status: form.elements.testing_status.closest('label'),
    artwork: $('#card-artwork').closest('label'),
    effect: form.elements.effect.closest('label'),
    tags: form.elements.tags.closest('label'),
    authors: $('#card-author-options').closest('fieldset'),
  };
  const titles = { title: 'Edit title', type: 'Edit card type', terrain: 'Edit Terrain', status: 'Status', artwork: 'Choose artwork', effect: 'Edit effect', tags: 'Edit tags', authors: 'Edit Author' };
  const source = sources[field];
  if (!source) return;
  cardFieldArtworkFile = null;
  const content = $('#card-field-content');
  $('#card-field-status').hidden = true;
  content.replaceChildren(source.cloneNode(true));
  if (field === 'authors') {
    content.replaceChildren();
    const label = document.createElement('label');
    label.textContent = 'Author';
    const select = document.createElement('select');
    if (state.card?.author && !selectedAuthorIds($('#card-author-options')).length) {
      select.append(new Option(`Keep current author: ${state.card.author}`, ''));
    }
    for (const profile of state.profiles) select.append(new Option(profile.display_name || ownerName(profile.id), profile.id));
    select.value = selectedAuthorIds($('#card-author-options'))[0] || '';
    label.append(select);
    content.append(label);
  }
  if (field === 'artwork') {
    const hint = document.createElement('p');
    hint.className = 'form-hint';
    hint.textContent = 'Artwork is automatically compressed to 100 KB before upload. Source files can be up to 20 MB.';
    content.append(hint);
  }
  if (field === 'tags') {
    const fieldset = document.createElement('fieldset');
    fieldset.className = 'tag-picker';
    const legend = document.createElement('legend');
    legend.textContent = 'Choose tags';
    fieldset.append(legend);
    const selected = new Set(form.elements.tags.value.split(',').map(tag => tag.trim()).filter(Boolean));
    for (const [id, label, description] of CARD_TAGS) {
      const option = document.createElement('label');
      option.className = 'tag-picker-option';
      option.title = description;
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.name = 'card-tag';
      checkbox.value = id;
      checkbox.checked = selected.has(id);
      const text = document.createElement('span');
      text.textContent = label;
      option.append(checkbox, text);
      fieldset.append(option);
    }
    content.replaceChildren(fieldset);
    const hint = document.createElement('p');
    hint.className = 'form-hint';
    hint.textContent = 'Choose up to 12 tags. Tags describe card effects and do not change game rules.';
    content.append(hint);
  }
  $('#card-field-title').textContent = titles[field];
  const copies = content.querySelectorAll('input, select, textarea');
  for (const [index, original] of (['authors', 'tags'].includes(field) ? [] : [...source.querySelectorAll('input, select, textarea')]).entries()) {
    const copy = copies[index];
    if (!copy) continue;
    if (copy.type === 'checkbox') copy.checked = original.checked;
    else if (copy.type !== 'file') copy.value = original.value;
    copy.removeAttribute('id');
    if (copy.type === 'file') copy.addEventListener('change', () => { cardFieldArtworkFile = copy.files?.[0] || null; });
  }
  const terrainCopy = content.querySelector('[name="terrain"]');
  if (terrainCopy) {
    terrainCopy.disabled = form.elements.terrain.disabled;
    terrainCopy.value = form.elements.terrain.value;
  }
  if (field === 'artwork') {
    const fileInput = content.querySelector('input[type="file"]');
    fileInput.classList.add('artwork-file-input');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'artwork-file-button action-choose';
    button.textContent = 'Choose File';
    button.addEventListener('click', () => fileInput.click());
    const filename = document.createElement('span');
    filename.className = 'artwork-file-name';
    filename.textContent = 'No file chosen';
    fileInput.addEventListener('change', () => { filename.textContent = fileInput.files?.[0]?.name || 'No file chosen'; });
    fileInput.closest('label').after(button, filename);
  }
  $('#card-field-modal').hidden = false;
  (field === 'artwork' ? content.querySelector('.artwork-file-button') : content.querySelector('input:not([type="checkbox"]), select, textarea, input[type="checkbox"]'))?.focus();
}

function cardFieldAt(event) {
  const box = event.currentTarget.getBoundingClientRect();
  const x = (event.clientX - box.left) * 750 / box.width;
  const y = (event.clientY - box.top) * 1050 / box.height;
  if (y < 200 && (x < 145 || x > 605)) return y < 130 ? 'type' : 'terrain';
  if (y < 200) return 'title';
  if (y < 640) return 'artwork';
  if (y < 940) return 'effect';
  return 'authors';
}

function selectCard(card, { openMobile = false } = {}) {
  if (!$('#card-field-modal').hidden) closeCardField();
  ++state.artworkSerial;
  ++state.renderSerial;
  releaseArtwork();
  $('#download-png').disabled = true;
  state.card = card;
  updateAddToDeckButtons(card);
  state.cardFormDirty = false;
  state.cardAuthorEdited = false;
  const form = $('#card-form');
  form.reset();
  form.elements.title.value = card?.title || '';
  form.elements.card_type.value = card?.card_type || 'Entity';
  form.elements.terrain.value = card?.terrain || (card?.card_type === 'Event' ? '' : 'Symbiosis');
  form.elements.testing_status.value = card?.testing_status === 'ready' ? 'ready' : 'draft';
  form.elements.effect.value = card?.effect || '';
  form.elements.tags.value = cardTags(card).join(', ');
  renderCardTags(card);
  updateTestingStatusButton('#card-test-status', card);
  renderAuthorOptions($('#card-author-options'), initialCardAuthorIds(card), card?.author);
  $('#card-heading').textContent = card?.title || 'New card';
  $('#card-edit-hint').hidden = !state.user;
  setCardFormEditable(canEditCard(card));
  syncTerrain();
  void showArtwork(card);
  syncSelectedCardRow(card?.id);
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
  placeDeckPreviewEditHint();
}

function closeDeckCardPreview() {
  $('#decks-view')?.classList.remove('mobile-card-preview-open');
  document.body.classList.remove('mobile-card-preview-visible');
  placeDeckPreviewEditHint();
}

function placeDeckPreviewEditHint() {
  const hint = $('#deck-preview-edit-hint');
  if (!window.matchMedia('(max-width: 850px)').matches) $('.deck-card-layout').append(hint);
  else if ($('#decks-view').classList.contains('mobile-card-preview-open')) $('.deck-card-preview-shell .deck-preview-actions').before(hint);
  else $('.deck-patron-preview-shell .deck-preview-actions').before(hint);
}

function updateDeckPreviewEditHint() {
  $('#deck-preview-edit-hint').hidden = !state.deck || !state.user || (!state.deckPreviewCard && !patronCardByName(patronByName(state.deck.patron_name)?.name));
}

window.addEventListener('resize', placeDeckPreviewEditHint);

function renderDeckList() {
  const list = $('#deck-list');
  list.replaceChildren();
  const userId = state.user?.id;
  const authoredByCurrentUser = deck => (deck.author_ids?.length ? deck.author_ids : [deck.owner_id]).includes(userId);
  const sections = userId
    ? [
        ['My Decks', state.decks.filter(authoredByCurrentUser)],
        ['Other Decks', state.decks.filter(deck => !authoredByCurrentUser(deck))],
      ]
    : [['All Decks', state.decks]];
  for (const [heading, decks] of sections) {
    const section = document.createElement('section');
    section.className = 'deck-gallery-section';
    section.setAttribute('aria-label', heading);
    const title = document.createElement('h2');
    title.textContent = heading;
    const tiles = document.createElement('div');
    tiles.className = 'deck-gallery-tiles';
    section.append(title, tiles);
    list.append(section);
    if (!decks.length) {
      const empty = document.createElement('p');
      empty.className = 'deck-gallery-empty';
      empty.textContent = heading === 'My Decks' ? 'You have no decks yet.' : heading === 'Other Decks' ? 'No other decks yet.' : 'No decks yet.';
      tiles.append(empty);
    }
    for (const deck of decks) {
    const row = button('', () => void selectDeck(deck), `deck-list-item${state.deck?.id === deck.id ? ' selected' : ''}`);
    const cover = document.createElement('span');
    cover.className = 'deck-tile-cover';
    cover.setAttribute('aria-hidden', 'true');
    const image = document.createElement('img');
    image.alt = '';
    image.src = deckCoverArtworkUrls.get(deck.cover_artwork_id) || './assets/site-background.jpg';
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
    tiles.append(row);
    if (deck.cover_artwork_id && !deckCoverArtworkUrls.has(deck.cover_artwork_id)) {
      void getArtworkUrl(deck.cover_artwork_id).then(url => {
        deckCoverArtworkUrls.set(deck.cover_artwork_id, url);
        if (image.isConnected) image.src = url;
      }).catch(() => {});
    }
  }
  }
}

function renderDeckHeader() {
  const deck = state.deck;
  $('#deck-detail-name').textContent = deck?.name || '';
  const author = $('#deck-detail-author');
  author.replaceChildren();
  if (deck) author.append(authorDisplayElement(deck.author_ids, deck.owner_id));
  const image = $('#deck-detail-cover-image');
  image.src = deckCoverArtworkUrls.get(deck?.cover_artwork_id) || './assets/site-background.jpg';
  if (deck?.cover_artwork_id && !deckCoverArtworkUrls.has(deck.cover_artwork_id)) {
    const artworkId = deck.cover_artwork_id;
    void getArtworkUrl(artworkId).then(url => {
      deckCoverArtworkUrls.set(artworkId, url);
      if (state.deck?.cover_artwork_id === artworkId) image.src = url;
    }).catch(() => {});
  }
}

const deckCopyUpdates = new Map();
function hasPendingDeckCopyChanges(deckId) {
  return [...deckCopyUpdates.keys()].some(key => key.startsWith(`${deckId}:`));
}

function selectDeckCardFromList(card) {
  if (state.deckPreviewCard === card) {
    openDeckCardPreview();
    return;
  }
  void showDeckCardPreview(card);
}

function renderDeckCards() {
  const list = $('#deck-cards');
  list.replaceChildren();
  if (!state.deck) { renderDeckSummary(); return; }
  const types = selectedFilterValues('deck-card-filter-type');
  const statusFilter = $('#deck-card-filter-status').value;
  const author = $('#deck-card-filter-author').value;
  const terrains = selectedFilterValues('deck-card-filter-terrain');
  const deckCards = state.cards.filter(card => state.deckCards.some(item => item.card_id === card.id && item.copies > 0));
  renderTagFilters('deck-card-filter-tags', deckCards, renderDeckCards);
  const selectedTags = selectedTagFilters('deck-card-filter-tags');
  const mine = Boolean(state.user && (state.deck.owner_id === state.user.id || state.isAdmin));
  for (const card of state.cards) {
    const copies = state.deckCards.find(item => item.card_id === card.id)?.copies || 0;
    if (!copies) continue;
    if (types.size && !types.has(card.card_type)) continue;
    if (statusFilter && (card.testing_status === 'ready' ? 'ready' : 'draft') !== statusFilter) continue;
    if (author && !cardAuthorNames(card).includes(author)) continue;
    if (!matchesCardTerrainFilter(card, terrains)) continue;
    if (!matchesCardTags(card, selectedTags)) continue;
    const row = document.createElement('div'); row.className = `card-list-item deck-card-row${state.deckPreviewCard?.id === card.id ? ' selected' : ''}`;
    row.dataset.cardId = card.id;
    row.setAttribute('role', 'button');
    row.setAttribute('aria-label', `${card.terrain || 'Neutral'} ${card.card_type}: ${card.title}, ${cardTestingStatusLabel(card.testing_status)}`);
    row.tabIndex = 0;
    row.addEventListener('click', () => selectDeckCardFromList(card));
    row.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectDeckCardFromList(card); } });
    row.append(cardListIcons(card));
    const label = document.createElement('span'); label.className = `card-list-title ${terrainClass(card.terrain)}`; label.textContent = card.title;
    row.append(label);
    const testingStatus = document.createElement('span');
    testingStatus.className = `card-testing-status${card.testing_status === 'ready' ? ' ready' : ''}`;
    testingStatus.textContent = card.testing_status === 'ready' ? 'Ready' : 'Draft';
    row.append(testingStatus);
    if (mine) {
      const controls = document.createElement('span');
      controls.className = 'deck-copy-controls';
      const decrement = document.createElement('button');
      decrement.type = 'button';
      decrement.className = 'deck-copy-button action-delete';
      decrement.textContent = '−';
      decrement.setAttribute('aria-label', `Remove one copy of ${card.title}`);
      const count = document.createElement('strong');
      count.className = 'deck-copy-count';
      count.textContent = String(copies);
      count.setAttribute('aria-label', `${copies} copies of ${card.title}`);
      const increment = document.createElement('button');
      increment.type = 'button';
      increment.className = 'deck-copy-button action-add-save';
      increment.textContent = '+';
      increment.setAttribute('aria-label', `Add one copy of ${card.title}`);
      increment.disabled = copies >= 2;
      const changeCopies = nextCopies => {
        const deck = state.deck;
        if (!deck || nextCopies < 0 || nextCopies > 2) return;
        const wasPreviewing = state.deckPreviewCard?.id === card.id;
        state.deckCards = state.deckCards.filter(item => item.card_id !== card.id);
        if (nextCopies) state.deckCards.push({ card_id: card.id, copies: nextCopies });
        if (nextCopies === 0 && wasPreviewing) void showDeckCardPreview(null);
        else renderDeckCards();

        const key = `${deck.id}:${card.id}`;
        const previous = deckCopyUpdates.get(key)?.promise || Promise.resolve();
        const token = Symbol();
        const promise = previous.catch(() => {}).then(() => api.setDeckCard(state.user.id, deck, card.id, nextCopies, state.isAdmin));
        deckCopyUpdates.set(key, { promise, token });
        void promise.then(() => {
          if (deckCopyUpdates.get(key)?.token !== token) return;
          deckCopyUpdates.delete(key);
          status(nextCopies === 0 ? `Removed ${card.title} from ${deck.name}.` : `Saved ${card.title} in ${deck.name}.`);
        }).catch(async cause => {
          if (deckCopyUpdates.get(key)?.token !== token) return;
          deckCopyUpdates.delete(key);
          if (state.deck?.id === deck.id) {
            state.deckCards = await api.listDeckCards(deck.id).catch(() => state.deckCards);
            renderDeckCards();
            if (wasPreviewing && state.deckCards.some(item => item.card_id === card.id && item.copies > 0)) await showDeckCardPreview(card);
          }
          status(cause.message, true);
        });
      };
      decrement.addEventListener('click', event => { event.stopPropagation(); changeCopies(copies - 1); });
      increment.addEventListener('click', event => { event.stopPropagation(); changeCopies(copies + 1); });
      controls.addEventListener('keydown', event => event.stopPropagation());
      controls.append(decrement, count, increment);
      row.append(controls);
    } else {
      const count = document.createElement('strong'); count.textContent = `×${copies}`; row.append(count);
    }
    list.append(row);
  }
  if (!list.childElementCount) list.textContent = state.deckCards.some(item => item.copies > 0) ? 'No cards found.' : 'This deck has no cards.';
  renderDeckSummary();
}

function scrollToDeckCardRow(cardId) {
  requestAnimationFrame(() => {
    const list = $('#deck-cards');
    let row = [...list.children].find(item => item.dataset.cardId === cardId);
    if (!row) {
      clearFilterTiles('deck-card-filter-type');
      clearFilterTiles('deck-card-filter-terrain');
      clearTagFilters('deck-card-filter-tags');
      $('#deck-card-filter-status').value = '';
      $('#deck-card-filter-author').value = '';
      renderDeckCards();
      row = [...list.children].find(item => item.dataset.cardId === cardId);
    }
    if (!row) return;
    const distance = row.getBoundingClientRect().top - list.getBoundingClientRect().top;
    list.scrollTo({ top: list.scrollTop + distance, behavior: 'smooth' });
  });
}

function navigateDeckCardList(direction) {
  const list = $('#deck-cards');
  const rows = [...list.children].filter(row => row.dataset.cardId);
  if (!rows.length) return;
  const currentIndex = rows.findIndex(row => row.dataset.cardId === String(state.deckPreviewCard?.id));
  const nextIndex = currentIndex < 0 ? (direction > 0 ? 0 : rows.length - 1) : currentIndex + direction;
  const nextRow = rows[nextIndex];
  if (!nextRow) return;
  const card = state.cards.find(item => String(item.id) === nextRow.dataset.cardId);
  if (!card) return;
  const focusList = list.contains(document.activeElement);
  void showDeckCardPreview(card);
  if (focusList) [...list.children].find(row => row.dataset.cardId === String(card.id))?.focus();
  scrollToDeckCardRow(card.id);
}

function closeCardSearchSuggestions(input, suggestions) {
  suggestions.hidden = true;
  input.setAttribute('aria-expanded', 'false');
}

function cardSearchOption(card, onSelect) {
  const option = document.createElement('button');
  option.type = 'button';
  option.className = 'card-search-option card-list-item';
  option.setAttribute('role', 'option');
  option.append(cardTypeIconElement(card));
  const title = document.createElement('span');
  title.className = `card-list-title ${terrainClass(card.terrain)}`;
  title.textContent = card.title;
  option.append(title);
  option.addEventListener('click', onSelect);
  return option;
}

function renderCardSearchSuggestions() {
  const input = $('#card-search');
  const suggestions = $('#card-search-suggestions');
  const query = input.value.trim().toLocaleLowerCase();
  const cards = [...state.cards, ...patronCards]
    .filter(card => !query || card.title.toLocaleLowerCase().includes(query))
    .sort((a, b) => a.title.localeCompare(b.title));
  suggestions.replaceChildren();
  for (const card of cards) suggestions.append(cardSearchOption(card, () => {
    input.value = card.title;
    closeCardSearchSuggestions(input, suggestions);
    if (state.card === card) renderCardList();
    selectCardFromList(card);
  }));
  suggestions.hidden = !cards.length;
  input.setAttribute('aria-expanded', String(Boolean(cards.length)));
}

function renderDeckCardSuggestions() {
  const input = $('#deck-card-search');
  const suggestions = $('#deck-card-search-suggestions');
  const query = input.value.trim().toLocaleLowerCase();
  const mine = Boolean(state.user && (state.deck?.owner_id === state.user.id || state.isAdmin));
  suggestions.replaceChildren();
  if (!state.deck) { closeCardSearchSuggestions(input, suggestions); return; }
  const cards = state.cards
    .filter(card => !query || card.title.toLocaleLowerCase().includes(query))
    .sort((a, b) => a.title.localeCompare(b.title));
  for (const card of cards) {
    suggestions.append(cardSearchOption(card, () => {
      input.value = '';
      closeCardSearchSuggestions(input, suggestions);
      if (!mine) {
        selectDeckCardFromList(card);
        return;
      }
      const deck = state.deck;
      const copies = state.deckCards.find(item => item.card_id === card.id)?.copies || 0;
      if (copies >= 2) { selectDeckCardFromList(card); return; }
      recentDeckCardAddition = { deckId: deck.id, cardId: card.id, expiresAt: performance.now() + 3000 };
      void api.setDeckCard(state.user.id, deck, card.id, copies + 1, state.isAdmin)
        .then(async () => {
          const deckCards = await api.listDeckCards(deck.id);
          if (state.deck?.id !== deck.id) return;
          state.deckCards = deckCards;
          await showDeckCardPreview(card);
          scrollToDeckCardRow(card.id);
          status(`Added ${card.title} to ${deck.name}.`);
        })
        .catch(cause => { recentDeckCardAddition = null; status(cause.message, true); });
    }));
  }
  suggestions.hidden = !cards.length;
  input.setAttribute('aria-expanded', String(Boolean(cards.length)));
}

function summaryGroup(entries, colorized = false) {
  const section = document.createElement('div');
  section.className = `deck-summary-group ${colorized ? 'deck-summary-colors' : 'deck-summary-types'}`;
  for (const [name, count] of Object.entries(entries)) {
    const item = document.createElement('span');
    item.className = `deck-summary-item${colorized ? ` ${terrainClass(name)}` : ''}`;
    const displayName = { Entity: 'Entities', Event: 'Events', Patron: 'Patrons' }[name] || name;
    item.textContent = `${displayName} ${count}`;
    section.append(item);
  }
  return section;
}

function renderCollectionSummary(cards) {
  const typeCounts = { 'All Cards': cards.length, Entity: 0, Event: 0, Patron: 0 };
  const terrainCounts = { Symbiosis: 0, Flow: 0, Verdant: 0, Radiance: 0, Nomads: 0 };
  for (const card of cards) {
    if (Object.hasOwn(typeCounts, card.card_type)) typeCounts[card.card_type]++;
    const terrain = Object.hasOwn(terrainCounts, card.terrain) ? card.terrain : 'Nomads';
    terrainCounts[terrain]++;
  }
  $('#cards-summary').replaceChildren(summaryGroup(typeCounts), summaryGroup(terrainCounts, true));
}

function renderDeckSummary() {
  const summary = $('#deck-summary');
  summary.replaceChildren();
  summary.hidden = !state.deck;
  const download = $('#download-all-cards');
  download.disabled = download.dataset.exporting === 'true' || !state.deck || !(
    state.deckCards.some(entry => entry.copies > 0)
    || patronCardByName(patronByName(state.deck?.patron_name)?.name)
  );
  if (!state.deck) return;

  const typeCounts = { 'All Cards': 0, Entity: 0, Event: 0 };
  const terrainCounts = { Symbiosis: 0, Flow: 0, Verdant: 0, Radiance: 0, Nomads: 0 };
  for (const entry of state.deckCards) {
    const copies = Number(entry.copies) || 0;
    const card = state.cards.find(item => item.id === entry.card_id);
    if (!card || copies < 1 || !Object.hasOwn(typeCounts, card.card_type)) continue;
    typeCounts['All Cards'] += copies;
    typeCounts[card.card_type] += copies;
    const terrain = Object.hasOwn(terrainCounts, card.terrain) ? card.terrain : 'Nomads';
    terrainCounts[terrain] += copies;
  }

  summary.append(summaryGroup(typeCounts), summaryGroup(terrainCounts, true));
}

async function renderDeckPatron(patron, { clearPrevious = false } = {}) {
  const shell = $('.deck-patron-preview-shell');
  const canvas = $('#deck-patron-canvas');
  const downloadButton = $('#patron-download-png');
  const deleteButton = $('#patron-delete-card');
  const patronCard = patron ? patronCardByName(patron.name) : null;
  updateTestingStatusButton('#deck-patron-test-status', patronCard, true);
  const keepExistingPreview = Boolean(patron && !clearPrevious && !shell.classList.contains('is-empty') && canvas.style.visibility !== 'hidden');
  updateAddToDeckButtons(null);
  const serial = ++state.deckPatronSerial;
  shell.className = `deck-patron-preview-shell patron-faction-${(patron?.faction || 'none').toLowerCase().replaceAll(/[^a-z]+/g, '-')}${patron ? '' : ' is-empty'}`;
  updateDeckPreviewEditHint();
  canvas.tabIndex = -1;
  canvas.setAttribute('aria-disabled', 'true');
  canvas.style.pointerEvents = patron ? 'none' : '';
  canvas.style.visibility = patron && !keepExistingPreview ? 'hidden' : '';
  downloadButton.classList.toggle('is-rendering', Boolean(keepExistingPreview && (!downloadButton.disabled || downloadButton.classList.contains('is-rendering'))));
  downloadButton.disabled = true;
  deleteButton.classList.toggle('is-rendering', Boolean(keepExistingPreview && (!deleteButton.disabled || deleteButton.classList.contains('is-rendering'))));
  deleteButton.disabled = true;
  if (!patron) return;
  if (!patronCard) return;
  let artworkUrl = '';
  if (patronCard.artwork_id) {
    try { artworkUrl = await getArtworkUrl(patronCard.artwork_id); }
    catch { /* Keep the default illustration if the custom one is unavailable. */ }
  }
  if (serial !== state.deckPatronSerial) return;
  const stagedCanvas = document.createElement('canvas');
  const result = await renderCard(stagedCanvas, patronCard, artworkUrl, () => serial === state.deckPatronSerial).catch(() => null);
  if (serial !== state.deckPatronSerial) return;
  downloadButton.classList.remove('is-rendering');
  deleteButton.classList.remove('is-rendering');
  if (!result || result.cancelled) return;
  canvas.width = stagedCanvas.width;
  canvas.height = stagedCanvas.height;
  canvas.getContext('2d').drawImage(stagedCanvas, 0, 0);
  canvas.setAttribute('aria-label', stagedCanvas.getAttribute('aria-label'));
  canvas.style.visibility = '';
  canvas.style.pointerEvents = '';
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-disabled', 'false');
  downloadButton.disabled = result.clipped;
  deleteButton.disabled = !state.user;
}

async function showDeckCardPreview(card) {
  const serial = ++state.deckPreviewSerial;
  const previousCard = state.deckPreviewCard;
  state.deckPreviewCard = card;
  const shell = $('.deck-card-preview-shell');
  const canvas = $('#deck-card-canvas');
  const downloadButton = $('#deck-download-png');
  const deleteButton = $('#deck-delete-card');
  updateTestingStatusButton('#deck-card-test-status', card, true);
  const keepExistingPreview = Boolean(card && previousCard && canvas.style.visibility !== 'hidden');
  updateAddToDeckButtons(card);
  shell.classList.toggle('is-empty', !card);
  updateDeckPreviewEditHint();
  canvas.tabIndex = -1;
  canvas.setAttribute('aria-disabled', 'true');
  canvas.style.pointerEvents = card ? 'none' : '';
  canvas.style.visibility = card && !keepExistingPreview ? 'hidden' : '';
  downloadButton.classList.toggle('is-rendering', Boolean(keepExistingPreview && (!downloadButton.disabled || downloadButton.classList.contains('is-rendering'))));
  downloadButton.disabled = true;
  deleteButton.classList.toggle('is-rendering', Boolean(keepExistingPreview && (!deleteButton.disabled || deleteButton.classList.contains('is-rendering'))));
  deleteButton.disabled = true;
  renderDeckCards();
  if (!card) {
    closeDeckCardPreview();
    return;
  }
  openDeckCardPreview();
  const previewCard = { ...card, author: cardAuthorText(card) };
  let artworkUrl = '';
  if (card.artwork_id) {
    try { artworkUrl = await getArtworkUrl(card.artwork_id); }
    catch { /* Keep the deck preview usable when artwork is unavailable. */ }
  }
  if (serial !== state.deckPreviewSerial) return;
  const stagedCanvas = document.createElement('canvas');
  const result = await renderCard(stagedCanvas, previewCard, artworkUrl, () => serial === state.deckPreviewSerial).catch(() => null);
  if (serial !== state.deckPreviewSerial) return;
  downloadButton.classList.remove('is-rendering');
  deleteButton.classList.remove('is-rendering');
  if (!result || result.cancelled) return;
  canvas.width = stagedCanvas.width;
  canvas.height = stagedCanvas.height;
  canvas.getContext('2d').drawImage(stagedCanvas, 0, 0);
  canvas.setAttribute('aria-label', stagedCanvas.getAttribute('aria-label'));
  canvas.style.visibility = '';
  canvas.style.pointerEvents = '';
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-disabled', 'false');
  downloadButton.disabled = result.clipped;
  deleteButton.disabled = !state.user || (!card.patron && card.owner_id !== state.user.id && !state.isAdmin);
}

async function selectDeck(deck) {
  state.deck = deck;
  $('#deck-download-status').hidden = true;
  $('#deck-download-status').textContent = '';
  closeDeckEdit();
  state.deckCards = [];
  $('#decks-view').classList.toggle('deck-detail-open', Boolean(deck));
  void renderDeckPatron(patronByName(deck?.patron_name), { clearPrevious: true });
  renderDeckList();
  renderDeckHeader();
  const canDelete = Boolean(deck && state.user && (deck.owner_id === state.user.id || state.isAdmin));
  $('#duplicate-deck').disabled = !deck || !state.user;
  $('#delete-deck').disabled = !canDelete;
  await showDeckCardPreview(null);
  const form = $('#deck-form');
  form.reset();
  form.elements.name.value = deck?.name || '';
  const patronSelect = form.elements.patron_name;
  refreshDeckPatronOptions();
  patronSelect.value = patronByName(deck?.patron_name)?.name || '';
  renderDeckAuthorSelect(deck?.author_ids?.[0] || deck?.owner_id || state.user?.id);
  $('#deck-cover').value = '';
  $('#deck-cover-button').disabled = !deck || !canEditDeck(deck) || savingDeckCover;
  $('#edit-deck').hidden = !canEditDeck(deck);
  $('#edit-deck').disabled = !deck || !canEditDeck(deck);
  showDeckCoverStatus();
  const mine = Boolean(state.user && (!deck || canEditDeck(deck)));
  for (const field of form.querySelectorAll('input,select, #duplicate-deck, #delete-deck')) field.disabled = !mine;
  syncPatronPicker(patronSelect);
  $('#duplicate-deck').disabled = !deck || !state.user;
  $('#delete-deck').disabled = !deck || !state.user || (!mine && !state.isAdmin);
  const deckCards = deck ? await api.listDeckCards(deck.id) : [];
  if (deck && state.deck?.id !== deck.id) return;
  state.deckCards = deckCards;
  const firstDeckCard = state.cards.find(card => state.deckCards.some(item => item.card_id === card.id && item.copies > 0));
  if (firstDeckCard) await showDeckCardPreview(firstDeckCard);
  else renderDeckCards();
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
  return { ...Object.fromEntries(new FormData(form)), is_public: true, author_ids: [$('#deck-author-select').value].filter(Boolean), cover_artwork_id: state.deck?.cover_artwork_id || '' };
}

let savingDeckCover = false;
function closeDeckEdit() {
  $('#deck-edit-modal').hidden = true;
  document.body.classList.remove('auth-modal-open');
  $('#deck-cover').value = '';
  showDeckCoverStatus();
}
function openDeckEdit() {
  if (!canEditDeck(state.deck)) return;
  const form = $('#deck-form');
  form.elements.name.value = state.deck.name;
  renderDeckAuthorSelect(state.deck.author_ids?.[0] || state.deck.owner_id);
  $('#deck-cover').value = '';
  showDeckCoverStatus();
  $('#deck-edit-modal').hidden = false;
  document.body.classList.add('auth-modal-open');
  form.elements.name.focus();
}
function showDeckCoverStatus(message = '', error = false) {
  const element = $('#deck-cover-status');
  element.textContent = message;
  element.hidden = !message;
  element.classList.toggle('error', error);
}
async function saveDeckEdit() {
  if (!state.user || !canEditDeck(state.deck) || savingDeckCover) return;
  savingDeckCover = true;
  const input = $('#deck-cover');
  const button = $('#save-deck-edit');
  const file = input.files?.[0];
  const stopLoading = setButtonLoading(button, file ? 'Uploading…' : 'Saving…');
  const selectedDeck = state.deck;
  input.disabled = true;
  let artwork = null;
  const previousArtworkId = selectedDeck.cover_artwork_id || null;
  try {
    await deckSaveQueue.catch(() => {});
    if (file) artwork = await api.uploadArtwork(await compressedArtwork(file));
    const saved = await api.saveDeck(state.user.id, selectedDeck.id, { ...deckFormValues(), cover_artwork_id: artwork?.id || previousArtworkId }, state.isAdmin);
    state.deck = saved;
    state.decks = state.decks.map(deck => deck.id === saved.id ? saved : deck);
    renderDeckList();
    renderDeckHeader();
    if (artwork && previousArtworkId && previousArtworkId !== artwork.id) await api.deleteArtwork(previousArtworkId).catch(console.error);
    closeDeckEdit();
  } catch (cause) {
    if (artwork) await api.deleteArtwork(artwork.id).catch(console.error);
    showDeckCoverStatus(cause.message || 'Deck save failed.', true);
    status(cause.message, true);
  } finally {
    savingDeckCover = false;
    input.value = '';
    input.disabled = !canEditDeck(state.deck);
    button.disabled = !canEditDeck(state.deck);
    stopLoading();
  }
}

async function autosaveDeck() {
  if (!state.user) return;
  const values = deckFormValues();
  const saved = state.deck
    ? await api.saveDeck(state.user.id, state.deck.id, values, state.isAdmin)
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
  addGroup(state.user ? 'Other profiles' : 'All profiles', otherProfiles);
}

function selectProfile(profile) {
  state.profile = profile;
  $('#profile-heading').replaceChildren(avatarElement(profile), document.createTextNode(profile.display_name || 'Player'));
  const mine = profile.id === state.user?.id;
  $('#profile-form').hidden = !mine;
  $('#profile-form').elements.display_name.value = profile.display_name;
  $('#profile-form').elements.bio.value = profile.bio;
  populateFavoriteCards($('#profile-form').elements.favorite_card_id, profile.favorite_card_id);
  $('#profile-bio').hidden = mine;
  $('#profile-bio').textContent = profile.bio || (mine ? 'Add a short bio to your profile.' : 'No bio yet.');
  $('#profile-favorite-card').hidden = mine;
  $('#profile-favorite-card').textContent = `Favorite card: ${favoriteCardName(profile.favorite_card_id)}`;
  renderProfileList();
}

async function reloadCollections() {
  [state.cards, state.decks, state.profiles] = await Promise.all([api.listCards(), api.listDecks(), api.listProfiles()]);
  state.cards = resolveLegacyCardAuthors(state.cards, state.profiles);
  play.refreshCollections();
  refreshDeckPatronOptions();
  const savedPatrons = savedDeckPatrons();
  state.decks = state.decks.map(deck => deck.patron_name || !savedPatrons[deck.id] ? deck : { ...deck, patron_name: savedPatrons[deck.id] });
  refreshCardAuthorFilter();
  updateAddToDeckButtons(state.card || state.deckPreviewCard);
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
      renderAuthorOptions($('#card-author-options'), selectedCardAuthors, state.card?.author);
      renderDeckAuthorSelect(selectedDeckAuthor);
      const cardEditable = canEditCard(state.card);
      const deckEditable = Boolean(state.user && (!state.deck || canEditDeck(state.deck)));
      for (const input of $('#card-author-options').querySelectorAll('input')) input.disabled = !cardEditable;
      $('#deck-author-select').disabled = !deckEditable;
    } catch (cause) { status(cause.message, true); }
  };
  const refreshDecks = async () => {
    const selectedDeckId = state.deck?.id;
    const selectedPreviewId = state.deckPreviewCard?.id;
    if (selectedDeckId && hasPendingDeckCopyChanges(selectedDeckId)) return;
    try {
      await reloadCollections();
      if (selectedDeckId && hasPendingDeckCopyChanges(selectedDeckId)) return;
      if (!selectedDeckId) return;
      const updatedDeck = state.decks.find(deck => deck.id === selectedDeckId);
      if (!updatedDeck) { state.deck = null; renderDeckCards(); return; }
      state.deck = updatedDeck;
      state.deckCards = await api.listDeckCards(updatedDeck.id);
      const previewCard = state.cards.find(card => card.id === selectedPreviewId);
      if (previewCard) await showDeckCardPreview(previewCard);
      else renderDeckCards();
      if (recentDeckCardAddition?.deckId === updatedDeck.id && performance.now() < recentDeckCardAddition.expiresAt) {
        scrollToDeckCardRow(recentDeckCardAddition.cardId);
      }
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

function updateAuthenticatedControls() {
  void play.refreshIdentity();
  const signedIn = Boolean(state.user);
  for (const id of ['new-card', 'new-deck', 'duplicate-deck', 'edit-deck', 'delete-deck', 'delete-card', 'deck-delete-card', 'patron-delete-card']) {
    $(`#${id}`).hidden = !signedIn;
  }
  $('#card-edit-hint').hidden = !signedIn;
  updateDeckPreviewEditHint();
  updateTestingStatusButton('#card-test-status', state.card);
  updateTestingStatusButton('#deck-card-test-status', state.deckPreviewCard, true);
  updateTestingStatusButton('#deck-patron-test-status', patronCardByName(patronByName(state.deck?.patron_name)?.name), true);
}

async function loadWorkspace() {
  const version = ++state.authVersion;
  status('Loading your Helianthe workspace…');
  try {
    const user = await api.currentUser();
    if (!user || version !== state.authVersion) return;
    state.user = user;
    state.isAdmin = user.email?.trim().toLowerCase() === ADMIN_EMAIL;
    updateAuthenticatedControls();
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
      updateAuthenticatedControls();
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
  updateAuthenticatedControls();
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
  const stopLoading = setButtonLoading(form.querySelector('button[type="submit"]'), 'Signing in…');
  try {
    const { error } = await client.auth.signInWithPassword({ email: form.elements.email.value.trim(), password: form.elements.password.value });
    if (error) {
      const message = error.code === 'email_not_confirmed'
        ? 'Confirm your email address using the link we sent you, then try signing in again.'
        : 'No account was found for this email address, or the password is incorrect.';
      showAuthMessage(message, true);
    } else await loadWorkspace();
  } catch (cause) {
    showAuthMessage('Sign in failed. Please try again.', true);
  } finally {
    stopLoading();
  }
}

async function submitPasswordRecovery(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  if (authMode === 'reset-request') {
    const email = form.elements.email.value.trim();
    if (!email || !form.elements.email.checkValidity()) return showAuthMessage('Enter a valid email address.', true);
    const stopLoading = setButtonLoading(button, 'Sending…');
    try {
      const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: 'https://mysticart.games/helianthe/' });
      showAuthMessage(error ? `Could not send the recovery link: ${error.message}` : 'If this account exists, a recovery link has been sent to that email address.', Boolean(error));
    } catch (cause) { showAuthMessage('Could not send the recovery link. Try again.', true); }
    finally { stopLoading(); }
    return;
  }
  const password = form.elements.password.value;
  if (password.length < 6) return showAuthMessage('Use a password with at least 6 characters.', true);
  if (password !== form.elements.confirm_password.value) return showAuthMessage('The passwords do not match.', true);
  const stopLoading = setButtonLoading(button, 'Saving…');
  try {
    const { error } = await client.auth.updateUser({ password });
    if (error) return showAuthMessage(`Could not update the password: ${error.message}`, true);
    recoveryPending = false;
    form.elements.password.value = '';
    form.elements.confirm_password.value = '';
    hideSignIn();
    await loadWorkspace();
    status('Password updated. You are signed in.');
  } catch (cause) { showAuthMessage('Could not update the password. Try the recovery link again.', true); }
  finally { stopLoading(); }
}

function setButtonLoading(button, label) {
  const originalLabel = button.textContent;
  button.disabled = true;
  button.classList.add('is-loading');
  button.setAttribute('aria-busy', 'true');
  button.textContent = label;
  return () => {
    button.disabled = false;
    button.classList.remove('is-loading');
    button.removeAttribute('aria-busy');
    button.textContent = originalLabel;
  };
}

$('#auth-form').addEventListener('submit', submitAuthForm);
$('#auth-modal-form').addEventListener('submit', event => authMode === 'sign-up' ? submitSignUp(event) : authMode === 'sign-in' ? submitAuthForm(event) : submitPasswordRecovery(event));
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
$('#auth-page-forgot').addEventListener('click', showResetRequest);
$('#auth-forgot').addEventListener('click', showResetRequest);
$('#auth-mode-toggle').addEventListener('click', () => authMode === 'sign-up' || authMode === 'reset-request' ? setAuthMode('sign-in') : showSignUp());

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
for (const tab of document.querySelectorAll('[data-about-tab]')) {
  tab.addEventListener('click', () => showTab(tab.dataset.aboutTab));
  tab.addEventListener('keydown', event => {
    const index = ABOUT_TAB_NAMES.indexOf(tab.dataset.aboutTab);
    const count = ABOUT_TAB_NAMES.length;
    const next = event.key === 'ArrowRight' ? (index + 1) % count
      : event.key === 'ArrowLeft' ? (index + count - 1) % count
      : event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : null;
    if (next === null) return;
    event.preventDefault();
    showTab(ABOUT_TAB_NAMES[next]);
    $(`[data-about-tab="${ABOUT_TAB_NAMES[next]}"]`).focus();
  });
}
for (const button of document.querySelectorAll('[data-open-tab]')) {
  button.addEventListener('click', () => showTab(button.dataset.openTab));
}
for (const button of document.querySelectorAll('[data-scroll-target]')) {
  button.addEventListener('click', () => {
    const target = document.getElementById(button.dataset.scrollTarget);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}
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
initializeFilterTiles('card-filter-type', ['Entity', 'Event', 'Patron'], 'type', renderCardList);
initializeFilterTiles('card-filter-terrain', ['Symbiosis', 'Flow', 'Verdant', 'Radiance', 'none'], 'terrain', renderCardList);
$('#card-filter-status').addEventListener('change', renderCardList);
$('#card-filter-author').addEventListener('change', renderCardList);
document.addEventListener('keydown', event => {
  if (event.defaultPrevented || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') || $('#cards-view').hidden) return;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing) return;
  if ([...document.querySelectorAll('[role="dialog"]')].some(dialog => dialog.getClientRects().length)) return;
  const focusedControl = event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable], [role="listbox"]');
  if (focusedControl && focusedControl.id !== 'card-search') return;
  if (!$('#card-list').querySelector('[data-card-id]')) return;
  event.preventDefault();
  navigateCardList(event.key === 'ArrowDown' ? 1 : -1);
});
document.addEventListener('keydown', event => {
  if (event.defaultPrevented || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') || $('#decks-view').hidden || !state.deck) return;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing) return;
  if ([...document.querySelectorAll('[role="dialog"]')].some(dialog => dialog.getClientRects().length)) return;
  if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable], [role="listbox"]')) return;
  if (!$('#deck-cards').querySelector('[data-card-id]')) return;
  event.preventDefault();
  navigateDeckCardList(event.key === 'ArrowDown' ? 1 : -1);
});
$('#deck-card-search').addEventListener('input', renderDeckCardSuggestions);
$('#deck-card-search').addEventListener('focus', renderDeckCardSuggestions);
$('#deck-card-search').addEventListener('click', renderDeckCardSuggestions);
document.addEventListener('click', event => {
  for (const [input, suggestions] of [
    ['#deck-card-search', '#deck-card-search-suggestions'],
  ]) {
    const searchInput = $(input);
    const suggestionList = $(suggestions);
    const scrollRail = suggestionList.parentElement.querySelector('.dropdown-scroll-rail');
    if (event.target !== searchInput && !suggestionList.contains(event.target) && !scrollRail?.contains(event.target)) {
      closeCardSearchSuggestions(searchInput, suggestionList);
    }
  }
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  closeCardSearchSuggestions($('#deck-card-search'), $('#deck-card-search-suggestions'));
});
initializeFilterTiles('deck-card-filter-type', ['Entity', 'Event'], 'type', renderDeckCards);
initializeFilterTiles('deck-card-filter-terrain', ['Symbiosis', 'Flow', 'Verdant', 'Radiance', 'none'], 'terrain', renderDeckCards);
$('#edit-card-tags').addEventListener('click', () => openCardField('tags'));
$('#deck-card-filter-status').addEventListener('change', renderDeckCards);
$('#deck-card-filter-author').addEventListener('change', renderDeckCards);
$('#new-card').addEventListener('click', async () => {
  if (!requireAccount()) return;
  const create = $('#new-card');
  create.disabled = true;
  try {
    const names = new Set(state.cards.map(card => card.title.trim().toLocaleLowerCase()));
    let title = 'New Card';
    for (let suffix = 2; names.has(title.toLocaleLowerCase()); suffix++) title = `New Card ${suffix}`;
    const created = await api.createCard(state.user.id, {
      title, card_type: 'Entity', terrain: 'Symbiosis', testing_status: 'draft', effect: '',
      author: authorNames([state.user.id], state.user.id).join(', '), author_ids: [state.user.id],
    });
    await reloadCollections();
    $('#card-search').value = '';
    clearFilterTiles('card-filter-type');
    $('#card-filter-status').value = '';
    $('#card-filter-author').value = '';
    clearFilterTiles('card-filter-terrain');
    clearTagFilters('card-filter-tags');
    selectCard(state.cards.find(card => card.id === created.id) || created);
    scrollToCardRow(created.id);
    status('Card created. Select it to edit.');
  } catch (cause) { status(cause.message, true); }
  finally { create.disabled = false; }
});
$('#close-mobile-editor').addEventListener('click', closeMobileEditor);
$('#card-canvas').tabIndex = 0;
$('#card-canvas').addEventListener('click', event => openCardField(cardFieldAt(event)));
$('#card-test-status').addEventListener('click', () => { void toggleCardTestingStatus(state.card); });
for (const [buttonId, getCard] of [
  ['deck-card-test-status', () => state.deckPreviewCard],
  ['deck-patron-test-status', () => patronCardByName(patronByName(state.deck?.patron_name)?.name)],
]) {
  $(`#${buttonId}`).addEventListener('click', () => {
    const card = getCard();
    void toggleCardTestingStatus(card);
  });
}
$('#card-canvas').addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openCardField('type'); } });
function editDeckPreviewAt(event, card) {
  if (!requireCardEdit(card)) return;
  selectCard(card);
  openCardField(cardFieldAt(event));
}
$('#deck-card-canvas').tabIndex = 0;
$('#deck-card-canvas').addEventListener('click', event => editDeckPreviewAt(event, state.deckPreviewCard));
$('#deck-card-canvas').addEventListener('keydown', event => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  const card = state.deckPreviewCard;
  if (!requireCardEdit(card)) return;
  selectCard(card);
  openCardField('type');
});
$('#deck-patron-canvas').tabIndex = 0;
$('#deck-patron-canvas').addEventListener('click', event => {
  const patron = patronByName(state.deck?.patron_name);
  const card = patronCardByName(patron?.name);
  editDeckPreviewAt(event, card);
});
$('#deck-patron-canvas').addEventListener('keydown', event => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  const patron = patronByName(state.deck?.patron_name);
  const card = patronCardByName(patron?.name);
  if (!requireCardEdit(card)) return;
  selectCard(card);
  openCardField('type');
});
$('#close-card-field').addEventListener('click', closeCardField);
for (const id of ['card-edit-denied-backdrop', 'close-card-edit-denied', 'confirm-card-edit-denied']) {
  $(`#${id}`).addEventListener('click', closeCardEditDenied);
}
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('#card-edit-denied-modal').hidden) closeCardEditDenied(); });
$('#card-field-save').addEventListener('click', () => { void saveCardForm(); });
$('#card-field-cancel').addEventListener('click', closeCardField);
$('#card-field-modal .card-field-backdrop').addEventListener('click', closeCardField);
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('#card-field-modal').hidden) { event.stopPropagation(); closeCardField(); } });
$('#close-deck-card-preview').addEventListener('click', closeDeckCardPreview);
$('#card-form').addEventListener('input', event => {
  state.cardFormDirty = true;
  if (event.target.closest('#card-author-options')) state.cardAuthorEdited = true;
  renderPreview();
});
$('#card-form').elements.card_type.addEventListener('change', () => { syncTerrain(); renderPreview(); });
$('#card-artwork').addEventListener('change', event => {
  const file = event.target.files?.[0];
  if (!file) return;
  state.cardFormDirty = true;
  ++state.artworkSerial; releaseArtwork();
  state.artworkError = '';
  state.artworkLoading = false;
  state.artworkUrl = URL.createObjectURL(file);
  renderPreview();
});
for (const [buttonId, getCard] of [
  ['add-to-deck', () => state.card],
  ['deck-add-to-deck', () => state.deckPreviewCard],
  ['patron-add-to-deck', () => patronCardByName(patronByName(state.deck?.patron_name)?.name)],
]) {
  $(`#${buttonId}`).addEventListener('click', () => openAddToDeckModal(getCard()));
}
$('#add-to-deck-backdrop').addEventListener('click', closeAddToDeckModal);
$('#close-add-to-deck').addEventListener('click', closeAddToDeckModal);
$('#cancel-add-to-deck').addEventListener('click', closeAddToDeckModal);
$('#confirm-add-to-deck').addEventListener('click', async () => {
  const card = addToDeckCard;
  const deck = state.decks.find(item => item.id === $('#add-to-deck-select').value);
  if (!card || !deck || !state.user) return closeAddToDeckModal();
  const button = $('#confirm-add-to-deck');
  const stopLoading = setButtonLoading(button, 'Adding…');
  try {
    const deckCards = state.deck?.id === deck.id ? state.deckCards : await api.listDeckCards(deck.id);
    const copies = deckCards.find(item => item.card_id === card.id)?.copies || 0;
    if (copies >= 2) {
      closeAddToDeckModal();
      return status(`${deck.name} already has two copies of ${card.title}.`);
    }
    await api.setDeckCard(state.user.id, deck, card.id, copies + 1, state.isAdmin);
    if (state.deck?.id === deck.id) {
      state.deckCards = await api.listDeckCards(deck.id);
      renderDeckCards();
    }
    closeAddToDeckModal();
  } catch (cause) {
    status(cause.message, true);
  } finally {
    stopLoading();
  }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !$('#add-to-deck-modal').hidden) closeAddToDeckModal();
});
$('#download-png').addEventListener('click', async () => {
  try { await downloadCardPNG($('#card-canvas'), $('#card-form').elements.title.value); }
  catch (cause) { status(cause.message, true); }
});
for (const [buttonId, canvasId, getCard] of [
  ['deck-download-png', 'deck-card-canvas', () => state.deckPreviewCard],
  ['patron-download-png', 'deck-patron-canvas', () => patronCardByName(patronByName(state.deck?.patron_name)?.name)],
]) {
  $(`#${buttonId}`).addEventListener('click', async () => {
    const card = getCard();
    if (!card) return;
    try { await downloadCardPNG($(`#${canvasId}`), card.title); }
    catch (cause) { status(cause.message, true); }
  });
}
for (const [buttonId, getCard] of [
  ['deck-delete-card', () => state.deckPreviewCard],
  ['patron-delete-card', () => patronCardByName(patronByName(state.deck?.patron_name)?.name)],
]) {
  $(`#${buttonId}`).addEventListener('click', () => {
    const card = getCard();
    if (!card || !state.user) return;
    selectCard(card);
    $('#delete-card').click();
  });
}
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
    if (card.patron) {
      const deletedPatrons = new Set(JSON.parse(localStorage.getItem(DELETED_PATRON_CARDS_KEY) || '[]'));
      deletedPatrons.add(card.id);
      localStorage.setItem(DELETED_PATRON_CARDS_KEY, JSON.stringify([...deletedPatrons]));
      patronCards = patronCards.filter(item => item.id !== card.id);
    } else await api.deleteCard(state.user.id, card.id, state.isAdmin);
    deleted = true;
    if (!card.patron) state.cards = state.cards.filter(item => item.id !== card.id);
    if (state.deckPreviewCard?.id === card.id) void showDeckCardPreview(null);
    if (card.patron && patronByName(state.deck?.patron_name)?.name === card.patron.name) void renderDeckPatron(null);
    state.card = null;
    closeDeleteCardModal();
    renderCardList();
    selectCard(state.cards[0] || patronCards[0]);
    if (!card.patron) await reloadCollections();
    status('Card deleted.');
  } catch (cause) {
    closeDeleteCardModal();
    status(cause.message, true);
  } finally {
    confirmButton.disabled = false;
    deleteButton.disabled = !state.card || !state.user || (!state.card.patron && state.card.owner_id !== state.user.id && !state.isAdmin);
  }
  if (artworkId && deleted) {
    await api.deleteArtwork(artworkId).catch(error => console.error('Artwork cleanup failed', error));
  }
});

let savingCard = false;
async function saveCardForm() {
  if (savingCard) return;
  if (!requireCardEdit(state.card)) return;
  const form = $('#card-form');
  const modalOpen = !$('#card-field-modal').hidden;
  const modalContent = $('#card-field-content');
  const modalStatus = $('#card-field-status');
  modalStatus.hidden = true;
  const invalidField = [...form.elements, ...(modalOpen ? modalContent.querySelectorAll('input,select,textarea') : [])].find(field => !field.checkValidity());
  if (invalidField) {
    if (modalOpen) {
      modalStatus.textContent = invalidField.validationMessage || 'Check the card fields before saving.';
      modalStatus.hidden = false;
    } else status(invalidField.validationMessage || 'Check the card fields before saving.', true);
    return;
  }
  savingCard = true;
  const isNewCard = !state.card;
  const save = $('#save-card');
  const modalSave = $('#card-field-save');
  const stopSaveLoading = setButtonLoading(save, 'Saving…');
  const stopModalLoading = setButtonLoading(modalSave, 'Saving…');
  let persistedCard = null;
  let cleanupWarning = '';
  try {
    const values = Object.fromEntries(new FormData(form));
    if (modalOpen) {
      for (const field of modalContent.querySelectorAll('[name]')) {
        if (['title', 'card_type', 'terrain', 'effect', 'testing_status'].includes(field.name)) values[field.name] = field.value;
      }
      if (modalContent.querySelector('.tag-picker')) values.tags = [...modalContent.querySelectorAll('input[name="card-tag"]:checked')].map(field => field.value);
    }
    values.tags = normalizeCardTags(values.tags);
    if (state.card?.legacy_tags && JSON.stringify(values.tags) === JSON.stringify(cardTags(state.card))) values.tags = [];
    if (['Entity', 'Patron'].includes(values.card_type) && !values.terrain) values.terrain = 'Symbiosis';
    const modalAuthor = modalOpen ? modalContent.querySelector('select:not([name])') : null;
    const selectedAuthors = selectedAuthorIds($('#card-author-options'));
    const modalAuthorChanged = Boolean(modalAuthor && modalAuthor.value !== (selectedAuthors[0] || ''));
    const authorEdited = state.cardAuthorEdited || modalAuthorChanged;
    values.author_ids = authorEdited
      ? (modalAuthorChanged ? [modalAuthor.value].filter(Boolean) : selectedAuthors)
      : (state.card?.author_ids || selectedAuthors);
    values.author = authorEdited ? authorNames(values.author_ids).join(', ') : (state.card?.author ?? authorNames(values.author_ids).join(', '));
    const sourceFile = cardFieldArtworkFile || $('#card-artwork').files?.[0];
    const file = sourceFile ? await compressedArtwork(sourceFile) : null;
    const previousArtworkId = state.card?.artwork_id || null;
    let card;
    if (state.card?.patron) {
      const authorIds = values.author_ids;
      const artwork = file ? await api.uploadArtwork(file) : null;
      const updates = { title: values.title, terrain: values.terrain, testing_status: values.testing_status, effect: values.effect, tags: values.tags, author_ids: authorIds, author: values.author, artwork_id: artwork?.id || previousArtworkId, rules_revision: PATRON_RULES_REVISION };
      try {
        const overrides = JSON.parse(localStorage.getItem(PATRON_CARD_OVERRIDES_KEY) || '{}');
        overrides[state.card.id] = updates;
        localStorage.setItem(PATRON_CARD_OVERRIDES_KEY, JSON.stringify(overrides));
      } catch (cause) {
        if (artwork) await api.deleteArtwork(artwork.id).catch(console.error);
        throw cause;
      }
      Object.assign(state.card, updates);
      card = state.card;
      if (artwork) artworkUrlCache.set(artwork.id, URL.createObjectURL(file));
      if (artwork && previousArtworkId && previousArtworkId !== artwork.id) {
        try { await api.deleteArtwork(previousArtworkId); }
        catch (cause) { cleanupWarning = cause.message; console.error('Old artwork cleanup failed', cause); }
      }
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
      artworkUrlCache.set(artwork.id, URL.createObjectURL(file));
      if (previousArtworkId && previousArtworkId !== artwork.id) {
        try { await api.deleteArtwork(previousArtworkId); }
        catch (cause) { cleanupWarning = cause.message; console.error('Old artwork cleanup failed', cause); }
      }
    }
    state.cardFormDirty = false;
    if (!state.card?.patron) await reloadCollections();
    if (isNewCard) {
      $('#card-search').value = '';
      clearFilterTiles('card-filter-type');
      $('#card-filter-status').value = '';
      $('#card-filter-author').value = '';
      clearFilterTiles('card-filter-terrain');
      clearTagFilters('card-filter-tags');
    }
    if (modalOpen) closeCardField();
    const savedCard = state.cards.find(item => item.id === card.id) || patronCards.find(item => item.id === card.id) || card;
    selectCard(savedCard);
    if (card.patron && patronPicker) syncPatronPicker($('#deck-form').elements.patron_name);
    if (state.deckPreviewCard?.id === card.id) await showDeckCardPreview(savedCard);
    if (card.patron && patronByName(state.deck?.patron_name)?.name === card.patron.name) await renderDeckPatron(card.patron);
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
  finally { savingCard = false; stopSaveLoading(); stopModalLoading(); }
}
$('#card-form').addEventListener('submit', event => { event.preventDefault(); void saveCardForm(); });

$('#new-deck').addEventListener('click', () => {
  if (requireAccount()) void createNewDeck().catch(cause => status(cause.message, true));
});
$('#back-to-decks').addEventListener('click', () => { void selectDeck(null); });
$('#download-all-cards').addEventListener('click', async () => {
  const deck = state.deck;
  if (!deck) return;
  const cards = state.deckCards.flatMap(entry => {
    const card = state.cards.find(item => item.id === entry.card_id);
    return card && entry.copies > 0 ? [{ card, copies: Number(entry.copies) }] : [];
  });
  const patron = patronCardByName(patronByName(deck.patron_name)?.name);
  const total = cards.reduce((count, entry) => count + entry.copies, patron ? 1 : 0);
  if (!total) return;
  const button = $('#download-all-cards');
  const message = $('#deck-download-status');
  const stopLoading = setButtonLoading(button, 'Preparing…');
  button.dataset.exporting = 'true';
  message.hidden = false;
  try {
    const files = [];
    let rendered = 0;
    for (const { card, copies } of [...(patron ? [{ card: patron, copies: 1 }] : []), ...cards]) {
      message.textContent = `Rendering ${++rendered} of ${cards.length + (patron ? 1 : 0)} card designs…`;
      const canvas = document.createElement('canvas');
      let artworkUrl = '';
      if (card.artwork_id) {
        try { artworkUrl = await getArtworkUrl(card.artwork_id); }
        catch { /* Match the single-card preview's default artwork fallback. */ }
      }
      const result = await renderCard(canvas, { ...card, author: cardAuthorText(card) }, artworkUrl);
      if (result.clipped) throw new Error(`${card.title} has text that does not fit on the card.`);
      const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error(`Could not generate PNG for ${card.title}.`)), 'image/png'));
      for (let copy = 1; copy <= copies; copy++) {
        const title = String(card.title || 'Card').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '') || 'Card';
        files.push({ name: `${String(files.length + 1).padStart(2, '0')} - ${title}${copies > 1 ? ` - ${copy}` : ''}.png`, blob });
      }
    }
    message.textContent = `Packing ${total} PNG files…`;
    const archive = await zipFiles(files);
    const name = String(deck.name || 'Deck').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '') || 'Deck';
    const url = URL.createObjectURL(archive);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Helianthe - ${name}.zip`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    message.textContent = `Downloaded ${total} card PNG files.`;
  } catch (cause) {
    message.textContent = cause.message || 'Could not download this deck.';
    status(message.textContent, true);
  } finally {
    delete button.dataset.exporting;
    stopLoading();
    renderDeckSummary();
  }
});
$('#edit-deck').addEventListener('click', openDeckEdit);
$('#deck-edit-backdrop').addEventListener('click', closeDeckEdit);
$('#close-deck-edit').addEventListener('click', closeDeckEdit);
$('#cancel-deck-edit').addEventListener('click', closeDeckEdit);
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
$('#deck-form').elements.patron_name.addEventListener('change', event => {
  syncPatronPicker(event.target);
  void renderDeckPatron(patronByName(event.target.value));
  void queueDeckSave().catch(cause => status(cause.message, true));
});
$('#deck-cover').addEventListener('change', event => showDeckCoverStatus(event.target.files?.[0]?.name || ''));
$('#deck-cover-button').addEventListener('click', () => $('#deck-cover').click());
$('#deck-form').addEventListener('submit', event => { event.preventDefault(); void saveDeckEdit(); });

$('#profile-form').addEventListener('submit', async event => {
  event.preventDefault();
  const submitButton = event.currentTarget.querySelector('button[type="submit"]');
  const stopLoading = setButtonLoading(submitButton, 'Saving…');
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
    $('#profile-save-status').hidden = true;
  } catch (cause) {
    if (uploadedAvatar) await api.deleteArtwork(uploadedAvatar.id).catch(console.error);
    status(cause.message, true);
  } finally {
    stopLoading();
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
  for (const element of document.querySelectorAll('.item-list, .deck-cards, .about-content, .card-search-suggestions, .favorite-card-menu')) {
    const dropdown = element.matches('.card-search-suggestions, .favorite-card-menu');
    const existingWrapper = dropdown ? element.parentElement : (element.parentElement?.classList.contains('art-scroll-wrap') ? element.parentElement : null);
    if (existingWrapper && element.dataset.artScrollReady === 'true') continue;
    const wrapper = existingWrapper || document.createElement('div');
    if (!existingWrapper) {
      wrapper.className = 'art-scroll-wrap';
      element.parentNode.insertBefore(wrapper, element);
      wrapper.append(element);
    }
    const rail = dropdown ? document.createElement('div') : (existingWrapper?.querySelector('.art-scroll-rail') || document.createElement('div'));
    rail.className = 'art-scroll-rail';
    if (dropdown) rail.classList.add('dropdown-scroll-rail');
    rail.setAttribute('aria-hidden', 'true');
    const thumb = dropdown ? document.createElement('button') : (existingWrapper?.querySelector('.art-scroll-thumb') || document.createElement('button'));
    thumb.className = 'art-scroll-thumb';
    thumb.type = 'button';
    thumb.tabIndex = -1;
    if (!existingWrapper || dropdown) {
      rail.append(thumb);
      wrapper.append(rail);
    }
    element.dataset.artScrollReady = 'true';
    const update = () => {
      const maxScroll = element.scrollHeight - element.clientHeight;
      if (dropdown) {
        rail.style.top = `${element.offsetTop + 4}px`;
        rail.style.height = `${Math.max(0, element.clientHeight - 8)}px`;
      }
      const railHeight = rail.clientHeight;
      const thumbHeight = Math.min(railHeight, 44);
      thumb.style.height = `${thumbHeight}px`;
      rail.style.display = !element.hidden && maxScroll > 0 ? '' : 'none';
      thumb.style.display = maxScroll > 0 ? '' : 'none';
      thumb.style.transform = `translateY(${maxScroll > 0 ? (element.scrollTop / maxScroll) * (railHeight - thumbHeight) : 0}px)`;
    };
    element.addEventListener('scroll', update, { passive: true });
    new ResizeObserver(update).observe(element);
    new ResizeObserver(update).observe(wrapper);
    new MutationObserver(update).observe(element, { childList: true, subtree: true, attributes: dropdown, attributeFilter: dropdown ? ['hidden'] : undefined });
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
  if (event === 'PASSWORD_RECOVERY') {
    recoveryPending = true;
    if (authReady) showNewPassword();
  }
});
const { data: { session }, error } = await client.auth.getSession();
if (error) status(error.message, true);
else if (session) await loadWorkspace();
else await loadPublicWorkspace();
authReady = true;
if (recoveryPending && session) showNewPassword();
