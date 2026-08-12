import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Building2,
  Download,
  FileSpreadsheet,
  TrendingUp,
  UserCheck,
  Wallet,
  Wrench,
} from 'lucide-react';
import { PageHeader, StatCard } from '@/components/StatCard';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, LoadingState } from '@/components/ui/feedback';
import { Input, Label } from '@/components/ui/form-controls';
import { RevenueExpenseChart } from '@/components/charts/RevenueExpenseChart';
import { ExpenseCategoryChart } from '@/components/charts/ExpenseCategoryChart';
import { adminApi } from '@/services/endpoints';
import { errorMessage } from '@/services/api';
import { formatMoney } from '@/lib/utils';
import { toast } from '@/store/toast.store';

const currentYear = new Date().getFullYear();

export default function AdminDashboard() {
  const [from, setFrom] = useState(`${currentYear}-01-01`);
  const [to, setTo] = useState(`${currentYear}-12-31`);
  const [exporting, setExporting] = useState<'csv' | 'xlsx' | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['admin', 'analytics', from, to],
    queryFn: () => adminApi.analytics({ from, to }),
  });

  const exportFile = async (format: 'csv' | 'xlsx') => {
    setExporting(format);
    try {
      await adminApi.exportFinancials(format, { from, to });
      toast.success(`${format.toUpperCase()} export downloaded`);
    } catch (err) {
      toast.error('Export failed', errorMessage(err));
    } finally {
      setExporting(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Property overview"
        description="Revenue, expenses and occupancy across the portfolio."
        actions={
          <>
            <Button variant="outline" loading={exporting === 'csv'} onClick={() => exportFile('csv')}>
              <Download className="h-4 w-4" /> CSV
            </Button>
            <Button loading={exporting === 'xlsx'} onClick={() => exportFile('xlsx')}>
              <FileSpreadsheet className="h-4 w-4" /> Excel
            </Button>
          </>
        }
      />

      {/* Filters sit in one row above the charts. */}
      <div className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4">
        <div className="space-y-1.5">
          <Label htmlFor="from">From</Label>
          <Input
            id="from"
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
            className="w-auto"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="to">To</Label>
          <Input
            id="to"
            type="date"
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
            className="w-auto"
          />
        </div>
        <div className="flex gap-2">
          {[
            { label: 'This year', from: `${currentYear}-01-01`, to: `${currentYear}-12-31` },
            { label: 'Last year', from: `${currentYear - 1}-01-01`, to: `${currentYear - 1}-12-31` },
          ].map((preset) => (
            <Button
              key={preset.label}
              variant="ghost"
              size="sm"
              onClick={() => {
                setFrom(preset.from);
                setTo(preset.to);
              }}
            >
              {preset.label}
            </Button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <LoadingState label="Crunching the numbers…" />
      ) : isError ? (
        <Alert tone="error" title="Could not load analytics">
          {errorMessage(error)}
        </Alert>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Revenue (base rent)"
              value={formatMoney(data!.totals.totalRevenue)}
              hint="Collected flat rent only"
              icon={Wallet}
              tone="primary"
            />
            <StatCard
              label="Operating expenses"
              value={formatMoney(data!.totals.totalExpenses)}
              hint="Utilities, maintenance, services"
              icon={Building2}
            />
            <StatCard
              label="Net profit"
              value={formatMoney(data!.totals.netProfit)}
              hint="Revenue − expenses"
              icon={TrendingUp}
              tone={data!.totals.netProfit >= 0 ? 'success' : 'destructive'}
            />
            <StatCard
              label="Outstanding"
              value={formatMoney(data!.totals.totalOutstanding)}
              hint={`${formatMoney(data!.totals.totalCollected)} collected of ${formatMoney(
                data!.totals.totalBilled
              )} billed`}
              tone={data!.totals.totalOutstanding > 0 ? 'warning' : 'success'}
            />
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <StatCard
              label="Occupancy"
              value={`${data!.occupancy.rate}%`}
              hint={`${data!.occupancy.occupied} of ${data!.occupancy.flats} flats occupied`}
              icon={Building2}
            />
            <StatCard
              label="Pending approvals"
              value={String(data!.counts.pendingApprovals)}
              hint={`${data!.counts.tenants} tenants in total`}
              icon={UserCheck}
              tone={data!.counts.pendingApprovals > 0 ? 'warning' : 'default'}
            />
            <StatCard
              label="Open maintenance"
              value={String(data!.counts.openTickets)}
              hint="Pending or in progress"
              icon={Wrench}
              tone={data!.counts.openTickets > 0 ? 'warning' : 'success'}
            />
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader>
                <CardTitle>Revenue vs expenses</CardTitle>
                <CardDescription>
                  Monthly base-rent revenue against operating cost, with net profit
                </CardDescription>
              </CardHeader>
              <CardContent>
                <RevenueExpenseChart series={data!.series} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Expenses by category</CardTitle>
                <CardDescription>Where the operating budget goes</CardDescription>
              </CardHeader>
              <CardContent>
                <ExpenseCategoryChart data={data!.expenseByCategory} />
              </CardContent>
            </Card>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { to: '/admin/tenants', label: 'Review tenants', icon: UserCheck },
              { to: '/admin/invoices', label: 'Issue invoices', icon: Wallet },
              { to: '/admin/tickets', label: 'Resolve tickets', icon: Wrench },
              { to: '/admin/data', label: 'Data control', icon: Building2 },
            ].map(({ to, label, icon: Icon }) => (
              <Button key={to} asChild variant="outline" className="h-auto justify-start py-4">
                <Link to={to}>
                  <Icon className="h-4 w-4" />
                  {label}
                </Link>
              </Button>
            ))}
          </div>
        </>
      )}
    </>
  );
}
