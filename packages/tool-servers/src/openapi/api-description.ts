import { problem, withoutTrailingSlashes, type SettingProblem } from '@on.auto/config';
import { Result } from 'effect';

import { at, isPinnableUrl } from '../settings/checked.ts';
import { toolServersSetting } from '../settings/server-entries.ts';
import type { OpenApiServerSettings } from '../settings/server-settings.ts';
import { decodedDocument, type ApiDocument, type DocumentProblem } from './api-document.ts';
import { derivedTools } from './api-tools.ts';
import { DocumentRefused, type DescribedApiSettings, type Describing } from './described-api.ts';
import { documentBounds, documentOf, type DocumentUnread } from './document-reading.ts';
import { securityProblemsOf } from './security-schemes.ts';

type Problems = readonly SettingProblem[];

type Refused<A> = Result.Result<A, Problems>;

function refusedFor(problems: Problems): DocumentRefused {
  return new DocumentRefused({ problems });
}

function documentProblems(name: string, problems: readonly DocumentProblem[]): readonly SettingProblem[] {
  return problems.map(({ pointer, detail }) =>
    problem(toolServersSetting, at(name, 'document'), `At ${pointer} of the document: ${detail}`),
  );
}

function serverUrlOf({ url, variables = {} }: NonNullable<ApiDocument['servers']>[number]): string {
  return url.replaceAll(/\{([^{}]*)\}/gu, (written, name: string) => {
    const variable = Object.hasOwn(variables, name) ? variables[name] : undefined;
    return variable === undefined ? written : variable.default;
  });
}

function baseUrlOf(settings: OpenApiServerSettings, document: ApiDocument): Refused<string> {
  const refused = (detail: string): Refused<string> =>
    Result.fail([problem(toolServersSetting, at(settings.name, 'base_url'), detail)]);
  if (settings.base_url !== null) {
    return Result.succeed(settings.base_url);
  }
  const [first] = document.servers ?? [];
  if (first === undefined) {
    return refused('Expected base_url, since the document names no server');
  }
  const relativeTo = settings.document.kind === 'url' ? settings.document.url : undefined;
  const written = serverUrlOf(first);
  if (/[?#]/u.test(written)) {
    return refused(
      'The first server the document names has a query or a fragment, which the path of a call would land in; give base_url',
    );
  }
  const resolved = URL.parse(written, relativeTo);
  if (resolved === null) {
    return refused('The first server the document names is not a URL this server can resolve; give base_url');
  }
  return isPinnableUrl(resolved.href)
    ? Result.succeed(withoutTrailingSlashes(resolved.href))
    : refused(
        'The first server the document names is not an https URL or an http URL on a loopback address; give base_url',
      );
}

export async function describedApi(
  settings: OpenApiServerSettings,
  describing: Describing,
): Promise<Result.Result<DescribedApiSettings, DocumentUnread | DocumentRefused>> {
  const read = await documentOf(settings.document, {
    entry: settings.name,
    fetch: describing.fetch ?? globalThis.fetch,
    readMs: describing.readMs ?? documentBounds.readMs,
  });
  if (Result.isFailure(read)) {
    return Result.fail(read.failure);
  }
  const presented = {
    security: settings.security,
    auth: settings.auth !== null,
    headers: new Set([...settings.headers.keys()].map((name) => name.toLowerCase())),
  };
  const derived = Result.flatMap(decodedDocument(read.success), (decoded) =>
    Result.map(derivedTools(decoded, presented), (tools) => ({ document: decoded.document, tools })),
  );
  if (Result.isFailure(derived)) {
    return Result.fail(refusedFor(documentProblems(settings.name, derived.failure)));
  }
  const { document, tools } = derived.success;
  const unsecured = securityProblemsOf(settings, document);
  if (unsecured.length > 0) {
    return Result.fail(
      refusedFor(unsecured.map(({ path, detail }) => problem(toolServersSetting, at(settings.name, ...path), detail))),
    );
  }
  const based = Result.mapError(baseUrlOf(settings, document), refusedFor);
  return Result.map(based, (baseUrl) => {
    for (const leftOut of tools.leftOut) {
      describing.reportLeftOut(settings.name, leftOut);
    }
    return { ...settings, api: { baseUrl, operations: tools.operations } };
  });
}
