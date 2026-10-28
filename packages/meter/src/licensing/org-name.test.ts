import { describe, expect, it } from 'vitest';

import { MOST_ORG_NAME_LENGTH, shownOrgName } from './org-name.ts';

describe('the name of an org as a runtime shows it', () => {
  it('is the name on one line, its control characters made spaces and its format characters taken out', () => {
    expect(shownOrgName('  Acme\n\tCorporation\u001B[2J ‮evil​ ')).toBe('Acme Corporation [2J evil');
  });

  it('is at most 80 characters, never splitting one', () => {
    expect(shownOrgName('😀'.repeat(100))).toBe('😀'.repeat(MOST_ORG_NAME_LENGTH));
    expect(shownOrgName(`${'a'.repeat(79)} b`)).toBe('a'.repeat(79));
  });

  it('is no name where the name is empty, spaces alone or nothing shown', () => {
    expect(['', '   ', '\n\t', '​‮', null, undefined].map((name) => shownOrgName(name))).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
  });
});
