import { isAbsolute, normalize, resolve, sep } from 'node:path';

import { withoutTrailingSlashes } from '@on.auto/config';

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
import type { ApiDocumentSource, OpenApiServerSettings } from './server-settings.ts';

export type ApiTransport = Pick<
  OpenApiServerSettings,
  'type' | 'document' | 'base_url' | 'headers' | 'query_params' | 'security' | 'auth'
>;

const documentShape = `${pinnedUrlShape}, or a path relative to the directory of the configuration file that stays inside it`;

function isWithin(path: string): boolean {
  const normal = normalize(path);
  return !isAbsolute(path) && normal !== '..' && !normal.startsWith(`..${sep}`);
}

function checkedDocument(name: string, document: string, directory: string): Checked<ApiDocumentSource> {
  if (URL.canParse(document)) {
    return isPinnableUrl(document)
      ? accepted({ kind: 'url', url: document })
      : refused(name, ['document'], documentShape);
  }
  return isWithin(document) && document.trim() !== ''
    ? accepted({ kind: 'file', path: resolve(directory, document) })
    : refused(name, ['document'], documentShape);
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

export function apiTransport(
  name: string,
  fields: ServerEntryFields,
  document: string,
  directory: string,
): Checked<ApiTransport> {
  const source = checkedDocument(name, document, directory);
  const baseUrl = checkedBaseUrl(name, fields.base_url);
  const headers = checkedHeaders(name, fields.headers ?? {}, 'openapi');
  const query = checkedQuery(name, fields.query_params ?? {});
  const security = checkedSecurity(name, fields.security ?? {});
  const auth = checkedAuth(name, fields);
  return source.ok && baseUrl.ok && headers.ok && query.ok && security.ok && auth.ok
    ? accepted({
        type: 'openapi',
        document: source.value,
        base_url: baseUrl.value,
        headers: headers.value,
        query_params: query.value,
        security: security.value,
        auth: auth.value,
      })
    : rejected(problemsOf(source, baseUrl, headers, query, security, auth));
}
