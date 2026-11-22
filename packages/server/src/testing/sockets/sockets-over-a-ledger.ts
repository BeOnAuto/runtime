import { ConnectionEventSchema, connectionsStreamOfOrg, eventSubscriptions } from '@on.auto/connections';
import { wakesHeard } from '@on.auto/interaction/testing';
import { streamSignalOf } from '@on.auto/ledger';
import { memoryLedger } from '@on.auto/operations/testing';
import { Effect, Redacted, Result, type Context } from 'effect';

import { socketWakeUpOf, type SocketParts } from '../../sockets/served-sockets.ts';
import { subscriptionsServedBy } from '../../subscriptions/served-subscriptions.ts';
import { playbooksCreated, playbooksRetired } from '../subscriptions/connections-followed.ts';
import {
  answeringBy,
  connectedAt,
  noSecretsKept,
  socketProviders,
  type Fact,
  type ServiceAnswer,
} from './held-sockets.ts';
import { ServiceSockets } from './service-sockets.ts';

type TakeIn = SocketParts['takeIn'];

type Arrival = Parameters<TakeIn>[0];

function recordedAt(at: string) {
  return {
    initialState: null,
    evolve: () => null,
    eventSchema: ConnectionEventSchema,
    decide: (facts: readonly Fact[]) => Result.succeed(facts),
    context: () => ({ at, by: 'person:ada' }),
  };
}

const typesOfTheFacts = {
  initialState: [],
  evolve: (types: readonly string[], { type }: { readonly type: string }) => [...types, type],
  eventSchema: ConnectionEventSchema,
};

const theIdentified = {
  initialState: [],
  evolve: (identified: readonly object[], fact: typeof ConnectionEventSchema.Type) =>
    fact.type === 'connection_identified' ? [...identified, fact.data] : identified,
  eventSchema: ConnectionEventSchema,
};

function stateOf<State>({ state }: { readonly state: State }): State {
  return state;
}

const taken: ReturnType<TakeIn> = Effect.succeed({ outcome: 'taken' });

/**
 * The socket set of a server over a ledger in memory: the registries of its orgs, the playbooks of each, the wakes
 * and the intake it hands each message to, each kept in order, and the service asked who a connection is.
 */
export class SocketsOverALedger extends ServiceSockets {
  readonly ledger = memoryLedger(undefined, [eventSubscriptions]).service;
  readonly wakes = wakesHeard();
  readonly appended = streamSignalOf();
  readonly loads: string[] = [];
  readonly handed: Arrival[] = [];
  readonly happened: string[] = [];
  readonly asked: string[] = [];
  readonly answers = new Map<string, ServiceAnswer>();
  readonly lateBy = new Map<string, number>();
  readonly #orgs = new Set<string>();
  #intake: readonly ReturnType<TakeIn>[] = [];
  #raised = 0;
  #listingFails = false;

  readonly forgotten = (org: string): void => {
    this.#orgs.delete(org);
  };

  readonly listingFails = (failing: boolean): void => {
    this.#listingFails = failing;
  };

  /** The intake answers each arrival in turn as given, and takes each one after them. */
  readonly takesInAs = (...answers: readonly ReturnType<TakeIn>[]): void => {
    this.#intake = answers;
  };

  readonly handedTo = (): readonly (readonly [string, string, string])[] =>
    this.handed.map(({ playbook, connection }) => [playbook.org, playbook.playbook, connection]);

  readonly recorded = (org: string, facts: readonly Fact[], at = connectedAt): Effect.Effect<void> =>
    Effect.andThen(
      Effect.sync(() => this.#orgs.add(org)),
      Effect.asVoid(Effect.orDie(this.ledger.execute(connectionsStreamOfOrg(org), recordedAt(at), facts))),
    );

  readonly identifiedIn = (org: string): Effect.Effect<readonly object[]> =>
    Effect.map(this.ledger.load(connectionsStreamOfOrg(org), theIdentified), stateOf);

  readonly playbooksMade = (org: string, playbooks: readonly string[], retired: readonly string[] = []) =>
    Effect.promise(async () => {
      await playbooksCreated(this.ledger, org, [...playbooks, ...retired]);
      await playbooksRetired(this.ledger, org, retired);
    });

  readonly typesIn = (org: string): Effect.Effect<readonly string[]> =>
    Effect.map(this.ledger.load(connectionsStreamOfOrg(org), typesOfTheFacts), stateOf);

  readonly raised = (): number => this.#raised;

  readonly started = (context: Context.Context<never>) =>
    socketWakeUpOf({
      streams: {
        orgStreams: () =>
          this.#listingFails ? Promise.reject(new Error('the ledger is down')) : Effect.runPromise(this.#listed()),
      },
      registries: { registry: { load: this.#load, execute: this.ledger.execute }, providers: socketProviders },
      secrets: { read: this.#secret },
      opens: this.opens,
      wake: (woken, now) =>
        woken.conversation === 'broken'
          ? Effect.die(new Error('the ledger is down'))
          : Effect.andThen(
              Effect.sync(() => this.happened.push('woken')),
              this.wakes.wake(woken, now),
            ),
      takeIn: this.#takeIn,
      identities: this.#identities.identities,
      appended: this.appended,
      context,
    })({
      raised: () => {
        this.#raised += 1;
      },
      renewed: () => {
        this.#raised += 0;
      },
    });

  readonly #takeIn: TakeIn = (arrival) =>
    Effect.suspend(() => {
      const answer = this.#intake[this.handed.length] ?? taken;
      this.handed.push(arrival);
      this.happened.push('taken in');
      return answer;
    });

  readonly #identities = subscriptionsServedBy({
    ledger: this.ledger,
    tools: answeringBy({
      answers: this.answers,
      lateBy: this.lateBy,
      asked: (connection) => {
        this.asked.push(connection);
      },
    }),
    secrets: noSecretsKept,
    providers: socketProviders,
    receivesOverHttp: false,
    opensSockets: true,
  });

  readonly #load: SocketParts['registries']['registry']['load'] = (stream, fold) =>
    Effect.andThen(
      Effect.sync(() => this.loads.push(stream)),
      this.ledger.load(stream, fold),
    );

  readonly #secret: SocketParts['secrets']['read'] = (id) => {
    const kept = { value: Redacted.make(`xapp-${id}`), version: 1, claimedUntil: undefined };
    const answers = new Map<string, ReturnType<SocketParts['secrets']['read']>>([
      ['gone', Effect.undefined],
      ['unreadable', Effect.fail({ _tag: 'secret_key_unknown', kid: 'k1', detail: 'unknown key' })],
    ]);
    return answers.get(id) ?? Effect.succeed(kept);
  };

  #listed() {
    return Effect.forEach([...this.#orgs].toSorted(), (org) =>
      Effect.map(this.ledger.load(connectionsStreamOfOrg(org), recordedAt(connectedAt)), ({ version }) => ({
        org,
        version,
      })),
    );
  }
}
