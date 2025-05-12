from typing import List

import numpy as np


class MultipleTestingCorrection:
    """Handles multiple testing corrections for experiment results"""

    @staticmethod
    def benjamini_hochberg(p_values: List[float]) -> List[float]:
        """
        Apply Benjamini-Hochberg procedure to control false discovery rate (FDR)
        """
        if not p_values:
            return []

        n = len(p_values)
        sorted_indices = np.argsort(p_values)
        sorted_p_values = np.array(p_values)[sorted_indices]

        adjusted_p_values = np.zeros(n)
        for i in range(n - 1, -1, -1):
            if i == n - 1:
                adjusted_p_values[i] = sorted_p_values[i]
            else:
                adjusted_p_values[i] = min(
                    sorted_p_values[i] * n / (i + 1), adjusted_p_values[i + 1]
                )

        final_adjusted_p_values = np.zeros(n)
        final_adjusted_p_values[sorted_indices] = adjusted_p_values

        return [min(p, 1.0) for p in final_adjusted_p_values]

    @staticmethod
    def holm(p_values: List[float]) -> List[float]:
        """
        Apply Holm-Bonferroni procedure to control family-wise error rate (FWER)
        """
        if not p_values:
            return []

        n = len(p_values)
        sorted_indices = np.argsort(p_values)
        sorted_p_values = np.array(p_values)[sorted_indices]

        adjusted_p_values = np.zeros(n)
        for i in range(n):
            adjusted_p_values[i] = sorted_p_values[i] * (n - i)

        for i in range(n - 1, 0, -1):
            adjusted_p_values[i - 1] = min(adjusted_p_values[i - 1], adjusted_p_values[i])

        final_adjusted_p_values = np.zeros(n)
        final_adjusted_p_values[sorted_indices] = adjusted_p_values

        return [min(p, 1.0) for p in final_adjusted_p_values]

    @staticmethod
    def apply_correction(p_values: List[float], method: str = "fdr_bh") -> List[float]:
        """
        Apply multiple testing correction using the specified method

        Parameters
        ----------
        p_values : List[float]
            List of p-values to correct
        method : str
            Correction method to use ('fdr_bh' or 'holm')

        Returns
        -------
        List[float]
            Corrected p-values
        """
        if method == "fdr_bh":
            return MultipleTestingCorrection.benjamini_hochberg(p_values)
        elif method == "holm":
            return MultipleTestingCorrection.holm(p_values)
        else:
            raise ValueError(f"Unknown correction method: {method}")
