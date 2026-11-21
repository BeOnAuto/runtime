import { readFileSync } from 'node:fs';

import { Conflict } from '@on.auto/operations';
import { Exit, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { campaignPace, campaignRows } from '../testing/campaign-pace.ts';
import { computationWith, functionOf, programDocument, workerPoolOf } from '../testing/computation-runs.ts';

const page = readFileSync(new URL('../../../../docs/reference/computation-format.md', import.meta.url), 'utf8');

const stackLine = String(page.split('\n').find((line) => line.startsWith('| Stack ')));

const deepest = [
  'let deepest = 0;',
  '  const down = (depth: number): number => {',
  '    deepest = depth;',
  '    return down(depth + 1);',
  '  };',
  '  try {',
  '    down(0);',
  '  } catch (error) {',
  '    return [deepest, String(error)];',
  '  }',
  '  return -1;',
].join('\n');

const thousand = 1000;

const decodedAnswer = Schema.decodeUnknownSync(Schema.Struct({ output: Schema.Tuple([Schema.Number, Schema.String]) }));

const decodedOutput = Schema.decodeUnknownSync(Schema.Struct({ output: Schema.Json }));

const answerAlone = { onSuccess: (answer: unknown): unknown => answer, onFailure: (): unknown => null };

describe('the stack of the worker a run takes', () => {
  it('gives a function that calls itself the depth the public reference page names, in whole thousands, the same every time', async () => {
    const ran = await computationWith(workerPoolOf()).running(programDocument(functionOf(deepest)), null);
    const {
      output: [reached, error],
    } = decodedAnswer(Exit.match(ran, answerAlone));
    const named = Number(/About (?<depth>[\d,]+) calls deep/u.exec(stackLine)?.groups?.['depth']?.replaceAll(',', ''));

    expect([Math.floor(reached / thousand) * thousand, error]).toEqual([named, 'InternalError: stack overflow']);
  });

  it('ends in conflict when the stack overflows and the program does not catch it, and the warm worker runs the next program as a fresh one does', async () => {
    const warm = computationWith(workerPoolOf());
    const input = campaignRows(1000);

    const overflowed = await warm.running(
      programDocument(functionOf('const down = (depth: number): number => down(depth + 1);\n  return down(0);')),
      null,
    );
    const afterIt = decodedOutput(Exit.match(await warm.running(campaignPace, input), answerAlone));
    const cold = decodedOutput(
      Exit.match(await computationWith(workerPoolOf()).running(campaignPace, input), answerAlone),
    );

    expect(overflowed).toEqual(
      Exit.fail(
        new Conflict({
          detail: 'The program raised an error on line 5: InternalError: stack overflow',
          kind: 'unworkable',
        }),
      ),
    );
    expect(afterIt).toEqual(cold);
  });
});
