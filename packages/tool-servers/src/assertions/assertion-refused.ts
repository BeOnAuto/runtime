export class AssertionRefused extends Error {
  readonly code: string;

  constructor(code: string) {
    super(`The authorization server answered ${code} when asked for a token`);
    this.code = code;
  }
}
