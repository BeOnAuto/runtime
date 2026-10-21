import type { FetchLike } from '@modelcontextprotocol/client';
import { Function } from 'effect';

import { hearingFetch } from '../index.ts';

export interface AnswersHeard {
  readonly fetch: FetchLike;
  readonly heard: (text: string) => Promise<void>;
}

interface Awaited {
  readonly text: string;
  readonly heard: () => void;
}

export function answersHeard(): AnswersHeard {
  const decoder = new TextDecoder();
  const awaited: Awaited[] = [];
  const said = { text: '' };
  const told = () => {
    for (const waiter of awaited.filter(({ text }) => said.text.includes(text))) {
      awaited.splice(awaited.indexOf(waiter), 1);
      waiter.heard();
    }
  };
  return {
    heard: (text) => {
      const { promise, resolve } = Promise.withResolvers<void>();
      awaited.push({ text, heard: resolve });
      told();
      return promise;
    },
    fetch: hearingFetch(fetch, () => ({
      piece: (piece) => {
        said.text += decoder.decode(piece, { stream: true });
        told();
      },
      ended: Function.constVoid,
    })),
  };
}
