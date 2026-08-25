// ===== 统一安全浏览器存储 =====
// 所有 localStorage 访问都应经由本模块。这里不清理、不覆盖旧值来“自救”——
// 写入失败时保留原值，调用方可把 userMessage 展示给用户并引导其导出数据。

export const STORAGE_SCHEMA_VERSION = 1;

function storageFrom(options = {}) {
  if (options && options.storage) return options.storage;
  try {
    return globalThis.localStorage || null;
  } catch (_) {
    // Safari 隐私模式等环境读取 localStorage 属性本身就可能抛 SecurityError。
    return null;
  }
}

function errorCode(error, fallback = 'STORAGE_ERROR') {
  const name = String(error?.name || '');
  if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') return 'QUOTA_EXCEEDED';
  if (name === 'SecurityError') return 'SECURITY_ERROR';
  if (name === 'SyntaxError') return 'INVALID_JSON';
  return fallback;
}

function userMessage(code, action = '操作') {
  switch (code) {
    case 'INVALID_JSON': return `${action}失败：浏览器中的本地预设数据已损坏。请先使用“预设 JSON 管理”导出数据，再重新导入或清理损坏数据。`;
    case 'SECURITY_ERROR': return `${action}失败：浏览器禁止访问本地存储。请检查隐私/站点存储权限后重试。`;
    case 'QUOTA_EXCEEDED': return `${action}失败：浏览器本地存储空间不足。请先导出重要预设，再删除旧预设或清理站点数据。原有数据未被清空。`;
    case 'STORAGE_UNAVAILABLE': return `${action}失败：当前浏览器未提供可用的本地存储。预设 JSON 管理仍可用于导出/导入文件。`;
    default: return `${action}失败：浏览器本地存储不可用。原有数据未被清空。`;
  }
}

function result(ok, value, extra = {}) {
  return { ok, value, ...extra };
}

/**
 * 返回带错误元数据的安全读取结果。损坏的原始字符串不会被删除，方便用户导出/恢复。
 */
export function safeStorageGetResult(key, fallback = null, options = {}) {
  const storage = storageFrom(options);
  if (!storage) {
    return result(false, fallback, {
      error: 'STORAGE_UNAVAILABLE',
      userMessage: userMessage('STORAGE_UNAVAILABLE', '读取'),
    });
  }
  try {
    const raw = storage.getItem(String(key));
    if (raw == null || raw === '') return result(true, fallback, { missing: true });
    try {
      return result(true, JSON.parse(raw), { raw });
    } catch (error) {
      const code = errorCode(error, 'INVALID_JSON');
      return result(false, fallback, {
        error: code,
        userMessage: userMessage(code, '读取'),
        raw,
      });
    }
  } catch (error) {
    const code = errorCode(error);
    return result(false, fallback, { error: code, userMessage: userMessage(code, '读取') });
  }
}

/**
 * 兼容普通调用方的读取 API：成功返回解析后的值，失败返回 fallback。
 * 需要展示错误时使用 safeStorageGetResult 或传入 onError 回调。
 */
export function safeStorageGet(key, fallback = null, options = {}) {
  const read = safeStorageGetResult(key, fallback, options);
  if (!read.ok && typeof options?.onError === 'function') options.onError(read);
  return read.value;
}

/**
 * 安全写入 JSON。序列化或 setItem 失败时绝不 removeItem，也不修改已有值。
 */
export function safeStorageSet(key, value, options = {}) {
  const storage = storageFrom(options);
  if (!storage) {
    return result(false, value, {
      error: 'STORAGE_UNAVAILABLE',
      userMessage: userMessage('STORAGE_UNAVAILABLE', '保存'),
    });
  }
  let serialized;
  try {
    serialized = JSON.stringify(value);
    if (serialized === undefined) throw Object.assign(new Error('数据无法序列化'), { name: 'SerializationError' });
  } catch (error) {
    const code = errorCode(error, 'SERIALIZATION_ERROR');
    return result(false, value, { error: code, userMessage: userMessage(code, '保存') });
  }
  try {
    storage.setItem(String(key), serialized);
    return result(true, value, { bytes: serialized.length * 2, serialized });
  } catch (error) {
    const code = errorCode(error);
    return result(false, value, {
      error: code,
      userMessage: userMessage(code, '保存'),
      bytes: serialized.length * 2,
    });
  }
}

/** 安全删除单个键；删除失败同样保留原值并返回用户提示。 */
export function safeStorageRemove(key, options = {}) {
  const storage = storageFrom(options);
  if (!storage) {
    return result(false, null, {
      error: 'STORAGE_UNAVAILABLE',
      userMessage: userMessage('STORAGE_UNAVAILABLE', '删除'),
    });
  }
  try {
    storage.removeItem(String(key));
    return result(true, null);
  } catch (error) {
    const code = errorCode(error);
    return result(false, null, { error: code, userMessage: userMessage(code, '删除') });
  }
}

export function storageErrorMessage(errorResult) {
  return errorResult?.userMessage || userMessage(errorResult?.error, '操作');
}

// 供开发者工具/最轻冒烟脚本读取能力，不遍历 localStorage，避免隐私模式额外抛错。
export function isStorageAvailable(options = {}) {
  const storage = storageFrom(options);
  if (!storage) return false;
  try {
    return typeof storage.getItem === 'function'
      && typeof storage.setItem === 'function'
      && typeof storage.removeItem === 'function';
  } catch (_) {
    return false;
  }
}
