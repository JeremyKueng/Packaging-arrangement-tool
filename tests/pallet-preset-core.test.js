import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePalletPreset,
  palletDefaults,
  capturePalletSource,
  isValidPalletSource,
} from '../src/pallet-preset-core.js';

test('叠板预设保存独立单件尺寸、固定托盘口径与packageType', () => {
  const preset = normalizePalletPreset({
    name: '纸箱托盘',
    packageType: 'case',
    // 旧 source 中的 presetId/presetName/snapshot 不应进入 v2 保存模型。
    source: { type: 'case', productType: 'softdraw', presetId: 'custom:1', presetName: '箱规A', snapshot: { rows: 2 } },
    unitSizeMm: { lengthMm: 700, widthMm: 500, heightMm: 300 },
    heightLimitMm: 1800,
  });
  assert.equal(preset.name, '纸箱托盘');
  assert.deepEqual(preset.unitSizeMm, { lengthMm: 700, widthMm: 500, heightMm: 300 });
  assert.deepEqual(preset.pallet, { length: 1200, width: 1000, height: 160 });
  assert.equal(preset.packageType, 'case');
  assert.equal('source' in preset, false);
  assert.equal(preset.loadHeightMm, 1640);
  assert.equal(preset.heightLimitMm, 1800);
  assert.equal(preset.schemaVersion, 7);
  assert.equal(preset.algorithmVersion, 'pallet-layout-v2');
  assert.match(preset.solutionId, /^solution:/);
  assert.equal(preset.algorithmInput.unitSizeMm.lengthMm, 700);
  assert.deepEqual(preset.placementList, []);
});

test('normalize兼容旧source.type：case保持case，bigpack迁移为softpack', () => {
  const casePreset = normalizePalletPreset({ source: { type: 'case' } });
  const softPreset = normalizePalletPreset({ source: { type: 'bigpack' }, softpackOptions: { allowTopSideLay: true } });
  assert.equal(casePreset.packageType, 'case');
  assert.equal(softPreset.packageType, 'softpack');
  assert.equal(softPreset.softpackOptions.allowTopSideLay, true);
  assert.deepEqual(palletDefaults('bigpack').packageType, 'softpack');
  assert.equal(isValidPalletSource({ type: 'midpack' }), false);
  assert.equal(isValidPalletSource({ type: 'bigpack' }), true);
  assert.deepEqual(capturePalletSource({ type: 'bigpack', presetId: 'custom:1' }), { packageType: 'softpack' });
});

test('软包护角和侧倒选项在预设中规范化，旧placement仅导入为轻量摘要', () => {
  const preset = normalizePalletPreset({
    packageType: 'softpack',
    loadHeightMm: 2341,
    softpackOptions: {
      cornerProtectorsEnabled: true,
      cornerLossLengthMm: 201,
      cornerLossWidthMm: -1,
      allowTopSideLay: true,
    },
    placementList: [
      { layer: 0, orientation: 'A', posture: 'side-lay', xMm: 1, yMm: 2, zMm: 3, lengthMm: 4, widthMm: 5, heightMm: 6 },
      { layer: 1, orientation: 'B', lying: true },
    ],
    solution: { totalCount: 2, itemsPerLayer: [1, 1], actualLoadHeightMm: 1840, totalHeightMm: 2000, surfaceUtilization: .7, fullPalletRate: .8, volumeUtilization: .2 },
  });
  assert.equal(preset.loadHeightMm, 2340);
  assert.equal(preset.heightLimitMm, 2500);
  assert.deepEqual(preset.softpackOptions, {
    cornerProtectorsEnabled: true,
    cornerLossLengthMm: 200,
    cornerLossWidthMm: 0,
    topSideLayMode: 'auto',
    allowTopSideLay: true,
  });
  assert.deepEqual(preset.placementList, []);
  assert.equal(preset.solution.surfaceUtilization, .7);
  assert.equal(preset.solution.heightUtilization, .8);
  assert.ok(Math.abs(preset.solution.fullPalletRate - .56) < 1e-12);
  assert.deepEqual(preset.solution.itemsPerLayer, [1, 1]);
  assert.equal(preset.solution.actualLoadHeightMm, 1840);
  assert.ok(Math.abs(preset.solution.palletYieldRate - .56) < 1e-12);
});

test('顶层侧倒模式兼容旧布尔值并可保存强制示例模式', () => {
  const migrated = normalizePalletPreset({ packageType: 'softpack', softpackOptions: { allowTopSideLay: true } });
  const forced = normalizePalletPreset({ packageType: 'softpack', softpackOptions: { topSideLayMode: 'force' } });
  assert.equal(migrated.softpackOptions.topSideLayMode, 'auto');
  assert.equal(migrated.softpackOptions.allowTopSideLay, true);
  assert.equal(forced.softpackOptions.topSideLayMode, 'force');
  assert.equal(forced.softpackOptions.allowTopSideLay, true);
});

test('placement list不会被不可信数据写回，旧列表数量仍可用于摘要', () => {
  const preset = normalizePalletPreset({ placementList: Array.from({ length: 12000 }, (_, i) => ({ layer: i, orientation: 'B' })) });
  assert.deepEqual(preset.placementList, []);
  assert.equal(preset.solution.totalCount, 12000);
});

test('新格式仅按 algorithmInput 确定性重建输入与 solutionId', () => {
  const a = normalizePalletPreset({
    id: 'custom:a',
    algorithmInput: {
      packageType: 'softpack',
      unitSizeMm: { lengthMm: 400, widthMm: 165, heightMm: 300 },
      loadHeightMm: 1040,
      layerStrategy: 'same',
      basePattern: ['A'],
      allowedOrientations: ['A'],
      faceConstraint: { enabled: true, palletEdge: 'z-', unitFace: 'long-side', layout: 'edge-exposure' },
      softpackOptions: { topSideLayMode: 'force' },
    },
    solution: { totalCount: 17, layerCount: 1, itemsPerLayer: [17], actualLoadHeightMm: 300, totalHeightMm: 460, surfaceUtilization: 1 },
  });
  const b = normalizePalletPreset({
    algorithmInput: {
      faceConstraint: { unitFace: 'long-side', layout: 'edge-exposure', palletEdge: 'z-', enabled: true },
      basePattern: ['A'], allowedOrientations: ['A'], layerStrategy: 'same', loadHeightMm: 1040,
      unitSizeMm: { heightMm: 300, widthMm: 165, lengthMm: 400 }, packageType: 'softpack',
      softpackOptions: { topSideLayMode: 'force' },
    },
    solution: { totalCount: 17, layerCount: 1, itemsPerLayer: [17], actualLoadHeightMm: 300, totalHeightMm: 460, surfaceUtilization: 1 },
  });
  assert.equal(a.algorithmVersion, 'pallet-layout-v2');
  assert.equal(a.solutionId, b.solutionId);
  assert.deepEqual(a.placementList, []);
  assert.equal(a.algorithmInput.loadHeightMm, 1040);
  assert.equal(a.solution.palletYieldRate, (300 + 160) / (1040 + 160));
});

test('单边展示约束随叠板方案保存，旧固定排样迁移为动态组合', () => {
  const explicit = normalizePalletPreset({
    faceConstraint: { enabled: true, palletEdge: 'z-', unitFace: 'long-side', layout: 'edge-band-compact' },
  });
  assert.equal(explicit.faceConstraint.layout, 'edge-exposure');

  const legacy = normalizePalletPreset({
    faceConstraint: { enabled: true, palletEdge: 'z-', unitFace: 'long-side' },
  });
  assert.equal(legacy.faceConstraint.layout, 'edge-exposure');
});
