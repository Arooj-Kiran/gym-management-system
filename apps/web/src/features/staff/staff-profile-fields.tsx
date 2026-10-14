import type { FieldErrors, UseFormRegister } from 'react-hook-form';
import { FormField, Input, Textarea } from '../../components/ui/form-field';
import type { StaffProfileValues } from './staff-profile';

export function StaffProfileFields<T extends StaffProfileValues>({
  register,
  errors,
  disabled,
}: {
  register: UseFormRegister<T>;
  errors: FieldErrors<T>;
  disabled?: boolean;
}) {
  // The generic form type is a superset of the profile fields; narrow once here.
  const reg = register as unknown as UseFormRegister<StaffProfileValues>;
  const err = errors as FieldErrors<StaffProfileValues>;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <FormField label="First name" error={err.firstName?.message}>
        <Input autoComplete="off" disabled={disabled} {...reg('firstName')} />
      </FormField>
      <FormField label="Last name" error={err.lastName?.message}>
        <Input autoComplete="off" disabled={disabled} {...reg('lastName')} />
      </FormField>
      <FormField
        label="Work email"
        error={err.email?.message}
        hint="Used to sign in."
        className="sm:col-span-2"
      >
        <Input type="email" autoComplete="off" disabled={disabled} {...reg('email')} />
      </FormField>
      <FormField
        label="Phone"
        optional
        error={err.phone?.message}
        hint="Numbers without +92 are read as Pakistani."
      >
        <Input
          type="tel"
          inputMode="tel"
          autoComplete="off"
          disabled={disabled}
          {...reg('phone')}
        />
      </FormField>
      <FormField label="Job title" optional error={err.jobTitle?.message}>
        <Input autoComplete="off" disabled={disabled} {...reg('jobTitle')} />
      </FormField>
      <FormField label="Hire date" optional error={err.hireDate?.message}>
        <Input type="date" disabled={disabled} {...reg('hireDate')} />
      </FormField>
      <FormField
        label="Internal notes"
        optional
        error={err.notes?.message}
        className="sm:col-span-2"
      >
        <Textarea rows={3} maxLength={1000} disabled={disabled} {...reg('notes')} />
      </FormField>
    </div>
  );
}
