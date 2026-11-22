import { createHash } from 'node:crypto';

import type { PageStyle } from '@on.auto/api';
import type { LinkAllowAsked, LinkShown, ServiceNamed } from '@on.auto/openid-connect/authorization-server';
import { html } from 'hono/html';

interface LinkPageShown {
  readonly status: number;
  readonly body: Promise<string>;
  readonly headers: Readonly<Record<string, string>>;
  readonly head?: string;
}

const codeStyle = `.code {
  margin: 8px 0 18px;
  padding: 14px 28px;
  border: 1px solid var(--rule);
  border-radius: 14px;
  color: var(--ink);
  font-family: 'DM Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 40px;
  font-weight: 500;
  letter-spacing: 6px;
  line-height: 1.2;
}`;

const codeStyleHash = createHash('sha256').update(codeStyle).digest('base64');

const failedReadStatus = 502;

const stoppedStatus = 404;

const tryAgain = 'Try again';

function newLinkOf({ service, app }: ServiceNamed): string {
  return `Message @${app} in ${service} again to get a new link.`;
}

async function allowPageOf({ service, memberName, accountName, allowAt, denyAt }: LinkAllowAsked): Promise<string> {
  const page = await html`<h1>Connect your ${service} account to Auto?</h1>
    <p>Your ${service} account ${memberName} in ${accountName} will be able to ask Auto and have it act, as you.</p>
    <div class="choices">
      <form method="post" action="${allowAt}"><button class="primary" type="submit">Allow</button></form>
      <form method="post" action="${denyAt}"><button class="secondary" type="submit">Deny</button></form>
    </div>`;
  return page;
}

async function unnamedPageOf(service: string, tryAgainAt: string): Promise<string> {
  const page = await html`<p>Couldn’t load your ${service} account. Try again.</p>
    <a class="open" href="${tryAgainAt}">${tryAgain}</a>`;
  return page;
}

async function codePageOf({ service, app, code }: ServiceNamed & { readonly code: string }): Promise<string> {
  const page = await html`<h1>One more step</h1>
    <p>Send this code to @${app} in ${service}:</p>
    <p class="code">${code}</p>`;
  return page;
}

async function deniedPageOf(named: ServiceNamed): Promise<string> {
  const page = await html`<h1>Nothing was connected</h1>
    <p>You declined the request, so your ${named.service} account wasn’t connected to Auto.</p>
    <p>${newLinkOf(named)}</p>`;
  return page;
}

async function stoppedPage(): Promise<string> {
  const page = await html`<h1>This link has stopped working</h1>
    <p>A sign-in link works once.</p>
    <p>Message Auto again to get a new link.</p>`;
  return page;
}

function withTheCodeStyle(headers: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  const policy = String(headers['content-security-policy']);
  return {
    ...headers,
    'content-security-policy': policy.replace('style-src ', `style-src 'sha256-${codeStyleHash}' `),
  };
}

export function linkPageShownBy(style: PageStyle, shown: LinkShown): LinkPageShown {
  if ('allow' in shown) {
    return { status: 200, body: allowPageOf(shown.allow), headers: style.formHeaders("'self'") };
  }
  if ('unnamed' in shown) {
    const { service, tryAgainAt } = shown.unnamed;
    return { status: failedReadStatus, body: unnamedPageOf(service, tryAgainAt), headers: style.readOnlyHeaders };
  }
  if ('code' in shown) {
    return {
      status: 200,
      body: codePageOf(shown.code),
      headers: withTheCodeStyle(style.readOnlyHeaders),
      head: `<style>${codeStyle}</style>`,
    };
  }
  if ('denied' in shown) {
    return { status: 200, body: deniedPageOf(shown.denied), headers: style.readOnlyHeaders };
  }
  return { status: stoppedStatus, body: stoppedPage(), headers: style.readOnlyHeaders };
}
