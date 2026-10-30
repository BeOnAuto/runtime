import { Effect, Option, Result } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { patientTiming, recordingCallJournal, reportingAccess, toolRun } from '../testing/index.ts';
import { serveFakeMcp, type FakeMcpServer } from '../testing/served-fakes.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function fakeServer(): Promise<FakeMcpServer> {
  const fake = await serveFakeMcp({ bearer: apiKey });
  closing.push(fake.close);
  return fake;
}

function accessTo(servers: Readonly<Record<string, unknown>>) {
  const { access } = reportingAccess(servers, { environment: { GRAPH_API_KEY: apiKey }, timing: patientTiming });
  closing.push(access.close);
  return { access };
}

const graphOf = (fake: FakeMcpServer, changes: Readonly<Record<string, unknown>> = {}) => ({
  url: fake.url,
  headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' },
  org: 'acme',
  ...changes,
});

async function refusalOf(access: ReturnType<typeof accessTo>['access'], ...written: readonly string[]) {
  const references = written.map((each) => {
    const [server = '', tool = ''] = each.split('/');
    return { server, tool };
  });
  const opened = await Effect.runPromise(Effect.result(access.open(toolRun(recordingCallJournal()), references)));
  return Option.getOrUndefined(Result.getFailure(opened));
}

describe('a tool that is not offered', () => {
  it('names a server that is not configured, or not for this org or playbook', async () => {
    const fake = await fakeServer();
    const { access } = accessTo({
      graph: graphOf(fake, { org: 'globex' }),
      crm: graphOf(fake, { playbooks: ['sales'] }),
      wiki: graphOf(fake),
    });

    expect(await refusalOf(access, 'wiki/search', 'graph/search', 'crm/search', 'mail/send')).toMatchObject({
      _tag: 'tool_not_offered',
      because: 'tool_server_not_configured',
      detail: 'No tool server named graph, crm, or mail is configured for this playbook',
    });
    expect(fake.seen()).toEqual([]);
  });

  it('names a tool the entry of its server does not allow', async () => {
    const fake = await fakeServer();
    const { access } = accessTo({ graph: graphOf(fake, { allowed: ['search'] }) });

    expect(await refusalOf(access, 'graph/search', 'graph/echo')).toMatchObject({
      _tag: 'tool_not_offered',
      because: 'tool_not_allowed',
      detail: 'The operator of this server does not allow graph/echo',
    });
  });
});

describe('a tool its server does not list', () => {
  it('names a tool its server does not list, and lets its session go', async () => {
    const fake = await fakeServer();
    const { access } = accessTo({ graph: graphOf(fake) });

    expect(await refusalOf(access, 'graph/search', 'graph/lookup')).toMatchObject({
      _tag: 'tool_not_offered',
      because: 'tool_not_listed',
      detail: 'The tool server graph does not list the tool lookup',
    });
    expect(fake.openSessions()).toBe(0);
  });

  it('names every tool its servers do not list, by server, and every tool their entries do not allow', async () => {
    const fake = await fakeServer();
    const { access } = accessTo({ graph: graphOf(fake), wiki: graphOf(fake, { allowed: ['seek'] }) });

    expect([
      await refusalOf(access, 'graph/lookup', 'wiki/seek', 'graph/find'),
      await refusalOf(access, 'wiki/echo', 'wiki/search'),
    ]).toMatchObject([
      {
        because: 'tool_not_listed',
        detail:
          'The tool server graph does not list the tools lookup and find and the tool server wiki does not list the tool seek',
      },
      { because: 'tool_not_allowed', detail: 'The operator of this server does not allow wiki/echo and wiki/search' },
    ]);
  });
});
