import { zodResolver } from '@hookform/resolvers/zod';
import {
  createExerciseSchema,
  DIFFICULTY_LEVEL_LABELS,
  DIFFICULTY_LEVELS,
  MUSCLE_GROUP_LABELS,
  MUSCLE_GROUPS,
  WORKOUT_LIMITS,
  type ExerciseDto,
} from '@gms/shared';
import { ImagePlus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { ApiError, errorMessage } from '../../api/client';
import { Button, IconButton } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { FormField, Input, Select, Textarea } from '../../components/ui/form-field';
import { applyServerErrors } from '../../lib/forms';
import { ExerciseThumb } from './exercise-thumb';
import { useCreateExercise, useUpdateExercise, useUploadExerciseImage } from './workouts-api';

type FormInput = z.input<typeof createExerciseSchema>;
type FormOutput = z.output<typeof createExerciseSchema>;

const FORM_ID = 'exercise-form';
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const FIELDS = [
  'name',
  'muscleGroup',
  'difficulty',
  'equipmentNeeded',
  'description',
  'instructions',
];

const defaultsFor = (exercise?: ExerciseDto): FormInput => ({
  name: exercise?.name ?? '',
  muscleGroup: exercise?.muscleGroup ?? ('' as FormInput['muscleGroup']),
  difficulty: exercise?.difficulty ?? 'BEGINNER',
  equipmentNeeded: exercise?.equipmentNeeded ?? '',
  description: exercise?.description ?? '',
  instructions: exercise?.instructions ?? '',
});

/**
 * A chosen file and its preview URL. The URL is made when the file is picked and
 * released when it is replaced, cleared or the dialog unmounts.
 */
function useChosenFile() {
  const [chosen, setChosen] = useState<{ file: File; url: string } | null>(null);
  const urls = useRef(new Set<string>());
  useEffect(() => {
    const made = urls.current;
    return () => {
      made.forEach((url) => URL.revokeObjectURL(url));
      made.clear();
    };
  }, []);
  const choose = (file: File | null) => {
    urls.current.forEach((url) => URL.revokeObjectURL(url));
    urls.current.clear();
    if (!file) return setChosen(null);
    const url = URL.createObjectURL(file);
    urls.current.add(url);
    setChosen({ file, url });
  };
  return [chosen, choose] as const;
}

export function ExerciseFormDialog({
  exercise,
  open,
  onOpenChange,
}: {
  /** Edit this exercise; omit to add a new one. */
  exercise?: ExerciseDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const create = useCreateExercise();
  const update = useUpdateExercise();
  const upload = useUploadExerciseImage();
  const saving = create.isPending || update.isPending || upload.isPending;
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(createExerciseSchema),
    defaultValues: defaultsFor(exercise),
  });
  const fileInput = useRef<HTMLInputElement>(null);
  const [chosen, setFile] = useChosenFile();
  const file = chosen?.file ?? null;
  const [fileError, setFileError] = useState<string | null>(null);
  const { errors } = form.formState;

  const close = (next: boolean) => {
    if (!next) {
      form.reset(defaultsFor(exercise));
      setFile(null);
      setFileError(null);
    }
    onOpenChange(next);
  };

  const pick = (picked: File | undefined) => {
    if (fileInput.current) fileInput.current.value = '';
    if (!picked) return;
    // The server decides by the file's content; this check only saves a round trip.
    if (!IMAGE_TYPES.includes(picked.type)) {
      setFileError('Use a JPEG, PNG or WebP image.');
      return;
    }
    setFileError(null);
    setFile(picked);
  };

  const finish = (saved: ExerciseDto) => {
    const done = () => {
      toast.success(exercise ? `${saved.name} saved` : `${saved.name} added to the library`);
      onOpenChange(false);
      form.reset(defaultsFor(exercise ? saved : undefined));
      setFile(null);
    };
    if (!file) return done();
    upload.mutate(
      { id: saved.id, file },
      {
        onSuccess: done,
        onError: (error) => {
          // The details are saved; only the picture needs another try.
          toast.error(`${saved.name} was saved, but the picture was not: ${errorMessage(error)}`);
          onOpenChange(false);
          form.reset(defaultsFor(exercise ? saved : undefined));
          setFile(null);
        },
      },
    );
  };

  const onError = (error: unknown) => {
    if (error instanceof ApiError && error.code === 'DUPLICATE_EXERCISE_NAME') {
      form.setError('name', { type: 'server', message: error.message }, { shouldFocus: true });
      return;
    }
    if (!applyServerErrors(error, form.setError, FIELDS)) toast.error(errorMessage(error));
  };

  const submit = form.handleSubmit((values) => {
    if (exercise) update.mutate({ id: exercise.id, input: values }, { onSuccess: finish, onError });
    else create.mutate(values, { onSuccess: finish, onError });
  });

  const shown = chosen?.url ?? exercise?.imageUrl ?? null;

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={exercise ? `Edit ${exercise.name}` : 'New exercise'}
      description="Trainers pick exercises from the library when they build a plan. Members see the picture and the instructions."
      size="lg"
      busy={saving}
      footer={
        <>
          <Button variant="secondary" onClick={() => close(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID} loading={saving}>
            {exercise ? 'Save exercise' : 'Add exercise'}
          </Button>
        </>
      }
    >
      <form
        id={FORM_ID}
        onSubmit={submit}
        noValidate
        aria-label={exercise ? 'Edit exercise' : 'New exercise'}
        className="grid grid-cols-1 gap-4 sm:grid-cols-2"
      >
        <FormField label="Name" error={errors.name?.message} className="sm:col-span-2">
          <Input
            autoComplete="off"
            placeholder="e.g. Barbell back squat"
            {...form.register('name')}
          />
        </FormField>
        <FormField label="Muscle group" error={errors.muscleGroup?.message}>
          <Select {...form.register('muscleGroup')}>
            <option value="">Choose a muscle group</option>
            {MUSCLE_GROUPS.map((group) => (
              <option key={group} value={group}>
                {MUSCLE_GROUP_LABELS[group]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Difficulty" error={errors.difficulty?.message}>
          <Select {...form.register('difficulty')}>
            {DIFFICULTY_LEVELS.map((level) => (
              <option key={level} value={level}>
                {DIFFICULTY_LEVEL_LABELS[level]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField
          label="Equipment needed"
          optional
          error={errors.equipmentNeeded?.message}
          className="sm:col-span-2"
        >
          <Input
            autoComplete="off"
            maxLength={WORKOUT_LIMITS.equipmentNeededMax}
            placeholder="e.g. Barbell, squat rack"
            {...form.register('equipmentNeeded')}
          />
        </FormField>
        <FormField
          label="Short description"
          optional
          error={errors.description?.message}
          className="sm:col-span-2"
        >
          <Textarea
            rows={2}
            maxLength={WORKOUT_LIMITS.descriptionMax}
            {...form.register('description')}
          />
        </FormField>
        <FormField
          label="How to do it"
          optional
          error={errors.instructions?.message}
          hint="Step by step, as you would explain it on the floor."
          className="sm:col-span-2"
        >
          <Textarea
            rows={4}
            maxLength={WORKOUT_LIMITS.instructionsMax}
            {...form.register('instructions')}
          />
        </FormField>

        <div className="flex items-center gap-4 sm:col-span-2">
          <ExerciseThumb
            exercise={{ name: exercise?.name ?? 'New exercise', imageUrl: shown }}
            size="md"
          />
          <div className="flex min-w-0 flex-col items-start gap-1.5">
            <input
              ref={fileInput}
              type="file"
              accept={IMAGE_TYPES.join(',')}
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(event) => pick(event.target.files?.[0])}
              data-testid="exercise-image-input"
            />
            <div className="flex items-center gap-1">
              <Button
                variant="secondary"
                size="sm"
                icon={<ImagePlus aria-hidden />}
                onClick={() => fileInput.current?.click()}
              >
                {shown ? 'Replace picture' : 'Add picture'}
              </Button>
              {file && (
                <IconButton label="Remove chosen picture" onClick={() => setFile(null)}>
                  <X aria-hidden />
                </IconButton>
              )}
            </div>
            {fileError ? (
              <p role="alert" className="text-13 text-danger-text">
                {fileError}
              </p>
            ) : (
              <p className="truncate text-13 text-fg-muted">
                {file ? file.name : 'JPEG, PNG or WebP. Optional.'}
              </p>
            )}
          </div>
        </div>
      </form>
    </Dialog>
  );
}
