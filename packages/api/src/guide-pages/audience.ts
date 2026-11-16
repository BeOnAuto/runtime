const audiences: readonly string[] = ['operator', 'developer', 'user'];

const blockOpening = /^<div data-audience="([^"]*)">$/u;

const spanOpening = /^<span data-audience="([^"]*)">$/u;

export const blockClosing = '</div>';

export const spanClosing = '</span>';

export function audienceOfABlock(tag: string): string | undefined {
  return blockOpening.exec(tag)?.[1];
}

export function audienceOfASpan(tag: string): string | undefined {
  return spanOpening.exec(tag)?.[1];
}

export function unknownAudienceIn(value: string): string | undefined {
  const named = value.split(' ');
  const known = named.every((name) => audiences.includes(name)) && new Set(named).size === named.length;
  return known
    ? undefined
    : `names no audience a page may name in data-audience="${value}": name one or more of ${audiences.join(', ')}, each once and separated by one space.`;
}
