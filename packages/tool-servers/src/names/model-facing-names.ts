import { sha256Of } from '@on.auto/operations';

import { writtenOf, type ToolReference } from './tool-reference.ts';

export interface Referring {
  readonly reference: ToolReference;
}

const mostModelFacingCharacters = 64;

const hashCharacters = 8;

const unsafeCharacters = /[^A-Za-z0-9_]/gu;

const separator = '__';

function hashOf(tool: ToolReference): string {
  return sha256Of(writtenOf(tool)).slice(0, hashCharacters);
}

function plainNameOf({ server, tool }: ToolReference): string {
  return `${server}${separator}${tool}`.replaceAll(unsafeCharacters, '_');
}

export function endsAtTheFirstSeparator(server: string): boolean {
  const facing = server.replaceAll(unsafeCharacters, '_');
  return !facing.includes(separator) && !facing.endsWith('_');
}

function hashedNameOf(tool: ToolReference): string {
  const room = mostModelFacingCharacters - hashCharacters - 1;
  return `${plainNameOf(tool).slice(0, room)}_${hashOf(tool)}`;
}

function needsHash(name: string, plainNames: readonly string[]): boolean {
  return name.length > mostModelFacingCharacters || plainNames.indexOf(name) !== plainNames.lastIndexOf(name);
}

function distinctName(candidate: string, used: Set<string>): string {
  let name = candidate;
  for (let sequence = 1; used.has(name); sequence += 1) {
    const suffix = `_${sequence}`;
    name = `${candidate.slice(0, mostModelFacingCharacters - suffix.length)}${suffix}`;
  }
  used.add(name);
  return name;
}

export function modelFacingNames<Item extends Referring>(
  items: readonly Item[],
): readonly (Item & { readonly name: string })[] {
  const plainNames = items.map(({ reference }) => plainNameOf(reference));
  const used = new Set<string>();
  return items.map((item) => {
    const plain = plainNameOf(item.reference);
    const candidate = needsHash(plain, plainNames) ? hashedNameOf(item.reference) : plain;
    return { ...item, name: distinctName(candidate, used) };
  });
}
