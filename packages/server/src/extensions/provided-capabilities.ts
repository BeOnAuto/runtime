import { firstLineOf } from '@on.auto/definitions';
import type { ProvidedCapability, SomeFolder } from '@on.auto/workflow-host';
import { Predicate, Result, Schema, SchemaIssue } from 'effect';

const missing = 'missing';

function kept<Kept extends Schema.Top>(schema: Kept, kind: string) {
  return schema.annotate({ message: kind }).annotateKey({ messageMissingKey: missing });
}

const aFunction = kept(Schema.declare(Predicate.isFunction), 'a function');

const text = kept(Schema.String, 'text');

const aNumber = kept(Schema.Number, 'a number');

const aBoolean = kept(Schema.Boolean, 'a boolean');

function aList<Item extends Schema.Top>(item: Item) {
  return kept(Schema.Array(item), 'a list');
}

function anObject<Fields extends Schema.Struct.Fields>(fields: Fields) {
  return kept(Schema.Struct(fields), 'an object');
}

const CapabilitySchema = anObject({
  type: text,
  title: text,
  guide: anObject({ name: text, onThisServer: Schema.optionalKey(text) }),
  noun: anObject({ one: text, other: text }),
  describeOutput: aFunction,
  mediaType: text,
  longestAnyRunMs: aNumber,
  reachesOutside: aBoolean,
  mayChangeOutside: aBoolean,
  mostActive: aNumber,
  standing: aFunction,
  cancel: aFunction,
  runWords: anObject({ deferralType: text, deferral: aFunction }),
  facts: anObject({ onRuns: aList(Schema.Unknown), streams: aList(Schema.Unknown) }),
  resumes: aBoolean,
  prepare: aFunction,
});

const StatementSchema = anObject({ strings: aList(Schema.String), values: aList(Schema.Unknown) });

const FolderSchema = anObject({
  definitionType: text,
  tables: aList(StatementSchema),
  rebuildsAtOnce: aNumber,
  keptOf: aFunction,
  keyOf: aFunction,
  typesOf: aFunction,
  playbooksWithRows: aFunction,
  rowsOf: aFunction,
  reconcile: aFunction,
  dropped: aFunction,
  phased: aFunction,
  fold: aFunction,
  write: aFunction,
  unchanged: aFunction,
  joinedLive: aFunction,
  hasChanged: aFunction,
});

const RegistrationSchema = anObject({
  scope: kept(Schema.Literal('playbook'), 'playbook'),
  kind: kept(Schema.Literals(['query', 'command']), 'query or command'),
  name: text,
  title: text,
  description: text,
  route: anObject({ method: text, path: text }),
  pathParameters: aList(Schema.String),
  targetsPlaybook: aBoolean,
  successStatus: aNumber,
  reachesOutside: aBoolean,
  mayChangeOutside: aBoolean,
  irreversible: aBoolean,
  repeatable: aBoolean,
  permissions: aList(Schema.String),
  reasons: aList(Schema.Unknown),
  input: anObject({}),
  refusesEmptyBody: aBoolean,
  output: anObject({}),
  run: aFunction,
  servedOverHttpAlone: Schema.optionalKey(kept(Schema.Undefined, 'absent, since a playbook operation is a tool too')),
});

const ProvidedCapabilitySchema = anObject({
  capability: CapabilitySchema,
  folders: Schema.optionalKey(aList(aFunction)),
  operations: Schema.optionalKey(aList(anObject({ registration: RegistrationSchema }))),
  dueWork: Schema.optionalKey(aList(anObject({ name: text, due: aFunction, nextDueAt: aFunction }))),
});

const decodeProvided = Schema.decodeUnknownResult(ProvidedCapabilitySchema);

const decodeFolder = Schema.decodeUnknownResult(FolderSchema);

const issuesOf = SchemaIssue.makeFormatterStandardSchemaV1();

function placeOf(path: readonly PropertyKey[]): string {
  const [first, ...rest] = path;
  if (first === undefined) {
    return 'what it makes';
  }
  const within = rest.map((key) => (typeof key === 'number' ? `[${key}]` : `.${String(key)}`)).join('');
  return `its ${String(first)}${within}`;
}

function problemAt(path: readonly PropertyKey[], message: string): string {
  return message === missing
    ? `${placeOf(path.slice(0, -1))} has no ${String(path.at(-1))}`
    : `${placeOf(path)} is not ${message}`;
}

function problemOf(issue: SchemaIssue.Issue, within: readonly PropertyKey[]): string {
  return issuesOf(issue)
    .issues.map(({ path = [], message }) =>
      problemAt([...within, ...path.filter((segment) => Predicate.isPropertyKey(segment))], message),
    )
    .join('; ');
}

function isProvidedCapability(made: unknown): made is ProvidedCapability {
  return Result.isSuccess(decodeProvided(made));
}

function isPlainObject(value: object): boolean {
  return Object.getPrototypeOf(value) === Object.prototype;
}

function folderProblem(folder: SomeFolder, at: number): string | undefined {
  const opened = Result.try({ try: () => folder((given): unknown => given), catch: firstLineOf });
  if (Result.isFailure(opened)) {
    return `its folders[${at}] could not be opened: ${opened.failure}`;
  }
  const decoded = decodeFolder(opened.success);
  return Result.isSuccess(decoded) ? undefined : problemOf(decoded.failure.issue, ['folders', at]);
}

function shapeProblem({ capability, folders = [] }: ProvidedCapability): string | undefined {
  if (!isPlainObject(capability)) {
    return 'its capability is not a plain object of its members, as defineCapability makes one';
  }
  return folders.map((folder, at) => folderProblem(folder, at)).find((problem) => problem !== undefined);
}

export function providedCapabilityOf(made: unknown): Result.Result<ProvidedCapability, string> {
  if (!isProvidedCapability(made)) {
    return Result.fail(problemOf(Result.getOrThrow(Result.flip(decodeProvided(made))).issue, []));
  }
  const problem = shapeProblem(made);
  return problem === undefined ? Result.succeed(made) : Result.fail(problem);
}
