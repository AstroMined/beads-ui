export const priority_levels = ['Critical', 'High', 'Medium', 'Low', 'Backlog'];

/** Priority assumed when an issue carries none (Medium). */
export const DEFAULT_PRIORITY = 2;

/** Highest-urgency priority value (Critical). */
export const MIN_PRIORITY = 0;

/** Lowest-urgency priority value (Backlog). */
export const MAX_PRIORITY = priority_levels.length - 1;
