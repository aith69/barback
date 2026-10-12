# Barback

Lightweight, self-hosted order management for small bars: waiters take orders
from their phones on the local network, the counter prepares and cashes up.
No cash-register integration, just a reliable record of what was ordered.

## Features

- **Waiters** (`/`): table grid (inside and outside), orders with quick variants and free-text notes,
  requests outside the menu, tables ready to serve.
- **Counter** (`/counter/`): preparation queue, cash-up with discount or rounding, closing tables.
- **Admin** (`/admin/`): operators, categories, items, prices, quick variants (with optional extra price).
- **Statistics** (`/stats/`): revenue per day, week or month, products sold with their variants and
  free-text requests, requests outside the menu, CSV export.
- Live updates between phones and counter, shared PIN for counter, admin and statistics,
  daily database backup, English and Italian.

## Stack

Node.js (>= 20), Fastify, SQLite (`better-sqlite3`), vanilla JS frontend, no build step.

## Install Node.js without apt (Debian, as root)

On Debian 13 `apt install npm` pulls in hundreds of MB of dependencies. The official
tarball is much lighter (Node 22, checksum verified):

```bash
apt install -y --no-install-recommends curl ca-certificates xz-utils git
cd /tmp
ARCH=$([ "$(uname -m)" = aarch64 ] && echo arm64 || echo x64)
BASE=https://nodejs.org/dist/latest-v22.x
curl -fsSLO $BASE/SHASUMS256.txt
F=$(grep -o "node-v[0-9.]*-linux-$ARCH.tar.xz" SHASUMS256.txt | head -1)
curl -fsSLO $BASE/$F
grep " $F\$" SHASUMS256.txt | sha256sum -c -
mkdir -p /opt/node
tar -xJf $F -C /opt/node --strip-components=1
rm -rf /opt/node/include /opt/node/share
ln -sf /opt/node/bin/node /usr/local/bin/node
ln -sf /opt/node/bin/npm /usr/local/bin/npm
ln -sf /opt/node/bin/npx /usr/local/bin/npx
rm -f /tmp/$F /tmp/SHASUMS256.txt
echo 'export PATH=/opt/node/bin:$PATH' > /etc/profile.d/node.sh
export PATH=/opt/node/bin:$PATH
hash -r
node -v && npm -v
```

If a shell still says `npm: command not found`, open a new session or run
`export PATH=/opt/node/bin:$PATH`.

## Quick start

```bash
npm install
cp config.example.json config.local.json   # then edit it (language, PIN, time zone)
npm run demo                               # optional: sample menu on an empty database
npm start                                  # http://<server-ip>:3000
npm test
```

## Run it as a service (Debian, systemd)

```bash
sh deploy/install-service.sh               # as root, from the project folder
systemctl status barback
journalctl -u barback -f                   # logs
```

The service starts at boot and restarts on failure. After an update (`git pull`, `npm install`),
run `systemctl restart barback`.

## Configuration

`config.local.json` (git-ignored) overrides the defaults in `server/config.js`.
Use `BARBACK_CONFIG=/path/to/file.json` to load it from elsewhere.

| Key | Default | Notes |
|---|---|---|
| `language` | `en` | UI language (`en`, `it`, ...). Decided here, never by the browser |
| `port` / `host` | `3000` / `0.0.0.0` | |
| `currency` | `EUR` | |
| `tablesInside` | `7` | Tables 1..N are inside |
| `tablesOutside` | `13` | The following tables are outside (a line separates the two groups) |
| `timezone` | system | Splits the sales in days for the statistics, e.g. `Europe/Rome` |
| `sharedPin` | `1234` | Shared PIN for counter, admin and statistics. **Change it**; empty turns the PIN off |
| `pinSessionHours` | `12` | How long a PIN login lasts |
| `dbPath` | `data/barback.db` | SQLite database |
| `backupDir` | `data/backups` | Where the daily copies go |
| `backupKeep` | `14` | Copies to keep; `0` turns the automatic backup off |
| `backupHour` | `4` | Local hour after which the daily copy is made |
| `modules` | `{}` | Optional modules, e.g. `{ "customer": true }` (future) |

## Backup and restore

A consistent copy of the database is made every day in `data/backups/` (the last 14 are kept).
If the server was off at the backup hour, the copy is made as soon as it starts. To make one now:

```bash
npm run backup
```

To restore, stop the service, put the chosen copy in place and start it again:

```bash
systemctl stop barback
rm -f data/barback.db-wal data/barback.db-shm
cp data/backups/barback-<date>.db data/barback.db
systemctl start barback
```

Backups live on the same machine: also copy `data/backups/` somewhere else now and then
(or let the Proxmox backup of the container do it).

## Translations

`locales/<code>.json` holds flat keys (`"table.title": "Table {number}"`).
To add a language, copy `en.json` to `de.json`, translate, and run `npm test`:
the tests fail if any key or placeholder is missing. User-defined data
(menu, categories, quick variants) is stored as typed and is not translated.

## Branches

- `develop`: day-to-day work, via `feature/*` branches.

A second copy next to the stable one is handy for trying changes: clone `develop` into
`barback-dev/`, give it its own `config.local.json` (another `port`, another `sharedPin`) and
run `npm run demo`. Its database is separate. Releases are merged into `main` from the stable copy.
- `main`: stable, tagged releases only (`v1.0.0`). Merge `develop` into `main` when tests are green.

## Roadmap

Done: foundation, admin, waiters, counter, shared PIN, statistics, backup, demo data, systemd install.
Later: customer ordering via QR code, confirmed by the waiter.

## License

MIT
