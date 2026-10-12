// Small fetch wrapper: JSON in, JSON out, errors carry the HTTP status.
export async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  // Not unlocked (or the PIN session ended): reload, the page will ask for the PIN.
  if (res.status === 401 && !url.startsWith('/api/auth/')) {
    location.reload();
    return new Promise(() => {});
  }
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw Object.assign(new Error(detail.message || res.statusText), { status: res.status });
  }
  return res.status === 204 ? null : res.json();
}
