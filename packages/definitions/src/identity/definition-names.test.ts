import { Conflict } from '@on.auto/operations';
import { memoryLedgerWith } from '@on.auto/operations/testing';
import { Cause, Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import type { DefinitionCommandData, DefinitionCreation } from '../registry/definition-commands.ts';
import type { DefinitionContent } from '../registry/definition-events.ts';
import { definitionsDecider, definitionTypeStreamOf } from '../registry/definitions-decider.ts';
import { recordedAdmin } from '../testing/callers.ts';
import { definitionKeyOfId, earlierDefinitionIdOf } from './definition-ids.ts';
import { definitionBoundsHeld, definitionNamesOf, mostReactingDefinitions, unbounded } from './definition-names.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const stream = `playbook/acme/alpha/${definitionTypeStreamOf('echo')}`;

const plain: DefinitionContent = { source: 'hello' };

const onItsOwn: DefinitionContent = {
  source: 'every minute',
  triggers: [{ kind: 'every', reference: '/schedule/every', milliseconds: 60_000 }],
};

const at = { by: 'acme-admin', at: '2026-11-13T09:00:00.000Z' };

function ledgerKeeping(mostEcho: number) {
  return memoryLedgerWith({
    definitionNames: definitionNamesOf(['echo'], (type) => (type === 'echo' ? mostEcho : unbounded())),
  });
}

type Ledger = ReturnType<typeof ledgerKeeping>;

async function answerOf(ledger: Ledger, command: DefinitionCommandData): Promise<unknown> {
  const exit = await Effect.runPromiseExit(
    ledger.service.execute(stream, definitionsDecider('echo', alpha), { ...command, ...at }),
  );
  return Exit.isFailure(exit) ? Cause.squash(exit.cause) : null;
}

function create(name: string, content = plain, definitionId = `id-of-${name}`): DefinitionCreation {
  return { type: 'create', name, content, created_by: recordedAdmin, definition_id: definitionId };
}

describe('the names of definitions, as the definitions declare them', () => {
  it('refuse a name another definition holds, in the words of an active holder or a retired one', async () => {
    const ledger = ledgerKeeping(unbounded());
    await answerOf(ledger, create('greet'));
    await answerOf(ledger, create('wave'));
    await answerOf(ledger, { type: 'retire', name: 'wave' });

    const answers = [
      await answerOf(ledger, create('greet', plain, 'another-greet')),
      await answerOf(ledger, create('wave', plain, 'another-wave')),
    ];

    expect(answers).toEqual([
      new Conflict({ detail: 'The playbook already has the echo definition greet', kind: 'taken' }),
      new Conflict({
        detail: 'The echo definition wave was retired and keeps its name; restore_definition brings it back',
        kind: 'taken',
      }),
    ]);
  });

  it('hold each definition under the key of its id, and follow its standing and whether it starts on its own', async () => {
    const ledger = ledgerKeeping(unbounded());
    await answerOf(ledger, create('greet'));
    await answerOf(ledger, create('wave'));
    await answerOf(ledger, { type: 'update', name: 'wave', content: onItsOwn });
    await answerOf(ledger, { type: 'pause', name: 'wave', paused_by: recordedAdmin });
    await answerOf(ledger, { type: 'resume', name: 'greet' });
    await answerOf(ledger, { type: 'pause', name: 'greet', paused_by: recordedAdmin });
    await answerOf(ledger, { type: 'resume', name: 'greet' });
    await answerOf(ledger, { type: 'retire', name: 'greet' });
    await answerOf(ledger, { type: 'restore', name: 'greet', restored_by: recordedAdmin });

    const held = Object.fromEntries(
      ledger
        .names()
        .map(({ definitionKey, name, status, hasTriggers }) => [name, [definitionKey, status, hasTriggers]]),
    );

    expect(held).toEqual({
      greet: [definitionKeyOfId('acme', 'id-of-greet'), 'paused', false],
      wave: [definitionKeyOfId('acme', 'id-of-wave'), 'paused', true],
    });
  });
});

describe('the bounds on the definitions of a playbook, as the definitions declare them', () => {
  it('refuse one more kept definition than a type allows, created, saved while above it, or restored, with the count before', async () => {
    const ledger = ledgerKeeping(1);
    await answerOf(ledger, create('greet'));

    const created = await answerOf(ledger, create('wave'));
    await answerOf(ledger, { type: 'retire', name: 'greet' });
    await answerOf(ledger, create('wave'));
    const restored = await answerOf(ledger, { type: 'restore', name: 'greet', restored_by: recordedAdmin });

    expect([created, restored]).toEqual([
      new Conflict({
        detail:
          'The playbook keeps 1 echo definitions, and a playbook may keep at most 1; retire one before creating another',
      }),
      new Conflict({
        detail:
          'The playbook keeps 1 echo definitions, and a playbook may keep at most 1; retire one before restoring one',
      }),
    ]);
  });
});

describe('a bound lowered below what a playbook keeps', () => {
  it('refuse a save while the playbook keeps more than a type allows, as when the bound was lowered, and take a retirement', async () => {
    const bound = { most: 2 };
    const ledger = memoryLedgerWith({ definitionNames: definitionNamesOf(['echo'], () => bound.most) });
    await answerOf(ledger, create('greet'));
    await answerOf(ledger, create('wave'));
    bound.most = 1;

    const answers = [
      await answerOf(ledger, { type: 'update', name: 'greet', content: onItsOwn }),
      await answerOf(ledger, { type: 'retire', name: 'greet' }),
    ];

    expect(answers).toEqual([
      new Conflict({
        detail:
          'The playbook keeps 2 echo definitions, and a playbook may keep at most 1; retire one before saving another version',
      }),
      null,
    ]);
  });

  it(`refuse one more definition that starts on its own than ${mostReactingDefinitions}, whatever the type allows`, async () => {
    const ledger = ledgerKeeping(unbounded());
    await Effect.runPromise(
      Effect.forEach(
        Array.from({ length: mostReactingDefinitions }, (_, index) => create(`clock-${index}`, onItsOwn)),
        (command) => ledger.service.execute(stream, definitionsDecider('echo', alpha), { ...command, ...at }),
        { discard: true },
      ),
    );

    expect([await answerOf(ledger, create('one-more', onItsOwn)), await answerOf(ledger, create('quiet'))]).toEqual([
      new Conflict({
        detail: `The playbook already has ${mostReactingDefinitions} echo definitions that start on their own, the most a playbook holds; retire one, or save this one without its schedule`,
      }),
      null,
    ]);
  });
});

describe('a restore beyond the definitions that start on their own', () => {
  it(`refuse to restore a definition that starts on its own while the playbook has ${mostReactingDefinitions} that do`, async () => {
    const ledger = ledgerKeeping(unbounded());
    await Effect.runPromise(
      Effect.forEach(
        Array.from({ length: mostReactingDefinitions }, (_, index) => create(`clock-${index}`, onItsOwn)),
        (command) => ledger.service.execute(stream, definitionsDecider('echo', alpha), { ...command, ...at }),
        { discard: true },
      ),
    );
    await answerOf(ledger, { type: 'retire', name: 'clock-0' });
    await answerOf(ledger, create('in-its-place', onItsOwn));

    expect(await answerOf(ledger, { type: 'restore', name: 'clock-0', restored_by: recordedAdmin })).toEqual(
      new Conflict({
        detail: `The playbook already has ${mostReactingDefinitions} echo definitions that start on their own, the most a playbook holds; retire one, or save this one without its schedule`,
      }),
    );
  });
});

describe('the facts the names of definitions read', () => {
  const names = definitionNamesOf(['echo']);
  const context = { ...at, definitionType: 'echo', definitionName: 'greet', definitionVersion: 1 };
  const created = {
    type: 'definition_created',
    data: { content: plain, created_by: recordedAdmin },
    context,
    id: 'x',
    position: 1,
  };

  it('name the key of an earlier definition by the one function over its address, the key of a later one by its id', () => {
    expect(names.definitionKeyOf({ ...created, stream })).toBe(
      definitionKeyOfId('acme', earlierDefinitionIdOf({ ...alpha, type: 'echo', name: 'greet' })),
    );
  });

  it('hold names on the stream of each declared type of a playbook, and on no other', () => {
    expect(
      [stream, 'playbook/acme/alpha/definitions/page', 'org/acme/definitions/echo', 'playbook/acme/alpha/runs/r1'].map(
        (each) => names.holdsNames(each),
      ),
    ).toEqual([true, false, false, false]);
  });

  it('name no definition for a stream that is not a declared type of a playbook, or a fact without a name', () => {
    expect([
      names.definitionKeyOf({ ...created, stream: 'playbook/acme/alpha/definitions/page' }),
      names.definitionKeyOf({ ...created, stream: 'org/acme/definitions/echo' }),
      names.definitionKeyOf({ ...created, stream, context: at }),
      names.definitionKeyOf({ ...created, stream, context: { ...context, definitionId: 'given' } }),
    ]).toEqual([undefined, undefined, undefined, 'definition/acme/given/']);
  });

  it('change no name for a creation of no declared stream, a change of no held name, or a fact it cannot read', () => {
    expect([
      names.nameAfter(undefined, { ...created, stream: 'playbook/acme/alpha/definitions/page' }),
      names.nameAfter(undefined, { ...created, stream, type: 'definition_retired', data: {} }),
      names.nameAfter(undefined, { ...created, stream, data: {} }),
    ]).toEqual([undefined, undefined, undefined]);
  });
});

describe('the bounds on the definitions a playbook keeps, as a composition holds them', () => {
  it('are unbounded for every type until the capabilities are composed, and then the most each keeps', () => {
    const bounds = definitionBoundsHeld();
    const before = bounds.mostActiveOf('prediction');

    bounds.keptFrom([{ type: 'prediction', mostActive: 32 }]);

    expect([before, bounds.mostActiveOf('prediction'), bounds.mostActiveOf('workflow')]).toEqual([
      unbounded(),
      32,
      unbounded(),
    ]);
  });
});
