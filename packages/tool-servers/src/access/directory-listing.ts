import { DirectoryListing } from '@on.auto/operations';
import { Data, Effect } from 'effect';

interface MayHandleMoney {
  readonly handles_money?: true;
}

export class NotInTheDirectoryListing extends Data.TaggedError('tool_not_offered')<{
  readonly detail: string;
}> {}

function notInTheDirectoryListing(server: string): NotInTheDirectoryListing {
  return new NotInTheDirectoryListing({
    detail: `The directory listing does not offer the tool server ${server}, whose tools pay, refund, transfer or pay out money`,
  });
}

const handlesMoney = ({ handles_money: money }: MayHandleMoney): boolean => money === true;

export const offeredInTheListing = Effect.fnUntraced(function* <Server extends MayHandleMoney>(
  servers: readonly Server[],
) {
  const listed = yield* DirectoryListing;
  return listed ? servers.filter((server) => !handlesMoney(server)) : servers;
});

export const refusedOutsideTheListing = Effect.fnUntraced(function* (server: string, settings: MayHandleMoney) {
  const refused = (yield* DirectoryListing) && handlesMoney(settings);
  return yield* refused ? Effect.fail(notInTheDirectoryListing(server)) : Effect.void;
});
