import { fileURLToPath } from 'node:url';

import { Cause, Effect, Layer, Logger, References } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { spawnServer } from '../testing/processes/spawned-server.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { formatConsole, formatPretty, logsFrom, logsToStderr } from './log-formats.ts';
import { logAccessMode, logIncident, logUnsettled, logWorkflows } from './logging.ts';
import type { ColorDepth } from './terminal.ts';

async function prettyLinesLoggedBy(effect: Effect.Effect<void>): Promise<readonly string[]> {
  const lines: string[] = [];
  const capture = Logger.map(formatPretty, (line: string) => {
    lines.push(line.replace(/^\d{2}:\d{2}:\d{2}\.\d{3} /u, '<time> '));
  });
  await Effect.runPromise(effect.pipe(Effect.provide(Logger.layer([capture]))));
  return lines;
}

async function consoleLinesLoggedBy(effect: Effect.Effect<void>, depth: ColorDepth): Promise<readonly string[]> {
  const lines: string[] = [];
  const capture = Logger.map(formatConsole(depth), (line: string) => {
    lines.push(line.replace(/\d{2}:\d{2}:\d{2}/u, '<time>'));
  });
  await Effect.runPromise(
    effect.pipe(Effect.provide(Logger.layer([capture])), Effect.provideService(References.MinimumLogLevel, 'Debug')),
  );
  return lines;
}

const mainModule = fileURLToPath(new URL('../main.ts', import.meta.url));

const loopback = { HOST: '127.0.0.1', PORT: '0', LEDGER_FILE: ':memory:' };

describe('the pretty log format', () => {
  it('writes the local time, the level, the message and then the annotations on one line', async () => {
    const lines = await prettyLinesLoggedBy(
      logWorkflows({ mostDurationMs: 604_800_000, mostCallsAtOnce: 8, sweepEveryMs: 250 }),
    );

    expect(lines).toEqual([
      '<time> INFO  Workflows run in this server: a run lasts at most 7 days, at most 8 of their calls run at once, and the runs are swept every 250 ms most_duration_ms=604800000 most_calls_at_once=8 sweep_every_ms=250',
    ]);
  });

  it('writes an annotation that is not one plain word as JSON', async () => {
    const lines = await prettyLinesLoggedBy(
      logUnsettled({ org: 'acme', playbook: 'alpha', runId: 'e-1', reason: 'The ledger has no such run' }),
    );

    expect(lines).toEqual([
      '<time> ERROR A run stays started because settling it failed org=acme playbook=alpha run_id=e-1 reason="The ledger has no such run"',
    ]);
  });

  it('puts the source of a line first, in brackets, and writes a message that is not text as JSON', async () => {
    const lines = await prettyLinesLoggedBy(
      Effect.logWarning({ answered: false }).pipe(Effect.annotateLogs({ source: 'dev', attempt: 2 })),
    );

    expect(lines).toEqual(['<time> WARN  [dev] {"answered":false} attempt=2']);
  });

  it('writes the cause of an incident below its line, indented', async () => {
    const [line] = await prettyLinesLoggedBy(
      logIncident({ id: 'incident-1', original: new Error('the ledger is unreachable') }),
    );

    expect(line?.split('\n').slice(0, 2)).toEqual([
      '<time> ERROR Unexpected error incident=incident-1',
      '    Error: the ledger is unreachable',
    ]);
  });
});

describe('the server with LOG_FORMAT=pretty', () => {
  it('writes its logs as readable lines to stderr, and still exactly the listening line to stdout', async () => {
    const { remove } = temporaryLedger();
    onTestFinished(remove);
    const child = spawnServer(mainModule, {
      ...loopback,
      LOG_FORMAT: 'pretty',
    });
    const port = await child.port;
    child.signal('SIGTERM');
    await child.exited;

    expect(child.output().stdout).toBe(`Auto Runtime listening on port ${port}\n`);
    expect(
      child
        .output()
        .stderr.split('\n')
        .map((line) => line.replace(/^\d{2}:\d{2}:\d{2}\.\d{3} /u, '')),
    ).toEqual([
      expect.stringMatching(/^WARN {2}Local mode is on: /u),
      'INFO  The ledger is kept in the file :memory: ledger_file=:memory:',
      "INFO  Content is kept in the ledger's database content_store=ledger",
      expect.stringMatching(
        /^INFO {2}Secrets are kept in the ledger's database, sealed under the key [\da-f]{16} that the server made at this start, and 0 sealed under the previous key were sealed again under it secrets_kid=[\da-f]{16} secrets_resealed=0 secrets_key_from=start$/u,
      ),
      'INFO  Extensions loaded, in their order of precedence: none extensions=[]',
      expect.stringMatching(/^WARN {2}No model provider is configured, .* providers=\[\{"provider":"anthropic",/u),
      "INFO  Reasoning functions run in this server: the model calls of a run add up to at most 2,000,000 input tokens, and each answer of a tool is read whole where it fits the model's context window most_input_tokens=2000000",
      'INFO  Workflows run in this server: a run lasts at most 30 days, at most 32 of their calls run at once, and the runs are swept every 1000 ms most_duration_ms=2592000000 most_calls_at_once=32 sweep_every_ms=1000',
      '',
    ]);
  });
});

describe('the console log format', () => {
  it('writes the time, a mark for the level and the message, and leaves out the annotations', async () => {
    const lines = await consoleLinesLoggedBy(
      Effect.all(
        [
          logWorkflows({ mostDurationMs: 604_800_000, mostCallsAtOnce: 8, sweepEveryMs: 250 }),
          logAccessMode({ mode: 'closed', signIn: undefined }),
          logUnsettled({ org: 'acme', playbook: 'alpha', runId: 'e-1', reason: 'The ledger has no such run' }),
          Effect.logFatal('The ledger is gone'),
          Effect.logDebug({ answered: false }),
        ],
        { discard: true },
      ),
      1,
    );

    expect(lines).toEqual([
      '  <time> • Workflows run in this server: a run lasts at most 7 days, at most 8 of their calls run at once, and the runs are swept every 250 ms',
      '  <time> ▲ No request can authenticate: API_KEYS lists no keys, so every path answers 401 except /health, the OpenAPI document at /v1/openapi.json, the guides under /v1/guides and the API catalog at /.well-known/api-catalog',
      '  <time> ✖ A run stays started because settling it failed',
      '  <time> ✖ The ledger is gone',
      '  <time> · {"answered":false}',
    ]);
  });

  it('writes the cause of an error under its line, indented', async () => {
    const lines = await consoleLinesLoggedBy(Effect.logError('A sweep failed', Cause.fail('unreachable')), 1);

    expect(lines[0]?.split('\n').slice(0, 2)).toEqual(['  <time> ✖ A sweep failed', '      Error: unreachable']);
  });

  it('paints the mark of the level where the terminal shows colors', async () => {
    const [line] = await consoleLinesLoggedBy(Effect.logWarning('Careful'), 24);

    expect(line).toContain('\u001B[33m▲\u001B[39m Careful');
  });

  it('is the logger of LOG_FORMAT=console', async () => {
    await expect(
      Effect.runPromise(Effect.logDebug('unseen').pipe(Effect.provide(logsToStderr('console')))),
    ).resolves.toBeUndefined();
  });
});

describe('the least level logged', () => {
  it.each([
    ['debug', ['DEBUG', 'INFO', 'WARN', 'ERROR']],
    ['info', ['INFO', 'WARN', 'ERROR']],
    ['warn', ['WARN', 'ERROR']],
    ['error', ['ERROR']],
  ] as const)('is %s, which drops the levels below it', async (level, logged) => {
    const levels: string[] = [];
    const capture = Logger.map(Logger.formatStructured, ({ level: written }: { readonly level: string }) => {
      levels.push(written);
    });

    await Effect.runPromise(
      Effect.all([Effect.logDebug('d'), Effect.logInfo('i'), Effect.logWarning('w'), Effect.logError('e')], {
        discard: true,
      }).pipe(Effect.provide(Layer.mergeAll(Logger.layer([capture]), logsFrom(level)))),
    );

    expect(levels).toEqual(logged);
  });
});

describe('the server with LOG_FORMAT=console and LOG_LEVEL=warn', () => {
  it('writes only its warnings, as console lines, to stderr', async () => {
    const child = spawnServer(mainModule, {
      ...loopback,
      LOG_FORMAT: 'console',
      LOG_LEVEL: 'warn',
    });
    await child.port;
    child.signal('SIGTERM');
    await child.exited;

    expect(child.output().stderr.split('\n')).toEqual([
      expect.stringMatching(/^ {2}\d{2}:\d{2}:\d{2} ▲ Local mode is on: /u),
      expect.stringMatching(/^ {2}\d{2}:\d{2}:\d{2} ▲ No model provider is configured, [^=]*$/u),
      '',
    ]);
  });
});
