import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  askedAt,
  keepingPlaybook,
  keptArmOfText,
  keptFunctionName,
  runsStartedIn,
  twoHoursLater,
} from '../testing/kept-documents.ts';
import {
  functionDocumentLongerThanAFactHolds,
  savingAFunction,
  savingOperations,
} from '../testing/saved-definitions.ts';

const { createDefinition, runDefinition, getRun } = savingOperations;

const first = { source: functionDocumentLongerThanAFactHolds('Hi'), overview: 'Greets each guest', diagram: 'none' };

const theKeptFunction = { type: savingAFunction.type, name: keptFunctionName };

const notStarted: unknown = expect.stringContaining('could not be read just now, so no run started');

const decodeRunId = Schema.decodeUnknownSync(
  Schema.Struct({ status: Schema.Literal('succeeded'), output: Schema.Struct({ run_id: Schema.String }) }),
);

describe('a run of a definition whose document its playbook keeps outside its facts', () => {
  it('reads the document once to start, and starts nothing while it cannot be read', async () => {
    const { definitions, watched, asked } = keepingPlaybook();
    await asked(createDefinition, first);

    expect(await asked(runDefinition, { input: { who: 'Ada' } })).toMatchObject({ status: 'succeeded' });
    expect(watched.reads()).toBe(1);
    watched.fail();
    expect(await asked(runDefinition, { input: { who: 'Grace' } })).toMatchObject({
      status: 'rejected',
      reason: 'unavailable',
      detail: notStarted,
    });
    expect(await runsStartedIn(definitions)).toBe(1);
  });

  it('is refused, saying the document is gone and to update the definition, once it is gone', async () => {
    const { definitions, watched, asked } = keepingPlaybook();
    await asked(createDefinition, first);
    watched.lose();

    expect(
      await askedAt(definitions, twoHoursLater)(runDefinition, { ...theKeptFunction, input: { who: 'Grace' } }),
    ).toMatchObject({
      status: 'rejected',
      reason: 'conflict',
      kind: 'unworkable',
      detail:
        "The reasoning function greet-reasoning at version 1 cannot run: its document is missing from the playbook's content; update it",
    });
  });

  it('is answered with its page, which says why it cannot be shown once the document it renders from is gone', async () => {
    const { definitions, watched, asked } = keepingPlaybook();
    await asked(createDefinition, first);
    const ran = decodeRunId(await asked(runDefinition, { input: { who: 'Ada' } }));
    watched.lose();
    const bytes = keptArmOfText(first.source).bytes.toLocaleString('en-US');

    expect(await askedAt(definitions, twoHoursLater)(getRun, { run_id: ran.output.run_id })).toMatchObject({
      status: 'succeeded',
      output: {
        page: {
          result: `The page of reasoning/greet-reasoning could not be shown: its document, ${bytes} bytes, is missing from the playbook's content.`,
        },
      },
    });
  });
});
