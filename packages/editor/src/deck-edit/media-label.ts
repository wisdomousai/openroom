/**
 * The first label of an uploaded recording or video, made from its file name.
 * Students see the label as the title of the listening block and in the
 * player's name, so `lesson_3-dialogue.mp3` starts as `lesson 3 dialogue`.
 */
export function mediaLabelFromFileName(name: string): string {
  const label = name.replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return label === '' ? 'Recording' : label;
}
