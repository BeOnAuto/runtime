import { describe, expect, it } from 'vitest';

import { leftOutTexts, packageLeftOut, packageResolution, resolutionOf } from './leaving-out.ts';
import type { PortableText } from './package-texts.ts';
import type { PortablePackage } from './portable-package.ts';
import { findingId, findingsIn } from './value-scan.ts';

const email = findingId('address', 'owner@example.com');
const channelId = findingId('id', 'C04ABC12DE');
const channelName = findingId('handle', '#news');

const shared: PortablePackage = {
  format: 1,
  goals: '- id: more-orders\n  statement: Tell owner@example.com about more orders.\n',
  page: 'Posts in #news\n',
  definitions: [
    {
      type: 'interaction',
      name: 'ask-owner',
      source: '---\nto: owner@example.com\ndeliver:\n  server: chat\n---\nAsk.\n',
      paused: false,
    },
    {
      type: 'interaction',
      name: 'post-news',
      source: "---\ncall:\n  server: chat\n  with:\n    channel: C04ABC12DE\n    text: 'In #news'\n---\n",
      overview: 'Posts in #news-room, not only #news.',
      paused: false,
    },
  ],
};

function page(text: string): PortableText[] {
  return [{ part: 'page', text }];
}

describe('leaving values out', () => {
  it('writes each blank in the shape of what it replaces, wherever the value stands', () => {
    const left = packageLeftOut(shared, [
      { finding: email, name: 'OWNER_EMAIL' },
      { finding: channelId, name: 'NEWS_CHANNEL' },
      { finding: channelName, name: 'NEWS' },
    ]);
    expect(left.goals).toBe(shared.goals);
    expect(left.page).toBe('Posts in AUTO_BLANK_NEWS\n');
    expect(left.definitions.map(({ source }) => source)).toEqual([
      '---\nto: owner_email@owner_email.blank.invalid\ndeliver:\n  server: chat\n---\nAsk.\n',
      "---\ncall:\n  server: chat\n  with:\n    channel: AUTO_BLANK_NEWS_CHANNEL\n    text: 'In AUTO_BLANK_NEWS'\n---\n",
    ]);
    expect(left.definitions[1]?.overview).toBe('Posts in AUTO_BLANK_NEWS-room, not only AUTO_BLANK_NEWS.');
  });

  it('replaces the longest value first and resolves a finding that lies wholly inside it', () => {
    const text = 'Open https://chat.example.com/open?channel=U03ABC12DE, or chat.example.com.';
    const findings = findingsIn(page(text));
    const url = findingId('address', 'https://chat.example.com/open?channel=U03ABC12DE');
    expect(findings.map(({ value }) => value)).toEqual([
      'https://chat.example.com/open?channel=U03ABC12DE',
      'chat.example.com',
      'U03ABC12DE',
    ]);
    expect(
      leftOutTexts(page(text), [
        { finding: findingId('address', 'chat.example.com'), name: 'CHAT' },
        { finding: url, name: 'OWNER_LINK' },
      ]),
    ).toEqual(page('Open https://owner_link.blank.invalid/, or chat.blank.invalid.'));
  });
});

describe('leaving out a host', () => {
  it('covers every address on a host when the host is left out', () => {
    const text = 'https://example.com/errors/a and orders@example.com and mail.example.com:8080';
    const host = findingId('address', 'example.com');
    const resolution = resolutionOf(page(text), { leave_out: [{ finding: host, name: 'ORG' }], cleared: [] });
    expect(resolution.texts).toEqual(
      page('https://org.blank.invalid/errors/a and orders@org.blank.invalid and mail.org.blank.invalid:8080'),
    );
    expect(resolution.unresolved.map(({ value }) => value)).toEqual([]);
    expect(resolution.fit).toBe(true);
  });

  it('replaces a value where it joins a longer one', () => {
    const text = 'a.owner@example.com, owner@example.com.au, https://example.com/a/b, https://example.com/a';
    const left = leftOutTexts(page(text), [
      { finding: email, name: 'OWNER' },
      { finding: findingId('address', 'https://example.com/a'), name: 'LINK' },
    ]);
    expect(left).toEqual(
      page('a.owner@example.com, owner@example.com.au, https://link.blank.invalid//b, https://link.blank.invalid/'),
    );
  });

  it('never leaves a value out of the goals', () => {
    expect(leftOutTexts([{ part: 'goals', text: 'owner@example.com' }], [{ finding: email, name: 'OWNER' }])).toEqual([
      { part: 'goals', text: 'owner@example.com' },
    ]);
  });
});

describe('whether a package is fit to share', () => {
  it('is not while a finding is neither left out nor cleared, and names it', () => {
    const resolution = packageResolution(shared, {
      leave_out: [{ finding: email, name: 'OWNER_EMAIL' }],
      cleared: [channelName],
    });
    expect(resolution.fit).toBe(false);
    expect(resolution.issues).toEqual([]);
    expect(resolution.unresolved.map(({ value }) => value)).toEqual(['owner@example.com', 'C04ABC12DE', '#news-room']);
  });

  it('is once every finding is left out or cleared, the goals only cleared', () => {
    const resolution = packageResolution(shared, {
      leave_out: [
        { finding: email, name: 'OWNER_EMAIL' },
        { finding: channelId, name: 'NEWS_CHANNEL' },
      ],
      cleared: [channelName, email, findingId('handle', '#news-room')],
    });
    expect(resolution).toMatchObject({ fit: true, issues: [], secrets: [], unresolved: [] });
    expect(resolution.package.definitions[0]?.source).toContain('owner_email@owner_email.blank.invalid');
    expect(resolution.package.goals).toBe(shared.goals);
  });

  it('takes the words that go with a package beside it', () => {
    const resolution = packageResolution(
      { format: 1, definitions: [] },
      { leave_out: [{ finding: email, name: 'OWNER' }], cleared: [] },
      [{ part: 'entry', name: 'promise', text: 'Mail owner@example.com' }],
    );
    expect(resolution.fit).toBe(true);
    expect(resolution.texts).toEqual([{ part: 'entry', name: 'promise', text: 'Mail owner@owner.blank.invalid' }]);
  });
});

describe('what a package that is not fit is told', () => {
  it('is never while a secret stands, which cannot be left out or cleared', () => {
    const hook = 'https://hooks.slack.com/services/T0/B0/X';
    const secret = findingId('secret', hook);
    const resolution = resolutionOf(page(`post to ${hook}`), {
      leave_out: [{ finding: secret, name: 'HOOK' }],
      cleared: [secret],
    });
    expect(resolution.fit).toBe(false);
    expect(resolution.secrets.map(({ value }) => value)).toEqual([hook]);
    expect(resolution.issues).toEqual([
      {
        pointer: '/leave_out/0/finding',
        detail: `${secret} is a value of a known secret shape, which can only be removed from the definition`,
      },
      {
        pointer: '/cleared/0',
        detail: `${secret} is a value of a known secret shape, which can only be removed from the definition`,
      },
    ]);
    expect(resolution.unresolved.map(({ value }) => value)).toEqual(['hooks.slack.com']);
  });

  it('refuses an unknown finding, a name that is not a blank and a finding left out twice', () => {
    const resolution = resolutionOf(page('owner@example.com and #news'), {
      leave_out: [
        { finding: email, name: 'owner' },
        { finding: email, name: 'OWNER' },
        { finding: 'nothing', name: 'NOTHING' },
        { finding: channelName, name: 'NEWS' },
        { finding: channelName, name: 'NEWS' },
      ],
      cleared: ['unknown'],
    });
    expect(resolution.issues).toEqual([
      {
        pointer: '/leave_out/0/name',
        detail: "owner is not a blank's name: capital letters, digits and underscores, 2 to 40, starting with a letter",
      },
      { pointer: '/leave_out/1/finding', detail: `${email} is left out twice` },
      { pointer: '/leave_out/2/finding', detail: 'nothing is not a finding of this package' },
      { pointer: '/leave_out/4/finding', detail: `${channelName} is left out twice` },
      { pointer: '/cleared/0', detail: 'unknown is not a finding of this package' },
    ]);
    expect(resolution.texts).toEqual(page('owner@owner.blank.invalid and AUTO_BLANK_NEWS'));
    expect(resolution.fit).toBe(false);
  });
});

describe('leaving values of one length out', () => {
  it('orders values of one length by their text, so the result is the same on every host', () => {
    const one = findingId('id', 'C04ABC12DE');
    const two = findingId('id', 'C04ABC12DF');
    const text = 'C04ABC12DF C04ABC12DE';
    expect(
      leftOutTexts(page(text), [
        { finding: two, name: 'TWO' },
        { finding: one, name: 'ONE' },
      ]),
    ).toEqual(page('AUTO_BLANK_TWO AUTO_BLANK_ONE'));
  });
});

describe('a value found where it joins other text', () => {
  it('is left out wherever the scan found it, so nothing stays that cannot be decided', () => {
    const text = 'Read report-C04ABC12DE and C04ABC12DE.json';
    const resolution = resolutionOf(page(text), {
      leave_out: [{ finding: channelId, name: 'NEWS_CHANNEL' }],
      cleared: [],
    });
    expect(resolution.texts[0]?.text).toBe('Read report-AUTO_BLANK_NEWS_CHANNEL and AUTO_BLANK_NEWS_CHANNEL.json');
    expect(resolution.fit).toBe(true);
  });
});

describe('a value in another spelling', () => {
  it('is a finding of its own, so leaving one spelling out never passes the other', () => {
    const text = 'Mail owner@example.com or Owner@Example.com';
    const resolution = resolutionOf(page(text), { leave_out: [{ finding: email, name: 'OWNER' }], cleared: [] });
    expect(resolution.texts[0]?.text).toBe('Mail owner@owner.blank.invalid or Owner@Example.com');
    expect(resolution.fit).toBe(false);
    expect(resolution.unresolved.map(({ value }) => value)).toEqual(['Owner@Example.com']);
  });
});

describe('a secret among values left out', () => {
  it('is never broken by leaving out a value that stands inside it, so the secret still refuses', () => {
    const hook = 'https://hooks.slack.com/services/T0AAAA1/B0BBBB2/abcdefghijklmnop';
    const text = `post to ${hook}, a URL on hooks.slack.com.`;
    const host = findingId('address', 'hooks.slack.com');
    const resolution = resolutionOf(page(text), { leave_out: [{ finding: host, name: 'HOOK_HOST' }], cleared: [] });
    expect(resolution.fit).toBe(false);
    expect(resolution.texts[0]?.text).toBe(`post to ${hook}, a URL on hook_host.blank.invalid.`);
    expect(resolution.secrets.map(({ value }) => value)).toEqual([hook]);
  });
});
