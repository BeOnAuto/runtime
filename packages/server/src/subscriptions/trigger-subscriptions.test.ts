import { eventSubscriptions, subscriptionLoopPortsOf, subscriptionRecordsOf } from '@on.auto/connections';
import { decidedIn, definitionNamesWith, definitionsReadModelOf } from '@on.auto/definitions/testing';
import { memoryLedgerWith } from '@on.auto/operations/testing';
import {
  providersShippedRoots,
  readProviders,
  subscriptionLoopOf,
  type LoopConnection,
  type ProviderList,
  type ThroughTheConnection,
} from '@on.auto/providers';
import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import { Effect, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { subscriptionLoopPartsOf, subscriptionsServingOf } from './served-subscriptions.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const theRepository = 'octo-org/approvals';

const opened = 'com.github.issues.opened';

const listeningForIssues = {
  kind: 'event',
  reference: '/schedule/on',
  filters: [
    {
      reference: '/schedule/on/one',
      type: opened,
      attributes: { type: opened, source: '/connections/github', subject: theRepository },
    },
  ],
} as const;

const ada = { id: 'person:ada', name: 'Ada' };

function aSavedTrigger() {
  const ledger = memoryLedgerWith({
    projections: [...definitionsReadModelOf(['workflow']), eventSubscriptions],
    definitionNames: definitionNamesWith([]),
  }).service;
  const saved = {
    type: 'create',
    name: 'triage',
    content: { source: 'triage', triggers: [listeningForIssues] },
    created_by: ada,
    definition_id: 'triage-id',
    by: ada.id,
    at: '2026-11-20T09:00:00.000Z',
  } as const;
  return Effect.runPromise(Effect.as(decidedIn(ledger, alpha, 'workflow', saved), ledger));
}

function aServiceThatSubscribes() {
  const sent: string[] = [];
  const tools: ThroughTheConnection = {
    callOnce: () => Effect.die('a call was sent'),
    requestOnce: ({ method, url }) =>
      Effect.sync(() => {
        sent.push(`${method} ${url}`);
        return { kind: 'answered', outcome: 'result', answer: { id: 480_932_108 } } as const;
      }),
    mostRequestBytesTo: () => 1_048_576,
  };
  const secrets = {
    keep: () => Effect.succeed('secret-1'),
    read: () => Effect.die('a secret was read'),
    forget: () => Effect.die('a secret was forgotten'),
  };
  return { tools, secrets, sent };
}

function aConnectionOf(providers: ProviderList, name: string): readonly LoopConnection[] {
  return providers.providers.flatMap(({ entry }) =>
    entry.name === name ? [{ connection: name, destinations: entry.events?.destinations ?? [] }] : [],
  );
}

describe('a saved workflow whose trigger names a connection, on a runtime given WEBHOOK_URL', () => {
  it('has the round the server composes subscribe once at the service, for the place the trigger names, with no request waiting', async () => {
    const ledger = await aSavedTrigger();
    const providers = Result.getOrThrow(await readProviders(shippedFilesOnDisk(providersShippedRoots())));
    const { tools, secrets, sent } = aServiceThatSubscribes();
    const receiving = { overHttp: true, webhookUrl: 'https://events.example.com' };
    const ports = subscriptionLoopPortsOf(
      subscriptionLoopPartsOf(subscriptionsServingOf(ledger, { providers, receiving }, { tools, secrets })),
    );
    const round = subscriptionLoopOf({
      ...ports,
      connectionsOf: () => Effect.succeed(aConnectionOf(providers, 'github')),
    });
    await Effect.runPromise(round(alpha));
    await Effect.runPromise(round(alpha));

    expect(sent).toEqual([`POST https://api.github.com/repos/${theRepository}/hooks`]);
    expect(await Effect.runPromise(subscriptionRecordsOf(ledger).read(alpha))).toMatchObject([
      { connection: 'github', topic: theRepository, made: { id: '480932108' } },
    ]);
  });
});
