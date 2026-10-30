import { describe, expect, it } from 'vitest';

import { closedAfterTheTest } from '../testing/scratch.ts';
import { cacheDirectory, modelPorts } from './model-ports.ts';

describe('the ports of the models of a server', () => {
  it('keep their files under /var/tmp/auto-runtime by default, with as many scoring permits as builds score at once', () => {
    const ports = modelPorts({ pool: closedAfterTheTest(3), scoringAtOnce: 1 });
    const first = ports.permits.take();

    expect([cacheDirectory, first === null, ports.permits.take()]).toEqual(['/var/tmp/auto-runtime', false, null]);
  });
});
