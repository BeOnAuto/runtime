import { Unavailable } from '@on.auto/operations';
import { mostExpressionWork, mostInputMs, type FilterSandbox } from '@on.auto/workflow-engine';
import { enclosedBody, type ProgramRun } from '@on.auto/workflow-engine/dsl';
import { Effect } from 'effect';

import { resolvedAt } from '../observations/json-pointer.ts';
import type { ConditionVerdict, ConditionVerdicts, ContributedRun } from '../observations/observation.ts';
import { mostItems } from '../observations/observations.ts';

export const mostConditionWork = 4000;

export const mostConditionsKept = 4;

export interface ConditionedEntry {
  readonly when?: string;
  readonly each?: string;
}

export interface ConditionedRun extends Pick<ContributedRun, 'record' | 'ended_at' | 'output'> {
  readonly entries: readonly ConditionedEntry[];
}

export type RunVerdicts = readonly (ConditionVerdicts | undefined)[];

export interface ConditionWork {
  readonly sessions: number;
  readonly evaluations: number;
  readonly work: number;
}

export interface RunConditions {
  readonly verdictsOf: (run: ConditionedRun) => Effect.Effect<RunVerdicts, Unavailable>;
  readonly spent: () => ConditionWork;
}

type Session = Awaited<ReturnType<FilterSandbox['session']>>;

type Test = ReturnType<Session['define']>;

interface Asked {
  readonly entry: number;
  readonly source: string;
  readonly value: unknown;
}

type Answer = { readonly verdict: ConditionVerdict; readonly stops: boolean } | 'cut';

interface Counting {
  readonly opened: () => void;
  readonly evaluated: (work: number) => void;
}

const notEvaluatedNow = 'The conditions of a run could not be evaluated just now; try again in a moment';

function sourceOf(when: string): string {
  return enclosedBody(when) ?? when;
}

function itemsOf(output: unknown, each: string | undefined): readonly unknown[] {
  if (each === undefined) {
    return [output];
  }
  const resolved = resolvedAt(output, each);
  return resolved.found && Array.isArray(resolved.value) ? resolved.value.slice(0, mostItems) : [];
}

function askedOf(run: ConditionedRun): readonly Asked[] {
  return run.entries.flatMap(({ when, each }, entry) =>
    when === undefined ? [] : itemsOf(run.output, each).map((value) => ({ entry, source: sourceOf(when), value })),
  );
}

function verdictOfValue(text: string): ConditionVerdict {
  const value: unknown = JSON.parse(text);
  return value === null ? null : value !== false;
}

function answerOf(run: ProgramRun, allowance: number): Answer {
  if (run.ran === 'answered') {
    return { verdict: verdictOfValue(run.text), stops: false };
  }
  if (run.ran === 'exhausted' && run.limit === 'work' && allowance < mostExpressionWork) {
    return 'cut';
  }
  if (run.ran === 'exhausted' && run.limit === 'work') {
    return {
      verdict: { failed: `${run.issue.detail}: a condition may do ${mostExpressionWork} checkpoints of work` },
      stops: false,
    };
  }
  return {
    verdict: { failed: run.issue.detail },
    stops: run.ran === 'exhausted' && (run.limit === 'memory' || run.limit === 'deadline'),
  };
}

function verdictsByEntry(
  run: ConditionedRun,
  asked: readonly Asked[],
  answered: readonly ConditionVerdict[],
): RunVerdicts {
  return run.entries.map(({ when }, entry): ConditionVerdicts | undefined => {
    if (when === undefined) {
      return undefined;
    }
    const ofEntry = asked.flatMap((each, index) => (each.entry === entry ? [index] : []));
    const reached = ofEntry.flatMap((index) => answered.slice(index, index + 1));
    return reached.length === 0 && ofEntry.length > 0 ? 'not_reached' : reached;
  });
}

interface Prepared {
  readonly value: unknown;
  readonly test: Test;
}

function preparedIn(session: Session, asked: readonly Asked[]): readonly Prepared[] {
  const defined = new Map<string, Test>();
  return asked.map(({ source, value }) => {
    const test = defined.get(source) ?? session.define(source);
    defined.set(source, test);
    return { value, test };
  });
}

interface Evaluating {
  readonly clock: () => number;
  readonly moment: number;
  readonly counting: Counting;
}

async function answeredFrom(
  prepared: readonly Prepared[],
  evaluating: Evaluating,
  used: number,
): Promise<readonly ConditionVerdict[]> {
  const [next, ...rest] = prepared;
  const allowance = Math.min(mostExpressionWork, mostConditionWork - used);
  if (next === undefined || allowance <= 0) {
    return [];
  }
  const { clock, moment, counting } = evaluating;
  const ran = await next.test(JSON.stringify(next.value) ?? 'null', {
    budget: allowance,
    deadlineAt: clock() + mostInputMs,
    moment,
  });
  const work = Math.max(ran.work, 1);
  counting.evaluated(work);
  const answer = answerOf(ran, allowance);
  if (answer === 'cut') {
    return [];
  }
  return answer.stops ? [answer.verdict] : [answer.verdict, ...(await answeredFrom(rest, evaluating, used + work))];
}

interface Asking {
  readonly run: ConditionedRun;
  readonly asked: readonly Asked[];
}

async function answeredIn(
  sandbox: FilterSandbox,
  { run, asked }: Asking,
  counting: Counting,
): Promise<readonly ConditionVerdict[]> {
  if (asked.length === 0) {
    return [];
  }
  const moment = run.ended_at;
  counting.opened();
  const session = await sandbox.session(() => ({
    budget: Number.POSITIVE_INFINITY,
    deadlineAt: sandbox.clock() + mostInputMs,
    moment,
  }));
  try {
    const prepared = preparedIn(session, asked);
    await session.freeze();
    return await answeredFrom(prepared, { clock: sandbox.clock, moment, counting }, 0);
  } finally {
    session.close();
  }
}

export function runConditionsOf(sandbox: FilterSandbox): RunConditions {
  const kept = new Map<string, RunVerdicts>();
  const spending = { sessions: 0, evaluations: 0, work: 0 };
  const counting: Counting = {
    opened: () => {
      spending.sessions += 1;
    },
    evaluated: (work) => {
      spending.evaluations += 1;
      spending.work += work;
    },
  };
  const remembered = (record: string, verdicts: RunVerdicts): RunVerdicts => {
    kept.delete(record);
    kept.set(record, verdicts);
    for (const oldest of [...kept.keys()].slice(0, Math.max(0, kept.size - mostConditionsKept))) {
      kept.delete(oldest);
    }
    return verdicts;
  };
  return {
    verdictsOf: (run) =>
      Effect.suspend(() => {
        const held = kept.get(run.record);
        if (held !== undefined) {
          return Effect.succeed(remembered(run.record, held));
        }
        const asked = askedOf(run);
        return Effect.tryPromise({
          try: () => answeredIn(sandbox, { run, asked }, counting),
          catch: () => new Unavailable({ detail: notEvaluatedNow }),
        }).pipe(Effect.map((answered) => remembered(run.record, verdictsByEntry(run, asked, answered))));
      }),
    spent: () => ({ ...spending }),
  };
}
