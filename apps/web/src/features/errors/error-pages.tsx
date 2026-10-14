import { Compass, LockKeyhole, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { isRouteErrorResponse, useRouteError } from 'react-router';
import { Button, ButtonLink } from '../../components/ui/button';

function Message({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action: ReactNode;
}) {
  return (
    <section className="mx-auto flex max-w-md flex-col items-center py-16 text-center sm:py-24">
      <div className="mb-5 flex size-12 items-center justify-center rounded-xl bg-surface text-fg-muted shadow-xs ring-1 ring-border [&_svg]:size-5">
        {icon}
      </div>
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-fg-secondary">{body}</p>
      <div className="mt-6">{action}</div>
    </section>
  );
}

export function NotFoundPage() {
  return (
    <Message
      icon={<Compass aria-hidden />}
      title="Page not found"
      body="The link may be outdated, or the page was moved. Check the address or go back to your home screen."
      action={<ButtonLink to="/">Go to home</ButtonLink>}
    />
  );
}

export function ForbiddenPage() {
  return (
    <Message
      icon={<LockKeyhole aria-hidden />}
      title="You do not have access to this page"
      body="Your role does not include this area. If you need it for your work, ask an Admin to review your role."
      action={<ButtonLink to="/">Go to home</ButtonLink>}
    />
  );
}

/** Last-resort boundary for render errors; never shows stack traces. */
export function RouteErrorPage() {
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  if (notFound) {
    return (
      <div className="min-h-dvh bg-bg px-4">
        <NotFoundPage />
      </div>
    );
  }
  return (
    <div className="min-h-dvh bg-bg px-4">
      <Message
        icon={<TriangleAlert aria-hidden />}
        title="Something went wrong"
        body="This screen hit an unexpected problem. Reloading usually fixes it; your saved data is not affected."
        action={<Button onClick={() => window.location.reload()}>Reload the page</Button>}
      />
    </div>
  );
}
