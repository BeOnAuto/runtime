import { literalTextOf, parsedTemplate, type ParsedTemplate } from '@on.auto/definitions/template';
import { toolBlockEngine } from '@on.auto/definitions/tool-blocks';
import { Result } from 'effect';

export interface TopicOfARequest {
  readonly written: string | undefined;
  readonly rendered: string;
}

type Written = Pick<ParsedTemplate, 'templates' | 'variables'>;

const firstLine = 1;

const theTopic = 'topic';

const delimiters = ['/', '?', '#', '\\', '%'];

const thePathOfAReference = /^(?:[^:/?#]+:)?(?:\/\/[^/?#]*)?(?<path>[^?#]*).*$/su;

const nothingInPlace: ReadonlyMap<string, string> = new Map();

const nothingWritten: Written = { templates: () => [], variables: [] };

function templateOf(text: string): Written {
  return Result.getOrElse(parsedTemplate(toolBlockEngine, text, firstLine), () => nothingWritten);
}

function timesIn(text: string, delimiter: string): number {
  return text.split(delimiter).length - 1;
}

function addsNoDelimiter(literal: string, rendered: string): boolean {
  return delimiters.every((delimiter) => timesIn(rendered, delimiter) === timesIn(literal, delimiter));
}

function literalOfTheTopic({ written, rendered }: TopicOfARequest): string | undefined {
  const literal = literalTextOf(templateOf(written ?? ''), nothingInPlace);
  return addsNoDelimiter(literal, rendered) ? literal : undefined;
}

function literalOfTheUrl(written: string, topic: TopicOfARequest): string | undefined {
  const url = templateOf(written);
  if (!url.variables.some(({ path }) => path[0] === theTopic)) {
    return literalTextOf(url, nothingInPlace);
  }
  const literal = literalOfTheTopic(topic);
  return literal === undefined ? undefined : literalTextOf(url, new Map([[theTopic, literal]]));
}

function pathAsRendered(rendered: string): string {
  const path = rendered.replace(thePathOfAReference, '$<path>');
  return path === '' ? '/' : path;
}

function isAtTheOriginWritten(written: string, sent: Readonly<URL>): boolean {
  const before = URL.parse(written);
  return before !== null && sent.protocol === 'https:' && sent.origin === before.origin;
}

function keepsTheShapeWritten(written: string, rendered: string, sent: Readonly<URL>, topic: TopicOfARequest): boolean {
  const literal = literalOfTheUrl(written, topic);
  return literal !== undefined && addsNoDelimiter(literal, rendered) && sent.pathname === pathAsRendered(rendered);
}

export function isAddressedAsWritten(written: string, rendered: string, topic: TopicOfARequest): boolean {
  const sent = URL.parse(rendered);
  return sent !== null && isAtTheOriginWritten(written, sent) && keepsTheShapeWritten(written, rendered, sent, topic);
}
