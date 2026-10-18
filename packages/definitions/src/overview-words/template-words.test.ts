import { describe, expect, it } from 'vitest';

import { paragraph, templateLead } from '../index.ts';

describe('the lead of a template read as a person reads it', () => {
  it('says that the names in bold stand for the values of each run, or of each build', () => {
    expect([templateLead('Its message', 'run'), templateLead('Its trainer reads the brief first', 'build')]).toEqual([
      paragraph('Its message, with the values of each run in place of the names in bold:'),
      paragraph('Its trainer reads the brief first, with the values of each build in place of the names in bold:'),
    ]);
  });
});
