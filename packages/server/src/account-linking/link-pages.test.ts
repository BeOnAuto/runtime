import { createHash } from 'node:crypto';

import type { PageStyle } from '@on.auto/api';
import type { LinkShown } from '@on.auto/openid-connect/authorization-server';
import { describe, expect, it } from 'vitest';

import { linkPageShownBy } from './link-pages.ts';

const policy = "default-src 'none'; style-src 'sha256-page'; form-action 'none'";

const style: PageStyle = {
  head: (extra) => extra,
  readOnlyHeaders: { 'content-security-policy': policy, 'referrer-policy': 'no-referrer' },
  controlHeaders: {},
  formHeaders: (formAction) => ({ 'content-security-policy': `form-action ${formAction}` }),
};

const named = { service: 'A chat', app: 'Auto' };

const allowAsked = {
  service: 'A chat',
  memberName: 'Dana',
  accountName: 'Northwind',
  allowAt: '/i/confirm',
  denyAt: '/i/abort',
};

const allow: LinkShown = { allow: allowAsked };

const pagesWithTheirStatus: ReadonlyArray<readonly [string, LinkShown, number, unknown]> = [
  ['asks to allow it', allow, 200, { 'content-security-policy': "form-action 'self'" }],
  ['could not name the member', { unnamed: { service: 'A chat', tryAgainAt: '/i' } }, 502, style.readOnlyHeaders],
  ['was declined', { denied: named }, 200, style.readOnlyHeaders],
  ['stopped working', { ended: true }, 404, style.readOnlyHeaders],
];

function rulesIn(head: string | undefined): string {
  return /^<style>(?<rules>[^<]+)<\/style>$/u.exec(String(head))?.groups?.['rules'] ?? '';
}

describe('the pages of a link to an account', () => {
  it.each(pagesWithTheirStatus)(
    'where it %s, answer their status with the headers of the page style',
    (_case, shown, status, headers) => {
      const page = linkPageShownBy(style, shown);

      expect([page.status, page.headers, page.head]).toEqual([status, headers, undefined]);
    },
  );

  it('ask to allow it with two forms, one posting to each choice', async () => {
    const page = await linkPageShownBy(style, allow).body;

    expect(
      [...page.matchAll(/<form method="post" action="([^"]+)">/gu)].map(([, action]: readonly string[]) => action),
    ).toEqual(['/i/confirm', '/i/abort']);
  });

  it('show the code with a style of their own, which the policy of the page allows by its hash alone', async () => {
    const page = linkPageShownBy(style, { code: { ...named, code: 'BCDFGH' } });

    const styled = rulesIn(page.head);
    const hash = createHash('sha256').update(styled).digest('base64');
    expect([page.status, page.headers]).toEqual([
      200,
      {
        ...style.readOnlyHeaders,
        'content-security-policy': policy.replace('style-src ', `style-src 'sha256-${hash}' `),
      },
    ]);
    expect((await page.body).includes('class="code">BCDFGH<')).toBe(true);
  });

  it('escape every name a service gives', async () => {
    const page = await linkPageShownBy(style, { allow: { ...allowAsked, memberName: '<script>' } }).body;

    expect([page.includes('<script>'), page.includes('&lt;script&gt;')]).toEqual([false, true]);
  });
});
