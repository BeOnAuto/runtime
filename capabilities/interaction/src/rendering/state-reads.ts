import { expressionsIn, type Expression } from './expressions.ts';
import { pointerTo } from './json-pointers.ts';
import { entriesOf, isRecord } from './written-values.ts';

export interface StateRead {
  readonly pointer: string;
  readonly path: string;
}

function templatePathsIn(template: string): readonly string[] {
  const paths: string[] = [];
  template.replaceAll(templateReference, (_reference, path: string) => {
    paths.push(path);
    return '';
  });
  return paths;
}

const templateReference = /\$\{(\/[^}]*)\}/gu;

function readsOfExpression({ pointer, key, value }: Expression): readonly StateRead[] {
  if (typeof value !== 'string') {
    return [];
  }
  if (key === '$state') {
    return [{ pointer, path: value }];
  }
  if (key === '$template') {
    return templatePathsIn(value).map((path) => ({ pointer, path }));
  }
  return [];
}

function repeatReadOf(element: Readonly<Record<string, unknown>>, pointer: string): readonly StateRead[] {
  const repeat = element['repeat'];
  const statePath = isRecord(repeat) ? repeat['statePath'] : undefined;
  return typeof statePath === 'string'
    ? [{ pointer: pointerTo(pointerTo(pointer, 'repeat'), 'statePath'), path: statePath }]
    : [];
}

function readsOfElement(element: unknown, pointer: string): readonly StateRead[] {
  if (!isRecord(element)) {
    return [];
  }
  return [
    ...expressionsIn(element, pointer).flatMap((expression) => readsOfExpression(expression)),
    ...repeatReadOf(element, pointer),
  ];
}

export function stateReadsOf(card: unknown): readonly StateRead[] {
  const elements = isRecord(card) ? card['elements'] : undefined;
  if (!isRecord(elements)) {
    return [];
  }
  return entriesOf(elements).flatMap(([id, element]) => readsOfElement(element, pointerTo('/elements', id)));
}
