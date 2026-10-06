/** Exercise the shipped SDK against real local HTTP/WS services, never a hosted target. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { createSessionClient } from '../packages/sdk/dist/index.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'e2e/verification-output/capacity/metrics.json');
const origin = process.env.OPENROOM_URL;
if (!origin || !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin) || !process.env.OPENROOM_E2E_PERSIST_TO || process.env.OPENROOM_ADMIN_KEY !== 'dev-admin') {
  throw new Error('Run bun run verify:capacity to create an isolated local Worker. Hosted targets are not supported.');
}
const count = 500;
const concurrency = 25;
const privateNotes = 'capacity-private-facilitator-note';
const report = {
  startedAt: new Date().toISOString(), status: 'running', localOnly: true,
  requestedParticipants: count, requestConcurrency: concurrency,
  timingScope: 'Local client HTTP round-trip and SDK snapshot receipt. Includes local transport and client processing; not production server-only timing or browser paint.',
  serviceTimingScope: 'Test-only wrapper measures local Worker fetch entry to returned response, including authentication, request parsing and awaited Durable Object work. Excludes client processing, transport and browser paint; not production telemetry.',
  checks: {}, phases: [],
};
await writeFile(output, JSON.stringify(report, null, 2));
const clients = [];
const rows = [];
const hostObservations = [];
const privacyFailures = new Set();
const httpFailures = new Map();
const participantSockets = new Set();
const monitorSockets = new Set();
function trackSockets(sockets) {
  return class extends WebSocket {
    constructor(url) {
      super(url);
      sockets.add(this);
      this.addEventListener('close', () => sockets.delete(this), { once: true });
    }
  };
}
const ParticipantSocket = trackSockets(participantSockets);
const MonitorSocket = trackSockets(monitorSockets);
const openParticipantSockets = () => [...participantSockets].filter((socket) => socket.readyState === WebSocket.OPEN).length;
let participantReads = 0;
let phase = '';
let host;
let stage;
let session;
const stop = new AbortController();
const started = performance.now();
const clientLoop = monitorEventLoopDelay({ resolution: 10 });
clientLoop.enable();
const now = () => performance.now() - started;
const sleep = (ms) => new Promise((accept) => setTimeout(accept, ms));
function distribution(values) {
  assert(values.length > 0, 'Timing distribution has no observations');
  const sorted = [...values].sort((a, b) => a - b);
  const at = (fraction) => Math.round(sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] * 10) / 10;
  return { samples: values.length, p50Ms: at(0.5), p95Ms: at(0.95), p99Ms: at(0.99), maxMs: at(1) };
}
async function until(predicate, label, timeout = 30_000) {
  const deadline = now() + timeout;
  while (!await predicate()) {
    if (now() > deadline) throw new Error(`Timed out: ${label}`);
    await sleep(25);
  }
}
async function parallel(items, operation) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) { const index = next++; await operation(items[index], index); }
  }));
}
async function request(path, { token, body, admin = false } = {}) {
  const response = await fetch(`${origin}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(admin ? { 'x-openroom-admin': 'dev-admin' } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.any([stop.signal, AbortSignal.timeout(30_000)]),
  });
  assert(response.ok, `Local ${path.split('?')[0]} returned HTTP ${response.status}`);
  return response.json();
}
const command = (value) => request(`/api/sessions/${session.sessionCode}/commands`, { token: session.hostToken, body: { idempotencyKey: crypto.randomUUID(), command: value } });
function connect(row, polling = false) {
  const client = createSessionClient({
    baseUrl: origin, sessionCode: session.sessionCode, token: row.participantToken, role: 'participant',
    // Stable per participant/question so replay tests exercise actual duplicate requests.
    randomUUID: () => `capacity-${row.index}-${phase}`,
    WebSocket: polling ? null : ParticipantSocket,
    fetch: async (url, init) => {
      if (init?.method === 'GET') participantReads++;
      const response = await fetch(url, { ...init, signal: AbortSignal.any([stop.signal, AbortSignal.timeout(30_000)]) });
      if (!response.ok && response.status !== 304) httpFailures.set(response.status, (httpFailures.get(response.status) ?? 0) + 1);
      if (init?.method === 'POST') {
        const timing = response.headers.get('server-timing')?.match(/(?:^|,)\s*openroom;dur=([\d.]+)/);
        row.serviceMs = timing ? Number(timing[1]) : undefined;
      }
      return response;
    },
    onChange: (snapshot) => {
      if (JSON.stringify(snapshot).includes(privateNotes)) privacyFailures.add('private-notes');
      if (snapshot.interaction?.id === 'hidden' && snapshot.interactionStatus === 'open') {
        if (snapshot.aggregate !== null) privacyFailures.add('hidden-aggregate');
        if (snapshot.interaction.options?.some((option) => 'correct' in option)) privacyFailures.add('unrevealed-correct-answer');
      }
      if (snapshot.interactionStatus === 'revealed' && row.revealedAt === undefined) row.revealedAt = now();
    },
  });
  clients.push(client);
  row.client = client;
}
function verifyAnswers(question) {
  const snapshot = host.getSnapshot();
  assert.equal(snapshot.participantCount, count, 'Reconnect must not create another participant');
  assert.equal(snapshot.aggregate.total, count, 'Each participant must have exactly one counted answer');
  assert.deepEqual(snapshot.aggregate.counts, { a: count / 2, b: count / 2 });
  assert.equal(Object.keys(snapshot.ballots[question]).length, count, 'No accepted answer may be missing');
  for (const row of rows) {
    assert.deepEqual(row.client.getSnapshot().ownAnswer, { kind: 'choice', optionIds: [row.index % 2 ? 'b' : 'a'] });
  }
}
async function answerRound(id, live) {
  phase = id;
  await command({ command: 'interaction.open', interactionId: id });
  await until(() => rows.every((row) => row.client.getSnapshot()?.interaction?.id === id), `${id}: all clients receive open`);
  const readsBefore = participantReads;
  const accepted = [];
  await parallel(rows, async (row) => {
    const sentAt = now();
    const result = await row.client.submit({ command: 'answer.submit', interactionId: id, answer: { kind: 'choice', optionIds: [row.index % 2 ? 'b' : 'a'] } });
    assert(result.ok, `Ballot rejected: ${result.error?.code}`);
    assert(Number.isFinite(row.serviceMs) && row.serviceMs >= 0, 'Missing local Worker timing');
    accepted.push({ revision: result.revision, acceptedAt: now(), rtt: now() - sentAt, serviceMs: row.serviceMs });
  });
  report.currentRound = { question: id, acknowledged: accepted.length, ballotRoundTrip: distribution(accepted.map((answer) => answer.rtt)) };
  await until(() => host.getSnapshot()?.aggregate?.total === count, `${id}: host receives complete aggregate`);
  await until(() => rows.every((row) => row.client.getSnapshot()?.answered), `${id}: own answers acknowledged`);
  if (live) await until(() => rows.every((row) => row.client.getSnapshot()?.aggregate?.total === count), `${id}: all live aggregates converge`);
  const updateLag = accepted.map((answer) => {
    const seen = hostObservations.find((observation) => observation.question === id && observation.revision >= answer.revision);
    assert(seen, 'Every acknowledged answer must reach the host monitor');
    return Math.max(0, seen.at - answer.acceptedAt);
  });
  verifyAnswers(id);
  const duplicateSample = rows.filter((row) => row.index % 20 === 0);
  await parallel(duplicateSample, async (row) => {
    const payload = { command: 'answer.submit', interactionId: id, answer: { kind: 'choice', optionIds: [row.index % 2 ? 'b' : 'a'] } };
    const [first, second] = await Promise.all([row.client.submit(payload), row.client.submit(payload)]);
    assert(first.ok && second.ok, 'Duplicate retry must return success');
    assert.equal(first.revision, second.revision, 'Duplicate retry must return the original acknowledgement');
  });
  // Read authoritative state after replay rather than trusting a pre-replay cached total.
  await host.refresh();
  verifyAnswers(id);
  report.phases.push({ question: id, visibility: live ? 'live' : 'hidden', accepted: accepted.length, duplicateReplays: duplicateSample.length * 2,
    ballotRoundTrip: distribution(accepted.map((answer) => answer.rtt)), localWorkerRequest: distribution(accepted.map((answer) => answer.serviceMs)), hostAggregateReceiptAfterAck: distribution(updateLag), participantSnapshotRequests: participantReads - readsBefore });
  const measured = report.phases.at(-1);
  console.log(`${id}: ${accepted.length} answers, ${duplicateSample.length * 2} duplicate replays; ballot p95 ${measured.ballotRoundTrip.p95Ms} ms (local Worker ${measured.localWorkerRequest.p95Ms} ms); host-update p95 ${measured.hostAggregateReceiptAfterAck.p95Ms} ms.`);
}
try {
  session = await request('/api/sessions', { admin: true, body: { outline: {
    version: 1, meta: { title: 'Isolated capacity verification' }, defaults: { identityMode: 'anonymous', allowAnswerChange: true },
    interactions: ['hidden', 'visible'].map((id) => ({ id, type: 'choice', prompt: 'Choose A or B', notes: privateNotes, resultVisibility: id === 'hidden' ? 'hidden-until-close' : 'live', options: [{ id: 'a', label: 'A', correct: true }, { id: 'b', label: 'B' }] })),
  } } });
  host = createSessionClient({ baseUrl: origin, sessionCode: session.sessionCode, token: session.hostToken, role: 'host', WebSocket: MonitorSocket, onChange: (snapshot) => hostObservations.push({ at: now(), revision: snapshot.revision, question: snapshot.activeInteractionId, total: snapshot.aggregate?.total }) });
  stage = createSessionClient({ baseUrl: origin, sessionCode: session.sessionCode, token: session.stageToken, role: 'stage', WebSocket: MonitorSocket });
  clients.push(host, stage);
  const joinTimings = [];
  await parallel(Array.from({ length: count }, (_, index) => index), async (index) => {
    const before = now();
    const participant = await request('/api/join', { body: { code: session.code } });
    joinTimings.push(now() - before);
    const row = { ...participant, index };
    rows.push(row);
    connect(row);
  });
  assert.equal(new Set(rows.map((row) => row.participantId)).size, count);
  await until(() => rows.every((row) => row.client.getStatus() === 'live' && row.client.getSnapshot()), '500 live SDK clients');
  await until(() => openParticipantSockets() === count && host.getSnapshot()?.participantCount === count, '500 open participant sockets and retained joins');
  report.join = { successful: rows.length, successRate: rows.length / count, roundTrip: distribution(joinTimings), simultaneousParticipantWebSockets: count };
  console.log(`Connected ${count} distinct participants over WebSockets.`);
  await command({ command: 'session.start' });
  await answerRound('hidden', false);
  assert.equal(stage.getSnapshot().aggregate, null, 'Stage must hide unrevealed results');
  const revealStart = now();
  await command({ command: 'interaction.reveal', interactionId: 'hidden' });
  await until(() => rows.every((row) => row.client.getSnapshot()?.interactionStatus === 'revealed' && row.client.getSnapshot()?.aggregate?.total === count), '500 clients receive released results');
  report.revealReceipt = distribution(rows.map((row) => row.revealedAt - revealStart));
  const pollingRows = rows.filter((row) => row.index % 10 === 0);
  const reconnectRows = rows.filter((row) => row.index % 10 === 1);
  await parallel([...pollingRows, ...reconnectRows], async (row) => { row.client.close(); connect(row, row.index % 10 === 0); });
  await until(() => rows.every((row) => row.client.getSnapshot()?.answered), 'reconnect and polling retain own answers');
  await until(() => openParticipantSockets() === count - pollingRows.length, '450 participant sockets after reconnect and polling fallback');
  assert(pollingRows.every((row) => row.client.getStatus() === 'polling'));
  report.recovery = { pollingParticipants: pollingRows.length, reconnectedWebSockets: reconnectRows.length, retainedOwnAnswers: true };
  await answerRound('visible', true);
  assert.equal(privacyFailures.size, 0, `Privacy failures: ${[...privacyFailures].join(', ')}`);
  assert.equal(httpFailures.size, 0, 'Unexpected SDK HTTP failures');
  await command({ command: 'session.end' });
  await until(() => rows.every((row) => row.client.getSnapshot()?.status === 'ended'), 'all clients receive end');
  report.checks = { uniqueParticipants: true, allAcceptedAnswersRetained: true, duplicateCountsPrevented: true, privateDataProtected: true, revealReachedAllClients: true, reconnectPreservedIdentity: true, pollingConverged: true, endReachedAllClients: true };
  report.localLatencyTargetsMet = report.phases.every((item) => item.ballotRoundTrip.p95Ms < 500 && item.hostAggregateReceiptAfterAck.p95Ms < 1000);
  report.status = report.localLatencyTargetsMet ? 'passed' : 'latency-target-missed';
  assert(report.localLatencyTargetsMet, 'Local latency targets missed; see capacity/metrics.json. Correctness checks passed.');
} catch (error) {
  if (report.status === 'running') report.status = 'failed';
  report.error = error instanceof Error ? error.message : 'Unknown capacity failure';
  throw error;
} finally {
  const observedHost = host?.getSnapshot();
  report.lastObservation = {
    hostStatus: host?.getStatus(), revision: observedHost?.revision,
    question: observedHost?.activeInteractionId, aggregate: observedHost?.aggregate,
    participantCount: observedHost?.participantCount, openParticipantSockets: openParticipantSockets(),
    answeredClients: rows.filter((row) => row.client.getSnapshot()?.answered).length,
    pollingClients: rows.filter((row) => row.client.getStatus() === 'polling').length,
    recentHostUpdates: hostObservations.slice(-10), httpFailures: Object.fromEntries(httpFailures),
  };
  for (const client of clients) client.close();
  stop.abort();
  let closed = false;
  try {
    await until(() => participantSockets.size === 0 && monitorSockets.size === 0, 'all socket close handshakes finish', 5000);
    closed = true;
  } catch (error) {
    report.status = 'failed';
    report.error ??= error.message;
  }
  report.socketShutdown = { completed: closed, remainingParticipantSockets: participantSockets.size, remainingMonitorSockets: monitorSockets.size };
  report.finishedAt = new Date().toISOString();
  report.durationMs = Math.round(now());
  clientLoop.disable();
  report.clientEventLoopDelay = { p95Ms: Math.round(clientLoop.percentile(95) / 1e5) / 10, maxMs: Math.round(clientLoop.max / 1e5) / 10 };
  await writeFile(output, JSON.stringify(report, null, 2));
  // A failed close handshake would otherwise keep the load generator alive indefinitely.
  if (!closed) process.exit(1);
}
