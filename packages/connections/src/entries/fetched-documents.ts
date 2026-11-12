import { Unavailable, type Issue } from '@on.auto/operations';

interface Answered {
  readonly statuses: readonly number[];
  readonly unanswered: boolean;
}

export interface Fetching {
  readonly fetch: typeof globalThis.fetch;
  readonly answered: () => Answered;
}

const statusesOfAPassingFailure: ReadonlySet<number> = new Set([408, 429]);

const placedInTheDocument = /^At (.*?) of the document: /u;

const neitherJsonNorYaml = 'The document is neither JSON nor YAML';

const fixedWords = {
  placed: (pointer: string) =>
    `At ${pointer} of the document: not what the runtime reads there in an OpenAPI document of version 3.0 or 3.1`,
  scheme: 'The document declares no security scheme of this name by which a call sends this credential',
  placedByAScheme: 'Placed by a security scheme of the document; give the credential under security alone',
} as const;

export function fetchingThrough(fetch: typeof globalThis.fetch): Fetching {
  const statuses: number[] = [];
  const signals: AbortSignal[] = [];
  const failures: unknown[] = [];
  return {
    fetch: async (...[address, init]: readonly [unknown, unknown?]) => {
      const asked: RequestInit = Object.assign({}, init);
      signals.push(new Request(String(address), asked).signal);
      try {
        const answer = await fetch(String(address), asked);
        statuses.push(answer.status);
        return answer;
      } catch (failure) {
        failures.push(failure);
        throw failure;
      }
    },
    answered: () => ({ statuses, unanswered: failures.length > 0 || signals.some(({ aborted }) => aborted) }),
  };
}

function isAPassingStatus(status: number): boolean {
  return status >= 500 || statusesOfAPassingFailure.has(status);
}

export function passingFailureOf(url: string, { statuses, unanswered }: Answered): Unavailable | undefined {
  const failed = statuses.find((status) => isAPassingStatus(status));
  if (failed !== undefined) {
    return new Unavailable({
      detail: `The document at ${url} cannot be read now: its address answered HTTP ${failed}; try again in a moment`,
    });
  }
  return unanswered
    ? new Unavailable({
        detail: `The document at ${url} cannot be read now: its address did not answer, or not in time; try again in a moment`,
      })
    : undefined;
}

export function withoutFetchedValues({ pointer, detail }: Issue): Issue {
  const placed = placedInTheDocument.exec(detail)?.[1];
  if (placed !== undefined) {
    return { pointer, detail: fixedWords.placed(placed) };
  }
  if (pointer === '/credential/name') {
    return { pointer, detail: fixedWords.scheme };
  }
  if (pointer.startsWith('/entry/headers/')) {
    return { pointer, detail: fixedWords.placedByAScheme };
  }
  return { pointer, detail: detail.startsWith(neitherJsonNorYaml) ? neitherJsonNorYaml : detail };
}
