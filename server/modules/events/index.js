// Server-Sent Events: tells the open pages that something changed, so they refetch.
// The "change" events are emitted by a hook in app.js after every successful write.
export default async function events(app) {
  const clients = new Set();

  app.get('/api/events', (req, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    clients.add(res);

    const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
    app.events.on('change', send);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.raw.on('close', () => {
      clearInterval(ping);
      app.events.off('change', send);
      clients.delete(res);
    });
  });

  app.addHook('onClose', async () => {
    for (const res of clients) res.end();
  });
}
