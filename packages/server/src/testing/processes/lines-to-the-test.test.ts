import { describe, expect, it } from 'vitest';

import { lineToTheTest } from '../entries/line-to-the-test.ts';
import { aLineToTheTest } from './lines-to-the-test.ts';

const goesOn: Promise<unknown> = new Promise(() => {});

describe('a line a process says what it did on, to its test', () => {
  it('answers each line once it was said, whole, however the writes split it, before or after the test asks', async () => {
    const line = await aLineToTheTest();
    const saying = lineToTheTest(line.environment.TOLD_ON_PORT);
    const startedAsked = line.said('started', goesOn);

    saying.write('sta');
    saying.write('rted\nsigt');
    saying.write('erm\n');

    await expect(Promise.all([startedAsked, line.said('sigterm', goesOn)])).resolves.toEqual([undefined, undefined]);
    saying.destroy();
  });

  it('fails at once, naming the line, where the process ended before it said it', async () => {
    const line = await aLineToTheTest();

    await expect(line.said('started', Promise.resolve())).rejects.toThrow('The process ended before it said started');
  });
});
