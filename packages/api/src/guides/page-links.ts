const publishedDocs = 'https://on.auto/docs/';

const markdownLink = /\[([^\]\n]+)\]\(([^)\s]+)\)/gu;

const absoluteAddress = /^[a-z][a-z0-9+.-]*:/iu;

const fence = /^```/mu;

function resolved(words: string, address: string, page: string): string {
  if (absoluteAddress.test(address)) {
    return `[${words}](${address})`;
  }
  if (address.startsWith('#')) {
    return words;
  }
  const published = new URL(address, `${publishedDocs}${page}`);
  return `[${words}](${published.origin}${published.pathname.replace(/\.md$/u, '')}${published.hash})`;
}

export function withLinksResolved(text: string, page: string): string {
  return text
    .split(fence)
    .map((part, index) =>
      index % 2 === 0
        ? part.replaceAll(markdownLink, (_link, words: string, address: string) => resolved(words, address, page))
        : part,
    )
    .join('```');
}
