import type { SQL } from '@event-driven-io/dumbo';

import type { StatementExecutor } from '../event-store.ts';

interface StoredRunStream {
  readonly stream: string;
  readonly size: number;
}

export interface RecordedFill {
  readonly execute: StatementExecutor;
  readonly listings: readonly number[];
  readonly keptRuns: () => readonly string[];
}

export const mebibyte = 1024 * 1024;

const listing = /s\.stream_id > "([^"]*)" .* LIMIT (\d+)$/u;

const keptRun = /"playbook\/acme\/alpha\/", "(r\d+)"/gu;

const began = JSON.stringify({ at: '2026-10-01T09:00:00.000Z', fn: 'triage' });

const stampedAsStored = { at: '2026-10-01T09:00:00.000Z', by: 'tallies' };

export function runIdsOf(count: number): readonly string[] {
  return Array.from({ length: count }, (_, index) => `r${String(index).padStart(3, '0')}`);
}

function storedOf(sizes: readonly number[]): readonly StoredRunStream[] {
  const runs = runIdsOf(sizes.length);
  return sizes.map((size, index) => ({ stream: `playbook/acme/alpha/runs/${String(runs[index])}`, size }));
}

export function aRecordedFillOf(
  sizes: readonly number[],
  describing: (sql: SQL) => string,
  dataOf: (json: string) => unknown,
  metadataOf: (json: string) => unknown,
): RecordedFill {
  const stored = storedOf(sizes);
  const listings: number[] = [];
  const commands: string[] = [];
  const described = (sql: SQL): string => describing(sql).replaceAll(/\s+/gu, ' ').trim();
  const answered = (statement: string): readonly unknown[] => {
    const listed = listing.exec(statement);
    if (listed !== null) {
      const [, after, limit] = listed;
      listings.push(Number(limit));
      return stored.filter(({ stream }) => stream > String(after)).slice(0, Number(limit));
    }
    return statement.includes('FROM emt_messages')
      ? stored.map(({ stream }) => ({
          stream,
          type: 'run_began',
          data: dataOf(began),
          metadata: metadataOf(JSON.stringify(stampedAsStored)),
          position: 1,
        }))
      : [];
  };
  return {
    listings,
    keptRuns: () => [...commands.join(' ').matchAll(keptRun)].map((found: readonly string[]) => String(found[1])),
    execute: {
      query: (sql) => Promise.resolve({ rows: answered(described(sql)) }),
      command: (sql) => {
        commands.push(described(sql));
        return Promise.resolve();
      },
    },
  };
}
