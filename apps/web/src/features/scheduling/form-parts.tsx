import { TriangleAlert } from 'lucide-react';
import { Select } from '../../components/ui/form-field';
import { fullName } from '../../lib/auth';
import { useTrainers } from './scheduling-api';

export function FormProblem({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-md border border-danger/25 bg-danger-subtle px-3 py-2.5 text-13 text-danger-text"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p>{message}</p>
    </div>
  );
}

/** Active trainers as select options. `emptyLabel` adds a first "none / default" choice. */
export function TrainerSelect({
  value,
  onChange,
  emptyLabel,
  bookableOnly = false,
  ...props
}: {
  value: string;
  onChange: (value: string) => void;
  emptyLabel?: string;
  bookableOnly?: boolean;
  id?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
  'aria-label'?: string;
  className?: string;
}) {
  const trainers = useTrainers();
  const options = (trainers.data ?? []).filter(
    (trainer) => trainer.isActive && (!bookableOnly || trainer.isBookable || trainer.id === value),
  );
  return (
    <Select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={trainers.isPending}
      {...props}
    >
      {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
      {trainers.isPending && <option value={value}>Loading trainers…</option>}
      {options.map((trainer) => (
        <option key={trainer.id} value={trainer.id}>
          {bookableOnly && !trainer.hasWeeklyHours
            ? `${fullName(trainer)} (no weekly hours)`
            : fullName(trainer)}
        </option>
      ))}
    </Select>
  );
}
