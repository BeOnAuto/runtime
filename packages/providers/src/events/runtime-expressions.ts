import { alternatives } from '@on.auto/phrasing';
import { headerNamePattern } from '@on.auto/tool-servers';

type RequestSource = 'header' | 'query' | 'body';

type MessageSource = 'header' | 'payload';

export type ExpressionPlace =
  | { readonly transport: 'request'; readonly sources: readonly RequestSource[]; readonly because?: string }
  | { readonly transport: 'message'; readonly sources: readonly MessageSource[]; readonly because?: string };

const jsonPointer = String.raw`(?:/(?:[^~/]|~[01])*)+`;

const requestExpression = new RegExp(
  String.raw`^\$request\.(?:header\.(?<header>\S+)|query\.(?<query>\S+)|body#(?<body>${jsonPointer}))$`,
  'u',
);

const messageExpression = new RegExp(String.raw`^\$message\.(?<source>header|payload)#${jsonPointer}$`, 'u');

const requestShapes: Readonly<Record<RequestSource, string>> = {
  header: '$request.header.<name>',
  query: '$request.query.<name>',
  body: '$request.body#/<pointer>',
};

const messageShapes: Readonly<Record<MessageSource, string>> = {
  header: '$message.header#/<pointer>',
  payload: '$message.payload#/<pointer>',
};

function requestSourceOf(expression: string): RequestSource | undefined {
  const found = requestExpression.exec(expression)?.groups ?? {};
  const header = found['header'];
  if (header !== undefined) {
    return headerNamePattern.test(header) ? 'header' : undefined;
  }
  if (found['query'] !== undefined) {
    return 'query';
  }
  return found['body'] === undefined ? undefined : 'body';
}

function messageSourceOf(expression: string): MessageSource | undefined {
  const source = messageExpression.exec(expression)?.groups?.['source'];
  return source === 'header' || source === 'payload' ? source : undefined;
}

function expectedOf(place: ExpressionPlace): string {
  const expected =
    place.transport === 'request'
      ? `Expected ${alternatives(place.sources.map((source) => requestShapes[source]))}, a runtime expression of OpenAPI into the request`
      : `Expected ${alternatives(place.sources.map((source) => messageShapes[source]))}, a runtime expression of AsyncAPI into the message`;
  return place.because === undefined ? expected : `${expected}, ${place.because}`;
}

function isOfItsPlace(expression: string, place: ExpressionPlace): boolean {
  if (place.transport === 'request') {
    const source = requestSourceOf(expression);
    return source !== undefined && place.sources.includes(source);
  }
  const source = messageSourceOf(expression);
  return source !== undefined && place.sources.includes(source);
}

export function expressionIssueOf(expression: string, place: ExpressionPlace): string | undefined {
  return isOfItsPlace(expression, place) ? undefined : expectedOf(place);
}

export function inEveryPlaceOf(transport: ExpressionPlace['transport']): ExpressionPlace {
  return transport === 'request'
    ? { transport, sources: ['header', 'query', 'body'] }
    : { transport, sources: ['header', 'payload'] };
}
