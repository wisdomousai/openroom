/**
 * The sentence Desktop shows when a `.openroom` file cannot be opened.
 *
 * A file can fail at three points: the disk (missing, not readable), the ZIP
 * package (damaged, or another kind of file renamed), and the deck inside it
 * (a newer file version, or an outline this build cannot read). The tutor
 * needs to know which, not the library's error text.
 */
export function openFailureReason(cause: unknown): string {
  const code = typeof cause === 'object' && cause !== null && 'code' in cause ? String((cause as { code: unknown }).code) : '';
  const message = cause instanceof Error ? cause.message : String(cause);
  if (code === 'ENOENT' && message.includes('deck.yaml')) return 'The file holds no OpenRoom deck.';
  if (code === 'ENOENT') return 'The file is no longer there.';
  if (code === 'EACCES' || code === 'EPERM') return 'OpenRoom is not allowed to read this file.';
  if (code === 'EISDIR') return 'This is a folder, not an OpenRoom file.';
  if (message.includes('unsupported OpenRoom file version')) {
    return 'The file was saved by a newer version of OpenRoom. Update OpenRoom to open it.';
  }
  // yauzl (through extract-zip) reports a file that is not a ZIP, or a cut-off one, this way.
  if (/central directory|local file header|signature|end of file|EOF|zip/i.test(message)) {
    return 'The file is damaged or is not an OpenRoom deck.';
  }
  if (message.startsWith('/')) return `The deck in the file is not valid: ${message}`;
  return message === '' ? 'The file could not be read.' : message;
}
