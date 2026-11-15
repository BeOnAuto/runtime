import { serverNameProblems } from '@on.auto/tool-servers';
import { Schema } from 'effect';

export const ReplacesSchema = Schema.Array(Schema.String).check(Schema.isMinLength(1)).annotate({
  description:
    'The providers this one replaces, by name: where both are served, no way of a provider it replaces is offered, a connection made from one is not used, and reconnecting such a connection adds it again from this provider under its name',
});

interface Replacing {
  readonly name: string;
  readonly replaces?: readonly string[] | undefined;
}

interface EntryIssue {
  readonly path: readonly (string | number)[];
  readonly issue: string;
}

const itself = 'Expected another provider: a provider does not replace itself';

const named = 'Expected each provider once';

function issueOfOne(replaced: string, index: number, { name, replaces = [] }: Replacing): string | undefined {
  const [problem] = serverNameProblems(replaced, []);
  if (problem !== undefined) {
    return problem.detail;
  }
  if (replaced === name) {
    return itself;
  }
  return replaces.indexOf(replaced) === index ? undefined : named;
}

export function replacedIssuesOf(entry: Replacing): readonly EntryIssue[] {
  return (entry.replaces ?? []).flatMap((replaced, index): readonly EntryIssue[] => {
    const issue = issueOfOne(replaced, index, entry);
    return issue === undefined ? [] : [{ path: ['replaces', index], issue }];
  });
}
