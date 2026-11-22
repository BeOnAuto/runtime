function wordsOf(status: number): string {
  return status >= 200 && status < 300
    ? 'The authorization server answered no access token'
    : `The authorization server answered HTTP ${String(status)} when asked for a token`;
}

export class TokenRequestFailed extends Error {
  readonly status: number;

  readonly host: string;

  readonly passing: boolean;

  constructor(status: number, host: string, passing: boolean) {
    super(wordsOf(status));
    this.status = status;
    this.host = host;
    this.passing = passing;
  }
}
