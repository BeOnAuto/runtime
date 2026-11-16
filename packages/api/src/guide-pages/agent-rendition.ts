import { withoutSiteMarkup } from '../guides/site-markup.ts';
import { readingOf } from './page-reading.ts';
import { lexed } from './page-tokens.ts';
import type { Edit } from './reading.ts';
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

export function forTheAgent(path: string, written: string): string {
  const { edits, faults } = readingOf(written);
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

export function markingFaultsOf(page: string): readonly string[] {
  return readingOf(page).faults;
}
