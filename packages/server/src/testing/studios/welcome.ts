const welcomeSentences = [
  'This organization has no playbooks yet.',
  'A playbook keeps work your team can use again. Its workflows coordinate functions that reason, interact, predict and compute.',
  'Unless the person has already said what they want, ask what they want done, and offer three starts: set up a first playbook, connect a service they use, or hear what Auto can do for their team.',
  'Before you build, read the guide start with get_guide: it says which function type each part of a job takes.',
  'In Studio, your team can review playbooks and run results.',
  'You can also manage workflows, connections, members and billing there.',
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
