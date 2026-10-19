import { Redacted, Schema } from 'effect';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { secretsOf } from '../bounds/secrets.ts';
import type { StdioServerSettings } from '../settings/server-settings.ts';
import { fakeStdioServerPath, testClientInfo } from '../testing/index.ts';
import { errorsNoLongerReported } from './mcp-client.ts';
import { observations } from './observed-requests.ts';
import { failureOf } from './server-failures.ts';
import { serverLink } from './server-links.ts';
import { outputNoLongerReported, StdioProcessTransport } from './stdio-transport.ts';

type ServerClient = Awaited<ReturnType<ReturnType<typeof serverLink>['take']>>;

type CallSettled = Awaited<ReturnType<ServerClient['call']>>;

const coverage = process.env['NODE_V8_COVERAGE'];

const environment = new Map([
  ['LIMITLESS_API_KEY', Redacted.make('limitless-key-3e9d')],
  ...(coverage === undefined ? [] : [['NODE_V8_COVERAGE', Redacted.make(coverage)] as const]),
]);

const closing: (() => Promise<void>)[] = [];

const patientMs = 20_000;

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

function stdioSettings(args: readonly string[], changes: Partial<StdioServerSettings> = {}): StdioServerSettings {
  return {
    type: 'stdio',
    name: 'limitless',
    command: process.execPath,
    args: [fakeStdioServerPath, ...args],
    env: environment,
    orgs: ['acme'],
    allowed: null,
    playbooks: null,
    record_content: false,
    request_id: null,
    secrets: [],
    connection: null,
    provider: null,
    ...changes,
  };
}

function linkTo(settings: StdioServerSettings, openMs = patientMs) {
  const lines: string[] = [];
  const link = serverLink(settings, {
    clientInfo: testClientInfo,
    fetch: globalThis.fetch,
    secrets: secretsOf([Redacted.make('fake MCP server')]),
    now: Date.now,
    timing: { callMs: patientMs, openMs, longestRetryWaitMs: 1000 },
    reportOutput: (server, line) => {
      lines.push(`${server}: ${line}`);
    },
  });
  return { link, lines };
}

function linked(settings: StdioServerSettings, openMs = patientMs) {
  const made = linkTo(settings, openMs);
  closing.push(made.link.stop);
  return made;
}

const decodeNames = Schema.decodeUnknownSync(
  Schema.Struct({
    result: Schema.Struct({
      content: Schema.Tuple([Schema.Struct({ text: Schema.fromJsonString(Schema.Array(Schema.String)) })]),
    }),
  }),
);

function namesIn(settled: unknown): readonly string[] {
  const [{ text }] = decodeNames(settled).result.content;
  return text.filter((name) => !name.startsWith(operatingSystemPrefix));
}

const operatingSystemPrefix = '__CF_';

const notJsonRpc = 'limitless: The MCP server wrote a message that is not JSON-RPC';

const errorsDropped = `limitless: ${errorsNoLongerReported}`;

const clientErrors: ReadonlySet<string> = new Set([notJsonRpc, errorsDropped]);

const called = (client: ServerClient, tool: string, input: Readonly<Record<string, unknown>> = {}) =>
  client.call({ tool, input, meta: {}, signal: new AbortController().signal, timeoutMs: patientMs });

function failureOfCall(settled: CallSettled) {
  return 'error' in settled ? failureOf(settled.error) : undefined;
}

async function failureOfTaking(link: ReturnType<typeof linked>['link']) {
  return failureOf(
    await link.take().then(
      () => null,
      (error: unknown) => error,
    ),
  );
}

describe('one stdio server that the tests of a link share', () => {
  const shared = linkTo(stdioSettings(['--chatter', '102', '--pad', '2100', '--stdout', 'not json\n{"not":"rpc"}\n']));

  afterAll(shared.link.stop);

  it('starts the process on first use with the environment of its entry alone, and keeps it while it is let go', async () => {
    const { link } = shared;

    const first = await link.take();
    await link.release();
    const second = await link.take();
    const variables = await called(second, 'environment');

    expect(second).toBe(first);
    expect(namesIn(variables)).toEqual([...environment.keys()]);
  });

  it('passes over lines on stdout that are not JSON, or not JSON-RPC, and reports the latter', async () => {
    expect(await called(await shared.link.take(), 'search', { query: 'acme' })).toMatchObject({
      result: { content: [{ text: 'Found 2 rows for acme.' }] },
    });
    expect(shared.lines).toContain(notJsonRpc);
  });

  it('reports what the process writes to stderr, line by line, scrubbed, cut and bounded, until it is stopped', async () => {
    const { link, lines } = shared;
    const client = await link.take();

    await link.stop();
    await client.closed;

    const written = lines.filter((line) => line !== notJsonRpc);
    expect(written).toHaveLength(101);
    expect(written[0]).toMatch(/^limitless: The \[redacted\] says line 1 on stderr\.+$/u);
    expect(written[0]).toHaveLength('limitless: '.length + 2000);
    expect(written.slice(1, 100).every((line) => line.length === written[0]?.length)).toBe(true);
    expect(written.at(-1)).toBe(`limitless: ${outputNoLongerReported}`);
  });
});

describe('what a stdio server writes', () => {
  it('passes over a large batch of non-RPC messages without exhausting the call stack, and reports only the first 100', async () => {
    const { link, lines } = linked(stdioSettings(['--stdout', '{}\n'.repeat(20_000)]));

    expect(await called(await link.take(), 'search', { query: 'acme' })).toMatchObject({
      result: { content: [{ text: 'Found 2 rows for acme.' }] },
    });
    expect(lines.filter((line) => clientErrors.has(line))).toEqual([
      ...Array.from({ length: 100 }, () => notJsonRpc),
      errorsDropped,
    ]);
  });

  it('closes a process that writes more than its output may take at once, and marks the call it answered too large', async () => {
    const { link } = linked(stdioSettings([]));
    const client = await link.take();

    const settled = await called(client, 'large', { kib: 4200 });
    await client.closed;

    expect(settled).toMatchObject({ observed: { response: { tooLarge: true } } });
  });

  it('sees a process exit while it is called', async () => {
    const { link } = linked(stdioSettings([]));
    const client = await link.take();

    const settled = await called(client, 'exit');
    await client.closed;
    await link.stop();

    expect(failureOfCall(settled)).toMatchObject({ kind: 'closed' });
  });
});

describe('draining the stdio transport', () => {
  it('drains a large batch of notifications interleaved with invalid messages', async () => {
    const notification = { jsonrpc: '2.0', method: 'notice' };
    const batch = JSON.stringify(`${JSON.stringify(notification)}\n{}\n`);
    const output: string[] = [];
    const transport = new StdioProcessTransport(
      { command: process.execPath, args: ['--eval', `process.stdout.write(${batch}.repeat(20000))`], env: {} },
      observations(null, Infinity),
      {
        scrub: String,
        report: (line) => {
          output.push(line);
        },
      },
    );
    const closed = Promise.withResolvers<void>();
    let received = 0;
    let rejected = 0;
    let last: unknown;
    Object.assign(transport, {
      onmessage: (message: unknown) => {
        received += 1;
        last = message;
      },
      onerror: () => {
        rejected += 1;
      },
      onclose: closed.resolve,
    } satisfies Pick<StdioProcessTransport, 'onmessage' | 'onerror' | 'onclose'>);
    closing.push(() => transport.close());

    await transport.start();
    await closed.promise;

    expect(received).toBe(20_000);
    expect(rejected).toBe(20_000);
    expect(last).toEqual(notification);
    expect(output).toEqual([]);
  });
});

describe('a stdio server that does not start or stop', () => {
  it('cannot start a command that is not there', async () => {
    const { link } = linked(stdioSettings([], { command: '/nonexistent/limitless-mcp-server', args: [] }));

    expect(await failureOfTaking(link)).toEqual({
      kind: 'unreachable',
      message: 'The tool server could not be reached',
    });
  });

  it('kills a process that does not answer in time, nor end when its input does', async () => {
    const { link } = linked(stdioSettings([], { args: ['--eval', 'setInterval(() => {}, 1000)'] }), 200);

    expect(await failureOfTaking(link)).toEqual({
      kind: 'timed_out',
      message: 'The tool server did not answer in time',
    });
  });

  it('kills a process that does not end when its input does, once it has been patient', async () => {
    const { link } = linked(stdioSettings(['--linger-ms', '60000']));
    const client = await link.take();

    const began = performance.now();
    await link.stop();
    await client.closed;

    expect(performance.now() - began).toBeGreaterThanOrEqual(1900);
  });
});
