const whatAGoalHolds = {
  told: 'what it should achieve for them, how they will know it worked, and what they want to be told about, and where',
  untold: 'what it should achieve for them and how they will know it worked',
};

const goalsSectionOf = (holds: string): readonly string[] => [
  '',
  '## Its goals',
  '',
  `A goal is what the playbook is for, in the person's own words: ${holds}. A playbook here cannot be made without its goals: create_playbook refuses one that has none, and a workflow saved in a playbook that has none is refused too.`,
  '',
  "So your first step, before you make anything, is to ask the person, through your client's question tool where it has one: What should this playbook achieve for you, and how will you know it worked? Learn the rest in the same round, propose the goals once as the goals guide says, and after their yes send them as the goals argument of create_playbook, or of update_playbook for a playbook that has no goals yet. Then give them the `studio` link the answer holds and, when the saved goals are the ones they agreed, record their yes with agree_playbook_goals before you make anything else. Every workflow you save then says what it does for a goal.",
];

export interface GoalsCarried {
  readonly goals?: boolean;
  readonly messages?: boolean;
}

export function itsGoals({ goals, messages }: GoalsCarried): readonly string[] {
  if (goals !== true) {
    return [];
  }
  return goalsSectionOf(messages === true ? whatAGoalHolds.told : whatAGoalHolds.untold);
}
