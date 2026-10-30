import type { Position } from '../yaml/yaml-reading.ts';

const plainKey = /^[A-Za-z_][\w-]*$/u;

const index = /^\d+$/u;

function segmentsOf(pointer: string): readonly string[] {
  return pointer
    .split('/')
    .slice(1)
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'));
}

function partOf(segment: string, position: number): string {
  if (index.test(segment)) {
    return `[${segment}]`;
  }
  if (plainKey.test(segment)) {
    return position === 0 ? segment : `.${segment}`;
  }
  return `[${JSON.stringify(segment)}]`;
}

function keyPathOf(pointer: string): string {
  return segmentsOf(pointer)
    .map((segment, position) => partOf(segment, position))
    .join('');
}

export function placeIn(path: string, { line, column }: Position, pointer: string): string {
  const keyPath = keyPathOf(pointer);
  return keyPath === '' ? `${path}:${line}:${column}` : `${path}:${line}:${column} ${keyPath}`;
}
