import { describe, expect, it } from 'vitest';

import { valueMatchesIn, type ValueClass, type ValueMatch } from './value-classes.ts';

function found(text: string): { class: ValueClass; value: string }[] {
  return valueMatchesIn(text).map((match) => ({ class: match.class, value: match.value }));
}

function valuesOf(text: string, valueClass: ValueClass): string[] {
  return valueMatchesIn(text)
    .filter((match: ValueMatch) => match.class === valueClass)
    .map(({ value }: ValueMatch) => value);
}

const signed = ['eyJ', 'hbGciOiJIUzI1', '.eyJ', 'zdWIiOiIxMjM0', '.', 'c2lnbmF0dXJlX2hlcmU'].join('');

const tokens = [
  ['gh', 'p_', 'a'.repeat(36)].join(''),
  ['github', '_pat_', 'b'.repeat(40)].join(''),
  ['sk', '_live_', 'c'.repeat(20)].join(''),
  ['AK', 'IA', 'D'.repeat(16)].join(''),
  ['xo', 'xb-', '1'.repeat(10)].join(''),
  ['sk-', 'ant-', 'e'.repeat(80)].join(''),
  ['sk-', 'proj-', 'f'.repeat(80)].join(''),
  ['np', 'm_', 'g'.repeat(36)].join(''),
  ['AI', 'za', 'h'.repeat(35)].join(''),
  ['sk', '_test_', 'c'.repeat(20)].join(''),
  ['wh', 'sec_', 'i'.repeat(24)].join(''),
  ['gl', 'pat-', 'j'.repeat(20)].join(''),
  ['xa', 'pp-1-', 'K'.repeat(10)].join(''),
  ['SG', '.', 'l'.repeat(22), '.', 'm'.repeat(43)].join(''),
  ['ya', '29.', 'n'.repeat(20)].join(''),
  ['Bea', 'rer ', 'o'.repeat(20)].join(''),
  signed,
];

describe('the secrets among values', () => {
  it('find a token or key of a known shape, and a signed token, as a secret', () => {
    for (const token of tokens) expect(valuesOf(`key: ${token}\n`, 'secret')).toEqual([token]);
    const key = ['-----BEGIN ', 'PRIVATE KEY-----\n', 'A'.repeat(64)].join('');
    expect(valuesOf(key, 'secret')).toEqual([key]);
  });

  it('find a URL with a user and password, a parameter named like a credential or a known incoming-webhook host as a secret', () => {
    const secrets = [
      'https://someone:hidden@files.example.com/report',
      'https://api.example.com/v1/items?limit=5&access_token=abc',
      'https://api.example.com/v1/items?apiKey=abc',
      'https://api.example.com/v1/items?X-Amz-Signature=abc',
      'https://api.example.com/v1/items?api_key=abc',
      'https://hooks.slack.com/services/T000/B000/XXX',
      'https://hooks.zapier.com/hooks/catch/1/abc/',
      'https://discord.com/api/webhooks/1/abc',
      'https://ptb.discordapp.com/api/webhooks/1/abc',
      'https://team.webhook.office.com/webhookb2/abc',
      'https://outlook.office.com/webhook/abc',
      'https://maker.ifttt.com/trigger/done/with/key/abc',
      'https://api.example.com/v1/items?pass=abc',
      'postgres://admin:pa/ss@db.example.com/orders',
    ];
    for (const written of secrets) expect(valuesOf(`see ${written} now`, 'secret')).toEqual([written]);
  });

  it('leave a URL with no credential, a webhook host on another path and an empty parameter as an address', () => {
    const addresses = [
      'https://discord.com/channels/1',
      'https://api.example.com/v1/items?design=wide&&=x#top',
      'https://someone@files.example.com/report',
      'https://api.example.com:8443',
      'http://[::1]:8443/status',
    ];
    for (const written of addresses) expect(valuesOf(written, 'secret')).toEqual([]);
  });
});

describe('what is not private', () => {
  it('takes no time zone for a finding, in a schedule or in prose', () => {
    expect(found("schedule:\n  time_zone: America/Los_Angeles\n  at: '09:00'\nIn Europe/London time.")).toEqual([]);
  });
});

describe('a secret written in another spelling', () => {
  it('is found in a URL whose slashes are escaped, as in JSON', () => {
    const hook = String.raw`https:\/\/hooks.slack.com\/services\/T0\/B0\/abc`;
    expect(found(`{"url":"${hook}"}`)).toEqual([
      { class: 'secret', value: hook },
      { class: 'address', value: 'hooks.slack.com' },
    ]);
    const escaped = String.raw`https:\/\/shop.example.com\/orders`;
    const places = valueMatchesIn(escaped).map(({ from, to }) => escaped.slice(from, to));
    expect(places).toEqual([escaped, 'shop.example.com']);
  });

  it('is found in a URL carried inside another, plainly or percent-encoded, and makes the outer one a secret too', () => {
    const inner = 'https://hooks.slack.com/services/T0/B0/abc';
    const outer = `https://example.org/go?next=${inner}`;
    expect(valuesOf(`see ${outer} now`, 'secret')).toEqual([outer, inner]);
    const encoded = `https://example.org/go?next=${encodeURIComponent(inner)}`;
    expect(valuesOf(`see ${encoded} now`, 'secret')).toEqual([encoded]);
    const plain = `https://example.org/go?next=${encodeURIComponent('https://shop.example.com/a')}&bad=%E0%A4%A`;
    expect(valuesOf(plain, 'secret')).toEqual([]);
  });

  it('makes any value that holds a secret a secret, so it cannot be left out or cleared', () => {
    const token = ['gh', 'p_', 'a'.repeat(36)].join('');
    const link = `https://example.org/download/${token}`;
    expect(valuesOf(link, 'secret')).toEqual([link, token]);
  });
});

describe('the addresses among values', () => {
  it('find a URL and its host as two addresses, without the punctuation that ends a sentence', () => {
    expect(found('Write to https://shop.example.com/orders?page=2. Or mail.')).toEqual([
      { class: 'address', value: 'https://shop.example.com/orders?page=2' },
      { class: 'address', value: 'shop.example.com' },
    ]);
    expect(found("source: 'https://events.example.com:8080/in'")).toEqual([
      { class: 'address', value: 'https://events.example.com:8080/in' },
      { class: 'address', value: 'events.example.com' },
    ]);
    expect(found('file:///tmp/notes')).toEqual([{ class: 'address', value: 'file:///tmp/notes' }]);
  });

  it('find an email address as an address', () => {
    expect(found('to: owner.one+news@example.co.uk')).toEqual([
      { class: 'address', value: 'owner.one+news@example.co.uk' },
    ]);
    expect(found('{{ input.email }} and name@localhost')).toEqual([]);
  });
});

describe('the ids and handles among values', () => {
  it('find a chat id, an id with a known prefix and a UUID as an id', () => {
    expect(valuesOf('channel: C04ABC12DE and W9ZZZZZZZZ', 'id')).toEqual(['C04ABC12DE', 'W9ZZZZZZZZ']);
    expect(valuesOf('CONSTANTS C123456789 UPPERCASE', 'id')).toEqual([]);
    expect(valuesOf('customer cus_Ab12Cd34Ef, in_stockitems', 'id')).toEqual(['cus_Ab12Cd34Ef']);
    expect(valuesOf('team 0b6f3c2e-1a2b-4c3d-8e9f-0123456789ab', 'id')).toEqual([
      '0b6f3c2e-1a2b-4c3d-8e9f-0123456789ab',
    ]);
  });

  it('find an opaque value of twelve characters or more, standing alone as a value, as an id', () => {
    expect(valuesOf("account: 'a8F3kd92LmQ0'\n", 'id')).toEqual(['a8F3kd92LmQ0']);
    expect(valuesOf('  - "Zx81Qp20Lm33"  \n', 'id')).toEqual(['Zx81Qp20Lm33']);
    expect(valuesOf('8F3kd92LmQ0abc\n', 'id')).toEqual(['8F3kd92LmQ0abc']);
    expect(
      valuesOf(
        'name: plan-roasts-v2\nconstant: MAX_RETRIES_10\nnumber: 123456789012\nword: abcdefghijklmn\nsome text a8F3kd92LmQ0 here\n',
        'id',
      ),
    ).toEqual([]);
  });
});

describe('the handles among values', () => {
  it('find a channel name and an @name as a handle', () => {
    expect(valuesOf("channel: '#team-news' and #orders. and `#ops`", 'handle')).toEqual([
      '#team-news',
      '#orders',
      '#ops',
    ]);
    expect(valuesOf('#fff #1a2b3c #12 ## heading fill:#f9f [link](#setup) a#b', 'handle')).toEqual([]);
    expect(valuesOf('ask @sam.lee. now', 'handle')).toEqual(['@sam.lee']);
    expect(valuesOf('owner@example.com @scope/package a@', 'handle')).toEqual([]);
  });

  it('answers the matches in the order they stand, a longer one first', () => {
    const matches = valueMatchesIn('https://shop.example.com');
    expect(matches.map(({ from, to }) => [from, to])).toEqual([
      [0, 24],
      [8, 24],
    ]);
    expect(found('usr_AB12CD34@example.com')).toEqual([
      { class: 'address', value: 'usr_AB12CD34@example.com' },
      { class: 'id', value: 'usr_AB12CD34' },
    ]);
  });
});
