import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { messageIdOf, streamPrefixOfPlaybook, textToKeep } from '../index.ts';
import { acmeAdmin, globexAdmin } from '../testing/callers.ts';
import { harness, toPlaybook } from '../testing/harness.ts';
import { addNote, readNoteContent, readNoteEvent } from '../testing/notes.ts';

const toAlpha = toPlaybook('acme', 'alpha');

const toGamma = toPlaybook('globex', 'gamma');

describe('the read of one event, bound to a call', () => {
  it('reads an event of the playbook of the call by its id, its stream relative to the playbook, and none of another', async () => {
    const { dispatcher, run } = harness();
    await run(
      dispatcher.dispatchToPlaybook(addNote.registration, toAlpha(acmeAdmin, { name: 'anvil', text: 'heavy' })),
    );
    await run(
      dispatcher.dispatchToPlaybook(addNote.registration, toGamma(globexAdmin, { name: 'gear', text: 'round' })),
    );
    const ofAlpha = messageIdOf(`${streamPrefixOfPlaybook({ org: 'acme', playbook: 'alpha' })}notes`, 1);
    const ofGamma = messageIdOf(`${streamPrefixOfPlaybook({ org: 'globex', playbook: 'gamma' })}notes`, 1);

    expect(
      await Promise.all(
        [ofAlpha, ofGamma].map((id) =>
          run(dispatcher.dispatchToPlaybook(readNoteEvent.registration, toAlpha(acmeAdmin, { id }))),
        ),
      ),
    ).toEqual([
      { status: 'succeeded', output: { stream: 'notes', by: 'tester' } },
      { status: 'succeeded', output: { stream: null, by: null } },
    ]);
  });
});

describe('the read of a recorded content, bound to a call', () => {
  it('reads a content of the playbook of the call by its digest, and none of another playbook', async () => {
    const { dispatcher, ledger, run } = harness();
    const [digest, other] = await Promise.all([
      Effect.runPromise(
        Effect.map(
          ledger.service.content.put({ org: 'acme', playbook: 'alpha' }, textToKeep('{"rows":[]}', 'application/json')),
          ({ sha256 }) => sha256,
        ),
      ),
      Effect.runPromise(
        Effect.map(
          ledger.service.content.put({ org: 'globex', playbook: 'gamma' }, textToKeep('{}', 'application/json')),
          ({ sha256 }) => sha256,
        ),
      ),
    ]);

    expect(
      await Promise.all(
        [digest, other].map((sha256) =>
          run(dispatcher.dispatchToPlaybook(readNoteContent.registration, toAlpha(acmeAdmin, { sha256 }))),
        ),
      ),
    ).toEqual([
      { status: 'succeeded', output: { text: '{"rows":[]}' } },
      { status: 'succeeded', output: { text: null } },
    ]);
  });
});
