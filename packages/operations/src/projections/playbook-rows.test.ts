import { describe, expect, it } from 'vitest';

import { playbookRowsOf } from './playbook-rows.ts';

describe('the rows of a projection of a playbook’s streams', () => {
  it('are answered as rows of their playbooks', () => {
    const row = { text: 'kept' };

    expect(
      playbookRowsOf('remarks', [
        { org: 'acme', playbook: 'alpha', key: 'r1', row },
        { org: 'acme', playbook: 'beta', key: 'r2', row },
      ]),
    ).toEqual([
      { org: 'acme', playbook: 'alpha', key: 'r1', row },
      { org: 'acme', playbook: 'beta', key: 'r2', row },
    ]);
  });

  it('are refused when one names no playbook, which no such projection folds', () => {
    const row = { text: 'kept' };

    expect(() =>
      playbookRowsOf('remarks', [
        { org: 'acme', playbook: 'alpha', key: 'r1', row },
        { org: 'acme', key: 'r2', row },
      ]),
    ).toThrow(
      "The projection remarks folds a playbook's streams alone, yet its row r2 names the org acme and no playbook",
    );
  });
});
