import test from 'node:test';
import assert from 'node:assert/strict';
import { freshState } from '../src/model.js';
import { applyOperation } from '../src/operations.js';
import { syncOnce } from '../src/offline-sync.js';

class MemoryWorkspace {
  constructor(base, projection, revision = 1, approved = false) {
    this.current = {
      ack: { revision, state: base },
      projection,
      outbox: [{ id: 'edit-1', operation: { type: 'board.replace', board: projection } }],
      bootstrapApproved: approved,
      conflict: null
    };
  }

  async read() { return structuredClone(this.current); }
  async adopt(remote) {
    if (this.current.outbox.length) return false;
    this.current.ack = remote;
    this.current.projection = remote.state;
    return true;
  }
  async acknowledge(sent, remote) {
    if (sent.ack.revision !== this.current.ack.revision) return false;
    if (!sent.outbox.every((entry, i) => entry.id === this.current.outbox[i]?.id)) return false;
    this.current.ack = remote;
    this.current.outbox = this.current.outbox.slice(sent.outbox.length);
    if (!this.current.outbox.length) this.current.projection = remote.state;
    return true;
  }
  async markConflict(remote, revision) {
    if (this.current.ack.revision !== revision) return false;
    this.current.conflict = remote;
    return true;
  }
}

const response = (status, data) => ({ status, ok: status >= 200 && status < 300, json: async () => data });
const changed = initial => applyOperation(initial, { type: 'meal.add', meal: 'breakfast', id: initial.foods[0].id });

test('sends a conditional write only with the acknowledged revision', async () => {
  const base = freshState();
  const local = changed(base);
  const workspace = new MemoryWorkspace(base, local);
  const calls = [];
  const fetcher = async (path, options) => {
    calls.push({ path, options });
    if (!options.method) return response(200, { revision: 1, state: base });
    assert.equal(path, '/api/v1/state');
    assert.equal(options.method, 'PUT');
    assert.equal(options.headers['If-Match'], '"rev-1"');
    assert.equal(JSON.parse(options.body).meals.breakfast.length, 1);
    return response(200, { revision: 2, state: local });
  };
  assert.equal(await syncOnce(workspace, fetcher), 'synced');
  assert.equal(workspace.current.ack.revision, 2);
  assert.equal(workspace.current.outbox.length, 0);
  assert.equal(calls.length, 2);
});

test('a lost write response is recovered by re-reading server state', async () => {
  const base = freshState();
  const local = changed(base);
  const workspace = new MemoryWorkspace(base, local);
  let puts = 0;
  const fetcher = async (path, options) => {
    if (!options.method) return response(200, { revision: puts ? 2 : 1, state: puts ? local : base });
    puts++;
    throw new TypeError('Connection lost after server commit');
  };
  assert.equal(await syncOnce(workspace, fetcher), 'offline');
  assert.equal(workspace.current.outbox.length, 1);
  assert.equal(await syncOnce(workspace, fetcher), 'synced');
  assert.equal(workspace.current.outbox.length, 0);
  assert.equal(puts, 1);
});

test('409 conflict protects local edits and halts further writes', async () => {
  const base = freshState();
  const local = changed(base);
  const competing = applyOperation(base, { type: 'meal.add', meal: 'dinner', id: base.foods[1].id });
  const workspace = new MemoryWorkspace(base, local);
  let puts = 0;
  const fetcher = async (path, options) => {
    if (!options.method) return response(200, { revision: 1, state: base });
    puts++;
    return response(409, { revision: 2, state: competing });
  };
  assert.equal(await syncOnce(workspace, fetcher), 'conflict');
  assert.equal(workspace.current.outbox.length, 1);
  assert.equal(workspace.current.conflict.revision, 2);
  assert.equal(await syncOnce(workspace, fetcher), 'conflict');
  assert.equal(puts, 1);
});

test('bootstrap is blocked until explicit approval', async () => {
  const local = freshState();
  const workspace = new MemoryWorkspace(null, local, 0, false);
  const fetcher = async () => response(200, { revision: 0, state: null });
  assert.equal(await syncOnce(workspace, fetcher), 'needs-approval');
  assert.equal(workspace.current.outbox.length, 1);
});

test('offline GET cannot clear the durable journal', async () => {
  const base = freshState();
  const workspace = new MemoryWorkspace(base, changed(base));
  const offline = async () => { throw new TypeError('Network unavailable'); };
  assert.equal(await syncOnce(workspace, offline), 'offline');
  assert.equal(workspace.current.outbox.length, 1);
});
