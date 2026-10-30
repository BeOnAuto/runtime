import { mostInputMs, type Place } from '../dsl/evaluation.ts';
import { withReachableValuesOnly } from '../machine/held-values.ts';
import type { RunState, TaskFrame, ValueId } from '../machine/run-state.ts';
import { stepJournalOf, type StepJournal } from '../steps/step-journal.ts';
import { countersOf, runCellOf, type Counters, type RunCell } from './run-cell.ts';
import { descriptorsOf, type DecidingOptions, type Descriptors, type MachineOptions } from './run-descriptors.ts';
import { lifecycleOf, type Ending, type Lifecycle } from './run-ending.ts';
import { emissionTableOf, inboxOf, type EmissionTable, type Inbox, type OfferVerdict } from './run-inbox.ts';
import { journalOf, meterOf, valueTableOf, type Journal, type Meter, type ValueTable } from './run-tables.ts';
import {
  callTableOf,
  listenerTableOf,
  timerTableOf,
  type CallTable,
  type ListenerTable,
  type TimerTable,
} from './run-timers.ts';

export interface SessionResult {
  readonly state: RunState;
  readonly outputs: ReturnType<Journal['outputs']>;
  readonly steps: ReturnType<StepJournal['steps']>;
  readonly resumed: ReturnType<StepJournal['resumed']>;
  readonly offer: OfferVerdict | undefined;
}

export interface Session
  extends ValueTable, Inbox, Counters, Descriptors, Lifecycle, Omit<StepJournal, 'steps' | 'resumed'> {
  readonly now: number;
  readonly options: MachineOptions;
  readonly meter: Meter;
  readonly placeAt: (reference: string) => Place;
  readonly timers: TimerTable;
  readonly calls: CallTable;
  readonly listeners: ListenerTable;
  readonly emissions: EmissionTable;
  readonly decideOffer: (verdict: OfferVerdict) => void;
  readonly context: () => ValueId;
  readonly replaceContext: (id: ValueId) => void;
  readonly root: () => TaskFrame | null;
  readonly setRoot: (root: TaskFrame | null) => void;
  readonly result: () => SessionResult;
}

function resultOf(
  cell: RunCell,
  values: ValueTable,
  { ending, emissions }: { readonly ending: Ending; readonly emissions: EmissionTable },
  now: number,
): RunState {
  const run = cell.get();
  return withReachableValuesOnly({
    ...run.state,
    lastInputAt: now,
    inputs: run.state.inputs + 1,
    random: { seed: run.state.random.seed, draws: run.draws },
    runs: run.runs,
    timers: ending.timers.timers(),
    calls: ending.calls.calls(),
    listeners: ending.listeners.listeners(),
    emitted: emissions.emitted(),
    inbox: ending.inbox.inbox(),
    stepsWithoutWaiting: run.stepsWithoutWaiting,
    machine: { values: values.values(), nextValue: values.nextValue(), context: run.context, root: run.root },
  });
}

function endingOf(state: RunState, now: number, descriptors: Descriptors, journal: Journal): Ending {
  const timers = timerTableOf(state, descriptors, now, journal);
  return {
    timers,
    calls: callTableOf(state, descriptors, { timers, journal, now }),
    listeners: listenerTableOf(state, journal),
    inbox: inboxOf(state.inbox),
    journal,
  };
}

interface Placing {
  readonly now: number;
  readonly meter: Meter;
  readonly options: DecidingOptions;
  readonly mostDuration: () => number;
}

function placesOf({ now, meter, options, mostDuration }: Placing): (reference: string) => Place {
  const deadlineAt = options.sandbox.clock() + mostInputMs;
  return (reference) => ({ reference, now, meter, mostDuration: mostDuration(), unit: options.unit, deadlineAt });
}

export function sessionOf(state: RunState, now: number, options: DecidingOptions): Session {
  const cell = runCellOf(state);
  const journal = journalOf();
  const steps = stepJournalOf();
  const values = valueTableOf(state.machine);
  const descriptors = descriptorsOf(cell, values);
  const ending = endingOf(state, now, descriptors, journal);
  const { timers, calls, listeners, inbox } = ending;
  const emissions = emissionTableOf(state.emitted, journal);
  const meter = meterOf();
  const offer: { verdict: OfferVerdict | undefined } = { verdict: undefined };
  return {
    now,
    options,
    meter,
    placeAt: placesOf({ now, meter, options, mostDuration: () => descriptors.limits().mostDurationMs }),
    timers,
    calls,
    listeners,
    emissions,
    decideOffer: (verdict) => {
      offer.verdict = verdict;
    },
    ...values,
    ...inbox,
    ...countersOf(cell, options.sandbox.mostStepsWithoutWaiting),
    ...descriptors,
    ...lifecycleOf(cell, ending, now),
    context: () => cell.get().context,
    replaceContext: (context) => {
      cell.update({ context });
    },
    record: steps.record,
    continues: steps.continues,
    cause: steps.cause,
    causedBy: steps.causedBy,
    resumedFrom: steps.resumedFrom,
    root: () => cell.get().root,
    setRoot: (root) => {
      cell.update({ root });
    },
    result: () => ({
      state: resultOf(cell, values, { ending, emissions }, now),
      outputs: journal.outputs(),
      steps: steps.steps(),
      resumed: steps.resumed(),
      offer: offer.verdict,
    }),
  };
}
