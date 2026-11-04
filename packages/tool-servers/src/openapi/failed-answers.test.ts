import { describe, expect, it } from 'vitest';

import { accessTo, called, clientSecret, fakeApi } from '../api-testing/api-calls.ts';
import type { CallSettled } from '../clients/server-client.ts';
import { failureOf } from '../clients/server-failures.ts';
import { settledOf } from './api-answers.ts';

const answering = {
  requestIdHeader: 'x-request-id',
  failureCodes: null,
  now: () => Date.parse('2026-11-04T09:00:00.000Z'),
};

function resultOf(settled: CallSettled): unknown {
  return 'result' in settled ? settled.result : settled;
}

function failingOf(settled: CallSettled): unknown {
  return 'error' in settled ? [failureOf(settled.error), settled.observed.response?.retryAfterMs] : settled;
}

async function resultsOf(...responses: readonly Readonly<Response>[]): Promise<readonly unknown[]> {
  return (await Promise.all(responses.map((response) => settledOf(response, answering)))).map((each) => resultOf(each));
}

const answeringByCodes = {
  ...answering,
  failureCodes: {
    succeeded: '/ok',
    code: '/error',
    key_refused: ['invalid_auth'],
    scope_lacking: ['missing_scope'],
    rate_limited: ['ratelimited'],
  },
};

describe('an answer of an HTTP API whose entry names its failure codes', () => {
  it('that says it failed with a code the entry names is the failure the code means, a limited rate with the wait its header asks for', async () => {
    const answers = [
      Response.json({ ok: false, error: 'invalid_auth' }),
      Response.json({ ok: false, error: 'missing_scope', needed: 'reactions:read' }),
      Response.json({ ok: false, error: 'ratelimited' }, { headers: { 'retry-after': '3' } }),
      Response.json({ ok: false, error: 'invalid_auth' }, { status: 400 }),
    ];

    const settled = await Promise.all(answers.map((response) => settledOf(response, answeringByCodes)));

    expect(settled.map((each) => failingOf(each))).toEqual([
      [{ kind: 'key_refused', message: 'The tool server answered invalid_auth' }, null],
      [
        {
          kind: 'scope_lacking',
          message:
            'The tool server answered missing_scope: the credential lacks a scope this request needs; a credential granted that scope would allow it',
        },
        null,
      ],
      [{ kind: 'rate_limited', message: 'The tool server answered ratelimited' }, 3000],
      [{ kind: 'key_refused', message: 'The tool server answered invalid_auth' }, null],
    ]);
  });
});

describe('an answer of an HTTP API whose entry names its failure codes, for a code it does not name', () => {
  it('that says it failed with any other code, or none, is an error result carrying the answer, and never a success', async () => {
    const settled = await settledOf(
      Response.json({ ok: false, error: 'channel_not_found' }, { headers: { 'x-request-id': 'request-9' } }),
      answeringByCodes,
    );

    const named = await settledOf(Response.json({ ok: false }), answeringByCodes);

    expect([settled, resultOf(named)]).toEqual([
      {
        result: { content: [{ type: 'text', text: '{"ok":false,"error":"channel_not_found"}' }], isError: true },
        resultJson: '{"content":[{"type":"text","text":"{\\"ok\\":false,\\"error\\":\\"channel_not_found\\"}"}]}',
        observed: { id: null, response: { retryAfterMs: null, serverRequestId: 'request-9', tooLarge: false } },
      },
      { content: [{ type: 'text', text: '{"ok":false}' }], isError: true },
    ]);
  });

  it('that says it succeeded, or is no JSON that parses, is shown as any answer is, as is every answer of an entry that names none', async () => {
    const settled = await Promise.all(
      [
        Response.json({ ok: true, channel: { id: 'C1' } }),
        new Response('{"ok":false', { headers: { 'content-type': 'application/json' } }),
      ].map((response) => settledOf(response, answeringByCodes)),
    );

    expect([
      ...settled.map((each) => resultOf(each)),
      ...(await resultsOf(Response.json({ ok: false, error: 'invalid_auth' }))),
    ]).toEqual([
      {
        content: [{ type: 'text', text: '{"ok":true,"channel":{"id":"C1"}}' }],
        structuredContent: { ok: true, channel: { id: 'C1' } },
      },
      { content: [{ type: 'text', text: '{"ok":false' }] },
      {
        content: [{ type: 'text', text: '{"ok":false,"error":"invalid_auth"}' }],
        structuredContent: { ok: false, error: 'invalid_auth' },
      },
    ]);
  });
});

const encoded = (text: string) => new TextEncoder().encode(text);

describe('an answer of an HTTP API whose entry names its failure codes, whatever its content type', () => {
  it('is read as JSON where it parses, so a failure sent as text or with no content type is the failure its code means', async () => {
    const failing = '{"ok":false,"error":"invalid_auth"}';
    const answers = [
      new Response(failing),
      new Response(encoded(failing)),
      new Response(failing, { status: 400 }),
      new Response(encoded('{"ok":false,"error":"channel_not_found"}')),
    ];

    const settled = await Promise.all(answers.map((response) => settledOf(response, answeringByCodes)));
    const succeeded = await settledOf(new Response('{"ok":true}'), answeringByCodes);

    expect(settled.map((each) => failingOf(each))).toEqual([
      [{ kind: 'key_refused', message: 'The tool server answered invalid_auth' }, null],
      [{ kind: 'key_refused', message: 'The tool server answered invalid_auth' }, null],
      [{ kind: 'key_refused', message: 'The tool server answered invalid_auth' }, null],
      expect.objectContaining({
        result: { content: [{ type: 'text', text: '{"ok":false,"error":"channel_not_found"}' }], isError: true },
      }),
    ]);
    expect(resultOf(succeeded)).toEqual({
      content: [{ type: 'text', text: '{"ok":true}' }],
      structuredContent: { ok: true },
    });
  });

  it('is read as a file, as without failure codes, where it is no JSON or holds more than an answer of a tool may', async () => {
    const larger = `{"ok":false,"error":"invalid_auth","pad":"${'x'.repeat(16_777_216)}"}`;
    const bodies = ['The report is ready.', larger];

    const byCodes = await Promise.all(bodies.map((body) => settledOf(new Response(body), answeringByCodes)));
    const without = await Promise.all(bodies.map((body) => settledOf(new Response(body), answering)));

    expect(byCodes.map((each) => resultOf(each))).toEqual(without.map((each) => resultOf(each)));
    expect(byCodes.map((each) => 'error' in each)).toEqual([false, false]);
  });
});

describe('the token of an HTTP API whose entry names its failure codes', () => {
  it('is minted once more when the API answers a code its entry names as a refused key, and a second such answer is a key the server refused in words that name the code', async () => {
    const fake = await fakeApi({ client: { clientId: 'playbook', clientSecret, expiresInSeconds: 3600 } });
    const access = await accessTo({
      document: fake.documentUrl,
      auth: { issuer: String(fake.issuing?.issuer), client_id: 'playbook', client_secret: '${GRAPH_CLIENT_SECRET}' },
      failure_codes: { succeeded: '/ok', code: '/error', key_refused: ['token_revoked'] },
    });
    const revoked = {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: '{"ok":false,"error":"token_revoked"}',
    };

    fake.answerNextWith(revoked);
    const renewed = await called(access, 'search', { query: 'acme' });
    fake.answerNextWith(revoked, 2);
    const refused = await called(access, 'search', { query: 'acme' });

    expect([renewed, refused]).toMatchObject([
      { outcome: 'result' },
      { outcome: 'server_failure', detail: 'The tool server answered token_revoked' },
    ]);
    expect(fake.issuing?.tokenRequests()).toBe(3);
  });
});
