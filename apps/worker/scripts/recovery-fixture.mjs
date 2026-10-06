/** Synthetic recovery data, with actual application reads before and after restoration. */
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

const origin = 'https://recovery.openroom.test';
const hash = value => createHash('sha256').update(value).digest('hex');
export const recoveryRequest = (runtime, path, options = {}) => runtime.dispatchFetch(origin + path, options);
async function json(runtime, path, cookie, body, expected = 200) {
  const response = await recoveryRequest(runtime, path, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', 'x-openroom-csrf': '1', ...(cookie ? { cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert.equal(response.status, expected, `${path}: ${response.status}`);
  return response.json();
}
async function login(runtime, username) {
  const response = await recoveryRequest(runtime, '/api/auth/demo/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: 'demo' }) });
  assert.equal(response.status, 200);
  return { ...(await response.json()), cookie: response.headers.get('set-cookie').split(';')[0] };
}

export async function seedRecoveryFixture(runtime, now) {
  const db = await runtime.getD1Database('DB'), bucket = await runtime.getR2Bucket('MEDIA');
  const owner = await login(runtime, 'alice'), collaborator = await login(runtime, 'bob');
  await db.prepare('UPDATE users SET entitlements=?1 WHERE id=?2').bind(JSON.stringify({ keep: true, team: true }), owner.user.id).run();
  const space = await json(runtime, '/api/my/spaces', owner.cookie, { name: 'Recovery classroom', experience: 'tutoring' }, 201);
  await db.prepare("INSERT INTO space_members (space_id,user_id,role,created_at) VALUES (?1,?2,'editor',?3)").bind(space.id, collaborator.user.id, now).run();
  const contextId = randomUUID();
  await db.prepare('INSERT INTO contexts (id,space_id,created_by,display_name,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?5)').bind(contextId, space.id, owner.user.id, 'Camille', now).run();
  await db.prepare('INSERT INTO space_contexts (space_id,context_id,created_at) VALUES (?1,?2,?3)').bind(space.id, contextId, now).run();
  const learner = await json(runtime, `/api/tutoring/contexts/${contextId}/links`, owner.cookie, { displayName: 'Camille' }, 201);
  const content = { version: 1, meta: { title: 'Français — les projets' }, interactions: [], steps: [{ id: 'opening', kind: 'title', title: 'Demain, je vais…', body: 'Écrire et raconter.' }] };
  const { deck } = await json(runtime, '/api/decks', owner.cookie, { spaceId: space.id, contextId, content }, 201);
  const first = await json(runtime, `/api/decks/${deck.id}/start`, owner.cookie, { requestId: randomUUID() }, 201);
  const end = await recoveryRequest(runtime, `/api/sessions/${first.sessionCode}/commands`, { method: 'POST', headers: { authorization: `Bearer ${first.hostToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ idempotencyKey: randomUUID(), command: { command: 'session.end' } }) });
  assert.equal(end.status, 200);
  await db.prepare("INSERT INTO session_records (id,session_id,context_id,session_code,deck_version,notes,created_at,updated_at) VALUES (?1,?2,?3,?4,1,'PRIVATE_RECOVERY_NOTE',?5,?5)").bind(randomUUID(), first.sessionId, contextId, first.sessionCode, now).run();
  const live = await json(runtime, `/api/decks/${deck.id}/start`, owner.cookie, { requestId: randomUUID() }, 201);
  const imageId = randomUUID(), image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8XkAAAAASUVORK5CYII=', 'base64');
  const cacheExpiry = new Date(now + 86400000);
  await bucket.put(`assets/${imageId}`, image, { httpMetadata: { contentType: 'image/png', cacheExpiry }, customMetadata: { fixture: 'recovery-image' } });
  await db.prepare("INSERT INTO media_assets (id,space_id,owner_id,key,content_type,size,name,created_at) VALUES (?1,?2,?3,?4,'image/png',?5,'Lesson image',?6)").bind(imageId, space.id, owner.user.id, `assets/${imageId}`, image.length, now).run();
  const recordings = [];
  for (const [name, expiresAt, removedAt] of [['retained', now + 30 * 86400000, null], ['already-expired', now - 1, null], ['expires-during-recovery', now + 30_000, null], ['trash-expired', now + 30 * 86400000, now - 8 * 86400000]]) {
    const id = randomUUID(), key = `learner-audio/${id}.wav`, bytes = Buffer.from(`RIFF-${name}-fixture`);
    await db.prepare("INSERT INTO learner_submissions (id,learner_id,context_id,session_id,task_id,task_json,assignment_revision,body,created_at) VALUES (?1,?2,?3,?4,'voice','{\"kind\":\"voice\",\"id\":\"voice\",\"prompt\":\"Parlez\"}',1,'',?5)").bind(id, learner.learnerId, contextId, first.sessionId, now).run();
    await db.prepare('INSERT INTO learner_audio (submission_id,object_key,sha256,byte_length,duration_ms,expires_at,removed_at) VALUES (?1,?2,?3,?4,1000,?5,?6)').bind(id, key, hash(bytes), bytes.length, expiresAt, removedAt).run();
    await db.prepare('INSERT INTO learner_feedback (submission_id,draft_json,published_json,version,updated_at) VALUES (?1,?2,?2,1,?3)').bind(id, JSON.stringify({ summary: 'Très bien — gardez le futur proche.' }), now).run();
    await bucket.put(key, bytes, { httpMetadata: { contentType: 'audio/wav' } });
    recordings.push({ id, key, bytes, name });
  }
  await bucket.put('unused/orphan', 'not referenced by D1');
  const pat = `orpat_${randomUUID()}_${randomBytes(32).toString('base64url')}`, oauth = `orauth_${randomBytes(32).toString('base64url')}`;
  await db.prepare("INSERT INTO api_tokens (id,user_id,name,token_hash,token_prefix,created_at) VALUES (?1,?2,'Recovery fixture',?3,?4,?5)").bind(randomUUID(), owner.user.id, hash(pat), pat.slice(0, 12), now).run();
  await db.prepare("INSERT INTO oauth_connections (id,user_id,client_id,client_name,redirect_uri,token_hash,created_at,expires_at) VALUES (?1,?2,'fixture','PowerPoint recovery','https://recovery.openroom.test/office',?3,?4,?5)").bind(randomUUID(), owner.user.id, hash(oauth), now, now + 86400000).run();
  const customerId = 'ctm_00000000000000000000000001', attemptId = randomUUID();
  await db.prepare("INSERT INTO billing_customers (environment,customer_id,user_id,created_at) VALUES ('sandbox',?1,?2,?3)").bind(customerId, owner.user.id, now).run();
  await db.prepare("INSERT INTO billing_checkouts (id,environment,user_id,price_id,attempted_at,created_at,claim,lease_until) VALUES (?1,'sandbox',?2,'pri_00000000000000000000000001',?3,?3,'stale-claim',?4)").bind(attemptId, owner.user.id, now, now + 600000).run();
  await db.prepare("INSERT INTO billing_subscriptions (environment,id,customer_id,status,price_ids,period_end,event_id,state_order,state_rank) VALUES ('sandbox','sub_00000000000000000000000001',?1,'active','[]',?2,'fixture','2026-09-19T00:00:00Z',1)").bind(customerId, now + 86400000).run();
  for (const token of [pat, oauth]) assert.equal((await recoveryRequest(runtime, '/api/my/spaces', { headers: { authorization: `Bearer ${token}` } })).status, 200);
  assert.equal((await recoveryRequest(runtime, '/api/learner/me', { headers: { authorization: `Bearer ${learner.token}` } })).status, 200);
  const stored = await db.prepare('SELECT content_json FROM deck_versions WHERE deck_id=?1').bind(deck.id).first();
  return { owner, collaborator, space, contextId, learner, deck, content, storedContent: JSON.parse(stored.content_json), first, live, imageId, image, cacheExpiry, recordings, pat, oauth, customerId, attemptId, attemptedAt: now };
}

export async function verifyRecoveredFixture(runtime, fixture) {
  const db = await runtime.getD1Database('DB'), bucket = await runtime.getR2Bucket('MEDIA');
  for (const token of [fixture.pat, fixture.oauth]) assert.equal((await recoveryRequest(runtime, '/api/my/spaces', { headers: { authorization: `Bearer ${token}` } })).status, 401);
  assert.equal((await recoveryRequest(runtime, '/api/my/spaces', { headers: { cookie: fixture.owner.cookie } })).status, 401);
  assert.equal((await recoveryRequest(runtime, '/api/learner/me', { headers: { authorization: `Bearer ${fixture.learner.token}` } })).status, 401);
  assert.notEqual((await recoveryRequest(runtime, `/api/sessions/${fixture.live.sessionCode}/state?role=host`, { headers: { authorization: `Bearer ${fixture.live.hostToken}` } })).status, 200);
  const owner = await login(runtime, 'alice'), collaborator = await login(runtime, 'bob');
  const saved = await json(runtime, `/api/decks/${fixture.deck.id}`, owner.cookie);
  assert.equal(saved.deck.title, fixture.content.meta.title);
  const versions = await db.prepare('SELECT content_json FROM deck_versions WHERE deck_id=?1').bind(fixture.deck.id).all();
  assert.deepEqual(JSON.parse(versions.results[0].content_json), fixture.storedContent);
  assert.notEqual((await recoveryRequest(runtime, `/api/decks/${fixture.deck.id}`, { headers: { cookie: collaborator.cookie } })).status, 200);
  const image = await recoveryRequest(runtime, `/api/assets/${fixture.imageId}`);
  assert.equal(image.status, 200); assert.deepEqual(Buffer.from(await image.arrayBuffer()), fixture.image);
  assert.equal((await bucket.head(`assets/${fixture.imageId}`)).customMetadata.fixture, 'recovery-image');
  assert.equal((await bucket.head(`assets/${fixture.imageId}`)).httpMetadata.cacheExpiry.getTime(), fixture.cacheExpiry.getTime());
  const record = await json(runtime, `/api/sessions/${fixture.first.sessionId}/record`, owner.cookie);
  assert.equal(record.record.notes, 'PRIVATE_RECOVERY_NOTE');
  const archive = await json(runtime, `/api/my/archives/${fixture.first.sessionCode}`, owner.cookie);
  assert.equal(archive.code, fixture.first.sessionCode);
  const replacement = await json(runtime, `/api/tutoring/contexts/${fixture.contextId}/links`, owner.cookie, { learnerId: fixture.learner.learnerId }, 201);
  for (const recording of fixture.recordings) {
    const response = await recoveryRequest(runtime, `/api/learner/submissions/${recording.id}/audio`, { headers: { authorization: `Bearer ${replacement.token}` } });
    if (recording.name === 'retained') { assert.equal(response.status, 200); assert.deepEqual(Buffer.from(await response.arrayBuffer()), recording.bytes); }
    else { assert.equal(response.status, 410); assert.equal(await bucket.head(recording.key), null); }
    assert.equal((await db.prepare('SELECT published_json FROM learner_feedback WHERE submission_id=?1').bind(recording.id).first()).published_json, JSON.stringify({ summary: 'Très bien — gardez le futur proche.' }));
  }
  assert.equal(await bucket.head('unused/orphan'), null);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM billing_subscriptions').first()).count, 0);
  assert.equal((await db.prepare('SELECT customer_id FROM billing_customers WHERE user_id=?1').bind(owner.user.id).first()).customer_id, fixture.customerId);
  assert.deepEqual(await db.prepare('SELECT attempted_at,transaction_id,claim,lease_until FROM billing_checkouts WHERE id=?1').bind(fixture.attemptId).first(), { attempted_at: fixture.attemptedAt, transaction_id: null, claim: null, lease_until: 0 });
  assert.equal((await db.prepare('SELECT entitlements FROM users WHERE id=?1').bind(owner.user.id).first()).entitlements, '{}');
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM live_sessions WHERE ended=0').first()).count, 0);
  const fresh = await json(runtime, `/api/decks/${fixture.deck.id}/start`, owner.cookie, { requestId: randomUUID() }, 201);
  assert.notEqual(fresh.sessionCode, fixture.live.sessionCode);
  assert.equal((await recoveryRequest(runtime, `/api/sessions/${fresh.sessionCode}/state?role=host`, { headers: { authorization: `Bearer ${fresh.hostToken}` } })).status, 200);
  return { oldCredentialsRejected: true, collaboratorsRequireNewInvitation: true, deckAndMediaReadable: true, privateNotesAndFeedbackPreserved: true,
    expiredAudioNotRestored: true, savedResultsReadable: true, billingOwnershipAndUncertainWritePreserved: true, stalePaidAccessRemoved: true, newSessionStarts: true };
}
