//! Attribute step types: `AttrStep` and `DocAttrStep`.

use super::map::{Mappable, StepMap};
use serde::{Deserialize, Serialize};

/// Changes a single named attribute on the node at a given position.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttrStep {
    /// The position of the node whose attribute should be changed
    pub pos: usize,
    /// The attribute name
    pub attr: String,
    /// The new attribute value
    pub value: serde_json::Value,
}

impl AttrStep {
    /// Get the step map for this step (empty — no position shift)
    pub fn get_map(&self) -> StepMap {
        StepMap::EMPTY
    }

    /// Map this step through a mapping. Returns None if the position was deleted.
    pub fn map_step<M: Mappable>(&self, mapping: &M) -> Option<AttrStep> {
        let pos = mapping.map_result(self.pos, 1);
        if pos.deleted_after() {
            None
        } else {
            Some(AttrStep {
                pos: pos.pos,
                attr: self.attr.clone(),
                value: self.value.clone(),
            })
        }
    }
}

/// Changes a single named attribute on the document root node.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocAttrStep {
    /// The attribute name
    pub attr: String,
    /// The new attribute value
    pub value: serde_json::Value,
}

impl DocAttrStep {
    /// Get the step map for this step (empty — no position shift)
    pub fn get_map(&self) -> StepMap {
        StepMap::EMPTY
    }

    /// Map this step through a mapping. Always returns self (doc-level step).
    pub fn map_step<M: Mappable>(&self, _mapping: &M) -> Option<DocAttrStep> {
        Some(DocAttrStep {
            attr: self.attr.clone(),
            value: self.value.clone(),
        })
    }
}
