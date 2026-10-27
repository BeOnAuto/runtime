import type { LicenseClient } from '../license-client/records.ts';
import type { ReportPollResult } from '../maintenance/reporting.ts';
import type { SelfHostedMaintenance } from './records.ts';

function finished<Value>(result: Readonly<PromiseSettledResult<Value>>): Value {
  if (result.status === 'rejected') {
    const failure: unknown = result.reason;
    throw failure;
  }
  return result.value;
}

export async function maintainSelfHosted(
  pollLicense: LicenseClient['poll'],
  pollReporting: () => Promise<ReportPollResult>,
): Promise<SelfHostedMaintenance> {
  const [licenseResult, reportingResult] = await Promise.allSettled([
    Promise.resolve().then(pollLicense),
    Promise.resolve().then(pollReporting),
  ]);
  const license = finished(licenseResult);
  const reporting = finished(reportingResult);
  return {
    license,
    reporting,
    retryInMilliseconds: Math.min(license.retryInMilliseconds, reporting.retryInMilliseconds),
  };
}
