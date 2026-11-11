import type { PlaybookAddress, ProjectedCondition, ProjectionReader } from '@on.auto/operations';
import { Effect } from 'effect';

import { openRequestsName } from '../requests/open-requests.ts';
import { tellingsName } from './telling-rows.ts';

export type TellingsReader = Pick<ProjectionReader, 'readProjectedRows'>;

function anyRow(
  ledger: TellingsReader,
  playbook: PlaybookAddress,
  projection: string,
  where: readonly ProjectedCondition[],
): Effect.Effect<boolean> {
  return Effect.map(
    ledger.readProjectedRows(projection, playbook, { where, orderBy: [], order: 'asc', limit: 1 }),
    (rows) => rows.length > 0,
  );
}

function anyTelling(
  ledger: TellingsReader,
  playbook: PlaybookAddress,
  where: readonly ProjectedCondition[],
): Effect.Effect<boolean> {
  return anyRow(ledger, playbook, tellingsName, where);
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
  const told = anyTelling(ledger, playbook, [
    { column: 'conversation', equals: conversation },
    { column: 'message', equals: id },
  ]);
  const asked = anyRow(ledger, playbook, openRequestsName, [
    { column: 'sent_conversation', equals: conversation },
    { column: 'sent_id', equals: id },
  ]);
  return Effect.flatMap(told, (byATelling) => (byATelling ? Effect.succeed(true) : asked));
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
