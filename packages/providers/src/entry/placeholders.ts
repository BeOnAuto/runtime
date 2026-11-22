import { isPinnableUrl } from '@on.auto/tool-servers';
import { Schema } from 'effect';

export const clientIdPlaceholder = 'client_id';

const addressFormat = 'uri';

const NamedSchema = Schema.String.check(Schema.isMinLength(1));

const heldDollar =
  'Holds a $, which a value an entry places never holds, since a reference to an environment variable begins with it';

const PlacedSchema = NamedSchema.check(
  Schema.makeFilter((text: string) => (text.includes('$') ? heldDollar : undefined)),
);

const ChoiceSchema = Schema.Struct({
  value: PlacedSchema,
  title: NamedSchema,
  sets: Schema.optionalKey(Schema.Record(Schema.String, PlacedSchema)),
});

export type Choice = typeof ChoiceSchema.Type;

const mostTitleCharacters = 40;

const PlaceholderFieldsSchema = Schema.Struct({
  title: Schema.optionalKey(
    NamedSchema.check(Schema.isMaxLength(mostTitleCharacters)).annotate({
      description: 'The label of the field a person gives the value in, in at most 40 characters',
    }),
  ),
  description: NamedSchema,
  format: Schema.optionalKey(
    Schema.Literal(addressFormat).annotate({
      description:
        'uri for a value that is a whole address, an https URL or an http URL on a loopback address, which stands only as the whole url of an mcp provider',
    }),
  ),
  pattern: Schema.optionalKey(Schema.String),
  example: Schema.optionalKey(Schema.String),
  required: Schema.optionalKey(Schema.Boolean),
  choices: Schema.optionalKey(Schema.Array(ChoiceSchema).check(Schema.isMinLength(1))),
});

export type Placeholder = typeof PlaceholderFieldsSchema.Type;

type PlaceholderIssue = Schema.FilterIssue;

const anchored = /^\^.*\$$/su;

export function patternOf(pattern: string): RegExp | undefined {
  try {
    return anchored.test(pattern) ? new RegExp(pattern, 'u') : undefined;
  } catch {
    return undefined;
  }
}

function patternIssuesOf({ pattern, example }: Placeholder): readonly PlaceholderIssue[] {
  if (pattern === undefined || example === undefined) {
    return [
      ...(pattern === undefined ? [{ path: ['pattern'], issue: 'Expected pattern, or choices' }] : []),
      ...(example === undefined ? [{ path: ['example'], issue: 'Expected example, or choices' }] : []),
    ];
  }
  const compiled = patternOf(pattern);
  if (compiled === undefined) {
    return [{ path: ['pattern'], issue: 'Expected a regular expression anchored with ^ and $' }];
  }
  return compiled.test(example) ? [] : [{ path: ['example'], issue: `Expected an example that matches ${pattern}` }];
}

function setNamesOf({ sets = {} }: Choice): string {
  return Object.keys(sets).toSorted().join(' ');
}

function choiceIssuesOf(choices: readonly Choice[]): readonly PlaceholderIssue[] {
  const [first] = choices;
  const values = choices.map(({ value }) => value);
  return choices.flatMap((choice, index): readonly PlaceholderIssue[] => [
    ...(values.indexOf(choice.value) === index
      ? []
      : [{ path: ['choices', index, 'value'], issue: 'Expected a value no other choice has' }]),
    ...(first === undefined || setNamesOf(choice) === setNamesOf(first)
      ? []
      : [
          {
            path: ['choices', index, 'sets'],
            issue: 'Expected the names the first choice sets, each choice setting the same',
          },
        ]),
  ]);
}

const takenWithChoices: readonly (keyof Placeholder)[] = ['pattern', 'example', 'required'];

const takenWithAnAddress: readonly (keyof Placeholder)[] = ['pattern', 'required', 'choices'];

export function isAnAddress({ format }: Placeholder): boolean {
  return format === addressFormat;
}

interface Addressed {
  readonly type: string;
  readonly url?: string | undefined;
  readonly placeholders?: Readonly<Record<string, Placeholder>> | undefined;
}

export function addressGivenWholeIn({ type, url, placeholders = {} }: Addressed): string | undefined {
  const given = Object.entries(placeholders).find(
    ([name, placeholder]: readonly [string, Placeholder]) =>
      type === 'mcp' && url === `{${name}}` && isAnAddress(placeholder),
  );
  return given?.[0];
}

function addressIssuesOf(placeholder: Placeholder): readonly PlaceholderIssue[] {
  const { example } = placeholder;
  return [
    ...takenWithAnAddress
      .filter((field) => placeholder[field] !== undefined)
      .map((field) => ({
        path: [field],
        issue: `Expected no ${field}: a placeholder of format uri takes a description and an example, and its value is checked as the address of a server given by hand`,
      })),
    ...(example === undefined
      ? [{ path: ['example'], issue: 'Expected example, which a placeholder of format uri takes' }]
      : []),
    ...(example === undefined || isPinnableUrl(example)
      ? []
      : [
          {
            path: ['example'],
            issue: 'Expected an example that is an https URL, or an http URL on a loopback address',
          },
        ]),
  ];
}

function placeholderIssuesOf(placeholder: Placeholder): readonly PlaceholderIssue[] {
  if (isAnAddress(placeholder)) {
    return addressIssuesOf(placeholder);
  }
  if (placeholder.choices === undefined) {
    return patternIssuesOf(placeholder);
  }
  return [
    ...takenWithChoices
      .filter((field) => placeholder[field] !== undefined)
      .map((field) => ({
        path: [field],
        issue: `Expected no ${field}: a placeholder of choices takes a description and its choices`,
      })),
    ...choiceIssuesOf(placeholder.choices),
  ];
}

const PlaceholderSchema = PlaceholderFieldsSchema.check(
  Schema.makeFilter((placeholder: Placeholder) => placeholderIssuesOf(placeholder)),
);

export const PlaceholdersSchema = Schema.Record(Schema.String, PlaceholderSchema);

export function isRequired({ required = true }: Placeholder): boolean {
  return required;
}

type Placed = ReadonlyMap<string, string>;

function placedBy({ sets = {} }: Choice): Placed {
  return new Map(Object.entries(sets));
}

export function setCombinationsOf(placeholders: Readonly<Record<string, Placeholder>>): readonly Placed[] {
  return Object.values(placeholders)
    .flatMap(({ choices }: Placeholder) => (choices === undefined ? [] : [choices]))
    .reduce<readonly Placed[]>(
      (combined, choices) =>
        combined.flatMap((placed) => choices.map((choice) => new Map([...placed, ...placedBy(choice)]))),
      [new Map()],
    );
}

export function setNamesOfEach(placeholders: Readonly<Record<string, Placeholder>>): readonly string[] {
  return [
    ...new Set(
      Object.values(placeholders).flatMap(({ choices = [] }) => choices.flatMap(({ sets = {} }) => Object.keys(sets))),
    ),
  ];
}
