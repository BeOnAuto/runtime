import { defaultStudioOrigin, loopbackNames, namesTheLoopback } from '@on.auto/identity';
import { alternatives } from '@on.auto/phrasing';
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

function anOriginOver(protocols: readonly string[], example: string) {
  return Schema.makeFilter(
    (text: string) =>
      isOriginOf(text, protocols) || `Expected an https URL with no path, query or fragment, such as ${example}`,
  );
}

function aWebOriginSuchAs(example: string) {
  return anOriginOver(['https:', 'http:'], example);
}

const theRuntimesExample = 'https://runtime.example.com';

export const PublicOrigin = Schema.String.check(aWebOriginSuchAs(theRuntimesExample));

export const WebhookUrl = Schema.String.annotate({
  description:
    "The public https URL of this runtime, as services outside your network reach it, with no path, such as https://runtime.example.com. Auto gives a connection's service an address under it when it asks the service to send a webhook as soon as something happens there. Leave it unset if nothing outside can reach the runtime: Auto then checks the service on a timer. WEBHOOK_URL wins over it",
}).check(anOriginOver(['https:'], theRuntimesExample));

export const defaultConsentService = 'https://consent.on.auto';

export const ConsentServiceOrigin = Schema.String.check(aWebOriginSuchAs(defaultConsentService));

export const StudioOrigin = Schema.String.annotate({
  description: `The origin Studio is served from, an https URL, or an http URL on localhost, 127.0.0.1 or [::1], with no path; a page there may call the API, and the runtime fetches Studio from it when it serves Studio. ${defaultStudioOrigin} when left out. STUDIO_ORIGIN wins over it`,
}).check(aWebOriginSuchAs(defaultStudioOrigin));

export function httpOffTheLoopbackIn(setting: string, origin: string, onlyBeside?: string): string | undefined {
  const where = alternatives(loopbackNames);
  const taken = onlyBeside === undefined ? `for ${where}` : `beside ${onlyBeside}, on ${where}`;
  return origin.startsWith('https://') || namesTheLoopback(new URL(origin).hostname)
    ? undefined
    : `${setting}: Expected an https URL; an http URL is taken only ${taken}`;
}
