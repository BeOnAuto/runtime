import { describe, expect, it } from 'vitest';

import { resolutionOf } from './leaving-out.ts';
import type { PortableText } from './package-texts.ts';
import { findingsIn } from './value-scan.ts';

function source(text: string): PortableText[] {
  return [{ part: 'definition', name: 'workflow/x', field: 'source', text }];
}

function everyValueLeftOut(texts: readonly PortableText[]) {
  const findings = findingsIn(texts).filter((finding) => finding.class !== 'secret');
  return resolutionOf(texts, {
    leave_out: findings.map(({ id }, at) => ({ finding: id, name: `VALUE_${at}` })),
    cleared: [],
  });
}

describe('a value left out where it joins other text', () => {
  it('is replaced there too, and refuses the share, since its blank could not be seen', () => {
    const texts = source("channel: Xq7Lm2Pa9Rt4\ntext: 'see Xq7Lm2Pa9Rt4_archive'\n");
    const resolution = everyValueLeftOut(texts);
    expect(resolution.fit).toBe(false);
    expect(JSON.stringify(resolution.texts)).not.toContain('Xq7Lm2Pa9Rt4');
    expect(resolution.standing).toEqual([
      {
        finding: findingsIn(texts)[0]?.id,
        name: 'VALUE_0',
        class: 'id',
        value: 'Xq7Lm2Pa9Rt4',
        joined: true,
        occurrences: [{ part: 'definition', name: 'workflow/x', field: 'source', line: 2 }],
      },
    ]);
  });

  it('is a host inside a longer host, which refuses the share', () => {
    const texts = source('url: https://acme-roasters.com/orders\nnote: mirror on acme-roasters.com.au\n');
    const resolution = everyValueLeftOut(texts);
    expect(resolution.fit).toBe(false);
    expect(JSON.stringify(resolution.texts)).not.toContain('acme-roasters');
    expect(resolution.standing.map(({ value, joined, occurrences }) => [value, joined, occurrences[0]?.line])).toEqual([
      ['acme-roasters.com', true, 2],
    ]);
  });

  it('is a chat id with a letter after it, which refuses the share', () => {
    const texts = source('post: https://app.slack.com/client/T0ABCDEFG/C0123ABCD9\nalso: C0123ABCD9x\n');
    const resolution = everyValueLeftOut(texts);
    expect(resolution.fit).toBe(false);
    expect(JSON.stringify(resolution.texts)).not.toContain('C0123ABCD9');
    expect(resolution.unresolved).toEqual([]);
    expect(resolution.standing.map(({ value, occurrences }) => [value, occurrences[0]?.line])).toEqual([
      ['C0123ABCD9', 2],
    ]);
  });

  it('is named once for each line it joins text on', () => {
    const resolution = everyValueLeftOut(source('id: Xq7Lm2Pa9Rt4\nsee Xq7Lm2Pa9Rt4_a and Xq7Lm2Pa9Rt4_b\n'));
    expect(resolution.standing.map(({ occurrences }) => occurrences)).toEqual([
      [{ part: 'definition', name: 'workflow/x', field: 'source', line: 2 }],
    ]);
  });
});

describe('a value left out where it joins other text, or not', () => {
  it('is shared where its blank is still seen, as before a hyphen or a dot', () => {
    const resolution = everyValueLeftOut(source('id: Xq7Lm2Pa9Rt4\nsee report-Xq7Lm2Pa9Rt4.json\n'));
    expect(resolution).toMatchObject({ fit: true, standing: [] });
    expect(resolution.texts[0]?.text).toBe('id: AUTO_BLANK_VALUE_0\nsee report-AUTO_BLANK_VALUE_0.json\n');
  });

  it('refuses a host left out inside another host whose name only begins with it', () => {
    const texts: PortableText[] = [{ part: 'page', text: 'See https://example.com/a and example.community' }];
    const resolution = everyValueLeftOut(texts);
    expect(resolution.fit).toBe(false);
    expect(resolution.texts[0]?.text).not.toContain('example.com');
    expect(resolution.standing.map(({ value, joined }) => [value, joined])).toEqual([['example.com', true]]);
  });
});

describe('a value left out that still stands in another spelling', () => {
  it('refuses the share even where the other spelling was cleared or is no finding', () => {
    const texts: PortableText[] = [
      { part: 'page', text: 'Mail owner@example.com or OWNER@EXAMPLE.COM' },
      { part: 'entry', name: 'story', text: 'Read https://example.com/news or Example.com itself.' },
      { part: 'goals', text: '- id: a\n  statement: Tell owner@example.com.\n' },
    ];
    const id = (value: string) => findingsIn(texts).find((finding) => finding.value === value)?.id;
    const resolution = resolutionOf(texts, {
      leave_out: [
        { finding: String(id('owner@example.com')), name: 'OWNER' },
        { finding: String(id('https://example.com/news')), name: 'NEWS' },
        { finding: String(id('example.com')), name: 'SITE' },
      ],
      cleared: [String(id('OWNER@EXAMPLE.COM')), String(id('owner@example.com'))],
    });
    expect(resolution.fit).toBe(false);
    expect(resolution.unresolved).toEqual([]);
    expect(resolution.standing.map(({ value, joined, occurrences }) => [value, joined, occurrences])).toEqual([
      ['owner@example.com', false, [{ part: 'page', line: 1 }]],
      [
        'example.com',
        false,
        [
          { part: 'page', line: 1 },
          { part: 'entry', name: 'story', line: 1 },
        ],
      ],
      ['example.com', false, [{ part: 'goals', line: 2 }]],
    ]);
  });
});

const goals = (statement: string): PortableText => ({ part: 'goals', text: `- id: a\n  statement: ${statement}\n` });

describe('a value left out that still stands in the goals, where no blank is written', () => {
  it.each([
    ['an opaque id', 'channel: Xq7Lm2Pa9Rt4\n', 'Orders posted to Xq7Lm2Pa9Rt4 are answered'],
    ['a bare host', 'url: https://acme-roasters.com/orders\n', 'acme-roasters.com orders ship'],
    ['an id in other capitals', 'channel: Xq7Lm2Pa9Rt4\n', 'Orders posted to XQ7LM2PA9RT4 are answered'],
  ])('refuses the share for %s, which the scan does not find in the goals', (_, written, statement) => {
    const texts = [...source(written), goals(statement)];
    const resolution = everyValueLeftOut(texts);
    expect(resolution.fit).toBe(false);
    expect(resolution.unresolved).toEqual([]);
    expect(resolution.texts.find(({ part }) => part === 'goals')).toEqual(goals(statement));
    expect(resolution.standing.filter(({ occurrences }) => occurrences.every(({ part }) => part === 'goals'))).toEqual([
      expect.objectContaining({ joined: false, occurrences: [{ part: 'goals', line: 2 }] }),
    ]);
  });

  it('is shared where the owner cleared it, since the goals keep what is cleared', () => {
    const texts = [...source('channel: Xq7Lm2Pa9Rt4\n'), goals('Orders posted to Xq7Lm2Pa9Rt4 are answered')];
    const [found] = findingsIn(texts);
    const resolution = resolutionOf(texts, {
      leave_out: [{ finding: String(found?.id), name: 'CHANNEL' }],
      cleared: [String(found?.id)],
    });
    expect(resolution).toMatchObject({ fit: true, standing: [], unresolved: [] });
  });
});

describe('a value hidden by a character the eye does not part it by', () => {
  it.each([
    ['a zero-width space', 'Mail bob​@acme.com weekly'],
    ['a soft hyphen', 'Mail bob@ac­me.com weekly'],
    ['wide letters', 'Mail ｂｏｂ＠ａｃｍｅ．ｃｏｍ weekly'],
  ])('is left out with %s, which goes with it', (_, text) => {
    const resolution = everyValueLeftOut([{ part: 'page', text }]);
    expect(resolution).toMatchObject({ fit: true, standing: [], unresolved: [] });
    expect(resolution.texts).toEqual([{ part: 'page', text: 'Mail value_0@value_0.blank.invalid weekly' }]);
  });
});

describe('a value left out that holds what a pattern would read as its own', () => {
  it('is looked for as it is written, so its parentheses, dots and question mark match only themselves', () => {
    const text = 'See https://example.com/a?b=(c)+d or https://example.com/aXb=(c)+d.';
    const resolution = everyValueLeftOut([{ part: 'page', text }]);
    expect(resolution).toMatchObject({ fit: true, standing: [], unresolved: [] });
    expect(resolution.texts[0]?.text).not.toContain('example.com');
  });
});

describe('a value left out whose copies are written with escapes', () => {
  it('is replaced in each copy, escapes and all, and the address around a copy is asked about again, as when written plainly', () => {
    const texts: PortableText[] = [
      ...source(`to: bob@acme.com\nx: "bob\\u0040acme.com"\n`),
      { part: 'definition', name: 'workflow/x', field: 'overview', text: 'See https://x.io/?u=bob%40acme.com' },
    ];
    const findings = findingsIn(texts);
    const email = findings.find(({ value }) => value === 'bob@acme.com');
    const resolution = resolutionOf(texts, {
      leave_out: [{ finding: String(email?.id), name: 'OWNER' }],
      cleared: findings.filter((finding) => finding !== email).map(({ id }) => id),
    });
    expect(resolution.standing).toEqual([]);
    expect(resolution.unresolved.map(({ value }) => value)).toEqual(['https://x.io/?u=owner@owner.blank.invalid']);
    expect(resolution.texts.map(({ text }) => text)).toEqual([
      'to: owner@owner.blank.invalid\nx: "owner@owner.blank.invalid"\n',
      'See https://x.io/?u=owner@owner.blank.invalid',
    ]);
  });
});
