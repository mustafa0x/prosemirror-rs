from __future__ import annotations

class Editor:
    """A stateful ProseMirror document editor backed by Rust.

    The schema and document live entirely in Rust memory.  Only JSON strings
    cross the Python/Rust boundary.
    """

    def __init__(self, schema_json: str, doc_json: str) -> None:
        """Create a new Editor.

        Args:
            schema_json: ProseMirror schema specification as a JSON string.
            doc_json: Initial document state as a JSON string.

        Raises:
            ValueError: If either string is not valid JSON, or the schema /
                document does not conform to the ProseMirror spec.
        """
        ...

    def apply_step(self, step_json: str) -> bool:
        """Apply a single step to the document.

        Args:
            step_json: The step as a JSON string.

        Returns:
            True if applied successfully, False if the step could not be
            applied (document is left unchanged).

        Raises:
            ValueError: If *step_json* is not valid JSON or not a recognised
                step type.
        """
        ...

    def apply_steps_json(
        self,
        steps_json: str,
        *,
        stop_on_failure: bool = True,
    ) -> list[bool]:
        """Apply a batch of steps supplied as a single JSON array string.

        Preferred method when steps arrive from a network client: the string
        is passed directly to Rust and parsed there, so nothing touches
        Python's JSON machinery.

        All steps are parsed before any are applied, so a malformed array
        raises ValueError without mutating the document.

        Args:
            steps_json: A JSON array of step objects, e.g.
                ``'[{"stepType":"replace",...},...]'``.
            stop_on_failure: When True (default) stop on the first failing
                step. When False continue applying remaining steps.

        Returns:
            A list of booleans — one per step — indicating success (True) or
            failure (False).

        Raises:
            ValueError: If *steps_json* is not a valid JSON array of steps.
        """
        ...

    def apply_steps(
        self,
        steps: list[str],
        *,
        stop_on_failure: bool = True,
    ) -> list[bool]:
        """Apply a batch of steps from a Python list of JSON strings.

        Use this when steps are constructed or modified in Python.  For steps
        arriving directly from a network client prefer :meth:`apply_steps_json`
        to avoid unnecessary Python-level JSON parsing.

        All steps are parsed before any are applied, so a bad JSON string
        raises ValueError without mutating the document.

        Args:
            steps: A list where each element is a JSON string for one step.
            stop_on_failure: Same semantics as in :meth:`apply_steps_json`.

        Returns:
            A list of booleans — one per step — indicating success.

        Raises:
            ValueError: If any element is not valid step JSON.
        """
        ...

    def doc_json(self) -> str:
        """Serialize the current document to a JSON string.

        Serialization happens entirely in Rust; only the resulting string is
        passed to Python.  Suitable for saving directly to a database without
        creating any intermediate Python dicts or lists.

        Returns:
            The current document as a compact JSON string.
        """
        ...

    @property
    def version(self) -> int:
        """Number of steps successfully applied since construction.

        Use as a document version counter in collaborative-editing protocols.
        """
        ...
