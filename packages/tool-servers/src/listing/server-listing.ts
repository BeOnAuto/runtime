import { Result } from 'effect';

import type { Timing } from '../bounds/call-bounds.ts';
import type { Secrets } from '../bounds/secrets.ts';
import { takenSlot, type ServerSlot } from '../calls/server-slot.ts';
import { failureOf } from '../clients/server-failures.ts';
import type { ServerLink } from '../clients/server-links.ts';
import type { Listed } from '../names/tool-naming.ts';
import { serverFailed, type Unusable } from '../org-servers/server-refusals.ts';

export interface Listing {
  readonly secrets: Secrets;
  readonly timing: Timing;
}

export function listedThrough(
  slot: ServerSlot,
  { secrets, timing }: Listing,
): Promise<Result.Result<Listed, Unusable>> {
  return slot
    .client()
    .listTools(timing.openMs)
    .then(
      (tools) => Result.succeed({ slot, tools }),
      async (error: unknown) => {
        await slot.release();
        return Result.fail(serverFailed(slot, failureOf(error), secrets));
      },
    );
}

export async function takenAndListed(link: ServerLink, listing: Listing): Promise<Result.Result<Listed, Unusable>> {
  const taken = await takenSlot(link);
  return Result.isFailure(taken)
    ? Result.fail(serverFailed(link, taken.failure, listing.secrets))
    : listedThrough(taken.success, listing);
}

export async function released(listed: readonly Listed[]): Promise<void> {
  await Promise.all(listed.map(({ slot }) => slot.release()));
}

export async function listedOn(
  links: readonly ServerLink[],
  listing: Listing,
): Promise<Result.Result<readonly Listed[], Unusable>> {
  const tried = await Promise.all(links.map((link) => takenAndListed(link, listing)));
  const listed: Listed[] = [];
  const failures: Unusable[] = [];
  for (const each of tried) {
    if (Result.isSuccess(each)) {
      listed.push(each.success);
    } else {
      failures.push(each.failure);
    }
  }
  const [failure] = failures;
  if (failure === undefined) {
    return Result.succeed(listed);
  }
  await released(listed);
  return Result.fail(failure);
}
