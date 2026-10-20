import type {
  BiometricEnrollmentDto,
  EnrollInput,
  GiveConsentInput,
  MemberBiometricStatus,
  RevokeEnrollmentInput,
  WithdrawConsentInput,
} from '@gms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { queryKeys } from '../../api/query-keys';

export function useMemberBiometric(memberId: string) {
  return useQuery({
    queryKey: queryKeys.members.biometric(memberId),
    queryFn: ({ signal }) =>
      api.get<MemberBiometricStatus>(`/members/${memberId}/biometric`, { signal }),
  });
}

/**
 * Consent changes return the member's full status; enroll and revoke return the enrollment, so
 * the status is fetched again. The simulator's fingerprint list changes with them.
 */
function useBiometricMutation<
  TInput,
  TResult extends MemberBiometricStatus | BiometricEnrollmentDto,
>(memberId: string, request: (input: TInput) => Promise<TResult>) {
  const queryClient = useQueryClient();
  const key = queryKeys.members.biometric(memberId);
  return useMutation({
    mutationFn: request,
    onSuccess: (result) => {
      if ('enrollments' in result) queryClient.setQueryData(key, result);
      else void queryClient.invalidateQueries({ queryKey: key });
      return queryClient.invalidateQueries({ queryKey: queryKeys.access.fixtures });
    },
    onError: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}

export const useGiveConsent = (memberId: string) =>
  useBiometricMutation(memberId, (input: GiveConsentInput) =>
    api.post<MemberBiometricStatus>(`/members/${memberId}/biometric/consent`, input),
  );

export const useWithdrawConsent = (memberId: string) =>
  useBiometricMutation(memberId, (input: WithdrawConsentInput) =>
    api.post<MemberBiometricStatus>(`/members/${memberId}/biometric/consent/withdraw`, input),
  );

export const useEnroll = (memberId: string) =>
  useBiometricMutation(memberId, (input: EnrollInput) =>
    api.post<BiometricEnrollmentDto>(`/members/${memberId}/biometric/enrollments`, input),
  );

export const useRevokeEnrollment = (memberId: string) =>
  useBiometricMutation(memberId, ({ id, ...input }: RevokeEnrollmentInput & { id: string }) =>
    api.post<BiometricEnrollmentDto>(`/biometric/enrollments/${id}/revoke`, input),
  );
