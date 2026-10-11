// Small fetch wrapper: JSON in, JSON out, errors carry the HTTP status.
export async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw Object.assign(new Error(detail.message || res.statusText), { status: res.status });
  }
  return res.status === 204 ? null : res.json();
}
