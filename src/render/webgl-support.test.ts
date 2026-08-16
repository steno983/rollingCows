// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { isWebGLAvailable, showWebGLError } from './webgl-support';

/** Canvas finto: getContext risponde quello che decide il test. */
function fakeCanvas(result: unknown): () => HTMLCanvasElement {
  return () =>
    ({
      getContext: () => result,
    }) as unknown as HTMLCanvasElement;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('isWebGLAvailable', () => {
  it('è false quando getContext restituisce null', () => {
    expect(isWebGLAvailable(fakeCanvas(null))).toBe(false);
  });

  it('è true quando getContext restituisce un contesto', () => {
    expect(isWebGLAvailable(fakeCanvas({ drawingBufferWidth: 300 }))).toBe(true);
  });

  it('è false se la creazione del canvas o del contesto lancia', () => {
    const throwing = (): HTMLCanvasElement => {
      throw new Error('contesto negato');
    };
    expect(isWebGLAvailable(throwing)).toBe(false);
  });
});

describe('showWebGLError', () => {
  it('scrive un messaggio leggibile nel contenitore', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    showWebGLError(root);

    const message = root.querySelector('.fatal');
    expect(message).not.toBeNull();
    expect(root.textContent).toContain('WebGL');
  });
});
