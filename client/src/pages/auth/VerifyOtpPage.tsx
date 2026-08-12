import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { MessageCircle, MessageSquare, Smartphone } from 'lucide-react';
import { AuthShell } from './AuthShell';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form-controls';
import { Alert } from '@/components/ui/feedback';
import { OtpValues, otpSchema } from '@/lib/schemas';
import { authApi, type OtpChannel } from '@/services/endpoints';
import { errorMessage } from '@/services/api';
import { toast } from '@/store/toast.store';

interface VerifyState {
  phone?: string;
  devCode?: string;
  expiresInSeconds?: number;
}

/** SMS goes out over Twilio; the other two ride the free messaging providers. */
const CHANNELS: { value: OtpChannel; label: string; icon: typeof MessageCircle }[] = [
  { value: 'WHATSAPP', label: 'WhatsApp', icon: MessageCircle },
  { value: 'IMO', label: 'IMO', icon: Smartphone },
  { value: 'SMS', label: 'SMS', icon: MessageSquare },
];

export default function VerifyOtpPage() {
  const navigate = useNavigate();
  const state = (useLocation().state ?? {}) as VerifyState;

  const [phone] = useState(state.phone ?? '');
  const [channel, setChannel] = useState<OtpChannel>('WHATSAPP');
  const [devCode, setDevCode] = useState(state.devCode);
  const [secondsLeft, setSecondsLeft] = useState(state.expiresInSeconds ?? 0);
  const [formError, setFormError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<OtpValues>({ resolver: zodResolver(otpSchema), defaultValues: { code: '' } });

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [secondsLeft]);

  if (!phone) {
    return (
      <AuthShell title="Verify your phone">
        <Alert tone="warning" title="No phone number in this session">
          Start from the registration form, or sign in to have a fresh code sent.
        </Alert>
        <div className="mt-4 flex gap-3">
          <Button asChild variant="outline">
            <Link to="/register">Register</Link>
          </Button>
          <Button asChild>
            <Link to="/login">Sign in</Link>
          </Button>
        </div>
      </AuthShell>
    );
  }

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const result = await authApi.verifyOtp(phone, values.code);
      toast.success('Phone verified', result.message);
      navigate('/login', { replace: true });
    } catch (error) {
      setFormError(errorMessage(error, 'Verification failed'));
    }
  });

  const resend = async () => {
    setResending(true);
    setFormError(null);
    try {
      const result = await authApi.sendOtp(phone, channel);
      setDevCode(result.devCode);
      setSecondsLeft(result.expiresInSeconds);
      toast.success(`Code sent over ${CHANNELS.find((c) => c.value === channel)!.label}`);
    } catch (error) {
      setFormError(errorMessage(error, 'Could not resend the code'));
    } finally {
      setResending(false);
    }
  };

  const mmss = `${String(Math.floor(secondsLeft / 60)).padStart(2, '0')}:${String(
    secondsLeft % 60
  ).padStart(2, '0')}`;

  return (
    <AuthShell
      title="Verify your phone"
      subtitle={`We sent a 6-digit code to ${phone}. It expires in 3 minutes.`}
    >
      {devCode && (
        <Alert tone="info" className="mb-4" title="Development mode">
          No messaging gateway is configured, so the code is shown here:{' '}
          <span className="font-mono text-base font-semibold tracking-widest text-foreground">
            {devCode}
          </span>
        </Alert>
      )}

      {formError && (
        <Alert tone="error" className="mb-4" title="Verification failed">
          {formError}
        </Alert>
      )}

      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Field label="6-digit code" htmlFor="code" error={errors.code?.message} required>
          <Input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="000000"
            className="text-center font-mono text-2xl tracking-[0.6em]"
            aria-invalid={Boolean(errors.code)}
            {...register('code')}
          />
        </Field>

        <p className="text-center text-sm text-muted-foreground" aria-live="polite">
          {secondsLeft > 0 ? `Code expires in ${mmss}` : 'Your code has expired — request a new one.'}
        </p>

        <Button type="submit" className="w-full" loading={isSubmitting}>
          Verify phone number
        </Button>
      </form>

      <div className="mt-6 space-y-3 border-t pt-5">
        <p className="text-sm font-medium">Didn’t get the code? Resend over:</p>
        <div className="grid grid-cols-3 gap-2">
          {CHANNELS.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => setChannel(value)}
              aria-pressed={channel === value}
              className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2.5 text-sm font-medium transition-colors ${
                channel === value
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>
        <Button variant="outline" className="w-full" onClick={resend} loading={resending}>
          Resend code
        </Button>
      </div>
    </AuthShell>
  );
}
