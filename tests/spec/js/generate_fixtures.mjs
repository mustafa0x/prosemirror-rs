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
import { Transform, findWrapping, liftTarget } from 'prosemirror-transform';
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
// transform_wrap_lift.json  (wrap / lift via replaceAround steps)
// ---------------------------------------------------------------------------

function generateTransformWrapLiftTests() {
  const cases = [];

  // Helper: run wrap, capture the step and expected doc
  function wrapTest(label, docNode, from, to, wrapType) {
    const $from = docNode.resolve(from);
    const $to   = docNode.resolve(to);
    const range = $from.blockRange($to);
    if (!range) throw new Error(`No blockRange for "${label}"`);
    const wrapping = findWrapping(range, schema.nodes[wrapType]);
    if (!wrapping) throw new Error(`No wrapping for "${label}"`);
    const tr = new Transform(docNode);
    tr.wrap(range, wrapping);
    if (tr.steps.length === 0) throw new Error(`No steps for "${label}"`);
    cases.push({
      label,
      type: 'replaceAround',
      input: docNode.toJSON(),
      step: tr.steps[0].toJSON(),
      expected: tr.doc.toJSON(),
    });
  }

  // Helper: run lift, capture the step and expected doc
  function liftTest(label, docNode, from, to) {
    const $from = docNode.resolve(from);
    const $to   = docNode.resolve(to);
    const range = $from.blockRange($to);
    if (!range) throw new Error(`No blockRange for "${label}"`);
    const target = liftTarget(range);
    if (target == null) throw new Error(`No liftTarget for "${label}"`);
    const tr = new Transform(docNode);
    tr.lift(range, target);
    if (tr.steps.length === 0) throw new Error(`No steps for "${label}"`);
    cases.push({
      label,
      type: 'replaceAround',
      input: docNode.toJSON(),
      step: tr.steps[0].toJSON(),
      expected: tr.doc.toJSON(),
    });
  }

  // ---- wrap tests (translated from prosemirror-transform test-trans.ts) ----
  // Positions are calculated from document structure:
  // p("one")=nodeSize 5 (1+3+1), p("two")=5, p("three")=7, p("four")=6, etc.

  // "can wrap in a blockquote"
  // doc: [p("one") p("two") p("three")]
  // <a> = inside p("two"), before 't' = pos 6
  wrapTest(
    'can wrap in a blockquote',
    schema.node('doc', {}, [p('one'), p('two'), p('three')]),
    6, 6,
    'blockquote'
  );

  // "can wrap two paragraphs"
  // doc: [p("one") p("two") p("three") p("four")]
  // <a>=6 (inside p("two")), <b>=11 (inside p("three"))
  wrapTest(
    'can wrap two paragraphs',
    schema.node('doc', {}, [p('one'), p('two'), p('three'), p('four')]),
    6, 11,
    'blockquote'
  );

  // "can wrap in a list"
  // doc: [p("one") p("two")]
  // <a>=1 (inside p("one")), <b>=6 (inside p("two"))
  wrapTest(
    'can wrap in a list',
    schema.node('doc', {}, [p('one'), p('two')]),
    1, 6,
    'ordered_list'
  );

  // "can wrap in a nested list"
  // doc: ol( li(p("one")), li(p("..."), p("two"), p("three")), li(p("four")) )
  // Positions inside li2: li2 opens at 8, p("...") at 9..14, p("two") at 14..19, p("three") at 19..26
  // <a> = inside p("two") before 't' = 15, <b> = inside p("three") before 't' = 20
  wrapTest(
    'can wrap in a nested list',
    schema.node('doc', {}, [
      ol(li(p('one')), li(p('...'), p('two'), p('three')), li(p('four')))
    ]),
    15, 20,
    'ordered_list'
  );

  // "includes half-covered parent nodes"
  // doc: [blockquote(p("one"), p("two")), p("three")]
  // bq content: p("one") at 1..6, p("two") at 6..11
  // <a> = inside p("two"), after "two" = pos 10 (end of p("two") content inside bq)
  // <b> = inside p("three"), after "three" = pos 18
  wrapTest(
    'includes half-covered parent nodes',
    schema.node('doc', {}, [blockquote(p('one'), p('two')), p('three')]),
    10, 18,
    'blockquote'
  );

  // ---- lift tests (translated from prosemirror-transform test-trans.ts) ----

  // "can lift a block out of the middle of its parent"
  // doc: [bq(p("one"), p("two"), p("three"))]
  // p("one") at bq-content positions 0..5, p("two") at 5..10
  // absolute: bq opens at 0, p("one") at 1..6, p("two") at 6..11
  // <a> = inside p("two") before 't' = pos 7
  liftTest(
    'can lift a block out of the middle of its parent',
    schema.node('doc', {}, [blockquote(p('one'), p('two'), p('three'))]),
    7, 7
  );

  // "can lift a block from the start of its parent"
  // doc: [bq(p("two"), p("three"))]
  // bq opens at 0, p("two") content starts at 2
  // <a> = pos 2
  liftTest(
    'can lift a block from the start of its parent',
    schema.node('doc', {}, [blockquote(p('two'), p('three'))]),
    2, 2
  );

  // "can lift a block from the end of its parent"
  // doc: [bq(p("one"), p("two"))]
  // p("two") starts at 6, content at 7
  // <a> = pos 7
  liftTest(
    'can lift a block from the end of its parent',
    schema.node('doc', {}, [blockquote(p('one'), p('two'))]),
    7, 7
  );

  // "can lift a single child"
  // doc: [bq(p("two"))]
  // bq opens at 0, p("two") content at 2
  // <a> = pos 2
  liftTest(
    'can lift a single child',
    schema.node('doc', {}, [blockquote(p('two'))]),
    2, 2
  );

  // "can lift multiple blocks"
  // doc: [bq(bq(p("one"), p("two")), p("three"))]
  // outer bq opens at 0, inner bq at 1..13, p("one") at 2..7, p("two") at 7..12
  // <a> = inside p("one"), after 'n' (on<a>e) = pos 5
  // <b> = inside p("two"), after 'w' (tw<b>o) = pos 10
  liftTest(
    'can lift multiple blocks',
    schema.node('doc', {}, [blockquote(blockquote(p('one'), p('two')), p('three'))]),
    5, 10
  );

  // "can lift from a list"
  // doc: [ul(li(p("one")), li(p("two")), li(p("three")))]
  // ul opens at 0, li1 at 1..8, li2 at 8..15
  //   li2 opens at 8, p("two") at 9..14, p("two") content at 10
  // <a> = inside li2's p("two") = pos 10
  liftTest(
    'can lift from a list',
    schema.node('doc', {}, [
      schema.node('bullet_list', {}, [
        li(p('one')), li(p('two')), li(p('three'))
      ])
    ]),
    10, 10
  );

  save('transform_wrap_lift', { cases });
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
generateTransformWrapLiftTests();
console.log('Done.');
