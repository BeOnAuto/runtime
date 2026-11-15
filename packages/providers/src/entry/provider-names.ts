import { serverNameProblems } from '@on.auto/tool-servers';
import { Schema } from 'effect';

export const AliasesSchema = Schema.Array(Schema.String).check(Schema.isMinLength(1)).annotate({
  description:
    'Other names the provider is found by, such as a name it had before: a connection added under one is read as made from this provider, and none is listed',
});

export const ReplacesSchema = Schema.Array(Schema.String).check(Schema.isMinLength(1)).annotate({
  description:
    'The providers this one replaces, by name: where both are served, no way of a provider it replaces is offered, a connection made from one is not used, and reconnecting such a connection adds it again from this provider under its name',
});

interface DeclaredNames {
  readonly name: string;
  readonly aliases?: readonly string[] | undefined;
  readonly replaces?: readonly string[] | undefined;
}

interface EntryIssue {
  readonly path: readonly (string | number)[];
  readonly issue: string;
}

const itsOwnName = "Expected another name: the provider's own name finds it already";

const named = 'Expected each name once';

const nameOfOneReplaced =
  'Expected a name the provider does not replace: a provider is not found by the name of one it replaces';

export function providerNamesOf({ name, aliases = [] }: DeclaredNames): readonly string[] {
  return [name, ...aliases];
}

function issueOfOne(
  alias: string,
  index: number,
  { name, aliases = [], replaces = [] }: DeclaredNames,
): string | undefined {
  const [problem] = serverNameProblems(alias, []);
  if (problem !== undefined) {
    return problem.detail;
  }
  if (alias === name) {
    return itsOwnName;
  }
  if (replaces.includes(alias)) {
    return nameOfOneReplaced;
  }
  return aliases.indexOf(alias) === index ? undefined : named;
}

export function aliasIssuesOf(entry: DeclaredNames): readonly EntryIssue[] {
  return (entry.aliases ?? []).flatMap((alias, index): readonly EntryIssue[] => {
    const issue = issueOfOne(alias, index, entry);
    return issue === undefined ? [] : [{ path: ['aliases', index], issue }];
  });
}

export interface AliasTaken {
  readonly entry: number;
  readonly at: number;
  readonly detail: string;
}

function takenWords(alias: string, another: string): string {
  return `Expected a name no other provider is found by: the provider ${another} is found by ${alias}`;
}

export function aliasesTakenIn(entries: readonly DeclaredNames[]): readonly AliasTaken[] {
  return entries.flatMap(({ aliases = [] }, entry) =>
    aliases.flatMap((alias, at): readonly AliasTaken[] => {
      const another = entries.find((other, index) => index !== entry && providerNamesOf(other).includes(alias));
      return another === undefined ? [] : [{ entry, at, detail: takenWords(alias, another.name) }];
    }),
  );
}

const itself = 'Expected another provider: a provider does not replace itself';

const replacedOnce = 'Expected each provider once';

function replacedIssueOfOne(
  replaced: string,
  index: number,
  { name, replaces = [] }: DeclaredNames,
): string | undefined {
  const [problem] = serverNameProblems(replaced, []);
  if (problem !== undefined) {
    return problem.detail;
  }
  if (replaced === name) {
    return itself;
  }
  return replaces.indexOf(replaced) === index ? undefined : replacedOnce;
}

export function replacedIssuesOf(entry: DeclaredNames): readonly EntryIssue[] {
  return (entry.replaces ?? []).flatMap((replaced, index): readonly EntryIssue[] => {
    const issue = replacedIssueOfOne(replaced, index, entry);
    return issue === undefined ? [] : [{ path: ['replaces', index], issue }];
  });
}
