import { entityEffectsSuppressed, vigilBlocksCreation, vigilBlocksPlacement } from './play-passive-entities.mjs';
import { entityEffectKind, entityEffectStep } from './play-entity-effects.mjs?v=8';

// These are the Event texts currently present in the online card catalog.
// Match the dealt card's text, not just its title, so edited cards cannot
// silently resolve as an older version of an effect.
export const extendedEventRules = {
  'Bubble Swap': ['switch places of any two entities.', 'swap_entities', 'an Entity'],
  'Bubble Switch': ['relocate any flow entity from a flow terrain to an adjacent terrain, after that change that terrain to a flow terrain.', 'bubble_switch', 'a Flow Entity on Flow Terrain'],
  'Compost Front': ['dissolve any empty verdant terrain to dissolve any entity.', 'compost_front', 'empty Verdant Terrain'],
  'Dematerialize': ['choose any unprotected entity in the world and trigger its "when place" effect. then dissolve it.', 'dematerialize', 'an unprotected Entity'],
  'Fertile Rain': ['dissolve entity from any verdant terrain to fertilize 2 on any adjacent nodes.', 'fertile_rain_any', 'Verdant Terrain with an Entity'],
  'Fungal Rainwood': ['dissolve any entity from any entangled terrain.', 'fungal_rainwood', 'an Entity on entangled Terrain'],
  'Glade Surveyor': ['dissolve any verdant terrain to relocate protection from any terrain to its adjacent terrain.', 'glade_surveyor', 'Verdant Terrain'],
  'Grid Reconfiguration': ['relocate any terrain to its adjacent node.', 'relocate_terrain', 'Terrain'],
  'Habitat Loom': ["back any entity from the world to it's patrons hand.", 'return_entity', 'an Entity'],
  'Hyphae': ['entangle any symbiosis terrain with an entity.', 'hyphae', 'Symbiosis Terrain with an Entity'],
  'Land Gift': ['create a verdant terrain on a empty node adjacent to a verdant terrain. if there are at least 8 other verdant terrains, fertilize 1', 'land_gift', 'empty Node adjacent to Verdant Terrain'],
  'Landshift': ['move any verdant entity to another empty verdant terrain.', 'landshift', 'a Verdant Entity'],
  'Lilac Overgrowth': ['choose any terrain with 2 adjacent verdant terrains. dissolve its entity.', 'lilac_overgrowth', 'Terrain adjacent to two Verdant Terrain cards'],
  'Liquid Protection': ['choose a pair of adjacent flow entities. protect them.', 'liquid_protection', 'a Flow Entity'],
  'Migration of Wind-Sails': ['relocate any flow entity to any empty terrain.', 'migration_wind_sails', 'a Flow Entity'],
  'Natural Habitat': ['choose any verdant terrain with entity. draw cards equal to the number of adjacent verdant terrains minus 2.', 'natural_habitat', 'Verdant Terrain with an Entity'],
  "Poseidon's Chosen One": ['if you have 3 or more entities in your archive, you may recall one of them to your hand.', 'poseidons_chosen_one', ''],
  'Reclamation Pulse': ['dissolve any empty verdant terrain to protect any verdant terrain. draw 1 card.', 'reclamation_pulse', 'empty Verdant Terrain'],
  'Restoration Nursery': ['relocate protection to a different terrain.', 'restoration_nursery', 'protected Terrain'],
  'Regrow': ['dissolve any verdant terrain to recall any entity from the archive.', 'regrow', 'Verdant Terrain'],
  'Shared Canal Gathering': ['entangle any symbiosis empty terrain.', 'shared_canal_gathering', 'empty Symbiosis Terrain'],
  'Skyfire': ['dissolve two adjacent entities from two different patrons.', 'skyfire_pair', 'an Entity adjacent to an opposing Entity'],
  'Solar Bombardment': ['put a crisis counter on target terrain. if that would be the second crisis counter on that terrain, destroy it and the entity on it.', 'solar_bombardment', 'Terrain'],
  'Spark of Invention': ['discard 1 card to recall any event from the archive to your hand.', 'spark_discard_recall', ''],
  'Sunken Archive': ['discard 1 card to recall any entity from the archive to your hand.', 'sunken_archive', ''],
  'Symbiotic Accord': ['transform terrain adjacent to the group of symbiosis terrains to a different one.', 'symbiotic_accord', 'Terrain adjacent to Symbiosis Terrain'],
  'Terrestrial Reorientation': ['relocate any entanglement to any terrain within the same group of symbiosis terrains. draw 1 card.', 'terrestrial_reorientation', 'entangled Symbiosis Terrain'],
  'Waterish Doppelganger': ['transform any entity to flow.', 'waterish_doppelganger', 'an Entity'],
  'Wave of Change': ["swap the positions of any two terrain's along with entities.", 'wave_of_change', 'Terrain'],
};

export const extendedKinds = new Set(Object.values(extendedEventRules).map(rule => rule[1]));

const adjacent = (a, b) => {
  if (!a || !b) return false;
  const [ax, ay] = a.split(',').map(Number);
  const [bx, by] = b.split(',').map(Number);
  return Math.abs(ax - bx) + Math.abs(ay - by) === 1;
};

const visibleCells = board => {
  const cells = [];
  for (let y = 0; y < 4; y++) for (let x = 0; x < 5; x++) {
    const key = `${x},${y}`;
    const node = board?.[key] || {};
    cells.push({ key, node, label: `R${y + 1} C${x + 1} · ${node.terrain || 'Empty'}${node.entity ? ` · ${node.entity.title || 'Entity'}` : ''}` });
  }
  return cells;
};

const verdantNeighbors = (board, key) => visibleCells(board).filter(cell => adjacent(key, cell.key) && cell.node.terrain === 'Verdant').length;

function adjacentSymbiosisGroup(board, start) {
  const symbiosis = visibleCells(board).filter(({ node }) => node.terrain === 'Symbiosis');
  const seen = new Set([start]);
  const queue = [start];
  for (const current of queue) {
    for (const { key } of symbiosis) {
      if (!seen.has(key) && adjacent(current, key)) {
        seen.add(key);
        queue.push(key);
      }
    }
  }
  return seen;
}

const canRelocateEntanglementToNeighbor = (node, key, symbiosis) =>
  ['Flow', 'Verdant', 'Radiance'].includes(node.terrain)
  && adjacent(key, symbiosis) && !node.entanglements?.includes(symbiosis);

function boardStep(label, board, predicate) {
  return { label, options: visibleCells(board).filter(({ key, node }) => predicate(node, key)).map(({ key, label: text }) => ({ label: text, value: { type: 'cell', key } })) };
}

function archiveStep(label, archive, type) {
  return { label, options: (archive || []).flatMap((card, index) => card.card_type === type && (card.card_id || card.id)
    ? [{ label: card.title || type, value: { type: 'archive', index, id: card.card_id || card.id } }] : []).reverse() };
}

function discardStep(hand, eventIndex) {
  return { label: 'Choose a card to discard', options: (hand || []).flatMap((card, index) => index === eventIndex
    ? [] : [{ label: card.title || 'Card', value: { type: 'discard', index: index > eventIndex ? index - 1 : index, id: card.card_id || card.id } }]) };
}

function terrainStep(label, excluded) {
  return { label, options: ['Symbiosis', 'Flow', 'Verdant', 'Radiance'].filter(type => type !== excluded)
    .map(type => ({ label: type, value: { type: 'terrain', terrain: type } })) };
}

const pairedEvents = new Set([
  'restoration_nursery', 'terrestrial_reorientation',
  'swap_entities', 'bubble_switch', 'relocate_terrain', 'landshift', 'liquid_protection',
  'migration_wind_sails', 'wave_of_change',
]);

const entityTargetSteps = {
  swap_entities: [0, 1], bubble_switch: [0], compost_front: [1], dematerialize: [0],
  fertile_rain_any: [0], fungal_rainwood: [0], return_entity: [0], landshift: [0],
  lilac_overgrowth: [0], liquid_protection: [0, 1], migration_wind_sails: [0],
  natural_habitat: [0], skyfire_pair: [0, 1], waterish_doppelganger: [0],
};

export function extendedEventStep(kind, selected, context) {
  const step = eventStep(kind, selected, context);
  if (step && entityTargetSteps[kind]?.includes(selected.length)) step.targetsEntity = true;
  if (step && selected.length === 0 && pairedEvents.has(kind)) {
    step.options = step.options.filter(({ value }) => eventStep(kind, [value], context)?.options.length);
  }
  return step;
}

function eventStep(kind, selected, { board, archive, hand, eventIndex, playerId }) {
  const cells = selected.filter(choice => choice.type === 'cell').map(choice => choice.key);
  const count = selected.length;
  const first = board?.[cells[0]] || {};
  const terrain = node => Boolean(node.terrain);
  const entity = node => Boolean(node.entity);
  const empty = node => !node.terrain;
  const entangled = node => Array.isArray(node.entanglements) && node.entanglements.length > 0;
  const source = cells[0];
  switch (kind) {
    case 'restoration_nursery':
      if (count === 0) return boardStep('Choose protected Terrain', board, node => terrain(node) && node.protected);
      if (count === 1) return boardStep('Choose another Terrain to receive Protection', board,
        (node, key) => terrain(node) && key !== source);
      return null;
    case 'swap_entities':
      if (count === 0) return boardStep('Choose the first Entity', board, entity);
      if (count === 1) return boardStep('Choose the second Entity', board, (node, key) => entity(node) && key !== source);
      return null;
    case 'bubble_switch':
      if (count === 0) return boardStep('Choose a Flow Entity on Flow Terrain', board, node => node.terrain === 'Flow' && node.entity?.terrain === 'Flow');
      if (count === 1) return boardStep('Choose adjacent Terrain without an Entity', board, (node, key) => terrain(node) && !entity(node) && adjacent(source, key));
      return null;
    case 'compost_front':
    case 'reclamation_pulse':
      if (count === 0) return boardStep('Choose empty Verdant Terrain to Dissolve', board, node => node.terrain === 'Verdant' && !entity(node));
      if (first.protected) return null;
      if (count === 1) return boardStep(kind === 'compost_front' ? 'Choose an Entity to Dissolve' : 'Choose Verdant Terrain to Protect', board,
        (node, key) => key !== source && (kind === 'compost_front' ? entity(node) : node.terrain === 'Verdant'));
      return null;
    case 'dematerialize':
      if (count === 0) return boardStep('Choose an unprotected Entity', board, node => entity(node) && !node.protected);
      if (count === 1 && first.entity && !first.protected && !entityEffectsSuppressed(board, source)
        && entityEffectKind(first.entity, 'place') === 'reclaim') {
        const transform = entityEffectStep('reclaim', board, source, {});
        return boardStep(transform.label, board, (_, key) => transform.boardTargets.includes(key));
      }
      if (count === 1 && !entityEffectsSuppressed(board, source)
        && ['Equatorial Forests', 'Garden of Shared Roots'].includes(first.entity?.title))
        return boardStep('Choose an empty Node for its When Placed effect', board,
          (node, key) => empty(node) && !vigilBlocksCreation(board, key) && (first.entity?.title === 'Garden of Shared Roots'
            ? adjacent(source, key) : visibleCells(board).some(other => terrain(other.node) && adjacent(key, other.key))));
      if (count === 2 && first.entity?.title === 'Garden of Shared Roots') return terrainStep('Choose the created Terrain', null);
      return null;
    case 'fertile_rain_any':
      if (count === 0) return boardStep('Choose Verdant Terrain with an Entity', board, node => node.terrain === 'Verdant' && entity(node));
      if (first.protected) return null;
      if (count < 3) return boardStep('Choose an adjacent empty Node to Fertilize', board, (node, key) =>
        empty(node) && !vigilBlocksCreation(board, key) && adjacent(source, key)
          && !(count === 2 && key === cells[1] && (node.fertilize || vigilBlocksPlacement(board, key))));
      return null;
    case 'fungal_rainwood':
      return count ? null : boardStep('Choose an Entity on entangled Terrain', board, node => entity(node) && entangled(node));
    case 'glade_surveyor':
      if (count === 0) return boardStep('Choose Verdant Terrain to Dissolve', board, node => node.terrain === 'Verdant');
      if (first.protected) return null;
      if (count === 1) return boardStep('Choose protected Terrain', board, (node, key) => terrain(node) && node.protected && key !== source
        && visibleCells(board).some(other => other.key !== source && terrain(other.node) && adjacent(key, other.key)));
      if (count === 2) return boardStep('Choose adjacent destination Terrain', board, (node, key) => terrain(node) && adjacent(cells[1], key) && key !== source);
      return null;
    case 'relocate_terrain':
      if (count === 0) return boardStep('Choose Terrain to relocate', board, terrain);
      if (count === 1) return boardStep('Choose adjacent empty Node', board, (node, key) => empty(node) && adjacent(source, key));
      return null;
    case 'return_entity':
      return count ? null : boardStep('Choose an Entity to return to its owner’s hand', board, entity);
    case 'hyphae':
    case 'shared_canal_gathering':
      if (count === 0) return boardStep('Choose Symbiosis Terrain to Entangle', board,
        (node, key) => node.terrain === 'Symbiosis' && (kind === 'hyphae' ? entity(node) : !entity(node))
          && !entangled(node) && visibleCells(board).some(other =>
            adjacent(key, other.key) && ['Verdant', 'Flow', 'Radiance'].includes(other.node.terrain)
              && !other.node.entanglements?.includes(key)));
      if (count === 1) return boardStep('Choose adjacent non-Symbiosis Terrain', board,
        (node, key) => ['Verdant', 'Flow', 'Radiance'].includes(node.terrain) && adjacent(source, key)
          && first.terrain === 'Symbiosis' && !entangled(first) && (kind === 'hyphae' ? entity(first) : !entity(first))
          && !node.entanglements?.includes(source));
      return null;
    case 'land_gift':
      if (count === 0) return boardStep('Choose empty Node adjacent to Verdant', board,
        (node, key) => empty(node) && !vigilBlocksCreation(board, key) && verdantNeighbors(board, key) > 0);
      if (count === 1 && visibleCells(board).filter(cell => cell.node.terrain === 'Verdant').length >= 8)
        return boardStep('Choose an empty Node to Fertilize', board, (node, key) => empty(node) && !vigilBlocksCreation(board, key) && key !== source);
      return null;
    case 'landshift':
      if (count === 0) return boardStep('Choose a Verdant Entity', board, node => node.entity?.terrain === 'Verdant');
      if (count === 1) return boardStep('Choose empty Verdant Terrain', board, (node, key) => node.terrain === 'Verdant' && !entity(node) && key !== source);
      return null;
    case 'lilac_overgrowth':
      return count ? null : boardStep('Choose an Entity next to two Verdant Terrain cards', board,
        (node, key) => terrain(node) && entity(node) && verdantNeighbors(board, key) >= 2);
    case 'liquid_protection':
      if (count === 0) return boardStep('Choose a Flow Entity', board, node => node.entity?.terrain === 'Flow');
      if (count === 1) return boardStep('Choose an adjacent Flow Entity', board,
        (node, key) => node.entity?.terrain === 'Flow' && adjacent(source, key));
      return null;
    case 'migration_wind_sails':
      if (count === 0) return boardStep('Choose a Flow Entity', board, node => node.entity?.terrain === 'Flow');
      if (count === 1) return boardStep('Choose empty Terrain', board, (node, key) => terrain(node) && !entity(node) && key !== source);
      return null;
    case 'natural_habitat':
      return count ? null : boardStep('Choose Verdant Terrain with an Entity', board, node => node.terrain === 'Verdant' && entity(node));
    case 'poseidons_chosen_one':
      return count ? null : (archive || []).filter(card => card.card_type === 'Entity').length >= 3
        ? { label: 'Choose an Entity to Recall', options: [
          ...archiveStep('Choose an Entity to Recall', archive, 'Entity').options,
          { label: 'Do not Recall', value: { type: 'skip' } },
        ] } : null;
    case 'regrow':
      if (count === 0) return boardStep('Choose Verdant Terrain to Dissolve', board, node => node.terrain === 'Verdant');
      if (first.protected) return null;
      if (count === 1) {
        const step = archiveStep('Choose an Entity to Recall', archive, 'Entity');
        const id = first.entity?.card_id || first.entity?.id;
        if (id && playerId && first.entity.owner_id === playerId) {
          step.options.unshift({ label: first.entity.title, value: { type: 'archive', id, dissolvedAt: source } });
        }
        return step;
      }
      return null;
    case 'skyfire_pair':
      if (count === 0) return boardStep('Choose an Entity adjacent to an opposing Entity', board,
        (node, key) => entity(node) && visibleCells(board).some(other => adjacent(key, other.key)
          && other.node.entity && other.node.entity.owner_id !== node.entity.owner_id));
      if (count === 1) return boardStep('Choose the adjacent opposing Entity', board,
        (node, key) => entity(node) && adjacent(source, key) && node.entity.owner_id !== first.entity?.owner_id);
      return null;
    case 'solar_bombardment':
      return count ? null : boardStep('Choose Terrain for Crisis', board, terrain);
    case 'spark_discard_recall':
    case 'sunken_archive':
      if (count === 0) return (archive || []).some(card => card.card_type ===
        (kind === 'spark_discard_recall' ? 'Event' : 'Entity')) ? discardStep(hand, eventIndex) : null;
      if (count === 1) return archiveStep('Choose a card to Recall', archive,
        kind === 'spark_discard_recall' ? 'Event' : 'Entity');
      return null;
    case 'symbiotic_accord':
      if (count === 0) return boardStep('Choose Terrain adjacent to Symbiosis', board,
        (node, key) => terrain(node) && visibleCells(board).some(other =>
          adjacent(key, other.key) && other.node.terrain === 'Symbiosis'));
      if (count === 1) return terrainStep('Choose the replacement Terrain', first.terrain);
      return null;
    case 'terrestrial_reorientation':
      if (count === 0) return boardStep('Choose entangled Symbiosis Terrain', board,
        (node, key) => node.terrain === 'Symbiosis' && node.entanglements?.length === 1
          && ['Flow', 'Verdant', 'Radiance'].includes(board[node.entanglements[0]]?.terrain)
          && adjacent(key, node.entanglements[0]) && board[node.entanglements[0]].entanglements?.includes(key));
      if (count === 1) {
        const linked = first.entanglements?.[0];
        if (!linked || first.terrain !== 'Symbiosis' || !board[linked]?.entanglements?.includes(source)) return null;
        const group = adjacentSymbiosisGroup(board, source);
        const neighbors = visibleCells(board);
        return boardStep('Choose an unentangled Symbiosis Terrain in the same group', board,
          (node, key) => key !== source && group.has(key) && !entangled(node)
            && neighbors.some(other => canRelocateEntanglementToNeighbor(other.node, other.key, key)));
      }
      if (count === 2) return boardStep('Choose an adjacent non-Symbiosis Terrain to Entangle', board,
        (node, key) => canRelocateEntanglementToNeighbor(node, key, cells[1]));
      return null;
    case 'waterish_doppelganger':
      return count ? null : boardStep('Choose an Entity to transform to Flow', board, entity);
    case 'wave_of_change':
      if (count === 0) return boardStep('Choose the first Terrain', board, terrain);
      if (count === 1) return boardStep('Choose the second Terrain', board, (node, key) => terrain(node) && key !== source);
      return null;
    default:
      return null;
  }
}
