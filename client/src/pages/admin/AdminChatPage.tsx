import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MessagesSquare } from 'lucide-react';
import { PageHeader } from '@/components/StatCard';
import { ChatPanel } from '@/components/ChatPanel';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, EmptyState, LoadingState } from '@/components/ui/feedback';
import { chatApi } from '@/services/endpoints';
import { errorMessage } from '@/services/api';
import { cn, formatRelative, initials } from '@/lib/utils';
import { useSocketEvent } from '@/hooks/useSocket';
import type { ChatMessage } from '@/types';

export default function AdminChatPage() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);

  const conversations = useQuery({
    queryKey: ['admin', 'conversations'],
    queryFn: chatApi.conversations,
  });

  // Keep the inbox ordering and unread counts live.
  useSocketEvent<ChatMessage>('chat:message', () => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'conversations'] });
  });

  const rows = conversations.data ?? [];

  useEffect(() => {
    if (!selected && rows.length > 0) setSelected(rows[0]!.tenant.id);
  }, [rows, selected]);

  const active = rows.find((row) => row.tenant.id === selected);

  return (
    <>
      <PageHeader
        title="Messages"
        description="Tenant conversations. The assistant answers keyword questions before you step in."
      />

      {conversations.isLoading ? (
        <LoadingState label="Loading conversations…" />
      ) : conversations.isError ? (
        <Alert tone="error" title="Could not load conversations">
          {errorMessage(conversations.error)}
        </Alert>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={MessagesSquare}
          title="No approved tenants yet"
          description="Once a tenant is approved they can start a conversation with you."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <Card className="max-h-[calc(100vh-13rem)] overflow-y-auto">
            <CardContent className="p-2">
              <ul className="space-y-1">
                {rows.map((row) => (
                  <li key={row.tenant.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(row.tenant.id)}
                      aria-current={selected === row.tenant.id}
                      className={cn(
                        'flex w-full items-start gap-3 rounded-md p-3 text-left transition-colors',
                        selected === row.tenant.id ? 'bg-primary/10' : 'hover:bg-muted'
                      )}
                    >
                      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
                        {initials(row.tenant.fullName)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="truncate text-sm font-medium">{row.tenant.fullName}</p>
                          {row.lastMessage && (
                            <span className="shrink-0 text-[11px] text-muted-foreground">
                              {formatRelative(row.lastMessage.createdAt)}
                            </span>
                          )}
                        </div>
                        <p className="truncate text-xs text-muted-foreground">
                          {row.tenant.flatNumber ? `Flat ${row.tenant.flatNumber} · ` : ''}
                          {row.lastMessage?.message ?? 'No messages yet'}
                        </p>
                      </div>
                      {row.unread > 0 && <Badge variant="destructive">{row.unread}</Badge>}
                    </button>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {active ? (
            <ChatPanel
              key={active.tenant.id}
              partnerId={active.tenant.id}
              partnerName={`${active.tenant.fullName}${
                active.tenant.flatNumber ? ` · Flat ${active.tenant.flatNumber}` : ''
              }`}
              showQuickCommands={false}
            />
          ) : (
            <EmptyState title="Select a conversation" />
          )}
        </div>
      )}
    </>
  );
}
