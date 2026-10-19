export type HtmlBlock = 'raw' | 'comment' | 'instruction' | 'declaration' | 'data' | 'element' | 'tag';

const blankLine = /^[ \t]*$/u;

const blockTags = [
  ['address', 'article', 'aside', 'base', 'basefont', 'blockquote', 'body', 'caption', 'center', 'col'],
  ['colgroup', 'dd', 'details', 'dialog', 'dir', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure'],
  ['footer', 'form', 'frame', 'frameset', 'h[1-6]', 'head', 'header', 'hr', 'html', 'iframe', 'legend'],
  ['li', 'link', 'main', 'menu', 'menuitem', 'nav', 'noframes', 'ol', 'optgroup', 'option', 'p', 'param'],
  ['search', 'section', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'title', 'tr', 'track', 'ul'],
].flat();

const tagName = '[A-Za-z][A-Za-z0-9-]*';

const attribute = `[ \\t]+[A-Za-z_:][A-Za-z0-9_.:-]*(?:[ \\t]*=[ \\t]*(?:[^ \\t"'=<>\`]+|'[^']*'|"[^"]*"))?`;

const htmlBlocks: readonly HtmlBlock[] = ['raw', 'comment', 'instruction', 'declaration', 'data', 'element', 'tag'];

const htmlOpeners: Readonly<Record<HtmlBlock, RegExp>> = {
  raw: /^<(?:script|pre|style|textarea)(?:[ \t>]|$)/iu,
  comment: /^<!--/u,
  instruction: /^<\?/u,
  declaration: /^<![A-Za-z]/u,
  data: /^<!\[CDATA\[/u,
  element: new RegExp(`^</?(?:${blockTags.join('|')})(?:[ \\t>]|/>|$)`, 'iu'),
  tag: new RegExp(`^(?:<${tagName}(?:${attribute})*[ \\t]*/?>|</${tagName}[ \\t]*>)[ \\t]*$`, 'iu'),
};

const htmlClosers: Readonly<Record<Exclude<HtmlBlock, 'raw'>, string>> = {
  comment: '-->',
  instruction: '?>',
  declaration: '>',
  data: ']]>',
  element: '',
  tag: '',
};

const endOfTheTagName = /[ \t>]|$/u;

export const htmlEnds: Readonly<Record<HtmlBlock, RegExp>> = {
  raw: /<\/(?:script|pre|style|textarea)>/iu,
  comment: /--!?>/u,
  instruction: /\?>/u,
  declaration: />/u,
  data: /\]\]>/u,
  element: blankLine,
  tag: blankLine,
};

export function htmlOpenedBy(content: string, interrupting: boolean): HtmlBlock | undefined {
  return htmlBlocks.find((html) => htmlOpeners[html].test(content) && !(html === 'tag' && interrupting));
}

export function htmlCloserOf(html: HtmlBlock, opener: string): string {
  return html === 'raw' ? `</${opener.slice(1, opener.search(endOfTheTagName)).toLowerCase()}>` : htmlClosers[html];
}
