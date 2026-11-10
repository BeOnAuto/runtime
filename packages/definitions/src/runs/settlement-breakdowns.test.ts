import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import type { Settlement } from '../index.ts';
import { settledAt, withHandOn } from '../testing/relaying.ts';

describe('a settlement whose output is too large, absent or not JSON', () => {
  it('is a breakdown of the capability that fails the run', async () => {
    const { breakingDown, running, reading } = await withHandOn();
    await running();

    expect(await breakingDown({ status: 'succeeded', output: 'x'.repeat(1_048_576), record: {} })).toEqual(
      new Error('The capability answered with 1048580 bytes to record, more than the 1048576 allowed'),
    );
    expect(await reading()).toMatchObject({ output: { status: 'failed', finished_at: settledAt } });
  });

  it('is a breakdown that fails the run, as before, when a success holds no output at all', async () => {
    const { breakingDown, running, reading } = await withHandOn();
    await running();
    const withoutItsOutput: Settlement = { status: 'succeeded', output: 'dropped', record: {} };
    Reflect.deleteProperty(withoutItsOutput, 'output');

    expect(await breakingDown(withoutItsOutput)).toEqual(
      new Error(
        'The data holds neither output nor output_sha256 and output_bytes, which the schema of a fact that keeps the payload refuses',
      ),
    );
    expect(await reading()).toMatchObject({ output: { status: 'failed', finished_at: settledAt } });
  });

  it('is a breakdown as well when the output is not JSON', async () => {
    const { breakingDown, running, reading } = await withHandOn();
    await running();

    expect(Schema.isSchemaError(await breakingDown({ status: 'succeeded', output: Number.NaN, record: {} }))).toBe(
      true,
    );
    expect(await reading()).toMatchObject({ output: { status: 'failed' } });
  });
});
