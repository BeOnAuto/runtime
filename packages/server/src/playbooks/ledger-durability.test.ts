import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { compositionRoot } from '../composition/composition-root.ts';
import { startServer } from '../lifecycle/lifecycle.ts';
import { spawnServer } from '../testing/processes/spawned-server.ts';
import { appendMalformedPlaybookEvent } from '../testing/records/malformed-playbook-event.ts';
import { temporaryLedger, type TemporaryLedger } from '../testing/records/temporary-ledger.ts';
import { request } from '../testing/servers/http-client.ts';

const mainModule = fileURLToPath(new URL('../main.ts', import.meta.url));

const alpha = '/v1/orgs/acme/playbooks/alpha';

let ledger: TemporaryLedger;

beforeEach(() => {
  ledger = temporaryLedger();
});

afterEach(() => {
  ledger.remove();
});

function onLoopback(fileName: string): Readonly<Record<string, string>> {
  return {
    HOST: '127.0.0.1',
    PORT: '0',
    LEDGER_FILE: fileName,
  };
}

function aPathUnderAFile(): string {
  const aFile = join(ledger.directory, 'a-file');
  writeFileSync(aFile, '');
  return join(aFile, 'ledger.db');
}

describe('playbooks in the ledger file', () => {
  it('are still there when the server starts again on the same file', async () => {
    const first = await startServer(onLoopback(ledger.fileName), compositionRoot);
    await request(first.port, 'POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
    await first.stop();

    const second = await startServer(onLoopback(ledger.fileName), compositionRoot);
    const read = await request(second.port, 'GET', alpha);
    await second.stop();

    expect(read).toMatchObject({ status: 200, body: { id: 'alpha', name: 'Alpha', status: 'active' } });
  });

  it('are kept by a process that exits 0 on SIGTERM, and read by the next process', async () => {
    const first = spawnServer(mainModule, onLoopback(ledger.fileName));
    const created = await request(await first.port, 'POST', '/v1/orgs/acme/playbooks', {
      body: { playbook: 'alpha', name: 'Alpha' },
    });
    first.signal('SIGTERM');
    const firstExit = await first.exited;

    const second = spawnServer(mainModule, onLoopback(ledger.fileName));
    const read = await request(await second.port, 'GET', alpha);
    second.signal('SIGTERM');

    expect({ created: created.status, firstExit, read: read.status, secondExit: await second.exited }).toEqual({
      created: 201,
      firstExit: 0,
      read: 200,
      secondExit: 0,
    });
    expect(read.body).toEqual(created.body);
  });
});

describe('a ledger that cannot be opened', () => {
  it('stops start-up with a named error', async () => {
    await expect(startServer(onLoopback(aPathUnderAFile()), compositionRoot)).rejects.toMatchObject({
      name: 'StartupError',
    });
  });

  it('stops the process with the error on stderr, a non-zero exit and nothing on stdout', async () => {
    const child = spawnServer(mainModule, onLoopback(aPathUnderAFile()));

    expect(await child.exited).toBe(1);
    expect(child.output().stdout).toBe('');
    expect(child.output().stderr.split('\n')).toEqual([
      expect.stringContaining(
        "Auto Runtime could not start: StartupError: The server's services could not start: Error: EEXIST: file already exists, mkdir",
      ),
      '',
    ]);
  });
});

describe('an error in the ledger', () => {
  it('answers 500 identified by the urn:uuid of an incident, logged with the operation, the org and the caller but not the input', async () => {
    const child = spawnServer(mainModule, onLoopback(ledger.fileName));
    const port = await child.port;
    await appendMalformedPlaybookEvent(ledger.fileName, 'acme');

    const response = await request(port, 'POST', '/v1/orgs/acme/playbooks', {
      body: { playbook: 'alpha', name: 'a name only the caller knows' },
    });
    child.signal('SIGTERM');
    await child.exited;
    const incident = /"instance":"urn:uuid:([^"]+)"/u.exec(response.text)?.[1];

    expect(response.status).toBe(500);
    expect(incident).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    expect(response.body).toEqual({
      type: 'https://on.auto/problems/internal',
      title: 'Internal error',
      status: 500,
      detail: 'An unexpected error occurred',
      reason: 'internal',
      instance: `urn:uuid:${String(incident)}`,
    });
    expect(child.output().stderr).toContain(
      `"annotations":{"requestId":"${String(response.headers.get('x-request-id'))}","incident":"${String(incident)}","operation":"create_playbook","org":"acme","caller":"local"}`,
    );
    expect(child.output().stderr).not.toContain('a name only the caller knows');
  });
});
