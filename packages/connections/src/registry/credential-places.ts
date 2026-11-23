import { variableNamePattern } from '@on.auto/config';
import { headerNamePattern } from '@on.auto/tool-servers';

interface FieldIssue {
  readonly path: readonly string[];
  readonly issue: string;
}

interface Placed {
  readonly variable?: string | undefined;
  readonly name?: string | undefined;
  readonly in?: string | undefined;
}

export function variableIssuesOf({ variable }: Placed): readonly FieldIssue[] {
  return variable === undefined || variableNamePattern.test(variable)
    ? []
    : [
        {
          path: ['variable'],
          issue: 'Expected the name of a variable: letters, digits and underscores, not starting with a digit',
        },
      ];
}

export function nameIssuesOf({ name, in: placement }: Placed): readonly FieldIssue[] {
  return name !== undefined && placement === 'header' && !headerNamePattern.test(name)
    ? [{ path: ['name'], issue: 'Expected a header name' }]
    : [];
}
