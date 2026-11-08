import { html, render } from 'lit-html';
import { debug } from '../utils/logging.js';

/**
 * @import { ViewName } from '../state.js'
 */

/**
 * Render the top navigation tabs and handle route changes.
 *
 * @param {HTMLElement} mount_element
 * @param {{ getState: () => any, subscribe: (fn: (s: any) => void) => () => void }} store
 * @param {{ gotoView: (v: ViewName) => void }} router
 */
export function createTopNav(mount_element, store, router) {
  const log = debug('views:nav');
  /** @type {(() => void) | null} */
  let unsubscribe = null;

  /**
   * @param {ViewName} view
   * @returns {(ev: MouseEvent) => void}
   */
  function onClick(view) {
    return (ev) => {
      ev.preventDefault();
      log('click tab %s', view);
      router.gotoView(view);
    };
  }

  function template() {
    const s = store.getState();
    const active = s.view || 'issues';
    return html`
      <nav class="header-nav" aria-label="Primary">
        <a
          href="#/issues"
          class="tab ${active === 'issues' ? 'active' : ''}"
          @click=${onClick('issues')}
          >Issues</a
        >
        <a
          href="#/epics"
          class="tab ${active === 'epics' ? 'active' : ''}"
          @click=${onClick('epics')}
          >Epics</a
        >
        <a
          href="#/board"
          class="tab ${active === 'board' ? 'active' : ''}"
          @click=${onClick('board')}
          >Board</a
        >
        <a
          href="#/graph"
          class="tab ${active === 'graph' ? 'active' : ''}"
          @click=${onClick('graph')}
          >Graph</a
        >
      </nav>
    `;
  }

  function doRender() {
    render(template(), mount_element);
  }

  doRender();
  unsubscribe = store.subscribe(() => doRender());

  return {
    destroy() {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
      render(html``, mount_element);
    }
  };
}
