"""
Common enum definitions used throughout the application.
"""

from enum import Enum

class MetricType(str, Enum):
    """Type of metric."""

    CONTINUOUS = "continuous"
    BINARY = "binary"
    COUNT = "count"
    RATIO = "ratio"
