// G4 式四块混排单层变体回归测试。
//
// 背景：整排条带枚举（sequenceCandidates）只能产出"每排同朝向"的结构，
// 而 Scheithauer–Terno G4 结构证明 A/B 棋盘式四块划分常能突破条带密度上限。
// 这里用 260×170 箱型做锚点：纯条带上限为 20 件/层（4列×5行），
// G4 棋盘可达 25 件/层，是"混排确实更密"的可复现实例。
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  enumerateG4Layouts,
  optimizePalletLayout,
  palletRowMarginReport,
} from '../src/pallet-core.js';

const g4CaseInput = {
  unitSizeMm: { lengthMm: 260, widthMm: 170, heightMm: 150 },
  loadHeightMm: 1500,
  layerStrategy: 'optimize',
  packageType: 'case',
};

test('G4 候选在双朝向下生成且全部合法', () => {
  const layouts = enumerateG4Layouts(g4CaseInput);
  assert.ok(layouts.length > 0, '应至少产出一个 G4 候选');
  for (const layout of layouts) {
    assert.equal(layout.layout, 'g4');
    // 边界与重叠校验：复用优化器的结果路径间接验证——每个候选件数
    // 应与实际 placements 数一致，且坐标在托盘范围内。
    const halfL = 600;
    const halfW = 500;
    for (const item of layout.placements) {
      assert.ok(Math.abs(item.xMm) + item.lengthMm / 2 <= halfL + 0.01, 'x 方向不得越界');
      assert.ok(Math.abs(item.zMm) + item.widthMm / 2 <= halfW + 0.01, 'z 方向不得越界');
    }
    for (let i = 0; i < layout.placements.length; i++) {
      for (let j = i + 1; j < layout.placements.length; j++) {
        const a = layout.placements[i];
        const b = layout.placements[j];
        const overlap = Math.abs(a.xMm - b.xMm) * 2 < a.lengthMm + b.lengthMm - 0.01
          && Math.abs(a.zMm - b.zMm) * 2 < a.widthMm + b.widthMm - 0.01;
        assert.ok(!overlap, 'G4 候选内部不得重叠');
      }
    }
  }
});

test('G4 候选必须是真正的 A/B 混排', () => {
  const layouts = enumerateG4Layouts(g4CaseInput);
  assert.ok(layouts.some(layout => {
    const oris = new Set(layout.placements.map(item => item.orientation));
    return oris.has('A') && oris.has('B');
  }), '至少存在一个同时含 A 与 B 的四块候选');
});

test('仅允许单一朝向时不产生 G4 候选', () => {
  const layouts = enumerateG4Layouts({ ...g4CaseInput, allowedOrientations: ['A'] });
  assert.equal(layouts.length, 0);
});

test('G4 在 260×170 箱型上把单层密度从 20 提升到 25', () => {
  const plan = optimizePalletLayout(g4CaseInput);
  assert.ok(plan.ok);
  assert.equal(plan.itemsPerLayer[0], 25, '最优层应为 G4 的 25 件而非条带的 20 件');
  assert.equal(plan.itemsPerLayer.every(count => count === 25), true);
  assert.equal(plan.totalCount, 250);
});

test('same 策略过滤混排，条带结果不受 G4 影响', () => {
  const plan = optimizePalletLayout({ ...g4CaseInput, layerStrategy: 'same' });
  assert.ok(plan.ok);
  assert.equal(plan.itemsPerLayer[0], 20, '全同向策略下仍为条带 20 件/层');
});

test('软包行余量规则同样约束 G4 候选', () => {
  const softpackInput = { ...g4CaseInput, packageType: 'softpack' };
  const layouts = enumerateG4Layouts(softpackInput);
  for (const layout of layouts) {
    const report = palletRowMarginReport(layout.placements);
    assert.equal(
      report.satisfiedFor(50, 1200),
      true,
      '启用人仓余量后每个 G4 候选都应满足行余量 ≥50mm',
    );
  }
});
