import { describe, expect, it } from 'vitest';

import { adding, crm, crmKeyHelp, issuesIn, notes } from '../testing/additions.ts';
import { harness } from '../testing/harness.ts';

const { instructions: _instructions, key_page: _keyPage, ...unexplained } = crm.credential;

function withKey(credential: Readonly<Record<string, unknown>>) {
  return { ...crm, credential: { ...crm.credential, ...credential } };
}

describe('a secret given by hand', () => {
  it('is refused without the instructions and the key page the person reads, in words that say what to write', async () => {
    expect(issuesIn(await adding(harness(), { ...crm, credential: unexplained }))).toEqual([
      {
        pointer: '/credential/instructions',
        detail:
          'Expected instructions, which a secret credential given by hand takes: in Markdown, where the person makes the key, with a link to that page, the plan or role it needs, the permissions it needs and its format',
      },
      {
        pointer: '/credential/key_page',
        detail:
          'Expected key_page, which a secret credential given by hand takes: the https address of the page where the person makes the key',
      },
    ]);
  });

  it('is added with how its key is made beside the rest of its credential, which the fact keeps and the answer holds', async () => {
    const h = harness();
    const credential = { ...crm.credential, example: 'crm_…', pattern: '^crm_\\w+$' };

    const outcome = await adding(h, { ...crm, credential });
    const [fact] = await h.facts();

    expect(outcome).toMatchObject({ status: 'succeeded', output: { credential } });
    expect(fact).toMatchObject({ type: 'connection_added', data: { credential } });
  });
});

describe('how a key given by hand is made', () => {
  it('is refused where it is no Markdown of at most 1,000 characters without HTML, its page no https page, its example no example, or its pattern no pattern the runtime takes', async () => {
    const refused = await Promise.all(
      [
        { instructions: '<b>Settings</b>' },
        { instructions: 'a'.repeat(1001) },
        { key_page: 'http://crm.example.com/settings/keys' },
        { example: 'crm_4f9c2b1e8a7d' },
        { pattern: '^(crm|key)_\\w+$' },
      ].map(async (field: Readonly<Record<string, string>>) => issuesIn(await adding(harness(), withKey(field)))),
    );

    expect(refused.map((issues) => issues.map(({ pointer }) => pointer))).toEqual([
      ['/credential/instructions'],
      ['/credential/instructions'],
      ['/credential/key_page'],
      ['/credential/example'],
      ['/credential/pattern'],
    ]);
  });

  it('is said of a key alone, so a credential of another kind is refused it, consent given by hand in its own words', async () => {
    const consent = { name: 'files', type: 'mcp', entry: { url: 'https://files.example.com/mcp' } };

    const refused = [
      issuesIn(await adding(harness(), { ...notes, credential: { kind: 'none', ...crmKeyHelp } })),
      issuesIn(await adding(harness(), { ...consent, credential: { kind: 'authorization', example: 'fls_…' } })),
    ];

    expect(refused).toEqual([
      [
        {
          pointer: '/credential/instructions',
          detail: 'Expected no instructions: a none credential takes no other field',
        },
        { pointer: '/credential/key_page', detail: 'Expected no key_page: a none credential takes no other field' },
      ],
      [
        {
          pointer: '/credential/example',
          detail: "Expected no example: the person signs in at the server's authorization server, so no key is made",
        },
      ],
    ]);
  });
});
