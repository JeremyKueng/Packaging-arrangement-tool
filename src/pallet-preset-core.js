// ===== 叠板预设标准化 =====
// 叠板方案独立于大包/装箱预设；v2 保存包装类型和叠板参数本身，
// 不再要求保存上游方案快照。

import {
  PALLET_SIZE_MM,
  PALLET_HEIGHT_RANGE_MM,
  PALLET_LOAD_HEIGHT_RANGE_MM,
  PALLET_LAYER_STRATEGIES,
  PALLET_ALGORITHM_VERSION,
  normalizePackageType,
  normalizePalletOptions,
} from './pallet-core.js';

export const PALLET_PRESET_SCHEMA_VERSION = 7;

function plain(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value, fallback, max = 60) {
  const result = String(value ?? fallback).trim().slice(0, max);
  return result || fallback;
}

function numberInRange(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function stableSerialize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
}

function stableHash(value) {
  // FNV-1a 32-bit：仅用于可复现的方案标识，不承担安全校验职责。
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function algorithmInputFromOptions(options) {
  return {
    packageType: options.packageType,
    unitSizeMm: { ...options.unitSizeMm },
    pallet: { ...options.pallet },
    loadHeightMm: options.loadHeightMm,
    overhangMm: options.overhangMm,
    allowedOrientations: [...options.allowedOrientations],
    layerStrategy: options.layerStrategy,
    basePattern: [...options.basePattern],
    faceConstraint: { ...options.faceConstraint },
    softpackOptions: { ...options.softpackOptions },
    maxCandidates: options.maxCandidates,
  };
}

function canonicalFromRecord(record, fallback) {
  const value = record?.packageType
    ?? record?.algorithmInput?.packageType
    ?? record?.source?.type
    ?? record?.source?.packageType;
  return normalizePackageType(value)
    || normalizePackageType(fallback?.packageType ?? fallback?.algorithmInput?.packageType ?? fallback?.source?.type ?? fallback?.source?.packageType)
    || 'case';
}

function dimensionsValue(raw) {
  const d = plain(raw) ? raw : {};
  const clamp = value => numberInRange(value, 1, 5000, 1);
  return {
    lengthMm: clamp(d.lengthMm ?? d.length),
    widthMm: clamp(d.widthMm ?? d.width),
    heightMm: clamp(d.heightMm ?? d.height),
  };
}

function normalizeSoftpackPresetOptions(record, fallback, packageType) {
  const raw = plain(record?.softpackOptions) ? record.softpackOptions : {};
  const fallbackOptions = plain(fallback?.softpackOptions) ? fallback.softpackOptions : {};
  const legacy = plain(record?.cornerProtection)
    ? record.cornerProtection
    : (plain(fallback?.cornerProtection) ? fallback.cornerProtection : {});
  const loss = Number.isFinite(Number(legacy.offsetMm)) ? Number(legacy.offsetMm) : 0;
  const fallbackLossLength = Number.isFinite(Number(fallbackOptions.cornerLossLengthMm))
    ? Number(fallbackOptions.cornerLossLengthMm)
    : loss;
  const fallbackLossWidth = Number.isFinite(Number(fallbackOptions.cornerLossWidthMm))
    ? Number(fallbackOptions.cornerLossWidthMm)
    : loss;
  const enabled = raw.cornerProtectorsEnabled ?? legacy.enabled ?? fallbackOptions.cornerProtectorsEnabled;
  // 兼容旧方案时，当前记录里的布尔开关必须优先于默认值中的 off。
  // 否则 allowTopSideLay:true 会被 fallbackOptions.topSideLayMode:'off' 静默覆盖。
  const explicitLegacySideLay = raw.allowTopSideLay ?? record?.allowTopLayerLying;
  const fallbackLegacySideLay = fallbackOptions.allowTopSideLay ?? fallback?.allowTopLayerLying;
  const requestedMode = raw.topSideLayMode
    ?? (explicitLegacySideLay != null ? (explicitLegacySideLay ? 'auto' : 'off') : null)
    ?? fallbackOptions.topSideLayMode
    ?? (fallbackLegacySideLay ? 'auto' : 'off');
  const topSideLayMode = packageType !== 'softpack'
    ? 'off'
    : ['off', 'auto', 'force'].includes(requestedMode)
      ? requestedMode
      : 'off';
  return {
    // normalizePalletOptions applies the packageType gate to effective corner geometry.
    cornerProtectorsEnabled: packageType === 'softpack' && Boolean(enabled),
    cornerLossLengthMm: numberInRange(raw.cornerLossLengthMm ?? fallbackLossLength, 0, 200, 0),
    cornerLossWidthMm: numberInRange(raw.cornerLossWidthMm ?? fallbackLossWidth, 0, 200, 0),
    topSideLayMode,
    allowTopSideLay: topSideLayMode !== 'off',
  };
}

function normalizeSolution(raw, legacyPlacementCount, options) {
  if (!plain(raw) && !legacyPlacementCount) return null;
  const source = plain(raw) ? raw : {};
  const surface = numberInRange(
    source.surfaceUtilization ?? source.fullPalletRate ?? source.footprintUtilization,
    0,
    1,
    0,
  );
  const rawTotalHeight = Number(source.totalHeightMm);
  const totalHeightMm = Math.max(0, Number.isFinite(rawTotalHeight) ? rawTotalHeight : 0);
  const rawActualHeight = Number(source.actualLoadHeightMm);
  const actualLoadHeightMm = Math.max(0, Number.isFinite(rawActualHeight)
    ? rawActualHeight
    : Math.max(0, totalHeightMm - PALLET_SIZE_MM.height));
  const loadHeightMm = Number(options?.loadHeightMm) || Math.max(0, Number(options?.heightLimitMm) - PALLET_SIZE_MM.height);
  const heightUtilization = loadHeightMm + PALLET_SIZE_MM.height > 0
    ? (actualLoadHeightMm + PALLET_SIZE_MM.height) / (loadHeightMm + PALLET_SIZE_MM.height)
    : 0;
  const derivedFullPalletRate = Math.min(1, surface * heightUtilization);
  const optionalNonNegative = value => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, n) : null;
  };
  const rawItemsPerLayer = Array.isArray(source.itemsPerLayer)
    ? source.itemsPerLayer.map(value => Math.max(0, Math.round(Number(value) || 0))).slice(0, 32)
    : [];
  const rawLayerCount = Number(source.layerCount);
  const rawTotalCount = Number(source.totalCount);
  return {
    totalCount: Math.max(0, Math.round(Number.isFinite(rawTotalCount) ? rawTotalCount : legacyPlacementCount)),
    layerCount: Math.max(0, Math.round(Number.isFinite(rawLayerCount) ? rawLayerCount : rawItemsPerLayer.length)),
    itemsPerLayer: rawItemsPerLayer,
    actualLoadHeightMm,
    totalHeightMm,
    occupiedLengthMm: optionalNonNegative(source.occupiedLengthMm),
    occupiedWidthMm: optionalNonNegative(source.occupiedWidthMm),
    remainingLengthMm: optionalNonNegative(source.remainingLengthMm),
    remainingWidthMm: optionalNonNegative(source.remainingWidthMm),
    remainingHeightMm: optionalNonNegative(source.remainingHeightMm)
      ?? Math.max(0, loadHeightMm - actualLoadHeightMm),
    heightUtilization: numberInRange(heightUtilization, 0, 1, 0),
    palletYieldRate: numberInRange(derivedFullPalletRate, 0, 1, 0),
    surfaceUtilization: surface,
    fullPalletRate: numberInRange(derivedFullPalletRate, 0, 1, 0),
    footprintUtilization: surface,
    volumeUtilization: numberInRange(source.volumeUtilization, 0, 1, 0),
    minSupportRatio: numberInRange(source.minSupportRatio, 0, 1, 0),
    averageSupportRatio: numberInRange(source.averageSupportRatio, 0, 1, 0),
    pattern: Array.isArray(source.pattern) ? source.pattern.map(String).slice(0, 32) : [],
  };
}

export function palletDefaults(packageType = 'case') {
  const canonical = normalizePackageType(
    typeof packageType === 'object' ? packageType.packageType ?? packageType.source?.type : packageType,
  ) || 'case';
  const label = canonical === 'softpack' ? '软包' : '纸箱';
  const defaultOptions = normalizePalletOptions({
    packageType: canonical,
    unitSizeMm: { lengthMm: 600, widthMm: 400, heightMm: 300 },
    loadHeightMm: 1640,
    overhangMm: 0,
    allowedOrientations: ['A', 'B'],
    layerStrategy: 'cyclic-interlock',
    basePattern: ['A', 'A', 'B'],
    softpackOptions: { cornerProtectorsEnabled: false, topSideLayMode: 'off' },
    faceConstraint: { enabled: false, palletEdge: 'z-', unitFace: 'long-side', layout: 'auto', scope: 'edge-row' },
  });
  return {
    schemaVersion: PALLET_PRESET_SCHEMA_VERSION,
    id: 'temporary',
    name: `${label}叠板临时方案`,
    packageType: canonical,
    algorithmVersion: PALLET_ALGORITHM_VERSION,
    solutionId: 'solution:temporary',
    algorithmInput: algorithmInputFromOptions(defaultOptions),
    unitSizeMm: { lengthMm: 600, widthMm: 400, heightMm: 300 },
    pallet: { ...PALLET_SIZE_MM },
    // v2 stores the usable loading height. heightLimitMm is derived total height.
    loadHeightMm: 1640,
    heightLimitMm: 1800,
    heightIncludesPallet: true,
    overhangMm: 0,
    allowedOrientations: ['A', 'B'],
    layerStrategy: 'cyclic-interlock',
    basePattern: ['A', 'A', 'B'],
    softpackOptions: {
      cornerProtectorsEnabled: false,
      cornerLossLengthMm: 0,
      cornerLossWidthMm: 0,
      topSideLayMode: 'off',
      allowTopSideLay: false,
    },
    showFaceLabels: true,
    faceConstraint: { enabled: false, palletEdge: 'z-', unitFace: 'long-side', layout: 'auto', scope: 'edge-row' },
    placementList: [],
    solution: null,
  };
}

export function normalizePalletPreset(record = {}, fallback = palletDefaults(record?.packageType || record?.source?.type || 'case')) {
  const raw = plain(record) ? record : {};
  const base = plain(fallback) ? fallback : palletDefaults('case');
  const savedInput = plain(raw.algorithmInput) ? raw.algorithmInput : {};
  // 新格式把算法输入集中到 algorithmInput；旧格式仍从顶层字段读取。
  // 顶层字段优先，便于用户编辑导入后的旧方案后继续保存。
  const inputRecord = {
    ...savedInput,
    ...raw,
    packageType: raw.packageType ?? savedInput.packageType,
    softpackOptions: raw.softpackOptions ?? savedInput.softpackOptions,
  };
  const packageType = canonicalFromRecord(inputRecord, base);
  const softpackOptions = normalizeSoftpackPresetOptions(inputRecord, base, packageType);

  const optionInput = {
    unitSizeMm: inputRecord.unitSizeMm ?? base.unitSizeMm,
    packageType,
    softpackOptions,
    // Legacy v1 snapshot support. normalizePalletOptions performs the -160 migration.
    heightLimitMm: inputRecord.heightLimitMm ?? base.heightLimitMm,
    overhangMm: inputRecord.overhangMm ?? base.overhangMm,
    allowedOrientations: inputRecord.allowedOrientations ?? base.allowedOrientations,
    layerStrategy: inputRecord.layerStrategy ?? base.layerStrategy,
    basePattern: inputRecord.basePattern ?? base.basePattern,
    faceConstraint: inputRecord.faceConstraint ?? base.faceConstraint,
  };
  if (inputRecord.loadHeightMm != null) optionInput.loadHeightMm = inputRecord.loadHeightMm;
  const options = normalizePalletOptions(optionInput);
  const algorithmInput = algorithmInputFromOptions(options);
  const legacyPlacementCount = Array.isArray(raw.placementList)
    ? raw.placementList.filter(item => plain(item)).length
    : 0;
  const solution = normalizeSolution(raw.solution, legacyPlacementCount, options);
  const explicitSolutionId = typeof raw.solutionId === 'string' ? raw.solutionId.trim() : '';
  const solutionId = explicitSolutionId
    || `solution:${stableHash(`${PALLET_ALGORITHM_VERSION}:${stableSerialize(algorithmInput)}`)}`;

  return {
    schemaVersion: PALLET_PRESET_SCHEMA_VERSION,
    id: typeof raw.id === 'string' ? raw.id : (base.id || 'temporary'),
    name: text(raw.name, base.name || '叠板临时方案'),
    packageType,
    algorithmVersion: PALLET_ALGORITHM_VERSION,
    solutionId,
    algorithmInput,
    unitSizeMm: dimensionsValue(options.unitSizeMm),
    pallet: { ...PALLET_SIZE_MM },
    loadHeightMm: options.loadHeightMm,
    heightLimitMm: options.heightLimitMm,
    heightIncludesPallet: true,
    overhangMm: options.overhangMm,
    allowedOrientations: options.allowedOrientations,
    layerStrategy: options.layerStrategy,
    basePattern: options.basePattern,
    faceConstraint: options.faceConstraint,
    softpackOptions: options.softpackOptions,
    showFaceLabels: raw.showFaceLabels !== false,
    // 新格式不持久化大型 placement 数组；旧 placementList 仅参与上面的摘要推导。
    placementList: [],
    solution,
  };
}

/**
 * 新 API 使用 { packageType }；旧 source/type 和直接字符串仍可被读取，
 * 但不会把 presetId/presetName/snapshot 等上游方案字段带入叠板预设。
 */
export function capturePalletSource(source) {
  const raw = typeof source === 'string' ? source : source?.packageType ?? source?.type;
  const packageType = normalizePackageType(raw);
  return packageType ? { packageType } : null;
}

export function isValidPalletSource(source) {
  const raw = typeof source === 'string' ? source : source?.packageType ?? source?.type;
  return Boolean(normalizePackageType(raw));
}

// Explicitly re-export the canonical range for callers that only load preset helpers.
export { PALLET_HEIGHT_RANGE_MM, PALLET_LOAD_HEIGHT_RANGE_MM, PALLET_LAYER_STRATEGIES };
