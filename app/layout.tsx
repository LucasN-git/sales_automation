import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import "./globals.css";
import { LoadingBar, NavigationLoadingTrigger } from "@/components/LoadingBar";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/profile";
import { getSettings } from "@/lib/settings";
import { getFavoriteShows } from "@/lib/favorites";
import { AppSidebar } from "@/components/AppSidebar";
import { ChatScopeProvider } from "@/components/chat/ChatScopeProvider";
import { ChatPanelContainer } from "@/components/chat/ChatPanelContainer";
import { MobileShellProvider } from "@/components/MobileShellProvider";
import { MobileTopBar } from "@/components/MobileTopBar";
import { MobileNavDrawer } from "@/components/MobileNavDrawer";
import { ErrorReportProvider } from "@/components/ErrorReportProvider";

export const metadata: Metadata = {
  title: "ISP Sales Intelligence",
  description: "Messe-Aussteller-Recherche und ISP-Capability-Match.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <html lang="de">
        <body className="min-h-screen bg-[var(--color-cream)] text-[var(--color-near-black)]">
          <ErrorReportProvider>
            <LoadingBar />
            <Suspense fallback={null}>
              <NavigationLoadingTrigger />
            </Suspense>
            {children}
          </ErrorReportProvider>
        </body>
      </html>
    );
  }

  const [profile, settings, favorites] = await Promise.all([
    getProfile(supabase, user),
    getSettings(supabase, user.id),
    getFavoriteShows(supabase, user.id),
  ]);

  return (
    <html lang="de">
      <body className="min-h-screen bg-[var(--color-cream)] text-[var(--color-near-black)]">
        <ErrorReportProvider userEmail={user.email ?? undefined}>
          <LoadingBar />
          <Suspense fallback={null}>
            <NavigationLoadingTrigger />
          </Suspense>
          <ChatScopeProvider>
            <MobileShellProvider>
              <div className="min-h-screen flex">
                <AppSidebar profile={profile} settings={settings} favorites={favorites} />
                <main className="flex-1 min-w-0 overflow-y-auto flex flex-col">
                  <MobileTopBar />
                  <div className="flex-1 px-4 py-6 lg:px-8 lg:py-12 max-w-5xl w-full mx-auto">
                    {children}
                  </div>
                </main>
                <ChatPanelContainer />
              </div>
              <MobileNavDrawer profile={profile} settings={settings} favorites={favorites} />
            </MobileShellProvider>
          </ChatScopeProvider>
        </ErrorReportProvider>
      </body>
    </html>
  );
}
