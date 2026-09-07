/* solution-agent — 解决方案顾问 Agent 内核（UMD：浏览器挂 window.AgentCore，Node 可 require） */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AgentCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ==========================================================================
  // 知识库
  // ==========================================================================

  // opex: 运维人工与外包年支出 USD/㎡·年（含值班、巡检、维保人工，非能源费）
  var BUILDING = {
    office:   { name: '甲级写字楼',   eui: 180, opex: 18, pains: ['能耗成本高', '租户舒适度投诉', '资产估值压力'], aff: { 'Siemens 西门子': 0.30, 'Schneider 施耐德': 0.30 } },
    campus:   { name: '园区 / 综合体', eui: 160, opex: 15, pains: ['多栋协同难', '运维人力紧张', '碳排考核'],       aff: { '华为': 0.40 } },
    hospital: { name: '医院',         eui: 280, opex: 28, pains: ['洁净与合规', '业务连续性', '生命安全'],         aff: { 'Schneider 施耐德': 0.30, 'Johnson Controls': 0.30 } },
    factory:  { name: '工业厂房',     eui: 220, opex: 22, pains: ['产线连续性', '设备故障停机', '峰谷电价'],       aff: { 'Honeywell 霍尼韦尔': 0.30, 'Siemens 西门子': 0.30 } },
    retail:   { name: '商业零售',     eui: 250, opex: 20, pains: ['冷柜与照明能耗', '多门店难统一', '客诉体验'],   aff: { 'Schneider 施耐德': 0.20 } },
    hotel:    { name: '酒店',         eui: 200, opex: 24, pains: ['客房体验', '能耗占比高', '品牌 ESG'],           aff: { 'Siemens 西门子': 0.20 } },
    data:     { name: '数据中心',     eui: 600, opex: 40, pains: ['PUE 偏高', '制冷能耗', '可用性风险'],           aff: { 'Schneider 施耐德': 0.35 } },
    gov:      { name: '政府 / 公共设施', eui: 150, opex: 14, pains: ['预算与审计', '国产化要求', '数据安全'],       aff: { '华为': 0.40 } }
  };

  // price: USD/kWh；grid: kgCO2/kWh；rf/erp 用于当地资本成本
  var REGION = {
    mena:  { name: '中东（沙特 / 阿联酋）', price: 0.12, grid: 0.65, rf: 0.045, erp: 0.058, tax: 0.20, notes: ['Saudization 本地用工比例', '数据本地化存储', 'Estidama / Al Safat 绿建认证'] },
    china: { name: '中国大陆',             price: 0.10, grid: 0.58, rf: 0.025, erp: 0.060, tax: 0.25, notes: ['等保与数据安全合规', '信创与国产化替代'] },
    sea:   { name: '东南亚',               price: 0.13, grid: 0.52, rf: 0.038, erp: 0.062, tax: 0.22, notes: ['电价长期上行', '湿热气候抬高制冷负荷'] },
    eu:    { name: '欧洲',                 price: 0.22, grid: 0.25, rf: 0.028, erp: 0.050, tax: 0.25, notes: ['EPBD 建筑能效指令', 'CBAM 碳边境调节'] }
  };

  // capex: USD/m2；esav: 该模块对总电耗的节能贡献；osav: 对运维成本的节省贡献
  var MODULES = [
    { id: 'metering', name: '能耗计量与监测平台', capex: 8,  esav: 0.03, osav: 0.03, tags: ['foundation'], tier: 1, why: '没有分项计量就无从验证节能，是所有优化的地基' },
    { id: 'bms',      name: '楼宇自控系统集成',   capex: 10, esav: 0.05, osav: 0.02, tags: ['foundation'], tier: 1, why: '打通暖通、照明、给排水等孤岛子系统' },
    { id: 'lighting', name: '智能照明控制',       capex: 6,  esav: 0.06, osav: 0.01, tags: ['quick'],      tier: 1, why: '投资小、回收快，适合作为首期成果建立信心' },
    { id: 'hvac',     name: '暖通空调优化',       capex: 18, esav: 0.13, osav: 0.02, tags: ['core'],       tier: 2, why: '商业建筑能耗占比最高的单一系统，节能主战场' },
    { id: 'pdm',      name: '设备预测性维护',     capex: 9,  esav: 0.02, osav: 0.05, tags: ['opex'],       tier: 2, why: '把运维从被动抢修转为主动干预，直接压人力成本' },
    { id: 'ieq',      name: '室内环境质量监测',   capex: 4,  esav: 0.01, osav: 0.01, tags: ['esg'],        tier: 2, why: '舒适度与健康的量化证据，支撑 ESG 披露' },
    { id: 'security', name: '安防与门禁集成',     capex: 7,  esav: 0.00, osav: 0.02, tags: ['compliance'], tier: 2, why: '与楼宇平台统一后减少重复值班岗位' },
    { id: 'twin',     name: '数字孪生可视化',     capex: 12, esav: 0.01, osav: 0.02, tags: ['showcase'],   tier: 3, why: '面向管理层与参观的展示价值，利于争取二期预算' },
    { id: 'pv',       name: '光伏与储能',         capex: 30, esav: 0.10, osav: 0.00, tags: ['longterm'],   tier: 3, why: '长期收益确定但回收期长，适合有 ESG 硬指标或补贴的客户' }
  ];

  var DIMS = [
    { k: 'open',  name: '开放性' },
    { k: 'cost',  name: '成本竞争力' },
    { k: 'eco',   name: '生态完整度' },
    { k: 'ai',    name: 'AI 能力' },
    { k: 'local', name: '本地化服务' },
    { k: 'sec',   name: '安全合规' }
  ];

  var VENDORS = [
    { name: '华为',                s: { open: 3.5, cost: 4.5, eco: 4.0, ai: 4.5, local: 5.0, sec: 4.0 }, why: '国产化与本地交付最强，园区与政府场景优势明显' },
    { name: 'Siemens 西门子',      s: { open: 4.5, cost: 3.0, eco: 5.0, ai: 4.5, local: 3.0, sec: 5.0 }, why: '生态与安全合规标杆，高端写字楼与医院首选' },
    { name: 'Schneider 施耐德',    s: { open: 5.0, cost: 3.5, eco: 4.5, ai: 4.5, local: 3.5, sec: 4.5 }, why: '开放性最好，配电侧能力强，改造项目友好' },
    { name: 'Johnson Controls',    s: { open: 4.0, cost: 3.0, eco: 5.0, ai: 4.0, local: 3.0, sec: 4.0 }, why: '暖通与医院场景积累深，运维服务网络成熟' },
    { name: 'Honeywell 霍尼韦尔',  s: { open: 4.0, cost: 3.0, eco: 4.5, ai: 4.5, local: 3.5, sec: 4.5 }, why: '工业与流程场景强，预测性维护方案成熟' }
  ];

  // 每个优先级的权重向量，归一到 1.00，保证综合分可解释可复算
  var WEIGHTS = {
    cost:   { cost: 0.40, open: 0.20, eco: 0.15, ai: 0.10, local: 0.10, sec: 0.05 },
    open:   { open: 0.40, eco: 0.20, sec: 0.15, ai: 0.10, cost: 0.10, local: 0.05 },
    local:  { local: 0.45, cost: 0.20, ai: 0.15, open: 0.10, eco: 0.05, sec: 0.05 },
    ai:     { ai: 0.40, eco: 0.15, open: 0.15, cost: 0.10, local: 0.10, sec: 0.10 },
    sec:    { sec: 0.40, open: 0.20, eco: 0.15, ai: 0.10, cost: 0.10, local: 0.05 }
  };

  var PRIORITY_NAME = { cost: '成本优先', open: '开放生态', local: '国产化与本地服务', ai: '智能化能力', sec: '安全合规' };

  var STAKEHOLDERS = [
    { k: 'cfo', name: 'CFO / 财务负责人', focus: '回收期、现金流、可验证的节能额',
      asks: ['多少年回本？', '节能效果怎么保证？', '能不能做成合同能源管理，不占用资本金？'],
      answer: '用折现回收期与净现值双指标回答，并给出节能保证条款与第三方核证方案；若资本金紧张，切换 ESCO 共享节能收益模式。' },
    { k: 'cto', name: 'CTO / IT 负责人', focus: '开放性、集成难度、数据安全',
      asks: ['会不会形成厂商锁定？', '能不能对接我们现有的系统？', '数据放在哪里？'],
      answer: '用开放性维度得分与接口清单回应，承诺 BACnet / Modbus / MQTT 标准协议与数据中台解耦，并给出数据本地化部署选项。' },
    { k: 'owner', name: '业主 / CEO', focus: '资产估值、品牌、ESG 披露',
      asks: ['这对我的资产估值有什么帮助？', '能不能写进 ESG 报告？', '有没有可参观的样板？'],
      answer: '把年碳减排量换算成碳资产与绿建认证加分，并提供可视化的数字孪生作为对外展示窗口。' },
    { k: 'ops', name: '运维总监', focus: '好不好用、误报多不多、增加多少工作量',
      asks: ['会不会增加我们的工作量？', '报警太多了怎么办？', '厂家能不能及时响应？'],
      answer: '强调告警收敛与分级派单机制，承诺本地服务响应时效与驻场培训，首期先在单栋楼试点降低学习成本。' }
  ];

  // ==========================================================================
  // 工具
  // ==========================================================================

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
  function byId(id) { for (var i = 0; i < MODULES.length; i++) if (MODULES[i].id === id) return MODULES[i]; return null; }

  // 多模块合成：用 1 - Π(1-x) 而非简单相加，避免叠加后超过 100%
  function composeRate(list, key) {
    var keep = 1;
    for (var i = 0; i < list.length; i++) keep *= (1 - num(list[i][key], 0));
    return 1 - keep;
  }

  // ==========================================================================
  // 步骤 1：需求解析
  // ==========================================================================

  function parseNeed(input) {
    var b = BUILDING[input.buildingType] || BUILDING.office;
    var r = REGION[input.region] || REGION.mena;
    var goal = input.goal || 'cost';

    var mustHave = ['metering'];
    var rationale = [];

    // 高能耗强度建筑必须上暖通优化
    if (b.eui >= 200) { mustHave.push('hvac'); rationale.push('该建筑类型能耗强度高（' + b.eui + ' kWh/㎡·年），暖通是节能主战场'); }
    else { mustHave.push('lighting'); rationale.push('能耗强度中等，先从投资小、见效快的照明控制切入'); }

    if (goal === 'cost')  { mustHave.push('lighting'); rationale.push('目标为控成本，优先纳入回收期短的模块'); }
    if (goal === 'ai')    { mustHave.push('pdm');      rationale.push('目标为智能化，纳入预测性维护形成数据闭环'); }
    if (goal === 'sec')   { mustHave.push('security'); rationale.push('目标为安全合规，纳入安防门禁集成'); }
    if (goal === 'open')  { mustHave.push('bms');      rationale.push('目标为开放生态，需先打通子系统集成'); }

    if (b.pains.indexOf('数据安全') >= 0 || b.pains.indexOf('预算与审计') >= 0) {
      rationale.push('该场景对数据合规敏感，架构需支持本地化部署与权限审计');
    }

    return {
      building: b, region: r, goal: goal,
      goalName: PRIORITY_NAME[goal] || goal,
      mustHave: unique(mustHave),
      pains: b.pains,
      rationale: rationale
    };
  }

  function unique(a) {
    var out = [], seen = {};
    for (var i = 0; i < a.length; i++) { if (!seen[a[i]]) { seen[a[i]] = 1; out.push(a[i]); } }
    return out;
  }

  // ==========================================================================
  // 步骤 2：生成三套配置（保守 / 平衡 / 激进）
  // ==========================================================================

  function designSolution(need, budgetCap) {
    var must = need.mustHave.slice();

    // 三档按 tier 递进：tier1 必选，tier2 平衡档加入，tier3 激进档加入
    var t1 = MODULES.filter(function (m) { return m.tier === 1; }).map(function (m) { return m.id; });
    var t2 = MODULES.filter(function (m) { return m.tier === 2; }).map(function (m) { return m.id; });
    var t3 = MODULES.filter(function (m) { return m.tier === 3; }).map(function (m) { return m.id; });

    var conservative = unique(must.concat(t1));
    var balanced = unique(conservative.concat(t2));
    var aggressive = unique(balanced.concat(t3));

    var plans = [
      { key: 'conservative', name: '保守方案', desc: '只做地基与快赢，风险最低、回收最快', ids: conservative },
      { key: 'balanced',     name: '平衡方案', desc: '地基 + 主力节能 + 运维优化，性价比最优', ids: balanced },
      { key: 'aggressive',   name: '激进方案', desc: '全量覆盖含光伏与数字孪生，ESG 收益最大', ids: aggressive }
    ];

    // 预算硬约束：超预算则按性价比从低到高砍模块
    plans.forEach(function (p) {
      p.ids = applyBudget(p.ids, budgetCap);
      p.modules = p.ids.map(byId).filter(Boolean);
      p.capexPerM2 = p.modules.reduce(function (s, m) { return s + m.capex; }, 0);
      p.esav = composeRate(p.modules, 'esav');
      p.osav = composeRate(p.modules, 'osav');
      p.trimmed = p.modules.length < p.ids.length;
    });

    return plans;
  }

  // 预算约束：按 单位投资节能效率 从低到高移除，直到满足上限
  function applyBudget(ids, budgetCap) {
    if (!budgetCap || budgetCap <= 0) return ids.slice();
    var list = ids.slice();
    var sum = function (arr) { return arr.reduce(function (s, id) { var m = byId(id); return s + (m ? m.capex : 0); }, 0); };
    var guard = 0;
    while (sum(list) > budgetCap && list.length > 1 && guard++ < 20) {
      var worst = null, worstEff = Infinity;
      for (var i = 0; i < list.length; i++) {
        var m = byId(list[i]);
        if (!m) continue;
        if (m.tags.indexOf('foundation') >= 0) continue; // 地基类模块不砍
        var eff = (m.esav + m.osav) / (m.capex || 1);
        if (eff < worstEff) { worstEff = eff; worst = m.id; }
      }
      if (!worst) break;
      list = list.filter(function (x) { return x !== worst; });
    }
    return list;
  }

  // ==========================================================================
  // 步骤 3：厂商选型
  // ==========================================================================

  function rankVendors(buildingType, goal) {
    var w = WEIGHTS[goal] || WEIGHTS.cost;
    var aff = (BUILDING[buildingType] || {}).aff || {};
    var rows = VENDORS.map(function (v) {
      var total = 0, parts = {};
      DIMS.forEach(function (d) {
        var c = v.s[d.k] * (w[d.k] || 0);
        parts[d.k] = c;
        total += c;
      });
      var a = aff[v.name] || 0;
      return { name: v.name, why: v.why, parts: parts, aff: a, total: total + a };
    });
    rows.sort(function (x, y) { return y.total - x.total; });
    return rows;
  }

  // 差距归因：解释为什么第一名不是某维度最高分者
  function explainGap(top, second, goal) {
    if (!second) return '无次选可比。';
    var w = WEIGHTS[goal] || WEIGHTS.cost;
    var delta = top.total - second.total;
    var lead = null, leadV = -Infinity;
    DIMS.forEach(function (d) {
      var v = (top.parts[d.k] || 0) - (second.parts[d.k] || 0);
      if (v > leadV) { leadV = v; lead = d; }
    });
    var txt = '领先 ' + delta.toFixed(2) + ' 分，主要来自「' + (lead ? lead.name : '综合') + '」';
    if ((top.aff || 0) - (second.aff || 0) > 0.01) txt += '，以及本建筑类型的场景亲和加成';
    return txt + '（该维度权重 ' + ((w[lead ? lead.k : 'cost'] || 0) * 100).toFixed(0) + '%）。';
  }

  // ==========================================================================
  // 步骤 4：投行级财务模型
  // ==========================================================================

  function irrBisect(cfs) {
    var lo = -0.9, hi = 1.5;
    var f = function (r) { var s = 0; for (var t = 0; t < cfs.length; t++) s += cfs[t] / Math.pow(1 + r, t); return s; };
    var flo = f(lo), fhi = f(hi);
    if (flo * fhi > 0) return NaN; // 无符号变化，IRR 不存在
    for (var i = 0; i < 200; i++) {
      var mid = (lo + hi) / 2, fm = f(mid);
      if (Math.abs(fm) < 1e-7) return mid;
      if ((flo < 0) !== (fm < 0)) hi = mid; else { lo = mid; flo = fm; }
    }
    return (lo + hi) / 2;
  }

  function mirrOf(cfs, rate) {
    var n = cfs.length - 1, pvO = 0, fvI = 0;
    for (var t = 0; t <= n; t++) {
      if (cfs[t] < 0) pvO += -cfs[t] / Math.pow(1 + rate, t);
      else fvI += cfs[t] * Math.pow(1 + rate, n - t);
    }
    if (pvO <= 0 || fvI <= 0 || n <= 0) return NaN;
    return Math.pow(fvI / pvO, 1 / n) - 1;
  }

  /**
   * 完整 DCF。p 字段：
   * area 面积㎡ / eui 能耗强度 / price 电价 / opexPerM2 运维基准 / esav 节能率 / osav 运维节省率
   * capexPerM2 单位投资 / subsidy 补贴比例 / esc 电价年涨幅 / maintRate 维护费率
   * horizon 年限 / tax 税率 / debtPct 债务比 / rd 债务成本 / rf 无风险利率 / beta / erp 风险溢价
   * grid 电网排放因子 / carbonPrice 碳价
   */
  function finance(p) {
    var esc = num(p.esc, 0.04), maintRate = num(p.maintRate, 0.02);
    var horizon = Math.max(1, Math.round(num(p.horizon, 15)));
    var tax = num(p.tax, 0.20), debtPct = clamp(num(p.debtPct, 0.5), 0, 0.95);
    var rd = num(p.rd, 0.065), rf = num(p.rf, 0.042), beta = num(p.beta, 0.9), erp = num(p.erp, 0.055);

    var baselineEnergy = p.area * p.eui;                    // kWh/年
    var baselineCost = baselineEnergy * p.price;            // 电费等年支出
    var opexBase = p.area * num(p.opexPerM2, 8);            // 运维人工等年支出

    var capex = p.area * p.capexPerM2 * (1 - num(p.subsidy, 0));
    var energySav1 = baselineCost * p.esav;
    var opexSav1 = opexBase * p.osav;

    var Re = rf + beta * erp;                               // CAPM 股权成本
    var RdAT = rd * (1 - tax);                              // 税后债务成本
    var wacc = (1 - debtPct) * Re + debtPct * RdAT;
    wacc = clamp(wacc, 0.005, 0.60);                        // 防止极端输入导致除零

    var dep = capex / horizon;
    var rows = [], cfs = [-capex];
    var cum = -capex, cumD = -capex;
    var sp = null, dp = null;

    for (var t = 1; t <= horizon; t++) {
      var sav = (energySav1 + opexSav1) * Math.pow(1 + esc, t - 1);
      var maint = capex * maintRate * Math.pow(1.03, t - 1);
      var ebit = sav - maint - dep;
      var taxPaid = ebit > 0 ? ebit * tax : 0;
      var ocf = ebit - taxPaid + dep;
      var df = Math.pow(1 + wacc, t);
      cum += ocf;
      cumD += ocf / df;
      if (dp === null && cumD >= 0) dp = t;
      rows.push({ t: t, sav: sav, maint: maint, dep: dep, ebit: ebit, tax: taxPaid, ocf: ocf, cum: cum, pv: ocf / df, cumD: cumD });
      cfs.push(ocf);
    }

    // 简单回收期（线性插值，更精确）
    sp = simplePayback(capex, rows);

    var npv = cumD;
    var irr = irrBisect(cfs);
    var mirr = mirrOf(cfs, wacc);
    var pi = capex > 0 ? (npv + capex) / capex : NaN;
    var avgNopat = rows.reduce(function (s, r) { return s + (r.ebit - r.tax); }, 0) / horizon;
    var roic = capex > 0 ? avgNopat / capex : NaN;
    var spread = (isFinite(roic) ? roic : 0) - wacc;

    // 终值：仅当 WACC 显著高于永续增长率时才计入，否则 Gordon 公式会给出误导性巨值
    var g0 = num(p.g, 0.02);
    var tvOn = wacc > g0 + 0.005;
    var tv = tvOn ? (rows[rows.length - 1].ocf * (1 + g0)) / (wacc - g0) : 0;
    var npvTv = npv + (tvOn ? tv / Math.pow(1 + wacc, horizon) : 0);

    var co2yr = baselineEnergy * p.esav * num(p.grid, 0.65) / 1000; // 吨/年
    var carbonVal = co2yr * num(p.carbonPrice, 15);
    var co2cum = co2yr * horizon;

    return {
      baselineEnergy: baselineEnergy, baselineCost: baselineCost, opexBase: opexBase,
      energySav1: energySav1, opexSav1: opexSav1, capex: capex, debt: capex * debtPct, equity: capex * (1 - debtPct),
      Re: Re, RdAT: RdAT, wacc: wacc, dep: dep,
      rows: rows, npv: npv, irr: irr, mirr: mirr, sp: sp, dp: dp,
      pi: pi, roic: roic, spread: spread,
      tvOn: tvOn, npvTv: npvTv, g0: g0,
      co2yr: co2yr, carbonVal: carbonVal, co2cum: co2cum
    };
  }

  function simplePayback(capex, rows) {
    var prev = -capex;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (prev + r.ocf >= 0) return (i) + (-prev) / (r.ocf || 1);
      prev += r.ocf;
    }
    return null; // 期内未回本
  }

  // 单变量敏感性：对关键驱动因子 ±delta 后的 NPV 偏离
  function sensitivity(p, keys, delta) {
    delta = delta || 0.20;
    var base = finance(p).npv;
    var out = [];
    var labels = { esav: '实际节能率', capexPerM2: '单位投资', price: '电价', eui: '能耗强度', waccProxy: '资本成本', esc: '电价涨幅' };
    (keys || ['esav', 'capexPerM2', 'price', 'eui']).forEach(function (k) {
      var lo = Object.assign({}, p), hi = Object.assign({}, p);
      if (k === 'waccProxy') { lo.rf = p.rf * (1 - delta); hi.rf = p.rf * (1 + delta); }
      else { lo[k] = p[k] * (1 - delta); hi[k] = p[k] * (1 + delta); }
      var nl = finance(lo).npv, nh = finance(hi).npv;
      out.push({ key: k, label: labels[k] || k, low: nl, high: nh, base: base, swing: Math.abs(nh - nl) });
    });
    out.sort(function (a, b) { return b.swing - a.swing; });
    return out;
  }

  // ==========================================================================
  // 步骤 5：风险识别
  // ==========================================================================

  function assessRisks(input, plan) {
    var r = REGION[input.region] || REGION.mena;
    var list = [];

    list.push({ lv: '高', name: '节能效果不达预期', why: '模型节能率基于同类项目基准，实际受运行习惯与气候影响',
      fix: '采用合同能源管理模式，约定保证节能额，不足部分由实施方补偿；同步部署第三方计量核证（IPMVP）。' });

    if (plan.modules.some(function (m) { return m.tags.indexOf('foundation') >= 0; }) === false) {
      list.push({ lv: '高', name: '缺少计量基线', why: '未纳入分项计量，节能效果无法验证', fix: '补入能耗计量与监测平台，作为所有节能措施的前置条件。' });
    }

    list.push({ lv: '中', name: '数据安全与权限', why: '楼宇数据接入平台后存在越权访问与外泄风险',
      fix: '职责分离与最小权限原则，数据本地化存储，关键操作留痕可审计（参照 ITGC 控制要求）。' });

    if (input.region === 'mena') {
      list.push({ lv: '中', name: '本地化用工与合规', why: '沙特 Saudization 对本地员工比例有硬性要求',
        fix: '与本地伙伴成立合资实体，将用工配额与资质要求前置计入交付成本。' });
      list.push({ lv: '中', name: '绿建认证强制要求', why: '迪拜 Al Safat、阿布扎比 Estidama 为强制门槛',
        fix: '在方案设计阶段即对齐认证条款，把认证得分点映射为可交付的功能清单。' });
    }
    if (input.region === 'eu') {
      list.push({ lv: '中', name: '碳边境与能效指令', why: 'EPBD 与 CBAM 提高了能效与碳披露门槛', fix: '把碳减排量核算纳入方案，输出可用于披露的年度数据。' });
    }
    if (input.region === 'china') {
      list.push({ lv: '中', name: '国产化替代要求', why: '关键信息基础设施场景对信创有明确要求', fix: '选型时提高本地化维度权重，核心组件采用国产方案。' });
    }

    if (plan.capexPerM2 >= 60) {
      list.push({ lv: '中', name: '投资强度偏高', why: '单位投资偏高会拉长回收期，增加决策阻力', fix: '拆分为两期交付，首期用快赢模块的收益反哺二期。' });
    }

    list.push({ lv: '低', name: '组织阻力与运维适配', why: '新系统改变既有工作流，可能遭遇一线抵触', fix: '首期单栋试点，配驻场培训与分级告警收敛，降低学习成本。' });

    return list;
  }

  // ==========================================================================
  // 反事实分析：预算不足时该砍谁
  // ==========================================================================

  function counterfactual(p, plan) {
    var base = finance(p);
    var out = [];
    plan.modules.forEach(function (m) {
      var alt = plan.modules.filter(function (x) { return x.id !== m.id; });
      if (alt.length === 0) return;
      var q = Object.assign({}, p, {
        capexPerM2: alt.reduce(function (s, x) { return s + x.capex; }, 0),
        esav: composeRate(alt, 'esav'),
        osav: composeRate(alt, 'osav')
      });
      var f = finance(q);
      out.push({
        id: m.id, name: m.name,
        capexSaved: m.capex,
        npvLoss: base.npv - f.npv,
        paybackChange: (f.sp === null ? 999 : f.sp) - (base.sp === null ? 999 : base.sp),
        efficiency: (base.npv - f.npv) / (m.capex || 1) // 每单位投资带来的 NPV，越高越该保留
      });
    });
    out.sort(function (a, b) { return a.efficiency - b.efficiency; }); // 效率最低的排最前 = 优先砍
    return { baseNpv: base.npv, items: out };
  }

  // ==========================================================================
  // 提案生成（Markdown）
  // ==========================================================================

  function proposal(ctx) {
    var L = [];
    L.push('# ' + ctx.clientName + '：智慧建筑能效与运营优化方案建议');
    L.push('');
    L.push('> 本文档由解决方案顾问 Agent 自动生成，参数可回溯、算法可复算。');
    L.push('');
    L.push('## 一、客户画像');
    L.push('');
    L.push('- 建筑类型：' + ctx.need.building.name + '（' + ctx.area.toLocaleString() + ' ㎡，基准能耗强度 ' + ctx.need.building.eui + ' kWh/㎡·年）');
    L.push('- 所在区域：' + ctx.need.region.name + '（电价 ' + ctx.price + ' USD/kWh）');
    L.push('- 决策优先级：' + ctx.need.goalName);
    L.push('- 核心痛点：' + ctx.need.pains.join('、'));
    L.push('');
    L.push('## 二、推荐方案');
    L.push('');
    L.push('**' + ctx.plan.name + '** — ' + ctx.plan.desc);
    L.push('');
    L.push('| 模块 | 单位投资 (USD/㎡) | 节能贡献 | 运维节省 |');
    L.push('|---|---|---|---|');
    ctx.plan.modules.forEach(function (m) {
      L.push('| ' + m.name + ' | ' + m.capex + ' | ' + (m.esav * 100).toFixed(0) + '% | ' + (m.osav * 100).toFixed(0) + '% |');
    });
    L.push('| **合计** | **' + ctx.plan.capexPerM2 + '** | **' + (ctx.plan.esav * 100).toFixed(1) + '%** | **' + (ctx.plan.osav * 100).toFixed(1) + '%** |');
    L.push('');
    L.push('> 合成节能率采用 1−Π(1−xᵢ) 口径，而非简单相加，避免多模块叠加后高估。');
    L.push('');
    L.push('## 三、财务测算');
    L.push('');
    L.push('| 指标 | 数值 |');
    L.push('|---|---|');
    L.push('| 初始投资 | ' + fmtMoney(ctx.fin.capex) + ' |');
    L.push('| 年节能收益（首年） | ' + fmtMoney(ctx.fin.energySav1 + ctx.fin.opexSav1) + ' |');
    L.push('| 加权平均资本成本 | ' + (ctx.fin.wacc * 100).toFixed(2) + '% |');
    L.push('| 净现值 NPV | ' + fmtMoney(ctx.fin.npv) + ' |');
    L.push('| 内部收益率 IRR | ' + pct(ctx.fin.irr) + ' |');
    L.push('| 修正内部收益率 MIRR | ' + pct(ctx.fin.mirr) + ' |');
    L.push('| 简单回收期 | ' + (ctx.fin.sp === null ? '期内未回本' : ctx.fin.sp.toFixed(1) + ' 年') + ' |');
    L.push('| 折现回收期 | ' + (ctx.fin.dp === null ? '期内未回本' : ctx.fin.dp + ' 年') + ' |');
    L.push('| 年碳减排 | ' + ctx.fin.co2yr.toFixed(0) + ' 吨 |');
    L.push('');
    L.push('## 四、厂商选型建议');
    L.push('');
    L.push('首选 **' + ctx.vendors[0].name + '**（综合 ' + ctx.vendors[0].total.toFixed(2) + '）：' + ctx.vendors[0].why + '。');
    if (ctx.vendors[1]) L.push('次选 ' + ctx.vendors[1].name + '（' + ctx.vendors[1].total.toFixed(2) + '），' + ctx.gapText);
    L.push('');
    L.push('## 五、风险与对策');
    L.push('');
    ctx.risks.forEach(function (r) {
      L.push('- **[' + r.lv + '] ' + r.name + '**：' + r.why + ' → ' + r.fix);
    });
    L.push('');
    L.push('## 六、建议下一步');
    L.push('');
    L.push('1. 现场能耗审计与基线确认（2 周）');
    L.push('2. 单栋试点验证节能率（3 个月）');
    L.push('3. 基于实测数据校准模型后，分批推广至全域');
    L.push('');
    return L.join('\n');
  }

  function fmtMoney(v) {
    if (!isFinite(v)) return '—';
    var a = Math.abs(v);
    if (a >= 1e6) return (v / 1e6).toFixed(2) + ' M USD';
    if (a >= 1e3) return (v / 1e3).toFixed(1) + ' k USD';
    return v.toFixed(0) + ' USD';
  }
  function pct(v) { return isFinite(v) ? (v * 100).toFixed(1) + '%' : '—'; }

  // ==========================================================================
  // 编排：一次跑完五步推理链
  // ==========================================================================

  function run(input) {
    var need = parseNeed(input);
    var plans = designSolution(need, input.budgetCap);
    var chosen = plans.filter(function (p) { return p.key === (input.planKey || 'balanced'); })[0] || plans[1];
    var vendors = rankVendors(input.buildingType, input.goal);

    var p = {
      area: num(input.area, 50000),
      eui: need.building.eui,
      price: need.region.price,
      opexPerM2: need.building.opex,
      esav: chosen.esav,
      osav: chosen.osav,
      capexPerM2: chosen.capexPerM2,
      subsidy: num(input.subsidy, 0),
      esc: num(input.esc, 0.04),
      maintRate: num(input.maintRate, 0.02),
      horizon: num(input.horizon, 15),
      tax: need.region.tax,
      debtPct: num(input.debtPct, 0.5),
      rd: num(input.rd, 0.065),
      rf: need.region.rf,
      beta: num(input.beta, 0.9),
      erp: need.region.erp,
      grid: need.region.grid,
      carbonPrice: num(input.carbonPrice, 15),
      g: num(input.g, 0.02)
    };

    plans.forEach(function (pl) {
      pl.fin = finance(Object.assign({}, p, {
        capexPerM2: pl.capexPerM2, esav: pl.esav, osav: pl.osav
      }));
    });

    var fin = chosen.fin;
    var risks = assessRisks(input, chosen);
    var cf = counterfactual(p, chosen);
    var sens = sensitivity(p, ['esav', 'capexPerM2', 'price', 'eui']);

    return {
      need: need, plans: plans, chosen: chosen, vendors: vendors,
      gapText: explainGap(vendors[0], vendors[1], input.goal),
      fin: fin, risks: risks, counterfactual: cf, sensitivity: sens,
      params: p,
      stakeholders: STAKEHOLDERS,
      proposal: proposal({
        clientName: input.clientName || '客户', need: need, plan: chosen,
        fin: fin, vendors: vendors, risks: risks, gapText: explainGap(vendors[0], vendors[1], input.goal),
        area: p.area, price: p.price
      })
    };
  }

  return {
    BUILDING: BUILDING, REGION: REGION, MODULES: MODULES, VENDORS: VENDORS, DIMS: DIMS,
    WEIGHTS: WEIGHTS, PRIORITY_NAME: PRIORITY_NAME, STAKEHOLDERS: STAKEHOLDERS,
    composeRate: composeRate, parseNeed: parseNeed, designSolution: designSolution,
    rankVendors: rankVendors, explainGap: explainGap, finance: finance,
    sensitivity: sensitivity, assessRisks: assessRisks, counterfactual: counterfactual,
    proposal: proposal, run: run, fmtMoney: fmtMoney
  };
});
