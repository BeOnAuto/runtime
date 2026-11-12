import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { Effect, Option, Schema } from 'effect';

import { documentFold, documentStreamOfOrg, keptTextOf } from '../src/documents/document-streams.ts';
import { mostDocumentTextBytes } from '../src/registry/connection-entry.ts';
import { connectionsFold, connectionsStreamOfOrg } from '../src/registry/registry-decider.ts';
import { mostConnectionsOfAnOrg } from '../src/registry/registry-decisions.ts';
import { connectionsOnSQLite } from './connections-on-sqlite.ts';

const samples = Number(process.env['CONNECTIONS_MEASURE_SAMPLES'] ?? 15);

const removedEver = Number(process.env['CONNECTIONS_MEASURE_REMOVED'] ?? 200);

const utf8 = new TextEncoder();

function documentOf(index: number, bytes: number): string {
  const written = (description: string) =>
    JSON.stringify({
      openapi: '3.1.0',
      info: { title: `Service ${index}`, version: '1', description },
      paths: { '/entries': { get: { operationId: 'list_entries', summary: 'Lists the entries.' } } },
    });
  const bare = utf8.encode(written('')).byteLength;
  return written('d'.repeat(Math.max(0, bytes - bare)));
}

function additionOf(index: number) {
  return {
    name: `service-${index}`,
    type: 'openapi',
    entry: {
      base_url: `https://api.service-${index}.example.com/v1`,
      document_text: documentOf(index, mostDocumentTextBytes),
    },
    credential: {
      kind: 'secret',
      name: 'X-Api-Key',
      in: 'header',
      instructions: 'Make a key under [Settings, API keys](https://service.example.com/keys).',
      key_page: 'https://service.example.com/keys',
    },
  };
}

function median(values: readonly number[]): number {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

interface Taken {
  readonly wall: number;
  readonly processor: number;
}

function sampled<A, R>(attempt: Effect.Effect<A, never, R>): Effect.Effect<Taken, never, R> {
  const timedOnce = Effect.gen(function* () {
    const started = performance.now();
    const used = process.cpuUsage();
    yield* attempt;
    const { user, system } = process.cpuUsage(used);
    return { wall: performance.now() - started, processor: (user + system) / 1000 };
  });
  return Effect.map(
    Effect.forEach(Array.from({ length: samples + 1 }), () => timedOnce),
    (taken: readonly Taken[]) => ({
      wall: median(taken.slice(1).map(({ wall }) => wall)),
      processor: median(taken.slice(1).map(({ processor }) => processor)),
    }),
  );
}

function takenIn({ wall, processor }: Taken): string {
  return `${processor.toFixed(1)} ms of processor time, ${wall.toFixed(1)} ms of wall time, at the median of ${samples}`;
}

function write(line: string): void {
  process.stdout.write(`${line}\n`);
}

const decodeStoredRow = Schema.decodeUnknownSync(
  Schema.Struct({ stream: Schema.String, data: Schema.String, metadata: Schema.String }),
);

function bytesOf(text: string): number {
  return utf8.encode(text).byteLength;
}

interface Stored {
  readonly streams: number;
  readonly facts: number;
  readonly data: number;
  readonly metadata: number;
}

function storedIn(fileName: string, pattern: string): Stored {
  const database = new DatabaseSync(fileName);
  const rows = database
    .prepare(
      'SELECT stream_id AS stream, message_data AS data, message_metadata AS metadata FROM emt_messages WHERE stream_id LIKE ?',
    )
    .all(pattern)
    .map((row: unknown) => decodeStoredRow(row));
  database.close();
  return {
    streams: new Set(rows.map(({ stream }) => stream)).size,
    facts: rows.length,
    data: rows.reduce((total, { data }) => total + bytesOf(data), 0),
    metadata: rows.reduce((total, { metadata }) => total + bytesOf(metadata), 0),
  };
}

type Connections = Awaited<ReturnType<typeof connectionsOnSQLite>>;

const IdSchema = Schema.Struct({ status: Schema.Literal('succeeded'), output: Schema.Struct({ id: Schema.String }) });

function addedAt(dispatched: Connections['dispatched'], index: number) {
  return Effect.flatMap(dispatched('add_connection', additionOf(index)), (outcome) =>
    Option.match(Schema.decodeUnknownOption(IdSchema)(outcome), {
      onNone: () => Effect.die(new Error(JSON.stringify(outcome))),
      onSome: ({ output }) => Effect.succeed(output.id),
    }),
  );
}

function indexes(from: number): readonly number[] {
  return Array.from({ length: mostConnectionsOfAnOrg }, (_, at) => from + at);
}

function grownTo(dispatched: Connections['dispatched'], removed: number) {
  const rounds = Math.ceil(removed / mostConnectionsOfAnOrg);
  return Effect.gen(function* () {
    for (const round of Array.from({ length: rounds }, (_, at) => at)) {
      const ids = yield* Effect.forEach(indexes(round * mostConnectionsOfAnOrg), (index) => addedAt(dispatched, index));
      yield* Effect.forEach(ids, (id) => dispatched('remove_connection', { id }));
    }
    yield* Effect.forEach(indexes(rounds * mostConnectionsOfAnOrg), (index) => addedAt(dispatched, index));
    return rounds * mostConnectionsOfAnOrg;
  });
}

function timedOn(dispatched: Connections['dispatched'], registry: Connections['registry'], removed: number) {
  return Effect.gen(function* () {
    const removedNow = yield* grownTo(dispatched, removed);
    const live = documentStreamOfOrg('acme', keptTextOf(documentOf(removedNow, mostDocumentTextBytes)).sha256);
    return {
      removedNow,
      fold: yield* sampled(registry.load(connectionsStreamOfOrg('acme'), connectionsFold)),
      list: yield* sampled(dispatched('list_connections', {})),
      document: yield* sampled(registry.load(live, documentFold)),
    };
  });
}

function storedWords(kind: string, { streams, facts, data, metadata }: Stored): string {
  return `  ${kind}: ${streams} streams, ${facts} facts, ${data} bytes of data and ${metadata} of metadata, ${data + metadata} in all`;
}

async function measuredWith(removed: number): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'auto-runtime-connections-'));
  const fileName = join(directory, 'ledger.db');
  const measured = await connectionsOnSQLite(fileName);
  try {
    const taken = await measured.runtime.runPromise(timedOn(measured.dispatched, measured.registry, removed));
    write(
      `${mostConnectionsOfAnOrg} connections live and ${taken.removedNow} removed, each given its own document of ${mostDocumentTextBytes} bytes, on SQLite`,
    );
    write(storedWords('the connections', storedIn(fileName, '%/connections')));
    write(storedWords('their documents', storedIn(fileName, '%/connection-documents/%')));
    write(
      `  a read and fold of the connections alone, as every operation over connections makes: ${takenIn(taken.fold)}`,
    );
    write(`  list_connections, the fold and the answer: ${takenIn(taken.list)}`);
    write(`  a read of one document, as a connection's first preparation makes: ${takenIn(taken.document)}`);
  } finally {
    await measured.runtime.dispose();
    rmSync(directory, { recursive: true, force: true });
  }
}

await measuredWith(0);
await measuredWith(removedEver);
