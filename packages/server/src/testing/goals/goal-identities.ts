import { definitionOfStreamPrefix, streamPrefixOfPlaybook, type Ledger, type ProjectedRow } from '@on.auto/operations';
import { Effect, Option } from 'effect';

export function goalIdentityIn(ledger: Ledger['Service'], goal: string, playbook = 'alpha'): Effect.Effect<string> {
  return Effect.map(
    ledger.holderOfName({
      playbookKey: streamPrefixOfPlaybook({ org: 'acme', playbook }),
      definitionType: 'goal',
      name: goal,
    }),
    (held) =>
      Option.getOrThrow(
        Option.flatMap(Option.fromNullishOr(held), ({ definitionKey }) => definitionOfStreamPrefix(definitionKey)),
      ).definition,
  );
}

interface Ledgered {
  readonly ledger: () => Promise<Ledger['Service']>;
}

export async function goalOf({ ledger }: Ledgered, goal: string, playbook?: string): Promise<string> {
  return Effect.runPromise(goalIdentityIn(await ledger(), goal, playbook));
}

export async function goalRowsOf(
  { ledger }: Ledgered,
  table: string,
  goal: string,
  playbook?: string,
): Promise<Readonly<Record<string, ProjectedRow>>> {
  const kept = await ledger();
  const definition = await Effect.runPromise(goalIdentityIn(kept, goal, playbook));
  const rows = await Effect.runPromise(
    kept.readProjectedRows(table, { org: 'acme', definition }, { where: [], orderBy: [], order: 'asc', limit: 1000 }),
  );
  return Object.fromEntries(rows.map(({ key, row }) => [key, row]));
}

export async function assessmentRowsOfGoals(
  ledgered: Ledgered,
  goals: readonly string[],
): Promise<ReadonlyMap<string, readonly ProjectedRow[]>> {
  const read = await Promise.all(
    goals.map(async (goal) => [goal, Object.values(await goalRowsOf(ledgered, 'goal_assessments', goal))] as const),
  );
  return new Map(read);
}
