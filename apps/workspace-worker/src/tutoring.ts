import { handleBrandKits } from './brand-kits.js';
import { startDeckRoute } from './deck-start.js';
/**
 * Students control plane plus the shared tutoring router and the
 * browser-confirmed permanent-deletion flow.
 *
 * Students are durable "who is this for?" records (person, group, class, event).
 * Decks (versioned content) and sessions (delivery instances) live in delivery.ts;
 * launch compiles into the Session runtime contract (Durable Object).
 */
import { STUDENT_KINDS, isWorkspaceExperience } from '@openroom/schema';

import { sha256Hex } from './api-tokens.js';
import { getSession, json, type ControlEnv, type SessionUser } from './auth.js';
import { requireControlUser } from './control-auth.js';
import {
  listStudentLinksRoute,
  listStudentLearnersRoute,
  mintStudentLinkRoute,
  revokeStudentLinkRoute,
} from './student-links.js';
import { studentReturnedRoute } from './learner-practice.js';
import { studentWorkRoute } from './learner-work.js';
import { deleteLearnerAudioPermanently } from './learner-audio.js';
import { dictionaryRoute } from './dictionary-route.js';
import { embedCheckRoute, embedImportRoute } from './embed-route.js';
import { lookupRoute } from './lookup.js';
import { stockRoute } from './stock.js';
import { ownerHasContinuity, spaceOwnerId } from './continuity-access.js';
import { roleAtLeast, spaceRole } from './members.js';
import {
  DELETION_INTENT_TTL_MS,
  studentOfSpace,
  linkStudent,
  memberOfSpace,
  parseJson,
  plainObject,
  randomId,
  randomToken,
  readJson,
} from './control-utils.js';
import { confirmFolderDeletion, ensureWorkspace, folderKeepsLiveDecks, spaceSettings } from './workspace.js';
import {
  confirmDeliveryDeletion,
  createDeliveryDeletionIntentRoute,
  deckDraftRoute,
  deckFileLinkRoute,
  deckFileLocationRoute,
  deckItemRoute,
  deckVersionsRoute,
  decksCollectionRoute,
  launchSessionRoute,
  restoreDeckRoute,
  restoreSessionRoute,
  deleteDeckPermanently,
  sessionItemRoute,
  sessionRecordRoute,
  sessionsCollectionRoute,
  type SessionLauncher,
} from './delivery/index.js';

export { DELETION_INTENT_TTL_MS };

type ResourceType = 'student' | 'deck' | 'session' | 'folder';

const STUDENT_KIND_SET: ReadonlySet<string> = new Set(STUDENT_KINDS);

interface StudentRow {
  id: string;
  space_id: string;
  created_by: string;
  kind: string;
  display_name: string;
  profile_json: string;
  next_note: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

async function studentAccess(
  env: ControlEnv,
  userId: string,
  studentId: string,
): Promise<StudentRow | null> {
  return env.DB.prepare(
    `SELECT c.* FROM students c
      JOIN space_members m ON m.space_id = c.space_id AND m.user_id = ?2
     WHERE c.id = ?1`,
  )
    .bind(studentId, userId)
    .first<StudentRow>();
}

/** Changing, trashing or deleting a student needs `editor` on its space; reads need membership. */
async function studentEditable(env: ControlEnv, user: SessionUser, spaceId: string): Promise<boolean> {
  const access = await spaceRole(env, user, spaceId);
  return access !== null && roleAtLeast(access.role, 'editor');
}

/**
 * The student itself is free. Its "for next time" sticky is written from Notes,
 * so it is shown only while the space owner holds `continuity`; it is retained,
 * not cleared, and returns with access.
 */
function studentJson(row: StudentRow, includeProfile = true, withNextNote = true): Record<string, unknown> {
  const nextNote = withNextNote && typeof row.next_note === 'string' ? row.next_note : '';
  return {
    id: row.id,
    spaceId: row.space_id,
    kind: row.kind,
    displayName: row.display_name,
    ...(includeProfile ? { profile: parseJson(row.profile_json, {}) } : {}),
    ...(nextNote !== '' ? { nextNote } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function parseKind(value: unknown, fallback = 'person'): string {
  return typeof value === 'string' && STUDENT_KIND_SET.has(value) ? value : fallback;
}


export async function studentsCollectionRoute(
  request: Request,
  env: ControlEnv,
  url: URL,
): Promise<Response> {
  const mutating = request.method === 'POST';
  const guard = await requireControlUser(request, env, mutating);
  if (!guard.ok) return guard.response;

  if (request.method === 'GET') {
    await ensureWorkspace(env, guard.user);
    const trashed = url.searchParams.get('trash') === '1';
    const spaceId = url.searchParams.get('spaceId');
    const kind = url.searchParams.get('kind');
    const binds: (string | number)[] = [guard.user.id];
    let where = trashed ? 'c.deleted_at IS NOT NULL' : 'c.deleted_at IS NULL';
    let next = 2;
    if (spaceId !== null) {
      where += ` AND c.space_id = ?${next}`;
      binds.push(spaceId);
      next += 1;
    }
    if (kind !== null && STUDENT_KIND_SET.has(kind)) {
      where += ` AND c.kind = ?${next}`;
      binds.push(kind);
    }
    const { results } = await env.DB.prepare(
      `SELECT c.*, s.owner_user_id AS owner_user_id FROM students c
        JOIN space_members m ON m.space_id = c.space_id AND m.user_id = ?1
        JOIN spaces s ON s.id = c.space_id
       WHERE ${where}
       ORDER BY c.updated_at DESC LIMIT 500`,
    )
      .bind(...binds)
      .all<StudentRow & { owner_user_id: string }>();
    const rows = results ?? [];
    const continuity = new Map<string, boolean>();
    for (const owner of new Set(rows.filter((row) => row.next_note).map((row) => row.owner_user_id))) {
      continuity.set(owner, await ownerHasContinuity(env, owner));
    }
    return json({ students: rows.map((row) => studentJson(row, false, continuity.get(row.owner_user_id) === true)) });
  }

  if (request.method !== 'POST') return json({ error: 'method-not-allowed' }, 405);
  const body = await readJson(request);
  if (body === null) return json({ error: 'invalid-json' }, 400);
  const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
  if (displayName === '') return json({ error: 'display-name-required' }, 422);
  const profile = body.profile === undefined ? {} : plainObject(body.profile);
  if (profile === null) return json({ error: 'profile-must-be-object' }, 422);
  const serializedProfile = JSON.stringify(profile);
  if (serializedProfile.length > 100_000) return json({ error: 'profile-too-large' }, 413);
  const kind = parseKind(body.kind);
  const id = randomId();
  const now = Date.now();

  /*
   * A space holds one student, so a new student brings its own space unless the
   * caller names an empty one. It used to fall back to the caller's home space,
   * which put every person a tutor added into the same one — and with the
   * language pair living on the space, that meant one language for everybody.
   */
  const home = await ensureWorkspace(env, guard.user, now);
  if ('experience' in body && !isWorkspaceExperience(body.experience)) {
    return json({ error: 'invalid-experience' }, 422);
  }
  const sourceSpaceId = typeof body.sourceSpaceId === 'string' && body.sourceSpaceId !== ''
    ? body.sourceSpaceId : home.spaceId;
  if (!(await memberOfSpace(env, guard.user.id, sourceSpaceId))) return json({ error: 'not-found' }, 404);
  let spaceId: string;
  if (typeof body.spaceId === 'string' && body.spaceId !== '') {
    if (!(await memberOfSpace(env, guard.user.id, body.spaceId))) {
      return json({ error: 'not-found' }, 404);
    }
    /*
     * The link is the reservation, and it survives trashing: a space whose
     * student is in the trash stays that person's, so a restore always has
     * somewhere to land.
     */
    if ((await studentOfSpace(env, body.spaceId)) !== null) {
      return json({ error: 'space-has-student' }, 409);
    }
    spaceId = body.spaceId;
  } else {
    spaceId = `sp_ctx_${id}`;
    const settings = await spaceSettings(env, sourceSpaceId);
    settings.experience = isWorkspaceExperience(body.experience) ? body.experience : 'tutoring';
    // Inherit the chosen place's language pair; the new person's folder remains
    // a separate sharing boundary, with its own explicit experience.
    await env.DB.prepare(
      `INSERT INTO spaces (id, owner_user_id, name, created_at, updated_at, settings)
       VALUES (?1, ?2, ?3, ?4, ?4, ?5)`,
    )
      .bind(spaceId, guard.user.id, displayName.slice(0, 200), now, JSON.stringify(settings))
      .run();
    await env.DB.prepare(
      `INSERT INTO space_members (space_id, user_id, role, invited_by, created_at)
       VALUES (?1, ?2, 'owner', NULL, ?3)`,
    )
      .bind(spaceId, guard.user.id, now)
      .run();
  }

  await env.DB.prepare(
    `INSERT INTO students
       (id, space_id, created_by, kind, display_name, profile_json, created_at, updated_at, deleted_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, NULL)`,
  )
    .bind(id, spaceId, guard.user.id, kind, displayName.slice(0, 200), serializedProfile, now)
    .run();
  await linkStudent(env, spaceId, id, now);
  const row = await studentAccess(env, guard.user.id, id);
  return json({ student: studentJson(row!) }, 201);
}


export async function studentItemRoute(
  request: Request,
  env: ControlEnv,
  studentId: string,
): Promise<Response> {
  const mutating = request.method !== 'GET';
  const guard = await requireControlUser(request, env, mutating);
  if (!guard.ok) return guard.response;
  const row = await studentAccess(env, guard.user.id, studentId);
  if (row === null) return json({ error: 'not-found' }, 404);

  const withNextNote = async () => row.next_note !== '' && (await ownerHasContinuity(env, await spaceOwnerId(env, row.space_id)));

  if (request.method === 'GET') return json({ student: studentJson(row, true, await withNextNote()) });
  if (!(await studentEditable(env, guard.user, row.space_id))) return json({ error: 'forbidden' }, 403);

  if (request.method === 'DELETE') {
    if (row.deleted_at === null) {
      const now = Date.now();
      await env.DB.prepare('UPDATE students SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2')
        .bind(now, studentId)
        .run();
    }
    return json({ ok: true, recoverable: true });
  }
  if (request.method !== 'PATCH') return json({ error: 'method-not-allowed' }, 405);
  if (row.deleted_at !== null) return json({ error: 'resource-in-trash' }, 409);
  const body = await readJson(request);
  if (body === null) return json({ error: 'invalid-json' }, 400);
  const displayName = body.displayName === undefined
    ? row.display_name
    : typeof body.displayName === 'string'
      ? body.displayName.trim().slice(0, 200)
      : '';
  if (displayName === '') return json({ error: 'display-name-required' }, 422);
  const currentProfile = parseJson(row.profile_json, {});
  const profile = body.profile === undefined ? currentProfile : plainObject(body.profile);
  if (profile === null) return json({ error: 'profile-must-be-object' }, 422);
  const serialized = JSON.stringify(profile);
  if (serialized.length > 100_000) return json({ error: 'profile-too-large' }, 413);
  const kind = body.kind === undefined ? row.kind : parseKind(body.kind, row.kind);
  const now = Date.now();
  await env.DB.prepare(
    'UPDATE students SET display_name = ?1, profile_json = ?2, kind = ?3, updated_at = ?4 WHERE id = ?5',
  )
    .bind(displayName, serialized, kind, now, studentId)
    .run();
  const payload = studentJson({
    ...row,
    display_name: displayName,
    profile_json: serialized,
    kind,
    updated_at: now,
  }, true, await withNextNote());
  return json({ student: payload });
}

export async function restoreStudentRoute(
  request: Request,
  env: ControlEnv,
  studentId: string,
): Promise<Response> {
  const guard = await requireControlUser(request, env, true);
  if (!guard.ok) return guard.response;
  const row = await studentAccess(env, guard.user.id, studentId);
  if (row === null) return json({ error: 'not-found' }, 404);
  if (!(await studentEditable(env, guard.user, row.space_id))) return json({ error: 'forbidden' }, 403);
  await env.DB.prepare('UPDATE students SET deleted_at = NULL, updated_at = ?1 WHERE id = ?2')
    .bind(Date.now(), studentId)
    .run();
  return json({ ok: true });
}

export async function createDeletionIntentRoute(
  request: Request,
  env: ControlEnv,
  resourceId: string,
): Promise<Response> {
  const guard = await requireControlUser(request, env, true);
  if (!guard.ok) return guard.response;
  const resource = await studentAccess(env, guard.user.id, resourceId);
  if (resource === null) return json({ error: 'not-found' }, 404);
  if (!(await studentEditable(env, guard.user, resource.space_id))) return json({ error: 'forbidden' }, 403);
  if (resource.deleted_at === null) return json({ error: 'move-to-trash-first' }, 409);
  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO deletion_intents
       (token_hash, user_id, resource_type, resource_id, resource_name, created_at, expires_at, used_at)
     VALUES (?1, ?2, 'student', ?3, ?4, ?5, ?6, NULL)`,
  ).bind(tokenHash, guard.user.id, resourceId, resource.display_name, now, now + DELETION_INTENT_TTL_MS).run();
  const origin = new URL(request.url).origin;
  return json({
    ok: true,
    confirmationRequired: true,
    expiresAt: now + DELETION_INTENT_TTL_MS,
    confirmationUrl: `${origin}/confirm-deletion/${encodeURIComponent(token)}`,
  }, 202);
}

interface IntentRow {
  token_hash: string;
  user_id: string;
  resource_type: ResourceType;
  resource_id: string;
  resource_name: string;
  expires_at: number;
  used_at: number | null;
}

async function intentForToken(env: ControlEnv, token: string): Promise<IntentRow | null> {
  return env.DB.prepare('SELECT * FROM deletion_intents WHERE token_hash = ?1')
    .bind(await sha256Hex(token))
    .first<IntentRow>();
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function deletionConfirmationPage(
  request: Request,
  env: ControlEnv,
  token: string,
): Promise<Response> {
  const user = await getSession(request, env);
  if (user === null) {
    return new Response(null, { status: 302, headers: { location: '/api/auth/google?returnTo=' + encodeURIComponent(new URL(request.url).pathname) } });
  }
  const intent = await intentForToken(env, token);
  if (intent === null || intent.user_id !== user.id || intent.used_at !== null || intent.expires_at <= Date.now()) {
    return linkNoLongerWorks();
  }
  const noun = await deletionNoun(env, intent);
  const contents = deletionContents(intent.resource_type, noun)
    .map((line) => `<li>${line}</li>`).join('');
  const kept = intent.resource_type === 'folder' && await folderKeepsLiveDecks(env, intent.resource_id)
    ? '<p>Decks in it that are not in Trash are kept and move to the top of the space.</p>'
    : '';
  return deletionPage(
    'Confirm permanent deletion',
    `<h1>Permanently delete this ${noun}?</h1>
<p class="name">${escapeHtml(intent.resource_name)}</p>
<p>This deletes:</p>
<ul>${contents}</ul>
${kept}<p>This cannot be undone. Items in Trash can be restored; items deleted here cannot.</p>
<form class="actions" method="post" action="/confirm-deletion/${encodeURIComponent(token)}"><button class="destructive" type="submit">Permanently delete</button><a class="button" href="${TRASH_HREF}">Cancel</a></form>`,
  );
}

const TRASH_HREF = '/host/#/tutor/trash';

function linkNoLongerWorks(): Response {
  return deletionPage(
    'This confirmation link no longer works',
    `<h1>This confirmation link no longer works.</h1>
<p>It has expired, it was already used, or it belongs to another account. Sign in as the owner of the item, or ask your agent for a new link.</p>
<p class="actions"><a class="button" href="${TRASH_HREF}">Open Trash</a></p>`,
    410,
  );
}

/** The item was restored or deleted elsewhere after the link was made. */
function notInTrash(): Response {
  return deletionPage(
    'Nothing was deleted',
    `<h1>Nothing was deleted.</h1>
<p>This item is no longer in Trash, or this account can no longer change it.</p>
<p class="actions"><a class="button" href="${TRASH_HREF}">Open Trash</a></p>`,
    404,
  );
}

/** The noun a student goes by, from its kind: a person is a student. */
const STUDENT_NOUNS: Record<string, string> = {
  person: 'student',
  group: 'group',
  class: 'class',
  event: 'event',
  other: 'student',
};

async function deletionNoun(env: ControlEnv, intent: IntentRow): Promise<string> {
  if (intent.resource_type !== 'student') return intent.resource_type;
  const row = await env.DB.prepare('SELECT kind FROM students WHERE id = ?1')
    .bind(intent.resource_id).first<{ kind: string }>();
  return STUDENT_NOUNS[row?.kind ?? 'person'] ?? 'student';
}

/**
 * What the deletion removes, in the words of TERMINOLOGY.md. Each line matches a
 * table the confirm route deletes from; Notes of sessions of another deck are
 * only unlinked from a student, so the student list does not claim them.
 */
function deletionContents(type: ResourceType, noun: string): string[] {
  if (type === 'student') {
    return [
      `The ${noun} and their access links`,
      'Their decks, with those decks’ sessions and Notes',
      'Their learner work, feedback, practice and audio',
    ];
  }
  if (type === 'folder') {
    return [
      'The folder and the folders inside it',
      'The decks in them that are in Trash, with those decks’ sessions, Notes and learner work',
    ];
  }
  if (type === 'session') return ['The session, its Notes and the learner work handed in for it'];
  return ['The deck and its saved versions', 'Its sessions, with their Notes and learner work'];
}

/**
 * The deletion pages are served by the worker, outside the workspace bundle, so
 * the product tokens from DESIGN.md are written out here: 14px body, the 8px
 * card radius and 4px control radius, the destructive red and action blue.
 */
const DELETION_PAGE_STYLE = `
body{margin:0;background:#FAF9F8;color:#242424;font:14px/1.5 'Segoe UI Variable Text','Segoe UI',system-ui,-apple-system,'Helvetica Neue',Arial,sans-serif}
main{max-width:36rem;margin:10vh auto;padding:24px;background:#fff;border:1px solid #E1DFDD;border-radius:8px}
h1{margin:0 0 12px;font-size:20px;line-height:1.3;font-weight:600}
p,ul{margin:0 0 12px}ul{padding-left:20px}
.name{font-weight:600}
.actions{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0 0}
button,.button{display:inline-flex;align-items:center;height:32px;padding:0 12px;border-radius:4px;font:inherit;font-weight:600;text-decoration:none;cursor:pointer}
.button{border:1px solid #D2D0CE;background:#fff;color:#0F6CBD}
.destructive{border:1px solid #A4262C;background:#A4262C;color:#fff}
.destructive:hover{background:#8E2025}
:focus-visible{outline:2px solid #0F6CBD;outline-offset:2px}`;

function deletionPage(title: string, body: string, status = 200): Response {
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title} · OpenRoom</title><style>${DELETION_PAGE_STYLE}</style><main>${body}</main></html>`;
  return new Response(html, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY' },
  });
}

/**
 * The space made for a student (`sp_ctx_<id>`) goes with them when nothing else
 * is filed in it: its folders, tags, invites and members, then the space. The
 * permanent deletion itself is the permission: whoever may delete the student and their
 * decks may delete the empty space that held them. A deck, session, picture or
 * brand kit still filed there keeps the space. Saved results of its lessons
 * stay with the tutor who ran them. A space the student was only attached to is
 * never touched. This is tidying after the deletion: if it cannot finish, the
 * space stays and the deletion still stands.
 */
async function removeEmptyStudentSpace(env: ControlEnv, studentId: string, spaceId: string): Promise<void> {
  if (spaceId !== `sp_ctx_${studentId}`) return;
  const space = await env.DB.prepare(
    `SELECT (EXISTS (SELECT 1 FROM decks WHERE space_id = s.id)
             OR EXISTS (SELECT 1 FROM sessions WHERE space_id = s.id)
             OR EXISTS (SELECT 1 FROM media_assets WHERE space_id = s.id)
             OR EXISTS (SELECT 1 FROM brand_kits WHERE space_id = s.id)
             OR EXISTS (SELECT 1 FROM students WHERE space_id = s.id)) AS kept
       FROM spaces s WHERE s.id = ?1`,
  ).bind(spaceId).first<{ kept: number }>();
  if (space === null || space.kept) return;
  try {
    await env.DB.batch([
      // Archive access then falls back to the tutor who ran the lesson.
      env.DB.prepare('UPDATE live_sessions SET space_id = NULL WHERE space_id = ?1').bind(spaceId),
      env.DB.prepare('DELETE FROM item_tags WHERE space_id = ?1').bind(spaceId),
      env.DB.prepare('DELETE FROM folders WHERE space_id = ?1').bind(spaceId),
      env.DB.prepare('DELETE FROM space_invites WHERE space_id = ?1').bind(spaceId),
      env.DB.prepare('DELETE FROM space_members WHERE space_id = ?1').bind(spaceId),
      env.DB.prepare('DELETE FROM space_students WHERE space_id = ?1').bind(spaceId),
      env.DB.prepare('DELETE FROM spaces WHERE id = ?1').bind(spaceId),
    ]);
  } catch (cause) {
    // The batch rolled back and the space stays; the workspace nav leaves an empty one out.
    console.error('student-space-cleanup-failed', spaceId, cause);
  }
}

export async function confirmPermanentDeletionRoute(
  request: Request,
  env: ControlEnv,
  token: string,
): Promise<Response> {
  /*
   * A browser form posts here, so every answer is a page. The statuses stay
   * what an API client would expect.
   */
  const user = await getSession(request, env);
  if (user === null) {
    return deletionPage(
      'Sign in to confirm',
      `<h1>Sign in to confirm this deletion.</h1>
<p>Only the owner, signed in on this browser, can confirm a permanent deletion.</p>
<p class="actions"><a class="button" href="/api/auth/google?returnTo=${encodeURIComponent(new URL(request.url).pathname)}">Sign in</a></p>`,
      401,
    );
  }
  const intent = await intentForToken(env, token);
  if (intent === null || intent.user_id !== user.id || intent.used_at !== null || intent.expires_at <= Date.now()) {
    return linkNoLongerWorks();
  }

  if (intent.resource_type === 'student') {
    const resource = await studentAccess(env, user.id, intent.resource_id);
    if (resource === null || resource.deleted_at === null) return notInTrash();
    // The role may have changed since the intent was made; deleting still needs editor.
    if (!(await studentEditable(env, user, resource.space_id))) return notInTrash();
    const { results } = await env.DB.prepare('SELECT id FROM decks WHERE student_id = ?1')
      .bind(resource.id).all<{ id: string }>();
    for (const deck of results ?? []) {
      await deleteDeckPermanently(env, deck.id);
    }
    await deleteLearnerAudioPermanently(env, 'student_id', resource.id);
    await env.DB.batch([
      // Sessions of other decks may still reference this student; detach them
      // before the student row goes away.
      env.DB.prepare('UPDATE sessions SET student_id = NULL WHERE student_id = ?1').bind(resource.id),
      env.DB.prepare('UPDATE session_records SET student_id = NULL WHERE student_id = ?1').bind(resource.id),
      env.DB.prepare('DELETE FROM learner_feedback WHERE submission_id IN (SELECT id FROM learner_submissions WHERE student_id = ?1)').bind(resource.id),
      env.DB.prepare('DELETE FROM learner_submissions WHERE student_id = ?1').bind(resource.id),
      env.DB.prepare('DELETE FROM learner_srs WHERE student_id = ?1').bind(resource.id),
      env.DB.prepare('DELETE FROM learner_practice_attempts WHERE student_id = ?1').bind(resource.id),
      env.DB.prepare('DELETE FROM student_access_links WHERE student_id = ?1').bind(resource.id),
      env.DB.prepare('DELETE FROM student_learners WHERE student_id = ?1').bind(resource.id),
      env.DB.prepare("DELETE FROM item_tags WHERE item_type = 'student' AND item_id = ?1").bind(resource.id),
      // Every space that pointed at it, before the row it points to is gone.
      env.DB.prepare('DELETE FROM space_students WHERE student_id = ?1').bind(resource.id),
      env.DB.prepare('DELETE FROM students WHERE id = ?1').bind(resource.id),
    ]);
    await removeEmptyStudentSpace(env, resource.id, resource.space_id);
  } else if (intent.resource_type === 'folder') {
    const ok = await confirmFolderDeletion(env, user, intent.resource_id, deleteDeckPermanently);
    if (!ok) return notInTrash();
  } else {
    const ok = await confirmDeliveryDeletion(env, user.id, intent.resource_type, intent.resource_id);
    if (!ok) return notInTrash();
  }

  await env.DB.prepare('UPDATE deletion_intents SET used_at = ?1 WHERE token_hash = ?2')
    .bind(Date.now(), intent.token_hash).run();
  return deletionPage(
    'Permanently deleted',
    `<h1>Permanently deleted.</h1>
<p class="name">${escapeHtml(intent.resource_name)}</p>
<p>This cannot be restored.</p>
<p class="actions"><a class="button" href="${TRASH_HREF}">Return to Trash</a></p>`,
  );
}

/**
 * Single tutoring API router for HTTP (index) and MCP controlRequest glue.
 * Returns null when the path is outside the tutoring control plane.
 */
export async function handleTutoringApi(
  request: Request,
  env: ControlEnv,
  url: URL,
  launch: SessionLauncher,
): Promise<Response | null> {
  const path = url.pathname;
  const brandKits = await handleBrandKits(request, env, url);
  if (brandKits) return brandKits;

  if (path === '/api/tutoring/lookup') {
    return lookupRoute(request, env);
  }
  if (path === '/api/tutoring/dictionary') {
    return dictionaryRoute(request, env);
  }
  if (path === '/api/tutoring/stock') {
    return stockRoute(request, env);
  }
  if (path === '/api/tutoring/embed-check') {
    return embedCheckRoute(request, env);
  }
  if (path === '/api/tutoring/embed-import') {
    return embedImportRoute(request, env);
  }

  if (path === '/api/tutoring/students') {
    return studentsCollectionRoute(request, env, url);
  }
  const studentAction = /^\/api\/tutoring\/students\/([^/]+)\/(restore|permanent-deletion)$/.exec(path);
  if (studentAction !== null) {
    const id = decodeURIComponent(studentAction[1] as string);
    if (request.method !== 'POST') return json({ error: 'method-not-allowed' }, 405);
    return studentAction[2] === 'restore'
      ? restoreStudentRoute(request, env, id)
      : createDeletionIntentRoute(request, env, id);
  }
  // Access links are tutor-side administration of a learner credential, so they
  // live on the normal control plane behind requireControlUser. Redeeming a
  // link happens only under /api/learner/* (learner.ts) and /api/join.
  const learners = /^\/api\/tutoring\/students\/([^/]+)\/learners$/.exec(path);
  if (learners !== null) {
    if (request.method !== 'GET') return json({ error: 'method-not-allowed' }, 405);
    return listStudentLearnersRoute(request, env, decodeURIComponent(learners[1]!));
  }
  const linkItem = /^\/api\/tutoring\/students\/([^/]+)\/links\/([^/]+)$/.exec(path);
  if (linkItem !== null) {
    if (request.method !== 'DELETE') return json({ error: 'method-not-allowed' }, 405);
    return revokeStudentLinkRoute(
      request,
      env,
      decodeURIComponent(linkItem[1] as string),
      decodeURIComponent(linkItem[2] as string),
    );
  }
  const linkCollection = /^\/api\/tutoring\/students\/([^/]+)\/links$/.exec(path);
  if (linkCollection !== null) {
    const id = decodeURIComponent(linkCollection[1] as string);
    if (request.method === 'GET') return listStudentLinksRoute(request, env, id);
    if (request.method === 'POST') return mintStudentLinkRoute(request, env, id);
    return json({ error: 'method-not-allowed' }, 405);
  }

  const returned = /^\/api\/tutoring\/students\/([^/]+)\/returned$/.exec(path);
  const work = /^\/api\/tutoring\/students\/([^/]+)\/work(?:\/([^/]+)(?:\/(feedback|audio))?)?$/.exec(path);
  if (work) return studentWorkRoute(request, env, decodeURIComponent(work[1]!), work[2] ? decodeURIComponent(work[2]) : undefined, work[3] as 'feedback' | 'audio' | undefined);
  if (returned !== null) {
    if (request.method !== 'GET') return json({ error: 'method-not-allowed' }, 405);
    return studentReturnedRoute(request, env, decodeURIComponent(returned[1] as string));
  }
  const studentItem = /^\/api\/tutoring\/students\/([^/]+)$/.exec(path);
  if (studentItem !== null) {
    return studentItemRoute(request, env, decodeURIComponent(studentItem[1] as string));
  }

  if (path === '/api/decks') {
    return decksCollectionRoute(request, env, url);
  }
  const deckLocation = /^\/api\/decks\/([^/]+)\/file-locations\/([^/]+)$/.exec(path);
  if (deckLocation !== null) {
    return deckFileLocationRoute(
      request,
      env,
      decodeURIComponent(deckLocation[1] as string),
      decodeURIComponent(deckLocation[2] as string),
    );
  }
  const deckFileLink = /^\/api\/decks\/([^/]+)\/file-link$/.exec(path);
  if (deckFileLink !== null) {
    return deckFileLinkRoute(request, env, decodeURIComponent(deckFileLink[1] as string));
  }
  const deckAction = /^\/api\/decks\/([^/]+)\/(versions|draft|start|restore|permanent-deletion)$/.exec(path);
  if (deckAction !== null) {
    const id = decodeURIComponent(deckAction[1] as string);
    const action = deckAction[2];
    if (action === 'versions') return deckVersionsRoute(request, env, id);
    if (action === 'draft') return deckDraftRoute(request, env, id);
    if (action === 'start') return startDeckRoute(request, env, id, launch);
    if (request.method !== 'POST') return json({ error: 'method-not-allowed' }, 405);
    if (action === 'restore') return restoreDeckRoute(request, env, id);
    return createDeliveryDeletionIntentRoute(request, env, 'deck', id);
  }
  const deckItem = /^\/api\/decks\/([^/]+)$/.exec(path);
  if (deckItem !== null) {
    return deckItemRoute(request, env, decodeURIComponent(deckItem[1] as string), url);
  }

  if (path === '/api/sessions') {
    return sessionsCollectionRoute(request, env, url);
  }
  const sessionAction = /^\/api\/sessions\/([^/]+)\/(record|launch|restore|permanent-deletion)$/.exec(path);
  if (sessionAction !== null) {
    const id = decodeURIComponent(sessionAction[1] as string);
    const action = sessionAction[2];
    if (action === 'record') return sessionRecordRoute(request, env, id);
    if (request.method !== 'POST') return json({ error: 'method-not-allowed' }, 405);
    if (action === 'launch') return launchSessionRoute(request, env, id, launch);
    if (action === 'restore') return restoreSessionRoute(request, env, id);
    return createDeliveryDeletionIntentRoute(request, env, 'session', id);
  }
  const sessionItem = /^\/api\/sessions\/([^/]+)$/.exec(path);
  if (sessionItem !== null) {
    return sessionItemRoute(request, env, decodeURIComponent(sessionItem[1] as string));
  }

  return null;
}
