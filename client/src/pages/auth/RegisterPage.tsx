import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AuthShell } from './AuthShell';
import { Button } from '@/components/ui/button';
import { Field, Input, PasswordInput, Select } from '@/components/ui/form-controls';
import { Alert } from '@/components/ui/feedback';
import { RegisterValues, registerSchema } from '@/lib/schemas';
import { IDENTITY_RULES } from '@/lib/identity';
import { authApi } from '@/services/endpoints';
import { errorMessage } from '@/services/api';
import { toast } from '@/store/toast.store';
import type { IdentityType } from '@/types';

const DIVISIONS = [
  'Dhaka', 'Chattogram', 'Khulna', 'Rajshahi',
  'Barishal', 'Sylhet', 'Rangpur', 'Mymensingh',
];

export default function RegisterPage() {
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      fullName: '',
      phone: '',
      password: '',
      confirmPassword: '',
      dob: '',
      familyMembers: 1,
      identityType: 'NID',
      identityNumber: '',
      village: '',
      postOffice: '',
      district: '',
      policeStation: '',
      division: 'Dhaka',
    },
  });

  const identityRule = IDENTITY_RULES[watch('identityType')] ?? IDENTITY_RULES.NID;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const { confirmPassword: _ignored, ...payload } = values;
      const result = await authApi.register({
        ...payload,
        dob: payload.dob || undefined,
      });

      // Phone verification is currently switched off server-side, which comes
      // back as `otp: null`. The screen and its route are still in place, so
      // re-enabling the step needs no change here.
      if (!result.otp) {
        toast.success('Account created', result.message);
        navigate('/login', { replace: true });
        return;
      }

      navigate('/verify', {
        state: {
          phone: result.user.phone,
          devCode: result.otp.devCode,
          expiresInSeconds: result.otp.expiresInSeconds,
        },
      });
    } catch (error) {
      setFormError(errorMessage(error, 'Registration failed'));
    }
  });

  return (
    <AuthShell
      wide
      title="Create your tenant account"
      subtitle="We verify every registration before granting access to a flat."
    >
      {formError && (
        <Alert tone="error" className="mb-5" title="Registration failed">
          {formError}
        </Alert>
      )}

      <form onSubmit={onSubmit} noValidate className="space-y-8">
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Personal details
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" htmlFor="fullName" error={errors.fullName?.message} required>
              <Input id="fullName" autoComplete="name" {...register('fullName')} />
            </Field>
            <Field label="Phone number" htmlFor="phone" error={errors.phone?.message} required
              hint="How your property admin will reach you">
              <Input id="phone" type="tel" inputMode="tel" placeholder="01712345678" {...register('phone')} />
            </Field>
            <Field label="Date of birth" htmlFor="dob" error={errors.dob?.message}>
              <Input id="dob" type="date" {...register('dob')} />
            </Field>
            <Field
              label="Total family members"
              htmlFor="familyMembers"
              error={errors.familyMembers?.message}
              required
            >
              <Input id="familyMembers" type="number" min={1} max={30} {...register('familyMembers')} />
            </Field>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Identity verification
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Identity type" htmlFor="identityType" error={errors.identityType?.message} required>
              <Select id="identityType" {...register('identityType')}>
                {(Object.keys(IDENTITY_RULES) as IdentityType[]).map((type) => (
                  <option key={type} value={type}>
                    {IDENTITY_RULES[type].label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Identity number"
              htmlFor="identityNumber"
              error={errors.identityNumber?.message}
              required
              // The expected shape changes with the document type, so the hint
              // has to track the select rather than sit as static copy.
              hint={identityRule.hint}
            >
              <Input
                id="identityNumber"
                inputMode={identityRule.inputMode}
                maxLength={identityRule.maxLength}
                placeholder={identityRule.placeholder}
                autoComplete="off"
                {...register('identityNumber')}
              />
            </Field>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Present address
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Village / street" htmlFor="village" error={errors.village?.message} required>
              <Input id="village" autoComplete="address-line1" {...register('village')} />
            </Field>
            <Field label="Post office" htmlFor="postOffice" error={errors.postOffice?.message} required>
              <Input id="postOffice" {...register('postOffice')} />
            </Field>
            <Field
              label="Police station (thana)"
              htmlFor="policeStation"
              error={errors.policeStation?.message}
              required
            >
              <Input id="policeStation" {...register('policeStation')} />
            </Field>
            <Field label="District" htmlFor="district" error={errors.district?.message} required>
              <Input id="district" autoComplete="address-level2" {...register('district')} />
            </Field>
            <Field label="Division" htmlFor="division" error={errors.division?.message} required>
              <Select id="division" {...register('division')}>
                {DIVISIONS.map((division) => (
                  <option key={division} value={division}>
                    {division}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Security
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Password" htmlFor="password" error={errors.password?.message} required
              hint="At least 8 characters, with a letter and a number">
              <PasswordInput id="password" autoComplete="new-password" {...register('password')} />
            </Field>
            <Field
              label="Confirm password"
              htmlFor="confirmPassword"
              error={errors.confirmPassword?.message}
              required
            >
              <PasswordInput
                id="confirmPassword"
                autoComplete="new-password"
                {...register('confirmPassword')}
              />
            </Field>
          </div>
        </section>

        <div className="flex flex-col gap-3 border-t pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            Already registered?{' '}
            <Link to="/login" className="font-medium text-primary underline-offset-4 hover:underline">
              Sign in
            </Link>
          </p>
          <Button type="submit" loading={isSubmitting} className="sm:w-auto">
            Create account
          </Button>
        </div>
      </form>
    </AuthShell>
  );
}
