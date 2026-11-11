import { describe, expect, it } from 'vitest';

import { DefinitionTextUnread } from '../payloads/kept-texts.ts';
import { refusedToAnswerFor, refusedToRunFor } from './unread-texts.ts';

const greet = { name: 'greet', version: 3 };

describe('a text of a definition the store does not give just now', () => {
  const unread = new DefinitionTextUnread({ name: 'source', because: 'unavailable' });

  it('says a pause, a resumption, a retirement and a restoration it made are saved and shown once storage responds', () => {
    expect([
      refusedToAnswerFor('workflow', greet, 'paused')(unread).detail,
      refusedToAnswerFor('workflow', greet, 'resumed')(unread).detail,
      refusedToAnswerFor('reasoning', greet, 'retired')(unread).detail,
      refusedToAnswerFor('reasoning', greet, 'restored')(unread).detail,
    ]).toEqual([
      "Saved. The workflow greet was paused, but storage didn't respond, so it can't be shown yet. Refresh in a moment to check the current status.",
      "Saved. The workflow greet was resumed, but storage didn't respond, so it can't be shown yet. Refresh in a moment to check the current status.",
      "Saved. The reasoning function greet was retired, but storage didn't respond, so it can't be shown yet. Refresh in a moment to check the current status.",
      "Saved. The reasoning function greet was restored, but storage didn't respond, so it can't be shown yet. Refresh in a moment to check the current status.",
    ]);
  });

  it('says a definition created or saved, and one only read, as before', () => {
    expect([
      refusedToAnswerFor('workflow', greet, 'created')(unread).detail,
      refusedToAnswerFor('workflow', greet, 'saved')(unread).detail,
      refusedToAnswerFor('workflow', greet)(unread).detail,
    ]).toEqual([
      'The workflow greet was created, but its document, which the playbook keeps outside its record, could not be read just now to answer with it; get_definition reads it again in a moment',
      'The workflow greet was saved, but its document, which the playbook keeps outside its record, could not be read just now to answer with it; get_definition reads it again in a moment',
      'The document of the workflow greet, which the playbook keeps outside its record, could not be read just now; ask again in a moment',
    ]);
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
