import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PALLET_SIZE_MM,
  enumerateSingleEdgeLayouts,
  normalizePalletOptions,
  optimizePalletLayout,
  orientedSize,
  palletExposedFacesFor,
  formatPalletPlan,
  clearPalletLayoutCache,
  getPalletLayoutCacheStats,
} from '../src/pallet-core.js';

function assertLayerGeometry(result) {
  const pallet = result.options.usablePallet;
  for (const layer of result.layers) {
    for (let i = 0; i < layer.length; i++) {
      const a = layer[i];
      assert.ok(Math.abs(a.xMm) + a.lengthMm / 2 <= pallet.lengthMm / 2 + result.options.overhangMm + 1e-6);
      assert.ok(Math.abs(a.zMm) + a.widthMm / 2 <= pallet.widthMm / 2 + result.options.overhangMm + 1e-6);
      for (let j = i + 1; j < layer.length; j++) {
        const b = layer[j];
        assert.ok(!(Math.abs(a.xMm - b.xMm) * 2 < a.lengthMm + b.lengthMm
          && Math.abs(a.zMm - b.zMm) * 2 < a.widthMm + b.widthMm), '同层 placement 不得重叠');
      }
    }
  }
}

test('单件姿态同时输出尺寸置换与唯一 L/W/H 世界面映射', () => {
  const unit = { lengthMm: 400, widthMm: 165, heightMm: 300 };
  assert.deepEqual(orientedSize(unit, 'A', 'normal'), {
    lengthMm: 400, widthMm: 165, heightMm: 300,
    orientation: 'A', posture: 'normal', faceDown: null,
    faceByWorldAxis: { x: 'W', y: 'H', z: 'L' },
  });
  assert.deepEqual(orientedSize(unit, 'B', 'normal'), {
    lengthMm: 165, widthMm: 400, heightMm: 300,
    orientation: 'B', posture: 'normal', faceDown: null,
    faceByWorldAxis: { x: 'L', y: 'H', z: 'W' },
  });
  assert.deepEqual(orientedSize(unit, 'A', 'side-lay'), {
    lengthMm: 400, widthMm: 300, heightMm: 165,
    orientation: 'A', posture: 'side-lay', faceDown: 'H',
    faceByWorldAxis: { x: 'W', y: 'L', z: 'H' },
  });
  assert.deepEqual(orientedSize(unit, 'B', 'side-lay'), {
    lengthMm: 300, widthMm: 400, heightMm: 165,
    orientation: 'B', posture: 'side-lay', faceDown: 'H',
    faceByWorldAxis: { x: 'H', y: 'L', z: 'W' },
  });
});

test('外露面按逐件邻接判断，非矩形台阶面不会被整层外框误判为遮挡', () => {
  const unit = { xMm:0, yMm:50, zMm:0, lengthMm:100, widthMm:100, heightMm:100 };
  const diagonal = { xMm:100, yMm:50, zMm:100, lengthMm:100, widthMm:100, heightMm:100 };
  const adjacent = { xMm:100, yMm:50, zMm:0, lengthMm:100, widthMm:100, heightMm:100 };

  // 对角件扩大了整层外接矩形，但没有覆盖当前件右侧面中心；该台阶面应显示标识。
  assert.equal(palletExposedFacesFor([unit, diagonal], unit).right, true);
  // 真正贴合且覆盖中心的邻件才遮挡该面。
  assert.equal(palletExposedFacesFor([unit, adjacent], unit).right, false);
  assert.equal(palletExposedFacesFor([unit, adjacent], adjacent).left, false);
  assert.equal(palletExposedFacesFor([unit, adjacent], unit).front, true);
});

test('上层邻件覆盖面中心时隐藏顶面标识，未覆盖的顶面仍保持外露', () => {
  const lower = { xMm:0, yMm:50, zMm:0, lengthMm:100, widthMm:100, heightMm:100 };
  const upper = { xMm:0, yMm:150, zMm:0, lengthMm:100, widthMm:100, heightMm:100 };
  const offsetUpper = { xMm:100, yMm:150, zMm:100, lengthMm:100, widthMm:100, heightMm:100 };
  assert.equal(palletExposedFacesFor([lower, upper], lower).top, false);
  assert.equal(palletExposedFacesFor([lower, offsetUpper], lower).top, true);
});

test('v2 固定托盘为1200×1000×160，loadHeight与旧总高互相迁移', () => {
  const byLoad = normalizePalletOptions({ unitSizeMm: { lengthMm: 600, widthMm: 400, heightMm: 300 }, loadHeightMm: 1040 });
  assert.deepEqual(byLoad.pallet, { lengthMm: 1200, widthMm: 1000, heightMm: PALLET_SIZE_MM.height });
  assert.equal(byLoad.loadHeightMm, 1040);
  assert.equal(byLoad.heightLimitMm, 1200);

  const byLegacy = normalizePalletOptions({ heightLimitMm: 1800 });
  assert.equal(byLegacy.loadHeightMm, 1640);
  assert.equal(byLegacy.heightLimitMm, 1800);
  assert.equal(normalizePalletOptions({ heightLimitMm: 9999 }).loadHeightMm, 2340);
  assert.equal(normalizePalletOptions({ heightLimitMm: 1200 }).loadHeightMm, 1040);
});

test('优化器输出 placement list，平面边界内不重叠且同向中线对称', () => {
  const result = optimizePalletLayout({
    unitSizeMm: { lengthMm: 600, widthMm: 400, heightMm: 300 },
    heightLimitMm: 1500,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.itemsPerLayer, [5, 5, 5, 5]);
  assert.equal(result.totalCount, 20);
  assert.equal(result.totalCount, result.placements.length);
  assertLayerGeometry(result);
  const expectedHeightUtilization = (result.actualLoadHeightMm + PALLET_SIZE_MM.height)
    / (result.options.loadHeightMm + PALLET_SIZE_MM.height);
  assert.equal(result.heightUtilization, expectedHeightUtilization);
  assert.equal(result.fullPalletRate, result.surfaceUtilization * expectedHeightUtilization);
  assert.equal(result.footprintUtilization, result.surfaceUtilization);
  assert.equal(result.actualLoadHeightMm, result.totalHeightMm - result.options.pallet.heightMm);
  assert.equal(result.palletYieldRate, result.fullPalletRate);
  const minX = Math.min(...result.placements.map(item => item.xMm - item.lengthMm / 2));
  const maxX = Math.max(...result.placements.map(item => item.xMm + item.lengthMm / 2));
  const minZ = Math.min(...result.placements.map(item => item.zMm - item.widthMm / 2));
  const maxZ = Math.max(...result.placements.map(item => item.zMm + item.widthMm / 2));
  assert.equal(result.occupiedLengthMm, maxX - minX);
  assert.equal(result.occupiedWidthMm, maxZ - minZ);
  assert.equal(result.remainingLengthMm, PALLET_SIZE_MM.length - result.occupiedLengthMm);
  assert.equal(result.remainingWidthMm, PALLET_SIZE_MM.width - result.occupiedWidthMm);
  assert.equal(result.remainingHeightMm, result.options.loadHeightMm - result.actualLoadHeightMm);
  assert.ok(result.volumeUtilization >= 0 && result.volumeUtilization <= 1);
  assert.match(formatPalletPlan(result), /平面率/);
  assert.match(formatPalletPlan(result), /满板率/);
  assert.match(formatPalletPlan(result), /台板剩余量/);

  const same = optimizePalletLayout({
    unitSizeMm: { lengthMm: 300, widthMm: 300, heightMm: 300 },
    heightLimitMm: 1500,
    layerStrategy: 'same',
    basePattern: ['A'],
    allowedOrientations: ['A'],
  });
  assert.equal(same.ok, true);
  for (const layer of same.layers) {
    const cx = layer.reduce((sum, item) => sum + item.xMm, 0) / layer.length;
    const cz = layer.reduce((sum, item) => sum + item.zMm, 0) / layer.length;
    assert.ok(Math.abs(cx) < 1e-6, `X 方向应对称，实际为 ${cx}`);
    assert.ok(Math.abs(cz) < 1e-6, `Z 方向应对称，实际为 ${cz}`);
  }
  assert.ok(same.centerOffsetMm < 1e-6);
});

test('软包选项规范化到0–200，护角按长宽分别扣除两倍损耗', () => {
  const options = normalizePalletOptions({
    packageType: 'softpack',
    softpackOptions: {
      cornerProtectorsEnabled: true,
      cornerLossLengthMm: 999,
      cornerLossWidthMm: -20,
      allowTopSideLay: true,
    },
  });
  assert.deepEqual(options.softpackOptions, {
    cornerProtectorsEnabled: true,
    cornerLossLengthMm: 200,
    cornerLossWidthMm: 0,
    topSideLayMode: 'auto',
    allowTopSideLay: true,
  });
  assert.deepEqual(options.usablePallet, { lengthMm: 800, widthMm: 1000, heightMm: 160 });
});

test('顶层侧倒只对softpack开放，并按件数优先、同件数再比较总高', () => {
  const base = {
    unitSizeMm: { lengthMm: 600, widthMm: 400, heightMm: 500 },
    loadHeightMm: 1040,
    layerStrategy: 'same',
    allowedOrientations: ['A'],
    basePattern: ['A'],
    // 该案例下层深度不足以容纳侧倒层（会超出来层轮廓），显式关闭分层出边规则，
    // 仅验证侧倒的包装类型门控与择优口径本身。
    layerRules: { enabled: false },
  };
  const normal = optimizePalletLayout({ ...base, packageType: 'softpack', softpackOptions: { allowTopSideLay: false } });
  const side = optimizePalletLayout({ ...base, packageType: 'softpack', softpackOptions: { allowTopSideLay: true } });
  assert.equal(normal.ok, true);
  assert.equal(side.ok, true);
  assert.ok(side.totalCount > normal.totalCount || (side.totalCount === normal.totalCount && side.totalHeightMm < normal.totalHeightMm));
  assert.ok(side.placements.some(item => item.posture === 'side-lay'));
  const sideLayer = side.layers.at(-1);
  assert.ok(sideLayer.every(item => item.posture === 'side-lay'));
  assert.ok(sideLayer.every(item => item.faceDown === 'H'));
  for (const item of sideLayer) {
    assert.equal(item.lengthMm, base.unitSizeMm.lengthMm);
    assert.equal(item.widthMm, base.unitSizeMm.heightMm);
    assert.equal(item.heightMm, base.unitSizeMm.widthMm);
  }
  assertLayerGeometry(side);

  const blocked = optimizePalletLayout({ ...base, packageType: 'case', softpackOptions: { allowTopSideLay: true } });
  assert.equal(blocked.ok, true);
  assert.ok(blocked.placements.every(item => item.posture === 'normal'));
});

test('强制模式可在自动模式不采用时生成H面向下业务示例', () => {
  const base = {
    unitSizeMm: { lengthMm: 400, widthMm: 165, heightMm: 300 },
    loadHeightMm: 1640,
    packageType: 'softpack',
    layerStrategy: 'cyclic-interlock',
    allowedOrientations: ['A', 'B'],
    basePattern: ['A', 'A', 'B'],
  };
  const automatic = optimizePalletLayout({ ...base, softpackOptions: { topSideLayMode: 'auto' } });
  const forced = optimizePalletLayout({ ...base, softpackOptions: { topSideLayMode: 'force' } });
  assert.equal(automatic.ok, true);
  assert.equal(automatic.topSideLayApplied, false);
  assert.ok(automatic.placements.every(item => item.posture === 'normal'));
  assert.equal(forced.ok, true);
  assert.equal(forced.topSideLayApplied, true);
  assert.equal(forced.topSideLayForced, true);
  assert.ok(forced.layers.at(-1).every(item => item.posture === 'side-lay' && item.faceDown === 'H'));
  assert.ok(forced.totalCount < automatic.totalCount, '强制示例允许牺牲件数，以便检查H面向下姿态');
  assert.ok(forced.actualLoadHeightMm <= base.loadHeightMm);
  assertLayerGeometry(forced);
});

test('顶层侧倒的A/B只改变平面方向，竖直高度均取薄边且低于正常层', () => {
  const unitSizeMm = { lengthMm: 400, widthMm: 100, heightMm: 300 };
  const result = optimizePalletLayout({
    unitSizeMm,
    loadHeightMm: 1040,
    packageType: 'softpack',
    softpackOptions: { allowTopSideLay: true },
    layerStrategy: 'cyclic-interlock',
    allowedOrientations: ['A', 'B'],
    basePattern: ['A', 'A', 'B'],
  });
  assert.equal(result.ok, true);
  const sideLayer = result.layers.find(layer => layer.some(item => item.posture === 'side-lay'));
  assert.ok(sideLayer, '该尺寸应选出一层更矮的顶层侧倒方案');
  assert.ok(sideLayer.every(item => item.posture === 'side-lay'));
  assert.ok(sideLayer.every(item => item.heightMm === unitSizeMm.widthMm));
  assert.ok(sideLayer.every(item => item.heightMm < unitSizeMm.heightMm));
  for (const item of sideLayer.filter(item => item.orientation === 'B')) {
    assert.equal(item.lengthMm, unitSizeMm.heightMm);
    assert.equal(item.widthMm, unitSizeMm.lengthMm);
  }
  assert.ok(result.totalHeightMm <= result.options.heightLimitMm);
  assertLayerGeometry(result);
});

test('剩余高度放不下薄边侧倒层时不得强行生成更高的假侧倒层', () => {
  const result = optimizePalletLayout({
    unitSizeMm: { lengthMm: 400, widthMm: 165, heightMm: 300 },
    loadHeightMm: 2240,
    packageType: 'softpack',
    softpackOptions: { allowTopSideLay: true },
    layerStrategy: 'cyclic-interlock',
    allowedOrientations: ['A', 'B'],
    basePattern: ['A', 'A', 'B'],
  });
  assert.equal(result.ok, true);
  assert.equal(result.totalHeightMm, 2260);
  assert.ok(result.placements.every(item => item.posture === 'normal'));
  assert.ok(result.totalHeightMm <= result.options.heightLimitMm);
});

test('循环错层保持件数优先，支撑率和展示面约束仍可检查', () => {
  const result = optimizePalletLayout({
    unitSizeMm: { lengthMm: 500, widthMm: 300, heightMm: 250 },
    heightLimitMm: 1400,
    layerStrategy: 'cyclic-interlock',
    basePattern: ['A', 'A', 'B'],
    faceConstraint: { enabled: true, palletEdge: 'z-', unitFace: 'long-side' },
  });
  assert.equal(result.ok, true);
  assert.ok(result.pattern.length >= 1);
  assert.ok(result.minSupportRatio >= 0 && result.minSupportRatio <= 1);
  assertLayerGeometry(result);
});

test('指定一条长边展示面动态枚举正向排数：400×165 时优选17件，不走中分路线', () => {
  const result = optimizePalletLayout({
    unitSizeMm: { lengthMm: 400, widthMm: 165, heightMm: 300 },
    loadHeightMm: 1040,
    layerStrategy: 'same',
    faceConstraint: { enabled: true, palletEdge: 'z-', unitFace: 'long-side', layout: 'edge-exposure' },
  });
  assert.equal(result.ok, true);
  assert.equal(result.itemsPerLayer[0], 17);
  assert.equal(result.layout, 'edge-exposure');
  assert.match(result.layoutLabel, /1排正向/);
  const layer = result.layers[0];
  const edgeBand = layer.filter(item => item.orientation === 'A');
  const innerFill = layer.filter(item => item.orientation === 'B');
  assert.equal(edgeBand.length, 3);
  assert.equal(innerFill.length, 14);
  const layerMinZ = Math.min(...layer.map(item => item.zMm - item.widthMm / 2));
  const layerMaxZ = Math.max(...layer.map(item => item.zMm + item.widthMm / 2));
  assert.ok(Math.abs(layerMinZ + layerMaxZ) < 1e-6, '展示层整体应居中于托盘宽度方向，而不是贴边');
  assert.ok(edgeBand.every(item => Math.abs(item.zMm - item.widthMm / 2 - layerMinZ) < 1e-6), '展示排必须位于整块的最外侧（z- 一侧）');
  assert.ok(edgeBand.every(item => item.faceByWorldAxis.z === 'L'), '指定长边实际露出面必须为 L，不能只用姿态 A 代替业务面');
  assert.ok(innerFill.every(item => item.zMm > edgeBand[0].zMm), '旋转填充必须位于展示排内侧，而不是沿中线分割');
  assertLayerGeometry(result);
});

test('指定短侧面时按实际 W 面校验指定边，而不是硬编码姿态名称', () => {
  const result = optimizePalletLayout({
    unitSizeMm: { lengthMm: 400, widthMm: 165, heightMm: 300 },
    loadHeightMm: 1040,
    layerStrategy: 'same',
    faceConstraint: { enabled: true, palletEdge: 'z-', unitFace: 'short-side', layout: 'edge-exposure' },
  });
  assert.equal(result.ok, true);
  const layerMinZ = Math.min(...result.layers[0].map(item => item.zMm - item.widthMm / 2));
  const layerMaxZ = Math.max(...result.layers[0].map(item => item.zMm + item.widthMm / 2));
  assert.ok(Math.abs(layerMinZ + layerMaxZ) < 1e-6, '展示层整体应居中于托盘宽度方向');
  const edgeItems = result.layers[0].filter(item => Math.abs(item.zMm - item.widthMm / 2 - layerMinZ) < 1e-6);
  assert.ok(edgeItems.length > 0);
  assert.ok(edgeItems.every(item => item.faceByWorldAxis.z === 'W'));
});

test('H 面向下侧倒无法在托盘长边露出 L 时，不伪造单边长侧面候选', () => {
  const candidates = enumerateSingleEdgeLayouts({
    unitSizeMm: { lengthMm: 400, widthMm: 165, heightMm: 300 },
    faceConstraint: { enabled: true, palletEdge: 'z-', unitFace: 'long-side', layout: 'edge-exposure' },
  }, 'side-lay');
  assert.deepEqual(candidates, []);
});

test('单边展示排数由尺寸组合动态得出：同一案例会同时产生1排17件与3排16件', () => {
  const candidates = enumerateSingleEdgeLayouts({
    unitSizeMm: { lengthMm: 400, widthMm: 165, heightMm: 300 },
    loadHeightMm: 1040,
    faceConstraint: { enabled: true, palletEdge: 'z-', unitFace: 'long-side', layout: 'edge-exposure' },
  });
  // 每档行数含满铺与端面对齐两种列数变体（后者缩短展示列使两带跨度一致）。
  assert.deepEqual(candidates.map(item => item.edgeRows), [1, 1, 2, 2, 3, 3]);
  assert.deepEqual(candidates.map(item => item.placements.length), [17, 16, 13, 11, 16, 13]);
  const threeRows = candidates.find(item => item.edgeRows === 3);
  assert.equal(threeRows.edgeCount, 9);
  assert.equal(threeRows.fillCount, 7);
  assert.equal(threeRows.placements.filter(item => item.orientation === 'A').length, 9);
  assert.equal(threeRows.placements.filter(item => item.orientation === 'B').length, 7);
});

test('旧的固定优选/备选字段会迁移为动态单边展示约束', () => {
  for (const legacyLayout of ['edge-band-max', 'edge-band-compact']) {
    const options = normalizePalletOptions({
      faceConstraint: { enabled: true, palletEdge: 'z-', unitFace: 'long-side', layout: legacyLayout },
    });
    assert.equal(options.faceConstraint.layout, 'edge-exposure');
  }
});

test('单件高度超过可用高度时返回明确失败', () => {
  const result = optimizePalletLayout({ unitSizeMm: { lengthMm: 300, widthMm: 300, heightMm: 1400 }, heightLimitMm: 1200 });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unit-too-high');
});

test('优化结果按稳定输入做有限LRU缓存，且返回值与缓存隔离', () => {
  clearPalletLayoutCache();
  const input = {
    unitSizeMm: { lengthMm: 400, widthMm: 165, heightMm: 300 },
    loadHeightMm: 1040,
    layerStrategy: 'same',
    faceConstraint: { enabled: true, palletEdge: 'z-', unitFace: 'long-side', layout: 'edge-exposure' },
  };
  const first = optimizePalletLayout({ ...input, debug: true, irrelevantUiState: 'a' });
  assert.equal(first.debug.cacheHit, false);
  assert.ok(first.debug.elapsedMs >= 0);
  assert.ok(first.debug.candidateCount > 0);
  first.placements[0].xMm = 999999;
  first.options.unitSizeMm.lengthMm = 999999;

  const second = optimizePalletLayout({ irrelevantUiState: 'b', ...input });
  assert.equal(second.debug.cacheHit, true);
  assert.equal(second.itemsPerLayer[0], 17);
  assert.notEqual(second.placements[0].xMm, 999999);
  assert.notEqual(second.options.unitSizeMm.lengthMm, 999999);
  const stats = getPalletLayoutCacheStats();
  assert.ok(stats.size <= stats.maxEntries);
  assert.ok(stats.maxEntries > 0);
});

test('单边展示选长侧面时，顶层极限侧倒仍然生效（侧倒层豁免展示面约束）', () => {
  clearPalletLayoutCache();
  // 400×180×280 软包，可摆高 1040：
  // 正常层（长侧面朝托盘长边的单边模板）每层 15 件、层高 280 → 3 层 45 件，余 200 mm。
  // 侧倒层高 = 宽 180 ≤ 余量；豁免展示约束后可整层侧倒追加 10 件 → 总数 55。
  const input = {
    packageType: 'softpack',
    unitSizeMm: { lengthMm: 400, widthMm: 180, heightMm: 280 },
    loadHeightMm: 1040,
    allowedOrientations: ['A', 'B'],
    layerStrategy: 'cyclic-interlock',
    softpackOptions: { cornerProtectorsEnabled: false, topSideLayMode: 'auto' },
    faceConstraint: { enabled: true, palletEdge: 'z-', unitFace: 'long-side', layout: 'edge-exposure' },
  };
  const plan = optimizePalletLayout(input);
  assert.equal(plan.ok, true);
  assert.equal(plan.topSideLayApplied, true);
  assert.equal(plan.totalCount, 55);
  assert.ok(plan.layers.at(-1).every(item => item.posture === 'side-lay'), '顶层应为整层侧倒');
  // 正常姿态层仍必须满足展示约束：贴着指定长边（z-）的展示排为 L 面朝外；
  // 模板内部的旋转填充件不在此约束范围内。
  for (const layer of plan.layers.slice(0, -1)) {
    const minZ = Math.min(...layer.map(item => item.zMm - item.widthMm / 2));
    for (const item of layer) {
      if (Math.abs((item.zMm - item.widthMm / 2) - minZ) < 0.01) {
        assert.equal(item.faceByWorldAxis?.z, 'L');
      }
    }
  }
  assertLayerGeometry(plan);
  assert.ok(plan.stability.boundaryValid && plan.stability.overlapFree);
});

test('关闭顶层侧倒时，同一长侧面单边展示方案回到纯正常姿态结果', () => {
  const input = {
    packageType: 'softpack',
    unitSizeMm: { lengthMm: 400, widthMm: 180, heightMm: 280 },
    loadHeightMm: 1040,
    allowedOrientations: ['A', 'B'],
    layerStrategy: 'cyclic-interlock',
    softpackOptions: { cornerProtectorsEnabled: false, topSideLayMode: 'off' },
    faceConstraint: { enabled: true, palletEdge: 'z-', unitFace: 'long-side', layout: 'edge-exposure' },
  };
  const plan = optimizePalletLayout(input);
  assert.equal(plan.ok, true);
  assert.equal(plan.topSideLayApplied, false);
  assert.equal(plan.totalCount, 45);
});

test('单边模板降档层对称剥离：次优层 X 向质心回到中线', () => {
  const plan = optimizePalletLayout({
    unitSizeMm: { lengthMm: 400, widthMm: 165, heightMm: 300 },
    loadHeightMm: 1300,
    packageType: 'softpack',
    layerStrategy: 'cyclic-interlock',
    softpackOptions: { topSideLayMode: 'auto' },
    faceConstraint: { enabled: true, palletEdge: 'z-', unitFace: 'long-side', layout: 'edge-exposure' },
    overhangMm: 10,
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.hasRunnerUp, true);
  const placements = plan.runnerUp.placements;
  const meanX = placements.reduce((sum, item) => sum + item.xMm, 0) / placements.length;
  assert.ok(
    Math.abs(meanX) < 0.5,
    '降档层 X 质心应接近中线（对称剥离失效），实测 ' + meanX.toFixed(1) + 'mm',
  );
});
