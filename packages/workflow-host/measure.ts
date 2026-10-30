import { idleViewsOn } from './measure/idle-views.ts';
import { timerLatenessOn } from './measure/lateness.ts';
import { reactionLatencyOn, type ReactionLatency } from './measure/reactions.ts';
import { rebuildOn } from './measure/rebuild.ts';
import { recoveryOn } from './measure/recovery.ts';
import { measuredStores, type MeasuredStore } from './measure/stores.ts';
import { sweepCostOn } from './measure/sweeps.ts';
import { throughputOn, type Throughput } from './measure/throughput.ts';
import { triggersMeasuredOn } from './measure/trigger-lines.ts';
import { catchUpsMeasuredOn, waitingMeasuredOn } from './measure/waiting-lines.ts';

const postgresqlServer = process.env['LEDGER_MEASURE_POSTGRESQL_URL'] ?? '';

const triggersAlone = process.argv.includes('triggers');

const catchUpAlone = process.argv.includes('catch-up');

function write(line: string): void {
  process.stdout.write(`${line}\n`);
}

function rateOf({ runs, inputs, milliseconds }: Throughput): string {
  const perSecond = Math.round((inputs * 1000) / milliseconds);
  return `${inputs} inputs of ${runs} runs in ${(milliseconds / 1000).toFixed(2)} s, ${perSecond} inputs a second`;
}

const reacted = { workflows: 100, events: 1000 };

function latencyLine(store: string, signal: string, latency: ReactionLatency): string {
  return `${store}: ${latency.events} events, each matching one of ${latency.workflows} workflows, ${signal} the append signal, started their runs ${latency.p50} ms after their append at the median, ${latency.p99} ms at p99, ${latency.most} ms at most`;
}

async function measuredOn({ store, aDatabase, removeAll }: MeasuredStore): Promise<void> {
  try {
    if (catchUpAlone) {
      await catchUpsMeasuredOn(store, aDatabase, write, 3);
      return;
    }
    await triggersMeasuredOn(store, aDatabase, write);
    if (triggersAlone) {
      return;
    }
    await waitingMeasuredOn(store, aDatabase, write);
    const lateness = await timerLatenessOn(await aDatabase(), 1000);
    write(
      `${store}: ${lateness.timers} timers fired late by ${lateness.p50} ms at the median, ${lateness.p99} ms at p99, ${lateness.most} ms at most`,
    );
    write(`${store}: the long-run loop, ${rateOf(await throughputOn(await aDatabase(), 1, 3000))}`);
    write(`${store}: runs side by side, ${rateOf(await throughputOn(await aDatabase(), 100, 100))}`);
    const reacting = await timerLatenessOn(await aDatabase(), 1000, 1000);
    write(
      `${store}: with 1000 workflows with event triggers in the playbook, ${reacting.timers} timers fired late by ${reacting.p50} ms at the median, ${reacting.p99} ms at p99, ${reacting.most} ms at most`,
    );
    write(latencyLine(store, 'with', await reactionLatencyOn(await aDatabase(), { ...reacted, signalled: true })));
    write(latencyLine(store, 'without', await reactionLatencyOn(await aDatabase(), { ...reacted, signalled: false })));
    const sweep = await sweepCostOn(await aDatabase(), 1000, 10);
    write(
      `${store}: ${sweep.playbooks} followed playbooks, ${sweep.reacting} with an event trigger: the sweeps after the start went over them in ${sweep.roundMs.toFixed(0)} ms, a sweep with nothing new took ${sweep.idleMs.toFixed(2)} ms at the median, and the sweeps after one new record in each took ${sweep.changedMs.toFixed(0)} ms`,
    );
    const recovery = await recoveryOn(await aDatabase());
    write(
      `${store}: after a restart, a snapshot of ${recovery.snapshotBytes} bytes and ${recovery.eventsAfterIt} events after it: the host opened in ${recovery.openMs.toFixed(1)} ms, the first input took ${recovery.firstInputMs.toFixed(1)} ms and the next ${recovery.nextInputMs.toFixed(1)} ms`,
    );
    const rebuild = await rebuildOn(await aDatabase(), 100_000);
    write(
      `${store}: a view rebuilt over ${rebuild.events} matching events in ${(rebuild.milliseconds / 1000).toFixed(2)} s, ${Math.round((rebuild.events * 1000) / rebuild.milliseconds)} events a second, in ${rebuild.pages} pages and ${rebuild.writes} writes of its row, to a view of ${rebuild.viewBytes} bytes`,
    );
    const idle = await idleViewsOn(await aDatabase(), 32, 10);
    write(
      `${store}: ${idle.views} live views of ${idle.viewBytes} bytes each, with no new events, kept the event loop busy ${idle.busyMsASecond.toFixed(1)} ms a second over ${idle.seconds} s`,
    );
  } finally {
    await removeAll();
  }
}

async function measuredInTurn(stores: readonly MeasuredStore[]): Promise<void> {
  const [first, ...rest] = stores;
  if (first !== undefined) {
    await measuredOn(first);
    await measuredInTurn(rest);
  }
}

write(`Node ${process.version}`);
await measuredInTurn(measuredStores(postgresqlServer));
