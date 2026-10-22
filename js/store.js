'use strict';
// Things the phone keeps for you between visits, in IndexedDB (never sent anywhere): your songs and your
// own sound pack. Every call fails soft: a private window or a full disk just means nothing is remembered.
(function () {
  const C = window.COSMOS;
  const NAME = 'cosmos', VERSION = 1;
  const STORES = ['songs', 'samples', 'kv', 'worlds', 'journal'];
  let opening = null;

  function open() {
    if (opening) return opening;
    opening = new Promise((resolve) => {
      if (!window.indexedDB) return resolve(null);
      let req;
      try { req = indexedDB.open(NAME, VERSION); } catch (e) { return resolve(null); }
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, s === 'kv' ? undefined : { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    });
    return opening;
  }

  function run(store, mode, fn) {
    return open().then((db) => new Promise((resolve, reject) => {
      if (!db) return reject(new Error('storage unavailable'));
      let out;
      const tx = db.transaction(store, mode);
      tx.oncomplete = () => resolve(out);
      tx.onerror = () => reject(tx.error || new Error('storage error'));
      tx.onabort = () => reject(tx.error || new Error('storage aborted'));
      const r = fn(tx.objectStore(store));
      if (r) r.onsuccess = () => { out = r.result; };
    }));
  }

  C.db = {
    available: () => open().then((db) => !!db),
    put: (store, value, key) => run(store, 'readwrite', (s) => (key === undefined ? s.put(value) : s.put(value, key))),
    get: (store, key) => run(store, 'readonly', (s) => s.get(key)),
    all: (store) => run(store, 'readonly', (s) => s.getAll()),
    keys: (store) => run(store, 'readonly', (s) => s.getAllKeys()),
    del: (store, key) => run(store, 'readwrite', (s) => s.delete(key)),
    clear: (store) => run(store, 'readwrite', (s) => s.clear()),
    // ask the browser not to evict what we keep (songs especially); a refusal is fine
    persist: () => { try { if (navigator.storage && navigator.storage.persist) return navigator.storage.persist(); } catch (e) {} return Promise.resolve(false); },
  };
})();
