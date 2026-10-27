import { statement, type ConnectionPorts } from '@on.auto/ledger';
import { allocationPayload } from '@on.auto/metering';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { openOfflineMeter } from '../index.ts';
import { offlineFixture, reserveRequest } from '../offline-testing/fixture.ts';
import { reservationFunding } from './funding.ts';

const record = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown));

function alteredRead(
  connection: ConnectionPorts,
  pattern: string,
  fields: Readonly<Record<string, unknown>>,
): ConnectionPorts {
  return {
    ...connection,
    readConsistently: (reads) =>
      connection.readConsistently((read) =>
        reads(async (sql) => {
          const rows = await read(sql);
          return sql.strings.join('').includes(pattern) ? rows.map((row) => ({ ...record(row), ...fields })) : rows;
        }),
      ),
  };
}

describe('offline reservation immutable intent', () => {
  it.each([
    { name: 'quote', fields: { quote_id: 'changed' } },
    { name: 'fractional maximum', fields: { maximum_units: 2_000_001 } },
    { name: 'empty capabilities', fields: { capabilities_json: '[]' } },
    { name: 'duplicate capabilities', fields: { capabilities_json: '["reasoning","reasoning"]' } },
    { name: 'invented running state', fields: { state: 'running' } },
    { name: 'invented settled state', fields: { state: 'settled' } },
  ])(
    'refuses $name projection corruption',
    async ({ fields }: { readonly fields: Readonly<Record<string, unknown>> }) => {
      const f = await offlineFixture();
      const hold = await f.meter.reserve(await reserveRequest('root', 2n));
      const meter = await openOfflineMeter({
        ...f.options,
        connection: alteredRead(f.options.connection, 'FROM meter_reservations r', fields),
      });
      await expect(meter.reservation(hold.reservationId)).rejects.toThrow('offline_reservation_projection_invalid');
    },
  );

  it('rejects altered canonical context bytes', async () => {
    const f = await offlineFixture();
    const request = await reserveRequest();
    const hold = await f.meter.reserve(request);
    const meter = await openOfflineMeter({
      ...f.options,
      connection: alteredRead(f.options.connection, 'FROM meter_reservations r', {
        context_json: `${JSON.stringify(request.context)} `,
      }),
    });
    await expect(meter.reservation(hold.reservationId)).rejects.toThrow('offline_reservation_projection_invalid');
  });
});

describe('offline reservation source projections', () => {
  it.each([
    { name: 'enlarged ceiling', fields: { capacity_units: 2_000_001 } },
    { name: 'missing source order', fields: { position: 1 } },
    { name: 'enlarged parts', fields: { units: 3_000_000, capacity_units: 3_000_000, reserved_units: 3_000_000 } },
    { name: 'unaccounted source quantity', fields: { reserved_units: 0 } },
    { name: 'commit without dispatch', fields: { reserved_units: 1_000_000, committed_units: 1_000_000 } },
    { name: 'release without settlement', fields: { reserved_units: 1_000_000, released_units: 1_000_000 } },
  ])('refuses $name', async ({ fields }: { readonly fields: Readonly<Record<string, unknown>> }) => {
    const f = await offlineFixture();
    const hold = await f.meter.reserve(await reserveRequest('root', 2n));
    const meter = await openOfflineMeter({
      ...f.options,
      connection: alteredRead(f.options.connection, 'FROM meter_reservation_sources s', fields),
    });
    await expect(meter.reservation(hold.reservationId)).rejects.toThrow('offline_reservation_projection_invalid');
  });

  it('refuses a source whose mutable usage row is missing', async () => {
    const f = await offlineFixture();
    const hold = await f.meter.reserve(await reserveRequest());
    await f.options.connection.write(statement`DELETE FROM meter_reservation_usage`);
    await expect(f.meter.reservation(hold.reservationId)).rejects.toThrow(/capacity_units/u);
  });
});

describe('signed capacity and funding consistency', () => {
  it('rejects an internally consistent projection that differs from the signed allocation', async () => {
    const f = await offlineFixture();
    const allocation = {
      ...f.allocation,
      sources: f.allocation.sources.map((source) => ({ ...source, expiresAt: source.expiresAt + 1 })),
    };
    const meter = await openOfflineMeter({
      ...f.options,
      connection: alteredRead(f.options.connection, 'h.claims_json', { claims_json: allocationPayload(allocation) }),
    });
    await expect(meter.reserve(await reserveRequest())).rejects.toThrow('offline_capacity_projection_invalid');
  });

  it('refuses funding with a counter for an unknown source', async () => {
    const f = await offlineFixture();
    const capacity = await f.capacity.snapshot();
    expect(capacity).toBeDefined();
    const license = await f.licenses.current(await f.clock.read());
    const request = await reserveRequest();
    const verified = {
      authority: { license, now: 5000, clockRevision: 0 },
      capacity: {
        allocation: f.allocation,
        revision: 0,
        state: 'open',
        checkpoint: 'a'.repeat(64),
        counters: [{ lotId: 'unknown', committedUnits: 0n, reservedUnits: 0n }],
      },
    } satisfies Parameters<typeof reservationFunding>[0];
    expect(() => reservationFunding(verified, request)).toThrow('offline_capacity_projection_invalid');
  });
});
