import { taskNameOf } from '../dsl/tasks.ts';
import type { DslError } from '../machine/dsl-error.ts';
import type { TaskFrame } from '../machine/run-state.ts';
import { textCutAt } from '../programs/byte-sizes.ts';
import {
  keyOf,
  mostNameBytes,
  mostTitleBytes,
  type Resumed,
  type Step,
  type StepCause,
  type StepKey,
  type StepOutcome,
  type WaitsFor,
} from './step-entry.ts';

interface StepEntry {
  readonly reference: string;
  readonly run: number;
  readonly outcome: StepOutcome;
  readonly error?: DslError;
  readonly waitsFor?: WaitsFor;
  readonly child?: string;
  readonly times?: number;
}

export interface StepJournal {
  readonly record: (entry: StepEntry) => StepKey;
  readonly continues: (frame: TaskFrame) => void;
  readonly cause: () => StepCause;
  readonly causedBy: (cause: StepCause) => void;
  readonly resumedFrom: (waiting: Resumed) => void;
  readonly steps: () => readonly Step[];
  readonly resumed: () => Resumed | null;
}

interface Course {
  cause: StepCause;
  resumed: Resumed | null;
}

interface Place {
  step: Step;
}

function errorShown(error: DslError | undefined): Pick<Step, 'error'> {
  if (error === undefined) {
    return {};
  }
  const { type, title } = error;
  return { error: { type, ...(title === undefined ? {} : { title: textCutAt(title, mostTitleBytes) }) } };
}

function stepOf({ reference, run }: Pick<StepKey, 'reference' | 'run'>): string {
  return JSON.stringify([reference, run]);
}

function textOf({ reference, run, outcome, times }: StepKey): string {
  return JSON.stringify([reference, run, outcome, times]);
}

function causedAnew(step: Step, cause: StepCause): Step {
  return { ...step, caused_by: cause };
}

function latestEntryOf({ reference, run, body }: TaskFrame): StepKey {
  if (body.kind === 'listen') {
    return { reference, run, outcome: 'waiting', times: body.waited };
  }
  const waits = body.kind === 'call' || body.kind === 'wait';
  return { reference, run, outcome: waits ? 'waiting' : 'started', times: 1 };
}

export function stepJournalOf(): StepJournal {
  const places: Place[] = [];
  const placeOfStep = new Map<string, Place>();
  const placeOfKey = new Map<string, Place>();
  const earlier = new Map<string, StepKey>();
  const course: Course = { cause: 'input', resumed: null };
  const settledCause = (cause: StepCause): StepCause => {
    const place = cause === 'input' ? undefined : placeOfKey.get(textOf(cause));
    return place === undefined ? cause : keyOf(place.step);
  };
  return {
    record: (entry) => {
      const { reference, run, outcome, waitsFor, child } = entry;
      const key = { reference, run, outcome, times: entry.times ?? 1 };
      const place = placeOfStep.get(stepOf(key));
      const step = {
        ...key,
        name: textCutAt(taskNameOf(reference), mostNameBytes),
        caused_by: place?.step.caused_by ?? earlier.get(stepOf(key)) ?? course.cause,
        ...errorShown(entry.error),
        ...(waitsFor === undefined ? {} : { waits_for: waitsFor }),
        ...(child === undefined ? {} : { child }),
      };
      const placed = place ?? { step };
      placed.step = step;
      if (place === undefined) {
        places.push(placed);
        placeOfStep.set(stepOf(key), placed);
      }
      placeOfKey.set(textOf(key), placed);
      if (outcome !== 'cancelled') {
        course.cause = key;
      }
      return key;
    },
    continues: (frame) => {
      earlier.set(stepOf(frame), latestEntryOf(frame));
    },
    cause: () => course.cause,
    causedBy: (cause) => {
      course.cause = cause;
    },
    resumedFrom: (waiting) => {
      course.resumed ??= waiting;
    },
    steps: () => places.map((place: Readonly<Place>) => causedAnew(place.step, settledCause(place.step.caused_by))),
    resumed: () => course.resumed,
  };
}
