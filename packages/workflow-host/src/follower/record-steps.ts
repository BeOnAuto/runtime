import { playbookOfStreamPrefix, streamKindOf, type PlaybookAddress, type RecordedEvent } from '@on.auto/operations';
import { Effect, Option } from 'effect';

import { followSpanOf } from '../runs/run-spans.ts';
import type { ApplyDefinitionRecord } from '../triggers/definition-records.ts';
import {
  boundTo,
  deliverySweeps,
  type CallConsumer,
  type Consumer,
  type Reading,
  type RecordConsumer,
} from './consumers.ts';
import { deliveredAll, type Mode } from './delivery-loop.ts';
import { followedEventOf } from './followed-events.ts';
import type { Progress } from './followed-playbooks.ts';
import { relativeRecord } from './playbook-records.ts';
import type { RunGate } from './run-gate.ts';

export type PassEnd = 'caught_up' | 'more' | 'waiting';

export interface Step {
  readonly progress: Progress;
  readonly end?: PassEnd;
  readonly delivered?: boolean;
}

export interface StepParts {
  readonly consumers: readonly RecordConsumer[];
  readonly registered: readonly Consumer[];
  readonly calls: readonly CallConsumer[];
  readonly definitionType: string;
  readonly applyDefinitionRecord: ApplyDefinitionRecord;
  readonly unreadable: (playbookKey: string, record: Pick<RecordedEvent, 'id' | 'type'>) => Effect.Effect<void>;
  readonly passedEarly: (playbookKey: string, record: RecordedEvent, sweeps: number) => Effect.Effect<void>;
}

export interface Stepping {
  readonly playbookKey: string;
  readonly gate: RunGate;
  readonly mode: Mode;
  readonly delivered: () => ReadonlySet<string>;
  readonly pageRead: (delivered: ReadonlySet<string>) => void;
  readonly readWithData: (type: string) => boolean;
  readonly delivers: (type: string) => Effect.Effect<boolean>;
  readonly reactsTo: (type: string) => Effect.Effect<boolean>;
  readonly wantsMore: () => Effect.Effect<boolean>;
}

export function playbookOfKey(playbookKey: string): PlaybookAddress {
  return Option.getOrThrowWith(
    playbookOfStreamPrefix(playbookKey),
    () => new Error(`The host follows ${playbookKey}, which is not the key of a playbook`),
  );
}

function passedOver(record: RecordedEvent): Progress {
  return { cursor: record.cursor, delivered: null, attempts: 0, waiting: false };
}

function unreadableStep(parts: StepParts, playbookKey: string, record: RecordedEvent): Effect.Effect<Step> {
  return Effect.as(parts.unreadable(playbookKey, record), { progress: passedOver(record) });
}

function runRecordStep(parts: StepParts, stepping: Stepping, progress: Progress, record: RecordedEvent) {
  const { gate, mode, playbookKey } = stepping;
  const sweeps = mode === 'sweep' ? progress.attempts + 1 : progress.attempts;
  return Effect.flatMap(gate.verdictOn(record, mode === 'sweep' && sweeps >= deliverySweeps), (verdict) => {
    if (verdict === 'held') {
      return Effect.succeed<Step>({ progress: { ...progress, attempts: sweeps, waiting: true }, end: 'waiting' });
    }
    const passed: Step = { progress: passedOver(record) };
    if (verdict === 'passed') {
      return Effect.succeed(passed);
    }
    const noted = verdict === 'overdue' ? parts.passedEarly(playbookKey, record, sweeps) : Effect.void;
    const ended = Effect.map(stepping.wantsMore(), (more): Step => (more ? { ...passed, end: 'more' } : passed));
    return Effect.andThen(noted, ended);
  });
}

function followedReadingsOf(
  parts: StepParts,
  stepping: Stepping,
  relative: RecordedEvent,
): Effect.Effect<readonly Reading[]> {
  const { playbookKey } = stepping;
  const event = followedEventOf(relative, parts.definitionType);
  if (event === 'none') {
    return Effect.succeed([]);
  }
  if (event === 'unreadable') {
    return Effect.succeed(['unreadable']);
  }
  const followed = { playbook: playbookOfKey(playbookKey), playbookKey, record: relative, event };
  const wanting = parts.registered.filter(({ types }) => types.includes(event.event.type));
  return Effect.map(stepping.reactsTo(event.event.type), (reacting) =>
    [...(reacting ? parts.consumers : []), ...wanting].map((consumer) => boundTo(consumer, followed)),
  );
}

function readingsOf(parts: StepParts, stepping: Stepping, record: RecordedEvent): Effect.Effect<readonly Reading[]> {
  const { playbookKey } = stepping;
  const relative = relativeRecord(playbookKey, record);
  const call = { playbook: playbookOfKey(playbookKey), playbookKey, record: relative };
  const calls = parts.calls.filter(({ types }) => types.includes(record.type)).map((consumer) => consumer.read(call));
  return Effect.map(followedReadingsOf(parts, stepping, relative), (followed) => [...calls, ...followed]);
}

function deliveredStep(
  parts: StepParts,
  stepping: Stepping,
  progress: Progress,
  record: RecordedEvent,
): Effect.Effect<Step> {
  return Effect.flatMap(readingsOf(parts, stepping, record), (readings) => {
    const consumers = readings.filter((reading) => reading !== 'unreadable');
    if (consumers.length < readings.length) {
      return unreadableStep(parts, stepping.playbookKey, record);
    }
    if (consumers.length === 0) {
      return Effect.succeed({ progress: passedOver(record) });
    }
    return deliveredAll(consumers, progress, stepping.mode).pipe(
      Effect.withSpan(`follow ${record.type}`, followSpanOf(record)),
      Effect.map(({ made, ...delivered }) =>
        delivered.end === undefined
          ? { progress: passedOver(record), delivered: made }
          : { ...delivered, delivered: made },
      ),
    );
  });
}

export function stepOf(
  parts: StepParts,
  stepping: Stepping,
  progress: Progress,
  record: RecordedEvent,
): Effect.Effect<Step> {
  const { playbookKey } = stepping;
  if (streamKindOf(record.stream.slice(playbookKey.length)) === 'run-logs') {
    return runRecordStep(parts, stepping, progress, record);
  }
  const step: Effect.Effect<Step> = stepping.readWithData(record.type)
    ? deliveredStep(parts, stepping, progress, record)
    : Effect.map(stepping.delivers(record.type), (namedSince): Step =>
        namedSince ? { progress, end: 'more' } : { progress: passedOver(record) },
      );
  if (record.stream === `${playbookKey}definitions/${parts.definitionType}`) {
    const readAgain: Effect.Effect<Step> = Effect.succeed({ progress, end: 'more' });
    return Effect.flatMap(parts.applyDefinitionRecord(playbookKey, record), (applied) =>
      applied === 'unreadable'
        ? unreadableStep(parts, playbookKey, record)
        : Effect.flatMap(stepping.wantsMore(), (more) => (more ? readAgain : step)),
    );
  }
  return step;
}
