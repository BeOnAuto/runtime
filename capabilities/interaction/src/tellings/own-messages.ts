import type { PlaybookAddress, ProjectedCondition, ProjectionReader } from '@on.auto/operations';
import { Effect } from 'effect';

import { tellingsName } from './telling-rows.ts';

export type TellingsReader = Pick<ProjectionReader, 'readProjectedRows'>;

function anyTelling(
  ledger: TellingsReader,
  playbook: PlaybookAddress,
  where: readonly ProjectedCondition[],
): Effect.Effect<boolean> {
  return Effect.map(
    ledger.readProjectedRows(tellingsName, playbook, { where, orderBy: [], order: 'asc', limit: 1 }),
    (rows) => rows.length > 0,
  );
}

export interface PostedMessage {
  readonly conversation: string;
  readonly id: string;
}

export function isPostedByThePlaybook(
  ledger: TellingsReader,
  playbook: PlaybookAddress,
  { conversation, id }: PostedMessage,
): Effect.Effect<boolean> {
  return anyTelling(ledger, playbook, [
    { column: 'conversation', equals: conversation },
    { column: 'message', equals: id },
  ]);
}

export function toldUnknowingly(
  ledger: TellingsReader,
  playbook: PlaybookAddress,
  runId: string,
): Effect.Effect<boolean> {
  return anyTelling(ledger, playbook, [
    { column: 'run_id', equals: runId },
    { column: 'known', equals: false },
  ]);
}
