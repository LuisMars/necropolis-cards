/**
 * A thin CouchDB HTTP client for device sync (same pattern as the owner's
 * other apps: plain fetch, CouchDB's cookie session, no library).
 *
 * Every call returns a typed outcome and never throws, so the sync engine
 * never reads HTTP by hand: ok, unauthorized (401), forbidden (403),
 * missing (404 doc), notReady (404 db: couch_peruser creates the db a moment
 * after sign-up), conflict (409), tooLarge (413), offline (no network or
 * 5xx), error.
 *
 * Only the session cookie is kept (`credentials: "include"`); the password
 * is sent once to sign in or up and is never stored.
 */

export const DEFAULT_URL = "https://couch.luismars.com";

/** The server: <meta name="necropolis-sync" content="https://…"> wins; an
 *  empty content turns sync off; otherwise the default. */
export function configuredUrl({ doc = globalThis.document } = {}) {
  try {
    const m = doc?.querySelector?.('meta[name="necropolis-sync"]');
    if (m) return String(m.getAttribute("content") ?? "").trim().replace(/\/$/, "");
  } catch {}
  return DEFAULT_URL;
}

/** CouchDB names are case-sensitive; one person is one account. */
export const normalizeName = (email) => String(email ?? "").trim().toLowerCase();
const hex = (s) => [...new TextEncoder().encode(String(s))].map(b => b.toString(16).padStart(2, "0")).join("");
export const userDbName = (name) => `userdb-${hex(normalizeName(name))}`;

function outcome(status, body) {
  if (status >= 200 && status < 300) return "ok";
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return /database does not exist/i.test(String(body?.reason ?? "")) ? "notReady" : "missing";
  if (status === 409) return "conflict";
  if (status === 413) return "tooLarge";
  if (status >= 500) return "offline";
  return "error";
}

export function createCouchClient({ baseUrl = configuredUrl(), fetch: fetchImpl = null } = {}) {
  async function request(method, path, body) {
    if (!baseUrl) return { status: "error", body: null };
    const init = { method, credentials: "include", cache: "no-store", headers: { Accept: "application/json" } };
    if (body !== undefined) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }
    let res;
    try { res = await (fetchImpl ?? globalThis.fetch)(`${baseUrl}${path}`, init); } catch { return { status: "offline", body: null }; }
    let parsed = null;
    try { parsed = await res.json(); } catch {}
    return { status: outcome(res.status, parsed), body: parsed };
  }
  const db = (user) => `/${userDbName(user)}`;
  const docPath = (user, id) => `${db(user)}/${encodeURIComponent(id)}`;

  async function login(email, password) {
    const name = normalizeName(email);
    const r = await request("POST", "/_session", { name, password });
    return r.status === "ok" ? { status: "ok", name } : { status: r.status };
  }
  async function signup(email, password) {
    const name = normalizeName(email), id = `org.couchdb.user:${name}`;
    const r = await request("PUT", `/_users/${encodeURIComponent(id)}`, { _id: id, name, password, roles: [], type: "user" });
    return r.status === "ok" ? login(name, password) : { status: r.status };
  }
  const logout = async () => ({ status: (await request("DELETE", "/_session")).status });
  /** Who the session cookie belongs to (null when signed out or expired). */
  async function session() {
    const r = await request("GET", "/_session");
    return r.status === "ok" ? { status: "ok", name: r.body?.userCtx?.name ?? null } : { status: r.status };
  }
  /** Every document of this app (ids starting "necropolis"), with bodies. */
  async function listDocs(user) {
    const q = `include_docs=true&startkey=${encodeURIComponent(JSON.stringify("necropolis"))}&endkey=${encodeURIComponent(JSON.stringify("necropolis￰"))}`;
    const r = await request("GET", `${db(user)}/_all_docs?${q}`);
    if (r.status !== "ok") return { status: r.status };
    return { status: "ok", docs: (Array.isArray(r.body?.rows) ? r.body.rows : []).map(x => x?.doc).filter(d => d && typeof d._id === "string") };
  }
  async function getDoc(user, id) {
    const r = await request("GET", docPath(user, id));
    return r.status === "ok" ? { status: "ok", doc: r.body } : { status: r.status };
  }
  async function putDoc(user, id, doc, rev) {
    const { _id, _rev, ...rest } = doc ?? {};
    const r = await request("PUT", docPath(user, id), { _id: id, ...(rev ? { _rev: rev } : {}), ...rest });
    return r.status === "ok" ? { status: "ok", rev: r.body?.rev ?? null } : { status: r.status };
  }
  return { signup, login, logout, session, listDocs, getDoc, putDoc };
}
