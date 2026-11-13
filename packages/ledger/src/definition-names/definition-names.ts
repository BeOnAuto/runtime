import {
  boundRefusal,
  claimsOf,
  definitionsInTheAppend,
  judgedOf,
  kindsChanged,
  nameKeyOf,
  takenRefusal,
  type DefinitionJudged,
  type DefinitionNames,
  type Refusal,
} from '@on.auto/operations/definition-names';

import type { StatementExecutor } from '../event-store.ts';
import {
  inlineRegistrationOf,
  inTurn,
  type InlineRegistration,
  type StoredMessage,
} from '../projections/inline-projection.ts';
import type { ProjectionDialect } from '../projections/projection-dialect.ts';
import { appendRefusedAs } from '../refusals/append-refused.ts';
import { definitionNamesTableName } from './definition-names-table.ts';
import { heldBy, holderOf, nameReleased, namesOfAKind, nameWritten } from './name-rows.ts';

export type {
  DefinitionName,
  DefinitionNames,
  NameAfter,
  NameBound,
  NamedMessage,
} from '@on.auto/operations/definition-names';

interface NamesKeeping {
  readonly dialect: ProjectionDialect;
  readonly names: DefinitionNames;
}

function locked(execute: StatementExecutor, dialect: ProjectionDialect, prefix: string, key: string): Promise<void> {
  return inTurn(dialect.keyLocks(definitionNamesTableName, prefix, key), (lock) => execute.query(lock));
}

function refused(refusal: Refusal | undefined): void {
  if (refusal !== undefined) {
    throw appendRefusedAs(refusal.conflict, refusal.stream);
  }
}

async function judgedUnderLock(
  { dialect, names }: NamesKeeping,
  execute: StatementExecutor,
  messages: readonly StoredMessage[],
): Promise<readonly DefinitionJudged[]> {
  const definitions = definitionsInTheAppend(
    names,
    messages.map(({ stream, id, position, type, data, context }) => ({
      stream,
      id,
      position,
      type,
      data: dialect.appendedData(data),
      context,
    })),
  );
  await inTurn(definitions, ({ definitionKey }) => locked(execute, dialect, definitionKey, ''));
  const judged: DefinitionJudged[] = [];
  await inTurn(definitions, async (definition) => {
    judged.push(judgedOf(names, definition, await heldBy(execute, definition.definitionKey)));
  });
  return judged;
}

async function judgedWhole(
  { dialect, names }: NamesKeeping,
  execute: StatementExecutor,
  judged: readonly DefinitionJudged[],
): Promise<void> {
  const claims = claimsOf(judged);
  const kinds = kindsChanged(judged);
  await inTurn(claims, ({ claimed }) => locked(execute, dialect, claimed.playbookKey, nameKeyOf(claimed)));
  await inTurn(kinds, ({ playbookKey, definitionType }) => locked(execute, dialect, playbookKey, definitionType));
  await inTurn(claims, async (claim) => {
    refused(takenRefusal(names, judged, claim, await holderOf(execute, claim.claimed)));
  });
  await inTurn(kinds, async (kind) => {
    refused(boundRefusal(names, judged, kind, await namesOfAKind(execute, kind)));
  });
}

async function judgementWritten(
  { dialect }: NamesKeeping,
  execute: StatementExecutor,
  judged: readonly DefinitionJudged[],
): Promise<void> {
  const changed = judged.filter(({ changedBy }) => changedBy.length > 0);
  await inTurn(changed, ({ definitionKey }) => nameReleased(execute, definitionKey));
  await inTurn(changed, async ({ definitionKey, end }) => {
    if (end !== undefined) {
      await nameWritten(execute, dialect, { definitionKey, ...end });
    }
  });
}

async function namesOfTheAppend(
  keeping: NamesKeeping,
  execute: StatementExecutor,
  messages: readonly StoredMessage[],
): Promise<void> {
  const judged = await judgedUnderLock(keeping, execute, messages);
  await judgedWhole(keeping, execute, judged);
  await judgementWritten(keeping, execute, judged);
}

export function definitionNamesRegistrations(
  dialect: ProjectionDialect,
  names: DefinitionNames | undefined,
): readonly InlineRegistration[] {
  if (names === undefined) {
    return [];
  }
  const keeping = { dialect, names };
  return [
    inlineRegistrationOf({
      types: names.types,
      handle: (messages, execute) => namesOfTheAppend(keeping, execute, messages),
    }),
  ];
}
