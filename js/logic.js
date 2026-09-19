/* 校园机会雷达 · 逻辑层
 * ------------------------------------------------------------------
 * 纯函数，不碰 DOM、不读系统时间（时间一律由调用方传入 now）。
 * 既可在浏览器里以 window.CampusLogic 使用，也可被 node 测试 require。
 *
 * 设计原则：
 *  1) 只做「发布者信息的整理、比较、提醒」，不添加发布者没有的事实。
 *  2) 凡是推算出来的内容（如结束时间、第二次活动日期）都必须带 derived 标记，
 *     UI 负责显示「推算」字样。
 *  3) 缺失字段一律走 unknown 分支，绝不默认成某个值。
 * ------------------------------------------------------------------
 */
(function (root) {
  'use strict';

  var DAY = 86400000;
  var WD = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  /* ---------------- 时间工具 ---------------- */
  /* 年份绑定：发布者只写了「9月X日」，没有写年份。
     页面按电脑系统时间的年份来呈现这些日期（否则换一年打开，全部条目都会变成「已结束一年」）。
     YEAR_BIND = null 时使用数据里字面写的年份，供离线核对发布者的测试使用。 */
  var YEAR_BIND = null;
  function setYear(y) {
    YEAR_BIND = (y === null || y === undefined || y === '') ? null : Number(y);
    return YEAR_BIND;
  }
  function boundYear() { return YEAR_BIND; }
  function bindYear(s) {
    if (s === null || s === undefined) return s;
    var str = String(s);
    if (YEAR_BIND === null) return str;
    return str.replace(/^(\d{4})/, String(YEAR_BIND));
  }

  function parseISO(s) {
    s = bindYear(s);
    if (!s) return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?$/.exec(String(s));
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0, 0, 0);
  }
  function addDays(d, n) { return new Date(d.getTime() + n * DAY); }
  function addMinutes(d, n) { return new Date(d.getTime() + n * 60000); }
  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function endOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59); }
  function ymd(d) {
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function fmtDate(d) { return (d.getMonth() + 1) + '月' + d.getDate() + '日'; }
  function fmtTime(d) {
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function fmtDateTime(d) { return fmtDate(d) + ' ' + fmtTime(d); }
  function weekdayOf(d) { return WD[d.getDay()]; }
  function dayDiff(a, b) { return Math.round((startOfDay(a) - startOfDay(b)) / DAY); }

  /** 相对某天的人话表达 */
  function relDay(target, now) {
    var n = dayDiff(target, now);
    if (n < 0) return { days: n, code: 'past', text: '已过 ' + (-n) + ' 天' };
    if (n === 0) return { days: 0, code: 'today', text: '今天' };
    if (n === 1) return { days: 1, code: 'tomorrow', text: '明天' };
    if (n === 2) return { days: 2, code: 'day2', text: '后天' };
    if (n <= 7) return { days: n, code: 'soon', text: n + ' 天后' };
    return { days: n, code: 'later', text: n + ' 天后' };
  }

  /** 距某时刻还剩多久（用于截止倒计时） */
  function countdown(target, now) {
    var ms = target.getTime() - now.getTime();
    if (ms < 0) {
      var over = relDay(target, now);
      return { ms: ms, text: '已过 ' + over.text.replace('已过 ', ''), tone: 'muted' };
    }
    var hours = ms / 3600000;
    if (hours < 1) return { ms: ms, text: '不到 1 小时', tone: 'danger' };
    if (hours <= 48) return { ms: ms, text: Math.round(hours) + ' 小时', tone: 'danger' };
    var d = Math.ceil(hours / 24);
    return { ms: ms, text: d + ' 天', tone: d <= 3 ? 'warn' : 'normal' };
  }

  /* ---------------- 条目 → 日程条目 ---------------- */
  var DEFAULT_SESSION_MINUTES = 90; // 仅用于「是否正在进行中」的粗略判断，不对外当作事实

  function entriesOf(rec) {
    var out = [];
    /* 变更/补充通知（kind === 'notice'）不是活动本身：它更新的是被通知条目的时间与地点，
       因此不生成日程条目 —— 否则同一场活动会在日历与冲突检测里被重复计算
       （例如 01 训练营与 09 补充通知同为首训 9/21 19:30）。通知内容通过「关联变更」与
       首屏通知提醒呈现，业务时间以被通知的条目为准。 */
    if (rec.kind === 'notice') return out;
    var w = rec.when || {};
    if (w.known) {
      var base = w.start || (w.date ? w.date + 'T00:00' : null);
      var bd = parseISO(base);
      if (bd) {
        var ed = parseISO(w.end);
        out.push({
          id: rec.id, kind: 'session', allDay: !w.start,
          at: w.start ? bd : bd, end: ed,
          date: ymd(bd), timeKnown: !!w.timeKnown,
          derivedEnd: false,
          label: w.start ? fmtDateTime(bd) + (ed ? '—' + fmtTime(ed) : '') : fmtDate(bd) + '（时间未注明）'
        });
        if (w.recur && w.recur.count > 1) {
          for (var i = 1; i < w.recur.count; i++) {
            var s2 = addDays(bd, w.recur.everyDays * i);
            var e2 = ed ? addDays(ed, w.recur.everyDays * i) : null;
            out.push({
              id: rec.id, kind: 'session', allDay: false, at: s2, end: e2,
              date: ymd(s2), timeKnown: !!w.timeKnown, derived: true, derivedNote: w.recur.note || '按发布者推算',
              label: fmtDateTime(s2) + (e2 ? '—' + fmtTime(e2) : '')
            });
          }
        }
      }
    }
    var dl = rec.deadline || {};
    if (dl.known && dl.at) {
      var dd = parseISO(dl.at);
      if (dd) {
        out.push({
          id: rec.id, kind: 'deadline', allDay: !!dl.dateOnly,
          at: dl.dateOnly ? endOfDay(dd) : dd, end: null,
          date: ymd(dd), timeKnown: !dl.dateOnly, derivedEnd: false,
          label: dl.dateOnly ? fmtDate(dd) + ' 截止（发布者未注明时刻）' : fmtDateTime(dd) + ' 截止'
        });
      }
    }
    (rec.milestones || []).forEach(function (m) {
      var md = parseISO(m.at);
      if (md) {
        // 发布者只给日期时不能显示成 00:00（那等于凭空造了一个时刻）
        var dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(String(m.at));
        out.push({
          id: rec.id, kind: 'milestone', allDay: dateOnly, at: dateOnly ? endOfDay(md) : md, end: null,
          date: ymd(md), timeKnown: !dateOnly, derivedEnd: false, label: m.text
        });
      }
    });
    return out;
  }

  /** 活动本身的时间状态 */
  function eventState(rec, now) {
    var w = rec.when || {};
    if (!w.known || !w.start) {
      return { code: 'no_time', label: w.known ? '时间未注明' : '无固定时间', tone: 'muted' };
    }
    var s = parseISO(w.start);
    if (!s) return { code: 'no_time', label: '时间未注明', tone: 'muted' };
    var e = parseISO(w.end);
    var eAssumed = false;
    if (!e) { e = addMinutes(s, DEFAULT_SESSION_MINUTES); eAssumed = true; }
    if (now.getTime() < s.getTime()) {
      var r = relDay(s, now);
      return {
        code: r.code === 'today' ? 'today_later' : 'upcoming',
        label: r.code === 'today' ? '今天 ' + fmtTime(s) + ' 开始' : r.text + '（' + fmtDate(s) + '）',
        tone: r.days <= 1 ? 'warn' : 'normal'
      };
    }
    if (now.getTime() <= e.getTime()) {
      return { code: 'ongoing', label: '进行中' + (eAssumed ? '（结束时间未注明）' : ''), tone: 'live' };
    }
    if ((rec.flags || []).indexOf('replay_pending') >= 0) {
      return { code: 'replay_pending', label: '已结束 · 回放待发布', tone: 'muted' };
    }
    if (w.recur) {
      // 有周期性安排的，说明后续还会开展
      return { code: 'ended_recurring', label: '本轮已结束（周期性安排）', tone: 'muted', title: '发布者安排：' + (w.recurring || '固定周期开展') };
    }
    return { code: 'ended', label: '已结束（' + fmtDate(s) + '）', tone: 'muted' };
  }

  /** 报名状态 */
  function signupState(rec, now) {
    var d = rec.deadline || {};
    var kind = d.kind || '未注明';
    if (kind === '无需报名') return { code: 'none_needed', label: '无需报名，直接去', tone: 'good' };
    if (kind === '长期招募') return { code: 'rolling', label: '长期招募，满员即止', tone: 'good' };
    if (kind === '满员即止') return { code: 'rolling', label: '满员即止（无截止时间）', tone: 'warn' };
    if (kind === '预约制·需审核') return { code: 'review', label: '需预约 · 报名≠录取', tone: 'warn' };
    if (kind === '链接有效期') {
      // 徽章必须短：发布者的长句放在 deadline.text / 详情里，不能塞进徽章（会撑爆窄屏布局）
      var ld = parseISO(d.at);
      return {
        code: 'link',
        label: ld ? '链接 ' + fmtDate(ld) + ' 到期' : '链接有有效期',
        tone: 'warn',
        title: '资料链接有效期：' + (d.text || '')
      };
    }
    if (d.known && d.at) {
      var at = parseISO(d.at);
      if (at) {
        if (d.dateOnly) at = endOfDay(at);
        var ms = at.getTime() - now.getTime();
        // 边界口径：写「12:00 截止」意味着 12:00 整即已截止（ms <= 0 视为已过）
        if (ms <= 0) {
          return (rec.flags || []).indexOf('waitlist_ok') >= 0
            ? { code: 'waitlist', label: '报名已截止 · 可候补入场', tone: 'warn' }
            : { code: 'closed', label: '报名已截止', tone: 'muted' };
        }
        var cd = countdown(at, now);
        if (ms <= 48 * 3600000) {
          return { code: 'closing_soon', label: '即将截止 · 还剩 ' + cd.text, tone: 'danger' };
        }
        return { code: 'open', label: '报名中 · 还有 ' + cd.text, tone: 'good' };
      }
    }
    return { code: 'unknown', label: '报名时间发布者未注明', tone: 'muted' };
  }

  /** 综合状态（给卡片用） */
  function stateOf(rec, now) {
    return { signup: signupState(rec, now), event: eventState(rec, now) };
  }

  /** 发布者写了「每周X」，核对它在当前年份的历法下是否成立。
   *  年份取自电脑系统时间，所以这条判断必须运行时算，不能在数据里写死。 */
  function weekdayVerdict(rec, now) {
    var c = rec && rec.weekdayClaim;
    if (!c) return null;
    var d = parseISO(c.on);
    if (!d) return null;
    var actual = weekdayOf(d);
    var y = d.getFullYear();
    var ok = String(c.stated).indexOf(actual.replace('周', '')) >= 0;
    return {
      ok: ok, stated: c.stated, date: d, actual: actual, year: y,
      text: ok
        ? '发布者写「' + c.stated + '」，' + fmtDate(d) + ' 在 ' + y + ' 年历里正是' + actual + '，日期与星期口径一致。'
        : '发布者写「' + c.stated + '」，但 ' + fmtDate(d) + ' 在 ' + y + ' 年历里是' + actual + '，对不上；' +
          '年份取自电脑系统时间，具体以哪天为准建议向主办方确认。'
    };
  }

  /* ---------------- 冲突检测 ---------------- */
  /** 仅依据发布者给出的时间；推算出的周期安排参与检测并标注 derived。 */
  function detectConflicts(records) {
    var byDate = {};
    records.forEach(function (rec) {
      entriesOf(rec).forEach(function (en) {
        if (en.kind !== 'session' || !en.at || !en.timeKnown) return;
        (byDate[en.date] = byDate[en.date] || []).push({ rec: rec, en: en });
      });
    });
    var groups = [];
    var caution = [];
    Object.keys(byDate).sort().forEach(function (date) {
      var items = byDate[date];
      var parent = items.map(function (_, i) { return i; });
      var find = function (i) { while (parent[i] !== i) { i = parent[i] = parent[parent[i]]; } return i; };
      var union = function (a, b) { var ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; };
      var unknowns = [];
      for (var i = 0; i < items.length; i++) {
        for (var j = i + 1; j < items.length; j++) {
          var A = items[i].en, B = items[j].en;
          var overlap = false;
          if (A.end && B.end) overlap = A.at < B.end && B.at < A.end;
          else if (A.end) overlap = B.at >= A.at && B.at < A.end;
          else if (B.end) overlap = A.at >= B.at && A.at < B.end;
          else overlap = A.at.getTime() === B.at.getTime();
          if (overlap) {
            union(i, j);
          } else if (!A.end && !B.end && A.at.getTime() !== B.at.getTime()) {
            unknowns.push([items[i], items[j]]);
          }
        }
      }
      var buckets = {};
      items.forEach(function (it, idx) {
        var r = find(idx);
        (buckets[r] = buckets[r] || []).push(it);
      });
      Object.keys(buckets).forEach(function (k) {
        var b = buckets[k];
        if (b.length < 2) return;
        var ids = b.map(function (x) { return x.rec.id; }).sort();
        var derived = b.some(function (x) { return x.en.derived; });
        var partial = b.some(function (x) { return !x.en.end; });
        groups.push({
          date: date, ids: ids, kind: 'overlap',
          derived: derived, partial: partial,
          label: fmtDate(parseISO(date)) + ' ' + weekdayOf(parseISO(date)),
          note: derived ? '含按发布者推算的场次' : (partial ? '其中一场未注明结束时间，但开始时间落在另一场时段内' : '')
        });
      });
      if (unknowns.length) {
        caution.push({
          date: date, kind: 'unknown_end',
          ids: items.map(function (x) { return x.rec.id; }).sort(),
          label: fmtDate(parseISO(date)) + ' ' + weekdayOf(parseISO(date)),
          note: '同一天有多场活动、且结束时间未注明，可能衔接紧张'
        });
      }
    });
    return { groups: groups, caution: caution };
  }

  /** 每天负载：用于「这天很满」提醒 */
  function dayLoad(records) {
    var map = {};
    records.forEach(function (rec) {
      entriesOf(rec).forEach(function (en) {
        if (en.kind === 'session' && !en.timeKnown) return; // 无具体时刻不计入负载
        var d = map[en.date] = map[en.date] || { date: en.date, sessions: [], deadlines: [], milestones: [] };
        if (en.kind === 'session') d.sessions.push({ id: rec.id, at: en.at, label: en.label, derived: !!en.derived });
        else if (en.kind === 'deadline') d.deadlines.push({ id: rec.id, at: en.at, label: en.label, allDay: en.allDay, kind: rec.deadline.kind });
        else d.milestones.push({ id: rec.id, at: en.at, label: en.label });
      });
    });
    return Object.keys(map).sort().map(function (k) {
      var d = map[k];
      d.sessions.sort(function (a, b) { return a.at - b.at; });
      d.deadlines.sort(function (a, b) { return a.at - b.at; });
      d.busy = d.sessions.length >= 3 || (d.sessions.length >= 2 && d.deadlines.length >= 1);
      d.label = fmtDate(parseISO(d.date)) + ' ' + weekdayOf(parseISO(d.date));
      return d;
    });
  }

  /* ---------------- 检索与筛选 ---------------- */
  function tagList(rec) {
    var t = [];
    var raw = rec.raw || '';
    if (/零基础|不限基础/.test(raw)) t.push('零基础');
    if (/无需报名|无需提前报名/.test(raw)) t.push('不用报名');
    if (/线上|直播/.test(raw)) t.push('线上/直播');
    if (/限\d+人/.test(raw)) t.push('限名额');
    if (/长期/.test(raw)) t.push('长期');
    if (/组队|团队/.test(raw)) t.push('组队');
    if (/每周/.test(raw)) t.push('每周固定');
    if (/审核|预约/.test(raw)) t.push('需审核/预约');
    if (/回放/.test(raw)) t.push('有回放');
    if (rec.source && rec.source.type === '学生个人') t.push('学生发布');
    if (rec.kind === 'notice') t.push('变更通知');
    if ((rec.flags || []).indexOf('risk_low_trust') >= 0) t.push('需谨慎');
    return t;
  }

  function haystack(rec) {
    return [
      rec.id, rec.title, rec.raw, rec.category, rec.audience, rec.oneLiner, rec.signup,
      rec.commitment || '', rec.quota || '', (rec.materials || []).join(' '),
      (rec.source && (rec.source.publisher || rec.source.hint)) || '',
      (rec.where && rec.where.text) || '', (rec.where && rec.where.note) || '',
      (rec.tips || []).join(' '), (rec.unknowns || []).map(function (u) { return u.what + ' ' + u.ask; }).join(' '),
      tagList(rec).join(' '), (rec.when && rec.when.text) || '', (rec.deadline && rec.deadline.text) || ''
    ].join(' ').toLowerCase();
  }

  function matchesQuery(rec, q) {
    if (!q) return true;
    var hay = haystack(rec);
    return String(q).toLowerCase().split(/\s+/).filter(Boolean).every(function (tok) { return hay.indexOf(tok) >= 0; });
  }

  function sourceBucket(rec) {
    var s = rec.source || {};
    if (s.type === '学院') return '学院发布';
    if (s.type === '学生个人') return '学生个人发布';
    if (s.basis === '据标题推断') return '校内主办（推断）';
    return '来源未注明';
  }

  function keyDates(rec, now) {
    return entriesOf(rec).filter(function (en) {
      return en.at && en.at.getTime() >= startOfDay(now).getTime();
    }).sort(function (a, b) { return a.at - b.at; });
  }

  function matchesWindow(rec, now, win) {
    if (!win || win === 'all') return true;
    var from = startOfDay(now);
    var to;
    if (win === 'today') to = endOfDay(now);
    else if (win === 'tomorrow') { to = endOfDay(addDays(now, 1)); from = startOfDay(addDays(now, 1)); }
    else if (win === '3d') to = endOfDay(addDays(now, 2));
    else if (win === 'week') to = endOfDay(addDays(now, 7));
    else return true;
    var ks = entriesOf(rec);
    return ks.some(function (en) { return en.at && en.at.getTime() >= from.getTime() && en.at.getTime() <= to.getTime(); });
  }

  var NEWBIE_RANK = { '适合': 0, '一般': 1, '谨慎': 2, '不适合': 3 };

  function applyFilters(records, f, now) {
    f = f || {};
    return records.filter(function (rec) {
      if (f.hideNotices && rec.kind === 'notice') return false;
      if (!matchesQuery(rec, f.q)) return false;
      if (f.source && f.source.length && f.source.indexOf(sourceBucket(rec)) < 0) return false;
      if (f.category && f.category.length && f.category.indexOf(rec.category) < 0) return false;
      if (f.freshman && f.freshman.length && f.freshman.indexOf(rec.freshman.level) < 0) return false;
      if (f.states && f.states.length && f.states.indexOf(signupState(rec, now).code) < 0) return false;
      if (f.quick && f.quick.length) {
        for (var i = 0; i < f.quick.length; i++) {
          var q = f.quick[i];
          if (q === '直接去' && signupState(rec, now).code !== 'none_needed') return false;
          if (q === '还能报名' && ['open', 'closing_soon', 'review', 'rolling'].indexOf(signupState(rec, now).code) < 0) return false;
          // '适合新生' 是界面上的标签，'新手友好' 为等价别名（两者必须指向同一规则）
          if ((q === '适合新生' || q === '新手友好') && rec.freshman.level !== '适合') return false;
          if (q === '不占固定时间' && rec.commitment) return false;
          if (q === '需谨慎的' && (rec.flags || []).indexOf('risk_low_trust') < 0) return false;
        }
      }
      if (f.window && !matchesWindow(rec, now, f.window)) return false;
      return true;
    });
  }

  function urgencyOf(rec, now) {
    var ks = keyDates(rec, now);
    if (!ks.length) {
      var st = signupState(rec, now);
      if (st.code === 'rolling' || st.code === 'unknown') return { rank: 90, text: st.label, date: null };
      return { rank: 95, text: '无近期时间', date: null };
    }
    var first = ks[0];
    var r = relDay(first.at, now);
    var rank = r.days * 10 + (first.kind === 'deadline' ? 0 : 1);
    var prefix = first.kind === 'deadline' ? '截止：' : (first.kind === 'milestone' ? '节点：' : '开始：');
    return { rank: rank, text: prefix + (first.allDay ? fmtDate(first.at) : fmtDateTime(first.at)) + '（' + r.text + '）', date: first.at, entry: first };
  }

  function sortRecords(records, key, now) {
    var arr = records.slice();
    var byId = function (a, b) { return a.id.localeCompare(b.id); };
    if (key === 'deadline') {
      arr.sort(function (a, b) {
        var ua = urgencyOf(a, now), ub = urgencyOf(b, now);
        if (ua.rank !== ub.rank) return ua.rank - ub.rank;
        return byId(a, b);
      });
    } else if (key === 'time') {
      arr.sort(function (a, b) {
        var ea = entriesOf(a).filter(function (e) { return e.at && e.at >= now; });
        var eb = entriesOf(b).filter(function (e) { return e.at && e.at >= now; });
        var va = ea.length ? Math.min.apply(null, ea.map(function (e) { return e.at.getTime(); })) : Infinity;
        var vb = eb.length ? Math.min.apply(null, eb.map(function (e) { return e.at.getTime(); })) : Infinity;
        if (va !== vb) return va - vb;
        return byId(a, b);
      });
    } else { // recommend：新生友好优先，再按紧迫度
      arr.sort(function (a, b) {
        var ra = NEWBIE_RANK[a.freshman.level], rb = NEWBIE_RANK[b.freshman.level];
        if (ra !== rb) return ra - rb;
        var ua = urgencyOf(a, now), ub = urgencyOf(b, now);
        if (ua.rank !== ub.rank) return ua.rank - ub.rank;
        return byId(a, b);
      });
    }
    return arr;
  }

  /* ---------------- 统计 ---------------- */
  function stats(records, now) {
    var bySource = {}, byCategory = {}, byFreshman = {}, byState = {}, risky = [], unknownList = [];
    records.forEach(function (r) {
      var sb = sourceBucket(r);
      bySource[sb] = (bySource[sb] || 0) + 1;
      byCategory[r.category] = (byCategory[r.category] || 0) + 1;
      byFreshman[r.freshman.level] = (byFreshman[r.freshman.level] || 0) + 1;
      var sc = signupState(r, now).code;
      byState[sc] = (byState[sc] || 0) + 1;
      if ((r.flags || []).indexOf('risk_low_trust') >= 0) risky.push(r);
      (r.unknowns || []).forEach(function (u) { unknownList.push({ id: r.id, title: r.title, what: u.what, ask: u.ask }); });
    });
    var flags = {};
    records.forEach(function (r) { (r.flags || []).forEach(function (f) { flags[f] = (flags[f] || 0) + 1; }); });
    return {
      total: records.length, bySource: bySource, byCategory: byCategory,
      byFreshman: byFreshman, byState: byState, flags: flags,
      risky: risky, unknowns: unknownList,
      conflictInfo: detectConflicts(records)
    };
  }

  /* ---------------- 数据自检 ---------------- */
  var ALLOWED = {
    source: ['学院', '学生个人', '未注明'],
    category: ['技能学习', '讲座分享', '竞赛挑战', '团队招募', '志愿服务', '兴趣社群', '学习资料', '生活服务'],
    freshman: ['适合', '一般', '不适合', '谨慎'],
    deadlineKind: ['硬截止', '满员即止', '长期招募', '无需报名', '预约制·需审核', '链接有效期', '未注明'],
    flags: ['superseded', 'missing_field', 'risk_low_trust', 'inconsistent_time', 'deadline_after_first_session',
      'replay_pending', 'link_expiry', 'ambiguity', 'multi_milestone', 'not_for_freshman', 'waitlist_ok', 'student_posted'],
    kind: ['activity', 'notice']
  };

  function validate(records, meta) {
    var errs = [];
    var want = (meta && meta.total) || 26;
    if (records.length !== want) errs.push('条数应为 ' + want + '，实际 ' + records.length);
    var ids = records.map(function (r) { return r.id; });
    for (var i = 0; i < want; i++) {
      var expect = (i + 1 < 10 ? '0' : '') + (i + 1);
      if (ids[i] !== expect) errs.push('第 ' + (i + 1) + ' 条编号应为 ' + expect + '，实际 ' + ids[i]);
    }
    records.forEach(function (r) {
      var tag = '[' + r.id + ']';
      if (!r.title) errs.push(tag + ' 缺标题');
      if (!r.raw || String(r.raw).length < 10) errs.push(tag + ' 发布者缺失或过短');
      if (ALLOWED.source.indexOf(r.source.type) < 0) errs.push(tag + ' 非法来源类型 ' + r.source.type);
      if (ALLOWED.category.indexOf(r.category) < 0) errs.push(tag + ' 非法类别 ' + r.category);
      if (ALLOWED.freshman.indexOf(r.freshman.level) < 0) errs.push(tag + ' 非法新生判定 ' + r.freshman.level);
      if (ALLOWED.kind.indexOf(r.kind) < 0) errs.push(tag + ' 非法 kind ' + r.kind);
      if (ALLOWED.deadlineKind.indexOf(r.deadline.kind) < 0) errs.push(tag + ' 非法截止类型 ' + r.deadline.kind);
      (r.flags || []).forEach(function (f) { if (ALLOWED.flags.indexOf(f) < 0) errs.push(tag + ' 未知标记 ' + f); });
      if (r.deadline.known === false && r.deadline.at) errs.push(tag + ' deadline 标为未提供却带了时间值');
      if (r.deadline.kind === '硬截止' && !r.deadline.at) errs.push(tag + ' 标为硬截止却没有截止时间');
      if (r.source.type === '学院' && !r.source.publisher) errs.push(tag + ' 来源为学院却无发布单位');
      (r.related || []).forEach(function (rel) {
        if (!records.some(function (x) { return x.id === rel.id; })) errs.push(tag + ' 关联条目 ' + rel.id + ' 不存在');
      });
      if (r.when.known && !r.when.start && !r.when.date) errs.push(tag + ' when.known 为真却没有日期');
    });
    return errs;
  }

  var API = {
    DAY: DAY, DEFAULT_SESSION_MINUTES: DEFAULT_SESSION_MINUTES,
    setYear: setYear, boundYear: boundYear, bindYear: bindYear,
    parseISO: parseISO, addDays: addDays, addMinutes: addMinutes, startOfDay: startOfDay, endOfDay: endOfDay,
    ymd: ymd, fmtDate: fmtDate, fmtTime: fmtTime, fmtDateTime: fmtDateTime, weekdayOf: weekdayOf, dayDiff: dayDiff,
    relDay: relDay, countdown: countdown, weekdayVerdict: weekdayVerdict,
    entriesOf: entriesOf, eventState: eventState, signupState: signupState, stateOf: stateOf,
    detectConflicts: detectConflicts, dayLoad: dayLoad,
    tagList: tagList, haystack: haystack, matchesQuery: matchesQuery, matchesWindow: matchesWindow,
    sourceBucket: sourceBucket, keyDates: keyDates, applyFilters: applyFilters, urgencyOf: urgencyOf,
    sortRecords: sortRecords, stats: stats, validate: validate, ALLOWED: ALLOWED
  };
  root.CampusLogic = API;
  if (typeof module !== 'undefined' && module.exports) { module.exports = API; }

})(typeof window !== 'undefined' ? window : globalThis);
