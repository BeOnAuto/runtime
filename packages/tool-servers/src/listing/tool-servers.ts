import { Result } from 'effect';

import type { ServerLink } from '../clients/server-links.ts';
import { offeredOn } from '../names/tool-naming.ts';
import { serverFieldsOf, unavailableServer } from './server-fields.ts';
import { takenAndListed, type Listing } from './server-listing.ts';
import { shownTool, type Showing } from './shown-tools.ts';
import type { ToolServer } from './tool-server.ts';

export type ServersListing = Listing & Showing;

export async function listedServer(link: ServerLink, listing: ServersListing): Promise<ToolServer> {
  const listed = await takenAndListed(link, listing);
  if (Result.isFailure(listed)) {
    return unavailableServer(link.settings, listed.failure);
  }
  await listed.success.slot.release();
  const offered = offeredOn(listed.success, { references: [{ server: link.settings.name, tool: '*' }] });
  return { ...serverFieldsOf(link.settings), tools: offered.map(({ tool }) => shownTool(tool, listing)) };
}
