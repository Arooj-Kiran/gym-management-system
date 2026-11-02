import { SearchX } from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '../../api/client';
import { SearchInput } from '../../components/ui/search-input';
import { ListSkeleton } from '../../components/ui/states';
import { fullName } from '../../lib/auth';
import { cn } from '../../lib/cn';
import { MembershipStatusBadge } from '../memberships/membership-status-badge';
import { MemberAvatar } from './member-avatar';
import { useMemberList } from './members-api';

export interface PickedMember {
  id: string;
  memberCode: string;
  firstName: string;
  lastName: string;
  photoUrl: string | null;
}

export function MemberPicker({
  selected,
  onSelect,
  name = 'member-picker',
}: {
  selected: PickedMember | null;
  onSelect: (member: PickedMember) => void;
  /** Radio group name; unique per dialog. */
  name?: string;
}) {
  const [q, setQ] = useState('');
  const list = useMemberList({ q: q || undefined, pageSize: 6 });
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 text-13 font-medium text-fg">Member</legend>
      <SearchInput
        value={q}
        onChange={setQ}
        label="Search members"
        placeholder="Name, member code or phone"
      />
      <div className="max-h-64 overflow-y-auto rounded-md border border-border">
        {list.isPending ? (
          <ListSkeleton rows={3} label="Loading members" />
        ) : list.isError ? (
          <p role="alert" className="px-3 py-4 text-13 text-danger-text">
            {errorMessage(list.error)}
          </p>
        ) : list.data.data.length === 0 ? (
          <p className="flex items-center gap-2 px-3 py-4 text-13 text-fg-muted">
            <SearchX className="size-4" aria-hidden /> No members match “{q}”.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {list.data.data.map((member) => {
              const checked = selected?.id === member.id;
              return (
                <li key={member.id}>
                  <label
                    className={cn(
                      'flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors duration-150 hover:bg-surface-hover has-focus-visible:outline-2 has-focus-visible:-outline-offset-2 has-focus-visible:outline-focus',
                      checked && 'bg-primary-subtle hover:bg-primary-subtle',
                    )}
                  >
                    <input
                      type="radio"
                      name={name}
                      className="sr-only"
                      checked={checked}
                      onChange={() => onSelect(member)}
                    />
                    <MemberAvatar member={member} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-fg">
                        {fullName(member)}
                      </span>
                      <span className="block truncate font-mono text-xs text-fg-muted">
                        {member.memberCode}
                      </span>
                    </span>
                    {member.currentMembership && (
                      <MembershipStatusBadge status={member.currentMembership.effectiveStatus} />
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </fieldset>
  );
}
