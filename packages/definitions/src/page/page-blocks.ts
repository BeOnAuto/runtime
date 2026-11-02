import { Buffer } from 'node:buffer';

import { Result } from 'effect';
import { Tokenizer, TypeGuards } from 'liquidjs';

import type { DocumentIssue } from '../document/document-issue.ts';
import { engineFailureOf } from '../template/engine-failure.ts';
import { pageBlockNames, type PageBlock, type PageBlockName, type PageBlocks } from './page-document.ts';
import { pageTemplateWords } from './template-refusals.ts';

type Checked<A> = Result.Result<A, readonly DocumentIssue[]>;

const mostTemplateBytes = 32_768;

interface BodyToken {
  readonly tag: string | undefined;
  readonly arguments: string;
  readonly blank: boolean;
  readonly begin: number;
  readonly end: number;
  readonly line: number;
}

interface Opened {
  readonly name: PageBlockName;
  readonly token: BodyToken;
}

interface Around {
  readonly opener: BodyToken;
  readonly within: readonly BodyToken[];
  readonly wraps: boolean;
}

interface Scan {
  readonly blocks: PageBlocks;
  readonly issues: readonly DocumentIssue[];
  readonly opened: Opened | undefined;
  readonly around: readonly Around[];
}

interface Body {
  readonly text: string;
  readonly line: number;
}

const blockNames: ReadonlySet<string> = new Set(pageBlockNames);

const endNames: ReadonlySet<string> = new Set(pageBlockNames.map((name) => `end${name}`));

const enclosingTags: ReadonlySet<string> = new Set(['if', 'unless', 'case', 'for', 'tablerow', 'capture', 'comment']);

const outsideWords =
  'Put page content inside {% result %} or {% lately %} blocks. Only whitespace is allowed outside them';

const noBlockWords =
  'A page shows at least one block: {% result %} … {% endresult %}, {% lately %} … {% endlately %} or both';

const nestedWords = 'Put each block at the top level, outside other blocks and tags';

function isBlockName(name: string | undefined): name is PageBlockName {
  return name !== undefined && blockNames.has(name);
}

function lineIn(body: Body, offset: number): number {
  return body.line + body.text.slice(0, offset).split('\n').length - 1;
}

function withIssues(scan: Scan, token: BodyToken, details: readonly string[]): Scan {
  return { ...scan, issues: [...scan.issues, ...details.map((detail) => ({ line: token.line, pointer: '', detail }))] };
}

function argumentWords(token: BodyToken): readonly string[] {
  return token.arguments === '' ? [] : [`{% ${String(token.tag)} %} takes no arguments`];
}

function opening(scan: Scan, name: PageBlockName, token: BodyToken): Scan {
  const twice = scan.blocks[name] === undefined ? [] : [`A page writes {% ${name} %} at most once`];
  return { ...withIssues(scan, token, [...argumentWords(token), ...twice]), opened: { name, token } };
}

function strays(scan: Scan, tokens: readonly BodyToken[]): Scan {
  return tokens.filter(({ blank }) => !blank).reduce((next, token) => withIssues(next, token, [outsideWords]), scan);
}

function heldAround(scan: Scan, tokens: readonly BodyToken[]): Scan {
  const enclosing = scan.around.at(-1);
  return enclosing === undefined
    ? strays(scan, tokens)
    : { ...scan, around: [...scan.around.slice(0, -1), { ...enclosing, within: [...enclosing.within, ...tokens] }] };
}

function closedAround(scan: Scan, enclosing: Around, closer: BodyToken): Scan {
  const rest = { ...scan, around: scan.around.slice(0, -1) };
  return enclosing.wraps ? rest : heldAround(rest, [enclosing.opener, ...enclosing.within, closer]);
}

function openingWithin(scan: Scan, name: PageBlockName, token: BodyToken): Scan {
  const wrapped = { ...scan, around: scan.around.map((enclosing) => ({ ...enclosing, wraps: true })) };
  return opening(withIssues(wrapped, token, [nestedWords]), name, token);
}

function outside(scan: Scan, token: BodyToken): Scan {
  const enclosing = scan.around.at(-1);
  if (isBlockName(token.tag)) {
    return enclosing === undefined ? opening(scan, token.tag, token) : openingWithin(scan, token.tag, token);
  }
  if (enclosing !== undefined && token.tag === `end${String(enclosing.opener.tag)}`) {
    return closedAround(scan, enclosing, token);
  }
  return token.tag !== undefined && enclosingTags.has(token.tag)
    ? { ...scan, around: [...scan.around, { opener: token, within: [], wraps: false }] }
    : heldAround(scan, [token]);
}

function closing(scan: Scan, body: Body, opened: Opened, token: BodyToken): Scan {
  const block: PageBlock = {
    text: body.text.slice(opened.token.end, token.begin),
    line: lineIn(body, opened.token.end),
  };
  const blocks = scan.blocks[opened.name] === undefined ? { ...scan.blocks, [opened.name]: block } : scan.blocks;
  return { ...withIssues(scan, token, argumentWords(token)), blocks, opened: undefined };
}

function inside(scan: Scan, body: Body, opened: Opened, token: BodyToken): Scan {
  if (token.tag === `end${opened.name}`) {
    return closing(scan, body, opened, token);
  }
  return isBlockName(token.tag) || endNames.has(String(token.tag)) ? withIssues(scan, token, [nestedWords]) : scan;
}

function tokensOf(body: Body): Checked<readonly BodyToken[]> {
  const read: BodyToken[] = [];
  try {
    for (const token of new Tokenizer(body.text).readTopLevelTokens()) {
      const tag = TypeGuards.isTagToken(token) ? token : undefined;
      read.push({
        tag: tag?.name,
        arguments: tag?.args.trim() ?? '',
        blank: TypeGuards.isHTMLToken(token) && token.getContent().trim() === '',
        begin: token.begin,
        end: token.end,
        line: lineIn(body, token.begin),
      });
    }
    return Result.succeed(read);
  } catch (error) {
    const { line, message } = engineFailureOf(error, body.line);
    return Result.fail([{ line, pointer: '', detail: pageTemplateWords(message) }]);
  }
}

function sizeIssues(blocks: PageBlocks, line: number): readonly DocumentIssue[] {
  const bytes = Object.values(blocks).reduce((sum, { text }) => sum + Buffer.byteLength(text, 'utf8'), 0);
  return bytes > mostTemplateBytes
    ? [
        {
          line,
          pointer: '',
          detail: `The templates take ${bytes} bytes in UTF-8, more than the ${mostTemplateBytes} a page's templates may take together`,
        },
      ]
    : [];
}

function unclosedAround(scan: Scan): Scan {
  const settled: Scan = { ...scan, around: [] };
  return scan.around
    .filter(({ wraps }) => !wraps)
    .reduce((next: Scan, { opener, within }: Around) => strays(next, [opener, ...within]), settled);
}

function scanned(body: Body, tokens: readonly BodyToken[]): Scan {
  const start: Scan = { blocks: {}, issues: [], opened: undefined, around: [] };
  const end = unclosedAround(
    tokens.reduce(
      (scan, token) => (scan.opened === undefined ? outside(scan, token) : inside(scan, body, scan.opened, token)),
      start,
    ),
  );
  return end.opened === undefined
    ? end
    : withIssues(end, end.opened.token, [`{% ${end.opened.name} %} is never closed by {% end${end.opened.name} %}`]);
}

function blocksOf(body: Body, tokens: readonly BodyToken[]): Checked<PageBlocks> {
  const { blocks, issues } = scanned(body, tokens);
  const found = [
    ...issues,
    ...(issues.length === 0 && Object.keys(blocks).length === 0
      ? [{ line: body.line, pointer: '', detail: noBlockWords }]
      : []),
    ...sizeIssues(blocks, body.line),
  ];
  return found.length > 0 ? Result.fail(found) : Result.succeed(blocks);
}

export function pageBlocksIn(text: string, line: number): Checked<PageBlocks> {
  const body = { text, line };
  return Result.flatMap(tokensOf(body), (tokens) => blocksOf(body, tokens));
}
