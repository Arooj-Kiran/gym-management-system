import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { TabPanel, Tabs } from '../src/components/ui/tabs';

function Example() {
  const [value, setValue] = useState<'profile' | 'membership' | 'notes'>('profile');
  return (
    <>
      <Tabs
        label="Member sections"
        idPrefix="member"
        value={value}
        onChange={setValue}
        tabs={[
          { value: 'profile', label: 'Profile' },
          { value: 'membership', label: 'Membership' },
          { value: 'notes', label: 'Notes' },
        ]}
      />
      <TabPanel idPrefix="member" value={value}>
        Showing {value}
      </TabPanel>
    </>
  );
}

describe('Tabs', () => {
  it('links the selected tab to its panel and keeps only it in the tab order', () => {
    render(<Example />);
    const profile = screen.getByRole('tab', { name: 'Profile' });
    expect(profile).toHaveAttribute('aria-selected', 'true');
    expect(profile).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'Membership' })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('tabpanel', { name: 'Profile' })).toHaveTextContent('Showing profile');
  });

  it('moves with the arrow, Home and End keys, wrapping at the ends', async () => {
    const user = userEvent.setup();
    render(<Example />);
    await user.click(screen.getByRole('tab', { name: 'Profile' }));

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Membership' })).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Showing membership');

    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Notes' })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Profile' })).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Notes' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'Profile' })).toHaveAttribute('aria-selected', 'true');
  });
});
