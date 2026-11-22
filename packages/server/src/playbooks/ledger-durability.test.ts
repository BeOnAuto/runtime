import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { startServer } from '../lifecycle/lifecycle.ts';
import { saidAtStart } from '../testing/processes/in-process-starts.ts';
import { appendMalformedPlaybookEvent } from '../testing/records/malformed-playbook-event.ts';
import { aPathUnderAFile, temporaryLedger, type TemporaryLedger } from '../testing/records/temporary-ledger.ts';
import { request, withoutStudioLink } from '../testing/servers/http-client.ts';
import { testComposition } from '../testing/servers/test-compositions.ts';
import { goalsText } from '../testing/settings/goals-kept.ts';

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

describe('playbooks in the ledger file', () => {
  it('are still there, read as they were created, when the server starts again on the same file', async () => {
    const first = await startServer(onLoopback(ledger.fileName), testComposition());
    const created = await request(first.port, 'POST', '/v1/orgs/acme/playbooks', {
      body: { playbook: 'alpha', name: 'Alpha', goals: goalsText },
    });
    await first.stop();

    const second = await startServer(onLoopback(ledger.fileName), testComposition());
    const read = await request(second.port, 'GET', alpha);
    await second.stop();
    const {
      before_building: _beforeBuilding,
      notices: _notices,
      before_going_on: _beforeGoingOn,
      ...asRead
    } = withoutStudioLink(created.body);

    expect(created.status).toBe(201);
    expect(read).toMatchObject({ status: 200, body: { id: 'alpha', name: 'Alpha', status: 'active' } });
    expect(read.body).toEqual(asRead);
  });
});

describe('a ledger that cannot be opened', () => {
  it('stops start-up with a named error', async () => {
    await expect(startServer(onLoopback(aPathUnderAFile(ledger)), testComposition())).rejects.toMatchObject({
      name: 'StartupError',
    });
  });

  it('says the error in one line as the start stops', async () => {
    const said = await saidAtStart(onLoopback(aPathUnderAFile(ledger)));

    expect(said.exitCode).toBe(1);
    expect(said.line.split('\n')).toEqual([
      expect.stringContaining(
        "Auto Runtime could not start: StartupError: The server's services could not start: Error: EEXIST: file already exists, mkdir",
      ),
      '',
    ]);
  });
});

describe('an error in the ledger', () => {
  it('answers 500 identified by the urn:uuid of an incident, logged with the operation, the org and the caller but not the input', async () => {
    const logged = vi.spyOn(console, 'error');
    onTestFinished(() => {
      logged.mockRestore();
    });
    const server = await startServer(onLoopback(ledger.fileName), testComposition());
    await appendMalformedPlaybookEvent(ledger.fileName, 'acme');

    const response = await request(server.port, 'POST', '/v1/orgs/acme/playbooks', {
      body: { playbook: 'alpha', name: 'a name only the caller knows', goals: goalsText },
    });
    await server.stop();
    const stderr = logged.mock.calls.flat().map(String).join('\n');
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
    expect(stderr).toContain(
      `"annotations":{"requestId":"${String(response.headers.get('x-request-id'))}","incident":"${String(incident)}","operation":"create_playbook","org":"acme","caller":"local"}`,
    );
    expect(stderr).not.toContain('a name only the caller knows');
  });
});
