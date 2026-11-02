import { describe, expect, it } from 'vitest';

import { callerTheInstructionsHold } from '../bounds/served-bounds.ts';
import { definitionTypes, everyEndpoint } from '../testing/served-instructions.ts';
import { instructionsActingAs, instructionsFor } from './instructions.ts';

const keptInAMemoryFunction = 'Remember what the person wants kept in a memory function, not your notes.';

const withMemory = [...definitionTypes, { type: 'memory', noun: 'memory function', guide: 'memory-function' }];

describe('what the instructions say of what the person wants kept, where the server runs memory functions', () => {
  it('say on every endpoint that it is remembered in a memory function, not in notes', () => {
    const instructions = everyEndpoint.map(([endpoint, served]) => instructionsFor(endpoint, served, withMemory));

    expect(instructions.filter((text) => !text.includes(keptInAMemoryFunction))).toEqual([]);
  });
});

describe('the length of the instructions of a server that runs memory functions beside the others', () => {
  it('take 1,717 characters on /mcp, 1,682 on the org endpoint and 1,350 on the playbook endpoint, and 1,847, 1,812 and 1,480 with the opening line of the person the bound holds', () => {
    const opened = everyEndpoint.map(
      ([endpoint, served]) => instructionsActingAs(callerTheInstructionsHold, endpoint, served, withMemory).length,
    );

    expect(everyEndpoint.map(([endpoint, served]) => instructionsFor(endpoint, served, withMemory).length)).toEqual([
      1682, 1350, 1717,
    ]);
    expect(opened).toEqual([1812, 1480, 1847]);
  });
});
