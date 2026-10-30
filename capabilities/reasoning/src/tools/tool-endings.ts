import { Conflict, Unavailable, type RejectionBecause } from '@on.auto/operations';
import type { CallsEndedBecause } from '@on.auto/tool-servers';
import { Effect, type Schema } from 'effect';

type UnfinishedBecause = Extract<
  RejectionBecause,
  | 'server_failed'
  | 'model_unavailable'
  | 'definition_refused'
  | 'run_bound'
  | 'no_answer'
  | 'restarted_without_content'
  | 'call_outcome_unknown'
>;

const serverEndings = {
  failing: 'A tool server kept failing',
  rate_limited: 'A tool server kept asking the run to slow down for longer than it waits',
} as const;

export type ToolsStoppedBecause = 'server_failed' | 'run_bound' | 'no_answer';

export interface ToolUse {
  readonly calledAny: boolean;
  readonly onlyRead: boolean;
  readonly inWords: string;
  readonly ending: CallsEndedBecause | null;
}

export interface Spent {
  readonly record?: Schema.JsonObject;
}

function unfinished(use: ToolUse, because: UnfinishedBecause, detail: string, spent: Spent): Unavailable | Conflict {
  const ending = { detail: `${detail}, after the run called ${use.inWords}`, because, ...spent };
  return use.onlyRead
    ? new Unavailable({ ...ending, kind: 'tools_unfinished' })
    : new Conflict({ ...ending, kind: 'effect_unknown' });
}

export interface Stopped {
  readonly detail: string;
  readonly because: ToolsStoppedBecause;
}

function stoppedDetail({ ending }: ToolUse, stopped: Stopped): string {
  return ending === null ? stopped.detail : serverEndings[ending];
}

export function stoppedEnding(
  use: ToolUse | undefined,
  stopped: Stopped,
  spent: Spent = {},
): Effect.Effect<never, Unavailable | Conflict> {
  return Effect.fail(
    use?.calledAny === true
      ? unfinished(use, stopped.because, stoppedDetail(use, stopped), spent)
      : new Unavailable({ detail: stopped.detail, ...spent }),
  );
}

export function unavailableAfter(
  use: ToolUse | undefined,
  detail: string,
  advice: string,
  spent: Spent = {},
): Effect.Effect<never, Unavailable | Conflict> {
  return Effect.fail(
    use?.calledAny === true
      ? unfinished(use, 'model_unavailable', detail, spent)
      : new Unavailable({ detail: `${detail}${advice}`, ...spent }),
  );
}

export function unfinishedAfter(
  use: ToolUse,
  because: Extract<
    UnfinishedBecause,
    'server_failed' | 'definition_refused' | 'restarted_without_content' | 'call_outcome_unknown'
  >,
  detail: string,
  spent: Spent,
): Effect.Effect<never, Unavailable | Conflict> {
  return Effect.fail(
    use.calledAny ? unfinished(use, because, detail, spent) : new Unavailable({ detail, because, ...spent }),
  );
}
