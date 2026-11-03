import { describe, expect, it } from 'vitest';

import { uuidV5 } from './uuid-v5.ts';

const dns = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

const namesOfEveryLength: ReadonlyArray<readonly [string, string]> = [
  ['', '4ebd0208-8328-5d69-8c44-ec50939c0967'],
  ['a', '4f3f2898-69e3-5a0d-820a-c4e87987dbce'],
  ['é', 'ebfe0af8-3997-5ade-b634-ba92cf69f557'],
  ['😀 run', '88b09bcd-d5e1-54c1-81de-09566c080aac'],
  ['x'.repeat(55), '4c506c2a-c3a2-508b-b2ce-25c3a06bf481'],
  ['y'.repeat(56), '4d280fc6-b05a-5094-b818-94a93e901355'],
  ['z'.repeat(64), 'e7749742-f7ff-5e30-bdfe-cc3db2284dd2'],
  ['w'.repeat(1000), '1ab1bd42-5cdd-51ce-a5d0-24ef6659f2c8'],
];

describe('a UUID version 5', () => {
  it('is the one RFC 9562 gives for a name in a namespace', () => {
    expect(uuidV5(dns, 'www.example.com')).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
  });

  it('is the SHA-1 of the namespace and the name in UTF-8, marked as version 5, for names of every length', () => {
    expect(namesOfEveryLength.map(([name]) => uuidV5(dns, name))).toEqual(namesOfEveryLength.map(([, uuid]) => uuid));
  });
});
