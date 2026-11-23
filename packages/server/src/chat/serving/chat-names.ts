import { defaultOrg } from '@on.auto/openid-connect';

import type { NamesFromTheService } from '../../account-linking/account-links.ts';
import type { ChatConnections } from './chat-connections.ts';

type Connections = Pick<ChatConnections, 'heldIn' | 'renderOf' | 'connectionOf'>;

async function ofTheAccount(connections: Connections, account: string) {
  const holder = (await connections.heldIn(defaultOrg)).find((each) => each.account === account);
  const render = holder === undefined ? undefined : connections.renderOf(holder)?.render;
  return holder === undefined || render === undefined ? undefined : { member: { org: defaultOrg, holder }, render };
}

export function namesOf(connections: Connections): NamesFromTheService {
  return {
    ofTheService: async (account) => {
      const found = await ofTheAccount(connections, account);
      return found === undefined ? undefined : { service: found.render.service, app: found.render.app };
    },
    ofTheMember: async ({ account, member }) => {
      const found = await ofTheAccount(connections, account);
      const connection = found === undefined ? undefined : await connections.connectionOf(found.member);
      const where = { id: member, conversation: '', thread: undefined, sender: member, kind: '' };
      const read = await connection?.service.sender(where);
      return read?.name === undefined || connection === undefined
        ? undefined
        : { memberName: read.name, accountName: connection.accountName ?? connection.render.service };
    },
  };
}
