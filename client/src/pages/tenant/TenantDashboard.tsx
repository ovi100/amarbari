import { useQuery } from '@tanstack/react-query';
import { unitNoun, unitOf } from '@/lib/unit';
import { Link } from 'react-router-dom';
import {
  CalendarClock,
  Home,
  MessageSquare,
  PiggyBank,
  Receipt,
  TrendingDown,
  Wrench,
} from 'lucide-react';
import { PageHeader, StatCard } from '@/components/StatCard';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, EmptyState, LoadingState } from '@/components/ui/feedback';
import { PaymentBadge, TicketBadge } from '@/components/ui/badge';
import { rentApi, ticketApi } from '@/services/endpoints';
import { errorMessage } from '@/services/api';
import { formatDate, formatMoney, monthLabel } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';

export default function TenantDashboard() {
  const { user } = useAuth();

  const rent = useQuery({ queryKey: ['rent', 'summary'], queryFn: rentApi.summary, retry: 1 });
  const tickets = useQuery({
    queryKey: ['tickets', 'mine'],
    queryFn: () => ticketApi.list({ pageSize: 5 }),
  });

  if (rent.isLoading) return <LoadingState label="Loading your dashboard…" />;

  if (rent.isError) {
    return (
      <>
        <PageHeader title={`Welcome, ${user?.fullName.split(' ')[0] ?? 'there'}`} />
        <Alert tone="warning" title="No active tenancy yet">
          {errorMessage(rent.error)} Once an administrator assigns you a flat or shop, your rent
          breakdown and tenancy details will appear here.
        </Alert>
      </>
    );
  }

  const summary = rent.data!;
  const { tenancy, currentInvoice, totals } = summary;
  // The account may hold a flat or a shop; `unit` resolves whichever it is.
  const unit = unitOf({ ...tenancy, flat: summary.flat, shop: summary.shop });
  const openTickets = (tickets.data?.tickets ?? []).filter(
    (t) => t.status === 'PENDING' || t.status === 'IN_PROGRESS'
  );

  return (
    <>
      <PageHeader
        title={`Welcome, ${user?.fullName.split(' ')[0] ?? 'there'}`}
        description={unit ? `${unit.label} · ${unit.location}` : undefined}
        actions={
          <>
            <Button asChild variant="outline">
              <Link to="/app/issues">
                <Wrench className="h-4 w-4" /> Report an issue
              </Link>
            </Button>
            <Button asChild>
              <Link to="/app/rent">
                <Receipt className="h-4 w-4" /> View rent
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="This month's bill"
          value={currentInvoice ? formatMoney(currentInvoice.totalAmount) : '—'}
          hint={
            currentInvoice
              ? `Due ${formatDate(currentInvoice.dueDate)}`
              : 'Not issued yet for this month'
          }
          icon={Receipt}
          tone="primary"
        />
        <StatCard
          label="Outstanding balance"
          value={formatMoney(totals.totalOutstanding)}
          hint={
            totals.accumulatedDue > 0
              ? `${formatMoney(totals.accumulatedDue)} carried to next month`
              : 'Nothing carried forward'
          }
          icon={TrendingDown}
          tone={totals.totalOutstanding > 0 ? 'destructive' : 'success'}
        />
        <StatCard
          label="Advance deposit"
          value={formatMoney(totals.advanceDeposit)}
          hint="Available to offset a deferred bill"
          icon={PiggyBank}
          tone="success"
        />
        <StatCard
          label={`Time in this ${unit ? unitNoun(unit.category) : 'unit'}`}
          value={tenancy.duration.label}
          hint={`Since ${formatDate(tenancy.startDate)}`}
          icon={CalendarClock}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Current bill breakdown</CardTitle>
            <CardDescription>
              {currentInvoice
                ? monthLabel(currentInvoice.month, currentInvoice.year)
                : 'No invoice for the current cycle'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {currentInvoice ? (
              <>
                <dl className="divide-y">
                  {[
                    ['Rent', currentInvoice.flatRent],
                    ['Electricity bill', currentInvoice.electricityBill],
                    ['Water bill', currentInvoice.waterBill],
                    ['Internet bill', currentInvoice.internetBill],
                    ['Utility & service charge', currentInvoice.utilityBill],
                    ['Previous due', currentInvoice.previousDue],
                  ].map(([label, amount]) => (
                    <div key={label as string} className="flex justify-between py-2.5 text-sm">
                      <dt className="text-muted-foreground">{label as string}</dt>
                      <dd className="font-medium tabular-nums">{formatMoney(amount as number)}</dd>
                    </div>
                  ))}
                  <div className="flex items-center justify-between pt-3 text-base">
                    <dt className="font-semibold">Total</dt>
                    <dd className="font-semibold tabular-nums">
                      {formatMoney(currentInvoice.totalAmount)}
                    </dd>
                  </div>
                </dl>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <PaymentBadge status={currentInvoice.paymentStatus} />
                  <span className="text-sm text-muted-foreground">
                    {formatMoney(currentInvoice.outstanding)} outstanding
                  </span>
                  <Button asChild size="sm" variant="outline" className="ml-auto">
                    <Link to="/app/rent">Manage this bill</Link>
                  </Button>
                </div>
              </>
            ) : (
              <EmptyState
                icon={Receipt}
                title="No invoice yet"
                description="Your administrator has not issued this month's invoice. Past invoices are on the Rent page."
              />
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Open maintenance</CardTitle>
              <CardDescription>Issues currently being handled</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {openTickets.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">
                  Nothing open. Everything looks in order.
                </p>
              ) : (
                openTickets.map((ticket) => (
                  <div key={ticket.id} className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {ticket.category.replace(/_/g, ' ').toLowerCase()}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {formatDate(ticket.createdAt)}
                      </p>
                    </div>
                    <TicketBadge status={ticket.status} />
                  </div>
                ))
              )}
              <Button asChild variant="outline" size="sm" className="w-full">
                <Link to="/app/issues">All my reports</Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Need help?</CardTitle>
              <CardDescription>Chat with your property admin</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-sm text-muted-foreground">
                Ask the assistant <code className="rounded bg-muted px-1">/rent</code>,{' '}
                <code className="rounded bg-muted px-1">/due</code> or{' '}
                <code className="rounded bg-muted px-1">/contact</code> for an instant answer.
              </p>
              <Button asChild className="w-full">
                <Link to="/app/chat">
                  <MessageSquare className="h-4 w-4" /> Open chat
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Home className="h-4 w-4" /> Your {unit ? unitNoun(unit.category) : 'unit'}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Flat</span>
                <span className="font-medium">{unit?.number ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Location</span>
                <span className="font-medium">{unit?.location ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Base rent</span>
                <span className="font-medium tabular-nums">{formatMoney(unit?.baseRent)}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
