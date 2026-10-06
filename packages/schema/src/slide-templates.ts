import type { OutlineStep } from './outline-types.js';
import type { Interaction } from './types.js';

export type SlideTemplateCategory = 'Essentials' | 'Language' | 'Questions' | 'Group work';
export interface SlideTemplate {
  id: string;
  name: string;
  description: string;
  category: SlideTemplateCategory;
  step: OutlineStep;
  interaction?: Interaction;
}

/** Editable compositions, shared by every client. IDs are replaced on insertion. */
export const SLIDE_TEMPLATES: readonly SlideTemplate[] = [
  { id: 'title', name: 'Title', description: 'A clear opening and one sentence of context.', category: 'Essentials',
    step: { id: 'slide', kind: 'title', layout: 'title', title: 'A question worth exploring', body: 'Bring your experience. Leave with a new idea.' } },
  { id: 'section', name: 'Section', description: 'Give the next part of your session a clear beginning.', category: 'Essentials',
    step: { id: 'slide', kind: 'title', layout: 'title', title: 'Put the idea into practice', body: 'Part two · Try it together' } },
  { id: 'objectives', name: 'Objectives', description: 'Three concrete things people will learn to do.', category: 'Essentials',
    step: { id: 'slide', kind: 'steps', layout: 'text', title: 'By the end, you can…', items: ['Explain the idea in your own words.', 'Use it in a realistic situation.', 'Choose one thing to try next.'] } },
  { id: 'statement', name: 'Statement', description: 'One idea, with room for it to land.', category: 'Essentials',
    step: { id: 'slide', kind: 'statement', layout: 'title', title: 'Start with the listener', body: 'A clear explanation begins with what the other person needs to understand.' } },
  { id: 'text-image', name: 'Text and image', description: 'An explanation beside a picture you choose.', category: 'Essentials',
    step: { id: 'slide', kind: 'blank', elements: [
      { id: 'heading', type: 'text', role: 'heading', text: 'What do you notice?', box: { x: 8, y: 18, w: 38, h: 20 } },
      { id: 'body', type: 'text', text: 'Describe one detail. Explain what it suggests.', box: { x: 8, y: 42, w: 38, h: 35 } },
      { id: 'picture', type: 'image', alt: 'Choose a picture', box: { x: 54, y: 15, w: 38, h: 70 } },
    ] } },
  { id: 'comparison', name: 'Comparison', description: 'Compare two approaches using the same criteria.', category: 'Essentials',
    step: { id: 'slide', kind: 'cards', layout: 'grid', title: 'Two ways forward', items: [{ label: 'Act now', text: 'Test the idea quickly and learn from a small attempt.' }, { label: 'Investigate first', text: 'Reduce uncertainty before committing more resources.' }] } },
  { id: 'process', name: 'Process', description: 'A sequence people can follow.', category: 'Essentials',
    step: { id: 'slide', kind: 'steps', layout: 'grid', title: 'From question to action', items: ['Describe the situation.', 'Consider two possible responses.', 'Choose a response and explain why.'] } },
  { id: 'cards', name: 'Cards', description: 'Related ideas with equal visual weight.', category: 'Essentials',
    step: { id: 'slide', kind: 'cards', layout: 'grid', title: 'Build a useful explanation', items: [{ label: 'Context', text: 'What does your listener already know?' }, { label: 'Example', text: 'Which real situation makes the idea clear?' }, { label: 'Practice', text: 'How could they try it themselves?' }, { label: 'Check', text: 'What would show they understand?' }] } },
  { id: 'quotation', name: 'Quotation', description: 'A short passage and a question to discuss.', category: 'Essentials',
    step: { id: 'slide', kind: 'statement', layout: 'title', title: 'Read it twice', body: '“I understand the words, but I am not sure what to do next.”', tutorNotes: 'An example learner comment. Ask what information is missing; do not attribute it to a real person.' } },
  { id: 'vocabulary', name: 'Vocabulary', description: 'A word, its meaning, and an example in context.', category: 'Language',
    step: { id: 'slide', kind: 'term', layout: 'text', term: 'pourtant', meaning: 'Introduces a contrast: yet, however.', example: 'Il pleut. Pourtant, nous sortons.', reveal: [['header'], ['body'], ['cell-0']] } },
  { id: 'dialogue', name: 'Dialogue', description: 'Two speakers with language to try aloud.', category: 'Language',
    step: { id: 'slide', kind: 'cards', layout: 'grid', title: 'Demander une précision', items: [{ label: 'A', text: 'Le rendez-vous est reporté à jeudi.' }, { label: 'B', text: 'À la même heure, ou plus tard ?' }], tutorNotes: 'Read together, then change the day and time. Ask each learner to take both roles.' } },
  { id: 'grammar', name: 'Grammar', description: 'A pattern, examples, and a short explanation.', category: 'Language',
    step: { id: 'slide', kind: 'cards', layout: 'grid', title: 'weil: the verb goes last', items: [{ label: 'Main clause', text: 'Ich bleibe zu Hause.' }, { label: 'Reason', text: '… weil ich heute arbeiten muss.' }], tutorNotes: 'Ask learners to find the verbs, then give another reason. Reveal the second example after they predict the word order.', reveal: [['header'], ['cell-0'], ['cell-1']] } },
  { id: 'reading', name: 'Reading', description: 'A short passage with a focused reading purpose.', category: 'Language',
    step: { id: 'slide', kind: 'statement', layout: 'text', title: 'Un changement de programme', body: 'Léa voulait visiter le musée samedi. Il était fermé, alors elle est allée au marché. Elle y a retrouvé une amie et elles ont déjeuné ensemble.', tutorNotes: 'First reading: where did Léa go? Second reading: why did her plans change? Invite a retelling before discussing individual words.' } },
  { id: 'listening', name: 'Listening', description: 'A purpose for listening before you play or read a clip.', category: 'Language',
    step: { id: 'slide', kind: 'activity', layout: 'split', title: 'Listen for the change', instructions: ['First listen: what changed?', 'Listen again: write the new day and time.', 'Compare what you heard with a partner.'], media: { type: 'audio', url: 'https://local.openroom.invalid/openroom-pending-audio', alt: 'A change of appointment', listening: { mode: 'room', transcript: 'Der Termin am Dienstag fällt aus. Wir treffen uns stattdessen am Donnerstag um halb zehn.' } }, tutorNotes: 'Choose your recording in the Audio pane, or read the private transcript twice. Keep the transcript hidden for the first listen, then reveal it to check details.' } },
  { id: 'role-play', name: 'Role-play', description: 'Two different purposes for a realistic conversation.', category: 'Language',
    step: { id: 'slide', kind: 'cards', layout: 'grid', title: 'Change a reservation', items: [{ label: 'Guest', text: 'You booked for two people. Ask to bring one more person and arrive later.' }, { label: 'Reception', text: 'The later time is full. Offer an earlier time or another day.' }], tutorNotes: 'Use the target language. Swap roles, then repeat with one detail changed.' } },
  { id: 'choice', name: 'Choice', description: 'Ask, collect answers, and reveal the reasoning.', category: 'Questions',
    step: { id: 'slide', kind: 'interaction', layout: 'poll', interactionId: 'activity' },
    interaction: { id: 'activity', type: 'choice', prompt: 'Which reply invites a useful explanation?', options: [{ id: 'a', label: 'Can you give me an example?', correct: true }, { id: 'b', label: 'You are wrong.' }, { id: 'c', label: 'It does not matter.' }] } },
  { id: 'confidence', name: 'Confidence', description: 'Check how ready people feel to use an idea.', category: 'Questions',
    step: { id: 'slide', kind: 'interaction', layout: 'poll', interactionId: 'activity' },
    interaction: { id: 'activity', type: 'scale', prompt: 'How confident are you about trying this?', min: 1, max: 5, minLabel: 'I need more practice', maxLabel: 'Ready to try' } },
  { id: 'ranking', name: 'Ranking', description: 'Compare priorities and discuss the differences.', category: 'Questions',
    step: { id: 'slide', kind: 'interaction', layout: 'poll', interactionId: 'activity' },
    interaction: { id: 'activity', type: 'ranking', prompt: 'What would help most? Rank your priorities.', options: [{ id: 'example', label: 'A worked example' }, { id: 'practice', label: 'Time to practise' }, { id: 'feedback', label: 'Specific feedback' }] } },
  { id: 'open-response', name: 'Open response', description: 'Collect a short idea in participants’ own words.', category: 'Questions',
    step: { id: 'slide', kind: 'interaction', layout: 'poll', interactionId: 'activity' },
    interaction: { id: 'activity', type: 'text', prompt: 'What is one thing you would like to understand better?', display: 'cards', maxLength: 200 } },
  { id: 'fill-gaps', name: 'Fill the gaps', description: 'Practise a language pattern, then reveal accepted answers.', category: 'Questions',
    step: { id: 'slide', kind: 'interaction', layout: 'poll', interactionId: 'activity' },
    interaction: { id: 'activity', type: 'fill-the-gaps', prompt: 'Je {{verb}} un café, s’il vous plaît.', gaps: [{ id: 'verb', answers: ['voudrais'] }], match: { locale: 'fr', accents: 'require', punctuation: 'strip' } } },
  { id: 'matching', name: 'Matching', description: 'Connect words and meanings before the reveal.', category: 'Questions',
    step: { id: 'slide', kind: 'interaction', layout: 'poll', interactionId: 'activity' },
    interaction: { id: 'activity', type: 'match', prompt: 'Match each phrase to its purpose.', left: [{ id: 'clarify', label: 'Könnten Sie das erklären?' }, { id: 'thank', label: 'Vielen Dank für Ihre Hilfe.' }], right: [{ id: 'help', label: 'Ask for clarification' }, { id: 'thanks', label: 'Thank someone' }], correct: { clarify: 'help', thank: 'thanks' } } },
  { id: 'group-task', name: 'Group task', description: 'A shared task, a tangible response, and a debrief.', category: 'Group work',
    step: { id: 'slide', kind: 'activity', layout: 'activity', title: 'Choose a response', instructions: ['Compare two possible responses to the situation.', 'Agree on one and write your reason.', 'Ask one person to share your decision.'], materials: ['The situation', 'Two possible responses'], durationSec: 300, tutorNotes: 'Ask what evidence changed the group’s mind. Invite a different view before moving on.' } },
  { id: 'timed-discussion', name: 'Timed discussion', description: 'Make thinking time explicit; start the clock when ready.', category: 'Group work',
    step: { id: 'slide', kind: 'timer', layout: 'timer', seconds: 120, title: 'Think, then compare', body: 'Choose one example. Explain it to a partner.', style: 'ring', placement: 'slide', persist: false } },
  { id: 'recap', name: 'Recap and next steps', description: 'Name what changed and choose a useful next action.', category: 'Group work',
    step: { id: 'slide', kind: 'debrief', layout: 'text', title: 'Take it into practice', prompts: ['What can you explain or do now?', 'Where will you use it?', 'What would you like to practise next?'] } },
];
