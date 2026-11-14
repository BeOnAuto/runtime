import type { MemoryLedger } from '@on.auto/operations/testing';
import { Effect } from 'effect';

import { definitionFromTheReadModel, type ReadFromTheReadModel } from '../read-model-reads/read-model-definitions.ts';
import { listedRowsFromTheReadModel, type ListedRow } from '../read-model-reads/read-model-lists.ts';
import { readToday, type DefinitionReadAt } from '../read-model-staging/staged-reads.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { inThePlaybook } from './in-the-playbook.ts';
import { createdWith } from './read-model-histories.ts';
import { readModelLedgerOf } from './read-model-ledger.ts';

export const savedWarnings = ['The greeting is never checked'];

const everyMonday = {
  kind: 'cron',
  reference: '/schedule/cron',
  expression: '0 9 * * 1',
  time_zone: 'Europe/Amsterdam',
} as const;

export interface SavedGreeting {
  readonly ledger: MemoryLedger;
  readonly today: DefinitionReadAt;
  readonly candidate: ReadFromTheReadModel;
  readonly listed: readonly ListedRow[];
}

export async function aSavedGreeting(): Promise<SavedGreeting> {
  const ledger = readModelLedgerOf(['echo']);
  const source = JSON.stringify({ greeting: 'Hello', warnings: savedWarnings, triggers: [everyMonday] });
  await createdWith(ledger.service, 'greet', { source, warnings: savedWarnings, triggers: [everyMonday] });
  const [today, candidate, listed] = await inThePlaybook(
    ledger,
    Effect.all([
      readToday(echo, ['echo'], 'greet'),
      definitionFromTheReadModel(echo, ['echo'], 'greet'),
      listedRowsFromTheReadModel(echo, false),
    ]),
  );
  return { ledger, today, candidate, listed };
}
