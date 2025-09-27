import type { ExperimentAssignment } from "../types";

/**
 * Parse experiment assignments from various formats
 */
export function parseExperimentAssignments(
  experiments?: ExperimentAssignment[],
  exp?: string
): ExperimentAssignment[] {
  const assignments: ExperimentAssignment[] = [];

  if (experiments && Array.isArray(experiments)) {
    assignments.push(...experiments.filter(e => e.experiment_id && e.variant_id));
  }

  if (exp && typeof exp === 'string') {
    const compactAssignments = exp.split(';')
      .map(pair => pair.trim())
      .filter(pair => pair.includes(':'))
      .map(pair => {
        const [experiment_id, variant_id] = pair.split(':');
        return { experiment_id: experiment_id.trim(), variant_id: variant_id.trim() };
      })
      .filter(assignment => assignment.experiment_id && assignment.variant_id);
    
    assignments.push(...compactAssignments);
  }

  const uniqueAssignments = assignments.filter((assignment, index, arr) => 
    arr.findIndex(a => a.experiment_id === assignment.experiment_id) === index
  );

  return uniqueAssignments;
}

export function returnCompactedAssignments(assignments: ExperimentAssignment[]): string {
  return assignments.map(assignment => `${assignment.experiment_id}:${assignment.variant_id}`).join(';');
}
