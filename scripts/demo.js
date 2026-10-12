// Adds sample operators, menu and quick variants to an empty database: npm run demo
import { loadConfig } from '../server/config.js';
import { buildApp } from '../server/app.js';
import { seedDemo } from '../server/lib/demo.js';

const app = await buildApp({ ...loadConfig(), sharedPin: '', backupKeep: 0 });
const added = await seedDemo(app);
await app.close();
console.log(added ? 'Demo data added.' : 'The database already has data: nothing changed.');
