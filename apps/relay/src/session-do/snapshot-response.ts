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
  const hostId = url.searchParams.get('hostId') ?? '';
  // Deleting removes host identities along with participants. The Worker
  // still verifies the host capability and current account access before this
  // read; retained aggregate snapshots remain readable until the session expires.
  const ballotsDeleted = state.status === 'ended' && state.ballotsDeletedAt !== undefined;
  if (role === 'host' && !ballotsDeleted && !Object.hasOwn(state.hosting.hosts, hostId)) return json({ error: 'host-not-found' }, 403);

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
    body.hosting = { presenterId: state.hosting.presenterId, hosts: Object.values(state.hosting.hosts).map(({ id, name }) => ({ id, name })), yourId: ballotsDeleted ? '' : hostId, canPresent: !ballotsDeleted && state.hosting.presenterId === hostId, canRecover: !ballotsDeleted && url.searchParams.get('canRecover') === 'true' };
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
