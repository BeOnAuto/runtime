import type { ConsentServices } from './consent-asking.ts';
import { defineFinishConsent } from './consent-finish.ts';
import { defineStartConsent } from './consent-start.ts';

export function consentOperationsOf(services: ConsentServices) {
  return [defineStartConsent(services), defineFinishConsent(services)];
}
