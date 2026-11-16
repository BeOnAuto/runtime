import type { GuideVariables } from '@on.auto/definitions';

import type { Placed } from './page-tokens.ts';

export interface PageRead {
  readonly text: string;
  readonly placed: readonly Placed[];
  readonly variables: GuideVariables;
}

export interface Here {
  readonly index: number;
  readonly placed: Placed;
}

export function isSpace(page: PageRead, index: number): boolean {
  return page.placed.slice(index, index + 1).some(({ token }) => token.type === 'space');
}

export function isEdge(page: PageRead, index: number): boolean {
  return index < 0 || index >= page.placed.length || isSpace(page, index);
}
