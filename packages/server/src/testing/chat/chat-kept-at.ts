import { out } from '../../admin-command/admin-words.ts';
import { withTheChatOpened } from '../../admin-command/delete-chat.ts';
import { withTheLedgerOpened } from '../../admin-command/opened-for-a-command.ts';
import type { ChatStore } from '../../chat/store/chat-store.ts';
import { aLedgerAServerKeptAt, shippedFilesOfTheServer } from '../records/ledger-a-server-kept.ts';
import { readSettingsOf } from '../settings/shipped-settings.ts';

export async function chatKeptAt<A>(LEDGER_FILE: string, keep: (chat: ChatStore) => Promise<A>): Promise<A> {
  await aLedgerAServerKeptAt({ LEDGER_FILE }, () => Promise.resolve());
  const kept = Promise.withResolvers<A>();
  const said = await withTheLedgerOpened(readSettingsOf({ LEDGER_FILE }), shippedFilesOfTheServer, (opened) =>
    withTheChatOpened(opened, async (chat) => {
      kept.resolve(await keep(chat));
      return out();
    }),
  );
  kept.reject(new Error(said.lines.join(' ')));
  return kept.promise;
}
