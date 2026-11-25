/*!
 * TeXmark: Markdown that's secretly LaTeX.
 * Converts a .tmd file into ordinary LaTeX, one output line per source line.
 * MIT License. Copyright (c) 2026 Khoa Le. See SPEC.md for the format.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TeXmark = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = '0.1.0';

  // ---------------------------------------------------------------- tables

  /** Theorem-like kinds known by name: env name -> [printed name, theorem style]. */
  const KINDS = {
    theorem: ['Theorem', 'plain'],
    lemma: ['Lemma', 'plain'],
    proposition: ['Proposition', 'plain'],
    corollary: ['Corollary', 'plain'],
    conjecture: ['Conjecture', 'plain'],
    claim: ['Claim', 'plain'],
    hypothesis: ['Hypothesis', 'plain'],
    definition: ['Definition', 'definition'],
    assumption: ['Assumption', 'definition'],
    example: ['Example', 'definition'],
    exercise: ['Exercise', 'definition'],
    problem: ['Problem', 'definition'],
    question: ['Question', 'definition'],
    notation: ['Notation', 'definition'],
    remark: ['Remark', 'remark'],
    note: ['Note', 'remark'],
  };

  const ALIASES = {
    thm: 'theorem', lem: 'lemma', prop: 'proposition', cor: 'corollary',
    conj: 'conjecture', defn: 'definition', def: 'definition', rem: 'remark',
    ex: 'example', assum: 'assumption', hyp: 'hypothesis', nota: 'notation',
  };

  /** Environments whose contents are prose: Markdown shortcuts work inside them. */
  const PROSE_ENVS = new Set([
    'document', 'abstract', 'center', 'flushleft', 'flushright', 'quote', 'quotation',
    'verse', 'itemize', 'enumerate', 'description', 'figure', 'table', 'minipage',
    'proof', 'wrapfigure', 'subfigure', 'multicols', 'frame', 'block', 'alertblock',
    'exampleblock', 'tiny', 'scriptsize', 'footnotesize', 'small', 'normalsize',
    'large', 'Large', 'LARGE', 'huge', 'Huge', 'em', 'bfseries', 'itshape',
    ...Object.keys(KINDS),
  ]);

  /** Commands whose arguments are copied untouched (labels, keys, paths, definitions). */
  const RAW_ARGS = new Set([
    'label', 'ref', 'eqref', 'pageref', 'autoref', 'nameref', 'cref', 'Cref', 'crefrange',
    'Crefrange', 'cpageref', 'labelcref', 'hyperref',
    'cite', 'citep', 'citet', 'citealp', 'citealt', 'citeauthor', 'citeyear', 'parencite',
    'textcite', 'autocite', 'footcite', 'nocite',
    'url', 'includegraphics', 'input', 'include', 'bibliography', 'bibliographystyle',
    'addbibresource', 'graphicspath',
    'newcommand', 'renewcommand', 'providecommand', 'newenvironment', 'renewenvironment',
    'newtheorem', 'theoremstyle', 'newcounter', 'setcounter', 'addtocounter', 'setlength',
    'addtolength', 'numberwithin', 'crefname', 'Crefname', 'DeclarePairedDelimiter',
    'DeclarePairedDelimiterX', 'NewDocumentCommand', 'RenewDocumentCommand',
    'definecolor', 'tikzset', 'pgfplotsset', 'hypersetup', 'let', 'def', 'gdef', 'edef', 'xdef',
    'vspace', 'hspace', 'rule', 'color', 'textcolor', 'colorbox', 'qquad', 'quad',
  ]);

  /** Commands that belong in the preamble: removed from the body, moved up on conversion. */
  const LIFT = new Set([
    'usepackage', 'RequirePackage', 'documentclass', 'DeclareMathOperator', 'usetikzlibrary',
    'usepgfplotslibrary', 'tcbuselibrary',
  ]);

  const HEADINGS = ['section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph', 'subparagraph'];

  const DEFAULT_PACKAGES = [
    '\\usepackage[T1]{fontenc}',
    '\\usepackage{lmodern}',
    '\\usepackage{amsmath,amssymb,amsthm}',
    '\\usepackage{graphicx}',
    '\\usepackage{hyperref}',
    '\\usepackage[capitalise,noabbrev]{cleveref}',
  ];

  // ---------------------------------------------------------- placeholders
  //
  // Pass 1 (lex) replaces everything that must not be touched (maths, raw
  // environments, commands with raw arguments, comments, code, URLs, attribute
  // blocks) by placeholders \u0001<n>\u0002, one per line of the original, so
  // the line structure stays. Pass 2 (blocks + inline) works on the rest.

  const PH_RE = /\u0001(\d+)\u0002/g;
  const PH_ONE = '\\u0001\\d+\\u0002';

  function put(ctx, tex, kind, extra) {
    ctx.ph.push(Object.assign({ tex, kind: kind || 'raw' }, extra || {}));
    return '\u0001' + (ctx.ph.length - 1) + '\u0002';
  }

  function putLines(ctx, tex, kind) {
    return tex.split('\n').map((p) => put(ctx, p, kind)).join('\n');
  }

  function phOf(ctx, s) {
    const m = /^\u0001(\d+)\u0002$/.exec(s || '');
    return m ? ctx.ph[+m[1]] : null;
  }

  function restore(ctx, s) {
    let prev;
    do {
      prev = s;
      s = s.replace(PH_RE, (_, i) => ctx.ph[+i].tex);
    } while (s !== prev && s.indexOf('\u0001') >= 0);
    return s;
  }

  // ------------------------------------------------------------ utilities

  /** Index just past a balanced {…} or […] group starting at s[i]. -1 if unbalanced. */
  function skipGroup(s, i) {
    const open = s[i];
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    for (let j = i; j < s.length; j++) {
      const c = s[j];
      if (c === '\\') { j++; continue; }
      if (c === '%' ) { const nl = s.indexOf('\n', j); if (nl < 0) return -1; j = nl; continue; }
      if (c === open) depth++;
      else if (c === close) { depth--; if (depth === 0) return j + 1; }
      else if (c === '\n' && s[j + 1] === '\n' && open === '[') return -1;
    }
    return -1;
  }

  /** Index past all argument groups ([…] and {…}) after a command, allowing single line breaks between. */
  function skipArgs(s, i, max) {
    let n = 0;
    for (;;) {
      let j = i;
      while (j < s.length && (s[j] === ' ' || s[j] === '\t')) j++;
      if (s[j] === '\n' && s[j + 1] !== '\n') { j++; while (s[j] === ' ' || s[j] === '\t') j++; }
      if (s[j] !== '{' && s[j] !== '[') return i;
      if (max != null && n >= max) return i;
      const e = skipGroup(s, j);
      if (e < 0) return i;
      i = e; n++;
    }
  }

  function findUnescaped(s, needle, from) {
    for (let j = from; j < s.length; j++) {
      if (s[j] === '\\') { j++; continue; }
      if (s.startsWith(needle, j)) return j;
    }
    return -1;
  }

  function escapeText(s) {
    return s.replace(/[\\{}$&#^_%~]/g, (c) => ({
      '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '$': '\\$', '&': '\\&', '#': '\\#',
      '^': '\\^{}', '_': '\\_', '%': '\\%', '~': '\\textasciitilde{}',
    })[c]);
  }

  function escapeUrl(s) {
    return s.replace(/[%#]/g, (c) => '\\' + c);
  }

  /** Parse an attribute block body: "#id .class key=value". */
  function parseAttrs(body) {
    const out = { id: null, classes: [], kv: {} };
    const re = /([#.])([^\s}#.][^\s}]*)|([\w-]+)=("[^"]*"|'[^']*'|[^\s}]+)|(-)(?=\s|$)/g;
    let m;
    while ((m = re.exec(body))) {
      if (m[1] === '#') out.id = m[2];
      else if (m[1] === '.') out.classes.push(m[2]);
      else if (m[3]) out.kv[m[3]] = m[4].replace(/^["']|["']$/g, '');
      else if (m[5]) out.classes.push('unnumbered');
    }
    return out;
  }

  function graphicsOptions(kv) {
    const opts = [];
    for (const k of ['width', 'height']) {
      if (!kv[k]) continue;
      const v = kv[k];
      const pct = /^([\d.]+)%$/.exec(v);
      if (pct) opts.push(`${k}=${+pct[1] / 100}\\${k === 'width' ? 'linewidth' : 'textheight'}`);
      else opts.push(`${k}=${v}`);
    }
    if (kv.scale) opts.push('scale=' + kv.scale);
    return opts.length ? '[' + opts.join(',') + ']' : '';
  }

  // ------------------------------------------------------------ front matter

  function unquote(v) {
    v = v.trim();
    if (/^".*"$/.test(v)) return v.slice(1, -1).replace(/\\"/g, '"');
    if (/^'.*'$/.test(v)) return v.slice(1, -1).replace(/''/g, "'");
    return v;
  }

  function parseInlineList(v) {
    return v.replace(/^\[|\]$/g, '').split(',').map(unquote).filter(Boolean);
  }

  /** A small YAML subset: scalars, | and > blocks, [a, b] lists, "- item" lists, "- name: x" maps. */
  function parseYaml(lines) {
    const obj = {};
    for (let i = 0; i < lines.length; i++) {
      const m = /^([A-Za-z_][\w-]*):[ \t]*(.*)$/.exec(lines[i]);
      if (!m) continue;
      const key = m[1].toLowerCase();
      const v = m[2].trim();
      if (v === '|' || v === '>' || v === '|-' || v === '>-') {
        const block = [];
        while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === '')) block.push(lines[++i]);
        const ind = Math.min(...block.filter((l) => l.trim()).map((l) => /^\s*/.exec(l)[0].length), 1e9);
        const body = block.map((l) => l.slice(Math.min(ind, l.length)));
        obj[key] = (v[0] === '|' ? body.join('\n') : body.join(' ').replace(/\s+/g, ' ')).trim();
      } else if (v === '') {
        const items = [];
        while (i + 1 < lines.length && /^\s+-\s*/.test(lines[i + 1])) {
          const dash = /^\s*/.exec(lines[++i])[0].length;
          const first = lines[i].replace(/^\s+-\s*/, '');
          const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(first);
          if (kv) {
            // A value is a scalar, an [a, b] list, or "- x" lines indented deeper than this item's dash.
            const value = (v) => {
              v = v.trim();
              if (v[0] === '[') return parseInlineList(v);
              if (v !== '') return unquote(v);
              const sub = [];
              let mm;
              while (i + 1 < lines.length && (mm = /^(\s+)-\s*(.*)$/.exec(lines[i + 1])) && mm[1].length > dash) {
                sub.push(unquote(mm[2])); i++;
              }
              return sub.length ? sub : '';
            };
            const item = { [kv[1].toLowerCase()]: value(kv[2]) };
            while (i + 1 < lines.length && /^\s{2,}[A-Za-z_][\w-]*:/.test(lines[i + 1]) && !/^\s+-/.test(lines[i + 1])) {
              const k2 = /^\s+([A-Za-z_][\w-]*):\s*(.*)$/.exec(lines[++i]);
              item[k2[1].toLowerCase()] = value(k2[2]);
            }
            items.push(item);
          } else items.push(unquote(first));
        }
        obj[key] = items;
      } else if (v[0] === '[') obj[key] = parseInlineList(v);
      else obj[key] = unquote(v);
    }
    return obj;
  }

  /** Splits off a leading --- front matter block. Its lines become blank lines in the body. */
  function splitFrontMatter(src) {
    const lines = src.split('\n');
    if (!/^---\s*$/.test(lines[0] || '')) return { meta: {}, body: src };
    let end = -1;
    for (let i = 1; i < lines.length; i++) {
      if (/^(---|\.\.\.)\s*$/.test(lines[i])) { end = i; break; }
    }
    if (end < 0) return { meta: {}, body: src };
    const inner = lines.slice(1, end);
    if (!inner.some((l) => /^[A-Za-z_][\w-]*:/.test(l))) return { meta: {}, body: src };
    const meta = parseYaml(inner);
    const body = lines.map((l, i) => (i <= end ? '' : l)).join('\n');
    return { meta, body, frontEnd: lines.slice(0, end + 1).join('\n').length };
  }

  // ------------------------------------------------------------------ lex

  function isProse(ctx, env) {
    const base = env.replace(/\*$/, '');
    return PROSE_ENVS.has(base) || ctx.theorems.has(base);
  }

  /** Index of the \end{env} matching a \begin{env} whose name ends before `from`; returns [start, end]. */
  function findEnd(s, env, from) {
    const esc = env.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('\\\\(begin|end)\\s*\\{' + esc + '\\}', 'g');
    re.lastIndex = from;
    let depth = 1, m;
    while ((m = re.exec(s))) {
      if (m[1] === 'begin') depth++;
      else if (--depth === 0) return [m.index, re.lastIndex];
    }
    return null;
  }

  function lex(s, ctx) {
    const out = [];
    const n = s.length;
    let i = 0;
    const lineStart = (k) => k === 0 || s[k - 1] === '\n';

    while (i < n) {
      const c = s[i];

      // Fenced code block ``` or ~~~ at the start of a line.
      if (lineStart(i) && (c === '`' || c === '~' || c === ' ')) {
        const eol = s.indexOf('\n', i) < 0 ? n : s.indexOf('\n', i);
        const m = /^ {0,3}(`{3,}|~{3,})[^`]*$/.exec(s.slice(i, eol));
        if (m) {
          const fence = m[1];
          let j = eol + 1;
          const body = [];
          let closed = -1;
          while (j <= n) {
            const e = s.indexOf('\n', j) < 0 ? n : s.indexOf('\n', j);
            const line = s.slice(j, e);
            if (new RegExp('^ {0,3}' + fence[0] + '{' + fence.length + ',}\\s*$').test(line)) { closed = e; break; }
            body.push(line);
            if (e >= n) break;
            j = e + 1;
          }
          const parts = [put(ctx, '\\begin{verbatim}', 'raw')];
          for (const b of body) parts.push(put(ctx, b, 'raw'));
          if (closed >= 0) { parts.push(put(ctx, '\\end{verbatim}', 'raw')); out.push(parts.join('\n')); i = closed; continue; }
          parts[parts.length - 1] = parts.length > 1 ? put(ctx, body[body.length - 1] + '\\end{verbatim}', 'raw') : parts[0];
          out.push(parts.join('\n'));
          i = n;
          continue;
        }
      }

      if (c === '\\') {
        const nx = s[i + 1];
        if (nx === undefined) { out.push(put(ctx, '\\')); i++; continue; }
        if (/[A-Za-z]/.test(nx)) {
          let j = i + 1;
          while (j < n && /[A-Za-z]/.test(s[j])) j++;
          const name = s.slice(i + 1, j);
          if (s[j] === '*' && name !== 'begin' && name !== 'end') j++;
          const cmd = s.slice(i, j);

          if (name === 'begin' || name === 'end') {
            const m = /^\s*\{([^{}\n]+)\}/.exec(s.slice(j));
            if (!m) { out.push(put(ctx, cmd)); i = j; continue; }
            const env = m[1].trim();
            const after = j + m[0].length;
            if (name === 'begin' && !isProse(ctx, env)) {
              const end = findEnd(s, env, after);
              const stop = end ? end[1] : n;
              out.push(putLines(ctx, s.slice(i, stop), 'env'));
              i = stop;
              continue;
            }
            out.push(put(ctx, s.slice(i, after)));
            i = after;
            continue;
          }
          if (name === 'verb') {
            const d = s[j];
            const e = d ? s.indexOf(d, j + 1) : -1;
            if (e > 0 && s.slice(j, e).indexOf('\n') < 0) { out.push(put(ctx, s.slice(i, e + 1))); i = e + 1; continue; }
            out.push(put(ctx, cmd)); i = j; continue;
          }
          if (LIFT.has(name.replace(/\*$/, ''))) {
            let e = skipArgs(s, j);
            if (name === 'DeclareMathOperator' && s[e] === '{') e = skipGroup(s, e);
            const text = s.slice(i, e);
            if (name === 'documentclass') ctx.docclass = text;
            else ctx.lifted.push(text);
            out.push(putLines(ctx, text.replace(/[^\n]/g, ''), 'lifted'));
            i = e;
            continue;
          }
          if (name === 'def' || name === 'gdef' || name === 'edef' || name === 'xdef') {
            // \def\foo#1#2{...}: copy up to and including the body group.
            let e = j;
            while (e < n && s[e] !== '{' && s[e] !== '\n') e++;
            if (s[e] === '{') { const g = skipGroup(s, e); if (g > 0) e = g; }
            out.push(putLines(ctx, s.slice(i, e), 'raw'));
            i = e;
            continue;
          }
          if (name === 'let') {
            const m = /^\s*\\[A-Za-z@]+\s*=?\s*(\\[A-Za-z@]+|\\.|.)/.exec(s.slice(j));
            const e = m ? j + m[0].length : j;
            out.push(put(ctx, s.slice(i, e)));
            i = e;
            continue;
          }
          if (name === 'href') {
            const e = skipArgs(s, j, 1);
            out.push(putLines(ctx, s.slice(i, e), 'raw'));
            i = e;
            continue;
          }
          if (RAW_ARGS.has(name.replace(/\*$/, ''))) {
            // \newcommand\foo{…} (no braces round the name) is common too.
            let k = j;
            if (/^(re)?newcommand|providecommand$/.test(name)) {
              const m = /^\*?\s*\\[A-Za-z@]+/.exec(s.slice(k));
              if (m) k += m[0].length;
            }
            const e = skipArgs(s, k);
            out.push(putLines(ctx, s.slice(i, e), 'raw'));
            i = e;
            continue;
          }
          out.push(put(ctx, cmd));
          i = j;
          continue;
        }
        if (nx === '(' || nx === '[') {
          const close = nx === '(' ? '\\)' : '\\]';
          const e = findUnescaped(s, close, i + 2);
          const stop = e < 0 ? n : e + 2;
          out.push(putLines(ctx, s.slice(i, stop), 'math'));
          i = stop;
          continue;
        }
        if (nx === '*') { out.push(put(ctx, '*')); i += 2; continue; }
        if (nx === '@' && /[A-Za-z]/.test(s[i + 2] || '')) { out.push(put(ctx, '@')); i += 2; continue; }
        if (nx === '\n') { out.push(put(ctx, '\\')); i++; continue; }
        out.push(put(ctx, '\\' + nx));
        i += 2;
        continue;
      }

      if (c === '$') {
        if (s[i + 1] === '$') {
          const e = findUnescaped(s, '$$', i + 2);
          if (e < 0) { out.push(put(ctx, '\\$\\$')); i += 2; continue; }
          const content = s.slice(i + 2, e);
          let stop = e + 2;
          const am = /^[ \t]*\{#([^\s}]+)[^}\n]*\}/.exec(s.slice(stop));
          let label = null;
          if (am) { label = am[1]; stop += am[0].length; }
          const numbered = label || /\\label\s*\{/.test(content);
          const tex = numbered
            ? '\\begin{equation}' + (label ? '\\label{' + label + '}' : '') + content + '\\end{equation}'
            : '\\[' + content + '\\]';
          out.push(putLines(ctx, tex, 'math'));
          i = stop;
          continue;
        }
        // Inline $…$: opening $ must be followed by non-space, closing preceded by non-space
        // and not followed by a digit (so "costs $5 and $6" stays text).
        if (s[i + 1] && !/\s/.test(s[i + 1])) {
          let e = -1;
          for (let j = i + 1; j < n; j++) {
            if (s[j] === '\\') { j++; continue; }
            if (s[j] === '\n' && /^\n[ \t]*\n/.test(s.slice(j, j + 3 + 64))) break;
            if (s[j] === '$') {
              if (!/[ \t]/.test(s[j - 1]) && !/\d/.test(s[j + 1] || '')) { e = j; }
              break;
            }
          }
          if (e > 0) { out.push(putLines(ctx, s.slice(i, e + 1), 'math')); i = e + 1; continue; }
        }
        out.push(put(ctx, '\\$'));
        i++;
        continue;
      }

      if (c === '%') {
        if (i > 0 && /\d/.test(s[i - 1])) { out.push(put(ctx, '\\%')); i++; continue; }
        let e = s.indexOf('\n', i);
        if (e < 0) e = n;
        out.push(put(ctx, s.slice(i, e), 'comment'));
        i = e;
        continue;
      }

      if (c === '`') {
        let k = i;
        while (s[k] === '`') k++;
        const run = k - i;
        const eol = s.indexOf('\n', k) < 0 ? n : s.indexOf('\n', k);
        const line = s.slice(k, eol);
        const re = new RegExp('(^|[^`])(`{' + run + '})(?!`)');
        const m = re.exec(line);
        if (m) {
          const content = line.slice(0, m.index + m[1].length);
          // ``quotes'' and `quotes' are LaTeX quotation marks, not code.
          if (!/'(\s|$)/.test(content) && content.trim()) {
            let body = content;
            if (/^ .* $/.test(body)) body = body.slice(1, -1);
            out.push(put(ctx, '\\texttt{' + escapeText(body) + '}', 'code'));
            i = k + m.index + m[1].length + run;
            continue;
          }
        }
        out.push(put(ctx, s.slice(i, k)));
        i = k;
        continue;
      }

      if (c === '{' && (s[i + 1] === '#' || s[i + 1] === '.' || (s[i + 1] === '-' && s[i + 2] === '}'))) {
        const e = s.indexOf('}', i);
        const nl = s.indexOf('\n', i);
        if (e > 0 && (nl < 0 || e < nl)) {
          const body = s.slice(i + 1, e);
          const a = parseAttrs(body);
          out.push(put(ctx, a.id ? '\\label{' + a.id + '}' : '', 'attr', { attrs: a }));
          i = e + 1;
          continue;
        }
      }

      if (c === ']' && s[i + 1] === '(') {
        const m = /^\]\((<[^>\n]*>|[^\s()]*(?:\([^\s()]*\)[^\s()]*)*)(?:\s+"[^"\n]*")?\)/.exec(s.slice(i));
        if (m) {
          const url = m[1].replace(/^<|>$/g, '');
          out.push('](' + put(ctx, escapeUrl(url), 'url', { url }) + ')');
          i += m[0].length;
          if (s[i] === '{') {
            const e = s.indexOf('}', i);
            const nl = s.indexOf('\n', i);
            if (e > 0 && (nl < 0 || e < nl)) {
              const a = parseAttrs(s.slice(i + 1, e));
              out.push(put(ctx, a.id ? '\\label{' + a.id + '}' : '', 'attr', { attrs: a }));
              i = e + 1;
            }
          }
          continue;
        }
      }

      if (c === '<') {
        const m = /^<((?:https?|ftp|mailto):[^\s<>]+)>/.exec(s.slice(i, i + 2048));
        if (m) { out.push(put(ctx, '\\url{' + m[1] + '}', 'raw')); i += m[0].length; continue; }
      }

      out.push(c);
      i++;
    }
    return out.join('');
  }

  // --------------------------------------------------------------- inline

  function citeOrRef(ctx, key) {
    return ctx.labels.has(key) || key.indexOf(':') >= 0;
  }

  function findClose(s, i) {
    // s[i] is '[': index of the matching ']'.
    let depth = 0;
    for (let j = i; j < s.length; j++) {
      if (s[j] === '[') depth++;
      else if (s[j] === ']') { depth--; if (depth === 0) return j; }
    }
    return -1;
  }

  function inline(ctx, s) {
    // Images and links.
    s = s.replace(new RegExp('!\\[([^\\]\\n]*)\\]\\((' + PH_ONE + ')\\)(' + PH_ONE + ')?', 'g'), (m, alt, u, a) => {
      const url = phOf(ctx, u).url;
      const attr = a && phOf(ctx, a).kind === 'attr' ? phOf(ctx, a).attrs : { kv: {} };
      return put(ctx, '\\includegraphics' + graphicsOptions(attr.kv) + '{' + url + '}');
    });
    s = s.replace(new RegExp('\\[([^\\[\\]\\n]*)\\]\\((' + PH_ONE + ')\\)', 'g'), (m, text, u) => {
      const url = phOf(ctx, u).url;
      const t = inline(ctx, text);
      if (url[0] === '#') return put(ctx, '\\hyperref[' + url.slice(1) + ']{' + t + '}');
      return put(ctx, '\\href{' + escapeUrl(url) + '}{' + t + '}');
    });

    // Footnotes ^[…].
    for (let k = s.indexOf('^['); k >= 0; k = s.indexOf('^[', k + 1)) {
      const e = findClose(s, k + 1);
      if (e < 0) break;
      const note = put(ctx, '\\footnote{' + inline(ctx, s.slice(k + 2, e)) + '}');
      s = s.slice(0, k) + note + s.slice(e + 1);
    }

    // Bracketed citations and references [@a; see @b, p. 3].
    s = s.replace(/\[([^\[\]\n]*@[^\[\]\n]*)\]/g, (m, body) => {
      const parts = body.split(';').map((p) => /^\s*(.*?)\s*-?@([A-Za-z0-9_](?:[\w:.\-\/+]*\w)?)\s*(?:,\s*(.*?))?\s*$/.exec(p));
      if (parts.some((p) => !p || /@/.test(p[1]))) return m;
      const items = parts.map((p) => ({ pre: p[1], key: p[2], loc: p[3], ref: citeOrRef(ctx, p[2]) }));
      const plain = items.every((x) => !x.pre && !x.loc);
      if (plain && items.every((x) => !x.ref)) return put(ctx, '\\cite{' + items.map((x) => x.key).join(',') + '}');
      if (plain && items.every((x) => x.ref)) return put(ctx, '\\cref{' + items.map((x) => x.key).join(',') + '}');
      return items.map((x) => {
        const pre = x.pre ? inline(ctx, x.pre) + '~' : '';
        if (x.ref) return put(ctx, pre + '\\cref{' + x.key + '}' + (x.loc ? ', ' + inline(ctx, x.loc) : ''));
        return put(ctx, pre + '\\cite' + (x.loc ? '[' + inline(ctx, x.loc) + ']' : '') + '{' + x.key + '}');
      }).join(', ');
    });

    // Bare references @thm:main (a label of this file, or any key with a colon).
    s = s.replace(/(^|[^\w@])@([A-Za-z](?:[\w:.\-]*\w)?)/g, (m, pre, key) =>
      citeOrRef(ctx, key) ? pre + put(ctx, '\\cref{' + key + '}') : m);

    // "Straight quotes" -> ``TeX quotes''.
    s = s.replace(/(^|[\s(\[{\u0002])"(?=\S)([^"\n]*?\S)"/g, "$1``$2''");

    // Emphasis.
    s = s.replace(/\*\*(?=[^\s*])(.+?)(?<=[^\s*])\*\*/g, '\\textbf{$1}');
    s = s.replace(/(^|[^A-Za-z0-9_])__(?=\S)(.+?)(?<=\S)__(?![A-Za-z0-9_])/g, '$1\\textbf{$2}');
    s = s.replace(/\*(?=[^\s*])(.+?)(?<=[^\s*])\*/g, '\\emph{$1}');
    s = s.replace(/(^|[^A-Za-z0-9_])_(?=\S)(.+?)(?<=\S)_(?![A-Za-z0-9_])/g, '$1\\emph{$2}');

    // Characters that are special in LaTeX but plain in Markdown prose.
    s = s.replace(/[&#_^]/g, (c) => (c === '^' ? '\\^{}' : '\\' + c));
    return s;
  }

  // --------------------------------------------------------------- blocks

  function blocks(ctx, text) {
    const L = text.split('\n');
    const O = new Array(L.length).fill('');
    const lists = []; // { type, indent, depth, counter }
    const divs = []; // { name }
    let quote = -1; // line index of the last quote line, -1 when closed
    let lastContent = -1;
    let blankSeen = false;

    const appendTo = (idx, closer) => {
      if (idx < 0) { ctx.trailer += closer; return; }
      // Insert before a trailing % comment so the closer isn't commented out.
      const line = O[idx];
      let cut = line.length;
      line.replace(PH_RE, (m, k, off) => {
        if (ctx.ph[+k].kind === 'comment' && off < cut) cut = off;
        return m;
      });
      O[idx] = line.slice(0, cut) + closer + line.slice(cut);
    };
    const closeLists = (keep) => {
      while (lists.length > keep) appendTo(lastContent, '\\end{' + lists.pop().type + '}');
    };
    const closeQuote = () => {
      if (quote >= 0) { appendTo(quote, '\\end{quote}'); quote = -1; }
    };
    const listsAtDepth = () => {
      let k = lists.length;
      while (k > 0 && lists[k - 1].depth >= divs.length) k--;
      return k;
    };

    for (let i = 0; i < L.length; i++) {
      const line = L[i];
      if (!line.trim()) { O[i] = line; blankSeen = true; if (quote >= 0) closeQuote(); continue; }
      const indent = /^[ \t]*/.exec(line)[0].replace(/\t/g, '    ').length;
      const body = line.trim();
      const lead = /^[ \t]*/.exec(line)[0];
      let m;

      // Block quote.
      if ((m = /^[ \t]*>[ \t]?(.*)$/.exec(line))) {
        if (quote < 0) { closeLists(listsAtDepth()); O[i] = '\\begin{quote}' + inline(ctx, m[1]); }
        else O[i] = inline(ctx, m[1]);
        quote = i;
        lastContent = i; blankSeen = false;
        continue;
      }
      if (quote >= 0) closeQuote();

      // Heading.
      if (indent === 0 && (m = /^(#{1,6})[ \t]+(.*?)[ \t]*$/.exec(line))) {
        closeLists(0);
        let title = m[2].replace(/[ \t]+#+$/, '');
        let attrs = null;
        const t = new RegExp('(' + PH_ONE + ')$').exec(title);
        if (t && phOf(ctx, t[1]).kind === 'attr') { attrs = phOf(ctx, t[1]).attrs; title = title.slice(0, t.index).trimEnd(); }
        const star = attrs && attrs.classes.indexOf('unnumbered') >= 0 ? '*' : '';
        O[i] = '\\' + HEADINGS[m[1].length - 1] + star + '{' + inline(ctx, title) + '}' +
          (attrs && attrs.id ? '\\label{' + attrs.id + '}' : '');
        lastContent = i; blankSeen = false;
        continue;
      }

      // Fenced div ::: name [title] {#id}  …  :::
      if ((m = /^[ \t]*:{3,}[ \t]*(.*?)[ \t]*:*[ \t]*$/.exec(line))) {
        const rest = m[1];
        if (!rest) {
          closeLists(listsAtDepth());
          const d = divs.pop();
          O[i] = d ? '\\end{' + d.name + '}' : '';
          lastContent = i; blankSeen = false;
          continue;
        }
        const f = new RegExp('^([A-Za-z][\\w-]*\\*?)?[ \\t]*(?:\\[(.*)\\])?[ \\t]*(' + PH_ONE + ')?$').exec(rest);
        if (f && (f[1] || f[3])) {
          closeLists(listsAtDepth());
          const attrs = f[3] && phOf(ctx, f[3]).kind === 'attr' ? phOf(ctx, f[3]).attrs : { id: null, classes: [] };
          let name = f[1] || attrs.classes.find((c) => c !== 'unnumbered') || 'center';
          const star = /\*$/.test(name) ? '*' : '';
          name = name.replace(/\*$/, '');
          name = (ALIASES[name] || name) + star;
          if (KINDS[name.replace(/\*$/, '')] && !ctx.theorems.has(name.replace(/\*$/, ''))) ctx.used.add(name);
          divs.push({ name });
          O[i] = lead + '\\begin{' + name + '}' + (f[2] != null && f[2] !== '' ? '[' + inline(ctx, f[2]) + ']' : '') +
            (attrs.id ? '\\label{' + attrs.id + '}' : '');
          lastContent = i; blankSeen = false;
          continue;
        }
      }

      // Horizontal rule.
      if (/^[ \t]*([-*_])([ \t]*\1){2,}[ \t]*$/.test(line) && !lists.length) {
        O[i] = '\\par\\medskip\\noindent\\hrulefill\\par\\medskip';
        lastContent = i; blankSeen = false;
        continue;
      }

      // Figure: an image alone on its line.
      if ((m = new RegExp('^[ \\t]*!\\[(.*)\\]\\((' + PH_ONE + ')\\)[ \\t]*(' + PH_ONE + ')?[ \\t]*$').exec(line))) {
        if (indent === 0) closeLists(listsAtDepth());
        const url = phOf(ctx, m[2]).url;
        const ap = m[3] && phOf(ctx, m[3]);
        const attrs = ap && ap.kind === 'attr' ? ap.attrs : { id: null, kv: {} };
        const cap = m[1].trim();
        O[i] = lead + '\\begin{figure}[htbp]\\centering\\includegraphics' + graphicsOptions(attrs.kv) + '{' + url + '}' +
          (cap ? '\\caption{' + inline(ctx, cap) + '}' : '') + (attrs.id ? '\\label{' + attrs.id + '}' : '') + '\\end{figure}';
        lastContent = i; blankSeen = false;
        continue;
      }

      // List item.
      if ((m = /^([ \t]*)([-*+]|(\d{1,9})[.)])[ \t]+(.*)$/.exec(line))) {
        const type = m[3] != null ? 'enumerate' : 'itemize';
        const keep = listsAtDepth();
        const last = () => (lists.length > keep ? lists[lists.length - 1] : null);
        while (last() && indent < last().indent) closeLists(lists.length - 1);
        let prefix = '';
        let top = last();
        if (top && indent <= top.indent + 1 && top.type !== type) { closeLists(lists.length - 1); top = null; }
        if (!top || indent > top.indent + 1) {
          const level = lists.filter((l) => l.type === 'enumerate').length;
          lists.push({ type, indent, depth: divs.length });
          prefix = '\\begin{' + type + '}';
          if (type === 'enumerate' && +m[3] !== 1 && level < 4) {
            prefix += '\\setcounter{enum' + ['i', 'ii', 'iii', 'iv'][level] + '}{' + (+m[3] - 1) + '}';
          }
        }
        O[i] = m[1] + prefix + '\\item ' + inline(ctx, m[4]);
        lastContent = i; blankSeen = false;
        continue;
      }

      // Plain text (or a line of raw LaTeX). A blank line followed by less indented text ends lists.
      if (lists.length && blankSeen) {
        const floor = listsAtDepth();
        let k = lists.length;
        while (k > floor && indent <= lists[k - 1].indent) k--;
        closeLists(k);
      }
      O[i] = lead + inline(ctx, body);
      lastContent = i; blankSeen = false;
    }

    closeLists(0);
    closeQuote();
    while (divs.length) appendTo(lastContent, '\\end{' + divs.pop().name + '}');
    return O;
  }

  // ------------------------------------------------------------- preamble

  function inlineValue(ctx, v) {
    return restore(ctx, inline(ctx, lex(String(v), ctx)));
  }

  const AFFIL_KEYS = ['affiliation', 'affiliations', 'affil', 'institute', 'institution', 'address'];

  /** Authors as { name, affils: [], email, orcid, thanks, curraddr } (SPEC §3). */
  function authorsOf(meta) {
    const a = meta.author || meta.authors;
    if (!a) return [];
    const list = Array.isArray(a) ? a : [a];
    const many = (v) => [].concat(v == null ? [] : v).map((x) => String(x).trim()).filter(Boolean);
    return list.map((x) => (typeof x === 'object' ? x : { name: x })).filter((x) => x.name).map((x) => ({
      name: x.name,
      affils: many(AFFIL_KEYS.map((k) => x[k]).find((v) => v != null && v !== '')),
      email: many(x.email)[0], orcid: many(x.orcid)[0],
      thanks: many(x.thanks)[0], curraddr: many(x.curraddr)[0],
    }));
  }

  function orcidUrl(id) { return /^https?:/.test(id) ? id : 'https://orcid.org/' + id; }

  /** \author … lines for the class: amsart blocks, beamer \inst marks, authblk, or a plain \author. */
  function authorLines(ctx, authors, cls, ams, userPkgs) {
    const iv = (v) => inlineValue(ctx, v);
    const lines = [];
    if (ams) {
      for (const a of authors) {
        lines.push('\\author{' + iv(a.name) + '}');
        a.affils.forEach((f) => lines.push('\\address{' + iv(f) + '}'));
        if (a.curraddr) lines.push('\\curraddr{' + iv(a.curraddr) + '}');
        if (a.email) lines.push('\\email{' + a.email + '}');
        if (a.orcid) lines.push('\\urladdr{' + orcidUrl(a.orcid) + '}');
        if (a.thanks) lines.push('\\thanks{' + iv(a.thanks) + '}');
      }
      return lines;
    }
    // Each distinct institute once, numbered in order of first use.
    const inst = [];
    authors.forEach((a) => a.affils.forEach((f) => { if (!inst.includes(f)) inst.push(f); }));
    const marks = (a) => a.affils.map((f) => inst.indexOf(f) + 1).join(',');
    const notes = (a) => [a.thanks && iv(a.thanks), a.curraddr && 'Current address: ' + iv(a.curraddr),
      a.orcid && 'ORCID: ' + a.orcid].filter(Boolean);
    const thanks = (a, extra) => notes(a).concat(extra || []).map((t) => '\\thanks{' + t + '}').join('');
    if (cls === 'beamer') {
      lines.push('\\author{' + authors.map((a) => iv(a.name) + (a.affils.length ? '\\inst{' + marks(a) + '}' : '')).join(' \\and ') + '}');
      const emails = authors.filter((a) => a.email).map((a) => '\\texttt{' + a.email + '}');
      if (inst.length || emails.length) {
        const parts = inst.map((f, k) => (inst.length > 1 ? '\\inst{' + (k + 1) + '} ' : '') + iv(f));
        lines.push('\\institute{' + parts.join(' \\and ') + (emails.length ? (parts.length ? '\\\\ ' : '') + emails.join(', ') : '') + '}');
      }
      return lines;
    }
    const shared = authors.some((a) => a.affils.length > 1) ||
      inst.some((f) => authors.filter((a) => a.affils.includes(f)).length > 1);
    if (shared) {
      // Several institutes per author, or one shared by several: authblk's numbered marks.
      if (!userPkgs.some((l) => /\{authblk\}/.test(l))) lines.push('\\usepackage{authblk}');
      for (const a of authors) {
        lines.push('\\author' + (a.affils.length ? '[' + marks(a) + ']' : '') + '{' + iv(a.name) +
          thanks(a, a.email ? ['\\texttt{' + a.email + '}'] : []) + '}');
      }
      inst.forEach((f, k) => lines.push('\\affil[' + (k + 1) + ']{' + iv(f) + '}'));
      return lines;
    }
    lines.push('\\author{' + authors.map((a) => iv(a.name) + thanks(a) +
      a.affils.map((f) => '\\\\ ' + iv(f)).join('') +
      (a.email ? '\\\\ \\texttt{' + a.email + '}' : '')).join(' \\and ') + '}');
    return lines;
  }

  function packageLines(list) {
    return list.map((p) => {
      p = String(p).trim();
      if (/^\\/.test(p)) return p;
      let m = /^\[(.*)\]\s*(.+)$/.exec(p);
      if (m) return '\\usepackage[' + m[1] + ']{' + m[2] + '}';
      m = /^(.+?)\s*\[(.*)\]$/.exec(p);
      if (m) return '\\usepackage[' + m[2] + ']{' + m[1] + '}';
      return '\\usepackage{' + p + '}';
    });
  }

  function buildPreamble(ctx, meta) {
    const lines = [];
    let cls = meta.class || meta.documentclass || 'amsart';
    const opts = meta.classoptions || meta['class-options'];
    if (ctx.docclass) lines.push(ctx.docclass);
    else lines.push('\\documentclass' + (opts ? '[' + (Array.isArray(opts) ? opts.join(',') : opts) + ']' : '') + '{' + cls + '}');
    const clsName = ctx.docclass ? (/\{([^}]*)\}/.exec(ctx.docclass) || [])[1] : cls;
    const ams = /^ams(art|book|proc)$/.test(clsName || '');

    const userPkgs = packageLines([].concat(meta.packages || []));
    const all = DEFAULT_PACKAGES.concat(userPkgs);
    const lifted = ctx.lifted.slice();
    // cleveref must load last; move it after any user packages.
    const cref = all.splice(all.findIndex((l) => /cleveref/.test(l)), 1)[0];
    const pk = lifted.filter((l) => /^\\(usepackage|RequirePackage)/.test(l));
    const other = lifted.filter((l) => !/^\\(usepackage|RequirePackage)/.test(l));
    lines.push(...all, ...pk);
    if (!pk.some((l) => /cleveref/.test(l))) lines.push(cref);
    lines.push(...other);
    if (meta.macros) [].concat(meta.macros).forEach((f) => lines.push('\\input{' + f + '}'));

    // Theorem environments used by ::: blocks.
    const used = Array.from(ctx.used);
    if (used.length) {
      const numbering = meta.numbering === 'global' ? '' : '[' + (meta.numbering || 'section') + ']';
      const needBase = used.some((u) => !/\*$/.test(u));
      const decl = [];
      let style = null;
      const order = ['plain', 'definition', 'remark'];
      const base = needBase && !ctx.theorems.has('theorem') ? 'theorem' : null;
      const names = new Set(used);
      if (base) names.add('theorem');
      const sorted = Array.from(names).sort((a, b) =>
        order.indexOf(KINDS[a.replace(/\*$/, '')][1]) - order.indexOf(KINDS[b.replace(/\*$/, '')][1]) ||
        (a === 'theorem' ? -1 : b === 'theorem' ? 1 : 0));
      for (const nm of sorted) {
        const k = nm.replace(/\*$/, '');
        const [title, st] = KINDS[k];
        if (st !== style) { decl.push('\\theoremstyle{' + st + '}'); style = st; }
        if (/\*$/.test(nm)) decl.push('\\newtheorem*{' + nm + '}{' + title + '}');
        else if (nm === 'theorem') decl.push('\\newtheorem{theorem}{Theorem}' + numbering);
        else decl.push('\\newtheorem{' + nm + '}[theorem]{' + title + '}');
      }
      lines.push(...decl);
    }

    if (meta.title) lines.push('\\title{' + inlineValue(ctx, meta.title) + '}');
    const authors = authorsOf(meta);
    if (authors.length) lines.push(...authorLines(ctx, authors, clsName, ams, all.concat(pk)));
    if (meta.date != null) lines.push('\\date{' + (meta.date === 'today' ? '\\today' : inlineValue(ctx, meta.date)) + '}');
    if (ams && meta.keywords) lines.push('\\keywords{' + [].concat(meta.keywords).map((k) => inlineValue(ctx, k)).join(', ') + '}');
    if (ams && meta.subjclass) lines.push('\\subjclass[2020]{' + [].concat(meta.subjclass).join(', ') + '}');

    lines.push('\\begin{document}');
    const abs = meta.abstract ? ['\\begin{abstract}', ...inlineValue(ctx, meta.abstract).split('\n'), '\\end{abstract}'] : [];
    if (ams) lines.push(...abs);
    if (meta.title) lines.push('\\maketitle');
    if (!ams) lines.push(...abs);
    return lines;
  }

  // ----------------------------------------------------------------- main

  /**
   * Converts TeXmark source to LaTeX.
   * Returns { latex, body, preamble, bodyLine, meta }:
   *   body      the converted body; line k of it is line k of the source
   *   preamble  everything before the body (\documentclass … \maketitle)
   *   latex     the whole document: preamble, body, \end{document}
   *   bodyLine  the 1-based line of `latex` that holds source line 1
   *   sourceOffset(n)  the source offset for offset n of `latex`
   *   sourceRange(s, e)  the whole source lines that latex[s, e) came from
   * options.compact: put the whole preamble on line 1, so that line k of
   *   `latex` is line k of the source (for editors and previews).
   * options.meta: front-matter values to add or override.
   */
  function convert(src, options) {
    options = options || {};
    src = String(src).replace(/\r\n?/g, '\n');
    const { meta, body: rawBody, frontEnd = 0 } = splitFrontMatter(src);
    Object.assign(meta, options.meta || {});

    const ctx = {
      ph: [], lifted: [], docclass: null, used: new Set(), trailer: '',
      labels: new Set(), theorems: new Set(),
    };
    let m;
    const labelRe = /\\label\s*\{([^}]+)\}|\{#([^\s}]+)/g;
    while ((m = labelRe.exec(rawBody))) ctx.labels.add(m[1] || m[2]);
    const thmRe = /\\newtheorem\*?\s*\{([^}]+)\}/g;
    while ((m = thmRe.exec(rawBody))) ctx.theorems.add(m[1].trim());

    const lexed = lex(rawBody, ctx);
    const outLines = blocks(ctx, lexed).map((l) => restore(ctx, l));
    if (ctx.trailer) outLines[outLines.length - 1] += ctx.trailer;
    const body = outLines.join('\n');

    const pre = buildPreamble(ctx, meta);
    const post = [];
    const bib = meta.bibliography || meta.bib;
    if (bib) {
      post.push('\\bibliographystyle{' + (meta.bibstyle || meta['biblio-style'] || 'amsplain') + '}');
      post.push('\\bibliography{' + [].concat(bib).map((b) => String(b).replace(/\.bib$/, '')).join(',') + '}');
    }
    post.push('\\end{document}');
    let preamble, latex, bodyLine;
    if (options.compact) {
      // The whole preamble on the first line, so every line keeps its number.
      preamble = pre.map((l) => l.replace(/(^|[^\\])%.*$/gm, '$1').replace(/\n\s*\n/g, '\\par ').replace(/\n/g, ' ')).join(' ') + ' ';
      latex = preamble + body + '\n' + post.join('\n') + '\n';
      bodyLine = 1;
    } else {
      preamble = pre.join('\n');
      latex = preamble + '\n' + body + '\n' + post.join('\n') + '\n';
      bodyLine = pre.length + 1;
    }
    return {
      latex,
      body,
      preamble,
      bodyLine,
      meta,
      ...offsetMapper(src, latex, bodyLine, frontEnd),
    };
  }

  function lineStarts(text) {
    const starts = [0];
    for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
    return starts;
  }

  /**
   * Maps offsets in `latex` back to `src`. Lines match one to one (from
   * bodyLine on). sourceOffset(n): the same line, with the column scaled to
   * the line's length, so line starts and ends map exactly; the preamble maps
   * to 0 and what follows the body to the end. sourceRange(s, e): the whole
   * source lines that [s, e) touches, which is what an editor should replace;
   * the preamble maps to the front matter.
   */
  function offsetMapper(src, latex, bodyLine, frontEnd) {
    let ls = null, ss = null;
    const init = () => { if (!ls) { ls = lineStarts(latex); ss = lineStarts(src); } };
    const lineOf = (n) => {
      let lo = 0, hi = ls.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ls[mid] <= n) lo = mid; else hi = mid - 1; }
      return lo;
    };
    const sEndOf = (k) => (k + 1 < ss.length ? ss[k + 1] - 1 : src.length);
    function sourceOffset(n) {
      init();
      n = Math.max(0, Math.min(n, latex.length));
      const lo = lineOf(n);
      const k = lo - (bodyLine - 1);
      if (k < 0) return 0;
      if (k >= ss.length) return src.length;
      const lEnd = lo + 1 < ls.length ? ls[lo + 1] - 1 : latex.length;
      const col = n - ls[lo], lLen = lEnd - ls[lo], sLen = sEndOf(k) - ss[k];
      if (col >= lLen) return ss[k] + sLen + (col > lLen && k + 1 < ss.length ? 1 : 0);
      return ss[k] + (lLen ? Math.round(col * sLen / lLen) : 0);
    }
    function sourceRange(s, e) {
      init();
      const a = lineOf(Math.max(0, Math.min(s, latex.length))) - (bodyLine - 1);
      const b = lineOf(Math.max(0, Math.min(Math.max(s, e - 1), latex.length))) - (bodyLine - 1);
      const start = a < 0 ? 0 : a >= ss.length ? src.length : ss[a];
      const end = b < 0 ? frontEnd : b >= ss.length ? src.length : sEndOf(b);
      return [start, Math.max(start, end)];
    }
    return { sourceOffset, sourceRange };
  }

  /** Converts to a complete LaTeX document (a string). */
  function toLatex(src, options) {
    return convert(src, options).latex;
  }

  /** True for file names TeXmark handles. */
  function isTeXmarkFile(name) {
    return /\.tmd$/i.test(name || '');
  }

  return { convert, toLatex, isTeXmarkFile, parseFrontMatter: (s) => splitFrontMatter(String(s).replace(/\r\n?/g, '\n')).meta, VERSION };
});
