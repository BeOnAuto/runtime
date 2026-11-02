import type { VariableSegment } from '../template/template-parsing.ts';
import type { TemplateVariables } from './rendered-arguments.ts';

export interface TemplateSet {
  readonly names: readonly string[];
  readonly what: string;
  readonly sample: TemplateVariables;
  readonly structured: string;
}

export const sampleMoment = '2026-10-07T09:00:00.000Z';

export const callTemplates: TemplateSet = {
  names: ['input', 'today', 'now'],
  what: 'a template of a call',
  sample: { today: sampleMoment.slice(0, 10), now: sampleMoment },
  structured: 'input',
};

function nestsUnder({ names }: TemplateSet, first: string): boolean {
  return names.some((name) => name.startsWith(`${first}.`));
}

export function nameOf(set: TemplateSet, path: readonly VariableSegment[]): string {
  const [first, ...nested] = path.map(String);
  const outer = String(first);
  return nested.length > 0 && nestsUnder(set, outer) ? `${outer}.${String(nested[0])}` : outer;
}

export function reads(set: TemplateSet, path: readonly VariableSegment[]): boolean {
  const name = nameOf(set, path);
  return set.names.includes(name) || nestsUnder(set, name);
}
