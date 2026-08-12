import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Wrench } from 'lucide-react';
import { PageHeader, StatCard } from '@/components/StatCard';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TicketBadge } from '@/components/ui/badge';
import { Alert, EmptyState, LoadingState } from '@/components/ui/feedback';
import { ticketApi } from '@/services/endpoints';
import { API_BASE_URL, errorMessage } from '@/services/api';
import { formatDateTime, humanise } from '@/lib/utils';
import { toast } from '@/store/toast.store';
import { useSocketEvent } from '@/hooks/useSocket';
import type { MaintenanceTicket, TicketStatus } from '@/types';

const FILTERS: (TicketStatus | 'ALL')[] = [
  'ALL',
  'PENDING',
  'IN_PROGRESS',
  'RESOLVED',
  'REJECTED',
];

const NEXT_ACTIONS: Record<TicketStatus, { status: TicketStatus; label: string; variant: 'default' | 'success' | 'destructive' | 'outline' }[]> = {
  PENDING: [
    { status: 'IN_PROGRESS', label: 'Start work', variant: 'default' },
    { status: 'REJECTED', label: 'Reject', variant: 'outline' },
  ],
  IN_PROGRESS: [
    { status: 'RESOLVED', label: 'Mark resolved', variant: 'success' },
    { status: 'REJECTED', label: 'Reject', variant: 'outline' },
  ],
  RESOLVED: [{ status: 'IN_PROGRESS', label: 'Reopen', variant: 'outline' }],
  REJECTED: [{ status: 'PENDING', label: 'Reopen', variant: 'outline' }],
};

const ASSET_ORIGIN = API_BASE_URL.replace(/\/api\/v1\/?$/, '');

export default function AdminTicketsPage() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<TicketStatus | 'ALL'>('ALL');

  const tickets = useQuery({
    queryKey: ['admin', 'tickets', filter],
    queryFn: () => ticketApi.list(filter === 'ALL' ? {} : { status: filter }),
  });

  // New reports arrive without a reload.
  useSocketEvent<MaintenanceTicket>('ticket:created', (ticket) => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'tickets'] });
    toast.info(
      'New maintenance report',
      `${humanise(ticket.category)} · flat ${ticket.flat?.flatNumber ?? '—'}`
    );
  });

  const update = useMutation({
    mutationFn: ({ id, status }: { id: string; status: TicketStatus }) =>
      ticketApi.updateStatus(id, status),
    onSuccess: (ticket) => {
      toast.success(`Ticket marked ${humanise(ticket.status)}`);
      queryClient.invalidateQueries({ queryKey: ['admin', 'tickets'] });
    },
    onError: (err) => toast.error('Could not update the ticket', errorMessage(err)),
  });

  const rows = tickets.data?.tickets ?? [];
  const counts = rows.reduce<Record<string, number>>((acc, ticket) => {
    acc[ticket.status] = (acc[ticket.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <>
      <PageHeader
        title="Maintenance centre"
        description="Every reported issue with reporter, flat, date and photo evidence."
        actions={
          <div className="flex flex-wrap gap-1 rounded-md border p-1">
            {FILTERS.map((option) => (
              <Button
                key={option}
                size="sm"
                variant={filter === option ? 'default' : 'ghost'}
                onClick={() => setFilter(option)}
              >
                {option === 'ALL' ? 'All' : humanise(option)}
              </Button>
            ))}
          </div>
        }
      />

      {filter === 'ALL' && rows.length > 0 && (
        <div className="mb-6 grid gap-4 sm:grid-cols-4">
          <StatCard label="Pending" value={String(counts.PENDING ?? 0)} tone="warning" />
          <StatCard label="In progress" value={String(counts.IN_PROGRESS ?? 0)} tone="primary" />
          <StatCard label="Resolved" value={String(counts.RESOLVED ?? 0)} tone="success" />
          <StatCard label="Rejected" value={String(counts.REJECTED ?? 0)} />
        </div>
      )}

      {tickets.isLoading ? (
        <LoadingState label="Loading tickets…" />
      ) : tickets.isError ? (
        <Alert tone="error" title="Could not load tickets">
          {errorMessage(tickets.error)}
        </Alert>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Wrench}
          title="Nothing to handle"
          description="No maintenance reports match this filter."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {rows.map((ticket) => (
            <Card key={ticket.id}>
              <CardContent className="space-y-3 pt-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold">{humanise(ticket.category)}</p>
                    <p className="text-sm text-muted-foreground">
                      Flat {ticket.flat?.flatNumber ?? '—'} · Floor {ticket.flat?.floor ?? '—'}
                    </p>
                  </div>
                  <TicketBadge status={ticket.status} />
                </div>

                <div className="rounded-md bg-muted/60 p-3 text-sm">
                  <p className="whitespace-pre-wrap">{ticket.description}</p>
                </div>

                {ticket.imageUrl && (
                  <a href={`${ASSET_ORIGIN}${ticket.imageUrl}`} target="_blank" rel="noreferrer">
                    <img
                      src={`${ASSET_ORIGIN}${ticket.imageUrl}`}
                      alt={`Photo from the ${humanise(ticket.category)} report`}
                      className="h-36 w-full rounded-md border object-cover"
                      loading="lazy"
                    />
                  </a>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
                  <div className="text-xs text-muted-foreground">
                    <p className="font-medium text-foreground">{ticket.user?.fullName}</p>
                    <p>{ticket.user?.phone}</p>
                    <p>Reported {formatDateTime(ticket.createdAt)}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {NEXT_ACTIONS[ticket.status].map((action) => (
                      <Button
                        key={action.status}
                        size="sm"
                        variant={action.variant}
                        loading={update.isPending && update.variables?.id === ticket.id}
                        onClick={() => update.mutate({ id: ticket.id, status: action.status })}
                      >
                        {action.label}
                      </Button>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
