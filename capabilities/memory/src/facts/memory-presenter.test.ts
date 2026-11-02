import { nothingKept } from '@on.auto/operations/testing';
import { describe, expect, it } from 'vitest';

import type { MemoryFact } from './memory-fact-schema.ts';
import { memoryFacts, memoryPresenter } from './memory-presenter.ts';

const acted = { at: '2026-10-01T09:00:00.000Z', by: 'acme-admin' };

function shown(fact: MemoryFact) {
  return memoryPresenter.present(
    {
      id: 'event-1',
      causationId: null,
      correlationId: null,
      stream: 'memories/019a3c4e-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
      version: 1,
      globalPosition: 3,
      type: fact.type,
      data: fact.data,
      context: acted,
      recordedAt: acted.at,
    },
    nothingKept,
  );
}

describe('the facts of a memory, as the playbook events show them', () => {
  it('say what was remembered, which version it replaces and whether its text was erased since', () => {
    expect([
      shown({ type: 'memory_remembered', data: { version: 1, text: 'Ship on Thursdays', tags: ['releases'] } }),
      shown({
        type: 'memory_remembered',
        data: { version: 2, text: null, erased_at: acted.at, tags: [], replaces_version: 1 },
      }),
    ]).toEqual([
      [
        {
          type: 'memory_remembered',
          summary: 'A memory was remembered, as its version 1.',
          data: { version: 1, text: 'Ship on Thursdays', tags: ['releases'] },
        },
      ],
      [
        {
          type: 'memory_remembered',
          summary: 'A memory was remembered, as its version 2, which replaces version 1, whose text was erased since.',
          data: { version: 2, text: null, erased_at: acted.at, tags: [], replaces_version: 1 },
        },
      ],
    ]);
  });
});

describe('the facts that end a memory, as the playbook events show them', () => {
  it('say that a memory was forgotten, erased or moved, and into which playbook', () => {
    expect([
      shown({ type: 'memory_forgotten', data: { version: 2 } }),
      shown({ type: 'memory_forgotten', data: { version: 0 } }),
      shown({ type: 'memory_erased', data: { version: 2 } }),
      shown({ type: 'memory_moved', data: { to: 'organization', as: 'memory-2' } }),
      shown({ type: 'memory_moved', data: { to: 'playbook', as: 'memory-3', playbook: 'alpha' } }),
    ]).toEqual([
      [{ type: 'memory_forgotten', summary: 'The memory was forgotten, at its version 2.', data: { version: 2 } }],
      [
        {
          type: 'memory_forgotten',
          summary:
            'The memory was forgotten before a version of it was kept, since the memory it was moved from was erased.',
          data: { version: 0 },
        },
      ],
      [{ type: 'memory_erased', summary: 'The text of version 2 of the memory was erased.', data: { version: 2 } }],
      [
        {
          type: 'memory_moved',
          summary: "The memory was moved to the organization's memories, as memory-2.",
          data: { to: 'organization', as: 'memory-2' },
        },
      ],
      [
        {
          type: 'memory_moved',
          summary: 'The memory was moved to the memories of the playbook alpha, as memory-3.',
          data: { to: 'playbook', as: 'memory-3', playbook: 'alpha' },
        },
      ],
    ]);
  });

  it('are declared on the stream kind of memories, none of them on a run, each under its own name', () => {
    expect(memoryFacts).toEqual({ onRuns: [], streams: [memoryPresenter] });
    expect(memoryPresenter.streamKind).toBe('memories');
    expect(Object.keys(memoryPresenter.publicNames)).toEqual([
      'memory_remembered',
      'memory_forgotten',
      'memory_erased',
      'memory_moved',
    ]);
  });
});
