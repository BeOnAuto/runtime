export type ValueClass = 'secret' | 'address' | 'id' | 'handle';

export interface ValueMatch {
  readonly class: ValueClass;
  readonly value: string;
  readonly from: number;
  readonly to: number;
}

const tokenShapes: readonly Readonly<RegExp>[] = [
  /\bgh[pousr]_[A-Za-z0-9]{36}\b/gu,
  /\bgithub_pat_[A-Za-z0-9_]{40,}/gu,
  /\b[rs]k_(?:live|test)_[0-9A-Za-z]{20,}/gu,
  /\bwhsec_[0-9A-Za-z+/=]{24,}/gu,
  /\bglpat-[0-9A-Za-z_-]{20,}/gu,
  /\bxapp-\d-[0-9A-Za-z-]{10,}/gu,
  /\bSG\.[0-9A-Za-z_-]{22}\.[0-9A-Za-z_-]{43}/gu,
  /\bya29\.[0-9A-Za-z_-]{20,}/gu,
  /\b[Bb]earer[ \t]+[0-9A-Za-z._~+/-]{20,}=*/gu,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/gu,
  /\bxox[abposr]-[0-9A-Za-z-]{10,}/gu,
  /\bsk-ant-[A-Za-z0-9_-]{80,}/gu,
  /\bsk-proj-[A-Za-z0-9_-]{80,}/gu,
  /\bnpm_[A-Za-z0-9]{36}\b/gu,
  /\bAIza[0-9A-Za-z_-]{35}\b/gu,
  /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----\r?\n[A-Za-z0-9+/=]{60,}/gu,
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/gu,
];

const webhookPlaces: readonly WebhookPlace[] = [
  { host: /^hooks\.slack\.com$/iu, path: '/' },
  { host: /^hooks\.zapier\.com$/iu, path: '/' },
  { host: /^(?:[a-z0-9-]+\.)*discord(?:app)?\.com$/iu, path: '/api/webhooks' },
  { host: /^(?:[a-z0-9-]+\.)+webhook\.office\.com$/iu, path: '/' },
  { host: /^outlook\.office\.com$/iu, path: '/webhook' },
  { host: /^maker\.ifttt\.com$/iu, path: '/trigger' },
];

const credentialWords = new Set([
  'token',
  'key',
  'apikey',
  'secret',
  'password',
  'passwd',
  'pwd',
  'sig',
  'signature',
  'auth',
  'credential',
  'credentials',
  'session',
  'pass',
  'jwt',
  'bearer',
]);

const url = /\b[a-z][a-z0-9+.-]{1,15}:(?:\/\/|\\\/\\\/)(?:[^\s'"<>()[\]{}`\\|^]|\\\/)+/giu;
const urlStart = /^[a-z][a-z0-9+.-]{1,15}:(?:\/\/|\\\/\\\/)/iu;
const urlEnd = /[.,;:!?*]+$/u;
const email =
  /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![A-Za-z0-9-])/gu;
const chatId = /(?<![A-Za-z0-9_])[CDGUW](?=[A-Z0-9]*[0-9])(?=[A-Z0-9]*[A-Z])[A-Z0-9]{8,11}(?![A-Za-z0-9_])/gu;
const prefixedId =
  /(?<![A-Za-z0-9_])(?:acct|cus|prod|price|sub|in|pi|ch|org|team|usr|user|evt|pm|tok|txn)_(?=[A-Za-z0-9]*[A-Z0-9])[A-Za-z0-9]{8,}(?![A-Za-z0-9_])/gu;
const uuid = /(?<![A-Za-z0-9_-])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![A-Za-z0-9_-])/giu;
const scalar = /^[ \t]*(?:-[ \t]+)?(?:[A-Za-z0-9_.-]+:[ \t]+)?(['"]?)([A-Za-z0-9][A-Za-z0-9_-]{11,})\1[ \t]*$/gmu;
const wordsAndNumbers = /^(?:[a-z]+(?:[-_][a-z0-9]+)*|[A-Z]+(?:_[A-Z0-9]+)*)$/u;
const channelName = /(?<![^\s'"`])#[a-z0-9][a-z0-9._-]{0,79}/gu;
const colour = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/iu;
const atName = /(?<![A-Za-z0-9._%+\-/@])@[A-Za-z][A-Za-z0-9._-]{0,39}/gu;
const nameEnd = /[._-]+$/u;

export interface Matched {
  readonly text: string;
  readonly groups: readonly string[];
  readonly at: number;
}

interface RegExpFound {
  readonly 0: string;
  readonly index: number;
  readonly length: number;
  readonly [group: number]: string | undefined;
}

export function matchedIn(text: string, pattern: Readonly<RegExp>): Matched[] {
  return [...text.matchAll(pattern)].map((found: RegExpFound) => ({
    text: found[0],
    groups: Array.from({ length: found.length }, (_, index) => found[index] ?? ''),
    at: found.index,
  }));
}

function matchesOf(text: string, pattern: Readonly<RegExp>, valueClass: ValueClass): ValueMatch[] {
  return matchedIn(text, pattern).map(({ text: value, at }: Matched) => ({
    class: valueClass,
    value,
    from: at,
    to: at + value.length,
  }));
}

function trimmed({ class: valueClass, value, from }: ValueMatch, end: Readonly<RegExp>): ValueMatch {
  const kept = value.replace(end, '');
  return { class: valueClass, value: kept, from, to: from + kept.length };
}

interface UrlParts {
  readonly host: string;
  readonly hostAt: number;
  readonly userAndPassword: boolean;
  readonly path: string;
  readonly parameters: readonly string[];
}

interface WebhookPlace {
  readonly host: Readonly<RegExp>;
  readonly path: string;
}

export function isUrl(value: string): boolean {
  return urlStart.test(value);
}

export function hostOf(value: string): string {
  return isUrl(value) ? partsOf(value).host : value.slice(value.lastIndexOf('@') + 1);
}

function schemeEnd(value: string): number {
  const colon = value.indexOf(':');
  return value.startsWith('\\/\\/', colon + 1) ? colon + 5 : colon + 3;
}

function partsOf(escaped: string): UrlParts {
  const written = escaped.replaceAll('\\/', '/');
  const shift = schemeEnd(escaped) - schemeEnd(written);
  const afterScheme = written.indexOf('://') + 3;
  const rest = written.slice(afterScheme);
  const authorityEnd = rest.search(/[/?#]/u);
  const authority = authorityEnd === -1 ? rest : rest.slice(0, authorityEnd);
  const userEnd = authority.lastIndexOf('@');
  const userInfo = userEnd === -1 ? '' : authority.slice(0, userEnd);
  const host = authority.slice(userEnd + 1).replace(/:\d*$/u, '');
  const after = authorityEnd === -1 ? '' : rest.slice(authorityEnd);
  const queryAt = after.search(/[?#]/u);
  return {
    host,
    hostAt: afterScheme + userEnd + 1 + shift,
    userAndPassword: userInfo.includes(':') || (host.includes(':') && !host.startsWith('[')),
    path: queryAt === -1 ? after : after.slice(0, queryAt),
    parameters: (queryAt === -1 ? '' : after.slice(queryAt + 1))
      .split(/[&;#]/u)
      .map((pair) => String(pair.split('=')[0]))
      .filter((name) => name.length > 0),
  };
}

function namedLikeACredential(parameter: string): boolean {
  const words = parameter
    .replaceAll(/([a-z])([A-Z])/gu, '$1 $2')
    .toLowerCase()
    .split(/[\s_.-]+/u);
  return (
    words.some((word) => credentialWords.has(word)) ||
    credentialWords.has(parameter.toLowerCase().replaceAll(/[_.-]/gu, ''))
  );
}

function onAWebhookHost({ host, path }: UrlParts): boolean {
  return webhookPlaces.some((place: WebhookPlace) => place.host.test(host) && path.startsWith(place.path));
}

function decoded(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function shifted({ class: valueClass, value, from, to }: ValueMatch, by: number): ValueMatch {
  return { class: valueClass, value, from: from + by, to: to + by };
}

function hidesASecret(value: string): boolean {
  const plain = decoded(value);
  return plain !== value && urlMatches(plain.slice(schemeEnd(plain))).some((inner) => inner.class === 'secret');
}

function urlMatches(text: string): ValueMatch[] {
  return matchesOf(text, url, 'address').flatMap((found: ValueMatch) => {
    const match = trimmed(found, urlEnd);
    const parts = partsOf(match.value);
    const after = schemeEnd(match.value);
    const inner = urlMatches(match.value.slice(after)).map((nested) => shifted(nested, match.from + after));
    const secret =
      parts.userAndPassword ||
      parts.parameters.some((name) => namedLikeACredential(name)) ||
      onAWebhookHost(parts) ||
      inner.some((nested) => nested.class === 'secret') ||
      hidesASecret(match.value);
    const whole: ValueMatch = {
      class: secret ? 'secret' : 'address',
      value: match.value,
      from: match.from,
      to: match.to,
    };
    const hostAt = match.from + parts.hostAt;
    const host: ValueMatch = { class: 'address', value: parts.host, from: hostAt, to: hostAt + parts.host.length };
    return [whole].concat(parts.host.length === 0 ? [] : [host], inner);
  });
}

function scalarIds(text: string): ValueMatch[] {
  return matchedIn(text, scalar).flatMap(({ text: line, groups, at }: Matched) => {
    const value = String(groups[2]);
    if (wordsAndNumbers.test(value) || !/[0-9]/u.test(value) || !/[A-Za-z]/u.test(value)) return [];
    const from = at + line.lastIndexOf(value);
    const found: ValueMatch = { class: 'id', value, from, to: from + value.length };
    return [found];
  });
}

function channelNames(text: string): ValueMatch[] {
  return matchesOf(text, channelName, 'handle')
    .map((match: ValueMatch) => trimmed(match, nameEnd))
    .filter(({ value }: ValueMatch) => /[a-z]/u.test(value) && !colour.test(value));
}

function atNames(text: string): ValueMatch[] {
  return matchesOf(text, atName, 'handle')
    .map((match: ValueMatch) => trimmed(match, nameEnd))
    .filter(({ to }: ValueMatch) => text[to] !== '/');
}

function byPlace(left: ValueMatch, right: ValueMatch): number {
  return left.from === right.from ? right.to - left.to : left.from - right.from;
}

function asSecretAround(match: ValueMatch, secrets: readonly ValueMatch[]): ValueMatch {
  const around = secrets.some(({ from, to }) => match.from <= from && to <= match.to);
  return around ? { class: 'secret', value: match.value, from: match.from, to: match.to } : match;
}

export function valueMatchesIn(text: string): ValueMatch[] {
  const matches = [
    ...tokenShapes.flatMap((pattern: Readonly<RegExp>) => matchesOf(text, pattern, 'secret')),
    ...urlMatches(text),
    ...matchesOf(text, email, 'address'),
    ...matchesOf(text, chatId, 'id'),
    ...matchesOf(text, prefixedId, 'id'),
    ...matchesOf(text, uuid, 'id'),
    ...scalarIds(text),
    ...channelNames(text),
    ...atNames(text),
  ];
  const secrets = matches.filter((match) => match.class === 'secret');
  const seen = new Set<string>();
  return matches
    .map((match) => asSecretAround(match, secrets))
    .filter(({ class: valueClass, from, to }: ValueMatch) => {
      const key = `${valueClass} ${from} ${to}`;
      const first = !seen.has(key);
      seen.add(key);
      return first;
    })
    .toSorted((left: ValueMatch, right: ValueMatch) => byPlace(left, right));
}
