import type { SessionState } from '@openroom/domain';

import { absolutizeJoinUrl, type JoinOriginEnv } from '../join-url.js';
import {
  hostWireSnapshot,
  participantWireSnapshot,
  stageWireSnapshot,
  type WireJson as Json,
} from '@openroom/domain';
import type { Role } from '../tokens.js';
import { json } from './http.js';

interface SnapshotDeps {
  state: SessionState;
  joinEnv: JoinOriginEnv;
}

/**
 * The role-shaped wire snapshot for one poll of `GET /state`.
 * Pure over its inputs; the class owns loading state.
 */
export function snapshotResponse(deps: SnapshotDeps, url: URL): Response {
  const { state, joinEnv } = deps;

  const role = url.searchParams.get('role') as Role | null;
  const facilitatorId = url.searchParams.get('facilitatorId') ?? '';
  // Purging removes facilitator identities along with participants. The Worker
  // still verifies the host capability and current account access before this
  // read; retained aggregate snapshots remain readable until the session expires.
  const purged = state.status === 'ended' && state.purgedAt !== undefined;
  if (role === 'host' && !purged && !Object.hasOwn(state.facilitation.facilitators, facilitatorId)) return json({ error: 'facilitator-not-found' }, 403);

  const afterParam = url.searchParams.get('afterRevision');
  if (afterParam !== null) {
    const after = Number(afterParam);
    if (Number.isFinite(after) && state.revision <= after) {
      return new Response(null, {
        status: 304,
        headers: { 'cache-control': 'no-store', etag: `"${state.revision}"` },
      });
    }
  }

  const participantId = url.searchParams.get('participantId') ?? '';
  let body: Json;
  if (role === 'host') {
    body = hostWireSnapshot(state);
    body.facilitation = { presenterId: state.facilitation.presenterId, facilitators: Object.values(state.facilitation.facilitators).map(({ id, name }) => ({ id, name })), yourId: purged ? '' : facilitatorId, canPresent: !purged && state.facilitation.presenterId === facilitatorId, canRecover: !purged && url.searchParams.get('canRecover') === 'true' };
  } else if (role === 'stage') {
    body = stageWireSnapshot(state);
  } else {
    body = participantWireSnapshot(state, participantId);
  }
  if (typeof body.joinUrl === 'string') {
    body.joinUrl = absolutizeJoinUrl(joinEnv, body.joinUrl);
  }
  return json(body, 200, { etag: `"${state.revision}"` });
}
