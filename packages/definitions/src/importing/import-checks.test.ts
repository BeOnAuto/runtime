import { defineCommand, InvalidInput, Unavailable, type Issue } from '@on.auto/operations';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import type { PageCheck } from '../page/subject-pages-port.ts';
import type { PortableDefinition, PortablePackage } from '../portable/portable-package.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { probe } from '../testing/capabilities/probe.ts';
import { harness, toPlaybook } from '../testing/harness.ts';
import { uncheckedPages } from '../testing/page-ports.ts';
import { importChecked, type ImportChecking } from './import-checks.ts';

const someWords: unknown = expect.any(String);

const toAlpha = toPlaybook('acme', 'alpha');

const DefinitionField = Schema.Struct({
  type: Schema.String,
  name: Schema.String,
  source: Schema.String,
  overview: Schema.optionalKey(Schema.String),
  diagram: Schema.optionalKey(Schema.String),
  paused: Schema.Boolean,
});

const PackageField = Schema.Struct({
  format: Schema.Number,
  page: Schema.optionalKey(Schema.String),
  goals: Schema.optionalKey(Schema.String),
  definitions: Schema.Array(DefinitionField),
});

const IssueSchema = Schema.Struct({ pointer: Schema.String, detail: Schema.String });

function serversOf(present: readonly string[]): ImportChecking['servers'] {
  return { present: (_org, named) => Effect.succeed(new Set(named.filter((server) => present.includes(server)))) };
}

const checking: ImportChecking = {
  capabilities: [probe().capability],
  pages: uncheckedPages,
  servers: serversOf(['chat']),
  offers: (model) => model.startsWith('anthropic/'),
};

function checkOf(over: Partial<ImportChecking>) {
  const checkedBy = importChecked({ ...checking, ...over });
  return defineCommand('playbook', {
    name: 'check_import',
    title: 'Check import',
    description: 'Checks a package as an import does.',
    route: { method: 'POST', path: '/check-import' },
    inputSchema: Schema.Struct({ package: PackageField }),
    outputSchema: Schema.Struct({
      issues: Schema.Array(IssueSchema),
      digest: Schema.String,
      models_not_offered: Schema.Array(Schema.String),
    }),
    reasons: [],
    handle: (input) =>
      Effect.map(checkedBy(input.package), ({ issues, plan }) => ({
        issues,
        digest: plan.digest,
        models_not_offered: plan.modelsNotOffered,
      })),
  });
}

function probeOf(name: string, source = 'text'): PortableDefinition {
  return { type: 'probe', name, source, paused: false };
}

const ordersPage = [
  'data:',
  '  language: typescript',
  '  source:',
  '    events:',
  '      - type: run_succeeded',
  '  views:',
  '    runs: categories',
  '  module: |',
  '    export function fold(view: View, event: Event): View {',
  '      return { runs: { values: [{ name: event.type, value: 1 }] } };',
  '    }',
  "runs: '{{ views.runs.values | size }} runs.'",
].join('\n');

const unreachablePage: PageCheck = (text, writtenIn) =>
  writtenIn === 'playbook'
    ? Effect.fail(new Unavailable({ detail: 'The page cannot be checked now' }))
    : uncheckedPages.check(text, writtenIn);

const refusedPage: PageCheck = (text, writtenIn) =>
  writtenIn === 'playbook'
    ? Effect.fail(
        new InvalidInput({ detail: 'The page is wrong', issues: [{ pointer: '/page/data', detail: 'No data' }] }),
      )
    : uncheckedPages.check(text, writtenIn);

function checked(written: PortablePackage, over: Partial<ImportChecking> = {}) {
  return harness().call(checkOf(over), toAlpha(acmeAdmin, { package: written }));
}

async function issuesOf(written: PortablePackage, over: Partial<ImportChecking> = {}): Promise<readonly Issue[]> {
  const outcome = await checked(written, over);
  return Schema.decodeUnknownSync(Schema.Struct({ output: Schema.Struct({ issues: Schema.Array(IssueSchema) }) }))(
    outcome,
  ).output.issues;
}

const refusedTwice: unknown = expect.stringContaining('holds the probe refused twice');

const nameRefused: unknown = expect.stringContaining('name');

describe('the checks of an import that passes', () => {
  it('answer no issue, the digest and the models this runtime does not offer', async () => {
    const written: PortablePackage = {
      format: 1,
      page: ordersPage,
      definitions: [
        probeOf('asks-in-chat', '---\ntools: [chat/send]\nmodel: anthropic/claude-sonnet-4-5\n---\nAsk.'),
        { ...probeOf('writes', '---\nmodel: other/model-one\n---\nWrite.'), overview: 'Writes.' },
      ],
    };

    expect(await checked(written)).toMatchObject({
      status: 'succeeded',
      output: { issues: [], models_not_offered: ['other/model-one'] },
    });
  });
});

describe('the checks of an import that fails', () => {
  it('name each connection the org lacks, each refused definition, a type not served and a name given twice', async () => {
    const written: PortablePackage = {
      format: 2,
      definitions: [
        probeOf('posts-in-mail', '---\ntools: [mail/send, chat/send]\n---\nPost.'),
        probeOf('refused', 'oops'),
        { type: 'forecast', name: 'guesses', source: 'text', paused: false },
        probeOf('refused'),
        probeOf('X'),
      ],
    };

    expect(await issuesOf(written)).toEqual([
      { pointer: '/package/format', detail: 'This runtime imports packages of format 1' },
      { pointer: '/package/definitions/3/name', detail: refusedTwice },
      { pointer: '/package/definitions/1/source', detail: 'Line 1 is not accepted' },
      { pointer: '/package/definitions/2/type', detail: 'This runtime serves no forecast definitions' },
      { pointer: '/package/definitions/4', detail: nameRefused },
      {
        pointer: '/package/definitions',
        detail: someWords,
      },
    ]);
  });
});

describe('the checks of the page and of the size of an import', () => {
  it('say what the page lacks', async () => {
    const written: PortablePackage = { format: 1, page: 'title: x', goals: 'goals', definitions: [probeOf('one')] };

    expect(await issuesOf(written, { pages: { check: unreachablePage } })).toEqual([
      { pointer: '/package/page', detail: 'The page cannot be checked now' },
    ]);
    expect(await issuesOf(written, { pages: { check: refusedPage } })).toEqual([
      { pointer: '/package/page/data', detail: 'No data' },
    ]);
  });

  it('refuse more definitions of a type than a playbook here may keep, which the copy would meet halfway', async () => {
    const written: PortablePackage = { format: 1, definitions: [probeOf('one'), probeOf('two'), probeOf('three')] };
    const capabilities = [{ ...probe().capability, mostActive: 2 }];

    expect(await issuesOf(written, { capabilities })).toEqual([
      {
        pointer: '/package/definitions',
        detail: someWords,
      },
    ]);
    expect(await issuesOf({ ...written, definitions: written.definitions.slice(1) }, { capabilities })).toEqual([]);
  });

  it('refuse a package beyond the caps before any definition is checked', async () => {
    const asked: string[] = [];
    const written: PortablePackage = {
      format: 1,
      definitions: Array.from({ length: 101 }, (_, index) => probeOf(`probe-${String(index)}`)),
    };
    const servers: ImportChecking['servers'] = {
      present: (_org, named) => {
        asked.push(...named);
        return Effect.succeed(new Set());
      },
    };

    expect(await issuesOf(written, { servers })).toEqual([{ pointer: '/package/definitions', detail: someWords }]);
    expect(asked).toEqual([]);
  });
});
