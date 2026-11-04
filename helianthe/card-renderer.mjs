// The hosted editor uses the same 750 × 1050 drawing geometry as the local
// Card Editor. Preview and exported PNG both render onto a 1500 × 2100 canvas.
const ASSETS = new URL('./assets/', import.meta.url);
const DEFAULT_ARTWORK = asset('Poseidons_Chosen_One_Comic.png?v=3');
const DEFAULT_ARTWORK_SCALE = 0.88;
const imageCache = new Map();
const artworkWindows = new WeakMap();
const iconBounds = new WeakMap();
// Centers of the enclosed paper circles in each 1024 × 1536 frame PNG.
const frameIconCenters = {
  Flow: { upper: [[116.5, 115], [902.5, 115]], lower: [[88.5, 246.5], [931.5, 247]] },
  Radiance: { upper: [[112.5, 113], [907, 113.5]], lower: [[85.5, 245], [935.5, 245]] },
  Verdant: { upper: [[115.5, 114], [903, 114.5]], lower: [[88, 246.5], [931, 246.5]] },
  Symbiosis: { upper: [[116, 115], [903, 115]], lower: [[88, 246], [932, 246]] },
  Neutral: { upper: [[111.5, 113], [905, 113.5]], lower: [[83.5, 245], [934, 245.5]] },
};
// Vertical centers of the enclosed title plates in the frame PNGs, at native resolution.
const titlePlateCenters = { Flow: 121.5, Radiance: 120, Verdant: 122, Symbiosis: 121.5, Neutral: 119 };
// Source-frame crop, balancing the outermost top ornaments with the side paper edge.
const frameVerticalInsets = {
  Flow: { top: 6, bottom: 11 },
  Radiance: { top: 4, bottom: 12 },
  Verdant: { top: 4, bottom: 11 },
  Symbiosis: { top: 4, bottom: 11 },
  Neutral: { top: 2, bottom: 13 },
};
const terrainColors = { Symbiosis: '#784997', Flow: '#428da7', Verdant: '#68a66c', Radiance: '#e0b52f' };
const factionSymbols = {
  Symbiosis: 'Faction_Symbiosis.png',
  Flow: 'Faction_Flow.png',
  Verdant: 'Faction_Verdant.png',
  Radiance: 'Faction_Radiance.png',
};
const cardFont = 'Alegreya';
const rulesFont = 'Nunito, Segoe UI, Arial, sans-serif';

function asset(name) { return new URL(name, ASSETS).href; }

function loadImage(url) {
  if (!url) return Promise.resolve(null);
  const load = () => new Promise(resolve => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
  if (url.startsWith('blob:')) return load();
  if (!imageCache.has(url)) imageCache.set(url, load());
  return imageCache.get(url);
}

function visibleIconCenter(icon) {
  if (iconBounds.has(icon)) return iconBounds.get(icon);
  const layer = document.createElement('canvas');
  layer.width = icon.width; layer.height = icon.height;
  const context = layer.getContext('2d');
  context.drawImage(icon, 0, 0);
  const pixels = context.getImageData(0, 0, layer.width, layer.height).data;
  let left = icon.width, right = -1, top = icon.height, bottom = -1;
  for (let y = 0; y < icon.height; y++) {
    for (let x = 0; x < icon.width; x++) {
      if (pixels[(y * icon.width + x) * 4 + 3] < 32) continue;
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
  }
  const center = right < 0 ? { x: icon.width / 2, y: icon.height / 2 }
    : { x: (left + right + 1) / 2, y: (top + bottom + 1) / 2 };
  iconBounds.set(icon, center);
  return center;
}

function artworkWindow(frame) {
  if (artworkWindows.has(frame)) return artworkWindows.get(frame);
  // Trace the enclosed paper inside this particular frame's ink outline.
  // Working at the PNG's native resolution preserves its hand-drawn contour.
  const mask = document.createElement('canvas');
  const width = mask.width = frame.naturalWidth;
  const height = mask.height = frame.naturalHeight;
  const context = mask.getContext('2d');
  context.drawImage(frame, 0, 0);
  const source = context.getImageData(0, 0, width, height).data;
  const pixels = context.createImageData(width, height);
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  const seed = Math.floor(height * 0.4) * width + Math.floor(width / 2);
  let head = 0, tail = 1;
  queue[0] = seed;
  visited[seed] = 1;
  let left = width, right = 0, top = height, bottom = 0;
  function enqueue(index) {
    if (visited[index]) return;
    visited[index] = 1;
    const offset = index * 4;
    const luminance = source[offset] * 0.2126 + source[offset + 1] * 0.7152 + source[offset + 2] * 0.0722;
    if (source[offset + 3] < 240 || luminance < 180) return;
    queue[tail++] = index;
  }
  while (head < tail) {
    const index = queue[head++];
    const x = index % width, y = Math.floor(index / width);
    pixels.data[index * 4 + 3] = 255;
    left = Math.min(left, x); right = Math.max(right, x);
    top = Math.min(top, y); bottom = Math.max(bottom, y);
    if (x > 0) enqueue(index - 1);
    if (x + 1 < width) enqueue(index + 1);
    if (y > 0) enqueue(index - width);
    if (y + 1 < height) enqueue(index + width);
  }
  if (left < width * 0.03 || right > width * 0.97 || top < height * 0.1 || bottom > height * 0.65) {
    throw new Error('The artwork window outline is not closed.');
  }
  context.putImageData(pixels, 0, 0);
  const window = { mask, left, top, width: right - left + 1, height: bottom - top + 1 };
  artworkWindows.set(frame, window);
  return window;
}

function drawArtwork(ctx, frame, art, scale = 1) {
  const window = artworkWindow(frame);
  const layer = document.createElement('canvas');
  layer.width = 1500; layer.height = 2100;
  const context = layer.getContext('2d');
  const scaleX = layer.width / frame.naturalWidth;
  const scaleY = layer.height / frame.naturalHeight;
  const boxWidth = window.width * scaleX, boxHeight = window.height * scaleY;
  const ratio = Math.max(boxWidth / art.width, boxHeight / art.height) * scale;
  const width = art.width * ratio, height = art.height * ratio;
  context.drawImage(art, window.left * scaleX + (boxWidth - width) / 2, window.top * scaleY + (boxHeight - height) / 2, width, height);
  context.globalCompositeOperation = 'destination-in';
  context.drawImage(window.mask, 0, 0, layer.width, layer.height);
  ctx.drawImage(layer, 0, 0, 750, 1050);
}

async function fontsReady() {
  await Promise.all([
    document.fonts.load(`700 36px ${cardFont}`),
    document.fonts.load('500 28px Nunito'),
    document.fonts.load('700 28px Nunito'),
    document.fonts.load('italic 500 26px Nunito'),
  ]);
}

export async function renderCard(canvas, card, artworkUrl = '', shouldDraw = () => true, options = {}) {
  const type = card.card_type || card.type || 'Entity';
  const terrain = Object.hasOwn(terrainColors, card.terrain) ? card.terrain : null;
  if (canvas.parentElement?.classList.contains('card-terrain-aura')) {
    canvas.parentElement.dataset.terrain = terrain || (type === 'Event' ? 'Event' : '');
  }
  const frameName = terrain === 'Radiance' ? 'Radiance_CardFrame_v2.png'
    : terrain ? `${terrain}_CardFrame.png` : 'Nomads_CardFrame_v2.png';
  const symbolType = type === 'Patron' ? 'Patron' : type === 'Event' ? 'Event' : 'Entity';
  const symbolName = `Type_${symbolType}_${terrain || 'Nomads'}.png`;
  const symbolVersion = terrain === 'Verdant' || terrain === 'Symbiosis' ? 3 : 2;
  const [frame, art, symbol, factionSymbol] = await Promise.all([
    loadImage(asset(`${frameName}?v=2`)), loadImage(artworkUrl || DEFAULT_ARTWORK), loadImage(asset(`${symbolName}?v=${symbolVersion}`)),
    loadImage(asset(terrain ? factionSymbols[terrain] : 'Faction_Nomads_Cairn.png')), fontsReady().catch(() => null),
  ]);
  if (!shouldDraw()) return { cancelled: true };
  if (!frame) throw new Error('The card frame could not be loaded.');
  canvas.width = 1500; canvas.height = 2100;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(2, 0, 0, 2, 0, 0);
  ctx.clearRect(0, 0, 750, 1050);
  ctx.save();
  ctx.beginPath(); ctx.roundRect(0, 0, 750, 1050, 32); ctx.clip();
  // Keep the outermost top ornaments and bottom ink equally spaced from the card edges.
  // The source frames have different top and bottom paper margins.
  const insetX = 6;
  const { top: insetTop, bottom: insetBottom } = frameVerticalInsets[terrain || 'Neutral'];
  const visibleFrameHeight = frame.naturalHeight - insetTop - insetBottom;
  ctx.translate(-750 * insetX / (frame.naturalWidth - 2 * insetX), -1050 * insetTop / visibleFrameHeight);
  ctx.scale(frame.naturalWidth / (frame.naturalWidth - 2 * insetX), frame.naturalHeight / visibleFrameHeight);
  ctx.drawImage(frame, 0, 0, 750, 1050);

  if (art) drawArtwork(ctx, frame, art, artworkUrl ? 1 : DEFAULT_ARTWORK_SCALE);

  const title = (card.title || 'New card').replace(/\s+/g, ' ').trim() || 'New card';
  canvas.setAttribute('aria-label', `${title}, ${type} card preview`);
  let titleSize = 12;
  for (let size = 56; size >= 12; size--) {
    ctx.font = `700 ${size}px ${cardFont}`;
    if (ctx.measureText(title).width <= 410) { titleSize = size; break; }
  }
  // Alegreya's visible letterforms need a slight downward optical correction in the nameplate.
  const titleCenterY = titlePlateCenters[terrain || 'Neutral'] * 1050 / frame.naturalHeight + 5;
  // Frame and icons share the inset transform already applied to the context.
  const framePoint = (x, y) => ({
    x: x * 750 / frame.naturalWidth,
    y: y * 1050 / frame.naturalHeight,
  });
  const centers = frameIconCenters[terrain || 'Neutral'];
  const upperIconCenters = centers.upper.map(([x, y]) => framePoint(x, y));
  const lowerIconCenters = centers.lower.map(([x, y]) => framePoint(x, y));
  function drawCenteredIcon(icon, { x, y }, size) {
    const center = visibleIconCenter(icon);
    const scale = Math.min(size / icon.width, size / icon.height);
    ctx.drawImage(icon, x - center.x * scale, y - center.y * scale, icon.width * scale, icon.height * scale);
  }
  function drawTypeIcon({ x, y }) {
    if (!symbol) return;
    drawCenteredIcon(symbol, { x, y }, 84);
  }
  if (!options.hideIcons) {
    for (const center of upperIconCenters) drawTypeIcon(center);
    if (factionSymbol) {
      for (const center of lowerIconCenters) drawCenteredIcon(factionSymbol, center, 44);
    }
  }
  ctx.font = `700 ${titleSize}px ${cardFont}`;
  ctx.fillStyle = '#302b27'; ctx.textAlign = 'center';
  const titleMetrics = ctx.measureText(title);
  const titleBaseline = titleCenterY + (titleMetrics.actualBoundingBoxAscent - titleMetrics.actualBoundingBoxDescent) / 2;
  ctx.fillText(title, 375, titleBaseline, 410); ctx.textAlign = 'left';

  function wrapText(value, maxWidth) {
    const lines = [];
    for (const paragraph of value.split('\n')) {
      if (!paragraph.trim()) { lines.push(''); continue; }
      let line = '';
      for (const word of paragraph.split(/\s+/)) {
        const proposed = line ? `${line} ${word}` : word;
        if (line && ctx.measureText(proposed).width > maxWidth) { lines.push(line); line = word; }
        else line = proposed;
      }
      lines.push(line);
    }
    return lines;
  }

  function fitText(value) {
    for (let size = 34; size >= 18; size--) {
      ctx.font = `500 ${size}px ${rulesFont}`;
      const lines = wrapText(value, 560);
      const verticalLimit = Math.floor((885 - 705) / (size * 1.25)) + 1;
      if (lines.length <= Math.min(8, verticalLimit)) return { lines, size, clipped: false };
    }
    ctx.font = `500 18px ${rulesFont}`;
    return { lines: wrapText(value, 560).slice(0, 8), size: 18, clipped: true };
  }

  const effect = card.effect?.trim() || 'Card effect text…';
  const fitted = fitText(effect);
  ctx.fillStyle = card.effect?.trim() ? '#112f40' : '#817586';
  ctx.font = `500 ${fitted.size}px ${rulesFont}`;
  let y = 705;
  let credoItalic = false;
  for (const line of fitted.lines) {
    let x = 95;
    const baseColor = ctx.fillStyle;
    for (const part of line.split(/(Credo:|Coredo:|Dusk:|\b\d+\b|Symbiosis|Flow|Verdant|Radiance)/g)) {
      if (!part) continue;
      ctx.fillStyle = terrainColors[part] || baseColor;
      const isLabel = /^(Dusk:|\d+)$/.test(part);
      ctx.font = `${credoItalic ? 'italic ' : ''}${isLabel ? 700 : 500} ${fitted.size}px ${rulesFont}`;
      ctx.fillText(part, x, y);
      x += ctx.measureText(part).width;
      if (/^(Credo:|Coredo:)$/.test(part)) credoItalic = true;
    }
    ctx.fillStyle = baseColor;
    y += fitted.size * 1.25;
  }
  if (fitted.clipped) { ctx.font = '700 14px Segoe UI,Arial,sans-serif'; ctx.fillStyle = '#b34739'; ctx.fillText('TEXT DOES NOT FIT ON CARD', 95, 895); }
  if (card.author) {
    ctx.save(); ctx.font = `italic 500 26px ${rulesFont}`; ctx.fillStyle = '#4d463f'; ctx.textAlign = 'center';
    const authorMetrics = ctx.measureText(card.author);
    const authorBaseline = 973 + (authorMetrics.actualBoundingBoxAscent - authorMetrics.actualBoundingBoxDescent) / 2;
    ctx.fillText(card.author, 375, authorBaseline, terrain ? 470 : 340); ctx.restore();
  }
  ctx.restore();
  return { clipped: fitted.clipped };
}

export function downloadCardPNG(canvas, title) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) { reject(new Error('Could not generate PNG.')); return; }
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${(title || 'card').replace(/[<>:"/\\|?*]/g, '_')}.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      resolve();
    }, 'image/png');
  });
}
