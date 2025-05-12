from typing import Any, Dict, List, Tuple

import numpy as np

from enum import Enum

class MetricType(str, Enum):
    """Type of metric."""

    CONTINUOUS = "continuous"
    BINARY = "binary"
    COUNT = "count"
    RATIO = "ratio"


class BayesianAnalysisService:
    def __init__(
        self, prior_successes: int = 30, prior_trials: int = 100, num_samples: int = 10000
    ):
        self.prior_successes = prior_successes
        self.prior_trials = prior_trials
        self.num_samples = num_samples

    def analyze_binary_metric(
        self,
        control_data: List[float],
        variant_data: List[float],
    ) -> Dict[str, Any]:
        """Perform Bayesian analysis for binary metrics"""
        control_success = sum(control_data)
        control_trials = len(control_data)
        variant_success = sum(variant_data)
        variant_trials = len(variant_data)

        control_posterior = np.random.beta(
            control_success + self.prior_successes,
            control_trials - control_success + self.prior_trials - self.prior_successes,
            size=self.num_samples,
        )
        variant_posterior = np.random.beta(
            variant_success + self.prior_successes,
            variant_trials - variant_success + self.prior_trials - self.prior_successes,
            size=self.num_samples,
        )

        prob_improvement = np.mean(variant_posterior > control_posterior)
        expected_lift = np.mean((variant_posterior - control_posterior) / control_posterior * 100)

        lift_samples = (variant_posterior - control_posterior) / control_posterior * 100
        credible_interval = np.percentile(lift_samples, [2.5, 97.5])

        return {
            "probability_of_improvement": prob_improvement,
            "expected_lift": expected_lift,
            "credible_interval": tuple(credible_interval),
            "control_rate": float(np.mean(control_posterior)),
            "variant_rate": float(np.mean(variant_posterior)),
            "sample_size": {"control": control_trials, "variant": variant_trials},
        }

    def analyze_continuous_metric(
        self,
        control_data: List[float],
        variant_data: List[float],
    ) -> Dict[str, Any]:
        """Perform Bayesian analysis for continuous metrics using normal approximation"""
        control_mean = np.mean(control_data)
        control_std = np.std(control_data, ddof=1)
        variant_mean = np.mean(variant_data)
        variant_std = np.std(variant_data, ddof=1)

        control_posterior = np.random.normal(
            control_mean, control_std / np.sqrt(len(control_data)), size=self.num_samples
        )
        variant_posterior = np.random.normal(
            variant_mean, variant_std / np.sqrt(len(variant_data)), size=self.num_samples
        )

        prob_improvement = np.mean(variant_posterior > control_posterior)
        relative_lift = (variant_posterior - control_posterior) / np.abs(control_posterior) * 100
        expected_lift = np.mean(relative_lift)

        credible_interval = np.percentile(relative_lift, [2.5, 97.5])

        return {
            "probability_of_improvement": prob_improvement,
            "expected_lift": expected_lift,
            "credible_interval": tuple(credible_interval),
            "control_mean": float(control_mean),
            "variant_mean": float(variant_mean),
            "sample_size": {"control": len(control_data), "variant": len(variant_data)},
        }

    def _check_sequential_stopping(
        self,
        control_data: List[float],
        variant_data: List[float],
        metric_type: MetricType,
        stopping_threshold: float,
    ) -> Tuple[bool, Dict[str, Any]]:
        """Check if sequential testing should stop early using Bayesian criteria"""
        if metric_type == MetricType.BINARY:
            results = self.analyze_binary_metric(control_data, variant_data)
        else:
            results = self.analyze_continuous_metric(control_data, variant_data)

        prob_improvement = results["probability_of_improvement"]

        should_stop = (
            prob_improvement > (1 - stopping_threshold) or prob_improvement < stopping_threshold
        )

        return should_stop, {
            "probability_of_improvement": prob_improvement,
            "expected_lift": results["expected_lift"],
            "control_mean": results.get("control_mean", results.get("control_rate")),
            "variant_mean": results.get("variant_mean", results.get("variant_rate")),
        }

    def analyze_experiment(
        self,
        control_data: List[float],
        variant_data: List[float],
        metric_type: MetricType,
        metric_name: str,
        sequential: bool = False,
        stopping_threshold: float = 0.01,
    ) -> Dict[str, Any]:
        """Perform Bayesian analysis based on metric type with optional sequential testing"""
        if sequential and stopping_threshold is not None:
            should_stop, early_results = self._check_sequential_stopping(
                control_data, variant_data, metric_type, stopping_threshold
            )
            if should_stop:
                return {
                    "metric_name": metric_name,
                    "control_mean": early_results["control_mean"],
                    "variant_mean": early_results["variant_mean"],
                    "relative_difference": early_results["expected_lift"],
                    "p_value": 1 - early_results["probability_of_improvement"],
                    "confidence_interval": (-np.inf, np.inf),  # Not applicable for early stopping
                    "sample_size": {"control": len(control_data), "variant": len(variant_data)},
                    "power": early_results["probability_of_improvement"],
                    "is_significant": early_results["probability_of_improvement"] > 0.95,
                }

        if metric_type == MetricType.BINARY:
            results = self.analyze_binary_metric(control_data, variant_data)
        elif metric_type in [MetricType.CONTINUOUS, MetricType.COUNT, MetricType.RATIO]:
            results = self.analyze_continuous_metric(control_data, variant_data)
        else:
            raise ValueError(f"Unsupported metric type: {metric_type}")

        return {
            "metric_name": metric_name,
            "control_mean": (
                results["control_mean"] if "control_mean" in results else results["control_rate"]
            ),
            "variant_mean": (
                results["variant_mean"] if "variant_mean" in results else results["variant_rate"]
            ),
            "relative_difference": results["expected_lift"],
            "p_value": 1 - results["probability_of_improvement"],
            "confidence_interval": results["credible_interval"],
            "sample_size": results["sample_size"],
            "power": results["probability_of_improvement"],
            "is_significant": results["probability_of_improvement"] > 0.95,
        }
