import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CARTON_POSTURE_NAME_MAP,
  cartonPostureName,
  deriveCartonNaming,
  resolveCartonLongAxis,
} from '../src/carton-naming.js';

function direct(productType, orientation, rows, cols, extra = {}) {
  return deriveCartonNaming({
    productType,
    sourceType: 'product',
    sourceSnapshot: {
      orientation,
      rollCore: 'cored',
      rollBundleMode: 'single',
      rollBundleX: 1,
      rollBundleZ: 1,
      rollBundleY: 1,
    },
    presetSnapshot: { rows, cols, layers: 1, spacing: 0, margin: 0.05, ...extra },
  });
}

test('闭箱 X/Z 接近正方形时固定以 X 为箱长', () => {
  assert.equal(resolveCartonLongAxis(10, 10.2), 'x');
  assert.equal(resolveCartonLongAxis(10, 10.5), 'z');
  assert.equal(resolveCartonLongAxis(12, 10), 'x');
});

test('装箱姿态名称集中由映射表维护', () => {
  assert.equal(cartonPostureName('rect.flat.along'), '顺箱长平放');
  assert.equal(CARTON_POSTURE_NAME_MAP['rect.end.width-along'], '宽边顺箱长端立');
  assert.equal(cartonPostureName('rect.flat.along', { 'rect.flat.along': '长度方向平放' }), '长度方向平放');
});

test('软抽直装：最终箱长改变时自动区分顺/横箱长', () => {
  assert.equal(direct('softdraw', 'flat', 2, 1).code, 'rect.flat.along');
  assert.equal(direct('softdraw', 'flat', 1, 3).code, 'rect.flat.cross');
  assert.equal(direct('softdraw', 'side', 3, 1).code, 'rect.side.along');
});

test('软抽直立：按小横截面中实际顺箱长的边区分宽边/厚边', () => {
  const widthAlong = direct('softdraw', 'upright', 2, 2);
  assert.equal(widthAlong.code, 'rect.end.width-along');
  assert.equal(widthAlong.postureName, '宽边顺箱长端立');
  const thicknessAlong = direct('softdraw', 'upright', 4, 1);
  assert.equal(thicknessAlong.code, 'rect.end.thickness-along');
});

test('悬挂式底抽侧立十字按产品姿态四元数命名，不再依赖轴交换补丁', () => {
  const baseSnapshot = {
    orientation: 'side',
    handleSide: 'z-',
    softdrawVariant: 'hanging-bottom',
    rollCore: 'cored',
    rollBundleMode: 'single',
  };
  const presetSnapshot = { rows: 2, cols: 1, layers: 1, spacing: 0, margin: 0.05 };
  const parallel = deriveCartonNaming({
    productType: 'softdraw', sourceType: 'product',
    sourceSnapshot: { ...baseSnapshot, hangingSideDirection: 'parallel' },
    presetSnapshot,
  });
  const cross = deriveCartonNaming({
    productType: 'softdraw', sourceType: 'product',
    sourceSnapshot: { ...baseSnapshot, hangingSideDirection: 'cross' },
    presetSnapshot,
  });
  assert.equal(parallel.code, 'rect.side.along');
  assert.equal(cross.code, 'rect.end.width-along');
  assert.notDeepEqual(cross.cartonSize, parallel.cartonSize);
});

test('卫卷直装：立式、卷轴顺箱长与卷轴横箱长', () => {
  assert.equal(direct('roll', 'upright', 2, 3).code, 'roll.vertical');
  assert.equal(direct('roll', 'horizontal', 3, 1).code, 'roll.axis-along');
  assert.equal(direct('roll', 'horizontal', 1, 3).code, 'roll.axis-cross');
});

test('经中包装箱按中包旋转后轴向与闭箱长边命名', () => {
  const naming = deriveCartonNaming({
    productType: 'softdraw',
    sourceType: 'midpack',
    sourcePresetName: '18包-平2×3×3',
    sourceSnapshot: {
      rows: 2, cols: 3, layers: 3, orientation: 'flat', handleSide: 'z-',
      rollCore: 'cored', rollBundleMode: 'single', rollBundleX: 1, rollBundleZ: 1, rollBundleY: 1,
    },
    presetSnapshot: {
      rows: 1, cols: 2, layers: 1, spacing: 0, margin: 0.05,
      unitPosture: 'flat', unitFacing: 'z-',
    },
  });
  assert.equal(naming.code, 'rect.flat.cross');
  assert.equal(naming.systemFormalName, '18包-平2×3×3中包－横箱长平放－1×2×1');
  assert.equal(naming.cartonLongAxis, 'z');
});

test('方案级正式名称修订覆盖显示但保留系统推导结果', () => {
  const naming = direct('softdraw', 'flat', 2, 1, { formalNameOverride: '客户专用装箱方式 A' });
  assert.equal(naming.formalName, '客户专用装箱方式 A');
  assert.equal(naming.isOverridden, true);
  assert.equal(naming.systemFormalName, '软抽单包－顺箱长平放－2×1×1');
});
