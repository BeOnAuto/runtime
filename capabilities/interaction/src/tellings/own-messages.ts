import type { PlaybookAddress, ProjectedCondition, ProjectionReader, RowsAddress } from '@on.auto/operations';
import type { TellingForm } from '@on.auto/tool-servers';
import { Effect } from 'effect';

import type { KeptRequest } from '../replies/reply-taking.ts';
import { openRequestsName } from '../requests/open-requests.ts';
import { tellingsName } from './telling-rows.ts';
import { onceFor } from './tellings.ts';

export type TellingsReader = Pick<ProjectionReader, 'readProjectedRows'>;

function anyRow(
  ledger: TellingsReader,
  address: RowsAddress,
  projection: string,
  where: readonly ProjectedCondition[],
): Effect.Effect<boolean> {
  return Effect.map(
    ledger.readProjectedRows(projection, address, { where, orderBy: [], order: 'asc', limit: 1 }),
    (rows) => rows.length > 0,
  );
}

function anyTelling(
  ledger: TellingsReader,
  address: RowsAddress,
  where: readonly ProjectedCondition[],
): Effect.Effect<boolean> {
  return anyRow(ledger, address, tellingsName, where);
}

export interface PostedMessage {
  readonly conversation: string;
  readonly id: string;
}

export function isPostedInTheOrg(
  ledger: TellingsReader,
  org: RowsAddress,
  { conversation, id }: PostedMessage,
): Effect.Effect<boolean> {
  const told = anyTelling(ledger, org, [
    { column: 'conversation', equals: conversation },
    { column: 'message', equals: id },
  ]);
  const asked = anyRow(ledger, org, openRequestsName, [
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

const formsOfTheAnswersTelling: readonly TellingForm[] = ['mark', 'line'];

function tellingsOfTheAnswer(runId: string): ReadonlySet<string> {
  return new Set(formsOfTheAnswersTelling.map((form) => onceFor({ runId, call: { about: 'taken', form } })));
}

export function answerToldKnowingly(
  ledger: TellingsReader,
  playbook: PlaybookAddress,
  { runId, row }: KeptRequest,
): Effect.Effect<boolean> {
  if (row.telling_due_at !== null) {
    return Effect.succeed(false);
  }
  const unknown = ledger.readProjectedRows(tellingsName, playbook, {
    where: [
      { column: 'run_id', equals: runId },
      { column: 'known', equals: false },
    ],
    orderBy: [],
    order: 'asc',
    limit: formsOfTheAnswersTelling.length + 1,
  });
  const ownTellings = tellingsOfTheAnswer(runId);
  return Effect.map(unknown, (rows) => rows.every(({ key }) => ownTellings.has(key)));
}

export function answersMarkRefused(
  ledger: TellingsReader,
  playbook: PlaybookAddress,
  runId: string,
): Effect.Effect<boolean> {
  return anyTelling(ledger, playbook, [
    { column: 'row_key', equals: onceFor({ runId, call: { about: 'taken', form: 'mark' } }) },
    { column: 'known', equals: true },
  ]);
}
