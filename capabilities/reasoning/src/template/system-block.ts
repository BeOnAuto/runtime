import type { LineOfOffset } from '@on.auto/definitions/template';
import { toValueSync, TypeGuards, type Template } from 'liquidjs';

import type { TemplateIssue } from './compiled-template.ts';

type MarkerName = 'system' | 'endsystem';

interface Marker {
  readonly name: MarkerName;
  readonly line: number;
  readonly offset: number;
}

interface Node {
  readonly marker: Marker | undefined;
  readonly blank: boolean;
  readonly children: readonly Template[];
}

export interface Outline {
  readonly top: readonly Marker[];
  readonly nested: readonly Marker[];
  readonly hasMessage: boolean;
}

function markerNamed(name: string): MarkerName | undefined {
  return name === 'system' || name === 'endsystem' ? name : undefined;
}

function nodeOf(template: () => Template, lineOf: LineOfOffset): Node {
  const current = template();
  const { token } = current;
  const name = TypeGuards.isTagToken(token) ? markerNamed(token.name) : undefined;
  return {
    marker: name === undefined ? undefined : { name, line: lineOf(token.begin), offset: token.begin },
    blank: TypeGuards.isHTMLToken(token) && token.getContent().trim() === '',
    children: current.children === undefined ? [] : toValueSync(current.children(false, true)),
  };
}

export function outlineOf(templates: () => readonly Template[], lineOf: LineOfOffset): Outline {
  const top: Marker[] = [];
  const nested: Marker[] = [];
  const pending: Template[] = [];
  let inside = false;
  let hasMessage = false;
  for (const template of templates()) {
    const { marker, blank, children } = nodeOf(() => template, lineOf);
    top.push(...(marker === undefined ? [] : [marker]));
    inside = marker === undefined ? inside : marker.name === 'system';
    hasMessage ||= !inside && marker === undefined && !blank;
    pending.push(...children);
  }
  let template = pending.pop();
  while (template !== undefined) {
    const current = template;
    const { marker, children } = nodeOf(() => current, lineOf);
    nested.push(...(marker === undefined ? [] : [marker]));
    pending.push(...children);
    template = pending.pop();
  }
  return { top, nested: nested.toSorted((first, second) => first.offset - second.offset), hasMessage };
}

function nestedIssues(nested: readonly Marker[]): readonly TemplateIssue[] {
  return nested.map(({ name, line }) => ({
    line,
    detail: `{% ${name} %} must stand at the top level of the template, outside every other tag`,
  }));
}

function sequenceIssues(top: readonly Marker[]): readonly TemplateIssue[] {
  const issues: TemplateIssue[] = [];
  let open: Marker | undefined;
  let closed = false;
  for (const marker of top) {
    if (marker.name === 'system' && (open !== undefined || closed)) {
      issues.push({ line: marker.line, detail: 'A template holds at most one {% system %} block' });
    } else if (marker.name === 'system') {
      open = marker;
    } else if (open === undefined) {
      issues.push({ line: marker.line, detail: '{% endsystem %} closes no {% system %}' });
    } else {
      open = undefined;
      closed = true;
    }
  }
  return open === undefined
    ? issues
    : [...issues, { line: open.line, detail: '{% system %} is never closed by {% endsystem %}' }];
}

export function markerIssues({ top, nested }: Outline): readonly TemplateIssue[] {
  return [...sequenceIssues(top), ...nestedIssues(nested)].toSorted((first, second) => first.line - second.line);
}
