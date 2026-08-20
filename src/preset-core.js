// ===== 预设标准化纯函数 =====
// 只依赖 dimensions 配置，不访问 DOM / UI / localStorage，可直接在 Node 中单测。

import {
  catalog,
  HANDLE_SIDES,
  ROLL_CORES,
  ROLL_BUNDLE_MODES,
  DIRECT_SPINS,
  LOAD_FACES,
  UNIT_POSTURES,
  UNIT_FACINGS,
  PRODUCT_ORIENTATIONS,
  LEGACY_UNIT_POSES,
  STACK_MODES,
  SOFTDRAW_VARIANTS,
  HANGING_SIDE_DIRECTIONS,
  normalizeProductSizeOverride,
} from './dimensions.js';
import { normalizeCaseDividerMode } from './case-divider.js';

export function clampPresetNumber(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(Number(value) || min)));
}

export function outerLevelName(level) {
  return level === 'bigpack' ? '大包' : '装箱';
}

export function outerDefaults(level) {
  const label = outerLevelName(level);
  return {
    name: `${label}临时方案`,
    unit: 'midpack',
    rows: 2,
    cols: 1,
    layers: 1,
    spacing: 0,
    margin: 0.05,
    loadFace: level === 'bigpack' ? 'z-' : 'y+',
    unitPosture: 'flat',
    unitFacing: 'z-',
    productOrientation: 'upright',
    // 直装（单粒直接装入）时绕竖直轴的剩余旋转：'none' 默认不旋转，'90' 旋转 90°。
    directSpin: 'none',
    rollCore: 'cored',
    rollBundleMode: 'single',
    rollBundleX: 1,
    rollBundleZ: 1,
    rollBundleY: 1,
    stackMode: 'same',
    // 装箱内部固定：none | cross。旧方案缺失时自动回退为无挡板。
    dividerMode: 'none',
    // 装箱正式名称的方案级修订；留空时由箱体最终长边与装入物姿态自动生成。
    formalNameOverride: '',
    source: null, // 临时方案默认未绑定来源；保存时由 UI 捕获绑定。
  };
}

export function normalizePreset(type, record, fallback = {}) {
  const orientationValues = catalog[type].orientations.map(item => item[0]);
  const orientation = orientationValues.includes(record?.orientation) ? record.orientation : (fallback.orientation || orientationValues[0]);
  const handleSide = HANDLE_SIDES.includes(record?.handleSide)
    ? record.handleSide
    : (HANDLE_SIDES.includes(fallback.handleSide) ? fallback.handleSide : null);
  const rollCore = type === 'roll' && ROLL_CORES.includes(record?.rollCore)
    ? record.rollCore
    : (type === 'roll' && ROLL_CORES.includes(fallback.rollCore) ? fallback.rollCore : 'cored');
  const rollBundleMode = type === 'roll' && ROLL_BUNDLE_MODES.includes(record?.rollBundleMode)
    ? record.rollBundleMode
    : (type === 'roll' && ROLL_BUNDLE_MODES.includes(fallback.rollBundleMode) ? fallback.rollBundleMode : 'single');
  const softdrawVariant = type === 'softdraw' && SOFTDRAW_VARIANTS.includes(record?.softdrawVariant)
    ? record.softdrawVariant
    : (type === 'softdraw' && SOFTDRAW_VARIANTS.includes(fallback.softdrawVariant) ? fallback.softdrawVariant : 'standard');
  // 兼容前两版误命名字段；新字段仅表示侧立时整包绕提手面法向旋转的方向，
  // 不单独旋转提手附件，也不作用于平放。
  const requestedSideDirection = record?.hangingSideDirection ?? record?.hangingFlatDirection ?? record?.hangingHandleDirection;
  const fallbackSideDirection = fallback?.hangingSideDirection ?? fallback?.hangingFlatDirection ?? fallback?.hangingHandleDirection;
  const hangingSideDirection = type === 'softdraw' && HANGING_SIDE_DIRECTIONS.includes(requestedSideDirection)
    ? requestedSideDirection
    : (type === 'softdraw' && HANGING_SIDE_DIRECTIONS.includes(fallbackSideDirection) ? fallbackSideDirection : 'parallel');
  return {
    name: String(record?.name || fallback.name || '未命名预设').trim().slice(0, 40) || '未命名预设',
    rows: clampPresetNumber(record?.rows ?? fallback.rows, 1, 25),
    cols: clampPresetNumber(record?.cols ?? fallback.cols, 1, 20),
    layers: clampPresetNumber(record?.layers ?? fallback.layers, 1, 8),
    orientation,
    softdrawVariant,
    hangingSideDirection,
    handleSide,
    rollCore,
    rollBundleMode: rollCore === 'coreless' ? 'single' : rollBundleMode,
    rollBundleX: clampPresetNumber(record?.rollBundleX ?? fallback.rollBundleX ?? 1, 1, 8),
    rollBundleZ: clampPresetNumber(record?.rollBundleZ ?? fallback.rollBundleZ ?? 1, 1, 8),
    rollBundleY: clampPresetNumber(record?.rollBundleY ?? fallback.rollBundleY ?? 1, 1, 6),
    // 小粒尺寸快照：历史方案/PDF 复现用，独立于 catalog，不污染内置预设默认。
    dimensionsMm: normalizeProductSizeOverride(type, record?.dimensionsMm ?? fallback.dimensionsMm),
  };
}

// 直装来源快照规范化：朝向回退、卫卷规格夹取。返回 null 表示 productType 非法。
export function normalizeDirectProductSnapshot(productType, snapshot) {
  const data = catalog[productType];
  if (!data) return null;
  const orientations = data.orientations.map(o => o[0]);
  if (productType === 'softdraw') orientations.unshift('upright'); // 直立仅用于小粒直装
  const orientation = orientations.includes(snapshot?.orientation) ? snapshot.orientation : orientations[0];
  const rollCore = ROLL_CORES.includes(snapshot?.rollCore) ? snapshot.rollCore : 'cored';
  const requestedBundleMode = ROLL_BUNDLE_MODES.includes(snapshot?.rollBundleMode) ? snapshot.rollBundleMode : 'single';
  return {
    orientation,
    // 直装软抽的侧立尺寸与朝向依赖提手端；即使其他品类暂不使用，也保留统一快照口径。
    handleSide: HANDLE_SIDES.includes(snapshot?.handleSide) ? snapshot.handleSide : 'z-',
    softdrawVariant: productType === 'softdraw' && SOFTDRAW_VARIANTS.includes(snapshot?.softdrawVariant)
      ? snapshot.softdrawVariant
      : 'standard',
    hangingSideDirection: productType === 'softdraw' && HANGING_SIDE_DIRECTIONS.includes(snapshot?.hangingSideDirection ?? snapshot?.hangingFlatDirection ?? snapshot?.hangingHandleDirection)
      ? (snapshot.hangingSideDirection ?? snapshot.hangingFlatDirection ?? snapshot.hangingHandleDirection)
      : 'parallel',
    rollCore,
    rollBundleMode: rollCore === 'coreless' ? 'single' : requestedBundleMode,
    rollBundleX: clampPresetNumber(snapshot?.rollBundleX ?? 1, 1, 8),
    rollBundleZ: clampPresetNumber(snapshot?.rollBundleZ ?? 1, 1, 8),
    rollBundleY: clampPresetNumber(snapshot?.rollBundleY ?? 1, 1, 6),
    dimensionsMm: normalizeProductSizeOverride(productType, snapshot?.dimensionsMm),
  };
}

// 合并导入内置预设修改时坚持“本地优先”：导入文件不得静默覆盖当前浏览器已有修改。
// 返回统计供界面明确提示冲突；targetOverrides 原地追加合法且不存在的条目。
export function mergeBuiltinOverridesPreservingExisting(targetOverrides, importedOverrides) {
  const target = targetOverrides && typeof targetOverrides === 'object' && !Array.isArray(targetOverrides)
    ? targetOverrides
    : {};
  const imported = importedOverrides && typeof importedOverrides === 'object' && !Array.isArray(importedOverrides)
    ? importedOverrides
    : {};
  const stats = { added: 0, skippedConflicts: 0, skippedInvalid: 0 };
  for (const [id, value] of Object.entries(imported)) {
    if (typeof id !== 'string' || !id.startsWith('builtin:') || !value || typeof value !== 'object' || Array.isArray(value)) {
      stats.skippedInvalid++;
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(target, id)) {
      stats.skippedConflicts++;
      continue;
    }
    target[id] = JSON.parse(JSON.stringify(value));
    stats.added++;
  }
  return stats;
}

// 按来源类型规范化快照字段：中包走 normalizePreset（夹取/回退），直装走 normalizeDirectProductSnapshot。
function normalizeOuterSourceSnapshot(source) {
  if (source.type === 'midpack') {
    const { name, ...snapshot } = normalizePreset(source.productType, source.snapshot);
    return snapshot;
  }
  return normalizeDirectProductSnapshot(source.productType, source.snapshot);
}

// 外包装方案来源绑定：{ type: midpack|product, productType, presetId, presetName, snapshot }。
// source 为空/非法（缺 productType 或 snapshot 非对象）返回 null（旧方案未绑定，不能稳定批量导出）。
export function normalizeOuterSource(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  const type = source.type === 'product' ? 'product' : 'midpack';
  if (typeof source.productType !== 'string' || !catalog[source.productType]) return null;
  if (!source.snapshot || typeof source.snapshot !== 'object' || Array.isArray(source.snapshot)) return null;
  const snapshot = normalizeOuterSourceSnapshot({ type, productType: source.productType, snapshot: source.snapshot });
  if (!snapshot) return null;
  return {
    type,
    productType: source.productType,
    presetId: typeof source.presetId === 'string' ? source.presetId : null,
    presetName: typeof source.presetName === 'string' ? source.presetName : null,
    snapshot,
  };
}

export function normalizeOuterPreset(level, record, fallback = outerDefaults(level)) {
  const source = record || {};
  const clampDecimal = (value, min, max, defaultValue) => Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : defaultValue));
  return {
    name: String(source.name ?? fallback.name ?? `${outerLevelName(level)}临时方案`).trim().slice(0, 40) || `${outerLevelName(level)}临时方案`,
    unit: source.unit === 'product' ? 'product' : 'midpack',
    rows: clampPresetNumber(source.rows ?? fallback.rows, 1, 25),
    cols: clampPresetNumber(source.cols ?? fallback.cols, 1, 20),
    layers: clampPresetNumber(source.layers ?? fallback.layers, 1, 8),
    spacing: Math.round(clampDecimal(source.spacing, 0, 2, Number.isFinite(Number(fallback.spacing)) ? Number(fallback.spacing) : 0) * 100) / 100,
    margin: Math.round(clampDecimal(source.margin, 0, 2, Number.isFinite(Number(fallback.margin)) ? Number(fallback.margin) : 0.05) * 100) / 100,
    loadFace: LOAD_FACES.includes(source.loadFace) ? source.loadFace : fallback.loadFace,
    unitPosture: UNIT_POSTURES.includes(source.unitPosture)
      ? source.unitPosture
      : (UNIT_POSTURES.includes(fallback.unitPosture) ? fallback.unitPosture : 'flat'),
    unitFacing: UNIT_FACINGS.includes(source.unitFacing)
      ? source.unitFacing
      : (LEGACY_UNIT_POSES.includes(source.unitPose) ? source.unitPose.slice(5) : (UNIT_FACINGS.includes(fallback.unitFacing) ? fallback.unitFacing : 'z-')),
    productOrientation: PRODUCT_ORIENTATIONS.includes(source.productOrientation)
      ? source.productOrientation
      : (PRODUCT_ORIENTATIONS.includes(fallback.productOrientation) ? fallback.productOrientation : 'flat'),
    // 直装剩余旋转仅对 unit === 'product' 有意义；旧方案缺失时回退 'none'。
    directSpin: DIRECT_SPINS.includes(source.directSpin)
      ? source.directSpin
      : (DIRECT_SPINS.includes(fallback.directSpin) ? fallback.directSpin : 'none'),
    rollCore: ROLL_CORES.includes(source.rollCore)
      ? source.rollCore
      : (ROLL_CORES.includes(fallback.rollCore) ? fallback.rollCore : 'cored'),
    rollBundleMode: ROLL_BUNDLE_MODES.includes(source.rollBundleMode)
      ? source.rollBundleMode
      : (ROLL_BUNDLE_MODES.includes(fallback.rollBundleMode) ? fallback.rollBundleMode : 'single'),
    rollBundleX: clampPresetNumber(source.rollBundleX ?? fallback.rollBundleX ?? 1, 1, 8),
    rollBundleZ: clampPresetNumber(source.rollBundleZ ?? fallback.rollBundleZ ?? 1, 1, 8),
    rollBundleY: clampPresetNumber(source.rollBundleY ?? fallback.rollBundleY ?? 1, 1, 6),
    stackMode: STACK_MODES.includes(source.stackMode) ? source.stackMode : fallback.stackMode,
    dividerMode: level === 'case'
      ? normalizeCaseDividerMode(source.dividerMode ?? fallback.dividerMode)
      : 'none',
    formalNameOverride: String(source.formalNameOverride ?? fallback.formalNameOverride ?? '').trim().slice(0, 80),
    source: normalizeOuterSource(source.source ?? fallback.source),
  };
}
