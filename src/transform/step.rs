use crate::model::{InsertError, ReplaceError, ResolveErr, Schema, SliceError};
use derivative::Derivative;
use displaydoc::Display;
use thiserror::Error;

use super::map::{Mappable, StepMap};

/// Different ways a step application can fail
#[derive(Derivative, Display, Error)]
#[derivative(Debug(bound = ""))]
pub enum StepError<S: Schema> {
    /// Structure replace would overwrite content
    WouldOverwrite,
    /// Structure gap-replace would overwrite content
    GapWouldOverwrite,
    /// Gap is not a flat range
    GapNotFlat,
    /// Content does not fit in gap
    GapNotFit,
    /// Invalid indices
    Resolve(#[from] ResolveErr),
    /// Invalid resolve
    Replace(#[from] ReplaceError<S>),
    /// Invalid slice
    Slice(#[from] SliceError),
    /// Insert error
    Insert(#[from] InsertError),
    /// No node at the step's position
    NoNodeAtPosition,
    /// Invalid attribute value
    InvalidAttr(String),
}

/// The result of [applying](#transform.Step.apply) a step. Contains either a
/// new document or a failure value.
#[allow(type_alias_bounds)]
pub type StepResult<S: Schema> = Result<S::Node, StepError<S>>;

/// A step object represents an atomic change.
///
/// It generally applies only to the document it was created for, since the positions
/// stored in it will only make sense for that document.
pub trait StepKind<S: Schema> {
    /// Applies this step to the given document, returning a result
    /// object that either indicates failure, if the step can not be
    /// applied to this document, or indicates success by containing a
    /// transformed document.
    fn apply(&self, doc: &S::Node) -> StepResult<S>;

    /// Returns the `StepMap` describing the position offset caused by this step.
    /// Default implementation returns an empty map.
    fn get_map(&self) -> StepMap {
        StepMap::EMPTY
    }

    /// Returns the inverse of this step as applied to the document before the step.
    fn invert(&self, doc: &S::Node) -> super::Step<S>;

    /// Maps this step through a mapping. Returns `None` if the step was
    /// rendered invalid (e.g. its target position was deleted).
    fn map<M: Mappable>(&self, mapping: &M) -> Option<super::Step<S>>;

    /// Attempts to merge this step with another step. Returns `None` if they
    /// cannot be merged.
    fn merge(&self, _other: &super::Step<S>) -> Option<super::Step<S>> {
        None
    }
}
