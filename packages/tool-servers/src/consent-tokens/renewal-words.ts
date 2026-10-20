export const renewalWords = {
  unanswered: (name: string) =>
    `The authorization server of the connection ${name} did not answer as an authorization server does, so its tokens were not renewed; the next call tries again`,
  serviceUnanswered: (name: string) =>
    `Auto's consent service did not answer for the connection ${name}, so its tokens were not renewed; the next call tries again`,
  unrenewable: (name: string) =>
    `The authorization server of the connection ${name} no longer answers as it did when the connection was made, so its tokens cannot be renewed`,
  unfinished: (name: string, waitMs: number) =>
    `The tokens of the connection ${name} are being renewed by another process of the runtime, which did not finish within ${waitMs} ms; the next call tries again`,
} as const;
