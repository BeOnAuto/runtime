import { mostEventsInAMultiStreamAppend } from '@on.auto/ledger';
import { describe, expect, it } from 'vitest';

import { definitionNamesOf, unbounded } from '../identity/definition-names.ts';
import { acmeAdmin, acmeAlphaKeeper } from '../testing/callers.ts';
import { harness } from '../testing/harness.ts';
import { recordOfTheRefusal, takenWhileWritten } from '../testing/move-refusals.ts';
import { holderOfTheRun, playbookItStartedIn, ranWeekly } from '../testing/moved-runs.ts';
import {
  answerOf,
  callsGreet,
  greet,
  heldIn,
  inAlpha,
  moveDefinitions,
  movedBesideACheckInBeta,
  moving,
  operations,
  toAlpha,
  toBeta,
  weekly,
} from '../testing/moving.ts';
import { admittingMeter, recordingMeter } from '../testing/recording-meter.ts';
import { mostDefinitionsMovedAtOnce } from './move-input.ts';

const unmoved = ['alpha echo greet', 'alpha workflow weekly'];

const both = { definitions: [weekly, greet] };

const approve = { type: 'asking', name: 'approve' };

function mostOf(type: string): number {
  return type === 'echo' ? 1 : unbounded();
}

const oneGreetingAPlaybook = definitionNamesOf(['echo', 'workflow'], mostOf);

function detailOf(outcome: object): string {
  return String(Reflect.get(outcome, 'detail'));
}

const explainedByTheMove = Object.keys(moveDefinitions.registration.plainLanguage?.explanations ?? {});

function toldOfMoving(moved: object, count: number): string | undefined {
  const listed: unknown = answerOf(moved)['definitions'];
  const kept: readonly unknown[] = Array.isArray(listed) ? listed.slice(0, count) : [];
  return moveDefinitions.registration.plainLanguage?.outcome({ definitions: kept }, { to: 'beta', ...both });
}

describe('move_definitions', () => {
  it('moves a workflow and the function it calls to another playbook, with their ids, versions and runs, told as one or several', async () => {
    const definitions = harness();
    await inAlpha(definitions);
    const runId = await ranWeekly(definitions);
    const before = answerOf(await definitions.call(operations.getDefinition, toAlpha(acmeAdmin, weekly)));

    const moved = await moving(definitions, both);

    expect(toldOfMoving(moved, 1)).not.toBe(toldOfMoving(moved, 2));
    expect(moved).toMatchObject({
      status: 'succeeded',
      output: {
        definitions: [
          { ...weekly, version: 2 },
          { ...greet, version: 2 },
        ],
      },
    });
    expect(await definitions.call(operations.getDefinition, toBeta(acmeAdmin, weekly))).toMatchObject({
      status: 'succeeded',
      output: { status: 'active', version: 2, definition_id: before['definition_id'] },
    });
    expect(await definitions.call(operations.getRun, toBeta(acmeAdmin, { run_id: runId }))).toMatchObject({
      status: 'succeeded',
      output: { run_id: runId, status: 'succeeded' },
    });
  });

  it('keeps a run that ended before it where the meter finds it, as its start recorded it, and adds no stream', async () => {
    const meter = recordingMeter();
    const definitions = harness(meter.layer);
    await inAlpha(definitions);
    const runId = await ranWeekly(definitions);
    const before = { holder: await holderOfTheRun(definitions, runId), streams: definitions.ledger.streamNames() };

    await moving(definitions, both);

    expect({ holder: await holderOfTheRun(definitions, runId), streams: definitions.ledger.streamNames() }).toEqual(
      before,
    );
    expect(before.holder).toMatch(/^definition\/acme\//u);
    expect(meter.admitted()).toHaveLength(1);
    expect(await playbookItStartedIn(definitions, runId)).toBe('alpha');
  });
});

describe('move_definitions at the playbook moved from', () => {
  it('leaves nothing of them at the playbook they left, whose names are free again', async () => {
    const definitions = harness();
    await inAlpha(definitions);
    const runId = await ranWeekly(definitions);

    await moving(definitions, both);

    expect([
      await definitions.call(operations.getDefinition, toAlpha(acmeAdmin, weekly)),
      await definitions.call(operations.getRun, toAlpha(acmeAdmin, { run_id: runId })),
      await definitions.call(
        operations.createDefinition,
        toAlpha(acmeAdmin, { ...greet, source: '{"greeting":"Hi"}' }),
      ),
    ]).toMatchObject([
      { status: 'rejected', reason: 'not_found' },
      { status: 'rejected', reason: 'not_found' },
      { status: 'succeeded' },
    ]);
  });

  it('moves a paused definition paused, at its version', async () => {
    const definitions = harness();
    await inAlpha(definitions);
    await definitions.call(operations.pauseDefinition, toAlpha(acmeAdmin, greet));

    await moving(definitions, both);

    expect(await definitions.call(operations.getDefinition, toBeta(acmeAdmin, greet))).toMatchObject({
      status: 'succeeded',
      output: { status: 'paused', version: 2 },
    });
  });
});

describe('move_definitions refusing what it cannot move', () => {
  it('refuses the playbook it acts in, a `to` that is no playbook id, a retired member and a member not there, moving nothing', async () => {
    const definitions = harness();
    await inAlpha(definitions);
    await definitions.call(
      operations.createDefinition,
      toAlpha(acmeAdmin, { type: 'echo', name: 'gone', source: '{"greeting":"Bye"}' }),
    );
    await definitions.call(operations.retireDefinition, toAlpha(acmeAdmin, { type: 'echo', name: 'gone' }));

    expect([
      await moving(definitions, { to: 'alpha', ...both }),
      await moving(definitions, { to: 'Beta', ...both }),
      await moving(definitions, { definitions: [{ type: 'echo', name: 'gone' }] }),
      await moving(definitions, { definitions: [{ type: 'echo', name: 'nowhere' }] }),
    ]).toMatchObject([
      { status: 'rejected', reason: 'invalid_input' },
      { status: 'rejected', reason: 'invalid_input', issues: [{ pointer: '/to' }] },
      { status: 'rejected', reason: 'conflict', kind: 'retired' },
      { status: 'rejected', reason: 'not_found' },
    ]);
    expect(heldIn(definitions)).toEqual(['alpha echo gone', ...unmoved]);
  });

  it('refuses a workflow without what it calls, and a function without the workflow that stays and calls it', async () => {
    const definitions = harness();
    await inAlpha(definitions);

    expect([
      await moving(definitions, { definitions: [weekly] }),
      await moving(definitions, { definitions: [greet] }),
    ]).toMatchObject([
      { status: 'rejected', reason: 'conflict', kind: 'incomplete' },
      { status: 'rejected', reason: 'conflict', kind: 'in_use' },
    ]);
    expect(heldIn(definitions)).toEqual(unmoved);
    expect([
      await recordOfTheRefusal(definitions, { definitions: [weekly] }),
      await recordOfTheRefusal(definitions, { definitions: [greet] }),
    ]).toEqual([{ definitions: [greet] }, { definitions: [weekly] }]);
  });
});

describe('move_definitions refusing what is in the way at the other playbook', () => {
  it('refuses a name the other playbook holds, active or retired, before the move is written and while it is, in its own words', async () => {
    const definitions = harness();
    await inAlpha(definitions);
    await definitions.call(operations.createDefinition, toBeta(acmeAdmin, { ...greet, source: '{"greeting":"Hey"}' }));
    const active = await moving(definitions, both);
    await definitions.call(operations.retireDefinition, toBeta(acmeAdmin, greet));
    const retired = await moving(definitions, both);

    expect([active, retired]).toMatchObject([
      { status: 'rejected', reason: 'conflict', kind: 'taken' },
      { status: 'rejected', reason: 'conflict', kind: 'taken' },
    ]);
    expect([takenWhileWritten('active'), takenWhileWritten('retired')]).toMatchObject([
      { kind: 'taken', detail: detailOf(active) },
      { kind: 'taken', detail: detailOf(retired) },
    ]);
    expect(explainedByTheMove).toEqual(['taken']);
    expect(heldIn(definitions)).toEqual(['beta echo greet', ...unmoved].toSorted());
  });

  it('refuses a move past the bound of the other playbook', async () => {
    const definitions = harness(admittingMeter, undefined, undefined, oneGreetingAPlaybook);
    await inAlpha(definitions);
    await definitions.call(
      operations.createDefinition,
      toBeta(acmeAdmin, { type: 'echo', name: 'other', source: '{"greeting":"Yo"}' }),
    );

    expect(await moving(definitions, both)).toMatchObject({ status: 'rejected', reason: 'conflict' });
    expect(heldIn(definitions)).toEqual(['beta echo other', ...unmoved].toSorted());
  });

  it('refuses a caller that may not change the other playbook, moving nothing', async () => {
    const definitions = harness();
    await inAlpha(definitions);

    expect(await moving(definitions, both, acmeAlphaKeeper)).toMatchObject({ status: 'rejected', reason: 'forbidden' });
    expect(heldIn(definitions)).toEqual(unmoved);
  });
});

describe('move_definitions refusing runs that have not ended', () => {
  it('refuses a member with runs that have not ended, naming the one, or up to ten of them, their count and how to list them', async () => {
    const definitions = harness();
    const ran = (runs: number) =>
      Promise.all(
        Array.from({ length: runs }, () =>
          definitions.call(operations.runDefinition, toAlpha(acmeAdmin, { ...approve, input: {} })),
        ),
      );
    await definitions.call(operations.createDefinition, toAlpha(acmeAdmin, { ...approve, source: 'Approve?' }));
    await ran(1);
    const one = await moving(definitions, { definitions: [approve] });
    await ran(20);
    const several = await moving(definitions, { definitions: [approve] });

    expect([one, several]).toMatchObject([
      { status: 'rejected', kind: 'runs_in_progress' },
      { status: 'rejected', kind: 'runs_in_progress' },
    ]);
    expect([one, several].map((refused) => detailOf(refused).includes('list_runs'))).toEqual([false, true]);
    expect(await recordOfTheRefusal(definitions, { definitions: [approve] })).toMatchObject({
      count: 21,
      runs: { length: 10 },
    });
    expect(heldIn(definitions)).toEqual(['alpha asking approve']);
  });
});

describe('move_definitions refusing connections, and its words', () => {
  it('refuses a connection the other playbook has no access to, used or listened to, unless forced, and never one that serves every playbook', async () => {
    const definitions = harness();
    const on = [
      ...['/connections/ledger', '/connections/crm', '/ledger/eu'].map((source) => ({ type: 'closed', source })),
      { type: 'opened' },
    ];
    await inAlpha(definitions, callsGreet({ call: { server: 'billing' }, tools: ['everywhere/send', 'crm/find'], on }));

    const refused = await moving(definitions, both);
    const record = await recordOfTheRefusal(definitions, both);
    const heldWhenRefused = heldIn(definitions);
    const forced = await moving(definitions, { ...both, force: true });

    expect([refused, forced]).toMatchObject([
      { status: 'rejected', kind: 'connection_not_accessible' },
      { status: 'succeeded' },
    ]);
    expect(record).toEqual({
      connections: [
        { connection: 'billing', definitions: [weekly] },
        { connection: 'ledger', definitions: [weekly] },
      ],
    });
    expect(heldWhenRefused).toEqual(unmoved);
    expect(heldIn(definitions)).toEqual(['beta echo greet', 'beta workflow weekly']);
  });

  it('takes at most as many members as one append to several streams keeps, and names each in its words', () => {
    const asked = { to: 'beta', ...both };

    expect(mostDefinitionsMovedAtOnce).toBe(mostEventsInAMultiStreamAppend);
    expect([
      moveDefinitions.registration.plainLanguage?.attempt(asked),
      moveDefinitions.registration.plainLanguage?.outcome({ definitions: [] }, asked),
    ]).toEqual([expect.stringMatching(/“weekly”.*“greet”.*beta/u), expect.stringMatching(/“weekly”.*“greet”.*beta/u)]);
  });
});

describe('move_definitions of a workflow whose trigger names a read', () => {
  it.each([
    ['another read under its type, even forced', 'list_cancelled', 'alpha', { status: 'rejected', reason: 'conflict' }],
    ['the read the other playbook checks under its type', 'list_bookings', 'beta', { status: 'succeeded' }],
  ] as const)('refuses or moves it for %s', async (_case, tool, place, outcome) => {
    const { moved, held } = await movedBesideACheckInBeta(tool);

    expect(moved).toMatchObject(outcome);
    expect(detailOf(moved).includes('beta')).toBe(outcome.status === 'rejected');
    expect(held).toContain(`${place} workflow weekly`);
  });
});
