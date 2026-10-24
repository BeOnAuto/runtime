const fence = /^```/mu;

const verbatimOpening = /^<div v-pre>\n+/u;

const verbatimClosing = /\n<\/div>\s*$/u;

const formatterLine = /^<!-- prettier-ignore -->\n/gmu;

function withoutFormatterLines(text: string): string {
  return text
    .split(fence)
    .map((part, index) => (index % 2 === 0 ? part.replaceAll(formatterLine, '') : part))
    .join('```');
}

export function withoutSiteMarkup(page: string): string {
  return `${withoutFormatterLines(page).replace(verbatimOpening, '').replace(verbatimClosing, '').trimEnd()}\n`;
}
