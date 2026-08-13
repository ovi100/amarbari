import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { History, ScrollText } from 'lucide-react';
import { PageHeader, StatCard } from '@/components/StatCard';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/feedback';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Segmented } from '@/components/ui/segmented';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { adminApi } from '@/services/endpoints';
import { errorMessage } from '@/services/api';
import { formatDateTime } from '@/lib/utils';
import type { ActivityLogEntry } from '@/types';

/**
 * The audit trail (SRS 3.2.10).
 *
 * Every mutation by either role lands here — meter readings and their previous
 * values in detail, everything else as the request that made it. The log is
 * read-only in the UI and absent from Data Control: a record that can be edited
 * proves nothing.
 */
const ENTITIES = ['All', 'Meter', 'User', 'Flat', 'Shop', 'Invoice', 'Tenancy'] as const;
type EntityFilter = (typeof ENTITIES)[number];

export default function ActivityLogPage() {
  const [entity, setEntity] = useState<EntityFilter>('All');
  const [detail, setDetail] = useState<ActivityLogEntry | null>(null);

  const log = useQuery({
    queryKey: ['admin', 'activity', entity],
    queryFn: () =>
      adminApi.activity({ pageSize: 200, ...(entity === 'All' ? {} : { entity }) }),
  });

  const rows = log.data?.entries ?? [];
  const actors = new Set(rows.map((entry) => entry.actorId ?? entry.actorName));
  const meterEntries = rows.filter((entry) => entry.entity === 'Meter').length;

  const columns = useMemo<DataTableColumn<ActivityLogEntry>[]>(
    () => [
      {
        id: 'createdAt',
        header: 'When',
        sortValue: (entry) => entry.createdAt,
        cell: (entry) => (
          <span className="whitespace-nowrap text-sm">{formatDateTime(entry.createdAt)}</span>
        ),
      },
      {
        id: 'actor',
        header: 'Who',
        sortValue: (entry) => entry.actorName,
        cell: (entry) => (
          <div>
            <p className="text-sm">{entry.actorName}</p>
            <p className="text-xs text-muted-foreground">{entry.actorRole}</p>
          </div>
        ),
      },
      {
        id: 'action',
        header: 'Action',
        sortValue: (entry) => entry.action,
        className: 'max-w-[240px]',
        cell: (entry) => (
          <span className="block truncate font-mono text-xs" title={entry.action}>
            {entry.action}
          </span>
        ),
      },
      {
        id: 'entity',
        header: 'Record',
        sortValue: (entry) => entry.entity,
        cell: (entry) => <Badge variant="secondary">{entry.entity}</Badge>,
      },
      {
        id: 'summary',
        header: 'What changed',
        sortValue: (entry) => entry.summary,
        className: 'max-w-[360px]',
        cell: (entry) => (
          <span className="block truncate text-sm" title={entry.summary}>
            {entry.summary}
          </span>
        ),
      },
    ],
    []
  );

  return (
    <>
      <PageHeader
        title="Activity Log"
        description="Every change made by an admin or a resident, in the order it happened."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Entries loaded" value={String(rows.length)} icon={ScrollText} />
        <StatCard label="People involved" value={String(actors.size)} tone="primary" />
        <StatCard
          label="Meter activity"
          value={String(meterEntries)}
          hint="Readings, edits and allocations"
          icon={History}
        />
      </div>

      <Card>
        <CardContent className="pt-5">
          {log.isError ? (
            <Alert tone="error" title="Could not load the activity log">
              {errorMessage(log.error)}
            </Alert>
          ) : (
            <DataTable
              rows={rows}
              columns={columns}
              getRowId={(entry) => entry.id}
              isLoading={log.isLoading}
              exportFileName="AmarBari-Activity"
              searchPlaceholder="Search by person, action or description…"
              searchableText={(entry) =>
                [entry.actorName, entry.action, entry.entity, entry.summary].join(' ')
              }
              onServerSearch={async (query) =>
                (await adminApi.activity({ search: query, pageSize: 200 })).entries
              }
              emptyMessage="Nothing logged yet."
              toolbar={
                <Segmented
                  value={entity}
                  onChange={setEntity}
                  size="sm"
                  options={ENTITIES.map((value) => ({ value, label: value }))}
                  aria-label="Filter by record type"
                />
              }
              actions={[{ label: 'Details', onSelect: setDetail }]}
            />
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(detail)} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{detail?.summary}</DialogTitle>
            <DialogDescription>
              {detail && (
                <>
                  {detail.actorName} ({detail.actorRole}) · {formatDateTime(detail.createdAt)}
                  {detail.ip ? ` · ${detail.ip}` : ''}
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          {detail && (
            <div className="grid gap-4 sm:grid-cols-2">
              <ValueBlock label="Before" value={detail.before} />
              <ValueBlock label="After" value={detail.after} />
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDetail(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Raw JSON, because the shape differs per action and inventing a renderer per
 *  action would hide exactly the detail somebody opened this dialog to see. */
function ValueBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium uppercase text-muted-foreground">{label}</p>
      <pre className="max-h-64 overflow-auto rounded-md border bg-muted/40 p-3 text-xs">
        {value === null || value === undefined ? '—' : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
