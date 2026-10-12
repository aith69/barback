-- Custom (text-only) items, extra prices on variants, price still to be decided.

-- Quick notes can add a price (0 by default). A copy is frozen on the order line.
ALTER TABLE modifiers ADD COLUMN price_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE order_line_modifiers ADD COLUMN price_cents INTEGER NOT NULL DEFAULT 0;

-- Price of a line (per unit) = base price of the item + quick notes + free-text note.
-- unit_price_cents keeps that total, so every sum in the app stays as it was.
ALTER TABLE order_lines ADD COLUMN base_price_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE order_lines ADD COLUMN note_price_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE order_lines ADD COLUMN price_pending INTEGER NOT NULL DEFAULT 0;
UPDATE order_lines SET base_price_cents = unit_price_cents;

-- Hidden item that custom lines point to: it is deleted, so it is never listed anywhere.
ALTER TABLE items ADD COLUMN is_custom INTEGER NOT NULL DEFAULT 0;
INSERT INTO categories (name, sort_order, active, deleted_at)
  VALUES ('(custom items)', 0, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
INSERT INTO items (category_id, name, price_cents, sort_order, active, deleted_at, is_custom)
  VALUES (last_insert_rowid(), 'Custom item', 0, 0, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1);
