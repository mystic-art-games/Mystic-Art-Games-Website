import test from 'node:test';
import assert from 'node:assert/strict';
import { playerOnline } from './play.mjs';

test('a silent, invalid or absent heartbeat does not leave a player marked online', () => {
  const now = Date.parse('2026-11-11T12:00:00Z');
  assert.equal(playerOnline('2026-11-11T11:59:40Z', now), true);
  assert.equal(playerOnline('2026-11-11T11:59:15Z', now), false);
  assert.equal(playerOnline(null, now), false);
  assert.equal(playerOnline('invalid', now), false);
});
