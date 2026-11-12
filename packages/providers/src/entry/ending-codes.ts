interface Ending {
  readonly ending_codes?: readonly string[] | undefined;
}

interface WayIssue {
  readonly path: readonly string[];
  readonly issue: string;
}

const endingOfEveryGrant = 'invalid_grant';

const neverEnding: ReadonlySet<string> = new Set([
  'invalid_request',
  'invalid_client',
  'unauthorized_client',
  'unsupported_grant_type',
  'invalid_scope',
  'server_error',
  'temporarily_unavailable',
]);

const endingCode = /^[\w.-]{1,64}$/u;

function endingCodeIssueOf(codes: readonly string[], code: string, index: number): string | undefined {
  if (code === endingOfEveryGrant) {
    return `Expected no ${endingOfEveryGrant}, which ends a consent at every token endpoint already`;
  }
  if (neverEnding.has(code)) {
    return `Expected no ${code}, an error of OAuth that never says a consent has ended`;
  }
  if (!endingCode.test(code)) {
    return 'Expected an error code of at most 64 letters, digits, underscores, dots and hyphens';
  }
  return codes.indexOf(code) < index ? `Expected ${code} once in ending_codes` : undefined;
}

export function endingIssuesOf({ ending_codes: codes = [] }: Ending): readonly WayIssue[] {
  return codes.flatMap((code, index) => {
    const issue = endingCodeIssueOf(codes, code, index);
    return issue === undefined ? [] : [{ path: ['ending_codes', String(index)], issue }];
  });
}
