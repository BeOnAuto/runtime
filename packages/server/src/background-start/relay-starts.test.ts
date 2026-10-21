import { describe, expect, it } from 'vitest';

import { computerWith, startingOn } from '../testing/relays/fake-starting.ts';
import { impatient, runningRuntime } from './background-start.ts';

describe('what the relay of an agent sees and starts on the port', () => {
  it('sees each answer of the port, and remembers the runtime it started', async () => {
    const computer = computerWith();

    await runningRuntime(5555, startingOn(computer), impatient);

    expect(computer.sightings()).toEqual(['down', 'remembered 4343', 'running']);
  });

  it('says the runtime did not start when the one it started ended before it answered', async () => {
    const computer = computerWith();

    await expect(
      runningRuntime(5555, startingOn(computer, { startsAs: undefined, endsAtItsStart: true }), impatient),
    ).resolves.toEqual({
      words: 'Auto Runtime did not start on port 5555; its log is /Users/ada/.auto-runtime/runtime.log',
    });
    expect(computer.events()).toEqual(['locked', 'started', 'unlocked']);
  });

  it('says another runtime took the port first when the one it started ended while another answers there', async () => {
    const computer = computerWith();

    await expect(runningRuntime(5555, startingOn(computer, { endsAtItsStart: true }), impatient)).resolves.toEqual({
      words:
        'Another Auto Runtime took port 5555 first, so the one this connection started ended. Send the request again: it goes to the one on the port.',
      anotherAnswers: true,
    });
    expect(computer.events()).toEqual(['locked', 'started', 'unlocked']);
  });

  it('starts none while the runtimes it started keep ending soon after their start, and says so', async () => {
    const computer = computerWith();

    await expect(runningRuntime(5555, startingOn(computer, { pausing: true }), impatient)).resolves.toEqual({
      words:
        'Auto Runtime stopped soon after each of the last 3 times this connection started it, within 10 minutes, so it starts it no more until those minutes have passed. Ask the person to read /Users/ada/.auto-runtime/runtime.log, which says why, and to fix what it says.',
    });
    expect(computer.events()).toEqual([]);
  });
});
