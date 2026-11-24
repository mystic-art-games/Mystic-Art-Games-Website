import { vigilBlocksCreation, vigilBlocksPlacement } from './play-passive-entities.mjs';

const terrainTypes = ['Symbiosis', 'Flow', 'Verdant', 'Radiance'];
const placementRules = {
  'Through Fire Reborn': ['through_fire_reborn', 'fertilize 1. if you sacrifice a verdant terrain, fertilize 3'],
  'Equatorial Forests': ['equatorial_forests', 'when placed, create verdant terrain. when this terrain becomes fully surrounded by any terrains, put an extra verdant terrain on any node. then, dissolve this entity.'],
  'Garden of Shared Roots': ['garden', 'when placed, create any terrain on adjacent empty node. at the beginning of your turn, draw 1 card if terrain under this entity is entangled.'],
  'Green Reclamation': ['reclaim', 'transform any adjacent empty terrain to verdant.'],
  'Hypervine': ['fertilize', 'if there are two or more adjacent verdant terrains, fertilize 2 on adjacent nodes.'],
  'Lanternhollow': ['entangle', 'when placed, entangle terrain under this entity.'],
  'Moss Bastion': ['protect', 'protect any terrain under this entity and on up to 1 adjacent verdant terrain.'],
  'Heliotic Discharge': ['double', 'duplicate solar counters on one adjacent radiance terrain.'],
  'Heart of Aurelia': ['spend', 'remove 3 lumens from terrain under this entity to put shield counter on any terrain.'],
  'Impulse Transmittion': ['transfer', 'choose two radiance terrains. relocate radiance counters between them as you like.'],
  'Helianthus Nursery': ['relocate_protection', 'choose any adjacent terrain. relocate protection from the chosen terrain to adjacent terrain to the chosen one. (remove protection if relocation is not possible). if this entity is fully surrounded with any terrains, dissolve entity from the chosen terrain.'],
  'Memories of Atlantis': ['dissolve_recall', 'dissolve any flow entity to recall any entity from your archive to you hand. when shaped, you may protect any terrain.'],
  'Sludge Bath': ['dissolve_adjacent', 'dissolve adjacent entity. when shaped, relocate any terrain to adjacent node.'],
};
const shapeRules = {
  'Depthcloak': ['unprotect', 'while this entity is on non-flow terrain, it counts as 2 toward your patron’s victory goal. when shaped, you may unprotect any terrain.'],
  'Memories of Atlantis': ['protect_any', 'dissolve any flow entity to recall any entity from your archive to you hand. when shaped, you may protect any terrain.'],
  'Sludge Bath': ['relocate', 'dissolve adjacent entity. when shaped, relocate any terrain to adjacent node.'],
};

export function entityEffectKind(card, action) {
  const rule = (action === 'shape' ? shapeRules : placementRules)[card.title];
  const effect = String(card.effect || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (rule?.[0] === 'through_fire_reborn') return effect.replace(/\.$/, '') === rule[1] ? rule[0] : null;
  return Array.isArray(rule) && rule[1] === effect ? rule[0] : null;
}

const boardKeys = Array.from({ length: 20 }, (_, index) => `${index % 5},${Math.floor(index / 5)}`);
const adjacent = (a, b) => Math.abs(Number(a[0]) - Number(b[0])) + Math.abs(Number(a[2]) - Number(b[2])) === 1;
const lumens = node => Number(node?.lumens || 0);

export const isEmptyTerrain = node => Boolean(node?.terrain && !node.entity);

export function entityEffectStep(kind, board, source, choices, archive = []) {
  const node = key => board[key] || {};
  const nearby = key => adjacent(source, key);
  const empty = key => key !== source && !node(key).terrain;
  const canCreate = key => empty(key) && !vigilBlocksCreation(board, key);
  const present = key => key === source || Boolean(node(key).terrain);
  const cell = (label, field, predicate, optional = false) => ({
    label, field, optional, boardTargets: boardKeys.filter(predicate),
  });
  switch (kind) {
    case 'through_fire_reborn': {
      const canSacrifice = key => node(key).terrain === 'Verdant' && !node(key).protected;
      if (!('sacrifice' in choices) && boardKeys.some(canSacrifice)) {
        return cell('Choose Verdant Terrain to sacrifice, or Fertilize 1', 'sacrifice', canSacrifice, true);
      }
      const fields = choices.sacrifice ? ['target', 'second', 'third'] : ['target'];
      const field = fields.find(name => !choices[name]);
      if (!field) return null;
      return cell('Choose a Node to Fertilize', field, key => {
        const sacrificed = key === choices.sacrifice;
        if (!sacrificed && !empty(key)) return false;
        const tokens = fields.filter(name => choices[name] === key).length;
        const existing = tokens + Number(!sacrificed && Boolean(node(key).fertilize));
        return existing < 2 && (existing === 0 || !vigilBlocksPlacement(board, key));
      });
    }
    case 'equatorial_forests':
      return choices.target ? null : cell('Choose an empty Node for Verdant Terrain', 'target',
        key => canCreate(key) && boardKeys.some(other => present(other) && adjacent(key, other)));
    case 'garden':
      if (!choices.target) return cell('Choose an adjacent empty Node', 'target', key => nearby(key) && canCreate(key));
      return choices.terrain ? null : { label: 'Choose Terrain to create', field: 'terrain',
        options: terrainTypes.map(terrain => ({ label: terrain, value: { terrain } })) };
    case 'reclaim':
      return choices.target ? null : cell('Choose an adjacent Terrain without an Entity to transform to Verdant', 'target',
        key => nearby(key) && isEmptyTerrain(node(key)));
    case 'fertilize':
      if (boardKeys.filter(key => nearby(key) && node(key).terrain === 'Verdant').length < 2) return null;
      if (!choices.target) return cell('Choose a Node for the first Fertilize token', 'target', key => nearby(key) && canCreate(key));
      return choices.second ? null : cell('Choose a Node for the second Fertilize token', 'second',
        key => nearby(key) && canCreate(key) && (key !== choices.target || (!node(key).fertilize && !vigilBlocksPlacement(board, key))));
    case 'entangle':
      if (choices.target || node(source).terrain !== 'Symbiosis' || node(source).entanglements?.length) return null;
      return cell('Choose adjacent non-Symbiosis Terrain to Entangle', 'target',
        key => nearby(key) && present(key) && node(key).terrain !== 'Symbiosis' && !node(key).entanglements?.includes(source));
    case 'protect':
      return 'target' in choices ? null : cell('Choose adjacent Verdant Terrain to Protect', 'target',
        key => nearby(key) && node(key).terrain === 'Verdant', true);
    case 'double':
      return choices.target ? null : cell('Choose adjacent Radiance Terrain', 'target',
        key => nearby(key) && node(key).terrain === 'Radiance');
    case 'spend':
      return choices.target || lumens(node(source)) < 3 ? null : cell('Choose Terrain to Protect', 'target', present);
    case 'transfer': {
      const radiance = boardKeys.filter(key => node(key).terrain === 'Radiance');
      if (radiance.length < 2 || !radiance.some(key => lumens(node(key)))) return null;
      if (!choices.target) return cell('Choose the first Radiance Terrain', 'target', key => radiance.includes(key));
      if (!choices.second) return cell('Choose the second Radiance Terrain', 'second', key => key !== choices.target && radiance.includes(key));
      if ('amount' in choices) return null;
      const first = lumens(node(choices.target));
      const second = lumens(node(choices.second));
      return { label: 'Choose the final Lumen distribution', field: 'amount',
        options: Array.from({ length: first + second + 1 }, (_, amount) => ({
          label: `First Terrain: ${amount} · Second Terrain: ${first + second - amount}`, value: amount,
        })) };
    }
    case 'unprotect':
      return 'target' in choices ? null : cell('Choose Terrain to Unprotect', 'target',
        key => present(key) && node(key).protected, true);
    case 'protect_any':
      return 'target' in choices ? null : cell('Choose Terrain to Protect', 'target', present, true);
    case 'dissolve_adjacent':
      return choices.target ? null : cell('Choose an adjacent Entity to Dissolve', 'target', key => nearby(key) && node(key).entity);
    case 'dissolve_recall': {
      const entities = new Map(archive.filter(card => card.card_type === 'Entity' && card.id)
        .map(card => [card.id, card.title]));
      const options = [...entities].map(([value, label]) => ({ label, value }));
      if (!options.length) return null;
      if (!choices.target) return cell('Choose a Flow Entity to Dissolve', 'target', key => key === source || node(key).entity?.terrain === 'Flow');
      if (choices.recall || node(choices.target).protected) return null;
      return { label: 'Choose an Entity to Recall from your Archive', field: 'recall', options };
    }
    case 'relocate_protection':
      if (!choices.target) return cell('Choose an adjacent Terrain', 'target', key => nearby(key) && present(key));
      if (choices.second || !node(choices.target).protected) return null;
      return cell('Choose adjacent Terrain to receive Protection', 'second', key => adjacent(choices.target, key) && present(key));
    case 'relocate':
      if (!choices.target) return cell('Choose Terrain to relocate', 'target',
        key => present(key) && boardKeys.some(destination => empty(destination) && adjacent(key, destination)));
      return choices.second ? null : cell('Choose an adjacent empty Node', 'second', key => adjacent(choices.target, key) && empty(key));
    default:
      return null;
  }
}
