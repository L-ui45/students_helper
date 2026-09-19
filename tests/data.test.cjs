/* 数据完整性自检：确认 26 条发布内容被真实、完整地使用，且解析字段与发布内容一致。
 * 运行：node tests/data.test.cjs
 */
'use strict';
var assert = require('assert');
var { META, DATA } = require('../js/data.js');
var L = require('../js/logic.js');

var pass = 0, fail = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
}

console.log('数据自检（' + DATA.length + ' 条）');

ok('结构校验零问题（条数/编号/枚举/字段一致性）', function () {
  var errs = L.validate(DATA, META);
  assert.deepStrictEqual(errs, [], errs.join('; '));
});

ok('编号 01–26 连续且唯一', function () {
  var ids = DATA.map(function (r) { return r.id; });
  assert.strictEqual(new Set(ids).size, 26);
  for (var i = 0; i < 26; i++) assert.strictEqual(ids[i], (i + 1 < 10 ? '0' : '') + (i + 1));
});

// 每条发布内容必须被真实使用：抽查发布内容的关键词是否保留在 raw 中
var KEYWORDS = {
  '01': ['9月24日22:00报名截止', '零基础可参加'],
  '02': ['9月19日19:00', '无需报名', '预计90分钟'],
  '03': ['每周需稳定投入4小时以上', '需提交简短自我介绍'],
  '04': ['直播已结束', '预计9月20日上传回放'],
  '05': ['9月27日8:30—17:00', '9月20日12:00报名截止'],
  '06': ['每周三19:30', '限30人', '满员即止'],
  '07': ['意向登记不等同于最终作品提交', '10月20日提交作品'],
  '08': ['面向大一、大二学生', '长期招募，满员即止'],
  '09': ['首次训练改为9月21日19:30', '地点改至实验楼A402', '报名截止时间不变'],
  '10': ['9月19日15:00—16:30', '线下A201并同步线上直播'],
  '11': ['论文检索、学生科研项目和导师联系方法'],
  '12': ['具体费用信息未提供'],
  '13': ['仅限大二及以上学生'],
  '14': ['提交报名表不代表最终录取'],
  '15': ['9月23日23:59前提交创意方案', '9月30日前提交最终作品'],
  '16': ['有摄影设备者优先但不作硬性要求'],
  '17': ['网盘提取信息有效至9月22日'],
  '18': ['首次交流时间为9月19日19:30', '之后每两周开展一次'],
  '19': ['如现场仍有余位，可接受候补入场'],
  '20': ['开发方向名额已满', '此前已投递者无需重复提交'],
  '21': ['计算机学院发布', '明德楼B203'],
  '22': ['费用AA', '场地待最终确认'],
  '23': ['报名后拉群', '具体地点未确定'],
  '24': ['零门槛、日结', '要求添加私人微信获取详情'],
  '25': ['正文主要介绍某商家优惠及购买链接'],
  '26': ['外国语学院发布', '无需提前报名']
};

ok('26 条发布内容逐条保留关键信息（raw 未被改写/删减）', function () {
  Object.keys(KEYWORDS).forEach(function (id) {
    var rec = DATA.filter(function (r) { return r.id === id; })[0];
    assert.ok(rec, '缺少 ' + id);
    KEYWORDS[id].forEach(function (kw) {
      assert.ok(rec.raw.indexOf(kw) >= 0, id + ' 发布内容里缺少「' + kw + '」');
    });
  });
});

ok('解析出的日期都能在发布内容里找到对应「X月Y日」', function () {
  DATA.forEach(function (r) {
    // 例外：01/03 的有效时间来自 09/20 补充通知；09/20 是通知本身，日期可能继承自被通知的条目
    if ((r.flags || []).indexOf('superseded') >= 0 || r.kind === 'notice') return;
    var ats = [];
    if (r.deadline.known && r.deadline.at) ats.push(r.deadline.at);
    (r.milestones || []).forEach(function (m) { ats.push(m.at); });
    if (r.when.known && r.when.start) ats.push(r.when.start);
    if (r.when.known && r.when.date) ats.push(r.when.date);
    ats.forEach(function (at) {
      var d = L.parseISO(at);
      var md = (d.getMonth() + 1) + '月' + d.getDate() + '日';
      assert.ok(r.raw.indexOf(md) >= 0, r.id + ' 解析出 ' + md + ' 但发布内容里未出现该日期');
    });
  });
});

ok('来源分层计数正确（学院 2 / 学生个人 4 / 校内推断 3 / 未注明 17）', function () {
  var s = L.stats(DATA, L.parseISO(META.defaultNow));
  assert.strictEqual(s.bySource['学院发布'], 2);
  assert.strictEqual(s.bySource['学生个人发布'], 4);
  assert.strictEqual(s.bySource['校内主办（推断）'], 3);
  assert.strictEqual(s.bySource['来源未注明'], 17);
});

ok('缺失字段保持「未注明」（null），没有被猜出来的值', function () {
  var byId = function (id) { return DATA.filter(function (r) { return r.id === id; })[0]; };
  assert.strictEqual(byId('12').fee, null, '12 费用发布者未提供（原文如此），必须为 null');
  assert.strictEqual(byId('06').deadline.at, null, '06 报名时间未注明，不能编一个截止时间');
  assert.strictEqual(byId('16').deadline.at, null, '16 截止时间未注明');
  assert.strictEqual(byId('23').where.text, null, '23 地点未确定');
  assert.strictEqual(byId('24').source.publisher, null, '24 未提供主办方');
  assert.strictEqual(byId('17').fee, null, '17 未提供费用信息');
});

ok('风险与不适用新生标记已落到对应条目', function () {
  var risky = DATA.filter(function (r) { return r.flags.indexOf('risk_low_trust') >= 0; }).map(function (r) { return r.id; });
  assert.deepStrictEqual(risky, ['24', '25']);
  var notFor = DATA.filter(function (r) { return r.flags.indexOf('not_for_freshman') >= 0; }).map(function (r) { return r.id; });
  assert.deepStrictEqual(notFor, ['13']);
});

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
