# TeXmark

**Markdown that's secretly LaTeX.** Write papers and notes without a
preamble. Markdown shortcuts cover the boilerplate, and every LaTeX command,
macro, package and environment still works anywhere. One command turns the
file into an ordinary `.tex` file that compiles for arXiv or a journal.

```markdown
---
title: Heat flow on a toy surface
author: A. N. Author
---

\newcommand{\R}{\mathbb{R}}

# Introduction {#sec:intro}

Let $u : [0,T] \times M \to \R$ solve the *heat equation*
$$ \partial_t u = \Delta u . $$ {#eq:heat}

::: theorem [Convergence] {#thm:main}
If $M$ is compact, then $u(t) \to \bar u$.
:::

::: proof
Multiply @eq:heat by $u$ and integrate, as in [@evans2010, Ch. 7].
:::
```

[TeXglass](https://github.com/klepo0/TeXglass) shows `.tmd` files directly,
with all its reading tools.

## Use it

```sh
npx texmark paper.tmd          # writes paper.tex
npx texmark paper.tmd -o -     # prints it
```

From JavaScript (Node or the browser, no dependencies):

```js
const TeXmark = require('texmark');            // or <script src="texmark.js"> → window.TeXmark
const { latex, body, preamble, bodyLine } = TeXmark.convert(source);
```

`body` has exactly one line per source line, and `bodyLine` is where source
line 1 sits in `latex`, so error messages map straight back.

## The format

See [SPEC.md](SPEC.md). In short:

- `#` headings, `*emph*`, `**bold**`, `` `code` ``, `-` and `1.` lists, `>` quotes
- `$…$` and `$$…$$` maths; `$$…$$ {#eq:x}` is a numbered equation
- `::: theorem [Title] {#thm:x}` … `:::` blocks, declared for you
- `@thm:x` references (`\cref`), `[@key, p. 3]` citations, `^[footnotes]`
- `[links](https://…)`, `![figures](file.pdf){#fig:x width=60%}`
- an optional YAML header for title, authors, abstract, packages and `.bib`
- anything else is LaTeX, and maths and environments are never touched

## License

MIT. See [LICENSE](LICENSE).
