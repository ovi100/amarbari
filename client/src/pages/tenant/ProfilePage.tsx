import { useQuery } from '@tanstack/react-query';
import { BadgeCheck, ShieldCheck } from 'lucide-react';
import { PageHeader } from '@/components/StatCard';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LoadingState } from '@/components/ui/feedback';
import { authApi } from '@/services/endpoints';
import { formatDate, formatMoney, humanise } from '@/lib/utils';

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b py-2.5 last:border-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  );
}

export default function ProfilePage() {
  const { data, isLoading } = useQuery({ queryKey: ['auth', 'me'], queryFn: authApi.me });

  if (isLoading || !data) return <LoadingState label="Loading your profile…" />;

  return (
    <>
      <PageHeader
        title="My profile"
        description="Contact your property admin to correct any of these details."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Personal details</CardTitle>
            <CardDescription>As submitted at registration</CardDescription>
          </CardHeader>
          <CardContent>
            <dl>
              <Row label="Full name" value={data.fullName} />
              <Row label="Phone number" value={data.phone} />
              <Row label="Date of birth" value={formatDate(data.dob)} />
              <Row label="Family members" value={data.familyMembers} />
              <Row label="Member since" value={formatDate(data.createdAt)} />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Identity &amp; verification</CardTitle>
            <CardDescription>Required before a flat can be allocated</CardDescription>
          </CardHeader>
          <CardContent>
            <dl>
              <Row label="Identity type" value={humanise(data.identityType)} />
              <Row label="Identity number" value={<span className="font-mono">{data.identityNumber}</span>} />
              <Row
                label="Phone verified"
                value={
                  data.isPhoneVerified ? (
                    <Badge variant="success">
                      <BadgeCheck className="mr-1 h-3 w-3" /> Verified
                    </Badge>
                  ) : (
                    <Badge variant="warning">Not verified</Badge>
                  )
                }
              />
              <Row
                label="Account approved"
                value={
                  data.isApproved ? (
                    <Badge variant="success">
                      <ShieldCheck className="mr-1 h-3 w-3" /> Approved
                    </Badge>
                  ) : (
                    <Badge variant="warning">Pending review</Badge>
                  )
                }
              />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Present address</CardTitle>
          </CardHeader>
          <CardContent>
            <dl>
              <Row label="Village / street" value={data.village} />
              <Row label="Post office" value={data.postOffice} />
              <Row label="Police station (thana)" value={data.policeStation} />
              <Row label="District" value={data.district} />
              <Row label="Division" value={data.division} />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Tenancy</CardTitle>
            <CardDescription>Your current flat allocation</CardDescription>
          </CardHeader>
          <CardContent>
            {data.tenancy ? (
              <dl>
                <Row label="Flat" value={data.tenancy.flat.flatNumber} />
                <Row label="Floor" value={data.tenancy.flat.floor} />
                <Row label="Building" value={data.tenancy.flat.building} />
                <Row label="Base rent" value={formatMoney(data.tenancy.flat.baseRent)} />
                <Row label="Moved in" value={formatDate(data.tenancy.startDate)} />
                <Row label="Advance deposit" value={formatMoney(data.tenancy.advanceDeposit)} />
                <Row label="Carried-over due" value={formatMoney(data.tenancy.accumulatedDue)} />
              </dl>
            ) : (
              <p className="py-4 text-sm text-muted-foreground">
                No flat has been allocated to your account yet.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
