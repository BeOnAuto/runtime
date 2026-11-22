import type { ModelResult } from '@on.auto/reasoning';

export const MOST_TURN_INPUT_TOKENS = 2_000_000;

export const MOST_REQUEST_INPUT_TOKENS = 180_000;

const BYTES_A_TOKEN = 1;

const utf8 = new TextEncoder();

interface Answered {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly bytesPerToken: number;
}

export interface InputSpent {
  readonly tokens: number;
  readonly last: Answered | undefined;
}

export interface NextCall {
  readonly resultBytes: number;
  readonly requestBytes: number;
  readonly leftOut: boolean;
}

export const nothingSpent: InputSpent = { tokens: 0, last: undefined };

const inputTokensOf = ({ usage, request_bytes: sentBytes }: ModelResult): number =>
  usage.input.total ?? Math.ceil(sentBytes / BYTES_A_TOKEN);

const outputTokensOf = ({ usage, response }: ModelResult): number =>
  usage.output.total ?? Math.ceil(utf8.encode(response).byteLength / BYTES_A_TOKEN);

export function spentAfter(spent: InputSpent, result: ModelResult): InputSpent {
  const inputTokens = inputTokensOf(result);
  const bytesPerToken =
    inputTokens > 0 && result.request_bytes > 0 ? result.request_bytes / inputTokens : BYTES_A_TOKEN;
  return {
    tokens: spent.tokens + inputTokens,
    last: { inputTokens, outputTokens: outputTokensOf(result), bytesPerToken },
  };
}

export const requestTokensOf = (spent: InputSpent, requestBytes: number): number =>
  Math.ceil(requestBytes / (spent.last?.bytesPerToken ?? BYTES_A_TOKEN));

export function tokensAfterTheNextCall(spent: InputSpent, { resultBytes, requestBytes, leftOut }: NextCall): number {
  if (spent.last === undefined) {
    return requestBytes / BYTES_A_TOKEN;
  }
  if (leftOut) {
    return spent.tokens + requestTokensOf(spent, requestBytes);
  }
  const { inputTokens, outputTokens, bytesPerToken } = spent.last;
  return spent.tokens + inputTokens + outputTokens + resultBytes / bytesPerToken;
}
