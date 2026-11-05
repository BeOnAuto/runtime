import { serveFakeMcp } from '@on.auto/tool-servers/served-fakes';
import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { guarded, interactionServerOn } from '../testing/interaction-servers/interaction-server.ts';
import { alpha } from '../testing/servers/reasoning-server.ts';
import { runIdIn, workflowSource } from '../testing/servers/workflow-server.ts';

const browserKey = 'browser-api-key-71c4d2e9';

const link = 'https://studio.example/?browser-sign-in=hand-off-7Qx2&org=acme';

const site = 'portal.supplier.example';

const message = "The weekly stock check reads your open orders on the supplier portal, and you're not signed in there.";

function signInSource(ifSignedOut: 'ask' | 'fail'): string {
  const asking = ifSignedOut === 'ask' ? ['expires: P1D', 'deliver: agent', '---', message] : ['---', ''];
  return ['---', 'sign_in:', '  server: browser', `  site: ${site}`, `  if_signed_out: ${ifSignedOut}`, ...asking].join(
    '\n',
  );
}

const ActivitySchema = Schema.Struct({
  rows: Schema.Array(
    Schema.Struct({ kind: Schema.String, run_id: Schema.NullOr(Schema.String), sign_in: Schema.Unknown }),
  ),
});

const answer = { signed_in: false, link, until: '2026-11-06T09:00:00.000Z' };

async function signingIn() {
  const browser = await serveFakeMcp({
    bearer: browserKey,
    tools: [
      {
        name: 'browser_sign_in',
        description: 'Hands the browser to the person to sign in to a site, and keeps the sign-in for them alone.',
        inputSchema: {
          type: 'object',
          properties: {
            site: { type: 'string' },
            request: { type: 'string' },
            until: { type: 'string' },
            ask: { type: 'boolean' },
          },
          required: ['site'],
        },
        answer: () => ({ content: [{ type: 'text', text: JSON.stringify(answer) }], structuredContent: answer }),
      },
    ],
  });
  onTestFinished(browser.close);
  const server = await interactionServerOn({
    BROWSER_KEY: browserKey,
    TOOL_SERVERS: JSON.stringify({
      browser: { url: browser.url, headers: { Authorization: 'Bearer ${BROWSER_KEY}' }, org: 'acme' },
    }),
  });
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  const saved = await Promise.all(
    (['ask', 'fail'] as const).map((ifSignedOut) =>
      server.call('POST', `${alpha}/definitions/interaction`, {
        body: { name: `portal-${ifSignedOut}`, source: signInSource(ifSignedOut), diagram: 'none' },
      }),
    ),
  );
  return { browser, server, saved };
}

describe('a sign-in function over HTTP, for the local developer', () => {
  it('asks the local developer with the link, listed with its site, and succeeds once they answer that they signed in', async () => {
    const { browser, server, saved } = await signingIn();
    const started = await server.call('POST', `${alpha}/definitions/interaction/portal-ask/run`, {
      body: { input: {} },
    });
    const runId = runIdIn(started.body);

    const listed = await server.call('GET', `${alpha}/interactions`);
    const activity = Schema.decodeUnknownSync(ActivitySchema)(
      (await server.call('GET', '/v1/orgs/acme/activity?kind=needs_you')).body,
    );
    const answered = await server.answer(runId, { answer: { signed_in: true } });
    const settled = await server.settled(runId);
    const history = await server.call('GET', `${alpha}/runs/${runId}/history`);

    expect(saved.map(({ status }) => status)).toEqual([201, 201]);
    expect(browser.received()).toMatchObject([
      { tool: 'browser_sign_in', arguments: { site, request: `alpha/${runId}` } },
    ]);
    expect(listed.body).toMatchObject({
      interactions: [
        {
          run_id: runId,
          to: 'local',
          message: `${message}\n\n${link}`,
          sign_in: { server: 'browser', site, link },
        },
      ],
    });
    expect(activity.rows).toEqual([{ kind: 'needs_you', run_id: runId, sign_in: { server: 'browser', site, link } }]);
    expect(answered.status).toBe(200);
    expect(settled).toMatchObject({ status: 'succeeded', output: { signed_in: true } });
    expect(history.body).toMatchObject({
      events: [
        { type: 'run_started' },
        { type: 'tool_call_started' },
        { type: 'tool_call_answered' },
        { type: 'interaction_requested' },
        { type: 'request_answered', data: { answer: { signed_in: true } } },
        { type: 'run_succeeded' },
      ],
    });
  });
});

describe('a sign-in function that stops at once, over HTTP', () => {
  it('ends a run as unanswered, signed_out, which a workflow catches by its kind', async () => {
    const { server } = await signingIn();

    const stopped = await server.call('POST', `${alpha}/definitions/interaction/portal-fail/run`, {
      body: { input: {} },
    });
    const caught = await server.workflow('guarded', guarded('portal-fail', 'signed_out'));

    expect(stopped).toMatchObject({
      status: 410,
      body: { type: 'https://on.auto/problems/unanswered', kind: 'signed_out' },
    });
    expect(await server.settled(caught)).toMatchObject({ status: 'succeeded', output: { caught: 'signed_out' } });
  });
});

const stockCheck = workflowSource(
  'weekly-stock-check',
  'schedule:\n  on: { one: { with: { type: com.acme.orders.due } } }\ndo:\n  - sign-in: { call: run_definition, with: { type: interaction, name: portal-ask, input: {} } }\n',
);

describe('a sign-in step of a workflow a trigger started, over HTTP', () => {
  it('asks the person the triggered run acts for, who saved the workflow: the local developer here', async () => {
    const { server } = await signingIn();
    await server.call('POST', `${alpha}/definitions/workflow`, {
      body: { name: 'weekly-stock-check', source: stockCheck },
    });

    await server.call('POST', `${alpha}/events`, {
      body: { event: { source: '/orders', type: 'com.acme.orders.due', data: {} } },
    });
    const [asked = ''] = await server.openRequests(1);
    const listed = await server.call('GET', `${alpha}/interactions`);
    const step = await server.call('GET', `${alpha}/runs/${asked}`);

    expect(listed.body).toMatchObject({
      interactions: [{ run_id: asked, to: 'local', sign_in: { server: 'browser', site, link } }],
    });
    expect(step.body).toMatchObject({ status: 'started', started_by: { id: 'playbook:alpha' }, acts_for: 'local' });
  });
});
