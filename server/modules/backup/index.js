import { createBackupService } from './service.js';

const CHECK_EVERY_MS = 10 * 60 * 1000;

// Checks every ten minutes (and at startup, to catch up after a night off) whether today's copy is due.
export default async function backup(app) {
  const { config } = app;
  if (config.dbPath === ':memory:' || !(config.backupKeep > 0)) return;

  const svc = createBackupService(app.db, config);
  let running = false;
  const tick = async () => {
    if (running || !svc.due()) return;
    running = true;
    try {
      app.log.info(`Backup written: ${await svc.run()}`);
    } catch (err) {
      app.log.error(err, 'Backup failed');
    } finally {
      running = false;
    }
  };

  const timer = setInterval(tick, CHECK_EVERY_MS);
  timer.unref();
  app.addHook('onReady', tick);
  app.addHook('onClose', async () => clearInterval(timer));
}
