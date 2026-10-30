import type { PlaybookAddress } from '@on.auto/operations';
import { Effect } from 'effect';

import { ToolNotOffered } from '../access/tool-not-offered.ts';
import { namedLinks } from '../names/tool-naming.ts';
import type { ToolReference } from '../names/tool-reference.ts';
import { namedIn, type OrgServer } from './org-servers.ts';

export type NamingCheck = (
  address: PlaybookAddress,
  references: readonly ToolReference[],
) => Effect.Effect<void, ToolNotOffered>;

export interface Naming {
  readonly address: PlaybookAddress;
  readonly references: readonly ToolReference[];
}

export function namedAmong(
  servers: readonly OrgServer[],
  { address, references }: Naming,
): Effect.Effect<readonly OrgServer[], ToolNotOffered> {
  return Effect.fromResult(namedLinks(address, { references, links: namedIn(address.org, servers) }));
}

async function firstUnready(servers: readonly OrgServer[]): Promise<ToolNotOffered | undefined> {
  const [unready] = (await Promise.all(servers.map((server) => server.checked()))).flat();
  return unready === undefined ? undefined : new ToolNotOffered(unready);
}

export function readyAmong(servers: readonly OrgServer[], naming: Naming): Effect.Effect<void, ToolNotOffered> {
  return Effect.gen(function* () {
    const named = yield* namedAmong(servers, naming);
    const unready = yield* Effect.promise(() => firstUnready(named));
    if (unready !== undefined) {
      yield* Effect.fail(unready);
    }
  });
}
