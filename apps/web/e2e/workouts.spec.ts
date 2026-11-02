import { expect, test, type Page } from '@playwright/test';
import {
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  signIn,
  signInAs,
  USERS,
  WORKOUT_MEMBER,
} from './helpers';

const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const PLAN_NAME = 'Foundations: 3-day strength';
const MEMBER_NAME = `${WORKOUT_MEMBER.firstName} ${WORKOUT_MEMBER.lastName}`;
const TRAINER_NOTE = 'Keep the first two weeks light and focus on form.';

/** Dismiss a toast so the next one (and axe) is not judged mid-animation. */
async function closeToast(page: Page, text: string | RegExp) {
  const toast = page.getByRole('listitem').filter({ hasText: text });
  await expect(toast).toBeVisible();
  await toast.getByRole('button', { name: 'Close toast' }).click();
  await expect(toast).toBeHidden();
}

async function settled(page: Page, heading: string | RegExp) {
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
  await expect(page.getByRole('status', { name: /loading/i })).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
}

async function addExercise(
  page: Page,
  exercise: { name: string; muscleGroup: string; equipment: string; howTo: string },
  picture?: boolean,
) {
  await page.getByRole('button', { name: 'New exercise' }).first().click();
  const form = page.getByRole('dialog', { name: 'New exercise' });
  await form.getByLabel('Name').fill(exercise.name);
  await form.getByLabel('Muscle group').selectOption({ label: exercise.muscleGroup });
  await form.getByLabel(/Equipment needed/).fill(exercise.equipment);
  await form.getByLabel(/How to do it/).fill(exercise.howTo);
  if (picture) {
    await form.getByTestId('exercise-image-input').setInputFiles({
      name: 'goblet-squat.png',
      mimeType: 'image/png',
      buffer: PIXEL_PNG,
    });
    await expect(form.getByText('goblet-squat.png')).toBeVisible();
    await expectNoAxeViolations(page);
  }
  await form.getByRole('button', { name: 'Add exercise' }).click();
  await closeToast(page, `${exercise.name} added to the library`);
}

test('a trainer builds and assigns a plan; the member logs a session and records progress', async ({
  page,
}) => {
  // Two sign-ins, a plan build and eight axe scans in one flow.
  test.setTimeout(150_000);

  // Trainer: the exercise library.
  await signInAs(page, 'TRAINER');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Exercises' })
    .click();
  await settled(page, 'Exercise library');
  await expect(page.getByText('The library is empty')).toBeVisible();
  await addExercise(
    page,
    {
      name: 'Goblet squat',
      muscleGroup: 'Legs',
      equipment: 'Kettlebell',
      howTo: 'Hold the bell at your chest, sit between your heels, stand tall.',
    },
    true,
  );
  await addExercise(page, {
    name: 'Forearm plank',
    muscleGroup: 'Core',
    equipment: 'Mat',
    howTo: 'Elbows under shoulders, body in one line, breathe slowly.',
  });
  const library = page.getByRole('list', { name: 'Exercises' });
  await expect(library.getByRole('listitem')).toHaveCount(2);
  // The uploaded picture is served back through the authorised image route and loads.
  const thumb = library.getByRole('listitem').filter({ hasText: 'Goblet squat' }).locator('img');
  await expect(thumb).toHaveCount(1);
  await expect
    .poll(() => thumb.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
    .toBeGreaterThan(0);
  await expectNoAxeViolations(page);

  // A new plan, then its exercises.
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Workout plans' })
    .click();
  await settled(page, 'Workout plans');
  await page.getByRole('button', { name: 'New plan' }).first().click();
  const planForm = page.getByRole('dialog', { name: 'New workout plan' });
  await planForm.getByLabel('Plan name').fill(PLAN_NAME);
  await planForm.getByLabel('Level').selectOption({ label: 'Beginner' });
  await planForm.getByLabel(/Goal/).fill('Build a base for heavier lifting');
  await expectNoAxeViolations(page);
  await planForm.getByRole('button', { name: 'Create plan' }).click();
  await closeToast(page, `${PLAN_NAME} created`);
  await settled(page, PLAN_NAME);

  await page.getByRole('button', { name: 'Add exercises' }).click();
  const builder = page.getByRole('region', { name: 'Plan builder' });
  await builder.getByRole('button', { name: 'Add exercise to Day 1' }).click();
  const picker = page.getByRole('dialog', { name: 'Add exercises to Day 1' });
  await picker.getByRole('button', { name: 'Add Goblet squat' }).click();
  await picker.getByRole('button', { name: 'Add Forearm plank' }).click();
  await expectNoAxeViolations(page);
  await picker.getByRole('button', { name: 'Done' }).click();

  const day1 = builder.getByRole('list', { name: 'Day 1 exercises' });
  await expect(day1.getByRole('listitem')).toHaveCount(2);
  // A plank is held for time, not counted in reps.
  const plank = day1.getByRole('listitem').filter({ hasText: 'Forearm plank' });
  await plank.getByLabel('Reps').fill('');
  await plank.getByLabel('Time').fill('45');
  await expectNoAxeViolations(page);
  await builder.getByRole('button', { name: 'Save exercises' }).click();
  await closeToast(page, `${PLAN_NAME} saved`);
  await expect(page.getByRole('region', { name: 'Plan builder' })).toBeHidden();
  await expect(page.getByText('3 × 45 s')).toBeVisible();

  // Assign it to the trainer's own member, with a note.
  await page.getByRole('button', { name: 'Assign to member' }).click();
  const assign = page.getByRole('dialog', { name: /Assign/ });
  // Options read "Name · member code"; the code depends on the fixture order.
  const memberSelect = assign.getByLabel('Member', { exact: true });
  const memberOption = memberSelect.locator('option', { hasText: MEMBER_NAME });
  await memberSelect.selectOption((await memberOption.getAttribute('value')) ?? '');
  await assign.getByLabel(/Notes for the member/).fill(TRAINER_NOTE);
  await expectNoAxeViolations(page);
  await assign.getByRole('button', { name: 'Assign plan' }).click();
  await closeToast(page, `${PLAN_NAME} assigned to ${MEMBER_NAME}`);

  // The member: their plan, a logged session and a progress entry.
  await page.context().clearCookies();
  await signIn(page, WORKOUT_MEMBER.email);
  await expect(page).toHaveURL(/\/portal$/);
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'My workouts' })
    .click();
  await settled(page, 'My workouts');
  const workout = page.getByRole('region', { name: PLAN_NAME });
  await expect(workout).toContainText(TRAINER_NOTE);
  await expect(workout).toContainText(`From ${USERS.TRAINER.firstName} ${USERS.TRAINER.lastName}`);
  await expect(page.getByText('Nothing logged yet')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectNoAxeViolations(page);

  await workout.getByRole('button', { name: `Log a workout: ${PLAN_NAME}` }).click();
  const logDialog = page.getByRole('dialog', { name: 'Log a workout' });
  // Every planned exercise starts ticked; the plank was skipped today.
  await logDialog.getByRole('checkbox', { name: /Forearm plank/ }).uncheck();
  await logDialog.getByLabel('Load').fill('12 kg');
  await expectNoAxeViolations(page);
  await logDialog.getByRole('button', { name: 'Save workout' }).click();
  await closeToast(page, 'Workout logged for today');
  // The history replaces its empty state with the session just logged.
  await expect(page.getByText('Nothing logged yet')).toBeHidden();
  await expect(page.getByRole('main')).toContainText('12 kg');

  await page.getByRole('link', { name: 'My progress' }).first().click();
  await settled(page, 'My progress');
  await expect(page.getByText('No progress recorded yet').first()).toBeVisible();
  await page.getByRole('button', { name: 'Record progress' }).first().click();
  const progress = page.getByRole('dialog', { name: 'Record progress' });
  await progress.getByLabel(/Weight \(kg\)/).fill('78.5');
  await progress.getByLabel(/Body fat/).fill('21');
  await expectNoAxeViolations(page);
  await progress.getByRole('button', { name: 'Save entry' }).click();
  await closeToast(page, 'Progress recorded');
  await expect(page.getByText('78.5 kg').first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectNoAxeViolations(page);

  // Back to the trainer: the member's session shows on the assignment.
  await page.context().clearCookies();
  await signInAs(page, 'TRAINER');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Assigned workouts' })
    .click();
  await settled(page, 'Assigned workouts');
  await page.getByRole('link', { name: new RegExp(PLAN_NAME) }).click();
  await settled(page, PLAN_NAME);
  await expect(page.getByRole('heading', { name: 'Workout log' })).toBeVisible();
  await expect(page.getByText('Nothing logged yet')).toBeHidden();
  await expect(page.getByRole('main')).toContainText('12 kg');
  await expectNoAxeViolations(page);
});
