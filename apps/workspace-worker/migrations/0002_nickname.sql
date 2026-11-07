-- Terminology: "pseudonymous" becomes "nickname". Hard break; the old value is not kept.
-- Stored values: identityMode "pseudonymous" -> "nickname" in decks, drafts and frozen
-- session outlines. No table or column changes. The participant "handle" field exists only
-- in Durable Object live state and in R2 archives (see docs/DEPLOYMENT.md), not in D1.
UPDATE `deck_versions` SET `content_json` = REPLACE(REPLACE(`content_json`, '"identityMode":"pseudonymous"', '"identityMode":"nickname"'), '"identityMode": "pseudonymous"', '"identityMode": "nickname"') WHERE `content_json` LIKE '%"pseudonymous"%';--> statement-breakpoint
UPDATE `sessions` SET `source_outline_json` = REPLACE(REPLACE(`source_outline_json`, '"identityMode":"pseudonymous"', '"identityMode":"nickname"'), '"identityMode": "pseudonymous"', '"identityMode": "nickname"') WHERE `source_outline_json` LIKE '%"pseudonymous"%';--> statement-breakpoint
UPDATE `deck_drafts` SET `content_yaml` = REPLACE(REPLACE(REPLACE(REPLACE(`content_yaml`, 'identityMode: pseudonymous', 'identityMode: nickname'), 'identityMode: "pseudonymous"', 'identityMode: "nickname"'), 'identityMode: ''pseudonymous''', 'identityMode: ''nickname'''), '"identityMode": "pseudonymous"', '"identityMode": "nickname"') WHERE `content_yaml` LIKE '%pseudonymous%';
