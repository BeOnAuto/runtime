import { defaultStudioOrigin } from '@on.auto/identity';
import { alternatives, loopbackNames, namesTheLoopback } from '@on.auto/operations';
import { Schema } from 'effect';

function isOriginOf(text: string, protocols: readonly string[]): boolean {
  const url = URL.parse(text);
  return url?.origin === text && protocols.includes(url.protocol);
}

export const Origin = Schema.String.check(
  Schema.makeFilter(
    (text: string) => URL.parse(text)?.origin === text || 'Expected an origin such as https://app.example.com',
  ),
);

export const IssuerOrigin = Schema.String.check(
  Schema.makeFilter(
    (text: string) =>
      isOriginOf(text, ['https:']) ||
      'Expected the https URL of the identity service, with no path, query or fragment, such as https://clerk.on.auto',
  ),
);

export const KeySetUrl = Schema.String.check(
  Schema.makeFilter(
    (text: string) =>
      URL.parse(text)?.protocol === 'https:' ||
      'Expected the https URL of the key set of the identity service, such as https://identity.example.com/.well-known/jwks.json',
  ),
);

function aWebOriginSuchAs(example: string) {
  return Schema.makeFilter(
    (text: string) =>
      isOriginOf(text, ['https:', 'http:']) ||
      `Expected an https URL with no path, query or fragment, such as ${example}`,
  );
}

export const PublicOrigin = Schema.String.check(aWebOriginSuchAs('https://runtime.example.com'));

export const defaultConsentService = 'https://consent.on.auto';

export const ConsentServiceOrigin = Schema.String.check(aWebOriginSuchAs(defaultConsentService));

export const StudioOrigin = Schema.String.annotate({
  description: `The origin Studio is served from, an https URL, or an http URL on localhost, 127.0.0.1 or [::1], with no path; a page there may call the API, and the runtime fetches Studio from it when it serves Studio. ${defaultStudioOrigin} when left out. STUDIO_ORIGIN wins over it`,
}).check(aWebOriginSuchAs(defaultStudioOrigin));

export function httpOffTheLoopbackIn(setting: string, origin: string): string | undefined {
  return origin.startsWith('https://') || namesTheLoopback(new URL(origin).hostname)
    ? undefined
    : `${setting}: Expected an https URL; an http URL is taken only for ${alternatives(loopbackNames)}`;
}
