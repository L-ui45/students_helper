/* 逻辑层测试：状态机、冲突检测、检索筛选、排序、自检器、年份绑定。
 * 运行：node tests/logic.test.cjs
 * 纯逻辑测试固定年份为 2025、基准时刻为 2025-09-19 12:00，保证断言稳定；
 * 页面运行时的时间基准是电脑系统时间（见最后一节「年份跟随电脑系统时间」）。
 */
'use strict';
var assert = require('assert');
var { META, DATA } = require('../js/data.js');
var L = require('../js/logic.js');

/* 纯逻辑测试固定到 2025 年，保证断言稳定（页面运行时年份来自系统时间） */
L.setYear(2025);
var NOW = L.parseISO(META.defaultNow);
var byId = function (id) { return DATA.filter(function (r) { return r.id === id; })[0]; };
var pass = 0, fail = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
}

console.log('逻辑测试 @ ' + META.defaultNow);
console.log('\n【报名状态】');

ok('02 无需报名 / 05 24 小时内截止 / 14 报名≠录取 / 17 链接有效期', function () {
  assert.strictEqual(L.signupState(byId('02'), NOW).code, 'none_needed');
  assert.strictEqual(L.signupState(byId('05'), NOW).code, 'closing_soon');
  assert.strictEqual(L.signupState(byId('14'), NOW).code, 'review');
  assert.strictEqual(L.signupState(byId('17'), NOW).code, 'link');
});

ok('06/08/16 走「满员即止 / 长期招募」而不是编造截止时间', function () {
  assert.strictEqual(L.signupState(byId('06'), NOW).code, 'rolling');
  assert.strictEqual(L.signupState(byId('08'), NOW).code, 'rolling');
  assert.strictEqual(L.signupState(byId('16'), NOW).code, 'rolling');
  ['06', '08', '16'].forEach(function (id) {
    assert.strictEqual(byId(id).deadline.at, null, id + ' 不应有截止时间');
  });
});

ok('19 显示「已截止·可候补」而不是简单「已截止」', function () {
  var st = L.signupState(byId('19'), NOW);
  assert.strictEqual(st.code, 'waitlist');
  assert.ok(/候补/.test(st.label));
});

ok('11/18/22/24/25 报名方式发布者未注明 → unknown（不猜）', function () {
  ['11', '18', '22', '24', '25'].forEach(function (id) {
    assert.strictEqual(L.signupState(byId(id), NOW).code, 'unknown', id + ' 应为 unknown');
  });
});

ok('还在报名期的条目为 open（01/03/07/09/12/13/15/20）', function () {
  ['01', '03', '07', '09', '12', '13', '15', '20'].forEach(function (id) {
    assert.strictEqual(L.signupState(byId(id), NOW).code, 'open', id + ' 应为 open');
  });
});

console.log('\n【活动状态】');

ok('今天稍后：02（19:00）、10（15:00）、18（19:30）', function () {
  ['02', '10', '18'].forEach(function (id) {
    assert.strictEqual(L.eventState(byId(id), NOW).code, 'today_later', id);
  });
});

ok('04 直播已结束但回放待发布 → replay_pending', function () {
  var st = L.eventState(byId('04'), NOW);
  assert.strictEqual(st.code, 'replay_pending');
  assert.ok(/回放/.test(st.label));
});

ok('01 首次训练（经 09 号通知调整）为未来场次', function () {
  assert.strictEqual(L.eventState(byId('01'), NOW).code, 'upcoming');
  assert.strictEqual(byId('01').when.start, '2025-09-21T19:30');
});

ok('23 只有日期没有时刻 → 时间未注明（不假装成 00:00 的活动）', function () {
  var st = L.eventState(byId('23'), NOW);
  assert.strictEqual(st.code, 'no_time');
  assert.ok(/未注明/.test(st.label));
});

console.log('\n【冲突检测】');

ok('确认的时间冲突恰为两组：9/19 {02,18}、9/21 {01,11,14}', function () {
  var c = L.detectConflicts(DATA);
  var flat = c.groups.map(function (g) { return g.date + ':' + g.ids.join(','); }).sort();
  assert.deepStrictEqual(flat, ['2025-09-19:02,18', '2025-09-21:01,11,14']);
});

ok('9/21 三场撞车用的是变更后的真实时间，且同一场训练营不会被 09 号通知重复计算', function () {
  var c = L.detectConflicts(DATA);
  var g = c.groups.filter(function (x) { return x.date === '2025-09-21'; })[0];
  assert.ok(g, '缺少 9/21 冲突组');
  assert.deepStrictEqual(g.ids, ['01', '11', '14']);
  // 09 号通知只更新 01 的时间，不再单独生成一场
  var e09 = L.entriesOf(byId('09'));
  assert.strictEqual(e09.length, 0, '变更通知不应生成日程条目');
  assert.strictEqual(byId('01').when.start, '2025-09-21T19:30', '01 应采用变更后的时间');
});

ok('9/19 冲突组标记「其中一场未注明结束时间」（18 号只写了 19:30 开始）', function () {
  var c = L.detectConflicts(DATA);
  var g = c.groups.filter(function (x) { return x.date === '2025-09-19'; })[0];
  assert.deepStrictEqual(g.ids, ['02', '18']);
  assert.strictEqual(g.partial, true);
});

ok('9/20 无确认冲突，但给出「同日多场、结束时间未注明」的提醒', function () {
  var c = L.detectConflicts(DATA);
  assert.strictEqual(c.groups.filter(function (g) { return g.date === '2025-09-20'; }).length, 0);
  var caution = c.caution.filter(function (x) { return x.date === '2025-09-20'; })[0];
  assert.ok(caution, '缺少 9/20 提示');
  assert.deepStrictEqual(caution.ids, ['19', '21', '22']);
});

console.log('\n【每天负载】');

ok('9/19、9/20、9/21 是「很满」的三天', function () {
  var load = L.dayLoad(DATA);
  var busy = load.filter(function (d) { return d.busy; }).map(function (d) { return d.date; });
  ['2025-09-19', '2025-09-20', '2025-09-21'].forEach(function (d) {
    assert.ok(busy.indexOf(d) >= 0, d + ' 应被标记为很满');
  });
});

ok('9/20 当天 4 件事：活动 3 场 + 报名截止 1 个', function () {
  var d = L.dayLoad(DATA).filter(function (x) { return x.date === '2025-09-20'; })[0];
  assert.strictEqual(d.sessions.length, 3);
  assert.strictEqual(d.deadlines.length, 1);
  assert.strictEqual(d.deadlines[0].id, '05');
});

ok('推算出的周期场次带 derived 标记（06 六周 / 18 第二次）', function () {
  var e6 = L.entriesOf(byId('06')).filter(function (e) { return e.kind === 'session'; });
  assert.strictEqual(e6.length, 6);
  assert.strictEqual(e6[0].derived, undefined);
  assert.strictEqual(e6[5].derived, true);
  var e18 = L.entriesOf(byId('18')).filter(function (e) { return e.kind === 'session'; });
  assert.strictEqual(e18.length, 2);
  assert.strictEqual(L.ymd(e18[1].at), '2025-10-03');
});

console.log('\n【检索 / 筛选 / 排序】');

ok('搜索「志愿」命中 05、16', function () {
  var r = L.applyFilters(DATA, { q: '志愿' }, NOW).map(function (x) { return x.id; });
  assert.ok(r.indexOf('05') >= 0 && r.indexOf('16') >= 0);
});

ok('搜索「大二」命中 08、13（面向人群差异）', function () {
  var r = L.applyFilters(DATA, { q: '大二' }, NOW).map(function (x) { return x.id; });
  assert.ok(r.indexOf('08') >= 0 && r.indexOf('13') >= 0);
});

ok('搜索「私人微信」能定位到风险条目 24', function () {
  var r = L.applyFilters(DATA, { q: '私人微信' }, NOW).map(function (x) { return x.id; });
  assert.deepStrictEqual(r, ['24']);
});

ok('快捷筛选：适合新生 18 条 / 直接去 5 条 / 需谨慎 2 条', function () {
  // 18 = 17 条活动 + 09（训练营变更通知，零基础可参加，对新生同样有用）
  assert.strictEqual(L.applyFilters(DATA, { quick: ['适合新生'] }, NOW).length, 18);
  // 回归保护：界面标签「适合新生」与逻辑别名「新手友好」必须指向同一条规则
  var a = L.applyFilters(DATA, { quick: ['适合新生'] }, NOW).map(function (x) { return x.id; });
  var b = L.applyFilters(DATA, { quick: ['新手友好'] }, NOW).map(function (x) { return x.id; });
  assert.deepStrictEqual(a, b, '「适合新生」与「新手友好」筛选结果必须一致');
  assert.deepStrictEqual(L.applyFilters(DATA, { quick: ['直接去'] }, NOW).map(function (x) { return x.id; }), ['02', '04', '10', '21', '26']);
  assert.deepStrictEqual(L.applyFilters(DATA, { quick: ['需谨慎的'] }, NOW).map(function (x) { return x.id; }), ['24', '25']);
});

ok('来源筛选：学院发布 2 条（21、26）', function () {
  var r = L.applyFilters(DATA, { source: ['学院发布'] }, NOW).map(function (x) { return x.id; });
  assert.deepStrictEqual(r, ['21', '26']);
});

ok('时间窗筛选：今天=3 场、明天=4 场', function () {
  var today = L.applyFilters(DATA, { window: 'today' }, NOW).map(function (x) { return x.id; });
  assert.deepStrictEqual(today, ['02', '10', '18']);
  var tmr = L.applyFilters(DATA, { window: 'tomorrow' }, NOW).map(function (x) { return x.id; });
  assert.deepStrictEqual(tmr, ['04', '05', '19', '21', '22']);
});

ok('排序：最紧急第一条是今天 19:00 的 02；按时间排序第一条是今天 15:00 的 10', function () {
  assert.strictEqual(L.sortRecords(DATA, 'deadline', NOW)[0].id, '02');
  assert.strictEqual(L.sortRecords(DATA, 'time', NOW)[0].id, '10');
});

ok('排序：推荐序把「适合新生」排在「不适合/需谨慎」之前', function () {
  var arr = L.sortRecords(DATA, 'recommend', NOW);
  var last = arr.length - 1;
  assert.ok(['不适合', '谨慎'].indexOf(arr[last].freshman.level) >= 0, '末位应为不适合或需谨慎');
  assert.strictEqual(arr[last].freshman.level, '不适合');
});

ok('只有日期没有时刻的节点/截止不会被显示成 00:00', function () {
  var m = L.entriesOf(byId('04')).filter(function (x) { return x.kind === 'milestone'; })[0];
  assert.ok(m, '04 应有「回放预计上传」节点');
  assert.strictEqual(m.allDay, true, '发布者只给日期时应标为整天');
  assert.strictEqual(L.urgencyOf(byId('04'), NOW).text.indexOf('00:00'), -1,
    '不应出现 00:00：' + L.urgencyOf(byId('04'), NOW).text);
  var d13 = L.entriesOf(byId('13')).filter(function (x) { return x.kind === 'deadline'; })[0];
  assert.strictEqual(d13.allDay, true, '13 的「9月21日截止」未注明时刻，应标为整天');
  assert.strictEqual(L.urgencyOf(byId('13'), NOW).text.indexOf('00:00'), -1);
});

console.log('\n【徽章文案长度（窄屏防溢出）】');

ok('报名/活动徽章文案始终短于阈值，不会把发布者长句塞进徽章', function () {
  // 回归防护：17 号「链接有效期」徽章曾把整段发布者包进 nowrap 徽章，
  // 单卡 min-content 被撑到 439px，把整个卡片网格撑爆、390px 窄屏横向溢出。
  var worst = { len: 0, desc: '' };
  for (var d = 0; d <= 10; d++) {
    var t = L.addDays(NOW, d);
    DATA.forEach(function (r) {
      var s = L.signupState(r, t), e = L.eventState(r, t);
      assert.ok(s.label.length <= 20, r.id + ' @+' + d + ' 天报名徽章过长（' + s.label.length + '字）：' + s.label);
      assert.ok(e.label.length <= 24, r.id + ' @+' + d + ' 天活动徽章过长（' + e.label.length + '字）：' + e.label);
      if (s.label.length > worst.len) worst = { len: s.label.length, desc: r.id + ' ' + s.label };
      if (e.label.length > worst.len) worst = { len: e.label.length, desc: r.id + ' ' + e.label };
    });
  }
  assert.ok(worst.len > 0);
  console.log('      （最长徽章 ' + worst.len + ' 字：' + worst.desc + '）');
});

ok('17 号资料链接徽章只写「链接 X月X日 到期」，长说明留在字段里', function () {
  var st = L.signupState(byId('17'), NOW);
  assert.strictEqual(st.code, 'link');
  assert.ok(st.label.length <= 14, '徽章过长：' + st.label);
  assert.ok(st.title.indexOf('网盘提取信息') >= 0, '完整发布者说明应保留在 title 里');
});

console.log('\n【统计与自检器】');

ok('统计覆盖 26 条，且给出冲突组与风险清单', function () {
  var s = L.stats(DATA, NOW);
  assert.strictEqual(s.total, 26);
  assert.strictEqual(s.conflictInfo.groups.length, 2);
  assert.deepStrictEqual(s.risky.map(function (r) { return r.id; }), ['24', '25']);
  assert.ok(s.unknowns.length >= 10, '应汇总出「发布者未说明项」清单');
});

ok('自检器能发现被破坏的数据（负向测试）', function () {
  var broken = JSON.parse(JSON.stringify(DATA));
  broken[5].category = '不存在的类别';
  broken[5].flags = ['这个标记不存在'];
  var errs = L.validate(broken, META);
  assert.ok(errs.some(function (e) { return /非法类别/.test(e); }), '应报非法类别：' + errs.join(';'));
  assert.ok(errs.some(function (e) { return /未知标记/.test(e); }), '应报未知标记');
  var broken2 = JSON.parse(JSON.stringify(DATA));
  broken2[10].raw = '';
  assert.ok(L.validate(broken2, META).length > 0, '发布者被清空后应报错');
  var broken3 = JSON.parse(JSON.stringify(DATA)).slice(0, 25);
  assert.ok(L.validate(broken3, META).length > 0, '条数不足应报错');
  var broken4 = JSON.parse(JSON.stringify(DATA));
  broken4[12].deadline = { at: null, dateOnly: false, text: '篡改', kind: '硬截止', known: true };
  assert.ok(L.validate(broken4, META).length > 0, '标为硬截止却没有截止时间应报错');
  var broken5 = JSON.parse(JSON.stringify(DATA));
  broken5[2].related = [{ id: '99', rel: '不存在的条目' }];
  assert.ok(L.validate(broken5, META).length > 0, '关联条目不存在应报错');
});

console.log('\n【年份跟随电脑系统时间】');

ok('不绑年份时用数据里写的年份（离线核对发布内容用）', function () {
  L.setYear(null);
  assert.strictEqual(L.parseISO('2025-09-21T19:30').getFullYear(), 2025);
  L.setYear(2025);
});

ok('绑定年份后全部日期整体落到该年份，冲突组与结构不变', function () {
  L.setYear(2026);
  var flat = L.detectConflicts(DATA).groups.map(function (g) { return g.date + ':' + g.ids.join(','); }).sort();
  assert.deepStrictEqual(flat, ['2026-09-19:02,18', '2026-09-21:01,11,14']);
  assert.strictEqual(L.parseISO(byId('01').when.start).getFullYear(), 2026);
  L.setYear(2025);
});

ok('同一份发布内容，星期口径结论随年份变化：06「每周三」2025 对不上、2026 对得上', function () {
  L.setYear(2025);
  assert.strictEqual(L.weekdayVerdict(byId('06'), NOW).ok, false, '2025 年 9月23日 是周二');
  L.setYear(2026);
  var v = L.weekdayVerdict(byId('06'), NOW);
  assert.strictEqual(v.ok, true, '2026 年 9月23日 是周三');
  assert.ok(v.text.indexOf('周三') >= 0 && v.text.indexOf('2026') >= 0, '结论应写明具体年份与星期：' + v.text);
  L.setYear(2025);
});

ok('01「每周六」同样逐年核对：2025 一致、2026 对不上', function () {
  L.setYear(2025);
  assert.strictEqual(L.weekdayVerdict(byId('01'), NOW).ok, true);
  L.setYear(2026);
  var v = L.weekdayVerdict(byId('01'), NOW);
  assert.strictEqual(v.ok, false, '2026 年 9月20日 是周日');
  assert.ok(v.text.indexOf('周日') >= 0);
  L.setYear(2025);
});

ok('没有星期声明的条目不产生核对结论', function () {
  assert.strictEqual(L.weekdayVerdict(byId('05'), NOW), null);
});

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
