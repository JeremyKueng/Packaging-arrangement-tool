import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  directionForSide,
  sideForDirection,
  faceVector,
  loadFaceLabel,
  postureLabel,
  unitFacingLabel,
  unitOrientationDescription,
  unitOrientationQuaternion,
  productOrientationQuaternion,
  rotatedSize,
  formatXzySize,
  rollUnitDims,
  dimsFor,
  midpackArrangementMetrics,
} from '../src/geometry-core.js';

function closeVec(actual, expected, eps = 1e-9) {
  assert.equal(actual.length, expected.length);
  actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < eps, `[${i}] ${v} != ${expected[i]}`));
}

function closeQuat(q, expected, eps = 1e-9) {
  closeVec([q.x, q.y, q.z, q.w], expected, eps);
}

test('dimsFor 软抽四种朝向', () => {
  closeVec(dimsFor('softdraw', 'flat', 'z-'), [1.8, 0.56, 1.08]);
  closeVec(dimsFor('softdraw', 'side', 'z-'), [1.8, 1.08, 0.56]);
  closeVec(dimsFor('softdraw', 'side', 'x+'), [0.56, 1.08, 1.8]);
  closeVec(dimsFor('softdraw', 'upright', 'z-'), [0.56, 1.8, 1.08]);
});

test('dimsFor 纸手帕平放/侧放', () => {
  closeVec(dimsFor('handkerchief', 'flat'), [0.92, 0.24, 1.34]);
  closeVec(dimsFor('handkerchief', 'side'), [0.92, 1.34, 0.24]);
});

test('rollUnitDims 卫卷三朝向（圆柱轴方向）', () => {
  closeVec(rollUnitDims('upright'), [1.0, 1.15, 1.0]);
  closeVec(rollUnitDims('horizontal'), [1.15, 1.0, 1.0]);
  closeVec(rollUnitDims('lying'), [1.0, 1.0, 1.15]);
});

test('dimsFor 卫卷膜包余量计算', () => {
  closeVec(dimsFor('roll', 'upright', 'z-', { count: 4, x: 2, z: 2, y: 1 }), [2.08, 1.23, 2.08]);
  closeVec(dimsFor('roll', 'upright', 'z-', { count: 6, x: 2, z: 3, y: 1 }), [2.08, 1.23, 3.08]);
  closeVec(dimsFor('roll', 'upright', 'z-', { count: 1 }), [1.0, 1.15, 1.0]);
});

test('dimsFor 默认尺寸不变（dimensionOverride 为 null）', () => {
  closeVec(dimsFor('softdraw', 'flat', 'z-', { count: 1 }, null), [1.8, 0.56, 1.08]);
  closeVec(dimsFor('roll', 'upright', 'z-', { count: 1 }, null), [1.0, 1.15, 1.0]);
});

test('dimsFor 自定义尺寸各朝向换算（软抽）', () => {
  const override = { enabled: true, lengthMm: 200, widthMm: 108, heightMm: 56 };
  closeVec(dimsFor('softdraw', 'flat', 'z-', { count: 1 }, override), [2.0, 0.56, 1.08]);
  closeVec(dimsFor('softdraw', 'side', 'z-', { count: 1 }, override), [2.0, 1.08, 0.56]);
  closeVec(dimsFor('softdraw', 'side', 'x+', { count: 1 }, override), [0.56, 1.08, 2.0]);
  closeVec(dimsFor('softdraw', 'upright', 'z-', { count: 1 }, override), [0.56, 2.0, 1.08]);
});

test('dimsFor 自定义卫卷尺寸（含膜包）', () => {
  const override = { enabled: true, diameterMm: 200, axialWidthMm: 100 };
  closeVec(dimsFor('roll', 'upright', 'z-', { count: 1 }, override), [2.0, 1.0, 2.0]);
  closeVec(dimsFor('roll', 'horizontal', 'z-', { count: 1 }, override), [1.0, 2.0, 2.0]);
  // 4 卷膜包（2×2×1）：X/Z 各 2 卷 + 膜余量 0.08；Y 单层 + 膜余量 0.08。
  closeVec(dimsFor('roll', 'upright', 'z-', { count: 4, x: 2, z: 2, y: 1 }, override), [4.08, 1.08, 4.08]);
});

test('无芯卫卷按压扁率形成椭圆且短轴始终为受压高度', () => {
  const override = { enabled:true, diameterMm:100, axialWidthMm:115, coreDiameterMm:40, flattenRatePct:20 };
  closeVec(rollUnitDims('upright',override,'coreless'),[1.25,1.15,.8]);
  closeVec(rollUnitDims('horizontal',override,'coreless'),[1.15,.8,1.25]);
  closeVec(rollUnitDims('lying',override,'coreless'),[1.25,.8,1.15]);
  closeVec(dimsFor('roll','horizontal','z-',{count:1},override,'coreless'),[1.15,.8,1.25]);
});

test('悬挂式底抽提手不计入产品本体高度与排列尺寸', () => {
  closeVec(dimsFor('softdraw','flat','z-',{count:1},null,'cored','hanging-bottom'),[1.8,.56,1.08]);
  closeVec(dimsFor('softdraw','side','z-',{count:1},null,'cored','hanging-bottom'),[1.8,1.08,.56]);
  closeVec(dimsFor('softdraw','upright','z-',{count:1},null,'cored','hanging-bottom'),[.56,1.8,1.08]);
});

test('悬挂式底抽侧立十字绕提手面法向旋转整包，平放不受影响', () => {
  closeVec(dimsFor('softdraw','flat','z-',{count:1},null,'cored','hanging-bottom','parallel'),[1.8,.56,1.08]);
  closeVec(dimsFor('softdraw','flat','z-',{count:1},null,'cored','hanging-bottom','cross'),[1.8,.56,1.08]);
  closeVec(dimsFor('softdraw','side','z-',{count:1},null,'cored','hanging-bottom','parallel'),[1.8,1.08,.56]);
  closeVec(dimsFor('softdraw','side','z-',{count:1},null,'cored','hanging-bottom','cross'),[1.08,1.8,.56]);
  closeVec(dimsFor('softdraw','side','x-',{count:1},null,'cored','hanging-bottom','parallel'),[.56,1.08,1.8]);
  closeVec(dimsFor('softdraw','side','x-',{count:1},null,'cored','hanging-bottom','cross'),[.56,1.8,1.08]);
});

test('悬挂式底抽侧立十字由产品姿态四元数统一驱动，提手面向不变', () => {
  const localSize = [1.8, .56, 1.08];
  const parallel = productOrientationQuaternion('softdraw', 'side', 'z-', 'hanging-bottom', 'parallel');
  const cross = productOrientationQuaternion('softdraw', 'side', 'z-', 'hanging-bottom', 'cross');
  const parallelHandleNormal = new THREE.Vector3(0, 1, 0).applyQuaternion(parallel);
  const crossHandleNormal = new THREE.Vector3(0, 1, 0).applyQuaternion(cross);
  closeVec(parallelHandleNormal.toArray(), [0, 0, -1]);
  closeVec(crossHandleNormal.toArray(), [0, 0, -1]);
  closeVec(rotatedSize(localSize, parallel), dimsFor('softdraw', 'side', 'z-', { count: 1 }, null, 'cored', 'hanging-bottom', 'parallel'));
  closeVec(rotatedSize(localSize, cross), dimsFor('softdraw', 'side', 'z-', { count: 1 }, null, 'cored', 'hanging-bottom', 'cross'));
  assert.ok(Math.abs(parallel.angleTo(cross) - Math.PI / 2) < 1e-9);
});

test('formatXzySize 按 X×Z×Y 排版', () => {
  assert.equal(formatXzySize([1.8, 0.56, 1.08]), '1.8 × 1.1 × 0.6');
});

test('粒间距只改变爆炸视图，不改变中包物理尺寸', () => {
  const zero = midpackArrangementMetrics([1.8, .56, 1.08], 2, 3, 3, 0, .88);
  const exploded = midpackArrangementMetrics([1.8, .56, 1.08], 2, 3, 3, .35, .88);
  closeVec(exploded.physicalTotal, zero.physicalTotal);
  assert.ok(exploded.viewTotal[0] > zero.viewTotal[0]);
  assert.ok(exploded.viewTotal[1] > zero.viewTotal[1]);
  assert.ok(exploded.viewTotal[2] > zero.viewTotal[2]);
});

test('loadFaceLabel 与 directionForSide/sideForDirection 互转', () => {
  assert.equal(loadFaceLabel('z-'), '长度端 A（-Z）');
  assert.equal(loadFaceLabel('y+'), '顶部（+Y）');
  assert.equal(loadFaceLabel('x+'), '横向端 B（+X）');
  const v = directionForSide('z-');
  assert.equal(v.x, 0); assert.equal(v.z, -1);
  assert.equal(sideForDirection(new THREE.Vector3(0, 0, -1)), 'z-');
  assert.equal(sideForDirection(new THREE.Vector3(-1, 0, 0)), 'x-');
  assert.equal(sideForDirection(directionForSide('x+')), 'x+');
});

test('faceVector 各面法向', () => {
  assert.equal(faceVector('y+').y, 1);
  assert.equal(faceVector('z-').z, -1);
  assert.equal(faceVector('x-').x, -1);
});

test('rotatedSize 恒等与绕 Y 轴 90°', () => {
  const identity = new THREE.Quaternion();
  closeVec(rotatedSize([1.8, 0.56, 1.08], identity), [1.8, 0.56, 1.08]);
  const rotY90 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  closeVec(rotatedSize([1.8, 0.56, 1.08], rotY90), [1.08, 0.56, 1.8]);
});

test('unitOrientationQuaternion：平放且朝向匹配为恒等', () => {
  const q = unitOrientationQuaternion('softdraw', 'flat', 'z-', 'z-');
  closeQuat(q, [0, 0, 0, 1]);
});

test('unitOrientationQuaternion：端立把顶面转到提手对侧', () => {
  const q = unitOrientationQuaternion('softdraw', 'end', 'z-', 'z-');
  const top = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  closeVec([top.x, top.y, top.z], [0, 0, -1]);
});

test('unitOrientationQuaternion：纸手帕忽略传入的提手端', () => {
  // 纸手帕无提手，native side 固定为 z-，即使传入 x+ 也不应影响平放恒等。
  const q = unitOrientationQuaternion('handkerchief', 'flat', 'z-', 'x+');
  closeQuat(q, [0, 0, 0, 1]);
});

test('标签函数不抛异常且包含关键信息', () => {
  assert.equal(postureLabel('side', 'softdraw'), '侧立（侧面承托）');
  assert.match(unitFacingLabel('flat', 'z-', 'softdraw'), /提手朝/);
  assert.match(unitOrientationDescription('softdraw', 'side', 'z-'), /侧立/);
});
