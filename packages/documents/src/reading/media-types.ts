import { pdfTextOf } from '../readers/pdf-text.ts';
import { plainTextOf } from '../readers/plain-text.ts';
import { wordTextOf } from '../readers/word-text.ts';
import type { DocumentReader, DocumentType } from './document-text.ts';

const pdfMediaType = 'application/pdf';

const wordMediaType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const unnamedBytes = 'application/octet-stream';

const textualApplicationTypes: ReadonlySet<string> = new Set([
  'application/json',
  'application/xml',
  'application/csv',
  'application/markdown',
  'application/yaml',
  'application/x-yaml',
]);

const textualSuffixes = /^application\/[\w.-]+\+(?:json|xml|yaml)$/u;

const typesOfExtensions: ReadonlyMap<string, string> = new Map([
  ['pdf', pdfMediaType],
  ['docx', wordMediaType],
  ['txt', 'text/plain'],
  ['md', 'text/markdown'],
  ['csv', 'text/csv'],
  ['json', 'application/json'],
  ['xml', 'application/xml'],
  ['yaml', 'application/yaml'],
  ['yml', 'application/yaml'],
]);

function extensionOf(name: string): string {
  const at = name.lastIndexOf('.');
  return at === -1 ? '' : name.slice(at + 1).toLowerCase();
}

const mediaTypeShape = /^[a-z\d][\w!#$&^.+-]*\/[a-z\d][\w!#$&^.+-]*$/u;

const charsetParameter = /;\s*charset\s*=\s*"?([^";\s]+)/iu;

export function documentTypeOf(written: string, name: string | undefined): DocumentType {
  const essence = written.split(';', 1).join('').trim().toLowerCase();
  const said = mediaTypeShape.test(essence) ? essence : unnamedBytes;
  const mediaType =
    said === unnamedBytes && name !== undefined ? (typesOfExtensions.get(extensionOf(name)) ?? said) : said;
  const charset = charsetParameter.exec(written);
  return { mediaType, charset: charset === null ? undefined : String(charset[1]).toLowerCase() };
}

function isText(mediaType: string): boolean {
  return mediaType.startsWith('text/') || textualApplicationTypes.has(mediaType) || textualSuffixes.test(mediaType);
}

export function readerOf(mediaType: string): DocumentReader | undefined {
  if (mediaType === pdfMediaType) {
    return pdfTextOf;
  }
  if (mediaType === wordMediaType) {
    return wordTextOf;
  }
  return isText(mediaType) ? plainTextOf : undefined;
}
