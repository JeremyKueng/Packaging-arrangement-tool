import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  clampPresetNumber,
  outerLevelName,
  outerDefaults,
  normalizePreset,
  normalizeOuterPreset,
  normalizeOuterSource,
  mergeBuiltinOverridesPreservingExisting,
} from '../src/preset-core.js';

test('clampPresetNumber：四舍五入并夹取', () => {
  assert.equal(clampPresetNumber(0, 1, 12), 1);
  assert.equal(clampPresetNumber(20, 1, 12), 12);
  assert.equal(clampPresetNumber(7.6, 1, 12), 8);
  assert.equal(clampPresetNumber('abc', 1, 12), 1);
});

test('normalizePreset：默认值、越界夹取、朝向回退', () => {
  const p = normalizePreset('softdraw', { rows: 99, cols: 0, layers: -3, orientation: 'bogus' }, {});
  assert.equal(p.orientation, 'flat'); // 非法朝向回退到首个
  assert.equal(p.rows, 25);
  assert.equal(p.cols, 1);
  assert.equal(p.layers, 1);
  assert.equal(p.name, '未命名预设');
  assert.equal(p.handleSide, null);
});

test('normalizePreset：卫卷无芯时膜包模式强制 single', () => {
  const p = normalizePreset('roll', { rollCore: 'coreless', rollBundleMode: '4' }, {});
  assert.equal(p.rollCore, 'coreless');
  assert.equal(p.rollBundleMode, 'single');
});

test('normalizePreset：提手端只在合法枚举内保留', () => {
  assert.equal(normalizePreset('softdraw', { handleSide: 'z+' }, {}).handleSide, 'z+');
  assert.equal(normalizePreset('softdraw', { handleSide: 'bogus' }, {}).handleSide, null);
});

test('normalizePreset：悬挂式底抽子品类可保存，非法值回退普通软抽', () => {
  assert.equal(normalizePreset('softdraw',{softdrawVariant:'hanging-bottom'},{}).softdrawVariant,'hanging-bottom');
  assert.equal(normalizePreset('softdraw',{softdrawVariant:'bad'},{}).softdrawVariant,'standard');
});

test('normalizePreset：悬挂式底抽侧立整包方向可保存为十字方向', () => {
  assert.equal(normalizePreset('softdraw',{softdrawVariant:'hanging-bottom',hangingSideDirection:'cross'},{}).hangingSideDirection,'cross');
  assert.equal(normalizePreset('softdraw',{hangingSideDirection:'bad'},{}).hangingSideDirection,'parallel');
  // 两个旧版误命名字段仍可迁移，但标准化输出只保留新字段。
  assert.equal(normalizePreset('softdraw',{hangingFlatDirection:'cross'},{}).hangingSideDirection,'cross');
  assert.equal(normalizePreset('softdraw',{hangingHandleDirection:'cross'},{}).hangingSideDirection,'cross');
});

test('normalizePreset：无芯卫卷尺寸快照保留压扁率', () => {
  const preset = normalizePreset('roll',{rollCore:'coreless',dimensionsMm:{enabled:true,diameterMm:100,axialWidthMm:115,coreDiameterMm:40,flattenRatePct:30}},{});
  assert.equal(preset.dimensionsMm.flattenRatePct,30);
  assert.equal(preset.rollBundleMode,'single');
});

test('outerLevelName / outerDefaults 大包与装箱', () => {
  assert.equal(outerLevelName('bigpack'), '大包');
  assert.equal(outerLevelName('case'), '装箱');
  const big = outerDefaults('bigpack');
  assert.equal(big.name, '大包临时方案');
  assert.equal(big.loadFace, 'z-');
  assert.equal(big.margin, 0.05);
  const cas = outerDefaults('case');
  assert.equal(cas.loadFace, 'y+');
});

test('normalizeOuterPreset：默认值完整', () => {
  const d = outerDefaults('bigpack');
  const p = normalizeOuterPreset('bigpack', {}, d);
  assert.equal(p.name, '大包临时方案');
  assert.equal(p.unit, 'midpack');
  assert.equal(p.rows, 2);
  assert.equal(p.cols, 1);
  assert.equal(p.layers, 1);
  assert.equal(p.spacing, 0);
  assert.equal(p.margin, 0.05);
  assert.equal(p.loadFace, 'z-');
  assert.equal(p.unitPosture, 'flat');
  assert.equal(p.unitFacing, 'z-');
  assert.equal(p.productOrientation, 'upright');
  assert.equal(p.dividerMode, 'none');
  assert.equal(p.formalNameOverride, '');
});

test('normalizeOuterPreset：十字挡板仅装箱保留，旧方案与非法值回退为无', () => {
  assert.equal(normalizeOuterPreset('case', { dividerMode: 'cross' }, outerDefaults('case')).dividerMode, 'cross');
  assert.equal(normalizeOuterPreset('case', { dividerMode: 'bad' }, outerDefaults('case')).dividerMode, 'none');
  assert.equal(normalizeOuterPreset('case', {}, outerDefaults('case')).dividerMode, 'none');
  assert.equal(normalizeOuterPreset('bigpack', { dividerMode: 'cross' }, outerDefaults('bigpack')).dividerMode, 'none');
});

test('normalizeOuterPreset：旧 unitPose 迁移为 unitFacing', () => {
  const d = outerDefaults('bigpack');
  assert.equal(normalizeOuterPreset('bigpack', { unitPose: 'flat-z+' }, d).unitFacing, 'z+');
  assert.equal(normalizeOuterPreset('bigpack', { unitPose: 'flat-x-' }, d).unitFacing, 'x-');
});

test('normalizeOuterPreset：小数夹取并保留两位', () => {
  const d = outerDefaults('bigpack');
  const p = normalizeOuterPreset('bigpack', { spacing: 99, margin: -5 }, d);
  assert.equal(p.spacing, 2);
  assert.equal(p.margin, 0);
});

test('normalizeOuterPreset：装箱正式名称修订保留，旧方案默认留空', () => {
  const d = outerDefaults('case');
  assert.equal(normalizeOuterPreset('case', { formalNameOverride: ' 客户装箱名称 ' }, d).formalNameOverride, '客户装箱名称');
  assert.equal(normalizeOuterPreset('case', {}, d).formalNameOverride, '');
});

test('normalizeOuterSource：合法中包来源保留快照', () => {
  const source = normalizeOuterSource({
    type: 'midpack',
    productType: 'softdraw',
    presetId: 'builtin:5',
    presetName: '18包-平2×3×3',
    snapshot: { rows: 2, cols: 3, layers: 3, orientation: 'side', handleSide: 'z-', hangingSideDirection: 'cross', rollCore: 'cored', rollBundleMode: 'single', rollBundleX: 1, rollBundleZ: 1, rollBundleY: 1 },
  });
  assert.equal(source.type, 'midpack');
  assert.equal(source.productType, 'softdraw');
  assert.equal(source.presetId, 'builtin:5');
  assert.equal(source.snapshot.rows, 2);
  assert.equal(source.snapshot.hangingSideDirection, 'cross');
});

test('normalizeOuterSource：合法直装来源', () => {
  const source = normalizeOuterSource({
    type: 'product',
    productType: 'roll',
    snapshot: { orientation: 'upright', rollCore: 'cored', rollBundleMode: 'single', rollBundleX: 1, rollBundleZ: 1, rollBundleY: 1 },
  });
  assert.equal(source.type, 'product');
  assert.equal(source.presetId, null);
  assert.equal(source.snapshot.handleSide, 'z-');
});

test('normalizeOuterSource：直装提手端可稳定往返，非法值回退默认端', () => {
  const source = normalizeOuterSource({
    type: 'product',
    productType: 'softdraw',
    snapshot: { orientation: 'side', handleSide: 'x+', softdrawVariant: 'standard' },
  });
  assert.equal(source.snapshot.handleSide, 'x+');
  const fallback = normalizeOuterSource({
    type: 'product',
    productType: 'softdraw',
    snapshot: { orientation: 'side', handleSide: 'bad' },
  });
  assert.equal(fallback.snapshot.handleSide, 'z-');
});

test('合并内置修改保持本地优先并报告冲突', () => {
  const local = { 'builtin:0': { name: '本地修改' } };
  const stats = mergeBuiltinOverridesPreservingExisting(local, {
    'builtin:0': { name: '导入修改' },
    'builtin:1': { name: '新增修改' },
    bad: { name: '非法键' },
  });
  assert.equal(local['builtin:0'].name, '本地修改');
  assert.equal(local['builtin:1'].name, '新增修改');
  assert.deepEqual(stats, { added: 1, skippedConflicts: 1, skippedInvalid: 1 });
});

test('normalizeOuterSource：非法来源返回 null（旧方案/未绑定）', () => {
  assert.equal(normalizeOuterSource(null), null);
  assert.equal(normalizeOuterSource(undefined), null);
  assert.equal(normalizeOuterSource({}), null); // 缺 productType/snapshot
  assert.equal(normalizeOuterSource({ type: 'midpack', productType: 'unknown', snapshot: {} }), null);
  assert.equal(normalizeOuterSource({ type: 'midpack', productType: 'softdraw' }), null); // 缺 snapshot
});

test('normalizeOuterPreset：未绑定来源时 source 为 null', () => {
  const d = outerDefaults('bigpack');
  assert.equal(normalizeOuterPreset('bigpack', {}, d).source, null);
});
