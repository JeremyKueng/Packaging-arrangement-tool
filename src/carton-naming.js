// ===== 装箱正式名称 =====
//
// 命名只用于业务显示，不参与三维姿态计算，也不替代 unitPosture / unitFacing /
// productOrientation 等稳定编码。以后调整术语时，只需修改 CARTON_POSTURE_NAME_MAP；
// 已保存方案无需迁移。单个方案还可通过 formalNameOverride 覆盖系统生成名称。

import * as THREE from 'three';
import { catalog, packagingRules, midpackHeightScale, DIRECT_SPINS } from './dimensions.js';
import { dimsFor, rotatedSize, productOrientationQuaternion, packageUnitOrientationQuaternion, directSpinQuaternion } from './geometry-core.js';

export const CARTON_POSTURE_NAME_MAP = Object.freeze({
  'rect.flat.along': '顺箱长平放',
  'rect.flat.cross': '横箱长平放',
  'rect.side.along': '顺箱长侧立',
  'rect.side.cross': '横箱长侧立',
  'rect.end.width-along': '宽边顺箱长端立',
  'rect.end.thickness-along': '厚边顺箱长端立',
  'rect.end.width-along.opening-along': '宽边顺箱长端立（开口刻线顺箱长）',
  'rect.end.width-along.opening-cross': '宽边顺箱长端立（开口刻线朝箱宽）',
  'rect.end.thickness-along.opening-along': '厚边顺箱长端立（开口刻线顺箱长）',
  'rect.end.thickness-along.opening-cross': '厚边顺箱长端立（开口刻线朝箱宽）',
  'roll.vertical': '立式装箱',
  'roll.vertical.pair-width': '立式装箱（×2面靠箱宽）',
  'roll.vertical.pair-length': '立式装箱（×2面靠箱长）',
  'roll.axis-along': '卷轴顺箱长',
  'roll.axis-cross': '卷轴横箱长',
});

const PRODUCT_SHORT_NAME = { handkerchief: '纸手帕', softdraw: '软抽', roll: '卫卷' };
const WORLD_AXES = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};

function safeCount(value, fallback = 1) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function safeDecimal(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function rollBundleSpec(snapshot = {}) {
  if (snapshot.rollCore === 'coreless' || snapshot.rollBundleMode === 'single' || !snapshot.rollBundleMode) {
    return { count: 1, x: 1, z: 1, y: 1 };
  }
  // 有芯卫卷膜包预设统一 2×1×N（X 并列 × Z 单排 × Y 叠层）。
  if (snapshot.rollBundleMode === '2') return { count: 2, x: 2, z: 1, y: 1 };
  if (snapshot.rollBundleMode === '4') return { count: 4, x: 2, z: 1, y: 2 };
  if (snapshot.rollBundleMode === '6') return { count: 6, x: 2, z: 1, y: 3 };
  const x = safeCount(snapshot.rollBundleX);
  const z = safeCount(snapshot.rollBundleZ);
  const y = safeCount(snapshot.rollBundleY);
  return { count: x * z * y, x, z, y };
}

// 闭箱后 X/Z 相差不超过 tolerance 时固定以 X 为箱长，避免微小余量或浮点误差
// 导致同一方案在“顺箱长/横箱长”之间跳变。
export function resolveCartonLongAxis(sizeX, sizeZ, tolerance = 0.03) {
  const x = Math.max(0, Number(sizeX) || 0);
  const z = Math.max(0, Number(sizeZ) || 0);
  const largest = Math.max(x, z, 1e-9);
  if (Math.abs(x - z) / largest <= tolerance) return 'x';
  return x > z ? 'x' : 'z';
}

export function cartonPostureName(code, nameMap = CARTON_POSTURE_NAME_MAP) {
  return nameMap[code] || code || '未定义装箱姿态';
}

function dominantAxis(vector) {
  const absolute = { x: Math.abs(vector.x), y: Math.abs(vector.y), z: Math.abs(vector.z) };
  return Object.entries(absolute).sort((a, b) => b[1] - a[1])[0][0];
}

function classifyRectangularBasis(basis, cartonLongAxis) {
  const verticalPhysicalAxis = Object.keys(basis).find(key => dominantAxis(basis[key]) === 'y') || 'height';
  const longPhysicalAxis = Object.keys(basis).find(key => dominantAxis(basis[key]) === cartonLongAxis) || 'length';
  if (verticalPhysicalAxis === 'height') {
    return longPhysicalAxis === 'length' ? 'rect.flat.along' : 'rect.flat.cross';
  }
  if (verticalPhysicalAxis === 'width') {
    return longPhysicalAxis === 'length' ? 'rect.side.along' : 'rect.side.cross';
  }
  return longPhysicalAxis === 'width' ? 'rect.end.width-along' : 'rect.end.thickness-along';
}

function directRectangularBasis(type, orientation, sourceSnapshot = {}) {
  const quaternion = productOrientationQuaternion(
    type,
    orientation,
    sourceSnapshot.handleSide || 'z-',
    sourceSnapshot.softdrawVariant || 'standard',
    sourceSnapshot.hangingSideDirection || 'parallel',
  );
  return {
    length: WORLD_AXES.x.clone().applyQuaternion(quaternion),
    width: WORLD_AXES.z.clone().applyQuaternion(quaternion),
    height: WORLD_AXES.y.clone().applyQuaternion(quaternion),
  };
}

function directSourceGeometry(productType, sourceSnapshot, presetSnapshot = {}) {
  const bundleSpec = productType === 'roll' ? rollBundleSpec(sourceSnapshot) : { count: 1 };
  const orientation = sourceSnapshot.orientation || catalog[productType].orientations[0][0];
  const size = dimsFor(
    productType,
    orientation,
    sourceSnapshot.handleSide || 'z-',
    bundleSpec,
    sourceSnapshot.dimensionsMm,
    sourceSnapshot.rollCore || 'cored',
    sourceSnapshot.softdrawVariant || 'standard',
    sourceSnapshot.hangingSideDirection || 'parallel',
  );
  // 直装剩余旋转（绕竖直轴 0°/90°/180°/270°）：同步参与尺寸、基向量与卷轴/×2面方向换算。
  const spin = DIRECT_SPINS.includes(presetSnapshot.directSpin) ? presetSnapshot.directSpin : 'none';
  const spinQuaternion = directSpinQuaternion(spin);
  const spunSize = rotatedSize(size, spinQuaternion);
  if (productType === 'roll') {
    const rollAxis = orientation === 'upright'
      ? 'y'
      : (orientation === 'horizontal' ? 'x' : 'z');
    const spunRollAxis = dominantAxis(WORLD_AXES[rollAxis].clone().applyQuaternion(spinQuaternion));
    // 立式膜包的 ×2 面朝向：并列方向（bundleSpec.x ≥ 2 且 z = 1 时为膜包本地 X）旋转后的世界轴。
    const pairAxis = (orientation === 'upright' && bundleSpec.x >= 2 && bundleSpec.z === 1)
      ? dominantAxis(WORLD_AXES.x.clone().applyQuaternion(spinQuaternion))
      : null;
    return { size: spunSize, rollAxis: spunRollAxis, pairAxis, bundleSpec, orientation, spin };
  }
  const basis = directRectangularBasis(productType, orientation, sourceSnapshot);
  Object.keys(basis).forEach(key => basis[key].applyQuaternion(spinQuaternion));
  return { size: spunSize, basis, bundleSpec, orientation, spin };
}

function midpackSourceGeometry(productType, sourceSnapshot, presetSnapshot) {
  const bundleSpec = productType === 'roll' ? rollBundleSpec(sourceSnapshot) : { count: 1 };
  const single = dimsFor(
    productType,
    sourceSnapshot.orientation || catalog[productType].orientations[0][0],
    sourceSnapshot.handleSide || 'z-',
    bundleSpec,
    sourceSnapshot.dimensionsMm,
    sourceSnapshot.rollCore || 'cored',
    sourceSnapshot.softdrawVariant || 'standard',
    sourceSnapshot.hangingSideDirection || 'parallel',
  );
  const rows = safeCount(sourceSnapshot.rows);
  const cols = safeCount(sourceSnapshot.cols);
  const layers = safeCount(sourceSnapshot.layers);
  const localSize = [
    rows * single[0],
    layers * single[1] * midpackHeightScale(productType),
    cols * single[2],
  ];
  const [padX, padY, padZ] = packagingRules.bagPadding;
  const proxySize = [localSize[0] + padX, localSize[1] + padY, localSize[2] + padZ];
  const quaternion = packageUnitOrientationQuaternion(
    productType,
    presetSnapshot.unitPosture || 'flat',
    presetSnapshot.unitFacing || 'z-',
    sourceSnapshot.handleSide || 'z-',
  );
  const localLengthAxis = proxySize[0] >= proxySize[2] ? 'x' : 'z';
  const localWidthAxis = localLengthAxis === 'x' ? 'z' : 'x';
  const basis = {
    length: WORLD_AXES[localLengthAxis].clone().applyQuaternion(quaternion),
    width: WORLD_AXES[localWidthAxis].clone().applyQuaternion(quaternion),
    height: WORLD_AXES.y.clone().applyQuaternion(quaternion),
  };
  return { size: rotatedSize(proxySize, quaternion), basis, bundleSpec };
}

function directSourceLabel(productType, snapshot, bundleSpec) {
  if (productType !== 'roll') {
    if (productType === 'softdraw' && snapshot.softdrawVariant === 'hanging-bottom') return '悬挂式底抽单包';
    return `${PRODUCT_SHORT_NAME[productType]}单包`;
  }
  if (bundleSpec.count > 1) return `${bundleSpec.count}卷膜包`;
  return snapshot.rollCore === 'coreless' ? '无芯卫卷' : '有芯卫卷';
}

function midpackSourceLabel(sourcePresetName) {
  const name = String(sourcePresetName || '当前中包').trim() || '当前中包';
  return name.endsWith('中包') ? name : `${name}中包`;
}

// 根据闭箱后的最终 X/Z 尺寸判定箱长，再生成“装入规格－相对箱长姿态－X×Z×Y”。
// formalNameOverride 非空时仅覆盖显示文字，系统推导 code / systemFormalName 仍保留供审计。
export function deriveCartonNaming({
  productType,
  sourceType = 'midpack',
  sourceSnapshot = {},
  sourcePresetName = '',
  presetSnapshot = {},
  nameMap = CARTON_POSTURE_NAME_MAP,
} = {}) {
  if (!catalog[productType]) return null;
  const geometry = sourceType === 'product'
    ? directSourceGeometry(productType, sourceSnapshot, presetSnapshot)
    : midpackSourceGeometry(productType, sourceSnapshot, presetSnapshot);
  const rows = safeCount(presetSnapshot.rows);
  const cols = safeCount(presetSnapshot.cols);
  const layers = safeCount(presetSnapshot.layers);
  const spacing = safeDecimal(presetSnapshot.spacing);
  const margin = safeDecimal(presetSnapshot.margin, 0.05);
  const cartonSize = [
    rows * geometry.size[0] + Math.max(0, rows - 1) * spacing + margin * 2,
    layers * geometry.size[1] + Math.max(0, layers - 1) * spacing + margin * 2,
    cols * geometry.size[2] + Math.max(0, cols - 1) * spacing + margin * 2,
  ];
  const cartonLongAxis = resolveCartonLongAxis(cartonSize[0], cartonSize[2]);
  let code;
  if (sourceType === 'product' && productType === 'roll') {
    if (geometry.rollAxis === 'y') {
      // 立式装箱细分 ×2 面朝向：并列方向沿箱长 → ×2 面靠箱宽；沿箱宽 → ×2 面靠箱长。
      code = geometry.pairAxis
        ? (geometry.pairAxis === cartonLongAxis ? 'roll.vertical.pair-width' : 'roll.vertical.pair-length')
        : 'roll.vertical';
    } else {
      code = geometry.rollAxis === cartonLongAxis ? 'roll.axis-along' : 'roll.axis-cross';
    }
  } else {
    code = classifyRectangularBasis(geometry.basis, cartonLongAxis);
    // 直装软抽直立：开口刻线沿物理宽向（提手/开口轴），补刻线与箱长的关系，便于直读朝向。
    if (sourceType === 'product' && productType === 'softdraw' && geometry.orientation === 'upright'
      && (code === 'rect.end.width-along' || code === 'rect.end.thickness-along')) {
      code += code === 'rect.end.width-along' ? '.opening-along' : '.opening-cross';
    }
  }
  const postureName = cartonPostureName(code, nameMap);
  const sourceLabel = sourceType === 'product'
    ? directSourceLabel(productType, sourceSnapshot, geometry.bundleSpec)
    : midpackSourceLabel(sourcePresetName);
  const arrangement = `${rows}×${cols}×${layers}`;
  const systemFormalName = `${sourceLabel}－${postureName}－${arrangement}`;
  const override = String(presetSnapshot.formalNameOverride || '').trim();
  return {
    code,
    postureName,
    sourceLabel,
    arrangement,
    systemFormalName,
    formalName: override || systemFormalName,
    isOverridden: Boolean(override),
    cartonLongAxis,
    cartonLongDirection: cartonLongAxis === 'x' ? 'X 行方向' : 'Z 列方向',
    cartonSize,
  };
}
