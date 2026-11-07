-- Terminology: the details object of a student (level, goals, notes, ...) is the student's "profile".
-- Column students.student_json -> students.profile_json. The JSON inside is unchanged: no key there
-- carried the old name.
ALTER TABLE `students` RENAME COLUMN `student_json` TO `profile_json`;
