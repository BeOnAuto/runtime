import type { ConsentRefusal } from '../consent/consent-client.ts';

export const renewalWords = {
  unanswered: (name: string) =>
    `The authorization server of the connection ${name} did not answer as an authorization server does, so its tokens were not renewed; the next call tries again`,
  serviceUnanswered: (name: string) =>
    `Auto's consent service did not answer for the connection ${name}, so its tokens were not renewed; the next call tries again`,
  unrenewable: (name: string) =>
    `The authorization server of the connection ${name} no longer answers as it did when the connection was made, so its tokens cannot be renewed`,
  registrationUnreadable: (name: string, detail: string) =>
    `The client the connection ${name} was made with cannot be read now, so its tokens were not renewed; the next call tries again: ${detail}`,
  unfinished: (name: string, waitMs: number) =>
    `The tokens of the connection ${name} are being renewed by another process of the runtime, which did not finish within ${waitMs} ms; the next call tries again`,
  authorizationServerUnnamed: (name: string, url: string) =>
    `The server at ${url} no longer names its authorization server, so the tokens of the connection ${name} cannot be renewed; remove the connection and add it again`,
  unrenewedBy: (refusal: ConsentRefusal, name: string): string => {
    if (refusal.refused === 'registration_unavailable') {
      return renewalWords.registrationUnreadable(name, refusal.detail);
    }
    if (refusal.refused === 'authorization_server_unnamed') {
      return renewalWords.authorizationServerUnnamed(name, refusal.url);
    }
    return refusal.refused === 'unanswered' ? renewalWords.unanswered(name) : renewalWords.unrenewable(name);
  },
} as const;
