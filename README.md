# prosemirror-rs

A Rust implementation of [ProseMirror](https://prosemirror.net)'s core modules,
providing document model, transforms, and a runtime-loadable schema system.

This crate implements the same functionality as:

- [`prosemirror-model`](https://github.com/ProseMirror/prosemirror-model) — document model, nodes, fragments, marks, resolved positions, content matching, slicing, replacing
- [`prosemirror-transform`](https://github.com/ProseMirror/prosemirror-transform) — step types, position mapping, the `Transform` builder, structure utilities, smart replace

The canonical references are the **JavaScript** source (primary) and **Python** port
(secondary). The Rust implementation aims to produce identical results.

## Quick start

### Add to your project

```toml
[dependencies]
prosemirror = { path = "../prosemirror-rs" }
serde_json = "1"
```

Or from crates.io (when published):

```toml
[dependencies]
prosemirror = "0.2"
serde_json = "1"
```

### Build from source

```bash
git clone <repo-url>
cd prosemirror-rs
cargo build          # debug build
cargo build --release # optimized build
```

### Run the tests

```bash
# Run all Rust tests (library + integration)
cargo test

# Run only the library unit tests
cargo test --lib

# Run a specific test
cargo test test_resolve
```

## Architecture

The crate has three main modules:

### `model` — Document model

Core data structures for representing ProseMirror documents:

| Type | Description |
|------|-------------|
| `Node<S>` trait | A document node (element, text, or leaf) |
| `Fragment<S>` | An ordered collection of child nodes |
| `Mark<S>` / `MarkSet<S>` | Inline formatting (bold, italic, etc.) |
| `ResolvedPos<S>` | A position resolved against a document tree |
| `NodeRange<S>` | A range between two resolved positions at a given depth |
| `Slice<S>` | A piece of document content with open boundaries |
| `ContentMatch<S>` trait | DFA-based content expression matching |
| `NodeType<S>` trait | Type descriptor for a node kind |
| `Schema` trait | Defines the full set of node types, mark types, and content rules |

### `transform` — Document transformations

| Type | Description |
|------|-------------|
| `Step<S>` enum | A single atomic change (replace, add-mark, remove-mark, attr, etc.) |
| `StepMap` / `Mapping` | Position offset maps for tracking changes |
| `Transform<S>` | Builder that accumulates steps and tracks the document |
| `replace_step()` | Smart replace algorithm (the "Fitter") |
| `can_split()`, `can_join()`, `lift_target()`, `find_wrapping()` | Structure analysis |
| `join_point()`, `insert_point()`, `drop_point()` | Position finding |

### `dynamic` — Runtime schema from JSON

Load a ProseMirror schema at runtime from a JSON `SchemaSpec`, the same format
used by the JavaScript and Python implementations:

```rust
use prosemirror::dynamic::DynamicSchema;
use prosemirror::model::Node;

let schema_json = serde_json::json!({
    "nodes": {
        "doc":       { "content": "block+" },
        "paragraph": { "content": "inline*", "group": "block" },
        "heading":   { "attrs": { "level": { "default": 1 } },
                       "content": "inline*", "group": "block" },
        "text":      { "group": "inline" }
    },
    "marks": {
        "strong": {},
        "em": {}
    }
});

let schema = DynamicSchema::from_json(&schema_json).unwrap();

// All dynamic operations must run inside with_types()
schema.with_types(|| {
    let doc = schema.node_from_json(&serde_json::json!({
        "type": "doc",
        "content": [{
            "type": "heading",
            "attrs": { "level": 1 },
            "content": [{ "type": "text", "text": "Hello" }]
        }]
    })).unwrap();

    assert_eq!(doc.text_content(), "Hello");
    assert_eq!(doc.child_count(), 1);

    // Serialize back to JSON
    let json = serde_json::to_value(&doc).unwrap();
});
```

## Step types

The `Step<S>` enum supports all step types from the JS/Python implementations:

| Variant | JS class | Description |
|---------|----------|-------------|
| `Replace` | `ReplaceStep` | Replace a range with a slice |
| `ReplaceAround` | `ReplaceAroundStep` | Replace while preserving structure |
| `AddMark` | `AddMarkStep` | Add a mark to an inline range |
| `RemoveMark` | `RemoveMarkStep` | Remove a mark from an inline range |
| `AddNodeMark` | `AddNodeMarkStep` | Add a mark to a specific node |
| `RemoveNodeMark` | `RemoveNodeMarkStep` | Remove a mark from a specific node |
| `Attr` | `AttrStep` | Set an attribute on a node |
| `DocAttr` | `DocAttrStep` | Set an attribute on the document root |

Each step type supports:

- `apply(doc)` — apply the step to produce a new document
- `get_map()` — return the `StepMap` describing position changes
- `invert(doc)` — return the inverse step (for undo)
- `map(mapping)` — map the step through a position mapping
- `merge(other)` — attempt to combine with an adjacent step

## Position mapping

```rust
use prosemirror::transform::{StepMap, Mapping, Mappable};

// Insert 4 characters at position 2
let insert = StepMap::new(vec![2, 0, 4]);
assert_eq!(insert.map(0, 1), 0);  // before insertion: unchanged
assert_eq!(insert.map(3, 1), 7);  // after insertion: shifted by 4

// Compose multiple maps
let mut mapping = Mapping::new();
mapping.append_map(StepMap::new(vec![2, 0, 4]), None);
mapping.append_map(StepMap::new(vec![10, 3, 0]), None);
assert_eq!(mapping.map(0, 1), 0);
assert_eq!(mapping.map(3, 1), 7);
```

## The Transform builder

```rust
use prosemirror::transform::Transform;
// Use with a concrete schema (see dynamic module example)
```

`Transform<S>` accumulates document changes:

- `replace(from, to, slice)` — low-level replace
- `delete(from, to)` — delete a range
- `insert(pos, content)` — insert content
- `add_mark(from, to, mark)` — add a mark
- `remove_mark(from, to, mark)` — remove a mark
- `split(pos, depth, types_after)` — split a node
- `join(pos, depth)` — join adjacent nodes
- `lift(range, target)` — lift content out of a wrapper
- `wrap(range, wrappers)` — wrap content in nodes
- `set_block_type(from, to, type, attrs)` — change block type
- `set_node_markup(pos, type, attrs, marks)` — change a node's markup
- `set_node_attribute(pos, attr, value)` — set a single attribute
- `set_doc_attribute(attr, value)` — set a document attribute

## Content expressions

Content expressions like `"block+"`, `"inline*"`, `"paragraph block*"` are
parsed at runtime into a DFA (deterministic finite automaton):

```rust
use prosemirror::dynamic::content_expr::ContentExpr;
use std::collections::HashMap;

let groups = HashMap::from([
    ("block".to_string(), vec!["paragraph".to_string(), "heading".to_string()]),
    ("inline".to_string(), vec!["text".to_string()]),
]);

let expr = ContentExpr::parse("block+", &groups).unwrap();
assert!(!expr.valid_end(0));          // needs at least one block
assert!(expr.match_type(0, "paragraph").is_some());
let s1 = expr.match_type(0, "paragraph").unwrap();
assert!(expr.valid_end(s1));          // one block = valid end
```

Supported syntax: `*`, `+`, `?`, `{n}`, `{n,m}`, `{n,}`, `|`, `()`, group
references, and node type names.

## Testing

The test suite is structured as:

1. **Library unit tests** (`cargo test --lib`) — 44 tests covering model internals,
   transform operations, content expression parsing, and dynamic schema loading.

2. **Integration tests** (`tests/`) — Ported from the JS and Python test suites:

   - `tests/test_resolve.rs` — 9 tests from `prosemirror-model/test/test-resolve.ts`
   - `tests/test_mapping.rs` — 11 tests from `prosemirror-transform/test/test-mapping.ts`

3. **Python-generated fixtures** (`tests/spec/`) — A Python script that uses
   `prosemirror-py` to generate expected JSON outputs. These can be consumed
   by Rust tests for cross-implementation validation:

   ```bash
   # Generate fixtures using prosemirror-py
   cd ../prosemirror-py
   python ../prosemirror-rs/tests/spec/generate_fixtures.py
   ```

   Generated JSON files in `tests/spec/expected/`:
   - `mapping.json` — StepMap/Mapping test cases
   - `step_merge.json` — Step merge test cases
   - `transform_marks.json` — addMark/removeMark test cases
   - `transform_edit.json` — insert/delete test cases
   - `transform_structure.json` — split test cases
   - `replace.json` — Replace test cases
   - `model.json` — Slice/size/textContent test cases
   - `resolve.json` — ResolvedPos test cases
   - `roundtrip.json` — JSON round-trip test cases

## Feature flags

| Feature | Default | Description |
|---------|---------|-------------|
| `cmark` | no | CommonMark parsing/serialization via `pulldown-cmark` |

## Differences from JS/Python

- **Compile-time schema support** — The `Schema` trait and associated types
  allow zero-cost abstraction over schemas defined as Rust types. The
  `dynamic` module provides the runtime-loadable equivalent.
- **UTF-16 position tracking** — Like JavaScript, positions are counted in
  UTF-16 code units. The `Text` type tracks both UTF-8 and UTF-16 lengths.
- **No DOM parsing/serialization** — Server-side crate; HTML round-trip is
  not included.

## Releasing a new version

Before tagging a release, bump the version number in **all three** of these
files to the same new version string (e.g. `0.3.0`):

| File | Key |
|------|-----|
| [`Cargo.toml`](Cargo.toml) | `[package] version` — the Rust crate published to crates.io |
| [`python/Cargo.toml`](python/Cargo.toml) | `[package] version` — the native extension built by maturin |
| [`python/pyproject.toml`](python/pyproject.toml) | `[project] version` — the Python package published to PyPI |
| [`node/Cargo.toml`](node/Cargo.toml) | `[package] version` — the native extension built by cargo |
| [`node/package.json`](node/package.json) | `version` — the npm package published to npm |

All five must be kept in sync; mismatches will cause the published artefacts
to report different version numbers.

Once the files are updated and committed, push an annotated tag to trigger
the publish workflow:

```bash
git tag v0.3.0
git push origin v0.3.0
```

## Credits

This crate was originally created by **Daniel Seiler**
([Xiphoseer](https://github.com/Xiphoseer), <me@dseiler.eu>), who designed and
implemented the document model, transform pipeline, and runtime schema system.
The project is now maintained by
**Johannes Wilm** ([FidusWriter](https://github.com/fiduswriter),
<johannes@fiduswriter.org>).

The ProseMirror data model and step format are the work of
**Marijn Haverbeke** and the ProseMirror contributors. See
[prosemirror.net](https://prosemirror.net) for the upstream project.

## License

MIT — see [LICENSE](LICENSE).

Copyright 2026 Johannes Wilm  
Copyright 2020 Daniel Seiler  
Copyright 2015–2026 Marijn Haverbeke and others
