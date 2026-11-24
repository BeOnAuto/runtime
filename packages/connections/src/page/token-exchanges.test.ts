import { asAManagedServiceAccount, asTheCompanysServiceAccount } from '@on.auto/providers/testing';
import { Struct } from 'effect';
import { describe, expect, it } from 'vitest';

import { added } from '../testing/additions.ts';
import {
  addedThe,
  byItsId,
  exchanging,
  onTheLink,
  reachedAtFirst,
  sameLedgerWith,
} from '../testing/exchange-harness.ts';
import {
  emailOf,
  exchangeProvidersWith,
  fakeSubjectTokens,
  issuer,
  listingOf,
  managedWay,
  ownValues,
  ownWay,
  tokenEndpoint,
} from '../testing/exchanges.ts';

const anyWords: unknown = expect.any(String);

const unchecked = Struct.omit(asTheCompanysServiceAccount, ['test']);

describe('the approval of a connection that acts as a service account Auto created', () => {
  it('gets a token signed for the organization, lists what the connection reaches, and records it connected', async () => {
    const { h, tokens, exchange, reads } = exchanging();
    const link = await addedThe(h, managedWay);
    await onTheLink(h, 'create_service_account', link);

    expect(await onTheLink(h, 'approve', link)).toMatchObject({
      status: 'succeeded',
      output: { status: 'connected', service_account: { email: emailOf(link.id) }, reached: reachedAtFirst },
    });
    expect(tokens.signed()).toEqual([
      { org: 'acme', audience: 'https://identity.mail.example.com/projects/566645377701/pools/auto/providers/auto' },
    ]);
    expect(exchange.asked()).toEqual([
      tokenEndpoint,
      `https://credentials.mail.example.com/v1/accounts/${emailOf(link.id)}:token`,
    ]);
    expect(reads.read().map(([call]) => call)).toEqual([
      { org: 'acme', reference: { server: 'mail', tool: 'mailboxes_list' }, meta: {} },
    ]);
  });

  it('asks the signer the call binds, where it binds one, in place of the one Auto was composed with', async () => {
    const ofTheCall = fakeSubjectTokens();
    const { h, tokens } = exchanging({ callSubjectTokens: ofTheCall.tokens });
    const link = await addedThe(h, managedWay);
    await onTheLink(h, 'create_service_account', link);

    expect(await onTheLink(h, 'approve', link)).toMatchObject({ status: 'succeeded', output: { status: 'connected' } });
    expect([ofTheCall.signed().map(({ org }) => org), tokens.signed()]).toEqual([['acme'], []]);
  });

  it('is refused before any token is asked while the account is not created', async () => {
    const { h, exchange } = exchanging();
    const link = await addedThe(h, managedWay);

    expect(await onTheLink(h, 'approve', link)).toMatchObject({ status: 'rejected', reason: 'conflict' });
    expect(exchange.asked()).toEqual([]);
  });
});

describe('an approval of a connection that exchanges a token, which records nothing', () => {
  it.each([
    ['the service refuses the token', 'refused', 'invalid_input'],
    ['the service does not answer', 'down', 'unavailable'],
  ] as const)('answers so where %s', async (_named, answer, reason) => {
    const { h, exchange, reads } = exchanging();
    const link = await addedThe(h, ownWay, { placeholders: ownValues });
    exchange.answerWith(answer);

    expect(await onTheLink(h, 'approve', link)).toMatchObject({ status: 'rejected', reason, detail: anyWords });
    expect(reads.read()).toEqual([]);
    expect((await h.facts()).map(({ type }) => type)).toEqual(['connection_added', 'connection_link_issued']);
  });

  it('answers unavailable where the check ends any other way than in a result', async () => {
    const { h, reads } = exchanging();
    reads.answerWith({ kind: 'unopened', refused: 'tool_server_failed', because: 'unreachable', detail: 'down' });
    const link = await addedThe(h, ownWay, { placeholders: ownValues });

    expect(await onTheLink(h, 'approve', link)).toMatchObject({ status: 'rejected', reason: 'unavailable' });
  });
});

describe('an approval of a connection that reaches nothing yet', () => {
  it('records nothing for a service account Auto created, and records the company’s own', async () => {
    const managed = exchanging();
    managed.reads.answerWith(listingOf());
    const managedLink = await addedThe(managed.h, managedWay);
    await onTheLink(managed.h, 'create_service_account', managedLink);
    const own = exchanging();
    own.reads.answerWith(listingOf());
    const ownLink = await addedThe(own.h, ownWay, { placeholders: ownValues });

    expect([
      await onTheLink(managed.h, 'approve', managedLink),
      await onTheLink(own.h, 'approve', ownLink),
    ]).toMatchObject([
      { status: 'rejected', reason: 'conflict', detail: anyWords },
      { status: 'succeeded', output: { status: 'connected', reached: [] } },
    ]);
    expect((await managed.h.facts()).map(({ type }) => type)).not.toContain('connection_connected');
  });
});

describe('an approval of a connection whose way declares no check', () => {
  it('records it once the token is had, and answers no reached', async () => {
    const { h, reads } = exchanging({ providers: exchangeProvidersWith(unchecked, asAManagedServiceAccount) });
    const link = await addedThe(h, ownWay, { placeholders: ownValues });

    const approved = await onTheLink(h, 'approve', link);

    expect(approved).toMatchObject({ status: 'succeeded', output: { status: 'connected' } });
    expect(approved).not.toHaveProperty(['output', 'reached']);
    expect(reads.read()).toEqual([]);
  });
});

describe('an approval at an Auto that signs no tokens', () => {
  it('is refused, and asks nothing', async () => {
    const made = exchanging();
    const link = await addedThe(made.h, ownWay, { placeholders: ownValues });

    expect(await onTheLink(sameLedgerWith(made, {}, ['subjectTokens']), 'approve', link)).toMatchObject({
      status: 'rejected',
      reason: 'conflict',
    });
    expect(made.exchange.asked()).toEqual([]);
  });

  it('is refused where its call binds a signer, which is asked nothing', async () => {
    const made = exchanging();
    const link = await addedThe(made.h, ownWay, { placeholders: ownValues });
    const ofTheCall = fakeSubjectTokens();
    const bound = sameLedgerWith(made, { callSubjectTokens: ofTheCall.tokens }, ['subjectTokens']);

    expect(await onTheLink(bound, 'approve', link)).toMatchObject({ status: 'rejected', reason: 'conflict' });
    expect([ofTheCall.signed(), made.exchange.asked()]).toEqual([[], []]);
  });
});

describe('an approval with a check of its own arguments, whose credential the service refuses', () => {
  it('calls the check with the arguments the way declares, reads the refusal as reaching nothing, and answers no token', async () => {
    const checking = { ...asTheCompanysServiceAccount.test, with: { page_size: 2 } };
    const providers = exchangeProvidersWith(
      { ...asTheCompanysServiceAccount, test: checking },
      asAManagedServiceAccount,
    );
    const { h, reads, tokens } = exchanging({ providers });
    reads.answerWith('refused');
    const link = await addedThe(h, ownWay, { placeholders: ownValues });

    const approved = await onTheLink(h, 'approve', link);
    const written = JSON.stringify([approved, await h.facts(), h.logged()]);

    expect(approved).toMatchObject({ status: 'succeeded', output: { reached: [] } });
    expect(reads.read().map(([call]) => call.input)).toEqual([{ page_size: 2 }]);
    expect(tokens.issued().filter((token) => written.includes(token))).toEqual([]);
  });
});

describe('a connection of the company’s own service account added with none of its values', () => {
  it('is added with its link, and approved once its page gives them by choose_way', async () => {
    const { h, exchange } = exchanging();
    const link = await addedThe(h, ownWay);

    expect((await h.facts())[0]?.data).toMatchObject({ placeholders: {}, credential: { kind: 'token_exchange' } });
    expect(await onTheLink(h, 'approve', link)).toMatchObject({ status: 'rejected', reason: 'invalid_input' });
    expect(exchange.asked()).toEqual([]);
    expect(await onTheLink(h, 'choose_way', link, { credential: ownWay, placeholders: ownValues })).toMatchObject({
      status: 'succeeded',
      output: { placeholders: ownValues },
    });
    expect(await onTheLink(h, 'approve', link)).toMatchObject({ status: 'succeeded', output: { status: 'connected' } });
  });

  it('is chosen in place of Auto’s service account with none of its values, and refused with some of them', async () => {
    const { h } = exchanging();
    const link = await addedThe(h, managedWay);

    expect([
      await onTheLink(h, 'choose_way', link, { credential: ownWay, placeholders: { project: ownValues.project } }),
      await onTheLink(h, 'choose_way', link, { credential: ownWay, placeholders: {} }),
    ]).toMatchObject([
      { status: 'rejected', reason: 'invalid_input' },
      { status: 'succeeded', output: { credential: { kind: 'token_exchange' }, placeholders: {} } },
    ]);
  });
});

describe('an approval of a connection whose values no longer fit its way', () => {
  it('is refused, and asks nothing', async () => {
    const made = exchanging();
    const link = await addedThe(made.h, ownWay, { placeholders: ownValues });
    const project = {
      ...asTheCompanysServiceAccount.placeholders.project,
      pattern: '^[a-z]{6,20}$',
      example: 'acmemail',
    };
    const narrowed = {
      ...asTheCompanysServiceAccount,
      placeholders: { ...asTheCompanysServiceAccount.placeholders, project },
    };
    const later = sameLedgerWith(made, { providers: exchangeProvidersWith(narrowed) });

    expect(await onTheLink(later, 'approve', link)).toMatchObject({ status: 'rejected', reason: 'invalid_input' });
    expect(made.exchange.asked()).toEqual([]);
  });
});

describe('the link of a connection that exchanges a token, by read_link', () => {
  it('names the issuer and the subject its steps name, where the issuer publishes its keys, and a file to upload', async () => {
    const { h } = exchanging();
    const own = await addedThe(h, ownWay, { placeholders: ownValues });

    expect(await onTheLink(h, 'read_link', own)).toMatchObject({
      output: {
        subject_token: { issuer, subject: 'acme', jwks_uri: `${issuer}/.well-known/jwks.json`, jwk_file: true },
      },
    });
  });

  it('names a key set the service reads at its address, where the service reaches this Auto', async () => {
    const { h } = exchanging({ subjectTokens: fakeSubjectTokens(false) });
    const own = await addedThe(h, ownWay, { placeholders: ownValues });

    expect(await onTheLink(h, 'read_link', own)).toMatchObject({ output: { subject_token: { jwk_file: false } } });
  });

  it('names nothing of a token where this Auto signs none', async () => {
    const made = exchanging();
    const own = await addedThe(made.h, ownWay, { placeholders: ownValues });

    const read = await onTheLink(sameLedgerWith(made, {}, ['subjectTokens']), 'read_link', own);

    expect(read).toMatchObject({ status: 'succeeded' });
    expect(read).not.toHaveProperty(['output', 'subject_token']);
  });
});

describe('the test of a connected connection that exchanges a token, by test_connection', () => {
  it('answers what it reaches and records nothing', async () => {
    const { h } = exchanging();
    const link = await addedThe(h, ownWay, { placeholders: ownValues });
    await onTheLink(h, 'approve', link);
    const recorded = (await h.facts()).length;

    expect(await byItsId(h, 'test_connection', link)).toEqual({
      status: 'succeeded',
      output: { reached: reachedAtFirst },
    });
    expect(await h.facts()).toHaveLength(recorded);
  });

  it('answers an empty list where its way declares no check', async () => {
    const { h } = exchanging({ providers: exchangeProvidersWith(unchecked) });
    const link = await addedThe(h, ownWay, { placeholders: ownValues });
    await onTheLink(h, 'approve', link);

    expect(await byItsId(h, 'test_connection', link)).toMatchObject({ status: 'succeeded', output: { reached: [] } });
  });

  it('is refused for a connection not connected yet, and one of another kind', async () => {
    const { h } = exchanging();
    const pending = await addedThe(h, ownWay, { placeholders: ownValues });
    const other = await added(h, {
      name: 'notes',
      type: 'mcp',
      entry: { url: 'https://notes.example.com/mcp' },
      credential: { kind: 'none' },
    });

    expect([await byItsId(h, 'test_connection', pending), await byItsId(h, 'test_connection', other)]).toMatchObject([
      { status: 'rejected', reason: 'conflict' },
      { status: 'rejected', reason: 'conflict' },
    ]);
  });
});
