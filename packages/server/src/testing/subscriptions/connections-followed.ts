import { ConnectionEventSchema, connectionsStreamOfOrg } from '@on.auto/connections';
import { streamSignalOf } from '@on.auto/ledger';
import type { Decided, Ledger } from '@on.auto/operations';
import { PlaybookEventSchema, playbooksStreamOfOrg } from '@on.auto/playbooks';
import { Effect, Function, Result } from 'effect';

import type { ServedSubscriptions } from '../../subscriptions/served-subscriptions.ts';

export type ConnectionFact = Decided<typeof ConnectionEventSchema.Type>;

const ada = { id: 'person:ada', name: 'Ada' };

const asGiven = {
  initialState: null,
  evolve: () => null,
  decide: <Fact>(facts: readonly Fact[]) => Result.succeed(facts),
  context: () => ({ at: '2026-11-20T09:00:00.000Z', by: ada.id }),
};

const versionRead = { initialState: null, evolve: () => null, eventSchema: ConnectionEventSchema };

type PlaybookFact = Decided<typeof PlaybookEventSchema.Type>;

function createdOf(playbook: string): PlaybookFact {
  return { type: 'playbook_created', data: { playbook, name: playbook, description: '', created_by: ada } };
}

function playbookFactsRecorded(ledger: Ledger['Service'], org: string, facts: readonly PlaybookFact[]): Promise<void> {
  const decider = { ...asGiven, eventSchema: PlaybookEventSchema };
  return Effect.runPromise(Effect.asVoid(Effect.orDie(ledger.execute(playbooksStreamOfOrg(org), decider, facts))));
}

export function playbooksCreated(ledger: Ledger['Service'], org: string, playbooks: readonly string[]): Promise<void> {
  return playbookFactsRecorded(
    ledger,
    org,
    playbooks.map((playbook) => createdOf(playbook)),
  );
}

export function playbooksRetired(ledger: Ledger['Service'], org: string, playbooks: readonly string[]): Promise<void> {
  return playbookFactsRecorded(
    ledger,
    org,
    playbooks.map((playbook) => ({ type: 'playbook_retired', data: { playbook } })),
  );
}

export function connectionsRecorded(
  ledger: Ledger['Service'],
  org: string,
  facts: readonly ConnectionFact[],
): Promise<void> {
  const decider = { ...asGiven, eventSchema: ConnectionEventSchema };
  return Effect.runPromise(Effect.asVoid(Effect.orDie(ledger.execute(connectionsStreamOfOrg(org), decider, facts))));
}

export function connectedOf(connection: string): ConnectionFact {
  return { type: 'connection_connected', data: { connection, secret_id: `token-${connection}`, connected_by: ada } };
}

/** A connection of a provider's entry added under its name, with a key, and connected. */
export function addedAndConnected(connection: string, provider: string, url: string): readonly ConnectionFact[] {
  const credential = { kind: 'secret', name: 'Authorization', in: 'header', scheme: 'Bearer' } as const;
  return [
    {
      type: 'connection_added',
      data: {
        connection,
        name: provider,
        server_type: 'mcp',
        provider,
        placeholders: null,
        entry: { url },
        credential,
        says: {},
        added_by: ada,
      },
    },
    connectedOf(connection),
  ];
}

/** The org's registry as `orgStreams` lists it: the org and the version of its connections stream. */
export function registryListedIn(ledger: Ledger['Service'], org: string) {
  return () =>
    Effect.runPromise(
      Effect.map(ledger.load(connectionsStreamOfOrg(org), versionRead), ({ version }) => [{ org, version }]),
    );
}

/**
 * The server's subscriptions following an org's connections: each wake-up the composition registers woken at a moment,
 * then the subscription rounds due then performed; and a change of the org's connections recorded and signalled.
 */
export function followedBy(rounds: ServedSubscriptions, ledger: Ledger['Service'], org: string) {
  const appended = streamSignalOf();
  const signal = { raised: Function.constVoid, renewed: Function.constVoid };
  const streams = { orgStreams: registryListedIn(ledger, org) };
  const wakeUps = rounds.wakeUpsOver({ streams, appended }).map((wakeUpWith) => wakeUpWith(signal));
  const wokenAt = async (now: number): Promise<void> => {
    await Effect.runPromise(Effect.forEach(wakeUps, ({ wakeUp }) => wakeUp({ now, sweep: false }), { discard: true }));
    const items = await Effect.runPromise(rounds.dueWork.due(now, 16, true));
    await Effect.runPromise(Effect.forEach(items, (item) => item.perform(now), { discard: true }));
  };
  const changed = async (facts: readonly ConnectionFact[]): Promise<void> => {
    await connectionsRecorded(ledger, org, facts);
    appended.raise(connectionsStreamOfOrg(org));
  };
  return { wokenAt, changed };
}
