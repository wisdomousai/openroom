export * from './types.js';
export * from './outline-types.js';
export { isPresentationPosition, type PresentationPosition } from './presentation-position.js';
export { parseHomeworkAudience, homeworkForLearner, type HomeworkAudience } from './homework-audience.js';
export { VOICE_SAMPLE_RATE, VOICE_MAX_SECONDS, VOICE_SOURCE_MAX_BYTES, VOICE_WAV_MAX_BYTES, VOICE_RETENTION_DAYS, VOICE_TRASH_DAYS, VOICE_MAX_RECORDINGS_PER_TASK, encodeVoiceWav, voiceWavDuration } from './voice-audio.js';
export { parseLearnerFeedback, type LearnerFeedback, type LearnerCorrection, type AudioComment } from './learner-feedback.js';
export { assessHomework, initialHomeworkAnswer, parseHomeworkPracticeAnswer, type HomeworkAssessment, type HomeworkPracticeAnswer, type HomeworkPracticeInteraction } from './homework-practice.js';
export {
  DISPLAY_STYLES,
  displaysFor,
  SESSION_SCHEMA_ID,
  DEFAULT_TEXT_MAX_LENGTH,
  TEXT_MAX_LENGTH_CAP,
  MAX_CORRECT_ANSWERS,
  MIN_OPTIONS,
  MAX_OPTIONS,
  MIN_RANKING_OPTIONS,
  MAX_RANKING_OPTIONS,
  MIN_FILL_THE_GAPS_GAPS,
  MAX_FILL_THE_GAPS_GAPS,
  MIN_SCALE_SPAN,
  MAX_SCALE_SPAN,
  defaultDisplay,
  sessionSchema,
} from './schema.js';
export { OUTLINE_SCHEMA_ID, outlineSchema } from './outline-schema.js';
export {
  asCompiledOutline,
  compileOutline,
  compileToOutline,
  isOutlineDocument,
  outlineFromSession,
  parseOutline,
  parseStartOutline,
  projectOutlineStep,
  projectOutlineSteps,
  toSession,
  validateOutline,
} from './outline.js';
export {
  HOMEWORK_QUIZ_TYPES,
  HOMEWORK_TASK_MAX,
  NEXT_NOTE_MAX,
  WRITING_BODY_MAX,
  clipNextNote,
  compileRecordHomework,
  homeworkItemId,
  homeworkTasksOf,
  isHomeworkQuizType,
  isPublishedHomeworkTask,
  legacyHomeworkTasks,
  parseHomeworkItemId,
  projectHomeworkInteraction,
  publishedHomeworkOf,
  snapshotHomework,
  snapshotHomeworkTask,
  type HomeworkQuizType,
  type PublishedHomeworkTask,
  type PublishedQuizInteraction,
} from './homework.js';
export {
  LAYOUTS_FOR_KIND,
  OUTLINE_LAYOUTS,
  clampMediaSize,
  defaultMediaPlace,
  kindCanCarryElements,
  kindCanCarryPicture,
  layoutAllowedForKind,
  layoutForMediaPlace,
  partKeysForStep,
  partSpansTarget,
  partValue,
  resolveMediaPlace,
  resolveMediaSize,
  resolveRevealOrder,
  revealIssues,
  SLOT_SPANS_FOR_KIND,
  stepElements,
  stepPicture,
  type RevealIssue,
  type SlotSpansTarget,
} from './outline-parts.js';
export {
  cssLooksUnsafe,
  elementMarkupIssue,
  htmlLooksUnsafe,
  sanitizeElementCss,
  sanitizeElementHtml,
} from './element-html.js';
export { MARKDOWN_OUTPUT_TAGS, escapeHtmlText, renderMarkdownToHtml } from './element-markdown.js';
export { iframeUrlIssue, pdfUrlIssue } from './element-iframe.js';
export { validateSession, parseSession } from './validate.js';
export {
  DEPRECATED_OUTLINE_STEP_KEYS,
  normalizeSession,
  stripDeprecatedOutlineFields,
} from './normalize.js';
export { participantView, projectInteraction } from './participant-view.js';
export { normalizeTextAnswer, textAnswerMatches } from './text-match.js';
export {
  FILL_THE_GAPS_GAP_STARTER_ANSWER,
  fillTheGapsGapIssue,
  fillTheGapsPlaceholderIds,
  fillTheGapsPlaceholderPattern,
  fillTheGapsPromptText,
  commitFillTheGapsPrompt,
  gapsForFillTheGapsPrompt,
  gradeFillTheGaps,
  gradeMatch,
  splitFillTheGapsPrompt,
  fillTheGapsGapOptions,
  fillTheGapsBankWords,
  insertFillTheGapsRange,
  removeFillTheGapsGap,
  seededShuffle,
  type FillTheGapsGapDraft,
  type FillTheGapsGapGrade,
  type FillTheGapsGrade,
  type FillTheGapsGrading,
  type FillTheGapsToken,
  type MatchGrade,
  type MatchPairGrade,
} from './fill-the-gaps-match.js';
export {
  DISPLAY_OPTION_KEYS,
  DISPLAY_OPTION_KEYS_FOR,
  normalizeDisplayOptions,
  validateDisplayOptionsShape,
  type DisplayOptionKey,
  type DisplayOptionsIssue,
} from './display-options.js';
export {
  compileSimpleSession,
  isSimpleSession,
  type SimpleSession,
  type SimpleQuestion,
  type SimpleQuestionType,
} from './simple-session.js';
export {
  OPENROOM_FILE_FORMAT,
  OPENROOM_FILE_VERSION,
  OPENROOM_PDF_SOURCE_MAX_BYTES,
  OPENROOM_RESOURCE_CONTENT_TYPES,
  OPENROOM_RESOURCE_MAX_BYTES,
  OPENROOM_RESOURCE_MAX_COUNT,
  OPENROOM_RESOURCE_TOTAL_MAX_BYTES,
  canonicalOutlineJson,
  canonicalJson,
  editableOutlineForOpenRoomFile,
  embeddedOutlineForOpenRoomFile,
  materializeOpenRoomFile,
  mergeOutlines,
  outlineContentHash,
  outlineResourceIds,
  parseOpenRoomFile,
  stringifyOpenRoomFile,
  updateOpenRoomFileOutline,
  type OpenRoomFileMaterializeResult,
  type OpenRoomFileParseResult,
  type OpenRoomFileResourceV1,
  type OpenRoomFileV1,
  type OpenRoomOnlineResource,
  type OpenRoomResourceContentType,
  type OpenRoomRemoteLinkV1,
  type OutlineMergeConflict,
  type OutlineMergeResult,
} from './openroom-file.js';
export { isTutoringApiPath, TUTORING_API_PATH_PATTERN } from './tutoring-paths.js';
export {
  CONTEXT_KINDS,
  DECK_DRAFT_MAX_CHARS,
  DECK_SHAPES,
  MEDIA_ASSET_MAX_BYTES,
  MEDIA_ASSET_VIDEO_TYPES,
  SESSION_STATUSES,
  SESSION_STATUSES_CLIENT_WRITABLE,
  isMediaAssetContentType,
  mediaAssetPath,
  type ContextKind,
  type MediaAssetListResponse,
  type MediaAssetSummary,
  type MediaAssetUploadResponse,
  type DeckDraftRequest,
  type DeckDraftResponse,
  type DeckDraftSavedResponse,
  type DeckShape,
  type SessionStatus,
} from './tutoring-contracts.js';
export {
  buildSections,
  cleanForms,
  headwordLabels,
  parseDictionaryEntry,
  MAX_ENTRY_BYTES,
  MAX_FORM_CHARS,
  MAX_GLOSS_CHARS,
  MAX_SECTIONS,
  MAX_SECTION_COLUMNS,
  MAX_SECTION_ROWS,
  MAX_SENSES,
  type DictionaryEntry,
  type DictionarySense,
  type FormRow,
  type FormSection,
  type RawForm,
} from './dictionary.js';
export {
  DICTIONARY_ROOTS,
  MEANING_EDITIONS,
  NATIVE_LANGUAGES,
  TAUGHT_LANGUAGES,
  isSupportedPair,
  isTaughtLanguage,
  meaningEdition,
  nativeNeedsEdition,
  taughtLanguagesFor,
  type LanguageChoice,
  type SpaceLanguages,
} from './languages.js';
export {
  WORKSPACE_EXPERIENCES,
  isWorkspaceExperience,
  parseSpaceSettings,
  readSpaceSettings,
  type SpaceSettings,
  type WorkspaceExperience,
} from './space-settings.js';
export * from './deck-design.js';
export * from './outline-resources.js';
export * from './resource-content.js';
export * from './slide-templates.js';
export * from './workshop-sequences.js';
export * from './session-recap.js';
export * from './saved-results.js';

export { validateBrandKit, brandPaletteIssues, colorContrast, type BrandKit, type BrandKitDocument, type ContrastIssue } from './brand-kit.js';

export * from './presentation-composition.js';
export * from './slide-embed.js';
export { FREE_SESSION_PARTICIPANT_LIMIT } from './session-limits.js';
