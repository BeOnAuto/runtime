import { isAbsolute, normalize, resolve, sep } from 'node:path';

import { withoutTrailingSlashes } from '@on.auto/config';

import { failureCodeIssuesOf, type FailureCodes } from '../openapi/failure-codes.ts';
import {
  accepted,
  isPinnableUrl,
  pinnedUrlShape,
  problemsOf,
  refused,
  rejected,
  redactedValuesOf,
  type Checked,
} from './checked.ts';
import { checkedAuth, checkedHeaders } from './remote-checks.ts';
import type { ServerEntryFields } from './server-entries.ts';
import type { ApiDocumentSource, DocumentsPlace, OpenApiServerSettings, ShippedDocument } from './server-settings.ts';

export type ApiTransport = Pick<
  OpenApiServerSettings,
  'type' | 'document' | 'base_url' | 'headers' | 'query_params' | 'security' | 'auth' | 'failure_codes'
>;

const documentShape = `${pinnedUrlShape}, or a path relative to the directory of the configuration file that stays inside it`;

function isWithin(path: string): boolean {
  const normal = normalize(path);
  return !isAbsolute(path) && normal !== '..' && !normal.startsWith(`..${sep}`);
}

function fileDocument(name: string, document: string, directory: string): Checked<ApiDocumentSource> {
  return isWithin(document) && document.trim() !== ''
    ? accepted({ kind: 'file', path: resolve(directory, document) })
    : refused(name, ['document'], documentShape);
}

function shippedDocument(
  name: string,
  document: string,
  byName: ReadonlyMap<string, ShippedDocument>,
): Checked<ApiDocumentSource> {
  const shipped = byName.get(document);
  return shipped === undefined
    ? refused(name, ['document'], `${pinnedUrlShape}, or a document the providers ship`)
    : accepted({ kind: 'shipped', document: shipped });
}

function checkedDocument(name: string, document: string, documents: DocumentsPlace): Checked<ApiDocumentSource> {
  if (URL.canParse(document)) {
    return isPinnableUrl(document)
      ? accepted({ kind: 'url', url: document })
      : refused(name, ['document'], documentShape);
  }
  return documents.kind === 'shipped'
    ? shippedDocument(name, document, documents.byName)
    : fileDocument(name, document, documents.path);
}

function checkedBaseUrl(name: string, baseUrl: string | undefined): Checked<string | null> {
  if (baseUrl === undefined) {
    return accepted(null);
  }
  if (!isPinnableUrl(baseUrl)) {
    return refused(name, ['base_url'], pinnedUrlShape);
  }
  return /[?#]/u.test(baseUrl)
    ? refused(
        name,
        ['base_url'],
        'Expected a URL without a query or a fragment, which the path of a call would land in',
      )
    : accepted(withoutTrailingSlashes(baseUrl));
}

function checkedQuery(
  name: string,
  query: Readonly<Record<string, string>>,
): Checked<OpenApiServerSettings['query_params']> {
  const problems = problemsOf(
    ...Object.keys(query).map((parameter) =>
      parameter === '' ? refused(name, ['query_params', parameter], 'Expected a parameter name') : accepted(parameter),
    ),
  );
  return problems.length === 0 ? accepted(redactedValuesOf(query)) : rejected(problems);
}

function checkedSecurity(
  name: string,
  security: Readonly<Record<string, string>>,
): Checked<OpenApiServerSettings['security']> {
  const problems = problemsOf(
    ...Object.keys(security).map((scheme) =>
      scheme === '' ? refused(name, ['security', scheme], 'Expected the name of a security scheme') : accepted(scheme),
    ),
  );
  return problems.length === 0 ? accepted(redactedValuesOf(security)) : rejected(problems);
}

function checkedFailureCodes(name: string, failureCodes: FailureCodes | undefined): Checked<FailureCodes | null> {
  const problems = problemsOf(
    ...failureCodeIssuesOf(failureCodes).map(({ path, detail }) =>
      refused(name, ['failure_codes', ...path.map(String)], detail),
    ),
  );
  return problems.length === 0 ? accepted(failureCodes ?? null) : rejected(problems);
}

type Sent = Pick<OpenApiServerSettings, 'headers' | 'query_params' | 'security'>;

function checkedSent(name: string, fields: ServerEntryFields): Checked<Sent> {
  const headers = checkedHeaders(name, fields.headers ?? {}, 'openapi');
  const query = checkedQuery(name, fields.query_params ?? {});
  const security = checkedSecurity(name, fields.security ?? {});
  return headers.ok && query.ok && security.ok
    ? accepted({ headers: headers.value, query_params: query.value, security: security.value })
    : rejected(problemsOf(headers, query, security));
}

export function apiTransport(
  name: string,
  fields: ServerEntryFields,
  document: string,
  documents: DocumentsPlace,
): Checked<ApiTransport> {
  const source = checkedDocument(name, document, documents);
  const baseUrl = checkedBaseUrl(name, fields.base_url);
  const sent = checkedSent(name, fields);
  const auth = checkedAuth(name, fields);
  const failureCodes = checkedFailureCodes(name, fields.failure_codes);
  return source.ok && baseUrl.ok && sent.ok && auth.ok && failureCodes.ok
    ? accepted({
        type: 'openapi',
        document: source.value,
        base_url: baseUrl.value,
        ...sent.value,
        auth: auth.value,
        failure_codes: failureCodes.value,
      })
    : rejected(problemsOf(source, baseUrl, sent, auth, failureCodes));
}
