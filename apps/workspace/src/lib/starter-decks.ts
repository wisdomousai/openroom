import { defaultDeckDesign, type Outline, type WorkspaceExperience } from '@openroom/schema';

/** Small, teachable examples. Inserting one creates an ordinary editable deck. */
const STARTERS: Record<WorkspaceExperience, Outline> = {
  tutoring: {
    version: 1, meta: { title: 'Au café · French A1' },
    steps: [
      { id: 'welcome', kind: 'title', title: 'Au café', body: 'Order a drink politely and ask the price.' },
      { id: 'phrases', kind: 'cards', title: 'Trois phrases utiles', items: [
        { label: 'Ask', text: 'Je voudrais un café, s’il vous plaît.' },
        { label: 'Price', text: 'Ça coûte combien ?' },
        { label: 'Thank', text: 'Merci, bonne journée !' },
      ] },
      { id: 'ask', kind: 'interaction', interactionId: 'polite' },
      { id: 'practice', kind: 'activity', title: 'À vous de commander', instructions: [
        'One person is the customer; the other serves at the café.',
        'Order a drink, ask the price and say thank you.',
        'Swap roles. This time, order something different.',
      ], durationSec: 180 },
      { id: 'recap', kind: 'debrief', title: 'Avant de partir', prompts: ['Which phrase can you say without looking?', 'What would you order at a café in France?'] },
    ],
    interactions: [{ id: 'polite', type: 'choice', prompt: 'Which request would you use with someone you do not know?', options: [
      { id: 'a', label: 'Un café !' }, { id: 'b', label: 'Je voudrais un café, s’il vous plaît.', correct: true },
    ] }],
  },
  classroom: {
    version: 1, meta: { title: 'What plants need' },
    steps: [
      { id: 'welcome', kind: 'title', title: 'What plants need', body: 'Make a prediction, compare your reasons and design a fair test.' },
      { id: 'predict', kind: 'interaction', interactionId: 'light' },
      { id: 'discuss', kind: 'activity', title: 'Compare your reasons', instructions: [
        'Explain your prediction to a partner.',
        'Name one observation that supports your idea.',
        'Discuss what would make you change your mind.',
      ], durationSec: 120 },
      { id: 'test', kind: 'steps', title: 'Design a fair test', items: ['Use similar plants.', 'Change only the amount of light.', 'Keep water, soil and temperature the same.'], reveal: [['header'], ['cell-0'], ['cell-1'], ['cell-2']] },
      { id: 'reflect', kind: 'debrief', title: 'What would count as evidence?', prompts: ['What will you measure?', 'How long will you observe?', 'What result would challenge your prediction?'] },
    ],
    interactions: [{ id: 'light', type: 'choice', prompt: 'Two similar plants get the same water. One has light; the other stays in a dark cupboard. What do you predict after two weeks?', options: [
      { id: 'a', label: 'They will grow equally well.' }, { id: 'b', label: 'The plant with light will stay healthier.', correct: true }, { id: 'c', label: 'The plant in the cupboard will stay healthier.' },
    ] }],
  },
  training: {
    version: 1, meta: { title: 'Make a decision together' },
    steps: [
      { id: 'welcome', kind: 'title', title: 'Make a decision together', body: 'Surface different priorities, test the trade-offs and agree on one action.' },
      { id: 'scenario', kind: 'statement', title: 'A customer deadline is at risk', body: 'Your team has found a defect two days before delivery. A complete fix takes a week. A smaller release could go out on time. The customer has not yet been told.' },
      { id: 'choose', kind: 'interaction', interactionId: 'decision' },
      { id: 'discuss', kind: 'activity', title: 'Test your decision', instructions: [
        'Each person explains one risk behind their choice.',
        'Identify the information you still need from the customer.',
        'Agree what you would communicate today and who should own the next action.',
      ], durationSec: 300 },
      { id: 'debrief', kind: 'debrief', title: 'From discussion to action', prompts: ['Which trade-off changed your thinking?', 'What would you do first?', 'How will you check whether the decision worked?'] },
    ],
    interactions: [{ id: 'decision', type: 'choice', prompt: 'What would you recommend first?', options: [
      { id: 'a', label: 'Propose a smaller release and explain the defect.' },
      { id: 'b', label: 'Ask for a new delivery date for the complete fix.' },
      { id: 'c', label: 'Get the customer’s priorities before proposing a solution.' },
    ] }],
  },
};

export function starterDeck(experience: WorkspaceExperience): Outline {
  return { ...structuredClone(STARTERS[experience]), design: defaultDeckDesign(experience === 'training' ? 'business' : experience === 'tutoring' ? 'paper' : 'clean') };
}
