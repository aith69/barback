// Daily copies of the SQLite database. Uses SQLite's online backup, which is safe
// while the app is running (a plain file copy of a WAL database may not be).

import fs from 'node:fs';
import path from 'node:path';

const PREFIX = 'barback-';
const EXT = '.db';

export function createBackupService(db, { backupDir, backupKeep, backupHour, timezone }) {
  const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const hourFormat = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: '2-digit', hourCycle: 'h23' });
  const day = (date) => dayFormat.format(date);
  const hour = (date) => Number(hourFormat.format(date));

  // Oldest first: the names hold the UTC time, so name order is time order.
  const list = () =>
    fs.existsSync(backupDir) ? fs.readdirSync(backupDir).filter((f) => f.startsWith(PREFIX) && f.endsWith(EXT)).sort() : [];

  const lastBackupAt = () => {
    const last = list().at(-1);
    return last ? fs.statSync(path.join(backupDir, last)).mtime : null;
  };

  function prune() {
    if (!(backupKeep > 0)) return;
    for (const f of list().slice(0, Math.max(0, list().length - backupKeep))) fs.rmSync(path.join(backupDir, f));
  }

  return {
    list,

    // Writes a new copy, then removes the oldest ones beyond `backupKeep`. Returns the file path.
    async run(now = new Date()) {
      fs.mkdirSync(backupDir, { recursive: true });
      const file = path.join(backupDir, `${PREFIX}${now.toISOString().replace(/[-:.]/g, '')}${EXT}`);
      await db.backup(file);
      prune();
      return file;
    },

    // True when it is past the backup hour (local time) and no copy was made today yet.
    due(now = new Date()) {
      const last = lastBackupAt();
      return hour(now) >= backupHour && (!last || day(last) !== day(now));
    },
  };
}
