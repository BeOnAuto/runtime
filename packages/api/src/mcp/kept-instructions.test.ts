import { describe, expect, it } from 'vitest';

import { callerTheInstructionsHold } from '../bounds/served-bounds.ts';
import { definitionTypes, everyEndpoint } from '../testing/served-instructions.ts';
import { instructionsActingAs, instructionsFor } from './instructions.ts';

const keptByAMemoryFunction = 'A memory function keeps what the playbook recalls later.';

const withMemory = [...definitionTypes, { type: 'memory', noun: 'memory function', guide: 'memory-function' }];

describe('what the instructions say of what is kept, where the server runs memory functions', () => {
  it('say on every endpoint that a memory function keeps what the playbook recalls later', () => {
    const instructions = everyEndpoint.map(([endpoint, served]) => instructionsFor(endpoint, served, withMemory));

    expect(instructions.filter((text) => !text.includes(keptByAMemoryFunction))).toEqual([]);
  });
});

describe('the length of the instructions of a server that runs memory functions beside the others', () => {
  it('take 1,248 characters on /mcp, 1,249 on the org endpoint and 979 on the playbook endpoint, and 1,378, 1,379 and 1,109 with the opening line of the person the bound holds', () => {
    const opened = everyEndpoint.map(
      ([endpoint, served]) =>
        instructionsActingAs(callerTheInstructionsHold, endpoint, served, { definitionTypes: withMemory, pages: false })
          .length,
    );

    expect(everyEndpoint.map(([endpoint, served]) => instructionsFor(endpoint, served, withMemory).length)).toEqual([
      1249, 979, 1248,
    ]);
    expect(opened).toEqual([1379, 1109, 1378]);
  });
});
