import { fileURLToPath } from 'node:url';

import type { SignInSettings } from '@on.auto/identity';
import { Cause } from 'effect';
import { describe, expect, it } from 'vitest';

import { serverHoldingARequest, spawnServer } from '../testing/processes/spawned-server.ts';
import { linesLoggedBy } from '../testing/records/logged-lines.ts';
import {
  logAccessMode,
  logIncident,
  logLostWorkflowConnection,
  logMcpError,
  logReasoning,
  logUnsettled,
  logWorkflows,
  logWorkflowTrouble,
} from './logging.ts';

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

describe('logAccessMode', () => {
  it('warns that local mode trusts every request, and what a machine reachable through a proxy sets instead', async () => {
    const [line] = await linesLoggedBy(logAccessMode({ mode: 'local', signIn: undefined }));

    expect(line).toContain('"level":"WARN"');
    expect(line).toContain(
      '"message":"Local mode is on: every request is trusted as the local developer, with every permission in every org. On a machine reachable through a proxy, set PUBLIC_URL or API_KEYS instead, and no ACCESS_MODE"',
    );
  });

  it('warns in one line that no request can authenticate when API_KEYS lists no keys', async () => {
    const lines = await linesLoggedBy(logAccessMode({ mode: 'closed', signIn: undefined }));

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"level":"WARN"');
    expect(lines[0]).toContain(
      '"message":"No request can authenticate: API_KEYS lists no keys, so every path answers 401 except /health, the OpenAPI document at /v1/openapi.json, the guides under /v1/guides and the API catalog at /.well-known/api-catalog"',
    );
  });
});

describe('logAccessMode with credentials configured', () => {
  it('says nothing when API keys alone are configured', async () => {
    expect(await linesLoggedBy(logAccessMode({ mode: 'credentials', signIn: undefined }))).toEqual([]);
  });

  it('names the identity service persons sign in through, and the audience of their tokens', async () => {
    const [line] = await linesLoggedBy(logAccessMode({ mode: 'credentials', signIn }));

    expect(line).toContain('"level":"INFO"');
    expect(line).toContain(
      '"message":"Signed-in persons are admitted through the identity service at https://clerk.on.auto, by tokens whose audience is https://runtime.example"',
    );
    expect(line).toContain('"public_url":"https://runtime.example","identity_issuer":"https://clerk.on.auto"');
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

    expect(line).toContain(
      `"message":"Reasoning functions run in this server: the model calls of a run add up to at most 2,000,000 input tokens, and each answer of a tool is read whole where it fits the model's context window","level":"INFO"`,
    );
    expect(line).toContain('"annotations":{"most_input_tokens":2000000}');
  });
});

describe('the workflow logs', () => {
  it('say how long a run lasts at most, how many calls run at once and how often the runs are swept', async () => {
    const [line] = await linesLoggedBy(
      logWorkflows({ mostDurationMs: 2_592_000_000, mostCallsAtOnce: 32, sweepEveryMs: 1000 }),
    );

    expect(line).toContain(
      '"message":"Workflows run in this server: a run lasts at most 30 days, at most 32 of their calls run at once, and the runs are swept every 1000 ms","level":"INFO"',
    );
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

    expect(line).toContain('"message":"A sweep of the runs failed; the next sweep tries again","level":"WARN"');
    expect(line).toContain('"error":"Error: the database is gone xxx');
    expect(line).not.toContain('x'.repeat(2000));
  });

  it('warn that a connection of the workflows to PostgreSQL was lost, with the message of its error', async () => {
    const [line] = await linesLoggedBy(logLostWorkflowConnection(new Error('Connection terminated unexpectedly')));

    expect(line).toContain(
      '"message":"A connection of the workflows to their PostgreSQL database was lost; they open another when they need one","level":"WARN"',
    );
    expect(line).toContain('"annotations":{"error":"Connection terminated unexpectedly"}');
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
