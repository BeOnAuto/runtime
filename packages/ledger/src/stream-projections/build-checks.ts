import { SQL } from '@event-driven-io/dumbo';
import { projectedTableOf, type GroupwiseMaximum, type StreamProjection } from '@on.auto/operations';
import { Schema } from 'effect';

import { inTurn } from '../projections/inline-projection.ts';
import type { ProjectionDialect } from '../projections/projection-dialect.ts';
import { countedIn } from './stream-statements.ts';

export type FailedCheck = 'counts_differ' | 'groupwise_maximum_differs';

export interface Checking {
  readonly query: (sql: SQL) => Promise<readonly unknown[]>;
  readonly dialect: ProjectionDialect;
  readonly projection: StreamProjection;
  readonly prefix: string;
}

const FailingRows = Schema.Tuple([Schema.Struct({ failing: Schema.Number })]);

function tableNamed(projection: StreamProjection, name: string): SQL {
  return SQL`${SQL.plain(projectedTableOf({ name, version: projection.version }))}`;
}

function matched(left: string, right: string, pairs: readonly (readonly [string, string])[]): string {
  return pairs.map(([of, to]) => `${left}.${of} = ${right}.${to}`).join(' AND ');
}

function groupwiseMaximumStatement(projection: StreamProjection, prefix: string, maximum: GroupwiseMaximum): SQL {
  const { groupedBy, greatest, matching } = maximum;
  const grouped = groupedBy.map((column): readonly [string, string] => [column, column]);
  const columns = SQL.plain(groupedBy.map((column) => `g.${column}`).join(', '));
  return SQL`WITH greatest AS (
      SELECT ${columns}, max(g.${SQL.plain(greatest)}) AS greatest_of_the_group
      FROM ${tableNamed(projection, maximum.groups)} AS g
      WHERE g.playbook_key = ${prefix}
      GROUP BY ${columns}
    ), newest AS (
      SELECT v.* FROM ${tableNamed(projection, maximum.groups)} AS v
      JOIN greatest AS m ON ${SQL.plain(matched('v', 'm', grouped))} AND v.${SQL.plain(greatest)} = m.greatest_of_the_group
      WHERE v.playbook_key = ${prefix}
    )
    SELECT CAST(count(*) AS INTEGER) AS failing FROM ${tableNamed(projection, maximum.projection)} AS r
    WHERE r.playbook_key = ${prefix} AND NOT EXISTS (
      SELECT 1 FROM newest AS n
      WHERE ${SQL.plain(matched('n', 'r', grouped))}
        AND ${SQL.plain(
          matched(
            'r',
            'n',
            matching.map(({ column, equals }): readonly [string, string] => [column, equals]),
          ),
        )}
    )`;
}

async function countsDiffer({ query, dialect, projection, prefix }: Checking): Promise<boolean> {
  const differing: boolean[] = [];
  await inTurn(projection.counted, async (counted) => {
    const { rows, facts } = await countedIn(query, dialect, projection, { prefix, counted });
    differing.push(rows !== facts);
  });
  return differing.includes(true);
}

async function maximaDiffer({ query, projection, prefix }: Checking): Promise<boolean> {
  const failing: number[] = [];
  await inTurn(projection.groupwiseMaxima, async (maximum) => {
    const [found] = Schema.decodeUnknownSync(FailingRows)(
      await query(groupwiseMaximumStatement(projection, prefix, maximum)),
    );
    failing.push(found.failing);
  });
  return failing.some((count) => count > 0);
}

export async function failedCheckOf(checking: Checking): Promise<FailedCheck | undefined> {
  if (await countsDiffer(checking)) {
    return 'counts_differ';
  }
  return (await maximaDiffer(checking)) ? 'groupwise_maximum_differs' : undefined;
}
