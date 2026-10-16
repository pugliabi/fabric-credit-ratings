import type { Factor } from '../domain/types.ts';

export const FACTORS: readonly Factor[] = [
  {
    id: 'capability',
    label: 'Feature Capability',
    question: 'What can it do, and how complete is it?',
    low: 'Gaps block common scenarios',
    high: 'Complete, with nothing missing for its job',
  },
  {
    id: 'ux',
    label: 'User Experience',
    question: 'How easy is it to build with, debug, and operate?',
    low: 'Friction at every step',
    high: 'Fast, obvious, and easy to troubleshoot',
  },
  {
    id: 'cost',
    label: 'CU / Token Cost',
    question: 'How many capacity units or tokens does the work cost?',
    low: 'Burns capacity for the result',
    high: 'Cheapest way to get the result',
  },
];
