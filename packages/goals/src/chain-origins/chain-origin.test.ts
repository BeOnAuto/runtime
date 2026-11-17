import type { Context, TriggerKind } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import {
  callerOriginOf,
  originCounts,
  stepFromACause,
  stepFromARunFact,
  type ChainFact,
  type ChainOrigin,
} from './chain-origin.ts';

const rule = { serviceCallers: new Set(['an-internal-caller']) };

const at = '2026-11-09T09:00:00.000Z';

const scheduledAndNoticed: readonly TriggerKind[] = ['cron', 'every', 'goal'];

const triggered: Partial<Context> = { trigger: { kind: 'event', reference: '/schedule/on' } };

function runFact(run: string, context: Partial<Context>, lineage: Partial<ChainFact> = {}): ChainFact {
  return {
    stream: `playbook/acme/sales/runs/${run}`,
    context: { at, by: 'playbook:sales', runId: run, ...context },
    causationId: null,
    correlationId: run,
    ...lineage,
  };
}

describe('who began a chain, by the id of its caller', () => {
  it('takes the local developer and a signed-in person for a person, the playbook acting as itself for the playbook, and a key for a machine', () => {
    expect(
      [
        'local',
        'person:user_29w83sxmDNGwOuEthce5gg56FcC',
        'playbook:sales',
        'ops-key',
        '0f3a9c2e4b1d6a7f8e9d0c1b2a3f4e5d',
      ].map((by) => callerOriginOf(by, rule)),
    ).toEqual(['person', 'person', 'playbook', 'machine', 'machine']);
  });

  it('takes a caller the host names as its own service for a service, though its id has the shape of a key', () => {
    expect([
      callerOriginOf('an-internal-caller', rule),
      callerOriginOf('an-internal-caller', { serviceCallers: new Set() }),
    ]).toEqual(['service', 'machine']);
  });

  it('takes any other id for unknown: not the shape of a key, too long for one, or a prefix it does not know', () => {
    expect(
      ['Ops_Key', 'a'.repeat(33), 'robot:one', '', 'localhost', 'person', 'playbook'].map((by) =>
        callerOriginOf(by, rule),
      ),
    ).toEqual(['unknown', 'unknown', 'unknown', 'unknown', 'machine', 'machine', 'machine']);
  });

  it('counts a chain a schedule, a machine or a person began, and never one begun as a test', () => {
    const origins: readonly ChainOrigin[] = ['schedule', 'machine', 'person', 'playbook', 'service', 'test', 'unknown'];
    expect(origins.filter((origin) => originCounts(origin))).toEqual(['schedule', 'machine', 'person']);
  });
});

describe('the next step from a fact of a run', () => {
  it('ends at a schedule for a cron or an interval trigger, and at the playbook for a notice of a goal, from any fact', () => {
    expect(
      scheduledAndNoticed.map((kind) =>
        stepFromARunFact('r1', runFact('r1', { trigger: { kind, reference: '/schedule' } }), false, rule),
      ),
    ).toEqual([{ origin: 'schedule' }, { origin: 'schedule' }, { origin: 'playbook' }]);
  });

  it('goes to the top run of its call tree when its correlation names another run', () => {
    expect(
      stepFromARunFact(
        'child',
        runFact('child', { calledBy: { runId: 'parent', reference: '/do/0', run: 1 } }, { correlationId: 'top' }),
        false,
        rule,
      ),
    ).toEqual({
      firstFactOf: 'top',
    });
  });

  it('reads the first fact of the run when the fact it holds is a later one and decides nothing', () => {
    expect([
      stepFromARunFact('r1', runFact('r1', { by: 'local' }), false, rule),
      stepFromARunFact('r1', runFact('r1', triggered, { causationId: 'm9' }), false, rule),
    ]).toEqual([{ firstFactOf: 'r1' }, { firstFactOf: 'r1' }]);
  });
});

describe('a run started as a test', () => {
  it('ends at a test from any fact of the run that carries the mark, whoever began it and whatever triggered it', () => {
    const tried: Partial<Context> = { test: true };
    expect([
      stepFromARunFact('r1', runFact('r1', { ...tried, by: 'person:user_one' }), true, rule),
      stepFromARunFact('r1', runFact('r1', { ...tried, by: 'local' }), false, rule),
      stepFromARunFact(
        'r1',
        runFact('r1', { ...tried, trigger: { kind: 'cron', reference: '/schedule' } }),
        false,
        rule,
      ),
      stepFromARunFact('child', runFact('child', tried, { correlationId: 'top' }), false, rule),
      stepFromACause(causeOn('events/e1', { ...tried, runId: 'emitter' }, 'top'), rule),
    ]).toEqual([{ origin: 'test' }, { origin: 'test' }, { origin: 'test' }, { origin: 'test' }, { origin: 'test' }]);
  });
});

describe('the next step from the first fact of a run', () => {
  it('goes to the record that triggered an event-triggered run, or ends unknown when its start names none', () => {
    expect([
      stepFromARunFact('r1', runFact('r1', triggered, { causationId: 'cause' }), true, rule),
      stepFromARunFact('r1', runFact('r1', triggered), true, rule),
    ]).toEqual([{ record: 'cause' }, { origin: 'unknown' }]);
  });

  it('classifies the caller of a run that began its own chain, also when its correlation is not kept', () => {
    expect([
      stepFromARunFact('r1', runFact('r1', { by: 'person:user_one' }), true, rule),
      stepFromARunFact('r1', runFact('r1', { by: 'ops-key' }, { correlationId: null }), true, rule),
      stepFromARunFact('r1', runFact('r1', { by: 'playbook:sales' }), true, rule),
    ]).toEqual([{ origin: 'person' }, { origin: 'machine' }, { origin: 'playbook' }]);
  });

  it('goes to the caller of a called run whose correlation names itself', () => {
    expect(
      stepFromARunFact(
        'child',
        runFact('child', { calledBy: { runId: 'parent', reference: '/do/0', run: 1 } }),
        true,
        rule,
      ),
    ).toEqual({ firstFactOf: 'parent' });
  });
});

function causeOn(stream: string, context: Partial<Context>, correlationId: string | null = null): ChainFact {
  return {
    stream: `playbook/acme/sales/${stream}`,
    context: { at, by: 'playbook:sales', ...context },
    causationId: null,
    correlationId,
  };
}

describe('the next step from the record that triggered a run, made by a run', () => {
  it('goes to the top run of the run that emitted an event or whose fact it is', () => {
    expect([
      stepFromACause(causeOn('events/e1', { runId: 'emitter' }, 'top'), rule),
      stepFromACause(causeOn('events/e1', { runId: 'emitter' }), rule),
      stepFromACause(causeOn('runs/upstream', { by: 'local' }), rule),
      stepFromACause(
        { stream: 'runs/upstream', context: { at, by: 'local' }, causationId: null, correlationId: 'upstream' },
        rule,
      ),
    ]).toEqual([
      { firstFactOf: 'top' },
      { firstFactOf: 'emitter' },
      { firstFactOf: 'upstream' },
      { firstFactOf: 'upstream' },
    ]);
  });
});

describe('the next step from the record that triggered a run, with no run behind it', () => {
  it('classifies whoever published an event or saved a definition', () => {
    expect([
      stepFromACause(causeOn('events/e1', { by: 'person:user_one' }), rule),
      stepFromACause(causeOn('events/e2', { by: 'ops-key' }), rule),
      stepFromACause(causeOn('definitions/workflow/report', { by: 'local' }), rule),
      stepFromACause(causeOn('run-logs/r1', { by: 'an-internal-caller' }), rule),
    ]).toEqual([{ origin: 'person' }, { origin: 'machine' }, { origin: 'person' }, { origin: 'service' }]);
  });
});
