from dataclasses import dataclass
from typing import Any, Dict, List, Tuple

import numpy as np
from scipy import stats
from scipy.stats import chi2_contingency, mannwhitneyu, ttest_ind
import statsmodels.stats.power

from enum import Enum

class MetricType(str, Enum):
    """Type of metric."""

    CONTINUOUS = "continuous"
    BINARY = "binary"
    COUNT = "count"
    RATIO = "ratio"


@dataclass
class ExperimentResult:
    metric_name: str
    control_mean: float
    variant_mean: float
    relative_difference: float
    absolute_difference: float
    p_value: float
    confidence_interval: Tuple[float, float]
    sample_size: Dict[str, int]
    power: float
    is_significant: bool


class StatisticalAnalysisService:
    def __init__(self, min_sample_size: int = 100, confidence_level: float = 0.95):
        if not 0 < confidence_level < 1:
            raise ValueError("Confidence level must be between 0 and 1")
        if min_sample_size < 1:
            raise ValueError("Minimum sample size must be positive")

        self.min_sample_size = min_sample_size
        self.confidence_level = confidence_level
        self.alpha = 1 - confidence_level

    def _validate_input_data(
        self, control_data: List[float], variant_data: List[float], metric_type: MetricType
    ) -> None:
        """Validate input data based on metric type and requirements"""
        if not control_data or not variant_data:
            raise ValueError("Control and variant data cannot be empty")

        if len(control_data) < self.min_sample_size or len(variant_data) < self.min_sample_size:
            raise ValueError(f"Insufficient sample size. Minimum required: {self.min_sample_size}")

        if metric_type == MetricType.BINARY:
            if not all(x in (0, 1) for x in control_data + variant_data):
                raise ValueError("Binary metrics must contain only 0s and 1s")

        if metric_type == MetricType.COUNT:
            if not all(
                isinstance(x, (int, np.integer)) and x >= 0 for x in control_data + variant_data
            ):
                raise ValueError("Count metrics must contain non-negative integers")

        if metric_type == MetricType.RATIO:
            if not all(0 <= x <= 1 for x in control_data + variant_data):
                raise ValueError("Ratio metrics must contain values between 0 and 1")

    async def analyze_experiment(
        self,
        control_data: List[float],
        variant_data: List[float],
        metric_type: MetricType,
        metric_name: str,
        sequential: bool = False,
        stopping_threshold: float = 0.01,
    ) -> ExperimentResult:
        """Perform statistical analysis on experiment data"""
        self._validate_input_data(control_data, variant_data, metric_type)

        if sequential:
            should_stop, stats = self._check_sequential_stopping(
                control_data, variant_data, metric_type, stopping_threshold
            )
            if should_stop:
                return ExperimentResult(
                    metric_name=metric_name,
                    control_mean=float(stats["control_mean"]),
                    variant_mean=float(stats["variant_mean"]),
                    relative_difference=float(
                        ((stats["variant_mean"] - stats["control_mean"]) / stats["control_mean"])
                        * 100
                    ),
                    absolute_difference=float(stats["variant_mean"] - stats["control_mean"]),
                    p_value=float(stats["p_value"]),
                    confidence_interval=(0.0, 0.0),
                    sample_size={"control": len(control_data), "variant": len(variant_data)},
                    power=1.0,
                    is_significant=bool(stats["p_value"] < self.alpha),
                )

        control_mean = np.mean(control_data)
        variant_mean = np.mean(variant_data)
        relative_diff = ((variant_mean - control_mean) / control_mean) * 100
        absolute_diff = variant_mean - control_mean

        if metric_type == MetricType.BINARY:
            p_value = self._calculate_binary_significance(control_data, variant_data)
            ci = self._calculate_binary_confidence_interval(control_data, variant_data)
        elif metric_type == MetricType.COUNT:
            stat, p_value = mannwhitneyu(control_data, variant_data, alternative="two-sided")
            ci = self._calculate_continuous_confidence_interval(control_data, variant_data)
        elif metric_type == MetricType.RATIO:
            stat, p_value = ttest_ind(control_data, variant_data)
            ci = self._calculate_ratio_confidence_interval(control_data, variant_data)
        else:
            stat, p_value = ttest_ind(control_data, variant_data)
            ci = self._calculate_continuous_confidence_interval(control_data, variant_data)

        power = self._calculate_power(control_data, variant_data)

        return ExperimentResult(
            metric_name=metric_name,
            control_mean=float(control_mean),
            variant_mean=float(variant_mean),
            relative_difference=float(relative_diff),
            absolute_difference=float(absolute_diff),
            p_value=float(p_value),
            confidence_interval=(float(ci[0]), float(ci[1])),
            sample_size={"control": len(control_data), "variant": len(variant_data)},
            power=float(power),
            is_significant=bool(p_value < self.alpha),
        )

    def _calculate_binary_significance(
        self, control_data: List[float], variant_data: List[float]
    ) -> float:
        """Calculate significance for binary metrics using chi-square test"""
        control_success = sum(control_data)
        variant_success = sum(variant_data)

        contingency_table = np.array(
            [
                [control_success, len(control_data) - control_success],
                [variant_success, len(variant_data) - variant_success],
            ]
        )

        chi2, p_value, dof, expected = chi2_contingency(contingency_table)
        return float(p_value)

    def _calculate_binary_confidence_interval(
        self, control_data: List[float], variant_data: List[float]
    ) -> Tuple[float, float]:
        """Calculate confidence interval for binary metrics"""
        control_prop = np.mean(control_data)
        variant_prop = np.mean(variant_data)

        se = np.sqrt(
            (control_prop * (1 - control_prop) / len(control_data))
            + (variant_prop * (1 - variant_prop) / len(variant_data))
        )

        z_score = stats.norm.ppf(1 - self.alpha / 2)
        margin_error = z_score * se

        return (
            variant_prop - control_prop - margin_error,
            variant_prop - control_prop + margin_error,
        )

    def _calculate_continuous_confidence_interval(
        self, control_data: List[float], variant_data: List[float]
    ) -> Tuple[float, float]:
        """Calculate confidence interval for continuous metrics"""
        control_mean = np.mean(control_data)
        variant_mean = np.mean(variant_data)

        control_var = np.var(control_data, ddof=1)
        variant_var = np.var(variant_data, ddof=1)

        se = np.sqrt((control_var / len(control_data)) + (variant_var / len(variant_data)))

        t_score = stats.t.ppf(1 - self.alpha / 2, len(control_data) + len(variant_data) - 2)
        margin_error = t_score * se

        return (
            variant_mean - control_mean - margin_error,
            variant_mean - control_mean + margin_error,
        )

    def _calculate_power(self, control_data: List[float], variant_data: List[float]) -> float:
        """Calculate statistical power"""
        effect_size = self._cohens_d(control_data, variant_data)
        power = statsmodels.stats.power.TTestIndPower().power(
            effect_size=effect_size,
            nobs1=min(len(control_data), len(variant_data)),
            alpha=self.alpha,
        )
        return float(power)

    def _cohens_d(self, control_data: List[float], variant_data: List[float]) -> float:
        """Calculate Cohen's d effect size"""
        n1, n2 = len(control_data), len(variant_data)
        var1, var2 = np.var(control_data, ddof=1), np.var(variant_data, ddof=1)

        pooled_sd = np.sqrt(((n1 - 1) * var1 + (n2 - 1) * var2) / (n1 + n2 - 2))

        return float(abs(np.mean(control_data) - np.mean(variant_data)) / pooled_sd)

    def _calculate_ratio_confidence_interval(
        self, control_data: List[float], variant_data: List[float]
    ) -> Tuple[float, float]:
        """Calculate confidence interval for ratio metrics, ensuring bounds are [0,1]"""
        ci_low, ci_high = self._calculate_continuous_confidence_interval(control_data, variant_data)
        return (max(0.0, ci_low), min(1.0, ci_high))

    def get_recommended_duration(self, daily_samples: int, required_sample_size: int) -> int:
        """Calculate recommended experiment duration in days"""
        return int(np.ceil(required_sample_size / daily_samples))

    def estimate_mde(self, baseline_rate: float, sample_size: int, power: float = 0.8) -> float:
        """Estimate minimum detectable effect given a sample size"""
        analysis = statsmodels.stats.power.TTestIndPower()
        effect_size = analysis.solve_effect_size(nobs=sample_size, alpha=self.alpha, power=power)
        return float(effect_size * np.sqrt(baseline_rate * (1 - baseline_rate)))

    async def calculate_sample_size(
        self, baseline_rate: float, minimum_detectable_effect: float, power: float = 0.8
    ) -> int:
        """Calculate required sample size for desired statistical power"""
        effect_size = minimum_detectable_effect / np.sqrt(baseline_rate * (1 - baseline_rate))

        analysis = statsmodels.stats.power.TTestIndPower()
        sample_size = analysis.solve_power(effect_size=effect_size, power=power, alpha=self.alpha)

        return int(np.ceil(sample_size))

    def _check_sequential_stopping(
        self,
        control_data: List[float],
        variant_data: List[float],
        metric_type: MetricType,
        stopping_threshold: float,
    ) -> Tuple[bool, Dict[str, Any]]:
        """Check if sequential testing should stop early"""
        if len(control_data) < self.min_sample_size or len(variant_data) < self.min_sample_size:
            return False, {}

        if metric_type == MetricType.BINARY:
            control_mean = np.mean(control_data)
            variant_mean = np.mean(variant_data)
            pooled_p = (sum(control_data) + sum(variant_data)) / (
                len(control_data) + len(variant_data)
            )
            se = np.sqrt(
                pooled_p * (1 - pooled_p) * (1 / len(control_data) + 1 / len(variant_data))
            )
        else:
            control_mean = np.mean(control_data)
            variant_mean = np.mean(variant_data)
            pooled_std = np.sqrt(
                (
                    (len(control_data) - 1) * np.var(control_data, ddof=1)
                    + (len(variant_data) - 1) * np.var(variant_data, ddof=1)
                )
                / (len(control_data) + len(variant_data) - 2)
            )
            se = pooled_std * np.sqrt(1 / len(control_data) + 1 / len(variant_data))

        z_score = (variant_mean - control_mean) / se
        p_value = 2 * (1 - stats.norm.cdf(abs(z_score)))

        should_stop = p_value < stopping_threshold or p_value > (1 - stopping_threshold)

        return should_stop, {
            "z_score": z_score,
            "p_value": p_value,
            "control_mean": control_mean,
            "variant_mean": variant_mean,
            "standard_error": se,
        }
