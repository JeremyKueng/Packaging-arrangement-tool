import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  STAGE_NAMES,
  buildPdfEntries,
  buildMidpackPdfEntries,
  buildOuterPdfEntries,
  buildDefaultPdfDescription,
  groupPdfEntries,
  effectivePdfScope,
} from '../src/pdf-entry-core.js';

function mp(id, name, rows, cols, layers, orientation = 'flat', extra = {}) {
  return { id, name, builtIn: id.startsWith('builtin:'), overridden: false, rows, cols, layers, orientation, handleSide: 'z-', rollCore: 'cored', rollBundleMode: 'single', rollBundleX: 1, rollBundleZ: 1, rollBundleY: 1, ...extra };
}

function outer(id, name, source, extra = {}) {
  return {
    id, name, builtIn: false, legacy: !source, invalidSource: false, source,
    rows: 2, cols: 1, layers: 2, spacing: 0, margin: 0.05,
    loadFace: 'y+', unitPosture: 'flat', unitFacing: 'z-', stackMode: 'same',
    ...extra,
  };
}

function msrc(productType, presetId, presetName, snapshot) {
  return { type: 'midpack', productType, presetId, presetName, snapshot };
}
function psrc(productType, snapshot) {
  return { type: 'product', productType, presetId: null, presetName: null, snapshot };
}

test('单品类中包条目数量正确', () => {
  const midpackLists = {
    softdraw: [mp('builtin:0', 'A', 2, 3, 3), mp('builtin:1', 'B', 2, 4, 2), mp('custom:x', 'C', 1, 4, 1)],
  };
  const { entries } = buildPdfEntries({ stages: ['midpack'], productTypes: ['softdraw'] }, { midpack: midpackLists });
  assert.equal(entries.length, 3);
  assert.ok(entries.every(e => e.stage === 'midpack' && e.productType === 'softdraw'));
});

test('全品类条目顺序稳定（工段→品类→来源→名称）', () => {
  const midpackLists = {
    roll: [mp('builtin:0', '立-2×N×1', 2, 5, 1, 'upright')],
    handkerchief: [mp('builtin:0', '长型单层', 6, 1, 1)],
    softdraw: [mp('builtin:0', 'A', 2, 3, 3)],
  };
  const opts = { stages: ['midpack'], productTypes: ['handkerchief', 'softdraw', 'roll'] };
  const a = buildPdfEntries(opts, { midpack: midpackLists }).entries.map(e => `${e.stage}:${e.productType}:${e.id}`);
  const b = buildPdfEntries(opts, { midpack: midpackLists }).entries.map(e => `${e.stage}:${e.productType}:${e.id}`);
  assert.deepEqual(a, b);
  assert.deepEqual(a, ['midpack:handkerchief:midpack:builtin:0', 'midpack:softdraw:midpack:builtin:0', 'midpack:roll:midpack:builtin:0']);
});

test('大包和装箱按工段正确分类', () => {
  const outerLists = {
    bigpack: [outer('custom:b1', '大包1', msrc('softdraw', 'builtin:5', '18包', { rows: 2, cols: 3, layers: 3, orientation: 'flat', handleSide: 'z-', rollCore: 'cored', rollBundleMode: 'single', rollBundleX: 1, rollBundleZ: 1, rollBundleY: 1 }))],
    case: [outer('custom:c1', '装箱1', psrc('roll', { orientation: 'upright', rollCore: 'cored', rollBundleMode: 'single', rollBundleX: 1, rollBundleZ: 1, rollBundleY: 1 }))],
  };
  const { entries } = buildPdfEntries({ stages: ['bigpack', 'case'], productTypes: ['softdraw', 'roll'] }, { outer: outerLists });
  assert.equal(entries.length, 2);
  assert.equal(entries[0].stage, 'bigpack');
  assert.equal(entries[1].stage, 'case');
});

test('直装与经中包路径可区分', () => {
  const snap = { rows: 2, cols: 3, layers: 3, orientation: 'flat', handleSide: 'z-', rollCore: 'cored', rollBundleMode: 'single', rollBundleX: 1, rollBundleZ: 1, rollBundleY: 1 };
  const outerLists = {
    bigpack: [
      outer('custom:m', '经中包', msrc('softdraw', 'builtin:5', '18包', snap)),
      outer('custom:p', '直装', psrc('softdraw', { orientation: 'flat', rollCore: 'cored', rollBundleMode: 'single', rollBundleX: 1, rollBundleZ: 1, rollBundleY: 1 })),
    ],
  };
  const { entries } = buildPdfEntries({ stages: ['bigpack'], productTypes: ['softdraw'] }, { outer: outerLists });
  assert.equal(entries[0].sourceType, 'midpack');
  assert.equal(entries[1].sourceType, 'product');
  assert.match(entries[0].sourcePath, /→ 18包 → 大包/);
  assert.match(entries[1].sourcePath, /直装/);
});

test('临时方案被排除并计数', () => {
  const outerLists = { bigpack: [outer('temporary', '临时', null, { builtIn: true })] };
  const { entries, excluded } = buildPdfEntries({ stages: ['bigpack'], productTypes: ['softdraw'] }, { outer: outerLists });
  assert.equal(entries.length, 0);
  assert.equal(excluded.temporary, 1);
});

test('未绑定旧方案被排除并计数', () => {
  const outerLists = { case: [outer('custom:old', '旧方案', null, { legacy: true })] };
  const { entries, excluded } = buildPdfEntries({ stages: ['case'], productTypes: ['softdraw'] }, { outer: outerLists });
  assert.equal(entries.length, 0);
  assert.equal(excluded.legacyUnbound, 1);
});

test('来源快照与当前 UI 无关（构建后列表变化不影响已生成条目）', () => {
  const snap = { rows: 2, cols: 3, layers: 3, orientation: 'flat', handleSide: 'z-', rollCore: 'cored', rollBundleMode: 'single', rollBundleX: 1, rollBundleZ: 1, rollBundleY: 1 };
  const list = [outer('custom:m', '经中包', msrc('softdraw', 'builtin:5', '18包', snap))];
  const { entries } = buildPdfEntries({ stages: ['bigpack'], productTypes: ['softdraw'] }, { outer: { bigpack: list } });
  list[0].source.snapshot.rows = 999; // 模拟 UI 后续变化
  assert.equal(entries[0].sourceSnapshot.rows, 2); // 条目快照不受影响
});

test('非法快照不能进入条目（invalidSource 计数）', () => {
  const outerLists = { bigpack: [outer('custom:bad', '坏来源', null, { invalidSource: true })] };
  const { entries, excluded } = buildPdfEntries({ stages: ['bigpack'], productTypes: ['softdraw'] }, { outer: outerLists });
  assert.equal(entries.length, 0);
  assert.equal(excluded.invalidSource, 1);
});

test('相同名称、不同 ID 不会被误去重', () => {
  const midpackLists = { softdraw: [mp('custom:a', '同名', 2, 3, 3), mp('custom:b', '同名', 3, 2, 3)] };
  const { entries } = buildPdfEntries({ stages: ['midpack'], productTypes: ['softdraw'] }, { midpack: midpackLists });
  assert.equal(entries.length, 2);
  assert.notEqual(entries[0].presetId, entries[1].presetId);
});

test('构建过程不修改原始预设对象', () => {
  const snap = { rows: 2, cols: 3, layers: 3, orientation: 'flat', handleSide: 'z-', rollCore: 'cored', rollBundleMode: 'single', rollBundleX: 1, rollBundleZ: 1, rollBundleY: 1 };
  const midpackLists = { softdraw: [mp('builtin:0', 'A', 2, 3, 3)] };
  const outerLists = { bigpack: [outer('custom:m', 'B', msrc('softdraw', 'builtin:5', '18包', snap))] };
  const midBefore = JSON.stringify(midpackLists);
  const outerBefore = JSON.stringify(outerLists);
  buildPdfEntries({ stages: ['midpack', 'bigpack'], productTypes: ['softdraw'] }, { midpack: midpackLists, outer: outerLists });
  assert.equal(JSON.stringify(midpackLists), midBefore);
  assert.equal(JSON.stringify(outerLists), outerBefore);
});

test('exportOverride 是新对象，修改不污染原 PdfEntry / 预设', () => {
  const midpackLists = { softdraw: [mp('builtin:0', 'A', 2, 3, 3)] };
  const { entries } = buildPdfEntries({ stages: ['midpack'], productTypes: ['softdraw'] }, { midpack: midpackLists });
  const entry = entries[0];
  assert.ok(entry.exportOverride && typeof entry.exportOverride === 'object');
  // 修改导出编辑状态，不应影响条目快照或其他字段。
  entry.exportOverride.included = false;
  entry.exportOverride.displayName = '被编辑';
  assert.equal(entry.presetName, 'A');
  assert.equal(entry.presetSnapshot.rows, 2);
  // 重新构建应得到全新的 exportOverride（互不影响）。
  const again = buildPdfEntries({ stages: ['midpack'], productTypes: ['softdraw'] }, { midpack: midpackLists }).entries[0];
  assert.equal(again.exportOverride.included, true);
  assert.equal(again.exportOverride.displayName, 'A');
  assert.notEqual(again.exportOverride, entry.exportOverride);
});

test('PDF 默认说明不得泄露内部枚举', () => {
  const forbidden = ['flat', 'side', 'upright', 'horizontal', 'lying', 'z-', 'z+', 'x-', 'x+', 'y+', 'A端', 'B端', 'A侧', 'B侧', '姿态', '粒/卷', '装袋单位', '装袋组成', '装箱组成'];
  const snap = { rows: 2, cols: 3, layers: 3, orientation: 'flat', handleSide: 'z-', rollCore: 'cored', rollBundleMode: 'single', rollBundleX: 1, rollBundleZ: 1, rollBundleY: 1 };
  const midpackLists = {
    softdraw: [mp('builtin:0', '平2×3×3', 2, 3, 3)],
    handkerchief: [mp('builtin:0', '长型单层', 6, 1, 1)],
    roll: [mp('builtin:0', '立-2×N×1', 2, 5, 1, 'upright'), mp('builtin:1', '4卷膜包', 2, 3, 2, 'upright', { rollBundleMode: '4' })],
  };
  const outerLists = {
    bigpack: [
      outer('custom:m', '大包', msrc('softdraw', 'builtin:5', '18包-平2×3×3', snap)),
      outer('custom:p', '直装大包', psrc('softdraw', { orientation: 'upright', rollCore: 'cored', rollBundleMode: 'single', rollBundleX: 1, rollBundleZ: 1, rollBundleY: 1 })),
    ],
    case: [outer('custom:c', '装箱', msrc('softdraw', 'builtin:5', '18包-平2×3×3', snap))],
  };
  const { entries } = buildPdfEntries(
    { stages: ['midpack', 'bigpack', 'case'], productTypes: ['softdraw', 'handkerchief', 'roll'] },
    { midpack: midpackLists, outer: outerLists },
  );
  assert.ok(entries.length > 0);
  for (const entry of entries) {
    const text = buildDefaultPdfDescription(entry);
    for (const word of forbidden) {
      assert.equal(text.includes(word), false, `${entry.id} 描述包含内部字段 ${word}：${text}`);
    }
  }
});

test('中包描述快照（软抽）', () => {
  const entry = {
    stage: 'midpack', productType: 'softdraw',
    presetSnapshot: { rows: 2, cols: 3, layers: 3, orientation: 'flat', handleSide: 'z-', rollCore: 'cored', rollBundleMode: 'single', rollBundleX: 1, rollBundleZ: 1, rollBundleY: 1 },
    count: 18, foldedCount: 18,
  };
  assert.equal(buildDefaultPdfDescription(entry), [
    '中包排列：2排×3包/排×3层。',
    '产品摆放：软抽平放，抽取口朝上。',
    '装包数量：18包/中包。',
    '单包尺寸：180×108×56 mm。',
    '提手位置：位于中包长向端部。',
  ].join('\n'));
});

test('悬挂式底抽说明使用业务名称并明确上悬挂、下开口', () => {
  const entry = {
    stage:'midpack', productType:'softdraw',
    presetSnapshot:{rows:1,cols:4,layers:1,orientation:'side',handleSide:'z-',softdrawVariant:'hanging-bottom',hangingSideDirection:'cross',rollCore:'cored',rollBundleMode:'single'},
    count:4, foldedCount:4,
  };
  const description = buildDefaultPdfDescription(entry);
  assert.match(description,/悬挂式底抽/);
  assert.match(description,/柔性双孔提手位于包装上方/);
  assert.match(description,/产品高度按软抽本体计算/);
  assert.match(description,/抽取开口位于底面/);
  assert.match(description,/侧立时整包绕提手面法向旋转90°/);
  assert.match(description,/提手面向一致且呈十字方向/);
});

test('无芯卫卷说明包含压扁率与椭圆截面长短轴', () => {
  const entry = {
    stage:'midpack', productType:'roll',
    presetSnapshot:{rows:2,cols:5,layers:1,orientation:'horizontal',rollCore:'coreless',rollBundleMode:'single',dimensionsMm:{enabled:true,diameterMm:100,axialWidthMm:115,coreDiameterMm:40,flattenRatePct:20}},
    count:10, foldedCount:10,
  };
  const description = buildDefaultPdfDescription(entry);
  assert.match(description,/压扁率20%/);
  assert.match(description,/椭圆截面约125\.0×80\.0 mm/);
  assert.equal(description.includes('卷芯直径'),false);
});

test('大包描述快照（软抽经中包）', () => {
  const entry = {
    stage: 'bigpack', productType: 'softdraw', sourceType: 'midpack',
    sourcePresetName: '18包-平2×3×3',
    sourceSnapshot: { rows: 2, cols: 3, layers: 3, orientation: 'flat', handleSide: 'z-', rollCore: 'cored', rollBundleMode: 'single', rollBundleX: 1, rollBundleZ: 1, rollBundleY: 1 },
    presetSnapshot: { rows: 2, cols: 1, layers: 2, loadFace: 'y+', unitPosture: 'flat', unitFacing: 'z-' },
    count: 4, foldedCount: 72,
  };
  assert.equal(buildDefaultPdfDescription(entry), [
    '包装单元：18包-平2×3×3 中包。',
    '装袋排列：2排×1列×2层。',
    '中包摆放：平放，提手端朝袋体长向端部。',
    '装袋方向：由顶部装入。',
    '装袋数量：4中包/袋，折合72包软抽。',
    '单包尺寸：180×108×56 mm。',
  ].join('\n'));
});

test('装箱描述快照（软抽经中包，长向端部装入）', () => {
  const entry = {
    stage: 'case', productType: 'softdraw', sourceType: 'midpack',
    sourcePresetName: '18包-平2×3×3',
    sourceSnapshot: { rows: 2, cols: 3, layers: 3, orientation: 'flat', handleSide: 'z-', rollCore: 'cored', rollBundleMode: 'single', rollBundleX: 1, rollBundleZ: 1, rollBundleY: 1 },
    presetSnapshot: { rows: 2, cols: 1, layers: 1, loadFace: 'z-', unitPosture: 'flat', unitFacing: 'z-' },
    count: 2, foldedCount: 36,
  };
  assert.equal(buildDefaultPdfDescription(entry), [
    '装箱单元：18包-平2×3×3 中包。',
    '装箱排列：2排×1列×1层。',
    '装箱正式名称：18包-平2×3×3中包－顺箱长平放－2×1×1。',
    '中包摆放：顺箱长平放，提手端朝箱体长向端部。',
    '装箱方向：由箱体长向端部装入。',
    '装箱数量：2中包/箱，折合36包软抽。',
    '单包尺寸：180×108×56 mm。',
  ].join('\n'));
});

test('装箱正式名称支持方案级修订且 PDF 使用修订值', () => {
  const entry = {
    stage: 'case', productType: 'softdraw', sourceType: 'product',
    sourceSnapshot: { orientation: 'upright', rollCore: 'cored', rollBundleMode: 'single' },
    presetSnapshot: {
      rows: 2, cols: 2, layers: 1, spacing: 0, margin: 0.05, loadFace: 'y+',
      unitPosture: 'flat', unitFacing: 'z-', formalNameOverride: '客户指定正式名称',
    },
    count: 4, foldedCount: 4,
  };
  const description = buildDefaultPdfDescription(entry);
  assert.match(description, /装箱正式名称：客户指定正式名称。/);
  assert.match(description, /单包摆放：宽边顺箱长端立/);
});

test('装箱十字挡板进入快照与可搜索业务说明，奇数自动按 2+3 分区', () => {
  const source = msrc('softdraw', 'builtin:5', '18包-平2×3×3', {
    rows: 2, cols: 3, layers: 3, orientation: 'side', handleSide: 'z-',
    rollCore: 'cored', rollBundleMode: 'single', rollBundleX: 1, rollBundleZ: 1, rollBundleY: 1,
  });
  const lists = { case: [outer('custom:divider', '薄款软抽十字挡板箱', source, {
    rows: 5, cols: 3, layers: 1, dividerMode: 'cross', unitPosture: 'side', unitFacing: 'z-',
  })] };
  const { entries } = buildPdfEntries({ stages: ['case'], productTypes: ['softdraw'] }, { outer: lists });
  assert.equal(entries[0].presetSnapshot.dividerMode, 'cross');
  const description = buildDefaultPdfDescription(entries[0]);
  assert.match(description, /箱内固定：十字挡板/);
  assert.match(description, /X 行方向 2\+3，Z 列方向 1\+2/);
  assert.match(description, /奇数时较少数量位于左\/前侧/);
});

test('单位与提手规则：软抽含「包」、纸手帕无「提手」、卫卷含「卷」、膜包含「膜包」与「折合…卷」', () => {
  const midpackLists = {
    softdraw: [mp('builtin:0', '平2×3×3', 2, 3, 3)],
    handkerchief: [mp('builtin:0', '长型单层', 6, 1, 1)],
    roll: [mp('builtin:0', '立-2×N×1', 2, 5, 1, 'upright'), mp('builtin:1', '4卷膜包', 2, 3, 2, 'upright', { rollBundleMode: '4' })],
  };
  const { entries } = buildPdfEntries({ stages: ['midpack'], productTypes: ['softdraw', 'handkerchief', 'roll'] }, { midpack: midpackLists });
  const byProduct = Object.fromEntries(entries.map(e => [e.productType + ':' + (e.presetSnapshot.rollBundleMode || 'single'), e]));

  const soft = buildDefaultPdfDescription(byProduct['softdraw:single']);
  assert.match(soft, /包/);
  assert.match(soft, /18/);

  const hank = buildDefaultPdfDescription(byProduct['handkerchief:single']);
  assert.equal(hank.includes('提手'), false);

  const rollSingle = buildDefaultPdfDescription(byProduct['roll:single']);
  assert.match(rollSingle, /卷/);
  assert.match(rollSingle, /卷径100 mm，卷高115 mm，卷芯直径40 mm/);
  assert.equal(rollSingle.includes('轴向宽度'), false);

  const rollBundle = buildDefaultPdfDescription(byProduct['roll:4']);
  assert.match(rollBundle, /膜包/);
  assert.match(rollBundle, /折合48卷/);
});

test('外包装：大包用「装袋」、装箱用「装箱」、经中包含方案名、直装含「不经过中包」', () => {
  const snap = { rows: 2, cols: 3, layers: 3, orientation: 'flat', handleSide: 'z-', rollCore: 'cored', rollBundleMode: 'single', rollBundleX: 1, rollBundleZ: 1, rollBundleY: 1 };
  const outerLists = {
    bigpack: [
      outer('custom:m', '大包', msrc('softdraw', 'builtin:5', '18包-平2×3×3', snap)),
      outer('custom:p', '直装大包', psrc('softdraw', { orientation: 'upright', rollCore: 'cored', rollBundleMode: 'single', rollBundleX: 1, rollBundleZ: 1, rollBundleY: 1 })),
    ],
    case: [outer('custom:c', '装箱', msrc('softdraw', 'builtin:5', '18包-平2×3×3', snap))],
  };
  const { entries } = buildPdfEntries({ stages: ['bigpack', 'case'], productTypes: ['softdraw'] }, { outer: outerLists });

  const bigViaMid = buildDefaultPdfDescription(entries.find(e => e.stage === 'bigpack' && e.sourceType === 'midpack'));
  assert.match(bigViaMid, /装袋/);
  assert.match(bigViaMid, /18包-平2×3×3/);

  const bigDirect = buildDefaultPdfDescription(entries.find(e => e.stage === 'bigpack' && e.sourceType === 'product'));
  assert.match(bigDirect, /装袋/);
  assert.match(bigDirect, /不经过中包/);

  const caseEntry = buildDefaultPdfDescription(entries.find(e => e.stage === 'case'));
  assert.match(caseEntry, /装箱/);
  assert.match(caseEntry, /18包-平2×3×3/);
});

test('exportOverride.description 默认 null，清空后不回退默认说明', () => {
  const { entries } = buildPdfEntries({ stages: ['midpack'], productTypes: ['softdraw'] }, { midpack: { softdraw: [mp('builtin:0', 'A', 2, 3, 3)] } });
  const entry = entries[0];
  // 未覆盖：null，回退到默认说明。
  assert.equal(entry.exportOverride.description, null);
  assert.equal(entry.exportOverride.description ?? entry.description, entry.description);
  // 明确清空：'' 不再回退，允许不输出说明。
  entry.exportOverride.description = '';
  assert.equal(entry.exportOverride.description ?? entry.description, '');
});

test('groupPdfEntries：过滤未包含条目，按 order 排序', () => {
  const a = { stage: 'midpack', productType: 'softdraw', productName: '软抽', stageName: '中包工段', sourceType: 'product', exportOverride: { included: true, order: 2 } };
  const b = { stage: 'midpack', productType: 'softdraw', productName: '软抽', stageName: '中包工段', sourceType: 'product', exportOverride: { included: true, order: 0 } };
  const c = { stage: 'midpack', productType: 'softdraw', productName: '软抽', stageName: '中包工段', sourceType: 'product', exportOverride: { included: false, order: 1 } };
  const groups = groupPdfEntries([a, b, c]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].entries.length, 2);
  assert.equal(groups[0].entries[0], b); // order 0 在前
  assert.equal(groups[0].entries[1], a);
});

test('groupPdfEntries：跨工段、跨品类分组，每组从新组开始', () => {
  const mk = (stage, productType, order) => ({ stage, productType, productName: productType, stageName: STAGE_NAMES[stage], sourceType: 'product', exportOverride: { included: true, order } });
  const groups = groupPdfEntries([
    mk('midpack', 'softdraw', 0),
    mk('midpack', 'softdraw', 1),
    mk('midpack', 'roll', 2),
    mk('bigpack', 'softdraw', 3),
  ]);
  assert.equal(groups.length, 3);
  assert.equal(groups[0].key, 'midpack:softdraw:product:product');
  assert.equal(groups[1].key, 'midpack:roll:product:product');
  assert.equal(groups[2].key, 'bigpack:softdraw:product:product');
});

test('groupPdfEntries：来源路径（经中包/直装）拆成不同小节', () => {
  const mk = (stage, sourceType, order, name, sourcePresetId) => ({
    stage, productType: 'softdraw', productName: '软抽', stageName: STAGE_NAMES[stage], sourceType,
    sourcePresetId: sourcePresetId || null, sourcePresetName: name, presetName: name, exportOverride: { included: true, order },
  });
  const groups = groupPdfEntries([
    mk('case', 'midpack', 0, '18包-平2×3×3', 'builtin:5'),
    mk('case', 'product', 1, '直装装箱'),
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].key, 'case:softdraw:midpack:builtin:5');
  assert.equal(groups[1].key, 'case:softdraw:product:product');
});

test('groupPdfEntries：不同中包来源拆成两个 group', () => {
  const mk = (sourcePresetId, sourcePresetName, order, name) => ({
    stage: 'bigpack', productType: 'softdraw', productName: '软抽', stageName: '大包工段',
    sourceType: 'midpack', sourcePresetId, sourcePresetName, sourcePath: `软抽单粒 → ${sourcePresetName} → 大包`,
    presetName: name, exportOverride: { included: true, order },
  });
  const groups = groupPdfEntries([
    mk('builtin:5', '18包-平2×3×3', 0, '大包A'),
    mk('builtin:7', '24包-平2×4×3', 1, '大包B'),
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].key, 'bigpack:softdraw:midpack:builtin:5');
  assert.equal(groups[1].key, 'bigpack:softdraw:midpack:builtin:7');
  assert.equal(groups[0].sourcePresetName, '18包-平2×3×3');
  assert.equal(groups[1].sourcePresetName, '24包-平2×4×3');
});

test('groupPdfEntries：跨分区调整 order 不会拆出重复工段/品类分区', () => {
  const mk = (stage, productType, order, name) => ({
    stage, productType, productName: productType, stageName: STAGE_NAMES[stage], sourceType: 'product',
    presetName: name, exportOverride: { included: true, order },
  });
  const entries = [
    mk('midpack', 'softdraw', 0, '软抽-A'),
    mk('midpack', 'roll', 1, '卫卷-A'),
    mk('midpack', 'softdraw', 2, '软抽-B'),
    mk('case', 'softdraw', 3, '装箱-A'),
  ];
  const groups = groupPdfEntries(entries);
  assert.deepEqual(groups.map(group => group.key), ['midpack:softdraw:product:product', 'midpack:roll:product:product', 'case:softdraw:product:product']);
  assert.deepEqual(groups[0].entries.map(entry => entry.presetName), ['软抽-A', '软抽-B']);
});

test('effectivePdfScope：从最终 included 条目推导范围，取消品类/工段后不再出现', () => {
  const mk = (stage, productType, included) => ({ stage, productType, exportOverride: { included } });
  // 选三个品类，但取消全部卫卷条目。
  const scope = effectivePdfScope([
    mk('midpack', 'softdraw', true),
    mk('midpack', 'handkerchief', true),
    mk('midpack', 'roll', false),
    mk('bigpack', 'softdraw', true),
  ]);
  assert.deepEqual(scope.stages, ['midpack', 'bigpack']);
  assert.deepEqual(scope.productTypes, ['handkerchief', 'softdraw']); // 不含 roll
});

test('effectivePdfScope：取消某工段全部条目后该工段消失', () => {
  const mk = (stage, productType, included) => ({ stage, productType, exportOverride: { included } });
  const scope = effectivePdfScope([
    mk('midpack', 'softdraw', true),
    mk('bigpack', 'softdraw', false), // 取消大包全部条目
    mk('case', 'softdraw', false),
  ]);
  assert.deepEqual(scope.stages, ['midpack']);
  assert.deepEqual(scope.productTypes, ['softdraw']);
});
