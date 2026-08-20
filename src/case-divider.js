// ===== 装箱十字挡板业务口径 =====
// 挡板属于装箱方案，不属于产品/中包本体。奇数数量按“小数在负向侧、大数在正向侧”分区，
// 例如 5 行分为 2+3；挡板落在实际单元边界，并为瓦楞纸厚度让出空间。

export const CASE_DIVIDER_MODES = ['none', 'cross'];
export const CASE_DIVIDER_THICKNESS_MM = 4;

function normalizedCount(value) {
  return Math.max(1, Math.round(Number(value) || 1));
}

export function splitCompartmentCount(value) {
  const count = normalizedCount(value);
  const first = Math.floor(count / 2);
  const second = count - first;
  return {
    count,
    first,
    second,
    canSplit: count >= 2,
    label: `${first}+${second}`,
  };
}

export function normalizeCaseDividerMode(value) {
  return value === 'cross' ? 'cross' : 'none';
}

export function caseDividerRequirement(mode, rows, cols) {
  const x = splitCompartmentCount(rows);
  const z = splitCompartmentCount(cols);
  const normalizedMode = normalizeCaseDividerMode(mode);
  return {
    mode: normalizedMode,
    active: normalizedMode === 'cross',
    completeCross: normalizedMode === 'cross' && x.canSplit && z.canSplit,
    x,
    z,
    summary: `X 行方向 ${x.label}，Z 列方向 ${z.label}`,
  };
}

// 分隔线位于 floor(N/2) 与下一单元之间；偶数时为 0，奇数时自然偏向数量较少的一侧。
export function dividerBoundaryOffset(count, step) {
  const split = splitCompartmentCount(count);
  if (!split.canSplit) return 0;
  return (split.first - split.count / 2) * (Number(step) || 0);
}

// 在分区边界两侧各让出半块纸板厚度，保持每个分区内部紧密接触。
export function dividerUnitShift(index, count, thickness) {
  const split = splitCompartmentCount(count);
  if (!split.canSplit) return 0;
  const half = Math.max(0, Number(thickness) || 0) / 2;
  return Number(index) < split.first ? -half : half;
}
