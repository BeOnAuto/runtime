const token = "[!#$%&'*+.^_`|~0-9A-Za-z-]+";

const mediaRange = new RegExp(`^(?:\\*/\\*|${token}/\\*|${token}/${token})$`, 'u');

const jsonMediaType = /^application\/(?:[\w.-]+\+)?json$/u;

const writtenAsUtf8 = 'charset=utf-8';

export const plainText = 'text/plain';

export function essenceOf(written: string): string {
  return written.split(';', 1).join('').trim().toLowerCase();
}

export function isJsonType(written: string): boolean {
  return jsonMediaType.test(essenceOf(written));
}

export function isMediaRange(written: string): boolean {
  return mediaRange.test(essenceOf(written));
}

export function isMediaType(written: string): boolean {
  return isMediaRange(written) && !essenceOf(written).includes('*');
}

export function isSpecific(range: string): boolean {
  return !essenceOf(range).includes('*');
}

export function covers(range: string, given: string): boolean {
  const [rangeType, rangeSubtype] = essenceOf(range).split('/');
  const [givenType, givenSubtype] = essenceOf(given).split('/');
  if (rangeType === '*') {
    return true;
  }
  return rangeType === givenType && (rangeSubtype === '*' || rangeSubtype === givenSubtype);
}

export function rangesIn(written: string): readonly string[] {
  return written
    .split(',')
    .map((each) => each.trim())
    .filter((each) => each !== '');
}

export function sentAs(mediaType: string): string {
  const essence = essenceOf(mediaType);
  return essence.startsWith('text/') || isJsonType(essence) ? `${essence}; ${writtenAsUtf8}` : essence;
}
