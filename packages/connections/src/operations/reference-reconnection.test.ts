import { Effect, Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { connectionPolicyOf } from '../policy/connection-policy.ts';
import { added, notes, reconnecting } from '../testing/additions.ts';
import { ada, harness, operationNamed, recordedAs, type Harness } from '../testing/harness.ts';
import { preparedOf, servedAs, sourceOver } from '../testing/served-connections.ts';

const sendingAVariable = connectionPolicyOf({ variables: ['NOTES_API_KEY'] });

const noteKeySet = new Map([['NOTES_API_KEY', Redacted.make('notes-key-5b2e9d')]]);

const fiveMinutesLater = '2026-10-15T14:05:00.000Z';

const elevenMinutesLater = '2026-10-15T14:11:00.000Z';

const newLinkExpires = '2026-10-15T14:21:00.000Z';

const reference = {
  ...notes,
  credential: { kind: 'reference', variable: 'NOTES_API_KEY', name: 'X-Api-Key', in: 'header' },
};

async function connectedReference(h: Harness): Promise<string> {
  const { id, token } = await added(h, reference);
  await h.call(operationNamed(h.operations, 'approve'), ada, { id, token });
  return id;
}

async function brokenReference(h: Harness): Promise<string> {
  const id = await connectedReference(h);
  const source = sourceOver(h, { policy: sendingAVariable, variables: noteKeySet });
  await Effect.runPromise((await preparedOf(source, id)).refused);
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
      detail:
        'The variable NOTES_API_KEY that the connection notes sends is not set on this runtime; whoever runs it sets the variable and starts it again',
    });
  });
});

describe('reconnecting a connection of a reference that is not broken', () => {
  it('gives one pending whose link ran out, and one connected, a new link and grants nothing, as for any other kind', async () => {
    const h = harness({ policy: sendingAVariable, variables: noteKeySet });
    const { id: pending } = await added(h, { ...reference, name: 'drafts' });
    const connected = await connectedReference(h);

    const fromPending = await reconnecting(h, pending, elevenMinutesLater);
    const fromConnected = await reconnecting(h, connected, elevenMinutesLater);

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
