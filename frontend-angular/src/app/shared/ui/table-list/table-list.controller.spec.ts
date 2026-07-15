import { describe, it, expect } from 'vitest';
import { signal } from '@angular/core';
import { TableListController } from './table-list.controller';

interface Row {
  id: number;
  name: string;
  score: number;
}

function makeRows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({ id: i + 1, name: `Row ${i + 1}`, score: (i * 7) % 13 }));
}

describe('TableListController', () => {
  it('paginates with a default page size of 10', () => {
    const ctrl = new TableListController(signal(makeRows(25)));
    expect(ctrl.pageRows().length).toBe(10);
    expect(ctrl.totalPages()).toBe(3);
    expect(ctrl.rangeLabel()).toBe('1–10 of 25');
  });

  it('advances and retreats pages', () => {
    const ctrl = new TableListController(signal(makeRows(25)));
    ctrl.nextPage();
    expect(ctrl.effectivePageIndex()).toBe(1);
    expect(ctrl.pageRows()[0].id).toBe(11);
    ctrl.prevPage();
    expect(ctrl.effectivePageIndex()).toBe(0);
  });

  it('does not page past the last page', () => {
    const ctrl = new TableListController(signal(makeRows(5)));
    ctrl.nextPage();
    expect(ctrl.effectivePageIndex()).toBe(0);
  });

  it('filters rows and resets to the first page', () => {
    const rows = signal(makeRows(25));
    const ctrl = new TableListController(rows, {
      filterPredicate: (row, q) => row.name.toLowerCase().includes(q),
    });
    ctrl.pageIndex.set(1);
    ctrl.setFilter('row 2');
    expect(ctrl.effectivePageIndex()).toBe(0);
    // "Row 2", "Row 20".."Row 25" all contain "row 2"
    expect(ctrl.total()).toBe(7);
  });

  it('clamps the effective page index when the filtered set shrinks without an explicit page reset', () => {
    const rows = signal(makeRows(25));
    const ctrl = new TableListController(rows);
    ctrl.setPageSize(10);
    ctrl.nextPage();
    ctrl.nextPage();
    expect(ctrl.effectivePageIndex()).toBe(2);
    rows.set(makeRows(5));
    expect(ctrl.effectivePageIndex()).toBe(0);
    expect(ctrl.pageRows().length).toBe(5);
  });

  it('sorts ascending then descending on repeated toggle', () => {
    const ctrl = new TableListController(signal(makeRows(5)), {
      sortAccessor: (row, key) => (key === 'score' ? row.score : row.id),
    });
    ctrl.toggleSort('score');
    const asc = ctrl.sorted().map((r) => r.score);
    expect(asc).toEqual([...asc].sort((a, b) => a - b));

    ctrl.toggleSort('score');
    const desc = ctrl.sorted().map((r) => r.score);
    expect(desc).toEqual([...desc].sort((a, b) => b - a));
  });

  it('reports 0 of 0 for an empty result set', () => {
    const ctrl = new TableListController(signal([]));
    expect(ctrl.rangeLabel()).toBe('0 of 0');
    expect(ctrl.totalPages()).toBe(1);
    expect(ctrl.pageRows()).toEqual([]);
  });
});
