# Changelog

## 0.1.1

- The converter handles richer author lists in the front matter: several
  institutes per author (`affiliation: [A, B]` or `- A` lines), institutes
  shared by co-authors (listed once, with authblk marks in article), `orcid`,
  `thanks` and `curraddr`, and `institute` / `address` in place of
  `affiliation`. Emails are no longer dropped in article.

## 0.1.0

First version: the TeXmark (.tmd) language with syntax highlighting,
snippets, completion for labels, citations, macros, environments, block kinds
and front-matter keys, hover and go to definition, outline and folding,
reference checks, Convert to .tex, Build PDF with latexmk (errors on the .tmd
lines), View PDF, a live preview through TeXglass, and Ctrl+B / Ctrl+I.
It also has auto-closing `$ $`, `$$ $$`, `\( \)` and `\[ \]` (with your own
pairs), backspace that removes both sides of an empty pair or `** **`, and a
setting for every automatic feature (`texmark.completion.*`,
`texmark.autoClose.*`, `texmark.hover.enabled`, `texmark.lint.*`,
`texmark.shortcuts.*`), with custom snippets and extra commands.
