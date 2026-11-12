import type { Reaches } from '@on.auto/outbound';
import { Duration, Effect, Option, Redacted, Schedule } from 'effect';

import { handoffVerifier } from '../consent-through-auto/auto-consents.ts';
import type { ConsentRequests } from '../consent-through-auto/consents-by-source.ts';
import { connectsThroughAGateway, type WayGateway } from '../consent/client-sources.ts';
import type {
  ConsentRefusal,
  ConsentWay,
  FinishAsked,
  FinishedConsent,
  GatewayEndAsked,
  GatewayEndRefusal,
  HandleFinishAsked,
  StartAsked,
  StartedConsent,
} from '../consent/consent-client.ts';
import { gatewayCallsOf, type GatewayCalls } from './gateway-calls.ts';

type FetchFor = ConsentRequests['fetchFor'];

export interface GatewayRequests extends ConsentRequests {
  readonly end: (asked: GatewayEndAsked) => Effect.Effect<void, GatewayEndRefusal>;
  readonly endTried: (asked: GatewayEndAsked, unended: string) => Effect.Effect<void>;
}

export interface GatewayOptions {
  readonly gateways?: boolean | undefined;
  readonly gatewayEndPauseMs?: number | undefined;
}

const noGatewayHere: GatewayEndRefusal = { refused: 'no_client' };

const handOverUnread: ConsentRefusal = { refused: 'handoff_unread' };

const gatewayEndingTries = 3;

const firstPauseMs = 500;

const endingBound = Duration.seconds(5);

function gatewayOfTheWay({ gateway }: ConsentWay): WayGateway {
  return Option.getOrThrow(Option.fromNullishOr(gateway));
}

function callsAt(way: ConsentWay, reaches: Reaches, fetchFor: FetchFor): GatewayCalls {
  return gatewayCallsOf({ fetch: fetchFor(reaches), url: gatewayOfTheWay(way).url });
}

export function unendedWords(url: string): string {
  return `The gateway at ${url} did not confirm the end of a key no connection holds any more, within ${String(gatewayEndingTries)} tries and ${String(Duration.toSeconds(endingBound))} seconds`;
}

function triedToEnd<E>(end: Effect.Effect<void, E>, unended: string, pauseMs: number): Effect.Effect<void> {
  return end.pipe(
    Effect.retry({ times: gatewayEndingTries - 1, schedule: Schedule.exponential(Duration.millis(pauseMs)) }),
    Effect.timeout(endingBound),
    Effect.catch(() => Effect.logError(unended)),
  );
}

function startedThroughAGateway(asked: StartAsked, fetchFor: FetchFor): Effect.Effect<StartedConsent, ConsentRefusal> {
  return Effect.gen(function* () {
    const { verifier, challenge } = handoffVerifier();
    const atTheGateway = yield* callsAt(asked.way, asked.reaches, fetchFor).start({ challenge, state: asked.state });
    return {
      url: atTheGateway.url,
      state: asked.state,
      verifier: Redacted.make(verifier),
      client: { client_id: atTheGateway.client_id, client_source: 'gateway' },
    };
  });
}

function handedOverByAGateway(
  asked: HandleFinishAsked,
  fetchFor: FetchFor,
  pauseMs: number,
): Effect.Effect<FinishedConsent, ConsentRefusal> {
  const calls = callsAt(asked.way, asked.reaches, fetchFor);
  return Effect.gen(function* () {
    const { key, connected } = yield* calls.takeHandoff(asked.handle, asked.verifier);
    const revoked = triedToEnd(calls.end(key), unendedWords(gatewayOfTheWay(asked.way).url), pauseMs);
    if (Option.isNone(connected)) {
      return yield* Effect.andThen(revoked, Effect.fail(handOverUnread));
    }
    const { account, scope } = connected.value;
    return { client: asked.client, tokens: key, scope, account, revoked };
  });
}

function reachesItsGateway(way: ConsentWay, gateways: boolean | undefined): boolean {
  return gateways === true && connectsThroughAGateway(way);
}

function started(asked: StartAsked, requests: ConsentRequests, gateways: boolean | undefined) {
  if (!connectsThroughAGateway(asked.way)) {
    return requests.start(asked);
  }
  return reachesItsGateway(asked.way, gateways)
    ? startedThroughAGateway(asked, requests.fetchFor)
    : Effect.fail(noGatewayHere);
}

function finished(asked: FinishAsked, requests: ConsentRequests, { gateways, pauseMs }: Switched) {
  if (asked.client.client_source !== 'gateway') {
    return requests.finish(asked);
  }
  return 'handle' in asked && reachesItsGateway(asked.way, gateways)
    ? handedOverByAGateway(asked, requests.fetchFor, pauseMs)
    : Effect.fail(noGatewayHere);
}

function ended(asked: GatewayEndAsked, { fetchFor }: ConsentRequests, gateways: boolean | undefined) {
  return reachesItsGateway(asked.way, gateways)
    ? callsAt(asked.way, asked.reaches, fetchFor).end(asked.key)
    : Effect.fail(noGatewayHere);
}

interface Switched {
  readonly gateways: boolean | undefined;
  readonly pauseMs: number;
}

export function throughGateways(requests: ConsentRequests, options: GatewayOptions): GatewayRequests {
  const switched = { gateways: options.gateways, pauseMs: options.gatewayEndPauseMs ?? firstPauseMs };
  return {
    ...requests,
    start: (asked) => started(asked, requests, switched.gateways),
    finish: (asked) => finished(asked, requests, switched),
    end: (asked) => ended(asked, requests, switched.gateways),
    endTried: (asked, unended) => triedToEnd(ended(asked, requests, switched.gateways), unended, switched.pauseMs),
  };
}
