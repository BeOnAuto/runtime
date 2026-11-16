import type { Context, Lineage, PlaybookAddress } from '@on.auto/operations';

import type { StatementValue } from '../connection/statement.ts';

export const pinnedMoment = Date.parse('2026-11-16T09:00:00.000Z');

export const longAfter = Date.parse('2100-01-01T00:00:00.000Z');

export const alpha: PlaybookAddress = { org: 'acme', playbook: 'alpha' };

export const pinnedStreams = {
  endedRun: 'playbook/acme/alpha/runs/r1',
  openRun: 'playbook/acme/alpha/runs/r2',
  topics: 'playbook/acme/alpha/notes/t1',
  labels: 'playbook/acme/alpha/notes/n1',
  held: 'playbook/acme/alpha/held/h1',
  written: 'playbook/acme/alpha/writings/w1',
  journal: 'org/acme/journal',
  tallies: 'org/acme/tallies',
  named: 'definition/acme/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a/definitions',
  namedAgain: 'definition/acme/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b/definitions',
};

export const pinnedCorrelation = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b02';

export const pinnedLineage: Lineage = {
  causationId: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b01',
  correlationId: pinnedCorrelation,
};

export const scrubbedContext: Context = { at: '2026-11-16T10:00:00.000Z', by: 'eraser' };

export const keptOutside = 'Kept in a store outside the ledger.';

export const pinnedContents = {
  held: 'A note kept as content.',
  payload: 'The body of a written note, kept outside its fact.',
  expiring: 'Kept until a day long after.',
  erased: 'Expired, then erased.',
};

export const pinnedSecrets = {
  sealed: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b11',
  plain: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b12',
};

export const keptBy = 'sealed-in-the-ledger';

export const valuesKeptBeside: readonly StatementValue[] = [
  0,
  7,
  -7,
  2_147_483_647,
  2_147_483_648,
  pinnedMoment,
  Number.MAX_SAFE_INTEGER,
  1.5,
  0.1,
  1e17,
  '5',
  'text',
  null,
];
