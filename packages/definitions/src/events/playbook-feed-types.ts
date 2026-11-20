import type {
  RecordedGoalEvent,
  RecordedPlaybookGoalAgreementsEvent,
  RecordedPlaybookGoalsEvent,
} from '../goals/goals-facts.ts';
import type { RecordedPageEvent } from '../page/page-facts.ts';
import type { DefinitionEvent } from '../registry/definition-events.ts';
import type { EventPublished } from './published-events.ts';
import type { ReactionRefused } from './reaction-refusals.ts';

type PlaybookFeedType =
  | DefinitionEvent['type']
  | RecordedPageEvent['type']
  | RecordedPlaybookGoalsEvent['type']
  | RecordedPlaybookGoalAgreementsEvent['type']
  | RecordedGoalEvent['type']
  | 'playbook_import_started'
  | 'playbook_imported'
  | EventPublished['type']
  | ReactionRefused['type'];

const feedTypes: Readonly<Record<PlaybookFeedType, true>> = {
  definition_created: true,
  definition_updated: true,
  definition_retired: true,
  definition_paused: true,
  definition_resumed: true,
  definition_restored: true,
  definition_moved: true,
  definition_renamed: true,
  playbook_page_saved: true,
  playbook_goals_saved: true,
  playbook_goals_agreed: true,
  goal_created: true,
  goal_updated: true,
  goal_reordered: true,
  goal_agreed: true,
  goal_removed: true,
  playbook_import_started: true,
  playbook_imported: true,
  event_published: true,
  reaction_refused: true,
};

export const playbookFeedTypes: readonly string[] = Object.keys(feedTypes);
