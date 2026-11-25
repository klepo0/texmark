# TeXmark format, version 0.1

TeXmark is Markdown that is secretly LaTeX. A `.tmd` file is a LaTeX document
body with no preamble and no `\begin{document}`, where a few Markdown
shortcuts stand in for the boilerplate. Every LaTeX command still works
anywhere. A converter turns the file into ordinary LaTeX.

This file is the specification. `texmark.js` is the reference converter, and
`test/texmark.test.js` pins down its behaviour.

## 1. The guarantee: line for line

Source line *k* becomes body line *k*. The converter never adds or removes a
line in the body: front-matter lines become blank lines, and closing
commands (`\end{itemize}`, `\end{quote}`) are added at the end of an existing
line. The full document is `preamble`, then the body, then the bibliography
and `\end{document}`. `bodyLine` says where source line 1 sits, so errors,
SyncTeX and click-to-source map back with a fixed offset.

## 2. What is never touched

Markdown shortcuts apply only to prose. These pass through exactly as written:

1. Maths: `$…$`, `$$…$$`, `\(…\)`, `\[…\]`.
2. Every environment except the prose ones (below), with all its contents:
   `align`, `equation`, `tikzpicture`, `tikzcd`, `tabular`, `array`,
   `verbatim`, a paper's own environments, and so on.
3. Commands, and the arguments of commands that take keys, paths or
   definitions: `\label`, `\ref`, `\cref`, `\cite`…, `\url`, `\href` (its URL),
   `\includegraphics`, `\input`, `\newcommand`, `\renewcommand`, `\def`,
   `\newtheorem`, `\newenvironment`, `\DeclarePairedDelimiter`, `\tikzset`, and
   the like. Other commands keep their arguments as prose, so
   `\textbf{*x*}` gives `\textbf{\emph{x}}`.
4. Comments: `%` to the end of the line.
5. Code: `` `…` `` and fenced blocks (```` ``` ````).

**Prose environments**, where shortcuts do apply: `document`, `abstract`,
`center`, `flushleft`, `flushright`, `quote`, `quotation`, `verse`,
`itemize`, `enumerate`, `description`, `figure`, `table`, `minipage`,
`proof`, `frame`, `block`, the font-size environments, every theorem kind in
§5, and every environment the file declares with `\newtheorem`.

**Preamble-only commands** in the body (`\usepackage`, `\documentclass`,
`\DeclareMathOperator`, `\usetikzlibrary`) are removed from the body and
placed in the preamble. Their lines stay, blank.

## 3. Front matter (optional)

A YAML block between `---` lines at the very top.

| Key | Meaning | Default |
| --- | --- | --- |
| `title` | `\title` (shortcuts and maths allowed) | none |
| `author` | one name, a list of names, or a list of authors with details (below) | none |
| `date` | `\date`; `today` gives `\today` | class default |
| `abstract` | the abstract (use `\|` for several lines) | none |
| `keywords`, `subjclass` | amsart `\keywords`, `\subjclass[2020]` | none |
| `class`, `classoptions` | `\documentclass[classoptions]{class}` | `amsart` |
| `packages` | list; `name`, `name[opts]` or `[opts]name` | none |
| `macros` | file(s) to `\input` in the preamble | none |
| `bib` (or `bibliography`), `bibstyle` | `.bib` file(s) and style | none, `amsplain` |
| `numbering` | theorem numbers within `section` (or `chapter`…), or `global` | `section` |

### Authors

Each author in the list may be a name or a map with these keys:

| Key | Meaning |
| --- | --- |
| `name` | the name (required) |
| `affiliation` | one institute, or a list (`[A, B]` or `- A` lines); `affiliations`, `affil`, `institute`, `institution` and `address` mean the same |
| `email` | the email address |
| `orcid` | an ORCID iD (`0000-0002-…`) or its URL |
| `thanks` | a footnote on the name: funding, "corresponding author" |
| `curraddr` | current address, if it differs from the affiliation |

```yaml
author:
  - name: Ann Smith
    affiliation:
      - University of Leeds
      - University of Oxford
    email: ann@example.org
  - name: Bob Jones
    affiliation: University of Leeds
    thanks: Supported by a grant.
```

How it comes out depends on the class:

- **amsart** (and amsbook, amsproc): per author `\author`, one `\address` per
  institute, `\curraddr`, `\email`, `\urladdr{https://orcid.org/…}` and
  `\thanks`.
- **article, report, book**: when every author has at most one institute and
  no two share one, a single `\author{Name\\ Institute\\ \texttt{email}
  \and …}`. Otherwise authblk (loaded for you) numbers each institute once:
  `\author[1,2]{Ann Smith}`, `\author[1]{Bob Jones}`, `\affil[1]{University
  of Leeds}`, with the email in a `\thanks`. `thanks`, `orcid` and `curraddr`
  are `\thanks` footnotes.
- **beamer**: `\author{Ann Smith\inst{1,2} \and …}` and `\institute{\inst{1}
  University of Leeds \and …}`, with the emails on the last line.

## 4. Prose shortcuts

| You write | LaTeX |
| --- | --- |
| `# T`, `## T`, `### T`, `#### T`, `##### T` | `\section{T}`, `\subsection`, `\subsubsection`, `\paragraph`, `\subparagraph` |
| `# T {#sec:x}` | `\section{T}\label{sec:x}` |
| `# T {-}` or `{.unnumbered}` | `\section*{T}` |
| `*t*`, `_t_` | `\emph{t}` (`_` only at word edges: `snake_case` is text) |
| `**t**`, `__t__` | `\textbf{t}` |
| `` `c` `` | `\texttt{c}` with special characters escaped |
| ```` ``` ```` fenced block | `verbatim` |
| `- a`, `* a`, `+ a` | `itemize`; nest by indenting |
| `1. a`, `1) a` | `enumerate`; a first number other than 1 sets the counter |
| `> q` | `quote` |
| `---`, `***` alone on a line | a horizontal rule |
| `$$ … $$` | `\[ … \]` |
| `$$ … $$ {#eq:x}` (or `\label` inside) | `equation` with `\label{eq:x}` |
| `::: name [Title] {#id}` … `:::` | `\begin{name}[Title]\label{id}` … `\end{name}` |
| `@key` | `\cref{key}`, when `key` is a label in the file or contains `:` |
| `[@key]`, `[@a; @b]` | `\cite{key}`, `\cite{a,b}` (labels give `\cref`) |
| `[@key, p. 3]`, `[see @key]` | `\cite[p. 3]{key}`, `see~\cite{key}` |
| `[text](https://…)` | `\href{https://…}{text}` |
| `[text](#label)` | `\hyperref[label]{text}` |
| `<https://…>` | `\url{https://…}` |
| `![Caption](file){#fig:x width=60%}` alone on a line | `figure` with `\includegraphics[width=0.6\linewidth]`, caption, label |
| `![](file)` inside text | `\includegraphics{file}` |
| `text^[note]` | `text\footnote{note}` |
| `"quoted"` | ` ``quoted'' ` |
| `{#id}` anywhere else | `\label{id}` |

`\cref` is loaded with `capitalise,noabbrev`, so `@thm:main` reads
"Theorem 1.1" and `@eq:heat` reads "Equation (1)". Write `@sec:intro`, not
"Section @sec:intro".

## 5. Theorem blocks

`::: kind` opens and a line of only `:::` closes. Blocks nest. The title in
`[…]` and the attributes in `{…}` are optional. Pandoc's form
`::: {#thm:x .theorem}` works too.

Known kinds, declared automatically in the preamble with one shared counter:

| Style | Kinds (aliases) |
| --- | --- |
| plain | theorem (thm), lemma (lem), proposition (prop), corollary (cor), conjecture (conj), claim, hypothesis (hyp) |
| definition | definition (def, defn), assumption (assum), example (ex), exercise, problem, question, notation (nota) |
| remark | remark (rem), note |

`::: theorem*` gives an unnumbered one. `::: proof` gives `proof`. Any other
name opens that environment as is, for example `::: center` or a kind the
file declares itself with `\newtheorem` (which is then not declared again).

## 6. Characters

In prose, `&`, `#`, `_` and `^` mean themselves (`\&`, `\#`, `\_`, `\^{}`).
`%` starts a comment, except right after a digit (`50%` is a percent sign).
`$` starts maths only when the next character is not a space and a matching
`$` follows (not followed by a digit), so "costs $5 and $6" is text.
`\*`, `\_`, `\$`, `\%`, `\&`, `\#` are literal characters. `\@thm` is a
literal `@thm`. `~` is a non-breaking space, as in LaTeX. `--` and `---`
are LaTeX dashes.

## 7. Not in version 0.1

Pipe tables (write `tabular`), setext headings, definition lists, task lists,
emphasis that spans lines, and nested block quotes.
