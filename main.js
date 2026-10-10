'use strict';

/*
 * EpXsC Syntax —— 为「述无空语构造记号」（EpXsC）代码块注册 Prism 语法。
 *
 * 分工：插件把代码切成 token（<span class="token keyword">…</span>），
 *       配色交给 CSS 片段 EpXsC-Highlight.css。
 *
 * 词表来源：载入时读《述无空语词典》的「动词 / 判断词 / 术式关键词 / 程度限定 / 单位」小节，
 *           词典一改、颜色跟着改；读不到就退回下面的内置词表（两者取并集，内置的不会被顶掉）。
 */

const { Plugin, TFile } = require('obsidian');

const LANG_KEYS = ['EpXsC', 'epxsc', 'EPXSC'];
const CODE_SELECTOR = 'code[class*="language-EpXsC" i]';
const DICT_PATH = '世界设定集/地域文化图鉴/语言/述无空语/述无空语词典.md';

const FALLBACK = {
  /* 词典读不到时的兜底；in / om 这类词性易漏，一并钉死 */
  keyword: ['keal', 'keol', 'tam', 'dum', 'nisi', 'quan', 'vero', 'es', 'exo', 'lic', 'luss', 'solum', 'hauri', 're', 'ren', 'rea', 'in', 'de', 'pro', 'om', 'post', 'nec'],
  degree: ['max', 'min', 'valde', 'magis', 'minus', 'parum', 'paulum', 'nimis'],
  predicate: ['plur', 'navis', 'apolus', 'expual', 'aepaus', 'movis', 'venis', 'retase'],
  unit: ['MUW', 'EUW', 'MU', 'miteas', 'kigrama', 'm', 's', 'kg']
};

/* 词典小节 → 词类 */
const SECTIONS = {
  keyword: ['介词', '助动词', '判断词', '时间限定', '数量与范围限定', '指称限定', '顺序限定', '代词（人称）', '疑问词', '连接词与从句标记', '术式关键词'],
  degree: ['程度限定'],
  predicate: ['动词'],
  unit: ['单位']
};

const ELEMENTS = ['Ert', 'Aqu', 'Flm', 'Wnd', 'Nut', 'Elc', 'Lum', 'Duk', 'Sar', 'Qen'];
const AXES = ['vis', 'diu', 'celer', 'latus', 'altus', 'acutus', 'densus', 'gravis', 'levis'];

/* 类型名（元素码另算，见 ELEMENTS）：域类型登记表，新类型加在这里 */
const TYPES = ['METOS', 'locus'];

function escapeWord(w) {
  return w.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&');
}

/* 词表一律大小写不敏感：术式里 Plur / plur 混用，元素码除外 */
function wordPattern(words) {
  const sorted = words.slice().sort(function (a, b) { return b.length - a.length; });
  return new RegExp('\\b(?:' + sorted.map(escapeWord).join('|') + ')\\b', 'i');
}

/* 按标题切分 markdown，取每个小节表格第一列的词 */
function splitSections(text) {
  const map = {};
  let current = null;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = /^#{1,6}\s*(.+?)\s*$/.exec(line);
    if (h) {
      current = h[1];
      if (!map[current]) map[current] = [];
      continue;
    }
    if (!current) continue;
    const m = /^\|\s*([A-Za-z][A-Za-z0-9_-]{0,30})\s*\|/.exec(line);
    if (m) map[current].push(m[1]);
  }
  return map;
}

function wordsFrom(map, names, fallback) {
  const out = [];
  for (let i = 0; i < names.length; i++) {
    const list = map[names[i]] || [];
    for (let j = 0; j < list.length; j++) out.push(list[j]);
  }
  for (let k = 0; k < fallback.length; k++) out.push(fallback[k]);
  return Array.from(new Set(out));
}

function makeGrammar(lists) {
  return {
    comment: /\/\*[\s\S]*?\*\//,
    annotation: /^[ \t]*\.[A-Za-z_][\w-]*(?:[ \t]+[^\n]*)?$/m,
    pretium: /\bpretium\b/i,
    /* 秩区间：1..3、..10、2..（要求至少一边有数字，且后面不再跟点，避免吃掉省略号 ...） */
    rankRange: /(?:\d+\.\.\d*|\d*\.\.\d+)(?!\.)/,
    number: /\b\d+(?:\.\d+)?\b/,
    unit: wordPattern(lists.unit),
    element: new RegExp('\\b(?:' + ELEMENTS.join('|') + ')\\b'),
    type: new RegExp('\\b(?:' + TYPES.join('|') + ')\\b'),
    /* 参数表里的类型位：紧跟在 ( 或 , 之后、后面是冒号的词（单个小写字母按变量名处理）。
       用 Prism 的 lookbehind 写法，避免原生 (?<=) 在旧 iOS Safari 上解析即报错。 */
    typeParam: {
      pattern: /([(,]\s*)(?![a-z]\s*:)[A-Za-z_][A-Za-z0-9_]*(?=\s*:(?!:))/,
      lookbehind: true,
      alias: 'type'
    },
    axis: wordPattern(AXES),
    degree: wordPattern(lists.degree),
    keyword: wordPattern(lists.keyword),
    /* 术式名：大写开头且后面紧跟 ( { [ ，或下划线复合名（Gramakipo_Aepaus） */
    declaration: /\b(?:[A-Z][A-Za-z0-9_]*(?=\s*[({\[])|[A-Z][A-Za-z0-9]*_[A-Za-z0-9_]+)/,
    predicate: wordPattern(lists.predicate),
    function: /\b[a-z][A-Za-z0-9_]*(?=\s*\()/,
    pointer: /\*&|&|@/,
    operator: /(?:\+=|-=|\*=|\/=|<=|>=|==|!=|\.{2,3})|\+|-|\*|\/|=|<|>|\^|~|\?|!/,
    /* 括号分三类：() 分组 · [] 方括号（列表 / 下标 / 秩）· {} 花括号（语块）；其余标点归 punctuation */
    paren: /[()]/,
    bracket: /[\[\]]/,
    brace: /[{}]/,
    punctuation: /[;:,]/
  };
}

const BASE_LISTS = {
  keyword: FALLBACK.keyword.slice(),
  degree: FALLBACK.degree.slice(),
  predicate: FALLBACK.predicate.slice(),
  unit: FALLBACK.unit.slice()
};

class EpXsCSyntaxPlugin extends Plugin {
  onload() {
    const self = this;
    this.grammar = makeGrammar(BASE_LISTS);
    this.install();
    this.register(function () {
      const Prism = window.Prism;
      if (!Prism || !Prism.languages) return;
      for (let i = 0; i < LANG_KEYS.length; i++) delete Prism.languages[LANG_KEYS[i]];
    });
    this.registerMarkdownPostProcessor(function (el) { self.highlightIn(el); });
    this.registerEvent(this.app.vault.on('modify', function (file) {
      if (file && file.path === DICT_PATH) self.refresh();
    }));
    this.app.workspace.onLayoutReady(function () { self.refresh(); });
  }

  install() {
    const Prism = window.Prism;
    if (!Prism || !Prism.languages) return false;
    for (let i = 0; i < LANG_KEYS.length; i++) Prism.languages[LANG_KEYS[i]] = this.grammar;
    return true;
  }

  /* 读词典 → 重建词表 → 重新上色 */
  async refresh() {
    let lists = BASE_LISTS;
    try {
      const file = this.app.vault.getAbstractFileByPath(DICT_PATH);
      if (file instanceof TFile) {
        const text = await this.app.vault.cachedRead(file);
        const map = splitSections(text);
        lists = {
          keyword: wordsFrom(map, SECTIONS.keyword, FALLBACK.keyword),
          degree: wordsFrom(map, SECTIONS.degree, FALLBACK.degree),
          predicate: wordsFrom(map, SECTIONS.predicate, FALLBACK.predicate),
          unit: wordsFrom(map, SECTIONS.unit, FALLBACK.unit)
        };
      }
    } catch (err) {
      console.warn('[EpXsC Syntax] 词典读取失败，沿用内置词表：', err);
    }
    this.grammar = makeGrammar(lists);
    this.install();
    this.rehighlight();
  }

  rehighlight() {
    this.highlightIn(document);
  }

  highlightIn(root) {
    if (!root || !root.querySelectorAll) return;
    const nodes = root.querySelectorAll(CODE_SELECTOR);
    for (let i = 0; i < nodes.length; i++) this.highlightOne(nodes[i]);
  }

  highlightOne(code) {
    const Prism = window.Prism;
    if (!Prism) return;
    try {
      const text = code.textContent || '';
      const found = /language-(\w+)/.exec(code.className || '');
      const lang = found ? found[1] : 'EpXsC';
      const grammar = Prism.languages[lang] || Prism.languages.EpXsC;
      if (!grammar) return;
      code.innerHTML = markBracketDepth(Prism.highlight(text, grammar, lang));
    } catch (err) {
      console.warn('[EpXsC Syntax]', err);
    }
  }
}

/* 逐层给括号打上 epx-d1 / d2 / d3（三层一循环，再深轮回第一层）。
   Prism 是逐位置的词法分析，数不了层数，所以在这一步扫一遍它产出的 HTML。 */
function markBracketDepth(html) {
  let depth = 0;
  return html.replace(/<span class="token ([a-z]+)">([\[\](){}])<\/span>/g, function (all, cls, ch) {
    if (cls !== 'bracket' && cls !== 'paren' && cls !== 'brace') return all;
    const isOpen = ch === '[' || ch === '(' || ch === '{';
    if (isOpen) depth += 1;
    else if (depth > 0) depth -= 1;
    const level = isOpen ? depth : depth + 1;
    return '<span class="token ' + cls + ' epx-d' + (((level - 1) % 3) + 1) + '">' + ch + '</span>';
  });
}

module.exports = EpXsCSyntaxPlugin;
