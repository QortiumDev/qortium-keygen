import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { App } from './App';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function render(): void {
  act(() => {
    root.render(<App />);
  });
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  window.history.replaceState(null, '', '/');
});

function pane(name: 'developers'): HTMLElement {
  const element = container.querySelector<HTMLElement>(`.workspace-pane.developers-pane`);
  if (element === null) throw new Error(`missing ${name} pane`);
  return element;
}

function generatorPane(): HTMLElement {
  return container.querySelectorAll<HTMLElement>('.workspace-pane')[0];
}

function navButton(label: 'Generator' | 'Developers'): HTMLButtonElement {
  const buttons = [...container.querySelectorAll<HTMLButtonElement>('.workspace-nav button')];
  const button = buttons.find((candidate) => candidate.textContent === label);
  if (button === undefined) throw new Error(`missing nav button ${label}`);
  return button;
}

describe('workspace navigation', () => {
  it('defaults to the Generator workspace with Developers hidden', () => {
    render();
    expect(generatorPane().hidden).toBe(false);
    expect(pane('developers').hidden).toBe(true);
    expect(container.textContent).toContain('How Q addresses work');
  });

  it('switches panes via the nav without unmounting either subtree', () => {
    render();
    act(() => {
      navButton('Developers').click();
    });
    expect(generatorPane().hidden).toBe(true);
    expect(pane('developers').hidden).toBe(false);
    expect(container.textContent).toContain('Address derivation pipeline');
    // The Generator subtree is still in the DOM, just hidden.
    expect(generatorPane().querySelector('.pattern-input')).not.toBeNull();

    act(() => {
      navButton('Generator').click();
    });
    expect(generatorPane().hidden).toBe(false);
    expect(pane('developers').hidden).toBe(true);
  });

  it('preserves an in-progress pattern draft across a workspace switch', () => {
    render();
    const input = generatorPane().querySelector<HTMLInputElement>('.pattern-input');
    if (input === null) throw new Error('missing pattern input');

    act(() => {
      const setNativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setNativeValue?.call(input, 'myname');
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'myname' }));
    });
    expect(input.value).toBe('myname');

    act(() => {
      navButton('Developers').click();
    });
    act(() => {
      navButton('Generator').click();
    });

    const inputAfter = generatorPane().querySelector<HTMLInputElement>('.pattern-input');
    expect(inputAfter).toBe(input); // same DOM node: never unmounted
    expect(inputAfter?.value).toBe('myname');
  });

  it('canonicalizes aliases on mount while preserving exact host history.state and hash', () => {
    const hostState = { hostFlag: true };
    window.history.replaceState(hostState, '', '/?view=developer&utm=x#host-fragment');
    render();
    expect(pane('developers').hidden).toBe(false);
    expect(window.location.search).toBe('?view=developers&utm=x');
    expect(window.location.hash).toBe('#host-fragment');
    expect(window.history.state).toBe(hostState);
  });

  it('preserves unrelated query params and the hash while switching views', () => {
    window.history.replaceState(null, '', '/?utm=abc&view=developers#hub-backup-schema');
    render();
    expect(window.location.hash).toBe('#hub-backup-schema');

    act(() => {
      navButton('Generator').click();
    });
    expect(window.location.search).toBe('?utm=abc');
    expect(window.location.hash).toBe('#hub-backup-schema');

    act(() => {
      navButton('Developers').click();
    });
    expect(window.location.search).toContain('utm=abc');
    expect(window.location.hash).toBe('#hub-backup-schema');
  });

  it('never writes generator-only state (pattern/seed/hit/password) into the URL', () => {
    render();
    const input = generatorPane().querySelector<HTMLInputElement>('.pattern-input');
    if (input === null) throw new Error('missing pattern input');
    act(() => {
      input.value = 'secretpattern';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => {
      navButton('Developers').click();
    });
    expect(window.location.search).not.toContain('secretpattern');
    expect(window.location.href).not.toContain('secretpattern');
  });

  it('reacts to browser back/forward (popstate) without a nav click', () => {
    render();
    act(() => {
      window.history.pushState({}, '', '/?view=developers');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(pane('developers').hidden).toBe(false);
    expect(generatorPane().hidden).toBe(true);

    act(() => {
      window.history.pushState({}, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(generatorPane().hidden).toBe(false);
    expect(pane('developers').hidden).toBe(true);
  });

  it('navigates a reference section link using ?section while retaining the host hash', () => {
    window.history.replaceState(null, '', '/#host-fragment');
    render();
    act(() => {
      navButton('Developers').click();
    });
    const link = [...container.querySelectorAll<HTMLAnchorElement>('.reference-toc a')].find(
      (candidate) => candidate.textContent === 'Hub backup v2 schema & KDF',
    );
    if (link === undefined) throw new Error('missing reference link');

    act(() => {
      link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    });
    expect(new URLSearchParams(window.location.search).get('section')).toBe('hub-backup-schema');
    expect(window.location.hash).toBe('#host-fragment');
    expect(pane('developers').hidden).toBe(false);
  });

  it('confines known-section scrolling to the Developers scroller and ignores unknown ids', () => {
    window.history.replaceState(null, '', '/?view=developers&section=hub-backup-schema#host-fragment');
    render();
    const scroller = container.querySelector<HTMLElement>('.developers-scroll');
    const target = container.querySelector<HTMLElement>('#hub-backup-schema');
    if (scroller === null || target === null) throw new Error('missing reference scroller/target');
    Object.defineProperty(scroller, 'scrollTop', { configurable: true, writable: true, value: 5 });
    vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue({ top: 100 } as DOMRect);
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({ top: 250 } as DOMRect);
    const derivation = container.querySelector<HTMLElement>('#derivation');
    if (derivation === null) throw new Error('missing derivation target');
    vi.spyOn(derivation, 'getBoundingClientRect').mockReturnValue({ top: 250 } as DOMRect);
    // Changing the known section proves the bounded delta path without
    // invoking browser-wide scrolling.
    window.history.pushState(null, '', '/?view=developers&section=derivation#host-fragment');
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));
    expect(scroller.scrollTop).toBe(155);

    window.history.pushState(null, '', '/?view=developers&section=%22%5D#host-fragment');
    expect(() => act(() => window.dispatchEvent(new PopStateEvent('popstate')))).not.toThrow();
  });
});
