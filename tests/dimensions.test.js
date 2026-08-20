import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  COORDINATES,
  catalog,
  HANDLE_SIDES,
  ROLL_CORES,
  ROLL_BUNDLE_MODES,
  PACKAGING_LEVELS,
  LOAD_FACES,
  UNIT_POSTURES,
  UNIT_FACINGS,
  STACK_MODES,
  LEGACY_UNIT_POSES,
  PRODUCT_ORIENTATIONS,
  packagingRules,
  midpackHeightScale,
  SCENE_UNITS_PER_MM,
  DEFAULT_PRODUCT_SIZE_MM,
  defaultProductSizeMm,
  normalizeProductSizeOverride,
  resolveCorelessRollCrossSection,
  resolveProductDimensions,
} from '../src/dimensions.js';
import { productVisualScale } from '../src/geometry-core.js';

test('坐标口径：X=行、Z=列、Y=层，显示顺序 X×Z×Y', () => {
  assert.deepEqual(COORDINATES.axes, { rows: 'x', cols: 'z', layers: 'y' });
  assert.deepEqual(COORDINATES.displayOrder, ['x', 'z', 'y']);
});

test('catalog 包含三个品类且尺寸标记为 relative', () => {
  assert.deepEqual(Object.keys(catalog).sort(), ['handkerchief', 'roll', 'softdraw']);
  for (const type of Object.keys(catalog)) {
    const item = catalog[type];
    assert.ok(item.name, `${type} 缺少 name`);
    assert.ok(item.shape, `${type} 缺少 shape`);
    assert.equal(item.dimensions.unit, 'relative', `${type} 尺寸应为 relative`);
    assert.ok(item.reference, `${type} 缺少 reference`);
    assert.ok(item.source || item.dimensions.source, `${type} 缺少 source 溯源`);
    assert.ok(Array.isArray(item.orientations) && item.orientations.length > 0, `${type} 缺少朝向`);
    assert.ok(Array.isArray(item.presets) && item.presets.length > 0, `${type} 缺少预设`);
    assert.ok(Array.isArray(item.axisLabels) && item.axisLabels.length === 3, `${type} axisLabels 应为 3 项`);
  }
});

test('自定义箱型小粒尺寸始终按本地长/高/宽轴缩放，不随姿态串轴', () => {
  const override = { enabled:true, lengthMm:200, widthMm:100, heightMm:80 };
  const expected = [200/180,80/56,100/108];
  const rounded = values => values.map(value => Number(value.toFixed(12)));
  assert.deepEqual(rounded(productVisualScale('softdraw','flat','z-',{count:1},override)),rounded(expected));
  assert.deepEqual(rounded(productVisualScale('softdraw','upright','z-',{count:1},override)),rounded(expected));
  assert.deepEqual(rounded(productVisualScale('softdraw','side','z-',{count:1},override)),rounded(expected));
});

test('自定义单卷始终按本地卷径/卷高轴缩放', () => {
  const override = { enabled:true, diameterMm:120, axialWidthMm:90 };
  const expected = [1.2,90/115,1.2];
  assert.deepEqual(productVisualScale('roll','upright','z-',{count:1},override),expected);
  assert.deepEqual(productVisualScale('roll','horizontal','z-',{count:1},override),expected);
});

test('包装规则与产品尺寸分离，压缩系数正确', () => {
  assert.deepEqual(packagingRules.midpackHeightScale, { handkerchief: 0.88, softdraw: 0.82, roll: 1 });
  assert.equal(packagingRules.rollBundleGap, 0);
  assert.equal(packagingRules.rollBundleFilmAllowance, 0.03);
  assert.deepEqual(packagingRules.bagPadding, [0.015, 0.035, 0.015]);
  assert.equal(midpackHeightScale('softdraw'), 0.82);
  assert.equal(midpackHeightScale('unknown'), 1);
});

test('领域枚举常量非空且无重复', () => {
  for (const [name, arr] of Object.entries({
    HANDLE_SIDES, ROLL_CORES, ROLL_BUNDLE_MODES, PACKAGING_LEVELS, LOAD_FACES,
    UNIT_POSTURES, UNIT_FACINGS, STACK_MODES, LEGACY_UNIT_POSES,
  })) {
    assert.ok(Array.isArray(arr) && arr.length > 0, `${name} 为空`);
    assert.equal(new Set(arr).size, arr.length, `${name} 存在重复`);
  }
});

test('PRODUCT_ORIENTATIONS 由各品类朝向去重派生', () => {
  assert.deepEqual(PRODUCT_ORIENTATIONS, ['flat', 'side', 'upright', 'horizontal', 'lying']);
});

test('小粒尺寸：默认 mm 与相对尺寸按 0.01 系数一致', () => {
  assert.equal(SCENE_UNITS_PER_MM, 0.01);
  assert.deepEqual(DEFAULT_PRODUCT_SIZE_MM.softdraw, { lengthMm: 180, widthMm: 108, heightMm: 56 });
  assert.deepEqual(DEFAULT_PRODUCT_SIZE_MM.handkerchief, { lengthMm: 92, widthMm: 134, heightMm: 24 });
  assert.deepEqual(DEFAULT_PRODUCT_SIZE_MM.roll, { diameterMm: 100, axialWidthMm: 115, coreDiameterMm: 40, flattenRatePct: 20 });
  // 默认 mm × 0.01 应精确还原 catalog 相对尺寸（浮点误差内）。
  const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
  close(180 * SCENE_UNITS_PER_MM, catalog.softdraw.dimensions.length);
  close(108 * SCENE_UNITS_PER_MM, catalog.softdraw.dimensions.width);
  close(56 * SCENE_UNITS_PER_MM, catalog.softdraw.dimensions.height);
  close(100 * SCENE_UNITS_PER_MM, catalog.roll.dimensions.diameter);
  close(115 * SCENE_UNITS_PER_MM, catalog.roll.dimensions.axialWidth);
  close(40 * SCENE_UNITS_PER_MM, catalog.roll.dimensions.coreDiameter);
});

test('悬挂式底抽采用独立默认规格，且高度不包含固定提手', () => {
  assert.deepEqual(defaultProductSizeMm('softdraw', 'hanging-bottom'), { lengthMm: 153, widthMm: 100, heightMm: 315 });
  assert.deepEqual(defaultProductSizeMm('softdraw', 'standard'), DEFAULT_PRODUCT_SIZE_MM.softdraw);
});

test('小粒尺寸：未启用/缺失回退默认，启用则夹取并保留合法值', () => {
  assert.deepEqual(normalizeProductSizeOverride('softdraw', null), { enabled: false, lengthMm: 180, widthMm: 108, heightMm: 56 });
  assert.deepEqual(normalizeProductSizeOverride('softdraw', { enabled: false }), { enabled: false, lengthMm: 180, widthMm: 108, heightMm: 56 });
  assert.deepEqual(
    normalizeProductSizeOverride('softdraw', { enabled: true, lengthMm: 200, widthMm: 108, heightMm: 56 }),
    { enabled: true, lengthMm: 200, widthMm: 108, heightMm: 56 },
  );
});

test('小粒尺寸：越界/负数/非数字回退品类默认', () => {
  assert.deepEqual(
    normalizeProductSizeOverride('softdraw', { enabled: true, lengthMm: -5, widthMm: 'abc', heightMm: 99999 }),
    { enabled: true, lengthMm: 180, widthMm: 108, heightMm: 56 },
  );
  assert.deepEqual(
    normalizeProductSizeOverride('roll', { enabled: true, diameterMm: 2000, axialWidthMm: 50, coreDiameterMm: 999 }),
    { enabled: true, diameterMm: 100, axialWidthMm: 50, coreDiameterMm: 40, flattenRatePct: 20 },
  );
  assert.deepEqual(
    normalizeProductSizeOverride('handkerchief', { enabled: true, lengthMm: 0, widthMm: 3000, heightMm: 10 }),
    { enabled: true, lengthMm: 92, widthMm: 134, heightMm: 10 },
  );
});

test('卫卷卷芯直径必须小于卷径，旧规格缺字段时回退默认卷芯', () => {
  assert.deepEqual(
    normalizeProductSizeOverride('roll', { enabled: true, diameterMm: 80, axialWidthMm: 100 }),
    { enabled: true, diameterMm: 80, axialWidthMm: 100, coreDiameterMm: 40, flattenRatePct: 20 },
  );
  assert.deepEqual(
    normalizeProductSizeOverride('roll', { enabled: true, diameterMm: 30, axialWidthMm: 100, coreDiameterMm: 40 }),
    { enabled: true, diameterMm: 30, axialWidthMm: 100, coreDiameterMm: 27, flattenRatePct: 20 },
  );
});

test('小粒尺寸：resolveProductDimensions 换算回场景单位', () => {
  assert.deepEqual(resolveProductDimensions('softdraw', { enabled: true, lengthMm: 200, widthMm: 108, heightMm: 56 }),
    { length: 2.0, width: 1.08, height: 0.56 });
  assert.deepEqual(resolveProductDimensions('roll', { enabled: true, diameterMm: 200, axialWidthMm: 100, coreDiameterMm: 50 }),
    { diameter: 2.0, axialWidth: 1.0, coreDiameter: 0.5, flattenRatePct: 20 });
  // 未启用时返回 catalog 原始尺寸对象。
  assert.equal(resolveProductDimensions('softdraw', null), catalog.softdraw.dimensions);
});

test('无芯卫卷压扁率按截面积守恒换算椭圆长短轴', () => {
  const cross = resolveCorelessRollCrossSection(100,20);
  assert.equal(cross.minorDiameter,80);
  assert.equal(cross.majorDiameter,125);
  assert.equal(cross.majorDiameter * cross.minorDiameter,100 * 100);
  assert.equal(normalizeProductSizeOverride('roll',{enabled:true,diameterMm:100,axialWidthMm:115,coreDiameterMm:40,flattenRatePct:75}).flattenRatePct,20);
  assert.equal(normalizeProductSizeOverride('roll',{enabled:true,diameterMm:100,axialWidthMm:115,coreDiameterMm:40,flattenRatePct:0}).flattenRatePct,0);
});
