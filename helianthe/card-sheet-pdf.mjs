const encoder = new TextEncoder();
const pointsPerMm = 72 / 25.4;
const pageWidth = 210 * pointsPerMm;
const pageHeight = 297 * pointsPerMm;
const cardWidth = 63 * pointsPerMm;
const cardHeight = 88 * pointsPerMm;
const leftMargin = (pageWidth - 3 * cardWidth) / 2;
const bottomMargin = (pageHeight - 3 * cardHeight) / 2;
const pdfNumber = value => value.toFixed(4);

function streamObject(bytes, dictionary = '') {
  return [`<< ${dictionary}/Length ${bytes.length} >>\nstream\n`, bytes, '\nendstream'];
}

export class CardSheetPDF {
  #images = [];
  #cards = [];

  async addCard(canvas, copies = 1) {
    const count = Math.trunc(Number(copies));
    if (!Number.isFinite(count) || count < 1) return;
    const printCanvas = document.createElement('canvas');
    printCanvas.width = canvas.width;
    printCanvas.height = canvas.height;
    const context = printCanvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Could not prepare the card for PDF.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, printCanvas.width, printCanvas.height);
    context.drawImage(canvas, 0, 0);
    const jpeg = await new Promise((resolve, reject) => printCanvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('Could not render a card for PDF.')),
      'image/jpeg', 0.98,
    ));
    const imageIndex = this.#images.push({
      bytes: new Uint8Array(await jpeg.arrayBuffer()),
      width: printCanvas.width,
      height: printCanvas.height,
    }) - 1;
    for (let copy = 0; copy < count; copy++) this.#cards.push(imageIndex);
  }

  toBlob() {
    if (!this.#cards.length) throw new Error('This deck has no cards to export.');
    const objects = [null, null];
    const imageIds = this.#images.map(({ bytes, width, height }) => objects.push(streamObject(
      bytes,
      `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode `,
    )));
    const pageIds = [];
    for (let start = 0; start < this.#cards.length; start += 9) {
      const cards = this.#cards.slice(start, start + 9);
      const commands = cards.map((imageIndex, position) => {
        const column = position % 3;
        const row = Math.floor(position / 3);
        const x = leftMargin + column * cardWidth;
        const y = bottomMargin + (2 - row) * cardHeight;
        return `q ${pdfNumber(cardWidth)} 0 0 ${pdfNumber(cardHeight)} ${pdfNumber(x)} ${pdfNumber(y)} cm /Im${imageIndex} Do Q`;
      }).join('\n');
      const contentId = objects.push(streamObject(encoder.encode(`${commands}\n`)));
      const images = [...new Set(cards)].map(index => `/Im${index} ${imageIds[index]} 0 R`).join(' ');
      pageIds.push(objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pdfNumber(pageWidth)} ${pdfNumber(pageHeight)}] /Resources << /XObject << ${images} >> >> /Contents ${contentId} 0 R >>`));
    }
    objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
    objects[1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

    const parts = [];
    const offsets = [0];
    let length = 0;
    const append = value => {
      const bytes = typeof value === 'string' ? encoder.encode(value) : value;
      parts.push(bytes);
      length += bytes.length;
    };
    append('%PDF-1.4\n');
    append(new Uint8Array([37, 226, 227, 207, 211, 10]));
    objects.forEach((object, index) => {
      offsets.push(length);
      append(`${index + 1} 0 obj\n`);
      for (const part of Array.isArray(object) ? object : [object]) append(part);
      append('\nendobj\n');
    });
    const xrefOffset = length;
    append(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
    for (const offset of offsets.slice(1)) append(`${String(offset).padStart(10, '0')} 00000 n \n`);
    append(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
    return new Blob(parts, { type: 'application/pdf' });
  }
}
