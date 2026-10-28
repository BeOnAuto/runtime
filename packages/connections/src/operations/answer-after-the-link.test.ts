import type { Outcome, Succeeded } from '@on.auto/operations';
import { Option, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { added, adding, crm, notes, type Added } from '../testing/additions.ts';
import { ada, harness, operationNamed, type Harness } from '../testing/harness.ts';

const IdentifiedSchema = Schema.Struct({ output: Schema.Struct({ id: Schema.String }) });

function outputOf(outcome: Outcome<Succeeded>): unknown {
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
