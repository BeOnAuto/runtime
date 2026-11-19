import { ConnectionEventSchema, connectionsStreamOfOrg } from '@on.auto/connections';
import { wakesHeard } from '@on.auto/interaction/testing';
import { streamSignalOf } from '@on.auto/ledger';
import type { Decided, StreamReader } from '@on.auto/operations';
import { memoryLedger } from '@on.auto/operations/testing';
import { SocketEnded, type OpensASocket, type SocketFrame, type SocketOpening } from '@on.auto/providers';
import { ledgers, overASocket, providersOf, trackerOverASocket } from '@on.auto/providers/testing';
import { Effect, Function, Option, Queue, Redacted, Result, Struct, type Context } from 'effect';

import { socketWakeUpOf, type SocketParts } from '../../sockets/served-sockets.ts';

export type Fact = Decided<typeof ConnectionEventSchema.Type>;

export const failureCodes = { succeeded: '/ok', code: '/error', key_refused: ['invalid_auth'] };

const [aKey] = trackerOverASocket.credentials;

const providers = providersOf(
  { ...trackerOverASocket, events: { destinations: [overASocket] } },
  {
    ...Struct.omit(ledgers, ['headers', 'placeholders']),
    base_url: 'https://api.ledgers.example.com/v2',
    credentials: [aKey],
    events: { destinations: [overASocket] },
    failure_codes: failureCodes,
  },
);

const recordedAt = {
  initialState: null,
  evolve: () => null,
  eventSchema: ConnectionEventSchema,
  decide: (facts: readonly Fact[]) => Result.succeed(facts),
  context: () => ({ at: '2026-11-19T08:00:00.000Z', by: 'person:ada' }),
};

const typesOfTheFacts = {
  initialState: [],
  evolve: (types: readonly string[], { type }: { readonly type: string }) => [...types, type],
  eventSchema: ConnectionEventSchema,
};

function stateOf({ state }: { readonly state: readonly string[] }): readonly string[] {
  return state;
}

export function heldBy(connection: string, appSecretId?: string, provider = 'tracker'): readonly Fact[] {
  return [
    {
      type: 'connection_added',
      data: {
        connection,
        name: `chat-${connection}`,
        server_type: 'mcp',
        provider,
        placeholders: null,
        entry: { url: 'https://tracker.example.com/mcp' },
        credential: { kind: 'secret', name: 'Authorization', in: 'header' },
        says: {},
        added_by: { id: 'person:ada', name: 'Ada' },
      },
    },
    {
      type: 'connection_connected',
      data: {
        connection,
        secret_id: `key-${connection}`,
        app_secret_ids: appSecretId === undefined ? {} : { app_level_token: appSecretId },
        connected_by: { id: 'person:ada', name: 'Ada' },
      },
    },
  ];
}

export function inTheChannel(channel: string): object {
  return {
    type: 'events_api',
    envelope_id: `e-${channel}`,
    payload: { team_id: 'T1', event: { channel, user: 'U1' } },
  };
}

export class SocketsOverALedger {
  readonly ledger = memoryLedger().service;
  readonly wakes = wakesHeard();
  readonly appended = streamSignalOf();
  readonly opened: string[] = [];
  readonly closed: string[] = [];
  readonly loads: string[] = [];
  readonly refusing = new Set<string>();
  readonly codes: SocketOpening['failureCodes'][] = [];
  readonly #downs = new Map<string, Queue.Queue<SocketFrame | 'closed'>>();
  readonly #orgs = new Set<string>();
  #raised = 0;
  #listingFails = false;

  readonly opens: OpensASocket = ({ credential, failureCodes: codes }) =>
    Effect.gen({ self: this }, function* () {
      const value = Redacted.value(credential);
      this.opened.push(value);
      this.codes.push(codes);
      if (this.refusing.has(value)) {
        return yield* Effect.fail(new SocketEnded({ end: 'refused' }));
      }
      const down = yield* Queue.unbounded<SocketFrame | 'closed'>();
      this.#downs.set(value, down);
      yield* Effect.addFinalizer(() => Effect.sync(() => this.closed.push(value)));
      const next = Effect.flatMap(Queue.take(down), (frame) =>
        frame === 'closed' ? Effect.fail(new SocketEnded({ end: 'closed', code: 1001 })) : Effect.succeed(frame),
      );
      return { next, send: Function.constant(Effect.void), ping: Effect.asVoid(Queue.offer(down, { kind: 'pong' })) };
    });

  readonly sends = (value: string, payload: object): Effect.Effect<void> =>
    this.#down(value, { kind: 'message', text: JSON.stringify(payload) });

  readonly closes = (value: string): Effect.Effect<void> => this.#down(value, 'closed');

  readonly forgotten = (org: string): void => {
    this.#orgs.delete(org);
  };

  readonly listingFails = (failing: boolean): void => {
    this.#listingFails = failing;
  };

  readonly recorded = (org: string, facts: readonly Fact[]): Effect.Effect<void> =>
    Effect.andThen(
      Effect.sync(() => this.#orgs.add(org)),
      Effect.asVoid(Effect.orDie(this.ledger.execute(connectionsStreamOfOrg(org), recordedAt, facts))),
    );

  readonly typesIn = (org: string): Effect.Effect<readonly string[]> =>
    Effect.map(this.ledger.load(connectionsStreamOfOrg(org), typesOfTheFacts), stateOf);

  readonly raised = (): number => this.#raised;

  readonly started = (context: Context.Context<never>) =>
    socketWakeUpOf({
      streams: {
        orgStreams: () =>
          this.#listingFails ? Promise.reject(new Error('the ledger is down')) : Effect.runPromise(this.#listed()),
      },
      registries: { registry: { load: this.#load, execute: this.ledger.execute }, providers },
      secrets: { read: this.#secret },
      opens: this.opens,
      wake: (woken, now) =>
        woken.conversation === 'broken' ? Effect.die(new Error('the ledger is down')) : this.wakes.wake(woken, now),
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

  readonly #load: StreamReader['load'] = (stream, fold) =>
    Effect.andThen(
      Effect.sync(() => this.loads.push(stream)),
      this.ledger.load(stream, fold),
    );

  #down(value: string, frame: SocketFrame | 'closed'): Effect.Effect<void> {
    return Effect.suspend(() =>
      Effect.asVoid(Queue.offer(Option.getOrThrow(Option.fromNullishOr(this.#downs.get(value))), frame)),
    );
  }

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
      Effect.map(this.ledger.load(connectionsStreamOfOrg(org), recordedAt), ({ version }) => ({ org, version })),
    );
  }
}
