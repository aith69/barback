// Login, logout and session status for the shared PIN. The check itself is an
// onRequest hook in app.js, so it covers the routes of every module.
export default async function auth(app) {
  const session = app.auth;

  // Session cookie (gone when the browser closes), not readable by scripts.
  const cookie = (req, value, maxAge) =>
    [
      `${session.cookieName}=${value}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Strict',
      ...(maxAge === undefined ? [] : [`Max-Age=${maxAge}`]),
      ...(req.headers['x-forwarded-proto'] === 'https' ? ['Secure'] : []),
    ].join('; ');

  app.get('/api/auth/status', async (req) => ({ authenticated: session.isValid(session.readToken(req)) }));

  app.post(
    '/api/auth/login',
    { schema: { body: { type: 'object', required: ['pin'], properties: { pin: { type: 'string', maxLength: 64 } } } } },
    async (req, reply) => {
      const result = session.login(req.body.pin, req.ip);
      if (result.locked) {
        return reply.code(429).send({ statusCode: 429, error: 'Too Many Requests', message: 'too many attempts' });
      }
      if (!result.ok) {
        return reply.code(401).send({ statusCode: 401, error: 'Unauthorized', message: 'wrong pin' });
      }
      reply.header('set-cookie', cookie(req, result.token));
      return reply.code(204).send();
    },
  );

  app.post('/api/auth/logout', async (req, reply) => {
    session.logout(session.readToken(req));
    reply.header('set-cookie', cookie(req, '', 0));
    return reply.code(204).send();
  });
}
