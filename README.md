# EpXsC Syntax Highlight

给 **EpXsC（述无空语构造记号 / Expaulxsirian Construct）** 代码块做真正的语法高亮。An Obsidian plugin + CSS snippet that turns ```EpXsC code blocks into properly coloured tokens.

```EpXsC
Expaste(METOS: a, METOS: b) {
	intervall(a, b) <= 66 miteas;
	luss (15 + 35 * intervall(a, b)) MU;
}
```

## 为什么光有 CSS 不够

Obsidian 的代码块只有在 Prism 认识那个语言时才会被切成 `<span class="token keyword">` 这类小片。`EpXsC` 不在 Prism 的语言表里，DOM 里就是一整块纯文本，而 CSS 没法按文本内容选元素。所以：

| 文件 | 职责 |
| :--- | :--- |
| `main.js` | 把 EpXsC 注册进 Prism（分词） |
| `styles.css` | token 配色与代码块外框（插件启用时自动加载） |
| `snippets/EpXsC-Highlight.css` | 同一套配色的独立片段，给只想用片段、不开插件的人 |

## 安装

1. 把 `main.js`、`manifest.json`、`styles.css` 放进 `<库>/.obsidian/plugins/epxsc-syntax/`
2. 设置 → 第三方插件 → 关闭受限模式 → 刷新 → 打开 **EpXsC Syntax**

`styles.css` 随插件自动加载，**不需要**再开 CSS 片段。

只要配色、不要插件：把 `snippets/EpXsC-Highlight.css` 放进 `<库>/.obsidian/snippets/`，在外观 → CSS 代码片段里启用 —— 但那样只有代码块外框，没有 token 着色。

## 词表：从词典自动读

谓词、判断词、程度词、单位四类词，在插件载入时从

`世界设定集/地域文化图鉴/语言/述无空语/述无空语词典.md`

的「动词 / 判断词 / 助动词 / 术式关键词 / 程度限定 / 单位」小节读取（只取表格第一列），改词典即改配色范围；读不到就退回 `main.js` 里的内置词表（两者取并集）。元素码十种与可缩放轴（`vis` / `diu` / `celer` …）写在 `ELEMENTS`、`AXES` 常量里。

## token 类名与配色

类名：`comment annotation pretium keyword predicate function declaration element type unit number degree axis label pointer operator punctuation`。

配色全在 `styles.css` 第 1 节的 `--epx-*` 变量里，取自 Obsidian 主题变量，深浅主题自动适配。

## 已知边界

- **阅读视图 / PDF 导出**：完整高亮。
- **实时预览（编辑态）**：Obsidian 编辑器走 CodeMirror 自己的解析器、不读 Prism，所以只有代码块外观、没有 token 着色。按 Ctrl+E 切到阅读视图即可见。
- 外框与右上角语言签用了 CSS `:has()`，需要 iOS 15.4+ / 较新的 Chromium；不满足时只是外框与语言签不出现，token 着色不受影响。
- 词表依赖上表那份词典笔记；换库或改路径请同步改 `main.js` 里的 `DICT_PATH`。

## License

Apache-2.0
