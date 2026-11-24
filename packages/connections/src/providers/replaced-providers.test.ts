import { roleRefusalDetail, type CallerIdentity, type Outcome } from '@on.auto/operations';
import { messages, providersOf, tracker } from '@on.auto/providers/testing';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeProviderOffering } from '../index.ts';
import type { StartsRuled } from '../policy/connection-starts.ts';
import { issuesIn } from '../testing/additions.ts';
import { startedByAdminsOf } from '../testing/connection-starts.ts';
import {
  ada,
  connectionServicesWith,
  connectionsManagedBy,
  grace,
  harness,
  operationNamed,
} from '../testing/harness.ts';
import { replacingFiles, replacingPolicy } from '../testing/replacements.ts';

const replacedHere = 'The provider files is replaced here by messages, which a connection is added from instead';

describe('a provider another provider of the list replaces', () => {
  it('is listed with no way offered, saying which provider replaces it, beside the one that replaces it, which names it', async () => {
    const { h, after } = replacingFiles();

    const listed = await h.call(operationNamed(after, 'list_providers'), ada);

    expect(listed).toMatchObject({
      output: {
        providers: [
          { name: 'files', credentials: [{ kind: 'authorization', offered: false, because: replacedHere }] },
          { name: 'messages', replaces: ['files'], credentials: [{ offered: true, client_source: 'gateway' }] },
        ],
      },
    });
  });

  it('is left out of the providers a person may connect, which search offers', async () => {
    const { h, providers } = replacingFiles();
    const services = connectionServicesWith({ providers, policy: replacingPolicy, consent: h.consent });

    const offered = await Effect.runPromise(makeProviderOffering(services)(ada));

    expect(offered?.map(({ name }) => name)).toEqual(['messages']);
  });

  it('is not added from: the addition is refused at the provider, naming the one that replaces it, and records nothing', async () => {
    const { h, after } = replacingFiles();

    const outcome = await h.call(operationNamed(after, 'add_connection'), ada, { provider: 'files' });

    expect(issuesIn(outcome)).toEqual([{ pointer: '/provider', detail: replacedHere }]);
    expect(await h.facts()).toEqual([]);
  });
});

const viewer: CallerIdentity = { ...ada, id: 'person:viewer', name: 'Viewer', permissions: ['org:read'] };

const aKey: CallerIdentity = { ...ada, id: 'acme-key', name: 'acme-key' };

const replacingTracker = providersOf(tracker, { ...messages, replaces: ['tracker'] });

const replacingNone = providersOf(tracker, messages);

const ruledForEvery: StartsRuled = () => true;

const ruledForNone: StartsRuled = () => false;

const ListedReconnectingSchema = Schema.Struct({
  output: Schema.Struct({
    providers: Schema.Array(
      Schema.Struct({
        name: Schema.String,
        may_reconnect: Schema.optionalKey(Schema.Boolean),
        reconnect_refusal: Schema.optionalKey(Schema.String),
      }),
    ),
  }),
});

const reconnectingListed = (outcome: Outcome) =>
  Schema.decodeUnknownSync(ListedReconnectingSchema)(outcome).output.providers;

interface Listing {
  readonly providers: ReturnType<typeof providersOf>;
  readonly startsRuledFor?: StartsRuled;
}

async function listedTo(caller: CallerIdentity, listing: Listing): Promise<Outcome> {
  const host = startedByAdminsOf('messages', []);
  const h = harness({ ...listing, decidedBy: connectionsManagedBy('grace'), starts: host.starts });
  const listed = await h.call(operationNamed(h.operations, 'list_providers'), caller);
  expect(host.asked()).toEqual([]);
  return listed;
}

describe('the provider that replaces another, as list_providers answers it to each caller', () => {
  it.each([
    ['an admin, whom the decision point lets manage connections', grace, { may_reconnect: true }],
    ['an editor, whom it does not', ada, { may_reconnect: false, reconnect_refusal: roleRefusalDetail }],
    ['a viewer, whom it does not', viewer, { may_reconnect: false, reconnect_refusal: roleRefusalDetail }],
    ['a key, which reconnects no connection', aKey, { may_reconnect: false, reconnect_refusal: roleRefusalDetail }],
  ] as const)(
    'tells %s, where the host rules who connects it, from the decision point alone, the host asked nothing',
    async (_, caller, said) => {
      const listed = await listedTo(caller, { providers: replacingTracker, startsRuledFor: ruledForEvery });

      expect(reconnectingListed(listed)).toEqual([{ name: 'tracker' }, { name: 'messages', ...said }]);
    },
  );

  it.each([
    ['the host rules no provider', { providers: replacingTracker, startsRuledFor: ruledForNone }],
    ['the host composes no rule', { providers: replacingTracker }],
    ['no provider replaces another', { providers: replacingNone, startsRuledFor: ruledForEvery }],
  ] as const)('says nothing of who reconnects where %s', async (_, listing) => {
    const listings = await Promise.all([grace, ada].map((caller) => listedTo(caller, listing)));

    expect(listings.map((listed) => reconnectingListed(listed))).toEqual(
      [0, 1].map(() => [{ name: 'tracker' }, { name: 'messages' }]),
    );
  });
});
