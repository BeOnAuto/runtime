import { Effect } from 'effect';

import { requestBoundsOf } from '../bounds/call-bounds.ts';
import { tokenRequestsOf, type TokenRequests } from '../consent-tokens/token-requests.ts';
import { isServerSource, requestsOf, type Requests } from '../consent/acting-clients.ts';
import { serviceClientTakenOf, sourcesHad, sourceTakenOf, type ServiceClient } from '../consent/client-sources.ts';
import type {
  ConsentRefusal,
  FinishAsked,
  FinishedConsent,
  LoadedOptions,
  NamedWay,
  StartAsked,
  StartedConsent,
  WayAsked,
  WayRefusal,
} from '../consent/consent-client.ts';
import { serverConsentsOf, type ServerConsents } from '../consent/consent-requests.ts';
import { servedKindOf } from './auto-clients.ts';
import { handedOff, startedThroughAuto } from './auto-consents.ts';
import { autoRenewalsOf } from './auto-renewals.ts';

export interface ConsentRequests extends TokenRequests {
  readonly namedWay: (asked: WayAsked) => Effect.Effect<NamedWay, WayRefusal>;
  readonly start: (asked: StartAsked) => Effect.Effect<StartedConsent, ConsentRefusal>;
  readonly finish: (asked: FinishAsked) => Effect.Effect<FinishedConsent, ConsentRefusal>;
}

interface Consenting {
  readonly options: LoadedOptions;
  readonly requests: Requests;
  readonly server: ServerConsents;
}

const studioElsewhere: ConsentRefusal = { refused: 'studio_elsewhere' };

const noServiceClients: readonly ServiceClient[] = [];

function takenThroughAutoAlone(asked: StartAsked, options: LoadedOptions): Effect.Effect<boolean> {
  return Effect.map(
    options.serviceClients,
    (listed) => sourceTakenOf(asked.way, { ...options, serviceClients: listed }) === 'auto',
  );
}

function started(asked: StartAsked, { options, requests, server }: Consenting) {
  return Effect.gen(function* () {
    const { auto } = options;
    const kind = servedKindOf(auto, asked.studioBase);
    const listed = kind === undefined ? noServiceClients : yield* options.serviceClients;
    const had = { ...options, serviceClients: listed };
    const taken = serviceClientTakenOf(asked.way, had);
    if (taken !== undefined && auto.enabled && kind !== undefined) {
      return yield* startedThroughAuto(asked, requests.fetchFor, { auto, clientId: taken.client_id, kind });
    }
    const sources = sourcesHad(asked.way, had);
    if (sources.length === 0 && kind === undefined && (yield* takenThroughAutoAlone(asked, options))) {
      return yield* Effect.fail(studioElsewhere);
    }
    return yield* server.start(
      asked,
      sources.filter((source) => isServerSource(source)),
    );
  });
}

function finished(asked: FinishAsked, { options, requests, server }: Consenting) {
  return 'handle' in asked ? handedOff(asked, requests.fetchFor, options.auto) : server.finish(asked);
}

export function consentRequests(options: LoadedOptions): ConsentRequests {
  const bounds = requestBoundsOf(options);
  const requests = requestsOf({ ...options, ...bounds });
  const consenting: Consenting = { options, requests, server: serverConsentsOf(requests, options.publicUrl) };
  return {
    namedWay: (asked) => consenting.server.namedWay(asked),
    start: (asked) => started(asked, consenting),
    finish: (asked) => finished(asked, consenting),
    ...tokenRequestsOf(
      requests,
      { requestMs: bounds.requestMs, renewalSpreadMs: options.renewalSpreadMs },
      autoRenewalsOf(requests.fetchFor, options.auto),
    ),
  };
}
