# Barback

Lightweight, self-hosted order management for small bars: waiters take orders
from their phones on the local network, the counter prepares and cashes up.
No cash-register integration, just a reliable record of what was ordered.

Work in progress. See the roadmap below.

## Stack

Node.js (>= 20), Fastify, SQLite (`better-sqlite3`), vanilla JS frontend, no build step.

## Quick start

```bash
npm install
cp config.example.json config.local.json   # then edit it
npm start                                  # http://<server-ip>:3000
npm test
```

## Configuration

`config.local.json` (git-ignored) overrides the defaults in `server/config.js`.
Use `BARBACK_CONFIG=/path/to/file.json` to load it from elsewhere.

| Key | Default | Notes |
|---|---|---|
| `language` | `en` | UI language (`en`, `it`, ...). Decided here, never by the browser |
| `port` / `host` | `3000` / `0.0.0.0` | |
| `tablesInside` | `7` | Tables 1..N are inside |
| `tablesOutside` | `13` | The following tables are outside (a line separates the two groups) |
| `timezone` | system | Splits the sales in days for the statistics, e.g. `Europe/Rome` |
| `sharedPin` | `1234` | Shared PIN for counter, admin and statistics. **Change it** |
| `dbPath` | `data/barback.db` | SQLite file: copy it to back up |
| `modules` | `{}` | Optional modules, e.g. `{ "customer": true }` (future) |

## Translations

`locales/<code>.json` holds flat keys (`"table.title": "Table {number}"`).
To add a language, copy `en.json` to `de.json`, translate, and run `npm test`:
the tests fail if any key or placeholder is missing. User-defined data
(menu, categories, quick notes) is stored as typed and is not translated.

## Branches

- `develop`: day-to-day work, via `feature/*` branches and pull requests.
- `main`: stable, tagged releases only (`v1.0.0`). Merge `develop` into `main` when tests are green.

## Roadmap

1. Foundation (this commit): config, DB migrations, i18n, CI
2. Admin: operators, categories, items, prices, quick notes
3. Waiter: table grid, orders
4. Counter: preparation queue, cash-up, discounts, close table
5. Shared PIN
6. Statistics and CSV export
7. Backup, demo data, systemd install
8. Later: customer ordering via QR

## License

MIT
