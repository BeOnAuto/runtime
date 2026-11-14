import { defineHttpOperation } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import type { Capability } from '../capability/capability.ts';
import { playbookGoalsIn } from '../goals/goals-stream.ts';
import type { SubjectPages } from '../page/subject-pages-port.ts';
import { portableExportOf } from '../portable/portable-export.ts';
import { PORTABLE_FORMAT } from '../portable/portable-package.ts';
import type { Finding, Occurrence } from '../portable/value-scan.ts';
import { PlaybookExportSchema, type PlaybookExport } from './export-answer.ts';
import { exportedDefinitionsOf } from './exported-definitions.ts';

const description = [
  "Reads the playbook's method as a package a copy is made from: its page and its goals as saved,",
  'every active and paused definition in an order a copy can create them in, whether each is paused,',
  'the connections, types and models they need, and the values a fixed scan finds that may be private to the org,',
  'with the digest of the package.',
  'No run, record, credential or key is in it, and the title and description of the playbook stay with the org.',
].join(' ');

const NoInput = Schema.Never.annotate({ message: 'export_playbook takes no query parameters; send none' });

type PackagePart = 'goals' | 'page' | 'definition';

function inThePackage(occurrence: Occurrence): occurrence is Occurrence & { readonly part: PackagePart } {
  return occurrence.part !== 'entry';
}

function answeredFinding({ id, class: valueClass, value, occurrences }: Finding): PlaybookExport['findings'][number] {
  return { id, class: valueClass, value, occurrences: occurrences.filter((occurrence) => inThePackage(occurrence)) };
}

function exportRead(capabilities: readonly Capability[], pages: SubjectPages) {
  return Effect.fnUntraced(function* () {
    const page = yield* pages.playbookPageOf();
    const { source: goals } = yield* playbookGoalsIn;
    const { digest, definitions, needs, findings } = portableExportOf({
      format: PORTABLE_FORMAT,
      ...(page === undefined ? {} : { page: page.source }),
      ...(goals === undefined ? {} : { goals }),
      definitions: yield* exportedDefinitionsOf(capabilities),
    });
    const answer: PlaybookExport = {
      format: PORTABLE_FORMAT,
      digest,
      ...(page === undefined ? {} : { page: page.source }),
      ...(goals === undefined ? {} : { goals }),
      definitions,
      needs,
      findings: findings.map((finding) => answeredFinding(finding)),
    };
    return answer;
  });
}

export function defineExportPlaybook(capabilities: readonly Capability[], pages: SubjectPages) {
  return defineHttpOperation('playbook', 'query', {
    name: 'export_playbook',
    title: 'Export playbook',
    description,
    route: { method: 'GET', path: '/export' },
    body: { kind: 'none' },
    inputSchema: Schema.Record(Schema.String, NoInput),
    outputSchema: PlaybookExportSchema,
    reasons: ['conflict', 'unavailable'],
    handle: exportRead(capabilities, pages),
  });
}
