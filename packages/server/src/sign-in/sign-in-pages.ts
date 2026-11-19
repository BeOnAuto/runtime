import { createHash } from 'node:crypto';

import type { PageStyle } from '@on.auto/api';
import { namesTheLoopback } from '@on.auto/identity';
import type { AllowAsked, PageShown, SignInPages, SignInRefusal } from '@on.auto/openid-connect/authorization-server';
import { html } from 'hono/html';

type Page = Promise<string>;

interface Refusal {
  readonly sentence: string;
  readonly status: number;
  readonly triedAgain: boolean;
}

const refusals: Readonly<Record<SignInRefusal, Refusal>> = {
  not_that_account: {
    sentence:
      'You can’t sign in here with that account. Try again and choose a different account or organization, or ask whoever runs Auto at your company.',
    status: 403,
    triedAgain: true,
  },
  no_access: {
    sentence: 'You don’t have access to this organization. Ask an admin of the organization to give you a role.',
    status: 403,
    triedAgain: false,
  },
  not_signed_in: {
    sentence: 'Couldn’t sign you in. Try again, or ask whoever runs Auto at your company.',
    status: 400,
    triedAgain: true,
  },
};

const tryAgain = 'Try again';

const notOpenStatus = 400;

function sourceOf(address: string): string {
  const { origin, protocol } = new URL(address);
  return origin === 'null' ? protocol : origin;
}

interface Delivery {
  readonly toThisComputer: boolean;
  readonly host: string;
}

function deliveryOf(deliveredTo: string): Delivery {
  const { hostname, host } = new URL(deliveredTo);
  return { toThisComputer: namesTheLoopback(hostname), host };
}

function registeredItselfOf(client: string, { toThisComputer, host }: Delivery): readonly string[] {
  return [
    toThisComputer
      ? `${client} registered itself, so its name is not verified.`
      : `${client} registered itself, so its name is not verified. Its access will be delivered to ${host}.`,
  ];
}

function publishedAtOf(client: string, domain: string, { toThisComputer, host }: Delivery): readonly string[] {
  const published = `${client}, published at ${domain}`;
  return toThisComputer ? [published] : [published, `Its access will be delivered to ${host}.`];
}

function aboutTheClientOf({ client, publishedAt, deliveredTo }: AllowAsked): readonly string[] {
  const delivery = deliveryOf(deliveredTo);
  return publishedAt === undefined
    ? registeredItselfOf(client, delivery)
    : publishedAtOf(client, publishedAt, delivery);
}

function documentOf(style: PageStyle, body: string): string {
  return [
    '<!doctype html><html lang="en"><head>',
    style.head(''),
    '</head><body><main>',
    body,
    '</main></body></html>',
  ].join('');
}

async function allowPageOf(asked: AllowAsked): Page {
  const { client, allowAt, denyAt } = asked;
  const page = await html`<h1>Allow ${client} to use Auto as you?</h1>
    <p>Allow takes you back to ${client}.</p>
    ${aboutTheClientOf(asked).map((line) => html`<p>${line}</p>`)}
    <div class="choices">
      <form method="post" action="${allowAt}"><button class="primary" type="submit">Allow</button></form>
      <form method="post" action="${denyAt}"><button class="secondary" type="submit">Deny</button></form>
    </div>`;
  return page;
}

async function notOpenPageOf(client: string | undefined): Page {
  const page = await (client === undefined
    ? html`<p>This request is no longer open. Go back to the app and connect again.</p>`
    : html`<p>This request is no longer open. Go back to ${client} and connect again.</p>`);
  return page;
}

async function refusalPageOf({ sentence, triedAgain }: Refusal, tryAgainAt: string | undefined): Page {
  const page = await html`<p>${sentence}</p>
    ${triedAgain && tryAgainAt !== undefined ? html`<a class="open" href="${tryAgainAt}">${tryAgain}</a>` : ''}`;
  return page;
}

interface Shown {
  readonly status: number;
  readonly body: Page;
  readonly headers: Readonly<Record<string, string>>;
}

type SigningOut = Extract<PageShown, { readonly signingOut: unknown }>['signingOut'];

const endOfTheForm = '</form>';

const withoutScripts = `<noscript><p>Your browser does not support JavaScript or you've disabled it.</p><div class="choices"><button class="primary" autofocus type="submit">Continue</button></div></noscript>`;

function signingOutShownBy(style: PageStyle, { form, script }: SigningOut): Shown {
  const headers = style.formHeaders("'self'");
  const scriptHash = createHash('sha256').update(script).digest('base64');
  return {
    status: 200,
    body: Promise.resolve(
      `${form.replace(endOfTheForm, `${withoutScripts}${endOfTheForm}`)}<script>${script}</script>`,
    ),
    headers: {
      ...headers,
      'content-security-policy': `${String(headers['content-security-policy'])}; script-src 'sha256-${scriptHash}'`,
    },
  };
}

function bodyShownOf(style: PageStyle, shown: PageShown): Shown {
  if ('allow' in shown) {
    const formAction = `'self' ${sourceOf(shown.allow.deliveredTo)}`;
    return { status: 200, body: allowPageOf(shown.allow), headers: style.formHeaders(formAction) };
  }
  if ('notOpen' in shown) {
    return { status: notOpenStatus, body: notOpenPageOf(shown.notOpen.client), headers: style.readOnlyHeaders };
  }
  if ('signingOut' in shown) {
    return signingOutShownBy(style, shown.signingOut);
  }
  const refusal = refusals[shown.refused];
  return { status: refusal.status, body: refusalPageOf(refusal, shown.tryAgainAt), headers: style.readOnlyHeaders };
}

export function signInPagesOf(style: PageStyle): SignInPages {
  return async (shown) => {
    const { status, body, headers } = bodyShownOf(style, shown);
    return { status, html: documentOf(style, await body), headers };
  };
}
