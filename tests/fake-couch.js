/**
 * An in-memory CouchDB for the sync tests: accounts, cookie-style sessions
 * (one per fake "browser"), per-user dbs named userdb-<hex(name)>,
 * _all_docs ranges, and 409 on a stale _rev. Never touches the network.
 */

export const BASE = "https://couch.test";
const hex = (s) => [...new TextEncoder().encode(s)].map(b => b.toString(16).padStart(2, "0")).join("");

export function createFakeCouch() {
  const users = new Map();      // name -> password
  const dbs = new Map();        // db -> Map(id -> doc)
  const server = {
    users, dbs, down: false, status: null, log: [], notReady: 0, beforePut: null,
    docs: (name) => dbs.get(`userdb-${hex(name)}`) || new Map(),
    /** A fetch for one browser (its own session cookie). */
    fetchFor() {
      const browser = { user: null };
      return async (url, init = {}) => {
        if (server.down) throw new TypeError("network down");
        if (!url.startsWith(BASE)) throw new Error(`request to an unexpected host: ${url}`);
        if (init.credentials !== "include") throw new Error("request without credentials: include");
        const u = new URL(url), method = init.method || "GET";
        const body = init.body ? JSON.parse(init.body) : undefined;
        server.log.push({ method, path: u.pathname, body });
        const res = (status, json) => ({ status, json: async () => json });
        if (server.status) return res(server.status, { error: "x", reason: "forced" });

        if (u.pathname === "/_session") {
          if (method === "POST") {
            if (users.get(body.name) === body.password) { browser.user = body.name; return res(200, { ok: true }); }
            return res(401, { error: "unauthorized" });
          }
          if (method === "DELETE") { browser.user = null; return res(200, { ok: true }); }
          return res(200, { userCtx: { name: browser.user } });
        }
        const um = /^\/_users\/(.+)$/.exec(u.pathname);
        if (um && method === "PUT") {
          const name = decodeURIComponent(um[1]).replace("org.couchdb.user:", "");
          if (users.has(name)) return res(409, { error: "conflict" });
          users.set(name, body.password);
          if (!server.notReady) dbs.set(`userdb-${hex(name)}`, new Map());
          return res(201, { ok: true });
        }
        const m = /^\/(userdb-[0-9a-f]+)(?:\/(.+))?$/.exec(u.pathname);
        if (!m) return res(404, { error: "not_found" });
        if (!browser.user) return res(401, { error: "unauthorized" });
        if (m[1] !== `userdb-${hex(browser.user)}`) return res(403, { error: "forbidden" });
        if (!dbs.has(m[1])) {
          if (server.notReady > 0) { server.notReady--; return res(404, { error: "not_found", reason: "Database does not exist." }); }
          dbs.set(m[1], new Map());
        }
        const db = dbs.get(m[1]);
        const id = m[2] && decodeURIComponent(m[2]);
        if (id === "_all_docs") {
          const lo = JSON.parse(u.searchParams.get("startkey")), hi = JSON.parse(u.searchParams.get("endkey"));
          const rows = [...db.values()].filter(d => d._id >= lo && d._id <= hi).sort((a, b) => (a._id < b._id ? -1 : 1))
            .map(d => ({ id: d._id, doc: structuredClone(d) }));
          return res(200, { rows });
        }
        if (method === "GET") return db.has(id) ? res(200, structuredClone(db.get(id))) : res(404, { error: "not_found", reason: "missing" });
        if (method === "PUT") {
          server.beforePut?.(db, id);
          const cur = db.get(id);
          if (cur && body._rev !== cur._rev) return res(409, { error: "conflict" });
          if (!cur && body._rev) return res(409, { error: "conflict" });
          if (JSON.stringify(body).length > 5_000_000) return res(413, { error: "too_large" });
          const n = cur ? Number(cur._rev.split("-")[0]) + 1 : 1;
          const rev = `${n}-${Math.random().toString(16).slice(2, 10)}`;
          db.set(id, { ...structuredClone(body), _id: id, _rev: rev });
          return res(201, { ok: true, id, rev });
        }
        return res(405, { error: "method_not_allowed" });
      };
    },
  };
  return server;
}
