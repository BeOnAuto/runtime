import type { RecordedEvent } from '@on.auto/operations';
import { Effect, Function } from 'effect';
import { describe, expect, it } from 'vitest';

import { callConsumerOf, deliverySweeps, type Consumer, type FollowedRecord } from './consumers.ts';
import type { Mode } from './delivery-loop.ts';
import type { EventRead } from './followed-events.ts';
import type { Progress } from './followed-playbooks.ts';
import { stepOf, type StepParts, type Stepping } from './record-steps.ts';

const playbookKey = 'playbook/acme/alpha/';

const at = '2026-10-01T09:00:00.000Z';

const succeeded: RecordedEvent = {
  id: 'record-1',
  cursor: 'cursor-1',
  causationId: null,
  correlationId: null,
  stream: `${playbookKey}runs/r-1`,
  version: 2,
  globalPosition: 2,
  type: 'run_succeeded',
  data: { output_sha256: 'a'.repeat(64), output_bytes: 40_000, record: {} },
  context: {
    at,
    by: 'acme-admin',
    runId: 'r-1',
    definitionType: 'workflow',
    definitionName: 'report',
    definitionVersion: 1,
    calledBy: { runId: 'r-0', reference: '/do/0/report', run: 1 },
  },
  recordedAt: at,
};

const fresh: Progress = { cursor: null, delivered: null, attempts: 0, waiting: false };

interface Seen {
  readonly endings: readonly string[];
  readonly events: readonly unknown[];
  readonly missing: readonly string[];
}

function onceEach(key: string, deliver: Effect.Effect<void>) {
  return (after: string | undefined) =>
    Effect.succeed({
      deliveries: after === undefined ? [{ key, workflow: 'parent', deliver, skipped: () => Effect.void }] : [],
      through: undefined,
      more: false,
    });
}

function endingsTo(seen: (id: string) => void) {
  return callConsumerOf({
    name: 'child_endings',
    types: ['run_succeeded'],
    skippedAfterSweeps: deliverySweeps,
    readOf: (call) => call,
    batchOf: ({ record }, after) =>
      onceEach(
        'call',
        Effect.sync(() => {
          seen(record.id);
        }),
      )(after),
  });
}

function eventsTo(seen: (data: unknown) => void): Consumer {
  return {
    name: 'reports',
    types: ['run_succeeded'],
    skippedAfterSweeps: deliverySweeps,
    batchOf: ({ event }, after) =>
      onceEach(
        'report',
        Effect.sync(() => {
          seen(event.event.data);
        }),
      )(after),
  };
}

function partsSeeing(): { readonly parts: StepParts; readonly seen: () => Seen } {
  const seen = { endings: new Array<string>(), events: new Array<unknown>(), missing: new Array<string>() };
  const parts: StepParts = {
    consumers: [],
    registered: [
      eventsTo((data) => {
        seen.events.push(data);
      }),
    ],
    calls: [
      endingsTo((id) => {
        seen.endings.push(id);
      }),
    ],
    definitionType: 'workflow',
    applyDefinitionRecord: () => Effect.succeed('applied'),
    unreadable: () => Effect.void,
    contentMissing: (_playbookKey, { id }) =>
      Effect.sync(() => {
        seen.missing.push(id);
      }),
    passedEarly: () => Effect.void,
    holdsUnreadable: false,
  };
  return { parts, seen: () => seen };
}

function steppingReading(mode: Mode, read: (followed: FollowedRecord) => EventRead): Stepping {
  return {
    playbookKey,
    gate: { verdictOn: () => Effect.succeed('passed') },
    mode,
    delivered: () => new Set(['run_succeeded']),
    pageRead: Function.constVoid,
    readWithData: () => true,
    delivers: () => Effect.succeed(true),
    reactsTo: () => Effect.succeed(false),
    wantsMore: () => Effect.succeed(false),
    eventRead: (followed) => Effect.succeed(read(followed)),
  };
}

const output = { report: 'r'.repeat(40_000) };

function readWhole({ event }: FollowedRecord): EventRead {
  return { event: { ...event, event: { ...event.event, data: { output } } } };
}

describe('a run fact whose output its playbook keeps outside, while the content store does not answer', () => {
  it('gives its run’s ending to the call first, then holds its place for the events, and gives each once once read', async () => {
    const { parts, seen } = partsSeeing();

    const held = await Effect.runPromise(
      stepOf(
        parts,
        steppingReading('signal', () => 'held'),
        fresh,
        succeeded,
      ),
    );
    const read = await Effect.runPromise(stepOf(parts, steppingReading('sweep', readWhole), held.progress, succeeded));

    expect(held).toEqual({
      progress: { cursor: null, delivered: JSON.stringify(['child_endings', 'call']), attempts: 0, waiting: true },
      end: 'waiting',
      delivered: true,
      held: { heldFor: 'content', record: { id: 'record-1', type: 'run_succeeded' } },
    });
    expect(read.progress).toEqual({ cursor: 'cursor-1', delivered: null, attempts: 0, waiting: false });
    expect(seen()).toEqual({ endings: ['record-1'], events: [{ output }], missing: [] });
  });

  it('holds through any number of sweeps without counting one toward passing the record over', async () => {
    const { parts } = partsSeeing();
    const sweeps = Array.from({ length: deliverySweeps * 2 });

    const last = await Effect.runPromise(
      Effect.reduce(
        sweeps,
        () => fresh,
        (progress) =>
          Effect.map(
            stepOf(
              parts,
              steppingReading('sweep', () => 'held'),
              progress,
              succeeded,
            ),
            (step) => step.progress,
          ),
      ),
    );

    expect([last.attempts, last.waiting, last.cursor]).toEqual([0, true, null]);
  });
});

describe('a run fact whose kept output is missing from its playbook’s content', () => {
  it('gives its run’s ending to the call, passes the events over once, and says so', async () => {
    const { parts, seen } = partsSeeing();

    const step = await Effect.runPromise(
      stepOf(
        parts,
        steppingReading('signal', () => 'missing'),
        fresh,
        succeeded,
      ),
    );

    expect(step).toEqual({
      progress: { cursor: 'cursor-1', delivered: null, attempts: 0, waiting: false },
      delivered: true,
    });
    expect(seen()).toEqual({ endings: ['record-1'], events: [], missing: ['record-1'] });
  });
});
