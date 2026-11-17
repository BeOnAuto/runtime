import { isAuthorized } from '@cedar-policy/cedar-wasm/web';
import type { ShippedFiles } from '@on.auto/shipped-files';
import { shippedFilesInMemory } from '@on.auto/shipped-files/testing';
import { Schema } from 'effect';
import { beforeAll, describe, expect, it } from 'vitest';

import { cedarOnDisk, filesOnDisk } from '../testing/access-testing.ts';
import { decidedFailingClosed, decisionOf, messageOf } from './cedar-decisions.ts';
import { cedarModuleBundled, notCompiledByTheBundler } from './cedar-module-bundled.ts';
import { cedarModuleIn } from './cedar-module.ts';
import { cedarOf } from './cedar.ts';

function countedImport(imported: () => Promise<unknown>): {
  readonly imported: () => Promise<unknown>;
  readonly imports: () => number;
} {
  const count = { imports: 0 };
  return {
    imported: () => {
      count.imports += 1;
      return imported();
    },
    imports: () => count.imports,
  };
}

describe('the engine, loaded from a bundle', () => {
  it('is the module the bundler compiled, imported once, on first use, however often it is asked for', async () => {
    const compiled = await cedarOnDisk();
    const counted = countedImport(() => Promise.resolve({ default: compiled }));
    const loading = cedarModuleBundled(counted.imported);

    expect(counted.imports()).toBe(0);
    const [first, second] = await Promise.all([loading(), loading()]);

    expect(first).toBe(compiled);
    expect(second).toBe(compiled);
    expect(counted.imports()).toBe(1);
  });

  it('is refused where the bundle hands its bytes, or anything but a compiled module, and goes on refusing', async () => {
    const bytes = countedImport(() => Promise.resolve({ default: new Uint8Array([0, 97, 115, 109]) }));
    const handedBytes = cedarModuleBundled(bytes.imported);
    const nothing = cedarModuleBundled(() => Promise.resolve({}));

    await expect(handedBytes()).rejects.toThrow(notCompiledByTheBundler);
    await expect(handedBytes()).rejects.toThrow(notCompiledByTheBundler);
    await expect(nothing()).rejects.toThrow(notCompiledByTheBundler);
    expect(bytes.imports()).toBe(1);
  });

  it('fails to load where its module cannot be imported', async () => {
    const loading = cedarModuleBundled(() => Promise.reject(new Error('no module of the bundle is Cedar')));

    await expect(loading()).rejects.toThrow('no module of the bundle is Cedar');
  });
});

interface HostImport {
  readonly module: string;
  readonly name: string;
  readonly kind: string;
}

interface ModuleConstructor {
  readonly imports: (module: WebAssembly.Module) => readonly HostImport[];
}

const moduleConstructor = Schema.decodeUnknownSync(
  Schema.declare(
    (value: unknown): value is ModuleConstructor =>
      typeof value === 'function' && typeof Reflect.get(value, 'imports') === 'function',
  ),
)(Reflect.get(Reflect.get(globalThis, 'WebAssembly'), 'Module'));

function countingReads(files: ShippedFiles): { readonly files: ShippedFiles; readonly reads: () => number } {
  const read = { count: 0 };
  return {
    files: {
      ...files,
      bytes: (file) => {
        read.count += 1;
        return files.bytes(file);
      },
    },
    reads: () => read.count,
  };
}

describe('the engine, loaded in Node', () => {
  it('is compiled from the bytes of its file once for each reader of files, on first use', async () => {
    const counting = countingReads(filesOnDisk);
    const loading = cedarModuleIn(counting.files);

    expect(counting.reads()).toBe(0);
    const [first, second] = await Promise.all([loading(), cedarModuleIn(counting.files)()]);

    expect(first).toBe(second);
    expect(counting.reads()).toBe(1);
  });

  it('fails to load where its file cannot be read, and goes on failing', async () => {
    const loading = cedarModuleIn(shippedFilesInMemory({}));

    await expect(loading()).rejects.toThrow('No file is shipped at @on.auto/access-control/node_modules/');
    await expect(loading()).rejects.toThrow('No file is shipped at');
  });

  it('asks its host for nothing but turning values into JSON and back and reporting its own errors: no clock, no randomness, no file and no network', async () => {
    const imported = moduleConstructor.imports(await cedarModuleIn(filesOnDisk)());

    expect(imported.map(({ module, name, kind }) => `${module} ${kind} ${name}`)).toEqual([
      './cedar_wasm_bg.js function __wbg_parse_545d11396395fbbd',
      './cedar_wasm_bg.js function __wbg_stringify_a2c39d991e1bf91d',
      './cedar_wasm_bg.js function __wbg___wbindgen_throw_81fc77679af83bc6',
      './cedar_wasm_bg.js function __wbg_Error_2e59b1b37a9a34c3',
      './cedar_wasm_bg.js function __wbg___wbindgen_string_get_914df97fcfa788f2',
      './cedar_wasm_bg.js function __wbg___wbindgen_is_undefined_c0cca72b82b86f4d',
      './cedar_wasm_bg.js function __wbindgen_init_externref_table',
    ]);
  });
});

const reading = {
  principal: { type: 'Person', id: 'user_ada' },
  action: { type: 'Action', id: 'read' },
  resource: { type: 'Definition', id: 'd-01' },
  context: {},
  entities: [{ uid: { type: 'Definition', id: 'd-01' }, attrs: {}, parents: [] }],
};

const readsAllowedButReasoningHidden = {
  staticPolicies: {
    'reads-allowed': 'permit (principal, action, resource);',
    'hide-reasoning': 'forbid (principal, action, resource) when { resource.definition_type == "reasoning" };',
  },
};

beforeAll(async () => {
  cedarOf(await cedarOnDisk());
});

describe('the answer of the engine', () => {
  it('is a deny where Cedar skips a forbid that errors and allows: the forbid cannot be read, so nothing is allowed', () => {
    const answer = isAuthorized({ ...reading, policies: readsAllowedButReasoningHidden });

    expect(answer).toMatchObject({
      type: 'success',
      response: { decision: 'allow', diagnostics: { reason: ['reads-allowed'] } },
    });
    expect(decisionOf(answer)).toEqual({
      decision: 'deny',
      determiningPolicies: [],
      errors: [expect.stringMatching(/^hide-reasoning: /u)],
    });
  });

  it('keeps the policies that decided a deny, beside any error', () => {
    const answer = isAuthorized({
      ...reading,
      policies: {
        staticPolicies: {
          ...readsAllowedButReasoningHidden.staticPolicies,
          'nothing-read': 'forbid (principal, action, resource);',
        },
      },
    });

    expect(decisionOf(answer)).toEqual({
      decision: 'deny',
      determiningPolicies: ['nothing-read'],
      errors: [expect.stringMatching(/^hide-reasoning: /u)],
    });
  });

  it('is an allow, with the policies that decided it, where no policy errs', () => {
    expect(
      decisionOf(
        isAuthorized({
          ...reading,
          policies: { staticPolicies: { 'reads-allowed': 'permit (principal, action, resource);' } },
        }),
      ),
    ).toEqual({ decision: 'allow', determiningPolicies: ['reads-allowed'], errors: [] });
  });
});

describe('the answer of the engine to what it cannot read', () => {
  it('is a deny with the errors of a request Cedar cannot read', () => {
    const answer = isAuthorized({
      ...reading,
      schema: 'entity Person; entity Definition; action "read" appliesTo { principal: Person, resource: Definition };',
      validateRequest: true,
      context: { unexpected: true },
      policies: readsAllowedButReasoningHidden,
    });

    expect(answer.type).toBe('failure');
    expect(decisionOf(answer)).toMatchObject({ decision: 'deny', determiningPolicies: [] });
    expect(decisionOf(answer).errors.length).toBeGreaterThan(0);
  });

  it('is a deny with what was thrown, where asking the engine throws', () => {
    expect(
      decidedFailingClosed(() => {
        throw new Error('the engine is not loaded');
      }),
    ).toEqual({ decision: 'deny', determiningPolicies: [], errors: ['the engine is not loaded'] });
    expect(messageOf('a thrown text')).toBe('a thrown text');
  });

  it('is a deny naming what failed, where the answer cannot be read', () => {
    expect(
      decidedFailingClosed(() => ({
        type: 'failure',
        get errors(): readonly { readonly message: string }[] {
          throw new Error('the answer cannot be read');
        },
      })),
    ).toEqual({
      decision: 'deny',
      determiningPolicies: [],
      errors: ['the answer cannot be read'],
    });
  });
});
