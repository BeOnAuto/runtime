import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { SignInSettings } from '@on.auto/identity';
import { Cause, Effect, Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { secretsKey } from '../testing/databases/secrets-key.ts';
import { serverHoldingARequest, type SpawnedServer, spawnServer } from '../testing/processes/spawned-server.ts';
import { linesLoggedBy } from '../testing/records/logged-lines.ts';
import { readSettingsOf } from '../testing/settings/shipped-settings.ts';
import { until } from '../testing/waiting/until.ts';
import { logExtensions } from './extension-logging.ts';
import {
  logAccessMode,
  logConfigFile,
  logContentStore,
  logFirstAdmin,
  logFirstSignInAwaited,
  logIncident,
  logLedger,
  logMcpError,
  logPayloadOffloading,
  logReasoning,
  logServedStudio,
  logSignInFailed,
  logSignInRefused,
  logStudioKeptInMemory,
  logTelemetry,
  logUnsettled,
  logWorkflows,
  logWorkflowTrouble,
} from './logging.ts';
import { logOperatorHint, logProviderMessage } from './provider-logging.ts';
import { colorDepthOf, linkerFor, painterFor } from './terminal.ts';
import { logLeftOutOperation, logMarkUnlisted, logServerMessage } from './tool-server-logging.ts';

function syntaxErrorParsing(text: string): SyntaxError {
  try {
    JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return error;
    }
  }
  throw new TypeError(`${text} parsed as JSON`);
}

const serveWithTestRoutes = fileURLToPath(new URL('../testing/entries/serve-with-test-routes.ts', import.meta.url));

const signIn: SignInSettings = { issuer: 'https://clerk.on.auto', publicUrl: 'https://runtime.example' };

const served = { origin: 'https://studio.on.auto', served: true };

const serveWithSelfCausedError = fileURLToPath(
  new URL('../testing/entries/serve-with-self-caused-error.ts', import.meta.url),
);

const selfCaused = new Error('an error whose cause is itself');

selfCaused.cause = selfCaused;

function stderrOnceItContains(child: SpawnedServer, text: string): Promise<string> {
  return until(
    () => child.output().stderr,
    (stderr) => stderr.includes(text),
  );
}

describe('logAccessMode', () => {
  it('warns that local mode trusts every request, and what a machine reachable through a proxy sets instead', async () => {
    const [line] = await linesLoggedBy(logAccessMode({ mode: 'local', signIn: undefined }));

    expect(line).toContain('"level":"WARN"');
    expect(line).toContain('"message":"Local mode is on');
  });

  it('warns in one line that no request can authenticate when API_KEYS lists no keys', async () => {
    const lines = await linesLoggedBy(logAccessMode({ mode: 'closed', signIn: undefined }));

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"level":"WARN"');
    expect(lines[0]).toContain('"message":"No request can authenticate');
  });
});

describe('logAccessMode with credentials configured', () => {
  it('says nothing when API keys alone are configured', async () => {
    expect(await linesLoggedBy(logAccessMode({ mode: 'credentials', signIn: undefined }))).toEqual([]);
  });

  it('names the identity service persons sign in through, and the audience of their tokens', async () => {
    const [line] = await linesLoggedBy(logAccessMode({ mode: 'credentials', signIn }));

    expect(line).toContain('"level":"INFO"');
    expect(line).toContain('"message":"Signed-in persons are admitted through the');
    expect(line).toContain('"public_url":"https://runtime.example","identity_issuer":"https://clerk.on.auto"');
  });
});

const companySignIn = {
  issuer: 'https://login.example.com/acme',
  clientId: 'auto-runtime',
  clientSecret: Redacted.make('a-client-secret-of-the-test'),
  scopes: ['openid'],
  tokenEndpointAuthMethod: undefined,
  publicUrl: 'https://auto.example.com',
  redirectUri: 'https://auto.example.com/auth/oidc/callback',
};

describe("the logs of a sign-in through the company's identity provider", () => {
  it('name at start the provider and the redirect URI to register at it, and never the client secret', async () => {
    const [line] = await linesLoggedBy(logAccessMode({ mode: 'credentials', signIn, openIdConnect: companySignIn }));

    expect(line).toContain('"level":"INFO"');
    expect(line).toContain(
      '"annotations":{"public_url":"https://auto.example.com","oidc_issuer":"https://login.example.com/acme","redirect_uri":"https://auto.example.com/auth/oidc/callback"}',
    );
    expect(line).not.toContain('a-client-secret-of-the-test');
  });

  it('warn of a sign-in the provider refused with its error code, and of one that could not be completed', async () => {
    const lines = await linesLoggedBy(
      Effect.andThen(
        logSignInRefused(companySignIn.issuer, 'invalid_client'),
        logSignInFailed(companySignIn.issuer, 'OAUTH_JWT_CLAIM_COMPARISON_FAILED'),
      ),
    );

    expect(lines.map((line) => line.includes('"level":"WARN"'))).toEqual([true, true]);
    expect(lines[0]).toContain(
      '"annotations":{"oidc_issuer":"https://login.example.com/acme","error":"invalid_client"}',
    );
    expect(lines[1]).toContain('"failure":"OAUTH_JWT_CLAIM_COMPARISON_FAILED"');
  });

  it('say until someone has signed in that the first person to do so becomes its admin, and once they did, by their id alone', async () => {
    const lines = await linesLoggedBy(
      Effect.andThen(logFirstSignInAwaited('default'), logFirstAdmin('default', 'a-person-id')),
    );

    expect(lines.map((line) => line.includes('"level":"INFO"'))).toEqual([true, true]);
    expect(lines[0]).toContain('"annotations":{"org":"default"}');
    expect(lines[1]).toContain('"annotations":{"org":"default","person":"a-person-id"}');
  });
});

describe('logIncident', () => {
  it('logs the error with its stack under the incident id', async () => {
    const [line] = await linesLoggedBy(
      logIncident({ id: 'incident-1', original: new Error('the ledger is unreachable') }),
    );

    expect(line).toContain('"level":"ERROR"');
    expect(line).toContain('"annotations":{"incident":"incident-1"}');
    expect(line).toContain('Error: the ledger is unreachable\\n    at ');
  });

  it('logs the operation, the org, the playbook and the caller of the call that failed', async () => {
    const call = { operation: 'add_note', org: 'acme', playbook: 'alpha', caller: 'acme-admin' };

    const [line] = await linesLoggedBy(logIncident({ id: 'incident-2', original: 'not an error', call }));

    expect(line).toContain(
      '"annotations":{"incident":"incident-2","operation":"add_note","org":"acme","playbook":"alpha","caller":"acme-admin"}',
    );
    expect(line).toContain('not an error');
  });
});

describe('the reasoning logs', () => {
  it('say how many input tokens the model calls of a run add up to at most', async () => {
    const [line] = await linesLoggedBy(logReasoning(2_000_000));

    expect(line).toContain(`"message":"Reasoning functions run in this server`);
    expect(line).toContain('"level":"INFO"');
    expect(line).toContain('"annotations":{"most_input_tokens":2000000}');
  });
});

describe('the workflow logs', () => {
  it('say how long a run lasts at most, how many calls run at once and how often the runs are swept', async () => {
    const [line] = await linesLoggedBy(
      logWorkflows({ mostDurationMs: 2_592_000_000, mostCallsAtOnce: 32, sweepEveryMs: 1000 }),
    );

    expect(line).toContain('"message":"Workflows run in this server');
    expect(line).toContain('"level":"INFO"');
    expect(line).toContain(
      '"annotations":{"most_duration_ms":2592000000,"most_calls_at_once":32,"sweep_every_ms":1000}',
    );
  });

  it.each([
    [86_400_000, 'a run lasts at most 1 day,'],
    [7_200_000, 'a run lasts at most 2 hours,'],
    [5_400_000, 'a run lasts at most 1.5 hours,'],
  ])('say a longest run of %i ms in days or hours', async (mostDurationMs, words) => {
    const [line] = await linesLoggedBy(logWorkflows({ mostDurationMs, mostCallsAtOnce: 1, sweepEveryMs: 10 }));

    expect(line).toContain(words);
  });

  it('report a run settling left started as an error with its org, playbook, id and reason only', async () => {
    const [line] = await linesLoggedBy(
      logUnsettled({ org: 'acme', playbook: 'alpha', runId: 'e-1', reason: 'The ledger has no such run' }),
    );

    expect(line).toContain('"message":"A run stays started because settling it failed","level":"ERROR"');
    expect(line).toContain(
      '"annotations":{"org":"acme","playbook":"alpha","run_id":"e-1","reason":"The ledger has no such run"}',
    );
  });
});

describe('the workflow warnings', () => {
  it('warn of trouble in the workflows with what failed and its cause, cut to 2,000 characters', async () => {
    const [line] = await linesLoggedBy(
      logWorkflowTrouble(
        'A sweep of the runs failed; the next sweep tries again',
        Cause.fail(new Error(`the database is gone ${'x'.repeat(3000)}`)),
      ),
    );

    expect(line).toContain('"message":"A sweep of the runs failed');
    expect(line).toContain('"level":"WARN"');
    expect(line).toContain('"error":"Error: the database is gone xxx');
    expect(line).not.toContain('x'.repeat(2000));
  });
});

describe('logMcpError', () => {
  it('warns with the message of an error the MCP layer reports', async () => {
    const [line] = await linesLoggedBy(
      logMcpError(new Error('Unsupported Media Type: Content-Type must be application/json')),
    );

    expect(line).toContain('"message":"The MCP layer reported an error","level":"WARN"');
    expect(line).toContain('"annotations":{"error":"Unsupported Media Type: Content-Type must be application/json"}');
  });

  it('leaves out the part of the request body that a JSON syntax error quotes', async () => {
    const error = syntaxErrorParsing('token=hunter2');

    const [line] = await linesLoggedBy(logMcpError(error));

    expect(error.message).toBe('Unexpected token \'o\', "token=hunter2" is not valid JSON');
    expect(line).toContain('"annotations":{"error":"The request body is not valid JSON"}');
    expect(line).not.toContain('hunter2');
  });
});

describe('the server process', () => {
  it('logs an unexpected error to stderr under the incident id it answers with', async () => {
    const child = spawnServer(serveWithTestRoutes, { HOST: '127.0.0.1', PORT: '0' });
    const port = await child.port;

    const response = await fetch(`http://127.0.0.1:${port}/fail`);
    const text = await response.text();
    child.signal('SIGTERM');
    await child.exited;
    const incident = /"instance":"urn:uuid:([^"]+)"/u.exec(text)?.[1];

    expect(text).not.toContain('hunter2');
    expect(child.output().stderr).toContain(
      `"annotations":{"requestId":"${String(response.headers.get('x-request-id'))}","incident":"${String(incident)}"}`,
    );
    expect(child.output().stderr).toContain('database password is hunter2');
    expect(child.output().stdout).toBe(`Auto Runtime listening on port ${port}\n`);
  });

  it('writes nothing more to stdout when a client abandons a request its route answers once abandoned', async () => {
    const { child, port, answer, abandon } = await serverHoldingARequest(serveWithTestRoutes, {});

    abandon();
    const abandoned = await answer;
    child.signal('SIGTERM');

    expect({ abandoned, exitCode: await child.exited }).toEqual({ abandoned: 'unanswered', exitCode: 0 });
    expect(child.output().stdout).toBe(`Auto Runtime listening on port ${port}\n`);
  });
});

describe('logConfigFile', () => {
  it('says nothing without a configuration file', async () => {
    await expect(linesLoggedBy(logConfigFile())).resolves.toEqual([]);
  });

  it('says none when the environment sets everything the file sets, naming only settings', async () => {
    const lines = await linesLoggedBy(
      logConfigFile({ path: '/etc/auto-runtime.yaml', fromFile: [], overridden: ['MODEL_GATEWAYS'] }),
    );

    expect(lines.map((line) => /"message":"((?:[^"\\]|\\.)*)"/u.exec(line)?.[1])).toEqual([
      'Settings read from the configuration file /etc/auto-runtime.yaml: none',
      "Set both in the environment and in the configuration file, so the environment's value is used: MODEL_GATEWAYS",
    ]);
    expect(lines[1]).toContain('"annotations":{"config_file":"/etc/auto-runtime.yaml","settings":["MODEL_GATEWAYS"]}');
  });
});

describe('logProviderMessage', () => {
  it('warns with the provider, the model, the status, the run and what the provider said', async () => {
    const [line] = await linesLoggedBy(
      logProviderMessage({
        provider: 'gateway',
        model: 'gateway/no-such-model',
        status: 404,
        message: 'No fallback model group found',
        run_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
      }),
    );

    expect(line).toContain('"message":"Model provider gateway answered with an error","level":"WARN"');
    expect(line).toContain(
      '"annotations":{"provider":"gateway","model":"gateway/no-such-model","status":404,"run_id":"0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a","provider_message":"No fallback model group found"}',
    );
  });
});

describe('logOperatorHint', () => {
  it('warns with what the operator must do, the provider, the model and the run', async () => {
    const [line] = await linesLoggedBy(
      logOperatorHint({
        provider: 'gateway',
        model: 'gateway/llama-3.3-70b',
        hint: 'The TLS certificate of gateway is not trusted; add its certificate authority with NODE_EXTRA_CA_CERTS',
        run_id: null,
      }),
    );

    expect(line).toContain('"message":"Model provider gateway could not be');
    expect(line).toContain('"level":"WARN"');
    expect(line).toContain('"annotations":{"provider":"gateway","model":"gateway/llama-3.3-70b","run_id":null}');
  });
});

describe('logServedStudio', () => {
  it('warns where SERVE_STUDIO is on outside local mode, since the Studio served there signs no one in and sends no key', async () => {
    const [line] = await linesLoggedBy(logServedStudio({ mode: 'credentials', studio: served }));

    expect(line).toContain('"level":"WARN"');
    expect(line).toContain('"message":"SERVE_STUDIO is on outside local mode');
  });

  it('says nothing in local mode, nor where no Studio is served', async () => {
    expect([
      await linesLoggedBy(logServedStudio({ mode: 'local', studio: served })),
      await linesLoggedBy(logServedStudio({ mode: 'closed', studio: { ...served, served: false } })),
    ]).toEqual([[], []]);
  });
});

describe('logStudioKeptInMemory', () => {
  it('warns that the Studio served is kept in memory alone, saying why', async () => {
    const [line] = await linesLoggedBy(logStudioKeptInMemory('the folder /data/auto-runtime-studio could not be made'));

    expect(line).toContain('"level":"WARN"');
    expect(line).toContain('"message":"The Studio this runtime serves is');
  });
});

describe('logTelemetry', () => {
  it('says nothing when telemetry is off', async () => {
    expect(await linesLoggedBy(logTelemetry())).toEqual([]);
  });

  it('names where each signal goes by its origin alone, and whether content is recorded', async () => {
    const telemetry = readSettingsOf({
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'https://collector.example.com:4318/v1/traces?token=secret',
      TELEMETRY_CONTENT: 'true',
    }).telemetry;
    const lines = await linesLoggedBy(logTelemetry(telemetry));

    expect(lines.map((line): unknown => JSON.parse(line))).toMatchObject([
      {
        message: 'Telemetry is on, exported over OTLP',
        level: 'INFO',
        annotations: {
          service: 'auto-runtime',
          traces: 'https://collector.example.com:4318 over http/protobuf',
          metrics: 'off',
          logs: 'off',
          content: 'recorded',
        },
      },
    ]);
    expect(lines.join('\n')).not.toContain('secret');
  });

  it('says content is left out unless TELEMETRY_CONTENT asks for it', async () => {
    const [line] = await linesLoggedBy(
      logTelemetry(readSettingsOf({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318' }).telemetry),
    );

    expect(line).toContain('"content":"left out"');
  });
});

describe('the log of the extensions a server loaded', () => {
  it('names each in its order of precedence, with its version, where it was listed and the points it fills', async () => {
    const [line] = await linesLoggedBy(
      logExtensions([
        {
          package: '@acme/extension',
          provenance: 'configured',
          name: '@acme/extension',
          version: '2.0.0',
          provides: [{ point: 'example/greeter', contract: 1 }],
        },
        {
          package: '@on.auto/greeters',
          provenance: 'release',
          name: '@on.auto/greeters',
          version: '0.36.0',
          provides: [{ point: 'example/greeter', contract: 1 }],
        },
      ]),
    );

    expect(line).toContain('"message":"Extensions loaded');
    expect(line).toContain('"level":"INFO"');
    expect(line).toContain(
      '"annotations":{"extensions":[{"package":"@acme/extension","version":"2.0.0","provenance":"configured","provides":["example/greeter@1"]},{"package":"@on.auto/greeters","version":"0.36.0","provenance":"release","provides":["example/greeter@1"]}]}',
    );
  });

  it('says an extension that provides no point fills none', async () => {
    const [line] = await linesLoggedBy(
      logExtensions([
        { package: '@acme/plain', provenance: 'configured', name: '@acme/plain', version: '1.0.0', provides: [] },
      ]),
    );

    expect(line).toContain('"message":"Extensions loaded');
  });

  it('says none were loaded when none were', async () => {
    const [line] = await linesLoggedBy(logExtensions([]));

    expect(line).toContain('"message":"Extensions loaded');
  });
});

describe('the colors a stream shows', () => {
  it('are none when it is not a terminal', () => {
    expect(colorDepthOf({ isTTY: false, getColorDepth: () => 24 })).toBe(1);
    expect(colorDepthOf({})).toBe(1);
  });

  it('are none for a terminal that cannot say', () => {
    expect(colorDepthOf({ isTTY: true })).toBe(1);
  });

  it.each([
    [24, 24],
    [8, 8],
    [4, 4],
    [1, 1],
  ])('are a depth of %i bits for a terminal of %i bits', (reported, depth) => {
    expect(colorDepthOf({ isTTY: true, getColorDepth: () => reported })).toBe(depth);
  });
});

describe('painting text for a terminal', () => {
  it('leaves the text as it is where there are no colors', () => {
    expect(painterFor(1)('red', 'stopped')).toBe('stopped');
    expect(linkerFor(1)('http://localhost:5555/', 'the server')).toBe('the server');
  });

  it('styles the text and links the address where there are colors', () => {
    expect(painterFor(24)('red', 'stopped')).toBe('\u001B[31mstopped\u001B[39m');
    expect(linkerFor(8)('http://localhost:5555/', 'the server')).toBe(
      '\u001B]8;;http://localhost:5555/\u001B\\the server\u001B]8;;\u001B\\',
    );
  });
});

describe('logLedger on SQLite', () => {
  it('names the file of a ledger in SQLite by its absolute path', async () => {
    const file = resolve('data/ledger.db');

    await expect(linesLoggedBy(logLedger({ store: 'sqlite', file: 'data/ledger.db' }))).resolves.toEqual([
      expect.stringContaining(`{"message":"The ledger is kept in the file ${file}","level":"INFO",`),
    ]);
    expect(await linesLoggedBy(logLedger({ store: 'sqlite', file: 'data/ledger.db' }))).toEqual([
      expect.stringContaining(`"annotations":{"ledger_file":"${file}"}`),
    ]);
  });

  it('names a private in-memory ledger as SQLite does', async () => {
    await expect(linesLoggedBy(logLedger({ store: 'sqlite', file: ':memory:' }))).resolves.toEqual([
      expect.stringContaining('{"message":"The ledger is kept in the file :memory:","level":"INFO",'),
    ]);
  });
});

describe('logLedger on PostgreSQL', () => {
  it('names the database and the host of a ledger in PostgreSQL, and nothing else of its URL', async () => {
    const lines = await linesLoggedBy(
      logLedger({
        store: 'postgresql',
        url: Redacted.make('postgresql://playbooks:a-secret-password@db.example.com:5432/playbooks?sslmode=require'),
        host: 'db.example.com:5432',
        database: 'playbooks',
        credentials: { kind: 'url' },
      }),
    );

    expect(lines).toEqual([
      expect.stringContaining(
        '{"message":"The ledger is kept in PostgreSQL, in the database playbooks on db.example.com:5432","level":"INFO"',
      ),
    ]);
    expect(lines[0]).toContain(
      '"annotations":{"database":"playbooks","database_host":"db.example.com:5432","database_credentials":"url"}',
    );
    expect(lines.join('\n')).not.toMatch(/a-secret-password|sslmode|postgresql:/u);
  });

  it('names the user and the region a ledger in PostgreSQL signs its tokens for, and no token', async () => {
    const { ledger } = readSettingsOf({
      DATABASE_URL: 'postgresql://auto_runtime@ledger.c9akciq32.eu-west-1.rds.amazonaws.com/playbooks',
      DATABASE_CREDENTIALS: 'aws-iam',
      SECRETS_KEY: secretsKey,
    });

    const lines = await linesLoggedBy(logLedger(ledger));

    expect(lines).toEqual([
      expect.stringContaining(
        '{"message":"The ledger is kept in PostgreSQL, in the database playbooks on ledger.c9akciq32.eu-west-1.rds.amazonaws.com, signing in as auto_runtime with a token signed for each connection from the AWS credential chain, for the region eu-west-1","level":"INFO"',
      ),
    ]);
    expect(lines[0]).toContain(
      '"annotations":{"database":"playbooks","database_host":"ledger.c9akciq32.eu-west-1.rds.amazonaws.com","database_credentials":"aws-iam","database_user":"auto_runtime","database_region":"eu-west-1"}',
    );
    expect(lines.join('\n')).not.toMatch(/X-Amz|postgresql:/u);
  });
});

describe('logContentStore', () => {
  it("says content is kept in the ledger's database when no object store is set", async () => {
    await expect(linesLoggedBy(logContentStore({ store: 'ledger' }))).resolves.toEqual([
      expect.stringMatching(
        /^\{"message":"Content is kept in the ledger's database","level":"INFO",.*"annotations":\{"content_store":"ledger"\}/u,
      ),
    ]);
  });

  it('names the bucket, the prefix and the host of the endpoint of an object store, and nothing else of its URL', async () => {
    const lines = await linesLoggedBy(
      logContentStore({
        store: 'object-storage',
        location: { bucket: 'playbook-content', prefix: 'production' },
        endpoint: 'https://access:secret@storage.example.com:9000/base',
        region: 'eu-west-1',
      }),
    );

    expect(lines).toEqual([
      expect.stringContaining(
        '{"message":"Content is kept on object storage, in the bucket playbook-content under production/, on storage.example.com:9000","level":"INFO"',
      ),
    ]);
    expect(lines[0]).toContain(
      '"annotations":{"content_store":"object-storage","content_bucket":"playbook-content","content_prefix":"production","content_endpoint":"storage.example.com:9000"}',
    );
    expect(lines.join('\n')).not.toMatch(/secret|access/u);
  });

  it('names the endpoint of the region when no endpoint is set, and no prefix when it has none', async () => {
    const lines = await linesLoggedBy(
      logContentStore({
        store: 'object-storage',
        location: { bucket: 'playbook-content', prefix: '' },
        endpoint: undefined,
        region: undefined,
      }),
    );

    expect(lines).toEqual([
      expect.stringContaining(
        '{"message":"Content is kept on object storage, in the bucket playbook-content, on the S3 endpoint of its region"',
      ),
    ]);
  });
});

describe('logPayloadOffloading', () => {
  it('says past what size a payload is kept as content, named in its record, or that every new payload stays in its record', async () => {
    const lines = [
      ...(await linesLoggedBy(logPayloadOffloading({ offloading: true, sizeThresholdBytes: 4096 }))),
      ...(await linesLoggedBy(logPayloadOffloading({ offloading: false, sizeThresholdBytes: 16_384 }))),
    ];

    expect(lines).toEqual([
      expect.stringContaining(
        '{"message":"Payload offloading is on: a payload larger than 4096 bytes is kept as content, and its record names it by its SHA-256 and its size","level":"INFO"',
      ),
      expect.stringContaining(
        '{"message":"Payload offloading is off: a new payload stays inline in its record, whatever its size","level":"INFO"',
      ),
    ]);
    expect(lines).toEqual([
      expect.stringContaining('"annotations":{"payload_offloading":true,"payload_size_threshold_bytes":4096}'),
      expect.stringContaining('"annotations":{"payload_offloading":false,"payload_size_threshold_bytes":16384}'),
    ]);
  });
});

describe('logServerMessage', () => {
  it('tells a line a tool server wrote, as information', async () => {
    const [line] = await linesLoggedBy(
      logServerMessage({ server: 'limitless', message: 'Listening on stdio', run_id: null, call_id: null }),
    );

    expect(line).toContain('"message":"Tool server limitless wrote: Listening on stdio","level":"INFO"');
    expect(line).toContain('"annotations":{"tool_server":"limitless"}');
  });

  it('warns of a call a tool server failed, with the run and what the server said', async () => {
    const [line] = await linesLoggedBy(
      logServerMessage({
        server: 'graph',
        message: 'The tool server answered HTTP 503',
        run_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
        call_id: null,
      }),
    );

    expect(line).toContain('"message":"Tool server graph failed a call","level":"WARN"');
    expect(line).toContain(
      '"annotations":{"tool_server":"graph","run_id":"0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a","server_message":"The tool server answered HTTP 503"}',
    );
  });

  it('warns of a call made by hand that a tool server failed, naming the call as a run is named', async () => {
    const [line] = await linesLoggedBy(
      logServerMessage({
        server: 'graph',
        message: 'The tool server answered HTTP 503',
        run_id: null,
        call_id: '0199b7e2-4c1d-7a3e-8f5b-6d2c1e0f9a8b',
      }),
    );

    expect(line).toContain('"message":"Tool server graph failed a call","level":"WARN"');
    expect(line).toContain(
      '"annotations":{"tool_server":"graph","call_id":"0199b7e2-4c1d-7a3e-8f5b-6d2c1e0f9a8b","server_message":"The tool server answered HTTP 503"}',
    );
  });
});

describe('logLeftOutOperation', () => {
  it('warns of an operation of the document of a tool server that no tool is offered for, saying why', async () => {
    const [line] = await linesLoggedBy(
      logLeftOutOperation('billing', {
        operation: 'upload (POST /uploads)',
        because: 'its body is application/x-www-form-urlencoded, a form a call does not send',
      }),
    );

    expect(line).toContain('"message":"The tool server billing offers no');
    expect(line).toContain('"level":"WARN"');
    expect(line).toContain('"annotations":{"tool_server":"billing"}');
  });
});

describe('logMarkUnlisted', () => {
  it('warns of a tool the entry of a tool server marks that the server does not list, naming both', async () => {
    const [line] = await linesLoggedBy(logMarkUnlisted('graph', 'archive_note'));

    expect(line).toContain('"message":"The tool server graph lists no');
    expect(line).toContain('"level":"WARN"');
    expect(line).toContain('"annotations":{"tool_server":"graph","tool":"archive_note"}');
  });
});

describe('logIncident for an error whose cause cannot be formatted', () => {
  it('logs a line with the incident id and the call, and no cause', async () => {
    const call = { operation: 'add_note', org: 'acme', caller: 'acme-admin' };

    const lines = await linesLoggedBy(logIncident({ id: 'incident-1', original: selfCaused, call }));

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"message":"Unexpected error whose cause could not');
    expect(lines[0]).toContain(
      '"annotations":{"incident":"incident-1","operation":"add_note","org":"acme","caller":"acme-admin"}',
    );
    expect(lines[0]).not.toContain('"cause"');
  });
});

describe('a server whose route throws an error that is its own cause', () => {
  it('answers 500, logs the incident and keeps serving', async () => {
    const child = spawnServer(serveWithSelfCausedError, { HOST: '127.0.0.1', PORT: '0' });
    const port = await child.port;

    const failed = await fetch(`http://127.0.0.1:${port}/self-caused`);
    const incident = /"instance":"urn:uuid:([^"]+)"/u.exec(await failed.text())?.[1];
    const stderr = await stderrOnceItContains(child, `"incident":"${String(incident)}"`);
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    child.signal('SIGTERM');

    expect({ failed: failed.status, health: health.status, exitCode: await child.exited }).toEqual({
      failed: 500,
      health: 200,
      exitCode: 0,
    });
    expect(stderr).toContain('"message":"Unexpected error whose cause could not');
    expect(stderr).toContain(
      `"annotations":{"requestId":"${String(failed.headers.get('x-request-id'))}","incident":"${String(incident)}"}`,
    );
  });
});
