"""Unreleased candidate APIs; never complete v1 validation."""
import sys

# Permit the CLI bootstrap to report an unsupported runtime without importing
# modules whose annotation syntax needs the declared Python floor.
__all__ = []
if sys.version_info >= (3, 11):
    from .candidate import CandidateResult, Finding, check_candidate
    from .validation import DeclarationResult, TreeEntry, TreeSnapshot, check_declaration
    from .acquire import ObservationResult, observe_repository

    __all__ = [
        "CandidateResult", "Finding", "check_candidate", "DeclarationResult",
        "TreeEntry", "TreeSnapshot", "check_declaration", "ObservationResult",
        "observe_repository",
    ]
