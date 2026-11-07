import type { WorkspaceExperience } from '@openroom/schema';

/** Navigation and first actions only. Document tools and authorization never read this. */
export const EXPERIENCES: Record<WorkspaceExperience, {
  label: string;
  description: string;
  studentLabel: string | null;
  addStudentLabel: string | null;
  starterTitle: string;
}> = {
  tutoring: {
    label: 'Tutoring',
    description: 'Language lessons, students, practice and feedback.',
    studentLabel: 'Students',
    addStudentLabel: 'Add student or group',
    starterTitle: 'French · At the café',
  },
  classroom: {
    label: 'Classroom',
    description: 'Lessons, class questions and discussion.',
    studentLabel: 'Classes',
    addStudentLabel: 'Add class',
    starterTitle: 'Science · What plants need',
  },
  training: {
    label: 'Training',
    description: 'Workshops, group decisions and facilitation.',
    studentLabel: null,
    addStudentLabel: null,
    starterTitle: 'Workshop · Make a decision',
  },
};
