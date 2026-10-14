import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from '../src/components/ui/confirm-dialog';

function setup(reason: 'none' | 'optional' | 'required') {
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <ConfirmDialog
      open
      onOpenChange={onOpenChange}
      title="Deactivate Hamza Qureshi?"
      description="They are signed out everywhere."
      confirmLabel="Deactivate"
      tone="danger"
      reason={reason}
      onConfirm={onConfirm}
    />,
  );
  return { onConfirm, onOpenChange, user: userEvent.setup() };
}

describe('ConfirmDialog', () => {
  it('blocks confirmation until a required reason is given', async () => {
    const { onConfirm, user } = setup('required');
    await user.click(screen.getByRole('button', { name: 'Deactivate' }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText(/at least 3 characters/i)).toBeVisible();

    await user.type(screen.getByLabelText(/reason/i), '  Left the gym  ');
    await user.click(screen.getByRole('button', { name: 'Deactivate' }));
    expect(onConfirm).toHaveBeenCalledWith('Left the gym');
  });

  it('passes undefined when an optional reason is left empty', async () => {
    const { onConfirm, user } = setup('optional');
    expect(screen.getByText('(optional)')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Deactivate' }));
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it('does not focus the confirm button by default and can be cancelled', async () => {
    const { onConfirm, onOpenChange, user } = setup('none');
    expect(screen.getByRole('button', { name: 'Deactivate' })).not.toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
