import type { Outline } from './outline-types.js';

export interface WorkshopSequence {
  id: string;
  name: string;
  description: string;
  minutes: number;
  steps: Outline['steps'];
  interactions: Outline['interactions'];
}

/** Ordinary authored slides and questions. Insertion copies them into the deck. */
export const WORKSHOP_SEQUENCES: readonly WorkshopSequence[] = [
  {
    id: 'check-in', name: 'Check-in', minutes: 5,
    description: 'Find out what people need, then agree what to focus on.',
    steps: [
      { id: 'welcome', kind: 'title', title: 'Make this useful', body: 'Think of a real situation you want to handle better.', tutorNotes: 'Allow one minute of quiet thinking. Explain that this is preparation, not an assessment.' },
      { id: 'needs', kind: 'interaction', interactionId: 'needs', tutorNotes: 'Collect answers before showing the wall. Read for recurring needs; do not ask people to defend a response.' },
      { id: 'focus', kind: 'debrief', title: 'Where we will focus', prompts: ['Which needs are shared?', 'What can we practise together?', 'What should we take away?'], tutorNotes: 'Allow two minutes. Name one concrete outcome for this workshop, using the room’s own words.' },
    ],
    interactions: [{ id: 'needs', type: 'text', prompt: 'What situation would you like to handle better?', display: 'cards', maxLength: 200, timerSec: 60, resultVisibility: 'hidden-until-close' }],
  },
  {
    id: 'think-discuss-revote', name: 'Think, discuss, revote', minutes: 8,
    description: 'Compare an individual decision before and after hearing another view.',
    steps: [
      { id: 'situation', kind: 'statement', title: 'A deadline has moved', body: 'A customer needs an earlier delivery. The team cannot meet it without dropping another commitment. You lead the next conversation.', tutorNotes: 'Give the room one minute to read. Replace this situation with one from your work before presenting.' },
      { id: 'decision', kind: 'interaction', interactionId: 'decision', tutorNotes: 'First vote: 45 seconds, individually. Close voting; keep results hidden. Ask pairs to compare reasoning for two minutes. Press Revote, allow 45 seconds, then close and reveal both rounds. A changed answer is evidence of thinking, not a failure.' },
      { id: 'debrief', kind: 'debrief', title: 'What changed your decision?', prompts: ['Which argument made you reconsider?', 'What information is still missing?', 'What would you say first?'], tutorNotes: 'Allow three minutes. Invite competing reasons before offering your interpretation. There is no authored right answer.' },
    ],
    interactions: [{ id: 'decision', type: 'choice', prompt: 'What should happen first?', peerInstruction: true, timerSec: 45, resultVisibility: 'hidden-until-close', options: [
      { id: 'promise', label: 'Accept the date and find a way' }, { id: 'tradeoffs', label: 'Discuss priorities and trade-offs' }, { id: 'decline', label: 'Keep the original commitment' },
    ] }],
  },
  {
    id: 'scenario-decision', name: 'Scenario decision', minutes: 10,
    description: 'Make a group decision under uncertainty and explain its trade-offs.',
    steps: [
      { id: 'case', kind: 'statement', title: 'The handoff is failing', body: 'Two teams each believe the other owns the final customer update. A customer has now asked twice. Both teams have followed their own checklist.', tutorNotes: 'Read together for one minute. Ask which facts are known and which are assumptions. Adapt the scenario to your audience.' },
      { id: 'discuss', kind: 'timer', seconds: 180, title: 'Agree on a first move', body: 'Consider the customer, the immediate handoff, and how to prevent a repeat.', placement: 'slide', style: 'ring', tutorNotes: 'Create groups and assign a spokesperson in the Groups pane. Start the clock when everyone is ready. Ask each group for a decision and a reason.' },
      { id: 'response', kind: 'interaction', interactionId: 'response', tutorNotes: 'Only the spokesperson submits. Allow one minute, close responses, then discuss the visible choices. Keep private notes out of any shared recap.' },
      { id: 'debrief', kind: 'debrief', title: 'Make the handoff explicit', prompts: ['What protects the customer now?', 'Who needs to agree on ownership?', 'What evidence would show the fix is working?'], tutorNotes: 'Allow four minutes. Compare trade-offs without ranking the people who proposed them.' },
    ],
    interactions: [{ id: 'response', type: 'text', prompt: 'What would your group do first, and why?', responseMode: 'group', display: 'cards', maxLength: 300, timerSec: 60, resultVisibility: 'hidden-until-close' }],
  },
  {
    id: 'team-challenge', name: 'Team challenge', minutes: 10,
    description: 'Design a small experiment and compare one proposal from each group.',
    steps: [
      { id: 'challenge', kind: 'activity', title: 'Design a useful experiment', instructions: ['Choose one recurring problem in your work.', 'Propose a change you can try on a small scale.', 'Agree what you would observe before expanding it.'], materials: ['One real example', 'A spokesperson for your group'], durationSec: 300, tutorNotes: 'Allow five minutes. Assign groups and spokespersons. Keep the experiment specific enough to explain in two sentences.' },
      { id: 'proposal', kind: 'interaction', interactionId: 'proposal', tutorNotes: 'Allow one minute. Each group sends one proposal. Close when ready and compare the proposals.' },
      { id: 'debrief', kind: 'debrief', title: 'Put the proposal to the test', prompts: ['What could we learn from this experiment?', 'What would make us stop or change it?', 'Who needs to help it happen?'], tutorNotes: 'Allow four minutes. Ask another group to name a useful test, not to score the presenters.' },
    ],
    interactions: [{ id: 'proposal', type: 'text', prompt: 'We will try… We will look for…', responseMode: 'group', display: 'cards', maxLength: 300, timerSec: 60, resultVisibility: 'hidden-until-close' }],
  },
  {
    id: 'prioritize-discuss', name: 'Prioritize and discuss', minutes: 8,
    description: 'Compare individual priorities, then choose one practical next step.',
    steps: [
      { id: 'priorities', kind: 'interaction', interactionId: 'priorities', tutorNotes: 'Allow one minute of individual ranking. Close and show the aggregate. Explain that a ranking starts a conversation; it does not make the decision.' },
      { id: 'compare', kind: 'debrief', title: 'Explain the priorities', prompts: ['Where is there a clear shared need?', 'Which priority might the average conceal?', 'What can we realistically improve first?'], tutorNotes: 'Allow four minutes. Invite reasons for low-ranked choices too. Replace the options with your actual alternatives before the session.' },
      { id: 'action', kind: 'interaction', interactionId: 'action', tutorNotes: 'Give groups two minutes to agree and one minute to submit. Close and compare the proposed next steps.' },
    ],
    interactions: [
      { id: 'priorities', type: 'ranking', prompt: 'What would most improve our handoffs?', timerSec: 60, resultVisibility: 'hidden-until-close', options: [{ id: 'owner', label: 'Clear ownership' }, { id: 'context', label: 'Better context' }, { id: 'timing', label: 'Earlier notice' }, { id: 'feedback', label: 'Faster feedback' }] },
      { id: 'action', type: 'text', prompt: 'What is one next step your group recommends?', responseMode: 'group', display: 'cards', maxLength: 200, timerSec: 60, resultVisibility: 'hidden-until-close' },
    ],
  },
  {
    id: 'commitment-recap', name: 'Commitment and recap', minutes: 5,
    description: 'Turn the discussion into a concrete action and a shared takeaway.',
    steps: [
      { id: 'reflect', kind: 'timer', seconds: 60, title: 'Choose an action', body: 'Think of your next opportunity to use what you practised. Choose a step within your control.', placement: 'slide', style: 'ring', tutorNotes: 'Give one minute of quiet thinking. Sharing is voluntary; this is not a manager-visible performance record.' },
      { id: 'commitment', kind: 'interaction', interactionId: 'commitment', tutorNotes: 'Allow one minute. Invite only actions people are comfortable sharing with the room. Close to show responses; do not ask for personal or sensitive detail.' },
      { id: 'recap', kind: 'debrief', title: 'Carry one thing forward', prompts: ['What idea will you use?', 'What support would help?', 'What should our shared recap include?'], tutorNotes: 'Allow three minutes. Agree which takeaways may be shared. Private facilitator notes and individual responses are not the recap.' },
    ],
    interactions: [{ id: 'commitment', type: 'text', prompt: 'Next time I… I will try…', display: 'cards', maxLength: 200, timerSec: 60, resultVisibility: 'hidden-until-close' }],
  },
];
