import type { MemoryLedger } from '@on.auto/operations/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { type Capability, defineCapability } from '../capability/capability.ts';
import { mostSourcesKept } from '../operations/answered-definitions.ts';
import { inThePlaybook } from '../read-model-testing/in-the-playbook.ts';
import { aReader, createdWith, executedIn } from '../read-model-testing/read-model-histories.ts';
import { readModelLedgerOf } from '../read-model-testing/read-model-ledger.ts';
import { echoDeclaration } from '../testing/capabilities/echo.ts';
import { definitionFromTheReadModel } from './read-model-definitions.ts';
import { listFromTheReadModel } from './read-model-lists.ts';
import { warningsAtAnOpen } from './remembered-warnings.ts';

const foundToday = JSON.stringify({ greeting: 'Hi', warnings: ['found today'] });

const goalsKept = true;

function aProcess(): Capability {
  return defineCapability(echoDeclaration);
}

async function aDefinitionSavedWith(warnings: readonly string[]): Promise<MemoryLedger> {
  const ledger = readModelLedgerOf(['echo']);
  await createdWith(ledger.service, 'greeter', { source: foundToday, warnings });
  return ledger;
}

async function listed(ledger: MemoryLedger, capability: Capability) {
  return (await inThePlaybook(ledger, listFromTheReadModel(capability, true, goalsKept))).map(
    ({ warnings }) => warnings,
  );
}

function counted(): { readonly capability: Capability; readonly checks: () => number } {
  const checking = defineCapability(echoDeclaration);
  let checks = 0;
  return {
    capability: {
      ...checking,
      prepare: (source, stripped) => {
        checks += 1;
        return checking.prepare(source, stripped);
      },
    },
    checks: () => checks,
  };
}

describe('the warnings a list of the read model shows', () => {
  it('are those of the save just made, which a check of today finds alike', async () => {
    const ledger = await aDefinitionSavedWith(['found today']);

    expect(await listed(ledger, aProcess())).toEqual([['found today']]);
  });

  it('are those found when the definition was opened in this process, and those it was saved with in another', async () => {
    const ledger = await aDefinitionSavedWith(['saved long ago']);
    const process = aProcess();

    const before = await listed(ledger, process);
    await inThePlaybook(ledger, definitionFromTheReadModel(process, ['echo'], 'greeter'));

    expect([before, await listed(ledger, process), await listed(ledger, aProcess())]).toEqual([
      [['saved long ago']],
      [['found today']],
      [['saved long ago']],
    ]);
  });

  it('are those found at the open after a retirement and a restore, which leave the saving fact as it was', async () => {
    const ledger = await aDefinitionSavedWith(['saved long ago']);
    const process = aProcess();
    await inThePlaybook(ledger, definitionFromTheReadModel(process, ['echo'], 'greeter'));

    await executedIn(ledger.service, 'echo', { type: 'retire', name: 'greeter' });
    await executedIn(ledger.service, 'echo', { type: 'restore', name: 'greeter', restored_by: aReader });

    expect(await listed(ledger, process)).toEqual([['found today']]);
  });
});

describe('the warnings a process remembers of the definitions it opened', () => {
  it(`are kept for at most ${mostSourcesKept} saving facts, and found again once forgotten`, async () => {
    const { capability, checks } = counted();
    const opened = (savedBy: string) =>
      Effect.runPromise(warningsAtAnOpen(capability, { savedBy, document: foundToday, saved: [] }));

    await Effect.runPromise(
      Effect.forEach(
        Array.from({ length: mostSourcesKept + 1 }, (_, index) => `saved-by-${index}`),
        (savedBy) => Effect.promise(() => opened(savedBy)),
      ),
    );
    await opened(`saved-by-${mostSourcesKept}`);
    await opened('saved-by-0');

    expect(checks()).toBe(mostSourcesKept + 2);
  });

  it('are those it was saved with when the document no longer parses', async () => {
    expect(
      await Effect.runPromise(
        warningsAtAnOpen(defineCapability(echoDeclaration), {
          savedBy: 'saved-by',
          document: '{',
          saved: ['as saved'],
        }),
      ),
    ).toEqual(['as saved']);
  });
});
