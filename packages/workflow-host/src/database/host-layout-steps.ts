import { statement, type LayoutStep } from '@on.auto/ledger';

import { reactionRefusalsTable } from './host-tables.ts';

const refusalsBeforeLayout16 = statement`CREATE TABLE IF NOT EXISTS workflow_reaction_refusals (
    playbook_key TEXT NOT NULL,
    workflow TEXT NOT NULL,
    version INTEGER NOT NULL,
    minute BIGINT NOT NULL,
    count INTEGER NOT NULL,
    reason TEXT NOT NULL,
    recorded INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (playbook_key, workflow)
  )`;

const runsBeforeLayout17 = statement`CREATE TABLE IF NOT EXISTS workflow_runs (
    run_key TEXT NOT NULL PRIMARY KEY,
    stream_id TEXT NOT NULL,
    dispatched_through BIGINT NOT NULL DEFAULT 0,
    ended_at BIGINT,
    taken BIGINT NOT NULL DEFAULT 0
  )`;

const subscriptionsBeforeLayout18 = statement`CREATE TABLE IF NOT EXISTS workflow_subscriptions (
    playbook_key TEXT NOT NULL,
    workflow TEXT NOT NULL,
    reference TEXT NOT NULL,
    version BIGINT NOT NULL,
    kind TEXT NOT NULL,
    rule TEXT NOT NULL,
    activated_by TEXT NOT NULL,
    activated_at BIGINT NOT NULL,
    next_due BIGINT,
    running TEXT,
    PRIMARY KEY (playbook_key, workflow, reference)
  )`;

const refusalsBeforeLayout18 = statement`CREATE TABLE IF NOT EXISTS workflow_reaction_refusals (
    playbook_key TEXT NOT NULL,
    workflow TEXT NOT NULL,
    version INTEGER NOT NULL,
    minute BIGINT NOT NULL,
    count INTEGER NOT NULL,
    reason TEXT NOT NULL,
    recorded INTEGER NOT NULL DEFAULT 0,
    kind TEXT,
    because TEXT,
    trigger_kind TEXT,
    trigger_reference TEXT,
    PRIMARY KEY (playbook_key, workflow)
  )`;

const followedPlaybooksBeforeLayout19 = statement`CREATE TABLE IF NOT EXISTS workflow_followed_playbooks (
    playbook_key TEXT NOT NULL PRIMARY KEY,
    cursor TEXT,
    delivered TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    waiting INTEGER NOT NULL DEFAULT 0,
    checked BIGINT NOT NULL DEFAULT 0
  )`;

export const hostLayoutSteps: readonly LayoutStep[] = [
  { layout: 9, statements: [statement`DROP TABLE IF EXISTS recall_views`] },
  { layout: 14, statements: [] },
  {
    layout: 16,
    statements: [
      refusalsBeforeLayout16,
      statement`ALTER TABLE workflow_reaction_refusals ADD COLUMN kind TEXT`,
      statement`ALTER TABLE workflow_reaction_refusals ADD COLUMN because TEXT`,
      statement`ALTER TABLE workflow_reaction_refusals ADD COLUMN trigger_kind TEXT`,
      statement`ALTER TABLE workflow_reaction_refusals ADD COLUMN trigger_reference TEXT`,
    ],
  },
  {
    layout: 17,
    statements: [
      runsBeforeLayout17,
      statement`ALTER TABLE workflow_runs ADD COLUMN ended_time BIGINT`,
      statement`ALTER TABLE workflow_runs ADD COLUMN closed_at BIGINT`,
    ],
  },
  {
    layout: 18,
    statements: [
      subscriptionsBeforeLayout18,
      refusalsBeforeLayout18,
      statement`ALTER TABLE workflow_subscriptions ADD COLUMN held_due BIGINT`,
      statement`CREATE TABLE workflow_reaction_refusals_by_workflow AS SELECT * FROM workflow_reaction_refusals`,
      statement`DROP TABLE workflow_reaction_refusals`,
      reactionRefusalsTable,
      statement`INSERT INTO workflow_reaction_refusals
          (playbook_key, workflow, version, minute, count, reason, recorded, kind, because, trigger_kind, trigger_reference)
        SELECT playbook_key, workflow, version, minute, count, reason, recorded, kind, because,
          COALESCE(trigger_kind, ''), COALESCE(trigger_reference, '')
        FROM workflow_reaction_refusals_by_workflow`,
      statement`DROP TABLE workflow_reaction_refusals_by_workflow`,
    ],
  },
  {
    layout: 19,
    statements: [
      followedPlaybooksBeforeLayout19,
      statement`ALTER TABLE workflow_followed_playbooks ADD COLUMN held_since BIGINT`,
      statement`ALTER TABLE workflow_followed_playbooks ADD COLUMN held_until BIGINT`,
      statement`ALTER TABLE workflow_followed_playbooks ADD COLUMN holds INTEGER NOT NULL DEFAULT 0`,
      statement`ALTER TABLE workflow_followed_playbooks ADD COLUMN held_for TEXT`,
    ],
  },
];
