import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '@/store/auth.store';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ?? 'http://localhost:4000';

let socket: Socket | null = null;

/** Shared singleton so every hook consumer rides one connection. */
export function getSocket(): Socket | null {
  return socket;
}

export type SocketStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error';

/**
 * Connects once per session and keeps the connection status in state so the UI
 * can show a degraded-mode banner. Socket.io falls back from WebSocket to long
 * polling automatically (QA matrix 7.2).
 */
export function useSocket() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const [status, setStatus] = useState<SocketStatus>('idle');

  useEffect(() => {
    if (!accessToken) {
      socket?.disconnect();
      socket = null;
      setStatus('idle');
      return;
    }

    setStatus('connecting');
    socket = io(SOCKET_URL, {
      auth: { token: accessToken },
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      withCredentials: true,
    });

    const onConnect = () => setStatus('connected');
    const onDisconnect = () => setStatus('reconnecting');
    const onError = () => setStatus('error');

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onError);

    return () => {
      socket?.off('connect', onConnect);
      socket?.off('disconnect', onDisconnect);
      socket?.off('connect_error', onError);
      socket?.disconnect();
      socket = null;
    };
  }, [accessToken]);

  return { socket, status, isConnected: status === 'connected' };
}

/** Subscribes to one server event for the lifetime of the component. */
export function useSocketEvent<T = unknown>(event: string, handler: (payload: T) => void) {
  const saved = useRef(handler);
  saved.current = handler;

  useEffect(() => {
    const active = getSocket();
    if (!active) return;
    const listener = (payload: T) => saved.current(payload);
    active.on(event, listener);
    return () => {
      active.off(event, listener);
    };
    // Re-bind when the socket instance itself changes.
  }, [event, getSocket()]);
}
