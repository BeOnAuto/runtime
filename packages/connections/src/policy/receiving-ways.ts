import type { SettingProblem } from '@on.auto/config';
import { Result, Schema } from 'effect';

export const receiveEventsSetting = 'CONNECTIONS_RECEIVE_EVENTS';

const ReceivingWaySchema = Schema.Literal('http').annotate({
  description:
    "A way the runtime receives what a connection's service sends: http, a delivery signed as the Standard Webhooks specification signs a webhook, at the connection's answer addresses",
});

export type ReceivingWay = typeof ReceivingWaySchema.Type;

const everyWay: readonly ReceivingWay[] = ['http'];

const isReceivingWay = Schema.is(ReceivingWaySchema);

export const ReceiveEventsSchema = Schema.Array(ReceivingWaySchema).annotate({
  description: `The ways the runtime receives what a connection's service sends, of http; every way when left out, and none for an empty list, so a request is answered only through Auto or by reading its replies. ${receiveEventsSetting} wins over it`,
});

const unknownWay: SettingProblem = {
  setting: receiveEventsSetting,
  detail: 'Expected ways of receiving separated by commas, of http, or nothing for none',
};

export function receiveEventsIn(
  environment: Readonly<Record<string, string | undefined>>,
  written: readonly ReceivingWay[] | undefined,
): Result.Result<readonly ReceivingWay[] | undefined, readonly SettingProblem[]> {
  const given = environment[receiveEventsSetting];
  if (given === undefined) {
    return Result.succeed(written);
  }
  const listed = given
    .split(',')
    .map((way) => way.trim())
    .filter((way) => way !== '');
  const ways = listed.filter((way) => isReceivingWay(way));
  return ways.length === listed.length ? Result.succeed(ways) : Result.fail([unknownWay]);
}

export function receivesOver(
  { receiveEvents }: { readonly receiveEvents: readonly ReceivingWay[] | undefined },
  way: ReceivingWay,
): boolean {
  return (receiveEvents ?? everyWay).includes(way);
}
