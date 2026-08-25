import { performance } from 'node:perf_hooks';
import {
  clearPalletLayoutCache,
  optimizePalletLayout,
  PALLET_ALGORITHM_VERSION,
} from '../src/pallet-core.js';

const RUNS = 30;
const scenarios = [
  {
    name: '常规软包 400×165×300',
    options: {
      packageType: 'softpack',
      unitSizeMm: { lengthMm: 400, widthMm: 165, heightMm: 300 },
      loadHeightMm: 1640,
      faceConstraint: { enabled: false },
      allowTopSideLay: false,
    },
  },
  {
    name: '单边长侧面约束',
    options: {
      packageType: 'softpack',
      unitSizeMm: { lengthMm: 400, widthMm: 165, heightMm: 300 },
      loadHeightMm: 1640,
      faceConstraint: { enabled: true, face: 'long', layout: 'edge-exposure' },
      allowTopSideLay: false,
    },
  },
  {
    name: '允许顶层 H 面向下',
    options: {
      packageType: 'softpack',
      unitSizeMm: { lengthMm: 400, widthMm: 165, heightMm: 300 },
      loadHeightMm: 1390,
      faceConstraint: { enabled: true, face: 'long', layout: 'edge-exposure' },
      allowTopSideLay: true,
      cornerProtectors: { enabled: true, lossLengthMm: 0, lossWidthMm: 5 },
    },
  },
];

function percentile(sorted, ratio) {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

const rows = scenarios.map(({ name, options }) => {
  const elapsed = [];
  let candidates = 0;
  let pruned = 0;
  let totalCount = 0;
  for (let run = 0; run < RUNS; run++) {
    // 每次清缓存，测量真实冷启动；缓存命中另作单独校验。
    clearPalletLayoutCache();
    const startedAt = performance.now();
    const plan = optimizePalletLayout(options);
    elapsed.push(performance.now() - startedAt);
    if (!plan.ok) throw new Error(`${name} 未找到可行解：${plan.reason || 'unknown'}`);
    candidates = plan.debug?.candidateCount || 0;
    pruned = plan.debug?.prunedCount || 0;
    totalCount = plan.totalCount;
  }
  const sorted = elapsed.sort((a, b) => a - b);

  clearPalletLayoutCache();
  optimizePalletLayout(options);
  const cached = optimizePalletLayout(options);
  if (!cached.debug?.cacheHit) throw new Error(`${name} 的第二次调用没有命中 LRU 缓存`);

  return {
    场景: name,
    算法版本: PALLET_ALGORITHM_VERSION,
    件数: totalCount,
    候选数: candidates,
    剪枝数: pruned,
    '冷启动中位数(ms)': Number(percentile(sorted, 0.5).toFixed(3)),
    '冷启动P95(ms)': Number(percentile(sorted, 0.95).toFixed(3)),
    '冷启动最大值(ms)': Number(sorted.at(-1).toFixed(3)),
    '缓存命中耗时(ms)': Number((cached.debug?.elapsedMs || 0).toFixed(3)),
  };
});

console.log(`托盘优化基准：${RUNS} 次冷启动/场景`);
console.table(rows);
