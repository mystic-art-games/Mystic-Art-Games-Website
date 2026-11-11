import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRoomCode, playerOnline } from './play.mjs';

test('a room can be joined from a pasted code or the shared invite link', () => {
  assert.equal(normalizeRoomCode(' ab12 cd34ef '), 'AB12CD34EF');
  assert.equal(normalizeRoomCode('https://mysticart.games/helianthe/?room=ab12cd34ef#play'), 'AB12CD34EF');
  assert.equal(normalizeRoomCode('https://mysticart.games/helianthe/'), '');
});

test('a silent, invalid or absent heartbeat does not leave a player marked online', () => {
  const now = Date.parse('2026-11-11T12:00:00Z');
  assert.equal(playerOnline('2026-11-11T11:59:40Z', now), true);
  assert.equal(playerOnline('2026-11-11T11:59:15Z', now), false);
  assert.equal(playerOnline(null, now), false);
  assert.equal(playerOnline('invalid', now), false);
});
