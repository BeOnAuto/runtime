import type { SelfHostedMeter } from '@on.auto/meter';

export async function meterStatus(meter: SelfHostedMeter) {
  const [head, current, time, capacity] = await Promise.all([
    meter.license.head(),
    meter.license.current().catch(() => null),
    meter.time(),
    meter.capacity(),
  ]);
  return {
    installation: meter.installation,
    head,
    current,
    usable: current !== null,
    time,
    capacity: capacity ?? null,
  };
}

export function meterResponse(value: unknown): Response {
  return new Response(
    JSON.stringify(value, (_key, item: unknown) => (typeof item === 'bigint' ? String(item) : item)),
    {
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    },
  );
}
