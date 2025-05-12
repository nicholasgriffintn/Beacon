"""
Type definitions for the experimentation platform.

This package contains all the type definitions used throughout the application,
organized in a logical structure to make them easier to find and maintain.
"""

# Common types
from .common import (
    AnalysisMethod,
    CorrectionMethod,
    ExperimentStatus,
    ExperimentType,
    GuardrailOperator,
    MetricType,
    TargetingType,
    UserContext,
    VariantType,
)

__all__ = [
    # Common types
    "AnalysisMethod",
    "CorrectionMethod",
    "ExperimentStatus",
    "ExperimentType",
    "GuardrailOperator",
    "MetricType",
    "TargetingType",
    "UserContext",
    "VariantType",
]
