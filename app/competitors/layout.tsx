import { Suspense } from "react";
import { CompetitorLayoutData } from "./CompetitorLayoutData";

export const dynamic = "force-dynamic";

export default function CompetitorsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Suspense fallback={null}>
        <CompetitorLayoutData />
      </Suspense>
      {children}
    </>
  );
}
