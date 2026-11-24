const BASE = '/api/v1';
let accessToken = null;

async function send(path, { method = 'GET', body } = {}) {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  return fetch(BASE + path, {
    method,
    credentials: 'include',
    headers: { ...(!isForm && { 'Content-Type': 'application/json' }), ...(accessToken && { Authorization: `Bearer ${accessToken}` }) },
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });
}

export async function refreshSession() {
  const res = await send('/auth/refresh', { method: 'POST' });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) { accessToken = null; return null; }
  accessToken = json.data.accessToken;
  return json.data.user;
}

export async function api(path, options) {
  let res = await send(path, options);
  if (res.status === 401 && !path.startsWith('/auth/') && (await refreshSession())) res = await send(path, options);
  const json = res.status === 204 ? {} : await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(json.message || 'Something went wrong. Please try again.'), { status: res.status, errors: json.errors || [] });
  }
  if (json.data?.accessToken) accessToken = json.data.accessToken;
  return json;
}

// For protected files such as ID documents: returns a blob the caller can open.
export async function apiBlob(path) {
  let res = await send(path);
  if (res.status === 401 && (await refreshSession())) res = await send(path);
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.message || 'Could not open the file');
  }
  return res.blob();
}

export const clearToken = () => { accessToken = null; };
