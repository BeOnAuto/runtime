import { describe, expect, it } from 'vitest';

import { personIdOf } from './signed-in-people.ts';

const pinned: ReadonlyArray<readonly [string, string, string]> = [
  [
    'https://login.example.com/acme',
    '248289761001',
    '83f8bacd8d76fa75e99f5c9f61599419c6647d9aebe50b453a89da169899d6e1',
  ],
  [
    'https://login.example.com/acme/',
    '248289761001',
    '254d9e86ff0a8209fc9d4416b0201784190f0cfff117b79f4ed4c507ae90721d',
  ],
  ['https://login.example.com/acme', 'Ada', '0c3de111680d66bea9b377080ec7d6784c7602c7bc2e4bfdd1b3ee489b0675ea'],
  ['https://login.example.com/acme', 'ada', '5b16439885527aaf69870ad180e109af39b1c7b102b5c633883b71b467447a62'],
  ['https://idp.example.org/x', 'y', '6a6c0d2da77b08f07f7793000c37036bee8d92c7160cfb3fb4f346070443168d'],
  ['https://idp.example.org/', 'xy', '9849658b7a136bfc2eec984326184181dfc95accff8145a37c5342aa26eb376c'],
  ['https://idp.example.org', 'a"b\\c', 'fe0869028663df379c0f179475ac6c475790d78d2e4d08165b187009368d11a5'],
  ['https://idp.example.org', 'Zoë', '53bb389bf7557bd1f95d6e1b0c590ec3d43fcde29edd6296a6f24e16efde62a1'],
];

describe("the id of a person who signed in at the company's identity provider", () => {
  it.each(pinned)(
    'is the lowercase hexadecimal SHA-256 of the UTF-8 octets of the JSON array of %j and %j, as given',
    (issuer, subject, id) => {
      expect(personIdOf({ issuer, subject })).toBe(id);
    },
  );
});
