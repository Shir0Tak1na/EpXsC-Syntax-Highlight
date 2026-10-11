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

const { Plugin, TFile, Notice, MarkdownView, Modal } = require('obsidian');

const LANG_KEYS = ['EpXsC', 'epxsc', 'EPXSC'];
const CODE_SELECTOR = 'code[class*="language-EpXsC" i]';
const DICT_PATH = '世界设定集/地域文化图鉴/语言/述无空语/述无空语词典.md';
/* 秩的构成表：悬停秩区间时显示（维度模型 · 九个秩与维度的对应） */
const RANK_PATH = '世界设定集/设定概念集合/维度/维度模型.md';
/* 术式语法文档：读「筛选键」表，给 genus / intervall / ordin … 挂释义 */
const SYNTAX_PATH = '世界设定集/地域文化图鉴/语言/述无空语/述无空语术式语法.md';
/* 词根表分册目录：整目录都在读，新增分册会自动纳入 */
const ROOTS_DIR = '世界设定集/地域文化图鉴/语言/述无空语/词库/词根表/';

const FALLBACK = {
  /* 词典读不到时的兜底；in / om 这类词性易漏，一并钉死 */
  keyword: ['in', 'de', 'pro', 'om', 'post', 'nec'],
  judge: ['keal', 'keol', 'tam', 'dum', 'nisi', 'quan', 'vero', 'es', 'exo', 'lic', 're', 'ren', 'rea', 'kon', 'aut', 'dis', 'ergo', 'kaus', 'ske', 'aude', 'rase', 'fas', 'nefas'],
  clause: ['pretium', 'limit', 'luss', 'solum', 'hauri', 'vita', 'memoria', 'sensus', 'voluntas', 'anima', 'vis', 'diu', 'celer', 'metos'],
  degree: ['max', 'min', 'valde', 'magis', 'minus', 'parum', 'paulum', 'nimis'],
  predicate: ['plur', 'navis', 'apolus', 'expual', 'aepaus', 'movis', 'venis', 'retase'],
  unit: ['MUW', 'EUW', 'MU', 'miteas', 'kigrama', 'm', 's', 'kg']
};

/* 词典小节 → 词类 */
const SECTIONS = {
  /* 功能词（介词·助动词·限定词·代词·疑问词·连接词）：紫 */
  keyword: ['介词', '助动词', '限定词', '时间限定', '数量与范围限定', '指称限定', '顺序限定', '代词（人称）', '疑问词', '连接词与从句标记'],
  /* 判断词（if／elif／else 一族）：单独一色 */
  judge: ['判断词'],
  /* 术式关键词（块内条款与术式专用词）：单独一色 */
  clause: ['术式关键词'],
  degree: ['程度限定'],
  predicate: ['动词'],
  unit: ['单位']
};

const ELEMENTS = ['Ert', 'Aqu', 'Flm', 'Wnd', 'Nut', 'Elc', 'Lum', 'Duk', 'Sar', 'Qen'];
const AXES = ['vis', 'diu', 'celer', 'latus', 'altus', 'acutus', 'densus', 'gravis', 'levis'];

/* 类型名（元素码另算，见 ELEMENTS）：域类型登记表，新类型加在这里 */
const TYPES = ['METOS', 'locus', 'siro'];
/* 作用域／可见性限定词：写在变量名前，解析赋值时要跳过它们 */
const MODIFIERS = ['priv', 'tut', 'publ', 'consta', 'om', 'tot'];

/* 代码版本：诊断报告里会写出来，用来分辨「文件换了但插件没重载」 */
const BUILD = '1.13.1';

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
    if (m && !/^(word|key|root)$/i.test(m[1])) map[current].push(m[1]);
  }
  return map;
}

/* 词典表格 → 词条表：词性取所在小节，释义取第二列，缩写取第三列 */
function parseEntries(text) {
  const out = new Map();
  let section = '';
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const h = /^#{1,6}\s*(.+?)\s*$/.exec(lines[i]);
    if (h) { section = h[1]; continue; }
    const m = /^\|\s*([A-Za-z][A-Za-z0-9_-]{0,30})\s*\|(.*)$/.exec(lines[i]);
    if (!m) continue;
    const cells = m[2].split('|');
    const meaning = (cells[0] || '').trim();
    if (!meaning || meaning === 'meaning' || meaning === '义' || meaning === '释义') continue;
    const key = m[1].toLowerCase();
    if (!out.has(key)) out.set(key, { word: m[1], pos: section, meaning: meaning, abbr: (cells[1] || '').trim() });
  }
  return out;
}

/* 秩表里的分量列带 LaTeX，洗成人能读的样子 */
const GREEK = { theta: 'θ', lambda: 'λ', sigma: 'σ', Delta: 'Δ', varphi: 'φ', eta: 'η', omega: 'ω', mu: 'μ', pi: 'π', alpha: 'α', beta: 'β', gamma: 'γ', tau: 'τ', rho: 'ρ' };

function cleanMath(s) {
  let t = String(s);
  t = t.replace(/\$([^$]*)\$/g, '$1');
  t = t.replace(/\\mathrm\{([^}]*)\}/g, '$1');
  t = t.replace(/\\text\{([^}]*)\}/g, '$1');
  t = t.replace(/\\([a-zA-Z]+)/g, function (all, name) { return GREEK[name] || name; });
  t = t.replace(/\\[,;!]/g, ' ');
  t = t.replace(/[{}]/g, '');
  t = t.replace(/\\/g, '');
  return t.replace(/\s+/g, ' ').trim();
}

/* 维度模型「九个秩与维度的对应」表 → 秩区间提示 */
function parseRanks(text) {
  const out = new Map();
  const lines = text.split(/\r?\n/);
  let started = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!started) {
      if (/九个秩与维度的对应/.test(line)) started = true;
      continue;
    }
    if (!/^\s*\|/.test(line)) { if (out.size) break; else continue; }
    const m = /^\s*\|\s*(\d{1,2}(?:[–-]\d{1,2})?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|/.exec(line);
    if (!m) continue;
    const rank = m[1].replace('-', '–');
    const parts = [];
    const comp = cleanMath(m[2]);
    if (comp) parts.push(comp);
    if (m[3].trim()) parts.push(m[3].trim());
    if (parts.length) out.set(rank, parts.join(' · '));
  }
  return out;
}
/* 术式语法「筛选键」表 → 悬停释义 */
function parseFilterKeys(text) {
  const out = new Map();
  const lines = text.split(/\r?\n/);
  let started = false;
  let rows = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!started) { if (/^#{2,6}\s*筛选键\s*$/.test(line)) started = true; continue; }
    if (!/^\s*\|/.test(line)) { if (rows) break; else continue; }
    const m = /^\s*\|\s*\x60?\s*([A-Za-z][A-Za-z0-9_-]{0,30})\s*\x60?\s*\|\s*([^|]*?)\s*\|/.exec(line);
    if (!m) continue;
    rows += 1;
    out.set(m[1].toLowerCase(), { word: m[1], pos: '筛选键', meaning: m[2].replace(/\x60/g, '').trim(), abbr: '' });
  }
  return out;
}

function cleanCell(s) {
  return String(s).replace(/\*\*/g, '').replace(/\x60/g, '').trim();
}

/* 术式语法「六、单位」两张表 → MU / EU / MUW / EUW 与 passus · sands 等 */
function parseUnits(text) {
  const out = new Map();
  const lines = text.split(/\r?\n/);
  let started = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!started) { if (/^#{2,6}\s*六、单位/.test(line)) started = true; continue; }
    if (/^#{2,6}\s/.test(line) && !/其他单位/.test(line)) break;
    if (!/^\s*\|/.test(line)) continue;
    const cells = line.split('|').map(cleanCell);
    if (cells.length < 5) continue;
    const energy = /^[?？]?\s*([A-Z]{2,4})$/.exec(cells[1]);
    if (energy) {
      const luss = cells[4] || '';
      const note = /锁存/.test(luss) ? '写它即为锁存（触发式术式）' : (/不得/.test(luss) ? '功率口径，不得配 luss（持续发动）' : '');
      const ekey = energy[1].toLowerCase();
      if (!out.has(ekey)) out.set(ekey, { word: energy[1], pos: '能量单位', meaning: cells[2] + (note ? '；' + note : ''), abbr: '' });
      continue;
    }
    const amount = cells[1];
    const names = (cells[3] || '').match(/[A-Za-z][A-Za-z0-9]*/g) || [];
    const labels = (cells[2] || '').split('·').map(function (s) { return s.trim(); });
    for (let j = 0; j < names.length; j++) {
      const key = names[j].toLowerCase();
      if (out.has(key)) continue;
      const label = labels.length === names.length ? labels[j] : (names.length === 1 ? labels[0] : '');
      out.set(key, { word: names[j], pos: amount, meaning: label || cells[2], abbr: '' });
    }
  }
  return out;
}

/* 词根表分册 → 词根释义（根类：动／物／性／数） */
function parseRoots(text) {
  const out = new Map();
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^\|\s*([A-Za-z][A-Za-z0-9-]{0,20})\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|/.exec(lines[i]);
    if (!m || /^(根|word|词根)$/.test(m[1])) continue;
    const key = m[1].toLowerCase();
    if (!out.has(key)) out.set(key, { word: m[1], pos: '词根·' + m[5].trim(), meaning: m[2].trim(), kind: m[5].trim() });
  }
  return out;
}

/* ---------- 内置快照（别人下载后库里没有那几份文件时的兜底） ---------- */

function builtinMap(part) {
  const out = new Map();
  const source = (BUILTIN_LEXICON[part] || {});
  for (const key in source) {
    const v = source[key];
    out.set(key, { word: v[0], pos: v[1], meaning: v[2], abbr: v[3] || '' });
  }
  return out;
}

function builtinRanks() {
  const out = new Map();
  const source = (BUILTIN_LEXICON.ranks || {});
  for (const key in source) out.set(key, source[key]);
  return out;
}

function builtinRoots() {
  const out = new Map();
  const source = (BUILTIN_LEXICON.roots || {});
  for (const key in source) out.set(key, { word: source[key][2] || key, pos: '词根·' + source[key][1], meaning: source[key][0], kind: source[key][1] });
  return out;
}

function builtinLists(verbRoots) {
  const bySection = {};
  const e = (BUILTIN_LEXICON.entries || {});
  for (const key in e) {
    const pos = e[key][1];
    (bySection[pos] = bySection[pos] || []).push(e[key][0]);
  }
  const units = Object.keys(BUILTIN_LEXICON.units || {});
  return {
    keyword: wordsFrom(bySection, SECTIONS.keyword, FALLBACK.keyword),
    judge: wordsFrom(bySection, SECTIONS.judge, FALLBACK.judge),
    clause: wordsFrom(bySection, SECTIONS.clause, FALLBACK.clause),
    degree: wordsFrom(bySection, SECTIONS.degree, FALLBACK.degree),
    predicate: wordsFrom(bySection, SECTIONS.predicate, FALLBACK.predicate).concat(verbRoots || []),
    unit: wordsFrom(bySection, SECTIONS.unit, FALLBACK.unit).concat(units)
  };
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
    /* 变量名：紧跟「类型:」的那个词（含 [2:变量] 这类位数写法）。
       必须排在 type / number 之前——否则冒号左边先被它们吃掉，右边这个词就轮不到这里了。 */
    variable: {
      pattern: /([([,][ \t]*[A-Za-z0-9_]+:[ \t]*)([A-Za-z_][A-Za-z0-9_]*)/,
      lookbehind: true
    },
    /* 位数声明组：[2:名] —— 冒号前是位数、冒号后是变量名（列表容器的声明） */
    indexDecl: {
      pattern: /\[[ \t]*\d+[ \t]*:[^\]\n]*\]/,
      inside: {
        variable: /[A-Za-z_][A-Za-z0-9_]*/,
        number: /\d+/,
        punctuation: /:/,
        bracket: /[\[\]]/
      }
    },
    /* 下标组：[1] / [1..3] —— 里面的数字按「第 n 位／第 n 秩」解释 */
    indexGroup: {
      pattern: /\[[ \t]*\d+[ \t]*(?:\.\.[ \t]*\d*)?[ \t]*\]/,
      inside: {
        rankRange: /(?:\d+\.\.\d*|\d*\.\.\d+)(?!\.)/,
        number: /\d+/,
        operator: /\.\./,
        bracket: /[\[\]]/
      }
    },
    pretium: /\bpretium\b/i,
    /* 秩区间：1..3、..10、2..（要求至少一边有数字，且后面不再跟点，避免吃掉省略号 ...） */
    rankRange: /(?:\d+\.\.\d*|\d*\.\.\d+)(?!\.)/,
    number: /\b\d+(?:\.\d+)?\b/,
    /* 限定词：作用域与可见性（与 C 的 private／protected／public／const 相当）。
       放在 unit／predicate 之前 —— tut 这类词兼作动词，靠「后面跟着一个名字」区分 */
    modifier: /\b(?:priv|tut|publ|consta)\b(?=[ \t]+[A-Za-z_])/,
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
    /* 前置否定：ne 紧跟一个词时，等同 !（逻辑非），否定后面那个成分 */
    negPrefix: /\bne(?=[ \t]+[A-Za-z_&*@?(\[])/i,
    /* 声明目标：赋值语句左边的那个名字（前面可带限定词） */
    declTarget: {
      pattern: /((?:^|[;\n])[ \t]*(?:(?:priv|tut|publ|consta|om|tot)[ \t]+)?)([A-Za-z_][A-Za-z0-9_]*)(?=[ \t]*=(?!=))/,
      lookbehind: true
    },
    /* 判断词（if／elif／else 一族）与术式关键词（块内条款）各自一色 */
    judge: wordPattern(lists.judge),
    clause: wordPattern(lists.clause),
    keyword: wordPattern(lists.keyword),
    /* 术式名：大写开头且后面紧跟 ( { [ ，或下划线复合名（Gramakipo_Aepaus） */
    declaration: /\b(?:[A-Z][A-Za-z0-9_]*(?=\s*[({\[])|[A-Z][A-Za-z0-9]*_[A-Za-z0-9_]+)/,
    predicate: wordPattern(lists.predicate),
    function: /\b[a-z][A-Za-z0-9_]*(?=\s*\()/,
    pointer: /\*&|&|@/,
    /* 坐标串：同一符号连写两个以上才算坐标（~ 世界轴 / ^ 朝向前三轴） */
    coordRun: {
      pattern: /(?:~(?:[ \t]*[-+]?\d+(?:\.\d+)?)?)(?:[ \t]+~(?:[ \t]*[-+]?\d+(?:\.\d+)?)?)+|(?:\^(?:[ \t]*[-+]?\d+(?:\.\d+)?)?)(?:[ \t]+\^(?:[ \t]*[-+]?\d+(?:\.\d+)?)?)+/,
      greedy: true
    },
    operator: /(?:\+=|-=|\*=|\/=|<=|>=|==|!=|\.{2,3})|\+|-|\*|\/|=|<|>|\^|~|\?|!/,
    /* 括号分三类：() 分组 · [] 方括号（列表 / 下标 / 秩）· {} 花括号（语块）；其余标点归 punctuation */
    paren: /[()]/,
    bracket: /[\[\]]/,
    brace: /[{}]/,
    punctuation: /[;:,]/,
    /* 兜底：其余标识符也切成 token，只为挂悬停释义；CSS 不给它上色 */
    word: /\b[A-Za-z_][A-Za-z0-9_]*\b/
  };
}

const BASE_LISTS = {
  keyword: FALLBACK.keyword.slice(),
  degree: FALLBACK.degree.slice(),
  predicate: FALLBACK.predicate.slice(),
  unit: FALLBACK.unit.slice()
};

/* ---------- 语法检查 ---------- */

const BRANCH_WORDS = ['keal', 'keol', 'tam', 'dum', 'nisi', 'quan'];

/* 逐块检查；返回 [{ level, line, message }]。ctx 需要 info / units / keys */
function lintText(text, ctx) {
  const issues = [];
  const lines = text.split('\n');
  const push = function (level, line, message) { issues.push({ level: level, line: line, message: message }); };
  const units = (ctx && ctx.units) || new Set();
  const keys = (ctx && ctx.keys) || new Set();

  /* 日常句与术式的分界：句号「.」不参与术式（它是日常句的句号）。
     含句号行的块按日常句对待：只查括号，不套术式的规矩。 */
  let prose = false;
  for (let i = 0; i < lines.length; i++) {
    if (/\.\s*(\/\*.*)?$/.test(lines[i].replace(/[ \t]+$/, ""))) { prose = true; break; }
  }

  /* ① 括号：配对、交叉、闭合（顺带跳过注释） */
  const stack = [];
  const pairOf = { ')': '(', ']': '[', '}': '{' };
  let inComment = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let clean = '';
    for (let c = 0; c < line.length; c++) {
      const ch = line.charAt(c);
      if (inComment) { if (ch === '*' && line.charAt(c + 1) === '/') { inComment = false; c += 1; } continue; }
      if (ch === '/' && line.charAt(c + 1) === '*') { inComment = true; c += 1; continue; }
      clean += ch;
    }
    for (let c = 0; c < clean.length; c++) {
      const ch = clean.charAt(c);
      if (ch === '(' || ch === '[' || ch === '{') stack.push({ ch: ch, line: i + 1 });
      else if (ch === ')' || ch === ']' || ch === '}') {
        const top = stack.pop();
        if (!top) push('error', i + 1, '多出一个「' + ch + '」，前面没有与之对应的「' + pairOf[ch] + '」');
        else if (top.ch !== pairOf[ch]) push('error', i + 1, '括号对不上：这里是「' + ch + '」，但最近未闭合的是「' + top.ch + '」（第 ' + top.line + ' 行）');
      }
    }
    /* ② 块头：行尾是冒号，下一行必须缩进更深（日常句不套这条） */
    if (!prose && /:$/.test(clean.replace(/[ \t]+$/, '')) && clean.trim()) {
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j += 1;
      if (j >= lines.length) push('error', i + 1, '冒号开的块没有块体');
      else {
        const base = (lines[i].match(/^[ \t]*/) || [''])[0].length;
        const next = (lines[j].match(/^[ \t]*/) || [''])[0].length;
        if (next <= base) push('error', j + 1, '块体没有缩进：冒号开的块，这一行要比块头更深');
      }
    }
  }
  for (let i = 0; i < stack.length; i++) push('error', stack[i].line, '「' + stack[i].ch + '」没有闭合');
  if (prose) return issues;

  /* 条款次序：载体制 → 对象 → 限制 → 代价 → 触发 → 效果 → 能量 */
  const lead = function (s) { return (s.match(/^[ \t]*/) || [''])[0].length; };
  const clauseRank = function (line) {
    const t = line.replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (!t || t === '}' || t === '{') return 0;
    if (/\{$/.test(t)) return 1;                                   /* 头行：载体制 ＋ 术式名 ＋ 对象 */
    if (/^limit\s*:/.test(t)) return 2;
    if (/^pretium\s*:/.test(t)) return 3;
    if (/^(keal|keol|tam|dum|nisi|quan)\b/.test(t)) return 4;
    if (/^(luss\b|[?(]|\d)/.test(t) && /\b(MUW|EUW|MU|EU)\b/.test(t)) return 6;
    if (/^(solum|hauri)\b/.test(t)) return 7;
    return 5;                                                      /* 效果 */
  };
  /* 只查「真术式」：首行是头行（… { 或 De …）的块才检查顺序。
     文档里常把一个代码块用来并列对比几种写法，那种片段块没有头行，不查，免得误报。 */
  let firstLine = '';
  for (let k = 0; k < lines.length; k++) { if (lines[k].trim()) { firstLine = lines[k].trim(); break; } }
  const isSpell = /\{$/.test(firstLine) || /^De\b/.test(firstLine);
  let lastRank = 0;
  let lastRankLine = 0;
  let li = 0;
  while (isSpell && li < lines.length) {
    const l = lines[li];
    if (!l.trim()) { li += 1; continue; }
    const r = clauseRank(l);
    if (r === 0) { li += 1; continue; }
    if (r < lastRank) {
      push('warn', li + 1, '条款次序：应为 载体制 → 对象 → 限制 → 代价 → 触发 → 效果 → 能量（第 ' + lastRankLine + ' 行之后再出现更靠前的条款）');
      break;
    }
    lastRank = r;
    lastRankLine = li + 1;
    /* 只有以冒号开块的条款（limit : ／ keal … : ／ pretium :）才跳过它的缩进体；
       头行（… {）不跳 —— 块内的条款正是要检查的对象 */
    const opensBlock = /:[ \t]*$/.test(l.replace(/\/\*[\s\S]*?\*\//g, '').trim());
    const indent = lead(l);
    li += 1;
    while (opensBlock && li < lines.length) {
      const l2 = lines[li];
      if (!l2.trim()) { li += 1; continue; }
      if (lead(l2) > indent) { li += 1; continue; }
      if (/^[ \t]*[{}][ \t]*$/.test(l2)) { li += 1; continue; }
      break;
    }
  }

  /* 限制条款（limit）：写在块首的准入条件，每条都应当是比较式 */
  for (let i = 0; i < lines.length; i++) {
    const lm = /^([ \t]*)limit[ \t]*:(.*)$/.exec(lines[i]);
    if (!lm) continue;
    const base = lm[1].length;
    const items = [{ text: lm[2], line: i + 1 }];
    let j = i + 1;
    while (j < lines.length) {
      const l = lines[j];
      if (!l.trim()) { j += 1; continue; }
      const ind = (l.match(/^[ \t]*/) || [''])[0].length;
      if (ind <= base) break;
      items.push({ text: l, line: j + 1 });
      j += 1;
    }
    for (let k = 0; k < items.length; k++) {
      const body = items[k].text.replace(/\/\*[\s\S]*?\*\//g, '').trim();
      if (!body) continue;
      if (!/(<=|>=|==|!=|<|>)/.test(body)) {
        push('warn', items[k].line, '限制条款（limit）里的每一条都应当是比较式 —— 它是准入条件，不成立就不发动');
      }
    }
  }

  /* 常数：写入后不可再赋值 */
  const constDecl = /(^|[;\n])[ \t]*(?:(?:priv|tut|publ)[ \t]+)?consta[ \t]+([A-Za-z_][A-Za-z0-9_]*)[ \t]*=(?!=)/g;
  const consts = [];
  let cdecl;
  while ((cdecl = constDecl.exec(text))) consts.push({ name: cdecl[2], line: text.slice(0, cdecl.index + (cdecl[1] || '').length).split('\n').length });
  for (let i = 0; i < consts.length; i++) {
    const again = new RegExp('(^|[;\\n])[ \\t]*(?:(?:priv|tut|publ|consta|om|tot)[ \\t]+)?' + consts[i].name + '[ \\t]*=(?!=)', 'g');
    let m2;
    while ((m2 = again.exec(text))) {
      const line = text.slice(0, m2.index + (m2[1] || '').length).split('\n').length;
      if (line > consts[i].line) {
        push('error', line, '常量「' + consts[i].name + '」在第 ' + consts[i].line + ' 行以 consta 声明，写入后不可再赋值');
        break;
      }
    }
  }

  /* 坐标串：~ 至少两轴（X、Z），^ 必须三轴 */
  const coordRe = /(?:~(?:[ \t]*[-+]?\d+(?:\.\d+)?)?)(?:[ \t]+~(?:[ \t]*[-+]?\d+(?:\.\d+)?)?)+|(?:\^(?:[ \t]*[-+]?\d+(?:\.\d+)?)?)(?:[ \t]+\^(?:[ \t]*[-+]?\d+(?:\.\d+)?)?)+/g;
  let cd;
  while ((cd = coordRe.exec(text))) {
    const line = text.slice(0, cd.index).split('\n').length;
    const c = parseCoord(cd[0]);
    if (c.values.length > 3) push('warn', line, '坐标最多三轴，这里写了 ' + c.values.length + ' 个');
    else if (c.sign === '^' && c.values.length !== 3) push('error', line, '局部坐标必须写全三轴（左／上／前），这里只有 ' + c.values.length + ' 个');
  }

  /* ③ 判断词要带块 */
  for (let i = 0; i < lines.length; i++) {
    const m = /^[ \t]*([A-Za-z_][A-Za-z0-9_]*)/.exec(lines[i]);
    if (!m || BRANCH_WORDS.indexOf(m[1].toLowerCase()) < 0) continue;
    if (lines[i].indexOf(':') < 0 && lines[i].indexOf('{') < 0) {
      push('warn', i + 1, '判断词「' + m[1] + '」要带块：行尾写冒号加缩进，或用花括号');
    }
  }

  /* ④ 数字后面跟的必须是登记过的单位 */
  for (let i = 0; i < lines.length; i++) {
    const re = /(\d)[ \t]*([A-Za-z_][A-Za-z0-9_]*)/g;
    let m;
    while ((m = re.exec(lines[i]))) {
      if (units.has(m[2].toLowerCase())) continue;
      push('warn', i + 1, '「' + m[1] + ' ' + m[2] + '」——' + m[2] + ' 不是登记过的单位');
    }
  }

  /* ⑤ 功率口径不得写锁存 */
  for (let i = 0; i < lines.length; i++) {
    if (/\bluss\b/i.test(lines[i]) && /\b(MUW|EUW)\b/.test(lines[i])) {
      push('error', i + 1, '写 MUW／EUW 即持续发动（功率口径），不得再写 luss（锁存）');
    }
  }

  /* ⑥ 量约束说说明的是「?」声明的量 */
  for (let i = 0; i < lines.length; i++) {
    if (/\blic\s+(magis|minus)\b/i.test(lines[i]) && lines[i].indexOf('?') < 0) {
      push('warn', i + 1, '「lic magis／lic minus」用来说明由「?」声明的量可增／可减，这一行没有「?」');
    }
  }

  /* ⑦ 筛选键要登记；下标（秩）要在 1–9；筛选值不按秩解释 */
  const sq = /\[([^\]\n]*)\]/g;
  let b;
  while ((b = sq.exec(text))) {
    const before = text.slice(0, b.index);
    const line = before.split('\n').length;
    const inner = b[1];
    let back = b.index - 1;
    while (back >= 0 && /[ \t]/.test(text.charAt(back))) back -= 1;
    if (text.charAt(back) === '=') continue;
    const kind = classifySquare(inner);
    if (kind === '筛选键表') {
      const kr = /([A-Za-z_][A-Za-z0-9_]*)\s*=/g;
      let k;
      while ((k = kr.exec(inner))) {
        if (!keys.has(k[1].toLowerCase())) push('warn', line, '筛选键「' + k[1] + '」不在登记表里');
      }
    } else if (kind === '下标 · 秩') {
      const nums = inner.match(/\d+/g) || [];
      for (let n = 0; n < nums.length; n++) {
        const v = parseInt(nums[n], 10);
        if (v < 1 || v > 9) push('warn', line, '秩只有 1–9，这里的「' + nums[n] + '」超出范围');
      }
    }
  }
  return issues;
}

/* ---------- 悬停提示 ---------- */

/* 一个 token 可能带多个类（如 typeParam + type），按语义优先级取第一个 */
const CLASS_ORDER = ['rankRange', 'bracket', 'paren', 'brace', 'pointer', 'coordRun', 'negPrefix', 'modifier', 'declTarget', 'varUse', 'judge', 'clause', 'declaration', 'variable', 'type', 'element', 'unit', 'predicate', 'function', 'keyword', 'pretium', 'degree', 'axis', 'number', 'comment', 'annotation', 'operator', 'punctuation', 'word'];

const CLASS_LABEL = {
  judge: '判断词',
  clause: '条款',
  modifier: '限定词',
  declTarget: '声明目标',
  negPrefix: '前置否定',
  declaration: '术式名',
  predicate: '谓词',
  function: '谓词调用',
  keyword: '',
  type: '类型名',
  element: '元素码',
  unit: '单位',
  number: '数值',
  degree: '程度词',
  axis: '缩放轴',
  pretium: '代价'
};

/* 词典暂未收、但术式里在用的词（补一条即可） */
const EXTRA_WORDS = {
  in: { word: 'in', pos: '介词', meaning: '在……里（词典暂未收录，按术式用法补）', abbr: '' }
};

/* 个别类型词要补一句（词典释义只说词义，说不清它在类型里的职务） */
const TYPE_NOTES = {
  siro: '类型即 void（空缺）：可以用于声明变量，也可以直接占位 —— 作目标即无目标，作载体即无载体'
};

/* 词典小节 → 真正的词性／类别；没有对应项时原样用小节名 */
const SECTION_POS = {
  '名词': '名词', '动词': '动词', '数词': '数词', '形容词': '形容词', '副词': '副词',
  '介词': '介词', '助动词': '助动词', '判断词': '判断词', '限定词': '限定词',
  '时间限定': '限定词', '数量与范围限定': '限定词', '指称限定': '限定词',
  '顺序限定': '限定词', '程度限定': '副词',
  '代词（人称）': '代词', '疑问词': '疑问词', '量词': '量词', '连接词与从句标记': '连接词',
  '族名': '名词', '动物名': '名词', '族、血统与分类': '名词',
  '地名与势力名': '专名', '地理 · 神宫 · 货币专名': '专名',
  '根词': '词根', '后缀': '后缀', '复合词': '复合词', '高频补充词': '补充词',
  '元素固定缩写': '元素', '术式关键词': '术式关键词', '单位': '单位'
};

function pickClass(classList) {
  for (let i = 0; i < CLASS_ORDER.length; i++) {
    if (classList.contains(CLASS_ORDER[i])) return CLASS_ORDER[i];
  }
  return null;
}

/* 已声明的变量，用在哪儿都按变量着色（C 风格：同名同色） */
function markVarUse(html, vars) {
  if (!vars || !vars.size) return html;
  vars.forEach(function (binding, name) {
    if (!name) return;
    const safe = name.replace(/[^A-Za-z0-9_]/g, '\\/* 每对括号分别是什么：元组 / 列表 / 秩 / 位数 / 字典（语块）/ 参数表 … */');
    html = html.replace(new RegExp('<span class="token word( [^"]*)?">' + safe + '</span>', 'g'), '<span class="token varUse$1">' + name + '</span>');
  });
  return html;
}

/* 每对括号分别是什么：元组 / 列表 / 秩 / 位数 / 字典（语块）/ 参数表 … */
function bracketKinds(text) {
  const src = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\.[^\n]*$/gm, '');
  const out = [];
  for (let i = 0; i < src.length; i++) {
    const ch = src.charAt(i);
    if (ch === '(' || ch === '[' || ch === '{') {
      let kind = '';
      if (ch === '(') {
        const before = src.slice(Math.max(0, i - 60), i);
        const head = /(^|[;{}\n])\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(before);
        const prev = src.charAt(i - 1);
        if (head && /^[A-Z]/.test(head[2]) && prev !== ' ') kind = '参数表';
        else if (/[A-Za-z0-9_]/.test(prev)) kind = '实参表';
        else kind = '分组';
      } else if (ch === '[') {
        const close = src.indexOf(']', i);
        const inner = close > 0 ? src.slice(i + 1, close) : '';
        let back = i - 1;
        while (back >= 0 && /[ \t]/.test(src.charAt(back))) back -= 1;
        kind = src.charAt(back) === '=' ? '筛选值' : classifySquare(inner);
      } else {
        kind = '语块';
      }
      out.push(kind);
    } else if (ch === ')' || ch === ']' || ch === '}') {
      out.push('');
    }
  }
  return out;
}

/* 符号释义（取自术式语法 三、逻辑与运算 / 四、指针与寻址） */
const SYMBOL_INFO = {
  '!': { label: '运算符 !', body: '逻辑非，同 C；也可用助动词 ne。' },
  '&&': { label: '运算符 &&', body: '逻辑与（合取）；术式里通常写作 kon。' },
  '||': { label: '运算符 ||', body: '包含或；术式里通常写作 aut。' },
  '^': { label: '运算符 ^', body: '局部坐标：沿受术者朝向的左／上／前三轴偏移，三轴必须写全。此符号在 C 中是位异或，由术式征用。' },
  '~': { label: '运算符 ~', body: '相对坐标：沿世界轴的偏移，至少给 X 与 Z 两轴。此符号在 C 中是位非，由术式征用。' },
  '==': { label: '运算符 ==', body: '相等（前后同一则同一）；亦有对应判断词 aude。' },
  '!=': { label: '运算符 !=', body: '不等（比较）。' },
  '<=': { label: '运算符 <=', body: '不超过（比较）。' },
  '>=': { label: '运算符 >=', body: '不少于（比较）。' },
  '<': { label: '运算符 <', body: '小于（比较）。' },
  '>': { label: '运算符 >', body: '大于（比较）。' },
  '=': { label: '赋值 =', body: '写入变量：块内绑定的变量作用域到块末。与系词 es（是／存在）分工不同。' },
  '+=': { label: '复合算子 +=', body: '对术式自身的数值参数递增。' },
  '-=': { label: '复合算子 -=', body: '对术式自身的数值参数递减；程度量也可用。' },
  '*=': { label: '复合算子 *=', body: '对术式自身的数值参数按倍率缩放。' },
  '/=': { label: '复合算子 /=', body: '对术式自身的数值参数按比例缩小。' },
  '+': { label: '运算符 +', body: '加法。有实数的量可以写算式。' },
  '-': { label: '运算符 -', body: '减法。' },
  '*': { label: '运算符 *', body: '解引用：顺着引用取到那物本身；取地址用 &。' },
  '/': { label: '运算符 /', body: '除法；同时是相变记号，所以注释不用双斜线。' },
  '?': { label: '占位符 ?', body: '自适应参数：值在发动时绑定——或由施术者当场指定，或由术式依情境自行适配。作类型时表示「空缺（待定）」。' },
  '..': { label: '区间 ..', body: '两端都写是闭区间；只写上界表示不超过，只写下界表示自该处起；两端都是秩时即秩区间。' },
  '...': { label: '省略 ...', body: '列举未尽。' },
  ';': { label: '分号 ;', body: '子句分隔，与换行等价；只在同一行要分开子句时写。' },
  ',': { label: '逗号 ,', body: '并列：同一子句内的并列项；也用于分隔形参、相接量约束。' },
  ':': { label: '冒号 :', body: '表「下一层开始」，作块头并与缩进配合；声明里则是「类型: 变量名」的分隔。' },
  '&': { label: '取地址 &', body: '取得某物的引用。设定里地址本身就是位置（第 1–3 秩）。' },
  '*&': { label: '取地址后解引用', body: '先取地址再顺着取回该物本身，合起来仍指那物本身。' },
  '@': { label: '目标简写 @', body: '目标对象集的简写形式；全形为 METOS 加方括号。' }
};

/* 方括号里装的是什么（提示与语法检查共用这一套判定） */
function classifySquare(inner) {
  if (/=/.test(inner)) return '筛选键表';
  if (/^\s*:/.test(inner)) return '列表类型';
  if (/^\s*\d+\s*:/.test(inner)) return '位数声明';
  if (/&/.test(inner)) return '点名列表';
  if (/siro|\*/.test(inner)) return '目标集';
  if (/\.\./.test(inner) || /^\s*\d+\s*$/.test(inner)) return '下标 · 秩';
  return '列表';
}

const KIND_INFO = {
  '参数表': { label: '圆括号 · 参数表', body: '术式的形参表。写法为「类型: 变量名」，逗号分隔；类型可省，省了由术式自判。' },
  '实参表': { label: '圆括号 · 实参表', body: '调用谓词时给出的实参。谓词与实参平时靠并置，圆括号只在需要消歧时出现。' },
  '分组': { label: '圆括号 · 分组／元组', body: '括号内以逗号分隔即成元组；也用来显式指定求值顺序。' },
  '筛选值': { label: '方括号 · 筛选值', body: '筛选键的取值：列表或区间，按该键的规则解释。' },
  '筛选键表': { label: '方括号 · 筛选键表', body: '内为「键=值」，按条件筛出对象集；键名与含义见《述无空语术式语法》筛选键一节。' },
  '列表类型': { label: '方括号 · 列表类型', body: '方括号以冒号开头时表示列表容器，冒号后是元素类型。' },
  '位数声明': { label: '方括号 · 位数：变量', body: '括号内的冒号交代「哪一位：叫什么」——冒号前是位数，冒号后是变量名。' },
  '下标 · 秩': { label: '方括号 · 下标（秩）', body: '取该对象的第 n 秩；写成区间时指一段秩。' },
  '点名列表': { label: '方括号 · 点名列表', body: '把已取地址的对象逐个列出，只作用于这些目标。' },
  '目标集': { label: '方括号 · 目标集', body: 'siro 表示无目标（作用于环境），* 表示任意目标。' },
  '列表': { label: '方括号 · 列表', body: '容器类型由括号自己声明：圆括号是元组、方括号是列表、花括号是字典。' },
  '语块': { label: '花括号 · 语块', body: '划范围：触发、效果、能量、代价都写在里面。同一形状也兼作字典／映射。' }
};

function bracketTip(kind) {
  return KIND_INFO[kind] || { label: '括号', body: kind || '' };
}

/* 参数表里的「类型: 变量名」→ 变量 → 类型（两种语序都认） */
/* 从右侧写法推断这个变量是什么 */
function inferKind(expr, known) {
  const e = (expr || '').trim();
  if (!e) return { kind: '未定' };
  if (/^\*&/.test(e)) return { kind: '实体' };
  if (/^&/.test(e)) return { kind: '地址' };
  if (/^@/.test(e) || /^METOS\s*\[/.test(e)) return { kind: '对象集' };
  if (/^\[/.test(e)) return { kind: '列表' };
  if (/^\(/.test(e)) return { kind: '元组' };
  if (/^\{/.test(e)) return { kind: '字典' };
  if (/^\d/.test(e)) return { kind: '数值' };
  const word = /^([A-Za-z_][A-Za-z0-9_]*)\s*([(=]?)/.exec(e);
  if (word) {
    const w = word[1];
    if (ELEMENTS.indexOf(w) >= 0 || TYPES.indexOf(w) >= 0) return { kind: '元素或类型', ref: w };
    if (word[2] === '(') return { kind: '调用' };
    if (known && known.has(w)) return { kind: '同前', ref: w };
  }
  return { kind: '未定' };
}

/* 变量表：① 形参「类型: 变量名」（两种语序都认）；② 赋值 name = 表达式 按右侧推断 */
function parseVarTypes(text, info) {
  const out = new Map();
  const isType = function (w) { return TYPES.indexOf(w) >= 0 || ELEMENTS.indexOf(w) >= 0; };
  const scopes = text.match(/\([^()]*\)/g) || [];
  for (let i = 0; i < scopes.length; i++) {
    const parts = scopes[i].slice(1, -1).split(',');
    for (let j = 0; j < parts.length; j++) {
      const p = parts[j].trim();
      let m = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_]*)$/.exec(p);
      if (m) {
        if (isType(m[1]) && !isType(m[2])) out.set(m[2], { type: m[1] });
        else if (!isType(m[1]) && isType(m[2])) out.set(m[1], { type: m[2] });
        else if (m[1].length === 1) out.set(m[1], { type: m[2] });
        else out.set(m[2], { type: m[1] });
        continue;
      }
      m = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*\[[^\]]*?(\d+)?\s*:?\s*([A-Za-z_][A-Za-z0-9_]*)\s*\]$/.exec(p);
      if (m) { out.set(m[3], { type: m[1], container: '列表', length: m[2] || '' }); continue; }
      m = /^\[[^\]]*?([A-Za-z_][A-Za-z0-9_]*)\s*\]\s*:\s*([A-Za-z_][A-Za-z0-9_]*)$/.exec(p);
      if (m) { out.set(m[2], { type: m[1], container: '列表', length: '' }); continue; }
    }
  }
  const assign = new RegExp('(^|[;\\n])[ \\t]*((?:(?:' + MODIFIERS.join('|') + ')[ \\t]+)?)([A-Za-z_][A-Za-z0-9_]*)[ \\t]*=(?!=)[ \\t]*([^\\n;]*)', 'g');
  let a;
  while ((a = assign.exec(text))) {
    const name = a[3];
    if (out.has(name)) continue;
    const binding = inferKind(a[4], out);
    binding.modifier = (a[2] || '').trim().toLowerCase();
    out.set(name, binding);
  }
  return out;
}

/* 赋值绑定的类别说明（不举例子） */
const BIND_KIND = {
  '地址': '是个地址 —— & 取得的引用；设定里地址本身就是位置（第 1–3 秩）。',
  '实体': '是顺着引用取回的那物本身。',
  '对象集': '是目标对象集。',
  '列表': '是列表容器。',
  '元组': '是元组。',
  '字典': '是字典／映射。',
  '数值': '是数值。',
  '调用': '取的是谓词调用的结果，类别由该谓词决定。',
  '同前': '与右侧那个变量指同一物。',
  '未定': '由 = 绑定，右侧写法未给出可判定的类别。'
};

/* 限定词在提示里的说法（与 C 相当） */
const MOD_INFO = {
  priv: '限定词 priv（私有）：只在当前语块内可见，出块即不可见',
  tut: '限定词 tut（受护）：本语块及其子块可见，外层不可见',
  publ: '限定词 publ（公开）：整个术式内可见，可跨块使用',
  consta: '限定词 consta（常数）：写入后不可再赋值'
};

function variableTip(name, binding, info) {
  if (!binding) return null;
  const mod = (binding.modifier && MOD_INFO[binding.modifier]) ? MOD_INFO[binding.modifier] + '；' : '';
  if (binding.type) {
    const entry = info && info.get(String(binding.type).toLowerCase());
    const detail = entry ? '（' + (entry.pos ? entry.pos + ' ' : '') + entry.meaning + '）' : '';
    const shape = binding.container ? '，' + binding.container + '容器，' + (binding.length ? '长度 ' + binding.length : '长度未定') : '';
    return { label: '变量 ' + name, body: mod + '形参：类型 ' + binding.type + shape + detail + '；作用域到块末。' };
  }
  if (binding.kind === '元素或类型') {
    const entry = info && info.get(String(binding.ref || '').toLowerCase());
    const detail = entry ? '（' + (entry.pos ? entry.pos + ' ' : '') + entry.meaning + '）' : '';
    return { label: '变量 ' + name, body: mod + '取 ' + binding.ref + detail + ' 本身 —— 元素码与类型名既是类型，也是该类型的值；作用域到块末。' };
  }
  return { label: '变量 ' + name, body: mod + (BIND_KIND[binding.kind] || BIND_KIND['未定']) + '作用域到块末。' };
}

/* ne 之后被否定的那段文字：顺着 DOM 兄弟节点走到子句边界 */
function negScopeText(el) {
  let out = '';
  let node = el && el.nextSibling;
  let guard = 0;
  while (node && guard < 40) {
    guard += 1;
    const t = node.textContent || '';
    const cut = /[;,\n]/.exec(t);
    if (cut) { out += t.slice(0, cut.index); break; }
    out += t;
    node = node.nextSibling;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/* 坐标串：拆出每一轴的取值 */
const WORLD_AXES = ['X（东西）', 'Y（上下）', 'Z（南北）'];
const LOCAL_AXES = ['左（X）', '上（Y）', '前（Z）'];

function parseCoord(text) {
  const sign = text.charAt(0) === '~' ? '~' : '^';
  const parts = text.split(/[ \t]+(?=[~^])/);
  const values = [];
  for (let i = 0; i < parts.length; i++) {
    const m = /^[~^][ \t]*([-+]?\d+(?:\.\d+)?)?/.exec(parts[i]);
    values.push(m && m[1] ? m[1] : '0');
  }
  return { sign: sign, values: values };
}

/* 相对坐标 ~：世界轴，最多省到 (X, Z)；局部坐标 ^：朝向三轴，必须写全 */
function coordTip(text) {
  const c = parseCoord(text);
  const n = c.values.length;
  if (c.sign === '~') {
    if (n < 2) return { label: '相对坐标 ~（' + n + ' 轴）', body: '单独一个「~」不成坐标，至少要给 X 与 Z 两轴。' };
    const names = n === 3 ? WORLD_AXES : (n === 2 ? [WORLD_AXES[0], WORLD_AXES[2]] : []);
    const shown = [];
    for (let i = 0; i < n; i++) shown.push((names[i] || ('第 ' + (i + 1) + ' 轴')) + ' ' + c.values[i]);
    return {
      label: '相对坐标 ~（' + n + ' 轴）',
      body: '世界轴偏移，依次 ' + (n === 3 ? 'X、Y、Z' : 'X、Z（Y 省略）') + '：' + shown.join(' · ') + '。基准是发动位置，不随朝向变。'
    };
  }
  if (n !== 3) return { label: '局部坐标 ^（' + n + ' 轴）', body: '局部坐标必须写全三轴（左／上／前），这里只有 ' + n + ' 个。' };
  const shown = [];
  for (let i = 0; i < 3; i++) shown.push(LOCAL_AXES[i] + ' ' + c.values[i]);
  return { label: '局部坐标 ^（3 轴）', body: '受术者自身坐标系的偏移：' + shown.join(' · ') + '。基准是朝向，随朝向变。' };
}

/* 单个秩的定义：先找同名行，再找覆盖它的区间行（1–3 这类） */
function rankDef(n, ranks) {
  if (!ranks) return '';
  const key = String(n);
  if (ranks.has(key)) return ranks.get(key);
  const num = parseInt(key, 10);
  if (!num) return '';
  let found = '';
  ranks.forEach(function (value, k) {
    if (found) return;
    const m = /^(\d+)[–-](\d+)$/.exec(k);
    if (m && num >= parseInt(m[1], 10) && num <= parseInt(m[2], 10)) found = value;
  });
  return found;
}

function rankSpan(a, b, ranks) {
  const lo = parseInt(a, 10);
  const hi = parseInt(b, 10);
  if (!lo || !hi || hi < lo || hi - lo > 8) return '';
  const parts = [];
  for (let n = lo; n <= hi; n++) {
    const r = ranks.get(String(n));
    if (!r) return '';
    const bits = String(r).split(' · ');
    parts.push(bits.length > 1 ? bits[bits.length - 1] : String(r));
  }
  return parts.join('，');
}

/* 纯函数：给定 token 类别与文本，返回 { label, body } 或 null（不给提示） */
function buildTip(cls, text, info, ranks) {
  if (cls === 'rankRange') {
    const m = /^(\d*)\.\.(\d*)$/.exec(text);
    const a = m ? m[1] : '';
    const b = m ? m[2] : '';
    if (a && b) {
      const span = ranks.get(a + '–' + b) || rankSpan(a, b, ranks);
      if (span) return { label: '秩 ' + a + '–' + b, body: span };
      return { label: '区间 ' + a + '–' + b, body: '距离、角度、量值等都用这个写法；两端都是秩时才显示秩的构成' };
    }
    if (b) return { label: '至 ' + b, body: '只写上界：表示不超过该数（含）。' };
    if (a) return { label: '自 ' + a + ' 起', body: '只写下界：表示自该处起（含）。' };
    return { label: '区间', body: '术式里的 .. 区间写法' };
  }
  if (cls === 'bracket') return { label: '方括号', body: '列表 ／ 下标 ／ 秩' };
  if (cls === 'paren') return { label: '圆括号', body: '元组 · 分组 · 实参表' };
  if (cls === 'brace') return { label: '花括号', body: '语块（兼作字典／映射）' };
  if (cls === 'pointer') return { label: '指针', body: '& 取地址 · * 顺着引用取到实体 · @ 目标简写' };
  if (cls === 'declaration') return { label: '术式名', body: '本术式的声明名，后面跟参数表与语块' };
  if (!info) return null;
  const entry = info.get(String(text).toLowerCase());
  if (!entry) return null;
  const head = entry.kind
    ? '词根·' + entry.kind
    : (CLASS_LABEL[cls] || SECTION_POS[entry.pos] || entry.pos || '词条');
  const raw = entry.abbr || '';
  const showAbbr = raw && raw !== '—' && raw !== '-' && raw.toLowerCase() !== String(text).toLowerCase();
  const note = TYPE_NOTES[String(text).toLowerCase()];
  return { label: head + (showAbbr ? '（缩写 ' + raw + '）' : ''), body: entry.meaning + (note ? '；' + note : '') };
}

const FALLBACK_CSS = "/* EpXsC Syntax 内置兜底样式（与 styles.css 第 1／2／3／5／6 节一致） */\nbody{--epx-comment:var(--text-faint);--epx-pretium:var(--color-red);--epx-keyword:var(--color-purple);--epx-judge:var(--color-purple);--epx-clause:var(--color-red);--epx-verb:var(--color-blue);--epx-decl:var(--color-yellow);--epx-element:var(--color-cyan);--epx-type:var(--color-cyan);--epx-unit:var(--color-orange);--epx-number:var(--color-orange);--epx-degree:var(--color-pink);--epx-axis:var(--color-green);--epx-pointer:var(--text-accent);--epx-operator:var(--text-muted);--epx-punct:var(--text-muted);--epx-paren:var(--text-muted);--epx-bracket:var(--text-muted);--epx-brace:var(--text-muted);--epx-rank:var(--color-orange);--epx-b2:var(--text-muted);--epx-b3:var(--text-muted);--epx-variable:var(--color-pink);--epx-modifier:var(--color-red)}\npre:has(> code[class*=\"language-EpXsC\" i]){position:relative;padding:1.1em 1.15em 1.15em;background:var(--code-background);border:1px solid var(--background-modifier-border);border-left:3px solid var(--text-accent);border-radius:var(--radius-m)}\npre:has(> code[class*=\"language-EpXsC\" i])::before{content:\"EpXsC\";position:absolute;inset:0 0 auto auto;padding:0 .7em;font-family:var(--font-interface);font-size:.62em;font-weight:600;letter-spacing:.09em;line-height:1.8;color:var(--text-on-accent);background:var(--text-accent);border-radius:0 var(--radius-m) 0 var(--radius-s);opacity:.85;pointer-events:none;user-select:none}\ncode[class*=\"language-EpXsC\" i]{font-family:var(--font-monospace);font-size:.9em;line-height:1.65;tab-size:4;color:var(--code-normal,var(--text-normal));background:none;padding:0;text-shadow:none}\ncode[class*=\"language-EpXsC\" i] .token.comment{color:var(--epx-comment);font-style:italic}\ncode[class*=\"language-EpXsC\" i] .token.pretium{color:var(--epx-pretium);font-weight:700}code[class*=\"language-EpXsC\" i] .token.clause{color:var(--epx-clause);font-weight:700}\ncode[class*=\"language-EpXsC\" i] .token.keyword{color:var(--epx-keyword);font-weight:600}code[class*=\"language-EpXsC\" i] .token.judge{color:var(--epx-judge);font-weight:700}\ncode[class*=\"language-EpXsC\" i] .token.negPrefix{color:var(--epx-keyword);font-weight:700}\ncode[class*=\"language-EpXsC\" i] .token.function{color:var(--epx-verb)}\ncode[class*=\"language-EpXsC\" i] .token.predicate{color:var(--epx-verb)}\ncode[class*=\"language-EpXsC\" i] .token.declaration{color:var(--epx-decl);font-weight:700}\ncode[class*=\"language-EpXsC\" i] .token.element{color:var(--epx-element);font-weight:600}\ncode[class*=\"language-EpXsC\" i] .token.type{color:var(--epx-type)}\ncode[class*=\"language-EpXsC\" i] .token.variable{color:var(--epx-variable);font-weight:600}\ncode[class*=\"language-EpXsC\" i] .token.unit{color:var(--epx-unit);font-style:italic}\ncode[class*=\"language-EpXsC\" i] .token.number{color:var(--epx-number)}\ncode[class*=\"language-EpXsC\" i] .token.rankRange{color:var(--epx-rank);font-weight:700}\ncode[class*=\"language-EpXsC\" i] .token.degree{color:var(--epx-degree);font-style:italic}\ncode[class*=\"language-EpXsC\" i] .token.axis{color:var(--epx-axis)}\ncode[class*=\"language-EpXsC\" i] .token.pointer{color:var(--epx-pointer);font-weight:700}\ncode[class*=\"language-EpXsC\" i] .token.coordRun{color:var(--text-muted);font-weight:600}\ncode[class*=\"language-EpXsC\" i] .token.modifier{color:var(--epx-modifier);font-style:italic;font-weight:600}\ncode[class*=\"language-EpXsC\" i] .token.declTarget{color:var(--epx-variable);font-weight:600}\ncode[class*=\"language-EpXsC\" i] .token.varUse{color:var(--epx-variable)}\ncode[class*=\"language-EpXsC\" i] .token.operator{color:var(--epx-operator)}\ncode[class*=\"language-EpXsC\" i] .token.bracket{color:var(--epx-bracket);color:color-mix(in srgb,var(--color-cyan) 40%,var(--text-muted));font-weight:600}\ncode[class*=\"language-EpXsC\" i] .token.paren{color:var(--epx-paren)}\ncode[class*=\"language-EpXsC\" i] .token.brace{color:var(--epx-brace)}\ncode[class*=\"language-EpXsC\" i] .token.punctuation{color:var(--epx-punct)}\ncode[class*=\"language-EpXsC\" i] .token.epx-d2{color:var(--epx-b2);color:color-mix(in srgb,var(--color-pink) 35%,var(--text-muted))}\ncode[class*=\"language-EpXsC\" i] .token.epx-d3{color:var(--epx-b3);color:color-mix(in srgb,var(--color-green) 35%,var(--text-muted))}\nbody.theme-light code[class*=\"language-EpXsC\" i] .token.declaration{color:#7e691f;color:color-mix(in srgb,var(--color-yellow) 45%,var(--text-normal))}\nbody.theme-light code[class*=\"language-EpXsC\" i] .token.element,body.theme-light code[class*=\"language-EpXsC\" i] .token.type{color:#17797a;color:color-mix(in srgb,var(--color-cyan) 50%,var(--text-normal))}\nbody.theme-light code[class*=\"language-EpXsC\" i] .token.unit,body.theme-light code[class*=\"language-EpXsC\" i] .token.number,body.theme-light code[class*=\"language-EpXsC\" i] .token.rankRange{color:#a05b16;color:color-mix(in srgb,var(--color-orange) 60%,var(--text-normal))}\nbody.theme-light code[class*=\"language-EpXsC\" i] .token.axis{color:#197d44;color:color-mix(in srgb,var(--color-green) 55%,var(--text-normal))}\nbody.theme-light code[class*=\"language-EpXsC\" i] .token.degree,body.theme-light code[class*=\"language-EpXsC\" i] .token.variable,body.theme-light code[class*=\"language-EpXsC\" i] .token.declTarget,body.theme-light code[class*=\"language-EpXsC\" i] .token.varUse{color:#c4387c;color:color-mix(in srgb,var(--color-pink) 90%,var(--text-normal))}\nbody.theme-light code[class*=\"language-EpXsC\" i] .token.pretium,body.theme-light code[class*=\"language-EpXsC\" i] .token.clause,body.theme-light code[class*=\"language-EpXsC\" i] .token.modifier{color:#cd3145;color:color-mix(in srgb,var(--color-red) 85%,var(--text-normal))}\ncode[class*=\"language-EpXsC\" i] .token.epx-unknown{text-decoration:underline dotted var(--color-orange);text-underline-offset:.2em}\n.epx-tip{position:fixed;z-index:9999;max-width:340px;padding:7px 11px;border:1px solid var(--background-modifier-border);border-radius:var(--radius-s);background:var(--background-secondary);color:var(--text-normal);font-family:var(--font-interface);font-size:12px;line-height:1.5;box-shadow:var(--shadow-s);pointer-events:none;opacity:0}\n.epx-tip.is-visible{opacity:1}\n.epx-tip .epx-tip-head{font-weight:600;color:var(--text-accent)}\n.epx-tip .epx-tip-body{color:var(--text-muted)}";

const varTypesOf = new WeakMap();

let tipNode = null;

function ensureTipNode() {
  if (tipNode && tipNode.parentNode) return tipNode;
  tipNode = document.createElement('div');
  tipNode.className = 'epx-tip';
  const s = tipNode.style;
  s.position = 'fixed';
  s.zIndex = '9999';
  s.pointerEvents = 'none';
  s.opacity = '0';
  /* 浮层的观感也自己带一份：外部样式表万一没生效，它就不会变成裸文本留在页面上 */
  s.maxWidth = '340px';
  s.padding = '7px 11px';
  s.border = '1px solid var(--background-modifier-border)';
  s.borderRadius = 'var(--radius-s, 6px)';
  s.background = 'var(--background-secondary)';
  s.color = 'var(--text-normal)';
  s.fontFamily = 'var(--font-interface)';
  s.fontSize = '12px';
  s.lineHeight = '1.5';
  s.boxShadow = 'var(--shadow-s, 0 2px 8px rgba(0,0,0,.25))';
  s.transition = 'opacity 90ms ease';
  document.body.appendChild(tipNode);
  return tipNode;
}

/* 跟随光标摆位：默认右下，贴边就翻到另一侧 */
function showTipAt(x, y, tip) {
  const node = ensureTipNode();
  node.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'epx-tip-head';
  head.textContent = tip.label;
  node.appendChild(head);
  if (tip.body) {
    const bodyEl = document.createElement('div');
    bodyEl.className = 'epx-tip-body';
    bodyEl.textContent = tip.body;
    node.appendChild(bodyEl);
  }
  node.style.opacity = '1';
  node.classList.add('is-visible');
  const nr = node.getBoundingClientRect();
  const vw = window.innerWidth || 900;
  const vh = window.innerHeight || 600;
  let left = x + 14;
  if (left + nr.width > vw - 8) left = x - nr.width - 14;
  if (left < 8) left = 8;
  let top = y + 18;
  if (top + nr.height > vh - 8) top = y - nr.height - 12;
  if (top < 8) top = 8;
  node.style.left = Math.round(left) + 'px';
  node.style.top = Math.round(top) + 'px';
}

function hideTip() {
  if (tipNode) tipNode.style.opacity = '0';
  if (tipNode) tipNode.classList.remove('is-visible');
}

/* 阅读视图：命中 token 就按它的类别给提示；括号看语境，变量看本块声明 */
function tipForElement(el, info, ranks) {
  let cls = pickClass(el.classList);
  if (cls === 'declTarget' || cls === 'varUse') cls = 'variable';
  if (!cls) return null;
  const text = el.textContent || '';
  const kind = el.getAttribute ? el.getAttribute('data-epx-kind') : '';
  if (kind && (cls === 'bracket' || cls === 'paren' || cls === 'brace')) return bracketTip(kind);
  const code = el.closest ? el.closest('code[class*="language-EpXsC" i]') : null;
  const vars = code ? varTypesOf.get(code) : null;
  if (vars && vars.has(text)) { const vt = variableTip(text, vars.get(text), info); if (vt) return vt; }
  if (cls === 'negPrefix') {
    const scope = negScopeText(el);
    const shown = scope.length > 24 ? scope.slice(0, 24) + '…' : scope;
    return {
      label: '前置否定 ne',
      body: '等同「!」（逻辑非）：否定紧跟其后的成分' + (shown ? ' —— ' + shown : '') + '。在筛选键里即「取反」。'
    };
  }
  if (cls === 'coordRun') return coordTip(text);
  const sym = SYMBOL_INFO[text];
  if (sym && (cls === 'operator' || cls === 'punctuation' || cls === 'pointer')) return sym;
  if (cls === 'comment') return { label: '注释', body: '注释写作 /* … */；// 不用——/ 在术式里是相变，会同形歧义。' };
  if (cls === 'annotation') return { label: '注解行', body: '行首以 . 开头的注解行，不参与解析。' };
  const group = el.closest ? el.closest('.token.indexGroup, .token.indexDecl') : null;
  if (group && cls === 'number') {
    const n = String(text).trim();
    if (group.classList.contains('indexDecl')) {
      return { label: '位数 ' + n, body: '列表容器的位数（长度）；冒号后是变量名。' };
    }
    const def = rankDef(n, ranks);
    return { label: '下标 ' + n, body: def ? '第 ' + n + ' 位；作用于实体时即它的第 ' + n + ' 秩 —— ' + def + '。' : '第 ' + n + ' 位（秩只有 1–9）。' };
  }
  if (cls === 'number') return { label: '数值', body: '有实数的量可以直接写算式。' };
  const tip = buildTip(cls, text, info, ranks);
  if (tip) return tip;
  if (cls === 'word' && text.length >= 4 && !/[0-9]/.test(text)) {
    return { label: '未入典', body: '《述无空语词典》里还没有这个词条；写进去之后，着色与释义会自动跟上。' };
  }
  return null;
}

/* 光标下的那个词：实时预览里没有 token，只能按词查 */
function wordAtPoint(x, y) {
  let node = null;
  let offset = 0;
  if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(x, y);
    if (r) { node = r.startContainer; offset = r.startOffset; }
  } else if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y);
    if (p) { node = p.offsetNode; offset = p.offset; }
  }
  if (!node || node.nodeType !== 3) return null;
  const text = node.nodeValue || '';
  const isWordChar = function (c) { return /[A-Za-z0-9_]/.test(c); };
  let i = offset;
  if (i >= text.length || !isWordChar(text.charAt(i))) {
    if (i > 0 && isWordChar(text.charAt(i - 1))) i -= 1;
    else return null;
  }
  let a = i;
  let b = i;
  while (a > 0 && isWordChar(text.charAt(a - 1))) a -= 1;
  while (b < text.length && isWordChar(text.charAt(b))) b += 1;
  return text.slice(a, b) || null;
}

/* 悬停位置是不是落在代码块里：阅读视图看 language-EpXsC，实时预览看代码行 */
function inCodeContext(el) {
  if (!el || !el.closest) return false;
  if (el.closest('code[class*="language-EpXsC" i]')) return true;
  if (el.closest('.HyperMD-codeblock')) return true;
  return false;
}

/* 检查结果面板：点一行跳到那一处 */
class LintModal extends Modal {
  constructor(app, file, issues, blocks) {
    super(app);
    this.file = file;
    this.issues = issues;
    this.blocks = blocks;
  }

  onOpen() {
    const el = this.contentEl;
    el.addClass('epx-lint');
    el.createEl('h4', { text: 'EpXsC 语法检查 · ' + this.file.basename });
    if (!this.issues.length) {
      el.createEl('div', { class: 'epx-lint-summary', text: this.blocks + ' 个代码块 · 没有发现问题' });
      return;
    }
    let errs = 0;
    for (let i = 0; i < this.issues.length; i++) if (this.issues[i].level === 'error') errs += 1;
    el.createEl('div', { class: 'epx-lint-summary', text: this.blocks + ' 个代码块 · ' + this.issues.length + ' 处（' + errs + ' 错误 / ' + (this.issues.length - errs) + ' 警告）· 点一行跳到该处' });
    const list = el.createEl('div', { class: 'epx-lint-list' });
    const self = this;
    for (let i = 0; i < this.issues.length; i++) {
      const it = this.issues[i];
      const row = list.createEl('div', { class: 'epx-lint-row epx-lint-' + it.level });
      row.createEl('span', { class: 'epx-lint-line', text: '第 ' + it.line + ' 行' });
      row.createEl('span', { class: 'epx-lint-msg', text: it.message });
      row.addEventListener('click', function () {
        self.app.workspace.getLeaf(false).openFile(self.file, { eState: { line: Math.max(0, it.line - 1), ch: 0 } });
        self.close();
      });
    }
  }

  onClose() { this.contentEl.empty(); }
}

class EpXsCSyntaxPlugin extends Plugin {
  onload() {
    const self = this;
    this.grammar = makeGrammar(BASE_LISTS);
    this.info = new Map();
    this.ranks = new Map();
    for (const w in EXTRA_WORDS) this.info.set(w, EXTRA_WORDS[w]);
    this.install();
    this.registerDomEvent(document, 'mouseover', function (ev) {
      hideTip();
      const el = ev.target;
      if (!el || !el.closest) return;
      const token = el.closest('span.token');
      if (token && el.closest('code[class*="language-EpXsC" i]')) {
        const tip = tipForElement(token, self.info, self.ranks);
        if (tip) { showTipAt(ev.clientX, ev.clientY, tip); return; }
      }
      if (!inCodeContext(el)) return;
      const word = wordAtPoint(ev.clientX, ev.clientY);
      if (!word) return;
      const tip = buildTip('word', word, self.info, self.ranks);
      if (tip) showTipAt(ev.clientX, ev.clientY, tip);
    });
    this.registerDomEvent(document, 'mouseout', hideTip);
    this.registerDomEvent(document, 'scroll', hideTip, true);
    this.addCommand({
      id: 'diagnose',
      name: 'EpXsC 诊断报告（写进库根目录，便于整段复制）',
      callback: function () { self.diagnose(); }
    });
    this.addCommand({
      id: 'lint-note',
      name: '检查当前笔记的 EpXsC 代码块',
      callback: function () { self.lintActiveNote(); }
    });
    this.addCommand({
      id: 'self-check',
      name: 'EpXsC 自检（视图／token／颜色／样式表）',
      callback: function () { self.selfCheck(); }
    });
    this.register(function () {
      const Prism = window.Prism;
      if (!Prism || !Prism.languages) return;
      for (let i = 0; i < LANG_KEYS.length; i++) delete Prism.languages[LANG_KEYS[i]];
    });
    this.registerMarkdownPostProcessor(function (el) { self.highlightIn(el); });
    this.registerEvent(this.app.vault.on('modify', function (file) {
      if (!file) return;
      if (file.path === DICT_PATH || file.path === SYNTAX_PATH || file.path === RANK_PATH) self.refresh();
    }));
    this.addCommand({
      id: 'reload-lexicon',
      name: '重新载入词表与释义',
      callback: function () { self.refresh(); }
    });
    this.app.workspace.onLayoutReady(function () { self.refresh(); });
    /* 启动期多补几次，之后靠事件与看门狗兜底 */
    const early = [400, 1500];
    for (let i = 0; i < early.length; i++) {
      const t = window.setTimeout(function () { self.ensureRendered(); }, early[i]);
      this.register(function () { window.clearTimeout(t); });
    }
    this.registerEvent(this.app.workspace.on('layout-change', function () { self.ensureRendered(); }));
    this.registerEvent(this.app.workspace.on('active-leaf-change', function () { self.ensureRendered(); }));
    this.registerInterval(window.setInterval(function () { self.ensureRendered(); }, 2500));
  }

  install() {
    const Prism = window.Prism;
    if (!Prism || !Prism.languages) return false;
    for (let i = 0; i < LANG_KEYS.length; i++) Prism.languages[LANG_KEYS[i]] = this.grammar;
    return true;
  }

  /* 读词典 → 重建词表 → 重新上色 */
  /* 读库内文件；哪一份读不到（别人下载的库）就用内置快照兜底。
     库内文件永远优先，所以词典一改，着色与释义就跟着改。 */
  async refresh() {
    const info = new Map();
    for (const w in EXTRA_WORDS) info.set(w, EXTRA_WORDS[w]);
    const roots = new Map();
    const extraUnits = [];
    const keyWords = new Set();
    let lists = null;
    let ranks = new Map();

    const mergeInto = function (target, map) {
      map.forEach(function (value, key) { if (!target.has(key)) target.set(key, value); });
    };

    try {
      /* 1) 词典 → 词条 + 四类词表 */
      const dictFile = this.app.vault.getAbstractFileByPath(DICT_PATH);
      if (dictFile instanceof TFile) {
        const text = await this.app.vault.cachedRead(dictFile);
        mergeInto(info, parseEntries(text));
        const map = splitSections(text);
        lists = {
          keyword: wordsFrom(map, SECTIONS.keyword, FALLBACK.keyword),
          judge: wordsFrom(map, SECTIONS.judge, FALLBACK.judge),
          clause: wordsFrom(map, SECTIONS.clause, FALLBACK.clause),
          degree: wordsFrom(map, SECTIONS.degree, FALLBACK.degree),
          predicate: wordsFrom(map, SECTIONS.predicate, FALLBACK.predicate),
          unit: wordsFrom(map, SECTIONS.unit, FALLBACK.unit)
        };
      } else {
        mergeInto(info, builtinMap('entries'));
      }

      /* 2) 术式语法 → 筛选键 + 单位表 */
      const syntaxFile = this.app.vault.getAbstractFileByPath(SYNTAX_PATH);
      if (syntaxFile instanceof TFile) {
        const syntaxText = await this.app.vault.cachedRead(syntaxFile);
        const keyMap = parseFilterKeys(syntaxText);
        mergeInto(info, keyMap);
        keyMap.forEach(function (v, k) { keyWords.add(String(k).toLowerCase()); });
        const unitMap = parseUnits(syntaxText);
        mergeInto(info, unitMap);
        unitMap.forEach(function (v) { extraUnits.push(v.word); });
      } else {
        const keyMap = builtinMap('keys');
        mergeInto(info, keyMap);
        keyMap.forEach(function (v, k) { keyWords.add(String(k).toLowerCase()); });
        mergeInto(info, builtinMap('units'));
      }

      /* 3) 维度模型 → 秩表 */
      const rankFile = this.app.vault.getAbstractFileByPath(RANK_PATH);
      ranks = rankFile instanceof TFile ? parseRanks(await this.app.vault.cachedRead(rankFile)) : builtinRanks();

      /* 4) 词根表分册 → 词根释义；动-根同时进谓词表 */
      const rootFiles = this.app.vault.getFiles().filter(function (f) { return f.path.indexOf(ROOTS_DIR) === 0; });
      if (rootFiles.length) {
        for (let i = 0; i < rootFiles.length; i++) {
          mergeInto(roots, parseRoots(await this.app.vault.cachedRead(rootFiles[i])));
        }
      } else {
        mergeInto(roots, builtinRoots());
      }
      roots.forEach(function (v, k) { if (v.kind === '动' || !info.has(k)) info.set(k, v); });
    } catch (err) {
      console.warn('[EpXsC Syntax] 读取库内词库失败，改用内置快照：', err);
      mergeInto(info, builtinMap('entries'));
      mergeInto(info, builtinMap('keys'));
      mergeInto(info, builtinMap('units'));
      mergeInto(roots, builtinRoots());
      roots.forEach(function (v, k) { if (v.kind === '动' || !info.has(k)) info.set(k, v); });
      if (!ranks.size) ranks = builtinRanks();
    }

    const verbRoots = [];
    roots.forEach(function (v) { if (v.kind === '动') verbRoots.push(v.word); });
    if (lists) {
      lists.predicate = lists.predicate.concat(verbRoots);
      lists.unit = lists.unit.concat(extraUnits);
    } else {
      lists = builtinLists(verbRoots);
    }

    this.info = info;
    this.ranks = ranks;
    this.roots = roots;
    this.units = new Set();
    for (let i = 0; i < lists.unit.length; i++) this.units.add(String(lists.unit[i]).toLowerCase());
    this.keys = new Set();
    const keySet = this.keys;
    /* 以《术式语法》的筛选键表为准：同一个词也可能另有词性（如 limit 兼作术式关键词），
       只按词性反推会漏掉它 */
    keyWords.forEach(function (k) { keySet.add(String(k).toLowerCase()); });
    info.forEach(function (v, k) { if (v.pos === '筛选键') keySet.add(String(k).toLowerCase()); });
    this.grammar = makeGrammar(lists);
    this.install();
    console.log('[EpXsC Syntax] 词条 ' + info.size + ' · 词根 ' + roots.size + ' · 秩 ' + ranks.size + '（' + (lists.predicate.length) + ' 个谓词）');
    await this.ensureStyles();
    this.rehighlight();
  }

  /* 样式兜底：外部 styles.css 没被加载时（颜色、右上角 EpXsC 标记、未入典点线、
     悬停浮层样式会一起消失），自己把样式塞进页面。先试读插件目录里的 styles.css，读不到就用内置那份。 */
  async ensureStyles() {
    if (this._styleState) return this._styleState;
    let present = false;
    try {
      const sheets = document.styleSheets || [];
      for (let i = 0; i < sheets.length && !present; i++) {
        let rules = null;
        try { rules = sheets[i].cssRules; } catch (e) { continue; }
        if (!rules) continue;
        for (let j = 0; j < rules.length; j++) {
          const sel = rules[j].selectorText || '';
          if (sel.indexOf('.epx-tip') >= 0 || sel.indexOf('.token.keyword') >= 0) { present = true; break; }
        }
      }
    } catch (e) { /* 读不到就当没有 */ }
    if (present) { this._styleState = '外部样式表已生效'; return this._styleState; }
    let css = '';
    try {
      const dir = (this.manifest && this.manifest.dir) || '.obsidian/plugins/epxsc-syntax';
      css = await this.app.vault.adapter.read(dir + '/styles.css');
    } catch (e) { css = ''; }
    let from = '外部样式表没生效：已把 styles.css 注入页面';
    if (!css || css.indexOf('.epx-tip') < 0) { css = FALLBACK_CSS; from = '外部样式表没生效：已注入内置配色'; }
    try {
      let el = document.getElementById('epxsc-styles');
      if (!el) { el = document.createElement('style'); el.id = 'epxsc-styles'; document.head.appendChild(el); }
      el.textContent = css;
      this._styleState = from;
    } catch (e) { this._styleState = '注入失败：' + (e && e.message); }
    return this._styleState;
  }

  /* 生成诊断报告，写进库里，便于整段复制出来 */
  async diagnose() {
    const L = [];
    const add = function (s) { L.push(s); };
    add('# EpXsC 诊断报告');
    add('');
    add('- 代码版本（BUILD）：' + BUILD);
    add('- manifest 版本：' + ((this.manifest && this.manifest.version) || '?'));
    add('- 插件目录：' + ((this.manifest && this.manifest.dir) || '?'));
    add('- 生成时间：' + new Date().toLocaleString());
    let mode = '非笔记视图';
    try {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (view) mode = view.getMode() === 'preview' ? '阅读视图' : '实时预览／源码';
    } catch (e) { /* 忽略 */ }
    add('- 当前视图：**' + mode + '**');
    add('- 词表：词条 ' + this.info.size + ' · 词根 ' + (this.roots ? this.roots.size : '-') + ' · 秩 ' + this.ranks.size + ' · 谓词 ' + this.grammar.predicate.source.length + ' 字符');
    add('- Prism：' + (window.Prism ? '有' : '**没有**') + ' · 语法 EpXsC：' + (window.Prism && window.Prism.languages && window.Prism.languages.EpXsC ? '已装' : '**缺失**'));
    add('');
    const codes = document.querySelectorAll('code[class*="language-EpXsC" i]');
    add('## 代码块（' + codes.length + ' 个）');
    for (let i = 0; i < codes.length && i < 6; i++) {
      const el = codes[i];
      let tokens = 0;
      let color = '-';
      try {
        tokens = el.querySelectorAll('span.token').length;
        const first = el.querySelector('span.token');
        if (first && window.getComputedStyle) color = window.getComputedStyle(first).color;
      } catch (e) { color = '(测不到)'; }
      add('- 第 ' + (i + 1) + ' 个：class="' + (el.className || '') + '" · token ' + tokens + ' 个 · 首个 token 颜色 ' + color);
    }
    add('');
    add('## 样式表');
    let ourRules = 0;
    try {
      const sheets = document.styleSheets || [];
      add('- 共 ' + sheets.length + ' 张');
      for (let i = 0; i < sheets.length; i++) {
        let n = 0;
        let ours = 0;
        let rules = null;
        try { rules = sheets[i].cssRules; } catch (e) { add('- 第 ' + (i + 1) + ' 张：读不到（跨源）' + (sheets[i].href ? ' href=' + sheets[i].href : '')); continue; }
        if (rules) {
          n = rules.length;
          for (let j = 0; j < rules.length; j++) {
            const sel = rules[j].selectorText || '';
            if (sel.indexOf('.epx-') >= 0 || sel.indexOf('.token.') >= 0) ours += 1;
          }
        }
        ourRules += ours;
        add('- 第 ' + (i + 1) + ' 张：' + n + ' 条规则，其中我们的 ' + ours + ' 条' + (sheets[i].href ? ' · href=' + sheets[i].href : ''));
      }
    } catch (e) { add('- 读样式表出错：' + (e && e.message)); }
    add('- 命中我们选择器的规则合计：' + ourRules);
    add('- 兜底状态：' + (this._styleState || '(还没跑)'));
    add('');
    add('## 插件目录里的 styles.css');
    try {
      const dir = (this.manifest && this.manifest.dir) || '.obsidian/plugins/epxsc-syntax';
      const css = await this.app.vault.adapter.read(dir + '/styles.css');
      const lines = String(css).split('\n');
      add('- 读到 ' + css.length + ' 字符 · 含 .epx-tip：' + (css.indexOf('.epx-tip') >= 0 ? '是' : '**否**') + ' · 含 --epx-modifier：' + (css.indexOf('--epx-modifier') >= 0 ? '是' : '否'));
      add('- 前 3 行：');
      for (let i = 0; i < 3 && i < lines.length; i++) add('    ' + (i + 1) + '. ' + lines[i]);
    } catch (e) { add('- **读不到**：' + (e && e.message)); }
    add('');
    add('## 样例代码块（下面这块在阅读视图里应当有颜色）');
    add('');
    add('\x60\x60\x60EpXsC');
    add('Purificatio(priv locus: zone) {');
    add('\tconsta lit = 3 MU;');
    add('\tpriv x = &zone;');
    add('\tpubl consta total = lit;');
    add('\tne navis *&zone');
    add('\tluss lit;');
    add('}');
    add('\x60\x60\x60');
    const text = L.join('\n');
    try {
      await this.app.vault.adapter.write('EpXsC 诊断报告.md', text);
      new Notice('诊断报告已写入库根目录：EpXsC 诊断报告.md（代码版本 ' + BUILD + '）', 12000);
    } catch (e) {
      new Notice('写报告失败：' + (e && e.message));
    }
    return text;
  }

  /* 检查当前笔记里的 EpXsC 代码块 */
  async lintActiveNote() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.file) { new Notice('先打开一篇笔记再检查。'); return; }
    const file = view.file;
    const text = await this.app.vault.cachedRead(file);
    const re = /^[ \t]*\x60\x60\x60EpXsC[ \t]*\r?\n([\s\S]*?)^[ \t]*\x60\x60\x60[ \t]*$/gm;
    const ctx = { info: this.info, units: this.units, keys: this.keys };
    let m;
    let blocks = 0;
    const issues = [];
    while ((m = re.exec(text))) {
      blocks += 1;
      const start = text.slice(0, m.index).split('\n').length;
      const found = lintText(m[1], ctx);
      for (let i = 0; i < found.length; i++) {
        issues.push({ level: found[i].level, line: start + 1 + found[i].line, message: found[i].message });
      }
    }
    if (!blocks) { new Notice('这一页没有 EpXsC 代码块。'); return; }
    new LintModal(this.app, file, issues, blocks).open();
  }

  /* 把 ne 之后、直到子句末尾的 token 标出来：被否定的范围 */
  markNegation(code) {
    const heads = code.querySelectorAll('span.token.negPrefix');
    for (let i = 0; i < heads.length; i++) {
      let node = heads[i].nextSibling;
      let guard = 0;
      while (node && guard < 40) {
        guard += 1;
        const t = node.textContent || '';
        if (/[;,\n]/.test(t)) break;
        if (node.nodeType === 1 && node.classList && node.classList.contains('token')) node.classList.add('epx-neg-scope');
        node = node.nextSibling;
      }
    }
  }

  /* 词典里查不到的词加一层点线，提示未入典 */
  markUnknown(code) {
    const spans = code.querySelectorAll('span.token.word');
    for (let i = 0; i < spans.length; i++) {
      const w = (spans[i].textContent || '').toLowerCase();
      if (w.length < 4 || /[0-9]/.test(w)) continue;
      if (this.info.has(w)) continue;
      spans[i].classList.add('epx-unknown');
    }
  }

  /* 自检：当前视图里到底有没有 token、词表读进来没有 */
  selfCheck() {
    let mode = '非笔记视图';
    try {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (view) mode = view.getMode() === 'preview' ? '阅读视图' : '实时预览／源码';
    } catch (err) { /* 忽略 */ }
    const codes = document.querySelectorAll('code[class*="language-EpXsC" i]');
    let tokened = 0;
    for (let i = 0; i < codes.length; i++) {
      if (codes[i].querySelector('span.token')) tokened += 1;
    }
    const lines = document.querySelectorAll('.HyperMD-codeblock').length;
    /* 决定性三问：token 有没有、算出来的颜色是什么、样式表载入没有 */
    let firstClass = '(没有代码块)';
    let tokenCount = 0;
    let color = '(未测)';
    if (codes[0]) {
      firstClass = codes[0].className || '(空)';
      tokenCount = codes[0].querySelectorAll('span.token').length;
      const first = codes[0].querySelector('span.token');
      try { if (first && window.getComputedStyle) color = window.getComputedStyle(first).color; } catch (e) { color = '(读不到)'; }
    }
    let styleState = '未知';
    try {
      let n = 0;
      const sheets = document.styleSheets || [];
      for (let i = 0; i < sheets.length; i++) {
        let rules = null;
        try { rules = sheets[i].cssRules; } catch (e) { continue; }
        if (!rules) continue;
        for (let j = 0; j < rules.length; j++) {
          const sel = rules[j].selectorText || '';
          if (sel.indexOf('.token.') >= 0 || sel.indexOf('.epx-tip') >= 0) n += 1;
        }
      }
      styleState = n ? '已载入 ' + n + ' 条着色规则' : '未载入 ✗（styles.css 没生效）';
    } catch (e) { styleState = '读不到'; }
    new Notice([
      'EpXsC 自检 · 代码版本 ' + BUILD,
      '词条 ' + this.info.size + ' · 秩 ' + this.ranks.size + ' · 语法' + (this.grammar ? '已装' : '缺失'),
      '当前视图：' + mode,
      'EpXsC 代码块 ' + codes.length + ' 个（带 token 的 ' + tokened + ' 个）· 实时预览代码行 ' + lines + ' 行',
      '首个块 class：' + firstClass,
      '首个块 token 数：' + tokenCount + ' · 首个 token 颜色：' + color,
      '样式表：' + styleState + (this._styleState ? ' · 兜底：' + this._styleState : '')
    ].join('\n'), 15000);
  }

  rehighlight() {
    this.highlightIn(document);
  }

  highlightIn(root) {
    if (!root || !root.querySelectorAll) return;
    const nodes = root.querySelectorAll(CODE_SELECTOR);
    for (let i = 0; i < nodes.length; i++) this.highlightOne(nodes[i]);
  }

  /* 自愈：启动时首屏可能早于插件加载、或 window.Prism 尚未就绪，
     也可能被 Obsidian 的 Prism 初始化覆盖掉注册的语法。
     这里确认两件事：语法还在不在、该上色的块有没有 token。 */
  ensureRendered() {
    const Prism = window.Prism;
    if (!Prism || !Prism.languages) return;
    if (Prism.languages.EpXsC !== this.grammar) this.install();
    const nodes = document.querySelectorAll(CODE_SELECTOR);
    for (let i = 0; i < nodes.length; i++) {
      const code = nodes[i];
      if (code.querySelector('span.token')) continue;
      if (!(code.textContent || '').trim()) continue;
      this.highlightOne(code);
    }
  }

  highlightOne(code) {
    const Prism = window.Prism;
    if (!Prism) return;
    try {
      const text = code.textContent || '';
      const found = /language-(\w+)/.exec(code.className || '');
      const lang = found ? found[1] : 'EpXsC';
      /* 样式选的是 language-EpXsC：万一 Obsidian 没给这个 class，token 会出来但不上色。
         补一个，让着色不悬在外部 class 上。 */
      if (!found && code.classList) code.classList.add('language-EpXsC');
      const grammar = Prism.languages[lang] || Prism.languages.EpXsC;
      if (!grammar) return;
      let html = markBracketDepth(Prism.highlight(text, grammar, lang), bracketKinds(text));
      const vars = parseVarTypes(text, this.info);
      varTypesOf.set(code, vars);
      html = markVarUse(html, vars);
      code.innerHTML = html;
      this.markUnknown(code);
      this.markNegation(code);
    } catch (err) {
      console.warn('[EpXsC Syntax]', err);
    }
  }
}

/* 逐层给括号打上 epx-d1 / d2 / d3（三层一循环，再深轮回第一层）。
   Prism 是逐位置的词法分析，数不了层数，所以在这一步扫一遍它产出的 HTML。 */
function markBracketDepth(html, kinds) {
  let depth = 0;
  let idx = 0;
  return html.replace(/<span class="token ([a-z]+)">([\[\](){}])<\/span>/g, function (all, cls, ch) {
    if (cls !== 'bracket' && cls !== 'paren' && cls !== 'brace') return all;
    const isOpen = ch === '[' || ch === '(' || ch === '{';
    if (isOpen) depth += 1;
    else if (depth > 0) depth -= 1;
    const level = isOpen ? depth : depth + 1;
    const kind = kinds && kinds[idx] ? String(kinds[idx]).replace(/"/g, '') : '';
    idx += 1;
    const attr = kind ? ' data-epx-kind="' + kind + '"' : '';
    return '<span class="token ' + cls + ' epx-d' + (((level - 1) % 3) + 1) + '"' + attr + '>' + ch + '</span>';
  });
}

/* 内置词库快照：由 述无空语词典 / 术式语法 / 维度模型 / 词根表 生成。
   库内有对应文件时以文件为准，这份只在缺失时兜底。 */
const BUILTIN_LEXICON = {"entries":{"aqua":["aqua","名词","水元素","Aqu"],"delucke":["Delucke","名词","暗元素","Duk"],"draco":["draco","名词","龙、东方龙","DRA"],"earthe":["Earthe","名词","地元素","Ert"],"eletribon":["Eletribon","名词","雷电","Elc"],"fliam":["fliam","名词","炎元素","Flm"],"fragor":["fragor","名词","破碎声、故障","FRAg"],"fragus":["fragus","名词","碎片、残骸","FRGs"],"gramakipo":["gramakipo","名词","重力加速度","GRK"],"hopas":["hopas","名词","营地、休息处、广场","HOP"],"locor":["locor","名词","定位器、放置者","LOCr"],"locus":["locus","名词","地点、位置","LOCs"],"loqor":["loqor","名词","说话者、讲述者","LOQr"],"loqus":["loqus","名词","语言、话语","LOQs"],"lumena":["lumena","名词","光元素","Lum"],"memor":["memor","名词","记忆、心智","MEMr"],"memus":["memus","名词","思想、念头","MEMs"],"miteas":["Miteas","名词","米、计量单位","MIT"],"mortor":["mortor","名词","死者、亡灵","MORr"],"mortus":["mortus","名词","死亡","MORs"],"movor":["movor","名词","推动者、动机","MOVr"],"movus":["movus","名词","运动、移动","MOVs"],"nuetrue":["Nuetrue","名词","自然元素","Nut"],"qudend":["qudend","名词","结束、终点","QUD"],"sanor":["sanor","名词","治疗者、修复者","SANr"],"sanus":["sanus","名词","健康、治愈","SANs"],"sartose":["sartose","名词","开始、起点","SAR"],"siro":["siro","名词","虚空","SIR"],"strua":["strua","名词","建筑、结构","STRa"],"struor":["struor","名词","建造者","STRu"],"vidor":["vidor","名词","观察者、见证者","VIDr"],"vidus":["vidus","名词","视觉、景象","VIDs"],"vivor":["vivor","名词","活力、生命力","VIVr"],"vivus":["vivus","名词","生命、活体","VIVs"],"wuinde":["wuinde","名词","风元素","Wnd"],"zone":["zone","名词","区域、范围","ZON"],"venis":["venis","名词","来（动）","—"],"agrus":["agrus","名词","田地","—"],"granarus":["granarus","名词","谷仓","—"],"sicus":["sicus","名词","干燥","—"],"vespus":["vespus","名词","傍晚","—"],"pluvus":["pluvus","名词","雨","—"],"petasus":["petasus","名词","帽","—"],"flagro":["flagro","名词","燃炽之事","—"],"sta":["sta","名词","立之事","—"],"acutus":["acutus","名词","尖锐","—"],"mana":["mana","名词","保持的结果","—"],"arus":["arus","名词","耕之事","—"],"sterus":["sterus","名词","粪肥","—"],"vernus":["vernus","名词","春","—"],"latus":["latus","名词","侧","—"],"altus":["altus","名词","高","—"],"densus":["densus","名词","密","—"],"manu":["manu","名词","手","—"],"amphor":["amphor","名词","瓮匠","—"],"cada":["cada","名词","坠落的结果","—"],"lalupid":["lalupid","名词","略石料","—"],"sanarium":["sanarium","名词","治愈之所","—"],"gnosarium":["gnosarium","名词","知识之所","—"],"vidorium":["vidorium","名词","看之器","—"],"viditrin":["viditrin","名词","看之所","—"],"lapidarius":["lapidarius","名词","石料者","—"],"vidista":["vidista","名词","看家","—"],"vidamen":["vidamen","名词","看之物","—"],"vidura":["vidura","名词","看之术","—"],"vidimentum":["vidimentum","名词","看之手段","—"],"vidibul":["vidibul","名词","看之具","—"],"lapidulus":["lapidulus","名词","小石料","—"],"vidaster":["vidaster","名词","劣等看","—"],"viditrix":["viditrix","名词","看的女性","—"],"vidologia":["vidologia","名词","看学","—"],"magism":["magism","名词","魔法主义","—"],"semi":["semi","名词","半","—"],"extra":["extra","名词","外侧","—"],"cisterna":["cisterna","名词","蓄水池","—"],"auctio":["auctio","名词","拍卖","—"],"aluctio":["aluctio","名词","略拍卖","—"],"tribelus":["tribelus","名词","脱粒器","—"],"ferrfabr":["ferrfabr","名词","铁匠","—"],"lignfabr":["lignfabr","名词","木匠","—"],"ferrgnos":["ferrgnos","名词","铁学","—"],"silvzone":["silvzone","名词","森林区","—"],"marvia":["marvia","名词","海路","—"],"censura":["censura","名词","监察之术","—"],"alfus":["alfus","族名","精灵族","ALF"],"angelus":["angelus","族名","萨科塔族","ANG"],"anura":["anura","族名","安努拉族","ANU"],"aquor":["aquor","族名","阿戈尔族","AQR"],"avis":["avis","族名","黎博利族","AVI"],"bovus":["bovus","族名","普米霍族","BOV"],"canis":["canis","族名","坎那斯族","CAN"],"centaurus":["centaurus","族名","半人马族","CEN"],"ceratus":["ceratus","族名","赛拉托族","CER"],"chimera":["chimera","族名","奇美拉","CHI"],"cobalus":["cobalus","族名","地精族","COB"],"cuniculus":["cuniculus","族名","卡特斯族","CUN"],"daemon":["daemon","族名","萨卡兹族","DAE"],"dracon":["dracon","族名","德拉克族","DRAk"],"eidolon":["eidolon","族名","幽灵族","EID"],"eksul":["eksul","族名","阿纳萨族","EKS"],"elafus":["elafus","族名","埃拉菲亚族","ELA"],"elementa":["elementa","族名","纯粹元素族","ELEm"],"equus":["equus","族名","埃奎他族","EQU"],"felus":["felus","族名","菲林族","FEL"],"gigas":["gigas","族名","巨人族","GIG"],"humanus":["humanus","族名","自然人","HUM"],"hyaena":["hyaena","族名","瑞柏巴族","HYA"],"kapra":["kapra","族名","卡普里尼族","KAP"],"krokodilus":["krokodilus","族名","阿达克利斯族","KRO"],"kylin":["kylin","族名","麒麟族","KYL"],"kyklops":["kyklops","族名","独眼巨人族","KYK"],"leon":["leon","族名","阿斯兰族","LEOn"],"lupus":["lupus","族名","鲁珀族","LUP"],"machina":["machina","族名","机械族","MAC"],"mantika":["mantika","族名","曼提柯族","MTK"],"moskus":["moskus","族名","依特拉族","MSK"],"mustela":["mustela","族名","阿纳缇族","MST"],"nanus":["nanus","族名","杜林族","NAN"],"nympha":["nympha","族名","宁芙族","NYM"],"oni":["oni","族名","鬼族","ONI"],"pilosa":["pilosa","族名","皮洛萨族","PIL"],"pumilio":["pumilio","族名","侏儒族","PUM"],"rattus":["rattus","族名","扎拉克族","RAT"],"saura":["saura","族名","萨弗拉族","SAU"],"serpens":["serpens","族名","斐迪亚族","SER"],"sirena":["sirena","族名","人鱼族","SRN"],"skeletus":["skeletus","族名","骸骨族","SKEl"],"telekinus":["telekinus","族名","念动力族","TEL"],"testudo":["testudo","族名","特斯图托族","TES"],"tikaz":["tikaz","族名","提卡兹族","TIK"],"umbra":["umbra","族名","法涅兰族","UMB"],"ursus":["ursus","族名","乌萨斯族","URS"],"versipellis":["versipellis","族名","狼人族","VER"],"vipera":["vipera","族名","瓦伊凡族","VIP"],"vulpes":["vulpes","族名","沃尔珀族","VUL"],"alopex":["alopex","动物名","狐","ALO"],"arktos":["arktos","动物名","熊","ARK"],"bradypus":["bradypus","动物名","树懒","BRA"],"catus":["catus","动物名","猫","CAT"],"cervus":["cervus","动物名","鹿","CRV"],"chelys":["chelys","动物名","龟","CHE"],"crocuta":["crocuta","动物名","鬣狗","CRO"],"gale":["gale","动物名","鼬","GAL"],"hippos":["hippos","动物名","马","HIP"],"kyon":["kyon","动物名","犬","KYO"],"lacerta":["lacerta","动物名","蜥蜴","LAC"],"leo":["leo","动物名","狮","LEO"],"lepus":["lepus","动物名","兔","LEP"],"lykos":["lykos","动物名","狼","LYK"],"mantis":["mantis","动物名","螳螂","MAN"],"moschiferus":["moschiferus","动物名","麝","MOS"],"mus":["mus","动物名","鼠","MUS"],"ophis":["ophis","动物名","蛇","OPH"],"pardalis":["pardalis","动物名","豹","PAR"],"rana":["rana","动物名","蛙","RAN"],"rinoceros":["rinoceros","动物名","犀牛","RIN"],"salamandra":["salamandra","动物名","蝾螈","SAL"],"souchos":["souchos","动物名","鳄","SOU"],"tauros":["tauros","动物名","牛","TAU"],"tragos":["tragos","动物名","山羊","TRA"],"ens":["ens","族、血统与分类","存在者","ENS"],"ferus":["ferus","族、血统与分类","兽人（提案）","FER"],"gens":["gens","族、血统与分类","族、血统群体","GEN"],"humaniforma":["humaniforma","族、血统与分类","人形、类人","HMF"],"phyton":["phyton","族、血统与分类","植物、菌","PHY"],"purus":["purus","族、血统与分类","纯血的","PUR"],"sanguis":["sanguis","族、血统与分类","血统、血缘","SNG"],"semihumanus":["semihumanus","族、血统与分类","半人（提案）","SEMh"],"subumanus":["subumanus","族、血统与分类","亚人（提案）","SUB"],"supervita":["supervita","族、血统与分类","高级生命","SUP"],"zoon":["zoon","族、血统与分类","动物","ZOO"],"aepaus":["aepaus","动词","增加、提升、加剧","AEP"],"apolus":["apolus","动词","射击、爆炸","APOl"],"expaste":["expaste","动词","交换、克隆、复制","EXPa"],"expual":["expual","动词","保存、储存","EXPu"],"fragis":["fragis","动词","破碎、打断","FRAi"],"locis":["locis","动词","放置、定位","LOCi"],"loqis":["loqis","动词","说、讲述","LOQi"],"memis":["memis","动词","记忆、回忆","MEMi"],"mortis":["mortis","动词","死、消亡","MORi"],"movis":["movis","动词","移动、推动","MOVi"],"navis":["navis","动词","引导、释放、解锁","NAV"],"plur":["plur","动词","净化","PLU"],"retase":["retase","动词","休息、 停止、重置","RET"],"sanis":["sanis","动词","治愈、修复","SANi"],"struis":["struis","动词","建造、构造","STRi"],"vidis":["vidis","动词","看、观察","VIDi"],"vivis":["vivis","动词","活、生存","VIVi"],"hab":["hab","动词","有、拥有","HAB"],"causa":["causa","动词","缘故、理由","CAU"],"trituris":["trituris","动词","脱粒","—"],"ventilis":["ventilis","动词","扬谷","—"],"manis":["manis","动词","保持","—"],"lapsis":["lapsis","动词","滑落","—"],"oppes":["oppes","动词","等待","—"],"stas":["stas","动词","立","—"],"restas":["restas","动词","重立","—"],"visid":["visid","动词","极看","—"],"vilud":["vilud","动词","略看","—"],"transividis":["transividis","动词","透看","—"],"vados":["vados","动词","行走","—"],"flagros":["flagros","动词","燃炽","—"],"secis":["secis","动词","切","—"],"vitad":["vitad","动词","反复看","—"],"vimid":["vimid","动词","瞬看","—"],"bilis":["bilis","动词","胆","—"],"formis":["formis","动词","塑造","—"],"videsco":["videsco","动词","开始看","—"],"nevidis":["nevidis","动词","不看","—"],"revidis":["revidis","动词","重看","—"],"praevidis":["praevidis","动词","预看","—"],"covidis":["covidis","动词","共看","—"],"providis":["providis","动词","前看","—"],"extravidis":["extravidis","动词","外看","—"],"retrovidis":["retrovidis","动词","回看","—"],"tri":["tri","数词","三","—"],"quinq":["quinq","数词","五","—"],"paulum":["paulum","数词","少许","—"],"nimis":["nimis","数词","过度","—"],"sept":["sept","数词","七","—"],"parum":["parum","数词","太少","—"],"dec":["dec","数词","十","—"],"quadr":["quadr","数词","四","—"],"false":["false","形容词","错误的、假的","—"],"true":["true","形容词","真实的、真的","—"],"magnal":["magnal","形容词","大的","—"],"granar":["granar","形容词","属于谷粒的","—"],"humal":["humal","形容词","属于湿的","—"],"ventil":["ventil","形容词","易风的","—"],"vidifer":["vidifer","形容词","带看的","—"],"vadosal":["vadosal","形容词","浅的","—"],"bathal":["bathal","形容词","深的","—"],"lumenal":["lumenal","形容词","属于微光的","—"],"vidal":["vidal","形容词","属于看的","—"],"vidivus":["vidivus","形容词","好看的","—"],"vidibilis":["vidibilis","形容词","可看的","—"],"lapidiformis":["lapidiformis","形容词","石料形","—"],"vidax":["vidax","形容词","嗜看的","—"],"vidibundus":["vidibundus","形容词","正看的","—"],"vidulent":["vidulent","形容词","富于看的","—"],"lapidat":["lapidat","形容词","具有石料的","—"],"vidil":["vidil","形容词","易看的","—"],"inter":["inter","形容词","属于毁灭的","—"],"cisternal":["cisternal","形容词","属于蓄水池的","—"],"ardu":["ardu","副词","难","—"],"clar":["clar","副词","明","—"],"facil":["facil","副词","易","—"],"fort":["fort","副词","强","—"],"lent":["lent","副词","慢","—"],"sombra":["sombra","副词","暗","—"],"tac":["tac","副词","静","—"],"vel":["vel","副词","快","—"],"viden":["viden","副词","以看的方式","—"],"viditim":["viditim","副词","逐看地","—"],"de":["de","介词","在……之内","dex"],"enn":["enn","介词","在……里面","enn"],"ord":["ord","介词","从、源自","ord"],"pro":["pro","介词","朝向、向、为了","pro"],"ynen":["Ynen","介词","通过、由","yne"],"intra":["intra","介词","进入、在……之内","—"],"di":["di","介词","……的、之（领属）","di"],"supra":["supra","介词","在……之上","sup"],"sub":["sub","介词","在……之下","sub"],"velut":["velut","介词","如、似（明喻）","vel"],"deb":["deb","助动词","应、该","deb"],"dur":["dur","助动词","持续体","dur"],"es":["es","助动词","是、存在","ess"],"fac":["fac","助动词","使、让","fac"],"inc":["inc","助动词","开始体","inc"],"iter":["iter","助动词","重复体","iter"],"lic":["lic","助动词","可、允许","lic"],"ne":["ne","助动词","不、相反","neg"],"nec":["nec","助动词","必须","nec"],"per":["per","助动词","完成体","per"],"pot":["pot","助动词","能、可以","pot"],"se":["se","助动词","被、反身","se"],"vet":["vet","助动词","禁止","vet"],"vol":["vol","助动词","愿、要","vol"],"aude":["aude","判断词","前后同一则同一","aud"],"aut":["aut","判断词","包含或","aut"],"dis":["dis","判断词","互斥或","dis"],"dum":["dum","判断词","只要","dum"],"ergo":["ergo","判断词","所以","erg"],"exo":["exo","判断词","如果……那么应当……","exo"],"fas":["fas","判断词","许可、合法","fas"],"kaus":["kaus","判断词","因为","kau"],"keal":["keal","判断词","如果……","kea"],"keol":["keol","判断词","否则如果……","keo"],"kon":["kon","判断词","并且、合取","kon"],"nefas":["nefas","判断词","禁忌、不合法","nef"],"nisi":["nisi","判断词","除非","nis"],"quan":["quan","判断词","无论","qua"],"rase":["rase","判断词","有一真则为真","ras"],"re":["re","判断词","是否真或假","req"],"ske":["ske","判断词","反事实如果","ske"],"tam":["tam","判断词","当……时","tam"],"vero":["vero","判断词","确实、强调真","vro"],"priv":["priv","限定词","私有：只在**当前语块**内可见，出块即不可见","prv"],"tut":["tut","限定词","受护：**本语块及其子块**可见，外层不可见","tut"],"publ":["publ","限定词","公开：**整个术式**内可见，可跨块使用","pbl"],"consta":["consta","限定词","常数：**写入后不可再赋值**（沿用词根表「常数」的原形）","cns"],"has":["has","时间限定","在未来","has"],"iam":["iam","时间限定","已经","iam"],"mis":["mis","时间限定","现在","mis"],"mox":["mox","时间限定","即将","mox"],"nun":["nun","时间限定","从不","nun"],"post":["post","时间限定","之后","pos"],"pre":["pre","时间限定","之前","pre"],"ros":["ros","时间限定","在古代、过去","ros"],"sem":["sem","时间限定","总是","sem"],"simul":["simul","时间限定","同时","sim"],"ali":["ali","数量与范围限定","某个","ali"],"mult":["mult","数量与范围限定","多","mul"],"nul":["nul","数量与范围限定","无","nul"],"om":["om","数量与范围限定","全部、整体","omn"],"part":["part","数量与范围限定","部分","prt"],"pauc":["pauc","数量与范围限定","少","pau"],"selinge":["Selinge","数量与范围限定","唯一一个","sel"],"sol":["sol","数量与范围限定","仅、只","sol"],"tallse":["tallse","数量与范围限定","每一个、所有","tal"],"tot":["tot","数量与范围限定","整个","tot"],"alius":["alius","指称限定","另一个","als"],"hic":["hic","指称限定","这","hic"],"idem":["idem","指称限定","同一","ide"],"ille":["ille","指称限定","那","ill"],"ipse":["ipse","指称限定","自身","ips"],"quis":["quis","指称限定","哪个","qui"],"quot":["quot","指称限定","多少","quo"],"prim":["prim","顺序限定","第一、首先","pri"],"prior":["prior","顺序限定","前一个","pir"],"prox":["prox","顺序限定","下一个","prx"],"ultim":["ultim","顺序限定","最后","ult"],"magis":["magis","程度限定","更","mag"],"max":["max","程度限定","最","max"],"min":["min","程度限定","最不","min"],"minus":["minus","程度限定","更少、较不","mns"],"valde":["valde","程度限定","很、非常","val"],"mi":["mi","代词（人称）","我","mi"],"tu":["tu","代词（人称）","你","tu"],"il":["il","代词（人称）","他／她","il"],"id":["id","代词（人称）","它","id"],"nos":["nos","代词（人称）","我们","nos"],"vos":["vos","代词（人称）","你们（兼敬称）","vos"],"les":["les","代词（人称）","他们","les"],"tis":["tis","疑问词","谁","名词位"],"ti":["ti","疑问词","什么","名词位"],"poi":["poi","疑问词","哪个","修饰位"],"pu":["pu","疑问词","哪里","补语位"],"pote":["pote","疑问词","何时","限定层"],"dia":["dia","疑问词","为何","判断层"],"pos":["pos","疑问词","如何","方式层"],"poso":["poso","疑问词","多少","数量位"],"word":["word","量词","用于","abbr"],"kor":["kor","量词","有灵者（人／神／族）","KOR"],"kap":["kap","量词","走兽、龙","KAPA"],"pte":["pte","量词","飞禽","PTE"],"ikh":["ikh","量词","鱼、蛇、长条物","IKH"],"pho":["pho","量词","草木","PHO"],"rok":["rok","量词","块状硬物（石／金）","ROK"],"ker":["ker","量词","器物、工具","KER"],"graf":["graf","量词","扁平物（纸／布／板）","GRAF"],"vat":["vat","量词","容器与液体","VAT"],"mo":["mo","量词","食物一份","MO"],"top":["top","量词","地点","TOP"],"kair":["kair","量词","次数、事件","KAIR"],"verb":["verb","量词","言语、文字","VERb"],"aps":["aps","量词","抽象事物","APS"],"inse":["inse","量词","虫豸","INSE"],"ka":["ka","连接词与从句标记","陈述从句标记（that）——开","ka"],"ku":["ku","连接词与从句标记","关系从句标记（……的）——开","ku"],"ki":["ki","连接词与从句标记","从句闭合词——闭（后开先闭）","ki"],"eti":["eti","连接词与从句标记","和、与（并列名词）","ETI"],"limit":["limit","术式关键词","限制（准入条件）；作筛选键时是「取前几个」","limit"],"pretium":["pretium","术式关键词","代价（术式的付出）","pretium"],"solum":["solum","术式关键词","独立（不依赖施术者）","solum"],"hauri":["hauri","术式关键词","汲取（自行吸取周遭元素）","hauri"],"luss":["luss","术式关键词","锁入（能量）","luss"],"vita":["vita","术式关键词","寿命","VIT"],"memoria":["memoria","术式关键词","记忆","MEMo"],"sensus":["sensus","术式关键词","感官","SEN"],"voluntas":["voluntas","术式关键词","意志","VOL"],"anima":["anima","术式关键词","灵魂","ANI"],"vis":["vis","术式关键词","威力","VIS"],"diu":["diu","术式关键词","持续","diu"],"celer":["celer","术式关键词","迅捷","celer"],"metos":["metos","术式关键词","对象、目标（术式的目标项）","metos"],"ren":["ren","术式关键词","返回数字（术式输出）","—"],"rea":["rea","术式关键词","返回地址（术式输出）","—"],"kigrama":["kigrama","单位","千克（质量）","kig"],"pondus":["pondus","单位","重量（与质量相对）","pon"],"sands":["sands","单位","秒","san"],"minas":["minas","单位","分（钟）","min"],"hora":["hora","单位","小时","hor"],"dies":["dies","单位","日","die"],"annus":["annus","单位","年","ann"],"animarbo":["Animarbo","地名与势力名","全息魂灵之树","anim ＋ arbor"],"parasevictom":["Parasevictom","地理 · 神宫 · 货币专名","帕拉斯维登","区域"],"root":["root","根词","抽象义","abbr"],"ae":["ae","根词","上升、增强","AER"],"apo":["apo","根词","离、爆发、释放","APX"],"end":["end","根词","终点","END"],"ex":["ex","根词","外、转移、复制","EXS"],"frag":["frag","根词","破碎、断裂","FRG"],"grama":["grama","根词","量、重","GRA"],"ho":["ho","根词","家、聚、庇护","HOM"],"kipo":["kipo","根词","动、加速","KIP"],"loc":["loc","根词","地点、放置","LOC"],"loq":["loq","根词","说、语言","LOQ"],"lus":["lus","根词","击、阻、锁","LUS"],"mem":["mem","根词","记忆、心智","MEM"],"mort":["mort","根词","死、消亡","MOR"],"mov":["mov","根词","移动、推动","MOV"],"navi":["navi","根词","路径、引导","NVI"],"ose":["ose","根词","开始","OSE"],"pas":["pas","根词","场、立、停留","PAS"],"redi":["redi","根词","回、再、停","RED"],"san":["san","根词","治愈、修复","SAN"],"stru":["stru","根词","建造、结构","STR"],"vid":["vid","根词","看、见、观察","VID"],"viv":["viv","根词","生、活、生命","VIV"],"fraglus":["fraglus","复合词","破锁、破坏障碍","FGL"],"loqnavi":["loqnavi","复合词","命令、咒语引导","LQN"],"loczone":["loczone","复合词","定位区域","LCZ"],"memexpual":["memexpual","复合词","保存记忆","MEX"],"mortsiro":["mortsiro","复合词","死亡虚空","MRS"],"movpas":["movpas","复合词","移动场、传送站","MVP"],"sanaqua":["sanaqua","复合词","治愈之水、圣水","SNQ"],"struhopas":["struhopas","复合词","建造营地","STH"],"vidnavi":["vidnavi","复合词","观察路径","VDN"],"vivfliam":["vivfliam","复合词","生命之火","VVF"],"ven":["ven","高频补充词","来","VEN"],"iri":["iri","高频补充词","去、走","IRI"],"cap":["cap","高频补充词","拿、取","CAP"],"don":["don","高频补充词","给","DON"],"sci":["sci","高频补充词","知道","SCI"],"ege":["ege","高频补充词","需要","EGE"],"aux":["aux","高频补充词","帮助","AUX"],"prc":["prc","高频补充词","危险","PRC"],"pop":["pop","高频补充词","人民、人群","POP"],"pna":["pna","高频补充词","人、个体","PNA"],"res":["res","高频补充词","事物","RES"],"tem":["tem","高频补充词","时间","TEM"],"die":["die","高频补充词","日、白天","DIE"],"nox":["nox","高频补充词","夜","NOX"],"cib":["cib","高频补充词","食物","CIB"],"dom":["dom","高频补充词","家、住所","DOM"],"via":["via","高频补充词","路、道路","VIA"],"pue":["pue","高频补充词","孩子","PUE"],"prn":["prn","高频补充词","父母、亲代","PRN"],"ami":["ami","高频补充词","朋友","AMI"],"hos":["hos","高频补充词","敌人","HOS"],"rex":["rex","高频补充词","王","REX"],"deu":["deu","高频补充词","神","DEU"],"mgi":["mgi","高频补充词","魔法","MGI"],"tmp":["tmp","高频补充词","风暴","TMP"],"aqe":["aqe","高频补充词","洪水","AQE"],"plv":["plv","高频补充词","雨","PLV"],"flv":["flv","高频补充词","河","FLV"],"mar":["mar","高频补充词","海","MAR"],"mon":["mon","高频补充词","山","MON"],"sil":["sil","高频补充词","森林","SIL"],"urb":["urb","高频补充词","城市","URB"],"pag":["pag","高频补充词","村庄","PAG"],"edi":["edi","高频补充词","吃","EDI"],"bib":["bib","高频补充词","喝","BIB"],"dor":["dor","高频补充词","睡","DOR"],"cur":["cur","高频补充词","跑","CUR"],"amb":["amb","高频补充词","走、行走","AMB"],"vla":["vla","高频补充词","飞","VLA"],"nat":["nat","高频补充词","游泳","NAT"],"pug":["pug","高频补充词","战斗","PUG"],"nca":["nca","高频补充词","杀","NCA"],"ape":["ape","高频补充词","打开","APE"],"cld":["cld","高频补充词","关闭","CLD"],"adi":["adi","高频补充词","听","ADI"],"clv":["clv","高频补充词","钥匙","CLV"],"por":["por","高频补充词","门","POR"],"yes":["yes","高频补充词","是","Iy"],"no":["no","高频补充词","否","Ey"]},"keys":{"init":["init","筛选键","原点（另定基准，不改编发动位置）"],"intervall":["intervall","筛选键","距离范围，.. 表区间"],"mensura":["mensura","筛选键","长方体尺寸（三轴）"],"genus":["genus","筛选键","类别：族名、元素码、生物类；前加 ne 取反"],"nomen":["nomen","筛选键","具名者"],"sigil":["sigil","筛选键","带某标记／阵营者"],"ratio":["ratio","筛选键","按**量值范围**筛（威力、精度等的量值）"],"versus":["versus","筛选键","按朝向筛（俯仰／水平）"],"ordin":["ordin","筛选键","排序：proxim 近／procul 远／temer 随机"],"limit":["limit","筛选键","取前几个"]},"units":{"mu":["MU","能量单位","魔力（能量）；写它即为锁存（触发式术式）"],"eu":["EU","能量单位","元素吞吐（能量）；写它即为锁存（触发式术式）"],"muw":["MUW","能量单位","魔力功率；功率口径，不得配 luss（持续发动）"],"euw":["EUW","能量单位","元素吞吐功率；功率口径，不得配 luss（持续发动）"],"miteas":["miteas","长度","米"],"passus":["passus","长度（旧制）","步"],"digitus":["digitus","长度（旧制）","指宽"],"cubitus":["cubitus","长度（旧制）","肘"],"kigrama":["kigrama","质量","千克"],"sands":["sands","时间","秒"],"minas":["minas","时间","分"],"hora":["hora","时间","时"],"dies":["dies","时间","日"],"annus":["annus","时间","年"]},"ranks":{"4":"θ · 客观时间（第四维度）","5":"b · 客观平行时间（第五维度）","6":"p_b · 存在性概率（第六维度）","7":"t_abs · 绝对客观时间（第七维度）","8":"λ · 时间流速率（第八维度）","9":"s · 所在宇宙空间（第九维度）","1–3":"x, y, z · 三维空间元组（第三维度，占 3 秩）"},"roots":{"est":["存在、是","动","est"],"ent":["存在者、实体","动","ent"],"hom":["人、个体","动","hom"],"ver":["真实、确实","动","ver"],"fal":["虚假、错误","动","fal"],"un":["单一、一","动","un"],"div":["分开、区分","动","div"],"iun":["连接、结合","动","iun"],"mut":["改变、转化","动","mut"],"man":["保持、持续","动","man"],"fin":["界限、边界","动","fin"],"nov":["新、崭新","动","nov"],"pris":["旧、古老","动","pris"],"hyl":["物质、材料","物","hyl"],"cosm":["秩序、宇宙","物","cosm"],"cha":["混沌、无序","物","cha"],"arc":["起源、本原","物","arc"],"tel":["目的、趋向","物","tel"],"dyn":["力、能量","物","dyn"],"oper":["操作","物","oper"],"sper":["种子、根本","物","sper"],"lab":["辛劳","物","lab"],"fund":["基础、底","物","fund"],"ter":["大地、陆地","物","ter"],"val":["谷地","物","val"],"camp":["平原、原野","物","camp"],"insul":["岛","物","insul"],"lit":["岸、边","物","lit"],"nem":["林、树丛","物","nem"],"vast":["荒芜、空旷","物","vast"],"glac":["冰","物","glac"],"niv":["雪","物","niv"],"nebul":["雾、云","物","nebul"],"heli":["太阳","物","heli"],"lun":["月亮","物","lun"],"stel":["星","物","stel"],"cael":["天空","物","cael"],"abys":["深渊","物","abys"],"fluv":["河流","物","fluv"],"und":["波浪","物","und"],"lim":["泥、沼泽","物","lim"],"font":["泉","物","font"],"lac":["湖、池","物","lac"],"gur":["漩涡","物","gur"],"sal":["盐","物","sal"],"riv":["溪流","物","riv"],"ror":["露水、滴","物","ror"],"ign":["火、燃烧","物","ign"],"ard":["炽热、灼烧","物","ard"],"lux":["光亮、照明","物","lux"],"umb":["影、阴影","物","umb"],"fum":["烟","物","fum"],"cin":["灰烬","物","cin"],"lamp":["灯、明火","物","lamp"],"cal":["热、暖","物","cal"],"frig":["冷","物","frig"],"gel":["霜、冻结","物","gel"],"aur":["空气、气息","物","aur"],"ton":["雷","物","ton"],"fulg":["闪电","物","fulg"],"nim":["雨云","物","nim"],"tempes":["风暴","物","tempes"],"pluv":["雨","物","pluv"],"hum":["湿、潮","物","hum"],"sic":["干燥","物","sic"],"turb":["搅动、涡旋","物","turb"],"ser":["晴朗","物","ser"],"brum":["冬","物","brum"],"vern":["春","物","vern"],"aest":["夏","物","aest"],"mes":["收获、秋","物","mes"],"anth":["花","物","anth"],"rad":["根","物","rad"],"fol":["叶","物","fol"],"lign":["木、木材","物","lign"],"herb":["草","物","herb"],"spin":["荆棘刺","物","spin"],"fung":["菌","物","fung"],"cres":["生长","动","cres"],"al":["养育","动","al"],"suc":["汁液","物","suc"],"arbor":["树","物","arbor"],"frut":["灌木","物","frut"],"ram":["枝","物","ram"],"trunc":["树干","物","trunc"],"cort":["树皮","物","cort"],"germ":["胚芽","物","germ"],"silv":["森林","物","silv"],"prat":["草地","物","prat"],"rhod":["玫瑰","物","rhod"],"lili":["百合","物","lili"],"viol":["紫罗兰","物","viol"],"narc":["水仙","物","narc"],"hyac":["风信子","物","hyac"],"myrt":["桃金娘","物","myrt"],"laur":["月桂","物","laur"],"querc":["橡","物","querc"],"pin":["松","物","pin"],"abi":["杉","物","abi"],"betul":["桦","物","betul"],"salic":["柳","物","salic"],"tili":["椴","物","tili"],"ulm":["榆","物","ulm"],"frax":["梣","物","frax"],"acer":["枫","物","acer"],"fag":["山毛榉","物","fag"],"ilic":["冬青","物","ilic"],"heder":["常春藤","物","heder"],"viti":["葡萄藤","物","viti"],"musc":["苔","物","musc"],"filic":["蕨","物","filic"],"alg":["藻","物","alg"],"bolet":["菇","物","bolet"],"ther":["野兽","物","ther"],"fer":["野兽","物","fer"],"belu":["巨兽","物","belu"],"besti":["牲畜","物","besti"],"orni":["鸟、禽","物","orni"],"pisc":["鱼","物","pisc"],"verm":["虫","物","verm"],"inse":["昆虫","物","inse"],"serp":["蛇","物","serp"],"bufo":["蟾蜍","物","bufo"],"verr":["公猪","物","verr"],"hirc":["公羊","物","hirc"],"lynx":["猞猁","物","lynx"],"myrm":["蚁","物","myrm"],"ap":["蜂","物","ap"],"papi":["蝶","物","papi"],"cicad":["蝉","物","cicad"],"locu":["蝗","物","locu"],"aran":["蛛","物","aran"],"cochl":["螺","物","cochl"],"polyp":["章鱼","物","polyp"],"cet":["鲸","物","cet"],"mustel":["鼬","物","mustel"],"lup":["狼","物","lup"],"vulp":["狐","物","vulp"],"urs":["熊","物","urs"],"cerv":["鹿","物","cerv"],"lep":["兔","物","lep"],"mys":["鼠","物","mys"],"feli":["猫","物","feli"],"can":["犬","物","can"],"equi":["马","物","equi"],"tau":["牛","物","tau"],"corp":["身体","物","corp"],"ceph":["头","物","ceph"],"vult":["面容","物","vult"],"ocu":["眼","物","ocu"],"oto":["耳","物","oto"],"manu":["手","物","manu"],"ped":["足","物","ped"],"dent":["齿","物","dent"],"ling":["舌","物","ling"],"sanguin":["血","物","sanguin"],"carn":["肉","物","carn"],"oss":["骨","物","oss"],"pell":["皮","物","pell"],"nerv":["神经、筋","物","nerv"],"visc":["内脏","物","visc"],"spir":["呼吸、气息","物","spir"],"cord":["心","物","cord"],"sta":["立、站","动","sta"],"desc":["下降","动","desc"],"flect":["屈曲","动","flect"],"torqu":["扭转","动","torqu"],"pand":["展开","动","pand"],"string":["勒紧","动","string"],"puls":["推撞","动","puls"],"trud":["推挤","动","trud"],"trah":["拉、拖","动","trah"],"scand":["攀爬","动","scand"],"laps":["滑落","动","laps"],"still":["滴落","动","still"],"anhel":["喘息","动","anhel"],"oscit":["呵欠","动","oscit"],"sug":["吮吸","动","sug"],"glut":["吞咽","动","glut"],"vom":["呕吐","动","vom"],"ming":["排尿","动","ming"],"sternu":["喷嚏","动","sternu"],"plaud":["拍手","动","plaud"],"quat":["摇动","动","quat"],"palp":["轻抚","动","palp"],"pung":["刺扎","动","pung"],"ungu":["爪","动","ungu"],"nict":["眨眼","动","nict"],"sput":["吐唾","动","sput"],"frend":["切齿","动","frend"],"hiat":["张口","动","hiat"],"trem":["颤抖","动","trem"],"nix":["倚靠","动","nix"],"sid":["沉降","动","sid"],"vag":["游荡","动","vag"],"nas":["出生","动","nas"],"sen":["衰老","动","sen"],"rob":["强壮","动","rob"],"nutr":["滋养","动","nutr"],"somn":["睡眠、梦","动","somn"],"dol":["疼痛","动","dol"],"vuln":["伤、创","动","vuln"],"vig":["警醒、活力","动","vig"],"quiet":["安宁、静止","动","quiet"],"matur":["成熟","动","matur"],"med":["医","动","med"],"pharm":["药","动","pharm"],"remed":["疗法","动","remed"],"cura":["照护","动","cura"],"aegr":["病","动","aegr"],"morb":["疾病","动","morb"],"febr":["发热","动","febr"],"tuss":["咳","动","tuss"],"pest":["瘟疫","动","pest"],"venen":["毒","动","venen"],"anti":["解药","动","anti"],"chir":["外科","动","chir"],"phleg":["痰、体液","动","phleg"],"bil":["胆","动","bil"],"ulc":["溃疡","动","ulc"],"tum":["肿","动","tum"],"frac":["折、碎","动","frac"],"cica":["疤","动","cica"],"purg":["清泻","动","purg"],"lav":["洗","动","lav"],"cont":["传染","动","cont"],"vale":["健康","动","vale"],"obst":["助产","动","obst"],"emplast":["膏药","动","emplast"],"theriac":["万灵药","动","theriac"],"sanit":["卫生","动","sanit"],"coqu":["烹、煮","物","coqu"],"ass":["烤、炙","物","ass"],"frix":["煎、炸","物","frix"],"ferv":["煮沸","物","ferv"],"ferm":["发酵","物","ferm"],"cond":["调味","物","cond"],"dulc":["甜","物","dulc"],"acid":["酸","物","acid"],"amar":["苦","物","amar"],"sals":["咸","物","sals"],"acr":["辛辣","物","acr"],"arom":["香气","物","arom"],"putr":["腐坏","物","putr"],"gran":["谷粒","物","gran"],"tritic":["麦","物","tritic"],"oryz":["稻、米","物","oryz"],"pan":["面包","物","pan"],"ov":["蛋","物","ov"],"lact":["奶","物","lact"],"ole":["油","物","ole"],"sucr":["糖","物","sucr"],"mel":["蜜","物","mel"],"fruct":["果","物","fruct"],"oler":["蔬菜","物","oler"],"jus":["汤汁","物","jus"],"oen":["酒","物","oen"],"thea":["茶","物","thea"],"far":["面粉、糊","物","far"],"coen":["餐、宴","物","coen"],"culin":["厨艺","物","culin"],"fam":["饥饿","物","fam"],"sat":["饱足","物","sat"],"siti":["渴","物","siti"],"vor":["吞食","物","vor"],"mand":["咀嚼","物","mand"],"mord":["咬","物","mord"],"lict":["舔","物","lict"],"vest":["衣、着装","物","vest"],"tunic":["束腰衣","物","tunic"],"toga":["长袍","物","toga"],"pall":["披风","物","pall"],"calce":["鞋","物","calce"],"petas":["帽","物","petas"],"cinct":["腰带","物","cinct"],"fib":["扣、别针","物","fib"],"acu":["针","物","acu"],"stam":["线","物","stam"],"pann":["布","物","pann"],"seric":["丝","物","seric"],"lan":["羊毛","物","lan"],"sut":["缝","物","sut"],"nect":["编织","物","nect"],"solea":["鞋底","物","solea"],"monil":["项链","物","monil"],"anul":["戒指","物","anul"],"coron":["冠冕","物","coron"],"ung":["涂油、膏","物","ung"],"fuc":["妆饰","物","fuc"],"specul":["镜","物","specul"],"redim":["头巾","物","redim"],"armill":["臂环","物","armill"],"inaur":["耳饰","物","inaur"],"cas":["屋舍","物","cas"],"tect":["屋顶","物","tect"],"pariet":["墙","物","pariet"],"mur":["墙垣","物","mur"],"fen":["窗","物","fen"],"limen":["门槛","物","limen"],"pav":["铺地","物","pav"],"later":["砖","物","later"],"caem":["石料","物","caem"],"sax":["岩石","物","sax"],"petr":["岩块","物","petr"],"marm":["大理石","物","marm"],"teg":["瓦","物","teg"],"aed":["建筑","物","aed"],"turr":["塔","物","turr"],"arx":["堡垒","物","arx"],"castr":["营垒","物","castr"],"moen":["城墙","物","moen"],"atr":["中庭","物","atr"],"cell":["房间、室","物","cell"],"cub":["卧、躺","物","cub"],"sell":["座椅","物","sell"],"tabl":["桌、板","物","tabl"],"sed":["坐","物","sed"],"foc":["炉灶、中心","物","foc"],"baln":["浴","物","baln"],"sera":["门闩","物","sera"],"cand":["烛、白炽","物","cand"],"scal":["梯","物","scal"],"portic":["柱廊","物","portic"],"fornic":["拱","物","fornic"],"ferr":["铁","物","ferr"],"cupr":["铜","物","cupr"],"argent":["银","物","argent"],"chrys":["金","物","chrys"],"plumb":["铅","物","plumb"],"stann":["锡","物","stann"],"vitr":["玻璃","物","vitr"],"malle":["锤","物","malle"],"secur":["斧","物","secur"],"cultr":["刀","物","cultr"],"glad":["剑","物","glad"],"scut":["盾","物","scut"],"tox":["弓","物","tox"],"sag":["箭","物","sag"],"iac":["投矛器","物","iac"],"ret":["网","物","ret"],"laqu":["套索","物","laqu"],"ham":["钩","物","ham"],"serr":["锯","物","serr"],"tereb":["钻","物","tereb"],"vect":["杠杆","物","vect"],"troch":["滑轮","物","troch"],"ax":["轴","物","ax"],"cune":["楔","物","cune"],"vincl":["束缚","物","vincl"],"caten":["链","物","caten"],"fun":["绳","物","fun"],"cribr":["筛","物","cribr"],"pistill":["杵","物","pistill"],"forn":["炉","物","forn"],"vas":["容器","物","vas"],"amph":["瓮、罐","物","amph"],"cophin":["提篮","物","cophin"],"sacc":["袋","物","sacc"],"lapid":["石料","物","lapid"],"aren":["沙","物","aren"],"cret":["白垩","物","cret"],"gyps":["石膏","物","gyps"],"calc":["石灰","物","calc"],"bitu":["沥青","物","bitu"],"resi":["树脂","物","resi"],"seb":["脂","物","seb"],"adip":["脂肪","物","adip"],"cori":["皮革","物","cori"],"byss":["棉","物","byss"],"cann":["麻","物","cann"],"papyr":["纸草","物","papyr"],"membr":["膜","物","membr"],"plum":["羽毛","物","plum"],"testa":["壳","物","testa"],"corn":["兽角","物","corn"],"ebur":["象牙","物","ebur"],"margar":["珍珠","物","margar"],"gemm":["宝石","物","gemm"],"cryst":["水晶","物","cryst"],"adam":["金刚","物","adam"],"silic":["硅石","物","silic"],"argill":["陶土","物","argill"],"lut":["泥浆","物","lut"],"glutin":["胶","物","glutin"],"agr":["田地","物","agr"],"arv":["耕地","物","arv"],"sulc":["犁沟","物","sulc"],"arat":["犁","物","arat"],"seget":["作物","物","seget"],"frum":["谷物","物","frum"],"vine":["葡萄园","物","vine"],"oliv":["橄榄","物","oliv"],"pom":["果树","物","pom"],"pasc":["放牧","动","pasc"],"greg":["畜群","物","greg"],"armen":["牛群","物","armen"],"ovil":["羊圈","物","ovil"],"capr":["山羊","物","capr"],"porc":["猪","物","porc"],"gall":["鸡","物","gall"],"anat":["鸭","物","anat"],"anser":["鹅","物","anser"],"colum":["鸽","物","colum"],"ar":["耕","动","ar"],"ster":["粪肥","物","ster"],"riga":["灌溉","动","riga"],"foss":["沟渠","物","foss"],"sep":["篱、围","物","sep"],"saept":["围栏","物","saept"],"horre":["谷仓","物","horre"],"vill":["庄园","物","vill"],"colon":["农人、垦殖","物","colon"],"rust":["乡野","物","rust"],"carin":["龙骨、船","物","carin"],"rem":["桨","物","rem"],"sip":["帆","物","sip"],"guber":["舵","物","guber"],"ancor":["锚","物","ancor"],"itin":["旅程","物","itin"],"curr":["车、奔驰","物","curr"],"raed":["马车","物","raed"],"carr":["货车","物","carr"],"big":["双驾","物","big"],"hipp":["马","物","hipp"],"asin":["驴","物","asin"],"pass":["步、通行","物","pass"],"ambul":["行走","物","ambul"],"celer":["迅捷","物","celer"],"tran":["穿过","物","tran"],"fret":["海峡","物","fret"],"pont":["桥","物","pont"],"nav":["舟、航行","物","nav"],"ratis":["筏","物","ratis"],"phasel":["小舟","物","phasel"],"lintr":["小艇","物","lintr"],"statio":["驿站","物","statio"],"viat":["旅人","物","viat"],"aud":["听","动","aud"],"tact":["触、摸","动","tact"],"olf":["嗅","动","olf"],"gust":["尝、味觉","动","gust"],"cog":["思、思考","动","cog"],"rat":["推理","动","rat"],"noe":["心智、理性","动","noe"],"cred":["相信","动","cred"],"dub":["怀疑","动","dub"],"opin":["看法、意见","动","opin"],"not":["标记、注意","动","not"],"sig":["符号、记号","动","sig"],"int":["理解","动","int"],"imag":["想象","动","imag"],"mir":["惊奇","动","mir"],"err":["错误、迷误","动","err"],"verb":["词、言辞","动","verb"],"nom":["名、名称","动","nom"],"scrib":["书写","动","scrib"],"leg":["读、收集","动","leg"],"dix":["说、命令","动","dix"],"clam":["呼喊","动","clam"],"silen":["沉默","动","silen"],"rog":["询问","动","rog"],"nunt":["消息、通报","动","nunt"],"test":["证明、见证","动","test"],"fid":["信任、信义","动","fid"],"text":["文本、织体","动","text"],"scho":["学校","物","scho"],"disc":["学生","物","disc"],"doc":["教","物","doc"],"doct":["学问、教义","物","doct"],"stud":["勤学","物","stud"],"lect":["诵读","物","lect"],"bibl":["书","物","bibl"],"chart":["纸、契","物","chart"],"pagin":["页","物","pagin"],"dial":["方言","物","dial"],"rhet":["修辞","物","rhet"],"log":["逻辑、理","物","log"],"math":["学、数学","物","math"],"geom":["几何","物","geom"],"arith":["算术","物","arith"],"harm":["和谐、乐","物","harm"],"chem":["炼化","物","chem"],"astr":["星辰、天学","物","astr"],"soph":["智慧","物","soph"],"eru":["博学","物","eru"],"exam":["考查","物","exam"],"stil":["笔","物","stil"],"atram":["墨","物","atram"],"cera":["蜡","物","cera"],"pupill":["学童","物","pupill"],"didas":["讲授","物","didas"],"thes":["论题","物","thes"],"quaes":["问题","物","quaes"],"solut":["解答","物","solut"],"probl":["难题","物","probl"],"du":["二","数","du"],"tri":["三","数","tri"],"quadr":["四","数","quadr"],"quinq":["五","数","quinq"],"sex":["六","数","sex"],"sept":["七","数","sept"],"oct":["八","数","oct"],"enne":["九","数","enne"],"dec":["十","数","dec"],"hecat":["百","数","hecat"],"mill":["千","数","mill"],"myri":["万","数","myri"],"summ":["和、总","数","summ"],"integ":["完整、整","数","integ"],"angul":["角形","数","angul"],"spha":["球体","数","spha"],"punct":["点","数","punct"],"solid":["立体","数","solid"],"nih":["无、零","数","nih"],"poten":["幂、能","数","poten"],"ordin":["次序","数","ordin"],"class":["类别","数","class"],"seri":["序列","数","seri"],"crit":["标准","数","crit"],"meta":["界标","数","meta"],"indic":["指标","数","indic"],"neg":["否、负","数","neg"],"posit":["正、置","数","posit"],"figur":["形状","数","figur"],"litr":["升","物","litr"],"pond":["重量","物","pond"],"stadi":["距离单位","物","stadi"],"milli":["千步","物","milli"],"iuge":["土地单位","物","iuge"],"modi":["容量单位","物","modi"],"libr":["重单位","物","libr"],"unci":["小单位","物","unci"],"digit":["指宽","物","digit"],"palm":["掌宽","物","palm"],"cubit":["肘尺","物","cubit"],"veloc":["速度","物","veloc"],"therm":["热温","物","therm"],"bar":["压强","物","bar"],"portio":["份额","物","portio"],"spiss":["浓稠","物","spiss"],"tenu":["稀薄","物","tenu"],"purit":["纯度","物","purit"],"modul":["模数","物","modul"],"dim":["维度","物","dim"],"spat":["空间量","物","spat"],"capac":["容量","物","capac"],"volum":["体积","物","volum"],"area":["面积","物","area"],"num":["数","性","num"],"met":["测量","性","met"],"par":["成对、同等","性","par"],"plus":["加、多","性","plus"],"minu":["减、少","性","minu"],"magn":["大","性","magn"],"parv":["小","性","parv"],"tant":["如此多","性","tant"],"plat":["宽、平","性","plat"],"bath":["深","性","bath"],"alt":["高","性","alt"],"brev":["短","性","brev"],"grav":["重","性","grav"],"lev":["轻","性","lev"],"dens":["密","性","dens"],"rar":["稀","性","rar"],"equ":["相等、均衡","性","equ"],"rela":["关系","性","rela"],"iden":["同一","性","iden"],"oppo":["对立","性","oppo"],"contr":["相反","性","contr"],"maio":["较大","性","maio"],"analo":["比例、类比","性","analo"],"symb":["象征","性","symb"],"typ":["类型","性","typ"],"exem":["例子","性","exem"],"parti":["划分","性","parti"],"multi":["多倍","性","multi"],"recip":["相互","性","recip"],"mutu":["交互","性","mutu"],"conseq":["推论","性","conseq"],"antece":["前件","性","antece"],"conclu":["结论","性","conclu"],"hypoth":["假设","性","hypoth"],"theor":["理论","性","theor"],"meth":["方法","性","meth"],"princ":["原理","性","princ"],"eleme":["要素","性","eleme"],"categ":["范畴","性","categ"],"essen":["本质","性","essen"],"propr":["固有","性","propr"],"accid":["偶性","性","accid"],"grada":["渐变","性","grada"],"syst":["体系","性","syst"],"ait":["原因","性","ait"],"dif":["差异","性","dif"],"sim":["相似","性","sim"],"qual":["性质、质","性","qual"],"quant":["量、多少","性","quant"],"sens":["意义、感觉","性","sens"],"spec":["种、类","性","spec"],"eff":["结果","性","eff"],"medi":["中间","性","medi"],"extr":["极端","性","extr"],"stat":["状态","动","stat"],"conve":["转变","动","conve"],"stab":["稳定","动","stab"],"fluc":["波动","动","fluc"],"vac":["摇摆","动","vac"],"ruin":["崩毁","动","ruin"],"salus":["安全","动","salus"],"discr":["危境","动","discr"],"primo":["起初","动","primo"],"inte":["毁灭","动","inte"],"solit":["孤独","动","solit"],"plen":["充满","动","plen"],"inan":["空虚","动","inan"],"perma":["持久","动","perma"],"tempo":["暂时","动","tempo"],"perpet":["永续","动","perpet"],"decad":["衰败","动","decad"],"renov":["更新","动","renov"],"restaur":["恢复","动","restaur"],"conserv":["保存","动","conserv"],"destru":["破坏","动","destru"],"corru":["腐化","动","corru"],"flux":["流变","动","flux"],"equil":["平衡","动","equil"],"tens":["拉紧","动","tens"],"press":["压力","动","press"],"motiv":["动因","动","motiv"],"impul":["冲动","动","impul"],"tende":["趋向","动","tende"],"liqu":["液化","动","liqu"],"fus":["熔","动","fus"],"coag":["凝固","动","coag"],"disso":["分解","动","disso"],"combi":["化合","动","combi"],"reac":["反应","动","reac"],"catal":["催化","动","catal"],"alka":["碱","动","alka"],"oxyd":["氧化","动","oxyd"],"disti":["蒸馏","动","disti"],"subl":["升华","动","subl"],"ust":["煅烧","动","ust"],"mixt":["混合","动","mixt"],"filt":["过滤","动","filt"],"precip":["沉淀","动","precip"],"satu":["饱和","动","satu"],"dilu":["稀释","动","dilu"],"effe":["起泡","动","effe"],"evap":["蒸发","动","evap"],"corrod":["腐蚀","动","corrod"],"art":["艺术","物","art"],"pict":["绘画","物","pict"],"melo":["旋律","物","melo"],"cant":["歌唱","物","cant"],"chor":["歌舞","物","chor"],"lyr":["琴","物","lyr"],"tib":["笛","物","tib"],"tub":["号角","物","tub"],"tymp":["鼓","物","tymp"],"theat":["剧场","物","theat"],"scae":["舞台","物","scae"],"lud":["游戏、戏","物","lud"],"alea":["赌博","物","alea"],"ioc":["玩笑","物","ioc"],"rid":["笑","物","rid"],"plor":["哭","物","plor"],"fest":["节庆","物","fest"],"pulch":["美","物","pulch"],"venus":["优雅","物","venus"],"musiv":["镶嵌","物","musiv"],"pocul":["杯","物","pocul"],"convi":["宴饮","物","convi"],"spect":["观看、演出","物","spect"],"tripud":["踏舞","物","tripud"],"histri":["演员","物","histri"],"od":["恨","动","od"],"tim":["恐惧","动","tim"],"ira":["怒","动","ira"],"gau":["喜悦","动","gau"],"tris":["悲伤","动","tris"],"cup":["欲望","动","cup"],"spes":["希望","动","spes"],"pud":["羞耻","动","pud"],"pax":["和平","动","pax"],"grat":["感激","动","grat"],"aem":["嫉妒","动","aem"],"mulc":["抚慰","动","mulc"],"volun":["意志","性","volun"],"inge":["天性","性","inge"],"indo":["性情","性","indo"],"mos":["习俗","性","mos"],"auda":["大胆","性","auda"],"timid":["怯懦","性","timid"],"clem":["仁慈","性","clem"],"seve":["严厉","性","seve"],"beni":["和善","性","beni"],"mali":["恶毒","性","mali"],"sinc":["真诚","性","sinc"],"fall":["欺诈","性","fall"],"perf":["背信","性","perf"],"const":["坚定","性","const"],"pert":["固执","性","pert"],"prud":["谨慎","性","prud"],"teme":["鲁莽","性","teme"],"mode":["谦逊","性","mode"],"humil":["谦卑","性","humil"],"arro":["傲慢","性","arro"],"invi":["妒忌","性","invi"],"avar":["贪婪","性","avar"],"simp":["单纯","性","simp"],"call":["狡黠","性","call"],"stul":["愚笨","性","stul"],"insa":["疯狂","性","insa"],"melan":["忧郁","性","melan"],"soler":["机敏","性","soler"],"saga":["睿智","性","saga"],"irac":["易怒","性","irac"],"plac":["温和","性","plac"],"gen":["族群、生育","物","gen"],"patr":["父","物","patr"],"mater":["母","物","mater"],"fil":["子、儿女","物","fil"],"sor":["姐妹","物","sor"],"frat":["兄弟","物","frat"],"soc":["同伴、社群","物","soc"],"civ":["公民、民","物","civ"],"serv":["服侍、仆","物","serv"],"lib":["自由","物","lib"],"lex":["成文法","物","lex"],"iur":["权利、法权","物","iur"],"vic":["邻、交替","物","vic"],"host":["敌人、外人","物","host"],"nob":["显贵","物","nob"],"pleb":["平民","物","pleb"],"amic":["友爱","动","amic"],"hospit":["宾客","动","hospit"],"nupt":["婚","动","nupt"],"coni":["配偶","动","coni"],"avu":["祖父","动","avu"],"nepot":["孙辈","动","nepot"],"cogn":["亲族","动","cogn"],"gent":["氏族","动","gent"],"inim":["仇怨","动","inim"],"offe":["冒犯","动","offe"],"venia":["宽恕","动","venia"],"bland":["谄媚","动","bland"],"adul":["奉承","动","adul"],"vitu":["斥骂","动","vitu"],"bened":["祝福","动","bened"],"salut":["问候","动","salut"],"valed":["告别","动","valed"],"oscul":["吻","动","oscul"],"ampl":["拥抱","动","ampl"],"patro":["庇护","动","patro"],"soda":["同伴","动","soda"],"socie":["社团","动","socie"],"hila":["欢欣","动","hila"],"iurg":["争吵","动","iurg"],"rix":["争斗","动","rix"],"gratu":["祝贺","动","gratu"],"condo":["致哀","动","condo"],"pub":["公众","物","pub"],"polis":["城邦","物","polis"],"reg":["王、统治","物","reg"],"sena":["元老院","物","sena"],"cons":["执政官","物","cons"],"dict":["独裁","物","dict"],"jud":["审判","物","jud"],"caus":["诉讼","物","caus"],"poen":["惩罚","物","poen"],"crim":["罪","物","crim"],"reus":["被告","物","reus"],"vind":["复仇","物","vind"],"pact":["契约","物","pact"],"foed":["盟约","物","foed"],"lega":["使节","物","lega"],"comit":["集会","物","comit"],"suffr":["投票","物","suffr"],"cens":["监察","物","cens"],"prov":["行省","物","prov"],"muni":["自治市","物","muni"],"client":["门客","物","client"],"popul":["民众","物","popul"],"decr":["法令","物","decr"],"edict":["告示","物","edict"],"civit":["公民权","物","civit"],"aedil":["营造官","物","aedil"],"praet":["裁判官","物","praet"],"bel":["战争","动","bel"],"arm":["武器、装备","动","arm"],"cid":["杀、斩","动","cid"],"noc":["伤害","动","noc"],"peric":["危险","动","peric"],"def":["防御","动","def"],"vin":["胜利、征服","动","vin"],"obs":["围困、封锁","动","obs"],"imp":["统治、命令","动","imp"],"mina":["威胁","动","mina"],"fug":["逃遁","动","fug"],"luct":["搏斗","动","luct"],"mach":["谋略、机巧","动","mach"],"truc":["凶猛、残暴","动","truc"],"mil":["兵、军","动","mil"],"coh":["大队","动","coh"],"dux":["统帅","动","dux"],"vexill":["军旗","动","vexill"],"hast":["长矛","动","hast"],"pil":["投枪","动","pil"],"ball":["弩炮","动","ball"],"catap":["投石机","动","catap"],"loric":["甲胄","动","loric"],"cass":["头盔","动","cass"],"vall":["壁垒","动","vall"],"opp":["攻城","动","opp"],"incu":["突袭","动","incu"],"praed":["劫掠","动","praed"],"clad":["惨败","动","clad"],"trium":["凯旋","动","trium"],"stip":["军饷","动","stip"],"deser":["叛逃","动","deser"],"prod":["背叛","动","prod"],"insid":["埋伏","动","insid"],"expl":["侦察","动","expl"],"praesid":["驻军","动","praesid"],"turma":["骑兵队","动","turma"],"centuri":["百人队","动","centuri"],"pecu":["钱财","动","pecu"],"mer":["商品、贸易","动","mer"],"pret":["价格","动","pret"],"vend":["出售","动","vend"],"empt":["购买","动","empt"],"lucr":["获利","动","lucr"],"dam":["损失","动","dam"],"debt":["债务","动","debt"],"fisc":["财库、公库","动","fisc"],"trib":["税、贡","动","trib"],"divin":["神性、占卜","物","divin"],"templ":["神庙","物","templ"],"ara":["祭坛","物","ara"],"vict":["祭品","物","vict"],"hosti":["祭牲","物","hosti"],"piet":["虔敬","物","piet"],"cult":["崇拜","物","cult"],"prec":["祈祷","物","prec"],"vot":["誓愿","物","vot"],"hymn":["颂歌","物","hymn"],"aug":["占兆","物","aug"],"omen":["征兆","物","omen"],"fat":["命运","物","fat"],"sort":["命运、机运","物","sort"],"anim":["灵魂、心","物","anim"],"sanc":["神圣","物","sanc"],"numi":["神意","物","numi"],"manes":["亡灵","物","manes"],"lemur":["幽魂","物","lemur"],"necr":["亡者术","物","necr"],"orac":["神谕","物","orac"],"vat":["先知","物","vat"],"proph":["先知预言","物","proph"],"superst":["迷信","物","superst"],"pagan":["异教","物","pagan"],"super":["上、超越","物","super"],"inf":["下、下方","物","inf"],"ant":["前、先前","物","ant"],"retr":["后、向后","物","retr"],"dext":["右","物","dext"],"sin":["左","物","sin"],"circ":["周围、环","物","circ"],"cent":["中心","物","cent"],"lat":["侧、旁","物","lat"],"lon":["远、长","物","lon"],"prop":["近、邻近","物","prop"],"ult":["越、彼端","物","ult"],"vers":["转、朝向","物","vers"],"grad":["步、级","物","grad"],"cron":["时间、时序","物","cron"],"ann":["年","物","ann"],"mens":["月","物","mens"],"hor":["时、时辰","物","hor"],"tard":["迟、缓","物","tard"],"cit":["速、急","物","cit"],"aev":["永世、时代","物","aev"],"init":["开始、起初","物","init"],"mom":["片刻","物","mom"],"diu":["久、长久","物","diu"],"rec":["近来、新鲜","物","rec"],"era":["纪元、时期","物","era"],"pet":["趋向、追求","动","pet"],"salt":["跳跃","动","salt"],"cad":["坠落","动","cad"],"asc":["上升","动","asc"],"sequ":["跟随","动","sequ"],"mit":["送、派遣","动","mit"],"duc":["引导、带领","动","duc"],"veh":["运送","动","veh"],"port":["携带","动","port"],"volat":["飞行","动","volat"],"meat":["穿行、经过","动","meat"],"red":["返回","动","red"],"ten":["持、握","动","ten"],"rap":["夺取、抓","动","rap"],"toll":["举起","动","toll"],"prem":["压、按","动","prem"],"sec":["切、割","动","sec"],"trit":["磨、碾","动","trit"],"lig":["绑、系","动","lig"],"solv":["解、松开","动","solv"],"claud":["关闭","动","claud"],"aper":["打开","动","aper"],"fric":["摩擦","动","fric"],"plic":["折叠","动","plic"],"tend":["伸展","动","tend"],"fabr":["制作","动","fabr"],"form":["塑造、形","动","form"],"orn":["装饰","动","orn"],"ping":["绘、画","动","ping"],"sculp":["雕刻","动","sculp"],"mod":["度量、样式","动","mod"],"norm":["规范、矩","动","norm"],"lin":["线、绳","动","lin"],"rot":["轮、转","动","rot"],"clav":["钉、键","动","clav"],"ianu":["门、出入口","动","ianu"],"col":["颜色","性","col"],"alb":["白","性","alb"],"nigr":["黑","性","nigr"],"rub":["红","性","rub"],"vir":["绿","性","vir"],"caer":["蓝","性","caer"],"flav":["黄","性","flav"],"purp":["紫","性","purp"],"son":["声音","性","son"],"odor":["气味","性","odor"],"sap":["味道","性","sap"],"glab":["光滑","性","glab"],"asp":["粗糙","性","asp"],"rig":["僵硬","性","rig"],"moll":["柔软","性","moll"],"mag":["魔法、术","动","mag"],"carm":["咒词","动","carm"],"sigil":["印记、符","动","sigil"],"ener":["能量","动","ener"],"myst":["奥秘","动","myst"],"rit":["仪式","动","rit"],"sacr":["神圣","动","sacr"],"prof":["凡俗","动","prof"],"virt":["效力、德能","动","virt"],"nex":["联结、结","动","nex"],"obli":["忘却","动","obli"],"quaer":["寻找","动","quaer"],"perd":["失去、丢失","动","perd"],"repar":["修补","动","repar"],"resp":["回答","动","resp"],"ora":["请求","动","ora"],"perm":["许可","动","perm"],"recus":["拒绝","动","recus"],"oppe":["等待","动","oppe"],"tempt":["尝试","动","tempt"],"succ":["成功","动","succ"],"defi":["失败","动","defi"],"ut":["使用","动","ut"],"tute":["保护","动","tute"],"elig":["选择","动","elig"],"cern":["决断","动","cern"],"fast":["厌恶","动","fast"],"assu":["习惯","动","assu"],"coep":["开始","动","coep"],"conti":["继续","动","conti"],"cess":["停止","动","cess"],"accip":["接受","动","accip"],"redd":["归还","动","redd"],"caren":["缺少","动","caren"],"plet":["填满","动","plet"],"fier":["成为","动","fier"],"perte":["属于","动","perte"],"possi":["拥有","动","possi"],"bon":["好","性","bon"],"mal":["坏、恶","性","mal"],"turp":["丑、可耻","性","turp"],"firm":["坚固","性","firm"],"imbe":["孱弱","性","imbe"],"dit":["富有","性","dit"],"paup":["贫穷","性","paup"],"preci":["贵重","性","preci"],"vil":["低贱","性","vil"],"vacu":["空","性","vacu"],"crud":["生、未熟","性","crud"],"coct":["熟、成熟","性","coct"],"rect":["正确","性","rect"],"prav":["错误、歪斜","性","prav"],"facil":["容易","性","facil"],"diffic":["困难","性","diffic"],"obsc":["昏暗","性","obsc"],"sord":["污浊","性","sord"],"mund":["洁净","性","mund"],"miti":["温顺","性","miti"],"leni":["柔和","性","leni"],"tener":["柔嫩","性","tener"],"dure":["坚硬","性","dure"],"pur":["纯净","性","pur"],"crass":["厚","性","crass"],"poss":["可能","性","poss"],"neces":["必然","性","neces"],"actu":["现实","性","actu"],"condit":["条件","性","condit"],"proce":["过程","性","proce"],"gnos":["知识","性","gnos"],"idea":["理念","性","idea"],"valo":["价值","性","valo"],"iust":["正义","性","iust"],"vitio":["恶习","性","vitio"],"offic":["义务","性","offic"],"merit":["功绩","性","merit"],"culp":["过失","性","culp"],"laus":["称赞","性","laus"],"honor":["荣誉","性","honor"],"infa":["耻辱","性","infa"],"glor":["荣耀","性","glor"],"fama":["名声","性","fama"],"nihil":["虚无","性","nihil"],"dialect":["辩证","性","dialect"],"analys":["分析","性","analys"],"synthes":["综合","性","synthes"],"kris":["危机","性","kris"],"harmon":["调和","性","harmon"],"nomos":["法则","性","nomos"],"physis":["本性","性","physis"],"techne":["技艺","性","techne"],"praxis":["实践","性","praxis"],"laet":["快乐","性","laet"],"desp":["绝望","性","desp"],"ango":["焦虑","性","ango"],"anxi":["忧虑","性","anxi"],"solli":["忧心","性","solli"],"pavid":["惊恐","性","pavid"],"terr":["恐怖","性","terr"],"horr":["战栗","性","horr"],"carit":["慈爱","性","carit"],"benevo":["善意","性","benevo"],"miser":["怜悯","性","miser"],"pati":["忍耐","性","pati"],"diffi":["不信","性","diffi"],"susp":["猜疑","性","susp"],"admi":["钦佩","性","admi"],"contem":["轻蔑","性","contem"],"volup":["享乐","性","volup"],"taed":["厌倦","性","taed"],"curio":["好奇","性","curio"],"studi":["热忱","性","studi"],"pigr":["懒惰","性","pigr"],"indus":["勤勉","性","indus"],"iucund":["愉快","性","iucund"],"maer":["哀伤","性","maer"],"lug":["悲悼","性","lug"],"blandi":["温柔","性","blandi"],"estu":["激奋","性","estu"],"stupe":["惊愕","性","stupe"],"iatro":["医师","物","iatro"],"advoc":["律师","物","advoc"],"magist":["长官","物","magist"],"minist":["臣仆","物","minist"],"praec":["传令","物","praec"],"merc":["商人","物","merc"],"naut":["水手","物","naut"],"aurig":["御者","物","aurig"],"past":["牧人","物","past"],"agric":["农夫","物","agric"],"opif":["工匠","物","opif"],"pisto":["面包师","物","pisto"],"suto":["鞋匠","物","suto"],"tons":["理发师","物","tons"],"paed":["塾师","物","paed"],"philo":["哲人","物","philo"],"poet":["诗人","物","poet"],"scurr":["丑角","物","scurr"],"mim":["伶人","物","mim"],"flam":["祭司","物","flam"],"pereg":["外邦人","物","pereg"],"testi":["证人","物","testi"],"auctor":["作者","物","auctor"],"artif":["巧匠","物","artif"],"venat":["猎人","物","venat"],"piscat":["渔人","物","piscat"],"colle":["同僚团","物","colle"],"sodal":["协会","物","sodal"],"curia":["议事堂","物","curia"],"concil":["会议","物","concil"],"univ":["团体","物","univ"],"grem":["行会","物","grem"],"conf":["同盟","物","conf"],"aerar":["国库","物","aerar"],"telo":["税项","物","telo"],"annon":["粮政","物","annon"],"censu":["人口登记","物","censu"],"bema":["法庭","物","bema"],"carc":["监狱","物","carc"],"cust":["看守","物","cust"],"equit":["骑士","物","equit"],"sacram":["誓约","物","sacram"],"testam":["遗嘱","物","testam"],"matrim":["婚姻","物","matrim"],"patri":["祖国","物","patri"],"famil":["家庭","物","famil"],"vicin":["邻里","物","vicin"],"tribul":["部族","物","tribul"],"decuri":["十人长","物","decuri"],"praefect":["长官","物","praefect"],"quaestor":["财务官","物","quaestor"],"addi":["加","性","addi"],"subtra":["减","性","subtra"],"produ":["积","性","produ"],"impa":["奇数","性","impa"],"absol":["绝对","性","absol"],"comp":["计算","性","comp"],"dual":["二元","性","dual"],"plura":["多元","性","plura"],"prog":["数列","性","prog"],"quoti":["商数","性","quoti"],"aequat":["方程","性","aequat"],"radic":["开方","性","radic"],"potent":["乘方","性","potent"],"logis":["对数","性","logis"],"calcul":["演算","性","calcul"],"numer":["计数","性","numer"],"multiplica":["连乘","性","multiplica"],"divid":["整除","性","divid"],"reman":["余数","性","reman"],"aequipar":["配平","性","aequipar"],"infin":["无穷","性","infin"],"finit":["有限","性","finit"],"planet":["行星","物","planet"],"comet":["彗星","物","comet"],"galax":["银河","物","galax"],"eclip":["蚀","物","eclip"],"auror":["晨光","物","auror"],"crepus":["黄昏","物","crepus"],"merid":["正午","物","merid"],"vesp":["傍晚","物","vesp"],"mane":["清晨","物","mane"],"saec":["世代","物","saec"],"lustr":["五年","物","lustr"],"kalen":["月初","物","kalen"],"idus":["月中","物","idus"],"hebdo":["周","物","hebdo"],"feria":["平日","物","feria"],"solsti":["至日","物","solsti"],"equin":["分日","物","equin"],"zodi":["黄道","物","zodi"],"orbita":["轨道","物","orbita"],"zenith":["天顶","物","zenith"],"horizon":["地平","物","horizon"],"tropic":["回归线","物","tropic"],"umbracul":["日晷","物","umbracul"],"clepsydra":["漏刻","物","clepsydra"],"nocturn":["夜时","物","nocturn"],"diurn":["日时","物","diurn"],"matutin":["晨时","物","matutin"],"annivers":["周年","物","annivers"],"intern":["内部","物","intern"],"exter":["外部","物","exter"],"vertic":["垂直","物","vertic"],"paral":["平行","物","paral"],"diag":["对角","物","diag"],"peri":["周边","物","peri"],"dist":["距离","物","dist"],"infim":["最低","物","infim"],"cis":["此侧","物","cis"],"intr":["内侧","物","intr"],"extra":["外侧","物","extra"],"superf":["上表面","物","superf"],"advers":["对面","物","advers"],"avers":["背面","物","avers"],"sinistr":["左侧","物","sinistr"],"dexter":["右侧","物","dexter"],"obliqu":["斜向","物","obliqu"],"transvers":["横向","物","transvers"],"longitud":["纵向","物","longitud"],"altitud":["高度","物","altitud"],"latitud":["宽度","物","latitud"],"profund":["深度","物","profund"],"magnitud":["大小","物","magnitud"],"intervall":["间隔","物","intervall"],"contigu":["邻接","物","contigu"],"remot":["遥远","物","remot"],"perce":["知觉","动","perce"],"intu":["直觉","动","intu"],"reco":["回想","动","reco"],"remin":["追忆","动","remin"],"atte":["注意","动","atte"],"obse":["观察","动","obse"],"adver":["注意","动","adver"],"disce":["辨别","动","disce"],"consci":["良知","动","consci"],"rumo":["传言","动","rumo"],"argum":["论据","动","argum"],"proba":["论证","动","proba"],"cert":["确信","动","cert"],"perspic":["明察","动","perspic"],"acum":["敏锐","动","acum"],"hebet":["迟钝","动","hebet"],"somnol":["困倦","动","somnol"],"vertig":["眩晕","动","vertig"],"nause":["恶心","动","nause"],"prurit":["瘙痒","动","prurit"],"titill":["酥痒","动","titill"],"gustat":["品味","动","gustat"],"odorat":["嗅闻","动","odorat"],"tactil":["触感","动","tactil"],"aure":["金色","性","aure"],"fusc":["褐色","性","fusc"],"ciner":["灰色","性","ciner"],"rose":["粉色","性","rose"],"venet":["青色","性","venet"],"ruf":["赤褐","性","ruf"],"fulv":["黄褐","性","fulv"],"candor":["洁白","性","candor"],"pull":["深色","性","pull"],"pallor":["苍白","性","pallor"],"splend":["辉煌","性","splend"],"nitid":["光洁","性","nitid"],"opac":["荫暗","性","opac"],"pellu":["透明","性","pellu"],"macul":["斑点","性","macul"],"varieg":["杂色","性","varieg"],"marmor":["纹彩","性","marmor"],"vitre":["玻璃光泽","性","vitre"],"metall":["金属光泽","性","metall"],"lanug":["绒面","性","lanug"],"levig":["光滑","性","levig"],"voc":["嗓音","物","voc"],"serm":["谈话","物","serm"],"syll":["音节","物","syll"],"acce":["重音","物","acce"],"gramm":["文法","物","gramm"],"synt":["句法","物","synt"],"sema":["语义","物","sema"],"phon":["音声","物","phon"],"rhyth":["节奏","物","rhyth"],"orat":["演说","物","orat"],"narr":["叙述","物","narr"],"descr":["描写","物","descr"],"defin":["定义","物","defin"],"sente":["句子","物","sente"],"para":["段落","物","para"],"poem":["诗","物","poem"],"fabul":["寓言","物","fabul"],"myth":["神话","物","myth"],"lexic":["词汇","物","lexic"],"phonem":["音位","物","phonem"],"morphem":["词素","物","morphem"],"etym":["词源","物","etym"],"idiom":["习语","物","idiom"],"proverb":["谚语","物","proverb"],"argot":["隐语","物","argot"],"poli":["打磨","动","poli"],"laevi":["磨光","动","laevi"],"caela":["雕镂","动","caela"],"fict":["塑造","动","fict"],"compa":["接合","动","compa"],"armam":["装备","动","armam"],"supell":["家具","动","supell"],"recep":["容器","动","recep"],"cist":["箱箧","动","cist"],"materi":["材料","动","materi"],"structu":["营造","动","structu"],"fabrica":["工坊","动","fabrica"],"instrument":["器具","动","instrument"],"organ":["工具","动","organ"],"utens":["用具","动","utens"],"machin":["机械","动","machin"],"temper":["回火","动","temper"],"confl":["熔炼","动","confl"],"forgi":["锻造","动","forgi"],"incud":["铁砧","动","incud"],"foll":["风箱","动","foll"],"lima":["锉","动","lima"],"runcin":["刨","动","runcin"],"ascia":["锛","动","ascia"],"scalpr":["刻刀","动","scalpr"],"faen":["利息","动","faen"],"usur":["高利","动","usur"],"pign":["抵押","动","pign"],"arrh":["定金","动","arrh"],"salar":["薪俸","动","salar"],"monet":["铸币","动","monet"],"numm":["钱币","动","numm"],"denar":["银钱","动","denar"],"talen":["大额货币","动","talen"],"drach":["货币单位","动","drach"],"merca":["市场","动","merca"],"nundi":["集日","动","nundi"],"tabern":["店铺","动","tabern"],"instit":["零售商","动","instit"],"credit":["债权","动","credit"],"camb":["兑换","动","camb"],"stips":["施舍","动","stips"],"locar":["出租","动","locar"],"conduc":["承租","动","conduc"],"emptor":["买主","动","emptor"],"vendit":["卖主","动","vendit"],"preti":["估价","动","preti"],"aequip":["等价","动","aequip"],"compens":["补偿","动","compens"],"lucrif":["牟利","动","lucrif"],"damn":["亏损","动","damn"],"fener":["放贷","动","fener"],"nummul":["钱庄","动","nummul"],"epist":["书信","物","epist"],"cod":["册","物","cod"],"signac":["封印","物","signac"],"curs":["信使","物","curs"],"procl":["公告","物","procl"],"mandat":["命令书","物","mandat"],"tom":["卷","物","tom"],"titul":["标题","物","titul"],"capit":["章节","物","capit"],"interp":["解释","物","interp"],"exege":["疏解","物","exege"],"transfer":["转达","物","transfer"],"nuntia":["通报","物","nuntia"],"ephemer":["传单","物","ephemer"],"libell":["小册","物","libell"],"pagella":["书页","物","pagella"],"versio":["译本","物","versio"],"notar":["速记","物","notar"],"sigill":["封缄","物","sigill"],"chiro":["手书","物","chiro"],"tabul":["案卷","物","tabul"],"semit":["小径","物","semit"],"tram":["岔路","物","tram"],"diver":["岔口","物","diver"],"caup":["客栈","物","caup"],"stabu":["厩舍","物","stabu"],"stratum":["床铺","物","stratum"],"pulv":["枕","物","pulv"],"strag":["被褥","物","strag"],"mensa":["餐桌","物","mensa"],"camin":["壁炉","物","camin"],"lych":["灯","物","lych"],"sarcin":["行囊","物","sarcin"],"migr":["迁徙","物","migr"],"comme":["通行","物","comme"],"viatic":["旅费","物","viatic"],"devers":["驿舍","物","devers"],"mans":["宿站","物","mans"],"exped":["远征","物","exped"],"peregr":["远游","物","peregr"],"profect":["出发","物","profect"],"redit":["归来","物","redit"],"vad":["涉渡","物","vad"],"transit":["过境","物","transit"],"column":["柱","物","column"],"episty":["柱顶","物","episty"],"arcus":["拱","物","arcus"],"pod":["台基","物","pod"],"exedr":["厅","物","exedr"],"latri":["厕","物","latri"],"piscin":["水池","物","piscin"],"hort":["园","物","hort"],"domus":["宅","物","domus"],"fan":["圣所","物","fan"],"delubr":["神龛","物","delubr"],"imbri":["筒瓦","物","imbri"],"antae":["壁柱","物","antae"],"posti":["门柱","物","posti"],"cardo":["门枢","物","cardo"],"claustr":["闩锁","物","claustr"],"fores":["双扉","物","fores"],"fenest":["窗牖","物","fenest"],"scalis":["阶梯","物","scalis"],"subsell":["长凳","物","subsell"],"armar":["橱柜","物","armar"],"cubil":["卧榻","物","cubil"],"impluvi":["天井","物","impluvi"],"compluvi":["庭院顶","物","compluvi"],"vestibu":["门厅","物","vestibu"],"antl":["水泵","物","antl"],"siph":["虹吸","物","siph"],"spira":["螺旋","物","spira"],"catar":["闸门","物","catar"],"rotat":["旋转","物","rotat"],"pression":["压动","物","pression"],"impuls":["推动","物","impuls"],"motri":["原动","物","motri"],"vecti":["传动","物","vecti"],"dentat":["齿轮","物","dentat"],"cochle":["螺旋杆","物","cochle"],"sucul":["绞盘","物","sucul"],"fornac":["炉膛","物","fornac"],"valv":["阀门","物","valv"],"tubul":["管道","物","tubul"],"haust":["汲水","物","haust"],"elevat":["提升","物","elevat"],"communic":["连通","物","communic"],"fim":["厩肥","物","fim"],"glum":["谷壳","物","glum"],"spic":["穗","物","spic"],"mol":["磨","物","mol"],"pistr":["磨坊","物","pistr"],"furn":["烤炉","物","furn"],"hord":["大麦","物","hord"],"aven":["燕麦","物","aven"],"case":["奶酪","物","case"],"buty":["黄油","物","buty"],"pipe":["胡椒","物","pipe"],"pult":["粥","物","pult"],"malum":["苹果","物","malum"],"fic":["无花果","物","fic"],"uv":["葡萄","物","uv"],"nuc":["坚果","物","nuc"],"rapa":["芜菁","物","rapa"],"all":["蒜","物","all"],"cep":["洋葱","物","cep"],"beta":["甜菜","物","beta"],"cucurbi":["瓜","物","cucurbi"],"legum":["豆","物","legum"],"lactuc":["莴苣","物","lactuc"],"prun":["李","物","prun"],"ceras":["樱桃","物","ceras"],"persic":["桃","物","persic"],"pir":["梨","物","pir"],"sympt":["症状","动","sympt"],"diagn":["诊断","动","diagn"],"thera":["治疗","动","thera"],"anato":["解剖","动","anato"],"muscul":["肌肉","动","muscul"],"pulm":["肺","动","pulm"],"hepat":["肝","动","hepat"],"ren":["肾","动","ren"],"ventr":["腹","动","ventr"],"cut":["肤","动","cut"],"capill":["发","动","capill"],"luxa":["脱臼","动","luxa"],"valetu":["疗养院","动","valetu"],"febri":["热病","动","febri"],"pesti":["疫病","动","pesti"],"veneni":["毒物","动","veneni"],"cicatr":["疤痕","动","cicatr"],"medic":["医术","动","medic"],"pharmac":["药草","动","pharmac"],"obstetric":["产科","动","obstetric"],"anesthes":["麻醉","动","anesthes"],"intestin":["肠","动","intestin"],"stomach":["胃","动","stomach"],"accus":["控告","动","accus"],"delic":["违法","动","delic"],"fraud":["欺诈","动","fraud"],"furt":["盗窃","动","furt"],"iniu":["侵害","动","iniu"],"homic":["杀人","动","homic"],"adult":["通奸","动","adult"],"periur":["伪誓","动","periur"],"calum":["诬告","动","calum"],"iurisc":["法学家","动","iurisc"],"provo":["上诉","动","provo"],"appell":["申诉","动","appell"],"damnat":["判罪","动","damnat"],"absolut":["开释","动","absolut"],"caut":["担保","动","caut"],"fideiuss":["保证","动","fideiuss"],"transact":["和解","动","transact"],"arbitr":["仲裁","动","arbitr"],"pacti":["约定","动","pacti"],"stipulat":["要式","动","stipulat"],"deposit":["寄存","动","deposit"],"commodat":["借用","动","commodat"],"usucap":["时效取得","动","usucap"],"possess":["占有","动","possess"],"domin":["所有权","动","domin"],"servitut":["地役","动","servitut"],"proel":["会战","动","proel"],"acie":["阵列","动","acie"],"pedit":["步兵","动","pedit"],"arie":["攻城槌","动","arie"],"agger":["土垒","动","agger"],"spicu":["矛尖","动","spicu"],"strat":["战略","动","strat"],"takt":["战术","动","takt"],"victo":["胜利","动","victo"],"dedit":["投降","动","dedit"],"indut":["休战","动","indut"],"equita":["骑兵","动","equita"],"sagitt":["箭手","动","sagitt"],"fundit":["投石手","动","fundit"],"ballist":["弩炮手","动","ballist"],"signif":["旗手","动","signif"],"tubic":["号手","动","tubic"],"cornic":["号角手","动","cornic"],"obsid":["围城","动","obsid"],"expugn":["强攻","动","expugn"],"propugn":["守御","动","propugn"],"praesidi":["守备","动","praesidi"],"excubi":["岗哨","动","excubi"],"bibli":["藏书","物","bibli"],"acad":["学园","物","acad"],"gym":["体育场","物","gym"],"histo":["历史","物","histo"],"geogr":["地理","物","geogr"],"theol":["神学","物","theol"],"disput":["辩论","物","disput"],"exper":["实验","物","exper"],"theore":["定理","物","theore"],"didact":["教学法","物","didact"],"paidei":["教化","物","paidei"],"scholar":["学人","物","scholar"],"discipul":["门生","物","discipul"],"praecept":["教诫","物","praecept"],"exercit":["练习","物","exercit"],"commen":["注疏","物","commen"],"gloss":["笺注","物","gloss"],"annotat":["批注","物","annotat"],"compend":["纲要","物","compend"],"epitom":["摘要","物","epitom"],"cursus":["课程","物","cursus"],"studios":["勤学者","物","studios"],"statu":["雕像","物","statu"],"trago":["悲剧","物","trago"],"comoe":["喜剧","物","comoe"],"person":["角色","物","person"],"cithar":["竖琴","物","cithar"],"cymb":["铙钹","物","cymb"],"poes":["诗艺","物","poes"],"metr":["格律","物","metr"],"pictor":["画师","物","pictor"],"sculptor":["雕刻师","物","sculptor"],"archit":["建筑师","物","archit"],"aulos":["双管笛","物","aulos"],"syrinx":["排箫","物","syrinx"],"orchestr":["乐池","物","orchestr"],"pantomim":["哑剧","物","pantomim"],"fabulat":["编剧","物","fabulat"],"versific":["作诗","物","versific"],"recitat":["朗诵","物","recitat"],"improvis":["即兴","物","improvis"],"virtuos":["名家","物","virtuos"],"divus":["神明","物","divus"],"lar":["家神","物","lar"],"penat":["家神","物","penat"],"geni":["守护灵","物","geni"],"infe":["冥界","物","infe"],"elys":["乐土","物","elys"],"tartar":["冥渊","物","tartar"],"char":["渡灵者","物","char"],"styx":["冥河","物","styx"],"orc":["冥府","物","orc"],"provi":["天命","物","provi"],"nemes":["报应","物","nemes"],"hybr":["僭越","物","hybr"],"piacul":["赎罪","物","piacul"],"exorc":["驱邪","物","exorc"],"devot":["奉献","物","devot"],"oblat":["供物","物","oblat"],"libat":["奠酒","物","libat"],"incens":["焚香","物","incens"],"harus":["肠卜","物","harus"],"sibyll":["神谕集","物","sibyll"],"vaticin":["神谕宣示","物","vaticin"],"plant":["植物","物","plant"],"vent":["风","物","vent"],"humu":["土壤","物","humu"],"mundu":["世界","物","mundu"],"flor":["花","物","flor"],"faun":["兽群","物","faun"],"flum":["河流","物","flum"],"litor":["海滨","物","litor"],"glare":["砾石","物","glare"],"limos":["淤泥","物","limos"],"palud":["沼泽","物","palud"],"saltu":["林地","物","saltu"],"coll":["丘陵","物","coll"],"planit":["平原","物","planit"],"desert":["荒漠","物","desert"],"oasi":["绿洲","物","oasi"],"paenin":["半岛","物","paenin"],"isthm":["地峡","物","isthm"],"promon":["海角","物","promon"],"portu":["港湾","物","portu"],"aestu":["河口","物","aestu"],"iuven":["青春","物","iuven"],"infan":["幼年","物","infan"],"puer":["童年","物","puer"],"adole":["少年","物","adole"],"femin":["女子","物","femin"],"mas":["男子","物","mas"],"prol":["后代","物","prol"],"hered":["继承","物","hered"],"here":["继承人","物","here"],"funer":["葬礼","物","funer"],"sepul":["埋葬","物","sepul"],"tumul":["坟冢","物","tumul"],"vit":["生命","物","vit"],"natal":["诞辰","物","natal"],"obit":["辞世","物","obit"],"mortu":["死者","物","mortu"],"superstes":["遗存","物","superstes"],"vidu":["寡居","物","vidu"],"nubil":["婚龄","物","nubil"],"caelib":["独身","物","caelib"],"genet":["生育","物","genet"],"thanat":["死亡","物","thanat"],"physic":["物理学","物","physic"],"atom":["原子","物","atom"],"molec":["分子","物","molec"],"kines":["运动","物","kines"],"statik":["静力学","物","statik"],"mech":["力学","物","mech"],"mass":["质量","物","mass"],"acceler":["加速度","物","acceler"],"gravit":["引力","物","gravit"],"inert":["惯性","物","inert"],"elast":["弹性","物","elast"],"vibr":["振动","物","vibr"],"frequent":["频率","物","frequent"],"amplitud":["振幅","物","amplitud"],"reson":["共振","物","reson"],"fluid":["流体","物","fluid"],"viscos":["黏性","物","viscos"],"entropi":["熵","物","entropi"],"radiat":["辐射","物","radiat"],"conduct":["传导","物","conduct"],"convect":["对流","物","convect"],"induct":["感应","物","induct"],"optic":["光学","物","optic"],"acust":["声学","物","acust"],"chemis":["化学","物","chemis"],"solvent":["溶剂","物","solvent"],"solute":["溶质","物","solute"],"reduct":["还原","物","reduct"],"compos":["化合物","物","compos"],"neutr":["中性","物","neutr"],"ion":["离子","物","ion"],"cation":["阳离子","物","cation"],"anion":["阴离子","物","anion"],"electro":["电极","物","electro"],"valent":["化合价","物","valent"],"mole":["摩尔","物","mole"],"concent":["浓度","物","concent"],"volatil":["挥发性","物","volatil"],"combust":["燃烧","物","combust"],"inciner":["焚化","物","inciner"],"alloy":["合金","物","alloy"],"amalgam":["汞齐","物","amalgam"],"reagen":["试剂","物","reagen"],"crucib":["坩埚","物","crucib"],"retort":["蒸馏器","物","retort"],"alembic":["蒸馏釜","物","alembic"],"hygro":["吸湿","物","hygro"],"titrat":["滴定","物","titrat"],"kat":["催化","物","kat"],"cellul":["细胞","物","cellul"],"viscer":["脏腑","物","viscer"],"chromos":["染色体","物","chromos"],"evolut":["进化","物","evolut"],"ecol":["生态","物","ecol"],"ambie":["环境","物","ambie"],"biom":["生物群系","物","biom"],"biosph":["生物圈","物","biosph"],"habitat":["栖息地","物","habitat"],"niche":["生态位","物","niche"],"symbio":["共生","物","symbio"],"parasit":["寄生","物","parasit"],"nutrien":["养分","物","nutrien"],"metabol":["代谢","物","metabol"],"photos":["光合","物","photos"],"germin":["发芽","物","germin"],"pollinat":["授粉","物","pollinat"],"fecund":["繁殖力","物","fecund"],"steril":["不育","物","steril"],"adapt":["适应","物","adapt"],"ecosys":["生态系统","物","ecosys"],"biolo":["生物学","物","biolo"],"zoolo":["动物学","物","zoolo"],"botan":["植物学","物","botan"],"miner":["矿物","物","miner"],"sediment":["沉积","物","sediment"],"erosion":["侵蚀","物","erosion"],"vulcan":["火山","物","vulcan"],"seism":["地震","物","seism"],"magma":["岩浆","物","magma"],"fossil":["化石","物","fossil"],"tecton":["板块","物","tecton"],"fault":["断层","物","fault"],"orogen":["造山","物","orogen"],"geolo":["地质学","物","geolo"],"quarr":["采石场","物","quarr"],"vein":["矿脉","物","vein"],"chalk":["矿石","物","chalk"],"stalac":["钟乳石","物","stalac"],"karst":["喀斯特","物","karst"],"loess":["黄土","物","loess"],"clay":["黏土","物","clay"],"silt":["粉砂","物","silt"],"sandst":["砂岩","物","sandst"],"calcar":["石灰岩","物","calcar"],"granit":["花岗岩","物","granit"],"basalt":["玄武岩","物","basalt"],"slate":["板岩","物","slate"],"quartz":["石英","物","quartz"],"supern":["超新星","物","supern"],"quasar":["类星体","物","quasar"],"pulsar":["脉冲星","物","pulsar"],"astero":["小行星","物","astero"],"meteor":["流星","物","meteor"],"meteorit":["陨石","物","meteorit"],"satellit":["卫星","物","satellit"],"aphel":["远日点","物","aphel"],"perihe":["近日点","物","perihe"],"equator":["赤道","物","equator"],"constel":["星座","物","constel"],"vacuum":["真空","物","vacuum"],"sidere":["恒星时","物","sidere"],"occult":["掩星","物","occult"],"nadir":["天底","物","nadir"],"azimuth":["方位角","物","azimuth"],"declin":["赤纬","物","declin"],"ascen":["赤经","物","ascen"],"cosmog":["宇宙起源","物","cosmog"],"parall":["视差","物","parall"],"luminos":["光度","物","luminos"],"spectr":["光谱","物","spectr"],"radio":["射电","物","radio"],"infrar":["红外","物","infrar"],"ultrav":["紫外","物","ultrav"],"climat":["气候","物","climat"],"atmos":["大气层","物","atmos"],"barom":["气压计","物","barom"],"anemo":["风速计","物","anemo"],"irid":["虹","物","irid"],"halo":["晕","物","halo"],"monsun":["季风","物","monsun"],"cyclon":["气旋","物","cyclon"],"anticy":["反气旋","物","anticy"],"typh":["台风","物","typh"],"tornad":["龙卷","物","tornad"],"sleet":["雨夹雪","物","sleet"],"droug":["干旱","物","droug"],"diluv":["大洪水","物","diluv"],"blizz":["暴雪","物","blizz"],"drizz":["细雨","物","drizz"],"downp":["倾盆","物","downp"],"subtro":["亚热带","物","subtro"],"altocu":["高积云","物","altocu"],"cumulo":["积雨云","物","cumulo"],"strati":["层云","物","strati"],"cirr":["卷云","物","cirr"],"nimbo":["雨层云","物","nimbo"],"condens":["凝结","物","condens"],"isoth":["等温线","物","isoth"],"emot":["情绪","性","emot"],"charact":["性格","性","charact"],"intell":["智力","性","intell"],"aptitud":["才能","性","aptitud"],"instinct":["本能","性","instinct"],"frustr":["挫折","性","frustr"],"conflict":["冲突","性","conflict"],"depress":["抑郁","性","depress"],"mania":["躁狂","性","mania"],"phobia":["恐惧症","性","phobia"],"obsess":["执念","性","obsess"],"compuls":["强迫","性","compuls"],"trauma":["创伤","性","trauma"],"accommod":["顺应","性","accommod"],"ego":["自我","性","ego"],"attitude":["态度","性","attitude"],"creden":["信念","性","creden"],"preju":["偏见","性","preju"],"stereo":["刻板","性","stereo"],"empath":["共情","性","empath"],"sympath":["同情","性","sympath"],"antipath":["反感","性","antipath"],"sentiment":["情感","性","sentiment"],"passion":["激情","性","passion"],"ambition":["雄心","性","ambition"],"hierar":["等级制","物","hierar"],"libertus":["自由民","物","libertus"],"margin":["边缘人","物","margin"],"elite":["精英","物","elite"],"prolet":["无产者","物","prolet"],"burgens":["市民","物","burgens"],"arist":["贵族制","物","arist"],"oliga":["寡头","物","oliga"],"democr":["民主","物","democr"],"monar":["君主制","物","monar"],"tyrann":["暴君","物","tyrann"],"republic":["共和","物","republic"],"feud":["封建","物","feud"],"caste":["种姓","物","caste"],"union":["联盟","物","union"],"faction":["派系","物","faction"],"assem":["议会","物","assem"],"parlia":["国会","物","parlia"],"elector":["选民","物","elector"],"candida":["候选人","物","candida"],"presti":["声望","物","presti"],"mobil":["流动","物","mobil"],"inequ":["不平等","物","inequ"],"privileg":["特权","物","privileg"],"rebell":["反抗","物","rebell"],"suppl":["供给","动","suppl"],"deman":["需求","动","deman"],"bank":["银行","动","bank"],"capital":["资本","动","capital"],"consum":["消费","动","consum"],"distribut":["分配","动","distribut"],"invest":["投资","动","invest"],"inflation":["通胀","动","inflation"],"deflation":["通缩","动","deflation"],"budget":["预算","动","budget"],"reven":["收入","动","reven"],"expend":["支出","动","expend"],"deficit":["赤字","动","deficit"],"surplus":["盈余","动","surplus"],"tarif":["关税","动","tarif"],"quota":["配额","动","quota"],"competit":["竞争","动","competit"],"barter":["以物易物","动","barter"],"currency":["通货","动","currency"],"stock":["股份","动","stock"],"dividend":["股息","动","dividend"],"oblig":["债券","动","oblig"],"premium":["保费","动","premium"],"pension":["年金","动","pension"],"constitu":["宪法","物","constitu"],"statute":["成文法","物","statute"],"aequit":["衡平","物","aequit"],"respons":["责任","物","respons"],"innoc":["无罪","物","innoc"],"verdict":["裁决","物","verdict"],"petition":["请愿","物","petition"],"actor":["原告","物","actor"],"attorn":["代理人","物","attorn"],"litig":["争讼","物","litig"],"iurisd":["管辖","物","iurisd"],"preced":["先例","物","preced"],"mediation":["调解","物","mediation"],"pardon":["赦免","物","pardon"],"amnesty":["大赦","物","amnesty"],"extrad":["引渡","物","extrad"],"torture":["酷刑","物","torture"],"citat":["传唤","物","citat"],"warrant":["令状","物","warrant"],"subpoe":["传票","物","subpoe"],"affidav":["宣誓书","物","affidav"],"lien":["留置权","物","lien"],"trespass":["侵入","物","trespass"],"neglig":["过失","物","neglig"],"guardi":["监护人","物","guardi"],"vaccine":["疫苗","物","vaccine"],"immun":["免疫","物","immun"],"antibi":["抗生素","物","antibi"],"virus":["病毒","物","virus"],"bacteri":["细菌","物","bacteri"],"inflam":["炎症","物","inflam"],"syndrome":["综合征","物","syndrome"],"dosis":["剂量","物","dosis"],"praesc":["处方","物","praesc"],"clinic":["诊所","物","clinic"],"hospital":["医院","物","hospital"],"cheirur":["外科医师","物","cheirur"],"ambula":["救护车","物","ambula"],"scalpe":["手术刀","物","scalpe"],"bandag":["绷带","物","bandag"],"splint":["夹板","物","splint"],"crutch":["拐杖","物","crutch"],"prosthe":["假肢","物","prosthe"],"transpl":["移植","物","transpl"],"dialysis":["透析","物","dialysis"],"transfu":["输血","物","transfu"],"onco":["肿瘤","物","onco"],"cardio":["心脏","物","cardio"],"pediat":["儿科","物","pediat"],"turbine":["涡轮","物","turbine"],"generator":["发电机","物","generator"],"piston":["活塞","物","piston"],"cylind":["汽缸","物","cylind"],"bolt":["螺栓","物","bolt"],"rivet":["铆钉","物","rivet"],"weld":["焊接","物","weld"],"sold":["钎焊","物","sold"],"foundr":["铸造厂","物","foundr"],"lathe":["车床","物","lathe"],"circuit":["电路","物","circuit"],"amper":["电流","物","amper"],"voltag":["电压","物","voltag"],"resist":["电阻","物","resist"],"inductor":["电感","物","inductor"],"transistor":["晶体管","物","transistor"],"diod":["二极管","物","diod"],"semico":["半导体","物","semico"],"chip":["芯片","物","chip"],"algor":["算法","物","algor"],"program":["程序","物","program"],"protocol":["协议","物","protocol"],"crypt":["加密","物","crypt"],"binary":["二进制","物","binary"],"digital":["数字","物","digital"],"subse":["子集","物","subse"],"varia":["变量","物","varia"],"limit":["极限","物","limit"],"continuu":["连续","物","continuu"],"deriv":["导数","物","deriv"],"differen":["微分","物","differen"],"probab":["概率","物","probab"],"statis":["统计","物","statis"],"averag":["平均","物","averag"],"varian":["方差","物","varian"],"correl":["相关","物","correl"],"regres":["回归","物","regres"],"sampl":["样本","物","sampl"],"axiom":["公理","物","axiom"],"lemma":["引理","物","lemma"],"topol":["拓扑","物","topol"],"matrix":["矩阵","物","matrix"],"determ":["行列式","物","determ"],"permut":["排列","物","permut"],"conver":["收敛","物","conver"],"diverg":["发散","物","diverg"],"graph":["图","物","graph"],"recurs":["递归","物","recurs"],"optim":["最优化","物","optim"],"proposit":["命题","性","proposit"],"premiss":["前提","性","premiss"],"infer":["推断","性","infer"],"deduc":["演绎","性","deduc"],"abduc":["溯因","性","abduc"],"syllog":["三段论","性","syllog"],"induc":["归纳","性","induc"],"falsif":["证伪","性","falsif"],"verif":["验证","性","verif"],"consist":["一致","性","consist"],"contradict":["矛盾","性","contradict"],"paradox":["悖论","性","paradox"],"fallac":["谬误","性","fallac"],"sophism":["诡辩","性","sophism"],"quantif":["量化","性","quantif"],"predicat":["谓词","性","predicat"],"entail":["蕴涵","性","entail"],"implic":["蕴含","性","implic"],"equival":["等价","性","equival"],"negation":["否定","性","negation"],"conjunct":["合取","性","conjunct"],"disjunct":["析取","性","disjunct"],"tautolog":["重言","性","tautolog"],"assert":["断言","性","assert"],"corollar":["系","性","corollar"],"literat":["文学","物","literat"],"prose":["散文","物","prose"],"epic":["史诗","物","epic"],"lyric":["抒情诗","物","lyric"],"elegy":["挽歌","物","elegy"],"sonnet":["十四行诗","物","sonnet"],"roman":["长篇小说","物","roman"],"romance":["传奇","物","romance"],"tale":["故事","物","tale"],"episode":["插曲","物","episode"],"plot":["情节","物","plot"],"theme":["主题","物","theme"],"motif":["母题","物","motif"],"protago":["主角","物","protago"],"antago":["反派","物","antago"],"editor":["编辑","物","editor"],"publis":["出版者","物","publis"],"critic":["批评家","物","critic"],"revie":["评论","物","revie"],"essay":["随笔","物","essay"],"biogra":["传记","物","biogra"],"memoir":["回忆录","物","memoir"],"anthol":["选集","物","anthol"],"metaphor":["隐喻","物","metaphor"],"parody":["戏仿","物","parody"],"pitch":["音高","物","pitch"],"chord":["和弦","物","chord"],"clef":["谱号","物","clef"],"staff":["谱表","物","staff"],"ensemble":["合奏","物","ensemble"],"solo":["独奏","物","solo"],"duet":["二重奏","物","duet"],"conductor":["指挥","物","conductor"],"concert":["音乐会","物","concert"],"opera":["歌剧","物","opera"],"operet":["轻歌剧","物","operet"],"ballet":["芭蕾","物","ballet"],"puppet":["木偶","物","puppet"],"masque":["假面剧","物","masque"],"carnival":["狂欢","物","carnival"],"parade":["游行","物","parade"],"acrobat":["杂技","物","acrobat"],"jongl":["杂耍","物","jongl"],"aria":["咏叹调","物","aria"],"sonata":["奏鸣曲","物","sonata"],"sympho":["交响乐","物","sympho"],"quartet":["四重奏","物","quartet"],"prelude":["前奏","物","prelude"],"canvas":["画布","物","canvas"],"pigment":["颜料","物","pigment"],"palette":["调色板","物","palette"],"brush":["画笔","物","brush"],"easel":["画架","物","easel"],"sketch":["速写","物","sketch"],"portra":["肖像","物","portra"],"landscape":["风景","物","landscape"],"mural":["壁画","物","mural"],"fresco":["湿壁画","物","fresco"],"engrav":["版画","物","engrav"],"etch":["蚀刻","物","etch"],"lithog":["石版","物","lithog"],"woodcu":["木刻","物","woodcu"],"relie":["浮雕","物","relie"],"bust":["胸像","物","bust"],"medall":["像章","物","medall"],"gallery":["画廊","物","gallery"],"exhib":["展览","物","exhib"],"curator":["策展人","物","curator"],"aesthe":["美学","物","aesthe"],"perspe":["透视","物","perspe"],"symmetry":["对称","物","symmetry"],"contrast":["对比","物","contrast"],"tinct":["淡色","物","tinct"],"phonet":["语音学","物","phonet"],"phonol":["音系学","物","phonol"],"morpho":["形态学","物","morpho"],"pragma":["语用","物","pragma"],"sociole":["社会方言","物","sociole"],"pictog":["象形","物","pictog"],"ideog":["表意","物","ideog"],"alphabet":["字母表","物","alphabet"],"graphem":["字素","物","graphem"],"alloph":["音位变体","物","alloph"],"prefix":["前缀","物","prefix"],"suffix":["后缀","物","suffix"],"infix":["中缀","物","infix"],"stem":["词干","物","stem"],"lexem":["词位","物","lexem"],"paradigm":["词形变化","物","paradigm"],"declension":["变格","物","declension"],"conjug":["变位","物","conjug"],"congru":["一致","物","congru"],"casus":["格","物","casus"],"aspect":["体","物","aspect"],"transla":["翻译","物","transla"],"transcr":["转写","物","transcr"],"translit":["音译","物","translit"],"orthogr":["正字法","物","orthogr"],"guilt":["内疚","性","guilt"],"superb":["骄傲","性","superb"],"zel":["妒羡","性","zel"],"resent":["怨恨","性","resent"],"rabi":["暴怒","性","rabi"],"furia":["狂怒","性","furia"],"wrath":["盛怒","性","wrath"],"scorn":["蔑视","性","scorn"],"dread":["畏惧","性","dread"],"panic":["恐慌","性","panic"],"shock":["震惊","性","shock"],"surpr":["惊讶","性","surpr"],"amaze":["惊异","性","amaze"],"awe":["敬畏","性","awe"],"rever":["敬仰","性","rever"],"nostal":["怀旧","性","nostal"],"grief":["哀痛","性","grief"],"optimis":["乐观","性","optimis"],"pessim":["悲观","性","pessim"],"conten":["满足","性","conten"],"embarr":["尴尬","性","embarr"],"confid":["自信","性","confid"],"ecsta":["狂喜","性","ecsta"],"euphor":["欣快","性","euphor"],"irrita":["烦躁","性","irrita"],"vision":["视觉","性","vision"],"audit":["听觉","性","audit"],"somato":["躯体感觉","性","somato"],"nocice":["痛觉","性","nocice"],"thermo":["温觉","性","thermo"],"proprio":["本体觉","性","proprio"],"stimulus":["刺激","性","stimulus"],"threshold":["阈","性","threshold"],"sensit":["敏感","性","sensit"],"habitu":["习惯化","性","habitu"],"illusion":["错觉","性","illusion"],"halluc":["幻觉","性","halluc"],"bright":["亮度","性","bright"],"loudn":["响度","性","loudn"],"reverb":["混响","性","reverb"],"synest":["通感","性","synest"],"kinest":["动觉","性","kinest"],"apperc":["统觉","性","apperc"],"recogn":["识别","性","recogn"],"identif":["辨认","性","identif"],"orient":["定向","性","orient"],"vestibul":["前庭觉","性","vestibul"],"sensor":["传感器","性","sensor"],"rostr":["喙","物","rostr"],"ala":["翼","物","ala"],"ungul":["蹄","物","ungul"],"caud":["尾","物","caud"],"iub":["鬃","物","iub"],"vell":["毛皮","物","vell"],"antenna":["触角","物","antenna"],"branchi":["鳃","物","branchi"],"nid":["巢","物","nid"],"hibern":["冬眠","物","hibern"],"rumin":["反刍","物","rumin"],"predat":["捕食","物","predat"],"pinna":["鳍","物","pinna"],"squam":["鳞","物","squam"],"crist":["冠羽","物","crist"],"gregar":["群居","物","gregar"],"carniv":["食肉","物","carniv"],"herbiv":["食草","物","herbiv"],"omniv":["杂食","物","omniv"],"larva":["幼体","物","larva"],"pupa":["蛹","物","pupa"],"nymph":["若虫","物","nymph"],"cocon":["茧","物","cocon"],"chrysal":["蛹壳","物","chrysal"],"plumag":["羽衣","物","plumag"],"caul":["茎","物","caul"],"gemin":["叶芽","物","gemin"],"flosc":["花冠","物","flosc"],"petal":["花瓣","物","petal"],"stamen":["雄蕊","物","stamen"],"pistil":["雌蕊","物","pistil"],"perica":["果皮","物","perica"],"testac":["种皮","物","testac"],"radicul":["须根","物","radicul"],"tuber":["块茎","物","tuber"],"viticul":["藤蔓","物","viticul"],"decidu":["落叶","物","decidu"],"semperv":["常绿","物","semperv"],"pollin":["花粉","物","pollin"],"insit":["嫁接","物","insit"],"propag":["扦插","物","propag"],"putat":["修剪","物","putat"],"tepidar":["温室","物","tepidar"],"pomari":["果园","物","pomari"],"hortul":["菜圃","物","hortul"],"seminari":["苗圃","物","seminari"],"stercor":["施肥","物","stercor"],"herbic":["除草","物","herbic"],"frond":["叶丛","物","frond"],"bulb":["鳞茎","物","bulb"],"platea":["街道","物","platea"],"angipo":["巷","物","angipo"],"forum":["广场","物","forum"],"porta":["城门","物","porta"],"dok":["码头","物","dok"],"pharos":["灯塔","物","pharos"],"fontan":["喷泉","物","fontan"],"monument":["纪念碑","物","monument"],"macell":["市场","物","macell"],"officina":["作坊","物","officina"],"arena":["竞技场","物","arena"],"aquaed":["水渠","物","aquaed"],"cloaca":["下水道","物","cloaca"],"lantern":["路灯","物","lantern"],"puteus":["水井","物","puteus"],"campan":["钟楼","物","campan"],"ergast":["牢房","物","ergast"],"teloni":["海关","物","teloni"],"cancell":["栅栏","物","cancell"],"paviment":["铺面","物","paviment"],"crepidin":["路缘","物","crepidin"],"suggest":["讲坛","物","suggest"],"basilica":["会堂","物","basilica"],"thermae":["浴场","物","thermae"],"hippodro":["跑马场","物","hippodro"],"mensula":["小桌","物","mensula"],"scamnum":["长凳","物","scamnum"],"lectulus":["卧榻","物","lectulus"],"pluteus":["壁架","物","pluteus"],"calathus":["花篮","物","calathus"],"patina":["盘","物","patina"],"catillus":["碟","物","catillus"],"urceus":["壶","物","urceus"],"olla":["锅","物","olla"],"cacabus":["炖锅","物","cacabus"],"foculus":["小炉","物","foculus"],"furca":["叉","物","furca"],"cochlear":["勺","物","cochlear"],"bacill":["小棒、筷","物","bacill"],"forfex":["剪","物","forfex"],"situla":["桶","物","situla"],"ampulla":["瓶","物","ampulla"],"candela":["烛台","物","candela"],"pelvis":["盆","物","pelvis"],"labrum":["洗涤盆","物","labrum"],"mappa":["餐巾","物","mappa"],"abacus":["算盘","物","abacus"],"tintin":["铃","物","tintin"],"scrinium":["卷箱","物","scrinium"],"capsula":["小盒","物","capsula"],"ablut":["盥洗","动","ablut"],"lotio":["洗涤","动","lotio"],"ters":["擦拭","动","ters"],"purgat":["打扫","动","purgat"],"compo":["整理","动","compo"],"sarci":["缝补","动","sarci"],"fod":["挖掘","动","fod"],"cumul":["堆叠","动","cumul"],"suspend":["悬挂","动","suspend"],"accend":["点燃","动","accend"],"extingu":["熄灭","动","extingu"],"haur":["舀取","动","haur"],"pensa":["称量","动","pensa"],"involv":["包裹","动","involv"],"fasc":["捆扎","动","fasc"],"sterna":["铺展","动","sterna"],"volv":["卷起","动","volv"],"scop":["扫帚","动","scop"],"verrit":["清扫","动","verrit"],"deterg":["去污","动","deterg"],"laxa":["放松","动","laxa"],"quiesc":["歇息","动","quiesc"],"suscit":["唤醒","动","suscit"],"pervig":["守夜","动","pervig"],"famul":["侍奉","动","famul"],"incumb":["俯身","动","incumb"],"genu":["跪","动","genu"],"serpo":["爬行","动","serpo"],"volut":["翻滚","动","volut"],"levat":["举起","动","levat"],"iact":["抛掷","动","iact"],"excip":["接住","动","excip"],"vellic":["拧捏","动","vellic"],"calcat":["踩踏","动","calcat"],"alapa":["拍打","动","alapa"],"calcitr":["踢","动","calcitr"],"gest":["扛抬","动","gest"],"innu":["点头示意","动","innu"],"renu":["摇头拒绝","动","renu"],"suffl":["吹气","动","suffl"],"sibil":["吹哨","动","sibil"],"scalpt":["搔","动","scalpt"],"tunde":["捶打","动","tunde"],"nut":["摆动","动","nut"],"titub":["踉跄","动","titub"],"claudic":["跛行","动","claudic"],"gress":["迈步","动","gress"],"sess":["坐姿","动","sess"],"fricat":["揉搓","动","fricat"],"laevis":["平滑","性","laevis"],"crepit":["噼啪","性","crepit"],"strid":["刺耳","性","strid"],"murmur":["低语声","性","murmur"],"susurr":["窸窣","性","susurr"],"fragr":["芬芳","性","fragr"],"putid":["恶臭","性","putid"],"sapid":["有味","性","sapid"],"insuls":["无味","性","insuls"],"squal":["污秽","性","squal"],"limpid":["清澈","性","limpid"],"turbid":["浑浊","性","turbid"],"lucid":["明亮","性","lucid"],"tenebr":["幽暗","性","tenebr"],"pallid":["苍白","性","pallid"],"ferrugin":["铁锈色","性","ferrugin"],"ianthin":["紫罗兰色","性","ianthin"],"punic":["绛红","性","punic"],"smaragd":["翠绿","性","smaragd"],"sapphir":["天蓝","性","sapphir"],"amethyst":["紫晶","性","amethyst"],"ochr":["赭石","性","ochr"],"miniat":["朱红","性","miniat"],"nive":["雪白","性","nive"],"fulgid":["闪耀","性","fulgid"],"primav":["早春","物","primav"],"hiem":["严冬","物","hiem"],"canic":["伏天","物","canic"],"nival":["降雪","物","nival"],"pluvial":["雨季","物","pluvial"],"siccit":["旱季","物","siccit"],"aestiv":["夏令","物","aestiv"],"vernal":["春令","物","vernal"],"nubos":["多云","物","nubos"],"fulmin":["打雷","物","fulmin"],"grandin":["下雹","物","grandin"],"pruin":["结霜","物","pruin"],"roran":["降露","物","roran"],"calig":["雾霭","物","calig"],"flatus":["阵风","物","flatus"],"afflat":["吹拂","物","afflat"],"imbrif":["多雨","物","imbrif"],"gelid":["严寒","物","gelid"],"tepor":["微温","物","tepor"],"umbrat":["荫凉","物","umbrat"],"apric":["向阳","物","apric"],"roscid":["带露","物","roscid"],"nimbos":["阴云","物","nimbos"],"ventos":["多风","物","ventos"],"frigor":["寒气","物","frigor"],"vehicul":["车辆","物","vehicul"],"carpent":["车架","物","carpent"],"cisi":["轻车","物","cisi"],"essed":["战车","物","essed"],"carruc":["篷车","物","carruc"],"lectic":["肩舆","物","lectic"],"stiva":["车辕","物","stiva"],"temo":["车辕","物","temo"],"canth":["轮辋","物","canth"],"modiol":["轮毂","物","modiol"],"iugum":["轭","物","iugum"],"habena":["缰绳","物","habena"],"fren":["马嚼","物","fren"],"mutat":["换马","物","mutat"],"tabell":["信使","物","tabell"],"rheda":["四轮车","物","rheda"],"clabul":["货车","物","clabul"],"remig":["划桨","物","remig"],"velific":["扬帆","物","velific"],"navig":["航行","物","navig"],"prora":["船首","物","prora"],"puppis":["船尾","物","puppis"],"malus":["桅","物","malus"],"antemna":["帆桁","物","antemna"],"rudens":["缆绳","物","rudens"],"venalic":["贩卖","物","venalic"],"auctio":["拍卖","物","auctio"],"licitat":["竞价","物","licitat"],"campon":["店主","物","campon"],"propola":["零售商","物","propola"],"sector":["囤积者","物","sector"],"argentar":["钱庄","物","argentar"],"mensari":["兑换商","物","mensari"],"trapezit":["钱商","物","trapezit"],"syngraph":["借据","物","syngraph"],"apocha":["收据","物","apocha"],"portitor":["承运人","物","portitor"],"naulum":["运费","物","naulum"],"vectura":["运输","物","vectura"],"mercim":["货物","物","mercim"],"promptuar":["货栈","物","promptuar"],"apotheca":["货仓","物","apotheca"],"empori":["商埠","物","empori"],"redempt":["赎买","物","redempt"],"redemptor":["承包人","物","redemptor"],"locator":["出租人","物","locator"],"fructuar":["收益人","物","fructuar"],"impensa":["开销","物","impensa"],"sumptus":["费用","物","sumptus"],"lucellum":["小利","物","lucellum"],"satio":["播种","动","satio"],"plantat":["栽种","动","plantat"],"sarri":["除草","动","sarri"],"runca":["拔草","动","runca"],"mess":["收割","动","mess"],"tritur":["脱粒","动","tritur"],"ventil":["扬谷","动","ventil"],"granar":["谷仓","物","granar"],"frug":["收成","物","frug"],"noval":["休耕地","物","noval"],"hiberna":["越冬","动","hiberna"],"pecuaria":["畜牧","动","pecuaria"],"mulctr":["挤奶","动","mulctr"],"tonsur":["剪毛","动","tonsur"],"veller":["羊毛","物","veller"],"apicul":["养蜂","动","apicul"],"sericu":["养蚕","动","sericu"],"vivarium":["养殖场","物","vivarium"],"compasc":["共牧","动","compasc"],"clausur":["围圈","动","clausur"],"olivet":["橄榄园","物","olivet"],"viridari":["花园","物","viridari"],"rosari":["玫瑰园","物","rosari"],"herbari":["草药园","物","herbari"],"falc":["镰刀","物","falc"],"figul":["陶工","动","figul"],"coctur":["烧制","动","coctur"],"emal":["珐琅","动","emal"],"frit":["釉料","动","frit"],"vitrif":["成玻璃","动","vitrif"],"fusor":["铸工","动","fusor"],"flatil":["吹制","动","flatil"],"politor":["磨工","动","politor"],"fullon":["漂洗工","动","fullon"],"ting":["染色","动","ting"],"textrin":["织坊","动","textrin"],"netr":["纺纱","动","netr"],"lanific":["毛纺","动","lanific"],"pellio":["皮匠","动","pellio"],"coriar":["制革","动","coriar"],"sarcinat":["缝补匠","动","sarcinat"],"sutrin":["鞋匠铺","动","sutrin"],"scob":["木屑","动","scob"],"rasur":["刨花","动","rasur"],"torn":["旋削","动","torn"],"caelam":["錾刻","动","caelam"],"bractea":["金箔","动","bractea"],"murex":["骨螺紫","动","murex"],"purpurar":["染坊","动","purpurar"],"lanari":["毛织工","动","lanari"],"sphygm":["脉搏","动","sphygm"],"arteri":["动脉","动","arteri"],"medull":["骨髓","动","medull"],"tendin":["肌腱","动","tendin"],"articul":["关节","动","articul"],"cartilag":["软骨","动","cartilag"],"ligament":["韧带","动","ligament"],"glandul":["腺","动","glandul"],"splen":["脾","动","splen"],"vesic":["膀胱","动","vesic"],"ureter":["输尿管","动","ureter"],"phleb":["静脉","动","phleb"],"gangli":["神经节","动","gangli"],"synaps":["突触","动","synaps"],"neuron":["神经元","动","neuron"],"cerebr":["大脑","动","cerebr"],"cerebell":["小脑","动","cerebell"],"lymph":["淋巴","动","lymph"],"serum":["血清","动","serum"],"plasma":["血浆","动","plasma"],"hormon":["激素","动","hormon"],"enzym":["酶","动","enzym"],"vitamin":["维生素","动","vitamin"],"febrif":["退热","动","febrif"],"sedat":["镇静","动","sedat"],"expect":["期待","性","expect"],"disapp":["失望","性","disapp"],"paenit":["后悔","性","paenit"],"haesit":["犹豫","性","haesit"],"destin":["决意","性","destin"],"confirm":["确认","性","confirm"],"trepid":["慌乱","性","trepid"],"solac":["慰藉","性","solac"],"cruci":["煎熬","性","cruci"],"animat":["振作","性","animat"],"despond":["消沉","性","despond"],"elat":["得意","性","elat"],"abject":["自弃","性","abject"],"pudibund":["羞怯","性","pudibund"],"aequanim":["平静","性","aequanim"],"perturb":["烦乱","性","perturb"],"concitat":["激动","性","concitat"],"langu":["倦怠","性","langu"],"alacr":["振奋","性","alacr"],"indign":["愤慨","性","indign"],"obsequ":["顺从","性","obsequ"],"contumac":["倔强","性","contumac"],"impavid":["无畏","性","impavid"],"exsult":["雀跃","性","exsult"],"lament":["哀叹","性","lament"],"congrat":["道贺","动","congrat"],"invit":["邀请","动","invit"],"epul":["宴飨","动","epul"],"propin":["敬酒","动","propin"],"officios":["殷勤","动","officios"],"comitat":["礼让","动","comitat"],"urbanit":["文雅","动","urbanit"],"rusticit":["粗鲁","动","rusticit"],"assent":["附和","动","assent"],"obtrect":["贬损","动","obtrect"],"maledict":["咒骂","动","maledict"],"congress":["会面","动","congress"],"conloq":["交谈","动","conloq"],"sermocin":["闲谈","动","sermocin"],"facet":["诙谐","动","facet"],"conviva":["同席","动","conviva"],"familiar":["亲近","动","familiar"],"gratios":["承欢","动","gratios"],"obviam":["迎候","动","obviam"],"deduct":["送行","动","deduct"],"prosequ":["送别","动","prosequ"],"sectat":["随从","动","sectat"],"assect":["侍从","动","assect"],"lepor":["风趣","动","lepor"],"comis":["和蔼","动","comis"],"cacumen":["山峰","物","cacumen"],"cliv":["山坡","物","cliv"],"convall":["峡谷","物","convall"],"antrum":["洞穴","物","antrum"],"spelunc":["岩洞","物","spelunc"],"cataract":["瀑布","物","cataract"],"torren":["急流","物","torren"],"tundr":["冻原","物","tundr"],"crater":["火山口","物","crater"],"fumarol":["喷气孔","物","fumarol"],"scatebr":["泉源","物","scatebr"],"rup":["峭壁","物","rup"],"moles":["巨岩","物","moles"],"cautes":["礁石","物","cautes"],"scopul":["礁岩","物","scopul"],"dune":["沙丘","物","dune"],"loam":["壤土","物","loam"],"marl":["泥灰","物","marl"],"peat":["泥炭","物","peat"],"bog":["泥沼","物","bog"],"moor":["荒沼","物","moor"],"heath":["石南荒原","物","heath"],"steppe":["草原","物","steppe"],"savanna":["稀树草原","物","savanna"],"jungle":["丛林","物","jungle"],"administr":["行政","物","administr"],"regim":["政体","物","regim"],"rescript":["敕答","物","rescript"],"diplom":["文书","物","diplom"],"codicill":["附敕","物","codicill"],"formul":["程式","物","formul"],"procurat":["代理","物","procurat"],"praefec":["长官署","物","praefec"],"proconsul":["总督","物","proconsul"],"internunt":["中介","物","internunt"],"praetori":["禁卫","物","praetori"],"comitatus":["随从","物","comitatus"],"scrini":["档案库","物","scrini"],"magistrat":["官职","物","magistrat"],"quaestur":["财务官署","物","quaestur"],"censur":["监察职","物","censur"],"tribunat":["护民官职","物","tribunat"],"consulat":["执政官职","物","consulat"],"dictatur":["独裁职","物","dictatur"],"princeps":["元首","物","princeps"],"equester":["骑士阶","物","equester"],"apparit":["侍从官","物","apparit"],"lictor":["扈从","物","lictor"],"lis":["诉讼","动","lis"],"controvers":["争讼","动","controvers"],"cognitio":["审理","动","cognitio"],"testimon":["证言","动","testimon"],"pandect":["法典","动","pandect"],"digest":["汇纂","动","digest"],"institut":["法学阶梯","动","institut"],"novell":["新敕","动","novell"],"supplic":["请愿","动","supplic"],"intercess":["异议","动","intercess"],"veto":["否决","动","veto"],"tribunic":["否决权","动","tribunic"],"cognitor":["诉讼代理人","动","cognitor"],"procurator":["代诉人","动","procurator"],"delator":["告发者","动","delator"],"vindex":["担保人","动","vindex"],"fideiussor":["保证人","动","fideiussor"],"hypothec":["抵押","动","hypothec"],"mancip":["要式买卖","动","mancip"],"nexum":["债务奴役","动","nexum"],"addict":["判归债主","动","addict"],"obnox":["负债","动","obnox"],"poenal":["刑罚的","动","poenal"],"exsil":["流放","动","exsil"],"deport":["放逐","动","deport"],"dimens":["尺寸","物","dimens"],"interstit":["间隙","物","interstit"],"ponder":["称重","物","ponder"],"cubat":["容积","物","cubat"],"convers":["换算","物","convers"],"scalae":["标尺","物","scalae"],"calibr":["校准","物","calibr"],"uncial":["一寸的","物","uncial"],"pedal":["一尺的","物","pedal"],"libral":["一磅的","物","libral"],"cyath":["杯量","物","cyath"],"sextar":["升量","物","sextar"],"hemin":["半升","物","hemin"],"choenix":["日粮量","物","choenix"],"medimn":["斗量","物","medimn"],"congius":["加仑量","物","congius"],"metric":["度量学","物","metric"],"geodes":["测地","物","geodes"],"hypsom":["测高","物","hypsom"],"thermom":["温度计","物","thermom"],"chronom":["精密计时","物","chronom"],"odomet":["计程","物","odomet"],"peramb":["测距轮","物","peramb"],"aequipond":["配重","物","aequipond"],"examen":["衡器","物","examen"],"sustent":["维系","物","sustent"],"pollut":["污染","物","pollut"],"contamin":["玷污","物","contamin"],"purific":["净化","物","purific"],"recycl":["循环","物","recycl"],"diversit":["多样","物","diversit"],"extinct":["灭绝","物","extinct"],"endang":["濒危","物","endang"],"sanctuar":["保护区","物","sanctuar"],"reserv":["保留","物","reserv"],"reforest":["再造林","物","reforest"],"afforest":["造林","物","afforest"],"drainag":["排水","物","drainag"],"desali":["脱盐","物","desali"],"fertil":["肥沃","物","fertil"],"saliniz":["盐渍化","物","saliniz"],"laterit":["红土","物","laterit"],"humif":["腐殖化","物","humif"],"compost":["堆肥","物","compost"],"conservat":["养护","物","conservat"],"parcim":["节约","物","parcim"],"frugal":["俭朴","物","frugal"],"sterilit":["贫瘠","物","sterilit"],"silvicul":["育林","物","silvicul"],"piscicul":["养鱼","物","piscicul"],"mola":["磨粉","物","mola"],"subig":["揉面","物","subig"],"elix":["熬煮","物","elix"],"acet":["醋","物","acet"],"gar":["鱼酱","物","gar"],"sapa":["浓浆","物","sapa"],"defrut":["果浆","物","defrut"],"salit":["腌渍","物","salit"],"fumig":["熏制","物","fumig"],"siccat":["风干","物","siccat"],"tost":["烘烤","物","tost"],"pins":["捣饼","物","pins"],"crust":["酥皮","物","crust"],"placen":["薄饼","物","placen"],"libum":["糕","物","libum"],"pulment":["羹","物","pulment"],"condim":["佐料","物","condim"],"cinnam":["肉桂","物","cinnam"],"zingib":["姜","物","zingib"],"passum":["果干","物","passum"],"must":["新酒","物","must"],"mulsum":["蜜酒","物","mulsum"],"lora":["淡酒","物","lora"],"amyl":["淀粉","物","amyl"],"gelat":["胶冻","物","gelat"],"collar":["衣领","物","collar"],"manic":["袖","物","manic"],"sinu":["衣褶","物","sinu"],"instita":["缘饰","物","instita"],"nodus":["纽结","物","nodus"],"sutur":["缝线","物","sutur"],"pannic":["衬里","物","pannic"],"chirot":["手套","物","chirot"],"tibial":["胫衣、袜","物","tibial"],"caligu":["长靴","物","caligu"],"sagum":["斗篷","物","sagum"],"paenul":["披风","物","paenul"],"perizo":["围裙","物","perizo"],"amicu":["披肩","物","amicu"],"velam":["面纱","物","velam"],"crinal":["簪","物","crinal"],"limbus":["缘带","物","limbus"],"clavus":["紫条纹","物","clavus"],"filum":["丝线","物","filum"],"fusus":["纺锤","物","fusus"],"pecten":["筘","物","pecten"],"tela":["织布","物","tela"],"mitra":["头巾","物","mitra"],"galer":["皮帽","物","galer"],"cucull":["兜帽","物","cucull"],"cortil":["庭院","物","cortil"],"pergul":["露台","物","pergul"],"clathr":["栏杆","物","clathr"],"luminar":["天窗","物","luminar"],"fumarium":["烟囱","物","fumarium"],"cellar":["地窖","物","cellar"],"tabulat":["阁楼","物","tabulat"],"equile":["马厩","物","equile"],"alveus":["水槽","物","alveus"],"peribol":["围墙","物","peribol"],"propyl":["门廊","物","propyl"],"tectorium":["灰泥","物","tectorium"],"culmen":["屋脊","物","culmen"],"fastig":["山墙","物","fastig"],"hypoca":["地暖","物","hypoca"],"lacunar":["藻井","物","lacunar"],"antefix":["檐饰","物","antefix"],"acrote":["山花饰","物","acrote"],"stylob":["台基","物","stylob"],"metopa":["间板","物","metopa"],"trigly":["三联槽","物","trigly"],"architr":["额枋","物","architr"],"zophor":["饰带","物","zophor"],"ambulac":["回廊","物","ambulac"],"xyst":["林荫道","物","xyst"],"frons":["额","物","frons"],"gena":["颊","物","gena"],"mentum":["颏","物","mentum"],"cervix":["颈","物","cervix"],"umerus":["肩","物","umerus"],"cubitus":["肘","物","cubitus"],"carpus":["腕","物","carpus"],"palma":["掌","物","palma"],"talus":["踝","物","talus"],"calcane":["踵","物","calcane"],"dorsum":["背","物","dorsum"],"lumbus":["腰","物","lumbus"],"costa":["肋","物","costa"],"pectus":["胸","物","pectus"],"clunis":["臀","物","clunis"],"guttur":["喉","物","guttur"],"pharynx":["咽","物","pharynx"],"superci":["眉","物","superci"],"cilium":["睫","物","cilium"],"pupilla":["瞳","物","pupilla"],"gingiva":["龈","物","gingiva"],"labium":["唇","物","labium"],"bucca":["口腔","物","bucca"],"naris":["鼻孔","物","naris"],"palatum":["腭","物","palatum"],"vepres":["荆棘","物","vepres"],"harundo":["芦苇","物","harundo"],"caries":["腐木","物","caries"],"sarment":["枯枝","物","sarment"],"ramale":["落枝","物","ramale"],"putamen":["果核","物","putamen"],"glans":["橡实","物","glans"],"cupula":["壳斗","物","cupula"],"volva":["菌托","物","volva"],"stipes":["菌柄","物","stipes"],"uligo":["湿地","物","uligo"],"calculus":["卵石","物","calculus"],"furfur":["麸皮","物","furfur"],"palea":["谷壳","物","palea"],"acervus":["堆","物","acervus"],"gemma":["花芽","物","gemma"],"turio":["嫩芽","物","turio"],"surculus":["新枝","物","surculus"],"stolo":["根蘖","物","stolo"],"flagell":["纤枝","物","flagell"],"capreo":["卷须","物","capreo"],"aculeus":["蜂刺","物","aculeus"],"ulva":["水草","物","ulva"],"carex":["苔草","物","carex"],"juncus":["灯芯草","物","juncus"],"fulgor":["闪光","物","fulgor"],"coruscat":["电光","物","coruscat"],"fulmen":["雷击","物","fulmen"],"stilla":["水珠","物","stilla"],"floccus":["雪片","物","floccus"],"ventulus":["微风","物","ventulus"],"flamen":["气流","物","flamen"],"jubar":["星辉","物","jubar"],"penumbra":["半影","物","penumbra"],"scintill":["闪烁","物","scintill"],"mic":["闪耀","物","mic"],"lucifer":["启明星","物","lucifer"],"noctiluc":["夜光","物","noctiluc"],"halitus":["薄雾","物","halitus"],"chasma":["云隙光","物","chasma"],"anthel":["幻日","物","anthel"],"parheli":["幻日","物","parheli"],"aureola":["光晕","物","aureola"],"serenum":["晴空","物","serenum"],"nubilum":["阴天","物","nubilum"],"occasus":["日落","物","occasus"],"ortus":["日出","物","ortus"],"contici":["夜深","物","contici"],"gallic":["鸡鸣时","物","gallic"],"dilucu":["破晓","物","dilucu"],"aequab":["沉稳","性","aequab"],"liberal":["慷慨","性","liberal"],"parc":["吝啬","性","parc"],"probit":["诚实","性","probit"],"fucat":["虚伪","性","fucat"],"fortitud":["勇敢","性","fortitud"],"ignav":["怯懦","性","ignav"],"indulg":["宽容","性","indulg"],"faceti":["幽默","性","faceti"],"serios":["严肃","性","serios"],"versut":["圆滑","性","versut"],"rigid":["耿直","性","rigid"],"suspic":["多疑","性","suspic"],"credul":["轻信","性","credul"],"frugi":["淡泊","性","frugi"],"abstin":["克己","性","abstin"],"intemp":["放纵","性","intemp"],"tenac":["坚韧","性","tenac"],"languid":["颓唐","性","languid"],"fervid":["热忱","性","fervid"],"frigid":["冷漠","性","frigid"],"mansuet":["温驯","性","mansuet"],"trucul":["凶横","性","trucul"],"moros":["乖僻","性","moros"],"scurril":["粗俗","性","scurril"],"consoci":["结社","物","consoci"],"convent":["聚会","物","convent"],"stipem":["募捐","物","stipem"],"discept":["辩论","物","discept"],"reclam":["抗议","物","reclam"],"interced":["调停","物","interced"],"exsequ":["履约","物","exsequ"],"spons":["担保","物","spons"],"mutuum":["赊欠","物","mutuum"],"exsolu":["清偿","物","exsolu"],"decoct":["破产","物","decoct"],"confus":["兼并","物","confus"],"foederat":["结盟","物","foederat"],"defect":["叛离","物","defect"],"secess":["分离","物","secess"],"coit":["联合","物","coit"],"conjur":["盟誓","物","conjur"],"tumult":["骚动","物","tumult"],"coercit":["弹压","物","coercit"],"proscr":["公敌宣告","物","proscr"],"confisc":["没收","物","confisc"],"multat":["罚款","物","multat"],"frument":["征粮","物","frument"],"compar":["比较","物","compar"],"perpens":["权衡","物","perpens"],"refut":["反驳","物","refut"],"conject":["推测","物","conject"],"temer":["臆断","物","temer"],"discern":["明辨","物","discern"],"confund":["混淆","物","confund"],"malint":["误解","物","malint"],"perspicu":["洞见","物","perspicu"],"recogit":["反思","物","recogit"],"excogit":["推敲","物","excogit"],"aestim":["审度","物","aestim"],"deliber":["抉择","物","deliber"],"select":["取舍","物","select"],"dijud":["辨析","物","dijud"],"sentisc":["体察","物","sentisc"],"compreh":["领悟","物","compreh"],"cognos":["参悟","物","cognos"],"praesag":["预判","物","praesag"],"retros":["回顾","物","retros"],"dubit":["质疑","物","dubit"],"notion":["概念","物","notion"],"examin":["审查","物","examin"],"fascic":["束","物","fascic"],"manip":["把、束","物","manip"],"corymb":["串","物","corymb"],"strues":["堆","物","strues"],"turba":["人群","物","turba"],"caterva":["队","物","caterva"],"globus":["团","物","globus"],"gutta":["滴","物","gutta"],"micul":["粒","物","micul"],"triens":["三分之一","物","triens"],"duplus":["双倍","物","duplus"],"triplus":["三倍","物","triplus"],"quadrupl":["四倍","物","quadrupl"],"nemo":["无人","物","nemo"],"quotus":["第几","物","quotus"],"tantun":["同量","物","tantun"],"quantul":["少许","物","quantul"],"tantil":["些微","物","tantil"],"aliquan":["若干","物","aliquan"],"singuli":["各一","物","singuli"],"bini":["每二","物","bini"],"terni":["每三","物","terni"],"seni":["每六","物","seni"],"viceni":["每二十","物","viceni"],"centeni":["每百","物","centeni"],"tremor":["震响","物","tremor"],"eruptio":["喷发","物","eruptio"],"lava":["熔岩","物","lava"],"inundat":["泛滥","物","inundat"],"alluvio":["冲积","物","alluvio"],"diluvies":["洪泛","物","diluvies"],"ariditas":["干旱","物","ariditas"],"turbo":["旋风","物","turbo"],"vortex":["漩涡","物","vortex"],"fissura":["裂缝","物","fissura"],"labes":["崩塌","物","labes"],"crepitus":["爆裂声","物","crepitus"],"sonitus":["轰鸣","物","sonitus"],"terraem":["地震","物","terraem"],"incend":["大火","物","incend"],"naufrag":["海难","物","naufrag"],"calamit":["灾祸","物","calamit"],"vorago":["深渊漩涡","物","vorago"],"barath":["深渊","物","barath"],"thorax":["胸甲","物","thorax"],"ocrea":["胫甲","物","ocrea"],"parma":["圆盾","物","parma"],"clypeus":["圆盾","物","clypeus"],"pugio":["短剑","物","pugio"],"sica":["曲剑","物","sica"],"spatha":["长剑","物","spatha"],"lancea":["长枪","物","lancea"],"tragula":["轻标枪","物","tragula"],"funda":["投石索","物","funda"],"insigne":["徽记","物","insigne"],"balteus":["腰带","物","balteus"],"verutum":["重标枪","物","verutum"],"matteris":["重矛","物","matteris"],"cateia":["战槌","物","cateia"],"caestus":["拳套","物","caestus"],"clava":["棍棒","物","clava"],"fustis":["短棍","物","fustis"],"contus":["长杆","物","contus"],"sarissa":["长矛","物","sarissa"],"romphae":["巨剑","物","romphae"],"bipennis":["双刃斧","物","bipennis"],"dolabra":["锛斧","物","dolabra"],"harpe":["弯刀","物","harpe"],"tormentum":["弩炮","物","tormentum"],"dominus":["主人、先生","物","dominus"],"domina":["女主人","物","domina"],"senior":["长者","物","senior"],"iunior":["晚辈","物","iunior"],"hospes":["客人","物","hospes"],"patronus":["恩主","物","patronus"],"collega":["同僚","物","collega"],"affinis":["姻亲","物","affinis"],"avuncu":["叔伯","物","avuncu"],"amita":["姑姨","物","amita"],"socer":["岳父","物","socer"],"socrus":["岳母","物","socrus"],"gener":["女婿","物","gener"],"nurus":["儿媳","物","nurus"],"levir":["夫兄","物","levir"],"privig":["继子","物","privig"],"vitricus":["继父","物","vitricus"],"noverca":["继母","物","noverca"],"comes":["侍从","物","comes"],"famulus":["仆从","物","famulus"],"ancilla":["婢女","物","ancilla"],"verna":["家生奴","物","verna"],"nutrix":["乳母","物","nutrix"],"tutor":["监护人","物","tutor"],"hospita":["女主人","物","hospita"],"statura":["身材","性","statura"],"procer":["高大","性","procer"],"pumilus":["矮小","性","pumilus"],"obesus":["肥胖","性","obesus"],"macilent":["瘦削","性","macilent"],"formos":["俊美","性","formos"],"deform":["丑陋","性","deform"],"robust":["健壮","性","robust"],"debilit":["衰弱","性","debilit"],"canus":["白发","性","canus"],"calvus":["秃顶","性","calvus"],"barbat":["有须","性","barbat"],"comat":["长发","性","comat"],"luscus":["独眼","性","luscus"],"claudus":["跛足","性","claudus"],"gibber":["驼背","性","gibber"],"strenuus":["矫健","性","strenuus"],"agilis":["灵巧","性","agilis"],"torosus":["肌肉发达","性","torosus"],"pallens":["苍白","性","pallens"],"rubens":["红润","性","rubens"],"stigma":["烙印","性","stigma"],"livor":["青紫","性","livor"],"vibex":["鞭痕","性","vibex"],"loquac":["多言","动","loquac"],"taciturn":["寡言","动","taciturn"],"argut":["巧辩","动","argut"],"blandil":["甜言","动","blandil"],"iura":["立誓","动","iura"],"cachinn":["大笑","动","cachinn"],"subrid":["微笑","动","subrid"],"gem":["呻吟","动","gem"],"eiul":["哀号","动","eiul"],"querul":["抱怨","动","querul"],"obtest":["恳求","动","obtest"],"obsecr":["哀求","动","obsecr"],"minit":["威胁","动","minit"],"increpit":["斥责","动","increpit"],"exprobr":["责难","动","exprobr"],"convic":["辱骂","动","convic"],"suggill":["讥讽","动","suggill"],"subsann":["嘲笑","动","subsann"],"dissent":["异议","动","dissent"],"peror":["陈词","动","peror"],"declam":["朗诵","动","declam"],"recit":["背诵","动","recit"],"pronun":["宣告","动","pronun"],"praelo":["开场白","动","praelo"],"epilog":["结语","动","epilog"],"incant":["吟唱施法","动","incant"],"excant":["解咒","动","excant"],"devov":["诅咒","动","devov"],"exsecr":["咒逐","动","exsecr"],"run":["符文","动","run"],"glyph":["刻符","动","glyph"],"tessera":["符牌","动","tessera"],"amulet":["护符","动","amulet"],"talisman":["法宝","动","talisman"],"philtrum":["迷药","动","philtrum"],"venefic":["施毒","动","venefic"],"malefic":["邪术","动","malefic"],"benefic":["善术","动","benefic"],"goet":["巫术","动","goet"],"magir":["法术","动","magir"],"sortil":["抽签占卜","动","sortil"],"abjur":["弃誓","动","abjur"],"adjur":["严令","动","adjur"],"imprec":["祈祸","动","imprec"],"deprec":["祈免","动","deprec"],"arcane":["秘传","动","arcane"],"esoter":["秘教","动","esoter"],"exoter":["显教","动","exoter"],"hierat":["圣职的","动","hierat"],"telet":["入教礼","动","telet"],"affix":["附着","动","affix"],"adhaer":["黏附","动","adhaer"],"concit":["激起","动","concit"],"impell":["驱动","动","impell"],"transmut":["嬗变","动","transmut"],"phaenom":["现象","动","phaenom"],"inhib":["抑制","动","inhib"],"amplif":["放大","动","amplif"],"attenu":["衰减","动","attenu"],"refract":["折射","动","refract"],"reflect":["反射","动","reflect"],"absorb":["吸收","动","absorb"],"emitt":["发射","动","emitt"],"diffus":["扩散","动","diffus"],"polar":["极性","动","polar"],"aether":["以太","动","aether"],"quinte":["第五元素","动","quinte"],"phlogist":["燃素","动","phlogist"],"mana":["玛那","动","mana"],"virtu":["德能","动","virtu"],"elan":["活力","动","elan"],"chakra":["脉轮","动","chakra"],"prana":["气","动","prana"],"telesm":["法器","动","telesm"],"arcanum":["奥秘","动","arcanum"],"illumin":["照亮","动","illumin"],"obscur":["使暗、蔽","动","obscur"],"lassit":["疲乏","动","lassit"],"palpit":["心悸","动","palpit"],"sudor":["汗","动","sudor"],"lacrima":["泪","动","lacrima"],"saliva":["唾液","动","saliva"],"mucus":["鼻涕","动","mucus"],"urina":["尿","动","urina"],"pulsus":["脉搏","动","pulsus"],"torpor":["麻木","动","torpor"],"rigor":["寒战","动","rigor"],"vigor":["精力","动","vigor"],"stamina":["耐力","动","stamina"],"sopor":["昏睡","动","sopor"],"letarg":["昏睡症","动","letarg"],"syncop":["晕厥","动","syncop"],"spasm":["痉挛","动","spasm"],"tetan":["强直","动","tetan"],"prurig":["痒症","动","prurig"],"rubor":["红肿","动","rubor"],"algid":["酷寒感","动","algid"],"aestumat":["燥热","动","aestumat"],"inedia":["绝食","动","inedia"],"crapula":["宿醉","动","crapula"],"ebriet":["醉酒","动","ebriet"],"aestus":["潮汐","物","aestus"],"access":["涨潮","物","access"],"recess":["落潮","物","recess"],"fluctus":["浪头","物","fluctus"],"brevia":["浅滩","物","brevia"],"canalis":["航道","物","canalis"],"navale":["船坞","物","navale"],"latera":["舷侧","物","latera"],"constrat":["甲板","物","constrat"],"saburra":["压舱","物","saburra"],"remex":["桨手","物","remex"],"gubernator":["舵手","物","gubernator"],"proreta":["领航","物","proreta"],"nautic":["航海术","物","nautic"],"acta":["海岸","物","acta"],"salum":["海涌","物","salum"],"pontus":["深海","物","pontus"],"aequor":["海面","物","aequor"],"remigi":["桨列","物","remigi"],"velum":["帆","物","velum"],"syrtic":["暗沙","物","syrtic"],"charyb":["大漩涡","物","charyb"],"scyll":["礁岩","物","scyll"],"harpax":["钩锚","物","harpax"],"sentina":["舱底污水","物","sentina"],"venabu":["猎矛","动","venabu"],"pedica":["捕兽夹","动","pedica"],"aucup":["捕鸟","动","aucup"],"sagena":["拖网","动","sagena"],"nassa":["鱼笼","动","nassa"],"indago":["围猎","动","indago"],"vestig":["追踪","动","vestig"],"latibu":["兽穴","动","latibu"],"spolium":["猎物皮","动","spolium"],"exuvi":["蜕壳","动","exuvi"],"collect":["采集","动","collect"],"baca":["浆果","动","baca"],"casses":["罗网","动","casses"],"plaga":["网罗","动","plaga"],"tendic":["绊索","动","tendic"],"decipula":["陷阱","动","decipula"],"fovea":["陷坑","动","fovea"],"cuspis":["矛尖","动","cuspis"],"esca":["诱饵","动","esca"],"illece":["诱物","动","illece"],"visci":["粘鸟胶","动","visci"],"trophae":["猎获纪念","动","trophae"],"aucupat":["捕鸟者","动","aucupat"],"venatric":["女猎手","动","venatric"],"decoqu":["熬煮","动","decoqu"],"excoqu":["煎干","动","excoqu"],"incoqu":["炖","动","incoqu"],"percoq":["炖烂","动","percoq"],"subfri":["微煎","动","subfri"],"inass":["入炉烤","动","inass"],"farc":["填料","动","farc"],"infund":["倾注","动","infund"],"perfund":["浇淋","动","perfund"],"asperg":["洒","动","asperg"],"consperg":["撒粉","动","consperg"],"inting":["蘸","动","inting"],"sorbill":["啜","动","sorbill"],"exsug":["吮","动","exsug"],"cremor":["浓汤","动","cremor"],"iuscul":["薄汤","动","iuscul"],"offula":["肉片","动","offula"],"sorbitio":["饮剂","动","sorbitio"],"frustum":["块","动","frustum"],"segmen":["片","动","segmen"],"buccel":["一口","动","buccel"],"daps":["盛宴","动","daps"],"ferculum":["菜肴","动","ferculum"],"oenopho":["酒器","动","oenopho"],"patella":["浅锅","动","patella"],"pens":["纺线","动","pens"],"colus":["纺锤杆","动","colus"],"carmin":["梳理","动","carmin"],"trama":["纬线","动","trama"],"subteg":["纬纱","动","subteg"],"licium":["综线","动","licium"],"insili":["经线","动","insili"],"mordant":["媒染","动","mordant"],"alumen":["明矾","动","alumen"],"coccum":["胭脂虫红","动","coccum"],"indig":["靛蓝","动","indig"],"glastum":["菘蓝","动","glastum"],"rubia":["茜草","动","rubia"],"crocus":["番红花","动","crocus"],"netrix":["纺女","动","netrix"],"fullonica":["漂洗坊","动","fullonica"],"tinctor":["染工","动","tinctor"],"calamis":["烫褶器","动","calamis"],"carbasum":["细麻","动","carbasum"],"polymita":["多色织物","动","polymita"],"plumat":["羽织","动","plumat"],"scutul":["方格纹","动","scutul"],"undulata":["波纹","动","undulata"],"gausapa":["绒面","动","gausapa"],"trilix":["三股线","动","trilix"],"domit":["驯服","动","domit"],"iug":["套轭","动","iug"],"mansue":["驯化","动","mansue"],"allig":["拴系","动","allig"],"admiss":["配种","动","admiss"],"fetus":["产仔","动","fetus"],"sagin":["育肥","动","sagin"],"castrat":["去势","动","castrat"],"inust":["烙印","动","inust"],"agit":["驱赶","动","agit"],"revoc":["唤回","动","revoc"],"stabul":["厩养","动","stabul"],"praese":["饲槽","动","praese"],"pabulum":["草料","动","pabulum"],"adaqu":["饮水","动","adaqu"],"sericar":["蚕室","动","sericar"],"alvear":["蜂箱","动","alvear"],"bubul":["牧牛人","动","bubul"],"opilio":["牧羊人","动","opilio"],"subulc":["牧猪人","动","subulc"],"equiso":["马夫","动","equiso"],"capistr":["笼头","动","capistr"],"fiscella":["草编食篮","动","fiscella"],"forceps":["钳","动","forceps"],"stimul":["刺棒","动","stimul"],"intue":["凝视","动","intue"],"conspic":["注视","动","conspic"],"adspect":["瞥见","动","adspect"],"limis":["斜视","动","limis"],"prospic":["远眺","动","prospic"],"perscrut":["细察","动","perscrut"],"scrut":["探究","动","scrut"],"auscult":["倾听","动","auscult"],"degust":["品尝","动","degust"],"attrect":["触摸","动","attrect"],"contrect":["抚弄","动","contrect"],"tent":["试探","动","tent"],"negleg":["忽略","动","negleg"],"contu":["打量","动","contu"],"subleg":["偷听","动","subleg"],"rim":["窥探","动","rim"],"obtut":["凝视","动","obtut"],"tuit":["注视","动","tuit"],"conniv":["闭眼","动","conniv"],"olfact":["嗅闻","动","olfact"],"contempl":["默观","动","contempl"],"persent":["觉察","动","persent"],"animad":["留意","动","animad"],"reper":["发现","动","reper"],"nutus":["颔首","动","nutus"],"renutus":["摇头","动","renutus"],"subrisus":["浅笑","动","subrisus"],"fletus":["哭泣","动","fletus"],"gemitus":["叹息","动","gemitus"],"suspir":["长叹","动","suspir"],"stupor":["呆滞","动","stupor"],"fremitus":["咬牙","动","fremitus"],"stridor":["咬牙声","动","stridor"],"torvi":["凶相","动","torvi"],"hilarit":["喜色","动","hilarit"],"tristit":["愁容","动","tristit"],"severit":["严厉神色","动","severit"],"verecun":["赧色","动","verecun"],"constan":["镇定","动","constan"],"iactant":["得意之色","动","iactant"],"fastus":["傲慢之色","动","fastus"],"maestit":["悲戚","动","maestit"],"habitus":["举止","动","habitus"],"gestus":["手势","动","gestus"],"incessus":["步态","动","incessus"],"facies":["面色","动","facies"],"exanim":["失色","动","exanim"],"gradior":["迈步","动","gradior"],"proper":["疾行","动","proper"],"lente":["缓行","动","lente"],"errab":["徘徊","动","errab"],"morat":["逗留","动","morat"],"substit":["驻足","动","substit"],"innit":["倚靠","动","innit"],"recumb":["斜倚","动","recumb"],"assid":["端坐","动","assid"],"procumb":["匍匐","动","procumb"],"result":["跃起","动","result"],"corrui":["栽倒","动","corrui"],"adrep":["匍匐而行","动","adrep"],"circumi":["环行","动","circumi"],"praegred":["先行","动","praegred"],"subsequ":["随行","动","subsequ"],"obambul":["踱步","动","obambul"],"deambul":["散步","动","deambul"],"contend":["疾奔","动","contend"],"festin":["赶路","动","festin"],"rept":["爬行","动","rept"],"sublim":["登高","动","sublim"],"nixus":["奋力","动","nixus"],"conat":["尝试","动","conat"],"tardig":["缓步","动","tardig"],"graveol":["浓臭","物","graveol"],"putor":["腐臭","物","putor"],"rancor":["哈喇味","物","rancor"],"nidor":["油烟味","物","nidor"],"sulf":["硫味","物","sulf"],"muria":["咸腥","物","muria"],"nardus":["甘松香","物","nardus"],"tus":["乳香","物","tus"],"myrrha":["没药","物","myrrha"],"balsam":["香膏","物","balsam"],"ambra":["龙涎香","物","ambra"],"mosch":["麝香","物","mosch"],"sandal":["檀香","物","sandal"],"camphor":["樟脑","物","camphor"],"thurib":["香炉","物","thurib"],"acerra":["香盒","物","acerra"],"suffim":["熏香","物","suffim"],"odoram":["香料","物","odoram"],"foetor":["恶臭","物","foetor"],"exhalat":["散出","物","exhalat"],"redol":["散发香气","物","redol"],"olens":["有气味的","物","olens"],"iners":["无味的","物","iners"],"flagran":["气味浓烈","物","flagran"],"dulcedo":["甘味","性","dulcedo"],"amaror":["苦味","性","amaror"],"salsedo":["咸味","性","salsedo"],"austerus":["涩","性","austerus"],"ponticus":["酸涩","性","ponticus"],"oleag":["油润","性","oleag"],"farinac":["粉质","性","farinac"],"friab":["酥脆","性","friab"],"crisp":["酥脆声","性","crisp"],"lentus":["黏韧","性","lentus"],"succulent":["多汁","性","succulent"],"vapidus":["走味","性","vapidus"],"insipidus":["无味","性","insipidus"],"apian":["蜜甜","性","apian"],"nauseos":["令人作呕","性","nauseos"],"fastidios":["倒胃","性","fastidios"],"saturit":["饱腻","性","saturit"],"mellitus":["蜜渍","性","mellitus"],"dulciar":["甜食","性","dulciar"],"bellaria":["甜点","性","bellaria"],"crustulum":["酥点","性","crustulum"],"libari":["糕点","性","libari"],"potulent":["饮品","性","potulent"],"esculent":["食品","性","esculent"],"nitor":["光泽","性","nitor"],"albedo":["皎白","性","albedo"],"nigredo":["黝黑","性","nigredo"],"rubedo":["赤红","性","rubedo"],"viridit":["翠绿","性","viridit"],"caerul":["蔚蓝","性","caerul"],"flavedo":["橙黄","性","flavedo"],"marmorat":["斑驳","性","marmorat"],"opacit":["不透明","性","opacit"],"transluc":["半透","性","transluc"],"perlucid":["透亮","性","perlucid"],"nitens":["润泽","性","nitens"],"levor":["光滑度","性","levor"],"asperit":["粗糙感","性","asperit"],"glabri":["无毛的","性","glabri"],"scabri":["凹凸","性","scabri"],"obscurit":["幽暗","性","obscurit"],"clarit":["明亮","性","clarit"],"colorat":["着色","性","colorat"],"luminesc":["发光","性","luminesc"],"phosphor":["磷光","性","phosphor"],"iridesc":["虹彩","性","iridesc"],"refulg":["返照","性","refulg"],"opert":["遮蔽","性","opert"],"reteg":["显露","性","reteg"],"sonor":["洪亮","性","sonor"],"clangor":["铿锵","性","clangor"],"tinnit":["耳鸣","性","tinnit"],"bombus":["嗡嗡","性","bombus"],"sibilus":["嘶声","性","sibilus"],"ululat":["嚎声","性","ululat"],"plausus":["掌声","性","plausus"],"modulat":["抑扬","性","modulat"],"canor":["旋律美","性","canor"],"disson":["不谐","性","disson"],"conson":["谐和","性","conson"],"fremor":["低沉声","性","fremor"],"raucit":["沙哑","性","raucit"],"arguti":["尖细","性","arguti"],"clariso":["清亮","性","clariso"],"obtusus":["闷响","性","obtusus"],"acut":["尖锐","性","acut"],"perstrep":["喧腾","性","perstrep"],"obstre":["嘈杂","性","obstre"],"stridul":["吱呀","性","stridul"],"modulam":["曲调","性","modulam"],"numeri":["节拍","性","numeri"],"sonorit":["响亮","性","sonorit"],"boatus":["牛鸣声","性","boatus"],"lentor":["黏滞","性","lentor"],"punctur":["刺痛","性","punctur"],"formicat":["发麻","性","formicat"],"ardor":["灼痛","性","ardor"],"morsus":["咬痛","性","morsus"],"pulsat":["搏动","性","pulsat"],"callosit":["茧","性","callosit"],"mollit":["柔软感","性","mollit"],"durit":["坚硬感","性","durit"],"scabies":["疥癣","性","scabies"],"papula":["丘疹","性","papula"],"pustula":["脓疱","性","pustula"],"torridus":["灼热","性","torridus"],"tepid":["微温","性","tepid"],"lubricus":["滑溜","性","lubricus"],"scaber":["粗糙面","性","scaber"],"rasilis":["光滑易磨","性","rasilis"],"mucor":["霉滑","性","mucor"],"scalpor":["刺痛感","性","scalpor"],"algidit":["寒冷","性","algidit"],"calidit":["温热","性","calidit"],"horrip":["起鸡皮","性","horrip"],"tormina":["绞痛","性","tormina"],"mordic":["刺痛","性","mordic"],"praecipi":["坠崖刑","物","praecipi"],"supplicium":["极刑","物","supplicium"],"crux":["十字刑","物","crux"],"flagrum":["鞭","物","flagrum"],"virga":["杖","物","virga"],"compes":["脚镣","物","compes"],"boiae":["项圈枷","物","boiae"],"metallum":["矿役","物","metallum"],"decoll":["斩首","物","decoll"],"patibu":["刑架","物","patibu"],"verber":["笞打","物","verber"],"talio":["同态复仇","物","talio"],"eculeus":["拷问架","物","eculeus"],"ungula":["钳烙","物","ungula"],"lamina":["烙铁","物","lamina"],"catasta":["刑台","物","catasta"],"manicae":["手铐","物","manicae"],"numella":["足枷","物","numella"],"cippus":["木枷","物","cippus"],"cruciat":["酷刑","物","cruciat"],"excarn":["凌迟","物","excarn"],"strangul":["绞杀","物","strangul"],"submer":["溺刑","物","submer"],"ustion":["火刑","物","ustion"],"mulcta":["罚金","物","mulcta"],"dot":["嫁妆","物","dot"],"thalamus":["婚房","物","thalamus"],"pronuba":["伴娘","物","pronuba"],"auspex":["证婚","物","auspex"],"taeda":["婚炬","物","taeda"],"confarr":["麦饼婚","物","confarr"],"repudium":["休婚","物","repudium"],"iustit":["国丧","物","iustit"],"lugubr":["丧服","物","lugubr"],"planctus":["捶胸哀哭","物","planctus"],"naenia":["挽歌","物","naenia"],"rogus":["火葬堆","物","rogus"],"bustum":["火葬场","物","bustum"],"sarcoph":["石棺","物","sarcoph"],"parental":["祭祖节","物","parental"],"inferiae":["祭亡","物","inferiae"],"novendi":["九日祭","物","novendi"],"silicer":["丧宴","物","silicer"],"iusta":["葬礼","物","iusta"],"elogium":["墓志铭","物","elogium"],"cunae":["摇篮","物","cunae"],"togavir":["成年袍","物","togavir"],"deductio":["迎亲","物","deductio"],"pompa":["仪仗","物","pompa"],"fasces":["权标","物","fasces"],"sors":["份额","物","sors"],"symbola":["分摊","物","symbola"],"collecta":["摊派","物","collecta"],"collatio":["凑份","物","collatio"],"pensita":["摊还","物","pensita"],"decuma":["什一税","物","decuma"],"centesi":["百分税","物","centesi"],"vicensi":["二十分税","物","vicensi"],"multa":["罚金","物","multa"],"manubi":["战利品","物","manubi"],"donativ":["赏赐","物","donativ"],"congiar":["赐粮","物","congiar"],"largitio":["赏赉","物","largitio"],"sortit":["抽签分配","物","sortit"],"adsigna":["分配","物","adsigna"],"attribu":["归属","物","attribu"],"dispens":["调度","物","dispens"],"erogat":["发放","物","erogat"],"ratioci":["核算","物","ratioci"],"expensum":["支出账","物","expensum"],"accept":["收入账","物","accept"],"collybus":["兑换率","物","collybus"],"fenerat":["放贷者","物","fenerat"],"peculi":["私产","物","peculi"],"ephipp":["马鞍","物","ephipp"],"stapes":["马镫","物","stapes"],"scutica":["鞭","物","scutica"],"crepida":["蹄铁","物","crepida"],"culcitra":["鞍褥","物","culcitra"],"cingulum":["肚带","物","cingulum"],"calcari":["马刺","物","calcari"],"sagma":["驮架","物","sagma"],"clitell":["驮鞍","物","clitell"],"lupatum":["马衔铁","物","lupatum"],"desultor":["马术师","物","desultor"],"veredus":["驿马","物","veredus"],"caballus":["驽马","物","caballus"],"sonipes":["蹄声马","物","sonipes"],"quadriga":["四马战车","物","quadriga"],"bige":["双马车","物","bige"],"hippoco":["马夫","物","hippoco"],"strator":["马夫","物","strator"],"parhipp":["副马","物","parhipp"],"faler":["马饰","物","faler"],"mulus":["骡","物","mulus"],"burdo":["役骡","物","burdo"],"iument":["役畜","物","iument"],"curso":["跑马","物","curso"],"equirr":["赛马节","物","equirr"],"astrag":["骰骨","动","astrag"],"scacc":["棋子","动","scacc"],"latrunc":["跳棋","动","latrunc"],"pila":["玩球","动","pila"],"harpast":["抢球戏","动","harpast"],"trigon":["三角球戏","动","trigon"],"certamen":["竞赛","动","certamen"],"palaest":["角力场","动","palaest"],"luctam":["角力","动","luctam"],"pancrat":["全能搏斗","动","pancrat"],"discus":["铁饼","动","discus"],"iaculum":["标枪","动","iaculum"],"funamb":["走索","动","funamb"],"praestig":["幻术","动","praestig"],"agon":["竞赛","动","agon"],"athlet":["竞技者","动","athlet"],"gymnic":["竞技的","动","gymnic"],"stadio":["竞走","动","stadio"],"diaul":["往返跑","动","diaul"],"coryc":["练拳袋","动","coryc"],"halter":["哑铃","动","halter"],"sphaeri":["球室","动","sphaeri"],"aleator":["赌徒","动","aleator"],"fritill":["骰筒","动","fritill"],"petaur":["跳板","动","petaur"],"ascesis":["苦修","物","ascesis"],"meditatio":["冥想","物","meditatio"],"ieiunium":["斋戒","物","ieiunium"],"litania":["连祷","物","litania"],"psalmus":["圣咏","物","psalmus"],"monachus":["修士","物","monachus"],"anacho":["隐修者","物","anacho"],"abbas":["院长","物","abbas"],"prioris":["女院长","物","prioris"],"novic":["初学生","物","novic"],"obedientia":["服从","物","obedientia"],"paupertas":["清贫","物","paupertas"],"castitas":["守贞","物","castitas"],"oratorium":["祈祷室","物","oratorium"],"cenobi":["团修院","物","cenobi"],"stupa":["塔庙","物","stupa"],"pagoda":["佛塔","物","pagoda"],"sangha":["僧团","物","sangha"],"bhikkhu":["比丘","物","bhikkhu"],"yogi":["瑜伽士","物","yogi"],"asana":["坐姿","物","asana"],"mantra":["真言","物","mantra"],"sutra":["经","物","sutra"],"dharma":["法理","物","dharma"],"karma":["业","物","karma"],"cephala":["头痛","物","cephala"],"odontal":["牙痛","物","odontal"],"arthrit":["关节炎","物","arthrit"],"podagra":["痛风","物","podagra"],"colic":["绞痛","物","colic"],"diarrh":["腹泻","物","diarrh"],"dysent":["痢疾","物","dysent"],"obstip":["便秘","物","obstip"],"lipoth":["昏厥","物","lipoth"],"convuls":["抽搐","物","convuls"],"paralys":["瘫痪","物","paralys"],"caecit":["失明","物","caecit"],"surdit":["耳聋","物","surdit"],"aphasia":["失语","物","aphasia"],"amnesia":["健忘","物","amnesia"],"icterus":["黄疸","物","icterus"],"hydrops":["水肿","物","hydrops"],"abscess":["脓肿","物","abscess"],"gangrae":["坏疽","物","gangrae"],"febricula":["低热","物","febricula"],"struma":["瘰疬","物","struma"],"variola":["天花","物","variola"],"morbill":["麻疹","物","morbill"],"scarlat":["猩红热","物","scarlat"],"diphthe":["白喉","物","diphthe"],"faex":["酒渣","动","faex"],"vinace":["葡萄渣","动","vinace"],"torcul":["压榨机","动","torcul"],"prelum":["榨机","动","prelum"],"lacus":["酒池","动","lacus"],"cupa":["酒桶","动","cupa"],"penus":["储粮","动","penus"],"silo":["地窖仓","动","silo"],"salitur":["腌藏","动","salitur"],"liquam":["鱼酱汁","动","liquam"],"conditu":["腌渍","动","conditu"],"carnar":["肉库","动","carnar"],"doliar":["桶匠","动","doliar"],"cupar":["桶匠","动","cupar"],"vindemia":["采葡萄","动","vindemia"],"torcular":["榨酒","动","torcular"],"caroen":["煮酒","动","caroen"],"oleari":["油商","动","oleari"],"vinari":["酒商","动","vinari"],"cetari":["鱼商","动","cetari"],"frigida":["冷藏室","动","frigida"],"carnifi":["屠宰场","动","carnifi"],"salsam":["腌鱼","动","salsam"],"salsur":["盐渍","动","salsur"],"fumos":["熏制的","动","fumos"],"discrim":["发缝","物","discrim"],"crinale":["发针","物","crinale"],"pulvis":["粉","物","pulvis"],"cerussa":["铅粉","物","cerussa"],"purpuris":["胭脂","物","purpuris"],"rubrica":["赭红","物","rubrica"],"stibi":["黛","物","stibi"],"unguent":["香膏","物","unguent"],"myrothe":["香油盒","物","myrothe"],"narthe":["药膏盒","物","narthe"],"tonstrin":["剃发铺","物","tonstrin"],"novacula":["剃刀","物","novacula"],"volsella":["镊","物","volsella"],"depil":["拔毛","物","depil"],"smegma":["擦身膏","物","smegma"],"strigilis":["刮身器","物","strigilis"],"sudator":["汗浴室","物","sudator"],"tepidarium":["温浴室","物","tepidarium"],"capilla":["发式","物","capilla"],"ciniflo":["烫发师","物","ciniflo"],"crinis":["发丝","物","crinis"],"collyr":["眼膏","物","collyr"],"psilot":["脱毛药","物","psilot"],"sapo":["皂","物","sapo"],"puella":["女孩","物","puella"],"parvul":["幼童","物","parvul"],"lactens":["乳儿","物","lactens"],"crepund":["摇铃","物","crepund"],"oscill":["小面具","物","oscill"],"turben":["陀螺","物","turben"],"trochus":["铁环","物","trochus"],"pilula":["小球","物","pilula"],"gerula":["育儿嫂","物","gerula"],"ludicrum":["玩物","物","ludicrum"],"crepitac":["摇响器","物","crepitac"],"rhombus":["陀螺","物","rhombus"],"lusus":["游戏","物","lusus"],"nugae":["琐戏","物","nugae"],"gerrae":["玩意儿","物","gerrae"],"inepti":["嬉闹","物","inepti"],"ludibrium":["笑柄玩物","物","ludibrium"],"puerilis":["稚气","物","puerilis"],"vagitus":["婴儿啼","物","vagitus"],"balbut":["咿呀","物","balbut"],"mammula":["儿语妈","物","mammula"],"pusio":["小男孩","物","pusio"],"pusa":["小女孩","物","pusa"],"paegnium":["玩物","物","paegnium"],"infantil":["幼儿的","物","infantil"],"vomer":["犁铧","物","vomer"],"dental":["犁齿","物","dental"],"raster":["耙","物","raster"],"sarcul":["锄","物","sarcul"],"bidens":["双齿锄","物","bidens"],"secula":["镰刀","物","secula"],"vannus":["簸箕","物","vannus"],"tribel":["脱粒器","物","tribel"],"pala":["铲","物","pala"],"rutrum":["锹","物","rutrum"],"ligo":["鹤嘴锄","物","ligo"],"marra":["大锄","物","marra"],"occator":["耙地者","物","occator"],"fossor":["掘土者","物","fossor"],"sator":["播种者","物","sator"],"messor":["收割者","物","messor"],"arator":["耕者","物","arator"],"putator":["修剪者","物","putator"],"fiscina":["草篮","物","fiscina"],"corbis":["粮筐","物","corbis"],"qualus":["篓","物","qualus"],"sporta":["篮筐","物","sporta"],"rutellum":["小锹","物","rutellum"],"marculus":["小锤","物","marculus"],"falcula":["小镰","物","falcula"],"officin":["匠人","物","officin"],"tegular":["瓦匠","物","tegular"],"dealba":["粉刷匠","物","dealba"],"scenogr":["布景师","物","scenogr"],"glutinat":["裱糊匠","物","glutinat"],"clavar":["锁匠","物","clavar"],"serrar":["锯匠","物","serrar"],"vitrar":["玻璃匠","物","vitrar"],"aurif":["金匠","物","aurif"],"argentari":["银器匠","物","argentari"],"lignar":["木匠","物","lignar"],"marmorar":["石匠","物","marmorar"],"calcinar":["烧灰匠","物","calcinar"],"laterar":["砖匠","物","laterar"],"fictor":["塑匠","物","fictor"],"ceropla":["蜡塑匠","物","ceropla"],"coronar":["花冠匠","物","coronar"],"unguentar":["香膏匠","物","unguentar"],"saponar":["制皂匠","物","saponar"],"armamentar":["兵器匠","物","armamentar"],"scutar":["盾匠","物","scutar"],"sellular":["椅匠","物","sellular"],"lecticar":["肩舆匠","物","lecticar"],"tornat":["旋工","物","tornat"],"limat":["锉工","物","limat"],"aula":["宫廷","物","aula"],"regia":["王宫","物","regia"],"palatium":["宫殿","物","palatium"],"thronus":["王座","物","thronus"],"diadema":["王冠","物","diadema"],"sceptrum":["权杖","物","sceptrum"],"infula":["绶带","物","infula"],"audientia":["觐见","物","audientia"],"admissio":["召见","物","admissio"],"salutat":["朝贺","物","salutat"],"processi":["仪仗游行","物","processi"],"nomencl":["唱名官","物","nomencl"],"cubicul":["侍寝官","物","cubicul"],"aulae":["宫人","物","aulae"],"sellacur":["象牙椅","物","sellacur"],"chlamys":["宫袍","物","chlamys"],"paludam":["元帅披风","物","paludam"],"cathedra":["宝座","物","cathedra"],"solium":["御座","物","solium"],"referen":["奏事官","物","referen"],"silentia":["静默官","物","silentia"],"castren":["宫廷总管","物","castren"],"sacella":["库官","物","sacella"],"ostiar":["门官","物","ostiar"],"decanus":["十人长","物","decanus"],"sollemn":["庆典","物","sollemn"],"circens":["竞技会","物","circens"],"saturnal":["农神节","物","saturnal"],"luperca":["牧神节","物","luperca"],"floral":["花神节","物","floral"],"compita":["路口节","物","compita"],"rosali":["玫瑰节","物","rosali"],"amburb":["绕城祭","物","amburb"],"muner":["角斗表演","物","muner"],"naumach":["海战表演","物","naumach"],"bacchan":["酒神节","物","bacchan"],"cereal":["谷神节","物","cereal"],"vestal":["灶神节","物","vestal"],"quirina":["市民节","物","quirina"],"fordici":["孕牛祭","物","fordici"],"ambarva":["田巡祭","物","ambarva"],"terminal":["界石节","物","terminal"],"regifug":["逐王节","物","regifug"],"nefast":["凶日","物","nefast"],"intercal":["闰月","物","intercal"],"vinali":["酒节","物","vinali"],"meditri":["新酒节","物","meditri"],"fontin":["泉节","物","fontin"],"robiga":["祛锈节","物","robiga"],"opali":["丰产节","物","opali"],"schedula":["小签","物","schedula"],"frontis":["扉页","物","frontis"],"praefat":["序言","物","praefat"],"prooemi":["绪论","物","prooemi"],"appendi":["附录","物","appendi"],"marginal":["页边注","物","marginal"],"scholi":["笺注","物","scholi"],"coloph":["题跋","物","coloph"],"explicit":["卷末题","物","explicit"],"incipit":["卷首题","物","incipit"],"quatern":["书帖","物","quatern"],"pugilla":["手札板","物","pugilla"],"diptych":["双折板","物","diptych"],"tripty":["三折板","物","tripty"],"polypty":["多折板","物","polypty"],"subscri":["卷末署名","物","subscri"],"bybl":["纸莎草芯","物","bybl"],"bombyci":["棉纸","物","bombyci"],"pumex":["磨纸石","物","pumex"],"commenta":["注记","物","commenta"],"diar":["日记","物","diar"],"adversa":["杂记","物","adversa"],"capitula":["敕令集","物","capitula"],"breviar":["节本","物","breviar"],"florileg":["花絮集","物","florileg"],"molitura":["磨粉","动","molitura"],"pistur":["舂米","动","pistur"],"cribrat":["筛粉","动","cribrat"],"subact":["揉面","动","subact"],"assatur":["炙烤","动","assatur"],"frictur":["油炸","动","frictur"],"infusio":["浸泡","动","infusio"],"macera":["浸渍","动","macera"],"torrefa":["焙炒","动","torrefa"],"pressur":["压榨","动","pressur"],"gelatio":["冻结","动","gelatio"],"mellif":["酿蜜","动","mellif"],"vinif":["酿酒","动","vinif"],"acetif":["酿醋","动","acetif"],"caseif":["制酪","动","caseif"],"panif":["制面包","动","panif"],"oleif":["榨油","动","oleif"],"saccharif":["制糖","动","saccharif"],"farinari":["磨坊主","动","farinari"],"molito":["磨坊主","动","molito"],"condito":["调味者","动","condito"],"salsamen":["腌鱼匠","动","salsamen"],"carnari":["肉贩","动","carnari"],"cisterna":["蓄水池","物","cisterna"],"rotaqua":["水车","物","rotaqua"],"molaaqu":["水磨","物","molaaqu"],"incile":["引水渠","物","incile"],"emissar":["排水道","物","emissar"],"colare":["滤水","物","colare"],"fistula":["水管","物","fistula"],"castella":["水塔","物","castella"],"hydraul":["水力机械","物","hydraul"],"noria":["水车","物","noria"],"aquilex":["找水人","物","aquilex"],"groma":["测角仪","物","groma"],"choroba":["水准仪","物","choroba"],"dioptra":["测角器","物","dioptra"],"puteal":["井栏","物","puteal"],"substruc":["基堤","物","substruc"],"fulcimen":["支柱","物","fulcimen"],"aquagi":["水道税","物","aquagi"],"navigi":["通航","物","navigi"],"ripa":["河岸","物","ripa"],"molendi":["磨坊","物","molendi"],"siphunc":["小管","物","siphunc"],"canalic":["小渠","物","canalic"],"aquari":["水工","物","aquari"],"librator":["水准测量员","物","librator"],"celox":["快船","物","celox"],"liburna":["轻帆船","物","liburna"],"triremis":["三列桨船","物","triremis"],"quinqueremis":["五列桨船","物","quinqueremis"],"actuaria":["快艇","物","actuaria"],"ponto":["平底船","物","ponto"],"scapha":["小艇","物","scapha"],"horia":["渔船","物","horia"],"onerari":["商船","物","onerari"],"longa":["战船","物","longa"],"lembus":["轻舟","物","lembus"],"cercur":["赛普勒斯船","物","cercur"],"catasco":["侦察船","物","catasco"],"hippago":["运马船","物","hippago"],"schedia":["筏","物","schedia"],"utricul":["皮筏","物","utricul"],"carabus":["柳条艇","物","carabus"],"nauclerus":["船主","物","nauclerus"],"celeus":["桨手长","物","celeus"],"apparat":["索具","物","apparat"],"anquina":["帆脚索","物","anquina"],"scalmus":["桨架","物","scalmus"],"tonsa":["桨叶","物","tonsa"],"portisc":["桨手歌者","物","portisc"],"hortat":["催桨者","物","hortat"],"madeo":["浸湿","动","madeo"],"madid":["湿透","动","madid"],"udus":["潮湿","动","udus"],"bulla":["水泡","动","bulla"],"spuma":["泡沫","动","spuma"],"merso":["沉没","动","merso"],"fluito":["漂浮","动","fluito"],"subsid":["下沉","动","subsid"],"emerg":["浮出","动","emerg"],"stillici":["滴水","动","stillici"],"proluvi":["冲积","动","proluvi"],"colluvi":["淤积","动","colluvi"],"manatio":["涌流","动","manatio"],"profluvi":["流出","动","profluvi"],"redunda":["溢出","动","redunda"],"exundat":["泛滥","动","exundat"],"irrigu":["灌区","动","irrigu"],"aquatio":["取水","动","aquatio"],"haurito":["汲水处","动","haurito"],"umecto":["润湿","动","umecto"],"roro":["降露","动","roro"],"pluo":["下雨","动","pluo"],"ningo":["下雪","动","ningo"],"madefac":["使湿","动","madefac"],"arefaci":["使干","动","arefaci"],"cymatium":["线脚","物","cymatium"],"capitellum":["柱头","物","capitellum"],"scamillus":["柱础","物","scamillus"],"anaglyph":["浮雕","物","anaglyph"],"polychr":["彩绘","物","polychr"],"encaust":["蜡画","物","encaust"],"opussect":["镶嵌石","物","opussect"],"crustat":["贴面","物","crustat"],"albari":["白灰","物","albari"],"signinum":["碎石地","物","signinum"],"lithost":["铺石","物","lithost"],"sectil":["拼花","物","sectil"],"sima":["檐口","物","sima"],"emblem":["镶嵌图","物","emblem"],"hypaeth":["露天顶","物","hypaeth"],"columnat":["列柱","物","columnat"],"peristy":["列柱中庭","物","peristy"],"strobil":["柱头卷叶","物","strobil"],"voluta":["涡卷","物","voluta"],"acanthus":["茛苕叶饰","物","acanthus"],"fasciola":["小带饰","物","fasciola"],"scotia":["凹圆线","物","scotia"],"mutulus":["檐下托块","物","mutulus"],"denticu":["齿饰","物","denticu"],"anthemion":["花饰","物","anthemion"],"campana":["钟","物","campana"],"crotalum":["响板","物","crotalum"],"sistrum":["叉铃","物","sistrum"],"pandura":["三弦","物","pandura"],"nablium":["竖琴","物","nablium"],"psalterium":["瑟","物","psalterium"],"hydraulus":["水力风琴","物","hydraulus"],"monaulus":["单管","物","monaulus"],"scabellum":["拍板","物","scabellum"],"melos":["曲调","物","melos"],"tonus":["调","物","tonus"],"choraul":["笛伴歌者","物","choraul"],"citharo":["琴歌者","物","citharo"],"auloed":["管歌者","物","auloed"],"tibicen":["笛手","物","tibicen"],"fidicen":["琴手","物","fidicen"],"symphon":["乐师","物","symphon"],"musicus":["乐人","物","musicus"],"cantor":["歌者","物","cantor"],"psaltes":["弹瑟者","物","psaltes"],"saltato":["舞者","物","saltato"],"exodium":["幕间剧","物","exodium"],"emboli":["插曲","物","emboli"],"minus":["哑剧","物","minus"],"atellana":["笑剧","物","atellana"],"tranquil":["安宁","性","tranquil"],"fiducia":["信赖","性","fiducia"],"formido":["惊惶","性","formido"],"angustia":["郁结","性","angustia"],"moeror":["悲恸","性","moeror"],"luctus":["哀恸","性","luctus"],"desider":["眷恋","性","desider"],"dedecus":["耻辱","性","dedecus"],"ignomin":["羞辱","性","ignomin"],"probrum":["丑行","性","probrum"],"blandimen":["柔情","性","blandimen"],"commotio":["激动","性","commotio"],"permotio":["情绪震动","性","permotio"],"turbatio":["烦乱","性","turbatio"],"abomina":["憎恶","性","abomina"],"detesta":["嫌恶","性","detesta"],"aversat":["反感","性","aversat"],"compunc":["悔恨","性","compunc"],"remors":["悔意","性","remors"],"querimo":["怨诉","性","querimo"],"complor":["哀号","性","complor"],"consolat":["慰藉","性","consolat"],"exhorta":["鼓励","性","exhorta"],"adhorta":["劝勉","性","adhorta"],"rotundus":["圆的","性","rotundus"],"quadratus":["方的","性","quadratus"],"oblongus":["长方的","性","oblongus"],"curvus":["弯的","性","curvus"],"flexuos":["曲折的","性","flexuos"],"sinuos":["蜿蜒的","性","sinuos"],"angulos":["多角的","性","angulos"],"striatus":["条纹的","性","striatus"],"maculos":["斑点的","性","maculos"],"globos":["球状的","性","globos"],"ovatus":["卵形的","性","ovatus"],"conic":["锥形的","性","conic"],"planus":["平的","性","planus"],"convexus":["凸的","性","convexus"],"concavus":["凹的","性","concavus"],"nodos":["多节的","性","nodos"],"sphaeric":["球面的","性","sphaeric"],"cubicus":["立方的","性","cubicus"],"triangul":["三角的","性","triangul"],"hexagon":["六角的","性","hexagon"],"acumina":["尖的","性","acumina"],"retusus":["钝的","性","retusus"],"hamatus":["钩状的","性","hamatus"],"serratus":["锯齿的","性","serratus"],"stellat":["星形的","性","stellat"],"sumo":["拿起","动","sumo"],"pono":["放下","动","pono"],"extraho":["拔出","动","extraho"],"imprimo":["压入","动","imprimo"],"compon":["对齐","动","compon"],"aequa":["弄平","动","aequa"],"hebeto":["弄钝","动","hebeto"],"acuo":["磨利","动","acuo"],"diruo":["拆毁","动","diruo"],"trado":["交付","动","trado"],"abdo":["藏匿","动","abdo"],"recond":["收藏","动","recond"],"promo":["取出","动","promo"],"repono":["放回","动","repono"],"eximo":["取出","动","eximo"],"erigo":["竖立","动","erigo"],"inclino":["倾斜","动","inclino"],"percuti":["敲击","动","percuti"],"ferio":["打击","动","ferio"],"verso":["翻动","动","verso"],"figo":["钉住","动","figo"],"infigo":["钉入","动","infigo"],"defigo":["钉牢","动","defigo"],"scindo":["劈开","动","scindo"],"findo":["裂开","动","findo"],"grand":["宏大","性","grand"],"ingen":["庞大","性","ingen"],"imman":["巨大","性","imman"],"enorm":["异常大","性","enorm"],"spatios":["宽敞","性","spatios"],"copios":["丰富","性","copios"],"abund":["丰裕","性","abund"],"larg":["丰盛","性","larg"],"profus":["充沛","性","profus"],"multip":["繁多","性","multip"],"numeros":["众多","性","numeros"],"frequens":["稠密","性","frequens"],"creber":["密集","性","creber"],"opim":["丰饶","性","opim"],"uber":["多产","性","uber"],"locupl":["富裕","性","locupl"],"sumptu":["奢华","性","sumptu"],"magnif":["宏伟","性","magnif"],"grandil":["豪言","性","grandil"],"august":["庄严","性","august"],"coloss":["巨型","性","coloss"],"titan":["巨擘","性","titan"],"gigan":["巨人的","性","gigan"],"prolix":["冗长","性","prolix"],"pusill":["微小","性","pusill"],"exigu":["稀少","性","exigu"],"minut":["细微","性","minut"],"subtil":["精细","性","subtil"],"modic":["适中","性","modic"],"infreq":["稀少","性","infreq"],"jejun":["贫瘠","性","jejun"],"inops":["贫乏","性","inops"],"egens":["匮乏","性","egens"],"indige":["短缺","性","indige"],"nugax":["琐屑","性","nugax"],"frivol":["琐碎","性","frivol"],"levid":["浅薄","性","levid"],"atomus":["微尘","性","atomus"],"puncil":["微小点","性","puncil"],"brevil":["简短","性","brevil"],"exili":["贫薄","性","exili"],"macer":["瘦瘠","性","macer"],"gracil":["纤细","性","gracil"],"angust":["狭窄","性","angust"],"arct":["紧窄","性","arct"],"strict":["收紧","性","strict"],"coarct":["压缩","性","coarct"],"contrac":["收缩","性","contrac"],"compres":["压缩","性","compres"],"velox":["迅捷","性","velox"],"pernix":["敏捷","性","pernix"],"ocior":["更快","性","ocior"],"praepes":["疾飞","性","praepes"],"rapid":["急速","性","rapid"],"vehem":["猛烈","性","vehem"],"incit":["疾行","性","incit"],"segnis":["迟缓","性","segnis"],"piger":["怠惰","性","piger"],"deses":["懒散","性","deses"],"morosus":["拖延","性","morosus"],"cunct":["迟缓","性","cunct"],"remora":["迟延","性","remora"],"praecep":["急促","性","praecep"],"subitus":["突然","性","subitus"],"repens":["突兀","性","repens"],"extemp":["立刻","性","extemp"],"seroti":["迟来","性","seroti"],"praecox":["早熟","性","praecox"],"assidu":["不间断","性","assidu"],"morato":["拖延者","性","morato"],"cuncta":["拖延者","性","cuncta"],"pernici":["迅疾","性","pernici"],"propera":["仓促","性","propera"],"valid":["强壮","性","valid"],"nervos":["有力","性","nervos"],"lacert":["健硕","性","lacert"],"praepot":["至强","性","praepot"],"opulen":["富力","性","opulen"],"infirm":["病弱","性","infirm"],"fragil":["易碎","性","fragil"],"caduc":["易倒","性","caduc"],"enerv":["无力","性","enerv"],"effetus":["衰竭","性","effetus"],"marcid":["萎弱","性","marcid"],"tabid":["消耗","性","tabid"],"valetud":["多病","性","valetud"],"praeval":["占优","性","praeval"],"superan":["超越","性","superan"],"invictus":["不败","性","invictus"],"impoten":["无力","性","impoten"],"invalid":["无力","性","invalid"],"tenellus":["娇弱","性","tenellus"],"delica":["娇弱","性","delica"],"fessus":["疲惫","性","fessus"],"lassus":["疲倦","性","lassus"],"defess":["精疲力竭","性","defess"],"exhaus":["耗竭","性","exhaus"],"confect":["衰颓","性","confect"],"specio":["华美","性","specio"],"decor":["雅致","性","decor"],"elegan":["优雅","性","elegan"],"comptus":["修饰","性","comptus"],"lautus":["精美","性","lautus"],"concinn":["工巧","性","concinn"],"lepid":["风趣","性","lepid"],"amabil":["可爱","性","amabil"],"suavis":["甘美","性","suavis"],"taeter":["丑恶","性","taeter"],"horrid":["粗陋","性","horrid"],"monstros":["怪异","性","monstros"],"pulchel":["秀美","性","pulchel"],"splendid":["璀璨","性","splendid"],"eximi":["卓异","性","eximi"],"insign":["非凡","性","insign"],"praest":["卓越","性","praest"],"mediocr":["平庸","性","mediocr"],"turpitu":["丑行","性","turpitu"],"foedit":["污秽","性","foedit"],"rutilus":["红艳","性","rutilus"],"florens":["繁盛","性","florens"],"vernan":["春意","性","vernan"],"ornat":["华饰","性","ornat"],"cultus":["修饰","性","cultus"],"fari":["言说","动","fari"],"effar":["宣说","动","effar"],"proloq":["吐露","动","proloq"],"alloq":["搭话","动","alloq"],"eloq":["陈说","动","eloq"],"interloq":["插话","动","interloq"],"obloq":["反驳","动","obloq"],"colloq":["交谈","动","colloq"],"refer":["转述","动","refer"],"enarr":["详述","动","enarr"],"expon":["陈述","动","expon"],"signifi":["表明","动","signifi"],"declar":["声明","动","declar"],"testari":["作证","动","testari"],"profit":["宣称","动","profit"],"asser":["主张","动","asser"],"inscrib":["题写","动","inscrib"],"adscrib":["附记","动","adscrib"],"edic":["颁布","动","edic"],"interdic":["禁止","动","interdic"],"praedic":["预告","动","praedic"],"dicax":["好讥讽","动","dicax"],"verbos":["冗言","动","verbos"],"garrul":["饶舌","动","garrul"],"facund":["雄辩","动","facund"],"aspic":["注视","动","aspic"],"circums":["环视","动","circums"],"respic":["回看","动","respic"],"despic":["轻视","动","despic"],"dispici":["辨认","动","dispici"],"inspic":["审视","动","inspic"],"perlust":["遍览","动","perlust"],"tueri":["守护看","动","tueri"],"exaud":["听清","动","exaud"],"obaud":["听从","动","obaud"],"inaud":["听闻","动","inaud"],"subaud":["听出","动","subaud"],"peraud":["听遍","动","peraud"],"oculat":["目击的","动","oculat"],"aurit":["有耳的","动","aurit"],"inspect":["细看","动","inspect"],"patul":["张开","动","patul"],"nosc":["认识","动","nosc"],"agnosc":["认出","动","agnosc"],"vener":["瞻仰","动","vener"],"ador":["敬拜","动","ador"],"aspecta":["凝望","动","aspecta"],"visere":["造访看","动","visere"],"invis":["探看","动","invis"],"revis":["重访","动","revis"],"provis":["预察","动","provis"],"capi":["抓取","动","capi"],"prend":["捉","动","prend"],"fero":["持运","动","fero"],"sustin":["托住","动","sustin"],"recipi":["接回","动","recipi"],"retin":["留住","动","retin"],"dimitt":["放开","动","dimitt"],"omitt":["略去","动","omitt"],"relinq":["留下","动","relinq"],"desere":["弃","动","desere"],"abici":["丢弃","动","abici"],"proici":["抛出","动","proici"],"mando":["交付","动","mando"],"commend":["托付","动","commend"],"tribu":["授予","动","tribu"],"asport":["搬走","动","asport"],"adveh":["运来","动","adveh"],"deveh":["运下","动","deveh"],"reveh":["运回","动","reveh"],"subveh":["上运","动","subveh"],"transve":["转运","动","transve"],"inveh":["运入","动","inveh"],"eveh":["运出","动","eveh"],"complec":["拥抱","动","complec"],"retent":["扣留","动","retent"],"eo":["去","动","eo"],"vado":["行走","动","vado"],"inced":["迈步","动","inced"],"perg":["前行","动","perg"],"profic":["启程","动","profic"],"egred":["走出","动","egred"],"ingred":["走入","动","ingred"],"regred":["退回","动","regred"],"transgr":["越过","动","transgr"],"congred":["相会","动","congred"],"palor":["游荡","动","palor"],"discur":["奔走","动","discur"],"obrepo":["潜行","动","obrepo"],"irrep":["潜入","动","irrep"],"subrep":["爬入","动","subrep"],"commig":["迁入","动","commig"],"emig":["迁出","动","emig"],"immig":["移入","动","immig"],"remigr":["迁回","动","remigr"],"exeo":["出去","动","exeo"],"ineo":["进入","动","ineo"],"pereo":["消逝","动","pereo"],"praeteri":["经过","动","praeteri"],"do":["给","动","do"],"largi":["施与","动","largi"],"impert":["分与","动","impert"],"elarg":["慷慨赠","动","elarg"],"munerar":["馈赠","动","munerar"],"condon":["赠予","动","condon"],"restit":["归还","动","restit"],"repend":["偿还","动","repend"],"pendo":["偿付","动","pendo"],"persol":["付清","动","persol"],"acqui":["取得","动","acqui"],"compara":["购置","动","compara"],"paro":["备办","动","paro"],"nancis":["获得","动","nancis"],"potio":["据有","动","potio"],"occup":["占据","动","occup"],"usurp":["篡取","动","usurp"],"surrip":["窃取","动","surrip"],"subrip":["偷取","动","subrip"],"abrip":["夺去","动","abrip"],"erip":["抢出","动","erip"],"dirip":["掠夺","动","dirip"],"corrip":["攫取","动","corrip"],"interci":["截取","动","interci"],"praerip":["抢走","动","praerip"],"pulso":["敲击","动","pulso"],"verbero":["鞭打","动","verbero"],"caed":["砍","动","caed"],"rump":["折断","动","rump"],"quass":["震荡","动","quass"],"concut":["摇撼","动","concut"],"discut":["震散","动","discut"],"excut":["抖出","动","excut"],"succut":["下撼","动","succut"],"labefa":["动摇","动","labefa"],"confrin":["打碎","动","confrin"],"diffrin":["砸裂","动","diffrin"],"perfrin":["击穿","动","perfrin"],"refrin":["折返破","动","refrin"],"tundit":["捶打","动","tundit"],"battu":["击打","动","battu"],"flagella":["鞭笞","动","flagella"],"contund":["捣碎","动","contund"],"extund":["锤出","动","extund"],"retund":["挫钝","动","retund"],"obtund":["使钝","动","obtund"],"compun":["刺穿","动","compun"],"expun":["剔除","动","expun"],"confod":["戳穿","动","confod"],"perfod":["凿穿","动","perfod"],"puto":["以为","动","puto"],"reor":["料想","动","reor"],"arbitra":["判定","动","arbitra"],"existim":["估量","动","existim"],"cense":["评议","动","cense"],"iudico":["判断","动","iudico"],"conici":["推测","动","conici"],"auguro":["占测","动","auguro"],"divina":["占测","动","divina"],"provide":["预见","动","provide"],"comper":["查明","动","comper"],"inven":["发现","动","inven"],"noscit":["熟识","动","noscit"],"sentio":["感觉","动","sentio"],"consen":["同感","动","consen"],"sapio":["有见识","动","sapio"],"desip":["胡涂","动","desip"],"scien":["知情的","动","scien"],"nesci":["不知","动","nesci"],"insci":["无知","动","insci"],"doctus":["博学的","动","doctus"],"indoct":["未学","动","indoct"],"memini":["记得","动","memini"],"cogita":["沉思的","动","cogita"],"medita":["默想的","动","medita"],"amo":["爱","性","amo"],"diligo":["珍爱","性","diligo"],"carus":["亲爱","性","carus"],"fave":["偏爱","性","fave"],"studeo":["热衷","性","studeo"],"opto":["愿望","性","opto"],"vove":["许愿","性","vove"],"appet":["渴求","性","appet"],"concup":["贪求","性","concup"],"exsecro":["咒恨","性","exsecro"],"detest":["憎恶","性","detest"],"abomin":["厌憎","性","abomin"],"invisus":["被憎的","性","invisus"],"peros":["极恨","性","peros"],"osor":["憎恨者","性","osor"],"aemulo":["争爱","性","aemulo"],"invide":["嫉妒","性","invide"],"zeloty":["妒忌","性","zeloty"],"amato":["爱者","性","amato"],"amatr":["女爱者","性","amatr"],"dilect":["珍爱者","性","dilect"],"malevo":["恶意","性","malevo"],"invidio":["妒忌的","性","invidio"],"odios":["可憎的","性","odios"],"elabor":["精作","动","elabor"],"molio":["营建","动","molio"],"elucub":["苦研","动","elucub"],"desud":["辛劳","动","desud"],"defati":["使疲","动","defati"],"fatig":["使累","动","fatig"],"exancl":["竭力","动","exancl"],"requie":["安歇","动","requie"],"otio":["闲居","动","otio"],"vaco":["空闲","动","vaco"],"desid":["闲坐","动","desid"],"ignavo":["偷懒","动","ignavo"],"pigro":["怠惰","动","pigro"],"socord":["怠惰","动","socord"],"sedul":["勤勉","动","sedul"],"operos":["费力的","动","operos"],"labori":["勤劳的","动","labori"],"molest":["烦累的","动","molest"],"quietus":["安定的","动","quietus"],"sedo":["使静","动","sedo"],"refoci":["使恢复","动","refoci"],"recreo":["使复原","动","recreo"],"refici":["修复","动","refici"],"rogo":["问","动","rogo"],"interro":["追问","动","interro"],"percon":["详问","动","percon"],"sciscit":["探问","动","sciscit"],"exquir":["细究","动","exquir"],"requir":["索求","动","requir"],"rescrib":["回信","动","rescrib"],"renunt":["回报","动","renunt"],"postula":["诉求","动","postula"],"exact":["催缴","动","exact"],"instan":["催逼","动","instan"],"postul":["要求","动","postul"],"flagit":["催讨","动","flagit"],"interpe":["插问","动","interpe"],"ambigu":["歧义","动","ambigu"],"consult":["请教","动","consult"],"scitor":["探询","动","scitor"],"inquis":["查问","动","inquis"],"confess":["供认","动","confess"],"affirm":["肯定","动","affirm"],"abiura":["矢口否认","动","abiura"],"iurat":["宣誓","动","iurat"],"protes":["声明","动","protes"],"iuvo":["帮助","动","iuvo"],"adiuv":["援助","动","adiuv"],"auxil":["支援","动","auxil"],"opitu":["救助","动","opitu"],"subven":["接济","动","subven"],"succur":["驰援","动","succur"],"prosum":["有益","动","prosum"],"commod":["便利","动","commod"],"defend":["护卫","动","defend"],"proteg":["掩护","动","proteg"],"munio":["筑防","动","munio"],"obsto":["阻碍","动","obsto"],"offici":["妨碍","动","offici"],"imped":["阻挠","动","imped"],"impedi":["妨碍","动","impedi"],"moror":["拖延阻","动","moror"],"retard":["延缓","动","retard"],"obstac":["设障","动","obstac"],"prohib":["禁止","动","prohib"],"suppet":["增援","动","suppet"],"subsidi":["后备援","动","subsidi"],"adiuto":["助手","动","adiuto"],"adstip":["声援者","动","adstip"],"fauto":["赞助者","动","fauto"],"iube":["命令","动","iube"],"impero":["下令","动","impero"],"decern":["裁定","动","decern"],"sancis":["钦定","动","sancis"],"praescr":["规定","动","praescr"],"moneo":["告诫","动","moneo"],"admon":["提醒","动","admon"],"praemon":["预警","动","praemon"],"denunt":["通令","动","denunt"],"indico":["宣布","动","indico"],"nuntio":["传令","动","nuntio"],"pareo":["服从","动","pareo"],"oboed":["听命","动","oboed"],"obtemper":["遵从","动","obtemper"],"morige":["迎合","动","morige"],"ausculto":["听从","动","ausculto"],"subici":["使臣服","动","subici"],"dominor":["主宰","动","dominor"],"servio":["服役","动","servio"],"ancill":["婢侍","动","ancill"],"iussio":["命令","动","iussio"],"scitum":["决议","动","scitum"],"vendo":["卖","动","vendo"],"mereo":["赚得","动","mereo"],"liceor":["竞买","动","liceor"],"addico":["判卖","动","addico"],"mutuo":["借贷","动","mutuo"],"faener":["放贷","动","faener"],"credo":["贷出","动","credo"],"debeo":["欠","动","debeo"],"repraes":["付现","动","repraes"],"locito":["出租","动","locito"],"emo":["买","动","emo"],"nundino":["做买卖","动","nundino"],"negoti":["经营","动","negoti"],"merco":["经商","动","merco"],"taberno":["开店","动","taberno"],"circumf":["行商","动","circumf"],"cambio":["汇兑","动","cambio"],"chirogr":["手据","动","chirogr"],"vadio":["抵押物","动","vadio"],"fideiu":["作保","动","fideiu"],"sponde":["承诺","动","sponde"],"exprom":["代诺","动","exprom"],"aedifi":["兴建","动","aedifi"],"exstru":["筑起","动","exstru"],"constr":["构建","动","constr"],"instr":["布置","动","instr"],"evert":["推翻","动","evert"],"subver":["颠覆","动","subver"],"perver":["败坏","动","perver"],"deici":["拆倒","动","deici"],"proste":["夷平","动","proste"],"complana":["铲平","动","complana"],"exscin":["夷灭","动","exscin"],"demol":["拆毁","动","demol"],"excid":["削去","动","excid"],"molar":["墙石","动","molar"],"machinor":["设计建造","动","machinor"],"archite":["主持建造","动","archite"],"exaedi":["建成","动","exaedi"],"peraed":["竣工","动","peraed"],"inaedi":["筑入","动","inaedi"],"obstr":["堵塞","动","obstr"],"interst":["夹建","动","interst"],"prodig":["拆散","动","prodig"],"dissip":["拆散","动","dissip"],"vasto":["蹂躏","动","vasto"],"ruinos":["倾颓的","动","ruinos"],"erudio":["教导","动","erudio"],"institu":["设教","动","institu"],"inform":["训导","动","inform"],"formo":["培养","动","formo"],"excol":["栽培","动","excol"],"educo":["养育","动","educo"],"imbu":["启蒙","动","imbu"],"instil":["灌输","动","instil"],"monstro":["指教","动","monstro"],"demonst":["演示","动","demonst"],"ostend":["展示","动","ostend"],"disco":["学习","动","disco"],"addisc":["学会","动","addisc"],"perdis":["学透","动","perdis"],"edisc":["熟记","动","edisc"],"assues":["使习惯","动","assues"],"consues":["惯于","动","consues"],"meditor":["研习","动","meditor"],"scriptit":["常写","动","scriptit"],"probo":["考核","动","probo"],"improbo":["否决","动","improbo"],"guberno":["治理","动","guberno"],"rego":["统辖","动","rego"],"moderor":["节制","动","moderor"],"tempero":["调和","动","tempero"],"adminis":["施政","动","adminis"],"procuro":["督办","动","procuro"],"ordino":["整饬","动","ordino"],"dispon":["调度","动","dispon"],"constit":["设立","动","constit"],"lego":["委任","动","lego"],"creo":["选任","动","creo"],"design":["指派","动","design"],"praefic":["任为长官","动","praefic"],"promov":["擢升","动","promov"],"amov":["免职","动","amov"],"summov":["斥退","动","summov"],"remov":["撤职","动","remov"],"depon":["罢黜","动","depon"],"abdic":["让位","动","abdic"],"seditios":["好乱","动","seditios"],"factios":["结党","动","factios"],"perdue":["叛国者","动","perdue"],"moderam":["治术","动","moderam"],"pacat":["绥靖的","动","pacat"],"dormi":["睡","动","dormi"],"somni":["做梦","动","somni"],"dormit":["打盹","动","dormit"],"obdorm":["入睡","动","obdorm"],"soporo":["使睡","动","soporo"],"consop":["催眠","动","consop"],"sterto":["打鼾","动","sterto"],"vigilo":["守夜","动","vigilo"],"evigil":["醒来","动","evigil"],"experg":["苏醒","动","experg"],"excito":["唤醒","动","excito"],"resipi":["清醒","动","resipi"],"insomn":["失眠","动","insomn"],"soporif":["致睡的","动","soporif"],"somnif":["催眠的","动","somnif"],"dormitor":["卧者","动","dormitor"],"cubati":["卧眠","动","cubati"],"decubi":["卧姿","动","decubi"],"accubi":["侧卧","动","accubi"],"vigilia":["守夜礼","动","vigilia"],"pervigi":["通宵","动","pervigi"],"noctur":["夜间的","动","noctur"],"lucubr":["夜读","动","lucubr"],"somnicu":["嗜睡的","动","somnicu"],"hypno":["睡意","动","hypno"],"arrid":["微笑迎","动","arrid"],"irrid":["嘲笑","动","irrid"],"derid":["讽笑","动","derid"],"cachinno":["狂笑","动","cachinno"],"fleo":["哭泣","动","fleo"],"lacrimo":["流泪","动","lacrimo"],"complora":["共哭","动","complora"],"deplor":["痛哭","动","deplor"],"exclam":["惊呼","动","exclam"],"vagio":["婴啼","动","vagio"],"gemisc":["呻吟起","动","gemisc"],"ingem":["呻吟","动","ingem"],"risus":["笑声","动","risus"],"lamentu":["哀词","动","lamentu"],"mugitu":["低鸣","动","mugitu"],"singult":["抽泣","动","singult"],"questu":["哀诉","动","questu"],"ridicu":["可笑的","动","ridicu"],"deridic":["极可笑","动","deridic"],"renid":["含笑","动","renid"],"flens":["哭泣的","动","flens"],"irasc":["发怒","性","irasc"],"succens":["恼怒","性","succens"],"stomacho":["恼怒","性","stomacho"],"furo":["狂怒","性","furo"],"saevi":["暴怒","性","saevi"],"bacchor":["狂乱","性","bacchor"],"timeo":["害怕","性","timeo"],"metuo":["畏惧","性","metuo"],"vereor":["敬畏","性","vereor"],"paveo":["惊恐","性","paveo"],"trepido":["惶急","性","trepido"],"exhorres":["悚然","性","exhorres"],"pertime":["深惧","性","pertime"],"terreo":["使惧","性","terreo"],"dirus":["可怖的","性","dirus"],"atrox":["凶暴","性","atrox"],"ferox":["凶猛","性","ferox"],"immit":["严酷","性","immit"],"rabid":["狂怒的","性","rabid"],"furibu":["暴怒的","性","furibu"],"formidol":["可怕的","性","formidol"],"meticul":["胆怯的","性","meticul"],"furor":["狂暴","性","furor"],"opulens":["富裕","性","opulens"],"beato":["有福","性","beato"],"fortuna":["幸运","性","fortuna"],"felix":["幸运","性","felix"],"prosper":["顺遂","性","prosper"],"mendic":["乞讨的","性","mendic"],"egenu":["穷困","性","egenu"],"penuri":["匮乏","性","penuri"],"inopi":["贫乏","性","inopi"],"ops":["财富","性","ops"],"gaza":["宝库","性","gaza"],"thesaur":["宝库","性","thesaur"],"dapsil":["丰盛","性","dapsil"],"afflu":["富足","性","afflu"],"profluen":["丰沛","性","profluen"],"egest":["贫困","性","egest"],"mendici":["行乞","性","mendici"],"nud":["赤贫","性","nud"],"squalor":["贫陋","性","squalor"],"provent":["收益","性","provent"],"reditus":["进项","性","reditus"],"quaestu":["营利","性","quaestu"],"peculat":["侵吞","性","peculat"],"repetun":["勒索","性","repetun"],"profusi":["挥霍","性","profusi"],"vetul":["小老头","物","vetul"],"anus":["老妇","物","anus"],"anil":["老妇的","物","anil"],"grandae":["高龄","物","grandae"],"decrepi":["衰朽","物","decrepi"],"longaev":["长寿","物","longaev"],"iuvenis":["青年","物","iuvenis"],"adules":["少年","物","adules"],"adolesc":["成长","物","adolesc"],"puber":["成丁","物","puber"],"viripo":["及笄","物","viripo"],"caniti":["白头","物","caniti"],"seniu":["暮年","物","seniu"],"senil":["老态的","物","senil"],"pubes":["成丁期","物","pubes"],"virgini":["童贞","物","virgini"],"adultus":["成年的","物","adultus"],"incunab":["襁褓","物","incunab"],"alumn":["养子","物","alumn"],"orphan":["孤儿","物","orphan"],"avia":["祖母","物","avia"],"maior":["长辈","物","maior"],"natu":["年齿","物","natu"],"primaev":["初年","物","primaev"],"castus":["洁净","性","castus"],"impur":["不洁","性","impur"],"inmund":["污秽","性","inmund"],"caenos":["泥污","性","caenos"],"lutulen":["泥泞","性","lutulen"],"maculat":["沾污","性","maculat"],"inquina":["玷污","性","inquina"],"lotura":["洗液","性","lotura"],"lavacr":["浴池","性","lavacr"],"deters":["擦净","性","deters"],"purgam":["污物","性","purgam"],"sordes":["污垢","性","sordes"],"caenum":["污泥","性","caenum"],"amurca":["油渣","性","amurca"],"recrem":["渣滓","性","recrem"],"quisqui":["垃圾","性","quisqui"],"tersus":["洁净的","性","tersus"],"piatus":["涤罪","性","piatus"],"expiat":["赎净","性","expiat"],"lustra":["祓净","性","lustra"],"defaec":["澄清","性","defaec"],"elutri":["淘净","性","elutri"],"faece":["渣滓的","性","faece"],"purgati":["清洗","性","purgati"],"castimo":["贞洁","性","castimo"],"sapien":["智慧","性","sapien"],"cordat":["明智","性","cordat"],"consili":["谋略","性","consili"],"fatu":["愚妄","性","fatu"],"insipie":["无知","性","insipie"],"brut":["粗钝","性","brut"],"idiot":["愚人","性","idiot"],"moroso":["愚哲","性","moroso"],"littera":["博文","性","littera"],"perit":["熟练","性","perit"],"imperit":["生疏","性","imperit"],"gnar":["通晓","性","gnar"],"ignar":["不知","性","ignar"],"catus":["精明的","性","catus"],"vafer":["狡黠","性","vafer"],"astut":["机敏","性","astut"],"stolid":["愚钝","性","stolid"],"bard":["蠢笨","性","bard"],"inept":["笨拙","性","inept"],"socor":["愚钝","性","socor"],"demen":["疯狂","性","demen"],"amens":["失智","性","amens"],"vecor":["昏聩","性","vecor"],"excor":["无智","性","excor"],"phrone":["实践智","性","phrone"],"edo":["吃","动","edo"],"comed":["共食","动","comed"],"vescor":["进食","动","vescor"],"pascor":["吃草","动","pascor"],"gusto":["品尝","动","gusto"],"deglut":["吞咽","动","deglut"],"glutt":["吞","动","glutt"],"mastic":["细嚼","动","mastic"],"vorax":["贪食","动","vorax"],"bibo":["饮","动","bibo"],"poto":["喝","动","poto"],"sorbeo":["啜饮","动","sorbeo"],"potito":["常饮","动","potito"],"esurio":["饿","动","esurio"],"ientac":["早餐","动","ientac"],"merenda":["午后点心","动","merenda"],"obsoni":["菜肴","动","obsoni"],"ganeo":["饕客","动","ganeo"],"heluo":["贪食者","动","heluo"],"crapul":["暴饮","动","crapul"],"ebrios":["嗜酒","动","ebrios"],"temulen":["醉的","动","temulen"],"induo":["穿上","动","induo"],"exuo":["脱下","动","exuo"],"vestio":["给穿","动","vestio"],"amici":["披上","动","amici"],"circumd":["裹上","动","circumd"],"denud":["裸露","动","denud"],"nudo":["使裸","动","nudo"],"velo":["遮盖","动","velo"],"advel":["蒙上","动","advel"],"obvolv":["裹住","动","obvolv"],"evolv":["解开","动","evolv"],"cingo":["系带","动","cingo"],"discin":["解带","动","discin"],"succin":["束腰","动","succin"],"calceo":["穿鞋","动","calceo"],"excalc":["脱鞋","动","excalc"],"discal":["赤足","动","discal"],"exuv":["蜕皮","动","exuv"],"succinc":["束腰的","动","succinc"],"semiind":["半穿衣的","动","semiind"],"induv":["内衣","动","induv"],"secto":["切割","动","secto"],"desec":["割下","动","desec"],"resec":["切除","动","resec"],"amput":["截肢","动","amput"],"praecid":["切断","动","praecid"],"recid":["削去","动","recid"],"succid":["砍倒","动","succid"],"incid":["切入","动","incid"],"concid":["剁碎","动","concid"],"dissec":["剖开","动","dissec"],"intersec":["截断","动","intersec"],"consuo":["缝合","动","consuo"],"insuo":["缝入","动","insuo"],"resuo":["拆缝","动","resuo"],"pannicu":["破布","动","pannicu"],"centro":["百衲","动","centro"],"sarcio":["缝缀","动","sarcio"],"obsuo":["封缝","动","obsuo"],"praesuo":["预缝","动","praesuo"],"lacero":["撕裂","动","lacero"],"dilace":["撕碎","动","dilace"],"lancin":["撕扯","动","lancin"],"cano":["唱","动","cano"],"decant":["吟唱","动","decant"],"recino":["重唱","动","recino"],"incino":["起唱","动","incino"],"concinno":["合唱","动","concinno"],"occino":["对唱","动","occino"],"succino":["伴唱","动","succino"],"modulor":["按调唱","动","modulor"],"psallo":["抚琴","动","psallo"],"cithari":["弹琴","动","cithari"],"tibicin":["吹笛","动","tibicin"],"buccin":["吹号","动","buccin"],"cornici":["吹角","动","cornici"],"persono":["鸣响","动","persono"],"resono":["回响","动","resono"],"crepo":["爆响","动","crepo"],"cantile":["小调","动","cantile"],"fremit":["轰鸣","动","fremit"],"crepitu":["爆响","动","crepitu"],"strepi":["喧响","动","strepi"],"tinnio":["丁当","动","tinnio"],"cantio":["曲","动","cantio"],"io":["欢呼","动","io"],"pingo":["绘画","动","pingo"],"deping":["描画","动","deping"],"adumbr":["勾轮廓","动","adumbr"],"lineo":["勾线","动","lineo"],"caelo":["錾刻","动","caelo"],"inscul":["刻入","动","inscul"],"exscul":["刻出","动","exscul"],"scalpo":["刮刻","动","scalpo"],"rado":["刮","动","rado"],"tero":["磨擦","动","tero"],"levigo":["磨光","动","levigo"],"dolo":["削平","动","dolo"],"ascio":["斧削","动","ascio"],"runco":["锉平","动","runco"],"limo":["锉","动","limo"],"effigi":["肖像","动","effigi"],"torno":["旋刻","动","torno"],"chalco":["铜版术","动","chalco"],"toreum":["錾刻品","动","toreum"],"caelatu":["錾工","动","caelatu"],"celtis":["凿","动","celtis"],"limatu":["锉屑","动","limatu"],"perfor":["穿孔","动","perfor"],"excud":["锻刻","动","excud"],"ardeo":["燃烧","动","ardeo"],"flagro":["燃炽","动","flagro"],"cremo":["焚","动","cremo"],"uro":["烧","动","uro"],"aduro":["灼","动","aduro"],"comburo":["烧尽","动","comburo"],"inuro":["烙","动","inuro"],"exuro":["烧掉","动","exuro"],"succend":["点燃","动","succend"],"restin":["熄灭","动","restin"],"opprim":["压灭","动","opprim"],"fumo":["冒烟","动","fumo"],"torreo":["焙","动","torreo"],"pruna":["炭火","动","pruna"],"carbo":["炭","动","carbo"],"cremio":["柴火","动","cremio"],"fomes":["引火物","动","fomes"],"fulig":["烟炱","动","fulig"],"favill":["飞灰","动","favill"],"exstinc":["熄灭","动","exstinc"],"ustio":["烙","动","ustio"],"ambust":["灼伤","动","ambust"],"adust":["烤焦的","动","adust"],"praeust":["烧硬的","动","praeust"],"neo":["纺","动","neo"],"texo":["织","动","texo"],"torque":["捻","动","torque"],"necto":["结","动","necto"],"vincio":["缚","动","vincio"],"relig":["解开系","动","relig"],"constrin":["束缚","动","constrin"],"obstrin":["束住","动","obstrin"],"devinc":["紧缚","动","devinc"],"revinc":["反缚","动","revinc"],"sublig":["下系","动","sublig"],"reticul":["结网","动","reticul"],"funicu":["细绳","动","funicu"],"retiac":["小网","动","retiac"],"stuppa":["麻絮","动","stuppa"],"toment":["填絮","动","toment"],"pensum":["一日之纱","动","pensum"],"glome":["绕线","动","glome"],"volvo":["缠绕","动","volvo"],"circumv":["盘绕","动","circumv"],"plexus":["交织","动","plexus"],"funal":["绳索的","动","funal"],"iaculor":["抛射","动","iaculor"],"conicio":["投合","动","conicio"],"reici":["掷回","动","reici"],"subicio":["投下","动","subicio"],"obici":["投向前","动","obici"],"traici":["掷过","动","traici"],"inicio":["投入","动","inicio"],"praemitt":["预遣","动","praemitt"],"promitt":["许诺","动","promitt"],"admitt":["接纳","动","admitt"],"committ":["交托","动","committ"],"remitt":["送回","动","remitt"],"summitt":["呈送","动","summitt"],"transmitt":["转送","动","transmitt"],"fundo":["倾泻","动","fundo"],"effund":["倾倒","动","effund"],"spargo":["撒播","动","spargo"],"aspergo":["洒上","动","aspergo"],"disperg":["散开","动","disperg"],"sagitto":["射箭","动","sagitto"],"roto":["抛转","动","roto"],"adigo":["投掷","动","adigo"],"emissi":["放出之物","动","emissi"],"duco":["引","动","duco"],"adduc":["引向","动","adduc"],"abduco":["引开","动","abduco"],"induco":["引入","动","induco"],"produc":["引出","动","produc"],"reduc":["引回","动","reduc"],"subduc":["引退","动","subduc"],"seduco":["引离","动","seduco"],"circumdu":["绕引","动","circumdu"],"pello":["推动","动","pello"],"propel":["推前","动","propel"],"expel":["逐出","动","expel"],"repel":["推回","动","repel"],"compel":["强推","动","compel"],"depel":["推下","动","depel"],"dispel":["驱散","动","dispel"],"vello":["拔","动","vello"],"avell":["拔去","动","avell"],"evell":["拔出","动","evell"],"revell":["扯下","动","revell"],"retrah":["拉回","动","retrah"],"detrah":["拉下","动","detrah"],"convel":["拔起","动","convel"],"divel":["扯开","动","divel"],"comprim":["压紧","动","comprim"],"exprim":["挤出","动","exprim"],"supprim":["压下","动","supprim"],"reprim":["抑制","动","reprim"],"deprim":["压下","动","deprim"],"arcio":["紧逼","动","arcio"],"coarto":["压缩","动","coarto"],"frequen":["挤满","动","frequen"],"stipo":["塞满","动","stipo"],"farcio":["填塞","动","farcio"],"referc":["塞满","动","referc"],"conferc":["压实","动","conferc"],"obtero":["压碎","动","obtero"],"contero":["磨碎","动","contero"],"attero":["磨损","动","attero"],"detero":["擦损","动","detero"],"arto":["逼紧","动","arto"],"adarto":["紧逼","动","adarto"],"angusto":["使窄","动","angusto"],"urgeo":["催逼","动","urgeo"],"perurge":["紧迫","动","perurge"],"insto":["逼近","动","insto"],"calco":["践踏","动","calco"],"concul":["踩碎","动","concul"],"odoro":["闻","动","odoro"],"oleo":["发味","动","oleo"],"fragro":["发香","动","fragro"],"puteo":["发臭","动","puteo"],"foete":["恶臭","动","foete"],"lambo":["舔","动","lambo"],"liguri":["贪吃","动","liguri"],"sallo":["盐渍","动","sallo"],"halitu":["呼气","动","halitu"],"fastid":["嫌味","动","fastid"],"amarit":["苦味","动","amarit"],"acidit":["酸味","动","acidit"],"salugo":["咸味","动","salugo"],"exhala":["散发","动","exhala"],"narco":["麻醉气","动","narco"],"olent":["香气","动","olent"],"graveo":["浓味","动","graveo"],"tinctur":["浸液","动","tinctur"],"sapora":["调味品","动","sapora"],"gustam":["品味之物","动","gustam"],"suffit":["熏烟","动","suffit"],"thymia":["香薰","动","thymia"],"tango":["触","性","tango"],"atting":["触及","性","atting"],"conting":["接触","性","conting"],"palpo":["抚","性","palpo"],"contrec":["摩挲","性","contrec"],"attrec":["摩触","性","attrec"],"perstrin":["轻掠","性","perstrin"],"tracto":["摆弄","性","tracto"],"hispid":["粗糙多毛","性","hispid"],"villosus":["绒毛的","性","villosus"],"veluti":["天鹅绒的","性","veluti"],"glutino":["胶黏","性","glutino"],"lubric":["滑的","性","lubric"],"teres":["圆滑的","性","teres"],"callos":["硬皮","性","callos"],"tenax":["黏韧","性","tenax"],"tractab":["可触的","性","tractab"],"ictus":["触击","性","ictus"],"attact":["接触","性","attact"],"horripi":["毛骨悚然","性","horripi"],"scabrit":["粗糙","性","scabrit"],"viscam":["黏稠","性","viscam"],"formica":["酥痒","性","formica"],"saluto":["致意","动","saluto"],"consalu":["问候","动","consalu"],"appello":["称呼","动","appello"],"compella":["招呼","动","compella"],"convenio":["会见","动","convenio"],"visito":["拜访","动","visito"],"inviso":["探访","动","inviso"],"convivo":["共宴","动","convivo"],"epulor":["赴宴","动","epulor"],"comito":["陪同","动","comito"],"prosequo":["随行","动","prosequo"],"consect":["追随","动","consect"],"occurro":["迎上","动","occurro"],"offendo":["撞见","动","offendo"],"arcess":["召来","动","arcess"],"accers":["传召","动","accers"],"except":["接客","动","except"],"gratulor":["致贺","动","gratulor"],"condol":["慰问","动","condol"],"consolor":["安慰","动","consolor"],"advent":["来访","动","advent"],"hospitor":["做客","动","hospitor"],"deducti":["护送","动","deducti"],"ministro":["侍候","动","ministro"],"magis":["更","数","magis"],"parum":["太少","数","parum"],"nimis":["过度","数","nimis"],"nimiu":["太多","数","nimiu"],"satis":["足够","数","satis"],"affati":["充分","数","affati"],"abunde":["丰足","数","abunde"],"multum":["多","数","multum"],"paulum":["少许","数","paulum"],"quantum":["多少","数","quantum"],"tantul":["微小量","数","tantul"],"plerum":["多半","数","plerum"],"pleriqu":["多数","数","pleriqu"],"nonnih":["不少","数","nonnih"],"exiguum":["少许","数","exiguum"],"minimu":["最少","数","minimu"],"maximu":["最多","数","maximu"],"plurimu":["极多","数","plurimu"],"parce":["节省地","数","parce"],"summati":["概括地","数","summati"],"particu":["逐条","数","particu"],"summa":["总量","数","summa"],"multitu":["众多","数","multitu"],"paucit":["寡少","数","paucit"],"neur":["神经","物","neur"],"myo":["肌","物","myo"],"oste":["骨","物","oste"],"haem":["血","物","haem"],"cyto":["细胞","物","cyto"],"textus":["组织","物","textus"],"arthro":["关节","物","arthro"],"cardi":["心","物","cardi"],"pneumo":["肺","物","pneumo"],"nephro":["肾","物","nephro"],"gastro":["胃","物","gastro"],"entero":["肠","物","entero"],"dermato":["皮","物","dermato"],"ophthal":["眼","物","ophthal"],"auric":["耳","物","auric"],"rhino":["鼻","物","rhino"],"stomato":["口","物","stomato"],"glosso":["舌","物","glosso"],"odonto":["牙","物","odonto"],"tricho":["毛","物","tricho"],"onycho":["甲","物","onycho"],"splanchno":["内脏","物","splanchno"],"chondro":["软骨","物","chondro"],"organo":["器官","物","organo"],"patho":["病","物","patho"],"algo":["痛","物","algo"],"pyo":["脓","物","pyo"],"septi":["腐","物","septi"],"toxo":["毒","物","toxo"],"therap":["疗","物","therap"],"progno":["预后","物","progno"],"sympto":["症","物","sympto"],"crisis":["危象","物","crisis"],"remiss":["缓解","物","remiss"],"recidiv":["复发","物","recidiv"],"chrono":["慢性","物","chrono"],"acuto":["急性","物","acuto"],"benigno":["良性","物","benigno"],"maligno":["恶性","物","maligno"],"heredo":["遗传","物","heredo"],"allergo":["过敏","物","allergo"],"necro":["坏死","物","necro"],"sclero":["硬化","物","sclero"],"steno":["狭窄","物","steno"],"psycho":["心灵","性","psycho"],"noo":["心智","性","noo"],"mnemo":["记忆","性","mnemo"],"phreno":["精神","性","phreno"],"thymo":["情绪","性","thymo"],"hormo":["冲动","性","hormo"],"hedono":["快乐","性","hedono"],"phobo":["恐惧","性","phobo"],"letho":["遗忘沉睡","性","letho"],"oneiro":["梦","性","oneiro"],"estheto":["感觉","性","estheto"],"logo":["理性","性","logo"],"doxo":["意见","性","doxo"],"fide":["信念","性","fide"],"etho":["习惯","性","etho"],"catharo":["宣泄","性","catharo"],"libido":["欲力","性","libido"],"complexo":["情结","性","complexo"],"affecto":["情感","性","affecto"],"cognito":["认知","性","cognito"],"volitio":["意志","性","volitio"],"demo":["民众","物","demo"],"polito":["城邦","物","polito"],"crati":["统治","物","crati"],"archo":["为首","物","archo"],"hiero":["圣职","物","hiero"],"theo":["神","物","theo"],"ethno":["民族","物","ethno"],"phylo":["部族","物","phylo"],"nomo":["习俗法","物","nomo"],"grapho":["书记","物","grapho"],"tyranno":["僭主","物","tyranno"],"oligo":["寡头","物","oligo"],"aristo":["贵族","物","aristo"],"pluto":["富豪","物","pluto"],"anarcho":["无政府","物","anarcho"],"bureau":["官僚","物","bureau"],"federo":["联邦","物","federo"],"socio":["社会","物","socio"],"patricio":["世家","物","patricio"],"senato":["元老","物","senato"],"consulo":["执政","物","consulo"],"hydro":["水","物","hydro"],"pyro":["火","物","pyro"],"aero":["气","物","aero"],"geo":["地","物","geo"],"helio":["日","物","helio"],"seleno":["月","物","seleno"],"astro":["星","物","astro"],"cosmo":["宇宙","物","cosmo"],"atmo":["蒸汽","物","atmo"],"litho":["石质","物","litho"],"metallo":["金属","物","metallo"],"crystallo":["晶","物","crystallo"],"cryo":["冷","物","cryo"],"photo":["光","物","photo"],"chromo":["色","物","chromo"],"baro":["重","物","baro"],"cyclo":["环","物","cyclo"],"schema":["形","物","schema"],"plasto":["塑","物","plasto"],"tomo":["切","物","tomo"],"kineto":["动","物","kineto"],"stato":["静","物","stato"],"bio":["生命","物","bio"],"zoo":["动物","物","zoo"],"phyto":["植物","物","phyto"],"viro":["病毒","物","viro"],"gene":["基因","物","gene"],"evolo":["演化","物","evolo"],"ecos":["生态","物","ecos"],"sedes":["栖息地","物","sedes"],"locus":["位置","物","locus"],"convit":["共栖","物","convit"],"estivo":["夏眠","物","estivo"],"metamorpho":["变态","物","metamorpho"],"larvo":["幼虫","物","larvo"],"pupo":["蛹","物","pupo"],"imago":["成虫","物","imago"],"ovio":["卵","物","ovio"],"mechano":["机械","物","mechano"],"automato":["自动","物","automato"],"electr":["电","物","electr"],"magneto":["磁","物","magneto"],"pneumato":["气动","物","pneumato"],"teleo":["远","物","teleo"],"phono":["声","物","phono"],"scopo":["观察","物","scopo"],"crypto":["隐秘","物","crypto"],"glypto":["刻","物","glypto"],"typo":["印","物","typo"],"syntheto":["合成","物","syntheto"],"ergo":["功","物","ergo"],"trocho":["轮","物","trocho"],"cochlio":["螺旋","物","cochlio"],"clino":["斜","物","clino"],"goni":["角度","物","goni"],"topo":["位置","物","topo"],"taxis":["排列","物","taxis"],"harmo":["契合","物","harmo"],"itis":["炎","性","itis"],"osis":["病变","性","osis"],"oma":["瘤","性","oma"],"emia":["血症","性","emia"],"uria":["尿症","性","uria"],"rrhag":["出血","性","rrhag"],"rrhoe":["溢出","性","rrhoe"],"ptos":["下垂","性","ptos"],"plasia":["增生","性","plasia"],"troph":["营养","性","troph"],"lys":["溶解","性","lys"],"pex":["固定","性","pex"],"ectom":["切除","性","ectom"],"otom":["切开","性","otom"],"tonia":["肌张力","性","tonia"],"praxia":["行为","性","praxia"],"gnosia":["认知","性","gnosia"],"mnesia":["记忆","性","mnesia"],"phasia":["言语","性","phasia"],"lalia":["谈话","性","lalia"],"opia":["视觉","性","opia"],"acusis":["听觉","性","acusis"],"osmia":["嗅觉","性","osmia"],"algebr":["代数","物","algebr"],"logarith":["对数","物","logarith"],"functio":["函数","物","functio"],"consta":["常数","物","consta"],"limes":["极限","物","limes"],"integral":["积分","物","integral"],"vecto":["向量","物","vecto"],"scalar":["标量","物","scalar"],"tensor":["张量","物","tensor"],"grex":["群","物","grex"],"campus":["域","物","campus"],"anulus":["环","物","anulus"],"tangens":["切线","物","tangens"],"secans":["割线","物","secans"],"sinus":["正弦","物","sinus"],"cosinus":["余弦","物","cosinus"],"lemn":["引理","物","lemn"],"coroll":["推论","物","coroll"],"demonstr":["论证","物","demonstr"],"praemiss":["前提","物","praemiss"],"analog":["类比","物","analog"],"antinom":["二律背反","物","antinom"],"metonym":["转喻","物","metonym"],"synecdoch":["提喻","物","synecdoch"],"hyperbol":["夸张","物","hyperbol"],"ironia":["反讽","物","ironia"],"allegor":["寓言","物","allegor"],"enthymem":["省略推理","物","enthymem"],"aporia":["疑难","物","aporia"],"elench":["反驳法","物","elench"],"rhythmus":["节律","物","rhythmus"],"scala":["音阶","物","scala"],"octava":["八度","物","octava"],"monod":["独奏","物","monod"],"orchestra":["乐队","物","orchestra"],"lyricus":["抒情","物","lyricus"],"arioso":["咏叹","物","arioso"],"sonat":["奏鸣","物","sonat"],"fuga":["赋格","物","fuga"],"canon":["卡农","物","canon"],"praelud":["序曲","物","praelud"],"overtura":["开场曲","物","overtura"],"cadentia":["终止式","物","cadentia"],"timbr":["音色","物","timbr"],"virtuose":["名手","物","virtuose"],"concentus":["和声","物","concentus"],"harmonia":["和声学","物","harmonia"],"melisma":["花腔","物","melisma"],"tonalis":["调性的","物","tonalis"],"modalis":["调式的","物","modalis"],"dissonan":["不协和","物","dissonan"],"consenan":["协和","物","consenan"],"thema":["主题","物","thema"],"paideia":["教育","物","paideia"],"didactic":["教授法","物","didactic"],"pedagog":["教学法","物","pedagog"],"syllabus":["教学大纲","物","syllabus"],"academia":["学院","物","academia"],"lyceum":["学园","物","lyceum"],"scholarch":["校长","物","scholarch"],"professor":["教授","物","professor"],"lectura":["讲席","物","lectura"],"seminarium":["研讨课","物","seminarium"],"tutela":["导师","物","tutela"],"matricul":["注册","物","matricul"],"graduat":["毕业","物","graduat"],"thesis":["论文","物","thesis"],"dissertat":["学位论文","物","dissertat"],"symposium":["学术会议","物","symposium"],"pedant":["炫学者","物","pedant"],"didascal":["教条","物","didascal"],"collegium":["学社","物","collegium"],"rector":["院长","物","rector"],"auditor":["旁听者","物","auditor"],"probato":["考试","物","probato"],"laurea":["学位","物","laurea"],"oeconomia":["经济","物","oeconomia"],"chrematist":["理财术","物","chrematist"],"trapez":["银行家","物","trapez"],"drachma":["德拉克马","物","drachma"],"obolus":["小币","物","obolus"],"stater":["金币","物","stater"],"talentum":["塔兰特","物","talentum"],"nomism":["通货","物","nomism"],"monopol":["垄断","物","monopol"],"oligopol":["寡头垄断","物","oligopol"],"kartel":["卡特尔","物","kartel"],"syndicat":["辛迪加","物","syndicat"],"kredit":["信贷","物","kredit"],"debet":["借方","物","debet"],"saldo":["余额","物","saldo"],"ratio":["预算","物","ratio"],"census":["普查","物","census"],"portorium":["关税","物","portorium"],"nummulari":["钱商","物","nummulari"],"fenus":["利息","物","fenus"],"usura":["高利贷","物","usura"],"syngraf":["契约","物","syngraf"],"banca":["钱庄","物","banca"],"strategus":["战略家","物","strategus"],"tactica":["战术","物","tactica"],"hoplit":["重装兵","物","hoplit"],"phalanx":["方阵","物","phalanx"],"legio":["军团","物","legio"],"maniple":["小队","物","maniple"],"alar":["翼队","物","alar"],"turna":["骑兵队","物","turna"],"cataphract":["铁甲骑","物","cataphract"],"poliorket":["攻城术","物","poliorket"],"navarch":["舰队司令","物","navarch"],"taxiarch":["支队长","物","taxiarch"],"strategema":["计谋","物","strategema"],"agmen":["行军纵队","物","agmen"],"optio":["副官","物","optio"],"decurio":["十夫长","物","decurio"],"centurio":["百夫长","物","centurio"],"tribunus":["护民官","物","tribunus"],"praesidium":["戍卫","物","praesidium"],"explorator":["斥候","物","explorator"],"speculator":["探子","物","speculator"],"mor":["桑","物","mor"],"autumn":["秋","物","autumn"],"vados":["浅","性","vados"],"latifol":["阔叶","物","latifol"],"mediterran":["地中海","物","mediterran"],"semi":["半","性","semi"],"infern":["地狱","物","infern"],"lumen":["微光","物","lumen"]}};

module.exports = EpXsCSyntaxPlugin;
