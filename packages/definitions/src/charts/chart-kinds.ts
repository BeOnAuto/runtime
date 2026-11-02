import type { OutputShapeName } from '../shapes/shape-names.ts';

export type ChartRole = 'x' | 'y' | 'color' | 'size' | 'value' | 'low' | 'high' | 'mark' | 'start' | 'end';

export interface ChartKind {
  readonly name: string;
  readonly noun: string;
  readonly reads: readonly OutputShapeName[];
  readonly needs: readonly ChartRole[];
  readonly may: readonly ChartRole[];
}

const none: readonly ChartRole[] = [];

const noRoles: Pick<ChartKind, 'needs' | 'may'> = { needs: none, may: none };

function kind(
  name: string,
  noun: string,
  reads: readonly OutputShapeName[],
  roles: Pick<ChartKind, 'needs' | 'may'> = noRoles,
): ChartKind {
  return { name, noun, reads, ...roles };
}

export const chartKinds: readonly ChartKind[] = [
  kind('line', 'a line chart', ['series']),
  kind('bars', 'a bar chart', ['categories', 'table'], { needs: ['x', 'y'], may: ['color'] }),
  kind('stacked', 'a stacked chart', ['series']),
  kind('share', 'a share chart', ['categories']),
  kind('histogram', 'a histogram', ['categories']),
  kind('scatter', 'a scatter chart', ['table'], { needs: ['x', 'y'], may: ['color', 'mark'] }),
  kind('bubble', 'a bubble chart', ['table'], { needs: ['x', 'y', 'size'], may: ['color', 'mark'] }),
  kind('heatmap', 'a heatmap', ['table'], { needs: ['x', 'y', 'value'], may: none }),
  kind('range', 'a range chart', ['categories', 'table'], { needs: ['x', 'low', 'high'], may: ['value'] }),
  kind('funnel', 'a funnel', ['categories']),
  kind('calendar', 'a calendar', ['series']),
  kind('timeline', 'a timeline', ['table'], { needs: ['y', 'start', 'end'], may: ['color', 'mark'] }),
  kind('table', 'a table', ['table']),
  kind('figure', 'a figure', ['categories']),
  kind('text', 'a text', ['text']),
];

export function chartKindNamed(name: string): ChartKind | undefined {
  return chartKinds.find((each) => each.name === name);
}

export const shapeNouns: Readonly<Record<OutputShapeName, string>> = {
  series: 'a series',
  categories: 'categories',
  table: 'a table',
  text: 'text',
};
