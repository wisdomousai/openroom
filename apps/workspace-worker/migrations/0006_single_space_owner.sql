-- A space has one owner: spaces.owner_user_id. The member-role API used to accept 'owner',
-- which could promote a colleague to a second owner row. Those colleagues become editors.
UPDATE `space_members` SET `role` = 'editor'
 WHERE `role` = 'owner'
   AND `user_id` <> (SELECT `owner_user_id` FROM `spaces` WHERE `spaces`.`id` = `space_members`.`space_id`);
