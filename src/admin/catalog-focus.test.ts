import { describe, expect, it } from 'vitest';
import { deleteFocus, focusKeys, focusLost, moveFocus, pickFocus } from './catalog-focus';

const element = (name: string, disabled = false) => ({
  name,
  matches: (selector: string) => selector === ':disabled' && disabled,
});

describe('moveFocus', () => {
  it('keeps the arrow that was pressed, then the other one once the row reaches the end', () => {
    expect(moveFocus('item:copy-job', -1)).toEqual(['item:copy-job:up', 'item:copy-job:down']);
    expect(moveFocus('workload:power-bi', 1)).toEqual(['workload:power-bi:down', 'workload:power-bi:up']);
  });
});

describe('deleteFocus', () => {
  const ids = ['pipeline', 'copy-job', 'dataflow'];

  it("tries the row itself (a refused delete keeps it), the next row's Delete, the previous one's, the heading", () => {
    expect(deleteFocus(ids, 1, 'data-factory')).toEqual([
      'delete:copy-job',
      'status:copy-job',
      'delete:dataflow',
      'delete:pipeline',
      'section:data-factory',
    ]);
  });

  it('skips neighbours that are not there', () => {
    expect(deleteFocus(ids, 2, 'data-factory')).toEqual([
      'delete:dataflow',
      'status:dataflow',
      'delete:copy-job',
      'section:data-factory',
    ]);
    expect(deleteFocus(['only'], 0, 'onelake')).toEqual(['delete:only', 'status:only', 'section:onelake']);
  });
});

describe('pickFocus', () => {
  it('takes the first control that is still on the page and not disabled', () => {
    const controls = new Map([
      ['delete:dataflow', element('next', true)],
      ['delete:pipeline', element('previous')],
      ['section:data-factory', element('heading')],
    ]);
    const find = (key: string) => controls.get(key);
    const targets = deleteFocus(['pipeline', 'copy-job', 'dataflow'], 1, 'data-factory');
    expect(pickFocus(targets, find)?.name).toBe('previous');
    expect(pickFocus(['delete:gone'], find)).toBeUndefined();
  });
});

describe('focusLost', () => {
  const body = element('body');

  it('is true on <body>, nowhere, or on a control that just turned disabled', () => {
    expect(focusLost(body, body)).toBe(true);
    expect(focusLost(null, body)).toBe(true);
    expect(focusLost(element('select', true), body)).toBe(true);
  });

  it('is false while a usable control has focus, so the user is never moved', () => {
    expect(focusLost(element('button'), body)).toBe(false);
  });
});

describe('focusKeys', () => {
  it('names each kind of control once, so registering and targeting agree', () => {
    expect([
      focusKeys.heading,
      focusKeys.section('onelake'),
      focusKeys.workloadName('onelake'),
      focusKeys.arrow('item:shortcuts', 'up'),
      focusKeys.name('shortcuts'),
      focusKeys.status('shortcuts'),
      focusKeys.place('shortcuts'),
      focusKeys.remove('shortcuts'),
      focusKeys.add('onelake'),
      focusKeys.addWorkload,
    ]).toEqual([
      'heading',
      'section:onelake',
      'workload-name:onelake',
      'item:shortcuts:up',
      'name:shortcuts',
      'status:shortcuts',
      'place:shortcuts',
      'delete:shortcuts',
      'add:onelake',
      'add-workload',
    ]);
  });
});
