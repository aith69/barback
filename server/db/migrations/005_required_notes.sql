-- A required quick note: when an item has some, at least one of them must be chosen on the order line.
ALTER TABLE modifiers ADD COLUMN required INTEGER NOT NULL DEFAULT 0 CHECK (required IN (0, 1));
