// Strategy tags are editorial labels. They do not change card rules.
export const CARD_TAGS = [
  ['cantrip', 'Cantrip', 'Draw exactly one card alongside another effect.'],
  ['card-draw', 'Card Draw', 'Draw one or more cards.'],
  ['card-selection', 'Card Selection', 'See extra cards and choose or discard some.'],
  ['removal', 'Removal', 'Dissolve or destroy a chosen Entity or Terrain.'],
  ['terrain-creation', 'Terrain Creation', 'Create a Terrain card on a blank Node.'],
  ['transformation', 'Transformation', 'Change a Terrain or Entity type.'],
  ['fertilize', 'Fertilize', 'Place Fertilize tokens.'],
  ['crisis', 'Crisis', 'Apply or move Crisis.'],
  ['restoration', 'Restoration', 'Remove Crisis.'],
  ['protection', 'Protection', 'Add, move, remove, or grant protection.'],
  ['lumens', 'Lumens', 'Add, remove, move, or count Lumens.'],
  ['recall', 'Recall', 'Bring a card back from the Archive.'],
  ['relocation', 'Relocation', 'Move a card or marker to another Node.'],
  ['entangle', 'Entangle', 'Create, move, or use Entanglement.'],
  ['extra-play', 'Extra Play', 'Play an additional card.'],
  ['lockdown', 'Lockdown', 'Prevent placement or Terrain creation.'],
  ['scoring', 'Scoring', 'Change how cards contribute to a victory goal.'],
];

const TAG_IDS = new Set(CARD_TAGS.map(([id]) => id));
export const tagLabel = id => CARD_TAGS.find(([tag]) => tag === id)?.[1] || id;

export function normalizeCardTags(input) {
  const tags = [...new Set((Array.isArray(input) ? input : String(input || '').split(','))
    .map(tag => String(tag).trim().toLocaleLowerCase()).filter(Boolean))];
  if (tags.length > 12) throw new Error('Choose up to 12 tags.');
  if (tags.some(tag => !TAG_IDS.has(tag))) throw new Error('Choose tags from the list.');
  return tags;
}

// Reviewed against the current Card Editor effects on 2026-11-07.
// A blank effect has no tag. These seeds are used while the cards table lacks a tags column.
const TITLES_BY_TAG = {
  'cantrip': ['Breachside Repairs', 'Grid Stabilization', 'Landshift', 'Reclamation Pulse', 'Seed Convoy', 'Terrestrial Reorientation', 'Verdant Vineroots'],
  'card-draw': ['Breachside Repairs', 'Expansive Ivy', 'Feel the Power', 'Festival of New Canopies', 'Garden of Shared Roots', 'Grid Stabilization', 'Kupala Night', 'Landshift', 'Mirrorpool Shrine', 'Mossveil Settlement', 'Natural Habitat', 'Path of Radiance', 'Reclamation Pulse', 'River Pact Crossing', 'Seed Convoy', 'Solar Commons', 'Terrace Keepers', 'Terrestrial Reorientation', 'The High Seas', 'Verdant Vineroots', 'Wood Wide Web'],
  'card-selection': ['Drownsomnia', 'Festival of New Canopies'],
  'removal': ['Bramble Briar', 'Compost Front', 'Dematerialize', 'Fertile Rain', 'Fungal Rainwood', 'Glade Surveyor', 'Helianthus Nursery', 'Lilac Overgrowth', 'Memories of Atlantis', 'Reclamation Pulse', 'Regrow', 'Skyfire', 'Sludge Bath', 'Solar Bombardment', 'Through Fire Reborn'],
  'terrain-creation': ['Dreamwell Courtyard', 'Equatorial Forests', 'Garden of Shared Roots', 'Land Gift', 'Lumen Workshop District', 'Spreading Ivy', 'Tropical Rainfall'],
  'transformation': ['Bubble Switch', 'Green Reclamation', 'Symbiotic Accord', 'Waterish Doppelganger'],
  'fertilize': ['Expansive Ivy', 'Fertile Rain', 'Greenway Advance', 'Hypervine', 'Land Gift', 'Orchard Warden', 'Seed Convoy', 'Through Fire Reborn', 'Verdant Vineroots'],
  'crisis': ['Solar Bombardment', 'Solar Converter'],
  'restoration': [],
  'protection': ['Controlled Overload', 'Depthcloak', 'Glade Surveyor', 'Grid Stabilization', 'Heart of Aurelia', 'Helianthus Nursery', 'Liquid Protection', 'Memories of Atlantis', 'Moss Bastion', 'Radiant Lock', 'Radiant Protector', 'Reclamation Pulse', 'Solar Converter', 'Static Insulation', 'Tideglass Lagoon', 'Undying Mycelium Network', 'Verdant Faultline'],
  'lumens': ['Battery Orchard', 'Beacon Grid', 'Breachside Repairs', 'Controlled Overload', 'Efficient Grid', 'Electrostatic Spread', 'Feel the Power', 'Grid Stabilization', 'Heart of Aurelia', 'Heliotic Discharge', 'Impulse Transmittion', "Lil' Liss Bandito", 'Path of Radiance', 'Solar Converter', 'Sunwire Avenue', 'Sunwire Spire', 'Solen, Architect of Dawn'],
  'recall': ['Bramble Briar', 'Memories of Atlantis', "Poseidon's Chosen One", 'Regrow', 'Rematerialize', 'Spark of Invention', 'Sunken Archive'],
  'relocation': ['Bubble Swap', 'Bubble Switch', 'Glade Surveyor', 'Grid Reconfiguration', 'Helianthus Nursery', 'Hyphal Reorientation', 'Impulse Transmittion', 'Landshift', "Lil' Liss Bandito", 'March of Marshrooms', 'Migration of Wind-Sails', 'Sludge Bath', 'Terrestrial Reorientation', 'Wave of Change'],
  'entangle': ['Chrystofoles, The Rootwright', 'Fungal Rainwood', 'Garden of Shared Roots', 'Hyphae', 'Hyphal Reorientation', 'Kupala Night', 'Lanternhollow', 'March of Marshrooms', 'Myrr, The Rootweaver', 'Shared Canal Gathering', 'Sporebound Relay', 'Terrestrial Reorientation'],
  'extra-play': ['Confluence'],
  'lockdown': ['Drownsomnia', "Eldervine's Vigil"],
  'scoring': ['Depthcloak', "Nautilus's Thought"],
};

export const CARD_TAG_SEED = Object.freeze(Object.entries(TITLES_BY_TAG).reduce((cards, [tag, titles]) => {
  for (const title of titles) (cards[title] ||= []).push(tag);
  return cards;
}, {}));

export const seedTagsForCard = title => CARD_TAG_SEED[title] || [];
