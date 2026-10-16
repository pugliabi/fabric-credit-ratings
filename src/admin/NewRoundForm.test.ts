import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AdminRound } from '../domain/api-types';
import { NewRoundForm } from './NewRoundForm';

const q4: AdminRound = {
  id: '2026-Q4',
  label: 'Q4 2026',
  status: 'published',
  publishedOn: '2026-12-15',
  scorecards: 3,
  notes: 10,
};

function render(): string {
  return renderToStaticMarkup(createElement(NewRoundForm, { rounds: [q4], onCreated: () => {} }));
}

describe('NewRoundForm', () => {
  it('suggests the next quarter', () => {
    const html = render();
    expect(html).toContain('value="2027-Q1"');
    expect(html).toContain('value="Q1 2027"');
  });

  it("leaves the id and label rules to the server's words instead of the browser's", () => {
    const html = render();
    expect(html).not.toMatch(/pattern=|maxlength=/i);
    expect(html).toMatch(/<input[^>]*autoCapitalize="characters"[^>]*value="2027-Q1"/i);
  });

  it('keeps Open round focusable, so focus survives a submit', () => {
    const button = /<button[^>]*>Open round<\/button>/.exec(render())?.[0];
    expect(button).toContain('aria-disabled="false"');
    expect(button).not.toMatch(/\sdisabled[\s=>]/);
  });
});
