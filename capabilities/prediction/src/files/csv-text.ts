import { Buffer } from 'node:buffer';

const recordEnd = '\r\n';

const needsQuotes = /[",\r\n]/u;

export function fieldOf(text: string): string {
  return needsQuotes.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function cellText(value: number | null): string {
  return value === null ? '' : JSON.stringify(value);
}

export function recordOf(fields: readonly string[]): string {
  return `${fields.join(',')}${recordEnd}`;
}

export function byUtf8(one: string, other: string): number {
  return Buffer.compare(Buffer.from(one, 'utf8'), Buffer.from(other, 'utf8'));
}
