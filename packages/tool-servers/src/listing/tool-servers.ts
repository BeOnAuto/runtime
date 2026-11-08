import { Result } from 'effect';

import type { ServerLink } from '../clients/server-links.ts';
import { offeredOn } from '../names/tool-naming.ts';
import type { Served } from '../org-servers/org-servers.ts';
import type { Unusable } from '../org-servers/server-refusals.ts';
import { takenAndListed, type Listing } from './server-listing.ts';
import { shownTool, type Showing } from './shown-tools.ts';
import type { ServerTool } from './tool-server.ts';

export type ServersListing = Listing & Showing;

export type ListedTools = Result.Result<readonly ServerTool[], Unusable>;

export async function listedTools(served: Served, link: ServerLink, listing: ServersListing): Promise<ListedTools> {
  const listed = await takenAndListed(link, listing);
  if (Result.isFailure(listed)) {
    return Result.fail(listed.failure);
  }
  await listed.success.slot.release();
  const offered = offeredOn(listed.success, { references: [{ server: served.name, tool: '*' }] });
  return Result.succeed(offered.map(({ tool }) => shownTool(tool, listing)));
}
