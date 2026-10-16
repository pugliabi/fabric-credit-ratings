import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AdminArtifact, AdminCatalog } from '../domain/api-types';
import { AddArtifactForm, ArtifactRowEditor, CatalogTab } from './CatalogTab';

const item = (id: string, name: string, sortOrder: number, referenced = false): AdminArtifact => ({
  id,
  name,
  workload: 'data-factory',
  status: 'ga',
  naFactors: [],
  sortOrder,
  referenced,
  description: '',
});

const catalog: AdminCatalog = {
  workloads: [
    { id: 'data-factory', name: 'Data Factory', shortName: 'Data Factory', blurb: 'Pipelines.', sortOrder: 10 },
    { id: 'power-bi', name: 'Power BI', shortName: 'Power BI', blurb: 'Reports.', sortOrder: 20 },
  ],
  artifacts: [item('pipeline', 'Pipeline', 10, true), item('copy-job', 'Copy job', 20)],
};

const run = async () => true;
const control = () => () => {};

function render(): string {
  return renderToStaticMarkup(createElement(CatalogTab, { catalog, onCatalog: () => {} }));
}

function inTable(element: ReactElement): string {
  return renderToStaticMarkup(createElement('table', null, createElement('tbody', null, element)));
}

/** A row while a write runs, with ↑ at the top of its workload. */
function busyRow(artifact: AdminArtifact): string {
  return inTable(
    createElement(ArtifactRowEditor, {
      artifact,
      catalog,
      busy: true,
      run,
      control,
      afterDelete: [],
      canMoveUp: false,
      canMoveDown: true,
      onMove: () => {},
    }),
  );
}

const tagWith = (html: string, tag: string, label: string) =>
  new RegExp(`<${tag}[^>]*aria-label="${label}"[^>]*>`).exec(html)?.[0] ?? '';
const button = (html: string, label: string) => tagWith(html, 'button', label);
const disabled = /\sdisabled=""/;

describe('CatalogTab', () => {
  it('opens with a heading that can take focus when focus is lost (after a login on #catalog)', () => {
    expect(render()).toMatch(/^<div[^>]*><h2 tabindex="-1"[^>]*>Workloads and items<\/h2>/);
  });

  it('gives each workload a heading that can take focus, for a delete that empties its table', () => {
    const headings = render().match(/<h3 tabindex="-1"[^>]*>[^<]*<\/h3>/g) ?? [];
    expect(headings.map((heading) => heading.replace(/<[^>]*>/g, ''))).toEqual(['Data Factory', 'Power BI']);
  });

  it('puts each item table in a wrapper that scrolls sideways on a narrow screen', () => {
    const wrapped = render().match(/<div class="[^"]*tableWrap[^"]*"><table/g) ?? [];
    expect(wrapped).toHaveLength(1);
  });

  it('disables Delete, with the reason, only on an item that has scores or notes', () => {
    const html = render();
    expect(button(html, 'Delete Pipeline')).toContain('title="Has scores or notes. Mark it retired instead."');
    expect(button(html, 'Delete Pipeline')).toMatch(disabled);
    expect(button(html, 'Delete Copy job')).not.toMatch(/\sdisabled=""|title=/);
  });

  it('turns off the moves past either end of a workload and of the list', () => {
    const html = render();
    expect(button(html, 'Move Pipeline up')).toMatch(disabled);
    expect(button(html, 'Move Pipeline down')).not.toMatch(disabled);
    expect(button(html, 'Move Copy job down')).toMatch(disabled);
    expect(button(html, 'Move Data Factory up')).toMatch(disabled);
    expect(button(html, 'Move Power BI down')).toMatch(disabled);
  });

  it('names every repeated control after its item or workload', () => {
    const html = render();
    for (const [tag, label] of [
      ['input', 'Copy job name'],
      ['select', 'Copy job status'],
      ['select', 'Copy job workload'],
      ['button', 'Delete Copy job'],
      ['button', 'Copy job description'],
      ['button', 'Move Copy job up'],
      ['input', 'Data Factory workload name'],
      ['input', 'Data Factory short name'],
      ['input', 'Data Factory description'],
      ['input', 'New item in Data Factory'],
      ['input', 'New item id in Data Factory'],
      ['select', 'New item status in Data Factory'],
      ['button', 'Add item to Data Factory'],
      ['button', 'Add item to Power BI'],
    ] as const) {
      expect(tagWith(html, tag, label), label).not.toBe('');
    }
    expect(html.match(/aria-label="Delete [^"]+"/g)).toHaveLength(2);
  });

  it("leaves the id and length rules to the server's words instead of the browser's", () => {
    expect(render()).not.toMatch(/pattern=|maxlength=/i);
  });
});

describe('ArtifactRowEditor while a write runs', () => {
  it('keeps the row buttons focusable (aria-disabled), so focus survives the write', () => {
    const html = busyRow(item('copy-job', 'Copy job', 20));
    for (const label of ['Move Copy job down', 'Delete Copy job']) {
      expect(button(html, label), label).toContain('aria-disabled="true"');
      expect(button(html, label), label).not.toMatch(disabled);
    }
  });

  it('still disables what can never work: the arrow at the end, Delete on a referenced item', () => {
    expect(button(busyRow(item('copy-job', 'Copy job', 20)), 'Move Copy job up')).toMatch(disabled);
    expect(button(busyRow(item('pipeline', 'Pipeline', 10, true)), 'Delete Pipeline')).toMatch(disabled);
  });

  it('disables the selects, whose focus the tab puts back after the write', () => {
    const html = busyRow(item('copy-job', 'Copy job', 20));
    expect(tagWith(html, 'select', 'Copy job status')).toMatch(disabled);
    expect(tagWith(html, 'select', 'Copy job workload')).toMatch(disabled);
  });
});

describe('AddArtifactForm', () => {
  it('renders Add item with aria-disabled, not disabled, while a write runs', () => {
    const html = renderToStaticMarkup(
      createElement(AddArtifactForm, { workload: catalog.workloads[0]!, busy: true, run, control }),
    );
    const add = button(html, 'Add item to Data Factory');
    expect(add).toContain('aria-disabled="true"');
    expect(add).not.toMatch(/\sdisabled[\s=>]/);
  });
});
