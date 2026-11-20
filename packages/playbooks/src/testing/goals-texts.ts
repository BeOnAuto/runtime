export const leadGoalId = 'paying-customers';

export const plainGoalId = 'steady-orders';

export const goalsText = [
  `- id: ${leadGoalId}`,
  '  statement: Bring in paying customers through my experiments.',
  '  per: experiment',
  '  window: { after: live, for: P7D, grace: P1D }',
  '  success:',
  '    label: New paying customers',
  '    settles: on_crossing',
  '    target: { at_least: 1 }',
  '    passed: Brought a customer',
  '    failed: Brought no customer',
  '  milestones:',
  '    - { id: chosen, label: Idea chosen, by: person }',
  '    - { id: prepared, label: Package prepared, by: auto }',
  '    - { id: live, label: Taken live, by: person }',
  '    - { id: measured, label: Measured, by: auto }',
  '  notify:',
  '    passed: now',
  '    failed: now',
  '    overdue: now',
  '    through: tell-owner',
  `- id: ${plainGoalId}`,
  '  statement: Keep the weekly orders coming in from the shop.',
  '  success:',
  '    label: Orders this week',
  '    settles: on_crossing',
  '    target: { at_least: 20 }',
  '    passed: Orders came in',
  '    failed: Orders fell short',
  '  notify: { passed: quiet, failed: quiet }',
  '',
].join('\n');

export const restatedGoalsText = goalsText.replace('through my experiments', 'through my launches');

export function versionsOfBothAt(version: number) {
  return [leadGoalId, plainGoalId].map((id) => ({ id, version }));
}

export const goalsTextGaps = [
  { kind: 'measure_unreported', goal: leadGoalId },
  { kind: 'milestone_unmarked', goal: leadGoalId },
  { kind: 'milestone_unmarked', goal: leadGoalId },
  { kind: 'window_never_starts', goal: leadGoalId },
  { kind: 'milestone_unmarked', goal: leadGoalId },
  { kind: 'notice_function_missing', goal: leadGoalId },
  { kind: 'measure_unreported', goal: plainGoalId },
];
