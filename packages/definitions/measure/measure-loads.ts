import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { ledgerLayer } from '@on.auto/ledger/sqlite3';
import { allPermissions, makeDispatcher, type CallerIdentity, type Runnable } from '@on.auto/operations';
import { memoryPlaybookRegistry, recordingReporter } from '@on.auto/operations/testing';
import { Effect, Layer, ManagedRuntime, Predicate, Schema } from 'effect';

import { defineCapability } from '../src/index.ts';
import { definitionOperationsFor } from '../src/testing/definition-operations.ts';

const versions = Number(process.env['DEFINITIONS_MEASURE_VERSIONS'] ?? 50);

const samples = Number(process.env['DEFINITIONS_MEASURE_SAMPLES'] ?? 15);

const mostSourceBytes = 65_536;

const utf8 = new TextEncoder();

const decodeFields = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Record(Schema.String, Schema.String)));

const widest = defineCapability({
  type: 'widest',
  title: 'Widest',
  guide: { name: 'widest' },
  noun: { one: 'widest document', other: 'widest documents' },
  describeOutput: () => 'It answered.',
  mediaType: 'application/json',
  parse: (source: string) => Effect.orDie(decodeFields(source)),
  summarize: (fields) => ({
    description: 'Takes as many fields as one document holds',
    inputSchema: {
      type: 'object',
      properties: Object.fromEntries(
        Object.entries(fields).map(([name, description]: readonly [string, string]) => [
          name,
          { type: 'string', description },
        ]),
      ),
    },
  }),
  run: () => Effect.succeed({ output: null, record: {} }),
});

const { createDefinition, updateDefinition, getDefinition, listDefinitions } = definitionOperationsFor([widest]);

const caller: CallerIdentity = { id: 'acme-admin', org: 'acme', permissions: allPermissions, playbooks: '*' };

const dispatcher = makeDispatcher([]);

function fieldOf(index: number): string {
  return `"f${index}":"The ${index}th field, as its author describes it"`;
}

function documentOf(version: number): string {
  const entries = [`"version":"Version ${version} of the document"`];
  let bytes = entries.join(',').length + 2;
  while (bytes + 1 + fieldOf(entries.length - 1).length <= mostSourceBytes) {
    bytes += 1 + fieldOf(entries.length - 1).length;
    entries.push(fieldOf(entries.length - 1));
  }
  return `{${entries.join(',')}}`;
}

function median(values: readonly number[]): number {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function write(line: string): void {
  process.stdout.write(`${line}\n`);
}

function dispatched(operation: { readonly registration: Runnable<'playbook'> }, input: object) {
  return dispatcher.dispatchToPlaybook(operation.registration, {
    caller,
    org: 'acme',
    playbook: 'alpha',
    input,
    encoding: 'json',
  });
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

function overviewBytesOf(data: string): number {
  const parsed: unknown = JSON.parse(data);
  const content = Predicate.hasProperty(parsed, 'content') ? parsed.content : undefined;
  const overview = Predicate.hasProperty(content, 'overview') ? content.overview : undefined;
  return utf8.encode(JSON.stringify(overview)).byteLength;
}

function storedEventsIn(fileName: string): readonly string[] {
  const database = new DatabaseSync(fileName);
  const rows = database
    .prepare("SELECT message_data AS data FROM emt_messages WHERE stream_id LIKE '%definitions/widest'")
    .all();
  database.close();
  return rows.map((row: Readonly<Record<string, unknown>>) => String(row['data']));
}

const directory = mkdtempSync(join(tmpdir(), 'auto-runtime-loads-'));
const fileName = join(directory, 'ledger.db');
const runtime = ManagedRuntime.make(
  Layer.mergeAll(
    ledgerLayer({ fileName }),
    memoryPlaybookRegistry([{ org: 'acme', playbook: 'alpha' }]),
    recordingReporter().layer,
  ),
);

try {
  const { load, read } = await runtime.runPromise(
    Effect.gen(function* () {
      yield* dispatched(createDefinition, { type: 'widest', name: 'widest', source: documentOf(1) });
      yield* Effect.forEach(
        Array.from({ length: versions - 1 }, (_, index) => index + 2),
        (version) => dispatched(updateDefinition, { type: 'widest', name: 'widest', source: documentOf(version) }),
      );
      return {
        load: yield* sampled(dispatched(listDefinitions, { type: 'widest' })),
        read: yield* sampled(dispatched(getDefinition, { type: 'widest', name: 'widest' })),
      };
    }),
  );
  const stored = storedEventsIn(fileName);
  const eventBytes = stored.reduce((total, data) => total + utf8.encode(data).byteLength, 0);
  write(`${stored.length} versions of a document of ${utf8.encode(documentOf(1)).byteLength} bytes on SQLite`);
  write(
    `  their events hold ${eventBytes} bytes, ${Math.round(eventBytes / stored.length)} each, of which the overview takes ${median(stored.map((data) => overviewBytesOf(data)))}`,
  );
  write(`  a load of the type, list_definitions: ${takenIn(load)}`);
  write(`  a read of the definition, get_definition: ${takenIn(read)}`);
} finally {
  await runtime.dispose();
  rmSync(directory, { recursive: true, force: true });
}
