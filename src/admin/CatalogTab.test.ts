import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AdminArtifact, AdminCatalog } from '../domain/api-types';
import { CatalogTab } from './CatalogTab';

const item = (id: string, name: string, sortOrder: number, referenced = false): AdminArtifact => ({
  id,
  name,
  workload: 'data-factory',
  status: 'ga',
  sortOrder,
  referenced,
});

const catalog: AdminCatalog = {
  workloads: [
    { id: 'data-factory', name: 'Data Factory', shortName: 'Data Factory', blurb: 'Pipelines.', sortOrder: 10 },
    { id: 'power-bi', name: 'Power BI', shortName: 'Power BI', blurb: 'Reports.', sortOrder: 20 },
  ],
  artifacts: [item('pipeline', 'Pipeline', 10, true), item('copy-job', 'Copy job', 20)],
};

function render(): string {
  return renderToStaticMarkup(createElement(CatalogTab, { catalog, onCatalog: () => {} }));
}

const button = (html: string, label: string) =>
  new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`).exec(html)?.[0] ?? '';

describe('CatalogTab', () => {
  it('disables Delete, with the reason, only on an item that has scores or notes', () => {
    const deletes = render().match(/<button[^>]*>Delete<\/button>/g) ?? [];
    expect(deletes).toHaveLength(2);
    expect(deletes[0]).toContain('title="Has scores or notes. Mark it retired instead."');
    expect(deletes[0]).toMatch(/\sdisabled=""/);
    expect(deletes[1]).not.toMatch(/\sdisabled=""|title=/);
  });

  it('turns off the moves past either end of a workload and of the list', () => {
    const html = render();
    expect(button(html, 'Move Pipeline up')).toMatch(/\sdisabled=""/);
    expect(button(html, 'Move Pipeline down')).not.toMatch(/\sdisabled=""/);
    expect(button(html, 'Move Copy job down')).toMatch(/\sdisabled=""/);
    expect(button(html, 'Move Data Factory up')).toMatch(/\sdisabled=""/);
    expect(button(html, 'Move Power BI down')).toMatch(/\sdisabled=""/);
  });

  it("leaves the id and length rules to the server's words instead of the browser's", () => {
    expect(render()).not.toMatch(/pattern=|maxlength=/i);
  });

  it('keeps Add item and Add workload focusable, so focus survives a refused add', () => {
    const html = render();
    const adds = html.match(/<button[^>]*>Add (item|workload)<\/button>/g) ?? [];
    expect(adds).toHaveLength(3);
    for (const add of adds) {
      expect(add).toContain('aria-disabled="false"');
      expect(add).not.toMatch(/\sdisabled[\s=>]/);
    }
  });
});
