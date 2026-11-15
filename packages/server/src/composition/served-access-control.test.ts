import { editorRoleForEveryPerson, loadedMessage } from '@on.auto/access-control';
import { reportedDifferenceMessage } from '@on.auto/operations';
import { Effect, Schema } from 'effect';
import { afterAll, describe, expect, it } from 'vitest';

import { logLinesOf, requestTo, workflowProcess } from '../testing/processes/workflow-process.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { contributing, givenGoals, workflowSource } from '../testing/servers/workflow-server.ts';
import { until } from '../testing/waiting/until.ts';
import { rolesServedFrom, servedRoleSource } from './served-access-control.ts';

const ledger = temporaryLedger();

afterAll(() => {
  ledger.remove();
});

const closing = workflowSource(
  'close-the-month',
  'schedule:\n  on: { one: { with: { type: com.acme.ledger.closed } } }\ndo:\n  - total: { set: { closed: true } }\n',
);

const runsOf = Schema.decodeUnknownSync(Schema.Struct({ runs: Schema.Array(Schema.Unknown) }));

describe('the server', () => {
  it('asks the policy decision point about each call in report-only mode: it loads on the first call, over every operation served, and decides as the check does', async () => {
    const child = workflowProcess(ledger.fileName);
    const port = await child.port;
    const atStart = logLinesOf(child).map(({ message }) => message);

    const created = await requestTo(port, 'POST', '', { playbook: 'gamma', name: 'Gamma', goals: givenGoals });
    const listed = await requestTo(port, 'GET', '');
    const read = await requestTo(port, 'GET', '/gamma');
    child.signal('SIGTERM');
    await child.exited;
    const lines = logLinesOf(child);
    const [loaded, ...loadedAgain] = lines.filter(({ message }) => message === loadedMessage);

    expect([created.status, listed.status, read.status]).toEqual([201, 200, 200]);
    expect(atStart).not.toContain(loadedMessage);
    expect(loadedAgain).toEqual([]);
    expect(loaded).toMatchObject({ level: 'INFO', annotations: { engine: 'Cedar 4.14.0', policies: 11 } });
    expect(loaded?.annotations['operations']).toBeGreaterThan(60);
    expect(lines.filter(({ message }) => message === reportedDifferenceMessage)).toEqual([]);
  });

  it('decides as the check does the start of a run an event triggers, which the workflow host asks of the playbook as itself', async () => {
    const child = workflowProcess(ledger.fileName);
    const port = await child.port;

    await requestTo(port, 'POST', '', { playbook: 'delta', name: 'Delta', goals: givenGoals });
    await requestTo(port, 'POST', '/delta/definitions/workflow', {
      name: 'close-the-month',
      source: contributing(closing),
    });
    await requestTo(port, 'POST', '/delta/events', {
      event: { source: '/ledger', type: 'com.acme.ledger.closed', data: { month: 'october' } },
    });
    const started = await until(
      () => requestTo(port, 'GET', '/delta/runs?type=workflow&name=close-the-month'),
      ({ body }) => runsOf(body).runs.length > 0,
    );
    child.signal('SIGTERM');
    await child.exited;

    expect(runsOf(started.body).runs).toHaveLength(1);
    expect(logLinesOf(child).filter(({ message }) => message === reportedDifferenceMessage)).toEqual([]);
  });
});

describe('the roles the server hands its decision point', () => {
  it('are today’s, every signed-in person an editor, until the composition names the role assignments it records', () => {
    const unread = { readProjectedRows: () => Effect.die(new Error('the read model is not read')) };

    expect(servedRoleSource).toBe('every_person_an_editor');
    expect(rolesServedFrom(unread)).toBe(editorRoleForEveryPerson);
  });
});
