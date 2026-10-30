import type { DocumentIssue } from '@on.auto/definitions/document';
import type { VariableReference, VariableSegment } from '@on.auto/definitions/template';

type Shape = 'value' | 'text' | { readonly fields: Readonly<Record<string, Shape>> } | { readonly items: Shape };

const featureShape: Shape = { fields: { name: 'text', as: 'text', given: 'value' } };

const datasetShape: Shape = {
  fields: {
    rows: 'value',
    series: 'value',
    periods: { fields: { grain: 'text', season: 'value', first: 'text', last: 'text' } },
    window: 'value',
    holdout: 'value',
    features: { items: featureShape },
    horizons: { items: 'value' },
    accumulates: 'value',
  },
};

const functionShape: Shape = {
  fields: { name: 'text', target: 'text', unit: 'text', rules: { items: 'text' } },
};

const roots: Readonly<Record<string, Shape>> = { dataset: datasetShape, function: functionShape };

const listProperties = new Set(['first', 'last']);

function isItemSegment(segment: VariableSegment): boolean {
  return typeof segment !== 'string' || listProperties.has(segment);
}

function shapeAfter(shape: Shape, segment: VariableSegment): Shape | 'size' | undefined {
  if (segment === 'size' && shape !== 'value') {
    return 'size';
  }
  if (typeof shape === 'string') {
    return undefined;
  }
  if ('items' in shape) {
    return isItemSegment(segment) ? shape.items : undefined;
  }
  return typeof segment === 'string' && Object.hasOwn(shape.fields, segment) ? shape.fields[segment] : undefined;
}

function unknownAt(shape: Shape, path: readonly VariableSegment[]): number | undefined {
  const reached = path.reduce<{ readonly shape: Shape | 'size' | undefined; readonly at: number | undefined }>(
    (walked, segment, index) => {
      if (walked.shape === undefined) {
        return walked;
      }
      const next = walked.shape === 'size' ? undefined : shapeAfter(walked.shape, segment);
      return next === undefined ? { shape: undefined, at: index } : { shape: next, at: undefined };
    },
    { shape, at: undefined },
  );
  return reached.at;
}

const listIndex = /^\d+$/u;

function nameOf(path: readonly VariableSegment[]): string {
  return path
    .map((segment, index) => {
      if (typeof segment !== 'string') {
        return `[${String(segment)}]`;
      }
      return index === 0 ? segment : `.${segment}`;
    })
    .join('');
}

export function renderedNameOf(dotted: string): string {
  return nameOf(dotted.split('.').map((segment) => (listIndex.test(segment) ? Number(segment) : segment)));
}

function referenceIssue({ path, line }: VariableReference): DocumentIssue | undefined {
  const [root, ...rest] = path;
  const shape = typeof root === 'string' && Object.hasOwn(roots, root) ? roots[root] : undefined;
  if (shape === undefined) {
    return {
      line,
      pointer: '',
      detail: `${String(root)} is not a variable of the brief, which reads dataset and function alone`,
    };
  }
  const at = unknownAt(shape, rest);
  return at === undefined
    ? undefined
    : {
        line,
        pointer: '',
        detail: `${nameOf(path.slice(0, at + 2))} is not a part of ${String(root)}; the brief reads dataset (rows, series, periods, window, holdout, features, horizons, accumulates) and function (name, target, unit, rules)`,
      };
}

export function briefVariableIssues(variables: readonly VariableReference[]): readonly DocumentIssue[] {
  const issues = variables.flatMap((reference) => {
    const issue = referenceIssue(reference);
    return issue === undefined ? [] : [issue];
  });
  return [...new Map(issues.map((issue) => [`${issue.line} ${issue.detail}`, issue])).values()];
}
