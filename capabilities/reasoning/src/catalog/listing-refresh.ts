import { Effect } from 'effect';

import type { ListedModel } from '../listing/listed-model.ts';
import type { ListedSource, ListingProblem } from '../listing/listing-request.ts';
import type { ReportOperatorHint, ReportProviderMessage } from '../providers/model-access-options.ts';

export interface ListingReports {
  readonly scrub: (text: string) => string;
  readonly report: ReportProviderMessage;
  readonly reportHint: ReportOperatorHint;
}

const mostReportedCharacters = 2000;

function reported(
  { scrub, report, reportHint }: ListingReports,
  provider: string,
  problem: ListingProblem,
): Effect.Effect<void> {
  return problem.kind === 'answered'
    ? report({
        provider,
        model: null,
        status: problem.status,
        message: scrub(problem.message).slice(0, mostReportedCharacters),
        run_id: null,
      })
    : reportHint({
        provider,
        model: null,
        hint: `The list of models of ${provider} could not be read: ${problem.reason}`,
        run_id: null,
      });
}

export function refreshOf(
  reports: ListingReports,
  { provider, read }: ListedSource,
): Effect.Effect<readonly ListedModel[] | null> {
  return read.pipe(Effect.catch((problem: ListingProblem) => Effect.as(reported(reports, provider, problem), null)));
}
