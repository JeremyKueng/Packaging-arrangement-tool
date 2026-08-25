import test from 'node:test';
import assert from 'node:assert/strict';
import {
  safeStorageGet,
  safeStorageGetResult,
  safeStorageRemove,
  safeStorageSet,
} from '../src/storage-core.js';

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); },
  };
}

test('安全存储读写删除走 JSON，损坏数据不被静默清空', () => {
  const storage = fakeStorage({ broken: '{bad' });
  assert.deepEqual(safeStorageGet('missing', { fallback: true }, { storage }), { fallback: true });
  const broken = safeStorageGetResult('broken', { fallback: true }, { storage });
  assert.equal(broken.ok, false);
  assert.equal(broken.error, 'INVALID_JSON');
  assert.match(broken.userMessage, /损坏/);
  assert.equal(storage.map.get('broken'), '{bad');
  assert.equal(safeStorageSet('ok', { value: 1 }, { storage }).ok, true);
  assert.deepEqual(safeStorageGet('ok', null, { storage }), { value: 1 });
  assert.equal(safeStorageRemove('ok', { storage }).ok, true);
  assert.equal(storage.map.has('ok'), false);
});

test('QuotaExceededError / SecurityError 写入失败不删除旧值，并返回用户提示', () => {
  const storage = fakeStorage({ keep: '{"old":1}' });
  storage.setItem = () => { throw Object.assign(new Error('full'), { name: 'QuotaExceededError' }); };
  const quota = safeStorageSet('keep', { next: 2 }, { storage });
  assert.equal(quota.ok, false);
  assert.equal(quota.error, 'QUOTA_EXCEEDED');
  assert.match(quota.userMessage, /原有数据未被清空/);
  assert.equal(storage.map.get('keep'), '{"old":1}');

  const secure = fakeStorage({ keep: '{"old":1}' });
  secure.getItem = () => { throw Object.assign(new Error('blocked'), { name: 'SecurityError' }); };
  const read = safeStorageGetResult('keep', { fallback: true }, { storage: secure });
  assert.equal(read.ok, false);
  assert.equal(read.error, 'SECURITY_ERROR');
  assert.match(read.userMessage, /禁止访问/);
});
