# Recover an OpenRoom installation

`bun run verify:recovery` exports a synthetic installation and restores it into
separate, empty local D1/R2 storage. It exercises the actual bundled application
after recovery. It takes no target argument, loads no provider credentials, and
does not back up or modify a hosted installation.

The local mechanism is implemented. A scheduled hosted backup destination,
post-backup deletion journal, actual provider reconciliation and a hosted restore
rehearsal remain required before release.

## What must survive

| Store | Recovery scope |
| --- | --- |
| D1 | Accounts, spaces, folders, decks/versions, Notes, assignments, learner work/feedback, billing ownership and pending creates, media/archive indexes |
| R2 | Indexed teaching assets, retained private recordings and saved results, HTTP/custom metadata |
| Session Durable Objects | Fresh namespace after disaster recovery; old live sessions are not resumed from stale D1 state |
| Operator secret store | Configuration and provider credentials are restored separately; generate a new session-signing secret |
| Teacher's computer | Local `.openroom` files and agent credentials remain the teacher's local responsibility |

A SQL export alone cannot restore an image or voice submission. Source writes
and scheduled jobs must be quiescent across both SQL exports and the media
inventory. The drill stops its only source runtime before exporting, then reads
the retained objects without app writes. A hosted capture coordinator still needs
to implement that consistency boundary.

## Capture format

The local bundle contains `manifest.json`, `schema.sql`, `data.sql`, and
`objects/<hash-of-object-key>`. The manifest records capture time, SHA-256 and byte
length for both SQL files and every retained object, original R2 keys, metadata
and retention deadlines. Object keys never become filesystem paths. Directories
and files are private; existing output is never overwritten. The manifest is
written last, so a failed capture is not advertised as complete.

Checksums detect corruption, not malicious replacement of the entire bundle.
The backup store and provenance must be trusted and access-restricted.

Use separate schema and data exports from the **same quiescent source**. Importing
the combined local export into an empty database failed: child-row inserts
referenced a parent table that had not been created yet. Schema-first import and
deferred foreign-key checks avoid that failure. See Cloudflare's
[D1 export/import documentation](https://developers.cloudflare.com/d1/best-practices/import-export-data/).

The drill uses the installed Wrangler commands:

```sh
wrangler d1 export DB --local --no-data --output schema.sql --config LOCAL_CONFIG
wrangler d1 export DB --local --no-schema --output data.sql --config LOCAL_CONFIG
```

For the locked Wrangler version, local export uses `.wrangler/state` relative to
the config file; it has no `--persist-to` flag. The drill places its synthetic
source there in a new temporary directory. It never uses a developer's normal
local state. Hosted export requires an explicitly selected remote database;
the drill makes no hosted request.

Capture fails on missing referenced media, a D1 byte-length mismatch, an audio
checksum mismatch or an unindexed session capture. A paid archive can reach R2
before its D1 pointer succeeds; resolve that capture through archive recovery
before retrying backup. Ordinary unreferenced temporary objects are excluded.
Expired archives and recordings, including audio beyond its trash recovery
period, are excluded too.

## Restore into an isolated target

1. Select a new empty D1 database, empty R2 bucket and fresh session-object
   namespace. Record their identifiers and source snapshot in the incident record.
   Keep the target off public routes and scheduled jobs during recovery.
2. Verify provenance and every still-retained file's checksum. Import `schema.sql`,
   then `data.sql`. Do not first apply the current schema bootstrap over a backup
   that already contains its schema.
3. Check `PRAGMA foreign_key_check`, `PRAGMA quick_check`, and source/target row
   fingerprints. The drill compares every application table before preparation.
4. Restore retained objects with their original keys and metadata. Reject an
   occupied bucket; each write also requires an absent key. Read back the bytes
   and verify SHA-256. R2's [conditional write contract](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/#conditional-operations)
   prevents silently overwriting a concurrent writer's object.
5. Apply `recoveryPreparation` from `apps/worker/src/operations/recovery.ts` as one
   database batch, using the actual recovery time. These statements invalidate
   restored credentials and stale derived access before users reach the target.
6. Set a new `TOKEN_SECRET` and use the fresh live-object namespace. Restore other
   secrets separately. Keep checkout and public traffic unavailable until the
   provider/deletion reconciliation below is complete.
7. Exercise the restored application and record evidence before routing users to
   it. Preserve the source and its rollback path separately.

Preparation revokes personal tokens, connected-client tokens, learner links and
pending space invitations. It removes browser sessions, temporary auth codes and
permanent-deletion confirmations. Collaborator memberships are removed because a
member might have been removed after the backup; owners sign in afresh and share
again. Learner identity, work and feedback remain, so replacement links reconnect
to the same learner. Old live-directory entries become ended; saved results keep
their ownership and space association. Decks can start new sessions.

## Retention and changes after the backup

Recovery does not extend retention. Recordings and archives keep their original
deadlines. Objects expiring between capture and restoration are not copied.
Expired backup bytes may already have been deleted: verification permits their
absence while still checking every retained file. Submission text and tutor
feedback remain after raw audio expires.

The hosted backup service must enforce deadlines in the backup store as well as
the application store. Encryption alone is not deletion. The helper honors
deadlines during capture, verification and restoration; scheduled removal of
backup copies is not implemented yet.

Before a target becomes public, replay permanent deletions and privacy changes
made after the snapshot from an independently retained deletion journal.
Credential invalidation cannot establish which records were permanently deleted
after capture. That journal and its replay remain outstanding; the local drill
does not prove complete hosted privacy recovery.

## Rebuild billing from Paddle

Recovery preserves customer ownership, provider identifiers, checkout references
and attempted-write timestamps. It clears stale local leases while leaving
uncertain creates uncertain. Derived subscription observations, reconciliation
checkpoints and manual development grants are removed so stale state cannot
restore paid access.

Before enabling checkout, reconcile current subscriptions and customer
transactions, including creates/payments **after** the snapshot. Those transactions
may be absent from restored D1. Ordinary account refresh alone does not prove
there are no pending post-snapshot purchases. Match provider objects to saved
ownership/references and use the [Paddle support procedure](BILLING-SUPPORT.md)
for inconclusive cases. Never clear a create marker merely because D1 was restored.

Provider reconciliation after an actual restore remains a hosted acceptance task.
The drill makes no Paddle call and grants no paid access.

## Routine media cleanup

The `17 * * * *` cron runs private-audio and saved-result cleanup independently.
Each pass processes at most 100 entries per job. Saved-result lookup already
denies access at its deadline; cleanup then deletes the indexed R2 bytes before
removing the database pointer. A failed byte deletion leaves the pointer for retry.
Missing bytes are safe to retry. Current archives, Notes and learner feedback
are unaffected.

Both jobs finish even if one fails. The cron reports failure with a fixed message
and structured `retention.cleanup.failed` events naming the failed job, without
provider bodies or object keys. Successful jobs emit `retention.cleanup.completed`
with their processed count and limit. Repeated full batches or failed invocations
need operator attention; inspect the expired-index backlog with a read-only query:

```sql
SELECT COUNT(*) AS expired_archives
FROM session_archives
WHERE expires_at <= CAST(strftime('%s','now') AS INTEGER) * 1000;
```

This job removes indexed application objects. Backup-copy expiry and recovery of
unindexed captures are separate operations; hosted schedules/alerts still need
acceptance in the selected deployment.

## Verification

After building the repository, run `bun run verify:recovery`. Its redacted result
is `e2e/verification-output/recovery/run.json`. Temporary source, backup and target
stores are removed when the command finishes. CI runs the same drill and retains
the result with its verification artifacts.

The fixture includes a French deck, an image with HTTP/custom metadata, private
Notes, voice submissions and published feedback, a retained archive, an active
session, shared membership, old credentials and an uncertain Paddle create.
Checks cover:

- Exact D1 export/import for every application table, foreign keys and integrity.
- Corruption rejection, occupied-bucket rejection and refusal to omit an
  unindexed R2 archive from a supposedly complete backup.
- Fresh owner sign-in, readable deck/image/Notes/results, and a new live session.
- Rejection of old cookies, PATs, connected-client tokens, learner links and live
  host capabilities; fresh sign-in does not revive collaborator access.
- Replacement learner links preserve retained audio and feedback; expired audio
  is unavailable and absent from the target bucket.
- Billing ownership and the uncertain attempt survive; stale grants do not.

This is local storage/application evidence. It does not measure hosted recovery
time, verify offsite scheduling, replay real deletions, reconcile actual purchases
or exercise Cloudflare Time Travel against a hosted database. [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)
is a separate D1 facility and does not restore OpenRoom's corresponding R2 objects.
