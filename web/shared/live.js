// Live updates: calls onChange (debounced) when the server says something changed,
// and once at every (re)connection. Returns a function that stops listening.
export function onLive(onChange) {
  let timer = null;
  const fire = () => {
    clearTimeout(timer);
    timer = setTimeout(onChange, 150);
  };
  const source = new EventSource('/api/events');
  source.onopen = fire;
  source.onmessage = fire;
  return () => {
    clearTimeout(timer);
    source.close();
  };
}
