import { ACCESS_REASON_LABELS, type MemberSummaryDto } from '@gms/shared';
import { CircleCheck, CircleX, Search, UserRoundCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { errorMessage } from '../../api/client';
import { Card, CardHeader } from '../../components/ui/card';
import { fullName } from '../../lib/auth';
import { MemberAvatar } from '../members/member-avatar';
import { useMemberList } from '../members/members-api';
import { MembershipStatusBadge } from '../memberships/membership-status-badge';
import { useManualCheckIn } from '../attendance/attendance-api';

const SEARCH_DELAY_MS = 250;
const SEARCH_PAGE_SIZE = 8;
const MANUAL_REASON = 'Manual Desk Entry';

function membershipStatus(member: MemberSummaryDto) {
  if (member.currentMembership) {
    return <MembershipStatusBadge status={member.currentMembership.effectiveStatus} />;
  }
  return (
    <span className="rounded-sm bg-surface-muted px-1.5 py-0.5 text-xs font-medium text-fg-muted">
      No membership
    </span>
  );
}

export function CheckInDesk() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [denialMessage, setDenialMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const checkIn = useManualCheckIn();
  const query = useMemberList(
    { q: debouncedSearch || undefined, pageSize: SEARCH_PAGE_SIZE },
    debouncedSearch.length > 0,
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setActiveIndex(0);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const searching = search.trim().length > 0;
  const queryIsCurrent = search.trim() === debouncedSearch;
  const searchingQuery = !queryIsCurrent || query.isPending || query.isPlaceholderData;
  const results = searchingQuery ? [] : (query.data?.data ?? []);

  const submit = (member: MemberSummaryDto) => {
    if (checkIn.isPending) return;
    setDenialMessage(null);
    checkIn.mutate(
      { memberId: member.id, reason: MANUAL_REASON },
      {
        onSuccess: (decision) => {
          if (decision.decision === 'GRANTED' && decision.reason === 'GRANTED') {
            toast.success(
              decision.duplicate
                ? `${fullName(member)} was already checked in a moment ago`
                : `${fullName(member)} checked in`,
            );
            setSearch('');
            setDebouncedSearch('');
            setActiveIndex(0);
            inputRef.current?.focus();
            return;
          }
          setDenialMessage(`${ACCESS_REASON_LABELS[decision.reason]}: ${decision.message}`);
        },
        onError: (error) => toast.error(errorMessage(error)),
      },
    );
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && results.length > 0) {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % results.length);
    } else if (event.key === 'ArrowUp' && results.length > 0) {
      event.preventDefault();
      setActiveIndex((index) => (index + results.length - 1) % results.length);
    } else if (event.key === 'Enter' && results.length > 0) {
      event.preventDefault();
      submit(results[Math.min(activeIndex, results.length - 1)]!);
    }
  };

  return (
    <Card className="mb-6">
      <CardHeader
        title="Fast manual check-in"
        description="Search by member name, phone number, or member code. Select a result or press Enter to check in."
      />
      <div className="px-4 pb-4 sm:px-5 sm:pb-5">
        <label htmlFor="check-in-member-search" className="sr-only">
          Search members by name, phone, or member code
        </label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-fg-muted"
            aria-hidden
          />
          <input
            ref={inputRef}
            id="check-in-member-search"
            type="search"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={searching}
            aria-controls="check-in-member-results"
            aria-activedescendant={
              results[activeIndex] ? `check-in-member-${results[activeIndex].id}` : undefined
            }
            autoComplete="off"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setDenialMessage(null);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Name, phone number, or code (e.g. GM-000001)"
            className="h-14 w-full rounded-lg border border-border-strong bg-surface pr-4 pl-11 text-base text-fg shadow-xs placeholder:text-fg-muted focus:border-primary focus:ring-3 focus:ring-primary/20 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
          />
        </div>

        {searching && (
          <div
            id="check-in-member-results"
            role="listbox"
            aria-label="Matching members"
            className="mt-2 max-h-80 overflow-y-auto rounded-lg border border-border bg-surface"
          >
            {searchingQuery ? (
              <p className="px-4 py-3 text-sm text-fg-muted" role="status">
                Searching members…
              </p>
            ) : query.isError ? (
              <p className="px-4 py-3 text-sm text-danger-text" role="alert">
                {errorMessage(query.error)}
              </p>
            ) : results.length === 0 ? (
              <p className="px-4 py-3 text-sm text-fg-muted">
                No members match “{debouncedSearch}”.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {results.map((member, index) => (
                  <li key={member.id}>
                    <button
                      id={`check-in-member-${member.id}`}
                      type="button"
                      role="option"
                      aria-selected={index === activeIndex}
                      disabled={checkIn.isPending}
                      onMouseEnter={() => setActiveIndex(index)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => submit(member)}
                      className={`flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus disabled:cursor-wait disabled:opacity-60 sm:px-4 ${index === activeIndex ? 'bg-primary-subtle' : ''}`}
                    >
                      <MemberAvatar member={member} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-fg">
                          {fullName(member)}
                        </span>
                        <span className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-13 text-fg-muted">
                          <span className="font-mono">{member.memberCode}</span>
                          <span>{member.phone}</span>
                        </span>
                      </span>
                      {membershipStatus(member)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {checkIn.isPending && (
          <p className="mt-3 flex items-center gap-2 text-sm text-fg-muted" role="status">
            <UserRoundCheck className="size-4" aria-hidden />
            Checking member access…
          </p>
        )}

        {denialMessage && (
          <div
            role="alert"
            className="mt-3 flex items-start gap-2 rounded-md border border-danger/25 bg-danger-subtle px-3 py-3 text-sm text-danger-text"
          >
            <CircleX className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              <strong>Access denied.</strong> {denialMessage}
            </span>
          </div>
        )}

        {!searching && !denialMessage && (
          <p className="mt-2 flex items-center gap-2 text-13 text-fg-muted">
            <CircleCheck className="size-4" aria-hidden />
            Scanner check-in remains available below.
          </p>
        )}
      </div>
    </Card>
  );
}
