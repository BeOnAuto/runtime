import type { MeteredRun } from '@on.auto/definitions';
import type { DefinitionNames } from '@on.auto/ledger';
import {
  ActedContextSchema,
  streamPrefixOfPlaybook,
  type Decider,
  type Ledger,
  type PlaybookAddress,
} from '@on.auto/operations';
import { definitionsPlaced } from '@on.auto/operations/testing';
import { Effect, Result, Schema } from 'effect';

export const FIRST_MOMENT = '2026-10-27T12:00:00.000Z';

const AppendedSchema = Schema.Struct({
  type: Schema.Literals(['run_started', 'run_cancel_requested', 'noted', 'placed']),
  data: Schema.Record(Schema.String, Schema.String),
  context: ActedContextSchema,
});

type Appended = typeof AppendedSchema.Type;

function appendingWith(type: Appended['type'], data: Appended['data'], count: number): Decider<number, null, Appended> {
  return {
    initialState: 0,
    evolve: (seen) => seen + 1,
    eventSchema: AppendedSchema,
    decide: () => Result.succeed(Array.from({ length: count }, () => ({ type, data }))),
    context: () => ({ at: FIRST_MOMENT, by: 'tester' }),
  };
}

export function appending(type: Appended['type'], count: number): Decider<number, null, Appended> {
  return appendingWith(type, {}, count);
}

function startsIn(playbook: string): Decider<number, null, Appended> {
  return appendingWith('run_started', { playbook }, 1);
}

const placing: Decider<number, PlaybookAddress, Appended> = {
  initialState: 0,
  evolve: (seen) => seen + 1,
  eventSchema: AppendedSchema,
  decide: ({ org, playbook }, seen) => Result.succeed(seen === 0 ? [{ type: 'placed', data: { org, playbook } }] : []),
  context: () => ({ at: FIRST_MOMENT, by: 'tester' }),
};

const decodePlacement = Schema.decodeUnknownSync(Schema.Struct({ org: Schema.String, playbook: Schema.String }));

export const placedDefinitions: DefinitionNames = {
  ...definitionsPlaced,
  types: ['placed'],
  nameAfter: (_held, { data }) => ({
    playbookKey: streamPrefixOfPlaybook(decodePlacement(data)),
    definitionType: 'computation',
    name: 'totals',
    status: 'active',
    hasTriggers: false,
  }),
};

export function runOf(run: string, playbook = 'alpha', org = 'acme'): MeteredRun {
  return {
    org,
    playbook,
    run_id: run,
    definition_id: `totals-of-${playbook}`,
    definition_type: 'computation',
    definition_name: 'totals',
    definition_version: 1,
    correlation_id: run,
    called_by: null,
    trigger: null,
    started_by: 'person:ada',
  };
}

export function runStreamOf(run: string, playbook = 'alpha', org = 'acme'): string {
  return `definition/${org}/totals-of-${playbook}/runs/${run}`;
}

export function startedIn(ledger: Ledger['Service'], run: string, playbook = 'alpha', org = 'acme') {
  return Effect.andThen(
    ledger.execute(`definition/${org}/totals-of-${playbook}/definitions/computation`, placing, { org, playbook }),
    ledger.execute(runStreamOf(run, playbook, org), startsIn(playbook), null),
  );
}

export interface Answer {
  readonly kind: string;
  readonly detail: string;
  readonly because?: string;
  readonly resolve_at?: string;
  readonly runtime_id?: string;
  readonly lifts_at?: string;
  readonly limited_because?: string;
}

function memberOf(refused: object, member: keyof Answer): Partial<Answer> {
  const value: unknown = Reflect.get(refused, member);
  return typeof value === 'string' ? { [member]: value } : {};
}

function answerOfRefusal(refusal: unknown): Answer {
  const refused = new Object(refusal);
  return {
    kind: String(Reflect.get(refused, 'kind')),
    detail: String(Reflect.get(refused, 'detail')),
    ...memberOf(refused, 'because'),
    ...memberOf(refused, 'resolve_at'),
    ...memberOf(refused, 'runtime_id'),
    ...memberOf(refused, 'lifts_at'),
    ...memberOf(refused, 'limited_because'),
  };
}

export function answerOf<A, E, R>(work: Effect.Effect<A, E, R>, kind: string): Effect.Effect<Answer, never, R> {
  return work.pipe(Effect.match({ onSuccess: () => ({ kind, detail: '' }), onFailure: answerOfRefusal }));
}

export function inTurn<Item, Done>(
  items: readonly Item[],
  work: (item: Item) => Promise<Done>,
): Promise<readonly Done[]> {
  return items.reduce<Promise<readonly Done[]>>(
    async (done, item) => [...(await done), await work(item)],
    Promise.resolve([]),
  );
}
