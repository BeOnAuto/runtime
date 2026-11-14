import { describe, expect, it } from 'vitest';

import { rejected, unsuccessfulWords } from '../index.ts';

describe('unsuccessfulWords of a refusal only the person can answer', () => {
  it("leads with the person's question, so a client that folds the rest still shows it", () => {
    expect(
      unsuccessfulWords(
        'create the playbook “sales”',
        'command',
        rejected('invalid_input', 'Ask the person: What change do you want from this? The goals have one problem.'),
      ),
    ).toBe(
      'Ask the person: What change do you want from this? The goals have one problem. Could not create the playbook “sales”: what was given does not fit what it needs. Nothing was changed. This can be corrected and tried again; the details below say what to change.',
    );
  });

  it('keeps the words of any other refusal as they are, its detail left to the details below', () => {
    expect(
      unsuccessfulWords(
        'create the playbook “sales”',
        'command',
        rejected('invalid_input', 'Ask the person to sign in'),
      ),
    ).toBe(
      'Could not create the playbook “sales”: what was given does not fit what it needs. Nothing was changed. This can be corrected and tried again; the details below say what to change.',
    );
  });
});
