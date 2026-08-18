import { useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AuthShell } from './AuthShell';
import { Button } from '@/components/ui/button';
import { Field, Input, PasswordInput } from '@/components/ui/form-controls';
import { Alert } from '@/components/ui/feedback';
import { LoginValues, loginSchema } from '@/lib/schemas';
import { useAuth } from '@/hooks/useAuth';
import { errorCode, errorMessage } from '@/services/api';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const [formError, setFormError] = useState<string | null>(null);
  const [unverifiedPhone, setUnverifiedPhone] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { phone: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    setUnverifiedPhone(null);
    try {
      const user = await login(values.phone, values.password);
      const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname;
      navigate(from ?? (user.role === 'ADMIN' ? '/admin' : '/app'), { replace: true });
    } catch (error) {
      if (errorCode(error) === 'PHONE_UNVERIFIED') setUnverifiedPhone(values.phone);
      setFormError(errorMessage(error, 'Could not sign you in'));
    }
  });

  return (
    <AuthShell title="Welcome back" subtitle="Sign in to manage your rent, bills and requests.">
      {params.get('expired') && (
        <Alert tone="warning" className="mb-4" title="Session expired">
          Please sign in again to continue.
        </Alert>
      )}

      {formError && (
        <Alert tone="error" className="mb-4" title="Sign-in failed">
          {formError}
          {unverifiedPhone && (
            <div className="mt-2">
              <Link
                to="/verify"
                state={{ phone: unverifiedPhone }}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                Verify your phone number →
              </Link>
            </div>
          )}
        </Alert>
      )}

      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Field label="Phone number" htmlFor="phone" error={errors.phone?.message} required>
          <Input
            id="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="Enter your phone number"
            aria-invalid={Boolean(errors.phone)}
            {...register('phone')}
          />
        </Field>

        <Field label="Password" htmlFor="password" error={errors.password?.message} required>
          <PasswordInput
            id="password"
            autoComplete="current-password"
            placeholder="Enter your password"
            aria-invalid={Boolean(errors.password)}
            {...register('password')}
          />
        </Field>

        <Button type="submit" className="w-full" loading={isSubmitting}>
          Sign in
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        New tenant?{' '}
        <Link to="/register" className="font-medium text-primary underline-offset-4 hover:underline">
          Create an account
        </Link>
      </p>
    </AuthShell>
  );
}
