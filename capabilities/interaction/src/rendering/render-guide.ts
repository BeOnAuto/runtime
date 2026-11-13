import { interactionType } from '../capability/interaction-type.ts';
import { interactionBounds } from '../run/run-bounds.ts';
import { renderTargetNames, renderTargetOf, type RenderTargetName } from './render-targets.ts';
import type { CatalogEntry } from './slack-catalog.ts';
import { entriesOf, hasKey, isList, isRecord } from './written-values.ts';

type Target = ReturnType<typeof renderTargetOf>;

const kibibyte = 1024;

function namedEntriesOf<Value>(record: Readonly<Record<string, Value>>): readonly (readonly [string, Value])[] {
  return Object.entries(record);
}

function guideNameOf(name: RenderTargetName): string {
  return `render-${name}`;
}

function pagePathOf(name: RenderTargetName): string {
  return `reference/${guideNameOf(name)}.md`;
}

function wordsOfKind(kind: unknown, schema: Readonly<Record<string, unknown>>): string {
  if (kind === 'string') {
    if (schema['format'] === 'uri') {
      return 'URL';
    }
    return schema['minLength'] === 1 ? 'non-empty text' : 'text';
  }
  if (kind === 'number') {
    return schema['exclusiveMinimum'] === 0 ? 'number above 0' : 'number';
  }
  return String(kind);
}

function alternativesIn(schema: Readonly<Record<string, unknown>>): readonly Readonly<Record<string, unknown>>[] {
  const { anyOf, type } = schema;
  if (isList(anyOf)) {
    return anyOf.filter((alternative) => isRecord(alternative));
  }
  return isList(type) ? type.map((kind) => Object.assign({}, schema, { type: kind })) : [schema];
}

function requiredOf(schema: unknown): ReadonlySet<unknown> {
  return new Set(isRecord(schema) && isList(schema['required']) ? schema['required'] : []);
}

function propertiesOf(schema: unknown): readonly (readonly [string, unknown])[] {
  return entriesOf(isRecord(schema) && isRecord(schema['properties']) ? schema['properties'] : {});
}

function objectWords(schema: Readonly<Record<string, unknown>>): string {
  const needed = requiredOf(schema);
  const fields = propertiesOf(schema).map(
    ([name, inner]) => `${name}${needed.has(name) ? '' : '?'}: ${schemaWordsOf(inner)}`,
  );
  return fields.length === 0 ? '{}' : `{ ${fields.join(', ')} }`;
}

function arrayWords(schema: Readonly<Record<string, unknown>>): string {
  const items = `[${schemaWordsOf(schema['items'])}]`;
  return schema['minItems'] === 1 ? `${items} (1 or more)` : items;
}

function singleWords(schema: Readonly<Record<string, unknown>>): string {
  if (isList(schema['enum'])) {
    return schema['enum'].map(String).join(' | ');
  }
  if (hasKey(schema, 'const')) {
    return String(schema['const']);
  }
  if (schema['type'] === 'array') {
    return arrayWords(schema);
  }
  return schema['type'] === 'object' ? objectWords(schema) : wordsOfKind(schema['type'], schema);
}

export function schemaWordsOf(schema: unknown): string {
  if (!isRecord(schema)) {
    return 'any value';
  }
  const present = alternativesIn(schema).filter(({ type }) => type !== 'null');
  return [...new Set(present.map((alternative) => singleWords(alternative)))].join(' or ');
}

function propLinesOf(props: unknown): readonly string[] {
  const needed = requiredOf(props);
  const entries = propertiesOf(props);
  if (entries.length === 0) {
    return ['- No props: write `props: {}` or leave it out.'];
  }
  return entries.map(
    ([name, inner]) => `- \`${name}\`, ${needed.has(name) ? 'required' : 'optional'}: \`${schemaWordsOf(inner)}\``,
  );
}

function componentSectionOf(name: string, { description, takesChildren, props }: CatalogEntry): string {
  const children = takesChildren ? 'Takes `children`, a list of element ids.' : 'No `children`.';
  return [`### ${name}`, '', `${description} ${children}`, '', ...propLinesOf(props)].join('\n');
}

function componentsOf({ catalog, interactive }: Target): string {
  return namedEntriesOf(catalog)
    .filter(([name]) => !hasKey(interactive, name))
    .map(([name, entry]) => componentSectionOf(name, entry))
    .join('\n\n');
}

function refusalsOf({ interactive, label, shows }: Target): string {
  const refused = namedEntriesOf(interactive).map(([name, remedy]) => `- \`${name}\`: ${remedy}.`);
  return [
    ...refused,
    `- Anything else a ${label} message cannot show. The run names the element and says to write only ${shows}.`,
  ].join('\n');
}

function limitsOf({ limits }: Target): string {
  const counted = limits.map(({ words, most }) => `- ${words}: ${String(most)}`);
  return [
    ...counted,
    `- The plain text of the card, \`message\`: ${String(interactionBounds.messageBytes / kibibyte)} KiB`,
    `- The blocks, as JSON: ${String(interactionBounds.renderedBytes / kibibyte)} KiB`,
  ].join('\n');
}

function introductionOf(name: RenderTargetName, { label, renderedAs, example }: Target): string {
  return `# Cards for ${label}

A message to a person can be a card with text, fields, a table, a chart and link buttons. Write \`render: ${name}\` in the front matter of an interaction function. The body after the front matter is then a card in YAML, not a Liquid text, and the run turns it into ${renderedAs} and offers it to \`deliver.with\` as \`rendered\`. This guide holds everything about the card. The \`interaction-function\` guide holds the other keys of the function: \`to\`, \`expires\`, \`deliver\`, \`replies\`, \`input\` and \`output\`.

## An example

This function tells a team how the week's orders went. It takes no answer, so it is a notification.

<!-- prettier-ignore -->
\`\`\`markdown
${example.trimEnd()}
\`\`\`

## In the front matter

- \`render: ${name}\` is the only value that renders. It is refused with \`call\`, with no \`deliver\`, and with \`deliver: agent\`, since an agent reads text.
- \`deliver.with\` must read \`rendered\`, and a function with no \`render\` must not. In it, \`rendered\` is ${renderedAs} and \`message\` is the plain text of the same card. \`'{{ rendered }}'\` alone is sent as the list; among other text it is refused.
- \`deliver\` names the tool of a connection that sends a message with blocks, as the \`interaction-function\` guide sets out. Read what the tool takes with \`introspect\` first.
- A card asks a question like any request: add \`output\` and \`replies\` as the \`interaction-function\` guide sets out. The reader answers by replying, since a click is no answer, so end the card with a \`Text\` that says how to reply.
- List in \`input.schema.required\` every field the card reads, so a request that lacks one is refused when it starts.
`;
}

function cardRulesOf(): string {
  return `## The card

\`root\` is the id of the first element, which is a \`Card\`. \`elements\` maps an id to an element with \`type\`, \`props\` and \`children\`, a list of ids. Every id in \`children\` names an element under \`elements\`. Group with a \`Section\`, never with another \`Card\`. The body is YAML and no template: quote a text that holds a comma or a colon inside \`{ }\`, and write no alias or \`state\`.

A prop may read the run instead of holding a value:

- \`{ $state: /input/<field> }\` is the value at that path.
- \`{ $template: 'Due \${/input/date}' }\` fills each \`\${path}\` into the text.
- \`repeat: { statePath: /input/items }\` on an element, beside \`props\` and \`children\`, shows its \`children\` once for each item of the list. In those children, \`{ $item: <field> }\` is that item's field.
- A path starts with \`/input\`, the run's input, \`/today\`, the UTC day such as \`2026-11-01\`, or \`/now\`, the moment of the request in ISO 8601. They are fixed when the request is made, so every attempt sends the same card.
- \`$bindState\` and \`$bindItem\` take an answer from the reader, which a message cannot: they are refused.
`;
}

function refusedWhenOf(name: RenderTargetName): string {
  return `## What is refused when

- When the function is saved: a \`render\` that is not \`${name}\`; a body that is not YAML, or not a mapping of \`root\` and \`elements\`; an element that is not a mapping, has a \`type\` not listed above, or has \`children\` that are not ids under \`elements\`; a path that does not start with \`/input\`, \`/today\` or \`/now\`, or names a property \`input.schema\` does not allow; props that do not fit the type, in an element with no expression and no \`repeat\`.
- When it runs: a card that cannot be made ends the run \`invalid_input\` with an issue for each problem, such as a root that is not a \`Card\`, a value read from the input that does not fit its prop, a row with the wrong number of cells, a series with the wrong number of values, a \`Field\` outside \`Fields\`, an empty card, or a limit passed. Text or blocks over the limits end it \`conflict\`, kind \`unworkable\`.
`;
}

function guideOf(name: RenderTargetName, target: Target): string {
  return [
    introductionOf(name, target),
    cardRulesOf(),
    `## Components

Write \`type\` as one of these. Each prop is shown as it is written in YAML: \`[x]\` is a list of x, \`{ a, b? }\` a mapping whose \`b\` is optional, and \`a | b\` one of the words.

${componentsOf(target)}
`,
    `## Refused\n\n${refusalsOf(target)}\n`,
    `## Limits\n\n${limitsOf(target)}\n`,
    refusedWhenOf(name),
  ].join('\n');
}

export function renderGuideTextOf(name: RenderTargetName): string {
  return guideOf(name, renderTargetOf(name));
}

function descriptionOf(name: RenderTargetName): string {
  return `How to write a message to ${renderTargetOf(name).label} as a card: the components and their props, the limits, what is refused and a complete example.`;
}

export function renderGuidePageOf(name: RenderTargetName): string {
  return [
    '---',
    `description: '${descriptionOf(name)}'`,
    '---',
    '',
    '<div v-pre>',
    '',
    renderGuideTextOf(name).trimEnd(),
    '',
    '</div>',
    '',
  ].join('\n');
}

export function renderGuidePagePathOf(name: RenderTargetName): string {
  return pagePathOf(name);
}

export const renderCompanionGuides = renderTargetNames.map((name) => ({
  type: interactionType,
  name: guideNameOf(name),
  title: `Cards for ${renderTargetOf(name).label}`,
  description: descriptionOf(name),
  page: pagePathOf(name),
}));
