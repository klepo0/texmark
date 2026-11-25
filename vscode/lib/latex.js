'use strict';
// Common LaTeX commands and environments offered after a backslash, beside the
// file's own macros. A snippet body uses VS Code's ${1} placeholders.

const MATH = [
  // Greek
  ...'alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi pi varpi rho varrho sigma varsigma tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega'.split(' ').map((n) => [n]),
  // Structures
  ['frac', 'frac{${1}}{${2}}', 'fraction'],
  ['dfrac', 'dfrac{${1}}{${2}}', 'display fraction'],
  ['tfrac', 'tfrac{${1}}{${2}}', 'text fraction'],
  ['sqrt', 'sqrt{${1}}', 'square root'],
  ['binom', 'binom{${1}}{${2}}', 'binomial'],
  ['sum', 'sum_{${1}}^{${2}}', 'sum'],
  ['prod', 'prod_{${1}}^{${2}}', 'product'],
  ['int', 'int_{${1}}^{${2}}', 'integral'],
  ['iint'], ['oint'],
  ['lim', 'lim_{${1}}', 'limit'],
  ['limsup', 'limsup_{${1}}'], ['liminf', 'liminf_{${1}}'],
  ['sup'], ['inf'], ['max'], ['min'], ['log'], ['ln'], ['exp'], ['sin'], ['cos'], ['tan'], ['det'], ['dim'], ['ker'], ['deg'], ['arg'],
  ['operatorname', 'operatorname{${1}}'],
  ['mathbb', 'mathbb{${1}}', 'blackboard bold'],
  ['mathcal', 'mathcal{${1}}', 'calligraphic'],
  ['mathfrak', 'mathfrak{${1}}', 'fraktur'],
  ['mathscr', 'mathscr{${1}}', 'script'],
  ['mathrm', 'mathrm{${1}}'], ['mathbf', 'mathbf{${1}}'], ['mathsf', 'mathsf{${1}}'], ['mathit', 'mathit{${1}}'],
  ['boldsymbol', 'boldsymbol{${1}}'],
  ['text', 'text{${1}}', 'text in maths'],
  ['hat', 'hat{${1}}'], ['widehat', 'widehat{${1}}'], ['tilde', 'tilde{${1}}'], ['widetilde', 'widetilde{${1}}'],
  ['bar', 'bar{${1}}'], ['overline', 'overline{${1}}'], ['underline', 'underline{${1}}'], ['vec', 'vec{${1}}'],
  ['dot', 'dot{${1}}'], ['ddot', 'ddot{${1}}'],
  ['overbrace', 'overbrace{${1}}^{${2}}'], ['underbrace', 'underbrace{${1}}_{${2}}'],
  ['left(', 'left( ${1} \\right)', '( … ) sized'], ['left[', 'left[ ${1} \\right]', '[ … ] sized'],
  ['left\\{', 'left\\{ ${1} \\right\\}', '{ … } sized'], ['left|', 'left| ${1} \\right|', '| … | sized'],
  ['langle'], ['rangle'], ['lfloor'], ['rfloor'], ['lceil'], ['rceil'],
  // Relations and operators
  ['le'], ['ge'], ['leq'], ['geq'], ['neq'], ['ll'], ['gg'], ['approx'], ['sim'], ['simeq'], ['cong'], ['equiv'], ['propto'],
  ['in'], ['notin'], ['ni'], ['subset'], ['subseteq'], ['supset'], ['supseteq'], ['cup'], ['cap'], ['bigcup'], ['bigcap'], ['setminus'], ['emptyset'], ['varnothing'],
  ['times'], ['cdot'], ['cdots'], ['ldots'], ['dots'], ['vdots'], ['ddots'], ['circ'], ['otimes'], ['oplus'], ['bigotimes'], ['bigoplus'], ['wedge'], ['vee'],
  ['pm'], ['mp'], ['div'], ['ast'], ['star'],
  ['to'], ['mapsto'], ['rightarrow'], ['leftarrow'], ['Rightarrow'], ['Leftarrow'], ['Leftrightarrow'], ['iff'], ['implies'], ['hookrightarrow'], ['twoheadrightarrow'], ['longrightarrow'], ['longmapsto'],
  ['uparrow'], ['downarrow'], ['nearrow'], ['searrow'],
  ['forall'], ['exists'], ['nexists'], ['neg'], ['land'], ['lor'],
  ['partial'], ['nabla'], ['infty'], ['ell'], ['hbar'], ['Re'], ['Im'], ['aleph'], ['prime'],
  ['perp'], ['parallel'], ['mid'], ['nmid'], ['vert'], ['Vert'], ['|'],
  ['quad'], ['qquad'],
];

const TEXT = [
  ['emph', 'emph{${1}}', 'emphasis (or *text*)'],
  ['textbf', 'textbf{${1}}', 'bold (or **text**)'],
  ['textit', 'textit{${1}}'], ['texttt', 'texttt{${1}}'], ['textsc', 'textsc{${1}}'], ['textrm', 'textrm{${1}}'],
  ['footnote', 'footnote{${1}}', 'footnote (or ^[text])'],
  ['label', 'label{${1}}', 'label (or {#id})'],
  ['ref', 'ref{${1}}'], ['eqref', 'eqref{${1}}'], ['cref', 'cref{${1}}', 'reference (or @label)'], ['Cref', 'Cref{${1}}'],
  ['cite', 'cite{${1}}', 'citation (or [@key])'], ['nocite', 'nocite{${1}}'],
  ['url', 'url{${1}}'], ['href', 'href{${1:url}}{${2:text}}'],
  ['includegraphics', 'includegraphics[width=${1:0.6}\\linewidth]{${2}}'],
  ['input', 'input{${1}}'],
  ['newcommand', 'newcommand{\\\\${1:name}}{${2}}', 'define a macro'],
  ['newcommand[]', 'newcommand{\\\\${1:name}}[${2:1}]{${3}}', 'define a macro with arguments'],
  ['renewcommand', 'renewcommand{\\\\${1:name}}{${2}}'],
  ['DeclareMathOperator', 'DeclareMathOperator{\\\\${1:name}}{${2:text}}', 'operator name (moves to the preamble)'],
  ['newtheorem', 'newtheorem{${1:name}}{${2:Name}}'],
  ['usepackage', 'usepackage{${1}}', 'package (moves to the preamble)'],
  ['begin', 'begin{${1:env}}\n\t${0}\n\\\\end{${1:env}}', 'environment'],
  ['item'], ['noindent'], ['newline'], ['newpage'], ['clearpage'], ['medskip'], ['bigskip'], ['smallskip'],
  ['vspace', 'vspace{${1}}'], ['hspace', 'hspace{${1}}'],
  ['section', 'section{${1}}', 'section (or # Title)'], ['subsection', 'subsection{${1}}', 'subsection (or ## Title)'],
  ['caption', 'caption{${1}}'], ['centering'], ['tableofcontents'], ['appendix'], ['today'],
  ['qedhere'], ['LaTeX'], ['TeX'],
];

const ENVIRONMENTS = [
  ['align', 'equations aligned at &'], ['align*', 'unnumbered'], ['equation', 'numbered equation'], ['equation*', 'unnumbered'],
  ['gather'], ['gather*'], ['multline'], ['multline*'], ['split'], ['aligned'], ['cases'],
  ['pmatrix'], ['bmatrix'], ['vmatrix'], ['matrix'], ['array'],
  ['itemize'], ['enumerate'], ['description'], ['center'], ['figure'], ['table'], ['tabular'], ['minipage'],
  ['quote'], ['verbatim'], ['proof'], ['tikzpicture'], ['tikzcd'], ['abstract'],
  ['theorem'], ['lemma'], ['proposition'], ['corollary'], ['definition'], ['remark'], ['example'],
];


/** Front-matter keys (SPEC §3). */
const FRONT_MATTER = [
  ['title', 'title: ${1}', 'The title (shortcuts and maths allowed)'],
  ['author', 'author: ${1}', 'One name, or a list of names or name/affiliation/email'],
  ['date', 'date: ${1:today}', '"today" gives \\today'],
  ['abstract', 'abstract: |\n  ${1}', 'The abstract'],
  ['keywords', 'keywords: ${1}', 'amsart \\keywords'],
  ['subjclass', 'subjclass: ${1}', 'amsart \\subjclass[2020]'],
  ['class', 'class: ${1|amsart,article,book,report,beamer|}', 'Document class (default amsart)'],
  ['classoptions', 'classoptions: ${1:11pt}', 'Class options'],
  ['packages', 'packages: [${1}]', 'Packages: name, name[opts] or [opts]name'],
  ['macros', 'macros: ${1:macros.tex}', 'File(s) to \\input in the preamble'],
  ['bib', 'bib: ${1:refs.bib}', 'Bibliography file(s)'],
  ['bibstyle', 'bibstyle: ${1:amsplain}', 'Bibliography style (default amsplain)'],
  ['numbering', 'numbering: ${1|section,chapter,global|}', 'Theorem numbering (default within section)'],
];

module.exports = { MATH, TEXT, ENVIRONMENTS, FRONT_MATTER };
