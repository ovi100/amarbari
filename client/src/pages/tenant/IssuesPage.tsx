import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ImagePlus, Wrench, X } from 'lucide-react';
import { PageHeader } from '@/components/StatCard';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Select, Textarea } from '@/components/ui/form-controls';
import { Alert, EmptyState, LoadingState } from '@/components/ui/feedback';
import { TicketBadge } from '@/components/ui/badge';
import { ticketApi } from '@/services/endpoints';
import { API_BASE_URL, errorMessage } from '@/services/api';
import { formatDateTime, humanise } from '@/lib/utils';
import { toast } from '@/store/toast.store';
import {
  TICKET_IMAGE_ACCEPT,
  TicketValues,
  ticketSchema,
  validateTicketImage,
} from '@/lib/schemas';
import { useSocketEvent } from '@/hooks/useSocket';
import type { MaintenanceTicket } from '@/types';

const CATEGORIES = [
  'WINDOW_BROKEN',
  'ELECTRICITY_PROBLEM',
  'FAUCET_BROKEN',
  'WATER_LEAKAGE',
  'OTHER',
] as const;

const ASSET_ORIGIN = API_BASE_URL.replace(/\/api\/v1\/?$/, '');

export default function IssuesPage() {
  const queryClient = useQueryClient();
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<TicketValues>({
    resolver: zodResolver(ticketSchema),
    defaultValues: { category: 'OTHER', description: '' },
  });

  const tickets = useQuery({ queryKey: ['tickets', 'mine'], queryFn: () => ticketApi.list() });

  // Live status tracker — the admin's change lands without a reload.
  useSocketEvent<MaintenanceTicket>('ticket:updated', (ticket) => {
    queryClient.invalidateQueries({ queryKey: ['tickets'] });
    toast.info(
      'Maintenance update',
      `${humanise(ticket.category)} is now ${humanise(ticket.status)}`
    );
  });

  const clearImage = () => {
    setImage(null);
    setPreview((url) => {
      if (url) URL.revokeObjectURL(url);
      return null;
    });
    setImageError(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const onPickImage = (file: File | undefined) => {
    if (!file) return;
    // Shared with the server's upload filter so the two cannot drift apart.
    const error = validateTicketImage(file);
    if (error) {
      setImageError(error);
      return;
    }
    setImageError(null);
    setImage(file);
    setPreview(URL.createObjectURL(file));
  };

  const submit = useMutation({
    mutationFn: (values: TicketValues) => ticketApi.create({ ...values, image }),
    onSuccess: () => {
      toast.success('Issue reported', 'Your property admin has been notified.');
      reset();
      clearImage();
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
    },
    onError: (err) => toast.error('Could not submit your report', errorMessage(err)),
  });

  return (
    <>
      <PageHeader
        title="Maintenance & issues"
        description="Report a problem with your flat and track it through to resolution."
      />

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Report an issue</CardTitle>
            <CardDescription>A photo helps the admin triage it faster.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={handleSubmit((values) => submit.mutate(values))}
              noValidate
              className="space-y-4"
            >
              <Field label="Category" htmlFor="category" error={errors.category?.message} required>
                <Select id="category" {...register('category')}>
                  {CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {humanise(category)}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field
                label="What is wrong?"
                htmlFor="description"
                error={errors.description?.message}
                required
                hint="Include where in the flat, and since when."
              >
                <Textarea
                  id="description"
                  rows={5}
                  placeholder="Water has been leaking from the bathroom ceiling since Tuesday night…"
                  aria-invalid={Boolean(errors.description)}
                  {...register('description')}
                />
              </Field>

              <div className="space-y-2">
                <p className="text-sm font-medium">Photo (optional)</p>
                {preview ? (
                  <div className="relative w-fit">
                    <img
                      src={preview}
                      alt="Selected preview"
                      className="h-32 rounded-md border object-cover"
                    />
                    <button
                      type="button"
                      onClick={clearImage}
                      className="absolute -right-2 -top-2 rounded-full border bg-background p-1 shadow-sm"
                      aria-label="Remove photo"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <label className="flex cursor-pointer flex-col items-center gap-2 rounded-md border border-dashed p-6 text-center transition-colors hover:bg-muted/50">
                    <ImagePlus className="h-6 w-6 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      Tap to attach a photo (max 5MB)
                    </span>
                    <input
                      ref={fileRef}
                      type="file"
                      accept={TICKET_IMAGE_ACCEPT}
                      className="sr-only"
                      onChange={(e) => onPickImage(e.target.files?.[0])}
                    />
                  </label>
                )}
                {imageError && (
                  <p role="alert" className="text-xs font-medium text-destructive">
                    {imageError}
                  </p>
                )}
              </div>

              <Button type="submit" className="w-full" loading={submit.isPending}>
                Submit report
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>My reports</CardTitle>
            <CardDescription>Status updates appear here in real time.</CardDescription>
          </CardHeader>
          <CardContent>
            {tickets.isLoading ? (
              <LoadingState label="Loading your reports…" />
            ) : tickets.isError ? (
              <Alert tone="error" title="Could not load your reports">
                {errorMessage(tickets.error)}
              </Alert>
            ) : tickets.data!.tickets.length === 0 ? (
              <EmptyState
                icon={Wrench}
                title="No reports yet"
                description="When something breaks, report it here and track the fix."
              />
            ) : (
              <ul className="space-y-3">
                {tickets.data!.tickets.map((ticket) => (
                  <li key={ticket.id} className="rounded-lg border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium">{humanise(ticket.category)}</p>
                        <p className="text-xs text-muted-foreground">
                          Reported {formatDateTime(ticket.createdAt)}
                        </p>
                      </div>
                      <TicketBadge status={ticket.status} />
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                      {ticket.description}
                    </p>
                    {ticket.imageUrl && (
                      <a
                        href={`${ASSET_ORIGIN}${ticket.imageUrl}`}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 inline-block"
                      >
                        <img
                          src={`${ASSET_ORIGIN}${ticket.imageUrl}`}
                          alt={`Photo attached to the ${humanise(ticket.category)} report`}
                          className="h-28 rounded-md border object-cover"
                          loading="lazy"
                        />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
