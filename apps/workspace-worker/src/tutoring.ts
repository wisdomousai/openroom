import { brandKitSpaceId, confirmBrandKitDeletion, handleBrandKits } from './brand-kits.js';
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
import { and, desc, eq, exists, getTableColumns, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';

import { sha256Hex } from './api-tokens.js';
import { getSession, json, type ControlEnv, type SessionUser } from './auth.js';
import { requireControlUser } from './control-auth.js';
import { orm } from './db/client.js';
import {
  brandKits,
  decks,
  deletionIntents,
  folders,
  itemTags,
  learnerFeedback,
  learnerPracticeAttempts,
  learnerSrs,
  learnerSubmissions,
  liveSessions,
  mediaAssets,
  sessionRecords,
  sessions,
  spaceInvites,
  spaceMembers,
  spaceStudents,
  spaces,
  studentAccessLinks,
  studentLearners,
  students,
} from './db/schema.js';
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

type ResourceType = 'student' | 'deck' | 'session' | 'folder' | 'brand_kit';

const STUDENT_KIND_SET: ReadonlySet<string> = new Set(STUDENT_KINDS);

type StudentRow = typeof students.$inferSelect;

async function studentAccess(
  env: ControlEnv,
  userId: string,
  studentId: string,
): Promise<StudentRow | null> {
  const row = await orm(env)
    .select(getTableColumns(students))
    .from(students)
    .innerJoin(spaceMembers, and(eq(spaceMembers.spaceId, students.spaceId), eq(spaceMembers.userId, userId)))
    .where(eq(students.id, studentId))
    .get();
  return row ?? null;
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
  const nextNote = withNextNote && typeof row.nextNote === 'string' ? row.nextNote : '';
  return {
    id: row.id,
    spaceId: row.spaceId,
    kind: row.kind,
    displayName: row.displayName,
    ...(includeProfile ? { profile: parseJson(row.profileJson, {}) } : {}),
    ...(nextNote !== '' ? { nextNote } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
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
    const filters = [trashed ? isNotNull(students.deletedAt) : isNull(students.deletedAt)];
    if (spaceId !== null) filters.push(eq(students.spaceId, spaceId));
    if (kind !== null && STUDENT_KIND_SET.has(kind)) filters.push(eq(students.kind, kind));
    const rows = await orm(env)
      .select({ ...getTableColumns(students), ownerUserId: spaces.ownerUserId })
      .from(students)
      .innerJoin(spaceMembers, and(eq(spaceMembers.spaceId, students.spaceId), eq(spaceMembers.userId, guard.user.id)))
      .innerJoin(spaces, eq(spaces.id, students.spaceId))
      .where(and(...filters))
      .orderBy(desc(students.updatedAt))
      .limit(500);
    const continuity = new Map<string, boolean>();
    for (const owner of new Set(rows.filter((row) => row.nextNote).map((row) => row.ownerUserId))) {
      continuity.set(owner, await ownerHasContinuity(env, owner));
    }
    return json({ students: rows.map((row) => studentJson(row, false, continuity.get(row.ownerUserId) === true)) });
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
    await orm(env)
      .insert(spaces)
      .values({
        id: spaceId,
        ownerUserId: guard.user.id,
        name: displayName.slice(0, 200),
        createdAt: now,
        updatedAt: now,
        settings: JSON.stringify(settings),
      })
      .run();
    await orm(env)
      .insert(spaceMembers)
      .values({ spaceId, userId: guard.user.id, role: 'owner', invitedBy: null, createdAt: now })
      .run();
  }

  await orm(env)
    .insert(students)
    .values({
      id,
      spaceId,
      createdBy: guard.user.id,
      kind,
      displayName: displayName.slice(0, 200),
      profileJson: serializedProfile,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    })
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

  const withNextNote = async () => row.nextNote !== '' && (await ownerHasContinuity(env, await spaceOwnerId(env, row.spaceId)));

  if (request.method === 'GET') return json({ student: studentJson(row, true, await withNextNote()) });
  if (!(await studentEditable(env, guard.user, row.spaceId))) return json({ error: 'forbidden' }, 403);

  if (request.method === 'DELETE') {
    if (row.deletedAt === null) {
      const now = Date.now();
      await orm(env).update(students).set({ deletedAt: now, updatedAt: now }).where(eq(students.id, studentId)).run();
    }
    return json({ ok: true, recoverable: true });
  }
  if (request.method !== 'PATCH') return json({ error: 'method-not-allowed' }, 405);
  if (row.deletedAt !== null) return json({ error: 'resource-in-trash' }, 409);
  const body = await readJson(request);
  if (body === null) return json({ error: 'invalid-json' }, 400);
  const displayName = body.displayName === undefined
    ? row.displayName
    : typeof body.displayName === 'string'
      ? body.displayName.trim().slice(0, 200)
      : '';
  if (displayName === '') return json({ error: 'display-name-required' }, 422);
  const currentProfile = parseJson(row.profileJson, {});
  const profile = body.profile === undefined ? currentProfile : plainObject(body.profile);
  if (profile === null) return json({ error: 'profile-must-be-object' }, 422);
  const serialized = JSON.stringify(profile);
  if (serialized.length > 100_000) return json({ error: 'profile-too-large' }, 413);
  const kind = body.kind === undefined ? row.kind : parseKind(body.kind, row.kind);
  const now = Date.now();
  await orm(env)
    .update(students)
    .set({ displayName, profileJson: serialized, kind, updatedAt: now })
    .where(eq(students.id, studentId))
    .run();
  const payload = studentJson({
    ...row,
    displayName,
    profileJson: serialized,
    kind,
    updatedAt: now,
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
  if (!(await studentEditable(env, guard.user, row.spaceId))) return json({ error: 'forbidden' }, 403);
  await orm(env).update(students).set({ deletedAt: null, updatedAt: Date.now() }).where(eq(students.id, studentId)).run();
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
  if (!(await studentEditable(env, guard.user, resource.spaceId))) return json({ error: 'forbidden' }, 403);
  if (resource.deletedAt === null) return json({ error: 'move-to-trash-first' }, 409);
  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const now = Date.now();
  await orm(env)
    .insert(deletionIntents)
    .values({
      tokenHash,
      userId: guard.user.id,
      resourceType: 'student',
      resourceId,
      resourceName: resource.displayName,
      createdAt: now,
      expiresAt: now + DELETION_INTENT_TTL_MS,
      usedAt: null,
    })
    .run();
  const origin = new URL(request.url).origin;
  return json({
    ok: true,
    confirmationRequired: true,
    expiresAt: now + DELETION_INTENT_TTL_MS,
    confirmationUrl: `${origin}/confirm-deletion/${encodeURIComponent(token)}`,
  }, 202);
}

type IntentRow = Omit<typeof deletionIntents.$inferSelect, 'resourceType'> & { resourceType: ResourceType };

async function intentForToken(env: ControlEnv, token: string): Promise<IntentRow | null> {
  const row = await orm(env)
    .select()
    .from(deletionIntents)
    .where(eq(deletionIntents.tokenHash, await sha256Hex(token)))
    .get();
  return row === undefined ? null : { ...row, resourceType: row.resourceType as ResourceType };
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
  if (intent === null || intent.userId !== user.id || intent.usedAt !== null || intent.expiresAt <= Date.now()) {
    return linkNoLongerWorks();
  }
  const noun = await deletionNoun(env, intent);
  const contents = deletionContents(intent.resourceType, noun)
    .map((line) => `<li>${line}</li>`).join('');
  const kept = intent.resourceType === 'folder' && await folderKeepsLiveDecks(env, intent.resourceId)
    ? '<p>Decks in it that are not in Trash are kept and move to the top of the space.</p>'
    : intent.resourceType === 'brand_kit'
      ? '<p>Decks that used this kit keep their design. Pictures the kit uses stay in the space.</p>'
      : '';
  const trashHref = await trashHrefFor(env, intent);
  return deletionPage(
    'Confirm permanent deletion',
    `<h1>Permanently delete this ${noun}?</h1>
<p class="name">${escapeHtml(intent.resourceName)}</p>
<p>This deletes:</p>
<ul>${contents}</ul>
${kept}<p>This cannot be undone. Items in Trash can be restored; items deleted here cannot.</p>
<form class="actions" method="post" action="/confirm-deletion/${encodeURIComponent(token)}"><button class="destructive" type="submit">Permanently delete</button><a class="button" href="${escapeHtml(trashHref)}">Cancel</a></form>`,
  );
}

const TRASH_HREF = '/host/#/tutor/trash';

/** Brand kits have their own Trash under the space's brand kits; everything else uses the workspace Trash. */
async function trashHrefFor(env: ControlEnv, intent: IntentRow): Promise<string> {
  if (intent.resourceType !== 'brand_kit') return TRASH_HREF;
  const spaceId = await brandKitSpaceId(env, intent.resourceId);
  return spaceId === null ? TRASH_HREF : `/host/#/space/${encodeURIComponent(spaceId)}/brand-kits?trashed=true`;
}

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
function notInTrash(trashHref = TRASH_HREF): Response {
  return deletionPage(
    'Nothing was deleted',
    `<h1>Nothing was deleted.</h1>
<p>This item is no longer in Trash, or this account can no longer change it.</p>
<p class="actions"><a class="button" href="${escapeHtml(trashHref)}">Open Trash</a></p>`,
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
  if (intent.resourceType === 'brand_kit') return 'brand kit';
  if (intent.resourceType !== 'student') return intent.resourceType;
  const row = await orm(env)
    .select({ kind: students.kind })
    .from(students)
    .where(eq(students.id, intent.resourceId))
    .get();
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
  if (type === 'brand_kit') return ['The brand kit with its colors, typography and slide masters'];
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
  const db = orm(env);
  const filedIn = (table: typeof decks | typeof sessions | typeof mediaAssets | typeof brandKits | typeof students) =>
    exists(db.select({ one: sql`1` }).from(table).where(eq(table.spaceId, spaces.id)));
  const space = await db
    .select({
      kept: sql<number>`(${filedIn(decks)} OR ${filedIn(sessions)} OR ${filedIn(mediaAssets)} OR ${filedIn(brandKits)} OR ${filedIn(students)})`,
    })
    .from(spaces)
    .where(eq(spaces.id, spaceId))
    .get();
  if (space === undefined || space.kept) return;
  try {
    await db.batch([
      // Archive access then falls back to the tutor who ran the lesson.
      db.update(liveSessions).set({ spaceId: null }).where(eq(liveSessions.spaceId, spaceId)),
      db.delete(itemTags).where(eq(itemTags.spaceId, spaceId)),
      db.delete(folders).where(eq(folders.spaceId, spaceId)),
      db.delete(spaceInvites).where(eq(spaceInvites.spaceId, spaceId)),
      db.delete(spaceMembers).where(eq(spaceMembers.spaceId, spaceId)),
      db.delete(spaceStudents).where(eq(spaceStudents.spaceId, spaceId)),
      db.delete(spaces).where(eq(spaces.id, spaceId)),
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
  if (intent === null || intent.userId !== user.id || intent.usedAt !== null || intent.expiresAt <= Date.now()) {
    return linkNoLongerWorks();
  }

  // Read before the deletion: the kit row is what names the space.
  const trashHref = await trashHrefFor(env, intent);
  if (intent.resourceType === 'student') {
    const resource = await studentAccess(env, user.id, intent.resourceId);
    if (resource === null || resource.deletedAt === null) return notInTrash();
    // The role may have changed since the intent was made; deleting still needs editor.
    if (!(await studentEditable(env, user, resource.spaceId))) return notInTrash();
    const db = orm(env);
    const studentDecks = await db.select({ id: decks.id }).from(decks).where(eq(decks.studentId, resource.id));
    for (const deck of studentDecks) {
      await deleteDeckPermanently(env, deck.id);
    }
    await deleteLearnerAudioPermanently(env, 'student_id', resource.id);
    await db.batch([
      // Sessions of other decks may still reference this student; detach them
      // before the student row goes away.
      db.update(sessions).set({ studentId: null }).where(eq(sessions.studentId, resource.id)),
      db.update(sessionRecords).set({ studentId: null }).where(eq(sessionRecords.studentId, resource.id)),
      db.delete(learnerFeedback).where(inArray(
        learnerFeedback.submissionId,
        db.select({ id: learnerSubmissions.id }).from(learnerSubmissions).where(eq(learnerSubmissions.studentId, resource.id)),
      )),
      db.delete(learnerSubmissions).where(eq(learnerSubmissions.studentId, resource.id)),
      db.delete(learnerSrs).where(eq(learnerSrs.studentId, resource.id)),
      db.delete(learnerPracticeAttempts).where(eq(learnerPracticeAttempts.studentId, resource.id)),
      db.delete(studentAccessLinks).where(eq(studentAccessLinks.studentId, resource.id)),
      db.delete(studentLearners).where(eq(studentLearners.studentId, resource.id)),
      db.delete(itemTags).where(and(eq(itemTags.itemType, 'student'), eq(itemTags.itemId, resource.id))),
      // Every space that pointed at it, before the row it points to is gone.
      db.delete(spaceStudents).where(eq(spaceStudents.studentId, resource.id)),
      db.delete(students).where(eq(students.id, resource.id)),
    ]);
    await removeEmptyStudentSpace(env, resource.id, resource.spaceId);
  } else if (intent.resourceType === 'folder') {
    const ok = await confirmFolderDeletion(env, user, intent.resourceId, deleteDeckPermanently);
    if (!ok) return notInTrash();
  } else if (intent.resourceType === 'brand_kit') {
    if (!(await confirmBrandKitDeletion(env, user, intent.resourceId))) return notInTrash(trashHref);
  } else {
    const ok = await confirmDeliveryDeletion(env, user.id, intent.resourceType, intent.resourceId);
    if (!ok) return notInTrash();
  }

  await orm(env).update(deletionIntents).set({ usedAt: Date.now() }).where(eq(deletionIntents.tokenHash, intent.tokenHash)).run();
  return deletionPage(
    'Permanently deleted',
    `<h1>Permanently deleted.</h1>
<p class="name">${escapeHtml(intent.resourceName)}</p>
<p>This cannot be restored.</p>
<p class="actions"><a class="button" href="${escapeHtml(trashHref)}">Return to Trash</a></p>`,
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
