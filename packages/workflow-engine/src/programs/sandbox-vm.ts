import type { QuickJSHandle, QuickJSRuntime } from 'quickjs-emscripten-core';

export type Outcome = { readonly value: number } | { readonly error: number } | { readonly thrown: unknown };

export interface Vm {
  readonly loaded: (code: string, file: string) => number;
  readonly evaluate: (code: string, file: string, module: boolean) => Outcome;
  readonly call: (fn: number, args: readonly number[]) => Outcome;
  readonly property: (holder: number, name: string) => number;
  readonly typeOf: (id: number) => string;
  readonly text: (value: string) => number;
  readonly number: (value: number) => number;
  readonly takeText: (id: number) => string;
  readonly forget: (id: number) => void;
  readonly close: () => void;
}

export function vmOf(runtime: () => QuickJSRuntime): Vm {
  const context = runtime().newContext();
  const handles = new Map<number, QuickJSHandle>();
  const ids = { next: 0 };
  const keep = (made: () => QuickJSHandle): number => {
    ids.next += 1;
    handles.set(ids.next, made());
    return ids.next;
  };
  const handleOf = (id: number): QuickJSHandle => handles.get(id) ?? context.undefined;
  const forget = (id: number): void => {
    handles.get(id)?.dispose();
    handles.delete(id);
  };
  const attempt = (perform: () => ReturnType<typeof context.evalCode>): Outcome => {
    try {
      const result = perform();
      return result.error === undefined ? { value: keep(() => result.value) } : { error: keep(() => result.error) };
    } catch (thrown) {
      return { thrown };
    }
  };
  const taken = <Read>(id: number, read: (id: number) => Read): Read => {
    const value = read(id);
    forget(id);
    return value;
  };
  return {
    loaded: (code, file) => keep(() => context.unwrapResult(context.evalCode(code, file))),
    evaluate: (code, file, module) =>
      attempt(() => context.evalCode(code, file, { type: module ? 'module' : 'global' })),
    call: (fn, args) =>
      attempt(() => context.callFunction(handleOf(fn), context.undefined, ...args.map((id) => handleOf(id)))),
    property: (holder, name) => keep(() => context.getProp(handleOf(holder), name)),
    typeOf: (id) => context.typeof(handleOf(id)),
    text: (value) => keep(() => context.newString(value)),
    number: (value) => keep(() => context.newNumber(value)),
    takeText: (id) => taken(id, (each) => context.getString(handleOf(each))),
    forget,
    close: () => {
      for (const id of handles.keys()) {
        forget(id);
      }
      context.dispose();
    },
  };
}
