import { recordedCursorOf, statement, type RecordedPoint, type Statement } from '@on.auto/ledger';

export const subscriptionTables: readonly Statement[] = [
  statement`CREATE TABLE IF NOT EXISTS workflow_subscriptions (
    definition_key TEXT NOT NULL,
    reference TEXT NOT NULL,
    playbook_key TEXT NOT NULL,
    version BIGINT NOT NULL,
    kind TEXT NOT NULL,
    rule TEXT NOT NULL,
    activated_by TEXT NOT NULL,
    activated_at BIGINT NOT NULL,
    next_due BIGINT,
    running TEXT,
    held_due BIGINT,
    PRIMARY KEY (definition_key, reference)
  )`,
  statement`CREATE INDEX IF NOT EXISTS workflow_subscriptions_due ON workflow_subscriptions (next_due)
    WHERE next_due IS NOT NULL`,
  statement`CREATE TABLE IF NOT EXISTS workflow_pauses (
    definition_key TEXT NOT NULL PRIMARY KEY
  )`,
  statement`CREATE TABLE IF NOT EXISTS workflow_subscription_types (
    definition_key TEXT NOT NULL,
    type TEXT NOT NULL,
    playbook_key TEXT NOT NULL,
    PRIMARY KEY (definition_key, type)
  )`,
  statement`CREATE INDEX IF NOT EXISTS workflow_subscription_types_by_type
    ON workflow_subscription_types (playbook_key, type, definition_key)`,
];

export const orgFollowerTables: readonly Statement[] = [
  statement`CREATE TABLE IF NOT EXISTS workflow_followed_orgs (
    org TEXT NOT NULL PRIMARY KEY,
    cursor TEXT,
    delivered TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    waiting INTEGER NOT NULL DEFAULT 0,
    checked BIGINT NOT NULL DEFAULT 0
  )`,
  statement`CREATE INDEX IF NOT EXISTS workflow_followed_orgs_by_check ON workflow_followed_orgs (waiting, checked)`,
  statement`CREATE TABLE IF NOT EXISTS workflow_held_playbooks (
    playbook_key TEXT NOT NULL PRIMARY KEY,
    org TEXT NOT NULL,
    cursor TEXT NOT NULL,
    held_since BIGINT NOT NULL,
    held_until BIGINT NOT NULL,
    holds INTEGER NOT NULL,
    held_for TEXT NOT NULL,
    delivered TEXT,
    attempts INTEGER NOT NULL DEFAULT 0
  )`,
  statement`CREATE INDEX IF NOT EXISTS workflow_held_playbooks_due ON workflow_held_playbooks (held_until)`,
];

export function orgFollowerCursorOf(org: string, point: RecordedPoint): string {
  return recordedCursorOf(org, point);
}

export function orgFollowerPlacedAt(org: string, point: RecordedPoint): Statement {
  return statement`INSERT INTO workflow_followed_orgs (org, cursor) VALUES (${org}, ${orgFollowerCursorOf(org, point)})`;
}
