import { Array as Arr, Effect, Option } from 'effect';

import type { ToolNotOffered } from '../access/tool-not-offered.ts';
import { defaultTiming, mostRequestBytesOf, mostRequestBytesTo, type Timing } from '../bounds/call-bounds.ts';
import type { OrgAccess } from '../org-servers/org-access.ts';
import { namedAmong } from '../org-servers/org-naming.ts';
import type { OrgServer } from '../org-servers/org-servers.ts';
import type { BearerSending } from './bearer-requests.ts';
import type { ConnectionRequest, DeclaredRequest, RequestedOnce } from './declared-requests.ts';
import { tracedRequest } from './requested-spans.ts';

export type RequestOnce = (request: ConnectionRequest) => Effect.Effect<RequestedOnce>;

export interface RequestWays {
  readonly requestOnce: RequestOnce;
}

interface RequestBounds {
  readonly timing: Timing | undefined;
  readonly most: number | undefined;
}

type Bounds = Pick<BearerSending, 'callMs' | 'mostRequestBytes'>;

async function requestedThrough(
  request: ConnectionRequest,
  server: OrgServer,
  { callMs, mostRequestBytes }: Bounds,
  signal: Readonly<AbortSignal>,
): Promise<RequestedOnce> {
  const linked = await server.linked();
  if ('refused' in linked) {
    return { kind: 'unopened', because: linked.refused.because };
  }
  const { link, requests } = linked;
  if (requests === undefined) {
    return { kind: 'unopened', because: 'connection_not_allowed' };
  }
  const [{ requestedWith }, { bearerOf }] = await Promise.all([
    import('./bearer-requests.ts'),
    import('./carried-credentials.ts'),
  ]);
  const { origins, tokens, fetch, reaches, refused } = requests;
  const most = mostRequestBytesTo(link.settings, mostRequestBytes);
  const bearer = bearerOf(link.settings, tokens);
  return requestedWith(request, { origins, bearer, fetch, reaches, refused, callMs, mostRequestBytes: most }, signal);
}

function requestedAmong(
  servers: readonly OrgServer[],
  request: ConnectionRequest,
  bounds: Bounds,
): Effect.Effect<RequestedOnce> {
  const naming = { address: request, references: [{ server: request.server, tool: '*' }] };
  return Effect.matchEffect(namedAmong(servers, naming), {
    onFailure: ({ because }: Pick<ToolNotOffered, 'because'>) =>
      Effect.succeed<RequestedOnce>({ kind: 'unopened', because }),
    onSuccess: (named) =>
      Effect.promise((signal) => requestedThrough(request, Option.getOrThrow(Arr.head(named)), bounds, signal)),
  });
}

export function requestWaysOf(access: OrgAccess, { timing = defaultTiming, most }: RequestBounds): RequestWays {
  const bounds: Bounds = { callMs: timing.callMs, mostRequestBytes: mostRequestBytesOf(most) };
  return {
    requestOnce: (request) =>
      tracedRequest(
        request,
        Effect.flatMap(access.serversOf(request.org), (servers) => requestedAmong(servers, request, bounds)),
      ),
  };
}

export function bearerRequestOnce(request: DeclaredRequest, sending: BearerSending): Effect.Effect<RequestedOnce> {
  return tracedRequest(
    request,
    Effect.promise(async (signal) => {
      const { requestedWith } = await import('./bearer-requests.ts');
      return requestedWith(request, sending, signal);
    }),
  );
}
