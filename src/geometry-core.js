// ===== 姿态、旋转、尺寸换算纯函数 =====
// 只依赖 three 与 dimensions 配置，不访问 DOM / UI 状态，可直接在 Node 中单测。

import * as THREE from 'three';
import { catalog, packagingRules, resolveCorelessRollCrossSection, resolveProductDimensions } from './dimensions.js';

export function directionForSide(side) {
  const sign = side.endsWith('-') ? -1 : 1;
  return side.startsWith('x') ? new THREE.Vector3(sign, 0, 0) : new THREE.Vector3(0, 0, sign);
}

export function sideForDirection(direction) {
  if (Math.abs(direction.x) > Math.abs(direction.z)) return direction.x < 0 ? 'x-' : 'x+';
  return direction.z < 0 ? 'z-' : 'z+';
}

export function faceVector(face) {
  if (face === 'y+') return new THREE.Vector3(0, 1, 0);
  if (face === 'z-') return new THREE.Vector3(0, 0, -1);
  if (face === 'z+') return new THREE.Vector3(0, 0, 1);
  if (face === 'x-') return new THREE.Vector3(-1, 0, 0);
  return new THREE.Vector3(1, 0, 0);
}

export function loadFaceLabel(face) {
  return ({ 'y+': '顶部（+Y）', 'z-': '长度端 A（-Z）', 'z+': '长度端 B（+Z）', 'x-': '横向端 A（-X）', 'x+': '横向端 B（+X）' })[face] || '顶部（+Y）';
}

export function postureLabel(posture, type) {
  if (posture === 'side') return '侧立（侧面承托）';
  if (posture === 'end') return type === 'handkerchief' ? '端立（长向朝上）' : '端立（提手朝上）';
  return type === 'handkerchief' ? '平放（顶封面向上）' : '平放（顶面向上）';
}

export function unitFacingLabel(posture, facing, type) {
  const side = loadFaceLabel(facing);
  if (posture === 'end') return type === 'handkerchief' ? `顶封面朝${side}` : `顶面朝${side}`;
  return type === 'handkerchief' ? `长向朝${side}` : `提手朝${side}`;
}

export function unitOrientationDescription(type, posture, facing) {
  const reference = type === 'handkerchief' ? '长向' : '提手';
  const top = type === 'handkerchief' ? '顶封面' : '顶面';
  if (posture === 'flat') return `平放；${top}向上；${reference}朝${loadFaceLabel(facing)}`;
  if (posture === 'side') {
    const targetHandle = directionForSide(facing);
    const targetTop = new THREE.Vector3(0, 1, 0).cross(targetHandle).normalize();
    return `侧立；${reference}朝${loadFaceLabel(facing)}；${top}朝${loadFaceLabel(sideForDirection(targetTop))}`;
  }
  return `端立；${reference}朝上；${top}朝${loadFaceLabel(facing)}`;
}

// 整个中包/包装单元进入外包装后的姿态。
// 注意：这不是单粒产品在中包内的姿态，不能接收 hangingSideDirection。
export function packageUnitOrientationQuaternion(type, posture, facing, nativeHandleSide = 'z-') {
  const nativeSide = type === 'handkerchief' ? 'z-' : nativeHandleSide;
  const localReference = directionForSide(nativeSide);
  const localTop = new THREE.Vector3(0, 1, 0);
  const localThird = localReference.clone().cross(localTop).normalize();
  let targetReference, targetTop;
  if (posture === 'side') {
    targetReference = directionForSide(facing);
    targetTop = new THREE.Vector3(0, 1, 0).cross(targetReference).normalize();
  } else if (posture === 'end') {
    targetReference = new THREE.Vector3(0, 1, 0);
    targetTop = directionForSide(facing);
  } else {
    targetReference = directionForSide(facing);
    targetTop = new THREE.Vector3(0, 1, 0);
  }
  const targetThird = targetReference.clone().cross(targetTop).normalize();
  const localBasis = new THREE.Matrix4().makeBasis(localReference, localTop, localThird);
  const targetBasis = new THREE.Matrix4().makeBasis(targetReference, targetTop, targetThird);
  const rotation = new THREE.Matrix4().multiplyMatrices(targetBasis, localBasis.clone().invert());
  return new THREE.Quaternion().setFromRotationMatrix(rotation).normalize();
}

// 单粒产品的唯一姿态来源。模型、dimsFor 和装箱命名都应使用它。
// hangingSideDirection 只描述悬挂式底抽侧立时的小包相对中包提手面的面内旋转。
export function productOrientationQuaternion(
  type,
  orientation,
  nativeHandleSide = 'z-',
  softdrawVariant = 'standard',
  hangingSideDirection = 'parallel',
) {
  const quaternion = new THREE.Quaternion();
  if (type === 'softdraw') {
    if (orientation === 'upright') {
      quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
    } else if (orientation === 'side') {
      const sign = nativeHandleSide.endsWith('-') ? -1 : 1;
      const alongX = nativeHandleSide.startsWith('x');
      const basisX = alongX ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
      const basisY = alongX ? new THREE.Vector3(sign, 0, 0) : new THREE.Vector3(0, 0, sign);
      const basisZ = alongX ? new THREE.Vector3(0, sign, 0) : new THREE.Vector3(0, -sign, 0);
      quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(basisX, basisY, basisZ));
      if (softdrawVariant === 'hanging-bottom' && hangingSideDirection === 'cross') {
        // 与 makeSoftdraw 的 group.rotateY(PI/2) 等价：绕产品局部 Y（提手面法向）旋转。
        quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2));
      }
    }
    return quaternion.normalize();
  }
  if (type === 'handkerchief' && orientation === 'side') {
    quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
  } else if (type === 'roll') {
    if (orientation === 'horizontal') quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
    if (orientation === 'lying') quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
  }
  return quaternion.normalize();
}

// 旧名称保留，避免外部集成和历史预设代码失效；新代码应使用更明确的名称。
export const unitOrientationQuaternion = packageUnitOrientationQuaternion;

// 直装（单粒直接装入大包/装箱）的剩余旋转自由度：绕竖直轴把已定向的产品再旋转。
// 0°/90°/180°/270° 覆盖四个朝向，用于表达“该装入姿态仍可旋转的面”，如软抽直立开口刻线朝向、
// 立式卷膜包 ×2 面朝向。旋转发生在产品姿态之后（世界系先乘），并同步参与尺寸换算与装箱命名。
const DIRECT_SPIN_ANGLES = { none: 0, 90: Math.PI / 2, 180: Math.PI, 270: -Math.PI / 2 };
export function directSpinQuaternion(spin) {
  const angle = DIRECT_SPIN_ANGLES[spin];
  if (angle) return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
  return new THREE.Quaternion();
}

export function rotatedSize(size, quaternion) {
  const half = new THREE.Vector3(size[0] / 2, size[1] / 2, size[2] / 2);
  const box = new THREE.Box3(half.clone().negate(), half).applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(quaternion));
  const result = box.getSize(new THREE.Vector3());
  return [result.x, result.y, result.z].map(value => Math.abs(value) < 1e-8 ? 0 : value);
}

export function formatXzySize(size) {
  return `${size[0].toFixed(1)} × ${size[2].toFixed(1)} × ${size[1].toFixed(1)}`;
}

// 卫卷单粒（未成膜包）在各朝向下的计算尺寸：仅圆柱轴方向不同。
// dimensionOverride 为可选的产品尺寸覆盖（{enabled, diameterMm, axialWidthMm, flattenRatePct}）。
// 无芯卫卷按椭圆截面计算：横/卧时短轴始终作为竖直承压方向；
// 直立时长轴（凸面）沿提手端轴向 handleSide，提手/封尾面看到卷的鼓面、扁面朝两侧。
export function rollUnitDims(orientation, dimensionOverride = null, rollCore = 'cored', handleSide = 'z-') {
  const { diameter, axialWidth, flattenRatePct } = resolveProductDimensions('roll', dimensionOverride);
  const cross = rollCore === 'coreless'
    ? resolveCorelessRollCrossSection(diameter, flattenRatePct)
    : { majorDiameter: diameter, minorDiameter: diameter };
  const major = cross.majorDiameter;
  const minor = cross.minorDiameter;
  // 无芯卷横放时，模型会先把短轴放到局部 X，再绕 Z 轴转为世界竖直方向；
  // 这里保持与 makeRoll 的椭圆缩放一致，再通过统一姿态四元数换算到世界尺寸。
  let localSize;
  if (orientation === 'horizontal') {
    localSize = [minor, axialWidth, major];
  } else if (orientation === 'lying') {
    localSize = [major, axialWidth, minor];
  } else {
    // 直立：椭圆长轴沿提手端轴向（提手在 z± → 长轴沿 Z；提手在 x± → 长轴沿 X）。
    const handleAlongX = String(handleSide || 'z-').startsWith('x');
    localSize = handleAlongX ? [major, axialWidth, minor] : [minor, axialWidth, major];
  }
  return rotatedSize(localSize, productOrientationQuaternion('roll', orientation));
}

// 品类 × 朝向 × 提手端 → 单粒/小包计算尺寸（内部数组顺序 [X,Y,Z]，界面显示为 X×Z×Y）。
// dimensionOverride 为可选的产品尺寸覆盖（{enabled, lengthMm/widthMm/heightMm 或 diameterMm/axialWidthMm}）。
export function dimsFor(type, orientation, handleSide = 'z-', bundleSpec = { count: 1 }, dimensionOverride = null, rollCore = 'cored', softdrawVariant = 'standard', hangingSideDirection = 'parallel') {
  if (type === 'roll') {
    const single = rollUnitDims(orientation, dimensionOverride, rollCore, handleSide);
    if (!bundleSpec || bundleSpec.count === 1) return single;
    const gap = packagingRules.rollBundleGap;
    const allowance = packagingRules.rollBundleFilmAllowance;
    return [
      bundleSpec.x * single[0] + Math.max(0, bundleSpec.x - 1) * gap + allowance,
      bundleSpec.y * single[1] + Math.max(0, bundleSpec.y - 1) * gap + allowance,
      bundleSpec.z * single[2] + Math.max(0, bundleSpec.z - 1) * gap + allowance,
    ];
  }
  if (type === 'softdraw') {
    const { length, width, height } = resolveProductDimensions('softdraw', dimensionOverride);
    // 悬挂式底抽的提手属于柔性包装附属件：只作方向识别，不计入产品本体高度、
    // 排列步距或容器尺寸。各姿态尺寸与同规格普通软抽完全一致。
    const localSize = [length, height, width];
    return rotatedSize(localSize, productOrientationQuaternion(
      'softdraw', orientation, handleSide, softdrawVariant, hangingSideDirection,
    ));
  }
  const { length, width, height } = resolveProductDimensions('handkerchief', dimensionOverride);
  return rotatedSize([length, height, width], productOrientationQuaternion('handkerchief', orientation));
}

// 中包排列同时维护两套口径：physical* 是紧密接触的业务尺寸；view* 仅用于爆炸展示。
// gapRatio 永远不能进入外包装尺寸或 PDF 的业务尺寸。
export function midpackArrangementMetrics(dims, rows, cols, layers, gapRatio = 0, heightScale = 1) {
  const d = dims.map(value => Math.max(0, Number(value) || 0));
  const r = Math.max(1, Math.round(Number(rows) || 1));
  const c = Math.max(1, Math.round(Number(cols) || 1));
  const l = Math.max(1, Math.round(Number(layers) || 1));
  const gap = Math.max(0, Number(gapRatio) || 0);
  const scaleY = Math.max(0, Number(heightScale) || 1);
  const physicalStep = [...d];
  const viewStep = d.map(value => value * (1 + gap));
  const physicalRawTotal = [r * d[0], l * d[1], c * d[2]];
  const viewRawTotal = [
    r * d[0] + Math.max(0, r - 1) * (viewStep[0] - d[0]),
    l * d[1] + Math.max(0, l - 1) * (viewStep[1] - d[1]),
    c * d[2] + Math.max(0, c - 1) * (viewStep[2] - d[2]),
  ];
  return {
    physicalStep,
    viewStep,
    physicalRawTotal,
    viewRawTotal,
    physicalTotal: [physicalRawTotal[0], physicalRawTotal[1] * scaleY, physicalRawTotal[2]],
    viewTotal: [viewRawTotal[0], viewRawTotal[1] * scaleY, viewRawTotal[2]],
  };
}

// 三维模型的 scale 属于模型本地坐标，必须在姿态旋转之前按产品原始物理轴换算。
// 箱型产品本地轴恒为 [长, 高, 宽]；单卷本地轴恒为 [直径, 轴向宽, 直径]。
// 组合膜包在已旋转的世界轴上排列多卷，所以仍按 dimsFor 的姿态后轴比例整体缩放。
export function productVisualScale(type, orientation, handleSide = 'z-', bundleSpec = { count: 1 }, dimensionOverride = null) {
  const basePhysical = resolveProductDimensions(type, null);
  const targetPhysical = resolveProductDimensions(type, dimensionOverride);
  if (type === 'softdraw' || type === 'handkerchief') {
    return [
      targetPhysical.length / basePhysical.length,
      targetPhysical.height / basePhysical.height,
      targetPhysical.width / basePhysical.width,
    ];
  }
  if (!bundleSpec || bundleSpec.count === 1) {
    const diameterRatio = targetPhysical.diameter / basePhysical.diameter;
    return [diameterRatio, targetPhysical.axialWidth / basePhysical.axialWidth, diameterRatio];
  }
  const base = dimsFor(type, orientation, handleSide, bundleSpec, null);
  const target = dimsFor(type, orientation, handleSide, bundleSpec, dimensionOverride);
  return base.map((value, index) => value > 0 ? target[index] / value : 1);
}
