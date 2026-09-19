/* 校园机会雷达 · 交互层
 * 无第三方依赖、无网络请求；所有数据来自 js/data.js（题目提供的校园信息 01–26）
 * 本机发布/收藏/引导状态存 localStorage，读写失败会降级为内存并提示。
 */
(function () {
  'use strict';

  var D = window.CampusData, L = window.CampusLogic, META = D.META;
  var DAY_MS = 86400000;

  /* =============== 1. 存储 =============== */
  var STORE = {
    prefix: 'radar.v1.',
    ok: true,
    read: function (k, dflt) {
      try {
        var raw = window.localStorage.getItem(this.prefix + k);
        return raw === null ? dflt : JSON.parse(raw);
      } catch (e) { this.ok = false; return dflt; }
    },
    write: function (k, v) {
      try { window.localStorage.setItem(this.prefix + k, JSON.stringify(v)); return true; }
      catch (e) { this.ok = false; return false; }
    }
  };
  (function probe() {
    try { window.localStorage.setItem(STORE.prefix + 'probe', '1'); window.localStorage.removeItem(STORE.prefix + 'probe'); }
    catch (e) { STORE.ok = false; }
  })();

  /* =============== 2. 术语小词典（通用词义，非题目信息） =============== */
  var GLOSSARY = {
    '意向登记': '先表达参加意愿的「预报名」，通常不等于正式报名，更不等于提交作品。',
    '候补': '报名已满后的排队名单；有人退出才能补上，有时也指现场余位先到先得。',
    '满员即止': '没有固定截止时间，人数招够就停，所以越早联系越稳。',
    'AA': '费用平摊，各自付自己那一份。',
    '搭子': '网络用语，指一起做某件事的伙伴，通常是松散的、非正式的组合。',
    'CTF': 'Capture The Flag，网络安全夺旗赛，一种信息安全竞赛形式。',
    '路演': '项目团队上台公开展示成果、争取资源的汇报形式。',
    '网盘提取': '通过网盘分享链接下载资料，通常需要提取码，分享可能过期失效。',
    '审核': '主办方筛选并确认名单，提交报名表之后仍可能不被录取。',
    '志愿服务': '无偿参与的公益活动，部分学校可计入志愿服务时长。'
  };
  function decorate(escapedText) {
    var terms = Object.keys(GLOSSARY).map(function (t) { return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); });
    var re = new RegExp('(' + terms.join('|') + ')', 'g');
    return String(escapedText).replace(re, function (m) {
      return '<button type="button" class="term" data-action="term" data-term="' + m + '">' + m + '</button>';
    });
  }

  /* =============== 3. 工具函数 =============== */
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function $(sel, rootEl) { return (rootEl || document).querySelector(sel); }
  function $$(sel, rootEl) { return Array.prototype.slice.call((rootEl || document).querySelectorAll(sel)); }
  function uniq(a) { return a.filter(function (v, i) { return a.indexOf(v) === i; }); }
  function toggleIn(arr, v) { var i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); else arr.push(v); }
  function sourceClass(rec) {
    var b = L.sourceBucket(rec);
    if (b === '学院发布') return 'b-college';
    if (b === '学生个人发布') return 'b-student';
    if (b === '校内主办（推断）') return 'b-school';
    return 'b-unknown';
  }
  function sourceBadge(rec) {
    var b = L.sourceBucket(rec);
    var title = rec.source.type === '学院' ? '发布单位：' + rec.source.publisher
      : (rec.source.basis === '据标题推断' ? '未写明发布单位，仅据标题表述推断为校内主办'
        : (rec.source.type === '学生个人' ? '学生个人发布，未经校方审核' : '未写明发布单位'));
    return '<span class="badge ' + sourceClass(rec) + '" title="' + esc(title) + '">' + esc(b) + '</span>';
  }
  function freshBadge(rec) {
    var lv = rec.freshman.level;
    var cls = lv === '适合' ? 'b-good' : (lv === '一般' ? 'b-outline' : (lv === '不适合' ? 'b-unknown' : 'b-danger'));
    var text = lv === '适合' ? '适合新生' : (lv === '一般' ? '新生可选' : (lv === '不适合' ? '新生暂不符合' : '需谨慎'));
    return '<span class="badge ' + cls + '" title="' + esc(rec.freshman.why || '') + '">' + text + '</span>';
  }
  function stateBadges(rec, now) {
    var st = L.stateOf(rec, now);
    var map = { good: 'b-good', warn: 'b-warn', danger: 'b-danger', muted: 'b-unknown', normal: 'b-outline', live: 'b-live' };
    var out = '<span class="badge ' + (map[st.signup.tone] || 'b-outline') + '">' + esc(st.signup.label) + '</span>';
    if (st.event.code !== 'no_time') {
      out += '<span class="badge ' + (map[st.event.tone] || 'b-outline') + '">' + esc(st.event.label) + '</span>';
    }
    return out;
  }

  /* =============== 4. 本机发布的数据 → 与题目条目同构的记录 =============== */
  var published = STORE.read('published', []);
  var favorites = STORE.read('favorites', []);

  function buildLocalRecord(p) {
    var start = p.date ? (p.date + 'T' + (p.startTime || '00:00')) : null;
    var end = (p.date && p.endTime) ? (p.date + 'T' + p.endTime) : null;
    var timeKnown = !!(p.date && p.startTime);
    var dlAt = p.deadlineDate ? (p.deadlineDate + (p.deadlineTime ? 'T' + p.deadlineTime : '')) : null;
    var unknownLoc = !p.location;
    var tips = [];
    if (unknownLoc) tips.push('发布者没有填写地点，去之前请先向发起人确认。');
    if (!p.deadlineDate) tips.push('没有填写报名截止时间，属于先到先得或随时联系。');
    if (p.selfCheck && p.selfCheck.indexOf('noPrivateWechat') >= 0) tips.push('发布者已自查确认：不要求他人添加私人微信或转账。');
    if (p.selfCheck && p.selfCheck.indexOf('titleMatch') >= 0) tips.push('发布者已自查确认：标题与内容一致，不含商家推广链接。');
    return {
      id: p.id, local: true,
      title: p.title,
      raw: p.note || '（本机发布内容，发布者未填写补充说明）',
      kind: 'activity',
      source: { type: '学生个人', publisher: null, basis: '本机发布', hint: '本机发布·未经校方审核' },
      category: p.category,
      audience: p.audience || '未注明',
      freshman: { level: p.freshman || '一般', why: p.why || '由本机发布者填写，未说明是否适合新生' },
      oneLiner: (p.date ? L.fmtDate(L.parseISO(p.date)) : '时间待定') +
        (p.startTime ? ' ' + p.startTime : '') +
        (p.location ? ' · ' + p.location : ' · 地点未填写') +
        '；报名方式：' + (p.signup || '未填写'),
      when: {
        date: p.date || null, start: start, end: end, timeKnown: timeKnown, known: !!p.date,
        text: p.date ? (L.fmtDate(L.parseISO(p.date)) + (p.startTime ? ' ' + p.startTime : '（时间未填写）')) : '发布时间者未填写日期',
        recurring: null, recur: null
      },
      where: { text: p.location || null, known: !!p.location, note: unknownLoc ? '发布者未填写地点' : null },
      deadline: dlAt
        ? { at: dlAt, dateOnly: !p.deadlineTime, text: (p.deadlineTime ? p.deadlineDate + ' ' + p.deadlineTime : p.deadlineDate), kind: '硬截止', known: true }
        : { at: null, dateOnly: false, text: '发布者未填写截止时间（可视为满员即止）', kind: '满员即止', known: false },
      milestones: [], signup: p.signup || '未填写',
      fee: p.fee || null, quota: p.quota || null, commitment: p.commitment || null, materials: [],
      flags: ['student_posted'], related: [], tips: tips,
      unknowns: unknownLoc ? [{ what: '活动地点', ask: '向发布者确认集合地点' }] : [],
      publishedAt: p.createdAt || null
    };
  }

  function allRecords() {
    return D.DATA.concat(published.map(buildLocalRecord));
  }
  function findRecord(id) {
    return allRecords().filter(function (r) { return r.id === id; })[0] || null;
  }

  /* =============== 5. 状态 =============== */
  var state = {
    q: '', source: [], category: [], quick: [], window: 'all', sort: 'recommend',
    view: 'cards', hideNotices: false, id: null, day: null, panel: null,
    offsetDays: STORE.read('clockOffsetDays', 0) || 0
  };

  /* 时间基准 = 电脑系统时间；±N 天只是演示偏移。
     题目没写年份，这里把日期年份绑定到系统年份，否则换一年打开会全部显示「已结束」。 */
  function now() {
    var d = new Date(new Date().getTime() + state.offsetDays * DAY_MS);
    L.setYear(d.getFullYear());
    return d;
  }
  function nowLabel() {
    var n = now();
    return n.getFullYear() + '年' + L.fmtDate(n) + ' ' + L.weekdayOf(n) + ' ' + L.fmtTime(n);
  }

  /* =============== 6. hash 同步 =============== */
  var lastHash = '';
  function parseHash() {
    var h = String(location.hash || '').replace(/^#/, '');
    var out = {};
    h.split('&').forEach(function (kv) {
      if (!kv) return;
      var i = kv.indexOf('=');
      if (i < 0) return;
      out[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1));
    });
    return out;
  }
  function readHash() {
    var o = parseHash();
    if (o.q !== undefined) state.q = o.q;
    if (o.src) state.source = o.src.split(',').filter(Boolean);
    if (o.cat) state.category = o.cat.split(',').filter(Boolean);
    if (o.quick) state.quick = o.quick.split(',').filter(Boolean);
    if (o.win !== undefined) state.window = o.win || 'all';
    if (o.sort) state.sort = o.sort;
    if (o.view) state.view = o.view;
    if (o.hide === '1') state.hideNotices = true;
    if (o.id) state.id = o.id;
    if (o.day) state.day = o.day;
    if (o.panel) state.panel = o.panel;
  }
  function writeHash(push) {
    var parts = [];
    function add(k, v) { if (v !== '' && v !== null && v !== undefined && !(Array.isArray(v) && !v.length)) parts.push(k + '=' + encodeURIComponent(v)); }
    add('q', state.q);
    add('src', state.source);
    add('cat', state.category);
    add('quick', state.quick);
    add('win', state.window === 'all' ? '' : state.window);
    add('sort', state.sort === 'recommend' ? '' : state.sort);
    add('view', state.view === 'cards' ? '' : state.view);
    add('hide', state.hideNotices ? '1' : '');
    add('id', state.id || '');
    add('day', state.day || '');
    add('panel', state.panel || '');
    var url = location.pathname + location.search + (parts.length ? '#' + parts.join('&') : '');
    try { (push ? history.pushState : history.replaceState).call(history, null, '', url); }
    catch (e) { try { location.hash = parts.join('&'); } catch (e2) { /* file:// 下忽略 */ } }
    lastHash = location.hash;
  }

  /* =============== 7. 筛选结果 =============== */
  function currentResults() {
    var n = now();
    var recs = allRecords();
    var list = L.applyFilters(recs, {
      q: state.q, source: state.source, category: state.category,
      quick: state.quick, window: state.window, hideNotices: state.hideNotices
    }, n);
    if (state.day) {
      list = list.filter(function (r) {
        return L.entriesOf(r).some(function (e) { return e.date === state.day; });
      });
    }
    return L.sortRecords(list, state.sort, n);
  }

  function activeFilterCount() {
    return (state.q ? 1 : 0) + state.source.length + state.category.length + state.quick.length +
      (state.window !== 'all' ? 1 : 0) + (state.hideNotices ? 1 : 0) + (state.day ? 1 : 0);
  }

  /* =============== 8. 渲染：时间基准 + 首屏 =============== */
  function renderBasis() {
    var n = now();
    var off = state.offsetDays;
    var offText = off === 0 ? '电脑系统时间' : (off > 0 ? '演示：+ ' + off + ' 天' : '演示：- ' + (-off) + ' 天');
    $('#clockLabel').innerHTML = '<strong>' + esc(nowLabel()) + '</strong> <span class="badge b-brand">' + offText + '</span>';
    $('#clockNote').textContent = '所有「报名中 / 即将截止 / 已结束」都按电脑系统时间实时重算；题目信息只写了月日（' +
      META.infoWindow + '），年份按你电脑的年份呈现。';
    $('#clockBack').disabled = off <= -1;
    $('#clockFwd').disabled = off >= 20;
    var resetBtn = $('#clockReset');
    if (resetBtn) resetBtn.disabled = off === 0;
  }

  function todaysCards(n) {
    var today = L.ymd(n);
    var recs = allRecords().filter(function (r) {
      return L.entriesOf(r).some(function (e) { return e.date === today && e.kind === 'session'; });
    });
    recs.sort(function (a, b) {
      var ea = L.entriesOf(a).filter(function (e) { return e.date === today && e.kind === 'session'; })[0];
      var eb = L.entriesOf(b).filter(function (e) { return e.date === today && e.kind === 'session'; })[0];
      return (ea && ea.at ? ea.at : 0) - (eb && eb.at ? eb.at : 0);
    });
    return recs;
  }

  function renderHero() {
    var n = now();
    var today = L.ymd(n);
    var recs = todaysCards(n);
    var host = $('#today');
    $('#todayTitle').textContent = L.fmtDate(n) + ' ' + L.weekdayOf(n) + '：今天可以做什么（共 ' + recs.length + ' 场）';

    if (!recs.length) {
      // 系统日期不一定落在题目信息的区间里（9月18日—10月28日），这里给出定位提示
      var sess = [];
      allRecords().forEach(function (r) {
        L.entriesOf(r).forEach(function (e) { if (e.at) sess.push(e.at); });
      });
      sess.sort(function (a, b) { return a - b; });
      var hint = '';
      if (sess.length) {
        var upcoming = sess.filter(function (d) { return d.getTime() >= L.startOfDay(n).getTime(); })[0];
        hint = upcoming
          ? '题目信息集中在 ' + L.fmtDate(sess[0]) + '—' + L.fmtDate(sess[sess.length - 1]) + '；最近的一项是 ' +
            L.fmtDateTime(upcoming) + '（' + L.relDay(upcoming, n).text + '）。'
          : '题目信息集中在 ' + L.fmtDate(sess[0]) + '—' + L.fmtDate(sess[sess.length - 1]) +
            '，按你电脑的系统时间都已经过去了；可以用上方的「- 1 天」把基准往回拨，回看当天情形。';
      }
      host.innerHTML = '<div class="empty"><strong>今天（' + L.fmtDate(n) + ' ' + L.weekdayOf(n) + '）题目信息里没有写明的活动</strong>' +
        hint + '<div class="small" style="margin-top:6px">可以改用「近 3 天 / 近 7 天」筛选，或直接看下面的完整列表。</div></div>';
    } else {
      host.innerHTML = '<div class="todaybox">' + recs.map(function (r) {
        var es = L.eventState(r, n);
        var en = L.entriesOf(r).filter(function (e) { return e.date === today && e.kind === 'session'; })[0];
        var timeText = en && en.allDay ? '时间未注明' : L.fmtTime(en.at);
        return '' +
          '<article class="todaycard">' +
          '  <div class="t">' + esc(timeText) + ' · ' + esc(r.title) + '</div>' +
          '  <div class="meta">' + esc(r.where.known ? r.where.text : '地点未注明') + ' · ' + esc(r.audience) + '</div>' +
          '  <div class="badges" style="margin-top:8px">' + sourceBadge(r) + stateBadges(r, n) + '</div>' +
          '  <div class="why">' + decorate(esc(r.freshman.why)) + '</div>' +
          '  <div class="pill-row" style="margin-top:10px">' +
          '    <button class="btn sm primary" data-action="open" data-id="' + r.id + '">看详情</button>' +
          '    <button class="btn sm" data-action="toggle-fav" data-id="' + r.id + '">' + (favorites.indexOf(r.id) >= 0 ? '★ 已在日程' : '☆ 加入我的日程') + '</button>' +
          '  </div>' +
          '</article>';
      }).join('') + '</div>';
    }

    /* 提醒条 */
    var alerts = [];
    var conf = L.detectConflicts(allRecords());
    var todayConf = conf.groups.filter(function (g) { return g.date === today; });
    todayConf.forEach(function (g) {
      var names = g.ids.map(function (id) { var r = findRecord(id); return id + ' ' + r.title; });
      alerts.push({
        kind: 'warn', icon: '⚠',
        html: '<div><strong>今晚时间重叠：</strong>' + esc(g.ids.join(' / ')) + ' ' + esc(g.note || '') +
          '<div class="small" style="margin-top:4px">' + names.map(esc).join('　·　') + '</div>' +
          '<div class="small" style="margin-top:4px">建议：选一个「不用报名、时长明确」的先参加（如 02，19:00 起约 90 分钟），另一个下次再去。</div></div>'
      });
    });

    /* 48 小时内截止 */
    var closing = allRecords().filter(function (r) {
      var st = L.signupState(r, n);
      return st.code === 'closing_soon';
    });
    if (closing.length) {
      alerts.push({
        kind: 'danger', icon: '⏰',
        html: '<div><strong>48 小时内截止报名：</strong>' +
          closing.map(function (r) { return esc(r.id + ' ' + r.title + '（' + r.deadline.text + '）'); }).join('；') +
          '<div class="small" style="margin-top:4px">错过就要等下一年或下一次，别拖。</div></div>'
      });
    }

    /* 明天很满 */
    var tomorrow = L.ymd(L.addDays(n, 1));
    var tm = L.dayLoad(allRecords()).filter(function (d) { return d.date === tomorrow; })[0];
    if (tm && (tm.sessions.length + tm.deadlines.length + tm.milestones.length) >= 3) {
      alerts.push({
        kind: 'info', icon: '📌',
        html: '<div><strong>明天（' + esc(tm.label) + '）安排很密：</strong>' +
          esc(tm.sessions.length + ' 场活动、' + tm.deadlines.length + ' 个报名截止' + (tm.milestones.length ? '、' + tm.milestones.length + ' 个节点' : '')) +
          '<div class="small" style="margin-top:4px">' + tm.sessions.map(function (s) { return esc(L.fmtTime(s.at) + ' ' + (findRecord(s.id) || {}).title); }).join('　·　') + '</div></div>'
      });
    }

    /* 变更通知 */
    var notices = allRecords().filter(function (r) { return r.kind === 'notice'; });
    if (notices.length) {
      alerts.push({
        kind: 'info', icon: '🔔',
        html: '<div><strong>有 ' + notices.length + ' 条变更/补充通知：</strong>' +
          notices.map(function (r) { return esc(r.id + ' ' + r.title + '（对应 ' + r.related.map(function (x) { return x.id; }).join('、') + ' 号）'); }).join('；') +
          '<div class="small" style="margin-top:4px">只看原条目会错过时间/地点/名额的变化，点开卡片看「关联变更」。</div></div>'
      });
    }

    if (!STORE.ok) {
      alerts.unshift({ kind: 'warn', icon: '💾', html: '<div><strong>本机存储不可用：</strong>收藏与发布只在当前页面有效，刷新后会丢失（浏览器限制，不影响浏览题目数据）。</div>' });
    }

    $('#alerts').innerHTML = alerts.map(function (a) {
      return '<div class="alert ' + a.kind + '"><span class="ic">' + a.icon + '</span>' + a.html + '</div>';
    }).join('');
  }

  /* =============== 9. 渲染：筛选工具条 =============== */
  var QUICKS = ['适合新生', '直接去', '还能报名', '不占固定时间', '需谨慎的'];
  var WINDOWS = [['all', '全部时间'], ['today', '今天'], ['tomorrow', '明天'], ['3d', '近 3 天'], ['week', '近 7 天']];
  var SORTS = [['recommend', '推荐'], ['deadline', '最紧急'], ['time', '按时间'], ['id', '按编号']];
  var VIEWS = [['cards', '卡片流'], ['timeline', '时间线'], ['calendar', '月历'], ['raw', '发布内容对照']];

  function chip(attr, value, label, pressed, count) {
    return '<button class="chip" data-action="' + attr + '" data-value="' + esc(value) + '" aria-pressed="' + (pressed ? 'true' : 'false') + '">' +
      esc(label) + (count !== undefined ? '<span class="n">' + count + '</span>' : '') + '</button>';
  }

  function renderToolbar() {
    var n = now();
    var recs = allRecords();
    var qEl = $('#q');
    if (qEl.value !== state.q) qEl.value = state.q;

    $('#quickRow').innerHTML = QUICKS.map(function (q) {
      var cnt = L.applyFilters(recs, { quick: [q] }, n).length;
      return chip('toggle-quick', q, q, state.quick.indexOf(q) >= 0, cnt);
    }).join('') + chip('clear-all', '', '清空筛选', false);

    var buckets = ['学院发布', '学生个人发布', '校内主办（推断）', '来源未注明'];
    $('#sourceRow').innerHTML = buckets.map(function (b) {
      var cnt = L.applyFilters(recs, { source: [b] }, n).length;
      return chip('toggle-source', b, b, state.source.indexOf(b) >= 0, cnt);
    }).join('');

    var cats = L.ALLOWED.category;
    $('#catRow').innerHTML = cats.map(function (c) {
      var cnt = L.applyFilters(recs, { category: [c] }, n).length;
      return cnt ? chip('toggle-category', c, c, state.category.indexOf(c) >= 0, cnt) : '';
    }).join('');

    $('#winRow').innerHTML = WINDOWS.map(function (w) {
      return chip('set-window', w[0], w[1], state.window === w[0]);
    }).join('');

    $('#sortSeg').innerHTML = SORTS.map(function (s) {
      return '<button data-action="set-sort" data-value="' + s[0] + '" aria-pressed="' + (state.sort === s[0]) + '">' + s[1] + '</button>';
    }).join('');
    $('#viewSeg').innerHTML = VIEWS.map(function (v) {
      return '<button data-action="set-view" data-value="' + v[0] + '" aria-pressed="' + (state.view === v[0]) + '">' + v[1] + '</button>';
    }).join('');
    $('#hideNotices').checked = state.hideNotices;
  }

  /* =============== 10. 渲染：结果区 =============== */
  function cardHtml(r, n) {
    var risky = r.flags.indexOf('risk_low_trust') >= 0;
    var cls = 'card' + (risky ? ' risk' : '') + (r.kind === 'notice' ? ' notice' : '') + (favorites.indexOf(r.id) >= 0 ? ' fav' : '');
    var tags = L.tagList(r).map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join('');
    var u = L.urgencyOf(r, n);
    return '' +
      '<article class="' + cls + '" data-id="' + esc(r.id) + '" tabindex="0" aria-label="' + esc(r.id + ' ' + r.title) + '">' +
      '  <div class="top">' +
      '    <span class="id">' + esc(r.id) + '</span>' +
      '    <h3>' + esc(r.title) + '</h3>' +
      '    <button class="stars" data-action="toggle-fav" data-id="' + esc(r.id) + '" aria-pressed="' + (favorites.indexOf(r.id) >= 0) + '" title="加入我的日程" aria-label="加入我的日程">★</button>' +
      '  </div>' +
      '  <div class="badges">' + sourceBadge(r) + freshBadge(r) + stateBadges(r, n) +
      (r.kind === 'notice' ? '<span class="badge b-live">变更通知</span>' : '') +
      (risky ? '<span class="badge b-danger">需谨慎</span>' : '') +
      (r.local ? '<span class="badge b-student">本机发布·未审核</span>' : '') + '</div>' +
      '  <div class="oneline">' + decorate(esc(r.oneLiner)) + '</div>' +
      (r.kind === 'notice' ? '<div class="small muted">变更通知不单独占用日历：请以它更新后的 <strong>' + esc(r.related.map(function (x) { return x.id; }).join('、')) + '</strong> 号条目时间为准。</div>' : '') +
      '  <div class="tags">' + tags + '</div>' +
      '  <div class="foot">' +
      '    <span class="small muted">' + esc(u.text) + '</span>' +
      '    <span class="spacer"></span>' +
      '    <button class="btn sm" data-action="open" data-id="' + esc(r.id) + '">看详情</button>' +
      '  </div>' +
      '</article>';
  }

  function renderCards(list, n) {
    return '<div class="cards">' + list.map(function (r) { return cardHtml(r, n); }).join('') + '</div>';
  }

  function renderTimeline(list, n) {
    var map = {};
    var ids = {};
    list.forEach(function (r) {
      ids[r.id] = r;
      L.entriesOf(r).forEach(function (e) {
        // 由月历点选某天时，时间线只呈现那一天，不把该条目的其他日期也画出来
        if (state.day && e.date !== state.day) return;
        (map[e.date] = map[e.date] || []).push({ e: e, r: r });
      });
    });
    var conf = L.detectConflicts(allRecords());
    var loads = {};
    L.dayLoad(allRecords()).forEach(function (d) { loads[d.date] = d; });
    var dates = Object.keys(map).sort();
    if (!dates.length) return emptyHtml();
    return '<div class="tl">' + dates.map(function (date) {
      var day = L.parseISO(date);
      var load = loads[date] || { busy: false };
      var cg = conf.groups.filter(function (g) { return g.date === date; });
      var items = map[date].sort(function (a, b) {
        return (a.e.at ? a.e.at.getTime() : 0) - (b.e.at ? b.e.at.getTime() : 0);
      });
      return '' +
        '<section class="tlday">' +
        '<header>' +
        '  <span class="d">' + esc(L.fmtDate(day) + ' ' + L.weekdayOf(day)) + (date === L.ymd(n) ? '（今天）' : '') + '</span>' +
        '  <span class="badge b-outline">' + items.length + ' 项</span>' +
        (load.busy ? '<span class="badge b-warn" title="按全部条目计算：当天活动 ≥3 场，或 ≥2 场且有报名截止">这天很满</span>' : '') +
        (cg.length ? '<span class="badge b-danger">时间冲突 ' + cg[0].ids.join('/') + '</span>' : '') +
        '</header>' +
        '<ul>' + items.map(function (it) {
          var e = it.e;
          var kindCls = e.kind === 'deadline' ? 'k-deadline' : (e.kind === 'milestone' ? 'k-milestone' : '');
          var kindLabel = e.kind === 'deadline' ? '截止' : (e.kind === 'milestone' ? '节点' : '活动');
          var timeText = e.allDay ? '时间未注明' : L.fmtTime(e.at);
          return '<li class="' + kindCls + '">' +
            '<span class="time' + (e.allDay ? ' allday' : '') + '">' + esc(timeText) + '</span>' +
            '<span class="body"><span class="badge b-outline">' + kindLabel + '</span> ' +
            '<span class="n" data-action="open" data-id="' + esc(it.r.id) + '">' + esc(it.r.id + ' ' + it.r.title) + '</span>' +
            (e.derived ? '<span class="badge b-warn">推算</span>' : '') +
            '<div class="small muted">' + decorate(esc(e.label)) + (e.derived && e.derivedNote ? ' · ' + esc(e.derivedNote) : '') + '</div>' +
            '</span></li>';
        }).join('') + '</ul></section>';
    }).join('') + '</div>';
  }

  function renderCalendar(list, n) {
    var ids = {};
    list.forEach(function (r) { ids[r.id] = r; });
    var days = {};
    list.forEach(function (r) {
      L.entriesOf(r).forEach(function (e) {
        var d = days[e.date] = days[e.date] || { session: 0, deadline: 0, milestone: 0, titles: [] };
        d[e.kind] = (d[e.kind] || 0) + 1;
        if (d.titles.length < 2) d.titles.push(r.id + ' ' + r.title);
      });
    });
    var loads = {};
    L.dayLoad(allRecords()).forEach(function (d) { loads[d.date] = d; });
    // 月份跟随绑定年份（= 电脑系统年份），不能写死，否则年份一变日历上就什么都没有
    var calYear = n.getFullYear();
    var months = [[calYear, 8], [calYear, 9]];
    var heads = ['日', '一', '二', '三', '四', '五', '六'];
    var todayYmd = L.ymd(n);

    var html = '<div class="cals">' + months.map(function (m) {
      var y = m[0], mo = m[1];
      var first = new Date(y, mo, 1);
      var last = new Date(y, mo + 1, 0);
      var cells = [];
      for (var i = 0; i < first.getDay(); i++) cells.push('<div class="cell out"></div>');
      for (var d = 1; d <= last.getDate(); d++) {
        var dt = new Date(y, mo, d);
        var key = L.ymd(dt);
        var info = days[key];
        var load = loads[key];
        var focused = list.some(function (r) { return L.entriesOf(r).some(function (e) { return e.date === key; }); });
        var cls = 'cell' + (key === todayYmd ? ' today' : '') + (state.day === key ? ' sel' : '') + (load && load.busy ? ' busy' : '') + (info ? '' : ' out');
        var dots = '';
        if (info) {
          if (info.session) dots += '<span class="dot" title="活动 ' + info.session + ' 场"></span>';
          if (info.deadline) dots += '<span class="dot deadline" title="报名截止 ' + info.deadline + ' 个"></span>';
          if (info.milestone) dots += '<span class="dot milestone" title="节点 ' + info.milestone + ' 个"></span>';
        }
        cells.push('<button class="' + cls + '" data-action="pick-day" data-value="' + key + '"' + (info ? '' : ' disabled') + '>' +
          '<span class="dnum">' + d + '</span>' +
          '<span class="dots">' + dots + '</span>' +
          (info && info.titles.length ? '<span class="mini">' + esc(info.titles[0]) + '</span>' : '') +
          '</button>');
      }
      return '<section class="cal"><h3>' + calYear + ' 年 ' + (mo + 1) + ' 月' + (first.getMonth() === 8 ? '（开学季）' : '（竞赛/提交节点）') + '</h3>' +
        '<div class="calgrid">' + heads.map(function (h) { return '<div class="wd">' + h + '</div>'; }).join('') + cells.join('') + '</div></section>';
    }).join('') + '</div>' +
      '<div class="legend">' +
      '<span><i style="background:var(--brand)"></i>活动场次</span>' +
      '<span><i style="background:#e08a00"></i>报名截止</span>' +
      '<span><i style="background:var(--live)"></i>作品/回放等节点</span>' +
      '<span><i style="background:#fff7f2;border:1px solid var(--line)"></i>这天很满（按全部 26 条计算，不受筛选影响）</span>' +
      '<span>点击有安排的日期，只看那天</span>' +
      '</div>';
    return html;
  }

  function renderRawTable(list, n) {
    // 这是核对性视图：固定按编号 01–26 排序，便于逐条对照发布内容（不受排序选择影响，页面已注明）
    var rows = list.slice().sort(function (a, b) { return String(a.id).localeCompare(String(b.id)); }).map(function (r) {
      var st = L.stateOf(r, n);
      return '<tr>' +
        '<td class="num">' + esc(r.id) + '</td>' +
        '<td class="raw">' + decorate(esc(r.raw)) + '</td>' +
        '<td class="small">' + esc(r.title) + '<br>' + sourceBadge(r) + '</td>' +
        '<td class="small">' + esc(st.signup.label) + '</td>' +
        '<td><button class="btn sm" data-action="open" data-id="' + esc(r.id) + '">详情</button></td>' +
        '</tr>';
    }).join('');
    return '<div class="rawtable"><table><thead><tr>' +
      '<th>编号</th><th>发布内容（逐字照录，未改写）</th><th>条目</th><th>当前报名状态</th><th></th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="small muted" style="margin-top:8px">本视图把 26 条发布内容与产品解析并排放置，便于核对「产品是否真的用了题目给的校园信息」；表格固定按编号 01–26 排序，不受上方排序影响。</p>';
  }

  function emptyHtml() {
    return '<div class="empty"><strong>没有符合条件的内容</strong>' +
      '当前筛选共 ' + activeFilterCount() + ' 个条件。可以试试：放宽时间范围、清空来源/类别筛选，或者直接点「清空筛选」。' +
      '<div style="margin-top:12px"><button class="btn primary" data-action="clear-all">清空筛选</button></div></div>';
  }

  function renderResults() {
    var n = now();
    var list = currentResults();
    var total = allRecords().length;
    $('#resultCount').textContent = '找到 ' + list.length + ' / ' + total + ' 条';
    $('#resultNote').textContent = state.day ? '（只看 ' + state.day + '）' : (state.window !== 'all' ? '' : '');
    var host = $('#results');
    if (!list.length) { host.innerHTML = emptyHtml(); return; }
    if (state.view === 'timeline') host.innerHTML = renderTimeline(list, n);
    else if (state.view === 'calendar') host.innerHTML = renderCalendar(list, n);
    else if (state.view === 'raw') host.innerHTML = renderRawTable(list, n);
    else host.innerHTML = renderCards(list, n);
  }

  /* =============== 11. 详情抽屉 =============== */
  function stepsOf(rec) {
    var s = [];
    var d = rec.deadline || {};
    if (d.known && d.at) {
      var at = L.parseISO(d.at);
      s.push('报名/提交：' + (d.dateOnly ? L.fmtDate(at) : L.fmtDateTime(at)) + ' 前完成' + (rec.signup && !isUnknownText(rec.signup) ? '（' + rec.signup + '）' : ''));
    } else if (d.kind === '无需报名') s.push('不用报名：按活动时间直接到场');
    else if (d.kind === '长期招募' || d.kind === '满员即止') s.push('没有固定截止时间：尽早联系，满员即止');
    else s.push('报名时间发布者没有写明：先向主办方确认');
    if (rec.when.known && rec.when.start) {
      var st = L.parseISO(rec.when.start);
      s.push('参加：' + L.fmtDateTime(st) + ' ' + L.weekdayOf(st) + '，' + (rec.where.known ? '地点 ' + rec.where.text : '地点未注明'));
    } else if (rec.when.known) {
      s.push('参加：' + rec.when.text);
    } else {
      s.push('时间：发布者没有写明（多为项目制或长期开放）');
    }
    (rec.milestones || []).forEach(function (m) { s.push('后续节点：' + m.text); });
    return s;
  }

  /* 标红约定：所有「发布者没有提供」的字段值一律只写「未注明」，不再各写各的。
     若该字段其实有另一条规则（满员即止 / 长期招募 / 需预约）或需要提醒，
     用灰色小字补充说明——红字保持统一，信息也不丢。 */
  var UNKNOWN = '未注明';
  function isUnknownText(s) { return /未注明|未写明|未提供|未确定|没有写明|没有提供|没有注明/.test(String(s || '')); }
  function fieldRow(k, v, isUnknown, note) {
    var cell = isUnknown
      ? '<span class="unknownval">' + UNKNOWN + '</span>' + (note ? ' <span class="small muted">（' + esc(note) + '）</span>' : '')
      : decorate(esc(v));
    return '<tr><th>' + esc(k) + '</th><td>' + cell + '</td></tr>';
  }
  /** 报名截止未注明时，把「其实有另一条规则」的原因取出来做灰色补充 */
  function deadlineNote(rec) {
    var d = rec.deadline || {}, k = d.kind;
    if (k === '满员即止') return '满员即止，无截止时间';
    if (k === '长期招募') return String(d.text || '').indexOf('满员即止') >= 0 ? '长期招募，满员即止' : '长期招募';
    if (k === '预约制·需审核') return '需提前预约，提交报名表不等于录取';
    return '';
  }

  function openDetail(id, push) {
    var rec = findRecord(id);
    if (!rec) return;
    state.id = id;
    writeHash(push !== false);
    var n = now();
    var st = L.stateOf(rec, n);
    var conf = L.detectConflicts(allRecords()).groups.filter(function (g) { return g.ids.indexOf(id) >= 0; });

    var html = '' +
      '<header>' +
      '  <div style="flex:1 1 auto">' +
      '    <div class="small muted">编号 ' + esc(rec.id) + ' · ' + esc(rec.category) + (rec.local ? ' · 本机发布' : '') + '</div>' +
      '    <h2 id="drawerTitle">' + esc(rec.title) + '</h2>' +
      '    <div class="badges" style="margin-top:7px">' + sourceBadge(rec) + freshBadge(rec) + stateBadges(rec, n) +
      (rec.flags.indexOf('risk_low_trust') >= 0 ? '<span class="badge b-danger">需谨慎</span>' : '') + '</div>' +
      '  </div>' +
      '  <button class="close" data-action="close-detail" aria-label="关闭">✕ 关闭</button>' +
      '</header>' +
      '<div class="body">' +
      '  <div class="quote" style="font-size:15px">' + decorate(esc(rec.oneLiner)) + '</div>' +
      '  <div class="alert good" style="margin-top:12px"><span class="ic">🧭</span><div><strong>为什么适合/不适合你：</strong>' + decorate(esc(rec.freshman.why)) + '</div></div>' +
      '  <h3 style="margin:16px 0 6px;font-size:15px">按这三步走</h3>' +
      '  <ol class="steps">' + stepsOf(rec).map(function (s) { return '<li>' + decorate(esc(s)) + '</li>'; }).join('') + '</ol>' +
      '  <h3 style="margin:16px 0 6px;font-size:15px">信息明细（标红＝未注明：发布内容没有提供）</h3>' +
      '  <table class="fieldtable">' +
      fieldRow('时间', rec.when.known ? rec.when.text : '', !rec.when.known) +
      fieldRow('地点', rec.where.known ? rec.where.text + (rec.where.note ? '（' + rec.where.note + '）' : '') : '',
        !rec.where.known, rec.where.known ? '' : String(rec.where.note || '')) +
      fieldRow('报名截止', rec.deadline.known ? rec.deadline.text : '', !rec.deadline.known, deadlineNote(rec)) +
      fieldRow('报名方式', rec.signup, isUnknownText(rec.signup)) +
      fieldRow('面向人群', rec.audience, isUnknownText(rec.audience)) +
      fieldRow('需要投入', rec.commitment || '', !rec.commitment) +
      fieldRow('名额', rec.quota || '', !rec.quota) +
      fieldRow('费用', rec.fee || '', !rec.fee, rec.fee ? '' : '发布者未提供，可能涉及费用，先问清') +
      fieldRow('需提交材料', rec.materials && rec.materials.length ? rec.materials.join('、') : '', !(rec.materials && rec.materials.length)) +
      fieldRow('发布来源', rec.source.publisher ? rec.source.publisher + '（发布者写明）' : (rec.source.hint || ''),
        !rec.source.publisher && !rec.source.hint) +
      '</table>' +
      (conf.length ? '<h3 style="margin:16px 0 6px;font-size:15px">时间冲突提醒</h3>' +
        conf.map(function (g) {
          return '<div class="tip">⚠ ' + esc(g.label) + ' 与 ' + esc(g.ids.filter(function (x) { return x !== id; }).join('、')) + ' 时间重叠' + (g.note ? '（' + esc(g.note) + '）' : '') + '，需要二选一或提前离场。</div>';
        }).join('') : '') +
      (function () {
        var v = L.weekdayVerdict(rec, n);
        if (!v) return '';
        return '<div class="alert ' + (v.ok ? 'good' : 'warn') + '" style="margin-top:12px"><span class="ic">' +
          (v.ok ? '✓' : '⚠') + '</span><div><strong>星期口径核对：</strong>' + decorate(esc(v.text)) + '</div></div>';
      })() +
      (rec.tips && rec.tips.length ? '<h3 style="margin:16px 0 6px;font-size:15px">容易误读的点</h3>' +
        rec.tips.map(function (t) {
          var risky = rec.flags.indexOf('risk_low_trust') >= 0;
          return '<div class="tip' + (risky ? ' risk' : '') + '"><span>' + (risky ? '🚩' : '💡') + '</span><span>' + decorate(esc(t)) + '</span></div>';
        }).join('') : '') +
      (rec.unknowns && rec.unknowns.length ? '<h3 style="margin:16px 0 6px;font-size:15px">发布者没说清的，建议这样问</h3>' +
        rec.unknowns.map(function (u) {
          return '<div class="ask"><div class="small muted">未提供：' + esc(u.what) + '</div><div class="q">『' + decorate(esc(u.ask)) + '』</div></div>';
        }).join('') : '') +
      (rec.related && rec.related.length ? '<h3 style="margin:16px 0 6px;font-size:15px">关联变更</h3>' +
        rec.related.map(function (x) {
          return '<div class="ask"><div><strong>' + esc(x.id) + '</strong> ' + decorate(esc(x.rel)) +
            ' <button class="btn sm ghost" data-action="open" data-id="' + esc(x.id) + '">查看 ' + esc(x.id) + '</button></div></div>';
        }).join('') : '') +
      '  <h3 style="margin:16px 0 6px;font-size:15px">发布内容（逐字照录）</h3>' +
      '  <div class="quote small">编号 ' + esc(rec.id) + '：' + decorate(esc(rec.raw)) + '</div>' +
      '  <div class="pill-row" style="margin-top:16px">' +
      '    <button class="btn primary" data-action="toggle-fav" data-id="' + esc(rec.id) + '">' + (favorites.indexOf(rec.id) >= 0 ? '★ 已在日程' : '☆ 加入我的日程') + '</button>' +
      '    <button class="btn" data-action="copy-info" data-id="' + esc(rec.id) + '">复制活动信息</button>' +
      (rec.local ? '<button class="btn danger" data-action="delete-local" data-id="' + esc(rec.id) + '">删除这条本机发布</button>' : '') +
      '  </div>' +
      '</div>';

    var drawer = $('#drawer');
    drawer.innerHTML = html;
    drawer.classList.remove('hidden');
    $('#scrim').classList.remove('hidden');
    document.body.classList.add('no-scroll');
    $('.close', drawer).focus();
  }

  function closeDetail(keepHash) {
    state.id = null;
    $('#drawer').classList.add('hidden');
    $('#drawer').innerHTML = '';
    if (!$('.dlg')) {
      $('#scrim').classList.add('hidden');
      document.body.classList.remove('no-scroll');
    }
    if (!keepHash) writeHash(false);
  }

  /* =============== 12. 通用弹窗 =============== */
  function openDialog(id, title, bodyHtml) {
    closeDialog(id, true);
    var wrap = document.createElement('div');
    wrap.className = 'dlg';
    wrap.id = id;
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-label', title);
    wrap.innerHTML = '<div class="panel"><header><h2>' + esc(title) + '</h2>' +
      '<button class="close" data-action="close-panel" data-panel="' + esc(id) + '" aria-label="关闭">✕ 关闭</button></header>' +
      '<div class="body">' + bodyHtml + '</div></div>';
    document.body.appendChild(wrap);
    $('#scrim').classList.remove('hidden');
    document.body.classList.add('no-scroll');
    var btn = $('.close', wrap);
    if (btn) btn.focus();
  }
  function closeDialog(id, silent) {
    var el = document.getElementById(id);
    if (el) el.remove();
    if (!silent && !$('.dlg') && $('#drawer').classList.contains('hidden')) {
      $('#scrim').classList.add('hidden');
      document.body.classList.remove('no-scroll');
    }
  }

  /* =============== 13. 我的日程 =============== */
  function favRecords() {
    return favorites.map(findRecord).filter(Boolean);
  }
  function openAgenda() {
    var n = now();
    var recs = favRecords();
    var conf = L.detectConflicts(allRecords());
    var mine = conf.groups.filter(function (g) {
      return g.ids.filter(function (id) { return favorites.indexOf(id) >= 0; }).length >= 2;
    });
    var body = '';
    if (!recs.length) {
      body = '<div class="empty"><strong>日程还是空的</strong>在列表里点卡片右上角的 ★，或打开详情后点「加入我的日程」。' +
        '<div class="small" style="margin-top:8px">加入后这里会自动帮你检查时间冲突，并能导出日历文件。</div></div>';
    } else {
      var load = {};
      recs.forEach(function (r) {
        L.entriesOf(r).forEach(function (e) {
          (load[e.date] = load[e.date] || []).push({ e: e, r: r });
        });
      });
      body += '<p class="small muted">共 ' + recs.length + ' 条。下面是按时间排列的日程：</p>';
      body += Object.keys(load).sort().map(function (d) {
        var day = L.parseISO(d);
        return '<div class="ask"><div><strong>' + esc(L.fmtDate(day) + ' ' + L.weekdayOf(day)) + '</strong></div>' +
          load[d].sort(function (a, b) { return (a.e.at ? a.e.at : 0) - (b.e.at ? b.e.at : 0); }).map(function (x) {
            var kind = x.e.kind === 'deadline' ? '截止' : (x.e.kind === 'milestone' ? '节点' : '活动');
            return '<div class="small" style="margin-top:4px">' + esc((x.e.allDay ? '时间未注明' : L.fmtTime(x.e.at)) + ' · ' + kind + ' · ' + x.r.id + ' ' + x.r.title) + '</div>';
          }).join('') + '</div>';
      }).join('');
      if (mine.length) {
        body += '<h3 style="margin:16px 0 6px;font-size:15px">日程冲突</h3>' + mine.map(function (g) {
          return '<div class="tip">⚠ ' + esc(g.label) + ' 你收藏的 ' + esc(g.ids.filter(function (id) { return favorites.indexOf(id) >= 0; }).join('、')) + ' 时间重叠，需要取舍。</div>';
        }).join('');
      } else {
        body += '<div class="alert good" style="margin-top:12px"><span class="ic">✅</span><div>目前收藏的活动之间没有检测到时间冲突。</div></div>';
      }
      body += '<div class="pill-row" style="margin-top:14px">' +
        '<button class="btn primary" data-action="export-ics">导出日历文件（.ics）</button>' +
        '<button class="btn" data-action="copy-agenda">复制日程文本</button>' +
        '<button class="btn danger" data-action="clear-fav">清空日程</button>' +
        '</div>';
    }
    openDialog('dlg-agenda', '我的日程（' + recs.length + '）', body);
  }

  function icsText() {
    var n = now();
    var lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//CampusRadar//NewStudent//CN', 'CALSCALE:GREGORIAN'];
    function stamp(d) {
      var p = function (x) { return (x < 10 ? '0' : '') + x; };
      return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + 'T' + p(d.getHours()) + p(d.getMinutes()) + '00';
    }
    favRecords().forEach(function (r) {
      L.entriesOf(r).forEach(function (e, i) {
        if (!e.at) return;
        var start = e.at;
        var end = e.end || new Date(start.getTime() + 90 * 60000);
        lines.push('BEGIN:VEVENT');
        lines.push('UID:radar-' + r.id + '-' + i + '@campus-radar');
        lines.push('DTSTART:' + stamp(start));
        lines.push('DTEND:' + stamp(end));
        lines.push('SUMMARY:' + r.title.replace(/[,;]/g, ' '));
        lines.push('DESCRIPTION:' + ('编号 ' + r.id + '：' + r.oneLiner + '｜报名：' + r.deadline.text).replace(/[,;\n]/g, ' '));
        lines.push('LOCATION:' + (r.where.known ? r.where.text.replace(/[,;]/g, ' ') : '地点未注明'));
        lines.push('END:VEVENT');
      });
    });
    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }

  function download(filename, text, mime) {
    try {
      var blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 500);
      return true;
    } catch (e) { return false; }
  }

  function copyText(text, okMsg) {
    var done = function () { toast(okMsg || '已复制到剪贴板'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallback(); });
    } else { fallback(); }
    function fallback() {
      try {
        var ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); done();
      } catch (e) { window.prompt('复制下面的内容：', text); }
    }
  }

  function toast(msg) {
    var el = document.createElement('div');
    el.className = 'alert good';
    el.setAttribute('role', 'status');
    el.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:22px;z-index:90;max-width:90vw;box-shadow:var(--shadow)';
    el.innerHTML = '<span class="ic">✅</span><span>' + esc(msg) + '</span>';
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 2600);
  }

  /* =============== 14. 发布（学生自主发布） =============== */
  var CHECK_ITEMS = [
    ['timePlace', '我已经写明了具体时间与地点（地点确实未定请在说明里写清原因）'],
    ['noPrivateWechat', '我不会要求他人添加私人微信、转账或交押金'],
    ['titleMatch', '标题与内容一致，没有夹带商家推广或购买链接']
  ];

  function openPublish(editId) {
    var editing = editId ? published.filter(function (p) { return p.id === editId; })[0] : null;
    var cats = L.ALLOWED.category;
    var body = '' +
      '<p class="small muted">发布的内容会出现在同一个列表里，和题目提供的 26 条信息一起被搜索和筛选；' +
      '它会带「本机发布·未经校方审核」标记，只保存在你自己的浏览器里，不会上传到任何服务器。</p>' +
      '<form class="form" id="pubForm" novalidate>' +
      '  <div class="row"><label for="pTitle">活动标题 <span class="req">*</span></label><input id="pTitle" name="title" required maxlength="60" value="' + esc(editing ? editing.title : '') + '"></div>' +
      '  <div class="two">' +
      '    <div class="row"><label for="pCat">类别 <span class="req">*</span></label><select id="pCat" name="category">' +
      cats.map(function (c) { return '<option' + (editing && editing.category === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') +
      '    </select></div>' +
      '    <div class="row"><label for="pFresh">适合新生吗</label><select id="pFresh" name="freshman">' +
      ['适合', '一般', '不适合'].map(function (f) { return '<option' + (editing && editing.freshman === f ? ' selected' : '') + '>' + f + '</option>'; }).join('') +
      '    </select></div>' +
      '  </div>' +
      '  <div class="two">' +
      '    <div class="row"><label for="pDate">日期 <span class="req">*</span></label><input id="pDate" name="date" type="date" required value="' + esc(editing ? editing.date : '') + '"></div>' +
      '    <div class="row"><label for="pStart">开始时间（留空表示未定）</label><input id="pStart" name="startTime" type="time" value="' + esc(editing ? editing.startTime : '') + '"></div>' +
      '  </div>' +
      '  <div class="two">' +
      '    <div class="row"><label for="pLoc">地点（留空表示未定）</label><input id="pLoc" name="location" maxlength="40" value="' + esc(editing ? editing.location : '') + '"></div>' +
      '    <div class="row"><label for="pAud">面向人群</label><input id="pAud" name="audience" maxlength="30" value="' + esc(editing ? editing.audience : '全校学生') + '"></div>' +
      '  </div>' +
      '  <div class="two">' +
      '    <div class="row"><label for="pDlDate">报名截止日期（留空＝满员即止）</label><input id="pDlDate" name="deadlineDate" type="date" value="' + esc(editing ? editing.deadlineDate : '') + '"></div>' +
      '    <div class="row"><label for="pDlTime">截止时间</label><input id="pDlTime" name="deadlineTime" type="time" value="' + esc(editing ? editing.deadlineTime : '') + '"></div>' +
      '  </div>' +
      '  <div class="row"><label for="pSignup">报名方式 <span class="req">*</span></label><input id="pSignup" name="signup" required maxlength="60" placeholder="例如：扫码进群 / 发邮件到 xxx@xx.edu / 直接到场" value="' + esc(editing ? editing.signup : '') + '"></div>' +
      '  <div class="two">' +
      '    <div class="row"><label for="pFee">费用</label><input id="pFee" name="fee" maxlength="20" placeholder="免费 / AA / 未定" value="' + esc(editing ? editing.fee : '') + '"></div>' +
      '    <div class="row"><label for="pQuota">名额</label><input id="pQuota" name="quota" maxlength="20" placeholder="例如：限 20 人" value="' + esc(editing ? editing.quota : '') + '"></div>' +
      '  </div>' +
      '  <div class="row"><label for="pCommit">时间投入 / 其他要求</label><input id="pCommit" name="commitment" maxlength="40" placeholder="例如：每周约 3 小时" value="' + esc(editing ? editing.commitment : '') + '"></div>' +
      '  <div class="row"><label for="pNote">活动说明 <span class="req">*</span></label><textarea id="pNote" name="note" required maxlength="400" placeholder="写清楚做什么、怎么集合、找谁联系。这段内容会作为这条信息的「发布者」展示。">' + esc(editing ? editing.note : '') + '</textarea></div>' +
      '  <fieldset style="border:1px solid var(--line);border-radius:12px;padding:10px 12px">' +
      '    <legend class="small muted">发布前自查（新生最容易被这几件事坑到）</legend>' +
      '    <div class="form checklist">' + CHECK_ITEMS.map(function (c) {
        var checked = editing && editing.selfCheck && editing.selfCheck.indexOf(c[0]) >= 0;
        return '<label><input type="checkbox" name="chk" value="' + c[0] + '"' + (checked ? ' checked' : '') + '><span>' + esc(c[1]) + '</span></label>';
      }).join('') + '</div>' +
      '  </fieldset>' +
      '  <div class="errmsg" id="pubErr" role="alert"></div>' +
      '  <div class="pill-row">' +
      '    <button class="btn primary" type="submit">' + (editing ? '保存修改' : '发布到列表') + '</button>' +
      '    <button class="btn" type="button" data-action="close-panel" data-panel="dlg-publish">取消</button>' +
      '  </div>' +
      '</form>';
    openDialog('dlg-publish', editing ? '编辑本机发布' : '我要发布一个活动 / 机会', body);
    $('#pubForm').addEventListener('submit', function (ev) { ev.preventDefault(); submitPublish(editing); });
  }

  function submitPublish(editing) {
    var f = $('#pubForm');
    var err = $('#pubErr');
    var get = function (name) { var el = f.elements[name]; return el ? String(el.value || '').trim() : ''; };
    var problems = [];
    if (!get('title')) problems.push('标题');
    if (!get('date')) problems.push('日期');
    if (!get('signup')) problems.push('报名方式');
    if (!get('note')) problems.push('活动说明');
    if (problems.length) { err.textContent = '还有必填项没填：' + problems.join('、'); return; }

    var chk = $$('input[name="chk"]:checked', f).map(function (i) { return i.value; });
    var unchecked = CHECK_ITEMS.filter(function (c) { return chk.indexOf(c[0]) < 0; });
    if (unchecked.length) {
      err.textContent = '还有 ' + unchecked.length + ' 项自查没有确认（' + unchecked.map(function (c) { return c[1].slice(0, 10) + '…'; }).join('；') +
        '）。请确认后再发布——这也是本产品对「学生自主发布」的审核替代方案。';
      return;
    }

    var payload = {
      id: editing ? editing.id : ('P' + (published.length + 1) + '-' + Date.now().toString().slice(-4)),
      title: get('title'), category: get('category'), freshman: get('freshman'),
      date: get('date'), startTime: get('startTime'), endTime: '',
      location: get('location'), audience: get('audience'),
      deadlineDate: get('deadlineDate'), deadlineTime: get('deadlineTime'),
      signup: get('signup'), fee: get('fee'), quota: get('quota'), commitment: get('commitment'),
      note: get('note'), selfCheck: chk,
      createdAt: editing ? editing.createdAt : new Date().toISOString()
    };
    if (editing) {
      published = published.map(function (p) { return p.id === editing.id ? payload : p; });
    } else {
      published.push(payload);
    }
    STORE.write('published', published);
    closeDialog('dlg-publish');
    renderAll();
    toast(editing ? '已保存修改' : '已发布，它已经出现在列表里了（本机发布·未经校方审核）');
  }

  /* =============== 15. 信息质量页 =============== */
  function openQuality() {
    var n = now();
    var recs = allRecords();
    var s = L.stats(recs, n);
    var errs = L.validate(D.DATA, META);
    var srcKeys = Object.keys(s.bySource);
    var body = '' +
      '<p class="small muted">这一页回答两个问题：这些信息是<strong>谁发布的</strong>，以及发布内容里<strong>哪些东西没说清楚</strong>。</p>' +
      '<div class="statgrid">' +
      '  <div class="stat"><div class="k">发布内容条目</div><div class="v">' + D.DATA.length + '</div></div>' +
      '  <div class="stat"><div class="k">本机发布（未审核）</div><div class="v">' + published.length + '</div></div>' +
      '  <div class="stat"><div class="k">确认的时间冲突</div><div class="v">' + s.conflictInfo.groups.length + '</div></div>' +
      '  <div class="stat"><div class="k">发布者未说明项</div><div class="v">' + s.unknowns.length + '</div></div>' +
      '</div>' +

      '<h3 style="margin:18px 0 6px;font-size:15px">来源分层（谁发的）</h3>' +
      srcKeys.map(function (k) {
        var pct = Math.round(100 * s.bySource[k] / recs.length);
        return '<div style="margin-bottom:9px"><div class="small"><strong>' + esc(k) + '</strong> ' + s.bySource[k] + ' 条（' + pct + '%）</div>' +
          '<div class="bar"><i style="width:' + pct + '%"></i></div></div>';
      }).join('') +
      '<div class="alert info"><span class="ic">ℹ</span><div>题目信息里只有 <strong>21、26</strong> 写明由学院发布，<strong>22—25</strong> 写明是学生个人发布；' +
      '<strong>01、05、16</strong> 只在标题里出现「校内/校园」，据此仅作「推断」标注；其余 ' + (s.bySource['来源未注明'] || 0) +
      ' 条发布者未写发布单位，本产品统一标为「来源未注明」，<strong>不替它猜</strong>。' +
      '<div class="small" style="margin-top:5px">想判断是不是校方正式通知，可以去教务处 / 学工部 / 团委 / 学院官网核对，或直接问辅导员。</div></div></div>' +

      '<h3 style="margin:18px 0 6px;font-size:15px">需要谨慎对待的学生发布（' + s.risky.length + ' 条）</h3>' +
      (s.risky.length ? s.risky.map(function (r) {
        return '<div class="tip risk"><span>🚩</span><span><strong>' + esc(r.id + ' ' + r.title) + '</strong><br>' + decorate(esc(r.tips[0] || '')) +
          ' <button class="btn sm" data-action="open" data-id="' + esc(r.id) + '">查看发布者</button></span></div>';
      }).join('') : '<p class="small muted">无</p>') +

      '<h3 style="margin:18px 0 6px;font-size:15px">发布者没说清的地方：该问什么（' + s.unknowns.length + ' 项）</h3>' +
      '<div class="small muted" style="margin-bottom:8px">这些不是产品的推测，而是发布者确实没有提供的信息；不确定的事，直接问主办方最快。</div>' +
      s.unknowns.map(function (u) {
        return '<div class="ask"><div class="small muted">' + esc(u.id + ' ' + u.title) + '：未提供 ' + esc(u.what) + '</div>' +
          '<div class="q">『' + decorate(esc(u.ask)) + '』</div></div>';
      }).join('') +

      '<h3 style="margin:18px 0 6px;font-size:15px">数据与口径说明</h3>' +
      '<ul class="small">' +
      '  <li>' + esc(META.sourceNote) + '，raw 字段逐字照录，未改写。</li>' +
      '  <li>' + esc(META.timeBasis) + '。' + esc(META.timeBasisWhy) + '</li>' +
      '  <li>' + esc(META.weekdayPolicy) + '</li>' +
      '  <li>数据自检：' + (errs.length === 0 ? '<strong style="color:var(--good)">通过</strong>（编号连续性、枚举合法性、缺失字段一致性、关联条目存在性）' : '<strong style="color:var(--danger)">发现 ' + errs.length + ' 个问题</strong>：' + esc(errs.join('；'))) + '</li>' +
      '  <li>推算内容一律标注「推算」（如 06 学习小组后续 5 次、18 小组第二次、02/09 的结束时间）。</li>' +
      '</ul>' +

      '<h3 style="margin:18px 0 6px;font-size:15px">术语小词典</h3>' +
      '<div class="small muted" style="margin-bottom:8px">以下是通用词义解释，<strong>不属于题目提供的校园信息</strong>。</div>' +
      Object.keys(GLOSSARY).map(function (t) {
        return '<div class="ask"><strong>' + esc(t) + '</strong>：' + esc(GLOSSARY[t]) + '</div>';
      }).join('');
    openDialog('dlg-quality', '信息质量与来源说明', body);
  }

  /* =============== 17. 事件 =============== */
  /** 首屏 KPI 条：把「今天有几场 / 多久截止 / 一周多少 / 多少适合新生」提到最上面 */
  function renderKpis(n) {
    var host = $('#kpis');
    if (!host) return;
    var recs = allRecords();
    var todayYmd = L.ymd(n);
    var todayCount = recs.filter(function (r) {
      return L.entriesOf(r).some(function (e) { return e.date === todayYmd && e.kind === 'session'; });
    }).length;
    var closing = recs.filter(function (r) { return L.signupState(r, n).code === 'closing_soon'; }).length;
    var week = 0, seen = {};
    var end7 = L.endOfDay(L.addDays(n, 6));
    recs.forEach(function (r) {
      L.entriesOf(r).forEach(function (e) {
        if (e.kind === 'session' && e.at && e.at >= L.startOfDay(n) && e.at <= end7 && !seen[r.id]) { seen[r.id] = 1; week++; }
      });
    });
    var fresh = recs.filter(function (r) { return r.freshman.level === '适合'; }).length;
    var tiles = [
      { k: '今天（' + L.fmtDate(n) + ' ' + L.weekdayOf(n) + '）', v: todayCount, s: '场活动', accent: true },
      { k: '48 小时内截止', v: closing, s: '项待办', accent: false },
      { k: '未来 7 天', v: week, s: '场活动', accent: false },
      { k: '适合新生', v: fresh, s: '条（共 ' + recs.length + ' 条）', accent: false }
    ];
    host.innerHTML = tiles.map(function (t) {
      return '<div class="kpi' + (t.accent ? ' accent' : '') + '"><div class="k">' + esc(t.k) + '</div>' +
        '<div class="v">' + t.v + '</div><div class="s">' + esc(t.s) + '</div></div>';
    }).join('');
  }

  /** 速览侧栏：宽屏粘在右侧，窄屏自动落到列表之后 */
  function renderRail(n) {
    var host = $('#rail');
    if (!host) return;
    var recs = allRecords();
    var favs = favRecords();
    var conf = L.detectConflicts(recs);
    var mineConf = conf.groups.filter(function (g) {
      return g.ids.filter(function (id) { return favorites.indexOf(id) >= 0; }).length >= 2;
    });

    var urgent = recs.filter(function (r) {
      var c = L.signupState(r, n).code;
      return c === 'closing_soon' || c === 'open';
    }).sort(function (a, b) { return L.urgencyOf(a, n).rank - L.urgencyOf(b, n).rank; }).slice(0, 4);
    var card1 = '<section class="railcard"><header><h3>最近的截止与开场' +
      (urgent.length ? '<span class="pill-n">' + urgent.length + '</span>' : '') + '</h3></header>' +
      (urgent.length ? urgent.map(function (r) {
        var u = L.urgencyOf(r, n);
        return '<div class="row"><div class="grow">' +
          '<div class="t" data-action="open" data-id="' + esc(r.id) + '">' + esc(r.id + ' ' + r.title) + '</div>' +
          '<div class="m">' + esc(u.text) + '</div></div>' +
          '<button class="btn sm" data-action="open" data-id="' + esc(r.id) + '">详情</button></div>';
      }).join('') : '<p class="small muted">当前没有还在报名期或临近截止的条目。</p>') +
      '</section>';

    var card2 = '<section class="railcard"><header><h3>我的日程' +
      '<span class="pill-n">' + favs.length + '</span></h3></header>' +
      (favs.length
        ? '<p class="small muted" style="margin:2px 0 10px">已收藏 ' + favs.length + ' 条' +
          (mineConf.length ? '，其中 <strong style="color:var(--danger)">' + mineConf.length + ' 组时间冲突</strong>' : '，没有检测到时间冲突') + '。</p>'
        : '<p class="small muted" style="margin:2px 0 10px">点卡片右上角的 ★ 加入日程，会自动帮你查冲突、还能导出日历文件。</p>') +
      '<div class="pill-row"><button class="btn sm primary" data-action="open-panel" data-value="agenda">打开我的日程</button>' +
      '<button class="btn sm" data-action="open-panel" data-value="publish">我要发布</button></div></section>';

    var s = L.stats(recs, n);
    var srcKeys = Object.keys(s.bySource).sort(function (a, b) { return s.bySource[b] - s.bySource[a]; });
    var maxSrc = srcKeys.reduce(function (m, k) { return Math.max(m, s.bySource[k]); }, 1);
    var card3 = '<section class="railcard"><header><h3>来源分层与风险</h3></header>' +
      srcKeys.map(function (k) {
        var pct = Math.round(100 * s.bySource[k] / maxSrc);
        return '<div class="minibar"><span class="lbl">' + esc(k) + '</span>' +
          '<span class="track"><i style="width:' + Math.max(pct, 4) + '%"></i></span>' +
          '<span class="num">' + s.bySource[k] + '</span></div>';
      }).join('') +
      (s.risky.length ? '<div class="tip risk" style="margin-top:10px"><span>🚩</span><span>有 ' + s.risky.length +
        ' 条学生发布内容需要谨慎（' + s.risky.map(function (r) { return r.id; }).join('、') + '）</span></div>' : '') +
      '<div class="pill-row" style="margin-top:4px"><button class="btn sm" data-action="open-panel" data-value="quality">查看信息质量说明</button></div></section>';

    var card4 = '<section class="railcard"><header><h3>快速开始</h3></header><div class="pill-row">' +
      '<button class="chip" data-action="set-window" data-value="today" aria-pressed="' + (state.window === 'today') + '">今天</button>' +
      '<button class="chip" data-action="set-window" data-value="3d" aria-pressed="' + (state.window === '3d') + '">近 3 天</button>' +
      '<button class="chip" data-action="set-window" data-value="week" aria-pressed="' + (state.window === 'week') + '">近 7 天</button>' +
      '<button class="chip" data-action="toggle-quick" data-value="适合新生" aria-pressed="' + (state.quick.indexOf('适合新生') >= 0) + '">适合新生</button>' +
      '<button class="chip" data-action="toggle-quick" data-value="直接去" aria-pressed="' + (state.quick.indexOf('直接去') >= 0) + '">不用报名</button>' +
      '<button class="chip" data-action="clear-all">全部 ' + recs.length + ' 条</button>' +
      '</div></section>';

    host.innerHTML = card1 + card2 + card3 + card4;
  }

  function renderAll() {
    renderBasis();
    renderKpis(now());
    renderHero();
    renderToolbar();
    renderResults();
    renderRail(now());
  }

  function onAction(ev) {
    var el = ev.target && ev.target.closest ? ev.target.closest('[data-action]') : null;
    if (!el) {
      var card = ev.target && ev.target.closest ? ev.target.closest('.card') : null;
      if (card) { openDetail(card.getAttribute('data-id')); }
      return;
    }
    var act = el.getAttribute('data-action');
    var val = el.getAttribute('data-value');
    var id = el.getAttribute('data-id');
    var n = now();

    switch (act) {
      case 'open': openDetail(id); break;
      case 'close-detail': closeDetail(); break;
      case 'toggle-fav': {
        toggleIn(favorites, id);
        STORE.write('favorites', favorites);
        renderAll();
        if (state.id === id) openDetail(id, false);
        toast(favorites.indexOf(id) >= 0 ? '已加入我的日程' : '已从日程移除');
        break;
      }
      case 'toggle-source': toggleIn(state.source, val); writeHash(false); renderAll(); break;
      case 'toggle-category': toggleIn(state.category, val); writeHash(false); renderAll(); break;
      case 'toggle-quick': toggleIn(state.quick, val); writeHash(false); renderAll(); break;
      case 'set-window': state.window = (state.window === val && val !== 'all') ? 'all' : val; state.day = null; writeHash(false); renderAll(); break;
      case 'set-sort': state.sort = val; writeHash(false); renderToolbar(); renderResults(); break;
      case 'set-view': state.view = val; writeHash(false); renderToolbar(); renderResults(); break;
      case 'clear-all': {
        state.q = ''; state.source = []; state.category = []; state.quick = []; state.window = 'all';
        state.hideNotices = false; state.day = null;
        $('#q').value = '';
        writeHash(false); renderAll();
        break;
      }
      case 'pick-day': {
        state.day = (state.day === val) ? null : val;
        state.view = 'timeline';
        writeHash(false); renderToolbar(); renderResults();
        $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' });
        break;
      }
      case 'term': window.alert(el.getAttribute('data-term') + '：' + GLOSSARY[el.getAttribute('data-term')] + '\n\n（通用词义解释，非题目提供的校园信息）'); break;
      case 'copy-info': {
        var r = findRecord(id);
        if (r) copyText(r.id + ' ' + r.title + '\n' + r.oneLiner + '\n报名截止：' + r.deadline.text + '\n发布者：' + r.raw, '已复制这条信息');
        break;
      }
      case 'copy-agenda': {
        var txt = favRecords().map(function (r) { return r.id + ' ' + r.title + '｜' + L.urgencyOf(r, n).text + '｜报名：' + r.deadline.text; }).join('\n');
        copyText(txt || '（日程为空）', '已复制日程文本');
        break;
      }
      case 'export-ics': {
        if (!favRecords().length) { toast('日程为空，先加入几条吧'); break; }
        var okDl = download('校园机会雷达-我的日程.ics', icsText(), 'text/calendar');
        if (!okDl) toast('浏览器拦截了下载，可改用「复制日程文本」');
        break;
      }
      case 'clear-fav': {
        if (window.confirm('确定清空我的日程？')) { favorites = []; STORE.write('favorites', favorites); renderAll(); openAgenda(); }
        break;
      }
      case 'open-panel': {
        state.panel = val; writeHash(false);
        if (val === 'publish') openPublish();
        else if (val === 'agenda') openAgenda();
        else if (val === 'quality') openQuality();
        break;
      }
      case 'close-panel': {
        state.panel = null; writeHash(false);
        closeDialog(el.getAttribute('data-panel'));
        break;
      }
      case 'delete-local': {
        if (window.confirm('删除这条本机发布？')) {
          published = published.filter(function (p) { return p.id !== id; });
          STORE.write('published', published);
          favorites = favorites.filter(function (f) { return f !== id; });
          STORE.write('favorites', favorites);
          closeDetail();
          renderAll();
          toast('已删除');
        }
        break;
      }
      case 'clock-shift': {
        var d = Number(val);
        var next = Math.max(-1, Math.min(20, state.offsetDays + d));
        state.offsetDays = next;
        STORE.write('clockOffsetDays', next);
        renderAll();
        break;
      }
      case 'clock-reset': state.offsetDays = 0; STORE.write('clockOffsetDays', 0); renderAll(); break;
      default: break;
    }
  }

  /* =============== 18. 初始化 =============== */
  /** 从 URL hash 重建界面（用于浏览器前进/后退，以及同标签页内粘贴深链） */
  function syncFromHash() {
    state = {
      q: '', source: [], category: [], quick: [], window: 'all', sort: 'recommend',
      view: 'cards', hideNotices: false, id: null, day: null, panel: null,
      offsetDays: state.offsetDays
    };
    readHash();
    var openDlg = $('.dlg');
    if (openDlg) closeDialog(openDlg.id, true);
    renderAll();
    if (state.id) openDetail(state.id, false); else closeDetail(true);
    if (state.panel === 'publish') openPublish();
    else if (state.panel === 'agenda') openAgenda();
    else if (state.panel === 'quality') openQuality();
    else if (!$('.dlg') && $('#drawer').classList.contains('hidden')) {
      $('#scrim').classList.add('hidden');
      document.body.classList.remove('no-scroll');
    }
  }

  function init() {
    readHash();
    renderAll();

    document.addEventListener('click', onAction);
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') {
        if ($('.dlg')) { closeDialog($('.dlg').id); return; }
        if (!$('#drawer').classList.contains('hidden')) { closeDetail(); return; }
      }
      if (ev.key === 'Enter' && ev.target.classList && ev.target.classList.contains('card')) {
        openDetail(ev.target.getAttribute('data-id'));
      }
    });
    $('#scrim').addEventListener('click', function () {
      if ($('.dlg')) { closeDialog($('.dlg').id); return; }
      if (!$('#drawer').classList.contains('hidden')) { closeDetail(); return; }
    });
    window.addEventListener('popstate', syncFromHash);
    /* 同一标签页里手动改地址栏 / 粘贴深链（纯 fragment 变化）也要生效 */
    window.addEventListener('hashchange', function () {
      if (location.hash === lastHash) return;
      syncFromHash();
    });

    var qEl = $('#q');
    var timer = null;
    qEl.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        state.q = qEl.value.trim();
        writeHash(false);
        renderToolbar();
        renderResults();
      }, 160);
    });
    $('#hideNotices').addEventListener('change', function (ev) {
      state.hideNotices = ev.target.checked;
      writeHash(false); renderResults();
    });
    $('#drawer').addEventListener('click', function (ev) { if (ev.target.id === 'drawer') closeDetail(); });

    if (state.id) openDetail(state.id, false);
    if (state.panel === 'publish') openPublish();
    else if (state.panel === 'agenda') openAgenda();
    else if (state.panel === 'quality') openQuality();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
