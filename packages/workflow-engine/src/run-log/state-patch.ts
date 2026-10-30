import { Data, Schema } from 'effect';

export const PatchOperationSchema = Schema.Union([
  Schema.Struct({ op: Schema.Literal('add'), path: Schema.String, value: Schema.Json }),
  Schema.Struct({ op: Schema.Literal('replace'), path: Schema.String, value: Schema.Json }),
  Schema.Struct({ op: Schema.Literal('remove'), path: Schema.String }),
]);

export type PatchOperation = typeof PatchOperationSchema.Type;

export type StatePatch = readonly PatchOperation[];

export class PatchFailed extends Data.TaggedError('patch_failed')<{
  readonly op: PatchOperation['op'];
  readonly path: string;
  readonly detail: string;
}> {}

type Container = Readonly<Record<string, unknown>> | readonly unknown[];

type Edit = (container: Container, token: string) => unknown;

const arrayIndex = /^(?:0|[1-9]\d*)$/u;

function isList(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function tokensOf(operation: PatchOperation): readonly string[] {
  if (operation.path === '' || !operation.path.startsWith('/')) {
    throw new PatchFailed({ ...operation, detail: 'A path names a member under the root, such as /machine/context' });
  }
  return operation.path
    .slice(1)
    .split('/')
    .map((token) => token.replaceAll('~1', '/').replaceAll('~0', '~'));
}

function indexIn(list: readonly unknown[], token: string, operation: PatchOperation, room: number): number {
  const index = token === '-' && operation.op === 'add' ? list.length : Number(token);
  if (!(arrayIndex.test(token) || token === '-') || index > list.length - 1 + room) {
    throw new PatchFailed({ ...operation, detail: `The list has no position ${token}` });
  }
  return index;
}

function hasMember(container: Container, token: string): boolean {
  return isList(container)
    ? arrayIndex.test(token) && Number(token) < container.length
    : Object.hasOwn(container, token);
}

function childOf(container: Container, token: string): unknown {
  return isList(container) ? container[Number(token)] : container[token];
}

function withChild(container: Container, token: string, child: unknown): Container {
  if (isList(container)) {
    return container.map((item, index) => (index === Number(token) ? child : item));
  }
  return { ...container, [token]: child };
}

function edited(document: unknown, tokens: readonly string[], operation: PatchOperation, edit: Edit): unknown {
  const [token = '', ...rest] = tokens;
  if (!isRecord(document) && !isList(document)) {
    throw new PatchFailed({
      ...operation,
      detail: 'The path goes through a value that is neither an object nor a list',
    });
  }
  if (rest.length === 0) {
    return edit(document, token);
  }
  if (!hasMember(document, token)) {
    throw new PatchFailed({ ...operation, detail: `The state has no member ${token} on the way` });
  }
  return withChild(document, token, edited(childOf(document, token), rest, operation, edit));
}

function editOf(operation: PatchOperation): Edit {
  return (container, token) => {
    if (operation.op === 'add') {
      if (isList(container)) {
        return container.toSpliced(indexIn(container, token, operation, 1), 0, operation.value);
      }
      if (Object.hasOwn(container, token)) {
        throw new PatchFailed({ ...operation, detail: `The member ${token} is there already` });
      }
      return { ...container, [token]: operation.value };
    }
    if (!hasMember(container, token)) {
      throw new PatchFailed({ ...operation, detail: `The state has no member ${token}` });
    }
    if (operation.op === 'replace') {
      return withChild(container, token, operation.value);
    }
    return isList(container)
      ? container.toSpliced(Number(token), 1)
      : Object.fromEntries(Object.entries(container).filter(([key]: readonly [string, unknown]) => key !== token));
  };
}

export function applyStatePatch(document: unknown, patch: StatePatch): unknown {
  return patch.reduce(
    (patched: unknown, operation: PatchOperation) => edited(patched, tokensOf(operation), operation, editOf(operation)),
    document,
  );
}
