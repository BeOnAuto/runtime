import { Result } from 'effect';

import type { ServerLink } from '../clients/server-links.ts';
import { offeredOn } from '../names/tool-naming.ts';
import type { Served } from '../org-servers/org-servers.ts';
import { serverFieldsOf, unavailableServer } from './server-fields.ts';
import { takenAndListed, type Listing } from './server-listing.ts';
import { shownTool, type Showing } from './shown-tools.ts';
import type { ToolServer } from './tool-server.ts';

export type ServersListing = Listing & Showing;

export async function listedServer(served: Served, link: ServerLink, listing: ServersListing): Promise<ToolServer> {
  const listed = await takenAndListed(link, listing);
  if (Result.isFailure(listed)) {
    return unavailableServer(served, listed.failure);
  }
  await listed.success.slot.release();
  const offered = offeredOn(listed.success, { references: [{ server: served.name, tool: '*' }] });
  return { ...serverFieldsOf(served), tools: offered.map(({ tool }) => shownTool(tool, listing)) };
}
