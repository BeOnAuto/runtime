import { Ledger, type Decided, type ProjectedKeyedRow, type ProjectedValue } from '@on.auto/operations';
import type { MemoryLedger } from '@on.auto/operations/testing';
import { Cause, Effect, Exit, Result } from 'effect';

import type { DefinitionCommandData } from '../registry/definition-commands.ts';
import type { RecordedDefinitionEvent } from '../registry/definition-events.ts';
import { definitionsDecider, definitionTypeStreamOf } from '../registry/definitions-decider.ts';
import { aReader } from './read-model-histories.ts';

type DefinitionsDecider = ReturnType<typeof definitionsDecider>;

const echoesOfAlpha = `playbook/acme/alpha/${definitionTypeStreamOf('echo')}`;

function withoutItsId(decided: Decided<RecordedDefinitionEvent>): Decided<RecordedDefinitionEvent> {
  if (decided.type !== 'definition_created') {
    return decided;
  }
  const { definition_id: _id, playbook: _playbook, ...data } = decided.data;
  return { ...decided, data };
}

function asTheReleaseBeforeIdsDecided(today: DefinitionsDecider): DefinitionsDecider {
  return {
    ...today,
    decide: (command, registry) =>
      Result.map(today.decide(command, registry), (decided) => decided.map((each) => withoutItsId(each))),
    context: (command, registry) => {
      const { definitionId: _id, ...context } = today.context(command, registry);
      return context;
    },
  };
}

async function refusalOf(
  ledger: MemoryLedger,
  decider: DefinitionsDecider,
  command: DefinitionCommandData,
): Promise<unknown> {
  const exit = await Effect.runPromiseExit(
    ledger.service.execute(echoesOfAlpha, decider, { ...command, by: aReader.id, at: '2026-11-11T09:00:00.000Z' }),
  );
  return Exit.isFailure(exit) ? Cause.squash(exit.cause) : null;
}

const decidedToday = (): DefinitionsDecider => definitionsDecider('echo', { org: 'acme', playbook: 'alpha' });

export function savedBeforeIds(ledger: MemoryLedger, command: DefinitionCommandData): Promise<unknown> {
  return refusalOf(ledger, asTheReleaseBeforeIdsDecided(decidedToday()), command);
}

export function savedToday(ledger: MemoryLedger, command: DefinitionCommandData): Promise<unknown> {
  return refusalOf(ledger, decidedToday(), command);
}

function withoutTheColumn(column: string, { row, ...keyed }: ProjectedKeyedRow): ProjectedKeyedRow {
  return {
    ...keyed,
    row: Object.fromEntries(Object.entries(row).filter(([name]: readonly [string, ProjectedValue]) => name !== column)),
  };
}

export function answeringAsTheReleaseBefore(ledger: MemoryLedger, itsNewColumn: string): MemoryLedger {
  return {
    ...ledger,
    service: Ledger.of({
      ...ledger.service,
      readProjectedRows: (projection, address, query) =>
        Effect.map(ledger.service.readProjectedRows(projection, address, query), (rows) =>
          rows.map((each) => withoutTheColumn(itsNewColumn, each)),
        ),
    }),
  };
}
