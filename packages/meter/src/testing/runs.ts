import type { MeteredRun } from '@on.auto/definitions';
import { ActedContextSchema, type Decider } from '@on.auto/operations';
import { Effect, Result, Schema } from 'effect';

export const FIRST_MOMENT = '2026-10-27T12:00:00.000Z';

const AppendedSchema = Schema.Struct({
  type: Schema.Literals(['run_started', 'noted']),
  data: Schema.Struct({}),
  context: ActedContextSchema,
});

type Appended = typeof AppendedSchema.Type;

export function appending(type: Appended['type'], count: number): Decider<number, null, Appended> {
  return {
    initialState: 0,
    evolve: (seen) => seen + 1,
    eventSchema: AppendedSchema,
    decide: () => Result.succeed(Array.from({ length: count }, () => ({ type, data: {} }))),
    context: () => ({ at: FIRST_MOMENT, by: 'tester' }),
  };
}

export const starts = appending('run_started', 1);

export function runOf(run: string, playbook = 'alpha', org = 'acme'): MeteredRun {
  return {
    org,
    playbook,
    run_id: run,
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
  return `playbook/${org}/${playbook}/runs/${run}`;
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
