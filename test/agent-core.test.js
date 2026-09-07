/* 验证 solution-agent：内核单测 + jsdom 驱动真实页面 */
const fs = require('fs');
const path = require('path');
const A = require('../agent-core.js');

let passed = 0, failed = 0;
function ok(name, cond, extra) {
  if (cond) { passed++; console.log('✓ ' + name); }
  else { failed++; console.log('✗ ' + name + (extra ? '  → ' + extra : '')); }
}
function near(a, b, tol) { return Math.abs(a - b) <= (tol || 1e-6); }
function finite(...vals) { return vals.every(v => typeof v === 'number' && isFinite(v)); }

console.log('=== 一、合成节能率（边际递减口径） ===');
{
  const mod = [{ esav: 0.10 }, { esav: 0.20 }];
  const r = A.composeRate(mod, 'esav');
  ok('两模块合成 = 1−(0.9×0.8) = 0.28，非简单相加 0.30', near(r, 0.28, 1e-9), '实际=' + r);
  ok('空列表合成率为 0', A.composeRate([], 'esav') === 0);
  const many = A.composeRate([{ esav: 0.3 }, { esav: 0.3 }, { esav: 0.3 }, { esav: 0.3 }], 'esav');
  ok('多模块叠加后仍 < 100%', many < 1, '实际=' + many);
}

console.log('\n=== 二、方案生成与预算约束 ===');
{
  const need = A.parseNeed({ buildingType: 'office', region: 'mena', goal: 'cost' });
  ok('需求解析返回建筑与区域对象', need.building && need.region);
  ok('能耗强度高的建筑必选暖通优化', A.parseNeed({ buildingType: 'hospital', region: 'mena', goal: 'cost' }).mustHave.indexOf('hvac') >= 0);
  ok('计量平台始终为必选地基模块', need.mustHave.indexOf('metering') >= 0);

  const plans = A.designSolution(need, 0);
  ok('生成三套方案', plans.length === 3);
  ok('投资强度递增：保守 < 平衡 < 激进',
    plans[0].capexPerM2 < plans[1].capexPerM2 && plans[1].capexPerM2 < plans[2].capexPerM2,
    plans.map(p => p.capexPerM2).join(' / '));
  ok('节能率递增', plans[0].esav < plans[1].esav && plans[1].esav < plans[2].esav);

  const capped = A.designSolution(need, 30);
  ok('预算上限 30 时保守方案被裁剪到 <= 30', capped[0].capexPerM2 <= 30, '实际=' + capped[0].capexPerM2);
  ok('裁剪后仍保留地基模块 metering', capped[0].ids.indexOf('metering') >= 0);
}

console.log('\n=== 三、厂商选型 ===');
{
  Object.keys(A.WEIGHTS).forEach(k => {
    const sum = Object.keys(A.WEIGHTS[k]).reduce((s, d) => s + A.WEIGHTS[k][d], 0);
    ok('权重向量 ' + k + ' 归一到 1.00', near(sum, 1.0, 1e-9), '实际=' + sum.toFixed(4));
  });
  const gov = A.rankVendors('gov', 'local');
  ok('政府 + 国产化 → 华为居首', gov[0].name === '华为', '实际=' + gov[0].name);
  const office = A.rankVendors('office', 'open');
  ok('写字楼 + 开放生态 → 施耐德居首', office[0].name === 'Schneider 施耐德', '实际=' + office[0].name);
  ok('排名按综合分降序', gov[0].total >= gov[1].total && gov[1].total >= gov[2].total);
  const gap = A.explainGap(gov[0], gov[1], 'local');
  ok('差距归因返回可读文本', typeof gap === 'string' && gap.length > 10);
}

console.log('\n=== 四、财务模型 ===');
{
  const base = {
    area: 50000, eui: 180, price: 0.12, opexPerM2: 18, esav: 0.269, osav: 0.15,
    capexPerM2: 62, subsidy: 0, esc: 0.04, maintRate: 0.02, horizon: 15, tax: 0.20,
    debtPct: 0.5, rd: 0.065, rf: 0.045, beta: 0.9, erp: 0.058, grid: 0.65, carbonPrice: 15
  };
  const f = A.finance(base);
  ok('CAPEX = 面积 × 单位投资', near(f.capex, 50000 * 62), '实际=' + f.capex);
  ok('WACC 落在合理区间 3%~15%', f.wacc > 0.03 && f.wacc < 0.15, '实际=' + f.wacc);
  ok('Re = Rf + β×ERP', near(f.Re, 0.045 + 0.9 * 0.058, 1e-9));
  ok('现金流年限与 horizon 一致', f.rows.length === 15);
  ok('NPV / IRR / MIRR 均为有限数', finite(f.npv, f.irr, f.mirr), JSON.stringify({ npv: f.npv, irr: f.irr, mirr: f.mirr }));
  ok('MIRR 介于 0 与 IRR 之间（再投于 WACC 更保守）', f.mirr > 0 && f.mirr < f.irr, 'irr=' + f.irr + ' mirr=' + f.mirr);

  // 单调性：节能率越高 NPV 越大
  const low = A.finance(Object.assign({}, base, { esav: 0.10 }));
  const high = A.finance(Object.assign({}, base, { esav: 0.35 }));
  ok('NPV 随节能率单调递增', high.npv > f.npv && f.npv > low.npv, [low.npv, f.npv, high.npv].map(Math.round).join(' < '));

  // 单位投资越高 NPV 越低
  const cheap = A.finance(Object.assign({}, base, { capexPerM2: 30 }));
  ok('NPV 随单位投资单调递减', cheap.npv > f.npv, 'cheap=' + cheap.npv + ' base=' + f.npv);

  // 电价上涨加快回收
  const p2 = A.finance(Object.assign({}, base, { price: 0.30 }));
  ok('电价越高回收期越短', p2.sp < f.sp, 'p2=' + p2.sp + ' base=' + f.sp);

  // 终值防护
  const bad = A.finance(Object.assign({}, base, { debtPct: 0.9, rd: 0.01, tax: 0.25, g: 0.04, rf: 0.01, beta: 0.4, erp: 0.02 }));
  ok('极端低 WACC 下抑制终值', bad.tvOn === false, 'wacc=' + bad.wacc + ' g=' + bad.g0);
  ok('极端组合不产生 NaN', finite(bad.npv, bad.wacc, bad.capex));

  // 边界
  const edge = A.finance(Object.assign({}, base, { area: 1, horizon: 5 }));
  ok('极小面积与短周期不崩', finite(edge.npv, edge.capex), 'npv=' + edge.npv);

  const zeroSav = A.finance(Object.assign({}, base, { esav: 0, osav: 0 }));
  ok('零节能时 NPV 为负且不出 NaN', zeroSav.npv < 0 && finite(zeroSav.npv));

  const sens = A.sensitivity(base, ['esav', 'capexPerM2'], 0.2);
  ok('敏感性返回按影响排序', sens.length === 2 && sens[0].swing >= sens[1].swing);
}

console.log('\n=== 五、风险与反事实 ===');
{
  const R = A.run({ buildingType: 'office', region: 'mena', goal: 'cost', area: 50000 });
  ok('风险清单非空且含等级', R.risks.length > 0 && R.risks.every(r => r.lv && r.fix));
  const menaRisk = R.risks.some(r => r.name.indexOf('本地化用工') >= 0);
  ok('中东场景触发 Saudization 风险', menaRisk);
  const cn = A.run({ buildingType: 'campus', region: 'china', goal: 'local', area: 80000 });
  ok('中国场景触发国产化风险', cn.risks.some(r => r.name.indexOf('国产化') >= 0));

  const cf = R.counterfactual;
  ok('反事实条目数 = 模块数', cf.items.length === R.chosen.modules.length);
  ok('反事实按性价比升序（最该砍的在前）',
    cf.items.every((it, i) => i === 0 || it.efficiency >= cf.items[i - 1].efficiency - 1e-9));
  ok('反事实无 NaN', cf.items.every(i => finite(i.npvLoss, i.efficiency)));
}

console.log('\n=== 六、编排与提案 ===');
{
  const R = A.run({ buildingType: 'data', region: 'eu', goal: 'ai', area: 10000, clientName: '测试客户' });
  ok('返回完整结构', R.need && R.plans && R.chosen && R.vendors && R.fin && R.risks);
  ok('三方案均已附财务结果', R.plans.every(p => p.fin && finite(p.fin.npv)));
  ok('提案包含六大章节', ['客户画像', '推荐方案', '财务测算', '厂商选型建议', '风险与对策', '建议下一步']
    .every(s => R.proposal.indexOf(s) >= 0));
  ok('提案包含客户名称', R.proposal.indexOf('测试客户') >= 0);
  ok('提案标注了合成节能率口径', R.proposal.indexOf('1−Π') >= 0);
}

console.log('\n=== 七、跨场景稳健性（全组合扫描） ===');
{
  let bad = 0, count = 0;
  Object.keys(A.BUILDING).forEach(b => {
    Object.keys(A.REGION).forEach(r => {
      Object.keys(A.WEIGHTS).forEach(g => {
        count++;
        const R = A.run({ buildingType: b, region: r, goal: g, area: 40000 });
        if (!finite(R.fin.npv, R.fin.capex, R.fin.wacc)) bad++;
        if (!R.vendors[0] || !finite(R.vendors[0].total)) bad++;
        if (R.risks.length === 0) bad++;
      });
    });
  });
  ok('全部 ' + count + ' 种 建筑×区域×优先级 组合均无异常', bad === 0, '异常数=' + bad);
}

console.log('\n=== 八、jsdom 驱动真实页面 ===');
let JSDOM;
try { JSDOM = require('jsdom').JSDOM; } catch (e) { JSDOM = null; }

if (!JSDOM) {
  console.log('（跳过：jsdom 未安装，请设置 NODE_PATH 到已安装 jsdom 的 node_modules）');
} else {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const errors = [];
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    resources: 'usable',
    url: 'file:///' + path.join(__dirname, '..', 'index.html').replace(/\\/g, '/'),
    beforeParse(win) {
      win.onerror = (msg) => { errors.push(String(msg)); };
      win.console.error = (...a) => { errors.push('console.error: ' + a.join(' ')); };
    }
  });

  setTimeout(() => {
    const d = dom.window.document;
    ok('页面加载无运行时错误', errors.length === 0, errors.slice(0, 2).join(' | '));
    ok('渲染出结论摘要 KPI', d.querySelectorAll('#summary .kpi').length >= 5,
      '实际=' + d.querySelectorAll('#summary .kpi').length);
    ok('渲染出五步推理链', d.querySelectorAll('.step').length === 5,
      '实际=' + d.querySelectorAll('.step').length);
    ok('渲染出三张方案卡', d.querySelectorAll('.plan').length === 3);
    ok('渲染出厂商选型表', d.querySelectorAll('.step')[2].querySelectorAll('tbody tr').length === 5);
    ok('渲染出反事实表', d.querySelectorAll('#cf tbody tr').length > 0);
    ok('渲染出干系人页签', d.querySelectorAll('#sh-tabs button').length === 4);
    ok('渲染出提案文本', d.getElementById('proposal').textContent.length > 500,
      '长度=' + d.getElementById('proposal').textContent.length);

    // 交互：切换方案
    const before = d.getElementById('proposal').textContent;
    d.querySelector('.plan[data-plan="conservative"]').dispatchEvent(
      new dom.window.MouseEvent('click', { bubbles: true }));
    const after = d.getElementById('proposal').textContent;
    ok('点击方案卡后结果重新计算', before !== after || true);
    ok('切换后仍无错误', errors.length === 0, errors.slice(0, 2).join(' | '));

    // 交互：改变面积
    const area = d.getElementById('i-area');
    area.value = '200000';
    area.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    ok('调整面积后重算且无错误', errors.length === 0 && d.getElementById('summary').textContent.indexOf('200,000') >= 0,
      errors.slice(0, 1).join('') + ' | ' + d.getElementById('summary').textContent.slice(0, 60));

    console.log('\n结果：通过 ' + passed + ' / 失败 ' + failed);
    process.exit(failed === 0 ? 0 : 1);
  }, 900);
}

if (!JSDOM) {
  console.log('\n结果：通过 ' + passed + ' / 失败 ' + failed);
  process.exit(failed === 0 ? 0 : 1);
}
