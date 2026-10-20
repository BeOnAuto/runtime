import { Effect, Option } from 'effect';

import { requestBoundsOf } from '../bounds/call-bounds.ts';
import { tokenRequestsOf, type TokenRequests } from '../consent-tokens/token-requests.ts';
import { isServerSource, requestsOf, type Requests } from '../consent/acting-clients.ts';
import { serviceClientAt, sourcesHad, sourceTakenOf } from '../consent/client-sources.ts';
import type {
  ConsentRefusal,
  FinishAsked,
  FinishedConsent,
  LoadedOptions,
  StartAsked,
  StartedConsent,
} from '../consent/consent-client.ts';
import { serverConsentsOf, type ServerConsents } from '../consent/consent-requests.ts';
import { handedOff, startedThroughAuto } from './auto-consents.ts';
import { autoRenewalsOf } from './auto-renewals.ts';

export interface ConsentRequests extends TokenRequests {
  readonly start: (asked: StartAsked) => Effect.Effect<StartedConsent, ConsentRefusal>;
  readonly finish: (asked: FinishAsked) => Effect.Effect<FinishedConsent, ConsentRefusal>;
}

interface Consenting {
  readonly options: LoadedOptions;
  readonly requests: Requests;
  readonly server: ServerConsents;
}

function required<A>(value: A | undefined): A {
  return Option.getOrThrow(Option.fromNullishOr(value));
}

function started(asked: StartAsked, { options, requests, server }: Consenting) {
  return Effect.gen(function* () {
    const serviceClients = yield* options.serviceClients;
    const had = { ...options, serviceClients };
    const { auto } = options;
    if (sourceTakenOf(asked.way, had) === 'auto' && auto.enabled) {
      const { client_id: clientId } = required(serviceClientAt(serviceClients, asked.way.issuer));
      return yield* startedThroughAuto(asked, requests.fetchFor, auto, clientId);
    }
    return yield* server.start(
      asked,
      sourcesHad(asked.way, had).filter((source) => isServerSource(source)),
    );
  });
}

function finished(asked: FinishAsked, { options, requests, server }: Consenting) {
  return 'handle' in asked ? handedOff(asked, requests.fetchFor, options.auto) : server.finish(asked);
}

export function consentRequests(options: LoadedOptions): ConsentRequests {
  const bounds = requestBoundsOf(options);
  const requests = requestsOf({ ...options, ...bounds });
  const consenting: Consenting = { options, requests, server: serverConsentsOf(requests) };
  return {
    start: (asked) => started(asked, consenting),
    finish: (asked) => finished(asked, consenting),
    ...tokenRequestsOf(
      requests,
      { requestMs: bounds.requestMs, renewalSpreadMs: options.renewalSpreadMs },
      autoRenewalsOf(requests.fetchFor, options.auto),
    ),
  };
}
