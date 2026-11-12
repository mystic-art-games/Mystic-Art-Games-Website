export const FACTION_VISIONS = {
  Verdant: 'Win immediately when all 19 spaces of the hexagonal board contain Terrain of any type and no Verdant Terrain is in Crisis.',
  Brightworks: 'Win immediately when Radiance Terrain without Crisis holds at least 15 Lumens in total.',
  Dreamwardens: 'Win immediately with at least 5 Entanglements in one connected Symbiosis group. Every entangled Symbiosis Node in that group must be free from Crisis.',
  Flowbound: 'Win immediately when at least 10 Flow Entities occupy Terrains without Crisis, regardless of those Nodes’ Terrain or the Entities’ Patron, owner or controller.',
};

export const PATRON_RULES_REVISION = '2026-11-12-hex-board';

// Replace only the scoring paragraph; retain artwork, flavor and other edits.
export function updatePatronVision(effect, patron) {
  const scoring = `Vision: ${FACTION_VISIONS[patron.faction]}`;
  let text = String(effect || '');
  if (/(^|\n)(?:Vision|Scoring):/.test(text)) text = text.replace(/(^|\n)(?:Vision|Scoring):[^\n]*(?:\n(?!(?:\n|Ability:|Credo:))[^\n]*)*/, (_, prefix) => prefix + scoring);
  else text = [text, scoring].filter(Boolean).join('\n\n');
  if (patron.name === 'Solen, Architect of Dawn') text = text.replace(/fewer than 2\b/g, 'fewer than 5');
  return text;
}

export const PATRONS = [
  { name: 'Aeryn, Keeper of the Currents', faction: 'Flowbound', credo: 'No community should become an island.', ability: '' },
  { name: 'Kaelor, The First Spark', faction: 'Brightworks', credo: 'Stagnation is extinction in disguise.', ability: '' },
  { name: 'Lyra, Weaver of Renewal', faction: 'Dreamwardens', credo: 'Change must be woven, not forced.', ability: '' },
  { name: 'Myrr, The Rootweaver', faction: 'Dreamwardens', credo: 'The deepest roads grow beneath us.', ability: 'Once per turn, after a Symbiosis Node is shaped or has its Crisis removed, draw 1 card, then discard 1 card.' },
  { name: 'Nox, Dreamtender', faction: 'Dreamwardens', credo: 'Memory is the root of wisdom.', ability: '' },
  { name: 'Solen, Architect of Dawn', faction: 'Brightworks', credo: 'Let the city shine without burning.', ability: 'Once per turn, after a Radiance Node is shaped or has its Crisis removed, add 1 Lumen to it if it has fewer than 5, or draw 1 card instead.' },
  { name: 'Thalos, Tidekeeper of the Deep', faction: 'Flowbound', credo: 'Return the water cleaner than you found it.', ability: '' },
  { name: 'Zhyr, Stitcher of the Wild', faction: 'Verdant', credo: 'Every scar can become soil.', ability: '' },
].map(patron => ({ ...patron, scoring: FACTION_VISIONS[patron.faction] }));
