/* 校园机会雷达 · 数据层
 * ------------------------------------------------------------------
 * 数据来源：题目提供的校园信息，编号 01–26。
 *   raw 字段为发布内容逐字照录，未改写、未删减；本产品不对发布者做「静默修正」。
 * 时间基准：电脑系统时间（页面右上角实时显示，可用 ±1 天做演示偏移）。
 *   发布者只写了「9月X日」，没有写年份；页面把日期年份绑定到系统年份，
 *   这样「今天」才能与题目里的 9 月 19 日 对应（否则换一年打开，全部条目都会显示「已结束」）。
 *   发布内容里的「每周六」「每周三」等星期说法会在运行时按系统年份的历法核对，对不上会被标出来。
 *   META.defaultNow 仅用于离线测试与「发布者对照」的年份基准（不是页面运行时的时钟）。
 * 缺失语义：字段为 null / known:false 一律表示「发布者未提供」，
 *   UI 显示「未注明」，绝不猜测填充（这是本产品的核心诚信约束）。
 * ------------------------------------------------------------------
 */
(function (root) {
  'use strict';

  var META = {
    product: '校园机会雷达',
    version: '1.1',
    /* 页面运行时不用这个时刻：它只是离线测试与「发布者对照」用的年份基准 */
    defaultNow: '2025-09-19T12:00',
    infoWindow: '9月18日—10月28日',
    timeBasis: '时间基准：电脑系统时间（右上角实时显示）',
    timeBasisWhy: '题目信息只给了「9月18日—10月28日」的月日、没有写年份；页面按你电脑系统时间的年份呈现这些日期，这样「今天」才能与题目里的 9 月 19 日 对上。若系统日期不在该区间，条目会如实显示为未开始或已结束，并给出区间提示。',
    weekdayPolicy: '发布内容里「每周六」「每周三」这类星期说法，会在运行时按你电脑年份的历法核对，对不上会直接标出来。',
    sourceNote: '数据来源：题目提供的校园信息，编号 01–26，发布内容逐条照录',
    total: 26
  };

  /* 记录字段说明（D 工厂的默认值即 schema）
   * id/title/raw      编号、标题、发布者
   * kind              activity 活动 | notice 变更·补充通知
   * source            {type: 学院|学生个人|未注明, publisher, basis: 发布者写明|据标题推断|未写明, hint}
   * category          技能学习|讲座分享|竞赛挑战|团队招募|志愿服务|兴趣社群|学习资料|生活服务
   * audience          发布者写明的面向对象
   * freshman          {level: 适合|一般|不适合|谨慎, why} 新生视角判定（依据发布者）
   * oneLiner          一句话看懂：什么时候、在哪、怎么报名
   * when              {date, start, end, timeKnown, known, text, recurring} ISO 本地时间
   * where             {text, known, note}
   * deadline          {at, dateOnly, text, kind, known} kind: 硬截止|满员即止|长期招募|无需报名|未注明
   * milestones        [{at, text}] 除报名外的第二个时点（如作品提交）
   * signup/fee/quota/commitment/materials  报名方式 / 费用(null=未提供) / 名额 / 投入 / 需提交材料
   * flags             发布者层事实标记（时间冲突、状态由 logic.js 计算，不在此列）
   * related           [{id, rel}] 关联条目（主要是补充通知）
   * tips              容易误读的点（依据发布者，白话解释）
   * unknowns          [{what, ask}] 发布者未提供 + 建议怎么问
   */
  function D(id, title, raw, o) {
    var r = {
      id: id, title: title, raw: raw, kind: 'activity',
      source: { type: '未注明', publisher: null, basis: '未写明', hint: null },
      category: '其他', audience: '发布者未注明',
      freshman: { level: '一般', why: '' },
      oneLiner: '',
      when: { date: null, start: null, end: null, timeKnown: false, known: false, text: '发布者没有写明时间', recurring: null, recur: null },
      where: { text: null, known: false, note: null },
      deadline: { at: null, dateOnly: false, text: '发布者未注明', kind: '未注明', known: false },
      milestones: [], signup: '发布者未注明', fee: null, quota: null, commitment: null, materials: [],
      weekdayClaim: null,
      flags: [], related: [], tips: [], unknowns: []
    };
    for (var k in o) { if (Object.prototype.hasOwnProperty.call(o, k)) r[k] = o[k]; }
    return r;
  }

  var STUDENT = { type: '学生个人', publisher: null, basis: '发布者写明', hint: '学生个人发布' };
  var UNKNOWN = { type: '未注明', publisher: null, basis: '未写明', hint: null };

  var DATA = [

    D('01', '「蓝桥杯」程序设计校内训练营',
      '9月24日22:00报名截止；原计划9月20日起每周六19:00训练；面向全校学生；零基础可参加',
      {
        source: { type: '未注明', publisher: null, basis: '据标题推断', hint: '校内训练营（据标题表述推断，发布者未写明发布单位）' },
        category: '技能学习',
        audience: '全校学生',
        freshman: { level: '适合', why: '发布者写明「零基础可参加」，不限年级专业' },
        oneLiner: '9月24日22:00前报名；首次训练已改为9月21日19:30，地点实验楼A402。',
        when: {
          date: '2025-09-21', start: '2025-09-21T19:30', end: '2025-09-21T21:30', timeKnown: true, known: true,
          text: '首次训练 9月21日19:30（经 09 号补充通知调整；原计划9月20日起每周六19:00）',
          recurring: '原计划每周六19:00'
        },
        where: { text: '实验楼 A402', known: true, note: '经 09 号补充通知调整后的地点' },
        deadline: { at: '2025-09-24T22:00', dateOnly: false, text: '9月24日22:00', kind: '硬截止', known: true },
        signup: '按发布者渠道报名；已报名同学无需重复提交（见 09 号补充通知）',
        flags: ['superseded', 'deadline_after_first_session'],
        weekdayClaim: { stated: '每周六', on: '2025-09-20', note: '发布者：原计划9月20日起每周六19:00训练' },
        related: [{ id: '09', rel: '补充通知：首次训练时间与地点变更，报名截止时间不变' }],
        tips: [
          '首次训练（9月21日）比报名截止（9月24日）更早，发布者未说明能否中途加入，建议先问主办方。',
          '「每周六19:00」是原计划；09 号补充通知只改了首次训练的时间和地点，后续安排以主办方通知为准。'
        ],
        unknowns: [{ what: '报名入口 / 报名方式', ask: '「训练营报名走哪个入口？9月21日首次训练之后还能报名吗？」' }]
      }),

    D('02', 'AI应用入门公开课',
      '9月19日19:00；计算机学院教学楼；面向全校学生；无需报名；预计90分钟',
      {
        category: '讲座分享',
        audience: '全校学生',
        freshman: { level: '适合', why: '无需报名、零基础友好，时长约 90 分钟，且就在今天' },
        oneLiner: '就在今天 9月19日19:00，直接去计算机学院教学楼，约 90 分钟，无需报名。',
        when: {
          date: '2025-09-19', start: '2025-09-19T19:00', end: '2025-09-19T20:30', timeKnown: true, known: true,
          text: '9月19日19:00，预计 90 分钟（结束时间按发布者时长推算）'
        },
        where: { text: '计算机学院教学楼', known: true, note: '发布者未写明具体教室' },
        deadline: { at: null, dateOnly: false, text: '无需报名', kind: '无需报名', known: true },
        signup: '无需报名，直接到场',
        flags: ['missing_field'],
        tips: [
          '与 18 号网络安全兴趣交流小组（同为今天 19:30 首次交流）时间重叠，只能二选一或提前离场。'
        ],
        unknowns: [{ what: '具体教室 / 容纳人数', ask: '「公开课在计算机学院教学楼哪间教室？需要提前占座吗？」' }]
      }),

    D('03', '大学生创新创业项目团队招募',
      '招募开发、设计、材料成员；每周需稳定投入4小时以上；9月22日18:00截止；需提交简短自我介绍',
      {
        category: '团队招募',
        audience: '发布者未注明（未限年级专业）',
        freshman: { level: '一般', why: '发布者未限年级，但要求每周稳定投入 4 小时以上，需自己评估课业与时间' },
        oneLiner: '9月22日18:00前提交简短自我介绍报名；注意 20 号补充说明：开发方向名额已满。',
        deadline: { at: '2025-09-22T18:00', dateOnly: false, text: '9月22日18:00', kind: '硬截止', known: true },
        signup: '需提交简短自我介绍',
        commitment: '每周需稳定投入 4 小时以上',
        materials: ['简短自我介绍'],
        flags: ['superseded', 'missing_field'],
        related: [{ id: '20', rel: '补充说明：开发方向名额已满，现主要补充设计与材料成员；此前已投递者无需重复提交' }],
        tips: [
          '发布者只写「需提交简短自我介绍」，没写投递渠道，投之前先确认发给谁。',
          '20 号补充说明改变了招募方向：只想做开发的同学这次基本没名额了。'
        ],
        unknowns: [{ what: '投递渠道 / 结果通知方式', ask: '「自我介绍提交到哪里？截止后多久通知结果？」' }]
      }),

    D('04', '数学建模竞赛经验分享会',
      '直播时间为9月18日19:30；不限专业；直播已结束，活动方预计9月20日上传回放',
      {
        category: '讲座分享',
        audience: '不限专业',
        freshman: { level: '适合', why: '不限专业；直播已结束，可直接等回放，不用赶时间' },
        oneLiner: '直播已于 9月18日19:30 结束；回放预计 9月20日上传（发布者未给回放地址）。',
        when: {
          date: '2025-09-18', start: '2025-09-18T19:30', end: null, timeKnown: true, known: true,
          text: '9月18日19:30 直播（已结束）；回放预计 9月20日 上传'
        },
        deadline: { at: null, dateOnly: false, text: '直播已结束，无需报名', kind: '无需报名', known: true },
        milestones: [{ at: '2025-09-20', text: '回放预计上传（发布者仅写「预计9月20日」，未注明时刻）' }],
        signup: '直播已结束；等回放',
        flags: ['replay_pending'],
        tips: [
          '回放是「预计」9月20日上传，发布者没有给确定时间和回放地址，属于待确认信息。'
        ],
        unknowns: [{ what: '回放地址 / 上线时间', ask: '「分享会回放在哪里发布？9月20日几点能看？」' }]
      }),

    D('05', '校园公益志愿服务活动',
      '活动时间9月27日8:30—17:00；9月20日12:00报名截止；预计服务8小时；需提前到场签到',
      {
        source: { type: '未注明', publisher: null, basis: '据标题推断', hint: '校园公益活动（据标题表述推断，发布者未写明主办单位）' },
        category: '志愿服务',
        audience: '发布者未注明（面向学生）',
        freshman: { level: '适合', why: '单日志愿服务、时间明确、门槛低；注意报名截止比活动早一周' },
        oneLiner: '9月20日12:00前报名；9月27日8:30—17:00 服务，需提前到场签到。',
        when: {
          date: '2025-09-27', start: '2025-09-27T08:30', end: '2025-09-27T17:00', timeKnown: true, known: true,
          text: '9月27日 8:30—17:00（预计服务 8 小时）'
        },
        deadline: { at: '2025-09-20T12:00', dateOnly: false, text: '9月20日12:00', kind: '硬截止', known: true },
        signup: '按发布者报名（发布者未写明报名入口）',
        commitment: '预计服务 8 小时（单日）',
        flags: ['missing_field'],
        tips: [
          '报名截止（9月20日12:00）比活动本身（9月27日）早一整周，容易误以为可以现场报名。'
        ],
        unknowns: [{ what: '报名入口 / 集合地点', ask: '「志愿服务在哪里报名？9月27日早上在哪个门集合签到？」' }]
      }),

    D('06', 'Web开发零基础学习小组',
      '9月23日起每周三19:30开展，共6周；面向零基础学生；限30人；报名时间未注明，满员即止',
      {
        category: '技能学习',
        audience: '零基础学生',
        freshman: { level: '适合', why: '面向零基础、连续 6 周有固定节奏；但报名时间没写、限 30 人，要尽早问' },
        oneLiner: '9月23日19:30 起每周三、共 6 周；限 30 人、满员即止，报名时间发布者未注明。',
        when: {
          date: '2025-09-23', start: '2025-09-23T19:30', end: '2025-09-23T21:00', timeKnown: true, known: true,
          text: '9月23日起每周三19:30，共 6 周（发布者另写「每周三」，星期是否对得上见下方口径核对）',
          recurring: '每周三19:30 × 6 周',
          recur: { count: 6, everyDays: 7, note: '按发布者「9月23日起…共6周」逐周推算；第 2—6 次日期为推算值' }
        },
        deadline: { at: null, dateOnly: false, text: '报名时间未注明，满员即止', kind: '满员即止', known: false },
        quota: '限 30 人',
        flags: ['missing_field'],
        weekdayClaim: { stated: '每周三', on: '2025-09-23', note: '发布者：9月23日起每周三19:30开展' },
        tips: [
          '发布者同时给了「9月23日起」和「每周三」，这两个说法是否对得上依年份而定（页面会按你电脑的年份核对并给出结论）。',
          '没有报名截止时间，只有「满员即止」，属于先到先得。'
        ],
        unknowns: [
          { what: '报名方式 / 首次活动日期', ask: '「小组报名时间没写，现在报还来得及吗？第一次是按 9月23日 还是按周三算？」' }
        ]
      }),

    D('07', 'AI创新应用挑战赛',
      '2—4人组队；9月21日18:00前完成校内意向登记；10月20日提交作品；意向登记不等同于最终作品提交',
      {
        category: '竞赛挑战',
        audience: '发布者未注明（2—4 人组队）',
        freshman: { level: '一般', why: '组队 2—4 人、周期到 10月20日，需要队友和持续投入；登记后还有一步作品提交' },
        oneLiner: '9月21日18:00前做校内意向登记；10月20日提交作品——登记不等于提交，别漏第二步。',
        deadline: { at: '2025-09-21T18:00', dateOnly: false, text: '9月21日18:00（校内意向登记）', kind: '硬截止', known: true },
        milestones: [{ at: '2025-10-20T23:59', text: '10月20日 提交作品（发布者未注明具体时刻）' }],
        signup: '2—4 人组队，先完成校内意向登记',
        flags: ['ambiguity', 'multi_milestone', 'missing_field'],
        tips: [
          '「意向登记」不等于「最终作品提交」，两个节点都要做，只登记不提交等于没参赛。',
          '2—4 人组队，发布者没说能否跨专业、跨年级组队。'
        ],
        unknowns: [
          { what: '登记入口 / 作品提交平台', ask: '「校内意向登记在哪个系统填？作品提交用什么平台、几点截止？」' }
        ]
      }),

    D('08', '校园软件项目组招募',
      '开发校园实用工具；面向大一、大二学生；希望成员了解Git基本操作；每周预计投入5小时；长期招募，满员即止',
      {
        category: '团队招募',
        audience: '大一、大二学生',
        freshman: { level: '适合', why: '明确面向大一，长期招募；「希望了解 Git」是期望，不等于硬门槛' },
        oneLiner: '长期招募、满员即止；面向大一/大二，每周约 5 小时，希望你了解 Git 基本操作。',
        deadline: { at: null, dateOnly: false, text: '长期招募，满员即止', kind: '长期招募', known: false },
        signup: '按发布者报名（发布者未写明报名方式）',
        commitment: '每周预计投入 5 小时',
        flags: ['missing_field'],
        tips: [
          '「希望成员了解 Git 基本操作」是期望而非硬性要求，完全没学过也可以先问一句。',
          '没有截止日期，只有「满员即止」，想参加就尽早联系。'
        ],
        unknowns: [
          { what: '报名方式 / 剩余名额', ask: '「项目组怎么报名？现在还缺人吗？完全没学过 Git 可以加入吗？」' }
        ]
      }),

    D('09', '程序设计训练营补充通知',
      '因场地调整，首次训练改为9月21日19:30，地点改至实验楼A402；已报名同学无需重复提交；报名截止时间不变',
      {
        kind: 'notice',
        category: '技能学习',
        audience: '全校学生（对应 01 号训练营）',
        freshman: { level: '适合', why: '这是 01 号训练营的时间地点变更通知，打算参加的同学必看' },
        oneLiner: '变更通知：01 号训练营首次训练改为 9月21日19:30、地点改到实验楼A402；报名截止仍是 9月24日22:00。',
        when: {
          date: '2025-09-21', start: '2025-09-21T19:30', end: '2025-09-21T21:30', timeKnown: true, known: true,
          text: '首次训练 9月21日19:30（变更后；原为 9月20日起每周六19:00）'
        },
        where: { text: '实验楼 A402', known: true, note: '场地调整后的地点' },
        deadline: { at: '2025-09-24T22:00', dateOnly: false, text: '9月24日22:00（保持不变）', kind: '硬截止', known: true },
        signup: '已报名同学无需重复提交',
        related: [{ id: '01', rel: '本通知对应 01 号「蓝桥杯」程序设计校内训练营' }],
        tips: [
          '这是对 01 号的补充通知，不是新活动；只看 01 号会错过时间与地点的变更。',
          '变更后的首次训练是 9月21日19:30（发布者原为「9月20日起每周六」），与原先的周六节奏不一致。'
        ],
        unknowns: []
      }),

    D('10', '前端开发经验交流会',
      '9月19日15:00—16:30；线下A201并同步线上直播；无需报名',
      {
        category: '讲座分享',
        audience: '发布者未注明（面向学生）',
        freshman: { level: '适合', why: '无需报名，线下/线上都能参加，时长 90 分钟' },
        oneLiner: '就在今天 9月19日15:00—16:30，线下 A201 或线上直播，无需报名。',
        when: {
          date: '2025-09-19', start: '2025-09-19T15:00', end: '2025-09-19T16:30', timeKnown: true, known: true,
          text: '9月19日 15:00—16:30'
        },
        where: { text: 'A201（线下），同步线上直播', known: true, note: '发布者未给线上直播入口' },
        deadline: { at: null, dateOnly: false, text: '无需报名', kind: '无需报名', known: true },
        signup: '无需报名，线下到 A201 或看线上直播',
        flags: ['missing_field'],
        tips: ['发布者写了「同步线上直播」但没给直播入口，想看线上要先问链接。'],
        unknowns: [{ what: '线上直播入口', ask: '「线上直播在哪里看？有回放吗？」' }]
      }),

    D('11', '大学生科研入门分享会',
      '9月21日19:00—20:30；介绍论文检索、学生科研项目和导师联系方法；面向全校学生',
      {
        category: '讲座分享',
        audience: '全校学生',
        freshman: { level: '适合', why: '讲论文检索、科研项目、怎么联系导师，是新生最缺的入门信息' },
        oneLiner: '9月21日19:00—20:30；讲论文检索、学生科研项目、怎么联系导师。',
        when: {
          date: '2025-09-21', start: '2025-09-21T19:00', end: '2025-09-21T20:30', timeKnown: true, known: true,
          text: '9月21日 19:00—20:30'
        },
        deadline: { at: null, dateOnly: false, text: '发布者未注明报名方式', kind: '未注明', known: false },
        flags: ['missing_field'],
        tips: [
          '与 14 号 Git 工作坊时间完全重叠（同为 9月21日19:00—20:30），只能选一个。',
          '发布者没写地点、也没写是否需要报名，去之前要先确认。'
        ],
        unknowns: [
          { what: '地点 / 是否需要报名', ask: '「分享会在哪个教室？需要提前报名吗？」' }
        ]
      }),

    D('12', '全国高校计算机能力挑战赛',
      '面向本科生；10月5日23:59报名截止；个人参赛；具体费用信息未提供',
      {
        category: '竞赛挑战',
        audience: '本科生',
        freshman: { level: '一般', why: '面向本科生、个人参赛，门槛不高；但费用发布者未提供，报名可能要交费' },
        oneLiner: '10月5日23:59前报名，个人参赛；费用发布者未提供，先问清楚再报。',
        deadline: { at: '2025-10-05T23:59', dateOnly: false, text: '10月5日23:59', kind: '硬截止', known: true },
        signup: '个人参赛，按发布者报名（发布者未写明报名入口）',
        fee: null,
        flags: ['missing_field'],
        tips: [
          '发布者明确写「具体费用信息未提供」——可能涉及报名费，决定前先确认。',
          '「面向本科生」不区分年级，大一也能报，但难度要自己评估。'
        ],
        unknowns: [
          { what: '报名费用 / 报名入口', ask: '「这个比赛报名费多少？校内从哪个入口报名？」' }
        ]
      }),

    D('13', '科研助理招募',
      '协助数据整理和实验工作；仅限大二及以上学生；每周预计投入6小时；9月21日截止报名',
      {
        category: '团队招募',
        audience: '仅限大二及以上学生',
        freshman: { level: '不适合', why: '发布者明确「仅限大二及以上」，大一新生不符合报名条件' },
        oneLiner: '9月21日截止报名；仅限大二及以上、每周约 6 小时——大一同学暂不符合条件。',
        when: { date: null, start: null, end: null, timeKnown: false, known: false, text: '未注明工作起始时间' },
        deadline: { at: '2025-09-21', dateOnly: true, text: '9月21日（发布者未注明具体时刻）', kind: '硬截止', known: true },
        signup: '按发布者报名（发布者未写明报名方式）',
        commitment: '每周预计投入 6 小时',
        flags: ['not_for_freshman', 'missing_field'],
        tips: [
          '「仅限大二及以上」是硬门槛，大一投递会被筛掉，可以收藏起来明年再看。',
          '只写「9月21日截止」，没写几点，建议当天尽早提交。'
        ],
        unknowns: [
          { what: '报名方式 / 截止具体时刻', ask: '「科研助理怎么报名？9月21日几点截止？」' }
        ]
      }),

    D('14', 'Git与GitHub零基础工作坊',
      '9月21日19:00—20:30；主要面向大一新生；限40人；需提前预约，提交报名表不代表最终录取，以审核通知为准',
      {
        category: '技能学习',
        audience: '主要面向大一新生',
        freshman: { level: '适合', why: '主要面向大一新生、零基础上手；但限 40 人要预约，且报名≠录取' },
        oneLiner: '9月21日19:00—20:30；需提前预约、限 40 人；提交报名表不代表录取，等审核通知。',
        when: {
          date: '2025-09-21', start: '2025-09-21T19:00', end: '2025-09-21T20:30', timeKnown: true, known: true,
          text: '9月21日 19:00—20:30'
        },
        deadline: { at: null, dateOnly: false, text: '需提前预约（发布者未注明预约截止时间）', kind: '预约制·需审核', known: false },
        signup: '需提前预约并提交报名表，是否录取以审核通知为准',
        quota: '限 40 人',
        flags: ['ambiguity', 'missing_field'],
        tips: [
          '「提交报名表不代表最终录取」——报完不算报上，要等审核通知。',
          '与 11 号科研入门分享会时间完全重叠（同为 9月21日19:00—20:30），只能选一个。',
          '限 40 人，但没写预约截止时间；发布者也没写地点。'
        ],
        unknowns: [
          { what: '预约截止时间 / 地点', ask: '「工作坊预约最晚什么时候？在哪个教室？」' }
        ]
      }),

    D('15', 'AI应用创意挑战',
      '9月23日23:59前提交创意方案；9月30日前提交最终作品；允许个人或团队参加；进入展示环节后可再组队',
      {
        category: '竞赛挑战',
        audience: '发布者未注明',
        freshman: { level: '一般', why: '允许个人参加、可以先交创意方案；但有两个提交节点，节奏偏紧' },
        oneLiner: '9月23日23:59前交创意方案，9月30日前交最终作品；可个人可团队。',
        deadline: { at: '2025-09-23T23:59', dateOnly: false, text: '9月23日23:59（创意方案）', kind: '硬截止', known: true },
        milestones: [{ at: '2025-09-30T23:59', text: '9月30日前 提交最终作品（发布者未注明具体时刻）' }],
        signup: '按发布者提交（发布者未写明提交入口）',
        flags: ['multi_milestone', 'missing_field'],
        tips: [
          '两个截止时间分属不同阶段：先交创意方案（9月23日），再交最终作品（9月30日）。',
          '「进入展示环节后可再组队」意味着可以先个人报名，后面再找队友。'
        ],
        unknowns: [
          { what: '提交入口 / 是否需报名', ask: '「创意方案提交到哪个邮箱或平台？需要先报名吗？」' }
        ]
      }),

    D('16', '校园摄影志愿者招募',
      '长期招募；参与校内大型活动摄影；具体报名截止时间未注明；有摄影设备者优先但不作硬性要求',
      {
        source: { type: '未注明', publisher: null, basis: '据标题推断', hint: '校内志愿岗（据标题表述推断，发布者未写明主办单位）' },
        category: '志愿服务',
        audience: '发布者未注明',
        freshman: { level: '适合', why: '长期招募、无硬性设备要求（有设备者优先），适合慢慢参与' },
        oneLiner: '长期招募、没有截止时间；有摄影设备者优先，但不作硬性要求。',
        deadline: { at: null, dateOnly: false, text: '长期招募，具体截止时间未注明', kind: '长期招募', known: false },
        signup: '按发布者报名（发布者未写明报名方式）',
        flags: ['missing_field'],
        tips: [
          '「有摄影设备者优先」不是硬门槛，没有相机也可以先问。',
          '没有截止时间，但长期招募通常按需安排，建议尽早联系。'
        ],
        unknowns: [
          { what: '报名方式 / 联系方式', ask: '「摄影志愿者怎么报名？没有专业相机可以参加吗？」' }
        ]
      }),

    D('17', 'Python程序设计学习资料合集',
      '包含课程、练习和项目案例；资料长期开放；当前网盘提取信息有效至9月22日，后续将统一更新',
      {
        category: '学习资料',
        audience: '发布者未注明（面向学生）',
        freshman: { level: '适合', why: '随时可看的自学资料，零门槛；但网盘提取信息 9月22日 后可能失效' },
        oneLiner: '资料长期开放；当前网盘提取信息有效至 9月22日，之后会统一更新。',
        when: { date: null, start: null, end: null, timeKnown: false, known: false, text: '资料长期开放（非定时活动）' },
        deadline: { at: '2025-09-22', dateOnly: true, text: '网盘提取信息有效至 9月22日（发布者未注明具体时刻）', kind: '链接有效期', known: true },
        signup: '按发布者提供的网盘提取信息获取（发布者未提供链接本身）',
        flags: ['link_expiry', 'missing_field'],
        tips: [
          '资料本身「长期开放」，但当前分享链接/提取码（发布者称「网盘提取信息」）9月22日 之后可能失效，要下就趁早。',
          '发布者没有给出链接与提取码本身，只说明了有效期。'
        ],
        unknowns: [
          { what: '资料链接本身 / 更新后的新链接', ask: '「资料链接和提取码是什么？9月22日之后在哪里更新？」' }
        ]
      }),

    D('18', '网络安全兴趣交流小组',
      '首次交流时间为9月19日19:30；之后每两周开展一次；面向CTF、Web安全等方向感兴趣的学生；不限基础',
      {
        category: '兴趣社群',
        audience: '对 CTF、Web 安全等方向感兴趣的学生（不限基础）',
        freshman: { level: '适合', why: '发布者写明「不限基础」，兴趣型小组，首次交流就在今晚' },
        oneLiner: '就在今晚 9月19日19:30 首次交流，之后每两周一次；不限基础。',
        when: {
          date: '2025-09-19', start: '2025-09-19T19:30', end: null, timeKnown: true, known: true,
          text: '首次 9月19日19:30；之后每两周一次（第二次预计 10月3日，据发布者「每两周」推算）',
          recurring: '每两周一次',
          recur: { count: 2, everyDays: 14, note: '按发布者「之后每两周开展一次」推算第二次为 10月3日' }
        },
        deadline: { at: null, dateOnly: false, text: '发布者未注明是否需要报名', kind: '未注明', known: false },
        signup: '发布者未注明报名方式',
        flags: ['missing_field'],
        tips: [
          '与 02 号 AI 应用入门公开课（19:00—20:30）时间重叠，今晚两场只能选一个。',
          '发布者没写地点、也没写要不要报名，直接去之前先确认。'
        ],
        unknowns: [
          { what: '地点 / 是否需要报名', ask: '「今晚的交流会在哪间教室？需要提前报名吗？」' }
        ]
      }),

    D('19', '学生创新项目路演观摩',
      '活动时间9月20日14:30；原报名截止时间为9月18日22:00；活动方说明如现场仍有余位，可接受候补入场',
      {
        category: '讲座分享',
        audience: '发布者未注明',
        freshman: { level: '适合', why: '观摩类活动、报名已截止但可候补入场，适合临时去看' },
        oneLiner: '9月20日14:30 活动；报名已于 9月18日22:00 截止，现场有余位可候补入场。',
        when: {
          date: '2025-09-20', start: '2025-09-20T14:30', end: null, timeKnown: true, known: true,
          text: '9月20日14:30（发布者未注明结束时间）'
        },
        deadline: { at: '2025-09-18T22:00', dateOnly: false, text: '原报名截止 9月18日22:00（已过）', kind: '硬截止', known: true },
        signup: '报名已截止；现场有余位可候补入场',
        flags: ['waitlist_ok', 'missing_field'],
        tips: [
          '报不了名 ≠ 去不了：发布者写明「如现场仍有余位，可接受候补入场」，可以早点到现场等位。',
          '发布者没写地点，也没写候补的具体规则，建议提前到并先问工作人员。'
        ],
        unknowns: [
          { what: '地点 / 候补规则', ask: '「路演在哪个场地？候补是现场排队吗？几点开始放人？」' }
        ]
      }),

    D('20', '创新创业项目团队补充说明',
      '开发方向名额已满，现主要补充设计与材料成员；9月22日18:00截止；此前已投递者无需重复提交',
      {
        kind: 'notice',
        category: '团队招募',
        audience: '发布者未注明（对应 03 号项目）',
        freshman: { level: '一般', why: '03 号项目的补充说明：开发方向名额已满，现在主要缺设计与材料' },
        oneLiner: '补充说明：03 号项目开发方向名额已满，现在主要补设计与材料成员；已投递者无需重复提交。',
        deadline: { at: '2025-09-22T18:00', dateOnly: false, text: '9月22日18:00', kind: '硬截止', known: true },
        signup: '按 03 号发布者方式投递；此前已投递者无需重复提交',
        materials: ['简短自我介绍'],
        related: [{ id: '03', rel: '本说明对应 03 号「大学生创新创业项目团队招募」' }],
        tips: [
          '如果你的目标是写代码，这个项目开发方向已经满了；设计与材料方向仍可投递。',
          '「此前已投递者无需重复提交」——已经交过自我介绍的同学不要再交一遍。'
        ],
        unknowns: []
      }),

    D('21', '计算机学院AI产品设计分享会',
      '计算机学院发布；9月20日19:00；明德楼B203；面向全校学生；无需报名，座位有限',
      {
        source: { type: '学院', publisher: '计算机学院', basis: '发布者写明', hint: null },
        category: '讲座分享',
        audience: '全校学生',
        freshman: { level: '适合', why: '学院官方发布、无需报名、地点明确；座位有限需早到' },
        oneLiner: '9月20日19:00 明德楼B203，无需报名但座位有限，建议提前到。',
        when: {
          date: '2025-09-20', start: '2025-09-20T19:00', end: null, timeKnown: true, known: true,
          text: '9月20日19:00（发布者未注明结束时间）'
        },
        where: { text: '明德楼 B203', known: true },
        deadline: { at: null, dateOnly: false, text: '无需报名（座位有限，先到先得）', kind: '无需报名', known: true },
        signup: '无需报名，直接到场',
        tips: [
          '「无需报名」但「座位有限」，实际是先到先坐，最好提前 15 分钟到。'
        ],
        unknowns: []
      }),

    D('22', '学生发起｜周末羽毛球约球',
      '学生个人发布；9月20日16:00；计划6—8人；费用AA；场地待最终确认',
      {
        source: STUDENT,
        category: '兴趣社群',
        audience: '发布者未注明（6—8 人小规模）',
        freshman: { level: '适合', why: '运动社交型、零门槛、费用 AA；但场地还没定，去之前先问' },
        oneLiner: '9月20日16:00，6—8 人，费用 AA；场地「待最终确认」，出发前先问。',
        when: {
          date: '2025-09-20', start: '2025-09-20T16:00', end: null, timeKnown: true, known: true,
          text: '9月20日16:00（发布者未注明结束时间）'
        },
        where: { text: null, known: false, note: '发布者写明「场地待最终确认」' },
        deadline: { at: null, dateOnly: false, text: '发布者未注明报名截止时间', kind: '未注明', known: false },
        signup: '按发布者联系发起人（发布者未写明联系方式）',
        fee: 'AA',
        quota: '计划 6—8 人',
        flags: ['missing_field', 'student_posted'],
        tips: [
          '学生个人发起、非校方组织，费用与安全自理；场地发布者写明「待最终确认」，出发前务必确认地点。'
        ],
        unknowns: [
          { what: '场地 / 联系方式', ask: '「场地定了吗？在哪个球场？怎么联系你确认？」' }
        ]
      }),

    D('23', '学生发起｜AI工具交流搭子招募',
      '学生个人发布；拟于9月21日晚开展；欢迎零基础；报名后拉群；具体地点未确定',
      {
        source: STUDENT,
        category: '兴趣社群',
        audience: '欢迎零基础',
        freshman: { level: '适合', why: '欢迎零基础的交流型活动；但时间和地点都还没定，属于「先报名后通知」' },
        oneLiner: '拟 9月21日晚，欢迎零基础；报名后拉群，具体地点未确定。',
        when: {
          date: '2025-09-21', start: null, end: null, timeKnown: false, known: true,
          text: '拟于 9月21日晚（发布者未注明具体时间）'
        },
        where: { text: null, known: false, note: '发布者写明「具体地点未确定」' },
        deadline: { at: null, dateOnly: false, text: '发布者未注明报名截止时间', kind: '未注明', known: false },
        signup: '报名后拉群（发布者未写明报名方式）',
        flags: ['missing_field', 'student_posted'],
        tips: [
          '时间和地点都没定（发布者如此），属于「先报名后群里通知」型，注意看群消息。',
          '学生个人发起、非校方组织，注意保护个人信息，不轻信群内收费要求。'
        ],
        unknowns: [
          { what: '具体时间 / 地点 / 发起人身份', ask: '「具体几点、在哪里？群主是哪个学院的同学？」' }
        ]
      }),

    D('24', '学生发起｜「校园兼职福利分享」',
      '学生个人发布；称「零门槛、日结」，要求添加私人微信获取详情；未提供主办方、地点和完整内容',
      {
        source: STUDENT,
        category: '生活服务',
        audience: '发布者未注明',
        freshman: { level: '谨慎', why: '发布者信息本身可疑：只让加私人微信，「零门槛、日结」，且未提供主办方、地点与完整内容' },
        oneLiner: '信息不完整：「零门槛、日结」+ 只让加私人微信，发布者未提供主办方、地点和内容。',
        when: { date: null, start: null, end: null, timeKnown: false, known: false, text: '发布者未注明活动时间' },
        where: { text: null, known: false, note: '发布者未提供地点' },
        deadline: { at: null, dateOnly: false, text: '发布者未注明报名截止时间', kind: '未注明', known: false },
        signup: '要求添加私人微信获取详情',
        flags: ['risk_low_trust', 'missing_field', 'student_posted'],
        tips: [
          '「零门槛、日结」+「加私人微信」是兼职诈骗的常见话术组合，本条又没有主办方、地点和工作内容。',
          '建议：不转账、不交押金、不提供身份证/银行卡信息；真要核实，可先问辅导员或学校就业指导中心。',
          '本条由学生个人发布，未经校方审核，不代表学校信息。'
        ],
        unknowns: [
          { what: '主办单位 / 工作内容 / 地点 / 报酬结算方式', ask: '「主办单位全称是什么？工作地点在哪？报酬怎么结算、有没有书面协议？」' }
        ]
      }),

    D('25', '学生发起｜数码新品体验交流',
      '学生个人发布；标题为技术交流，正文主要介绍某商家优惠及购买链接；活动时间、地点未注明',
      {
        source: STUDENT,
        category: '生活服务',
        audience: '发布者未注明',
        freshman: { level: '谨慎', why: '标题写技术交流，正文却是商家优惠与购买链接；时间地点都没写，属标题与内容不符' },
        oneLiner: '标题是技术交流，正文主要是商家优惠与购买链接；时间、地点都未注明。',
        when: { date: null, start: null, end: null, timeKnown: false, known: false, text: '发布者未注明活动时间' },
        where: { text: null, known: false, note: '发布者未注明活动地点' },
        deadline: { at: null, dateOnly: false, text: '发布者未注明报名截止时间', kind: '未注明', known: false },
        signup: '发布者未注明报名方式（正文以购买链接为主）',
        flags: ['risk_low_trust', 'missing_field', 'student_posted'],
        tips: [
          '标题与内容不一致 + 带购买链接，属于典型的导流/带货信息，不是真正的校园技术活动。',
          '发布者没有活动时间与地点，无法当作活动参加；不建议按文中链接下单。'
        ],
        unknowns: [
          { what: '活动时间 / 地点 / 是否真的有线下交流', ask: '「这条到底有没有线下活动？时间地点在哪？」' }
        ]
      }),

    D('26', '外国语学院校园语言角',
      '外国语学院发布；9月21日15:00；面向全校学生；自由交流；场地容量有限，无需提前报名',
      {
        source: { type: '学院', publisher: '外国语学院', basis: '发布者写明', hint: null },
        category: '兴趣社群',
        audience: '全校学生',
        freshman: { level: '适合', why: '学院发布、无需报名、自由交流，适合作息规律地练口语认识人' },
        oneLiner: '9月21日15:00，无需提前报名、自由交流；场地容量有限，建议早到。',
        when: {
          date: '2025-09-21', start: '2025-09-21T15:00', end: null, timeKnown: true, known: true,
          text: '9月21日15:00（发布者未注明结束时间）'
        },
        where: { text: null, known: false, note: '发布者未写明具体场地' },
        deadline: { at: null, dateOnly: false, text: '无需提前报名', kind: '无需报名', known: true },
        signup: '无需提前报名，直接到场',
        flags: ['missing_field'],
        tips: [
          '「无需提前报名」但「场地容量有限」，实际是先到先进，建议提前到。',
          '发布者没有写明具体场地（只写了「外国语学院校园语言角」）。'
        ],
        unknowns: [
          { what: '具体场地', ask: '「语言角在外国语学院哪间教室或哪个区域？」' }
        ]
      })

  ];

  var API = { META: META, DATA: DATA, make: D };
  root.CampusData = API;
  if (typeof module !== 'undefined' && module.exports) { module.exports = API; }

})(typeof window !== 'undefined' ? window : globalThis);
