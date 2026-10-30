import { Buffer } from 'node:buffer';
import { crc32, deflateRawSync } from 'node:zlib';

const pdfStrings = /[\\()]/gu;

function pdfStringOf(text: string): string {
  return `(${text.replaceAll(pdfStrings, (character) => `\\${character}`)})`;
}

function contentOf(lines: readonly string[]): string {
  const shown = lines.map((line) => `${pdfStringOf(line)} Tj 0 -16 Td`).join(' ');
  return `BT /F1 12 Tf 72 720 Td ${shown} ET`;
}

function streamOf(dictionary: string, content: string): string {
  return `<< ${dictionary}/Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`;
}

function pageObjectsOf(pages: readonly (readonly string[])[]): readonly string[] {
  return pages.flatMap((lines, index) => [
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${4 + index * 2 + 1} 0 R >>`,
    streamOf('', contentOf(lines)),
  ]);
}

function headObjectsOf(kids: readonly number[]): readonly string[] {
  return [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kids.map((kid) => `${kid} 0 R`).join(' ')}] /Count ${kids.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
}

export function pdfOfPages(pages: readonly (readonly string[])[]): Uint8Array {
  return pdfOf([...headObjectsOf(pages.map((_, index) => 4 + index * 2)), ...pageObjectsOf(pages)]);
}

function formOf(level: number, { fanOut, depth }: NestedDrawings): string {
  const form = '/Type /XObject /Subtype /Form /BBox [0 0 612 792] ';
  return level === depth - 1
    ? streamOf(`${form}/Resources << /Font << /F1 3 0 R >> >> `, 'BT /F1 12 Tf 10 10 Td (A) Tj ET')
    : streamOf(
        `${form}/Resources << /XObject << /X ${7 + level} 0 R >> >> `,
        Array.from({ length: fanOut }, () => '/X Do').join('\n'),
      );
}

export interface NestedDrawings {
  readonly fanOut: number;
  readonly depth: number;
}

export function pdfOfNestedDrawings(nested: NestedDrawings): Uint8Array {
  return pdfOf([
    ...headObjectsOf([4]),
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /X 6 0 R >> >> /Contents 5 0 R >>',
    streamOf('', '/X Do'),
    ...Array.from({ length: nested.depth }, (_, level) => formOf(level, nested)),
  ]);
}

function pdfOf(objects: readonly string[]): Uint8Array {
  let written = '%PDF-1.7\n';
  const offsets = objects.map((object, index) => {
    const offset = Buffer.byteLength(written, 'latin1');
    written += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const startOfTheTable = Buffer.byteLength(written, 'latin1');
  const entries = offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  written += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${entries}`;
  written += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startOfTheTable}\n%%EOF\n`;
  return Uint8Array.from(Buffer.from(written, 'latin1'));
}

function xmlTextOf(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

const contentTypes =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';

const relationships =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';

function paragraphOf(text: string): string {
  return `<w:p><w:r><w:t>${xmlTextOf(text)}</w:t></w:r></w:p>`;
}

function documentPartOf(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
}

interface ZipEntry {
  readonly path: string;
  readonly crc: number;
  readonly size: number;
  readonly compressedSize: number;
  readonly offset: number;
}

const zipDate = 0x21;

const deflated = 8;

const localSignature = 0x04_03_4b_50;

const centralSignature = 0x02_01_4b_50;

const endSignature = 0x06_05_4b_50;

function localHeaderOf({ path, crc, size, compressedSize }: ZipEntry): Buffer {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(localSignature, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(deflated, 8);
  header.writeUInt16LE(zipDate, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(compressedSize, 18);
  header.writeUInt32LE(size, 22);
  header.writeUInt16LE(Buffer.byteLength(path), 26);
  return Buffer.concat([header, Buffer.from(path)]);
}

function centralHeaderOf({ path, crc, size, compressedSize, offset }: ZipEntry): Buffer {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(centralSignature, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(deflated, 10);
  header.writeUInt16LE(zipDate, 14);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(compressedSize, 20);
  header.writeUInt32LE(size, 24);
  header.writeUInt16LE(Buffer.byteLength(path), 28);
  header.writeUInt32LE(offset, 42);
  return Buffer.concat([header, Buffer.from(path)]);
}

function endOf(files: number, size: number, offset: number): Buffer {
  const end = Buffer.alloc(22);
  end.writeUInt32LE(endSignature, 0);
  end.writeUInt16LE(files, 8);
  end.writeUInt16LE(files, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);
  return end;
}

function zipOf(files: readonly (readonly [string, string])[]): Uint8Array {
  const parts: Buffer[] = [];
  const entries: ZipEntry[] = [];
  let offset = 0;
  for (const [path, text] of files) {
    const data = deflateRawSync(text);
    const entry = { path, crc: crc32(text), size: Buffer.byteLength(text), compressedSize: data.length, offset };
    const local = localHeaderOf(entry);
    parts.push(local, data);
    entries.push(entry);
    offset += local.length + data.length;
  }
  const central = Buffer.concat(entries.map((entry) => centralHeaderOf(entry)));
  return Uint8Array.from(Buffer.concat([...parts, central, endOf(entries.length, central.length, offset)]));
}

function wordDocumentHolding(body: string): Uint8Array {
  return zipOf([
    ['[Content_Types].xml', contentTypes],
    ['_rels/.rels', relationships],
    ['word/document.xml', documentPartOf(body)],
  ]);
}

export function wordDocumentOf(paragraphs: readonly string[]): Uint8Array {
  return wordDocumentHolding(paragraphs.map((paragraph) => paragraphOf(paragraph)).join(''));
}

export function wordDocumentRepeating(paragraph: string, times: number): Uint8Array {
  return wordDocumentHolding(paragraphOf(paragraph).repeat(times));
}
