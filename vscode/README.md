# TeXmark for VS Code

Language support for [TeXmark](https://github.com/klepo0/texmark) (`.tmd`),
Markdown that's secretly LaTeX: write papers and notes without a preamble,
with Markdown shortcuts for the boilerplate and every LaTeX command still
working anywhere.

## Features

- **Syntax highlighting.** Headings, emphasis, lists, links, figures,
  footnotes, `::: theorem` blocks, `{#labels}`, `@references` and
  `[@citations]` in Markdown colours; maths, environments and commands in
  VS Code's LaTeX colours (the same grammar LaTeX Workshop uses).
- **Snippets.** `thm`, `lem`, `prop`, `cor`, `def`, `rem`, `ex`, `proof`,
  `eq` (numbered equation), `dm` (display maths), `align`, `cases`, `pmatrix`,
  `fig`, `fn` (footnote), `cite`, `front` (front matter), `newc`, `tikz`,
  `tikzcd` and more.
- **Completion.**
  - `@` suggests the labels in the file (`@thm:main`, `@eq:heat`), with
    their kind and title.
  - `[@` and `\cite{` suggest the keys of the `.bib` files named in the front
    matter (`bib: refs.bib`) or by `\bibliography{…}`, searchable by author,
    title and year.
  - `\` suggests the file's own macros (`\newcommand`, `\DeclareMathOperator`,
    `\def`, and those in `macros:` files) and common LaTeX commands, with
    maths commands first inside maths.
  - `\begin{` suggests environments and adds the matching `\end`; `:::`
    suggests theorem kinds; front-matter keys complete at the top.
- **Hover and go to definition** for `@labels`, citations and macros.
- **Outline, breadcrumbs and folding** by section and by `:::` block.
- **Reference checks.** `@thm:x` and `\ref{…}` to labels the file does not
  define, and citations missing from its `.bib` files, are underlined.
- **Convert to .tex.** Writes `paper.tex` next to `paper.tmd`: an ordinary
  LaTeX file with the standard preamble, ready for arXiv or a journal.
- **Build PDF** (Ctrl+Alt+B) with your own LaTeX through `latexmk`. LaTeX's
  errors and warnings appear on the right lines of the `.tmd` file. The PDF
  lands next to the `.tmd`; the generated `.tex` and auxiliary files stay in a
  `.texmark` folder. **View PDF** is Ctrl+Alt+V.
- **Live preview** through the
  [TeXglass](https://marketplace.visualstudio.com/items?itemName=klepo1.texglass)
  extension: rendered maths, numbered theorems, working references and its
  reading tools, with no LaTeX installation needed. TeXmark offers to install
  it the first time you open the preview.
- **Auto-closing maths.** `$` gives `$ $`, a second `$` gives `$$ $$`, `\(`
  gives `\( \)` and `\[` gives `\[ \]`. Typing the closer goes over it, and
  backspace in an empty pair removes both sides. Add your own pairs, such as
  `\left(` … `\right)`.
- **Ctrl+B** and **Ctrl+I** toggle `**bold**` and `*italic*`; with nothing
  selected, backspace between the marks removes both.

## Settings

Every automatic feature can be turned off or adjusted.

| Setting | Default | |
| --- | --- | --- |
| `texmark.autoClose.enabled` | `true` | close maths delimiters as you type |
| `texmark.autoClose.pairs` | `$`, `$$`, `\(`, `\[` | opener → closer; add your own or remove one |
| `texmark.completion.labels` | `true` | labels after `@` and in `\ref{…}` |
| `texmark.completion.citations` | `true` | `.bib` keys after `[@` and in `\cite{…}` |
| `texmark.completion.macros` | `true` | your macros after `\` |
| `texmark.completion.latexCommands` | `true` | common LaTeX commands after `\` |
| `texmark.completion.extraCommands` | `[]` | more commands: `"Hom"` or `{ "name": "norm", "snippet": "norm{${1}}" }` |
| `texmark.completion.environments` | `true` | environments in `\begin{…}` |
| `texmark.completion.environmentEnd` | `true` | add the matching `\end{…}` |
| `texmark.completion.blocks` | `true` | theorem kinds after `:::` |
| `texmark.completion.frontMatter` | `true` | front-matter keys |
| `texmark.completion.snippets` | `true` | the snippets |
| `texmark.completion.customSnippets` | `{}` | your snippets by name (VS Code format); a built-in name replaces it, `null` removes it |
| `texmark.hover.enabled` | `true` | hovers on labels, citations and macros |
| `texmark.lint.references` | `true` | underline references to missing labels |
| `texmark.lint.citations` | `true` | underline citations missing from the `.bib` |
| `texmark.shortcuts.bold` | `true` | Ctrl+B toggles bold |
| `texmark.shortcuts.italic` | `true` | Ctrl+I toggles italic (turn off to keep Ctrl+I for inline chat) |
| `texmark.build.tool` | `latexmk` | `engine` runs the engine, BibTeX, then the engine twice (no Perl needed) |
| `texmark.build.engine` | `pdflatex` | or `xelatex`, `lualatex` |
| `texmark.build.outDir` | `.texmark` | build folder, relative to the `.tmd` file |
| `texmark.build.copyPdfNextToSource` | `true` | put `paper.pdf` next to `paper.tmd` |
| `texmark.build.onSave` | `false` | build every time you save |
| `texmark.build.openPdf` | `false` | open the PDF after a build |
| `texmark.pdf.viewer` | `auto` | a VS Code tab when a PDF viewer extension is installed, else the system viewer |

Keyboard shortcuts can be changed in VS Code's Keyboard Shortcuts editor
(search for "TeXmark").

## Requirements

Nothing for editing and the preview. Build PDF needs a TeX distribution
([TeX Live](https://tug.org/texlive/) or [MiKTeX](https://miktex.org/)).

## License

MIT
