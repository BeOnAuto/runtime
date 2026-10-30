import { mostFilterMs, mostInputMs, testedOrRaised } from '../dsl/evaluation.ts';
import type { Json, JsonObject } from '../dsl/json.ts';
import { RaisedError } from '../dsl/raised-error.ts';
import type { DslError } from '../machine/dsl-error.ts';
import type { Evaluation, Limit, ProgramFailure, ProgramRun } from '../programs/program-run.ts';
import { meterOf, type Meter } from '../runner/run-tables.ts';
import { attributeHoldsLater, filterAttributesOf, type FilterAttribute } from './attribute-match.ts';
import type { FilterVerdict, LiteralFilter } from './event-filter.ts';

type AskedTest = (value: string, evaluation: Evaluation) => Promise<ProgramRun>;

export interface FilterSession {
  readonly define: (source: string) => AskedTest;
  readonly freeze: () => Promise<ProgramFailure | undefined>;
  readonly close: () => void;
}

export interface FilterSandbox {
  readonly session: (opening: () => Evaluation) => Promise<FilterSession>;
  readonly clock: () => number;
}

export type MatchedFilter = Pick<LiteralFilter, 'reference' | 'attributes'>;

async function verdictUnlessRaised(
  holds: () => Promise<boolean>,
  failed: (error: DslError) => FilterVerdict,
): Promise<FilterVerdict> {
  try {
    return await holds();
  } catch (error) {
    if (!(error instanceof RaisedError)) {
      throw error;
    }
    return failed(error.error);
  }
}

interface PreparedFilter {
  readonly reference: string;
  readonly attributes: readonly FilterAttribute<AskedTest>[];
}

interface Tested {
  readonly verdicts: readonly FilterVerdict[];
  readonly limited: boolean;
}

interface PreparedSession {
  readonly session: FilterSession;
  readonly prepared: readonly PreparedFilter[];
}

export interface FilterTesting {
  readonly verdictsOf: (event: JsonObject, now: number) => Promise<readonly FilterVerdict[]>;
  readonly close: () => Promise<void>;
}

interface Testing {
  readonly meter: Meter;
  readonly reference: string;
  readonly deadlineAt: number;
  readonly now: number;
  readonly exhausted: (limit: Limit) => void;
}

const limitsNoEventCauses: ReadonlySet<Limit> = new Set(['deadline', 'memory']);

function preparedOf({ reference, attributes }: MatchedFilter, define: FilterSession['define']): PreparedFilter {
  return { reference, attributes: filterAttributesOf(attributes, define) };
}

function verdictIn(testing: Testing): (test: AskedTest, actual: Json, source: string) => Promise<Json> {
  return async (test, actual, source) => {
    const run = await test(JSON.stringify(actual), {
      budget: testing.meter.allowance(),
      deadlineAt: testing.deadlineAt,
      moment: testing.now,
    });
    if (run.ran === 'exhausted') {
      testing.exhausted(run.limit);
    }
    return testedOrRaised(source, run, testing);
  };
}

async function attributesHold(
  attributes: readonly FilterAttribute<AskedTest>[],
  event: JsonObject,
  testing: Testing,
): Promise<boolean> {
  const [attribute, ...rest] = attributes;
  if (attribute === undefined) {
    return true;
  }
  return (await attributeHoldsLater(attribute, event, verdictIn(testing))) && attributesHold(rest, event, testing);
}

async function verdictsUntilLimited(
  filters: readonly PreparedFilter[],
  event: JsonObject,
  sandbox: FilterSandbox,
  now: number,
): Promise<Tested> {
  const [filter, ...rest] = filters;
  if (filter === undefined) {
    return { verdicts: [], limited: false };
  }
  const state: { limit: Limit | undefined } = { limit: undefined };
  const testing: Testing = {
    meter: meterOf(),
    reference: filter.reference,
    deadlineAt: sandbox.clock() + mostFilterMs,
    now,
    exhausted: (limit) => {
      state.limit = limit;
    },
  };
  const verdict = await verdictUnlessRaised(
    () => attributesHold(filter.attributes, event, testing),
    (error) => ({ error, stopped: state.limit !== undefined && limitsNoEventCauses.has(state.limit) }),
  );
  if (state.limit !== undefined) {
    return { verdicts: [verdict], limited: true };
  }
  const after = await verdictsUntilLimited(rest, event, sandbox, now);
  return { verdicts: [verdict, ...after.verdicts], limited: after.limited };
}

function openingAt(sandbox: FilterSandbox, now: number): () => Evaluation {
  return () => ({ budget: Number.POSITIVE_INFINITY, deadlineAt: sandbox.clock() + mostInputMs, moment: now });
}

async function verdictsInSession(
  session: FilterSession,
  filters: readonly MatchedFilter[],
  event: JsonObject,
  { sandbox, now }: { readonly sandbox: FilterSandbox; readonly now: number },
): Promise<readonly FilterVerdict[]> {
  try {
    const prepared = filters.map((filter) => preparedOf(filter, session.define));
    await session.freeze();
    return (await verdictsUntilLimited(prepared, event, sandbox, now)).verdicts;
  } finally {
    session.close();
  }
}

export async function filterVerdictsOf(
  filters: readonly MatchedFilter[],
  event: JsonObject,
  sandbox: FilterSandbox,
  now: number,
): Promise<readonly FilterVerdict[]> {
  if (filters.length === 0) {
    return [];
  }
  const session = await sandbox.session(openingAt(sandbox, now));
  const verdicts = await verdictsInSession(session, filters, event, { sandbox, now });
  return [...verdicts, ...(await filterVerdictsOf(filters.slice(verdicts.length), event, sandbox, now))];
}

async function sessionPrepared(
  filters: readonly MatchedFilter[],
  sandbox: FilterSandbox,
  now: number,
): Promise<PreparedSession> {
  const session = await sandbox.session(openingAt(sandbox, now));
  try {
    const prepared = filters.map((filter) => preparedOf(filter, session.define));
    await session.freeze();
    return { session, prepared };
  } catch (error) {
    session.close();
    throw error;
  }
}

export function filterTestingOf(filters: readonly MatchedFilter[], sandbox: FilterSandbox): FilterTesting {
  const held: { opening: Promise<PreparedSession> | undefined; closed: boolean } = {
    opening: undefined,
    closed: false,
  };
  const opened = (now: number): Promise<PreparedSession> => {
    held.opening ??= sessionPrepared(filters, sandbox, now);
    return held.opening;
  };
  const letGo = async (): Promise<void> => {
    const { opening } = held;
    held.opening = undefined;
    if (opening === undefined) {
      return;
    }
    for (const outcome of await Promise.allSettled([opening])) {
      if (outcome.status === 'fulfilled') {
        outcome.value.session.close();
      }
    }
  };
  return {
    verdictsOf: async (event, now) => {
      const session = held.closed ? undefined : await opened(now);
      if (session === undefined || held.closed) {
        return filterVerdictsOf(filters, event, sandbox, now);
      }
      const tested = await verdictsUntilLimited(session.prepared, event, sandbox, now);
      if (!tested.limited) {
        return tested.verdicts;
      }
      await letGo();
      const rest = filters.slice(tested.verdicts.length);
      return [...tested.verdicts, ...(await filterVerdictsOf(rest, event, sandbox, now))];
    },
    close: async () => {
      held.closed = true;
      await letGo();
    },
  };
}
