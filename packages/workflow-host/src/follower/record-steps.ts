import { playbookOfStreamPrefix, streamKindOf, type PlaybookAddress, type RecordedEvent } from '@on.auto/operations';
import { Effect, Option } from 'effect';

import { followSpanOf } from '../runs/run-spans.ts';
import type { ApplyDefinitionRecord } from '../triggers/definition-records.ts';
import {
  boundTo,
  deliverySweeps,
  type CallConsumer,
  type Consumer,
  type FollowedRecord,
  type Reading,
  type RecordConsumer,
} from './consumers.ts';
import { deliveredAll, type Mode } from './delivery-loop.ts';
import { followedEventOf, isDefinitionFact, type EventRead } from './followed-events.ts';
import type { HeldFor, Progress } from './followed-playbooks.ts';
import { relativeRecord } from './playbook-records.ts';
import type { RunGate } from './run-gate.ts';

export type PassEnd = 'caught_up' | 'more' | 'waiting';

export interface Held {
  readonly heldFor: HeldFor;
  readonly record: Pick<RecordedEvent, 'id' | 'type'>;
}

export interface Step {
  readonly progress: Progress;
  readonly end?: PassEnd;
  readonly delivered?: boolean;
  readonly held?: Held;
}

export interface StepParts {
  readonly consumers: readonly RecordConsumer[];
  readonly registered: readonly Consumer[];
  readonly calls: readonly CallConsumer[];
  readonly definitionType: string;
  readonly applyDefinitionRecord: ApplyDefinitionRecord;
  readonly unreadable: (playbookKey: string, record: Pick<RecordedEvent, 'id' | 'type'>) => Effect.Effect<void>;
  readonly contentMissing: (playbookKey: string, record: Pick<RecordedEvent, 'id' | 'type'>) => Effect.Effect<void>;
  readonly passedEarly: (playbookKey: string, record: RecordedEvent, sweeps: number) => Effect.Effect<void>;
  readonly holdsUnreadable: boolean;
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
  readonly eventRead: (followed: FollowedRecord) => Effect.Effect<EventRead>;
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

function heldAt(heldFor: HeldFor, { id, type }: Held['record']): Held {
  return { heldFor, record: { id, type } };
}

function heldStep(progress: Progress, held: Held): Step {
  return { progress: { ...progress, waiting: true }, end: 'waiting', held };
}

function passedAsUnreadable(parts: StepParts, playbookKey: string, record: RecordedEvent): Effect.Effect<Step> {
  return Effect.as(parts.unreadable(playbookKey, record), { progress: passedOver(record) });
}

function unreadableStep(
  parts: StepParts,
  stepping: Stepping,
  progress: Progress,
  record: RecordedEvent,
): Effect.Effect<Step> {
  return parts.holdsUnreadable
    ? Effect.succeed(heldStep(progress, heldAt('unreadable', record)))
    : passedAsUnreadable(parts, stepping.playbookKey, record);
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

type ContentOfTheEvent = 'read' | 'held' | 'missing';

interface Readings {
  readonly readings: readonly Reading[];
  readonly content: ContentOfTheEvent;
}

const nothingFollowed: Readings = { readings: [], content: 'read' };

function boundToTheRead(
  stepping: Stepping,
  followed: FollowedRecord,
  consumers: readonly RecordConsumer[],
): Effect.Effect<Readings> {
  return Effect.map(stepping.eventRead(followed), (read) =>
    typeof read === 'string'
      ? { readings: [], content: read }
      : {
          readings: consumers.map((consumer) => boundTo(consumer, { ...followed, event: read.event })),
          content: 'read',
        },
  );
}

function followedReadingsOf(parts: StepParts, stepping: Stepping, relative: RecordedEvent): Effect.Effect<Readings> {
  const { playbookKey } = stepping;
  const event = followedEventOf(relative, parts.definitionType);
  if (event === 'none') {
    return Effect.succeed(nothingFollowed);
  }
  if (event === 'unreadable') {
    return Effect.succeed({ readings: ['unreadable'], content: 'read' });
  }
  const followed = { playbook: playbookOfKey(playbookKey), playbookKey, record: relative, event };
  const wanting = parts.registered.filter(({ types }) => types.includes(event.event.type));
  return Effect.flatMap(stepping.reactsTo(event.event.type), (reacting) => {
    const consumers = [...(reacting ? parts.consumers : []), ...wanting];
    return consumers.length === 0 ? Effect.succeed(nothingFollowed) : boundToTheRead(stepping, followed, consumers);
  });
}

function readingsOf(parts: StepParts, stepping: Stepping, record: RecordedEvent): Effect.Effect<Readings> {
  const { playbookKey } = stepping;
  const relative = relativeRecord(playbookKey, record);
  const call = { playbook: playbookOfKey(playbookKey), playbookKey, record: relative };
  const calls = parts.calls.filter(({ types }) => types.includes(record.type)).map((consumer) => consumer.read(call));
  return Effect.map(followedReadingsOf(parts, stepping, relative), ({ readings, content }) => ({
    readings: [...calls, ...readings],
    content,
  }));
}

function afterTheDeliveries(
  parts: StepParts,
  stepping: Stepping,
  record: RecordedEvent,
  content: ContentOfTheEvent,
): (delivered: { readonly progress: Progress; readonly made: boolean }) => Effect.Effect<Step> {
  return ({ progress, made }) => {
    if (content === 'held') {
      return Effect.succeed({ ...heldStep(progress, heldAt('content', record)), delivered: made });
    }
    const passed: Step = { progress: passedOver(record), delivered: made };
    return content === 'missing'
      ? Effect.as(parts.contentMissing(stepping.playbookKey, record), passed)
      : Effect.succeed(passed);
  };
}

function deliveredStep(
  parts: StepParts,
  stepping: Stepping,
  progress: Progress,
  record: RecordedEvent,
): Effect.Effect<Step> {
  return Effect.flatMap(readingsOf(parts, stepping, record), ({ readings, content }) => {
    const consumers = readings.filter((reading) => reading !== 'unreadable');
    if (consumers.length < readings.length) {
      return unreadableStep(parts, stepping, progress, record);
    }
    if (consumers.length === 0 && content === 'read') {
      return Effect.succeed({ progress: passedOver(record) });
    }
    return deliveredAll(consumers, progress, stepping.mode).pipe(
      Effect.withSpan(`follow ${record.type}`, followSpanOf(record)),
      Effect.flatMap(({ made, held, ...delivered }) => {
        if (delivered.end !== undefined) {
          const step: Step = { ...delivered, delivered: made };
          return Effect.succeed(held === undefined ? step : { ...step, held: heldAt(held, record) });
        }
        return afterTheDeliveries(parts, stepping, record, content)({ progress: delivered.progress, made });
      }),
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
    return Effect.flatMap(parts.applyDefinitionRecord(playbookKey, record), (applied) => {
      if (applied === 'applied') {
        return Effect.flatMap(stepping.wantsMore(), (more) => (more ? readAgain : step));
      }
      return isDefinitionFact(record.type)
        ? unreadableStep(parts, stepping, progress, record)
        : passedAsUnreadable(parts, playbookKey, record);
    });
  }
  return step;
}
