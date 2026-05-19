/**
 * Generate JSON test fixtures from the real prosemirror npm packages.
 *
 * Outputs to tests/spec/expected/*.json (one directory up from this file).
 *
 * Usage:
 *   cd tests/spec/js
 *   npm install
 *   node generate_fixtures.mjs
 */

import { Schema, Fragment, Slice } from 'prosemirror-model';
import { Transform } from 'prosemirror-transform';
import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const OUT_DIR = join(__dirname, '..', 'expected');

// ---------------------------------------------------------------------------
// Schema definition  (must match the Python generate_fixtures.py schema)
// ---------------------------------------------------------------------------

const basicSpec = {
  nodes: {
    doc:              { content: 'block+' },
    paragraph:        { content: 'inline*', group: 'block' },
    blockquote:       { content: 'block+', group: 'block', defining: true },
    horizontal_rule:  { group: 'block' },
    heading:          { attrs: { level: { default: 1 } }, content: 'inline*', group: 'block', defining: true },
    code_block:       { content: 'text*', marks: '', group: 'block', code: true, defining: true },
    text:             { group: 'inline' },
    image:            { inline: true, attrs: { src: {}, alt: { default: null }, title: { default: null } }, group: 'inline', draggable: true },
    hard_break:       { inline: true, group: 'inline' },
    ordered_list:     { attrs: { order: { default: 1 } }, content: 'list_item+', group: 'block' },
    bullet_list:      { content: 'list_item+', group: 'block' },
    list_item:        { content: 'paragraph block*', defining: true },
  },
  marks: {
    link:   { attrs: { href: {}, title: { default: null } }, inclusive: false },
    em:     {},
    strong: {},
    code:   {},
  },
};

const schema = new Schema(basicSpec);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function save(name, data) {
  mkdirSync(OUT_DIR, { recursive: true });
  const path = join(OUT_DIR, `${name}.json`);
  writeFileSync(path, JSON.stringify(data, null, 2));
  console.log(`  wrote ${path}`);
}

function p(text = '', ...marks) {
  if (text) {
    return schema.node('paragraph', {}, [
      schema.text(text, marks.length > 0 ? marks : undefined),
    ]);
  }
  return schema.node('paragraph', {});
}

function h(level, text = '') {
  return schema.node('heading', { level }, text ? [schema.text(text)] : []);
}

function blockquote(...children) {
  return schema.node('blockquote', {}, children);
}

function strong(text) {
  return schema.text(text, [schema.mark('strong')]);
}

function em(text) {
  return schema.text(text, [schema.mark('em')]);
}

function br() {
  return schema.node('hard_break');
}

function li(...children) {
  return schema.node('list_item', {}, children);
}

function ol(...items) {
  return schema.node('ordered_list', {}, items);
}

// ---------------------------------------------------------------------------
// transform_edit.json  (insert / delete)
// ---------------------------------------------------------------------------

function generateTransformEditTests() {
  const cases = [];

  function insertTest(label, docNode, pos, fragment) {
    const tr = new Transform(docNode);
    tr.insert(pos, fragment);
    cases.push({
      label,
      type: 'insert',
      input: docNode.toJSON(),
      pos,
      content: fragment.toJSON(),   // array of node JSONs
      expected: tr.doc.toJSON(),
    });
  }

  function deleteTest(label, docNode, from, to) {
    const tr = new Transform(docNode);
    tr.delete(from, to);
    cases.push({
      label,
      type: 'delete',
      input: docNode.toJSON(),
      from,
      to,
      expected: tr.doc.toJSON(),
    });
  }

  insertTest('can insert a break',
    schema.node('doc', {}, [p('hellothere')]),
    6,
    Fragment.from([br()]));

  insertTest('can insert an empty paragraph at the top',
    schema.node('doc', {}, [p('one'), p('two')]),
    5,
    Fragment.from([p()]));

  deleteTest('can delete a word',
    schema.node('doc', {}, [p('one'), p('two'), p('three')]),
    5, 10);

  deleteTest('can delete text',
    schema.node('doc', {}, [p('hello you')]),
    5, 7);

  save('transform_edit', { cases });
}

// ---------------------------------------------------------------------------
// transform_marks.json  (addMark / removeMark)
// ---------------------------------------------------------------------------

function generateTransformMarkTests() {
  const cases = [];

  function addMarkTest(label, docNode, from, to, markName) {
    const tr = new Transform(docNode);
    tr.addMark(from, to, schema.mark(markName));
    cases.push({
      label,
      type: 'addMark',
      input: docNode.toJSON(),
      from,
      to,
      mark: markName,
      expected: tr.doc.toJSON(),
    });
  }

  function removeMarkTest(label, docNode, from, to, markName) {
    const tr = new Transform(docNode);
    tr.removeMark(from, to, schema.mark(markName));
    cases.push({
      label,
      type: 'removeMark',
      input: docNode.toJSON(),
      from,
      to,
      mark: markName,
      expected: tr.doc.toJSON(),
    });
  }

  addMarkTest('can add a mark',
    schema.node('doc', {}, [p('hello there!')]),
    7, 12, 'strong');

  // NOTE: correct positions are 25,26 (not 26,27) to mark the final 'i'
  addMarkTest('can add a mark in a nested node',
    schema.node('doc', {}, [
      blockquote(
        schema.node('paragraph', {}, [schema.text('the variable is called i')])
      ),
    ]),
    25, 26, 'code');

  removeMarkTest('can cut a gap',
    schema.node('doc', {}, [
      schema.node('paragraph', {}, [
        schema.text('hello world!', [schema.mark('em')]),
      ]),
    ]),
    7, 12, 'em');

  save('transform_marks', { cases });
}

// ---------------------------------------------------------------------------
// transform_structure.json  (split)
// ---------------------------------------------------------------------------

function generateTransformStructureTests() {
  const cases = [];

  function splitTest(label, docNode, pos) {
    const tr = new Transform(docNode);
    tr.split(pos);
    cases.push({
      label,
      type: 'split',
      input: docNode.toJSON(),
      pos,
      expected: tr.doc.toJSON(),
    });
  }

  splitTest('can split a textblock',
    schema.node('doc', {}, [p('foobar')]), 4);

  splitTest('can split at the start',
    schema.node('doc', {}, [p('foobar')]), 1);

  splitTest('can split at the end',
    schema.node('doc', {}, [p('foobar')]), 7);

  save('transform_structure', { cases });
}

// ---------------------------------------------------------------------------
// replace.json  (replace)
// ---------------------------------------------------------------------------

function generateReplaceTests() {
  const cases = [];

  /**
   * @param {string} label
   * @param {import('prosemirror-model').Node} docNode
   * @param {number} from
   * @param {number} to
   * @param {import('prosemirror-model').Slice | null} slice  – null = Slice.empty
   */
  function replaceTest(label, docNode, from, to, slice) {
    const actualSlice = slice ?? Slice.empty;
    const tr = new Transform(docNode);
    tr.replace(from, to, actualSlice);
    cases.push({
      label,
      type: 'replace',
      input: docNode.toJSON(),
      from,
      to,
      // Slice.empty.toJSON() returns null; non-empty returns the slice object
      slice: actualSlice.toJSON(),
      expected: tr.doc.toJSON(),
    });
  }

  replaceTest('can delete text',
    schema.node('doc', {}, [p('hello you')]),
    5, 7, null);

  replaceTest('can join blocks',
    schema.node('doc', {}, [p('hello'), p('you')]),
    5, 8, null);

  replaceTest('can overwrite text',
    schema.node('doc', {}, [p('hello you')]),
    5, 7,
    schema.node('doc', {}, [p('i k')]).slice(
      0,
      schema.node('doc', {}, [p('i k')]).content.size
    ));

  replaceTest('can add a textblock',
    schema.node('doc', {}, [p('helloyou')]),
    6, 6,
    schema.node('doc', {}, [p('there')]).slice(
      0,
      schema.node('doc', {}, [p('there')]).content.size
    ));

  replaceTest('merges blocks across deleted content',
    schema.node('doc', {}, [p('a'), p('b'), p('c')]),
    3, 6, null);

  replaceTest('can delete the whole document',
    schema.node('doc', {}, [h(1, 'hi'), p('you')]),
    0, 7, null);

  save('replace', { cases });
}

// ---------------------------------------------------------------------------
// resolve.json
// ---------------------------------------------------------------------------

function generateResolveTests() {
  const testDoc = schema.node('doc', {}, [
    schema.node('paragraph', {}, [schema.text('ab')]),
    schema.node('blockquote', {}, [
      schema.node('paragraph', {}, [
        schema.text('cd', [schema.mark('em')]),
        schema.text('ef'),
      ]),
    ]),
  ]);

  const cases = [];
  for (let pos = 0; pos <= testDoc.content.size; pos++) {
    const rp = testDoc.resolve(pos);
    cases.push({
      pos,
      depth:         rp.depth,
      parent_offset: rp.parentOffset,
      parent_type:   rp.parent.type.name,
    });
  }

  save('resolve', { doc: testDoc.toJSON(), cases });
}

// ---------------------------------------------------------------------------
// roundtrip.json
// ---------------------------------------------------------------------------

function generateRoundtripTests() {
  const docs = [
    schema.node('doc', {}, [p('hello world')]),
    schema.node('doc', {}, [h(1, 'Title'), p('text'), blockquote(p('quote'))]),
    schema.node('doc', {}, [p('one'), p('two'), p('three')]),
    schema.node('doc', {}, [
      schema.node('paragraph', {}, [
        schema.text('bold',   [schema.mark('strong')]),
        schema.text(' and '),
        schema.text('italic', [schema.mark('em')]),
      ]),
    ]),
    schema.node('doc', {}, [
      schema.node('ordered_list', {}, [
        schema.node('list_item', {}, [p('first')]),
        schema.node('list_item', {}, [p('second')]),
      ]),
    ]),
  ];

  const cases = docs.map(d => ({
    json:         d.toJSON(),
    roundtrip_ok: true,
    node_size:    d.nodeSize,
  }));

  save('roundtrip', { cases });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log('Generating JS test fixtures from prosemirror npm packages...');
generateTransformEditTests();
generateTransformMarkTests();
generateTransformStructureTests();
generateReplaceTests();
generateResolveTests();
generateRoundtripTests();
console.log('Done.');
