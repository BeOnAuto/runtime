export class AnsweredStatus extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`The tool server answered HTTP ${status}`);
    this.status = status;
  }
}
