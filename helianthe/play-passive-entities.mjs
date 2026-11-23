const passiveEffects = {
  "Eldervine's Vigil": ['vigil', "terrains can't be created on adjacent fertilized nodes. entities can't be placed on adjacent terrains."],
  'Sporebound Relay': ['relay', 'entities on all entangled non-symbiosis terrains has no effect.'],
  'Undying Mycelium Network': ['network', 'if any entity or terrain of the group of symbiosis terrains that this entity belongs to is dissolve, dissolve this entity first. if this terrain is protected, unprotect it first.'],
};

export function passiveEntityKind(card) {
  const rule = passiveEffects[String(card?.title || '').replaceAll('’', "'")];
  const text = String(card?.effect || '').replaceAll('’', "'").replace(/\s+/g, ' ').trim().toLowerCase();
  return rule?.[1] === text ? rule[0] : null;
}

const linkedNonSymbiosis = node => Boolean(node?.terrain && node.terrain !== 'Symbiosis' && node.entanglements?.length);

export function entityEffectsSuppressed(board, key) {
  return linkedNonSymbiosis(board?.[key]) && Object.values(board).some(node =>
    !linkedNonSymbiosis(node) && passiveEntityKind(node?.entity) === 'relay');
}

export function vigilBlocksPlacement(board, key) {
  if (!key) return false;
  const [x, y] = key.split(',').map(Number);
  return [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].some(([column, row]) => {
    const neighbor = `${column},${row}`;
    return passiveEntityKind(board?.[neighbor]?.entity) === 'vigil' && !entityEffectsSuppressed(board, neighbor);
  });
}

export function vigilBlocksCreation(board, key) {
  return Boolean(board?.[key]?.fertilize) && vigilBlocksPlacement(board, key);
}
