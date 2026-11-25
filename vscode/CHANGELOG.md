# Changelog

## Unreleased

- Choosing an environment after the `\begin` completion no longer writes a
  second `\begin … \end`; snippets no longer appear inside `\begin{…}`.
- Auto-closing `$ $`, `$$ $$`, `\( \)`, `\[ \]`, with your own pairs.
- Backspace between empty `** **`, `* *` or maths delimiters removes both sides.
- Settings for every automatic feature (`texmark.completion.*`,
  `texmark.autoClose.*`, `texmark.hover.enabled`, `texmark.lint.citations`,
  `texmark.shortcuts.*`), custom snippets and extra commands.

## 0.1.0

First version: the TeXmark (.tmd) language with syntax highlighting,
snippets, completion for labels, citations, macros, environments, block kinds
and front-matter keys, hover and go to definition, outline and folding,
reference checks, Convert to .tex, Build PDF with latexmk (errors on the .tmd
lines), View PDF, a live preview through TeXglass, and Ctrl+B / Ctrl+I.
