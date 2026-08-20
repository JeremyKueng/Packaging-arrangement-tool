// ===== 尺寸与品类配置 =====
//
// 坐标口径：世界坐标 X = 行（排），Z = 列（每排包数），Y = 层。
// 界面显示顺序恒为 X × Z × Y（formatXzySize 负责排版）。
//
// 尺寸口径分层（三者不能混成一组）：
//   dimensions —— 包装/排列计算尺寸，dimsFor 等换算函数使用。
//   visualStyle —— 模型视觉尺寸，makeProduct 等场景构建使用（当前仍在 index.html 内，未迁入）。
//   真实尺寸   —— 待产品规格表 / SKU 数据确认后录入，unit 改为 'mm'，并补 sku / verifiedAt。
//
// 当前无权威数据：所有数值标记 unit:'relative'，仅表示现有视觉模型的比例关系，不代表业务标准。
// 后续拿到权威 SKU 尺寸后，只替换本文件的 dimensions 数据，不改换算算法。

export const COORDINATES = {
  axes: { rows: 'x', cols: 'z', layers: 'y' },
  displayOrder: ['x', 'z', 'y'],
};

// 场景单位换算：1 mm = 0.01 场景单位。现有相对尺寸（如软抽长 1.80）即等价于 180 mm。
// 自定义小粒尺寸以 mm 录入，通过本系数换算回场景单位，保证既有比例与容器余量口径不变。
export const SCENE_UNITS_PER_MM = 0.01;

// 默认小粒尺寸（mm），按当前模型比例换算：软抽 180×108×56、纸手帕 92×134×24、卫卷卷径 100/卷高 115/卷芯直径 40。
// 无芯卫卷默认按 20% 压扁率表达；有芯卫卷仍保持圆形截面。
export const DEFAULT_PRODUCT_SIZE_MM = {
  handkerchief: { lengthMm: 92, widthMm: 134, heightMm: 24 },
  softdraw: { lengthMm: 180, widthMm: 108, heightMm: 56 },
  roll: { diameterMm: 100, axialWidthMm: 115, coreDiameterMm: 40, flattenRatePct: 20 },
};

// 软抽子品类可有独立默认规格；它们仍属于同一种箱型尺寸口径。
// 悬挂式底抽的 315 mm 仅指产品本体高度，顶部柔性提手固定高度且不计入本表。
export const DEFAULT_SOFTDRAW_VARIANT_SIZE_MM = Object.freeze({
  standard: DEFAULT_PRODUCT_SIZE_MM.softdraw,
  'hanging-bottom': { lengthMm: 153, widthMm: 100, heightMm: 315 },
});

export function defaultProductSizeMm(type, softdrawVariant = 'standard') {
  if (type === 'softdraw') return DEFAULT_SOFTDRAW_VARIANT_SIZE_MM[softdrawVariant] || DEFAULT_PRODUCT_SIZE_MM.softdraw;
  return DEFAULT_PRODUCT_SIZE_MM[type];
}

export const catalog = {
  handkerchief: {
    name: '纸手帕（便携纸巾）',
    color: 0x2c78dc,
    shape: 'box',
    // 长 = 顶封面方向（X），宽 = 侧封面方向（Z），高 = 层数方向（Y）
    dimensions: { unit: 'relative', length: 0.92, width: 1.34, height: 0.24, source: 'current-visual-model' },
    reference: { topAxis: 'y+', handleAxis: null, openingAxis: 'z-' },
    orientations: [
      ['flat', '平放（顶封面向上）'],
      ['side', '侧放（侧封面朝外）'],
    ],
    axisLabels: ['长向列数 X', '宽向排数 Z', '高 / 层数 Y'],
    presets: [
      ['长型单层（示例 6 包）', 6, 1, 1, 'flat'], ['长型双层（示例 12 包）', 6, 1, 2, 'flat'], ['长型三层（示例 18 包）', 6, 1, 3, 'flat'],
      ['12包-3×2×2', 3, 2, 2, 'flat'], ['16包-4×2×2', 4, 2, 2, 'flat'], ['18包-3×3×2', 3, 3, 2, 'flat'], ['18包-3×2×3', 3, 2, 3, 'flat'],
      ['20包-5×2×2', 5, 2, 2, 'flat'], ['24包-4×3×2', 4, 3, 2, 'flat'], ['24包-4×2×3', 4, 2, 3, 'flat'], ['30包-5×3×2', 5, 3, 2, 'flat'],
      ['30包-5×2×3', 5, 2, 3, 'flat'], ['36包-3×3×4', 3, 3, 4, 'flat'], ['36包-4×3×3', 4, 3, 3, 'flat'], ['48包-4×3×4', 4, 3, 4, 'flat'],
      ['10包-便携5×2×1', 5, 2, 1, 'side'],
    ],
  },
  softdraw: {
    name: '软抽',
    color: 0x159a92,
    shape: 'box',
    // 长 = 1.80（X），宽 = 1.08（Z，业务口径「宽 100」），高 = 0.56（Y）
    dimensions: { unit: 'relative', length: 1.80, width: 1.08, height: 0.56, source: 'current-visual-model' },
    reference: { topAxis: 'y+', handleAxis: 'z-', openingAxis: 'z-' },
    orientations: [
      ['flat', '平放（刻线向上，宽100水平）'],
      ['side', '侧立（刻线向提手，宽100竖直）'],
    ],
    axisLabels: ['排数 X', '每排包数 Z', '层数 Y'],
    presets: [
      ['单排单层-4包', 1, 4, 1, 'side'], ['双排单层-8包', 2, 4, 1, 'side'], ['单排双层-8包', 1, 4, 2, 'side'], ['三排单层-12包', 3, 4, 1, 'side'],
      ['16包-平2×4×2', 2, 4, 2, 'flat'], ['18包-平2×3×3', 2, 3, 3, 'flat'], ['20包-平2×5×2', 2, 5, 2, 'flat'], ['20包-侧2×5×2', 2, 5, 2, 'side'],
      ['24包-平2×4×3', 2, 4, 3, 'flat'], ['24包-平2×3×4', 2, 3, 4, 'flat'], ['30包-平2×5×3', 2, 5, 3, 'flat'], ['擦手纸_纵向单层', 2, 3, 1, 'side'],
    ],
  },
  roll: {
    name: '卫卷',
    color: 0x8c5ad6,
    shape: 'cylinder',
    // 卷径 = 1.00，卷高 = 1.15，卷芯直径 = 0.40；三种朝向仅改变圆柱轴的方向。
    dimensions: { unit: 'relative', diameter: 1.00, axialWidth: 1.15, coreDiameter: 0.40, source: 'current-visual-model' },
    reference: { cylinderAxis: 'y' },
    orientations: [
      ['upright', '立（裁切面向上）'],
      ['horizontal', '横（侧面横向入料）'],
      ['lying', '卧（裁切面入料）'],
    ],
    axisLabels: ['固定列数 X', 'N 行数 Z', '层数 Y'],
    presets: [
      ['立-2×N×1（N=5）', 2, 5, 1, 'upright'], ['立-2×N×2（N=6）', 2, 6, 2, 'upright'], ['立-3×N×1（N=5）', 3, 5, 1, 'upright'],
      ['立-3×N×2（N=4）', 3, 4, 2, 'upright'], ['横-1×N×2（N=6）', 1, 6, 2, 'horizontal'], ['卧-4×N×2（N=3）', 4, 3, 2, 'lying'],
    ],
  },
};

// 领域枚举常量（纯配置，供 UI 与预设标准化共用）
export const HANDLE_SIDES = ['z+', 'z-', 'x+', 'x-'];
export const ROLL_CORES = ['cored', 'coreless'];
// 有芯卫卷膜包预设统一为 2×1×N：2 卷=2×1×1、4 卷=2×1×2、6 卷=2×1×3（X 并列 × Z 单排 × Y 叠层）。
export const ROLL_BUNDLE_MODES = ['single', '2', '4', '6', 'custom'];
// 直装（单粒直接装入大包/装箱）时绕竖直轴的剩余旋转自由度：0°/90°/180°/270°，覆盖四个朝向。
// 用于表达“该装入姿态仍可旋转的面”：软抽直立控制开口刻线朝向（四个面可选）、立式卷膜包 ×2 面朝向等。
export const DIRECT_SPINS = ['none', '90', '180', '270'];
export const SOFTDRAW_VARIANTS = ['standard', 'hanging-bottom'];
export const SOFTDRAW_VARIANT_LABELS = Object.freeze({
  standard: '普通软抽',
  'hanging-bottom': '悬挂式底抽',
});
export const HANGING_SIDE_DIRECTIONS = ['parallel', 'cross'];
export const HANGING_SIDE_DIRECTION_LABELS = Object.freeze({
  parallel: '侧立同向',
  cross: '侧立同面十字（整包旋转 90°）',
});
export const PACKAGING_LEVELS = ['midpack', 'bigpack', 'case'];
export const LOAD_FACES = ['y+', 'z-', 'z+', 'x-', 'x+'];
export const UNIT_POSTURES = ['flat', 'side', 'end'];
export const UNIT_FACINGS = ['z-', 'z+', 'x-', 'x+'];
export const STACK_MODES = ['same'];
export const LEGACY_UNIT_POSES = ['flat-z-', 'flat-z+', 'flat-x-', 'flat-x+'];

export const PRODUCT_ORIENTATIONS = [...new Set(Object.values(catalog).flatMap(item => item.orientations.map(o => o[0])))];

// 包装规则：压缩系数、膜余量等，与产品本体尺寸分离。
export const packagingRules = {
  // 中包组合视图 Y 向轻度压紧；端部厚边由 bagPadding 控制，不能靠压扁产品解决。
  midpackHeightScale: { handkerchief: 0.88, softdraw: 0.82, roll: 1 },
  // 卫卷小包组合：卷间间隙与整体膜余量（尺寸换算用）。
  // 外膜为贴合收缩膜形态：余量只保留薄膜厚度级（原方盒口径 0.08 收紧为 0.03）。
  rollBundleGap: 0,
  rollBundleFilmAllowance: 0.03,
  // 中包膜相对总尺寸的 X/Y/Z 总余量（两侧均分）。X/Z 只留薄膜贴合量，避免端部出现厚底。
  bagPadding: [0.015, 0.035, 0.015],
};

export function midpackHeightScale(type) {
  return packagingRules.midpackHeightScale[type] || 1;
}

// 校验并规范化产品尺寸覆盖：非法/越界/未启用回退品类默认；返回 {enabled, ...mm} 供 UI 与计算共用。
export function normalizeProductSizeOverride(type, override) {
  const defaults = DEFAULT_PRODUCT_SIZE_MM[type];
  if (!defaults) return { enabled: false };
  if (!override || typeof override !== 'object' || Array.isArray(override) || !override.enabled) {
    return { enabled: false, ...defaults };
  }
  const clampMm = (value, min, max, fallback) => {
    const num = Number(value);
    return Number.isFinite(num) && num >= min && num <= max ? num : fallback;
  };
  if (type === 'roll') {
    const diameterMm = clampMm(override.diameterMm, 1, 1000, defaults.diameterMm);
    // 卷芯必须小于卷径，最多取卷径的 90%，避免卷芯穿出纸卷。
    const maxCoreDiameter = Math.max(1, Math.min(500, diameterMm * 0.9));
    return {
      enabled: true,
      diameterMm,
      axialWidthMm: clampMm(override.axialWidthMm, 1, 1000, defaults.axialWidthMm),
      coreDiameterMm: clampMm(override.coreDiameterMm, 1, maxCoreDiameter, Math.min(defaults.coreDiameterMm, maxCoreDiameter)),
      // 0% = 圆形；上限 50% 避免长轴无限放大导致排列失真。
      flattenRatePct: clampMm(override.flattenRatePct, 0, 50, defaults.flattenRatePct),
    };
  }
  return {
    enabled: true,
    lengthMm: clampMm(override.lengthMm, 1, 2000, defaults.lengthMm),
    widthMm: clampMm(override.widthMm, 1, 2000, defaults.widthMm),
    heightMm: clampMm(override.heightMm, 1, 2000, defaults.heightMm),
  };
}

// 解析产品基准尺寸（场景单位）：override.enabled 时用自定义 mm 换算，否则返回 catalog 默认相对尺寸。
export function resolveProductDimensions(type, override) {
  const normalized = normalizeProductSizeOverride(type, override);
  if (!normalized.enabled) {
    if (type === 'roll') return { ...catalog[type].dimensions, flattenRatePct: normalized.flattenRatePct };
    return catalog[type].dimensions;
  }
  if (type === 'roll') {
    return {
      diameter: normalized.diameterMm * SCENE_UNITS_PER_MM,
      axialWidth: normalized.axialWidthMm * SCENE_UNITS_PER_MM,
      coreDiameter: normalized.coreDiameterMm * SCENE_UNITS_PER_MM,
      flattenRatePct: normalized.flattenRatePct,
    };
  }
  return {
    length: normalized.lengthMm * SCENE_UNITS_PER_MM,
    width: normalized.widthMm * SCENE_UNITS_PER_MM,
    height: normalized.heightMm * SCENE_UNITS_PER_MM,
  };
}

// 无芯卫卷压扁后的椭圆截面。
// 采用截面积近似守恒：原圆面积 πD²/4 = 椭圆面积 π×长轴×短轴/4。
// 因此短轴 = D×(1-r)，长轴 = D²/短轴。D 可用 mm 或场景单位，返回值保持同一单位。
export function resolveCorelessRollCrossSection(diameter, flattenRatePct = DEFAULT_PRODUCT_SIZE_MM.roll.flattenRatePct) {
  const d = Math.max(0.0001, Number(diameter) || 0.0001);
  const rate = Math.max(0, Math.min(50, Number(flattenRatePct) || 0));
  const minorDiameter = d * (1 - rate / 100);
  const majorDiameter = d * d / minorDiameter;
  return { majorDiameter, minorDiameter, flattenRatePct: rate };
}
