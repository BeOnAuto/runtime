import type { Appended } from './trace-ledger.ts';

const plainKeys = ['verdict', 'by', 'told', 'reason'];

function measured(data: Readonly<Record<string, unknown>>): readonly string[] {
  const { measurement } = data;
  if (typeof measurement !== 'object' || measurement === null) {
    return [];
  }
  const value = String(Reflect.get(measurement, 'value'));
  return [Reflect.get(measurement, 'final') === true ? `${value} final` : value];
}

function dueIn(data: Readonly<Record<string, unknown>>): readonly string[] {
  const { window } = data;
  return typeof window === 'object' && window !== null ? [`due ${String(Reflect.get(window, 'due'))}`] : [];
}

export function wordsOf(appended: Appended, names: Readonly<Record<string, string>>): string {
  const data: Readonly<Record<string, unknown>> = appended.fact.data;
  const marks = typeof data['marks'] === 'string' ? [`marks ${data['marks']}`] : [];
  return [
    names[appended.assessment] ?? 'another',
    appended.fact.type.replace('goal_', ''),
    ...plainKeys.flatMap((key) => {
      const value = data[key];
      return typeof value === 'string' ? [value] : [];
    }),
    ...marks,
    ...measured(data),
    ...dueIn(data),
  ].join(' ');
}
