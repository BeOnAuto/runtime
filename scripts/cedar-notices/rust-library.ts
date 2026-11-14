import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import { licenceFilesIn, type PackageFile } from './crate-notices.ts';

interface Read<T> {
  readonly value: T;
  readonly next: number;
}

const customSection = 0;

const firstSection = 8;

function unsignedAt(bytes: Readonly<Uint8Array>, offset: number): Read<number> {
  let value = 0;
  let shift = 0;
  let next = offset;
  let byte = 0x80;
  while (byte >= 0x80) {
    byte = bytes[next] ?? 0;
    value += (byte % 0x80) * 2 ** shift;
    shift += 7;
    next += 1;
  }
  return { value, next };
}

function nameAt(bytes: Readonly<Uint8Array>, offset: number): Read<string> {
  const length = unsignedAt(bytes, offset);
  const end = length.next + length.value;
  return { value: new TextDecoder().decode(bytes.subarray(length.next, end)), next: end };
}

function producersIn(bytes: Readonly<Uint8Array>, offset: number): readonly string[] {
  const fields = unsignedAt(bytes, offset);
  const named: string[] = [];
  let next = fields.next;
  for (let field = 0; field < fields.value; field += 1) {
    const values = unsignedAt(bytes, nameAt(bytes, next).next);
    next = values.next;
    for (let value = 0; value < values.value; value += 1) {
      const name = nameAt(bytes, next);
      const version = nameAt(bytes, name.next);
      named.push(`${name.value} ${version.value}`.trim());
      next = version.next;
    }
  }
  return named;
}

export function producersOf(bytes: Readonly<Uint8Array>): readonly string[] {
  let offset = firstSection;
  while (offset < bytes.length) {
    const size = unsignedAt(bytes, offset + 1);
    if (bytes[offset] === customSection && nameAt(bytes, size.next).value === 'producers') {
      return producersIn(bytes, nameAt(bytes, size.next).next);
    }
    offset = size.next + size.value;
  }
  return [];
}

export function compilerVersionOf(producers: readonly string[]): string {
  const compiler = producers.find((producer) => producer.startsWith('rustc '));
  if (compiler === undefined) {
    throw new Error('The WebAssembly names no rustc among its producers');
  }
  return compiler.slice('rustc '.length);
}

const entities: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" };

function plainTextOf(html: string): string {
  return html
    .replaceAll(/<[^>]+>/gu, '')
    .replaceAll(/&(amp|lt|gt|quot|#39);/gu, (_, name: string) => entities[name] ?? '')
    .replaceAll(/\s+/gu, ' ')
    .trim();
}

export interface InTreeNotice {
  readonly lines: readonly string[];
  readonly licenceIds: readonly string[];
}

const inTreePart = /In-tree files<\/h2>(?<part>[\s\S]*?)<h2 id="out-of-tree-dependencies">/u;

const blockOrParagraph = /<div\b[^>]*>|<\/div>|<p>(?<paragraph>[\s\S]*?)<\/p>/gu;

const licenceLine = /^License: (?<expression>.+)$/u;

function expressionOn(line: string): readonly string[] {
  const { expression } = licenceLine.exec(line.trim())?.groups ?? {};
  return expression === undefined ? [] : [expression];
}

export function inTreeNoticeOf(html: string): InTreeNotice {
  const { part } = inTreePart.exec(html)?.groups ?? {};
  if (part === undefined) {
    throw new Error("Rust's notice of the standard library has no part for its in-tree files");
  }
  const lines: string[] = [];
  let depth = 0;
  for (const { 0: token, groups } of part.matchAll(blockOrParagraph)) {
    depth += token.startsWith('<div') ? 1 : 0;
    depth -= token === '</div>' ? 1 : 0;
    const { paragraph = '' } = groups ?? {};
    const text = plainTextOf(paragraph);
    if (text !== '') {
      lines.push(`${'  '.repeat(Math.max(depth - 1, 0))}${text}`);
    }
  }
  const expressions = lines.flatMap((line) => expressionOn(line));
  const ids = expressions.flatMap((expression) => expression.split(/\s+(?:AND|OR|WITH)\s+|[()\s]+/u));
  return { lines, licenceIds: [...new Set(ids.filter((id) => id !== ''))].toSorted() };
}

export function licenceTextsIn(folder: string, ids: readonly string[]): readonly PackageFile[] {
  return ids.map((id) => ({ name: id, text: readFileSync(join(folder, `${id}.txt`), 'utf8') }));
}

interface LicenceFolder {
  readonly folder: string;
  readonly files: readonly PackageFile[];
}

function foldersUpTo(folder: string, workspaceFolder: string): readonly string[] {
  const below = relative(workspaceFolder, folder);
  return below === '' || below.startsWith('..') ? [] : [folder, ...foldersUpTo(dirname(folder), workspaceFolder)];
}

export function ownLicenceFiles(crateFolder: string, workspaceFolder: string): readonly PackageFile[] {
  const nearest = foldersUpTo(crateFolder, workspaceFolder)
    .map((folder): LicenceFolder => ({ folder, files: licenceFilesIn(folder) }))
    .find((candidate: Readonly<LicenceFolder>) => candidate.files.length > 0);
  return (nearest?.files ?? []).map(({ name, text }) => ({
    name: relative(crateFolder, join(nearest?.folder ?? crateFolder, name)),
    text,
  }));
}
