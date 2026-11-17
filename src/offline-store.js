import { normalizeState } from './model.js';
import { applyOperation, normalizeRemote, sameBoard } from './operations.js';

const DATABASE = 'wellspan-offline-v1';
const STORE = 'workspace';
const ROW = 'current';
const makeId = () => globalThis.crypto?.randomUUID?.() || String(Date.now()) + '-' + Math.random().toString(36).slice(2);

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      resolve(database);
    };
  });
}

class OfflineStore {
  constructor(db) {
    this.db = db;
  }

  static async open() {
    return new OfflineStore(await openDatabase());
  }

  read() {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get(ROW);
      tx.oncomplete = () => resolve(request.result || null);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('IndexedDB read cancelled'));
    });
  }

  transaction(change) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE, 'readwrite');
      const objectStore = tx.objectStore(STORE);
      const request = objectStore.get(ROW);
      let result;
      let failure;
      request.onsuccess = () => {
        try {
          const altered = change(request.result || null);
          result = altered.result;
          if (altered.next !== undefined) objectStore.put(altered.next, ROW);
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(failure || tx.error);
      tx.onabort = () => reject(failure || tx.error || new Error('IndexedDB write cancelled'));
    });
  }

  initialize(board, rawRemote, bootstrapApproved = false, preserveLocal = false) {
    const projection = normalizeState(board);
    const remote = normalizeRemote(rawRemote);
    return this.transaction(current => {
      if (current) return { result: current };
      const differs = !sameBoard(remote.state, projection);
      const next = {
        ack: remote,
        projection,
        outbox: differs ? [{ id: makeId(), at: Date.now(), operation: { type: 'board.replace', board: projection } }] : [],
        bootstrapApproved,
        conflict: preserveLocal && remote.revision > 0 && differs ? remote : null
      };
      return { next, result: next };
    });
  }

  apply(operation) {
    return this.transaction(current => {
      if (!current) throw new Error('Wellspan storage has not been initialized');
      if (current.outbox.length >= 4096) throw new Error('Offline edit queue is full. Export a backup.');
      const projection = applyOperation(current.projection, operation);
      const next = {
        ...current,
        projection,
        outbox: [...current.outbox, { id: makeId(), at: Date.now(), operation: structuredClone(operation) }]
      };
      return { next, result: next };
    });
  }

  adopt(remote) {
    return this.transaction(current => {
      if (!current || current.outbox.length || current.conflict || remote.revision < current.ack.revision) {
        return { result: false };
      }
      const next = { ...current, ack: remote, projection: remote.state, bootstrapApproved: false };
      return { next, result: true };
    });
  }

  acknowledge(sent, remote) {
    return this.transaction(current => {
      if (!current || current.ack.revision !== sent.ack.revision || current.outbox.length < sent.outbox.length) {
        return { result: false };
      }
      if (!sent.outbox.every((item, index) => current.outbox[index].id === item.id)) {
        return { result: false };
      }
      const remaining = current.outbox.slice(sent.outbox.length);
      const next = {
        ...current,
        ack: remote,
        projection: remaining.length ? current.projection : remote.state,
        outbox: remaining,
        conflict: null,
        bootstrapApproved: false
      };
      return { next, result: true };
    });
  }

  markConflict(remote) {
    return this.transaction(current => {
      if (!current) return { result: false };
      const next = { ...current, conflict: remote };
      return { next, result: true };
    });
  }

  approveBootstrap() {
    return this.transaction(current => {
      if (!current || current.ack.revision !== 0 || current.conflict) throw new Error('Bootstrap approval is unavailable');
      const next = { ...current, bootstrapApproved: true };
      return { next, result: next };
    });
  }

  useServer() {
    return this.transaction(current => {
      if (!current?.conflict) throw new Error('There is no server conflict');
      const remote = current.conflict;
      const next = { ack: remote, projection: remote.state, outbox: [], bootstrapApproved: false, conflict: null };
      return { next, result: next };
    });
  }

  keepLocal() {
    return this.transaction(current => {
      if (!current?.conflict) throw new Error('There is no server conflict');
      const next = {
        ...current,
        ack: current.conflict,
        outbox: [{
          id: makeId(),
          at: Date.now(),
          operation: { type: 'board.replace', board: current.projection }
        }],
        bootstrapApproved: true,
        conflict: null
      };
      return { next, result: next };
    });
  }
}

export { OfflineStore };
