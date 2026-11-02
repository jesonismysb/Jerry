/* ==================================================================
 * 《医学综合习题集（理论）》题库数据
 * 河北省中等职业学校对口升学 医学类专业
 * 含：解剖学基础理论习题 / 生理学专业理论 / 药物学基础
 *
 * ----------------------------------------------------------------
 * 【题目格式】目前已搭建框架，各章节 questions 为空数组，后续分批导入：
 *
 *   { q: '题干文字', options: ['选项A', '选项B', '选项C', '选项D'], answer: 0, explain: '解析文字' }
 *
 *   answer 为正确选项下标（0=A，1=B，2=C，3=D）
 *   全部为单选题；difficulty 可省略（默认基础题）
 *
 * 导入示例：
 *   绪论: questions: [
 *     { q: '对人体结构进行宏观描述的解剖学分支是', options: ['系统解剖学','组织学','细胞学','胚胎学'], answer: 0, explain: '系统解剖学按人体器官系统进行宏观描述。' },
 *   ]
 * ----------------------------------------------------------------
 * 本文件同时把 3 个一级分类并入 window.BOOKS（教材题库），
 * 使其自动出现在【随机组卷】的可选教材列表中，不改动组卷模块逻辑。
 * ================================================================== */
(function () {
  'use strict';

  /** 生成章节（questions 留空，待批量导入；其余字段给空数组，保证教材页搜索/渲染安全） */
  function ch(title) {
    return {
      title: title,
      sections: [],
      knowledge: [],
      examPoints: [],
      memorize: [],
      questions: []          // ← 后续在此填充单选题数据
    };
  }

  var MEDICAL = {
    title: '医学综合习题集（理论）',
    subtitle: '河北省中等职业学校对口升学 · 医学类专业',
    categories: [
      {
        id: 'med-anatomy',
        title: '解剖学基础理论习题',
        short: '解剖学基础',
        cover: 'cv-anatomy',
        deco: 'fa-solid fa-bone',
        chapters: [
          ch('绪论'),
          ch('细胞'),
          ch('基本组织'),
          ch('运动系统'),
          ch('消化系统'),
          ch('呼吸系统'),
          ch('泌尿系统'),
          ch('生殖系统'),
          ch('脉管系统'),
          ch('感觉器'),
          ch('神经系统'),
          ch('内分泌系统')
        ]
      },
      {
        id: 'med-physiology',
        title: '生理学专业理论',
        short: '生理学',
        cover: 'cv-physiology',
        deco: 'fa-solid fa-heart-pulse',
        chapters: [
          ch('绪论'),
          ch('细胞的基本功能'),
          ch('血液'),
          ch('血液循环'),
          ch('呼吸'),
          ch('消化与吸收'),
          ch('能量代谢与体温'),
          ch('肾脏的排泄功能'),
          ch('感觉器官'),
          ch('神经系统'),
          ch('内分泌'),
          ch('生殖')
        ]
      },
      {
        id: 'med-pharmacology',
        title: '药物学基础',
        short: '药物学基础',
        cover: 'cv-pharmacology',
        deco: 'fa-solid fa-pills',
        chapters: [
          ch('药物学基础总论'),
          ch('局部麻醉药'),
          ch('中枢神经系统药'),
          ch('传出神经系统药物'),
          ch('心血管用药'),
          ch('呼吸系统药'),
          ch('消化系统药'),
          ch('利尿药与脱水药'),
          ch('血液和造血系统药'),
          ch('子宫兴奋药与子宫抑制药'),
          ch('抗过敏'),
          ch('激素类药物'),
          ch('抗微生物药'),
          ch('抗寄生虫药'),
          ch('抗恶性肿瘤药'),
          ch('解毒药')
        ]
      }
    ]
  };

  /* 题型归一化：本习题集全部为单选题，导入时若未写 type 则自动补 'choice'。
   * 随机组卷模块的题池只收 type=choice/judge 的题，缺 type 会被静默过滤。
   * 此处统一补齐，导入数据时无需重复写 type 字段。 */
  MEDICAL.categories.forEach(function (cat) {
    (cat.chapters || []).forEach(function (c) {
      (c.questions || []).forEach(function (q) {
        if (!q.type) q.type = 'choice';
      });
    });
  });

  /* 统计辅助：各分类 / 全书已导入题目数 */
  MEDICAL.countQuestions = function (cat) {
    return (cat.chapters || []).reduce(function (n, c) {
      return n + ((c.questions && c.questions.length) || 0);
    }, 0);
  };

  window.MEDICAL = MEDICAL;

  /* 并入教材题库：随机组卷模块读取 BOOKS，因此这本习题集自动可选章抽题。
   * 原 books-data.js 先于本文件加载；此处仅 push，不改变原书数据。 */
  if (Array.isArray(window.BOOKS)) {
    MEDICAL.categories.forEach(function (cat) {
      var exists = window.BOOKS.some(function (b) { return b.id === cat.id; });
      if (exists) return;
      window.BOOKS.push({
        id: cat.id,
        title: cat.title,
        cover: cat.cover,
        deco: cat.deco,
        major: '河北省对口升学 · 医学类 · 医学综合习题集（理论）',
        editors: '《医学综合习题集（理论）》编写组',
        publisher: '医学综合习题集',
        chapters: cat.chapters
      });
    });
  }
})();
