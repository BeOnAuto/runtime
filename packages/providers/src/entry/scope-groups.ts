import { isScope } from '@on.auto/tool-servers';
import { Schema } from 'effect';

type EntryIssue = Schema.FilterIssue;

const mostSentenceCharacters = 120;

const SentenceSchema = Schema.String.check(
  Schema.isMaxLength(mostSentenceCharacters),
  Schema.isPattern(/^[A-Z][^.]*(?:\.[^.\s][^.]*)*\.$/u, {
    expected: 'one sentence that opens with a capital letter and ends with its one period',
  }),
);

export const ScopeWordsSchema = Schema.Record(Schema.String, SentenceSchema);

const GroupNameSchema = Schema.String.check(
  Schema.isPattern(/^[a-z][a-z0-9_]{0,31}$/u, {
    expected: '1 to 32 lowercase letters, digits and underscores, starting with a letter',
  }),
);

export const ScopeGroupSchema = Schema.Struct({
  name: GroupNameSchema.annotate({ description: 'The name a tool and a consent that asks more name the group by' }),
  for: SentenceSchema.annotate({ description: "What the group is for, in one sentence of the person's words" }),
  scope: Schema.String.annotate({
    description: 'The scopes it adds to those the way asks, separated by single spaces',
  }),
  says: ScopeWordsSchema.annotate({ description: 'What a connection can do through each scope it adds, by the scope' }),
});

export type ScopeGroup = typeof ScopeGroupSchema.Type;

export const notScopes = 'Expected scopes separated by single spaces, such as files.read mail.send';

export function scopesIn(scope: string | undefined): readonly string[] {
  return scope === undefined ? [] : scope.split(' ');
}

export function scopeWith(scope: string | undefined, added: string): string {
  return [...new Set([...scopesIn(scope), ...scopesIn(added)])].join(' ');
}

function scopesSaidIn(scope: string | undefined, says: Readonly<Record<string, string>>): readonly string[] {
  return scope === undefined || isScope(scope) ? scopesIn(scope) : Object.keys(says);
}

interface Saying {
  readonly path: readonly PropertyKey[];
  readonly asking: string;
}

function wordsIssuesAt(
  { path, asking }: Saying,
  scope: string | undefined,
  says: Readonly<Record<string, string>> = {},
): readonly EntryIssue[] {
  const asked = scopesSaidIn(scope, says);
  return [
    ...asked
      .filter((name) => !Object.hasOwn(says, name))
      .map((name) => ({
        path: [...path, 'says'],
        issue: `Expected words for the scope ${name}: one sentence of at most ${mostSentenceCharacters} characters that says what a connection can do through it`,
      })),
    ...Object.keys(says)
      .filter((name) => !asked.includes(name))
      .map((name) => ({ path: [...path, 'says', name], issue: `Expected words only for a scope ${asking}` })),
  ];
}

export function wordsIssuesOf(
  scope: string | undefined,
  says?: Readonly<Record<string, string>>,
): readonly EntryIssue[] {
  return wordsIssuesAt({ path: [], asking: 'the way asks' }, scope, says);
}

function groupScopeIssuesOf(index: number, scope: string, askedBefore: readonly string[]): readonly EntryIssue[] {
  const path = ['more', index, 'scope'];
  if (!isScope(scope)) {
    return [{ path, issue: notScopes }];
  }
  const scopes = scopesIn(scope);
  return [
    ...scopes
      .filter((name, at) => scopes.indexOf(name) !== at)
      .map((name) => ({ path, issue: `Expected ${name} once in the scope of the group` })),
    ...scopes
      .filter((name) => askedBefore.includes(name))
      .map((name) => ({ path, issue: `Expected no ${name}, which scope or an earlier group of more asks already` })),
  ];
}

interface Growing {
  readonly scope?: string | undefined;
  readonly more?: readonly ScopeGroup[] | undefined;
}

const moreWithoutAScope = 'Expected more only on a way that asks a scope, to which each group adds its own';

export function groupIssuesOf({ scope, more = [] }: Growing): readonly EntryIssue[] {
  if (scope === undefined && more.length > 0) {
    return [{ path: ['more'], issue: moreWithoutAScope }];
  }
  const names = more.map(({ name }) => name);
  return more.flatMap((group, index): readonly EntryIssue[] => {
    const askedBefore = [scope, ...more.slice(0, index).map((earlier) => earlier.scope)].flatMap((each) =>
      scopesIn(each),
    );
    return [
      ...(names.indexOf(group.name) === index
        ? []
        : [{ path: ['more', index, 'name'], issue: 'Expected a name no earlier group of more has' }]),
      ...groupScopeIssuesOf(index, group.scope, askedBefore),
      ...wordsIssuesAt({ path: ['more', index], asking: 'the group adds' }, group.scope, group.says),
    ];
  });
}
