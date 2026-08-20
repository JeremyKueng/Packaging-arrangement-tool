import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CASE_DIVIDER_THICKNESS_MM,
  caseDividerRequirement,
  dividerBoundaryOffset,
  dividerUnitShift,
  normalizeCaseDividerMode,
  splitCompartmentCount,
} from '../src/case-divider.js';

test('奇数排列按小数在前、大数在后分区', () => {
  assert.deepEqual(splitCompartmentCount(5), {
    count: 5, first: 2, second: 3, canSplit: true, label: '2+3',
  });
  assert.equal(caseDividerRequirement('cross', 5, 3).summary, 'X 行方向 2+3，Z 列方向 1+2');
});

test('偶数排列等分，单列不能形成完整十字', () => {
  assert.equal(splitCompartmentCount(4).label, '2+2');
  assert.equal(caseDividerRequirement('cross', 4, 2).completeCross, true);
  assert.equal(caseDividerRequirement('cross', 4, 1).completeCross, false);
});

test('挡板位于实际单元边界，奇数时偏向小数量一侧', () => {
  assert.equal(dividerBoundaryOffset(4, 10), 0);
  assert.equal(dividerBoundaryOffset(5, 10), -5);
  assert.equal(dividerUnitShift(1, 5, 0.04), -0.02);
  assert.equal(dividerUnitShift(2, 5, 0.04), 0.02);
  assert.equal(dividerUnitShift(0, 1, 0.04), 0);
});

test('非法挡板模式回退为无挡板，纸板默认厚度为 4 mm', () => {
  assert.equal(normalizeCaseDividerMode('cross'), 'cross');
  assert.equal(normalizeCaseDividerMode('bad'), 'none');
  assert.equal(CASE_DIVIDER_THICKNESS_MM, 4);
});
