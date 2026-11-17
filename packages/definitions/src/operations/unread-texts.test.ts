import { describe, expect, it } from 'vitest';

import { DefinitionTextUnread } from '../payloads/kept-texts.ts';
import { refusedToAnswerFor, refusedToRunFor } from './unread-texts.ts';

const someWords: unknown = expect.any(String);

const greet = { name: 'greet', version: 3 };

describe('a text of a definition the store does not give just now', () => {
  const unread = new DefinitionTextUnread({ name: 'source', because: 'unavailable' });

  it('says a pause, a resumption, a retirement and a restoration it made are saved and shown once storage responds', () => {
    expect([
      refusedToAnswerFor('workflow', greet, 'paused')(unread).detail,
      refusedToAnswerFor('workflow', greet, 'resumed')(unread).detail,
      refusedToAnswerFor('reasoning', greet, 'retired')(unread).detail,
      refusedToAnswerFor('reasoning', greet, 'restored')(unread).detail,
    ]).toEqual([expect.any(String), expect.any(String), expect.any(String), expect.any(String)]);
  });

  it('says a definition created or saved, and one only read, as before', () => {
    expect([
      refusedToAnswerFor('workflow', greet, 'created')(unread).detail,
      refusedToAnswerFor('workflow', greet, 'saved')(unread).detail,
      refusedToAnswerFor('workflow', greet)(unread).detail,
    ]).toEqual([expect.any(String), expect.any(String), expect.any(String)]);
  });
});

describe('a text of a definition its playbook erased', () => {
  it('refuses a run of its version, and an answer that would hold it, saying it was erased and how to save it again', () => {
    const erased = new DefinitionTextUnread({ name: 'overview', because: 'erased' });

    expect([
      refusedToRunFor('workflow', greet)(new DefinitionTextUnread({ name: 'source', because: 'erased' })),
      refusedToAnswerFor('workflow', greet)(erased),
      refusedToAnswerFor('workflow', greet, 'paused')(erased),
    ]).toMatchObject([
      {
        _tag: 'conflict',
        because: 'workflow_document_missing',
        detail: someWords,
      },
      {
        _tag: 'conflict',
        kind: 'unworkable',
        detail: someWords,
      },
      {
        _tag: 'conflict',
        kind: 'unworkable',
        detail: someWords,
      },
    ]);
  });
});
