import { Array as Arr, Option, Result } from 'effect';

import { isReadOnly, type ListedTool } from '../bounds/tool-results.ts';
import type { ServerSlot } from '../calls/server-slot.ts';
import type { ServerLink } from '../clients/server-links.ts';
import { listedThrough, type Listing } from '../listing/server-listing.ts';
import { notListed, offeredOn, unlistedOn } from '../names/tool-naming.ts';
import type { ToolReference } from '../names/tool-reference.ts';
import { serverFailed } from '../org-servers/server-refusals.ts';
import { notOfferedOnce, refusedOnce, type UnopenedOnce } from './called-once.ts';
import { boundedSlot, restartedIfExited, takenWithin } from './client-bound.ts';

export interface Opened {
  readonly slot: ServerSlot;
  readonly tool: ListedTool;
  readonly readOnly: boolean;
}

export async function openedFor(
  reference: ToolReference,
  link: ServerLink,
  listing: Listing,
): Promise<Opened | UnopenedOnce> {
  const { openMs } = listing.timing;
  const taken = await takenWithin(link, openMs);
  if ('late' in taken) {
    const message = `The tool server did not open a connection within ${openMs} ms`;
    return refusedOnce(serverFailed(link, { kind: 'timed_out', message }, listing.secrets));
  }
  if ('failure' in taken) {
    return refusedOnce(serverFailed(link, taken.failure, listing.secrets));
  }
  const bounded = boundedSlot(taken.slot, openMs);
  const exited = await restartedIfExited(bounded);
  if (exited !== undefined) {
    await bounded.release();
    return refusedOnce(serverFailed(link, exited, listing.secrets));
  }
  const listed = await listedThrough(bounded, listing);
  if (Result.isFailure(listed)) {
    return refusedOnce(listed.failure);
  }
  const naming = { references: [reference] };
  const unlisted = unlistedOn(listed.success, naming);
  if (unlisted.length > 0) {
    await listed.success.slot.release();
    return notOfferedOnce(notListed(unlisted));
  }
  const { slot, tool } = Option.getOrThrow(Arr.head(offeredOn(listed.success, naming)));
  return { slot, tool, readOnly: isReadOnly(tool.annotations) };
}
