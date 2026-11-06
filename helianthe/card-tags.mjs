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

// Reviewed against the current Card Editor effects on 2026-11-06.
// Cards with blank, obsolete, or only placement-restriction text have no seed tag.
const TITLES_BY_TAG = {
  'cantrip': ['Breachside Repairs', 'Grid Stabilization', 'Landshift', 'Restoration Nursery', 'Seed Convoy', 'Verdant Vineroots'],
  'card-draw': ['Breachside Repairs', 'Expansive Ivy', 'Feel the Power', 'Festival of New Canopies', 'Garden of Shared Roots', 'Grid Stabilization', 'Landshift', 'Mirrorpool Shrine', 'Mossveil Settlement', 'Natural Habitat', 'Path of Radiance', 'Radiantide', 'Restoration Nursery', 'Seed Caravan', 'Seed Convoy', 'Seedbank Pavilion', 'Solar Commons', 'Symbiotic Accord', 'Terrace Keepers', 'The High Seas', 'Tideglass Lagoon', 'Verdant Vineroots', 'Wood Wide Web', 'Myrr, The Rootweaver', 'Solen, Architect of Dawn'],
  'card-selection': ['Depthcloak', 'Festival of New Canopies', 'Seed Caravan', 'Seedbank Pavilion', 'Myrr, The Rootweaver'],
  'removal': ['Compost Front', 'Lilac Overgrowth', 'Raincatcher Terraces', 'Skyfire', 'Solar Bombardment', 'Verdant Faultline'],
  'terrain-creation': ['Dreamwell Courtyard', 'Garden of Shared Roots', 'Green Reclamation', 'Greenway Advance', 'Habitat Loom', 'Land Gift', 'Lumen Workshop District', 'Migration of Wind-Sails', 'Mirrorpool Shrine', 'Moss-Covered Viaduct', 'Seed Caravan', 'Seedlight Grove', 'Sludge Bath', 'Spreading Ivy'],
  'transformation': ['Bubble Switch', 'Grid Reconfiguration', 'Rootline Breach', 'Sporebound Relay', 'Stewards’ Repair Protocols', 'Waterish Doppelganger'],
  'fertilize': ['Expansive Ivy', 'Fertile Rain', 'Hypervine', 'Land Gift', 'Orchard Warden', 'Seed Convoy', 'Through Fire Reborn', 'Verdant Vineroots'],
  'crisis': ['Controlled Overload', 'Glassroad Station', 'Helianthus Nursery', 'Sludge Bath', 'Solar Bombardment', 'Solar Converter'],
  'restoration': ['Green Reclamation', 'Grid Stabilization', 'Reclamation Pulse', 'Restoration Nursery', 'Rootline Breach', 'Suncoil Fields', 'Symbiotic Accord'],
  'protection': ['Glade Surveyor', 'Heart of Aurelia', 'Helianthus Nursery', "Lil' Liss, The Green Renegade", 'Liquid Protection', 'Moss Bastion', 'Radiant Lock', 'Radiant Protector', 'Solar Converter', 'Static Insulation', 'Undying Mycelium Network'],
  'lumens': ['Battery Orchard', 'Beacon Grid', 'Breachside Repairs', 'Controlled Overload', 'Efficient Grid', 'Electrostatic Spread', 'Feel the Power', 'Heart of Aurelia', 'Impulse Transmittion', "Lil' Liss Bandito", 'Path of Radiance', 'Solar Converter', 'Sunwire Avenue', 'Sunwire Spire', 'Solen, Architect of Dawn'],
  'recall': ['Bramble Briar', 'Memories of Atlantis', "Poseidon's Chosen One", 'Regrow', 'Rematerialize', 'Spark of Invention', 'Sunken Archive'],
  'relocation': ['Bubble Swap', 'Bubble Switch', 'Drownsomnia', 'Helianthus Nursery', 'Hyphae', 'Hyphal Reorientation', 'Impulse Transmittion', 'Landshift', 'Lanternhollow', "Lil' Liss Bandito", 'Wave of Change'],
  'entangle': ['Chrystofoles, The Rootwright', 'Fungal Rainwood', 'Garden of Shared Roots', 'Hyphal Reorientation', 'Kupala Night', 'Lanternhollow', 'Shared Canal Gathering'],
  'extra-play': ['Confluence', 'Depthcloak'],
  'lockdown': ["Eldervine's Vigil"],
  'scoring': ["Nautilus's Thought"],
};

export const CARD_TAG_SEED = Object.freeze(Object.entries(TITLES_BY_TAG).reduce((cards, [tag, titles]) => {
  for (const title of titles) (cards[title] ||= []).push(tag);
  return cards;
}, {}));

export const seedTagsForCard = title => CARD_TAG_SEED[title] || [];
