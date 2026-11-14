import type { PortableText, TextPlace } from './package-texts.ts';
import { isUrl, matchedIn, type Matched, type ValueClass } from './value-classes.ts';

export const BLANK_NAME = /^[A-Z][A-Z0-9_]{1,39}$/u;

export interface BlankSpan {
  readonly name: string;
  readonly from: number;
  readonly to: number;
}

export interface BlankPlace {
  readonly name: string;
  readonly line: number;
}

type Placed = TextPlace & { readonly line: number };

export interface StandingBlank {
  readonly name: string;
  readonly occurrences: readonly (TextPlace & { readonly line: number })[];
}

const token = /(?<![A-Za-z0-9_])AUTO_BLANK_([A-Z][A-Z0-9_]{1,39})(?![A-Za-z0-9_])/gu;
const blankHost =
  /(?<![A-Za-z0-9_])(?:([A-Za-z][A-Za-z0-9_]{1,39})@)?([A-Za-z][A-Za-z0-9_]{1,39})\.blank\.invalid(?![A-Za-z0-9_-]|\.[A-Za-z0-9])/giu;

export function blankFor(found: { readonly class: ValueClass; readonly value: string }, name: string): string {
  const lower = name.toLowerCase();
  if (found.class !== 'address') return `AUTO_BLANK_${name}`;
  if (isUrl(found.value)) return `https://${lower}.blank.invalid/`;
  if (found.value.includes('@')) return `${lower}@${lower}.blank.invalid`;
  return `${lower}.blank.invalid`;
}

export function blankSpansIn(text: string): BlankSpan[] {
  return [
    ...matchedIn(text, token).map(({ text: written, groups, at }: Matched) => ({
      name: String(groups[1]),
      from: at,
      to: at + written.length,
    })),
    ...matchedIn(text, blankHost).map(({ text: written, groups, at }: Matched) => ({
      name: String(groups[2]).toUpperCase(),
      from: at,
      to: at + written.length,
    })),
  ].toSorted((left: BlankSpan, right: BlankSpan) => left.from - right.from);
}

export function lineAt(text: string, at: number): number {
  return text.slice(0, at).split('\n').length;
}

export function blankPlacesIn(text: string): BlankPlace[] {
  return blankSpansIn(text).map(({ name, from }) => ({ name, line: lineAt(text, from) }));
}

export function blanksStanding(texts: readonly PortableText[]): StandingBlank[] {
  const byName = new Map<string, (TextPlace & { readonly line: number })[]>();
  for (const { text, ...place } of texts) {
    for (const { name, line } of blankPlacesIn(text)) {
      const occurrences = byName.get(name) ?? [];
      if (!occurrences.some((seen) => JSON.stringify(seen) === JSON.stringify({ ...place, line }))) {
        occurrences.push({ ...place, line });
      }
      byName.set(name, occurrences);
    }
  }
  return Array.from(byName, ([name, occurrences]: readonly [string, readonly Placed[]]) => ({ name, occurrences }));
}
