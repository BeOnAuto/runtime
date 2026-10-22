import { describe, expect, it } from 'vitest';

import { measuredEnvironment } from './measured-environment.ts';

describe('the environment a worker or a process of a test is given', () => {
  it('holds the folder the coverage of the run is written to, as the run gives it, and nothing else', () => {
    expect(Object.keys(measuredEnvironment).filter((key) => key !== 'NODE_V8_COVERAGE')).toEqual([]);
    expect(measuredEnvironment['NODE_V8_COVERAGE']).toBe(process.env['NODE_V8_COVERAGE']);
  });
});
