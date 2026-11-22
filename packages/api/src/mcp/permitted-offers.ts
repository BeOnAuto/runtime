import type { McpServer } from '@modelcontextprotocol/server';
import { type RegisteredPlainLanguage, type Registration, Unavailable, mayCallEach } from '@on.auto/operations';
import { Array as Arr, Effect } from 'effect';

import type { OrgCall } from '../hand-off/caller-hand-off.ts';
import type { ServerInfo } from './mcp-connection.ts';
import { unavailableServerOf, type UnavailableListing } from './unavailable-server.ts';

interface Offer<R extends Registration> {
  readonly registration: R;
}

function mayCallEachOf(
  { caller, org, requestId, context }: OrgCall,
  offers: readonly Offer<Registration>[],
  playbook?: string,
): Promise<readonly boolean[] | Unavailable> {
  const named = playbook === undefined ? {} : { playbook };
  const asked = offers.map((offer) => ({ operation: offer.registration, caller, org, ...named }));
  return Effect.runPromise(
    mayCallEach(asked).pipe(
      Effect.map((answers): readonly boolean[] | Unavailable => answers),
      Effect.catchTag('unavailable', Effect.succeed),
      Effect.annotateLogs({ requestId, org, caller: caller.id, ...named }),
      Effect.provideContext(context),
    ),
  );
}

function mayBeCalled<O extends Offer<Registration>>(offers: readonly O[], answers: readonly boolean[]): readonly O[] {
  return Arr.zip(offers, answers)
    .filter(([, may]: readonly [O, boolean]) => may)
    .map(([offer]: readonly [O, boolean]) => offer);
}

/** The offers the caller may call, asked as one batch, or why that is unavailable: busy, or a check that failed. */
export async function permittedTo<O extends Offer<Registration>>(
  call: OrgCall,
  offers: readonly O[],
  playbook?: string,
): Promise<readonly O[] | Unavailable> {
  const answers = await mayCallEachOf(call, offers, playbook);
  return answers instanceof Unavailable ? answers : mayBeCalled(offers, answers);
}

/** The offers of the org and those that take a playbook the caller may call, asked together as one batch. */
export async function permittedInOrgAndPlaybooks<
  O extends Offer<Registration<'org'>>,
  P extends Offer<Registration<'playbook'>>,
>(
  call: OrgCall,
  orgOffers: readonly O[],
  playbookOffers: readonly P[],
): Promise<readonly [readonly O[], readonly P[]] | Unavailable> {
  const answers = await mayCallEachOf(call, [...orgOffers, ...playbookOffers]);
  if (answers instanceof Unavailable) {
    return answers;
  }
  return [mayBeCalled(orgOffers, answers), mayBeCalled(playbookOffers, answers.slice(orgOffers.length))];
}

interface WordedOffer extends Offer<Registration> {
  readonly plainLanguage: RegisteredPlainLanguage;
}

/** The server a connection is served where whether it may call its tools is unavailable: refusing what it would list. */
export function unavailableServerFor(
  serverInfo: ServerInfo,
  offers: readonly WordedOffer[],
  unavailable: UnavailableListing,
): McpServer {
  const tools = offers.map(({ registration, plainLanguage }) => ({
    name: registration.name,
    kind: registration.kind,
    plainLanguage,
  }));
  return unavailableServerOf(serverInfo, unavailable, tools);
}
