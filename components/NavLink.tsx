"use client";

import Link, { useLinkStatus } from "next/link";
import { useEffect } from "react";
import { loading } from "@/components/LoadingBar";

type NavLinkProps = React.ComponentProps<typeof Link>;

/**
 * Drop-in <Link> replacement that flips the global LoadingBar on as soon as
 * the user clicks (via Next 15.3's useLinkStatus), and back off once the
 * destination is rendered. Use for any in-app navigation where the destination
 * may be slow — sidebar tabs, top nav, favorites — so the user gets instant
 * feedback instead of waiting for pathname to change.
 */
export function NavLink(props: NavLinkProps) {
  const { children, ...linkProps } = props;
  return (
    <Link {...linkProps}>
      <PendingTracker />
      {children}
    </Link>
  );
}

function PendingTracker() {
  const { pending } = useLinkStatus();
  useEffect(() => {
    if (!pending) return;
    loading.start();
    return () => loading.stop();
  }, [pending]);
  return null;
}
