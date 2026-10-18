type DescribedValue = 'input' | 'output' | 'value';

const leads: Readonly<Record<'input' | 'output', string>> = {
  input: 'It takes any input',
  output: 'It produces any output',
};

const undescribed = ', which its document does not describe.';

export function undescribedSentence(value: 'input' | 'output'): string;
export function undescribedSentence(value: DescribedValue, said: 'alone'): string;
export function undescribedSentence(value: DescribedValue, said?: 'alone'): string {
  return said === 'alone' || value === 'value' ? `Any ${value}${undescribed}` : `${leads[value]}${undescribed}`;
}
