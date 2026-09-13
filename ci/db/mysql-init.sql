-- Seed for the MySQL smoke test. Runs once, on first container start.
--
-- Mirrors ci/db/postgres-init.sql: same table names, same columns, same rows.
-- Keeping them identical is the point -- the two smoke tests then differ only
-- in the engine, so a failure on one side and not the other is a dialect
-- problem rather than a fixture problem.
--
-- `smoke_order_lines` sorts first and has a composite primary key, so the
-- picker has to reject a table before it accepts one.

CREATE TABLE smoke_order_lines (
  order_id  BIGINT   NOT NULL,
  line_no   INT      NOT NULL,
  sku       VARCHAR(64) NOT NULL,
  quantity  INT      NOT NULL,
  PRIMARY KEY (order_id, line_no)
);

CREATE TABLE smoke_orders (
  id           BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  status       VARCHAR(32)  NOT NULL,
  amount       DECIMAL(10,2) NOT NULL,
  -- tinyint(1) is what the introspector maps to `boolean`.
  is_priority  TINYINT(1)   NOT NULL DEFAULT 0,
  placed_at    DATETIME     NOT NULL,
  attributes   JSON         NOT NULL
);

CREATE INDEX smoke_orders_status_placed_at_idx ON smoke_orders (status, placed_at);

INSERT INTO smoke_orders (status, amount, is_priority, placed_at, attributes) VALUES
  ('shipped',   120.00, 0, '2026-01-05 09:00:00', '{"channel": "web",    "region": "east"}'),
  ('shipped',    75.50, 1, '2026-01-06 11:30:00', '{"channel": "mobile", "region": "west"}'),
  ('pending',   240.25, 0, '2026-02-01 15:45:00', '{"channel": "web",    "region": "east"}'),
  ('cancelled',  10.00, 0, '2026-02-14 08:15:00', '{"channel": "phone",  "region": "north"}');

INSERT INTO smoke_order_lines (order_id, line_no, sku, quantity) VALUES
  (1, 1, 'SKU-001', 2),
  (1, 2, 'SKU-002', 1),
  (2, 1, 'SKU-003', 5);
