import { useState } from 'react';
import { Avatar } from '../../components/ui/avatar';
import { cn } from '../../lib/cn';

const SIZES = { sm: 'size-7', md: 'size-8', lg: 'size-12', xl: 'size-24' };

/** The member's photo when there is one (and it loads), otherwise their initials. */
export function MemberAvatar({
  member,
  size = 'md',
  className,
}: {
  member: { firstName: string; lastName: string; photoUrl: string | null };
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  if (member.photoUrl && failed !== member.photoUrl) {
    return (
      <img
        src={member.photoUrl}
        alt=""
        loading="lazy"
        onError={() => setFailed(member.photoUrl)}
        className={cn(
          'shrink-0 rounded-full bg-surface-muted object-cover ring-1 ring-border',
          SIZES[size],
          className,
        )}
      />
    );
  }
  if (size === 'xl') {
    return <Avatar user={member} size="lg" className={cn('size-24 text-2xl', className)} />;
  }
  return <Avatar user={member} size={size} className={className} />;
}
