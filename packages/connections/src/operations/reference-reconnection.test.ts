import type { Outcome } from '@on.auto/operations';
import { Effect, Option, Redacted, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { connectionPolicyOf } from '../policy/connection-policy.ts';
import {
  added,
  type Added,
  adding,
  crm,
  crmKeyHelp,
  issuesIn,
  notes,
  reconnected,
  reconnecting,
} from '../testing/additions.ts';
import { ada, harness, type Harness, operationNamed, recordedAs } from '../testing/harness.ts';
import { preparedOf, servedAs, sourceOver } from '../testing/served-connections.ts';

const anyWords: unknown = expect.any(String);

const { instructions: _instructions, key_page: _keyPage, ...unexplained } = crm.credential;

function withKey(credential: Readonly<Record<string, unknown>>) {
  return { ...crm, credential: { ...crm.credential, ...credential } };
}

describe('a secret given by hand', () => {
  it('is refused without the instructions and the key page the person reads, in words that say what to write', async () => {
    expect(issuesIn(await adding(harness(), { ...crm, credential: unexplained }))).toEqual([
      {
        pointer: '/credential/instructions',
        detail:
          'Expected instructions, which a secret credential given by hand takes: in Markdown, where the person makes the key, with a link to that page, the plan or role it needs, the permissions it needs and its format',
      },
      {
        pointer: '/credential/key_page',
        detail:
          'Expected key_page, which a secret credential given by hand takes: the https address of the page where the person makes the key',
      },
    ]);
  });

  it('is added with how its key is made beside the rest of its credential, which the fact keeps and the answer holds', async () => {
    const h = harness();
    const credential = { ...crm.credential, example: 'crm_…', pattern: '^crm_\\w+$' };

    const outcome = await adding(h, { ...crm, credential });
    const [fact] = await h.facts();

    expect(outcome).toMatchObject({ status: 'succeeded', output: { credential } });
    expect(fact).toMatchObject({ type: 'connection_added', data: { credential } });
  });
});

describe('how a key given by hand is made', () => {
  it('is refused where it is no Markdown of at most 1,000 characters without HTML, its page no https page, its example no example, or its pattern no pattern the runtime takes', async () => {
    const refused = await Promise.all(
      [
        { instructions: '<b>Settings</b>' },
        { instructions: 'a'.repeat(1001) },
        { key_page: 'http://crm.example.com/settings/keys' },
        { example: 'crm_4f9c2b1e8a7d' },
        { pattern: '^(crm|key)_\\w+$' },
      ].map(async (field: Readonly<Record<string, string>>) => issuesIn(await adding(harness(), withKey(field)))),
    );

    expect(refused.map((issues) => issues.map(({ pointer }) => pointer))).toEqual([
      ['/credential/instructions'],
      ['/credential/instructions'],
      ['/credential/key_page'],
      ['/credential/example'],
      ['/credential/pattern'],
    ]);
  });

  it('is said of a key alone, so a credential of another kind is refused it, consent given by hand in its own words', async () => {
    const consent = { name: 'files', type: 'mcp', entry: { url: 'https://files.example.com/mcp' } };

    const refused = [
      issuesIn(await adding(harness(), { ...notes, credential: { kind: 'none', ...crmKeyHelp } })),
      issuesIn(await adding(harness(), { ...consent, credential: { kind: 'authorization', example: 'fls_…' } })),
    ];

    expect(refused).toEqual([
      [
        {
          pointer: '/credential/instructions',
          detail: 'Expected no instructions: a none credential takes no other field',
        },
        { pointer: '/credential/key_page', detail: 'Expected no key_page: a none credential takes no other field' },
      ],
      [
        {
          pointer: '/credential/example',
          detail: "Expected no example: the person signs in at the server's authorization server, so no key is made",
        },
      ],
    ]);
  });
});

const IdentifiedSchema = Schema.Struct({ output: Schema.Struct({ id: Schema.String }) });

function outputOf(outcome: Outcome): unknown {
  return 'output' in outcome ? outcome.output : undefined;
}

function linkingOf(h: Harness) {
  const { registration } = operationNamed(h.operations, 'add_connection');
  return Option.getOrThrow(Option.fromNullishOr('link' in registration ? registration.link : undefined));
}

function answeredAfterTheLink(h: Harness, { id, url }: Added, input: unknown = notes, at?: string) {
  return h.call({ registration: linkingOf(h).answerAfter({ id, url }) }, ada, input, at);
}

describe('the answer to adding a connection after its link', () => {
  it('is read again by the id of the connection the link approves', async () => {
    const h = harness();
    const outcome = await adding(h, notes);

    expect(linkingOf(h).idOf(outputOf(outcome))).toBe(Schema.decodeUnknownSync(IdentifiedSchema)(outcome).output.id);
  });

  it('is the connection connected, with no link, once the person approved it', async () => {
    const h = harness();
    const link = await added(h, notes);
    await h.call(operationNamed(h.operations, 'approve'), ada, { id: link.id, token: link.token });

    const answer = await answeredAfterTheLink(h, link);

    expect(answer).toMatchObject({ status: 'succeeded', output: { id: link.id, status: 'connected' } });
    expect(answer).not.toHaveProperty('output.connect');
  });

  it('is the connection pending with its link, while the link lasts', async () => {
    const h = harness();
    const link = await added(h, notes);

    expect(await answeredAfterTheLink(h, link, notes, '2026-10-16T13:59:59.999Z')).toMatchObject({
      status: 'succeeded',
      output: { id: link.id, status: 'pending', connect: { url: link.url, expires_at: link.expiresAt } },
    });
  });
});

describe('the answer to adding a connection after its link is gone', () => {
  it('is the connection pending with no link, once its link has expired', async () => {
    const h = harness();
    const link = await added(h, notes);

    const answer = await answeredAfterTheLink(h, link, notes, link.expiresAt);

    expect(answer).toMatchObject({ status: 'succeeded', output: { status: 'pending' } });
    expect(answer).not.toHaveProperty('output.connect');
  });

  it('is the connection removed, with no link, once the person cancelled it on the page', async () => {
    const h = harness();
    const link = await added(h, notes);
    await h.call(operationNamed(h.operations, 'remove_connection'), ada, { id: link.id });

    const answer = await answeredAfterTheLink(h, link);

    expect(answer).toMatchObject({ status: 'succeeded', output: { status: 'removed' } });
    expect(answer).not.toHaveProperty('output.connect');
  });
});

describe('the read of a connection after its link', () => {
  it('reads the connection as it stands, the ending of its credential with it, and adds no other', async () => {
    const h = harness();
    const link = await added(h, crm);
    const credential = { id: link.id, token: link.token, value: 'Bearer crm-0123456789' };
    await h.call(operationNamed(h.operations, 'give_credential'), ada, credential);
    const facts = await h.facts();

    expect(await answeredAfterTheLink(h, link, crm)).toMatchObject({
      output: { status: 'connected', credential_ends_with: '6789' },
    });
    expect(await h.facts()).toEqual(facts);
  });
});

const sendingAVariable = connectionPolicyOf({ variables: ['NOTES_API_KEY'] });

const noteKeySet = new Map([['NOTES_API_KEY', Redacted.make('notes-key-5b2e9d')]]);

const fiveMinutesLater = '2026-10-15T14:05:00.000Z';

const newLinkExpires = '2026-10-16T14:05:00.000Z';

const reference = {
  ...notes,
  credential: { kind: 'reference', variable: 'NOTES_API_KEY', name: 'X-Api-Key', in: 'header' },
};

async function connectedReference(h: Harness): Promise<string> {
  const { id, token } = await added(h, reference);
  await h.call(operationNamed(h.operations, 'approve'), ada, { id, token });
  return id;
}

async function breaking(h: Harness, id: string): Promise<void> {
  const source = sourceOver(h, { policy: sendingAVariable, variables: noteKeySet });
  await Effect.runPromise((await preparedOf(source, id)).refused('The tool server answered HTTP 401'));
}

async function brokenReference(h: Harness): Promise<string> {
  const id = await connectedReference(h);
  await breaking(h, id);
  return id;
}

describe('reconnecting a connection of a reference its server refused', () => {
  it('connects it again at once, with no link, where the variable it sends is set, and it serves again', async () => {
    const h = harness({ policy: sendingAVariable, variables: noteKeySet });
    const id = await brokenReference(h);

    const reconnectedAgain = await reconnecting(h, id, fiveMinutesLater);

    expect(reconnectedAgain).toMatchObject({
      status: 'succeeded',
      output: { id, status: 'connected', broken: null, connected_at: fiveMinutesLater, connected_by: recordedAs.ada },
    });
    expect(reconnectedAgain).not.toHaveProperty('output.connect');
    expect((await h.facts()).at(-1)).toMatchObject({ type: 'connection_connected', data: { connection: id } });
    expect((await servedAs(sourceOver(h, { policy: sendingAVariable, variables: noteKeySet }), id)).state.status).toBe(
      'connected',
    );
  });

  it('is refused where the variable it sends is not set, saying whoever runs the runtime sets it', async () => {
    const h = harness({ policy: sendingAVariable });
    const id = await brokenReference(h);

    expect(await reconnecting(h, id)).toEqual({
      status: 'rejected',
      reason: 'conflict',
      detail: anyWords,
    });
  });
});

describe('reconnecting a connection of a reference its server refused while a link of it is open', () => {
  it('mends it in place all the same, which uses that link up', async () => {
    const h = harness({ policy: sendingAVariable, variables: noteKeySet });
    const id = await connectedReference(h);
    const { token } = await reconnected(h, id);
    await breaking(h, id);

    const mended = await reconnecting(h, id, fiveMinutesLater);

    expect(mended).toMatchObject({
      status: 'succeeded',
      output: { id, status: 'connected', broken: null, connected_at: fiveMinutesLater },
    });
    expect(mended).not.toHaveProperty('output.connect');
    expect(await h.call(operationNamed(h.operations, 'read_link'), ada, { id, token }, fiveMinutesLater)).toMatchObject(
      {
        reason: 'not_found',
        detail: anyWords,
      },
    );
  });
});

describe('reconnecting a connection of a reference that is not broken', () => {
  it('gives one pending and one connected a new link and grants nothing, as for any other kind', async () => {
    const h = harness({ policy: sendingAVariable, variables: noteKeySet });
    const { id: pending } = await added(h, { ...reference, name: 'drafts' });
    const connected = await connectedReference(h);

    const fromPending = await reconnecting(h, pending, fiveMinutesLater);
    const fromConnected = await reconnecting(h, connected, fiveMinutesLater);

    expect([fromPending, fromConnected]).toMatchObject([
      { status: 'succeeded', output: { id: pending, status: 'pending', connect: { expires_at: newLinkExpires } } },
      { status: 'succeeded', output: { id: connected, status: 'connected', connect: { expires_at: newLinkExpires } } },
    ]);
    expect((await h.facts()).slice(-2).map(({ type }) => type)).toEqual([
      'connection_link_issued',
      'connection_link_issued',
    ]);
  });
});
