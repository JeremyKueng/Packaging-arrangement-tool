// ===== 分层规则（v3）与次优解回归测试 =====

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearPalletLayoutCache,
  enumerateSingleEdgeLayouts,
  normalizePalletOptions,
  optimizePalletLayout,
  palletRowMarginReport,
} from '../src/pallet-core.js';

const layerRulesBaseInput = {
  packageType: 'softpack',
  unitSizeMm: { lengthMm: 400, widthMm: 180, heightMm: 280 },
  loadHeightMm: 1040,
  allowedOrientations: ['A', 'B'],
  layerStrategy: 'cyclic-interlock',
  softpackOptions: { cornerProtectorsEnabled: false, topSideLayMode: 'off' },
};

function boundsOf(placements) {
  return placements.reduce((b, item) => ({
    minX: Math.min(b.minX, item.xMm - item.lengthMm / 2),
    maxX: Math.max(b.maxX, item.xMm + item.lengthMm / 2),
    minZ: Math.min(b.minZ, item.zMm - item.widthMm / 2),
    maxZ: Math.max(b.maxZ, item.zMm + item.widthMm / 2),
  }), { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });
}

function structureSig(plan) {
  return plan.layers.map(layer => layer.length + (layer.some(item => item.posture === 'side-lay') ? 's' : '')).join('|');
}

// 正常姿态层的“每层数量”序列——次优方案的判定口径。
function normalLayerCounts(plan) {
  return plan.layers
    .filter(layer => !layer.some(item => item.posture === 'side-lay'))
    .map(layer => layer.length)
    .join('/');
}

const runnerUpCaseInput = {
  packageType: 'softpack',
  unitSizeMm: { lengthMm: 325, widthMm: 180, heightMm: 438 },
  loadHeightMm: 1300,
  allowedOrientations: ['A', 'B'],
  layerStrategy: 'cyclic-interlock',
  softpackOptions: { cornerProtectorsEnabled: false, topSideLayMode: 'auto' },
  faceConstraint: { enabled: true, palletEdge: 'z-', unitFace: 'long-side', layout: 'edge-exposure' },
};

test('软包默认启用分层规则（内建算法，无需开关）；纸箱与显式关闭回退统一规则', () => {
  const softpackDefaults = normalizePalletOptions({
    packageType: 'softpack',
    unitSizeMm: { lengthMm: 400, widthMm: 180, heightMm: 280 },
    loadHeightMm: 1040,
  });
  assert.equal(softpackDefaults.layerRules.enabled, true);
  assert.equal(softpackDefaults.layerRules.sideLayMaxOverhangMm, 10);
  assert.equal(softpackDefaults.layerRules.minRowMarginMm, 50);

  const caseDefaults = normalizePalletOptions({
    packageType: 'case',
    unitSizeMm: { lengthMm: 400, widthMm: 180, heightMm: 280 },
    loadHeightMm: 1040,
  });
  assert.equal(caseDefaults.layerRules.enabled, false);

  clearPalletLayoutCache();
  // 显式关闭后回到统一规则口径：与“关闭+默认参数”结果一致。
  const legacy = optimizePalletLayout({ ...layerRulesBaseInput, layerRules: { enabled: false } });
  const disabled = optimizePalletLayout({
    ...layerRulesBaseInput,
    layerRules: { enabled: false, sideLayMaxOverhangMm: 10, minRowMarginMm: 50 },
  });
  assert.equal(legacy.totalCount, disabled.totalCount);
  assert.equal(legacy.layerCount, disabled.layerCount);
});

test('规则一：顶层侧倒相对下层轮廓出边不得超过设定值', () => {
  clearPalletLayoutCache();
  const baseline = optimizePalletLayout({ ...layerRulesBaseInput, softpackOptions: { cornerProtectorsEnabled: false, topSideLayMode: 'auto' } });
  const limited = optimizePalletLayout({
    ...layerRulesBaseInput,
    softpackOptions: { cornerProtectorsEnabled: false, topSideLayMode: 'auto' },
    layerRules: { enabled: true, sideLayMaxOverhangMm: 10, minRowMarginMm: 0 },
  });
  assert.equal(limited.ok, true);
  // 规则只会收缩可行域，件数不会变多。
  assert.ok(limited.totalCount <= baseline.totalCount);
  if (limited.topSideLayApplied && limited.layerCount > 1) {
    const lower = boundsOf(limited.layers.at(-2));
    const upper = boundsOf(limited.layers.at(-1));
    const overhang = Math.max(lower.minX - upper.minX, upper.maxX - lower.maxX, lower.minZ - upper.minZ, upper.maxZ - lower.maxZ, 0);
    assert.ok(overhang <= 10 + 1e-6, `侧倒出边 ${overhang} 应 ≤ 10`);
  }
});

test('约束二：单边展示模板与行余量兼容（枚举缩短填充列数的变体）', () => {
  clearPalletLayoutCache();
  const input = {
    ...layerRulesBaseInput,
    faceConstraint: { enabled: true, palletEdge: 'z-', unitFace: 'long-side', layout: 'edge-exposure' },
  };
  const templates = enumerateSingleEdgeLayouts(input);
  assert.ok(templates.length >= 1, '长侧面单边展示应有可行模板');
  const usableLength = normalizePalletOptions(input).usablePallet.lengthMm;
  for (const tpl of templates) {
    const report = palletRowMarginReport(tpl.placements);
    if (report.rows.length > 1) {
      const bestRest = Math.max(...report.rows.slice(1).map(row => usableLength - row.spanLengthMm));
      assert.ok(bestRest >= 50 - 1e-6, `单边模板其余排最大余量 ${bestRest} 应 ≥ 50`);
    }
  }
  // 存在缩短填充列的变体（填满版所有行都贴边、无法满足行余量）。
  const plan = optimizePalletLayout(input);
  assert.equal(plan.ok, true);
  for (const layer of plan.layers) {
    if (layer.some(item => item.posture === 'side-lay')) continue;
    const report = palletRowMarginReport(layer);
    if (report.rows.length > 1) {
      const bestRest = Math.max(...report.rows.slice(1).map(row => usableLength - row.spanLengthMm));
      assert.ok(bestRest >= 50 - 1e-6, '正常姿态层应满足行余量');
    }
  }
});

test('规则三：软包缺省即生效——每一层其余排至少一排沿托盘长向剩余≥50mm', () => {
  clearPalletLayoutCache();
  const input = layerRulesBaseInput;
  const baseline = optimizePalletLayout({ ...layerRulesBaseInput, layerRules: { enabled: false } });
  const plan = optimizePalletLayout(input);
  assert.equal(plan.ok, true);
  assert.ok(plan.totalCount <= baseline.totalCount, '规则收紧后件数不应增加');
  const usableLength = plan.options.usablePallet?.lengthMm ?? plan.options.pallet.lengthMm;
  for (let index = 0; index < plan.layers.length; index++) {
    const report = palletRowMarginReport(plan.layers[index]);
    if (report.rows.length > 1) {
      const bestRest = Math.max(...report.rows.slice(1).map(row => usableLength - row.spanLengthMm));
      assert.ok(bestRest >= 50 - 1e-6, `第 ${index + 1} 层其余排最大余量 ${bestRest} 应 ≥ 50`);
    }
  }
});

test('次优解定义：同高度下每层数量下调整档的另一种排法（仅顶层侧倒差异不算），缓存命中后仍保留', () => {
  clearPalletLayoutCache();
  const first = optimizePalletLayout(runnerUpCaseInput);
  assert.equal(first.hasRunnerUp, true);
  const runner = first.runnerUp;
  assert.equal(runner.isRunnerUp, true);
  assert.ok(runner.totalCount <= first.totalCount, '次优总数不应高于最优');
  // 每层数量必须真的下调整档：正常姿态层的件数序列与最优不同——
  // “仅顶层侧倒少一件”的方案不属于次优。
  assert.notEqual(normalLayerCounts(runner), normalLayerCounts(first), '正常层每层数量应与最优不同');
  // 向下兼容口径：能放 N 件必然能放 N-1 件，次优只降一件而不是跳档。
  const firstNormalCount = plan => Number(normalLayerCounts(plan).split('/')[0]);
  assert.equal(firstNormalCount(runner), firstNormalCount(first) - 1, '次优每层应恰好比最优少一件');
  assert.equal(runner.layerCount, first.layerCount, '次优应与最优同高度（层数一致）');
  assert.equal(first.placements.length, first.totalCount);
  // 缓存命中路径同样要带出次优解。
  const cached = optimizePalletLayout(runnerUpCaseInput);
  assert.equal(cached.debug.cacheHit, true);
  assert.equal(cached.runnerUp.isRunnerUp, true);
  assert.equal(cached.runnerUp.totalCount, runner.totalCount);
});

function boundsMinMax(placements) {
  return placements.reduce((b, item) => ({
    minX: Math.min(b.minX, item.xMm - item.lengthMm / 2),
    maxX: Math.max(b.maxX, item.xMm + item.lengthMm / 2),
    minZ: Math.min(b.minZ, item.zMm - item.widthMm / 2),
    maxZ: Math.max(b.maxZ, item.zMm + item.widthMm / 2),
  }), { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });
}

test('案例回归：325×180×438 单边展示＋1300 高度——模板逐层一致且顶层侧倒生效', () => {
  clearPalletLayoutCache();
  const input = {
    packageType: 'softpack',
    unitSizeMm: { lengthMm: 325, widthMm: 180, heightMm: 438 },
    loadHeightMm: 1300,
    allowedOrientations: ['A', 'B'],
    layerStrategy: 'cyclic-interlock',
    softpackOptions: { cornerProtectorsEnabled: false, topSideLayMode: 'auto' },
    faceConstraint: { enabled: true, palletEdge: 'z-', unitFace: 'long-side', layout: 'edge-exposure' },
  };
  const plan = optimizePalletLayout(input);
  assert.equal(plan.ok, true);
  assert.equal(plan.topSideLayApplied, true);
  assert.ok(plan.layerCount >= 3, '1300 高度应能叠到第三层（顶层侧倒）');
  // 业务基准：默认出边上限 10mm 内即应复现现场 36 件 [15/15/6]。
  // 模板变体若按重心偏移择优会选中较窄轮廓，把必要出边推高到 23mm——回归此行为时在此失败。
  assert.equal(plan.totalCount, 36, '默认 10mm 出边上限应达到现场 36 件');
  assert.deepEqual(plan.itemsPerLayer, [15, 15, 6]);
  // 正常姿态层必须复用同一单边模板（覆盖面积一致）。
  const posSig = layer => layer.map(item => [item.xMm, item.zMm, item.orientation].join(':')).sort().join('|');
  const normalLayers = plan.layers.filter(layer => layer.every(item => item.posture === 'normal'));
  assert.ok(normalLayers.length >= 2, '应有至少两层正常姿态层');
  for (const layer of normalLayers) assert.equal(posSig(layer), posSig(normalLayers[0]), '单边模板各层结构应一致');
  // 每层相对下层出边 ≤10mm。
  for (let i = 1; i < plan.layers.length; i++) {
    const lo = boundsMinMax(plan.layers[i - 1]);
    const up = boundsMinMax(plan.layers[i]);
    const overhang = Math.max(lo.minX - up.minX, up.maxX - lo.maxX, lo.minZ - up.minZ, up.maxZ - lo.maxZ, 0);
    assert.ok(overhang <= 10 + 1e-6, '第 ' + (i + 1) + ' 层出边 ' + overhang.toFixed(1) + ' 应 ≤ 10');
  }
});
