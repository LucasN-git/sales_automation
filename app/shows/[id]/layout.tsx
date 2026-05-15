import { Suspense } from "react";
import { ShowLayoutData } from "./ShowLayoutData";

export const dynamic = "force-dynamic";

export default function ShowLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  return (
    <>
      <Suspense fallback={null}>
        <ShowLayoutData params={params} />
      </Suspense>
      {children}
    </>
  );
}
