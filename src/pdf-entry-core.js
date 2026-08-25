// ===== 统一 PDF 条目模型 =====
// 纯函数，无 DOM 依赖：接收已规范化的预设列表，输出统一条目 + 排除统计。
// 每个条目保存完整快照，导出时不再重新读取当前 UI 状态。

import { catalog, normalizeProductSizeOverride, resolveCorelessRollCrossSection, SOFTDRAW_VARIANT_LABELS } from './dimensions.js';
import { deriveCartonNaming } from './carton-naming.js';
import { caseDividerRequirement } from './case-divider.js';

export const STAGE_NAMES = { product: '单元定义', midpack: '中包工段', bigpack: '大包工段', case: '装箱工段', pallet: '叠板工段' };
const STAGE_ORDER = { product: 0, midpack: 1, bigpack: 2, case: 3, pallet: 4 };

// ===== 业务词典：把内部枚举转换为正式包装说明，不泄露 flat/side/z-/A端/B端 等程序参数 =====
const PRODUCT_SHORT_NAME = { handkerchief: '纸手帕', softdraw: '软抽', roll: '卫卷' };
const PRODUCT_UNIT = { handkerchief: '包', softdraw: '包', roll: '卷' };

const ORIENTATION_LABELS = {
  handkerchief: { flat: '平放，正面朝上', side: '侧放，侧封面朝外' },
  softdraw: { flat: '平放，抽取口朝上', side: '侧立，抽取口朝中包提手方向', upright: '直立，小端面向下' },
  roll: { upright: '立式摆放，裁切面朝上', horizontal: '横式摆放，卷轴保持水平', lying: '卧式摆放，裁切面朝侧向' },
};

// 方向词（去掉 A 端/B 端系统命名，改为可执行的物理方位描述）。
const DIRECTION_LABELS = {
  'y+': '顶部',
  'z-': '长向端部',
  'z+': '长向另一端',
  'x-': '宽向侧部',
  'x+': '宽向另一侧',
};

// 中包姿态（用于外包装「中包摆放」字段，字段已含“中包”前缀，此处只保留姿态）。
const MIDPACK_POSTURE_LABELS = { flat: '平放', side: '侧立', end: '端立' };

function orientationText(productType, orientation) {
  const table = ORIENTATION_LABELS[productType] || {};
  return table[orientation] || orientation;
}

function rollCoreText(snapshot) {
  return snapshot?.rollCore === 'coreless' ? '无芯卫卷' : '有芯卫卷';
}

function softdrawName(snapshot) {
  return SOFTDRAW_VARIANT_LABELS[snapshot?.softdrawVariant] || SOFTDRAW_VARIANT_LABELS.standard;
}

// 小粒尺寸说明：mm 口径，缺失/非法回退品类默认。
function dimensionText(productType, dimensionsMm, rollCore = 'cored') {
  const d = normalizeProductSizeOverride(productType, dimensionsMm);
  if (productType === 'roll') {
    if (rollCore === 'coreless') {
      const cross = resolveCorelessRollCrossSection(d.diameterMm, d.flattenRatePct);
      return `单卷尺寸：原始卷径${d.diameterMm} mm，卷高${d.axialWidthMm} mm；压扁率${d.flattenRatePct}%，椭圆截面约${cross.majorDiameter.toFixed(1)}×${cross.minorDiameter.toFixed(1)} mm。`;
    }
    return `单卷尺寸：卷径${d.diameterMm} mm，卷高${d.axialWidthMm} mm，卷芯直径${d.coreDiameterMm} mm。`;
  }
  return `单包尺寸：${d.lengthMm}×${d.widthMm}×${d.heightMm} mm。`;
}

// 从快照推导折合卷数（单卷/4卷/6卷/自定义）。
function bundleCount(snapshot) {
  if (!snapshot) return 1;
  if (snapshot.rollCore === 'coreless') return 1;
  const mode = snapshot.rollBundleMode || 'single';
  if (mode === 'single') return 1;
  if (mode === '4') return 4;
  if (mode === '6') return 6;
  return (snapshot.rollBundleX || 1) * (snapshot.rollBundleZ || 1) * (snapshot.rollBundleY || 1);
}

function sourcePathFor(stage, sourceType, productType, presetName) {
  const productName = catalog[productType].name;
  if (stage === 'product') return `${productName}单粒`;
  if (stage === 'midpack') return `${productName}单粒 → 中包`;
  const outerName = STAGE_NAMES[stage].replace('工段', '');
  if (sourceType === 'product') return `${productName}单粒 → 直装 → ${outerName}`;
  return `${productName}单粒 → ${presetName || '中包'} → ${outerName}`;
}

// 单元定义：无独立预设存储，第一版只导出当前已确认的单元形态（可选附录）。
export function buildProductPdfEntries(productTypes, currentProduct) {
  if (!currentProduct) return [];
  const type = currentProduct.type;
  if (!productTypes.includes(type)) return [];
  return [{
    id: `product:${type}`,
    stage: 'product',
    stageName: STAGE_NAMES.product,
    productType: type,
    productName: catalog[type].name,
    sourceType: 'product',
    sourcePath: `${catalog[type].name}单粒`,
    sourceSnapshot: currentProduct.snapshot ? { ...currentProduct.snapshot } : null,
    presetId: null,
    presetName: null,
    presetSnapshot: null,
    count: 1,
    foldedCount: bundleCount(currentProduct.snapshot),
    loadFace: null,
    unitPosture: null,
    unitFacing: null,
  }];
}

// 中包：包含所有内置与自定义预设。
export function buildMidpackPdfEntries(productTypes, midpackLists) {
  const entries = [];
  for (const productType of productTypes) {
    const list = midpackLists[productType] || [];
    for (const preset of list) {
      const singleSnapshot = {
        orientation: preset.orientation,
        softdrawVariant: preset.softdrawVariant,
        hangingSideDirection: preset.hangingSideDirection,
        rollCore: preset.rollCore,
        rollBundleMode: preset.rollBundleMode,
        rollBundleX: preset.rollBundleX,
        rollBundleZ: preset.rollBundleZ,
        rollBundleY: preset.rollBundleY,
        dimensionsMm: preset.dimensionsMm,
      };
      entries.push({
        id: `midpack:${preset.id}`,
        stage: 'midpack',
        stageName: STAGE_NAMES.midpack,
        productType,
        productName: catalog[productType].name,
        sourceType: 'product',
        sourcePath: `${catalog[productType].name}单粒 → 中包`,
        sourceSnapshot: singleSnapshot,
        presetId: preset.id,
        presetName: preset.name,
        presetSnapshot: {
          rows: preset.rows, cols: preset.cols, layers: preset.layers,
          orientation: preset.orientation, handleSide: preset.handleSide, softdrawVariant: preset.softdrawVariant, hangingSideDirection: preset.hangingSideDirection,
          rollCore: preset.rollCore, rollBundleMode: preset.rollBundleMode,
          rollBundleX: preset.rollBundleX, rollBundleZ: preset.rollBundleZ, rollBundleY: preset.rollBundleY,
          dimensionsMm: preset.dimensionsMm,
        },
        count: preset.rows * preset.cols * preset.layers,
        foldedCount: preset.rows * preset.cols * preset.layers * bundleCount(singleSnapshot),
        loadFace: null,
        unitPosture: null,
        unitFacing: null,
      });
    }
  }
  return entries;
}

// 大包/装箱：仅包含已保存、已绑定来源的方案；temporary / 旧方案 / 非法快照计入 excluded。
export function buildOuterPdfEntries(level, productTypes, outerList, excluded) {
  const entries = [];
  for (const preset of outerList || []) {
    if (preset.builtIn) { excluded.temporary++; continue; }
    if (preset.invalidSource) { excluded.invalidSource++; continue; }
    if (preset.legacy) { excluded.legacyUnbound++; continue; }
    if (!preset.source) { excluded.invalidSource++; continue; } // 兜底
    if (!productTypes.includes(preset.source.productType)) continue; // 未选品类，不计排除
    const src = preset.source;
    const unitCount = preset.rows * preset.cols * preset.layers;
    const midpackProductCount = src.type === 'midpack' ? (src.snapshot.rows * src.snapshot.cols * src.snapshot.layers) : 1;
    const foldedCount = unitCount * midpackProductCount * bundleCount(src.snapshot);
    entries.push({
      id: `${level}:${preset.id}`,
      stage: level,
      stageName: STAGE_NAMES[level],
      productType: src.productType,
      productName: catalog[src.productType].name,
      sourceType: src.type,
      sourcePath: sourcePathFor(level, src.type, src.productType, src.presetName),
      sourcePresetId: src.presetId || null,
      sourcePresetName: src.presetName || null,
      sourceSnapshot: { ...src.snapshot },
      presetId: preset.id,
      presetName: preset.name,
      presetSnapshot: {
        rows: preset.rows, cols: preset.cols, layers: preset.layers,
        spacing: preset.spacing, margin: preset.margin,
        loadFace: preset.loadFace, unitPosture: preset.unitPosture, unitFacing: preset.unitFacing,
        formalNameOverride: preset.formalNameOverride || '',
        stackMode: preset.stackMode,
        dividerMode: preset.dividerMode || 'none',
      },
      count: unitCount,
      foldedCount,
      loadFace: preset.loadFace,
      unitPosture: preset.unitPosture,
      unitFacing: preset.unitFacing,
    });
  }
  return entries;
}

function productPlacementText(type, orientation, snapshot) {
  if (type === 'roll') {
    return `${rollCoreText(snapshot)}${orientationText(type, orientation)}`;
  }
  if (type === 'softdraw' && snapshot?.softdrawVariant === 'hanging-bottom') {
    const direction = orientation === 'side'
      ? (snapshot?.hangingSideDirection === 'cross'
        ? '；侧立时整包绕提手面法向旋转90°，提手面向一致且呈十字方向'
        : '；侧立时小包提手与中包提手同向')
      : '';
    return `${softdrawName(snapshot)}${orientationText(type, orientation)}，固定高度柔性双孔提手位于包装上方（产品高度按软抽本体计算，装包时折叠贴伏），抽取开口位于底面${direction}`;
  }
  return `${PRODUCT_SHORT_NAME[type]}${orientationText(type, orientation)}`;
}

function midpackArrangementText(productType, s) {
  if (productType === 'handkerchief') return `长向${s.rows}包×宽向${s.cols}包×${s.layers}层`;
  if (productType === 'roll') return `${s.rows}列×${s.cols}行×${s.layers}层`;
  return `${s.rows}排×${s.cols}包/排×${s.layers}层`;
}

function midpackCountText(productType, count, foldedCount, snapshot) {
  if (productType === 'roll') {
    const bundle = bundleCount(snapshot);
    if (bundle > 1) return `${count}膜包/中包，折合${foldedCount}卷`;
    return `${count}卷/中包`;
  }
  return `${count}包/中包`;
}

function outerCountText(entry) {
  const type = entry.productType;
  const short = PRODUCT_SHORT_NAME[type];
  const isDirect = entry.sourceType === 'product';
  const bundle = bundleCount(entry.sourceSnapshot);
  const container = entry.stage === 'case' ? '箱' : '袋';
  if (isDirect) {
    if (type === 'roll' && bundle > 1) return `${entry.count}膜包/${container}，折合${entry.foldedCount}卷`;
    const unit = type === 'roll' ? '卷' : '包';
    return `${entry.count}${unit}/${container}`;
  }
  const unit = type === 'roll' ? '卷' : '包';
  return `${entry.count}中包/${container}，折合${entry.foldedCount}${unit}${short}`;
}

// 装入方向：顶部为绝对方向（无容器前缀），其余带容器前缀保证可执行含义。
function loadText(loadFace, containerBody) {
  const dir = DIRECTION_LABELS[loadFace] || '顶部';
  if (dir === '顶部') return '由顶部装入';
  return `由${containerBody}${dir}装入`;
}

function describeProductEntry(entry) {
  const type = entry.productType;
  const s = entry.sourceSnapshot || {};
  const lines = [];
  if (type === 'roll' && bundleCount(s) > 1) {
    lines.push(`装入规格：以${bundleCount(s)}卷膜包作为排列单位。`);
  }
  lines.push(`产品摆放：${productPlacementText(type, s.orientation, s)}。`);
  lines.push(dimensionText(type, s.dimensionsMm, s.rollCore));
  return lines.join('\n');
}

function describeMidpackEntry(entry) {
  const type = entry.productType;
  const s = entry.presetSnapshot || {};
  const lines = [];
  if (type === 'roll' && bundleCount(s) > 1) {
    lines.push(`装入规格：以${bundleCount(s)}卷膜包作为排列单位。`);
  }
  lines.push(`中包排列：${midpackArrangementText(type, s)}。`);
  lines.push(`产品摆放：${productPlacementText(type, s.orientation, s)}。`);
  lines.push(`装包数量：${midpackCountText(type, entry.count, entry.foldedCount, s)}。`);
  lines.push(dimensionText(type, s.dimensionsMm, s.rollCore));
  if (type !== 'handkerchief' && s.handleSide) {
    lines.push(`提手位置：位于中包${DIRECTION_LABELS[s.handleSide] || '长向端部'}。`);
  }
  return lines.join('\n');
}

function describeOuterEntry(entry) {
  const isCase = entry.stage === 'case';
  const verb = isCase ? '装箱' : '装袋';
  const containerBody = isCase ? '箱体' : '袋体';
  const type = entry.productType;
  const short = PRODUCT_SHORT_NAME[type];
  const s = entry.presetSnapshot || {};
  const src = entry.sourceSnapshot || {};
  const isDirect = entry.sourceType === 'product';
  const lines = [];
  const cartonNaming = isCase ? deriveCartonNaming({
    productType: type,
    sourceType: entry.sourceType,
    sourceSnapshot: src,
    sourcePresetName: entry.sourcePresetName,
    presetSnapshot: s,
  }) : null;

  const unitLabel = isCase ? '装箱单元' : '包装单元';

  if (isDirect) {
    const directName = type === 'softdraw' ? softdrawName(src) : short;
    lines.push(`${unitLabel}：${directName}单包直接${verb}，不经过中包。`);
  } else {
    lines.push(`${unitLabel}：${entry.sourcePresetName || '中包'} 中包。`);
  }

  lines.push(`${verb}排列：${s.rows}排×${s.cols}列×${s.layers}层。`);

  if (cartonNaming) {
    lines.push(`装箱正式名称：${cartonNaming.formalName}。`);
  }

  if (isCase && s.dividerMode === 'cross') {
    const divider = caseDividerRequirement(s.dividerMode, s.rows, s.cols);
    const status = divider.completeCross
      ? `奇数时较少数量位于左/前侧`
      : '当前排列不足以形成完整四分区';
    lines.push(`箱内固定：十字挡板，${divider.summary}；${status}。`);
  }

  if (isDirect) {
    const relativeName = cartonNaming ? `${cartonNaming.postureName}，` : '';
    lines.push(`单包摆放：${relativeName}${productPlacementText(type, src.orientation, src)}。`);
    lines.push(`${verb}方向：${loadText(s.loadFace, containerBody)}。`);
  } else {
    const posture = cartonNaming?.postureName || MIDPACK_POSTURE_LABELS[s.unitPosture] || '平放';
    const facing = type !== 'handkerchief' ? `，提手端朝${containerBody}${DIRECTION_LABELS[s.unitFacing] || '长向端部'}` : '';
    lines.push(`中包摆放：${posture}${facing}。`);
    lines.push(`${verb}方向：${loadText(s.loadFace, containerBody)}。`);
  }

  lines.push(`${verb}数量：${outerCountText(entry)}。`);
  lines.push(dimensionText(type, src.dimensionsMm, src.rollCore));
  return lines.join('\n');
}

function describePalletEntry(entry) {
  const s = entry.presetSnapshot || {};
  const size = s.unitSizeMm || {};
  const solution = s.solution || {};
  const packageType = s.packageType === 'softpack' || entry.sourceType === 'softpack' ? 'softpack' : 'case';
  const packageName = packageType === 'softpack' ? '软包' : '纸箱';
  const pattern = Array.isArray(s.basePattern) && s.basePattern.length ? s.basePattern.join('') : 'AAB';
  const strategy = s.layerStrategy === 'same' ? '同向码放' : s.layerStrategy === 'alternate' ? 'A/B逐层交替' : `循环错层（${pattern}→${pattern.slice(1) + pattern[0]}→${pattern.slice(2) + pattern.slice(0, 2)}）`;
  const edgeLayout = s.faceConstraint?.layout === 'edge-exposure'
    || s.faceConstraint?.layout === 'edge-band-max'
    || s.faceConstraint?.layout === 'edge-band-compact'
    ? '；至少保留一排展示面，正向排数及旋转填充由尺寸和护角损耗自动计算'
    : '';
  const face = s.faceConstraint?.enabled
    ? `；托盘其中一条长边展示${s.faceConstraint.unitFace === 'short-side' ? '单元短侧面' : '单元长侧面'}${edgeLayout}`
    : '';
  const corner = packageType === 'softpack' && s.softpackOptions?.cornerProtectorsEnabled
    ? `；使用四护角，长向/宽向单侧各扣减${s.softpackOptions.cornerLossLengthMm || 0}/${s.softpackOptions.cornerLossWidthMm || 0} mm`
    : '';
  const sideLayMode = s.softpackOptions?.topSideLayMode
    || (s.softpackOptions?.allowTopSideLay ? 'auto' : 'off');
  const sideLay = packageType !== 'softpack' || sideLayMode === 'off'
    ? ''
    : sideLayMode === 'force'
      ? '；强制生成顶层 H 面向下侧倒示例'
      : '；允许在增件时采用顶层 H 面向下侧倒';
  const loadHeight = s.loadHeightMm ?? Math.max(0, (s.heightLimitMm || 0) - 160);
  const totalHeight = Number(solution.totalHeightMm) || 0;
  const actualLoadHeight = Math.max(0, Number(solution.actualLoadHeightMm) || Math.max(0, totalHeight - 160));
  const allowedTotalHeight = Number(loadHeight) + 160;
  const surfaceUtilization = Number(solution.surfaceUtilization ?? solution.fullPalletRate ?? solution.footprintUtilization) || 0;
  const heightUtilization = allowedTotalHeight > 0 ? Math.min(1, (actualLoadHeight + 160) / allowedTotalHeight) : 0;
  const fullPalletRate = Math.min(1, surfaceUtilization * heightUtilization);
  const remainingText = value => Number.isFinite(Number(value)) ? `${Number(value).toFixed(0)} mm` : '未记录';
  return [
    `叠板形态：${packageName}（与上游工段解耦）。`,
    `单件箱规：${size.lengthMm || 0}×${size.widthMm || 0}×${size.heightMm || 0} mm（长×宽×高）。`,
    `托板规格：1200×1000×160 mm；可摆放高度${loadHeight} mm，总高上限${loadHeight + 160} mm。`,
    `叠放结果：每层件数${Array.isArray(solution.itemsPerLayer) && solution.itemsPerLayer.length ? solution.itemsPerLayer.join(' / ') : '未记录'}；叠放层数${solution.layerCount ?? 0}层；总数量${solution.totalCount ?? entry.count ?? 0}件。`,
    `台板剩余量：长${remainingText(solution.remainingLengthMm)}、宽${remainingText(solution.remainingWidthMm)}、高${remainingText(solution.remainingHeightMm ?? Math.max(0, Number(loadHeight) - actualLoadHeight))}。`,
    `层间方式：${strategy}${face}${corner}${sideLay}。`,
    `平面率：${(surfaceUtilization * 100).toFixed(1)}%；满板率：${(fullPalletRate * 100).toFixed(1)}%（平面率 ×〔实际叠放高度+160 mm托盘〕÷〔可叠放高度+160 mm托盘〕）；带板高度：${totalHeight} mm。`,
  ].join('\n');
}

// 生成条目的默认业务说明（结构化多行纯文字，可搜索、可复制，不泄露内部枚举）。
export function buildDefaultPdfDescription(entry) {
  switch (entry.stage) {
    case 'product': return describeProductEntry(entry);
    case 'midpack': return describeMidpackEntry(entry);
    case 'bigpack':
    case 'case': return describeOuterEntry(entry);
    case 'pallet': return describePalletEntry(entry);
    default: return '';
  }
}

// 导出编辑状态：仅属于本次导出会话，关闭预览即丢弃，不回写 presetStore / outerPresetStore。
function makeExportOverride(entry) {
  return {
    included: true,
    order: 0,
    displayName: entry.presetName || entry.productName,
    description: null, // null = 未覆盖，渲染时回退到默认说明；用户清空后为 ''，允许不输出说明。
    note: '',
    sectionTitle: '',
  };
}

// 过滤 included + 按 order 排序 + 按「工段:品类:来源类型:来源方案」分组（不同中包来源也拆成独立小节）。纯函数，供预览/下载共用。
export function groupPdfEntries(entries) {
  const included = entries.filter(entry => entry.exportOverride.included).slice();
  // 分区优先级固定为「工段 → 品类 → 来源类型 → 来源方案」。条目上下移动只在所属分区内决定先后。
  included.sort((a, b) => {
    if (a.stage !== b.stage) return STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage];
    if (a.productType !== b.productType) {
      return Object.keys(catalog).indexOf(a.productType) - Object.keys(catalog).indexOf(b.productType);
    }
    if (a.sourceType !== b.sourceType) return a.sourceType === 'midpack' ? -1 : 1;
    const sourceNameCmp = String(a.sourcePresetName || '').localeCompare(String(b.sourcePresetName || ''));
    if (sourceNameCmp !== 0) return sourceNameCmp;
    const sourcePathCmp = String(a.sourcePath || '').localeCompare(String(b.sourcePath || ''));
    if (sourcePathCmp !== 0) return sourcePathCmp;
    return (a.exportOverride.order ?? 0) - (b.exportOverride.order ?? 0);
  });
  const groups = [];
  for (const entry of included) {
    // 经中包时按具体中包方案（presetId）区分来源，避免不同中包来源合并到同一小节。
    const sourceKey = entry.sourceType === 'midpack'
      ? (entry.sourcePresetId || entry.sourcePath || entry.sourcePresetName || 'midpack')
      : entry.sourceType;
    const key = `${entry.stage}:${entry.productType}:${entry.sourceType}:${sourceKey}`;
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.entries.push(entry);
    else groups.push({
      key,
      stage: entry.stage, stageName: entry.stageName,
      productName: entry.productName, productType: entry.productType,
      sourceType: entry.sourceType, sourcePresetId: entry.sourcePresetId || null, sourcePresetName: entry.sourcePresetName || null,
      entries: [entry],
    });
  }
  return groups;
}

// 从最终 included 条目推导有效导出范围（封面/章节统计/文件命名用，不读取初始勾选范围）。
export function effectivePdfScope(entries) {
  const included = entries.filter(entry => entry.exportOverride.included);
  return {
    stages: ['product', 'midpack', 'bigpack', 'case', 'pallet'].filter(stage => included.some(entry => entry.stage === stage)),
    productTypes: [...Object.keys(catalog), 'pallet'].filter(type => included.some(entry => entry.productType === type)),
  };
}

// 叠板 v2：方案与上游品类/预设解耦，只区分纸箱与软包。
export function buildPalletPdfEntries(productTypes, palletLists, excluded) {
  const entries = [];
  const independent = Array.isArray(palletLists?.independent)
    ? palletLists.independent
    : productTypes.flatMap(productType => palletLists?.[productType] || []);
  for (const preset of independent) {
      if (preset.id === 'temporary' || preset.builtIn) { excluded.temporary++; continue; }
      const packageType = preset.packageType === 'softpack' || preset.source?.type === 'bigpack' ? 'softpack' : 'case';
      const count = Number(preset.solution?.totalCount) || (Array.isArray(preset.placementList) ? preset.placementList.length : 0);
      if (count <= 0) { excluded.invalidSource++; continue; }
      entries.push({
        id: `pallet:${preset.id}`,
        stage: 'pallet',
        stageName: STAGE_NAMES.pallet,
        productType: 'pallet',
        productName: packageType === 'softpack' ? '软包' : '纸箱',
        sourceType: packageType,
        sourcePath: `${packageType === 'softpack' ? '软包' : '纸箱'} → 叠板`,
        sourcePresetId: null,
        sourcePresetName: null,
        sourceSnapshot: { packageType },
        presetId: preset.id,
        presetName: preset.name,
        presetSnapshot: {
          packageType,
          unitSizeMm: { ...(preset.unitSizeMm || {}) },
          pallet: { ...(preset.pallet || {}) },
          loadHeightMm: preset.loadHeightMm,
          heightLimitMm: preset.heightLimitMm,
          heightIncludesPallet: preset.heightIncludesPallet !== false,
          layerStrategy: preset.layerStrategy,
          basePattern: Array.isArray(preset.basePattern) ? [...preset.basePattern] : [],
          faceConstraint: preset.faceConstraint ? { ...preset.faceConstraint } : null,
          softpackOptions: preset.softpackOptions ? { ...preset.softpackOptions } : null,
          showFaceLabels: preset.showFaceLabels !== false,
          algorithmVersion: preset.algorithmVersion || null,
          solutionId: preset.solutionId || null,
          algorithmInput: preset.algorithmInput ? { ...preset.algorithmInput } : null,
          solution: preset.solution ? { ...preset.solution } : null,
        },
        count,
        foldedCount: count,
        loadFace: null,
        unitPosture: null,
        unitFacing: null,
      });
  }
  return entries;
}

// 统一入口：工段 → 品类 → 来源路径 → 方案名称 稳定排序。
export function buildPdfEntries(options, lists = {}) {
  const excluded = { temporary: 0, legacyUnbound: 0, invalidSource: 0 };
  const entries = [];
  const stages = options.stages || ['midpack'];
  const productTypes = options.productTypes || Object.keys(catalog);
  if (stages.includes('product')) entries.push(...buildProductPdfEntries(productTypes, options.currentProduct));
  if (stages.includes('midpack')) entries.push(...buildMidpackPdfEntries(productTypes, lists.midpack || {}));
  if (stages.includes('bigpack')) entries.push(...buildOuterPdfEntries('bigpack', productTypes, lists.outer?.bigpack, excluded));
  if (stages.includes('case')) entries.push(...buildOuterPdfEntries('case', productTypes, lists.outer?.case, excluded));
  if (stages.includes('pallet')) entries.push(...buildPalletPdfEntries(productTypes, lists.pallet, excluded));
  entries.sort((a, b) => {
    if (a.stage !== b.stage) return STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage];
    if (a.productType !== b.productType) return productTypes.indexOf(a.productType) - productTypes.indexOf(b.productType);
    if (a.sourceType !== b.sourceType) return a.sourceType === 'midpack' ? -1 : 1;
    const nameCmp = String(a.presetName || '').localeCompare(String(b.presetName || ''));
    if (nameCmp !== 0) return nameCmp;
    return a.id.localeCompare(b.id);
  });
  // 为每条目附加默认纯文字描述 + 独立的 exportOverride（新对象，不污染原预设）。
  const finalEntries = entries.map(entry => ({
    ...entry,
    description: buildDefaultPdfDescription(entry),
    exportOverride: makeExportOverride(entry),
  }));
  return { entries: finalEntries, excluded };
}
