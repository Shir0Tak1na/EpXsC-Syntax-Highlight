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

## 四类名字怎么认出来的

| 类别 | 认法 | 颜色 |
| :--- | :--- | :--- |
| **术式名（声明）** | 大写开头且后面紧跟 `(` `{` `[`，或下划线复合名（`Gramakipo_Aepaus`） | 黄 `--epx-decl`（浅色主题自动压深） |
| **类型名** | ① 登记表 `TYPES`（`METOS`、`locus`）；② 参数表里紧跟 `(` 或 `,`、后面是冒号的词（`locus: zone` 的 `locus`）。用 Prism 的 lookbehind 写法实现，单字母按变量名放过 | 青 `--epx-type` |
| **元素码** | `ELEMENTS` 十种，大小写敏感 | 青（与类型同族） |
| **谓词 / 谓词调用** | 词典「动词」表，以及后面跟 `(` 的小写词 | 蓝 `--epx-verb` |

「类型: 变量名」的写法里**变量名不着色**（类型在前，如 `locus: zone`）。`构思案/_术式语法_粘贴原文.md` 里那几块是旧写法（`zone: locus`），会反过来着色，属正常。

## 词表：从词典自动读

插件载入时读

`世界设定集/地域文化图鉴/语言/述无空语/述无空语词典.md`

的这些小节（只取表格第一列）：**介词 / 助动词 / 判断词 / 时间限定 / 数量与范围限定 / 指称限定 / 顺序限定 / 代词（人称）/ 疑问词 / 连接词与从句标记 / 术式关键词** → 判断词类；**动词** → 谓词类；**程度限定** → 程度词；**单位** → 单位。改词典即改配色范围；读不到就退回 `main.js` 里的内置词表（两者取并集）。元素码 `ELEMENTS`、域类型 `TYPES`、可缩放轴 `AXES` 写在 main.js 常量里。
## token 类名与配色

类名：`comment annotation pretium keyword predicate function declaration element type unit number degree axis pointer operator paren bracket brace punctuation rankRange`。参数表里的类型位会输出两个类（`token typeParam type`），走 `.token.type` 的样式。

**括号按种类分了三类**：`()` → `paren`，`[]` → `bracket`（列表 ／ 下标 ／ **秩**），`{}` → `brace`（语块）——对应语法里的「容器类型由括号自己声明」。

**秩区间**：`1..3`、`..10`、`2..` 这类由 `rankRange` 单独着色（默认橙、加粗、虚线下划线）。模式要求至少一边有数字，所以省略号 `...` 不会被吃掉，仍归 `operator`。

**嵌套括号**：Prism 是逐位置的词法分析、数不了层数，所以 `main.js` 里的 `markBracketDepth()` 在它产出 HTML 之后再扫一遍，给每个括号补上 `epx-d1` / `epx-d2` / `epx-d3`（三层一循环，再深轮回第一层）。第 1 层保持分类色（`[` 青、`()` 淡、`{}` 略亮），**第 2 层起才换色**（`--epx-b2` 品红、`--epx-b3` 绿），既不吵又能对上号：

| 写法 | 层数反映 |
| :--- | :--- |
| `ExpasteZone(METOS: [2:metos])` | `(` d1，`[` d2 —— 内层的秩方括号被顶出来 |
| `luss (15 + 35 * intervall(a, b)) MU;` | 外层 `(` d1，`intervall(` 的 `(` d2 |
| `(*x1)[1..3] = x2;` | `(` d1 先闭合，`[1..3]` 回到 d1 |

不想要嵌套换色：把 `styles.css` 末尾 `.epx-d2` / `.epx-d3` 两条删掉即可（`epx-d*` 类照旧生成，只是没有色差）。
## 已知边界

- **阅读视图 / PDF 导出**：完整高亮。
- **实时预览（编辑态）**：Obsidian 编辑器走 CodeMirror 自己的解析器、不读 Prism，所以只有代码块外观、没有 token 着色。按 Ctrl+E 切到阅读视图即可见。
- 外框与右上角语言签用了 CSS `:has()`，需要 iOS 15.4+ / 较新的 Chromium；不满足时只是外框与语言签不出现，token 着色不受影响。
- 词表依赖上表那份词典笔记；换库或改路径请同步改 `main.js` 里的 `DICT_PATH`。

## License

Apache-2.0
