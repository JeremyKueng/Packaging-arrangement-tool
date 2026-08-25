// ===== 叠板（托盘码垛）核心算法 =====
// 纯函数模块：只使用毫米口径，不访问 DOM / Three.js / localStorage。
// X=托盘长向 1200 mm，Z=托盘宽向 1000 mm，Y=高度。

export const PALLET_SIZE_MM = Object.freeze({ length: 1200, width: 1000, height: 160 });
export const PALLET_HEIGHT_RANGE_MM = Object.freeze({ min: 1200, max: 2500 });
export const PALLET_LOAD_HEIGHT_RANGE_MM = Object.freeze({ min: 1040, max: 2340 });
export const PALLET_ORIENTATIONS = Object.freeze(['A', 'B']);
export const PALLET_LAYER_STRATEGIES = Object.freeze(['same', 'alternate', 'cyclic-interlock', 'optimize']);
// 单边展示是“至少一排展示面 + 其余旋转填充”的约束，不是固定件数或固定排数。
// 算法会枚举所有可行的展示排数；400×165 仅是其中会出现 1 排/3 排候选的示例。
export const PALLET_FACE_LAYOUTS = Object.freeze(['auto', 'edge-exposure']);

const EPS = 1e-6;

// 优化结果缓存只保存规范化输入对应的纯 JSON 结果；任何返回值都在出缓存前后做深拷贝，
// 因此调用方修改 placements / options / debug 不会污染后续调用。容量是有限的 LRU，
// 避免长期编辑不同箱规时内存无限增长。
export const PALLET_LAYOUT_CACHE_MAX_ENTRIES = 32;
export const PALLET_ALGORITHM_VERSION = 'pallet-layout-v3';

function cloneSerializable(value) {
  if (value === undefined || value === null || typeof value !== 'object') return value;
  if (typeof structuredClone === 'function') {
    try { return structuredClone(value); } catch (_) { /* fallback below */ }
  }
  return JSON.parse(JSON.stringify(value));
}

function stableSerialize(value) {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) return 'null';
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
}

function stableHash(value) {
  const text = String(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, '0');
}

function palletSolutionId(inputKey) {
  return `solution:${PALLET_ALGORITHM_VERSION}:${stableHash(inputKey)}`;
}

class FiniteLruCache {
  constructor(maxEntries) {
    this.maxEntries = Math.max(1, Math.floor(maxEntries));
    this.entries = new Map();
  }

  get(key) {
    if (!this.entries.has(key)) return undefined;
    const value = this.entries.get(key);
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key, value) {
    if (this.entries.has(key)) this.entries.delete(key);
    while (this.entries.size >= this.maxEntries) this.entries.delete(this.entries.keys().next().value);
    this.entries.set(key, value);
  }

  clear() { this.entries.clear(); }
  get size() { return this.entries.size; }
}

const optimizationCache = new FiniteLruCache(PALLET_LAYOUT_CACHE_MAX_ENTRIES);

export function clearPalletLayoutCache() {
  optimizationCache.clear();
}

export function getPalletLayoutCacheStats() {
  return {
    size: optimizationCache.size,
    maxEntries: optimizationCache.maxEntries,
  };
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function unique(values) {
  return [...new Set(values)];
}

function plain(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * v2 的叠板来源只有包装类型。bigpack 是旧数据中的软包别名，仍可读取。
 */
export function normalizePackageType(value) {
  if (value === 'case' || value === 'carton') return 'case';
  if (value === 'softpack' || value === 'bigpack' || value === 'soft-bag') return 'softpack';
  return null;
}

export function normalizePalletUnitSize(size = {}) {
  const value = plain(size) ? size : {};
  const number = (candidate, fallback = 1) => clamp(finite(candidate, fallback), 1, 5000);
  return {
    lengthMm: number(value.lengthMm ?? value.length),
    widthMm: number(value.widthMm ?? value.width),
    heightMm: number(value.heightMm ?? value.height),
  };
}

function normalizeLoadHeight(options = {}) {
  // v2 的主输入是可摆放高度；旧 heightLimitMm 表示含托盘总高，迁移时必须减去托盘高度。
  const raw = options.loadHeightMm != null
    ? finite(options.loadHeightMm, NaN)
    : options.heightLimitMm != null
      ? finite(options.heightLimitMm, NaN) - PALLET_SIZE_MM.height
      : 1640;
  const fallback = Number.isFinite(raw) ? raw : 1640;
  return clamp(Math.round(fallback), PALLET_LOAD_HEIGHT_RANGE_MM.min, PALLET_LOAD_HEIGHT_RANGE_MM.max);
}

function normalizeSoftpackOptions(options, packageType) {
  const raw = plain(options.softpackOptions) ? options.softpackOptions : {};
  // 兼容 v1 的单一 offsetMm；v2 长、宽损耗可分别维护。
  const legacy = plain(options.cornerProtection) ? options.cornerProtection : {};
  const legacyLoss = finite(legacy.offsetMm, 0);
  const lossLength = clamp(finite(raw.cornerLossLengthMm ?? legacyLoss, 0), 0, 200);
  const lossWidth = clamp(finite(raw.cornerLossWidthMm ?? legacyLoss, 0), 0, 200);
  const requestedCorner = raw.cornerProtectorsEnabled ?? legacy.enabled;
  const requestedSideLay = raw.allowTopSideLay ?? options.allowTopLayerLying;
  const requestedSideLayMode = raw.topSideLayMode;
  const topSideLayMode = packageType !== 'softpack'
    ? 'off'
    : ['off', 'auto', 'force'].includes(requestedSideLayMode)
      ? requestedSideLayMode
      : (requestedSideLay ? 'auto' : 'off');
  return {
    // 护角与顶层侧倒属于软包选项；传入 case 时保留规范化损耗值，但不启用其几何效果。
    cornerProtectorsEnabled: packageType === 'softpack' && Boolean(requestedCorner),
    cornerLossLengthMm: lossLength,
    cornerLossWidthMm: lossWidth,
    // auto：仅当侧倒能提高件数（或同件数降低总高）时采用；
    // force：用于业务检查，强制输出一个可行的 H 面向下顶层示例。
    topSideLayMode,
    allowTopSideLay: topSideLayMode !== 'off',
  };
}

export function normalizePalletOptions(options = {}) {
  const raw = plain(options) ? options : {};
  const unitSizeMm = normalizePalletUnitSize(raw.unitSizeMm || raw.unitSize || raw);
  const allowed = unique((Array.isArray(raw.allowedOrientations) ? raw.allowedOrientations : PALLET_ORIENTATIONS)
    .filter(value => PALLET_ORIENTATIONS.includes(value)));
  const allowedOrientations = allowed.length ? allowed : ['A'];
  const loadHeightMm = normalizeLoadHeight(raw);
  const heightLimitMm = loadHeightMm + PALLET_SIZE_MM.height;
  const packageType = normalizePackageType(raw.packageType ?? raw.sourceType ?? raw.source?.type) || 'case';
  const pallet = {
    lengthMm: PALLET_SIZE_MM.length,
    widthMm: PALLET_SIZE_MM.width,
    heightMm: PALLET_SIZE_MM.height,
  };
  const softpackOptions = normalizeSoftpackOptions(raw, packageType);
  const usablePallet = {
    lengthMm: Math.max(1, pallet.lengthMm - (softpackOptions.cornerProtectorsEnabled ? softpackOptions.cornerLossLengthMm * 2 : 0)),
    widthMm: Math.max(1, pallet.widthMm - (softpackOptions.cornerProtectorsEnabled ? softpackOptions.cornerLossWidthMm * 2 : 0)),
    heightMm: pallet.heightMm,
  };
  const rawPattern = Array.isArray(raw.basePattern) ? raw.basePattern : ['A', 'A', 'B'];
  const basePattern = rawPattern.filter(value => allowedOrientations.includes(value));
  const layerStrategy = PALLET_LAYER_STRATEGIES.includes(raw.layerStrategy) ? raw.layerStrategy : 'cyclic-interlock';
  const face = plain(raw.faceConstraint) ? raw.faceConstraint : {};
  const palletEdge = ['z-', 'z+', 'front', 'back'].includes(face.palletEdge)
    ? (face.palletEdge === 'front' ? 'z-' : face.palletEdge === 'back' ? 'z+' : face.palletEdge)
    : 'z-';
  const unitFace = ['long-side', 'short-side'].includes(face.unitFace) ? face.unitFace : 'long-side';
  // `edge-band-max` / `edge-band-compact` 是此前错误地把示例件数固化为模板的旧字段。
  // 读取旧方案时统一迁移为动态枚举的单边展示约束。
  const faceLayout = PALLET_FACE_LAYOUTS.includes(face.layout)
    ? face.layout
    : (face.enabled ? 'edge-exposure' : 'auto');
  // 分层规则（v3）：软包叠板的内建算法结构，按约束先后顺序生效——
  // 约束一：顶层侧倒件相对下层轮廓每侧最大悬出（默认 10 mm）；
  // 约束二：整板展示面模板（复用 faceConstraint“指定托盘长边展示面”）；
  // 约束三：每一层的行余量下限（默认 50 mm，长边第一排允许贴边）。
  // 纸箱不启用；显式传入 layerRules.enabled=false 可强制关闭。
  const rulesRaw = plain(raw.layerRules) ? raw.layerRules : {};
  const layerRules = {
    enabled: rulesRaw.enabled != null ? Boolean(rulesRaw.enabled) : packageType === 'softpack',
    sideLayMaxOverhangMm: clamp(finite(rulesRaw.sideLayMaxOverhangMm, 10), 0, 100),
    minRowMarginMm: clamp(finite(rulesRaw.minRowMarginMm, 50), 0, 500),
  };
  const cornerProtection = {
    // 仅为读取旧调用方保留，不作为 v2 保存字段。
    enabled: softpackOptions.cornerProtectorsEnabled,
    offsetMm: Math.max(softpackOptions.cornerLossLengthMm, softpackOptions.cornerLossWidthMm),
  };
  return {
    unitSizeMm,
    pallet,
    heightLimitMm,
    loadHeightMm,
    // v2 始终使用“总高含托盘”的口径；保留该布尔值以兼容旧 UI 快照。
    heightIncludesPallet: true,
    overhangMm: clamp(finite(raw.overhangMm, 0), 0, 100),
    allowedOrientations,
    layerStrategy,
    basePattern: basePattern.length ? basePattern : allowedOrientations.slice(),
    faceConstraint: {
      enabled: Boolean(face.enabled),
      palletEdge,
      unitFace,
      layout: faceLayout,
      scope: face.scope === 'all' ? 'all' : 'edge-row',
    },
    packageType,
    softpackOptions,
    layerRules,
    usablePallet,
    // 旧调用方别名；候选逻辑实际只读取 packageType/softpackOptions。
    sourceType: packageType,
    cornerProtection,
    allowTopLayerLying: packageType === 'softpack' && softpackOptions.allowTopSideLay,
    maxCandidates: clamp(Math.round(finite(raw.maxCandidates, 18)), 4, 60),
  };
}

function palletLayoutInputKey(options) {
  // 只保留影响算法的规范化字段；UI 草稿名、debug 标记和调用方属性顺序不会改变 key。
  return stableSerialize({
    algorithmVersion: PALLET_ALGORITHM_VERSION,
    unitSizeMm: options.unitSizeMm,
    pallet: options.pallet,
    usablePallet: options.usablePallet,
    loadHeightMm: options.loadHeightMm,
    overhangMm: options.overhangMm,
    allowedOrientations: options.allowedOrientations,
    layerStrategy: options.layerStrategy,
    basePattern: options.basePattern,
    faceConstraint: options.faceConstraint,
    packageType: options.packageType,
    softpackOptions: options.softpackOptions,
    layerRules: options.layerRules,
    maxCandidates: options.maxCandidates,
  });
}

// 单件在托盘世界坐标中的唯一姿态口径。
//
// faceByWorldAxis 表示“法向朝该世界轴的包装面”应显示的业务面名：
// - x：左右面
// - y：顶/底面
// - z：前/后面
//
// 尺寸置换与 L/W/H 面来源必须在这里同时产生，渲染层不得再根据 A/B、
// side-lay 二次猜测，否则顶层侧倒或平面旋转后很容易出现重复/错误标识。
export function orientedSize(unitSizeMm, orientation, posture = 'normal') {
  if (posture === 'side-lay') {
    // H 面向下：竖直高度始终为原 width（薄边）。
    // A 为 length×height footprint；B 只在托盘平面内旋转 90°，为 height×length footprint。
    return orientation === 'B'
      ? {
          lengthMm: unitSizeMm.heightMm, widthMm: unitSizeMm.lengthMm, heightMm: unitSizeMm.widthMm,
          orientation: 'B', posture, faceDown: 'H',
          // A 侧倒后：顶=L、前后=H、左右=W；B 再绕世界 Y 旋转 90°。
          faceByWorldAxis: { x: 'H', y: 'L', z: 'W' },
        }
      : {
          lengthMm: unitSizeMm.lengthMm, widthMm: unitSizeMm.heightMm, heightMm: unitSizeMm.widthMm,
          orientation: 'A', posture, faceDown: 'H',
          faceByWorldAxis: { x: 'W', y: 'L', z: 'H' },
        };
  }
  return orientation === 'B'
    ? {
        lengthMm: unitSizeMm.widthMm, widthMm: unitSizeMm.lengthMm, heightMm: unitSizeMm.heightMm,
        orientation: 'B', posture: 'normal', faceDown: null,
        faceByWorldAxis: { x: 'L', y: 'H', z: 'W' },
      }
    : {
        lengthMm: unitSizeMm.lengthMm, widthMm: unitSizeMm.widthMm, heightMm: unitSizeMm.heightMm,
        orientation: 'A', posture: 'normal', faceDown: null,
        faceByWorldAxis: { x: 'W', y: 'H', z: 'L' },
      };
}

// 逐件判断五个可见方向是否被相邻件遮挡。
//
// 不能用“整层外接矩形”判断外露面：非矩形排样会形成台阶、凹口，
// 这些面不在整层最外坐标上，但在三维空间中仍然真实外露。这里以
// 当前面的中心点为标识落点；只有存在与该面贴合、且覆盖中心点的邻件
// 时才判定为遮挡。这样标识判定与实际占位一致，也不会在邻件内部穿透。
export function palletExposedFacesFor(placements = [], item, toleranceMm = 0.1) {
  if (!item) return { top:false, front:false, back:false, right:false, left:false };

  const center = (entry, axis) => (
    axis === 'x' ? entry.xMm : axis === 'y' ? entry.yMm : entry.zMm
  );
  const size = (entry, axis) => (
    axis === 'x' ? entry.lengthMm : axis === 'y' ? entry.heightMm : entry.widthMm
  );
  const perpendicularAxes = axis => (
    axis === 'x' ? ['y', 'z'] : axis === 'y' ? ['x', 'z'] : ['x', 'y']
  );
  const centerCovered = (axis, sign) => {
    const facePlane = center(item, axis) + sign * size(item, axis) / 2;
    const otherAxes = perpendicularAxes(axis);
    return placements.some(candidate => {
      if (candidate === item) return false;
      const candidateFace = center(candidate, axis) - sign * size(candidate, axis) / 2;
      if (Math.abs(candidateFace - facePlane) > toleranceMm) return false;
      return otherAxes.every(otherAxis => {
        const point = center(item, otherAxis);
        const half = size(candidate, otherAxis) / 2;
        return point >= center(candidate, otherAxis) - half - toleranceMm
          && point <= center(candidate, otherAxis) + half + toleranceMm;
      });
    });
  };

  return {
    top: !centerCovered('y', 1),
    front: !centerCovered('z', 1),
    back: !centerCovered('z', -1),
    right: !centerCovered('x', 1),
    left: !centerCovered('x', -1),
  };
}

function requiredEdgeFace(options) {
  if (!options.faceConstraint.enabled) return null;
  return options.faceConstraint.unitFace === 'long-side' ? 'L' : 'W';
}

function requiredEdgeOrientation(options, posture = 'normal') {
  const requiredFace = requiredEdgeFace(options);
  if (!requiredFace) return null;
  // 托盘长边沿 X，指定展示边外法向为 Z。姿态 A/B 只是平面旋转编码，
  // 不能作为业务面 L/W 的替代口径；必须从唯一姿态源 faceByWorldAxis 反查。
  return options.allowedOrientations.find(orientation => (
    orientedSize(options.unitSizeMm, orientation, posture).faceByWorldAxis.z === requiredFace
  )) || null;
}

function patternRotations(pattern) {
  if (!pattern.length) return [[]];
  const output = [];
  for (let shift = 0; shift < pattern.length; shift++) {
    output.push(pattern.map((_, index) => pattern[(index + shift) % pattern.length]));
  }
  return output;
}

function patternVariants(options, layerIndex = 0) {
  const allowed = options.allowedOrientations;
  if (options.layerStrategy === 'same') return [allowed[0]];
  if (options.layerStrategy === 'alternate') return [allowed[layerIndex % allowed.length]];
  const pattern = options.basePattern.filter(value => allowed.includes(value));
  if (options.layerStrategy === 'cyclic-interlock' || options.layerStrategy === 'optimize') {
    const rotated = patternRotations(pattern.length ? pattern : allowed);
    return rotated[Math.min(layerIndex, rotated.length - 1)] || allowed;
  }
  return allowed;
}

function rectsOverlap(a, b) {
  return Math.abs(a.xMm - b.xMm) * 2 < a.lengthMm + b.lengthMm - EPS
    && Math.abs(a.zMm - b.zMm) * 2 < a.widthMm + b.widthMm - EPS;
}

function placementInBounds(item, pallet, overhangMm = 0) {
  const halfL = pallet.lengthMm / 2 + overhangMm;
  const halfW = pallet.widthMm / 2 + overhangMm;
  return Math.abs(item.xMm) + item.lengthMm / 2 <= halfL + EPS
    && Math.abs(item.zMm) + item.widthMm / 2 <= halfW + EPS;
}

function placementsValid(placements, pallet, overhangMm) {
  if (!placements.every(item => placementInBounds(item, pallet, overhangMm))) return false;
  for (let i = 0; i < placements.length; i++) {
    for (let j = i + 1; j < placements.length; j++) {
      if (rectsOverlap(placements[i], placements[j])) return false;
    }
  }
  return true;
}

function normalizeEdgeConstraint(placements, options) {
  const requiredFace = requiredEdgeFace(options);
  if (!requiredFace || !placements.length) return true;
  const edge = options.faceConstraint.palletEdge === 'z+' ? 1 : -1;
  const maxEdge = Math.max(...placements.map(item => edge * (item.zMm + edge * item.widthMm / 2)));
  const edgeItems = placements.filter(item => Math.abs(edge * (item.zMm + edge * item.widthMm / 2) - maxEdge) < 0.01);
  return edgeItems.length > 0 && edgeItems.every(item => {
    const faces = item.faceByWorldAxis
      || orientedSize(options.unitSizeMm, item.orientation, item.posture).faceByWorldAxis;
    return faces.z === requiredFace;
  });
}

function centeredPositions(count, size) {
  return Array.from({ length: count }, (_, index) => -(count * size) / 2 + size / 2 + index * size);
}

function faceLayoutLabel(layout, edgeRows = 0) {
  if (layout === 'edge-exposure') {
    return edgeRows > 0
      ? `单边展示：${edgeRows}排正向 + 旋转填充`
      : '单边展示：自动组合';
  }
  return '自动排样';
}

/**
 * 单边展示动态排样。
 *
 * 以托盘 z- / z+ 长边作为指定展示边：从该边向内枚举 1、2、3…排目标朝向，
 * 其余区域全部以 90° 旋转朝向填充。每个候选都至少保留一排展示面与一排
 * 旋转填充，不会沿托盘中线拆分。排数和件数均由单件尺寸、护角损耗及托盘边界
 * 动态决定，而不是固化为“17件”或“16件”。
 */
function edgeExposureLayouts(options, posture = 'normal') {
  const constraint = options.faceConstraint;
  if (!constraint.enabled || constraint.layout !== 'edge-exposure') return [];
  const pallet = options.usablePallet || options.pallet;
  const edgeOrientation = requiredEdgeOrientation(options, posture);
  const fillOrientation = edgeOrientation === 'A' ? 'B' : 'A';
  if (!edgeOrientation || !options.allowedOrientations.includes(edgeOrientation) || !options.allowedOrientations.includes(fillOrientation)) return [];

  const edgeSize = orientedSize(options.unitSizeMm, edgeOrientation, posture);
  const fillSize = orientedSize(options.unitSizeMm, fillOrientation, posture);
  const edgeCount = Math.floor((pallet.lengthMm + options.overhangMm * 2 + EPS) / edgeSize.lengthMm);
  const fillColumns = Math.floor((pallet.lengthMm + options.overhangMm * 2 + EPS) / fillSize.lengthMm);
  // 至少留一排旋转填充，避免把“全部同向”误归类为单边展示混排。
  const maxEdgeRows = Math.floor((pallet.widthMm + options.overhangMm * 2 - fillSize.widthMm + EPS) / edgeSize.widthMm);
  if (edgeCount < 1 || fillColumns < 1 || maxEdgeRows < 1) return [];

  const sign = constraint.palletEdge === 'z+' ? 1 : -1;
  // 分层规则三开启时，填充区需要能留出行余量；此时按“填满 → 逐列缩短”枚举，
  // 直到某列数满足行余量（长边第一排展示排允许贴边，天然豁免）。
  const wantMarginMm = options.layerRules?.enabled ? options.layerRules.minRowMarginMm : 0;
  const output = [];
  for (let edgeRows = 1; edgeRows <= maxEdgeRows; edgeRows++) {
    const remainingWidth = pallet.widthMm + options.overhangMm * 2 - edgeRows * edgeSize.widthMm;
    const fillRows = Math.floor((remainingWidth + EPS) / fillSize.widthMm);
    if (fillRows < 1) continue;
    for (let columns = fillColumns; columns >= 1; columns--) {
      const placements = [];
      const edgeStartZ = sign * (pallet.widthMm / 2 - edgeSize.widthMm / 2);
      for (let row = 0; row < edgeRows; row++) {
        const zMm = edgeStartZ - sign * row * edgeSize.widthMm;
        for (const xMm of centeredPositions(edgeCount, edgeSize.lengthMm)) placements.push({ xMm, zMm, ...edgeSize });
      }
      const fillStartZ = sign * (pallet.widthMm / 2 - edgeRows * edgeSize.widthMm - fillSize.widthMm / 2);
      for (let row = 0; row < fillRows; row++) {
        const zMm = fillStartZ - sign * row * fillSize.widthMm;
        for (const xMm of centeredPositions(columns, fillSize.lengthMm)) placements.push({ xMm, zMm, ...fillSize });
      }
      if (!placementsValid(placements, pallet, options.overhangMm) || !normalizeEdgeConstraint(placements, options)) continue;
      // 整体居中：模板块沿托盘宽度方向居中放置，不贴死展示边。
      // 这样各层轮廓关于托盘中线对称，顶层侧倒无需偏移即可对齐；
      // 展示排仍位于同一侧、保持目标朝向，展示语义不变。
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (const item of placements) {
        minZ = Math.min(minZ, item.zMm - item.widthMm / 2);
        maxZ = Math.max(maxZ, item.zMm + item.widthMm / 2);
      }
      const dzCenter = -(minZ + maxZ) / 2;
      if (Math.abs(dzCenter) > EPS) {
        for (const item of placements) item.zMm += dzCenter;
      }
      if (wantMarginMm > 0 && !rowMarginRuleSatisfied(placements, options)) continue;
      output.push({
        placements,
        pattern: [edgeOrientation, fillOrientation],
        axis: 'edge-exposure',
        posture,
        layout: 'edge-exposure',
        edgeRows,
        edgeCount: edgeRows * edgeCount,
        fillCount: fillRows * columns,
        layoutLabel: faceLayoutLabel('edge-exposure', edgeRows),
      });
      // 未启用行余量时保持原行为：只取填满的排样；
      // 启用时一旦当前列数已满足行余量即停止继续缩短。
      if (!(wantMarginMm > 0)) break;
      const report = palletRowMarginReport(placements);
      if (report.rows.length <= 1 || report.satisfiedFor(wantMarginMm, pallet.lengthMm)) break;
    }
  }
  return output;
}

// 供界面候选说明与回归测试使用：返回“单边展示”约束下所有可行单层组合。
// 注意：这里不按总件数裁剪，调用方可看到例如同一尺寸下 17 件和 16 件的不同排样。
export function enumerateSingleEdgeLayouts(rawOptions = {}, posture = 'normal') {
  const options = normalizePalletOptions(rawOptions);
  return edgeExposureLayouts(options, posture);
}

function addRowLayout(rows, axis, options, posture = 'normal') {
  const { unitSizeMm, overhangMm } = options;
  const pallet = options.usablePallet || options.pallet;
  const halfL = pallet.lengthMm / 2;
  const halfW = pallet.widthMm / 2;
  const rowEntries = rows
    .filter(orientation => options.allowedOrientations.includes(orientation))
    .map(orientation => ({ orientation, size: orientedSize(unitSizeMm, orientation, posture) }));
  if (!rowEntries.length) return [];

  // 先计算整条排样带的总宽度，再以托盘中线为基准放置。
  // 这样全同向时 X/Z 两个方向都保持中线对称。
  const stripExtent = axis === 'z' ? pallet.widthMm : pallet.lengthMm;
  const totalStrip = rowEntries.reduce((sum, entry) => sum + (axis === 'z' ? entry.size.widthMm : entry.size.lengthMm), 0);
  if (totalStrip > stripExtent + overhangMm * 2 + EPS) return [];
  let cursor = -totalStrip / 2;
  const placements = [];
  for (const entry of rowEntries) {
    const { orientation, size } = entry;
    const stripSize = axis === 'z' ? size.widthMm : size.lengthMm;
    const acrossSize = axis === 'z' ? size.lengthMm : size.widthMm;
    if (cursor + stripSize > (axis === 'z' ? halfW : halfL) + overhangMm + EPS) return [];
    const count = Math.floor((axis === 'z' ? pallet.lengthMm : pallet.widthMm) / acrossSize + EPS);
    if (count < 1) return [];
    const startAcross = -(count * acrossSize) / 2 + acrossSize / 2;
    const stripCenter = cursor + stripSize / 2;
    for (let index = 0; index < count; index++) {
      const across = startAcross + index * acrossSize;
      placements.push(axis === 'z'
        ? { xMm: across, zMm: stripCenter, ...size }
        : { xMm: stripCenter, zMm: across, ...size });
    }
    cursor += stripSize;
    if (cursor > (axis === 'z' ? halfW : halfL) + overhangMm + EPS) return [];
  }
  return placements;
}

function sequenceCandidates(options, axis, posture = 'normal', enforceFace = true) {
  const pallet = options.usablePallet || options.pallet;
  const a = orientedSize(options.unitSizeMm, 'A', posture);
  const b = orientedSize(options.unitSizeMm, 'B', posture);
  const minStrip = Math.min(a.lengthMm, a.widthMm, b.lengthMm, b.widthMm);
  const extent = axis === 'z' ? pallet.widthMm : pallet.lengthMm;
  const maxRows = Math.min(12, Math.floor((extent + options.overhangMm * 2) / minStrip));
  const base = patternVariants(options, 0);
  const candidates = [];
  const seeds = [base, [...base].reverse(), ['A'], ['B'], ['A', 'B'], ['B', 'A'], ['A', 'A', 'B'], ['A', 'B', 'A'], ['B', 'A', 'A']];
  for (const seed of seeds) {
    if (!seed.length || seed.some(value => !options.allowedOrientations.includes(value))) continue;
    for (const rotated of patternRotations(seed)) {
      const sequence = [];
      while (sequence.length < maxRows) sequence.push(rotated[sequence.length % rotated.length]);
      for (let length = 1; length <= maxRows; length++) {
        const rows = sequence.slice(0, length);
        const placements = addRowLayout(rows, axis, options, posture);
        if (placements.length && (!enforceFace || normalizeEdgeConstraint(placements, options))) candidates.push({ placements, pattern: rows, axis, posture });
      }
    }
  }
  const seen = new Set();
  return candidates.filter(item => {
    const key = item.placements.map(p => `${p.orientation}:${p.posture}:${p.xMm}:${p.zMm}:${p.lengthMm}:${p.widthMm}`).join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function evaluateLayer(placements, options) {
  const pallet = options.usablePallet || options.pallet;
  const area = pallet.lengthMm * pallet.widthMm;
  const usedArea = placements.reduce((sum, item) => sum + item.lengthMm * item.widthMm, 0);
  const cx = placements.length ? placements.reduce((sum, item) => sum + item.xMm, 0) / placements.length : 0;
  const cz = placements.length ? placements.reduce((sum, item) => sum + item.zMm, 0) / placements.length : 0;
  const edgeItems = placements.filter(item => Math.abs(Math.abs(item.zMm) + item.widthMm / 2 - pallet.widthMm / 2) < 0.02).length;
  return {
    count: placements.length,
    areaUtilization: area > 0 ? Math.min(1, usedArea / area) : 0,
    centerOffsetMm: Math.hypot(cx, cz),
    edgeItems,
  };
}

function supportRatio(lower, upper) {
  if (!upper?.length || !lower?.length) return { min: 1, average: 1 };
  let min = 1;
  let sum = 0;
  for (const top of upper) {
    let supported = 0;
    for (const bottom of lower) {
      const overlapX = Math.max(0, Math.min(top.xMm + top.lengthMm / 2, bottom.xMm + bottom.lengthMm / 2) - Math.max(top.xMm - top.lengthMm / 2, bottom.xMm - bottom.lengthMm / 2));
      const overlapZ = Math.max(0, Math.min(top.zMm + top.widthMm / 2, bottom.zMm + bottom.widthMm / 2) - Math.max(top.zMm - top.widthMm / 2, bottom.zMm - bottom.widthMm / 2));
      supported += overlapX * overlapZ;
    }
    const ratio = Math.min(1, supported / (top.lengthMm * top.widthMm));
    min = Math.min(min, ratio);
    sum += ratio;
  }
  return { min, average: sum / upper.length };
}

function layoutSignature(layer) {
  return layer
    .map(item => `${item.orientation}:${item.posture}:${item.faceDown || ''}:${item.xMm.toFixed(3)}:${item.zMm.toFixed(3)}:${item.lengthMm.toFixed(3)}:${item.widthMm.toFixed(3)}:${item.heightMm.toFixed(3)}`)
    .sort()
    .join('|');
}

// ===== 分层规则（v3）辅助 =====

function placementBounds(placements) {
  return placements.reduce((bounds, item) => ({
    minX: Math.min(bounds.minX, item.xMm - item.lengthMm / 2),
    maxX: Math.max(bounds.maxX, item.xMm + item.lengthMm / 2),
    minZ: Math.min(bounds.minZ, item.zMm - item.widthMm / 2),
    maxZ: Math.max(bounds.maxZ, item.zMm + item.widthMm / 2),
  }), { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });
}

// 规则一：上层相对下一层轮廓的每侧悬出量不得超过上限。
function sideLayOverhangWithinLimit(upperPlacements, lowerLayer, limitMm) {
  if (!lowerLayer?.length || !upperPlacements.length) return true;
  const lower = placementBounds(lowerLayer);
  const upper = placementBounds(upperPlacements);
  const overhang = Math.max(
    lower.minX - upper.minX,
    upper.maxX - lower.maxX,
    lower.minZ - upper.minZ,
    upper.maxZ - lower.maxZ,
    0,
  );
  return overhang <= limitMm + EPS;
}

// 把一层单件聚成“排”：addRowLayout 与单边模板生成的候选里，
// 同一排的单件共享同一条带坐标；唯一值较少的方向即排的叠进方向。
function placementRows(placements) {
  if (!placements.length) return [];
  const uniqueX = new Set(placements.map(item => item.xMm.toFixed(3)));
  const uniqueZ = new Set(placements.map(item => item.zMm.toFixed(3)));
  const byZ = uniqueZ.size <= uniqueX.size;
  const groups = new Map();
  for (const item of placements) {
    const key = byZ ? item.zMm.toFixed(3) : item.xMm.toFixed(3);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return [...groups.values()];
}

// 规则三：长边第一排（最贴近托盘长边的排）允许 0 余量；
// 其余排中至少要有一排沿托盘长向的剩余长度 ≥ 设定值。
// 只有一排时视为满足（不存在“后面的摆放排”，条件空真）。
function rowMarginRuleSatisfied(placements, options) {
  const pallet = options.usablePallet || options.pallet;
  const report = palletRowMarginReport(placements);
  return report.satisfiedFor(options.layerRules.minRowMarginMm, pallet.lengthMm);
}

// 供分层规则校验、界面说明与回归测试使用：把一层拆成排并给出每排沿托盘长向的占用。
export function palletRowMarginReport(placements) {
  const rows = placementRows(placements).map(items => {
    let minX = Infinity;
    let maxX = -Infinity;
    let edgeDistance = 0;
    for (const item of items) {
      minX = Math.min(minX, item.xMm - item.lengthMm / 2);
      maxX = Math.max(maxX, item.xMm + item.lengthMm / 2);
      edgeDistance += Math.abs(item.zMm);
    }
    // span 为该排沿托盘长向的实际占用；edgeDistance 取均值代表离长边距离。
    return { spanLengthMm: maxX - minX, edgeDistance: edgeDistance / items.length };
  });
  rows.sort((a, b) => b.edgeDistance - a.edgeDistance);
  const restRows = rows.slice(1);
  return {
    rows,
    // 调用方传入阈值后判断：其余排中至少一排剩余 ≥ 阈值；只有一排时空真。
    satisfiedFor(thresholdMm, usableLengthMm) {
      if (rows.length <= 1) return true;
      return restRows.some(row => usableLengthMm - row.spanLengthMm >= thresholdMm - EPS);
    },
  };
}

function layerOptions(options, layerIndex, posture = 'normal') {
  // 分层规则口径（v3）：“一/二/三”是约束的先后顺序，不是物理层号——
  // 约束一：顶层侧倒出边限制（在 extendState 中校验并对齐下层轮廓）；
  // 约束二：整板展示面模板，由 faceConstraint（指定托盘长边展示面）承载；
  // 约束三：每一层都要求长边第一排允许贴边、其余排至少一排沿托盘长向剩余 ≥ 行余量下限。
  const isEdgeTemplate = options.faceConstraint.enabled && options.faceConstraint.layout === 'edge-exposure';
  // 单边展示约束只约束正常姿态层。侧倒（H 面向下）时长侧面必然朝上，与
  // “L 面朝托盘长边”在几何上互斥；若把约束套到侧倒层，候选会被过滤为空、
  // 极限侧倒静默失效。因此侧倒层豁免该约束，展示面由下部正常姿态层保证。
  const exemptFromFaceConstraint = posture === 'side-lay';
  const templateApplies = isEdgeTemplate && !exemptFromFaceConstraint;
  // 单边模板必须逐层复用同一结构（覆盖面积一致），不随循环错层轮换——
  // 否则上下层模板不同会导致第二层比第一层更“大”，现场无法堆叠。
  const patterns = patternVariants(options, templateApplies ? 0 : layerIndex);
  const candidates = templateApplies
    ? edgeExposureLayouts(options, posture)
    : [
        ...sequenceCandidates(options, 'z', posture, !exemptFromFaceConstraint),
        ...sequenceCandidates(options, 'x', posture, !exemptFromFaceConstraint),
      ];
  const requiredPattern = patterns.join('');
  let valid = candidates.filter(item => placementsValid(item.placements, options.usablePallet || options.pallet, options.overhangMm));
  // 分层规则三：作用于每一层（硬约束，先于策略筛选和件数择优执行，
  // 保证“不牺牲合格候选”）。
  if (options.layerRules?.enabled) {
    valid = valid.filter(item => rowMarginRuleSatisfied(item.placements, options));
  }
  const filtered = valid.filter(item => {
    // 单边模板的 A/B 是同一层内部的固定结构；“全部同向”在此表示各层复用该模板，
    // 不能再用“所有单件均为 A/B”把它误过滤掉。
    if (templateApplies) return true;
    if (options.layerStrategy === 'same') return item.placements.every(item => item.orientation === patterns[0]);
    if (options.layerStrategy === 'alternate') return item.placements.every(item => item.orientation === patterns[0]);
    return true;
  });
  // same/alternate 是显式硬约束；循环/自动策略只把字面 pattern 作为择优因素。
  let source = (options.layerStrategy === 'same' || options.layerStrategy === 'alternate')
    ? filtered
    : valid;
  // 件数择优只作用于正常姿态层。侧倒层的可行性与所在状态的下层轮廓相关
  // （约束一的对齐平移），件数最大的候选未必放得进去；若在此剪掉小方案，
  // 会导致“有可行侧倒却整体失效”。侧倒层的取舍交给最终 compareSelection。
  if (posture === 'normal' && (options.layerStrategy === 'cyclic-interlock' || options.layerStrategy === 'optimize')) {
    const maxCount = source.reduce((max, item) => Math.max(max, item.placements.length), 0);
    source = source.filter(item => item.placements.length === maxCount);
  }
  return source
    .sort((a, b) => {
      const countDiff = evaluateLayer(b.placements, options).count - evaluateLayer(a.placements, options).count;
      if (countDiff) return countDiff;
      if (options.layerStrategy === 'cyclic-interlock') {
        const aMatch = a.pattern.slice(0, patterns.length).join('') === requiredPattern ? 1 : 0;
        const bMatch = b.pattern.slice(0, patterns.length).join('') === requiredPattern ? 1 : 0;
        if (aMatch !== bMatch) return bMatch - aMatch;
      }
      if (templateApplies) {
        // 单边模板只保留一个候选时，同件数下优先覆盖面积更大的变体：
        // 既提高层间支撑，也缩小与顶层侧倒块的轮廓差——否则较窄模板会把
        // 约束一的必要出边从几毫米推高到几十毫米，直接损失顶层数量。
        const aB = placementBounds(a.placements);
        const bB = placementBounds(b.placements);
        const aArea = (aB.maxX - aB.minX) * (aB.maxZ - aB.minZ);
        const bArea = (bB.maxX - bB.minX) * (bB.maxZ - bB.minZ);
        if (Math.abs(aArea - bArea) > 1) return bArea - aArea;
      }
      return evaluateLayer(a.placements, options).centerOffsetMm - evaluateLayer(b.placements, options).centerOffsetMm;
    })
    // 单边模板层只保留唯一最优结构：上下层覆盖面积必须一致，
    // 且错层比较器不能在模板层之间制造差异。
    .slice(0, templateApplies ? 1 : options.maxCandidates);
}

function compareState(a, b) {
  if (a.count !== b.count) return b.count - a.count;
  if (a.heightMm !== b.heightMm) return a.heightMm - b.heightMm;
  // 同等装载数量下优先真正发生错层的方案，避免循环错层完全重合。
  if (a.staggerChanges !== b.staggerChanges) return b.staggerChanges - a.staggerChanges;
  if (a.minSupport !== b.minSupport) return b.minSupport - a.minSupport;
  if (a.averageSupport !== b.averageSupport) return b.averageSupport - a.averageSupport;
  if (a.centerOffset !== b.centerOffset) return a.centerOffset - b.centerOffset;
  return b.areaUtilization - a.areaUtilization;
}

function layerHeight(choice) {
  return choice.placements.reduce((max, item) => Math.max(max, item.heightMm), 0);
}

// 约束一辅助：侧倒候选默认居中生成，但单边模板的下层轮廓贴展示边、并不居中；
// 居中直接放会误判“出边超限”。这里枚举平移量（每轴取 左对齐/右对齐/不动 三种），
// 选出相对下层轮廓悬出最小、且不越出托盘边界的组合。整体平移不改变件间相对
// 位置，重叠关系与支撑面积保持不变。
function alignedSideLayShift(upperPlacements, lowerLayer, options) {
  const pallet = options.usablePallet || options.pallet;
  const lower = placementBounds(lowerLayer);
  const upper = placementBounds(upperPlacements);
  const limit = options.layerRules.sideLayMaxOverhangMm;
  const axisShifts = (lo, hi, ul, uh) => [...new Set([lo - ul, hi - uh, 0])];
  const shiftsX = axisShifts(lower.minX, lower.maxX, upper.minX, upper.maxX);
  const shiftsZ = axisShifts(lower.minZ, lower.maxZ, upper.minZ, upper.maxZ);
  const overhangOf = (dx, dz) => Math.max(
    lower.minX - (upper.minX + dx),
    upper.maxX + dx - lower.maxX,
    lower.minZ - (upper.minZ + dz),
    upper.maxZ + dz - lower.maxZ,
    0,
  );
  const inBounds = (item, dx, dz) => placementInBounds(
    { ...item, xMm: item.xMm + dx, zMm: item.zMm + dz },
    pallet,
    options.overhangMm,
  );
  let best = null;
  for (const dx of shiftsX) {
    for (const dz of shiftsZ) {
      const overhang = overhangOf(dx, dz);
      if (overhang > limit + EPS) continue;
      if (!upperPlacements.every(item => inBounds(item, dx, dz))) continue;
      const travel = Math.abs(dx) + Math.abs(dz);
      if (!best || overhang < best.overhang - EPS || (Math.abs(overhang - best.overhang) <= EPS && travel < best.travel)) {
        best = { dx, dz, overhang, travel };
      }
    }
  }
  return best;
}

function extendState(state, choice, options, enforceSupport = true, stats = null) {
  const reject = () => {
    if (stats) stats.prunedCount++;
    return null;
  };
  const layerIndex = state.layers.length;
  const height = layerHeight(choice);
  if (!height) return reject();
  if (state.heightMm + height > options.loadHeightMm + EPS) return reject();
  const baseHeight = state.heightMm;
  // 约束一启用时，侧倒层先尝试对齐下层轮廓再放置。
  let placed = choice.placements;
  if (options.layerRules?.enabled && choice.posture === 'side-lay' && layerIndex) {
    const shift = alignedSideLayShift(choice.placements, state.layers[layerIndex - 1], options);
    if (!shift) return reject();
    if (shift.dx || shift.dz) {
      placed = choice.placements.map(item => ({ ...item, xMm: item.xMm + shift.dx, zMm: item.zMm + shift.dz }));
    }
  }
  const layer = placed.map(item => ({
    ...item,
    layer: layerIndex,
    yMm: options.pallet.heightMm + baseHeight + item.heightMm / 2,
  }));
  const support = layerIndex ? supportRatio(state.layers[layerIndex - 1], layer) : { min: 1, average: 1 };
  if (enforceSupport && layerIndex && (options.layerStrategy === 'cyclic-interlock' || options.layerStrategy === 'optimize') && support.min < .75) return reject();
  // 分层规则一：顶层侧倒件相对下一层轮廓的每侧悬出量不得超过设定值。
  if (options.layerRules?.enabled && choice.posture === 'side-lay' && layerIndex
    && !sideLayOverhangWithinLimit(layer, state.layers[layerIndex - 1], options.layerRules.sideLayMaxOverhangMm)) {
    return reject();
  }
  const all = state.placements.concat(layer);
  const cx = all.reduce((sum, item) => sum + item.xMm, 0) / Math.max(1, all.length);
  const cz = all.reduce((sum, item) => sum + item.zMm, 0) / Math.max(1, all.length);
  const metric = evaluateLayer(choice.placements, options);
  return {
    layers: state.layers.concat([layer]),
    placements: all,
    count: state.count + layer.length,
    heightMm: state.heightMm + height,
    staggerChanges: state.staggerChanges + (layerIndex && layoutSignature(state.layers[layerIndex - 1]) !== layoutSignature(layer) ? 1 : 0),
    minSupport: Math.min(state.minSupport, support.min),
    averageSupport: (state.averageSupport * layerIndex + support.average) / (layerIndex + 1),
    centerOffset: Math.hypot(cx, cz),
    areaUtilization: (state.areaUtilization * layerIndex + metric.areaUtilization) / (layerIndex + 1),
    layout: choice.layout || 'auto',
    layoutLabel: choice.layoutLabel || faceLayoutLabel(choice.layout || 'auto'),
  };
}

function compareSelection(a, b) {
  if (a.count !== b.count) return b.count - a.count;
  if (a.heightMm !== b.heightMm) return a.heightMm - b.heightMm;
  return compareState(a, b);
}

function resultFromState(best, options) {
  const pallet = options.pallet;
  const usable = options.usablePallet || pallet;
  const all = best.placements;
  const layerRates = best.layers.map(layer => {
    const usedArea = layer.reduce((sum, item) => sum + item.lengthMm * item.widthMm, 0);
    return usable.lengthMm * usable.widthMm > 0 ? Math.min(1, usedArea / (usable.lengthMm * usable.widthMm)) : 0;
  });
  // 平面率描述平均每层的占用面积比例。
  const surfaceUtilization = layerRates.length ? layerRates.reduce((sum, value) => sum + value, 0) / layerRates.length : 0;
  const usableVolume = usable.lengthMm * usable.widthMm * options.loadHeightMm;
  const itemVolume = options.unitSizeMm.lengthMm * options.unitSizeMm.widthMm * options.unitSizeMm.heightMm;
  const volumeUtilization = usableVolume > 0 ? Math.min(1, best.count * itemVolume / usableVolume) : 0;
  const actualLoadHeightMm = best.heightMm;
  const totalHeightMm = pallet.heightMm + actualLoadHeightMm;
  const heightUtilization = options.loadHeightMm + pallet.heightMm > 0
    ? Math.min(1, (actualLoadHeightMm + pallet.heightMm) / (options.loadHeightMm + pallet.heightMm))
    : 0;
  // 满板率统一口径：平面率 ×（实际叠放高度+托盘高度）÷（可叠放高度+托盘高度）。
  const fullPalletRate = Math.min(1, surfaceUtilization * heightUtilization);
  const occupiedBounds = all.reduce((bounds, item) => ({
    minX: Math.min(bounds.minX, item.xMm - item.lengthMm / 2),
    maxX: Math.max(bounds.maxX, item.xMm + item.lengthMm / 2),
    minZ: Math.min(bounds.minZ, item.zMm - item.widthMm / 2),
    maxZ: Math.max(bounds.maxZ, item.zMm + item.widthMm / 2),
  }), { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });
  const occupiedLengthMm = all.length ? Math.max(0, occupiedBounds.maxX - occupiedBounds.minX) : 0;
  const occupiedWidthMm = all.length ? Math.max(0, occupiedBounds.maxZ - occupiedBounds.minZ) : 0;
  const boundaryValid = all.every(item => placementInBounds(item, usable, options.overhangMm));
  return {
    ok: true,
    options,
    placements: all,
    layers: best.layers,
    layerCount: best.layers.length,
    itemsPerLayer: best.layers.map(layer => layer.length),
    totalCount: best.count,
    actualLoadHeightMm,
    totalHeightMm,
    occupiedLengthMm,
    occupiedWidthMm,
    remainingLengthMm: Math.max(0, pallet.lengthMm - occupiedLengthMm),
    remainingWidthMm: Math.max(0, pallet.widthMm - occupiedWidthMm),
    remainingHeightMm: Math.max(0, options.loadHeightMm - actualLoadHeightMm),
    heightUtilization,
    // 兼容旧消费者；从 v2 起 palletYieldRate 与 fullPalletRate 均表示“满板率”。
    palletYieldRate: fullPalletRate,
    surfaceUtilization,
    footprintUtilization: surfaceUtilization,
    fullPalletRate,
    volumeUtilization,
    minSupportRatio: best.minSupport,
    averageSupportRatio: best.averageSupport,
    centerOffsetMm: best.centerOffset,
    stability: {
      boundaryValid,
      overlapFree: best.layers.every(layer => placementsValid(layer, usable, options.overhangMm)),
      supportValid: best.minSupport >= .75,
      centerValid: best.centerOffset <= Math.min(pallet.lengthMm, pallet.widthMm) * .15,
    },
    pattern: best.layers.map(layer => layer.map(item => item.orientation).join('')),
    layout: best.layout || 'auto',
    layoutLabel: best.layoutLabel || faceLayoutLabel(best.layout || 'auto'),
  };
}

function optimizePalletLayoutInternal(rawOptions = {}, stats = {}) {
  const options = normalizePalletOptions(rawOptions);
  const initial = {
    layers: [],
    placements: [],
    count: 0,
    heightMm: 0,
    staggerChanges: 0,
    minSupport: 1,
    averageSupport: 1,
    centerOffset: 0,
    areaUtilization: 0,
  };
  const maxLayers = Math.max(0, Math.floor(options.loadHeightMm / options.unitSizeMm.heightMm + EPS));
  const normalStatesByDepth = [[initial]];
  let states = [initial];
  for (let layerIndex = 0; layerIndex < maxLayers; layerIndex++) {
    const choices = layerOptions(options, layerIndex, 'normal');
    if (!choices.length) break;
    const next = [];
    for (const state of states) {
      for (const choice of choices) {
        stats.candidateCount = (stats.candidateCount || 0) + 1;
        const candidate = extendState(state, choice, options, true, stats);
        if (candidate) next.push(candidate);
      }
    }
    if (!next.length) break;
    next.sort(compareState);
    states = next.slice(0, 36);
    normalStatesByDepth.push(states);
  }
  const normalBest = states.some(state => state.layers.length) ? [...states].sort(compareState)[0] : null;

  // 侧倒只对软包开放。枚举“若干正常层 + 一个顶层侧倒层”，既覆盖追加一层，也覆盖替换正常顶层。
  const sideLayEnabled = options.packageType === 'softpack' && options.softpackOptions.allowTopSideLay;
  const forceSideLay = sideLayEnabled && options.softpackOptions.topSideLayMode === 'force';
  const sideStates = [];
  let sideBest = null;
  if (sideLayEnabled) {
    for (const depthStates of normalStatesByDepth) {
      for (const state of depthStates) {
        const choices = layerOptions(options, state.layers.length, 'side-lay');
        for (const choice of choices) {
          stats.candidateCount = (stats.candidateCount || 0) + 1;
          // “顶层侧倒”必须真实降低层高；任何等于或高于正常摆放高度的候选均不成立。
          const sideLayerHeight = layerHeight(choice);
          if (sideLayerHeight >= options.unitSizeMm.heightMm - EPS) {
            stats.prunedCount = (stats.prunedCount || 0) + 1;
            continue;
          }
          const candidate = extendState(state, choice, options, false, stats);
          if (candidate) sideStates.push(candidate);
        }
      }
    }
    sideStates.sort(compareSelection);
    sideBest = sideStates[0] || null;
  }

  // 侧倒只有在件数更优，或件数相同但总高更低时才替换正常方案。
  const useSide = sideBest && (forceSideLay || !normalBest
    || sideBest.count > normalBest.count
    || (sideBest.count === normalBest.count && sideBest.heightMm < normalBest.heightMm - EPS));
  const best = useSide ? sideBest : normalBest;
  if (!best) {
    const reason = maxLayers < 1 ? 'unit-too-high' : 'no-layout';
    return {
      ok: false,
      reason,
      options,
      placements: [],
      layers: [],
      totalCount: 0,
      layerCount: 0,
      actualLoadHeightMm: 0,
      totalHeightMm: options.pallet.heightMm,
    };
  }
  const result = resultFromState(best, options);
  result.topSideLayMode = options.softpackOptions.topSideLayMode;
  result.topSideLayApplied = Boolean(useSide && best.layers.at(-1)?.some(item => item.posture === 'side-lay'));
  result.topSideLayForced = Boolean(result.topSideLayApplied && forceSideLay);

  // 次优解：在全部到达过的搜索状态里挑“总数次高、且层结构签名与最优不同”的方案，
  // 供产线作为备选排列。结构签名只看每层件数与是否含侧倒，避免同一排布的平移/微调被误判为备选。
  const structureSignature = state => state.layers.map(layer => `${layer.length}${layer.some(item => item.posture === 'side-lay') ? 's' : ''}`).join('|');
  const candidatePool = [];
  for (const depthStates of normalStatesByDepth) candidatePool.push(...depthStates);
  candidatePool.push(...sideStates);
  const bestSignature = structureSignature(best);
  const runnerUp = candidatePool
    .filter(state => state.layers.length && state !== best && structureSignature(state) !== bestSignature)
    .sort(compareSelection)[0] || null;
  result.hasRunnerUp = Boolean(runnerUp);
  if (runnerUp) {
    const runnerResult = resultFromState(runnerUp, options);
    runnerResult.isRunnerUp = true;
    result.runnerUp = runnerResult;
  }
  return result;
}

/**
 * 带有限 LRU 的托盘优化入口。输入先规范化再生成稳定 key；缓存命中与否、候选尝试、
 * 被硬约束拒绝的分支和耗时都放到 debug，便于浏览器与基准脚本核对。这里没有新增
 * 依赖启发式上限的剪枝；现有算法的候选/状态规则保持不变，避免改变最优解口径。
 */
export function optimizePalletLayout(rawOptions = {}) {
  const options = normalizePalletOptions(rawOptions);
  const key = palletLayoutInputKey(options);
  const startedAt = typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
  const cached = optimizationCache.get(key);
  if (cached) {
    const output = cloneSerializable(cached);
    const endedAt = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
    output.debug = {
      ...(output.debug || {}),
      elapsedMs: Math.max(0, endedAt - startedAt),
      cacheHit: true,
      cacheKey: key,
    };
    output.algorithmVersion = PALLET_ALGORITHM_VERSION;
    output.solutionId = palletSolutionId(key);
    return output;
  }

  const stats = { candidateCount: 0, prunedCount: 0 };
  const result = optimizePalletLayoutInternal(options, stats);
  const endedAt = typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
  result.debug = {
    elapsedMs: Math.max(0, endedAt - startedAt),
    candidateCount: stats.candidateCount,
    prunedCount: stats.prunedCount,
    cacheHit: false,
    cacheKey: key,
  };
  result.algorithmVersion = PALLET_ALGORITHM_VERSION;
  result.solutionId = palletSolutionId(key);
  optimizationCache.set(key, cloneSerializable(result));
  return result;
}

export function formatPalletPlan(plan) {
  if (!plan?.ok) return plan?.reason === 'unit-too-high' ? '单件高度超过可用堆叠高度' : '没有找到可行叠放方式';
  const surface = Number.isFinite(Number(plan.surfaceUtilization)) ? plan.surfaceUtilization : plan.footprintUtilization;
  const actualLoadHeightMm = Number(plan.actualLoadHeightMm ?? Math.max(0, plan.totalHeightMm - plan.options.pallet.heightMm));
  const palletHeightMm = Number(plan.options.pallet?.heightMm ?? PALLET_SIZE_MM.height);
  const loadHeightMm = Number(plan.options.loadHeightMm ?? Math.max(0, plan.options.heightLimitMm - palletHeightMm));
  const heightUtilization = (actualLoadHeightMm + palletHeightMm) / Math.max(1, loadHeightMm + palletHeightMm);
  const fullRate = Number.isFinite(Number(plan.fullPalletRate))
    ? plan.fullPalletRate
    : Math.min(1, surface * heightUtilization);
  const remainingLengthMm = Number(plan.remainingLengthMm ?? 0);
  const remainingWidthMm = Number(plan.remainingWidthMm ?? 0);
  const remainingHeightMm = Number(plan.remainingHeightMm ?? Math.max(0, loadHeightMm - actualLoadHeightMm));
  return `托盘${plan.options.pallet.lengthMm}×${plan.options.pallet.widthMm} mm：每层${plan.itemsPerLayer.join('/')}件，叠放${plan.layerCount}层，总数${plan.totalCount}件，台板剩余量长${remainingLengthMm.toFixed(0)} mm、宽${remainingWidthMm.toFixed(0)} mm、高${remainingHeightMm.toFixed(0)} mm，平面率${(surface * 100).toFixed(1)}%，满板率${(fullRate * 100).toFixed(1)}%，带板高${plan.totalHeightMm} mm`;
}
