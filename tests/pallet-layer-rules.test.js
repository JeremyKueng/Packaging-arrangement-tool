// ===== 分层规则（v3）与次优解回归测试 =====

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearPalletLayoutCache,
  enumerateSingleEdgeLayouts,
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

test('分层规则关闭时结果与 v2 口径一致（layerRules 缺省不生效）', () => {
  clearPalletLayoutCache();
  const without = optimizePalletLayout(layerRulesBaseInput);
  const withOff = optimizePalletLayout({
    ...layerRulesBaseInput,
    layerRules: { enabled: false, sideLayMaxOverhangMm: 10, secondLayerMode: 'free', minRowMarginMm: 50 },
  });
  assert.equal(without.totalCount, withOff.totalCount);
  assert.equal(without.layerCount, withOff.layerCount);
});

test('规则一：顶层侧倒相对下层轮廓出边不得超过设定值', () => {
  clearPalletLayoutCache();
  const baseline = optimizePalletLayout({ ...layerRulesBaseInput, softpackOptions: { cornerProtectorsEnabled: false, topSideLayMode: 'auto' } });
  const limited = optimizePalletLayout({
    ...layerRulesBaseInput,
    softpackOptions: { cornerProtectorsEnabled: false, topSideLayMode: 'auto' },
    layerRules: { enabled: true, sideLayMaxOverhangMm: 10, secondLayerMode: 'free', minRowMarginMm: 0 },
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

test('规则二：第二层固定为长侧面单边展示模板（全局展示约束关闭时仍生效）', () => {
  clearPalletLayoutCache();
  const input = {
    ...layerRulesBaseInput,
    layerRules: { enabled: true, sideLayMaxOverhangMm: 10, secondLayerMode: 'long-side', minRowMarginMm: 0 },
  };
  const plan = optimizePalletLayout(input);
  assert.equal(plan.ok, true);
  assert.ok(plan.layers.length >= 2, '应有第二层');
  const second = plan.layers[1];
  const secondSig = second.map(item => [item.xMm, item.zMm, item.orientation].join(':')).sort().join('|');
  const templates = enumerateSingleEdgeLayouts({
    ...input,
    faceConstraint: { enabled: true, palletEdge: 'z-', unitFace: 'long-side', layout: 'edge-exposure' },
  }).map(tpl => tpl.placements.map(item => [item.xMm, item.zMm, item.orientation].join(':')).sort().join('|'));
  assert.ok(templates.includes(secondSig), '第二层排样应命中长侧面单边模板集合');
});

test('规则三：第三层起每层其余排至少一排沿托盘长向剩余≥50mm', () => {
  clearPalletLayoutCache();
  const input = {
    ...layerRulesBaseInput,
    layerRules: { enabled: true, sideLayMaxOverhangMm: 10, secondLayerMode: 'free', minRowMarginMm: 50 },
  };
  const baseline = optimizePalletLayout(layerRulesBaseInput);
  const plan = optimizePalletLayout(input);
  assert.equal(plan.ok, true);
  assert.ok(plan.totalCount <= baseline.totalCount, '规则收紧后件数不应增加');
  const usableLength = plan.options.usablePallet?.lengthMm ?? plan.options.pallet.lengthMm;
  for (let index = 2; index < plan.layers.length; index++) {
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
