import { Dumbbell } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../../lib/cn';

const SIZES = {
  sm: 'size-10 rounded-md [&_svg]:size-4',
  md: 'size-14 rounded-lg [&_svg]:size-5',
  cover: 'aspect-[4/3] w-full rounded-t-lg [&_svg]:size-7',
};

/** The exercise picture, or a calm placeholder when there is none (or it fails to load). */
export function ExerciseThumb({
  exercise,
  size = 'sm',
  className,
}: {
  exercise: { name: string; imageUrl: string | null };
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const showImage = exercise.imageUrl && failed !== exercise.imageUrl;
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden bg-surface-muted text-fg-muted ring-1 ring-border ring-inset',
        SIZES[size],
        className,
      )}
    >
      {showImage ? (
        <img
          src={exercise.imageUrl!}
          alt=""
          loading="lazy"
          className="size-full object-cover"
          onError={() => setFailed(exercise.imageUrl)}
        />
      ) : (
        <Dumbbell aria-hidden />
      )}
    </span>
  );
}
