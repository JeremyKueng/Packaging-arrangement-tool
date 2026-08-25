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

test('输出次优解：总数次高且层结构与最优不同，缓存命中后仍保留', () => {
  clearPalletLayoutCache();
  const first = optimizePalletLayout(layerRulesBaseInput);
  assert.equal(first.hasRunnerUp, true);
  const runner = first.runnerUp;
  assert.equal(runner.isRunnerUp, true);
  assert.ok(runner.totalCount <= first.totalCount, '次优总数不应高于最优');
  assert.notEqual(structureSig(runner), structureSig(first), '层结构签名应与最优不同');
  assert.equal(first.placements.length, first.totalCount);
  // 缓存命中路径同样要带出次优解。
  const cached = optimizePalletLayout(layerRulesBaseInput);
  assert.equal(cached.debug.cacheHit, true);
  assert.equal(cached.runnerUp.isRunnerUp, true);
  assert.equal(cached.runnerUp.totalCount, runner.totalCount);
});
