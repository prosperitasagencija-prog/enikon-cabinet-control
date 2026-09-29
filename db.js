const DB_NAME = 'enikonCabinetControl';
const DB_VERSION = 1;

export function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('materials')) {
        db.createObjectStore('materials', { keyPath: 'code' });
      }
      if (!db.objectStoreNames.contains('placements')) {
        const s = db.createObjectStore('placements', { keyPath: 'id' });
        s.createIndex('cabinetId', 'cabinetId', { unique: false });
        s.createIndex('materialCode', 'materialCode', { unique: false });
      }
      if (!db.objectStoreNames.contains('snapshots')) {
        const s = db.createObjectStore('snapshots', { keyPath: 'id' });
        s.createIndex('cabinetDate', ['cabinetId', 'date'], { unique: false });
        s.createIndex('materialDate', ['materialCode', 'date'], { unique: false });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function reqAsPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function countStore(storeName) {
  const db = await openDb();
  const tx = db.transaction(storeName, 'readonly');
  return reqAsPromise(tx.objectStore(storeName).count());
}

export async function getAll(storeName) {
  const db = await openDb();
  const tx = db.transaction(storeName, 'readonly');
  return reqAsPromise(tx.objectStore(storeName).getAll());
}

export async function get(storeName, key) {
  const db = await openDb();
  const tx = db.transaction(storeName, 'readonly');
  return reqAsPromise(tx.objectStore(storeName).get(key));
}

export async function put(storeName, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function putMany(storeName, values) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    values.forEach(v => store.put(v));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteKey(storeName, key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearStore(storeName) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearAll() {
  for (const s of ['materials', 'placements', 'snapshots', 'settings']) {
    await clearStore(s);
  }
}

export async function importBundle(bundle, { replace = false } = {}) {
  if (!bundle || bundle.format !== 'enikon-cabinet-control') {
    throw new Error('Datoteka nije ENIKON Cabinet Control backup/seed.');
  }
  if (replace) await clearAll();
  if (Array.isArray(bundle.materials)) await putMany('materials', bundle.materials);
  if (Array.isArray(bundle.placements)) await putMany('placements', bundle.placements);
  if (Array.isArray(bundle.snapshots)) await putMany('snapshots', bundle.snapshots);
  if (Array.isArray(bundle.cabinets)) {
    await put('settings', { key: 'cabinets', value: bundle.cabinets });
  }
  await put('settings', { key: 'lastImportAt', value: new Date().toISOString() });
}

export async function exportBundle() {
  const cabinets = (await get('settings', 'cabinets'))?.value || [
    { id: 'cabinet1', name: 'Ormar 1' },
    { id: 'cabinet2a', name: 'Ormar 2A' },
    { id: 'cabinet2b', name: 'Ormar 2B' },
  ];
  return {
    format: 'enikon-cabinet-control',
    version: 1,
    exportedAt: new Date().toISOString(),
    cabinets,
    materials: await getAll('materials'),
    placements: await getAll('placements'),
    snapshots: await getAll('snapshots'),
  };
}
