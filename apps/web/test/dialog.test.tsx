import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Button } from '../src/components/ui/button';
import { Dialog } from '../src/components/ui/dialog';

/** An invoice row: paying it removes its "Pay" button, as the real list does after a refetch. */
function InvoiceRow() {
  const [paid, setPaid] = useState(false);
  const [open, setOpen] = useState(false);
  return (
    <ul>
      <li>
        <span>
          {!paid && <Button onClick={() => setOpen(true)}>Pay</Button>}
          <Button variant="ghost">Details</Button>
        </span>
      </li>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Record payment"
        footer={
          <Button
            onClick={() => {
              setPaid(true);
              setOpen(false);
            }}
          >
            Record payment
          </Button>
        }
      >
        Cash at the counter
      </Dialog>
    </ul>
  );
}

describe('Dialog focus on close', () => {
  it('returns focus to the button that opened it', async () => {
    const user = userEvent.setup();
    render(<InvoiceRow />);
    await user.click(screen.getByRole('button', { name: 'Pay' }));
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pay' })).toHaveFocus());
  });

  it('moves focus to the nearest control left when the opener is gone', async () => {
    const user = userEvent.setup();
    render(<InvoiceRow />);
    await user.click(screen.getByRole('button', { name: 'Pay' }));
    await user.click(screen.getByRole('button', { name: 'Record payment' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Details' })).toHaveFocus());
    expect(screen.queryByRole('button', { name: 'Pay' })).not.toBeInTheDocument();
  });
});
