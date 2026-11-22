import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ranToItsEnd } from '../src/testing/processes/awaited-children.ts';

const releaseReads = fileURLToPath(new URL('release-reads.ts', import.meta.url));

/**
 * The release runs `release-reads.ts` with node itself, resolving each package's shipped files as an installed
 * package does, so the test runs it as a process too.
 */
describe('the reads a release makes of the files its packages ship', () => {
  it('pass on the sources, the guide shelf among them with each value its pages name declared', async () => {
    const { stdout } = await ranToItsEnd(process.execPath, [releaseReads]);

    expect(stdout).toContain(
      'the guide shelf of a server of workflows and pages, start, terminology, workflow, templates',
    );
  });
});
