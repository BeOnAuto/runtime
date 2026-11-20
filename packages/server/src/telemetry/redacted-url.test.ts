import { Context, Effect, ManagedRuntime, Tracer } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { readSettingsOf } from '../testing/settings/shipped-settings.ts';
import { spansIn } from '../testing/telemetry/otlp-exports.ts';
import { receivingOtlp } from '../testing/telemetry/otlp-receiver.ts';
import { redactedUrlAttributes, withoutTheTokenOfALink } from './redacted-url.ts';
import { startTelemetry } from './start-telemetry.ts';

describe('the URL of an outbound request on its span', () => {
  it('keeps the origin and the path, and redacts every value of the query and the credentials', () => {
    expect(
      redactedUrlAttributes({
        origin: 'https://user:secret@gateway.example.com',
        path: '/v1/chat?api-key=sk-123&api-key=sk-456&model=x',
      }),
    ).toEqual({
      'url.full': 'https://gateway.example.com/v1/chat?api-key=REDACTED&model=REDACTED',
      'url.query': '?api-key=REDACTED&model=REDACTED',
    });
  });

  it('is left to the instrumentation when the request names no URL', () => {
    expect(redactedUrlAttributes({ origin: 'not a url', path: 'nor this' })).toEqual({});
  });
});

async function outboundUrlsOnSpans(sentUnder: (sent: Effect.Effect<Response>) => Effect.Effect<Response>) {
  const receiver = await receivingOtlp();
  onTestFinished(receiver.close);
  const target = await receivingOtlp();
  onTestFinished(target.close);
  const environment = { OTEL_EXPORTER_OTLP_ENDPOINT: receiver.endpoint, OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json' };
  const telemetry = startTelemetry(readSettingsOf(environment).telemetry);
  const runtime = ManagedRuntime.make(telemetry.layer);
  await runtime.runPromise(sentUnder(Effect.promise(() => fetch(`${target.endpoint}/projects/acme-web/hooks`))));
  await runtime.dispose();
  await telemetry.shutdown();
  return spansIn(receiver.received()).flatMap(({ attributes }) => attributes['url.full'] ?? []);
}

describe('the URL of an outbound request sent under a span that does not propagate', () => {
  it('is on no span, where one sent under a span that propagates is on the HTTP client’s', async () => {
    const unpropagated = { annotations: Context.make(Tracer.DisablePropagation, true) };

    expect(await outboundUrlsOnSpans((sent) => sent.pipe(Effect.withSpan('a round')))).toHaveLength(1);
    expect(
      await outboundUrlsOnSpans((sent) => sent.pipe(Effect.withSpan('sent', unpropagated), Effect.withSpan('a round'))),
    ).toEqual([]);
  });
});

describe('the URL of an inbound request on its span', () => {
  it('masks the secret of an invitation link, after /invitations/ at the root, and leaves an invitation’s id in the API as it is', () => {
    expect(
      [
        'https://auto.example.com/invitations/kQ2_x-9pendingInvitation',
        'https://auto.example.com/invitations/kQ2_x-9pendingInvitation?view=1',
        'http://127.0.0.1:5555/v1/orgs/default/members/invitations/9b74c9897bac770ffc029102a200c5de1f8b7c1f3b6e1ad2f0d2b3e1c4a5f6e7',
      ].map((url) => withoutTheTokenOfALink(url)),
    ).toEqual([
      'https://auto.example.com/invitations/REDACTED',
      'https://auto.example.com/invitations/REDACTED?view=1',
      'http://127.0.0.1:5555/v1/orgs/default/members/invitations/9b74c9897bac770ffc029102a200c5de1f8b7c1f3b6e1ad2f0d2b3e1c4a5f6e7',
    ]);
  });

  it('masks the token of a link, after /connections/<id>/link/, and leaves every other URL as it is', () => {
    expect(
      [
        'http://127.0.0.1:5555/v1/orgs/acme/connections/0199-crm/link/kQ2_x-9?view=1',
        'http://127.0.0.1:5555/v1/orgs/acme/connections/0199-crm/link/kQ2_x-9',
        'http://127.0.0.1:5555/v1/orgs/acme/connections/0199-crm',
        'http://127.0.0.1:5555/v1/orgs/acme/playbooks/link/definitions/reasoning/link/run',
      ].map((url) => withoutTheTokenOfALink(url)),
    ).toEqual([
      'http://127.0.0.1:5555/v1/orgs/acme/connections/0199-crm/link/REDACTED?view=1',
      'http://127.0.0.1:5555/v1/orgs/acme/connections/0199-crm/link/REDACTED',
      'http://127.0.0.1:5555/v1/orgs/acme/connections/0199-crm',
      'http://127.0.0.1:5555/v1/orgs/acme/playbooks/link/definitions/reasoning/link/run',
    ]);
  });
});
