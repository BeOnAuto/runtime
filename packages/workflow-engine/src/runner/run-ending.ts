import type { JsonObject } from '../dsl/json.ts';
import { settlementOf } from '../dsl/raised-error.ts';
import type { RunLimits } from '../machine/run-input.ts';
import type { RunOutcome, ValueId } from '../machine/run-state.ts';
import type { RunCell } from './run-cell.ts';
import type { Inbox } from './run-inbox.ts';
import type { Journal } from './run-tables.ts';
import type { CallTable, ListenerTable, TimerTable } from './run-timers.ts';

interface RunStart {
  readonly runId: string;
  readonly document: JsonObject;
  readonly input: ValueId;
  readonly limits: RunLimits;
  readonly attributes: JsonObject;
  readonly seed: number;
}

export interface Lifecycle {
  readonly begin: (start: RunStart) => void;
  readonly requestCancel: () => void;
  readonly end: (outcome: RunOutcome) => void;
}

export interface Ending {
  readonly timers: TimerTable;
  readonly calls: CallTable;
  readonly listeners: ListenerTable;
  readonly inbox: Inbox;
  readonly journal: Journal;
}

export function lifecycleOf(cell: RunCell, ending: Ending, now: number): Lifecycle {
  return {
    begin: ({ runId, document, input, limits, attributes, seed }) => {
      const { state } = cell.get();
      cell.update({
        state: {
          ...state,
          runId,
          status: 'running',
          workflow: { document, input },
          attributes,
          limits,
          startedAt: now,
          random: { seed, draws: 0 },
        },
      });
    },
    requestCancel: () => {
      cell.update({ state: { ...cell.get().state, cancelRequested: true } });
    },
    end: (outcome) => {
      ending.calls.cancelAll('parent_ended');
      ending.listeners.cancelAll();
      ending.timers.disarmAll();
      ending.inbox.clear();
      const { state } = cell.get();
      cell.update({ state: { ...state, status: 'ended', outcome }, root: null });
      ending.journal.emit({ kind: 'settle', runId: state.runId, settlement: settlementOf(outcome) });
    },
  };
}
