import crypto from 'node:crypto';

const COOKIE = 'barback_session';
const MAX_FAILS = 5;
const LOCK_MS = 60_000;

// Routes that need the shared PIN. Matched on the route pattern chosen by the
// router, not on the raw URL, so encoded paths cannot slip through.
const needsPin = (method, route) =>
  route.startsWith('/api/admin/') ||
  route === '/api/stats' || route.startsWith('/api/stats/') ||
  (['GET', 'HEAD'].includes(method) && route === '/api/counter/tables') ||
  (method === 'POST' && route === '/api/counter/tables/:number/close');

const digest = (value) => crypto.createHash('sha256').update(String(value)).digest();

// Shared-PIN sessions, kept in memory: a restart asks for the PIN again.
// An empty sharedPin turns the PIN off (development, tests).
export function createAuth(config) {
  const enabled = config.sharedPin !== '' && config.sharedPin != null;
  const ttl = (config.pinSessionHours ?? 12) * 3_600_000;
  const sessions = new Map(); // token -> expiry (ms)
  const attempts = new Map(); // ip -> { fails, lockedUntil }

  return {
    enabled,
    cookieName: COOKIE,
    needsPin,

    readToken(req) {
      for (const part of (req.headers.cookie ?? '').split(';')) {
        const [name, ...rest] = part.trim().split('=');
        if (name === COOKIE) return rest.join('=');
      }
      return null;
    },

    isValid(token) {
      if (!enabled) return true;
      const expiry = sessions.get(token);
      if (!expiry) return false;
      if (expiry <= Date.now()) {
        sessions.delete(token);
        return false;
      }
      return true;
    },

    // -> { locked: true } | { ok: false } | { ok: true, token }
    login(pin, ip) {
      if (!enabled) return { ok: true, token: 'open' };
      const entry = attempts.get(ip) ?? { fails: 0, lockedUntil: 0 };
      if (entry.lockedUntil > Date.now()) return { locked: true };

      if (!crypto.timingSafeEqual(digest(pin), digest(config.sharedPin))) {
        entry.fails += 1;
        if (entry.fails >= MAX_FAILS) {
          entry.fails = 0;
          entry.lockedUntil = Date.now() + LOCK_MS;
        }
        attempts.set(ip, entry);
        return { ok: false };
      }

      attempts.delete(ip);
      for (const [token, expiry] of sessions) if (expiry <= Date.now()) sessions.delete(token);
      const token = crypto.randomBytes(24).toString('base64url');
      sessions.set(token, Date.now() + ttl);
      return { ok: true, token };
    },

    logout(token) {
      sessions.delete(token);
    },
  };
}
