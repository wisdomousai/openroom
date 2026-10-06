import {
  createColumnHelper,
  createPaginatedRowModel,
  createSortedRowModel,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronsUpDown, MoreHorizontal, Search } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';

import { Button } from './ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Input } from './ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './ui/table';

export function CollectionToolbar({
  value,
  onChange,
  placeholder = 'Search…',
  filters,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  filters?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <div className="relative min-w-[14rem] max-w-md flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={value}
            onChange={(event) => onChange(event.currentTarget.value)}
            placeholder={placeholder}
            aria-label={placeholder}
            className="pl-9"
          />
        </div>
        {filters}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  );
}

export function CollectionMeta({ count, noun }: { count: number; noun: string }) {
  return (
    <p className="text-xs text-muted-foreground">
      {count} {noun}{count === 1 ? '' : 's'}
    </p>
  );
}

export interface ManagementColumn<Row> {
  key: string;
  header: string;
  className?: string;
  accessor?: (row: Row) => string | number | null | undefined;
  cell: (row: Row) => ReactNode;
}

const managementTableFeatures = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
});

export function ManagementTable<Row extends { id: string }>({
  columns,
  rows,
  empty,
  caption,
}: {
  columns: ManagementColumn<Row>[];
  rows: Row[];
  empty: ReactNode;
  caption?: string;
}) {
  const columnHelper = useMemo(
    () => createColumnHelper<typeof managementTableFeatures, Row>(),
    [],
  );
  const tableColumns = useMemo(
    () => columnHelper.columns(columns.map((column) => (
      column.accessor
        ? columnHelper.accessor(column.accessor, {
            id: column.key,
            header: column.header,
            cell: (info) => column.cell(info.row.original),
          })
        : columnHelper.display({
            id: column.key,
            header: column.header,
            cell: (info) => column.cell(info.row.original),
          })
    ))),
    [columnHelper, columns],
  );
  const table = useTable({
    features: managementTableFeatures,
    columns: tableColumns,
    data: rows,
    getRowId: (row) => row.id,
    autoResetPageIndex: true,
    initialState: { pagination: { pageIndex: 0, pageSize: 20 } },
  });
  const visibleRows = table.getRowModel().rows;
  const pageCount = table.getPageCount();

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="overflow-x-auto">
        <Table>
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const column = columns.find((candidate) => candidate.key === header.column.id);
                  const sorted = header.column.getIsSorted();
                  const canSort = header.column.getCanSort();
                  return (
                    <TableHead key={header.id} className={column?.className} aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : canSort ? 'none' : undefined}>
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          type="button"
                          className="inline-flex min-h-8 items-center gap-1 rounded-sm text-left font-medium hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          <table.FlexRender header={header} />
                          {sorted === 'asc' ? <ArrowUp className="size-3.5" aria-hidden="true" /> : sorted === 'desc' ? <ArrowDown className="size-3.5" aria-hidden="true" /> : <ChevronsUpDown className="size-3.5 text-muted-foreground" aria-hidden="true" />}
                        </button>
                      ) : <table.FlexRender header={header} />}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {visibleRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-32 text-center text-sm text-muted-foreground">
                  {empty}
                </TableCell>
              </TableRow>
            ) : visibleRows.map((row) => (
              <TableRow key={row.id}>
                {row.getAllCells().map((cell) => {
                  const column = columns.find((candidate) => candidate.key === cell.column.id);
                  return (
                    <TableCell key={cell.id} className={column?.className}>
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {pageCount > 1 ? (
        <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-2">
          <p className="text-xs text-muted-foreground">
            Page {table.state.pagination.pageIndex + 1} of {pageCount}
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()}>
              Previous
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={!table.getCanNextPage()} onClick={() => table.nextPage()}>
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function RowActions({
  label = 'Open actions',
  children,
}: {
  label?: string;
  children: ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label={label}>
          <MoreHorizontal data-icon="inline-start" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ActionMenuDivider() {
  return <DropdownMenuSeparator />;
}

export function ConfirmActionDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  busy = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent role="alertdialog" aria-describedby="confirm-action-description">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription id="confirm-action-description">{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">Cancel</Button>
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            disabled={busy}
            onClick={() => void onConfirm()}
          >
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
