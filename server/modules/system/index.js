// Core routes: health, public config and UI messages for the frontend.
export default async function system(app) {
  app.get('/api/health', async () => ({ status: 'ok' }));

  app.get('/api/config', async () => ({
    language: app.i18n.language,
    currency: app.config.currency,
    maxTables: app.config.tablesInside + app.config.tablesOutside,
    tablesInside: app.config.tablesInside,
    modules: app.config.modules,
  }));

  app.get('/api/i18n', async () => ({
    language: app.i18n.language,
    messages: app.i18n.messages,
  }));
}
