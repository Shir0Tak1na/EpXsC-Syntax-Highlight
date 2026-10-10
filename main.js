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

const { Plugin, TFile, Notice, MarkdownView } = require('obsidian');

const LANG_KEYS = ['EpXsC', 'epxsc', 'EPXSC'];
const CODE_SELECTOR = 'code[class*="language-EpXsC" i]';
const DICT_PATH = '世界设定集/地域文化图鉴/语言/述无空语/述无空语词典.md';
/* 秩的构成表：悬停秩区间时显示（维度模型 · 九个秩与维度的对应） */
const RANK_PATH = '世界设定集/设定概念集合/维度/维度模型.md';
/* 术式语法文档：读「筛选键」表，给 genus / intervall / ordin … 挂释义 */
const SYNTAX_PATH = '世界设定集/地域文化图鉴/语言/述无空语/述无空语术式语法.md';

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
    const comp = m[2].replace(/\$/g, '').replace(/\\/g, '').replace(/\s+/g, ' ').trim();
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

/* ---------- 悬停提示 ---------- */

/* 一个 token 可能带多个类（如 typeParam + type），按语义优先级取第一个 */
const CLASS_ORDER = ['rankRange', 'bracket', 'paren', 'brace', 'pointer', 'declaration', 'type', 'element', 'unit', 'predicate', 'function', 'keyword', 'pretium', 'degree', 'axis', 'number', 'word'];

const CLASS_LABEL = {
  declaration: '术式名',
  predicate: '谓词',
  function: '谓词调用',
  type: '类型名',
  element: '元素码',
  unit: '单位',
  number: '数值',
  degree: '程度词',
  axis: '缩放轴',
  pretium: '代价'
};

function pickClass(classList) {
  for (let i = 0; i < CLASS_ORDER.length; i++) {
    if (classList.contains(CLASS_ORDER[i])) return CLASS_ORDER[i];
  }
  return null;
}

/* 相邻单秩合成一段：7..9 → 第七、八、九秩的来历（秩表里只有单条时用） */
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
    if (b) return { label: '至 ' + b, body: '区间上界 ' + b + '（含）——如 intervall=..' + b + ' 即「' + b + ' 以内」' };
    if (a) return { label: '自 ' + a + ' 起', body: '区间下界 ' + a + '（含）' };
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
  const head = CLASS_LABEL[cls] || entry.pos || '词条';
  const raw = entry.abbr || '';
  const showAbbr = raw && raw !== '—' && raw !== '-' && raw.toLowerCase() !== String(text).toLowerCase();
  const abbr = showAbbr ? '（缩写 ' + raw + '）' : '';
  const detail = [entry.pos && entry.pos !== head ? entry.pos : '', entry.meaning].filter(Boolean).join(' · ');
  return { label: head + abbr, body: detail };
}

let tipNode = null;

function ensureTipNode() {
  if (tipNode && tipNode.parentNode) return tipNode;
  tipNode = document.createElement('div');
  tipNode.className = 'epx-tip';
  tipNode.style.position = 'fixed';
  tipNode.style.zIndex = '9999';
  tipNode.style.pointerEvents = 'none';
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
  if (tipNode) tipNode.classList.remove('is-visible');
}

/* 阅读视图：命中 token 就按它的类别给提示 */
function tipForToken(el, info, ranks) {
  const cls = pickClass(el.classList);
  if (!cls) return null;
  return buildTip(cls, el.textContent || '', info, ranks);
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

class EpXsCSyntaxPlugin extends Plugin {
  onload() {
    const self = this;
    this.grammar = makeGrammar(BASE_LISTS);
    this.info = new Map();
    this.ranks = new Map();
    this.install();
    this.registerDomEvent(document, 'mouseover', function (ev) {
      hideTip();
      const el = ev.target;
      if (!el || !el.closest) return;
      const token = el.closest('span.token');
      if (token && el.closest('code[class*="language-EpXsC" i]')) {
        const tip = tipForToken(token, self.info, self.ranks);
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
      id: 'self-check',
      name: '悬停提示自检',
      callback: function () { self.selfCheck(); }
    });
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
  async refresh() {
    let lists = BASE_LISTS;
    try {
      const file = this.app.vault.getAbstractFileByPath(DICT_PATH);
      if (file instanceof TFile) {
        const text = await this.app.vault.cachedRead(file);
        const map = splitSections(text);
        this.info = parseEntries(text);
        lists = {
          keyword: wordsFrom(map, SECTIONS.keyword, FALLBACK.keyword),
          degree: wordsFrom(map, SECTIONS.degree, FALLBACK.degree),
          predicate: wordsFrom(map, SECTIONS.predicate, FALLBACK.predicate),
          unit: wordsFrom(map, SECTIONS.unit, FALLBACK.unit)
        };
      }
      const syntaxFile = this.app.vault.getAbstractFileByPath(SYNTAX_PATH);
      if (syntaxFile instanceof TFile) {
        const infoMap = this.info;
        parseFilterKeys(await this.app.vault.cachedRead(syntaxFile)).forEach(function (entry, key) {
          if (!infoMap.has(key)) infoMap.set(key, entry);
        });
      }
      const rankFile = this.app.vault.getAbstractFileByPath(RANK_PATH);
      if (rankFile instanceof TFile) {
        this.ranks = parseRanks(await this.app.vault.cachedRead(rankFile));
      }
    } catch (err) {
      console.warn('[EpXsC Syntax] 词典读取失败，沿用内置词表：', err);
    }
    this.grammar = makeGrammar(lists);
    this.install();
    console.log('[EpXsC Syntax] 词条 ' + this.info.size + ' 条 · 秩 ' + this.ranks.size + ' 条');
    this.rehighlight();
  }

  /* 自检：告诉用户当前视图里到底有没有 token */
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
    new Notice([
      'EpXsC 悬停自检',
      '词典 ' + this.info.size + ' 条 · 秩 ' + this.ranks.size + ' 条 · 语法' + (this.grammar ? '已装' : '缺失'),
      '当前视图：' + mode,
      'EpXsC 代码块 ' + codes.length + ' 个（带 token 的 ' + tokened + ' 个）',
      '实时预览代码行 ' + lines + ' 行'
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
