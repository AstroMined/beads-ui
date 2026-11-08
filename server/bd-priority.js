import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Scheduling priority of a queued bd call. Interactive calls (mutations,
 * subscribe snapshots, issue detail) are the default; background calls are the
 * watcher and mutation driven refresh passes.
 *
 * @typedef {'interactive' | 'background'} BdPriority
 */

/** @type {BdPriority} */
export const BD_PRIORITY_INTERACTIVE = 'interactive';
/** @type {BdPriority} */
export const BD_PRIORITY_BACKGROUND = 'background';

/**
 * Carries the priority through every async continuation started inside
 * `runInBackground`, so callers deep in the stack (list adapters) need no
 * extra parameter.
 *
 * @type {AsyncLocalStorage<BdPriority>}
 */
const priority_storage = new AsyncLocalStorage();

/**
 * Run `fn` so that every bd call it makes, directly or through awaited
 * helpers, queues at background priority behind interactive calls.
 *
 * @template T
 * @param {() => T} fn
 * @returns {T}
 */
export function runInBackground(fn) {
  return priority_storage.run(BD_PRIORITY_BACKGROUND, fn);
}

/**
 * Priority of the current async context.
 *
 * @returns {BdPriority}
 */
export function currentBdPriority() {
  return priority_storage.getStore() ?? BD_PRIORITY_INTERACTIVE;
}
