import { sha256Of } from '@on.auto/content';
import { canonicalJson } from '@on.auto/tool-servers';
import { Schema } from 'effect';

const PointerField = Schema.String;

export const TriggerReadSchema = Schema.Struct({
  tool: Schema.String.annotate({ description: "The connection's tool that Auto calls to list the items" }),
  with: Schema.optionalKey(
    Schema.Record(Schema.String, Schema.Json).annotate({
      description:
        "The tool's arguments. `{{ since }}` is where the last check got to, and `{{ page_token }}` is the token of the next page",
    }),
  ),
  list: PointerField.annotate({ description: "Where the list of items is in the tool's answer, as a JSON Pointer" }),
  order: Schema.Literals(['oldest_first', 'newest_first']).annotate({
    description: 'The order the tool lists items in: `oldest_first` or `newest_first`',
  }),
  cursor: Schema.optionalKey(
    PointerField.annotate({
      description: 'Where in an item the value is that the next check passes as `since`, as a JSON Pointer',
    }),
  ),
  next_page_token: Schema.optionalKey(
    PointerField.annotate({
      description: "Where the token of the next page is in the tool's answer, as a JSON Pointer",
    }),
  ),
  start: Schema.optionalKey(
    Schema.String.annotate({ description: 'The value of `since` for the first check, such as `{{ now }}`' }),
  ),
  id: Schema.Array(PointerField)
    .check(Schema.isMinLength(1))
    .annotate({ description: 'JSON Pointers into an item whose values together tell one item from another' }),
  time: Schema.optionalKey(
    PointerField.annotate({ description: 'Where an item says when it happened, as a JSON Pointer' }),
  ),
}).annotate({
  description:
    'For a connection that lists no events: the tool Auto checks on a timer, and how it reads what the tool lists. Each item it has not seen is an event, whose data is the item as listed',
});

export type TriggerRead = typeof TriggerReadSchema.Type;

export function readTopicOf(type: string, read: TriggerRead): string {
  return sha256Of(canonicalJson({ type, read }));
}

export interface DeclaredRead {
  readonly connection: string;
  readonly type: string;
  readonly read?: TriggerRead;
}

function isTheSameRead(one: TriggerRead | undefined, other: TriggerRead | undefined): boolean {
  return one === undefined || other === undefined ? one === other : canonicalJson(one) === canonicalJson(other);
}

function readsAnother(one: DeclaredRead, other: DeclaredRead): boolean {
  return one.connection === other.connection && one.type === other.type && !isTheSameRead(one.read, other.read);
}

export function readingAnotherUnderTheirType<Declared extends DeclaredRead>(
  asked: readonly Declared[],
  held: readonly DeclaredRead[],
): readonly Declared[] {
  return asked.filter((each, index) => [...held, ...asked.slice(0, index)].some((other) => readsAnother(each, other)));
}

export function anotherReadWords({ type, connection }: DeclaredRead, playbook?: string): string {
  const where = playbook === undefined ? 'this playbook' : `the playbook ${playbook}`;
  return `Another workflow of ${where} already uses the type ${type} for a different \`read\` through ${connection}. Give this trigger a \`type\` of its own, or the same \`read\``;
}
