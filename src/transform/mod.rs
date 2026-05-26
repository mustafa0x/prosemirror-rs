//! # The document transformations
//!
mod attr_step;
pub mod map;
mod mark_step;
mod node_mark_step;
mod replace;
mod replace_step;
mod step;
pub mod structure;
#[allow(clippy::module_inception)]
pub mod transform;

pub use attr_step::{AttrStep, DocAttrStep};
pub use map::{MapResult, Mappable, Mapping, StepMap};
pub use mark_step::{AddMarkStep, RemoveMarkStep};
pub use node_mark_step::{AddNodeMarkStep, RemoveNodeMarkStep};
pub use replace::{close_fragment, covered_depths, replace_step as smart_replace_step};
pub use replace_step::{ReplaceAroundStep, ReplaceStep};
pub use step::{StepError, StepKind, StepResult};
pub use transform::Transform;
pub use util::Span;

mod util;

use crate::model::Schema;
use derivative::Derivative;
use serde::{Deserialize, Serialize};

/// A list of steps
#[allow(type_alias_bounds)]
pub type Steps<S: Schema> = Vec<Step<S>>;

/// Steps that can be applied on a document
#[derive(Derivative, Deserialize, Serialize)]
#[derivative(
    Debug(bound = ""),
    PartialEq(bound = ""),
    Eq(bound = ""),
    Clone(bound = "")
)]
#[serde(bound = "", tag = "stepType", rename_all = "camelCase")]
pub enum Step<S: Schema> {
    /// Replace some content
    Replace(ReplaceStep<S>),
    /// Replace around some content
    ReplaceAround(ReplaceAroundStep<S>),
    /// Add a mark to a span
    AddMark(AddMarkStep<S>),
    /// Remove a mark from a span
    RemoveMark(RemoveMarkStep<S>),
    /// Add a mark to a node
    AddNodeMark(AddNodeMarkStep<S>),
    /// Remove a mark from a node
    RemoveNodeMark(RemoveNodeMarkStep<S>),
    /// Set an attribute on a node
    #[serde(rename = "attr")]
    Attr(AttrStep),
    /// Set an attribute on the document root
    #[serde(rename = "docAttr")]
    DocAttr(DocAttrStep),
}

impl<S: Schema> Step<S> {
    /// Apply the step to the given node
    pub fn apply(&self, doc: &S::Node) -> StepResult<S> {
        match self {
            Self::Replace(r_step) => r_step.apply(doc),
            Self::ReplaceAround(ra_step) => ra_step.apply(doc),
            Self::AddMark(am_step) => am_step.apply(doc),
            Self::RemoveMark(rm_step) => rm_step.apply(doc),
            Self::AddNodeMark(anm_step) => anm_step.apply(doc),
            Self::RemoveNodeMark(rnm_step) => rnm_step.apply(doc),
            Self::Attr(_) | Self::DocAttr(_) => Err(StepError::NoNodeAtPosition),
        }
    }

    /// Get the step map for this step
    pub fn get_map(&self) -> StepMap {
        match self {
            Self::Replace(r_step) => r_step.get_map(),
            Self::ReplaceAround(ra_step) => ra_step.get_map(),
            Self::AddMark(am_step) => am_step.get_map(),
            Self::RemoveMark(rm_step) => rm_step.get_map(),
            Self::AddNodeMark(anm_step) => anm_step.get_map(),
            Self::RemoveNodeMark(rnm_step) => rnm_step.get_map(),
            Self::Attr(a_step) => a_step.get_map(),
            Self::DocAttr(da_step) => da_step.get_map(),
        }
    }

    /// Get the inverse of this step
    pub fn invert(&self, doc: &S::Node) -> Step<S> {
        match self {
            Self::Replace(r_step) => r_step.invert(doc),
            Self::ReplaceAround(ra_step) => ra_step.invert(doc),
            Self::AddMark(am_step) => am_step.invert(doc),
            Self::RemoveMark(rm_step) => rm_step.invert(doc),
            Self::AddNodeMark(anm_step) => anm_step.invert(doc),
            Self::RemoveNodeMark(rnm_step) => rnm_step.invert(doc),
            other => other.clone(),
        }
    }

    /// Map this step through a mapping
    pub fn map<M: Mappable>(&self, mapping: &M) -> Option<Step<S>> {
        match self {
            Self::Replace(r_step) => r_step.map(mapping),
            Self::ReplaceAround(ra_step) => ra_step.map(mapping),
            Self::AddMark(am_step) => am_step.map(mapping),
            Self::RemoveMark(rm_step) => rm_step.map(mapping),
            Self::AddNodeMark(anm_step) => anm_step.map(mapping),
            Self::RemoveNodeMark(rnm_step) => rnm_step.map(mapping),
            Self::Attr(a_step) => a_step.map_step(mapping).map(Step::Attr),
            Self::DocAttr(da_step) => da_step.map_step(mapping).map(Step::DocAttr),
        }
    }

    /// Try to merge this step with another
    pub fn merge(&self, other: &Step<S>) -> Option<Step<S>> {
        match self {
            Self::Replace(r_step) => r_step.merge(other),
            Self::ReplaceAround(ra_step) => ra_step.merge(other),
            Self::AddMark(am_step) => am_step.merge(other),
            Self::RemoveMark(rm_step) => rm_step.merge(other),
            Self::AddNodeMark(anm_step) => anm_step.merge(other),
            Self::RemoveNodeMark(rnm_step) => rnm_step.merge(other),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dynamic::types::Dyn;
    use crate::dynamic::DynamicSchema;
    use crate::model::{Fragment, Slice};

    fn basic_schema() -> DynamicSchema {
        DynamicSchema::from_json(&serde_json::json!({
            "nodes": {
                "doc": { "content": "block+" },
                "paragraph": { "content": "inline*", "group": "block" },
                "blockquote": { "content": "block+", "group": "block" },
                "heading": { "attrs": { "level": { "default": 1 } }, "content": "inline*", "group": "block" },
                "text": { "group": "inline" },
                "image": { "inline": true, "attrs": { "src": {}, "alt": { "default": null } }, "group": "inline", "atom": true },
                "hard_break": { "inline": true, "group": "inline" }
            },
            "marks": { "strong": {}, "em": {} }
        })).unwrap()
    }

    #[test]
    fn test_attr_step_serialize() {
        let s: Step<Dyn> =
            serde_json::from_str(r#"{"stepType":"attr","pos":1,"attr":"level","value":2}"#)
                .unwrap();
        match &s {
            Step::Attr(a) => {
                assert_eq!(a.pos, 1);
                assert_eq!(a.attr, "level");
            }
            _ => panic!("Expected Attr variant"),
        }
    }

    #[test]
    fn test_doc_attr_step_serialize() {
        let s: Step<Dyn> =
            serde_json::from_str(r#"{"stepType":"docAttr","attr":"title","value":"hello"}"#)
                .unwrap();
        match &s {
            Step::DocAttr(d) => {
                assert_eq!(d.attr, "title");
            }
            _ => panic!("Expected DocAttr variant"),
        }
    }

    #[test]
    fn test_step_get_map() {
        let schema = basic_schema();
        schema.with_types(|| {
            let text_node = schema.text("abc");
            let s = Step::Replace::<Dyn>(ReplaceStep {
                span: Span { from: 5, to: 10 },
                slice: Slice::new(Fragment::from(vec![text_node]), 0, 0),
                structure: false,
            });
            let map = s.get_map();
            assert_eq!(map.ranges, vec![5, 5, 3]);
        });
    }

    #[test]
    fn replace_step_get_map_uses_open_slice_size() {
        let schema = basic_schema();
        schema.with_types(|| {
            let paragraph = schema
                .node_from_json(&serde_json::json!({
                    "type": "paragraph",
                    "content": [{"type": "text", "text": "abc"}]
                }))
                .unwrap();
            let s = Step::Replace::<Dyn>(ReplaceStep {
                span: Span { from: 5, to: 10 },
                slice: Slice::new(Fragment::from(vec![paragraph]), 1, 1),
                structure: false,
            });
            let map = s.get_map();
            assert_eq!(map.ranges, vec![5, 5, 3]);
        });
    }

    #[test]
    fn test_step_map_through_mapping() {
        let schema = basic_schema();
        schema.with_types(|| {
            let text_node = schema.text("abc");
            let s = Step::Replace::<Dyn>(ReplaceStep {
                span: Span { from: 5, to: 10 },
                slice: Slice::new(Fragment::from(vec![text_node]), 0, 0),
                structure: false,
            });
            let mut mapping = Mapping::new();
            mapping.append_map(StepMap::new(vec![0, 0, 3]), None);
            let mapped = s.map(&mapping).unwrap();
            match mapped {
                Step::Replace(r) => {
                    assert_eq!(r.span.from, 8);
                    assert_eq!(r.span.to, 13);
                }
                _ => panic!("Expected Replace variant"),
            }
        });
    }

    #[test]
    fn test_add_mark_step_serialize() {
        let s: Step<Dyn> =
            serde_json::from_str(r#"{"stepType":"addMark","mark":{"type":"em"},"from":1,"to":5}"#)
                .unwrap();
        match &s {
            Step::AddMark(am) => {
                assert_eq!(am.span.from, 1);
                assert_eq!(am.span.to, 5);
            }
            _ => panic!("Expected AddMark variant"),
        }
    }

    #[test]
    fn test_replace_step_serialize() {
        let s: Step<Dyn> = serde_json::from_str(
            r#"{"stepType":"replace","from":3,"to":5,"slice":{"content":[{"type":"text","text":"hi"}]}}"#,
        ).unwrap();
        match &s {
            Step::Replace(r) => {
                assert_eq!(r.span.from, 3);
                assert_eq!(r.span.to, 5);
            }
            _ => panic!("Expected Replace variant"),
        }
    }
}
