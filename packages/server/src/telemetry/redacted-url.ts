const redacted = 'REDACTED';

const tokenOfALink = /(?<=\/connections\/[^/?#]+\/link\/)[^/?#]+/u;

export interface RequestTarget {
  readonly origin: string;
  readonly path: string;
}

export function redactedUrlAttributes({ origin, path }: RequestTarget): Readonly<Record<string, string>> {
  const url = URL.parse(path, origin);
  if (url === null) {
    return {};
  }
  url.username = '';
  url.password = '';
  for (const name of new Set(url.searchParams.keys())) {
    url.searchParams.set(name, redacted);
  }
  return { 'url.full': url.href, 'url.query': url.search };
}

export function withoutTheTokenOfALink(url: string): string {
  return url.replace(tokenOfALink, redacted);
}
