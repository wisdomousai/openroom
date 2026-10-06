import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  getSessionRecord,
  listContexts,
  listDecks,
  listSessions,
  listTrashedFolders,
  requestFolderPermanentDeletion,
  requestPermanentDeletion,
  restoreContext,
  restoreDeck,
  restoreFolder,
  restoreSession,
} from '../../api';
import {
  EmptyCollection,
  LoadState,
  PageHeading,
  TrashList,
  messageOf,
  type Notify,
} from './shared';

export function TutoringTrashPage({ notify }: { notify: Notify }) {
  const queryClient = useQueryClient();
  const trashQuery = useQuery({
    queryKey: ['trash', 'tutoring'] as const,
    queryFn: async () => {
      const [contexts, decks, sessions, folders] = await Promise.all([
        listContexts({ trash: true }),
        listDecks({ trash: true }),
        listSessions({ trash: true }),
        listTrashedFolders(),
      ]);
      /*
       * A record is not trashed on its own — it has no `deleted_at` of its
       * own and follows the session it was written for. So the Notes section
       * is "the trashed sessions that carry written notes", read one by one
       * because there is no records collection endpoint. The trash is a short
       * list, and this page is not on any hot path.
       */
      const records = (
        await Promise.all(
          sessions.map(async (session) => {
            try {
              const record = await getSessionRecord(session.id);
              return record === null ? null : { id: record.id, sessionId: session.id, title: session.title };
            } catch {
              return null;
            }
          }),
        )
      ).filter((row): row is { id: string; sessionId: string; title: string } => row !== null);
      return { contexts, decks, sessions, folders, records };
    },
  });
  const restoreMutation = useMutation({
    mutationFn: async ({ type, id }: { type: 'context' | 'deck' | 'session' | 'folder'; id: string }) => {
      if (type === 'context') return restoreContext(id);
      if (type === 'deck') return restoreDeck(id);
      if (type === 'session') return restoreSession(id);
      return restoreFolder(id);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['trash'] }),
        queryClient.invalidateQueries({ queryKey: ['contexts'] }),
        queryClient.invalidateQueries({ queryKey: ['decks'] }),
        queryClient.invalidateQueries({ queryKey: ['sessions'] }),
        queryClient.invalidateQueries({ queryKey: ['spaces'] }),
      ]);
      notify('Restored');
    },
    onError: (cause) => {
      notify(messageOf(cause, 'Could not restore'), 'error');
    },
  });

  const purge = async (type: 'context' | 'deck' | 'session', id: string) => {
    try {
      const intent = await requestPermanentDeletion(type, id);
      location.href = intent.confirmationUrl;
    } catch (cause) {
      notify(messageOf(cause, 'Could not request deletion confirmation'), 'error');
    }
  };

  const purgeFolder = async (id: string) => {
    try {
      const intent = await requestFolderPermanentDeletion(id);
      location.href = intent.confirmationUrl;
    } catch (cause) {
      notify(messageOf(cause, 'Could not request deletion confirmation'), 'error');
    }
  };

  if (!trashQuery.data) return <LoadState error={trashQuery.error ? messageOf(trashQuery.error, 'Could not load trash') : null} />;
  const { contexts, decks, sessions, folders, records } = trashQuery.data;
  const empty = contexts.length === 0 && decks.length === 0 && sessions.length === 0
    && folders.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeading title="Trash" />
      {empty ? (
        <EmptyCollection>Trash is empty.</EmptyCollection>
      ) : (
        <>
          {decks.length > 0 ? (
            <TrashList
              title="Decks"
              rows={decks.map((row) => ({ id: row.id, label: row.title }))}
              onRestore={(id) => restoreMutation.mutate({ type: 'deck', id })}
              onPurge={(id) => void purge('deck', id)}
            />
          ) : null}
          {folders.length > 0 ? (
            <TrashList
              title="Folders"
              rows={folders.map((row) => ({ id: row.id, label: row.name }))}
              onRestore={(id) => restoreMutation.mutate({ type: 'folder', id })}
              onPurge={(id) => void purgeFolder(id)}
            />
          ) : null}
          {contexts.length > 0 ? (
            <TrashList
              title="People"
              rows={contexts.map((row) => ({ id: row.id, label: row.displayName }))}
              onRestore={(id) => restoreMutation.mutate({ type: 'context', id })}
              onPurge={(id) => void purge('context', id)}
            />
          ) : null}
          {records.length > 0 ? (
            <TrashList
              title="Notes"
              rows={records.map((row) => ({ id: row.sessionId, label: row.title }))}
              onRestore={(id) => restoreMutation.mutate({ type: 'session', id })}
              onPurge={(id) => void purge('session', id)}
            />
          ) : null}
          {sessions.length > 0 ? (
            <TrashList
              title="Other"
              rows={sessions.map((row) => ({ id: row.id, label: row.title }))}
              onRestore={(id) => restoreMutation.mutate({ type: 'session', id })}
              onPurge={(id) => void purge('session', id)}
            />
          ) : null}
        </>
      )}
    </div>
  );
}
