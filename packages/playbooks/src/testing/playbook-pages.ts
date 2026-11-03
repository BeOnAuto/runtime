import { InvalidInput, type PlaybookAddress } from '@on.auto/operations';
import { Effect } from 'effect';

import { defineGetPlaybook } from '../operations/get-playbook.ts';
import { playbookOperationsOf } from '../operations/playbook-operations.ts';
import type { PlaybookPage, PlaybookPages } from '../operations/playbook-pages.ts';
import { defineUpdatePlaybook } from '../operations/update-playbook.ts';

export const refusedPage = 'not a page';

const refusal = new InvalidInput({
  detail: 'The page has a problem',
  issues: [{ pointer: '/page', detail: 'Line 1: a page starts with its front matter' }],
});

function keyOf({ org, playbook }: PlaybookAddress): string {
  return `${org}/${playbook}`;
}

export function pagesInMemory(): PlaybookPages {
  const kept = new Map<string, PlaybookPage>();
  const removed = (key: string): PlaybookPage | undefined => {
    kept.delete(key);
    return kept.get(key);
  };
  const saved = (key: string, source: string): PlaybookPage => {
    kept.set(key, { source });
    return { source };
  };
  return {
    pageOf: (address) => Effect.sync(() => kept.get(keyOf(address))),
    save: (address, source) => {
      if (source === refusedPage) {
        return Effect.fail(refusal);
      }
      const key = keyOf(address);
      return Effect.sync(() => (source === null ? removed(key) : saved(key, source)));
    },
  };
}

const keptPages = pagesInMemory();

export const getPlaybook = defineGetPlaybook(keptPages);

export const updatePlaybook = defineUpdatePlaybook(keptPages);

export const playbookOperations = playbookOperationsOf(keptPages);
