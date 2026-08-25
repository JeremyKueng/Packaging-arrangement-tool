# 优化实施路线图

**目标**：在2周内完成核心优化，提升系统性能和稳定性  
**风险等级**：🟢 低风险 | 🟡 中风险 | 🔴 高风险

---

## 第一周：稳定性与用户体验

### Day 1-2：localStorage安全封装 🟢

**目标**：防止用户数据丢失，提升存储可靠性

#### 任务清单
- [x] 创建 `src/storage-helper.js`
- [ ] 实现 `safeStorageSet` 和 `safeStorageGet`
- [ ] 添加自动清理机制
- [ ] 集成到所有预设保存点
- [ ] 添加存储统计面板（开发者工具）

#### 修改文件
```
src/storage-helper.js         [新建，参考 OPTIMIZATION_EXAMPLES.md]
index.html                     [修改保存逻辑]
src/preset-core.js             [使用新API]
src/pallet-preset-core.js      [使用新API]
```

#### 测试要点
```javascript
// 1. 模拟配额超限
test('配额超限时自动清理旧数据', () => {
  // 填满localStorage
  for (let i = 0; i < 100; i++) {
    safeStorageSet(`test-${i}`, { data: 'x'.repeat(50000) });
  }
  
  // 应该能继续保存
  const result = safeStorageSet('important', { value: 123 });
  assert.ok(result.ok);
});

// 2. 大型托盘方案压缩
test('超过500个placement的方案自动压缩', () => {
  const preset = {
    placementList: Array(1000).fill({ xMm: 0, yMm: 0, zMm: 0 })
  };
  
  const result = safeStorageSet('pallet-large', preset, { compress: true });
  assert.ok(result.ok);
  assert.ok(result.compressed);
  
  const retrieved = safeStorageGet('pallet-large');
  assert.equal(retrieved.placementList.length, 500);
  assert.equal(retrieved._originalPlacementCount, 1000);
});
```

#### 验收标准
- ✅ 配额超限时不崩溃，显示友好提示
- ✅ 自动压缩大型方案，节省空间
- ✅ 提供导出功能，避免数据丢失
- ✅ 存储使用率>90%时显示警告

---

### Day 3：WebGL降级方案 🟢

**目标**：提升移动端和旧设备兼容性

#### 任务清单
- [ ] 添加WebGL能力检测
- [ ] 设计降级UI（纯参数表格 + PDF导出引导）
- [ ] 添加"系统要求"提示
- [ ] 测试iOS Safari、Android Chrome

#### 实现要点

```javascript
// 在index.html的scene初始化前添加
function checkWebGLSupport() {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
  
  if (!gl) {
    return { supported: false, reason: 'WebGL不可用' };
  }
  
  // 检查必需的扩展
  const requiredExtensions = [
    'OES_element_index_uint',
    'OES_standard_derivatives'
  ];
  
  for (const ext of requiredExtensions) {
    if (!gl.getExtension(ext)) {
      return { 
        supported: false, 
        reason: `缺少必需的WebGL扩展: ${ext}` 
      };
    }
  }
  
  return { supported: true };
}

function initViewer() {
  const support = checkWebGLSupport();
  
  if (!support.supported) {
    console.warn('[Viewer] WebGL check failed:', support.reason);
    showFallbackUI();
    return null;
  }
  
  try {
    const renderer = new THREE.WebGLRenderer({ 
      canvas: document.getElementById('canvas'),
      antialias: true 
    });
    
    // 测试渲染
    const testScene = new THREE.Scene();
    const testCamera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
    renderer.render(testScene, testCamera);
    
    return renderer;
    
  } catch (error) {
    console.error('[Viewer] Renderer init failed:', error);
    showFallbackUI();
    return null;
  }
}
```

#### 降级UI设计

```html
<div id="fallback-ui" style="display: none;">
  <div class="notice-card">
    <h3>⚠️ 3D视图不可用</h3>
    <p>您的浏览器不支持WebGL 3D渲染。</p>
    
    <div class="fallback-options">
      <div class="option">
        <h4>📊 查看参数表</h4>
        <p>直接编辑和查看排列参数（行×列×层）</p>
        <button onclick="showParamTable()">打开参数表</button>
      </div>
      
      <div class="option">
        <h4>📄 导出PDF</h4>
        <p>生成包含排列说明的PDF文档</p>
        <button onclick="openPdfExport()">导出PDF</button>
      </div>
      
      <div class="option">
        <h4>💻 升级浏览器</h4>
        <p>推荐使用以下浏览器最新版：</p>
        <ul>
          <li>Chrome / Edge (推荐)</li>
          <li>Firefox</li>
          <li>Safari 15+</li>
        </ul>
      </div>
    </div>
  </div>
</div>
```

#### 验收标准
- ✅ 在不支持WebGL的环境下不崩溃
- ✅ 显示友好的降级UI
- ✅ 参数编辑和PDF导出功能正常可用
- ✅ 提示用户升级浏览器

---

### Day 4-5：托盘优化缓存 🟢

**目标**：减少60%重复计算，提升响应速度

#### 任务清单
- [x] 创建 `src/pallet-cache.js`
- [ ] 实现LRU缓存
- [ ] 集成到 `pallet-core.js`
- [ ] 添加缓存统计面板
- [ ] 性能测试对比

#### 集成步骤

**Step 1**: 重命名原函数为内部版本

```javascript
// src/pallet-core.js

// 1. 重命名原函数
export function _layerOptionsInternal(options, layerIndex, posture = 'normal') {
  // ... 保持原有实现不变
}

export function _optimizePalletLayoutInternal(rawOptions = {}) {
  // ... 保持原有实现不变
}
```

**Step 2**: 导入缓存层

```javascript
// src/pallet-core.js 顶部
import { 
  layerOptionsWithCache, 
  optimizeWithCache,
  clearPalletCache,
  getCacheStats
} from './pallet-cache.js';

// 导出带缓存的版本
export function layerOptions(options, layerIndex, posture) {
  return layerOptionsWithCache(options, layerIndex, posture);
}

export function optimizePalletLayout(rawOptions) {
  return optimizeWithCache(rawOptions);
}

// 导出缓存控制函数
export { clearPalletCache, getCacheStats };
```

**Step 3**: 在UI中添加缓存控制

```javascript
// 添加到开发者工具
window.VIDA_DEV = {
  cacheStats: () => {
    const stats = getCacheStats();
    console.table(stats);
    return stats;
  },
  clearCache: () => {
    clearPalletCache();
    console.log('[Cache] Cleared all pallet caches');
  }
};

// 在参数大幅变化时自动清理
function onUnitSizeChange(newSize) {
  if (hasSignificantChange(lastSize, newSize)) {
    clearPalletCache();
  }
  updatePalletLayout();
}
```

#### 性能测试脚本

```javascript
// tests/pallet-performance.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { optimizePalletLayout, clearPalletCache } from '../src/pallet-core.js';

test('缓存提升性能测试', () => {
  clearPalletCache();
  
  const options = {
    unitSizeMm: { lengthMm: 350, widthMm: 420, heightMm: 280 },
    loadHeightMm: 1800,
    packageType: 'case',
    layerStrategy: 'cyclic-interlock'
  };
  
  // 第一次：冷启动
  const start1 = performance.now();
  const result1 = optimizePalletLayout(options);
  const time1 = performance.now() - start1;
  
  // 第二次：命中缓存
  const start2 = performance.now();
  const result2 = optimizePalletLayout(options);
  const time2 = performance.now() - start2;
  
  console.log(`Cold: ${time1.toFixed(0)}ms, Cached: ${time2.toFixed(0)}ms, Speedup: ${(time1/time2).toFixed(1)}x`);
  
  assert.ok(result1.ok && result2.ok);
  assert.equal(result1.totalCount, result2.totalCount);
  assert.ok(time2 < time1 * 0.4, '缓存应提升至少60%性能');
});
```

#### 验收标准
- ✅ 相同参数第二次优化快60%以上
- ✅ 缓存不影响结果正确性
- ✅ LRU策略防止内存无限增长
- ✅ 开发者工具可查看缓存统计

---

## 第二周：性能优化与代码质量

### Day 6-7：早期剪枝优化 🟡

**目标**：降低复杂场景下的计算复杂度

#### 任务清单
- [ ] 添加全局最优追踪
- [ ] 实现分支剪枝逻辑
- [ ] 预计算理论上限
- [ ] 性能对比测试

#### 关键代码（参考OPTIMIZATION_EXAMPLES.md第2节）

```javascript
// 在optimizePalletLayout中添加
const theoreticalMaxPerLayer = Math.floor(
  (options.pallet.lengthMm * options.pallet.widthMm) /
  (options.unitSizeMm.lengthMm * options.unitSizeMm.widthMm)
);

let globalBestCount = 0;

for (let layerIndex = 0; layerIndex < maxLayers; layerIndex++) {
  const remainingLayers = maxLayers - layerIndex;
  const maxPossibleIncrease = remainingLayers * theoreticalMaxPerLayer;
  
  for (const state of states) {
    // 剪枝：即使后续全满也追不上最优解
    if (state.count + maxPossibleIncrease < globalBestCount * 0.95) {
      continue;
    }
    // ...
  }
}
```

#### 测试用例

```javascript
test('复杂场景剪枝效果测试', () => {
  const complexOptions = {
    unitSizeMm: { lengthMm: 280, widthMm: 350, heightMm: 180 },
    loadHeightMm: 2200,  // 高托盘
    layerStrategy: 'cyclic-interlock',
    basePattern: ['A', 'A', 'B'],
    faceConstraint: { enabled: true, layout: 'edge-exposure' }
  };
  
  const start = performance.now();
  const result = optimizePalletLayout(complexOptions);
  const elapsed = performance.now() - start;
  
  console.log(`Complex scenario: ${elapsed.toFixed(0)}ms, ${result.totalCount} items, ${result.layerCount} layers`);
  
  assert.ok(result.ok);
  assert.ok(elapsed < 2000, '复杂场景应在2秒内完成');
  assert.ok(result.layerCount >= 10, '高托盘应有多层');
});
```

#### 验收标准
- ✅ 复杂场景（12+层）性能提升30%以上
- ✅ 结果件数不低于剪枝前
- ✅ 所有现有测试通过

---

### Day 8：性能监控集成 🟢

**目标**：建立长期性能跟踪机制

#### 任务清单
- [x] 创建 `src/performance-monitor.js`
- [ ] 集成到关键路径
- [ ] 添加开发者面板
- [ ] 设置性能告警阈值

#### 集成点

```javascript
// 1. 托盘优化
export function optimizePalletLayout(rawOptions = {}) {
  const start = performance.now();
  const result = _optimizePalletLayoutInternal(rawOptions);
  const duration = performance.now() - start;
  
  perfMonitor.recordPalletOptimization(duration, {
    unitSize: rawOptions.unitSizeMm,
    itemCount: result.totalCount,
    layerCount: result.layerCount,
    fromCache: result.fromCache
  });
  
  return result;
}

// 2. PDF生成
function generatePDF(entries) {
  const start = performance.now();
  // ... PDF生成逻辑
  const duration = performance.now() - start;
  
  perfMonitor.recordPdfGeneration(duration, entries.length);
}

// 3. 添加到UI
document.getElementById('dev-perf-btn').addEventListener('click', () => {
  const report = perfMonitor.getReport();
  showPerformanceModal(report);
});
```

#### 性能面板UI

```html
<div id="perf-modal" class="modal">
  <h3>性能统计</h3>
  
  <table class="perf-table">
    <thead>
      <tr>
        <th>指标</th>
        <th>平均值</th>
        <th>P95</th>
        <th>最大值</th>
        <th>样本数</th>
      </tr>
    </thead>
    <tbody id="perf-data">
      <!-- 动态填充 -->
    </tbody>
  </table>
  
  <div class="perf-actions">
    <button onclick="perfMonitor.exportReport()">导出报告</button>
    <button onclick="location.reload()">重置会话</button>
  </div>
</div>
```

#### 验收标准
- ✅ 关键操作自动记录性能数据
- ✅ P95耗时超过阈值时控制台警告
- ✅ 可导出性能报告供分析
- ✅ 缓存命中率可见

---

### Day 9-10：代码重构与文档更新 🟡

**目标**：提升代码可维护性

#### 任务清单
- [ ] 拆分 `pdf-entry-core.js` (521行 → 3个文件)
- [ ] 重构 `dimsFor` 函数参数
- [ ] 更新所有调用点
- [ ] 补充JSDoc注释
- [ ] 更新README

#### pdf-entry-core.js 拆分方案

```
src/pdf/
├── entry-builder.js       # buildPdfEntries, buildMidpackPdfEntries, etc.
├── entry-formatter.js     # buildDefaultPdfDescription, 业务词典
├── entry-grouping.js      # groupPdfEntries, effectivePdfScope
└── index.js               # 统一导出接口
```

#### dimsFor 重构

**Before**:
```javascript
dimsFor(type, orientation, handleSide, bundleSpec, dimensionOverride, rollCore, softdrawVariant, hangingSideDirection)
```

**After**:
```javascript
dimsFor(type, config)

// 调用示例
const dims = dimsFor('softdraw', {
  orientation: 'side',
  handleSide: 'z-',
  softdrawVariant: 'hanging-bottom',
  hangingSideDirection: 'cross',
  dimensionOverride: { enabled: true, lengthMm: 180 }
});
```

#### 验收标准
- ✅ 单文件不超过300行
- ✅ 所有测试通过
- ✅ 向后兼容（旧调用方式降级支持）
- ✅ JSDoc覆盖所有公共API

---

## 回归测试计划

### 自动化测试
```bash
npm test                    # 121个单元测试必须全部通过
npm run test:performance    # 性能基准测试
```

### 手工测试清单

#### 基础功能
- [ ] 纸手帕中包排列显示正确
- [ ] 软抽中包排列显示正确（平放、侧立）
- [ ] 悬挂式底抽侧立十字显示正确
- [ ] 卫卷中包排列显示正确（立、横、卧）
- [ ] 无芯卫卷压扁显示正确
- [ ] 4/6卷膜包组合正确

#### 外包装功能
- [ ] 大包排列显示正确
- [ ] 装箱排列显示正确
- [ ] 直装单粒显示正确
- [ ] 十字挡板显示正确
- [ ] 装箱正式名称生成正确

#### 托盘功能
- [ ] 基础托盘优化正常
- [ ] 单边展示约束生效
- [ ] A/B旋转正确
- [ ] 循环错层正确
- [ ] 软包护角生效
- [ ] 顶层侧倒显示正确
- [ ] 得板率/利用率计算正确

#### PDF导出
- [ ] 中包PDF导出正常
- [ ] 大包PDF导出正常
- [ ] 装箱PDF导出正常
- [ ] 托盘PDF导出正常
- [ ] 业务说明无内部字段泄露

#### 预设管理
- [ ] 预设保存成功
- [ ] 预设读取正常
- [ ] 预设导入/导出正常
- [ ] 预设合并冲突处理正确
- [ ] localStorage配额处理正常

#### 性能测试
- [ ] 标准托盘优化<1秒
- [ ] 复杂托盘优化<2秒
- [ ] 缓存第二次提升60%+
- [ ] PDF生成100条目<3秒
- [ ] 3D渲染流畅（60fps）

---

## 风险管理

### 高风险点

1. **托盘优化算法改动**
   - 风险：可能影响结果准确性
   - 缓解：保留原算法，新旧对比测试
   - 回滚：使用feature flag控制

2. **storage-helper集成**
   - 风险：数据迁移失败导致预设丢失
   - 缓解：先实现自动导出备份
   - 回滚：保留旧API，逐步迁移

3. **代码重构**
   - 风险：引入新bug
   - 缓解：充分的单元测试和回归测试
   - 回滚：Git分支隔离，可快速恢复

### 质量门禁

**每日检查**：
- 所有单元测试通过
- ESLint无错误
- 控制台无新增错误

**上线前检查**：
- 手工测试清单100%完成
- 性能基准测试通过
- 代码审阅完成
- 用户文档更新

---

## 上线计划

### 灰度发布策略

**Week 1 结束**: 内部测试版
- 仅测试环境启用
- 开发团队试用
- 收集性能数据

**Week 2 结束**: Beta版
- 10%用户灰度
- 监控错误率和性能
- 快速响应问题

**Week 3**: 全量发布
- 100%用户
- 持续监控1周
- 准备hotfix流程

### 监控指标

**关键指标**:
- 页面加载时间 (目标: <3s)
- 托盘优化P95 (目标: <1.5s)
- 缓存命中率 (目标: >40%)
- 错误率 (目标: <0.5%)
- localStorage失败率 (目标: <1%)

**告警规则**:
- 托盘优化P95 >3s
- 错误率 >1%
- localStorage失败率 >5%

---

## 团队分工建议

**前端开发 A** (4天):
- Day 1-2: localStorage安全封装
- Day 3: WebGL降级方案
- Day 4: UI集成和测试

**前端开发 B** (4天):
- Day 4-5: 托盘优化缓存
- Day 6-7: 早期剪枝优化
- Day 8: 性能监控集成

**前端开发 C** (2天):
- Day 9-10: 代码重构

**测试工程师** (持续):
- 编写自动化测试
- 执行回归测试
- 性能基准测试

**项目经理** (持续):
- 跟踪进度
- 风险管理
- 发布协调

---

## 成功标准

### 定量指标
- ✅ 托盘优化平均速度提升50%
- ✅ 缓存命中率达到40%
- ✅ localStorage错误率降至0
- ✅ 代码覆盖率保持>90%
- ✅ 所有性能测试通过

### 定性指标
- ✅ 用户反馈无"卡顿"投诉
- ✅ 移动端可正常使用
- ✅ 无数据丢失事故
- ✅ 代码可读性提升
- ✅ 团队认可新架构

---

**文档版本**: v1.0  
**最后更新**: 2026-08-24  
**负责人**: 开发团队
