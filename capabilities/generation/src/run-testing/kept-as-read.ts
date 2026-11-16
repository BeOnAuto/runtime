import type { Context, Decided, Decider, PlaybookAddress, StreamWriter } from '@on.auto/operations';

import { assetDecider, decidedInTurn, type AssetStanding } from '../assets/asset-decider.ts';
import type { AssetEvent, AssetKeptData } from '../assets/asset-facts.ts';
import { assetStreamIn } from '../assets/asset-keeping.ts';

interface CommandOfWhatIsRead {
  readonly event: Decided<AssetEvent>;
  readonly context: Context;
}

const assetDeciderOfWhatIsRead: Decider<AssetStanding, CommandOfWhatIsRead, AssetEvent, 'conflict'> = {
  ...assetDecider,
  decide: ({ event }, standing) => decidedInTurn(event, standing),
  context: ({ context }) => context,
};

interface KeptAsRead {
  readonly playbook: PlaybookAddress;
  readonly id: string;
  readonly data: AssetKeptData;
  readonly context: Context;
}

export function keptAsRead(ledger: StreamWriter, { playbook, id, data, context }: KeptAsRead) {
  return ledger.execute(assetStreamIn(playbook, id), assetDeciderOfWhatIsRead, {
    event: { type: 'asset_kept', data },
    context,
  });
}
