'use strict';
// Building a PDF from a .tmd file with the reader's own LaTeX: what to run,
// and how to read the log back onto the .tmd lines. No VS Code API here.
//
// The file is converted in compact mode (the whole preamble on line 1), so
// line k of the generated .tex is line k of the .tmd, and a LaTeX error on
// line k is an error on line k of the source. The generated .tex goes into a
// build folder; LaTeX runs from the .tmd's own folder, so \input, figures and
// .bib files resolve exactly as they would next to it.

const path = require('path');

const ENGINES = {
  pdflatex: { latexmk: '-pdf', bin: 'pdflatex' },
  xelatex: { latexmk: '-xelatex', bin: 'xelatex' },
  lualatex: { latexmk: '-lualatex', bin: 'lualatex' },
};

/**
 * What to run for one build.
 *   tmdPath  absolute path of the .tmd file
 *   outDir   build folder, relative to the .tmd's folder or absolute (default .texmark)
 *   tool     'latexmk' or 'engine' (the engine, bibtex if needed, then the engine twice)
 *   engine   'pdflatex' | 'xelatex' | 'lualatex'
 *   hasBib   whether the file has a bibliography (for 'engine')
 * Returns { cwd, outDir, jobname, texPath, pdfPath, logPath, steps: [{ cmd, args, cwd, env }] }.
 */
function plan({ tmdPath, outDir, tool, engine, hasBib }) {
  const cwd = path.dirname(tmdPath);
  const jobname = path.basename(tmdPath).replace(/\.tmd$/i, '');
  const out = path.resolve(cwd, outDir || '.texmark');
  const texPath = path.join(out, jobname + '.tex');
  const rel = path.relative(cwd, texPath) || texPath;
  // The build folder as LaTeX sees it: relative when it sits inside the .tmd's
  // folder, which keeps spaces in the folders above out of TeX's way.
  const relOut = path.relative(cwd, out);
  const outArg = relOut && !relOut.startsWith('..') && !path.isAbsolute(relOut) ? relOut : out;
  const eng = ENGINES[engine] || ENGINES.pdflatex;
  const common = ['-interaction=nonstopmode', '-file-line-error', '-synctex=1'];
  const steps = [];
  if ((tool || 'latexmk') === 'latexmk') {
    steps.push({ cmd: 'latexmk', args: [eng.latexmk, ...common, '-outdir=' + outArg, rel], cwd });
  } else {
    const run = { cmd: eng.bin, args: [...common, '-output-directory=' + outArg, rel], cwd };
    steps.push(run);
    if (hasBib) {
      // bibtex runs in the build folder and finds the .bib next to the .tmd.
      steps.push({
        cmd: 'bibtex', args: [jobname], cwd: out,
        env: { BIBINPUTS: cwd + path.delimiter, BSTINPUTS: cwd + path.delimiter },
        optional: true,
      });
    }
    steps.push(run, run);
  }
  return {
    cwd, outDir: out, jobname, texPath,
    pdfPath: path.join(out, jobname + '.pdf'),
    logPath: path.join(out, jobname + '.log'),
    steps,
  };
}

/**
 * Problems from a LaTeX log, for the generated file `texName` (its base name).
 * Returns [{ line, message, severity: 'error' | 'warning' }], line 1-based.
 * Reads -file-line-error lines (./x.tex:12: Undefined control sequence),
 * classic "! Error … l.12" pairs, and LaTeX's "… on input line 12" warnings.
 */
function parseLog(log, texName) {
  const out = [];
  const seen = new Set();
  const add = (line, message, severity) => {
    message = message.replace(/\s+/g, ' ').trim();
    const k = line + '|' + message;
    if (!line || seen.has(k)) return;
    seen.add(k);
    out.push({ line, message, severity });
  };
  const text = String(log).replace(/\r\n?/g, '\n');
  const ls = text.split('\n');
  const base = texName ? path.basename(texName) : null;
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const fileLine = base ? new RegExp('(?:^|[\\s(/\\\\])' + esc(base) + ':(\\d+): (.*)$') : /^.*?\.tex:(\d+): (.*)$/;
  for (let i = 0; i < ls.length; i++) {
    const s = ls[i];
    let m;
    if ((m = fileLine.exec(s))) {
      let msg = m[2];
      // The context ("l.12 \foo") on the next lines makes the message clearer.
      const ctx = ls.slice(i + 1, i + 6).find((x) => /^l\.\d+ /.test(x));
      if (ctx && /Undefined control sequence/.test(msg)) {
        const cmd = /\\[A-Za-z@]+$/.exec(ctx.replace(/^l\.\d+ /, '').trimEnd());
        if (cmd) msg += ' ' + cmd[0];
      }
      add(+m[1], msg, 'error');
      continue;
    }
    if ((m = /^! (.*)$/.exec(s))) {
      const ctx = ls.slice(i + 1, i + 12).find((x) => /^l\.\d+/.test(x));
      if (ctx) add(+/^l\.(\d+)/.exec(ctx)[1], m[1], 'error');
      continue;
    }
    if ((m = /^(?:LaTeX|Package \w+|Class \w+) Warning: (.*)$/.exec(s))) {
      // Warnings wrap; join the continuation lines (they start with spaces or "(pkg)").
      let msg = m[1];
      let j = i + 1;
      while (j < ls.length && ls[j].trim() && !/^(?:LaTeX|Package|Class) /.test(ls[j]) && j < i + 5) {
        msg += ' ' + ls[j].replace(/^\(\w+\)\s*/, '').trim();
        j++;
      }
      const at = /on input line (\d+)\.?/.exec(msg);
      if (at) add(+at[1], msg.replace(/\s*on input line \d+\.?/, '.').replace(/\.\.$/, '.'), 'warning');
    }
  }
  return out;
}

/** "latexmk -pdf … file.tex" as one line, for the output panel. */
function describe(step) {
  const q = (a) => (/[\s"]/.test(a) ? JSON.stringify(a) : a);
  return [step.cmd, ...step.args].map(q).join(' ');
}

module.exports = { plan, parseLog, describe, ENGINES };
