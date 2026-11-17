import { Effect } from 'effect';

import { defaultTiming, mostRequestBytesOf, mostRequestBytesTo, type Timing } from '../bounds/call-bounds.ts';
import type { RunTools } from '../calls/run-tools.ts';
import type { ToolReference } from '../names/tool-reference.ts';
import type { OrgAccess } from '../org-servers/org-access.ts';
import { namedAmong, readyAmong, type NamingCheck } from '../org-servers/org-naming.ts';
import { linksOf } from '../org-servers/org-servers.ts';
import { callWaysOf, type CallWays } from './call-ways.ts';
import type { CallerContext, ToolsNotOpened } from './caller-context.ts';
import type { RecordingParts } from './entry-reads.ts';

export interface RunWays extends CallWays {
  readonly open: (
    context: CallerContext,
    references: readonly ToolReference[],
  ) => Effect.Effect<RunTools, ToolsNotOpened>;
  readonly named: NamingCheck;
  readonly callMs: number;
  readonly mostRequestBytes: number;
  readonly mostRequestBytesTo: (server: string) => number;
}

type NamedServer = Parameters<typeof mostRequestBytesTo>[0] & { readonly name: string };

interface RequestBytesBounds {
  readonly servers: readonly NamedServer[];
  readonly most: number;
}

interface RunBounds extends Pick<RequestBytesBounds, 'servers'> {
  readonly timing: Timing | undefined;
  readonly most: number | undefined;
}

export function mostRequestBytesAmong({ servers, most }: RequestBytesBounds): RunWays['mostRequestBytesTo'] {
  return (named) => {
    const server = servers.find(({ name }) => name === named);
    return server === undefined ? most : mostRequestBytesTo(server, most);
  };
}

export function runWaysOf(access: OrgAccess, recording: RecordingParts, bounds: RunBounds): RunWays {
  const { callMs } = bounds.timing ?? defaultTiming;
  const mostRequestBytes = mostRequestBytesOf(bounds.most);
  return {
    ...callWaysOf(access, recording),
    callMs,
    mostRequestBytes,
    mostRequestBytesTo: mostRequestBytesAmong({ servers: bounds.servers, most: mostRequestBytes }),
    open: (context, references) =>
      Effect.gen(function* () {
        const servers = yield* access.serversOf(context.org);
        const named = yield* namedAmong(servers, { address: context, references });
        const linked = yield* Effect.promise(() => Promise.all(named.map((server) => server.linked())));
        const links = yield* linksOf(linked);
        const linkedAccess = yield* Effect.promise(access.loaded);
        return yield* linkedAccess.open({ context, references, links });
      }),
    named: (address, references) =>
      Effect.flatMap(access.serversOf(address.org), (servers) => readyAmong(servers, { address, references })),
  };
}
