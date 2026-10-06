import type { WorkspaceExperience } from '@openroom/schema';

/** Navigation and first actions only. Document tools and authorization never read this. */
export const EXPERIENCES: Record<WorkspaceExperience, {
  label: string;
  description: string;
  contextLabel: string | null;
  addContextLabel: string | null;
  starterTitle: string;
}> = {
  tutoring: {
    label: 'Tutoring',
    description: 'Language lessons, students, practice and feedback.',
    contextLabel: 'Students',
    addContextLabel: 'Add student or group',
    starterTitle: 'French · At the café',
  },
  classroom: {
    label: 'Classroom',
    description: 'Lessons, class questions and discussion.',
    contextLabel: 'Classes',
    addContextLabel: 'Add class',
    starterTitle: 'Science · What plants need',
  },
  training: {
    label: 'Training',
    description: 'Workshops, group decisions and facilitation.',
    contextLabel: null,
    addContextLabel: null,
    starterTitle: 'Workshop · Make a decision',
  },
};
