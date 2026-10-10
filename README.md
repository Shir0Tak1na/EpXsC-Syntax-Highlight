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
## 悬停提示（像 IDE 那样）

鼠标停在有释义的 token 上会浮出一张小卡片：上一行是类别，下一行是释义。

| 悬停对象 | 显示 |
| :--- | :--- |
| `plur` | 谓词 · 动词 净化 |
| `locus`（类型位） | 类型名（缩写 LOCs）· 名词 地点、位置 |
| `METOS` | 类型名 · 术式关键词 对象、目标（术式的目标项） |
| `genus` / `intervall` / `ordin` / `limit` … | 筛选键 · 该键的语义 |
| `1..3` | 秩 1–3 · x, y, z · 三维空间元组（第三维度，占 3 秩） |
| `7..9` | 秩 7–9 · 第七、八、九秩的来历 |
| `..10` / `2..` | 区间上界／下界 |
| `[` `(` `{` | 方括号／圆括号／花括号的语法职务 |
| `Purificatio` | 术式名 · 本术式的声明名 |
| `&` `*&` `@` | 指针的三种取法 |

数据全部在载入时从库里读，改文件即改提示：

1. `述无空语词典.md` —— 词性（取所在小节）＋ 释义 ＋ 缩写，约 475 条
2. `述无空语术式语法.md` 的「筛选键」表 —— 10 个键
3. `维度模型.md` 的「九个秩与维度的对应」表 —— 秩的构成

浮层用 `position: fixed` 挂在 `body` 上，所以不会被代码块的 `overflow` 裁掉；样式在 `styles.css` 第 5 节（`.epx-tip`）。区间（`rankRange` 类）覆盖所有 `a..b` 写法：两端都落在秩表里才显示秩的构成，否则按普通区间处理（距离、角度、量值）。

**两种视图都可用**：阅读视图按 token 取类别；实时预览里代码块不是 Prism 渲染的（没有 token），改为取光标下的那个词直接查词典，所以照样有提示。浮层加了 inline 的 `position: fixed` 兜底，即使 CSS 没加载也能看见（便于排查）。

**自检**：命令面板里搜「EpXsC 悬停自检」——会显示词典/秩表的条数、当前视图、本页 EpXsC 代码块数量与其中带 token 的数量。悬停不出东西时先跑它：

- 「代码块 0 个」→ 语言标记没识别到（检查围栏是不是 ```` ```EpXsC ````）
- 「带 token 0 个」→ 插件没重载（设置 → 第三方插件 → 关掉再打开）
- 「词典 0 条」→ 词典路径读不到

**边界**：移动端没有 hover。

## 启动时序与自愈

Obsidian 启动时，首屏可能在社区插件加载完成**之前**就已渲染（那一次不经过插件的 markdown 后处理器），`window.Prism` 也可能尚未就绪。插件因此带一层自愈，不必手动切笔记：

- 载入后 0.4s / 1.5s 各补一次
- `layout-change`、`active-leaf-change` 时补
- 每 2.5s 的看门狗：确认「EpXsC 语法仍在 `Prism.languages` 里」且「页面上每个 EpXsC 代码块都有 token」，缺哪个补哪个

## 已知边界

- **阅读视图 / PDF 导出**：完整高亮。
- **实时预览（编辑态）**：Obsidian 编辑器走 CodeMirror 自己的解析器、不读 Prism，所以只有代码块外观、没有 token 着色。按 Ctrl+E 切到阅读视图即可见。
- 外框与右上角语言签用了 CSS `:has()`，需要 iOS 15.4+ / 较新的 Chromium；不满足时只是外框与语言签不出现，token 着色不受影响。
- 词表依赖上表那份词典笔记；换库或改路径请同步改 `main.js` 里的 `DICT_PATH`。

## License

Apache-2.0
