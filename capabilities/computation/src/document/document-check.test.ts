import { savedIn } from '@on.auto/definitions/testing';
import { InvalidInput, Unavailable } from '@on.auto/operations';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { campaignPace } from '../testing/campaign-pace.ts';
import { computationWith, functionOf, poolOf, programDocument } from '../testing/computation-runs.ts';

const frontMatter = [
  'language: typescript',
  'input:',
  '  schema: { type: object, required: [period], properties: { period: { type: integer } } }',
  'output:',
  '  schema: { type: object, required: [total], properties: { total: { type: number } } }',
].join('\n');

const keeping = 'let kept = 0;\nexport default function (input: Input): Output {\n  return { total: kept };\n}';

function checking(source: string) {
  const { prepared } = computationWith();
  return Effect.runPromiseExit(prepared(source).check(savedIn));
}

describe('the check of a computation function when it is saved', () => {
  it('accepts the example of the reference, and a program over any JSON when the document has no schemas, answering each stripped of its types', async () => {
    const strippedExample: unknown = expect.stringContaining('export default function (input       )         {');

    expect(await checking(campaignPace)).toEqual(Exit.succeed({ module: strippedExample }));
    expect(await checking(programDocument(functionOf('return input;')))).toEqual(
      Exit.succeed({ module: 'export default function (input     )      {\n  return input;\n}' }),
    );
  });
});

function textOf(body: string): string {
  return programDocument(
    `export default function (input: Input): Output {\n  ${body}\n}`,
    'language: typescript\noutput: {shape: text}',
  );
}

describe('the check of a computation function whose output names a shape', () => {
  it('checks its program against the type of the shape', async () => {
    expect(await checking(textOf("return { text: '# Done' };"))).toMatchObject(Exit.succeed({}));
    expect(await checking(textOf('return { text: 1 };'))).toMatchObject(
      Exit.fail({ detail: 'The computation function definition has a problem' }),
    );
  });
});

describe('the check of a computation function that has problems', () => {
  it('refuses its program’s problems at their lines in the document, with the compiler’s words', async () => {
    const program = [
      'export default function (input: Input): Output {',
      '  const days = input.perod;',
      '  return { total: days, extra: true };',
      '}',
    ].join('\n');

    expect(await checking(programDocument(program, frontMatter))).toEqual(
      Exit.fail(
        new InvalidInput({
          detail: 'The computation function definition has 2 problems',
          issues: [
            { pointer: '', detail: "Line 9: Property 'perod' does not exist on type 'Input'. Did you mean 'period'?" },
            {
              pointer: '',
              detail:
                "Line 10: Object literal may only specify known properties, and 'extra' does not exist in type 'Output'.",
            },
          ],
        }),
      ),
    );
  });

  it('refuses a module that keeps state, in the words of one problem', async () => {
    expect(await checking(programDocument(keeping, frontMatter))).toEqual(
      Exit.fail(
        new InvalidInput({
          detail: 'The computation function definition has a problem',
          issues: [
            {
              pointer: '',
              detail:
                'Line 8: A module holds its types and its exported functions and nothing else, so that two calls share nothing',
            },
          ],
        }),
      ),
    );
  });
});

describe('a check of a computation function that does not answer', () => {
  it('refuses the document when a ready checker runs past its deadline, and is unavailable when no checker was ready', async () => {
    const pool = poolOf();
    const tooLong = {
      ...pool,
      check: () => Promise.resolve({ ran: 'stopped', because: 'deadline', milliseconds: 2000 } as const),
    };
    const busy = {
      ...pool,
      check: () => Promise.resolve({ ran: 'stopped', because: 'busy', milliseconds: 1 } as const),
    };
    const tooLongToCheck =
      'The document took longer to check than the 2000 ms a save allows; simplify its types or split its program. A busy server may also have slowed the check, so saving it again later may succeed';

    expect(await Effect.runPromiseExit(computationWith(tooLong).prepared(campaignPace).check(savedIn))).toEqual(
      Exit.fail(new InvalidInput({ detail: tooLongToCheck, issues: [{ pointer: '', detail: tooLongToCheck }] })),
    );
    expect(await Effect.runPromiseExit(computationWith(busy).prepared(campaignPace).check(savedIn))).toEqual(
      Exit.fail(
        new Unavailable({
          detail:
            'No checker was ready in time for this save, since this server checks one document at a time with one checker; try again',
        }),
      ),
    );
  });
});
