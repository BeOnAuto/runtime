import type { KeyCommandConsole } from '@on.auto/identity';
import { Effect, Option, Schema } from 'effect';

import { runtimeAddressOf, whenRunning, type RuntimeFetch } from './runtime-probe.ts';

interface RuntimeAsking {
  readonly fetch: RuntimeFetch;
  readonly console: KeyCommandConsole;
}

const askedWithinMs = 30_000;

const LicensedSchema = Schema.Struct({
  installation: Schema.String,
  org: Schema.String,
  plan: Schema.String,
  expires_at: Schema.String,
});

const licensedIn = Schema.decodeUnknownOption(Schema.fromJsonString(LicensedSchema));

const refusalIn = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Struct({ detail: Schema.String })));

interface Answer {
  readonly status: number;
  readonly text: string;
}

function activationAsked(port: number, key: string, asking: RuntimeAsking): Effect.Effect<Answer> {
  return Effect.promise(async (signal) => {
    try {
      const response = await asking.fetch(`${runtimeAddressOf(port)}/v1/orgs/local/license`, {
        method: 'POST',
        timeoutMs: askedWithinMs,
        signal,
        body: JSON.stringify({ key }),
      });
      return { status: response.status, text: await response.text() };
    } catch (failure) {
      return { status: 0, text: JSON.stringify({ detail: `Auto Runtime did not answer: ${String(failure)}` }) };
    }
  });
}

function told(answer: Answer, asking: RuntimeAsking): number {
  const licensed = Option.filter(licensedIn(answer.text), () => answer.status === 200);
  if (Option.isSome(licensed)) {
    const { org, plan, installation, expires_at: expiresAt } = licensed.value;
    asking.console.log(
      `Auto Runtime is licensed to the org ${org} on the plan ${plan}, as the installation ${installation}, until ${expiresAt}; it renews the license every day`,
    );
    return 0;
  }
  const { detail } = Option.getOrElse(refusalIn(answer.text), () => ({ detail: `It answered ${answer.status}` }));
  asking.console.error(`Auto Runtime did not activate the key: ${detail}`);
  return 1;
}

export function runLicenseActivation(key: string, port: number, asking: RuntimeAsking): Effect.Effect<number> {
  return whenRunning(port, asking, () =>
    Effect.map(activationAsked(port, key, asking), (answer) => told(answer, asking)),
  );
}
