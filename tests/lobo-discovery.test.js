import test from 'node:test';
import assert from 'node:assert/strict';
import { PREFERRED_DEVICE_KEY, privateIPv4, normalizeDiscovery, preferredDevice, rememberDevice, chooseDevice } from '../src/lobo-discovery.js';

const device = (id, address = '192.168.1.200') => ({
  id, host: 'pixel.local', address, port: 7869, proto: '1', path: '/v1'
});
const candidates = () => normalizeDiscovery({ status: 'available', devices: [
  device('LOBO-8207D3'), device('LOBO-17AE84', '192.168.1.201')
]});

test('fresh DNS-SD entries become strictly typed HTTPS origins', () => {
  assert.deepEqual(candidates().map(x => [x.id, x.origin]), [
    ['LOBO-17AE84', 'https://192.168.1.201:7869'],
    ['LOBO-8207D3', 'https://192.168.1.200:7869']
  ]);
  assert.deepEqual(normalizeDiscovery({ status: 'unavailable', devices: [device('LOBO-8207D3')] }), []);
  for (const invalid of [
    device('invalid'), device('LOBO-8207D3', '8.8.8.8'),
    device('LOBO-8207D3', '127.0.0.1'),
    device('LOBO-8207D3', '169.254.1.2'),
    { ...device('LOBO-8207D3'), port: 0 },
    { ...device('LOBO-8207D3'), path: '/admin' },
    { ...device('LOBO-8207D3'), proto: '2' },
    { ...device('LOBO-8207D3'), host: 'evil.example' }
  ]) assert.deepEqual(normalizeDiscovery({ status: 'available', devices: [invalid] }), []);
  assert.deepEqual(normalizeDiscovery({ status: 'available', devices: [
    device('LOBO-8207D3'), device('LOBO-8207D3')
  ] }), []);
  assert.equal(privateIPv4('192.168.1.200'), true);
  assert.equal(privateIPv4('172.15.0.1'), false);
  assert.equal(privateIPv4('192.168.1.01'), false);
});

test('preferred identity survives a DHCP IP change and never picks a different phone', () => {
  const known = candidates();
  assert.equal(chooseDevice(known, 'LOBO-8207D3', 'https://192.168.1.50:7869').origin, 'https://192.168.1.200:7869');
  assert.equal(chooseDevice(known, 'LOBO-FFFFFF', 'https://192.168.1.50:7869'), null);
  assert.equal(chooseDevice(known, '', 'https://192.168.1.201:7869').id, 'LOBO-17AE84');
  assert.equal(chooseDevice(known, '', ''), null);
  assert.equal(chooseDevice([known[0]], '', '').id, known[0].id);
  assert.equal(chooseDevice([known[0]], '', 'https://192.168.1.50:7869'), null);
});

test('device preference is bounded and manual handoff can clear previous association', () => {
  const map = new Map();
  const storage = {
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value),
    removeItem: key => map.delete(key)
  };
  assert.equal(rememberDevice(storage, 'LOBO-8207D3'), true);
  assert.equal(map.get(PREFERRED_DEVICE_KEY), 'LOBO-8207D3');
  assert.equal(preferredDevice(storage), 'LOBO-8207D3');
  assert.equal(rememberDevice(storage, 'malicious-name'), false);
  assert.equal(preferredDevice(storage), 'LOBO-8207D3');
  assert.equal(rememberDevice(storage, ''), true);
  assert.equal(preferredDevice(storage), '');
  assert.equal(rememberDevice({getItem: () => {throw Error('denied')}}, 'LOBO-8207D3'), false);
  assert.equal(preferredDevice({getItem: () => {throw Error('denied')}}), '');
});
