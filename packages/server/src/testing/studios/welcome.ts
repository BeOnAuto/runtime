const welcomeSentences = [
  'This organization has no playbooks yet.',
  'A playbook is work a person asks for once and Auto keeps and runs: functions that reason, interact, predict, recall and compute, coordinated by workflows.',
  'Unless the person has already said what they want, ask what they want done, and offer three starts: set up a first playbook, connect a service they use, or hear what Auto can do for their team.',
  "Studio is your team's window on everything your agent builds.",
  'Each playbook and its workflows, every run and what it produced, the services connected, who is in the organization and what it costs.',
];

export function welcomeLinking(studioHome: string): string {
  return [...welcomeSentences, studioHome].join(' ');
}

export function servedStudioHomeOf(origin: string): string {
  return `${origin}/studio/?server=${encodeURIComponent(origin)}&src=agent`;
}

export function studioHostHomeOf(origin: string): string {
  return `https://studio.on.auto/?server=${encodeURIComponent(origin)}&src=agent`;
}
