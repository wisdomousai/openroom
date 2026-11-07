/**
 * Installs the local OpenRoom manifests into PowerPoint for Mac.
 *
 * Usage: bun run office:addin   (with `bun run dev:office` running, or after it ran once)
 *
 * macOS protects PowerPoint's container from writes by other apps (Operation not
 * permitted). When the direct copy is refused, the command hands the copy to a small
 * helper app, "OpenRoom Add-in Installer", in ~/Library/Application Support/OpenRoom.
 * The helper does one thing: it copies the two manifests from its sibling `manifests`
 * folder into PowerPoint's add-in folder. Give that app Full Disk Access once, and the
 * terminal needs none. The helper is built on first use and rebuilt only when its
 * script changes; a rebuilt helper has to be granted again.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { get } from 'node:https';
import { homedir, tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const wefFolder = resolve(homedir(), 'Library/Containers/com.microsoft.Powerpoint/Data/Documents/wef');
export const manifestFiles = ['openroom-taskpane.xml', 'openroom-display.xml'];
export const helperFolder = resolve(homedir(), 'Library/Application Support/OpenRoom');
export const helperApp = resolve(helperFolder, 'OpenRoom Add-in Installer.app');
const helperManifests = resolve(helperFolder, 'manifests');
const helperResult = resolve(helperManifests, 'result.txt');
const helperVersionFile = resolve(helperFolder, 'installer-version');

// The helper reads nothing from the command that starts it: the source is the folder
// next to the app and the destination is PowerPoint's add-in folder in this account.
const helperScript = `on run
  set here to do shell script "dirname " & quoted form of POSIX path of (path to me)
  set source to here & "/manifests/"
  set destination to (POSIX path of (path to home folder)) & "Library/Containers/com.microsoft.Powerpoint/Data/Documents/wef/"
  try
    do shell script "mkdir -p " & quoted form of destination & " && cp " & quoted form of (source & "openroom-taskpane.xml") & " " & quoted form of (source & "openroom-display.xml") & " " & quoted form of destination
    do shell script "printf ok > " & quoted form of (source & "result.txt")
  on error message
    do shell script "printf %s " & quoted form of message & " > " & quoted form of (source & "result.txt")
  end try
end run
`;
const helperVersion = createHash('sha256').update(helperScript).digest('hex').slice(0, 16);

const run = (command, args) => new Promise((accept, reject) => {
  execFile(command, args, (error, stdout, stderr) => { if (error) reject(new Error(stderr.trim() || error.message)); else accept(stdout); });
});

async function ensureHelper() {
  const current = await readFile(helperVersionFile, 'utf8').catch(() => '');
  try { await readFile(resolve(helperApp, 'Contents/Info.plist')); if (current.trim() === helperVersion) return false; } catch {}
  await mkdir(helperFolder, { recursive: true });
  await rm(helperApp, { recursive: true, force: true });
  const source = resolve(tmpdir(), `openroom-installer-${process.pid}.applescript`);
  await writeFile(source, helperScript);
  try { await run('osacompile', ['-o', helperApp, source]); } finally { await rm(source, { force: true }); }
  // No Dock icon while it copies; re-sign after changing Info.plist so the signature stays valid.
  await run('plutil', ['-replace', 'LSUIElement', '-bool', 'true', resolve(helperApp, 'Contents/Info.plist')]);
  await run('codesign', ['--force', '--deep', '--sign', '-', helperApp]);
  await writeFile(helperVersionFile, `${helperVersion}\n`);
  return true;
}

async function helperCopy(sources) {
  const rebuilt = await ensureHelper();
  await mkdir(helperManifests, { recursive: true });
  for (const [index, source] of sources.entries()) await copyFile(source, resolve(helperManifests, manifestFiles[index]));
  await rm(helperResult, { force: true });
  await run('open', ['-W', helperApp]);
  const result = (await readFile(helperResult, 'utf8').catch(() => 'The installer did not report a result.')).trim();
  if (result !== 'ok') {
    const refused = new Error(`macOS refused OpenRoom Add-in Installer access to PowerPoint's add-in folder (${result.split('\n').at(-1)}).`);
    refused.code = 'OPENROOM_INSTALL_REFUSED';
    refused.rebuilt = rebuilt;
    throw refused;
  }
}

/** Copies the manifests into PowerPoint's add-in folder. Returns how it copied them. */
export async function installManifests(sourceDir, destination = wefFolder) {
  if (process.platform !== 'darwin') throw new Error('Automatic installation supports PowerPoint for Mac. See apps/office/README.md for other platforms.');
  const sources = manifestFiles.map((name) => resolve(sourceDir, name));
  try {
    await mkdir(destination, { recursive: true });
    for (const [index, source] of sources.entries()) await copyFile(source, resolve(destination, manifestFiles[index]));
    return 'direct';
  } catch (error) {
    if (error.code !== 'EPERM' && error.code !== 'EACCES') throw error;
  }
  // The helper always writes to the real add-in folder, so it only stands in for that one.
  if (destination !== wefFolder) throw new Error(`macOS refused the copy into ${destination}.`);
  await helperCopy(sources);
  return 'helper';
}

/** Opens Full Disk Access in System Settings and shows the helper in Finder. */
export async function showHelperGrant() {
  await run('open', ['x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles']).catch(() => {});
  await run('open', ['-R', helperApp]).catch(() => {});
  return [
    'Give the helper access once:',
    '  System Settings > Privacy & Security > Full Disk Access, turn on "OpenRoom Add-in Installer".',
    '  If it is not listed, click +, and choose it in the Finder window that just opened:',
    `  ${helperApp}`,
    'Then run bun run office:addin again. Only that app gets access; the terminal does not.',
  ].join('\n');
}

async function fetchManifest(origin, path, ca) {
  return new Promise((accept, reject) => {
    const request = get(`${origin}${path}`, { ca, family: 4, timeout: 3000 }, (response) => {
      if (response.statusCode !== 200) { response.resume(); reject(new Error(`${path}: HTTP ${response.statusCode}`)); return; }
      let body = ''; response.setEncoding('utf8');
      response.on('data', (part) => { body += part; }); response.on('end', () => accept(body)); response.on('error', reject);
    });
    request.once('error', reject);
    request.once('timeout', () => request.destroy(new Error('Local HTTPS request timed out')));
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const sourceDir = resolve(root, '.wrangler/office/manifests');
  const origin = 'https://localhost:3443';
  // Prefer fresh manifests from the running local server; fall back to the last written ones.
  try {
    const ca = await readFile(resolve(homedir(), '.office-addin-dev-certs/ca.crt'));
    await mkdir(sourceDir, { recursive: true });
    await writeFile(resolve(sourceDir, 'openroom-taskpane.xml'), await fetchManifest(origin, '/office/manifest.xml', ca));
    await writeFile(resolve(sourceDir, 'openroom-display.xml'), await fetchManifest(origin, '/office/content-manifest.xml', ca));
  } catch {
    console.warn(`The local server at ${origin} did not answer. Installing the manifests from the last bun run dev:office.`);
  }
  try {
    for (const name of manifestFiles) await readFile(resolve(sourceDir, name));
  } catch {
    console.error('No manifests found. Run bun run dev:office first.');
    process.exit(1);
  }
  let how;
  try {
    how = await installManifests(sourceDir);
  } catch (error) {
    if (error.code !== 'OPENROOM_INSTALL_REFUSED') throw error;
    console.error(error.message);
    console.log(await showHelperGrant());
    process.exit(1);
  }
  console.log(`Installed ${manifestFiles.join(' and ')} in PowerPoint's add-in folder${how === 'helper' ? ' (copied by OpenRoom Add-in Installer)' : ''}.`);
  console.log('Quit and reopen PowerPoint, then choose Home > Add-ins > OpenRoom (task pane) or OpenRoom Slide (embedded slide).');
}
