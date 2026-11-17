import { decideSync, normalizeRemote, sameBoard } from './operations.js';

async function readRemote(fetchImpl) {
  const response = await fetchImpl('/api/v1/state', { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) throw new Error('Vega returned HTTP ' + response.status);
  return normalizeRemote(await response.json());
}

async function writeRemote(fetchImpl, local, method) {
  const headers = { 'Content-Type': 'application/json' };
  if (method === 'PUT') headers['If-Match'] = '"rev-' + local.ack.revision + '"';
  const response = await fetchImpl(method === 'PUT' ? '/api/v1/state' : '/api/v1/bootstrap', {
    method,
    headers,
    body: JSON.stringify(local.projection),
    cache: 'no-store',
    credentials: 'same-origin'
  });
  if (response.status === 409) return { conflict: normalizeRemote(await response.json()) };
  if (!response.ok) throw new Error('Vega rejected the edit: HTTP ' + response.status);
  const remote = normalizeRemote(await response.json());
  if (!sameBoard(remote.state, local.projection)) throw new Error('Vega returned unexpected food data');
  return { remote };
}

async function syncOnce(store, fetchImpl = fetch) {
  const local = await store.read();
  if (!local) return 'not-ready';
  if (local.conflict) return 'conflict';
  let remote;
  try {
    remote = await readRemote(fetchImpl);
  } catch (error) {
    return error instanceof TypeError ? 'offline' : 'error: ' + error.message;
  }
  const action = decideSync(local, remote);
  if (action === 'needs-approval') return 'needs-approval';
  if (action === 'conflict') {
    await store.markConflict(remote);
    return 'conflict';
  }
  if (action === 'adopt') {
    return (await store.adopt(remote)) ? 'synced' : 'retry';
  }
  if (action === 'acknowledge') {
    return (await store.acknowledge(local, remote)) ? 'synced' : 'retry';
  }
  let result;
  try {
    result = await writeRemote(fetchImpl, local, action === 'bootstrap' ? 'POST' : 'PUT');
  } catch (error) {
    return error instanceof TypeError ? 'offline' : 'error: ' + error.message;
  }
  if (result.conflict) {
    await store.markConflict(result.conflict);
    return 'conflict';
  }
  return (await store.acknowledge(local, result.remote)) ? 'synced' : 'retry';
}

function createSyncEngine(store, onStatus, fetchImpl = fetch) {
  let running = null;
  const work = async () => {
    let result = 'offline';
    for (let attempt = 0; attempt < 8; attempt++) {
      result = await syncOnce(store, fetchImpl);
      onStatus(result, await store.read());
      if (result !== 'retry' && result !== 'synced') break;
      const current = await store.read();
      if (!current?.outbox.length) break;
    }
    return result;
  };
  const sync = () => {
    if (running) return running;
    const task = () => globalThis.navigator?.locks?.request
      ? navigator.locks.request('wellspan-sync-v1', { mode: 'exclusive' }, work)
      : work();
    running = Promise.resolve().then(task).finally(() => { running = null; });
    return running;
  };
  return { sync };
}

export { readRemote, syncOnce, createSyncEngine };
