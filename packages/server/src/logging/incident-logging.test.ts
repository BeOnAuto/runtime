import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { spawnServer, type SpawnedServer } from '../testing/processes/spawned-server.ts';
import { linesLoggedBy } from '../testing/records/logged-lines.ts';
import { until } from '../testing/waiting/until.ts';
import { logIncident } from './logging.ts';

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

describe('logIncident for an error whose cause cannot be formatted', () => {
  it('logs a line with the incident id and the call, and no cause', async () => {
    const call = { operation: 'add_note', org: 'acme', caller: 'acme-admin' };

    const lines = await linesLoggedBy(logIncident({ id: 'incident-1', original: selfCaused, call }));

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"message":"Unexpected error whose cause could not be formatted"');
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
    expect(stderr).toContain('"message":"Unexpected error whose cause could not be formatted"');
    expect(stderr).toContain(
      `"annotations":{"requestId":"${String(failed.headers.get('x-request-id'))}","incident":"${String(incident)}"}`,
    );
  });
});
