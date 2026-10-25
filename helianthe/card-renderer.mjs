// The hosted editor uses the same 750 × 1050 drawing geometry as the local
// Card Editor. Preview and exported PNG both render onto a 1500 × 2100 canvas.
const ASSETS = new URL('./assets/', import.meta.url);
const imageCache = new Map();
const eventTints = new WeakMap();
const terrainColors = { Symbiosis: '#784997', Flow: '#428da7', Evergreen: '#68a66c', Radiance: '#e0b52f' };
const eventSymbolColors = { Symbiosis: '#784997', Flow: '#35758e', Evergreen: '#488057', Radiance: '#a87318' };
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

async function fontsReady() {
  await Promise.all([
    document.fonts.load(`36px ${cardFont}`),
    document.fonts.load('500 28px Nunito'),
    document.fonts.load('700 28px Nunito'),
  ]);
}

function tintedEventSymbol(image, terrain) {
  const color = eventSymbolColors[terrain] || '#909592';
  let variants = eventTints.get(image);
  if (!variants) { variants = new Map(); eventTints.set(image, variants); }
  if (!variants.has(color)) {
    const tinted = document.createElement('canvas');
    tinted.width = image.width; tinted.height = image.height;
    const paint = tinted.getContext('2d');
    paint.drawImage(image, 0, 0);
    paint.globalCompositeOperation = 'source-in';
    paint.fillStyle = color;
    paint.fillRect(0, 0, tinted.width, tinted.height);
    variants.set(color, tinted);
  }
  return variants.get(color);
}

export async function renderCard(canvas, card, artworkUrl = '', shouldDraw = () => true) {
  const type = card.card_type || card.type || 'Entity';
  const terrain = Object.hasOwn(terrainColors, card.terrain) ? card.terrain : null;
  const frameName = `Frame_${terrain || 'Event'}.svg`;
  const symbolName = type === 'Event' ? 'Event.png' : `Entity_${terrain || 'Flow'}.png`;
  const [frame, art, symbol] = await Promise.all([
    loadImage(asset(frameName)), loadImage(artworkUrl), loadImage(asset(symbolName)), fontsReady().catch(() => null),
  ]);
  if (!shouldDraw()) return { cancelled: true };
  if (!frame) throw new Error('The card frame could not be loaded.');
  canvas.width = 1500; canvas.height = 2100;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(2, 0, 0, 2, 0, 0);
  ctx.clearRect(0, 0, 750, 1050);
  ctx.save();
  ctx.beginPath(); ctx.roundRect(0, 0, 750, 1050, 32); ctx.clip();
  ctx.fillStyle = '#ece6d8'; ctx.fillRect(0, 0, 750, 1050);

  // The illustration stays fully inside the same safe area as the local editor.
  const artBox = { x: 66, y: 145, width: 618, height: 620 };
  const illustrationBox = { x: 112, y: 145, width: 526, height: 620 };
  if (art) {
    ctx.save();
    ctx.beginPath(); ctx.rect(illustrationBox.x, illustrationBox.y, illustrationBox.width, illustrationBox.height); ctx.clip();
    const ratio = Math.min(illustrationBox.width / art.width, illustrationBox.height / art.height);
    const width = art.width * ratio, height = art.height * ratio;
    ctx.drawImage(art, illustrationBox.x + (illustrationBox.width - width) / 2, illustrationBox.y + (illustrationBox.height - height) / 2, width, height);
    ctx.restore();
  } else {
    ctx.save();
    ctx.beginPath(); ctx.rect(artBox.x, artBox.y, artBox.width, artBox.height); ctx.clip();
    const gradient = ctx.createLinearGradient(0, artBox.y, 750, artBox.y + artBox.height);
    gradient.addColorStop(0, '#c5d7ba'); gradient.addColorStop(1, '#536e69');
    ctx.fillStyle = gradient; ctx.fillRect(artBox.x, artBox.y, artBox.width, artBox.height);
    ctx.globalAlpha = .26; ctx.strokeStyle = '#eef1d9'; ctx.lineWidth = 2;
    for (let x = -100; x < 850; x += 64) for (let y = 105; y < 665; y += 74) {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) { const a = Math.PI / 3 * i; const px = x + Math.cos(a) * 40; const py = y + Math.sin(a) * 40; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
      ctx.closePath(); ctx.stroke();
    }
    ctx.globalAlpha = 1; ctx.fillStyle = '#f3f0da'; ctx.textAlign = 'center'; ctx.font = `25px ${cardFont}`;
    ctx.fillText('Artwork placeholder', 375, 380); ctx.textAlign = 'left';
    ctx.restore();
  }
  ctx.drawImage(frame, 0, 0, 750, 1050);

  const title = (card.title || 'New card').replace(/\s+/g, ' ').trim() || 'New card';
  canvas.setAttribute('aria-label', `${title}, ${type} card preview`);
  let titleSize = 12;
  for (let size = 56; size >= 12; size--) {
    ctx.font = `${size}px ${cardFont}`;
    if (ctx.measureText(title).width <= 500) { titleSize = size; break; }
  }
  const plate = new Path2D();
  plate.moveTo(62, 29); plate.lineTo(688, 29); plate.bezierCurveTo(706, 29, 721, 44, 721, 62);
  plate.lineTo(721, 119); plate.bezierCurveTo(715, 140, 706, 150, 689, 150);
  plate.bezierCurveTo(566, 136, 487, 166, 384, 149); plate.bezierCurveTo(279, 133, 181, 168, 74, 150);
  plate.bezierCurveTo(44, 146, 29, 140, 29, 122); plate.lineTo(29, 77);
  plate.bezierCurveTo(29, 45, 37, 29, 62, 29); plate.closePath();
  ctx.save(); ctx.translate(3, 5); ctx.fillStyle = 'rgba(20, 40, 45, .45)'; ctx.fill(plate); ctx.restore();
  ctx.fillStyle = '#fff6e3'; ctx.strokeStyle = '#9d835d'; ctx.lineWidth = 7; ctx.lineJoin = 'round';
  ctx.fill(plate); ctx.stroke(plate); ctx.strokeStyle = '#fff9e9'; ctx.lineWidth = 3; ctx.stroke(plate);

  function drawTypeIcon(x) {
    ctx.save(); ctx.translate(x, 90); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (type === 'Event') { if (symbol) ctx.drawImage(tintedEventSymbol(symbol, terrain), -23, -23, 46, 46); }
    else if (symbol) ctx.drawImage(symbol, -27, -27, 54, 54);
    ctx.restore();
  }
  drawTypeIcon(78); drawTypeIcon(672);
  ctx.font = `${titleSize}px ${cardFont}`;
  ctx.fillStyle = type === 'Event' ? '#3b3b3b' : '#123747'; ctx.textAlign = 'center';
  ctx.fillText(title, 375, 105, 500); ctx.textAlign = 'left';

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
      const lines = wrapText(value, 630);
      const verticalLimit = Math.floor((928 - 790) / (size * 1.25)) + 1;
      if (lines.length <= Math.min(7, verticalLimit)) return { lines, size, clipped: false };
    }
    ctx.font = `500 18px ${rulesFont}`;
    return { lines: wrapText(value, 630).slice(0, 7), size: 18, clipped: true };
  }

  const effect = card.effect?.trim() || 'Card effect text…';
  const fitted = fitText(effect);
  ctx.fillStyle = card.effect?.trim() ? '#112f40' : '#817586';
  ctx.font = `500 ${fitted.size}px ${rulesFont}`;
  let y = 818;
  for (const line of fitted.lines) {
    let x = 59;
    const baseColor = ctx.fillStyle;
    for (const part of line.split(/(Dusk:|\b\d+\b|Symbiosis|Flow|Evergreen|Radiance)/g)) {
      if (!part) continue;
      ctx.fillStyle = terrainColors[part] || baseColor;
      ctx.font = `${/^(Dusk:|\d+)$/.test(part) ? 700 : 500} ${fitted.size}px ${rulesFont}`;
      ctx.fillText(part, x, y);
      x += ctx.measureText(part).width;
    }
    ctx.fillStyle = baseColor;
    y += fitted.size * 1.25;
  }
  if (fitted.clipped) { ctx.font = '700 14px Segoe UI,Arial,sans-serif'; ctx.fillStyle = '#b34739'; ctx.fillText('TEXT DOES NOT FIT ON CARD', 59, 940); }
  if (card.author) {
    ctx.save(); ctx.strokeStyle = '#c6cbbd'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(58, 962); ctx.lineTo(692, 962); ctx.stroke();
    ctx.font = `500 21px ${rulesFont}`; ctx.fillStyle = '#52676a';
    ctx.fillText(`Author · ${card.author}`, 58, 988, 620); ctx.restore();
  }
  ctx.lineWidth = 5; ctx.strokeStyle = '#000';
  ctx.beginPath(); ctx.roundRect(2.5, 2.5, 745, 1045, 29.5); ctx.stroke();
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
