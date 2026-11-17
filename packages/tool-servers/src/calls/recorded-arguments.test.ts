import { memoryRecordedContent } from '@on.auto/content/testing';
import { Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { recordingPartsOf, startedOn } from '../access/entry-reads.ts';

const key = 'graph-api-key-4f1d9a7c2b';

const quoted = 'graph-api-key"4f1d/9a7c~2b+';

const keyedProto: Readonly<Record<string, unknown>> = Object.fromEntries(
  new Map<string, unknown>([
    ['__proto__', { a: 1 }],
    ['b', 2],
  ]),
);

interface Recorded {
  readonly named: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly secret: string;
  readonly bytes: number;
  readonly sha256: string;
}

const recordedBeforeTheyWereRenderedOnce: readonly Recorded[] = [
  {
    named: 'a page written to a repository',
    input: { path: 'guide.md', branch: 'main', content: '# The guide\n\nEach section explains one step.\n' },
    secret: key,
    bytes: 96,
    sha256: 'eadd8451f5c3d623d5c117076cfcf79d9f258d9ac013a380c068f153b33795ff',
  },
  {
    named: 'text that JSON escapes, numbers and a list',
    input: {
      text: 'é ✓ \u{1D11E} "quoted" \\ back\u0001 ',
      zero: -0,
      big: 1e21,
      small: 5e-7,
      list: [1, 'two', null, true, { nested: 'x' }],
    },
    secret: key,
    bytes: 126,
    sha256: '567d4403a5f8f3447e3eff0b3c4fdceebe94c8802c8b9e869b5903174b4b5a30',
  },
  {
    named: 'keys a number names, written after others',
    input: { b: 1, '10': 2, '2': 3, a: [] },
    secret: key,
    bytes: 27,
    sha256: '0cee3e5a660994ec19522b68800ca0ccb4fba5f8fba6c4910b16b6d2f154a668',
  },
  {
    named: 'half a character alone',
    input: { lone: '\uD834 and \uDD1E' },
    secret: key,
    bytes: 28,
    sha256: '7717763caac0bcafcb3a6279cb2d3ac6c78689fe7ec62f1b076b3f382ec3becd',
  },
  {
    named: 'a key named __proto__',
    input: keyedProto,
    secret: key,
    bytes: 27,
    sha256: '8d6c652f4aa72c9b091d3bbace50453a7acf63914c029720b36c6feb1db06324',
  },
  {
    named: 'a secret in a value',
    input: { header: `Bearer ${key}`, note: 'no secret here' },
    secret: key,
    bytes: 54,
    sha256: 'd21ce7f83d1390a24a4fc2f5f1ebdb1398397463c190d7396ba02ec2f1234199',
  },
  {
    named: 'a secret JSON escapes, in a value and in a key',
    input: { said: `the key is ${quoted}`, [quoted]: 'as a key' },
    secret: quoted,
    bytes: 56,
    sha256: '09b6376d1ff272f7e34faabfd3ced68b2b09a4684f089c2258859048112cdad8',
  },
  {
    named: 'a number whose digits are a secret',
    input: { pin: 31_415_926_535, other: 7 },
    secret: '31415926535',
    bytes: 30,
    sha256: 'cab28af7417b3f34ceaae912742078926752ac9c950d76758129748a592f843c',
  },
];

describe('the arguments a call records, rendered once', () => {
  it.each(recordedBeforeTheyWereRenderedOnce)(
    'are $named, the same bytes and digest as before',
    async ({ input, secret, bytes, sha256 }) => {
      const parts = recordingPartsOf([], memoryRecordedContent(), [Redacted.make(secret)]);
      const call = { org: 'acme', playbook: 'alpha', reference: { server: 'graph', tool: 'save' }, input };

      const fields = await startedOn({ record_content: true, connection: null }, call, parts);

      expect(fields).toEqual({ server: 'graph', tool: 'save', arguments_bytes: bytes, arguments_sha256: sha256 });
    },
  );
});
