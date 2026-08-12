import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Send, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/form-controls';
import { Alert, LoadingState } from '@/components/ui/feedback';
import { chatApi } from '@/services/endpoints';
import { errorMessage } from '@/services/api';
import { cn, formatDateTime, initials } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { getSocket, useSocket, useSocketEvent } from '@/hooks/useSocket';
import { toast } from '@/store/toast.store';
import type { ChatMessage } from '@/types';

const QUICK_COMMANDS = ['/rent', '/due', '/contact', '/rules'];

export function ChatPanel({
  partnerId,
  partnerName,
  showQuickCommands = true,
}: {
  partnerId?: string;
  partnerName: string;
  showQuickCommands?: boolean;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { isConnected } = useSocket();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const queryKey = useMemo(() => ['chat', 'thread', partnerId ?? 'admin'], [partnerId]);

  const thread = useQuery({
    queryKey,
    queryFn: () => chatApi.thread(partnerId),
  });

  const messages = thread.data?.messages ?? [];
  const resolvedPartnerId = thread.data?.partnerId ?? partnerId;

  // Append inbound messages that belong to this thread.
  useSocketEvent<ChatMessage>('chat:message', (message) => {
    const mine = message.senderId === user?.id || message.receiverId === user?.id;
    const inThread =
      !resolvedPartnerId ||
      message.senderId === resolvedPartnerId ||
      message.receiverId === resolvedPartnerId;
    if (!mine || !inThread) return;

    queryClient.setQueryData<{ partnerId: string; messages: ChatMessage[] }>(queryKey, (prev) => {
      if (!prev) return prev;
      if (prev.messages.some((m) => m.id === message.id)) return prev;
      return { ...prev, messages: [...prev.messages, message] };
    });
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length]);

  // Mark the thread read when it is on screen.
  useEffect(() => {
    if (resolvedPartnerId) getSocket()?.emit('chat:read', { partnerId: resolvedPartnerId });
  }, [resolvedPartnerId, messages.length]);

  const send = async (text: string) => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setDraft('');

    const socket = getSocket();
    try {
      if (socket?.connected) {
        // Socket path — the server echoes the persisted message back to us.
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Send timed out')), 8000);
          socket.emit(
            'chat:send',
            { receiverId: resolvedPartnerId, message: body },
            (ack: { success: boolean; error?: string }) => {
              clearTimeout(timer);
              ack?.success ? resolve() : reject(new Error(ack?.error ?? 'Send failed'));
            }
          );
        });
      } else {
        // REST fallback when the WebSocket is unavailable.
        await chatApi.send(body, resolvedPartnerId);
        await queryClient.invalidateQueries({ queryKey });
      }
    } catch (error) {
      setDraft(body);
      toast.error('Message not sent', errorMessage(error));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-[calc(100vh-13rem)] min-h-[420px] flex-col rounded-lg border bg-card">
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <div className="grid h-9 w-9 place-items-center rounded-full bg-accent text-sm font-semibold text-accent-foreground">
          {initials(partnerName)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{partnerName}</p>
          <p className="text-xs text-muted-foreground">
            {isConnected ? 'Live' : 'Offline — messages send over HTTP'}
          </p>
        </div>
        {!isConnected && <WifiOff className="h-4 w-4 text-warning" aria-label="Realtime offline" />}
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
        {thread.isLoading ? (
          <LoadingState label="Loading conversation…" />
        ) : thread.isError ? (
          <Alert tone="error" title="Could not load the conversation">
            {errorMessage(thread.error)}
          </Alert>
        ) : messages.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            <Bot className="mx-auto mb-2 h-8 w-8 opacity-50" />
            <p>No messages yet.</p>
            {showQuickCommands && (
              <p className="mt-1">
                Try <code className="rounded bg-muted px-1">/help</code> for instant answers.
              </p>
            )}
          </div>
        ) : (
          messages.map((message) => {
            const mine = message.senderId === user?.id;
            return (
              <div key={message.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
                <div
                  className={cn(
                    'max-w-[85%] rounded-lg px-3.5 py-2.5 sm:max-w-[70%]',
                    mine
                      ? 'bg-primary text-primary-foreground'
                      : message.isBot
                        ? 'border border-dashed bg-muted'
                        : 'bg-muted'
                  )}
                >
                  {message.isBot && (
                    <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <Bot className="h-3 w-3" /> AmarBari assistant
                    </p>
                  )}
                  <p className="whitespace-pre-wrap break-words text-sm">{message.message}</p>
                  <p
                    className={cn(
                      'mt-1 text-[11px]',
                      mine ? 'text-primary-foreground/70' : 'text-muted-foreground'
                    )}
                  >
                    {formatDateTime(message.createdAt)}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>

      {showQuickCommands && (
        <div className="flex flex-wrap gap-2 border-t px-4 py-2.5">
          {QUICK_COMMANDS.map((command) => (
            <button
              key={command}
              type="button"
              onClick={() => send(command)}
              disabled={sending}
              className="rounded-full border px-3 py-1 font-mono text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              {command}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft);
        }}
        className="flex items-center gap-2 border-t p-3"
      >
        <label htmlFor="chat-input" className="sr-only">
          Message
        </label>
        <Input
          id="chat-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Type a message…"
          autoComplete="off"
          maxLength={2000}
        />
        <Button type="submit" size="icon" disabled={!draft.trim() || sending} aria-label="Send message">
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}
