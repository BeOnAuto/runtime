import { sendLessRemedy } from '../bounds/call-bounds.ts';
import { bytesOf } from '../bounds/text-bytes.ts';

const meanings: ReadonlyMap<number, string> = new Map([
  [413, `the request was larger than the server takes; ${sendLessRemedy}`],
  [414, 'the address of the request was longer than the server takes'],
  [431, 'the headers of the request were larger than the server takes'],
]);

export function answeredHttpWords(status: number): string {
  const meaning = meanings.get(status);
  return meaning === undefined
    ? `The tool server answered HTTP ${status}`
    : `The tool server answered HTTP ${status}: ${meaning}`;
}

export function answeredToACall(status: number, input: unknown): string {
  return status === 413
    ? `The tool server answered HTTP 413: the request, with arguments of ${bytesOf(JSON.stringify(input))} bytes as JSON, was larger than the server takes; ${sendLessRemedy}`
    : answeredHttpWords(status);
}

export class AnsweredStatus extends Error {
  readonly status: number;

  constructor(status: number) {
    super(answeredHttpWords(status));
    this.status = status;
  }
}
