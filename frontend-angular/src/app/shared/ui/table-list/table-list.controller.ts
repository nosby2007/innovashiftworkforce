import { Signal, computed, signal } from '@angular/core';

export type SortDirection = 'asc' | 'desc';

export interface TableListOptions<T> {
  pageSize?: number;
  /** Returns true if the row matches a lowercased, trimmed search query. */
  filterPredicate?: (row: T, query: string) => boolean;
  /** Returns the comparable value for a row given a sort key (column id). */
  sortAccessor?: (row: T, key: string) => string | number | Date | null | undefined;
  /** Sort key/direction applied before the user picks one, if any. */
  initialSort?: { key: string; dir?: SortDirection };
}

/**
 * Generic client-side search + sort + pagination for the app's existing
 * hand-styled tables (no Angular Material table swap — see the "Garder le
 * style actuel" scope decision). One instance per table; the host page
 * supplies a `Signal<T[]>` of the raw rows plus how to filter/sort them.
 */
export class TableListController<T> {
  readonly filterText = signal('');
  readonly sortKey = signal<string | null>(null);
  readonly sortDir = signal<SortDirection>('asc');
  readonly pageIndex = signal(0);
  readonly pageSize = signal(10);

  readonly filtered: Signal<T[]>;
  readonly sorted: Signal<T[]>;
  readonly total: Signal<number>;
  readonly totalPages: Signal<number>;
  readonly effectivePageIndex: Signal<number>;
  readonly pageRows: Signal<T[]>;
  readonly rangeLabel: Signal<string>;

  private readonly filterPredicate?: (row: T, query: string) => boolean;
  private readonly sortAccessor?: (row: T, key: string) => string | number | Date | null | undefined;

  constructor(private readonly source: Signal<T[]>, options: TableListOptions<T> = {}) {
    this.filterPredicate = options.filterPredicate;
    this.sortAccessor = options.sortAccessor;
    if (options.pageSize) this.pageSize.set(options.pageSize);
    if (options.initialSort) {
      this.sortKey.set(options.initialSort.key);
      this.sortDir.set(options.initialSort.dir ?? 'asc');
    }

    this.filtered = computed(() => {
      const query = this.filterText().trim().toLowerCase();
      const rows = this.source();
      if (!query || !this.filterPredicate) return rows;
      return rows.filter((row) => this.filterPredicate!(row, query));
    });

    this.sorted = computed(() => {
      const key = this.sortKey();
      const rows = this.filtered();
      if (!key || !this.sortAccessor) return rows;
      const dir = this.sortDir() === 'asc' ? 1 : -1;
      return [...rows].sort((a, b) => {
        const av = this.sortAccessor!(a, key);
        const bv = this.sortAccessor!(b, key);
        if (av == null && bv == null) return 0;
        if (av == null) return -1 * dir;
        if (bv == null) return 1 * dir;
        if (av < bv) return -1 * dir;
        if (av > bv) return 1 * dir;
        return 0;
      });
    });

    this.total = computed(() => this.sorted().length);
    this.totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));

    // Clamped for display only — never mutates pageIndex from inside a
    // computed. If a filter shrinks the result set out from under the raw
    // page index, the view still renders a valid page; explicit paging
    // actions (next/prev/setPageSize/setFilter) are what actually move it.
    this.effectivePageIndex = computed(() => Math.min(this.pageIndex(), this.totalPages() - 1));

    this.pageRows = computed(() => {
      const rows = this.sorted();
      const size = this.pageSize();
      const start = this.effectivePageIndex() * size;
      return rows.slice(start, start + size);
    });

    this.rangeLabel = computed(() => {
      const total = this.total();
      if (total === 0) return '0 of 0';
      const size = this.pageSize();
      const start = this.effectivePageIndex() * size + 1;
      const end = Math.min(total, start + size - 1);
      return `${start}–${end} of ${total}`;
    });
  }

  setFilter(text: string): void {
    this.filterText.set(text);
    this.pageIndex.set(0);
  }

  toggleSort(key: string): void {
    if (this.sortKey() === key) {
      this.sortDir.set(this.sortDir() === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortKey.set(key);
      this.sortDir.set('asc');
    }
  }

  sortIndicator(key: string): '' | '▲' | '▼' {
    if (this.sortKey() !== key) return '';
    return this.sortDir() === 'asc' ? '▲' : '▼';
  }

  setPageSize(size: number): void {
    this.pageSize.set(Math.max(1, size));
    this.pageIndex.set(0);
  }

  nextPage(): void {
    if (this.effectivePageIndex() < this.totalPages() - 1) {
      this.pageIndex.set(this.effectivePageIndex() + 1);
    }
  }

  prevPage(): void {
    if (this.effectivePageIndex() > 0) {
      this.pageIndex.set(this.effectivePageIndex() - 1);
    }
  }
}
