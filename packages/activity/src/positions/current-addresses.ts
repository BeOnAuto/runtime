import {
  carriedPagesIn,
  pagesSavedAsDefinitionsType,
  playbookSubject,
  type CarriedPage,
  type CarriedPages,
} from '@on.auto/definitions/page';
import type { PlaybookReader } from '@on.auto/operations';
import { Effect } from 'effect';

import { definitionsSegment, isVersion, playbooksSegment } from './activity-addresses.ts';

export type PagesOfTheirOwn = ReadonlyMap<string, string>;

export const noPagesOfTheirOwn: PagesOfTheirOwn = new Map();

const partsSegment = 'parts';

const runsPart = /^runs-/u;

const earlierRunsPart = /\/parts\/lately-(?=[1-9])/u;

export function pagesOfTheirOwnIn(carried: CarriedPages): PagesOfTheirOwn {
  return new Map([...carried].map(([subject, { name }]: readonly [string, CarriedPage]) => [name, subject]));
}

export const pagesOfTheirOwn: Effect.Effect<PagesOfTheirOwn, never, PlaybookReader> = Effect.map(
  carriedPagesIn,
  pagesOfTheirOwnIn,
);

export interface PageOfItsOwn {
  readonly playbook: string;
  readonly name: string;
  readonly version: string;
  readonly rest: readonly string[];
}

export function pageOfItsOwnIn(address: string): PageOfItsOwn | undefined {
  const [playbook = '', definitions, type, name = '', version = '', ...rest] = address.split('/');
  return definitions === definitionsSegment && type === pagesSavedAsDefinitionsType && isVersion(version)
    ? { playbook, name, version, rest }
    : undefined;
}

function ofThePlaybook(playbook: string, [parts, part = '', ...beyond]: readonly string[]): string {
  const ofItsPage = parts === partsSegment && beyond.length === 0 && runsPart.test(part);
  return ofItsPage ? `${playbooksSegment}/${playbook}/${partsSegment}/${part}` : `${playbooksSegment}/${playbook}`;
}

export function currentAddressOf(recorded: string, pages: PagesOfTheirOwn): string {
  const address = recorded.replace(earlierRunsPart, '/parts/runs-');
  const page = pageOfItsOwnIn(address);
  const subject = page === undefined ? undefined : pages.get(page.name);
  if (page === undefined || subject === undefined) {
    return address;
  }
  return subject === playbookSubject
    ? ofThePlaybook(page.playbook, page.rest)
    : `${page.playbook}/${definitionsSegment}/${subject}`;
}

export function pagesOfTheirOwnOf(pages: PagesOfTheirOwn, type: string, name: string): readonly string[] {
  const subject = `${type}/${name}`;
  return [...pages]
    .filter(([, presented]: readonly [string, string]) => presented === subject)
    .map(([page]: readonly [string, string]) => `${pagesSavedAsDefinitionsType}/${page}`);
}
