import { definitionNamePattern } from '@on.auto/definitions';
import type { DocumentIssue, SourceLines } from '@on.auto/definitions/document';

import { refusedAt } from './checked-parts.ts';

export function functionNameIssues(name: string, at: string, lines: SourceLines): readonly DocumentIssue[] {
  return definitionNamePattern.test(name)
    ? []
    : refusedAt(
        lines,
        at,
        `${name} is not the name of a function: 3 to 48 lowercase letters, digits and hyphens, starting with a letter`,
      );
}
