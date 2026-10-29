import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.mjs';

const TERRAINS = new Set(['Symbiosis', 'Flow', 'Verdant', 'Radiance']);
const CARD_TYPES = new Set(['Entity', 'Event']);
const PREVIOUS_VERDANT_NAME = ['Ever', 'green'].join('');

function result(response) {
  if (response.error) throw new Error(response.error.message || 'The request failed.');
  return response.data;
}

function text(value, maxLength) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function normalizeCardTerrain(card) {
  if (card?.terrain !== PREVIOUS_VERDANT_NAME) return card;
  return {
    ...card,
    terrain: 'Verdant',
    effect: typeof card.effect === 'string' ? card.effect.replaceAll(PREVIOUS_VERDANT_NAME, 'Verdant') : card.effect,
  };
}

export function cardInput(form) {
  const title = text(form.title, 200);
  const card_type = text(form.card_type, 20);
  const terrain = text(form.terrain, 20) || null;
  if (!title) throw new Error('Card title is required.');
  if (!CARD_TYPES.has(card_type)) throw new Error('Choose Entity or Event.');
  if (card_type === 'Entity' && !terrain) throw new Error('Choose a Terrain for the Entity.');
  if (terrain && !TERRAINS.has(terrain)) throw new Error('Unknown Terrain.');
  return {
    title, card_type, terrain,
    effect: text(form.effect, 6000),
    author: text(form.author, 500),
    author_ids: Array.isArray(form.author_ids) ? form.author_ids : [],
  };
}

export function deckInput(form) {
  const name = text(form.name, 100);
  if (!name) throw new Error('Deck name is required.');
  return { name, patron_name: text(form.patron_name, 200), is_public: true, author_ids: Array.isArray(form.author_ids) ? form.author_ids : [] };
}

export function createCommunityApi(client) {
  return {
    async currentUser() {
      const { data, error } = await client.auth.getUser();
      if (error) throw new Error(error.message);
      return data.user;
    },

    async ensureProfile(user) {
      if (!user?.id) throw new Error('Sign in first.');
      let existing;
      try {
        existing = result(await client.from('profiles').select('id,display_name,bio,favorite_card_id,avatar_id').eq('id', user.id).maybeSingle());
      } catch {
        try {
          existing = result(await client.from('profiles').select('id,display_name,bio,favorite_card_id').eq('id', user.id).maybeSingle());
        } catch {
          existing = result(await client.from('profiles').select('id,display_name,bio').eq('id', user.id).maybeSingle());
        }
      }
      if (existing) return existing;
      const metadata = user.user_metadata || {};
      const displayName = text(metadata.display_name, 60) || `Player ${user.id.slice(0, 6)}`;
      const row = { id: user.id, display_name: displayName, bio: text(metadata.bio, 500), favorite_card_id: text(metadata.favorite_card_id, 36) || null };
      let response = await client.from('profiles').insert(row).select('id,display_name,bio,favorite_card_id,avatar_id').single();
      if (response.error && /favorite_card_id/i.test(response.error.message || '')) {
        response = await client.from('profiles').insert({ id: row.id, display_name: row.display_name, bio: row.bio }).select('id,display_name,bio').single();
      }
      if (response.error?.code === '23505') return result(await client.from('profiles').select('id,display_name,bio').eq('id', user.id).single());
      return result(response);
    },

    async publishOwnedDecks(userId) {
      if (!userId) throw new Error('Sign in first.');
      return result(await client.from('decks').update({ is_public: true }).eq('owner_id', userId).eq('is_public', false).select('id'));
    },

    async listProfiles() {
      try {
        return result(await client.from('profiles').select('id,display_name,bio,favorite_card_id,avatar_id,created_at').order('created_at', { ascending: true }));
      } catch {
        try {
          const profiles = result(await client.from('profiles').select('id,display_name,bio,favorite_card_id,created_at').order('created_at', { ascending: true }));
          return profiles.map(profile => ({ ...profile, avatar_id: null }));
        } catch {
          const profiles = result(await client.from('profiles').select('id,display_name,bio,created_at').order('created_at', { ascending: true }));
          return profiles.map(profile => ({ ...profile, favorite_card_id: null, avatar_id: null }));
        }
      }
    },

    async saveProfile(userId, values) {
      if (!userId) throw new Error('Sign in first.');
      const displayName = text(values.display_name, 60);
      if (displayName.length < 2) throw new Error('Display name must contain at least 2 characters.');
      const patch = { display_name: displayName, bio: text(values.bio, 500), favorite_card_id: text(values.favorite_card_id, 36) || null, avatar_id: text(values.avatar_id, 36) || null, updated_at: new Date().toISOString() };
      return result(await client.from('profiles').update(patch).eq('id', userId).select('id,display_name,bio,favorite_card_id,avatar_id').single());
    },

    async listCards() {
      try {
        return result(await client.from('cards').select('id,owner_id,source_path,title,polish_name,card_type,terrain,effect,author,author_ids,artwork_id,legacy_image_ref,updated_at').order('title', { ascending: true })).map(normalizeCardTerrain);
      } catch {
        const cards = result(await client.from('cards').select('id,owner_id,source_path,title,polish_name,card_type,terrain,effect,author,artwork_id,legacy_image_ref,updated_at').order('title', { ascending: true }));
        return cards.map(card => normalizeCardTerrain({ ...card, author_ids: card.owner_id ? [card.owner_id] : [] }));
      }
    },

    async createCard(userId, values) {
      if (!userId) throw new Error('Sign in first.');
      const row = { ...cardInput(values), owner_id: userId };
      let response = await client.from('cards').insert(row).select().single();
      if (response.error && /author_ids/i.test(response.error.message || '')) {
        const { author_ids, ...legacyRow } = row;
        response = await client.from('cards').insert(legacyRow).select().single();
      }
      return result(response);
    },

    async saveCard(userId, cardId, values, isAdmin = false) {
      if (!userId || !cardId) throw new Error('Select your own card.');
      const patch = { ...cardInput(values), updated_at: new Date().toISOString() };
      if (values.artwork_id !== undefined) patch.artwork_id = values.artwork_id || null;
      const update = async valuesToSave => {
        let query = client.from('cards').update(valuesToSave).eq('id', cardId);
        if (!isAdmin) query = query.eq('owner_id', userId);
        return query.select();
      };
      let response = await update(patch);
      if (response.error && /author_ids/i.test(response.error.message || '')) {
        const { author_ids, ...legacyPatch } = patch;
        response = await update(legacyPatch);
      }
      const rows = result(response);
      if (!rows?.length) throw new Error('Only the card creator or designated administrator can edit this card.');
      return rows[0];
    },

    async deleteCard(userId, cardId, isAdmin = false) {
      if (!userId || !cardId) throw new Error('Select a card first.');
      let query = client.from('cards').delete().eq('id', cardId);
      if (!isAdmin) query = query.eq('owner_id', userId);
      const response = await query.select('id');
      const rows = result(response);
      if (!rows?.length) throw new Error('Only the card creator or designated administrator can delete this card.');
      return rows[0];
    },

    async listDecks() {
      try {
        return result(await client.from('decks').select('id,owner_id,name,patron_name,author_ids,is_public,created_at,updated_at').order('created_at', { ascending: false }));
      } catch {
        const decks = result(await client.from('decks').select('id,owner_id,name,patron_name,is_public,created_at,updated_at').order('created_at', { ascending: false }));
        return decks.map(deck => ({ ...deck, author_ids: deck.owner_id ? [deck.owner_id] : [] }));
      }
    },

    async createDeck(userId, values) {
      if (!userId) throw new Error('Sign in first.');
      const row = { ...deckInput(values), owner_id: userId, is_public: true };
      return result(await client.from('decks').insert(row).select().single());
    },

    async saveDeck(userId, deckId, values) {
      if (!userId || !deckId) throw new Error('Select your own deck.');
      const patch = { ...deckInput(values), updated_at: new Date().toISOString() };
      const rows = result(await client.from('decks').update(patch).eq('id', deckId).eq('owner_id', userId).select());
      if (!rows?.length) throw new Error('Only the deck owner can edit this deck.');
      return rows[0];
    },

    async duplicateDeck(userId, deck, cards) {
      if (!userId || !deck?.id) throw new Error('Select a deck to duplicate.');
      const copy = await this.createDeck(userId, {
        name: `${deck.name} Copy`.slice(0, 100),
        patron_name: deck.patron_name,
        author_ids: [userId],
      });
      if (!cards?.length) return copy;
      const rows = cards.map(card => ({ deck_id: copy.id, card_id: card.card_id, copies: card.copies }));
      try {
        result(await client.from('deck_cards').insert(rows));
      } catch (error) {
        await client.from('decks').delete().eq('id', copy.id).eq('owner_id', userId);
        throw error;
      }
      return copy;
    },

    async deleteDeck(userId, deckId) {
      if (!userId || !deckId) throw new Error('Select your own deck.');
      const rows = result(await client.from('decks').delete().eq('id', deckId).eq('owner_id', userId).select('id'));
      if (!rows?.length) throw new Error('Only the deck owner can delete this deck.');
    },

    async listDeckCards(deckId) {
      if (!deckId) return [];
      return result(await client.from('deck_cards').select('card_id,copies').eq('deck_id', deckId));
    },

    async setDeckCard(userId, deck, cardId, copies) {
      if (!userId || deck?.owner_id !== userId) throw new Error('Only the deck owner can change its cards.');
      if (!cardId || !Number.isInteger(copies) || copies < 0 || copies > 3) throw new Error('Copies must be between 0 and 3.');
      if (copies === 0) return result(await client.from('deck_cards').delete().eq('deck_id', deck.id).eq('card_id', cardId).select());
      return result(await client.from('deck_cards').upsert({ deck_id: deck.id, card_id: cardId, copies }, { onConflict: 'deck_id,card_id' }).select());
    },

    async uploadArtwork(file) {
      if (!file || file.size > 5 * 1024 * 1024) throw new Error('Artwork must be 5 MB or smaller.');
      const { data: { session }, error } = await client.auth.getSession();
      if (error || !session) throw new Error('Sign in to upload artwork.');
      const response = await fetch(`${SUPABASE_URL}/functions/v1/card-art`, {
        method: 'POST',
        headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${session.access_token}`, 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Artwork upload failed (HTTP ${response.status}).`);
      if (!payload.artwork?.id) throw new Error('Artwork upload returned no image ID.');
      return payload.artwork;
    },

    async deleteArtwork(artworkId) {
      if (!artworkId) return;
      const { data: { session }, error } = await client.auth.getSession();
      if (error || !session) throw new Error('Sign in to delete artwork.');
      const response = await fetch(`${SUPABASE_URL}/functions/v1/card-art?id=${encodeURIComponent(artworkId)}`, {
        method: 'DELETE',
        headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${session.access_token}` },
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || 'Old artwork cleanup failed.');
      }
    },

    async fetchArtwork(artworkId) {
      if (!artworkId) return null;
      const { data: { session }, error } = await client.auth.getSession();
      if (error) throw new Error(error.message);
      const url = `${SUPABASE_URL}/functions/v1/card-art?id=${encodeURIComponent(artworkId)}`;
      const token = session?.access_token || SUPABASE_PUBLISHABLE_KEY;
      const response = await fetch(url, { headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error('Could not load artwork.');
      return response.blob();
    },

    mediaUrl(artworkId) {
      return artworkId ? `${SUPABASE_URL}/functions/v1/card-art?id=${encodeURIComponent(artworkId)}` : '';
    },
  };
}
