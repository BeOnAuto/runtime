import { listed } from '@on.auto/phrasing';

const tryLater = 'Try again in a few minutes';

export const exchangeWords = {
  refused: (code: string) =>
    `The service did not give Auto a token for this connection. Check that each step on this page was done and that the values you entered are right. A change at the service can take a few minutes to apply. The service answered: ${code}.`,
  unanswered: (name: string) => `Auto could not get a token for the connection ${name}`,
  unreached: (hosts: readonly string[]) =>
    `Auto could not reach ${listed(hosts)} to get a token, so nothing was saved. ${tryLater}. If it still fails on an Auto that you or your company runs, ask whoever runs your network to allow connections to ${listed(hosts)} on port 443.`,
  signsNoTokens: (name: string) =>
    `This Auto cannot sign the token the connection ${name} exchanges, so it cannot connect this way here. Choose another way to connect it.`,
  nothingReached: (name: string) =>
    `The connection ${name} reaches nothing at the service yet, so nothing was saved. Give its service account access at the service, then approve again.`,
  unchecked: (name: string) =>
    `Auto could not check what the connection ${name} reaches, so nothing was saved. ${tryLater}.`,
  accountUnmade: (name: string) =>
    `Auto could not create the service account of the connection ${name}. ${tryLater}, or choose another way to connect it.`,
  accountUnremoved: (name: string) =>
    `Auto could not remove the service account of the connection ${name}, so nothing was changed. ${tryLater}.`,
} as const;
