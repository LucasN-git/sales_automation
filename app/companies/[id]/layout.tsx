import { Suspense } from "react";
import { CompanyLayoutData } from "./CompanyLayoutData";

export const dynamic = "force-dynamic";

export default function CompanyLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  return (
    <>
      <Suspense fallback={null}>
        <CompanyLayoutData params={params} />
      </Suspense>
      {children}
    </>
  );
}
