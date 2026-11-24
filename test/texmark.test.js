'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const TeXmark = require('../texmark.js');

const body = (src) => TeXmark.convert(src).body;

test('every source line becomes exactly one body line', () => {
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'examples')).filter((f) => f.endsWith('.tmd'))) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'examples', f), 'utf8');
    const r = TeXmark.convert(src);
    assert.equal(r.body.split('\n').length, src.split('\n').length, f);
    const lines = r.latex.split('\n');
    // bodyLine points at source line 1.
    assert.equal(lines.slice(r.bodyLine - 1, r.bodyLine - 1 + src.split('\n').length).join('\n'), r.body);
  }
});

test('headings, labels and unnumbered headings', () => {
  assert.equal(body('# Intro'), '\\section{Intro}');
  assert.equal(body('## Two {#sec:two}'), '\\subsection{Two}\\label{sec:two}');
  assert.equal(body('### Three {-}'), '\\subsubsection*{Three}');
  assert.equal(body('#### Four {.unnumbered}'), '\\paragraph*{Four}');
  assert.equal(body('#nospace'), '\\#nospace');
});

test('emphasis outside maths only', () => {
  assert.equal(body('*a* and **b** and _c_'), '\\emph{a} and \\textbf{b} and \\emph{c}');
  assert.equal(body('$a*b*c$ and $x_1 + y_2$'), '$a*b*c$ and $x_1 + y_2$');
  assert.equal(body('snake_case_name'), 'snake\\_case\\_name');
  assert.equal(body('2 * 3 * 4'), '2 * 3 * 4');
  assert.equal(body('\\*not emph\\*'), '*not emph*');
});

test('LaTeX commands, macros and maths packages pass through', () => {
  assert.equal(body('\\newcommand{\\R}{\\mathbb{R}}'), '\\newcommand{\\R}{\\mathbb{R}}');
  assert.equal(body('\\newcommand\\N{\\mathbb{N}_0}'), '\\newcommand\\N{\\mathbb{N}_0}');
  assert.equal(body('\\def\\foo#1{x_#1}'), '\\def\\foo#1{x_#1}');
  assert.equal(body('Let $f \\in \\mathcal{C}^\\infty(\\mathbb{R}^d)$.'), 'Let $f \\in \\mathcal{C}^\\infty(\\mathbb{R}^d)$.');
  assert.equal(body('\\textbf{*x*}'), '\\textbf{\\emph{x}}');
  assert.equal(body('see \\cref{thm:a_b} and \\label{x_y}'), 'see \\cref{thm:a_b} and \\label{x_y}');
  assert.equal(body('\\includegraphics[width=5cm]{my_fig.pdf}'), '\\includegraphics[width=5cm]{my_fig.pdf}');
});

test('maths and raw environments are untouched', () => {
  const align = '\\begin{align}\n  a &= b * c * d \\\\\n  - x &= _y_\n\\end{align}';
  assert.equal(body(align), align);
  const tikz = '\\begin{tikzpicture}\n# not a heading\n\\draw (0,0) -- (1,1);\n\\end{tikzpicture}';
  assert.equal(body(tikz), tikz);
  assert.equal(body('\\[ a*b*c \\]'), '\\[ a*b*c \\]');
  assert.equal(body('\\(x_1\\) and \\(y_2\\)'), '\\(x_1\\) and \\(y_2\\)');
  assert.equal(body('$a\n*b*\n$'), '$a\n*b*\n$');
});

test('prose environments still get Markdown', () => {
  assert.equal(body('\\begin{theorem}\n*x*\n\\end{theorem}'), '\\begin{theorem}\n\\emph{x}\n\\end{theorem}');
  assert.equal(body('\\newtheorem{hyp}{Hypothesis}\n\\begin{hyp}\n*x*\n\\end{hyp}'),
    '\\newtheorem{hyp}{Hypothesis}\n\\begin{hyp}\n\\emph{x}\n\\end{hyp}');
});

test('display maths: $$ is unnumbered, a label makes an equation', () => {
  assert.equal(body('$$x$$'), '\\[x\\]');
  assert.equal(body('$$\nx\n$$ {#eq:x}'), '\\begin{equation}\\label{eq:x}\nx\n\\end{equation}');
  assert.equal(body('$$ x \\label{eq:y} $$'), '\\begin{equation} x \\label{eq:y} \\end{equation}');
});

test('dollars that are not maths', () => {
  assert.equal(body('It costs $5 and $6.'), 'It costs \\$5 and \\$6.');
  assert.equal(body('A \\$ sign'), 'A \\$ sign');
});

test('theorem blocks', () => {
  assert.equal(body('::: theorem [Main] {#thm:main}\nText.\n:::'),
    '\\begin{theorem}[Main]\\label{thm:main}\nText.\n\\end{theorem}');
  assert.equal(body('::: lem\nx\n:::'), '\\begin{lemma}\nx\n\\end{lemma}');
  assert.equal(body('::: {#thm:q .theorem}\nx\n:::'), '\\begin{theorem}\\label{thm:q}\nx\n\\end{theorem}');
  assert.equal(body('::: proof [Proof of @thm:main]\nx\n:::'), '\\begin{proof}[Proof of \\cref{thm:main}]\nx\n\\end{proof}');
  assert.equal(body('::: center\nx\n:::'), '\\begin{center}\nx\n\\end{center}');
  assert.equal(body('::: theorem*\nx\n:::'), '\\begin{theorem*}\nx\n\\end{theorem*}');
});

test('theorem blocks declare their environments in the preamble', () => {
  const { preamble } = TeXmark.convert('::: lemma\nx\n:::\n::: remark\ny\n:::');
  assert.match(preamble, /\\theoremstyle\{plain\}\n\\newtheorem\{theorem\}\{Theorem\}\[section\]\n\\newtheorem\{lemma\}\[theorem\]\{Lemma\}/);
  assert.match(preamble, /\\theoremstyle\{remark\}\n\\newtheorem\{remark\}\[theorem\]\{Remark\}/);
  const own = TeXmark.convert('\\newtheorem{lemma}{Lemma}\n::: lemma\nx\n:::').preamble;
  assert.doesNotMatch(own, /newtheorem\{lemma\}/);
});

test('references and citations', () => {
  assert.equal(body('By @thm:main.'), 'By \\cref{thm:main}.');
  assert.equal(body('# A {#intro}\nSee @intro.'), '\\section{A}\\label{intro}\nSee \\cref{intro}.');
  assert.equal(body('mail me@example.com or @someone'), 'mail me@example.com or @someone');
  assert.equal(body('[@knuth84]'), '\\cite{knuth84}');
  assert.equal(body('[@a; @b]'), '\\cite{a,b}');
  assert.equal(body('[@a, Thm. 3]'), '\\cite[Thm. 3]{a}');
  assert.equal(body('[see @a]'), 'see~\\cite{a}');
  assert.equal(body('[@thm:a; @thm:b]'), '\\cref{thm:a,thm:b}');
  assert.equal(body('\\@thm:a'), '@thm:a');
});

test('lists', () => {
  assert.equal(body('- a\n- b'), '\\begin{itemize}\\item a\n\\item b\\end{itemize}');
  assert.equal(body('1. a\n2. b'), '\\begin{enumerate}\\item a\n\\item b\\end{enumerate}');
  assert.equal(body('3. a'), '\\begin{enumerate}\\setcounter{enumi}{2}\\item a\\end{enumerate}');
  assert.equal(body('- a\n  - b\n- c'), '\\begin{itemize}\\item a\n  \\begin{itemize}\\item b\\end{itemize}\n\\item c\\end{itemize}');
  assert.equal(body('- a\n\nText'), '\\begin{itemize}\\item a\\end{itemize}\n\nText');
  assert.equal(body('- a\n\n  more\n- b'), '\\begin{itemize}\\item a\n\n  more\n\\item b\\end{itemize}');
  assert.equal(body('- a % note\n\nx'), '\\begin{itemize}\\item a \\end{itemize}% note\n\nx');
  assert.equal(body('::: theorem\n- a\n:::'), '\\begin{theorem}\n\\begin{itemize}\\item a\\end{itemize}\n\\end{theorem}');
});

test('comments, percent signs and special characters', () => {
  assert.equal(body('x % a *comment*'), 'x % a *comment*');
  assert.equal(body('50% more'), '50\\% more');
  assert.equal(body('Q&A #1 x^2'), 'Q\\&A \\#1 x\\^{}2');
});

test('code, quotes, links, footnotes, figures, quotes', () => {
  assert.equal(body('`a_b`'), '\\texttt{a\\_b}');
  assert.equal(body("``quoted'' and `single'"), "``quoted'' and `single'");
  assert.equal(body('"quoted"'), "``quoted''");
  assert.equal(body('[site](https://x.org/a_b%20c)'), '\\href{https://x.org/a_b\\%20c}{site}');
  assert.equal(body('[back](#sec:intro)'), '\\hyperref[sec:intro]{back}');
  assert.equal(body('<https://x.org>'), '\\url{https://x.org}');
  assert.equal(body('x^[a *note* $y_1$]'), 'x\\footnote{a \\emph{note} $y_1$}');
  assert.equal(body('![Cap](f.pdf){#fig:f width=50%}'),
    '\\begin{figure}[htbp]\\centering\\includegraphics[width=0.5\\linewidth]{f.pdf}\\caption{Cap}\\label{fig:f}\\end{figure}');
  assert.equal(body('> a\n> b\n\nc'), '\\begin{quote}a\nb\\end{quote}\n\nc');
  assert.equal(body('```\n*x* $y\n```'), '\\begin{verbatim}\n*x* $y\n\\end{verbatim}');
  assert.equal(body('---'), '\\par\\medskip\\noindent\\hrulefill\\par\\medskip');
});

test('front matter and preamble', () => {
  const r = TeXmark.convert('---\ntitle: On $x$\nauthor: [A, B]\nclass: article\npackages: [tikz-cd, "[all]xy"]\nabstract: |\n  Short.\n---\nBody');
  assert.equal(r.body, '\n\n\n\n\n\n\n\nBody');
  assert.match(r.preamble, /^\\documentclass\{article\}/);
  assert.match(r.preamble, /\\usepackage\{tikz-cd\}\n\\usepackage\[all\]\{xy\}\n\\usepackage\[capitalise,noabbrev\]\{cleveref\}/);
  assert.match(r.preamble, /\\title\{On \$x\$\}\n\\author\{A \\and B\}/);
  assert.match(r.preamble, /\\maketitle\n\\begin\{abstract\}\nShort\.\n\\end\{abstract\}$/);
  assert.match(r.latex, /\\end\{document\}\n$/);
});

test('\\usepackage and \\DeclareMathOperator in the body move to the preamble', () => {
  const r = TeXmark.convert('\\usepackage{bbm}\n\\DeclareMathOperator{\\tr}{tr}\nx');
  assert.equal(r.body, '\n\nx');
  assert.match(r.preamble, /\\usepackage\{bbm\}\n\\usepackage\[capitalise/);
  assert.match(r.preamble, /\\DeclareMathOperator\{\\tr\}\{tr\}/);
});

test('command line', () => {
  const out = execFileSync(process.execPath, [path.join(__dirname, '..', 'bin', 'texmark.js'), '-', '--body'], { input: '# Hi' }).toString();
  assert.equal(out, '\\section{Hi}\n');
});
