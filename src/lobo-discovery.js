const PREFERRED_DEVICE_KEY = 'wellspan.lobo.preferredDevice/v1';
const DEVICE_ID = /^LOBO-[0-9A-F]{6}(?: \([2-9][0-9]*\))?$/;

function privateIPv4(value) {
  if (typeof value !== 'string') return false;
  const parts = value.split('.');
  if (parts.length !== 4 || parts.some(part => !/^(0|[1-9][0-9]{0,2})$/.test(part) || Number(part) > 255)) return false;
  const [a, b] = parts.map(Number);
  return a === 10 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168;
}

function normalizeDiscovery(reply) {
  if (!reply || reply.status !== 'available' || !Array.isArray(reply.devices) || reply.devices.length > 16) return [];
  const ids = new Set();
  const devices = [];
  for (const device of reply.devices) {
    if (!device || !DEVICE_ID.test(device.id) || ids.has(device.id) ||
      !privateIPv4(device.address) || !Number.isInteger(device.port) ||
      device.port < 1 || device.port > 65535 || device.proto !== '1' ||
      device.path !== '/v1' || typeof device.host !== 'string' ||
      !/^[a-zA-Z0-9.-]{1,253}\.local$/.test(device.host)) return [];
    ids.add(device.id);
    devices.push({ id: device.id, host: device.host, origin: `https://${device.address}:${device.port}` });
  }
  return devices.sort((a, b) => a.id.localeCompare(b.id));
}

function preferredDevice(storage) {
  try {
    const id = storage?.getItem(PREFERRED_DEVICE_KEY);
    return typeof id === 'string' && DEVICE_ID.test(id) ? id : '';
  } catch {
    return '';
  }
}

function rememberDevice(storage, id) {
  if (id !== '' && (typeof id !== 'string' || !DEVICE_ID.test(id))) return false;
  if (!storage || (id ? typeof storage.setItem !== 'function' : typeof storage.removeItem !== 'function')) return false;
  try {
    if (id) storage?.setItem(PREFERRED_DEVICE_KEY, id);
    else storage?.removeItem(PREFERRED_DEVICE_KEY);
    return !!storage;
  } catch {
    return false;
  }
}

function chooseDevice(devices, preferredId, lastOrigin) {
  if (preferredId) return devices.find(device => device.id === preferredId) || null;
  const known = devices.find(device => device.origin === lastOrigin);
  if (known) return known;
  return !lastOrigin && devices.length === 1 ? devices[0] : null;
}

export { PREFERRED_DEVICE_KEY, privateIPv4, normalizeDiscovery, preferredDevice, rememberDevice, chooseDevice };
