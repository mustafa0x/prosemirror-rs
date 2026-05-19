//! Runtime-loadable dynamic schema support.
//!
//! This module provides the ability to load a ProseMirror schema from a JSON
//! `SchemaSpec` at runtime, rather than defining it at compile time through Rust
//! types.

pub mod content_expr;
pub mod schema;
pub mod types;

pub use content_expr::ContentExpr;
pub use schema::{DynamicSchema, DynamicSchemaError};
pub use types::{DynamicMark, DynamicMarkType, DynamicNode, DynamicNodeType};
