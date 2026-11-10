import { describe, expect, it } from 'vitest';

import { DefinitionTextUnread } from '../payloads/kept-texts.ts';
import { refusedToAnswerFor, refusedToRunFor } from './unread-texts.ts';

const greet = { name: 'greet', version: 3 };

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
        kind: 'unworkable',
        detail: 'The workflow greet at version 3 cannot run: its document was erased; update it',
      },
      {
        _tag: 'conflict',
        kind: 'unworkable',
        detail:
          'The overview of version 3 of the workflow greet was erased; update_definition saves the workflow again with one',
      },
      {
        _tag: 'conflict',
        kind: 'unworkable',
        detail:
          'The workflow greet was paused, but the overview of version 3 of the workflow greet was erased; update_definition saves the workflow again with one',
      },
    ]);
  });
});
