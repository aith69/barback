-- Money is stored as integer cents. Timestamps are UTC ISO-8601 text.

CREATE TABLE operators (
  id     INTEGER PRIMARY KEY,
  name   TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE TABLE categories (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active     INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE TABLE items (
  id          INTEGER PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES categories (id),
  name        TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  sold_out    INTEGER NOT NULL DEFAULT 0 CHECK (sold_out IN (0, 1))
);
CREATE INDEX idx_items_category ON items (category_id);

-- Quick notes defined by the admin. Attached to a category (inherited by all
-- its items) or to a single item, never both.
CREATE TABLE modifiers (
  id          INTEGER PRIMARY KEY,
  category_id INTEGER REFERENCES categories (id),
  item_id     INTEGER REFERENCES items (id),
  name        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  CHECK ((category_id IS NULL) <> (item_id IS NULL))
);

-- Tables are plain numbers (1..maxTables from config), so no tables entity.
CREATE TABLE orders (
  id               INTEGER PRIMARY KEY,
  table_number     INTEGER NOT NULL CHECK (table_number > 0),
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  opened_by        INTEGER REFERENCES operators (id),
  opened_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  closed_by        INTEGER REFERENCES operators (id),
  closed_at        TEXT,
  subtotal_cents   INTEGER NOT NULL DEFAULT 0,
  adjustment_cents INTEGER NOT NULL DEFAULT 0, -- discount (<0) or rounding, signed
  total_paid_cents INTEGER
);
CREATE UNIQUE INDEX idx_one_open_order_per_table ON orders (table_number) WHERE status = 'open';
CREATE INDEX idx_orders_closed_at ON orders (closed_at);

CREATE TABLE order_lines (
  id               INTEGER PRIMARY KEY,
  order_id         INTEGER NOT NULL REFERENCES orders (id),
  item_id          INTEGER NOT NULL REFERENCES items (id),
  item_name        TEXT NOT NULL,    -- snapshot, survives renames
  quantity         INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_cents INTEGER NOT NULL, -- snapshot, survives price changes
  note             TEXT,             -- free text, not used in statistics
  status           TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('pending_confirm', 'new', 'prepared')),
  created_by       INTEGER REFERENCES operators (id),
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  removed_at       TEXT,             -- soft delete
  removed_by       INTEGER REFERENCES operators (id)
);
CREATE INDEX idx_order_lines_order ON order_lines (order_id);

-- Quick notes chosen on a line: feeds the "most requested changes" statistics.
CREATE TABLE order_line_modifiers (
  order_line_id INTEGER NOT NULL REFERENCES order_lines (id) ON DELETE CASCADE,
  modifier_id   INTEGER NOT NULL REFERENCES modifiers (id),
  modifier_name TEXT NOT NULL,       -- snapshot
  PRIMARY KEY (order_line_id, modifier_id)
);
