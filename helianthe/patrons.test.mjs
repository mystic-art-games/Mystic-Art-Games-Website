import test from 'node:test';
import assert from 'node:assert/strict';
import { PATRONS, FACTION_VISIONS, updatePatronVision } from './patrons.mjs';

test('updating a stored Patron goal preserves custom credo and ability paragraphs', () => {
  const patron = PATRONS.find(p => p.name.startsWith('Myrr,'));
  const effect = 'Credo: Custom wording.\n\nScoring: An old goal.\n\nAbility: Custom reaction.\n\nArtist note: Keep this.';
  const result = updatePatronVision(effect, patron);
  assert.equal(result, `Credo: Custom wording.\n\nVision: ${FACTION_VISIONS.Dreamwardens}\n\nAbility: Custom reaction.\n\nArtist note: Keep this.`);
});

test('single-line spacing does not consume adjacent credo or ability text', () => {
  const patron = PATRONS.find(p => p.name.startsWith('Solen,'));
  const result = updatePatronVision('Vision: Old goal.\nCredo: Preserve me.\nAbility: Add 1 Lumen if it has fewer than 2.', patron);
  assert.equal(result, `Vision: ${FACTION_VISIONS.Brightworks}\nCredo: Preserve me.\nAbility: Add 1 Lumen if it has fewer than 5.`);
});
