// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '../test/dom';
import { FactorBars } from './FactorBars';

afterEach(cleanup);

describe('FactorBars', () => {
  it('draws a meter per scored factor and a "Not applicable" cell for a null one', async () => {
    const { container } = await render(FactorBars, { scores: { capability: 6, ux: 5, cost: null, outlook: 4 } });
    expect(container.querySelectorAll('[role="meter"]')).toHaveLength(3);
    const na = container.querySelectorAll('[data-na]');
    expect(na).toHaveLength(1);
    expect(na[0]?.textContent).toContain('CU / Token Cost');
    expect(na[0]?.textContent).toContain('Not applicable');
    expect(na[0]?.querySelector('[role="meter"]')).toBeNull();
  });
});
