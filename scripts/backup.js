// Makes a backup right now: npm run backup
import { loadConfig } from '../server/config.js';
import { openDb } from '../server/db/index.js';
import { createBackupService } from '../server/modules/backup/service.js';

const config = loadConfig();
const db = openDb(config.dbPath);
console.log(await createBackupService(db, config).run());
db.close();
