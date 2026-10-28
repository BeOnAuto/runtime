const fence = /^```/mu;

const verbatimOpening = /^<div v-pre>\n+/u;

const verbatimClosing = /\n<\/div>\s*$/u;

const formatterLine = /^<!-- prettier-ignore -->\n/gmu;

const paddingBeforeABar = / {2,}\|/gu;

const longDelimiter = /-{4,}/gu;

function outsideCode(text: string, change: (part: string) => string): string {
  return text
    .split(fence)
    .map((part, index) => (index % 2 === 0 ? change(part) : part))
    .join('```');
}

function withoutColumnPadding(part: string): string {
  return part
    .split('\n')
    .map((line) =>
      line.startsWith('|') ? line.replaceAll(paddingBeforeABar, ' |').replaceAll(longDelimiter, '---') : line,
    )
    .join('\n');
}

function withoutFormatterLines(part: string): string {
  return part.replaceAll(formatterLine, '');
}

export function withoutSiteMarkup(page: string): string {
  const unformatted = outsideCode(page, (part) => withoutColumnPadding(withoutFormatterLines(part)));
  return `${unformatted.replace(verbatimOpening, '').replace(verbatimClosing, '').trimEnd()}\n`;
}
