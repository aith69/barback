-- "Delete" in the admin never removes rows (past orders point to them): it stamps deleted_at.
ALTER TABLE operators ADD COLUMN deleted_at TEXT;
ALTER TABLE categories ADD COLUMN deleted_at TEXT;
ALTER TABLE items ADD COLUMN deleted_at TEXT;
ALTER TABLE modifiers ADD COLUMN deleted_at TEXT;

-- Items and quick notes no longer have an "active" switch in the UI:
-- show again anything that was left hidden, it can now be deleted instead.
UPDATE items SET active = 1;
UPDATE modifiers SET active = 1;
