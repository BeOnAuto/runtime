import { describe, expect, it } from 'vitest';

import { testFunctions } from '../testing/driver-inputs.ts';
import { header } from '../testing/workflows.ts';
import { policyOf } from './policy.ts';

const rejectionsOf = policyOf(testFunctions);

const notifying = { call: 'notify', with: { to: 'ops' } };

function callNamed(name: string) {
  return { document: header, do: [{ [name]: notifying }] };
}

function nameOfReferenceBytes(bytes: number): string {
  return 'a'.repeat(bytes - '/do/0/'.length);
}

describe('the reference of a task that starts a run', () => {
  it('may take 256 bytes, the most a reference takes', () => {
    expect(rejectionsOf(callNamed(nameOfReferenceBytes(256)))).toEqual([]);
  });

  it('is refused at its pointer one byte past that, in words that say why and what to shorten', () => {
    const name = nameOfReferenceBytes(257);
    const pointer = `/do/0/${name}`;

    expect(rejectionsOf(callNamed(name))).toEqual([
      {
        pointer,
        detail: `The reference of this task, ${pointer.slice(0, 120)}…, takes 257 bytes, more than the 256 a reference may take, since a run the task starts carries it; shorten its name or the names above it`,
        forbidden: false,
      },
    ]);
  });

  it('is shown cut at a whole character within 120 bytes', () => {
    const name = '𝄞'.repeat(70);

    expect(rejectionsOf(callNamed(name)).map(({ detail }) => detail)).toEqual([
      `The reference of this task, /do/0/${'𝄞'.repeat(28)}…, takes 286 bytes, more than the 256 a reference may take, since a run the task starts carries it; shorten its name or the names above it`,
    ]);
  });

  it('counts the names above it, since the pointer of a nested task grows with them', () => {
    const outer = 'o'.repeat(240);
    const document = { document: header, do: [{ [outer]: { do: [{ inner: notifying }, { short: { set: {} } }] } }] };

    expect(rejectionsOf(document).map(({ pointer }) => pointer)).toEqual([`/do/0/${outer}/do/0/inner`]);
  });

  it('leaves a task that starts no run to the bounds of the document', () => {
    const name = nameOfReferenceBytes(400);

    expect(rejectionsOf({ document: header, do: [{ [name]: { set: { a: 1 } } }] })).toEqual([]);
  });
});

describe('the names in the reference of a task that starts a run', () => {
  it('are refused when the name of the task holds a character a reference never holds, in words that point at that name', () => {
    expect(rejectionsOf(callNamed('notify\u0000ops'))).toEqual([
      {
        pointer: '/do/0/notify\u0000ops',
        detail:
          'The name of the task at /do/0/notify\u0000ops holds control characters, unpaired surrogates or noncharacters, which a reference never holds',
        forbidden: false,
      },
    ]);
  });

  it('are refused at the pointer of the task for such a character in the name of a task above it, in words that point at that one', () => {
    const document = { document: header, do: [{ 'outer\uFFFEname': { do: [{ inner: notifying }] } }] };

    expect(rejectionsOf(document)).toEqual([
      {
        pointer: '/do/0/outer\uFFFEname/do/0/inner',
        detail:
          'The name of the task at /do/0/outer\uFFFEname holds control characters, unpaired surrogates or noncharacters, which a reference never holds',
        forbidden: false,
      },
    ]);
  });
});
