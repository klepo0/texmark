#!/usr/bin/env node
'use strict';
// Writes syntaxes/texmark.tmLanguage.json. The grammar lives here as code so
// the regular expressions can be read without JSON escaping:
//   node scripts/build-grammar.js
// Markdown parts are coloured with the scopes Markdown themes know; maths,
// environments and commands are handed to VS Code's LaTeX grammar
// (text.tex.latex, also the one LaTeX Workshop ships).
const fs = require('fs');
const path = require('path');

const PROSE_ENVS = [
  'document', 'abstract', 'center', 'flushleft', 'flushright', 'quote', 'quotation', 'verse',
  'itemize', 'enumerate', 'description', 'figure', 'table', 'minipage', 'proof', 'wrapfigure',
  'subfigure', 'multicols', 'frame', 'block', 'alertblock', 'exampleblock',
  'theorem', 'lemma', 'proposition', 'corollary', 'conjecture', 'claim', 'hypothesis',
  'definition', 'assumption', 'example', 'exercise', 'problem', 'question', 'notation',
  'remark', 'note', 'tiny', 'scriptsize', 'footnotesize', 'small', 'normalsize', 'large',
  'Large', 'LARGE', 'huge', 'Huge',
];

const ATTRS = String.raw`\{(?:[#.-][^{}\n]*|[\w-]+=[^{}\n]*)\}`;
const LABEL = String.raw`[\w][\w:.\-/]*[\w]|[\w]`;

const grammar = {
  $schema: 'https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json',
  name: 'TeXmark',
  scopeName: 'text.tex.texmark',
  fileTypes: ['tmd'],
  patterns: [
    { include: '#front-matter' },
    { include: '#block' },
  ],
  repository: {
    'front-matter': {
      begin: String.raw`\A(---)\s*$`,
      beginCaptures: { 1: { name: 'punctuation.definition.frontmatter.begin.texmark' } },
      end: String.raw`^(---|\.\.\.)\s*$`,
      endCaptures: { 1: { name: 'punctuation.definition.frontmatter.end.texmark' } },
      name: 'meta.frontmatter.texmark',
      contentName: 'meta.embedded.block.frontmatter source.yaml',
      patterns: [{ include: 'source.yaml' }],
    },
    block: {
      patterns: [
        { include: '#comment' },
        { include: '#fenced-code' },
        { include: '#heading' },
        { include: '#theorem-fence' },
        { include: '#rule' },
        { include: '#figure' },
        { include: '#list-marker' },
        { include: '#quote-marker' },
        { include: '#display-math' },
        { include: '#inline' },
      ],
    },
    comment: {
      // % starts a comment, except right after a digit (50% is a percent sign).
      match: String.raw`(?<![\\0-9])(%).*$`,
      name: 'comment.line.percentage.texmark',
      captures: { 1: { name: 'punctuation.definition.comment.texmark' } },
    },
    'fenced-code': {
      begin: String.raw`^\s*(\x60{3,}|~{3,})\s*([\w+#.-]*).*$`,
      beginCaptures: {
        1: { name: 'punctuation.definition.markdown' },
        2: { name: 'fenced_code.block.language.markdown' },
      },
      end: String.raw`^\s*\1\s*$`,
      endCaptures: { 0: { name: 'punctuation.definition.markdown' } },
      name: 'markup.fenced_code.block.markdown',
      contentName: 'markup.raw.block.markdown',
    },
    heading: {
      begin: String.raw`^(#{1,5})(?=\s)`,
      beginCaptures: { 1: { name: 'punctuation.definition.heading.markdown' } },
      end: '$',
      name: 'markup.heading.markdown',
      contentName: 'entity.name.section.markdown',
      patterns: [
        { include: '#attributes' },
        { include: '#comment' },
        { include: '#inline' },
      ],
    },
    'theorem-fence': {
      // ::: theorem [Title] {#thm:x}   and   ::: {#thm:x .theorem}   and   :::
      begin: String.raw`^\s*(:{3,})\s*(?:([A-Za-z][\w-]*\*?)(?=[\s\[{]|$))?\s*`,
      beginCaptures: {
        1: { name: 'punctuation.definition.block.texmark keyword.control.block.texmark' },
        2: { name: 'entity.name.type.environment.texmark storage.type.theorem.texmark' },
      },
      end: '$',
      name: 'meta.block.theorem.texmark',
      patterns: [
        {
          begin: String.raw`\[`,
          beginCaptures: { 0: { name: 'punctuation.definition.title.begin.texmark' } },
          end: String.raw`\]`,
          endCaptures: { 0: { name: 'punctuation.definition.title.end.texmark' } },
          contentName: 'entity.name.section.theorem-title.texmark markup.bold.texmark',
          patterns: [{ include: '#inline' }],
        },
        { include: '#attributes' },
        { include: '#comment' },
      ],
    },
    rule: {
      match: String.raw`^\s*(?:-{3,}|\*{3,}|_{3,})\s*$`,
      name: 'meta.separator.markdown',
    },
    figure: {
      // ![Caption](file){#fig:x width=60%}
      begin: String.raw`(!)(\[)`,
      beginCaptures: {
        1: { name: 'punctuation.definition.link.description.begin.markdown' },
        2: { name: 'punctuation.definition.link.description.begin.markdown' },
      },
      end: String.raw`(\])(\()([^)\s]*)(\))(${ATTRS})?`,
      endCaptures: {
        1: { name: 'punctuation.definition.link.description.end.markdown' },
        2: { name: 'punctuation.definition.metadata.markdown' },
        3: { name: 'markup.underline.link.image.markdown' },
        4: { name: 'punctuation.definition.metadata.markdown' },
        5: { patterns: [{ include: '#attributes' }] },
      },
      name: 'meta.image.inline.markdown',
      contentName: 'string.other.link.description.markdown',
      patterns: [{ include: '#inline' }],
    },
    'list-marker': {
      match: String.raw`^\s*([-*+]|\d{1,9}[.)])(?=\s)`,
      captures: { 1: { name: 'punctuation.definition.list.begin.markdown' } },
    },
    'quote-marker': {
      match: String.raw`^\s*(>)(?=\s|$)`,
      captures: { 1: { name: 'punctuation.definition.quote.begin.markdown markup.quote.markdown' } },
    },
    'display-math': {
      // $$ … $$ {#eq:x}
      begin: String.raw`\$\$`,
      beginCaptures: { 0: { name: 'punctuation.definition.string.begin.tex' } },
      end: String.raw`(\$\$)(\s*${ATTRS})?`,
      endCaptures: {
        1: { name: 'punctuation.definition.string.end.tex' },
        2: { patterns: [{ include: '#attributes' }] },
      },
      name: 'meta.math.block.texmark support.class.math.block.environment.latex',
      patterns: [
        { match: String.raw`\\\$`, name: 'constant.character.escape.tex' },
        { include: 'text.tex#math-content' },
        { include: 'text.tex.latex' },
      ],
    },
    'inline-math': {
      patterns: [
        {
          // $ opens maths only before a non-space with a closing $ (not before a digit) on the line.
          begin: String.raw`(?<![\\$])\$(?![\s$])(?=(?:[^$\\]|\\.)*(?<![\s\\])\$(?!\d))`,
          beginCaptures: { 0: { name: 'punctuation.definition.string.begin.tex' } },
          end: String.raw`\$`,
          endCaptures: { 0: { name: 'punctuation.definition.string.end.tex' } },
          name: 'meta.math.block.tex support.class.math.block.tex',
          patterns: [
            { match: String.raw`\\\$`, name: 'constant.character.escape.tex' },
            { include: 'text.tex#math-content' },
            { include: 'text.tex.latex' },
          ],
        },
        // "costs $5": a dollar sign that is text.
        { match: String.raw`\$(?=\d|\s)` },
      ],
    },
    attributes: {
      match: String.raw`(\{)(?:(#)(${LABEL})|([.-][^{}\n]*)|([\w-]+=[^{}\n]*))([^{}\n]*)(\})`,
      captures: {
        1: { name: 'punctuation.definition.attributes.begin.texmark' },
        2: { name: 'punctuation.definition.label.texmark' },
        3: { name: 'variable.parameter.definition.label.latex' },
        4: { name: 'entity.other.attribute-name.texmark' },
        5: { name: 'entity.other.attribute-name.texmark' },
        6: { name: 'entity.other.attribute-name.texmark' },
        7: { name: 'punctuation.definition.attributes.end.texmark' },
      },
    },
    inline: {
      patterns: [
        { include: '#escape' },
        { include: '#inline-math' },
        { include: '#code-span' },
        { include: '#bold' },
        { include: '#italic' },
        { include: '#footnote' },
        { include: '#citation' },
        { include: '#figure' },
        { include: '#link' },
        { include: '#autolink' },
        { include: '#reference' },
        { include: '#attributes' },
        { include: '#comment' },
        { include: '#prose-env' },
        // 50% is a percent sign, not a comment.
        { match: String.raw`(?<=[0-9])%` },
        { include: 'text.tex.latex' },
      ],
    },
    escape: {
      match: String.raw`\\[*_$%&#@\x60]`,
      name: 'constant.character.escape.texmark',
    },
    'code-span': {
      match: String.raw`(\x60+)(.+?)(?<!\x60)(\1)(?!\x60)`,
      captures: {
        1: { name: 'punctuation.definition.raw.markdown' },
        2: { name: 'markup.inline.raw.string.markdown' },
        3: { name: 'punctuation.definition.raw.markdown' },
      },
      name: 'markup.inline.raw.markdown',
    },
    bold: {
      begin: String.raw`(?<![\w\\*_])(\*\*|__)(?=[^\s*_])(?=.*?(?<=\S)\1)`,
      beginCaptures: { 1: { name: 'punctuation.definition.bold.markdown' } },
      end: String.raw`(?<=\S)(\1)`,
      endCaptures: { 1: { name: 'punctuation.definition.bold.markdown' } },
      name: 'markup.bold.markdown',
      patterns: [{ include: '#inline' }],
    },
    italic: {
      patterns: [
        {
          begin: String.raw`(?<![\w\\*])(\*)(?=[^\s*])(?=(?:[^*\\]|\\.)*?(?<=\S)\*(?!\*))`,
          beginCaptures: { 1: { name: 'punctuation.definition.italic.markdown' } },
          end: String.raw`(?<=\S)(\*)`,
          endCaptures: { 1: { name: 'punctuation.definition.italic.markdown' } },
          name: 'markup.italic.markdown',
          patterns: [{ include: '#inline' }],
        },
        {
          // _ only at word edges: snake_case is text.
          begin: String.raw`(?<![\w\\_])(_)(?=[^\s_])(?=(?:[^_\\]|\\.)*?(?<=\S)_(?!\w))`,
          beginCaptures: { 1: { name: 'punctuation.definition.italic.markdown' } },
          end: String.raw`(?<=\S)(_)(?!\w)`,
          endCaptures: { 1: { name: 'punctuation.definition.italic.markdown' } },
          name: 'markup.italic.markdown',
          patterns: [{ include: '#inline' }],
        },
      ],
    },
    footnote: {
      begin: String.raw`(\^)(\[)`,
      beginCaptures: {
        1: { name: 'punctuation.definition.footnote.texmark' },
        2: { name: 'punctuation.definition.footnote.begin.texmark' },
      },
      end: String.raw`\]`,
      endCaptures: { 0: { name: 'punctuation.definition.footnote.end.texmark' } },
      name: 'meta.footnote.texmark',
      contentName: 'markup.other.footnote.texmark',
      patterns: [{ include: '#inline' }],
    },
    citation: {
      // [@key], [@a; @b], [see @key, p. 3]
      begin: String.raw`\[(?=[^\]\n]*(?<![\w\\])@[\w])`,
      beginCaptures: { 0: { name: 'punctuation.definition.citation.begin.texmark' } },
      end: String.raw`\]`,
      endCaptures: { 0: { name: 'punctuation.definition.citation.end.texmark' } },
      name: 'meta.citation.texmark',
      patterns: [
        {
          match: String.raw`(@)(${LABEL})`,
          captures: {
            1: { name: 'punctuation.definition.citation.texmark' },
            2: { name: 'entity.name.type.citation.texmark constant.other.reference.citation.latex' },
          },
        },
        { match: ';', name: 'punctuation.separator.citation.texmark' },
        { include: '#inline-math' },
      ],
    },
    link: {
      // [text](https://…) and [text](#label)
      begin: String.raw`\[(?=[^\]\n]*\]\()`,
      beginCaptures: { 0: { name: 'punctuation.definition.link.title.begin.markdown' } },
      end: String.raw`(\])(\()(?:(#)(${LABEL})|([^)\s]*))(\))`,
      endCaptures: {
        1: { name: 'punctuation.definition.link.title.end.markdown' },
        2: { name: 'punctuation.definition.metadata.markdown' },
        3: { name: 'punctuation.definition.label.texmark' },
        4: { name: 'variable.other.reference.texmark constant.other.reference.label.latex' },
        5: { name: 'markup.underline.link.markdown' },
        6: { name: 'punctuation.definition.metadata.markdown' },
      },
      name: 'meta.link.inline.markdown',
      contentName: 'string.other.link.title.markdown',
      patterns: [{ include: '#inline' }],
    },
    autolink: {
      match: String.raw`(<)((?:https?|ftp|mailto):[^>\s]+)(>)`,
      captures: {
        1: { name: 'punctuation.definition.link.markdown' },
        2: { name: 'markup.underline.link.markdown' },
        3: { name: 'punctuation.definition.link.markdown' },
      },
      name: 'meta.link.inet.markdown',
    },
    reference: {
      // @thm:main  (\cref)
      match: String.raw`(?<![\w\\@])(@)(${LABEL})`,
      captures: {
        1: { name: 'punctuation.definition.reference.texmark' },
        2: { name: 'variable.other.reference.texmark constant.other.reference.label.latex' },
      },
      name: 'meta.reference.texmark',
    },
    'prose-env': {
      // Prose environments only open and close: Markdown keeps working inside.
      match: String.raw`(\\)(begin|end)(\{)(${PROSE_ENVS.join('|')})(\*?)(\})`,
      captures: {
        1: { name: 'punctuation.definition.function.latex' },
        2: { name: 'support.function.be.latex' },
        3: { name: 'punctuation.definition.arguments.begin.latex' },
        4: { name: 'variable.parameter.function.latex' },
        5: { name: 'variable.parameter.function.latex' },
        6: { name: 'punctuation.definition.arguments.end.latex' },
      },
      name: 'meta.function.environment.prose.texmark',
    },
  },
};

const OUT = path.join(__dirname, '..', 'syntaxes', 'texmark.tmLanguage.json');
const text = JSON.stringify(grammar, null, 2) + '\n';
if (require.main === module) {
  fs.writeFileSync(OUT, text);
  console.log('wrote', path.relative(process.cwd(), OUT));
}
module.exports = { grammar, text, OUT, PROSE_ENVS };
