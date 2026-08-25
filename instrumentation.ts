import type { Instrumentation } from "next";

// Next.js calls onRequestError for any unhandled exception thrown while
// serving a request - the errors nobody wrote a handler for, which are
// exactly the ones you cannot anticipate and therefore cannot instrument
// individually.
//
// Without this they reach Railway's logs and stop there: a 500 for whoever
// hit the route, and silence for everyone else. This is the framework's own
// hook, so it needs no third-party service; the trade against something like
// Sentry is that there is no stack-trace grouping or history here, only "it
// happened, here is where". That is the right trade at one operator and the
// wrong one at fifty, so revisit it when other people's failures stop being
// visible to you.
//
// Deliberately conservative about what it sends. The message and the route
// go to the phone; the full error goes to the log. Request bodies and query
// strings are never included - they carry guest names, phone numbers and
// door codes, and a push notification is the last place those belong.
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const message = err instanceof Error ? err.message : String(err);
  const where = `${context.routerKind === "App Router" ? "" : "pages:"}${request.path}`;

  console.error(`[onRequestError] ${where}:`, err);

  // Alerting is best-effort and must never itself throw inside the error
  // handler - an exception here would be reported nowhere at all.
  try {
    // Imported lazily: this file is loaded in every runtime Next starts,
    // including the edge runtime where Prisma cannot be used at all. A
    // top-level import would break the build for the sake of a path that
    // only ever runs on the server.
    const { prisma } = await import("@/lib/prisma");
    const { notifyUserThrottled } = await import("@/lib/notify");

    const owners = await prisma.user.findMany({ select: { id: true } });
    for (const owner of owners) {
      await notifyUserThrottled(
        owner.id,
        {
          type: "app_error",
          // Route rather than message in the title, so the throttle groups
          // by "this page is broken" and one failing endpoint firing
          // repeatedly does not become a stream of near-identical alerts.
          title: `Something failed on ${where}`,
          body: message.slice(0, 180),
          link: request.path,
        },
        60
      );
    }
  } catch (reportErr) {
    console.error("[onRequestError] could not report:", reportErr);
  }
};
