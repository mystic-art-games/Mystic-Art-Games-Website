// The hosted editor uses the same 750 × 1050 drawing geometry as the local
// Card Editor. Preview and exported PNG both render onto a 1500 × 2100 canvas.
const ASSETS = new URL('./assets/', import.meta.url);
const DEFAULT_ARTWORK = asset('Poseidons_Chosen_One_Comic.png?v=3');
const imageCache = new Map();
const terrainColors = { Symbiosis: '#784997', Flow: '#428da7', Verdant: '#68a66c', Radiance: '#e0b52f' };
const terrainBackgrounds = {
  Symbiosis: 'Terrain_Watercolor_Symbiosis.png',
  Flow: 'Terrain_Watercolor_Flow.png',
  Verdant: 'Terrain_Watercolor_Verdant.png',
  Radiance: 'Terrain_Watercolor_Radiance.png',
};
const eventBackground = 'Terrain_Watercolor_Event.png';
const cardFont = 'Nunito';
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

function drawFrameWithBackground(ctx, frame, background, accent) {
  if (!background) {
    ctx.drawImage(frame, 0, 0, 750, 1050);
    return;
  }
  const frameCanvas = document.createElement('canvas');
  frameCanvas.width = 750; frameCanvas.height = 1050;
  const frameCtx = frameCanvas.getContext('2d');
  frameCtx.drawImage(frame, 0, 0, 750, 1050);
  const frameData = frameCtx.getImageData(0, 0, 750, 1050);
  // Follow the actual opaque silhouette: the PNG's bottom margin and corner
  // shapes differ from the canvas bounds and between Terrain templates.
  const left = new Int32Array(1050).fill(750);
  const right = new Int32Array(1050).fill(-1);
  const top = new Int32Array(750).fill(1050);
  const bottom = new Int32Array(750).fill(-1);
  for (let y = 0; y < 1050; y++) {
    for (let x = 0; x < 750; x++) {
      if (frameData.data[(y * 750 + x) * 4 + 3] < 240) continue;
      left[y] = Math.min(left[y], x);
      right[y] = Math.max(right[y], x);
      top[x] = Math.min(top[x], y);
      bottom[x] = Math.max(bottom[x], y);
    }
  }
  const watercolorCanvas = document.createElement('canvas');
  watercolorCanvas.width = 750; watercolorCanvas.height = 1050;
  const watercolorCtx = watercolorCanvas.getContext('2d');
  watercolorCtx.drawImage(background, -150, 0, 1050, 1050);
  const watercolorData = watercolorCtx.getImageData(0, 0, 750, 1050);
  const channelMeans = [0, 0, 0];
  for (let i = 0; i < watercolorData.data.length; i += 4) {
    channelMeans[0] += watercolorData.data[i];
    channelMeans[1] += watercolorData.data[i + 1];
    channelMeans[2] += watercolorData.data[i + 2];
  }
  const pixelCount = watercolorData.data.length / 4;
  for (let channel = 0; channel < 3; channel++) channelMeans[channel] /= pixelCount;
  const accentRgb = accent.match(/[\da-f]{2}/gi).map(value => parseInt(value, 16));
  for (let i = 0; i < frameData.data.length; i += 4) {
    const r = frameData.data[i], g = frameData.data[i + 1], b = frameData.data[i + 2];
    const isCreamSurface = r > 170 && g > 140 && b > 90 && r >= g * 0.92 && g >= b * 0.9;
    const pixel = i / 4;
    const x = pixel % 750, y = Math.floor(pixel / 750);
    const onOuterRim = x <= left[y] + 5 || x >= right[y] - 5
      || y <= top[x] + 5 || y >= bottom[x] - 5;
    if (isCreamSurface || onOuterRim) {
      for (let channel = 0; channel < 3; channel++) {
        const wash = watercolorData.data[i + channel];
        const evenWash = channelMeans[channel] + (wash - channelMeans[channel]) * 1.05;
        const tintedPaper = 255 * 0.55 + accentRgb[channel] * 0.45;
        frameData.data[i + channel] = Math.max(0, Math.min(255, Math.round(evenWash * 0.58 + tintedPaper * 0.42)));
      }
    }
  }
  frameCtx.putImageData(frameData, 0, 0);
  ctx.drawImage(frameCanvas, 0, 0);
}

async function fontsReady() {
  await Promise.all([
    document.fonts.load(`36px ${cardFont}`),
    document.fonts.load('500 28px Nunito'),
    document.fonts.load('700 28px Nunito'),
  ]);
}

export async function renderCard(canvas, card, artworkUrl = '', shouldDraw = () => true, options = {}) {
  const type = card.card_type || card.type || 'Entity';
  const terrain = Object.hasOwn(terrainColors, card.terrain) ? card.terrain : null;
  if (canvas.parentElement?.classList.contains('card-terrain-aura')) {
    canvas.parentElement.dataset.terrain = terrain || (type === 'Event' ? 'Event' : '');
  }
  const frameName = `CardFrame_${terrain || 'Event'}.png`;
  const symbolName = type === 'Patron' ? 'Type_Patron_Simple.png' : type === 'Event' ? 'Type_Event_Scroll_v2.png' : 'Type_Entity_Simple.png';
  const backgroundName = terrain ? terrainBackgrounds[terrain] : type === 'Event' ? eventBackground : null;
  const [frame, art, symbol, background, neutralFaction] = await Promise.all([
    loadImage(asset(frameName)), loadImage(artworkUrl || DEFAULT_ARTWORK), loadImage(asset(symbolName)),
    loadImage(backgroundName ? asset(backgroundName) : ''), loadImage(!terrain ? asset('Faction_Nomads.png') : ''), fontsReady().catch(() => null),
  ]);
  if (!shouldDraw()) return { cancelled: true };
  if (!frame) throw new Error('The card frame could not be loaded.');
  canvas.width = 1500; canvas.height = 2100;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(2, 0, 0, 2, 0, 0);
  ctx.clearRect(0, 0, 750, 1050);
  ctx.save();
  ctx.beginPath(); ctx.roundRect(0, 0, 750, 1050, 32); ctx.clip();
  drawFrameWithBackground(ctx, frame, background, terrain ? terrainColors[terrain] : '#909592');

  // The artwork is drawn inside the blank window, leaving the painted border visible.
  const illustrationBox = { x: 55, y: 145, width: 640, height: 482 };
  if (art) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(375, 145);
    ctx.bezierCurveTo(550, 145, 695, 193, 695, 285);
    ctx.lineTo(695, 553); ctx.quadraticCurveTo(695, 627, 625, 627);
    ctx.lineTo(125, 627); ctx.quadraticCurveTo(55, 627, 55, 553);
    ctx.lineTo(55, 285); ctx.bezierCurveTo(55, 193, 200, 145, 375, 145);
    ctx.clip();
    const ratio = Math.max(illustrationBox.width / art.width, illustrationBox.height / art.height);
    const width = art.width * ratio, height = art.height * ratio;
    ctx.drawImage(art, illustrationBox.x + (illustrationBox.width - width) / 2, illustrationBox.y + (illustrationBox.height - height) / 2, width, height);
    ctx.restore();
  }

  const title = (card.title || 'New card').replace(/\s+/g, ' ').trim() || 'New card';
  canvas.setAttribute('aria-label', `${title}, ${type} card preview`);
  let titleSize = 12;
  for (let size = 56; size >= 12; size--) {
    ctx.font = `800 ${size}px ${cardFont}`;
    if (ctx.measureText(title).width <= 410) { titleSize = size; break; }
  }
  const titleCenterY = 87;
  const leftIconX = 74;
  const rightIconX = 676;
  function drawTypeIcon(x) {
    if (!symbol) return;
    const scale = Math.min(44 / symbol.width, 44 / symbol.height);
    const width = symbol.width * scale;
    const height = symbol.height * scale;
    ctx.save();
    ctx.filter = terrain ? ({ Symbiosis: 'hue-rotate(240deg)', Flow: 'hue-rotate(160deg)', Verdant: 'hue-rotate(95deg)' }[terrain] || 'none') : 'grayscale(1)';
    ctx.drawImage(symbol, x - width / 2, 180 - height / 2, width, height);
    ctx.restore();
  }
  if (!options.hideIcons) {
    if (neutralFaction) {
      for (const x of [88, 662]) {
        ctx.fillStyle = '#fff7e8';
        ctx.beginPath(); ctx.arc(x, 82, 48, 0, Math.PI * 2); ctx.fill();
        ctx.drawImage(neutralFaction, x - 42, 40, 84, 84);
      }
    }
    drawTypeIcon(leftIconX); drawTypeIcon(rightIconX);
  }
  ctx.font = `800 ${titleSize}px ${cardFont}`;
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
    ctx.save(); ctx.font = `500 26px ${rulesFont}`; ctx.fillStyle = '#4d463f'; ctx.textAlign = 'center';
    ctx.fillText(card.author, 375, 968, 470); ctx.restore();
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
