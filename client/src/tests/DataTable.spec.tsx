import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';

interface Row {
  id: string;
  name: string;
  amount: number;
}

const columns: DataTableColumn<Row>[] = [
  { id: 'name', header: 'Name', sortValue: (row) => row.name, cell: (row) => row.name },
  {
    id: 'amount',
    header: 'Amount',
    align: 'right',
    sortValue: (row) => row.amount,
    cell: (row) => row.amount,
  },
];

const rows: Row[] = [
  { id: '1', name: 'Karim', amount: 300 },
  { id: '2', name: 'Ayesha', amount: 100 },
  { id: '3', name: 'Nadia', amount: 200 },
];

function setup(props: Partial<React.ComponentProps<typeof DataTable<Row>>> = {}) {
  return render(
    <DataTable
      rows={rows}
      columns={columns}
      getRowId={(row) => row.id}
      exportFileName="rows"
      searchableText={(row) => row.name}
      {...props}
    />
  );
}

/** Body cell text, in render order, for the first column. */
function nameColumn() {
  return screen
    .getAllByRole('row')
    .slice(1) // skip the header row
    .map((row) => within(row).getAllByRole('cell')[0]!.textContent);
}

describe('DataTable', () => {
  it('sorts a column ascending, then descending, then back to source order', async () => {
    const user = userEvent.setup();
    setup();

    expect(nameColumn()).toEqual(['Karim', 'Ayesha', 'Nadia']);

    const header = screen.getByRole('button', { name: /name/i });
    await user.click(header);
    expect(nameColumn()).toEqual(['Ayesha', 'Karim', 'Nadia']);

    await user.click(header);
    expect(nameColumn()).toEqual(['Nadia', 'Karim', 'Ayesha']);

    await user.click(header);
    expect(nameColumn()).toEqual(['Karim', 'Ayesha', 'Nadia']);
  });

  it('sorts numerically rather than lexically', async () => {
    const user = userEvent.setup();
    setup({
      rows: [
        { id: '1', name: 'a', amount: 9 },
        { id: '2', name: 'b', amount: 100 },
        { id: '3', name: 'c', amount: 20 },
      ],
    });

    await user.click(screen.getByRole('button', { name: /amount/i }));
    expect(nameColumn()).toEqual(['a', 'c', 'b']);
  });

  it('filters the loaded rows without touching the server', async () => {
    const user = userEvent.setup();
    const onServerSearch = vi.fn().mockResolvedValue([]);
    setup({ onServerSearch });

    await user.type(screen.getByRole('searchbox'), 'ayesha');

    await waitFor(() => expect(nameColumn()).toEqual(['Ayesha']));
    expect(onServerSearch).not.toHaveBeenCalled();
  });

  it('falls back to a database search when nothing matches locally', async () => {
    const user = userEvent.setup();
    const onServerSearch = vi
      .fn()
      .mockResolvedValue([{ id: '9', name: 'Rokeya', amount: 50 }] satisfies Row[]);
    setup({ onServerSearch });

    await user.type(screen.getByRole('searchbox'), 'rokeya');

    await waitFor(() => expect(onServerSearch).toHaveBeenCalledWith('rokeya'));
    await waitFor(() => expect(nameColumn()).toEqual(['Rokeya']));
    expect(screen.getByText(/found 1 record in the database/i)).toBeInTheDocument();
  });

  it('paginates and reports the visible slice', async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 25 }, (_, i) => ({
      id: String(i),
      name: `User ${i}`,
      amount: i,
    }));
    setup({ rows: many, initialPageSize: 10 });

    expect(nameColumn()).toHaveLength(10);
    expect(screen.getByText('1–10 of 25')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /next/i }));
    expect(screen.getByText('11–20 of 25')).toBeInTheDocument();
  });

  it('shows two actions inline and collapses three or more into a menu', async () => {
    const user = userEvent.setup();
    const edit = vi.fn();

    const { rerender } = setup({
      actions: [
        { label: 'Edit', onSelect: edit },
        { label: 'Delete', onSelect: vi.fn() },
      ],
    });

    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(rows.length);
    expect(screen.queryByRole('button', { name: /row actions/i })).not.toBeInTheDocument();

    rerender(
      <DataTable
        rows={rows}
        columns={columns}
        getRowId={(row) => row.id}
        exportFileName="rows"
        actions={[
          { label: 'Edit', onSelect: edit },
          { label: 'Delete', onSelect: vi.fn() },
          { label: 'Archive', onSelect: vi.fn() },
        ]}
      />
    );

    const menus = screen.getAllByRole('button', { name: /row actions/i });
    expect(menus).toHaveLength(rows.length);

    await user.click(menus[0]!);
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    expect(edit).toHaveBeenCalledWith(rows[0]);
  });

  it('counts hidden actions per row, so a row can drop to an inline pair', () => {
    setup({
      actions: [
        { label: 'Edit', onSelect: vi.fn() },
        { label: 'Delete', onSelect: vi.fn() },
        // Only applies to Karim, so the other two rows keep two actions.
        { label: 'Approve', hidden: (row) => row.name !== 'Karim', onSelect: vi.fn() },
      ],
    });

    expect(screen.getAllByRole('button', { name: /row actions/i })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(2);
  });
});
