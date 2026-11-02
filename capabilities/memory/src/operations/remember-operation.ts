import { defineCommand } from '@on.auto/operations';
import { Effect } from 'effect';

import { keptHere, type MemoryPorts } from '../capability/memory-ports.ts';
import { distinctTags, expiresAfter } from '../document/memory-bounds.ts';
import type { AskedMemory } from '../facts/memory-decider.ts';
import { kept, readyToRemember } from '../remember/remembering.ts';
import { actingNow, admitted } from './agent-actions.ts';
import { RememberInputSchema } from './memory-fields.ts';
import { RememberedSchema } from './memory-outputs.ts';

const description = [
  'Keeps one thing the playbook should know from now on, as a memory its functions and its agent recall later, for anyone who uses the playbook: not your own notes.',
  'Use it when the person says what to keep, or the work turns up a fact, a decision or a preference worth keeping.',
  "`scope` is playbook by default, for what is learned about this playbook's own work; write organization when the fact is about the team or the business rather than this playbook's work, so every playbook of the organization recalls it.",
  '`text` is what to remember, at most 2,000 characters; `tags` at most 8 words to recall it by; `about` the days it is about; `expires` how long to keep it, such as P30D.',
  '`replaces` is the id of a memory this one corrects, which recall then answers in its place.',
].join(' ');

type RememberInput = typeof RememberInputSchema.Type;

function memoryOf({ text, tags = [], about, expires }: RememberInput, now: string): AskedMemory {
  const expiresAt = expires === undefined ? undefined : expiresAfter(expires, Date.parse(now));
  return {
    text,
    tags: distinctTags(tags),
    ...(about === undefined ? {} : { about }),
    ...(expiresAt === undefined ? {} : { expiresAt }),
  };
}

export function defineRemember(ports: MemoryPorts) {
  return defineCommand('playbook', {
    name: 'remember',
    title: 'Remember something',
    description,
    route: { method: 'POST', path: '/memories' },
    inputSchema: RememberInputSchema,
    outputSchema: RememberedSchema,
    reasons: ['invalid_input', 'not_found', 'conflict', 'unavailable'],
    handle: Effect.fnUntraced(function* (input: RememberInput) {
      const scope = input.scope ?? 'playbook';
      yield* keptHere(ports, scope, '/scope');
      const action = yield* actingNow;
      const { place, acting } = action;
      const memory = memoryOf(input, acting.context.at);
      const replaces = input.replaces !== undefined;
      const asked = { memory, scope, id: input.replaces ?? ports.newId(), replaces };
      yield* readyToRemember(ports, place, asked, acting);
      yield* admitted(action, 'remember', replaces ? ports.newId() : asked.id);
      return yield* kept(ports, place, asked, acting);
    }),
    plainLanguage: {
      task: 'remember something',
      attempt: () => 'remember it',
      outcome: ({ version }) =>
        version === 1
          ? 'The playbook remembers it now, and recall finds it.'
          : `The playbook remembers it now as version ${version} of the memory, which recall finds in place of the version before.`,
    },
  });
}
