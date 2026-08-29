import test from 'node:test';
import assert from 'node:assert/strict';
import { getSafeLocalStorage, readStorage, writeStorage } from '../src/storage.js';

function createStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

test('usa armazenamento disponível sem deixar a chave de sondagem', () => {
  const storage = createStorage();
  const safeStorage = getSafeLocalStorage({ localStorage: storage });

  assert.equal(safeStorage, storage);
  assert.equal(storage.getItem('__organiza_plus_storage_probe__'), null);
  assert.equal(writeStorage(safeStorage, 'tasks', '{"ok":true}'), true);
  assert.equal(readStorage(safeStorage, 'tasks'), '{"ok":true}');
});

test('continua funcionando sem armazenamento quando o contexto o bloqueia', () => {
  const blockedRoot = {};
  Object.defineProperty(blockedRoot, 'localStorage', {
    get() {
      throw new DOMException('Access to storage is not allowed from this context.', 'SecurityError');
    },
  });

  const safeStorage = getSafeLocalStorage(blockedRoot);
  assert.equal(safeStorage, null);
  assert.equal(readStorage(safeStorage, 'tasks'), null);
  assert.equal(writeStorage(safeStorage, 'tasks', '{}'), false);
});

test('ignora falhas posteriores de leitura e gravação sem interromper a aplicação', () => {
  const failingStorage = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
  };

  assert.equal(readStorage(failingStorage, 'tasks'), null);
  assert.equal(writeStorage(failingStorage, 'tasks', '{}'), false);
});
