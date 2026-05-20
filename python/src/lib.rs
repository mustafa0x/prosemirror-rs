use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;
use prosemirror::dynamic::types::Dyn;
use prosemirror::dynamic::{DynamicNode, DynamicSchema};
use prosemirror::transform::Step;

/// A stateful ProseMirror document editor backed by Rust.
///
/// The schema and document state live entirely in Rust memory. Only JSON
/// strings cross the Python/Rust boundary, keeping data-transfer overhead
/// to the absolute minimum for each operation:
///
/// * Steps arrive as a JSON string → parsed in Rust → applied in Rust.
/// * The document is serialized in Rust → returned as a plain Python ``str``.
#[pyclass(module = "prosemirror_rs")]
struct Editor {
    schema: DynamicSchema,
    doc: DynamicNode,
    version: usize,
}

#[pymethods]
impl Editor {
    /// Create a new Editor.
    ///
    /// :param schema_json: ProseMirror schema specification as a JSON string.
    /// :param doc_json: Initial document state as a JSON string.
    /// :raises ValueError: If either string is not valid JSON, or the schema /
    ///     document does not conform to the ProseMirror spec.
    #[new]
    #[pyo3(signature = (schema_json, doc_json))]
    fn new(schema_json: &str, doc_json: &str) -> PyResult<Self> {
        let schema_val: serde_json::Value = serde_json::from_str(schema_json)
            .map_err(|e| PyValueError::new_err(format!("Invalid schema JSON: {e}")))?;
        let schema = DynamicSchema::from_json(&schema_val)
            .map_err(|e| PyValueError::new_err(format!("Invalid schema: {e}")))?;

        let doc_val: serde_json::Value = serde_json::from_str(doc_json)
            .map_err(|e| PyValueError::new_err(format!("Invalid document JSON: {e}")))?;
        let doc = schema
            .node_from_json(&doc_val)
            .map_err(|e| PyValueError::new_err(format!("Invalid document: {e}")))?;

        Ok(Editor { schema, doc, version: 0 })
    }

    /// Apply a single step to the document.
    ///
    /// :param step_json: The step as a JSON string.
    /// :returns: ``True`` if applied successfully, ``False`` if the step could
    ///     not be applied (document is left unchanged).
    /// :raises ValueError: If *step_json* is not valid JSON or not a
    ///     recognised step type.
    fn apply_step(&mut self, step_json: &str) -> PyResult<bool> {
        // Borrow schema and doc immutably inside a scope, so that we can
        // mutate self.doc afterwards without a borrow-checker conflict.
        let result = {
            let schema = &self.schema;
            let doc = &self.doc;
            schema.with_types(|| -> PyResult<Option<DynamicNode>> {
                let step: Step<Dyn> = serde_json::from_str(step_json)
                    .map_err(|e| PyValueError::new_err(format!("Invalid step JSON: {e}")))?;
                Ok(step.apply(doc).ok())
            })
        }?;

        if let Some(new_doc) = result {
            self.doc = new_doc;
            self.version += 1;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    /// Apply a batch of steps supplied as a single JSON array string.
    ///
    /// **This is the preferred method when steps arrive from a network client.**
    /// The entire string is handed to Rust and parsed there in one pass — no
    /// Python JSON machinery is involved, and no intermediate Python objects
    /// are created.
    ///
    /// All steps are parsed before any are applied, so a malformed JSON array
    /// raises ``ValueError`` without mutating the document.
    ///
    /// :param steps_json: A JSON array of step objects, e.g.
    ///     ``'[{"stepType":"replace",...},...]'``.
    /// :param stop_on_failure: When ``True`` (default) stop on the first step
    ///     that fails to apply and leave the document at the state before that
    ///     step.  When ``False`` continue applying remaining steps regardless.
    /// :returns: A list of booleans — one per step — indicating success.
    /// :raises ValueError: If *steps_json* is not a valid JSON array of steps.
    #[pyo3(signature = (steps_json, *, stop_on_failure = true))]
    fn apply_steps_json(
        &mut self,
        steps_json: &str,
        stop_on_failure: bool,
    ) -> PyResult<Vec<bool>> {
        // Phase 1: parse the whole array in one with_types scope.
        let steps: Vec<Step<Dyn>> = {
            let schema = &self.schema;
            schema.with_types(|| {
                serde_json::from_str(steps_json)
                    .map_err(|e| PyValueError::new_err(format!("Invalid steps JSON: {e}")))
            })?
        };

        // Phase 2: apply each step; with_types overhead per step is a single
        // thread-local read, which is negligible.
        let mut results = Vec::with_capacity(steps.len());
        for step in steps {
            let result = {
                let schema = &self.schema;
                let doc = &self.doc;
                schema.with_types(|| step.apply(doc))
            };
            match result {
                Ok(new_doc) => {
                    self.doc = new_doc;
                    self.version += 1;
                    results.push(true);
                }
                Err(_) => {
                    results.push(false);
                    if stop_on_failure {
                        break;
                    }
                }
            }
        }
        Ok(results)
    }

    /// Apply a batch of steps from a Python list of JSON strings.
    ///
    /// Use this when steps are constructed or modified in Python (e.g.
    /// programmatically building a step dict and calling ``json.dumps``).
    /// For steps that arrive directly from a network client prefer
    /// :meth:`apply_steps_json` to avoid unnecessary Python-level parsing.
    ///
    /// All steps are parsed before any are applied, so a bad JSON string
    /// raises ``ValueError`` without mutating the document.
    ///
    /// :param steps: A list where each element is a JSON string for one step.
    /// :param stop_on_failure: Same semantics as in :meth:`apply_steps_json`.
    /// :returns: A list of booleans — one per step — indicating success.
    /// :raises ValueError: If any element is not valid step JSON.
    #[pyo3(signature = (steps, *, stop_on_failure = true))]
    fn apply_steps(
        &mut self,
        steps: Vec<String>,
        stop_on_failure: bool,
    ) -> PyResult<Vec<bool>> {
        // Parse all steps up-front so that a bad step raises ValueError
        // before any mutation takes place.
        let parsed: Vec<Step<Dyn>> = {
            let schema = &self.schema;
            schema.with_types(|| {
                steps
                    .iter()
                    .map(|s| {
                        serde_json::from_str::<Step<Dyn>>(s)
                            .map_err(|e| PyValueError::new_err(format!("Invalid step JSON: {e}")))
                    })
                    .collect::<PyResult<Vec<_>>>()
            })?
        };

        let mut results = Vec::with_capacity(parsed.len());
        for step in parsed {
            let result = {
                let schema = &self.schema;
                let doc = &self.doc;
                schema.with_types(|| step.apply(doc))
            };
            match result {
                Ok(new_doc) => {
                    self.doc = new_doc;
                    self.version += 1;
                    results.push(true);
                }
                Err(_) => {
                    results.push(false);
                    if stop_on_failure {
                        break;
                    }
                }
            }
        }
        Ok(results)
    }

    /// Serialize the current document to a JSON string.
    ///
    /// Serialization happens entirely in Rust; only the resulting string is
    /// passed to Python.  This makes the method suitable for saving the
    /// document directly to a database without creating any intermediate
    /// Python dicts or lists.
    ///
    /// :returns: The document as a compact JSON string.
    fn doc_json(&self) -> PyResult<String> {
        // DynamicNode::serialize only reads stored data and does not need the
        // thread-local type store, so no with_types wrapper is required here.
        serde_json::to_string(&self.doc)
            .map_err(|e| PyValueError::new_err(format!("Serialization error: {e}")))
    }

    /// Number of steps successfully applied since construction.
    ///
    /// Use as a document version counter in collaborative-editing protocols.
    #[getter]
    fn version(&self) -> usize {
        self.version
    }
}

/// Python bindings for prosemirror-rs.
///
/// Provides a memory- and CPU-efficient interface to ProseMirror's document
/// model and transform pipeline.  Document state lives entirely in Rust; only
/// JSON strings cross the Python/Rust boundary.
#[pymodule]
fn prosemirror_rs(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_class::<Editor>()?;
    Ok(())
}
