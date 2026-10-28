const routes = [];
export function route(method, path, handler, opts = {}) {
  const keys = [];
  const re = new RegExp('^' + path.replace(/:([a-z]+)/gi, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, handler, opts });
}
export const get = (p, h, o) => route('GET', p, h, o);
export const post = (p, h, o) => route('POST', p, h, o);
export function match(method, pathname) {
  const m2 = method === 'HEAD' ? 'GET' : method;
  for (const r of routes) {
    if (r.method !== m2) continue;
    const m = r.re.exec(pathname);
    if (m) { try { return { r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) }; } catch { return null; } }
  }
  return null;
}
export function pathExists(pathname) { return routes.some((r) => r.re.test(pathname)); }
