import type { GuideVariables } from '@on.auto/definitions';

type GuideVariable = GuideVariables[string];

import { withoutSiteMarkup } from '../guides/site-markup.ts';
import { readingOf } from './page-reading.ts';
import { lexed } from './page-tokens.ts';
import type { Edit } from './reading.ts';
import { holdsTheWholeValue } from './variable-forms.ts';
import { faultsOfARendition } from './whole-rendition.ts';

function withEdits(page: string, edits: readonly Edit[]): string {
  const ordered = edits.toSorted((one, other) => one.start - other.start);
  const kept = ordered.map(({ start, words }, index) => {
    const from = ordered.slice(index - 1, index).reduce((_end, { end }) => end, 0);
    return `${page.slice(from, start)}${words}`;
  });
  const from = ordered.slice(-1).reduce((_end, { end }) => end, 0);
  return `${kept.join('')}${page.slice(from)}`;
}

export function forTheAgent(path: string, written: string, variables: GuideVariables): string {
  const { edits, faults } = readingOf(written, variables);
  if (faults.length === 0 && edits.length === 0) {
    return withoutSiteMarkup(written);
  }
  const rendition = withoutSiteMarkup(withEdits(written, edits));
  const broken = faults.length > 0 ? faults : faultsOfARendition(rendition, lexed(rendition));
  if (broken.length > 0) {
    throw new Error(`The page ${path} cannot be served as a guide. ${broken.join(' ')}`);
  }
  return rendition;
}

export function markingFaultsOf(page: string, variables: GuideVariables): readonly string[] {
  const { faults, stale } = readingOf(page, variables);
  return [...faults, ...stale.map(({ fault }) => fault)];
}

export function defaultsTypedIn(path: string, page: string, variables: GuideVariables): readonly string[] {
  const unlikeAnyDefault = Object.fromEntries(
    Object.entries(variables).map(([name, variable]: readonly [string, GuideVariable]) => [
      name,
      { ...variable, value: `⟦${name}⟧` },
    ]),
  );
  const rendition = forTheAgent(path, page, unlikeAnyDefault);
  return Object.entries(variables)
    .filter(([, variable]: readonly [string, GuideVariable]) => holdsTheWholeValue(rendition, variable.default))
    .map(
      ([name, variable]: readonly [string, GuideVariable]) =>
        `${path} types "${variable.default}", the default of ${name}, where its value belongs.`,
    );
}

export function withDefaultsWritten(page: string, variables: GuideVariables): string {
  const { faults, stale } = readingOf(page, variables);
  if (faults.length > 0) {
    throw new Error(faults.join(' '));
  }
  return withEdits(
    page,
    stale.map(({ edit }) => edit),
  );
}
