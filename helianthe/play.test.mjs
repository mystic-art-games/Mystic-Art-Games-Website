import test from 'node:test';
import assert from 'node:assert/strict';
import { playerOnline, readyCountdown } from './play.mjs';

test('a silent, invalid or absent heartbeat does not leave a player marked online', () => {
  const now = Date.parse('2026-11-11T12:00:00Z');
  assert.equal(playerOnline('2026-11-11T11:59:40Z', now), true);
  assert.equal(playerOnline('2026-11-11T11:59:15Z', now), false);
  assert.equal(playerOnline(null, now), false);
  assert.equal(playerOnline('invalid', now), false);
});

test('ready deadline counts down from table creation and stops after activation', () => {
  const created = '2026-11-11T12:00:00Z';
  const now = Date.parse(created);
  assert.equal(readyCountdown(created, null, now), 'Ready in 01:00');
  assert.equal(readyCountdown(created, null, now + 59000), 'Ready in 00:01');
  assert.equal(readyCountdown(created, null, now + 60000), 'Ready in 00:00');
  assert.equal(readyCountdown(created, '2026-11-11T12:00:30Z', now + 60000), '');
  assert.equal(readyCountdown(undefined, null, now), '');
});
