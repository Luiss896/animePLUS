import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { useTranslation } from "react-i18next";
import { HashRouter, Route, Routes } from "react-router-dom";

import { initI18n } from "@/renderer/helpers/i18n/i18n";
import { updateAppLanguage } from "@/renderer/helpers/i18n/language-helpers";
import { applyStoredThemeClass, syncThemeWithLocal } from "@/renderer/helpers/theme/theme-helper";
import { ScrollToTop } from "@/renderer/components/scroll-to-top";
import { UpdateAvailableDialog } from "@/renderer/components/update-available-dialog";
import { WatchPartyProvider } from "@/renderer/features/watch-party/party-provider";
import SidebarLayout from "@/renderer/layouts/sidebar-layout";
import { FollowingPage } from "@/renderer/pages/following-page";
import { HistoryPage } from "@/renderer/pages/history-page";
import { BookmarksPage } from "@/renderer/pages/bookmarks-page";
import { PartyPage } from "@/renderer/pages/party-page";
import { PlayerPage } from "@/renderer/pages/player-page";
import { SearchPage } from "@/renderer/pages/search-page";
import { SettingsPage } from "@/renderer/pages/settings-page";
import { ShowDetailsPage } from "@/renderer/pages/show-details-page";
import { WatchPage } from "@/renderer/pages/watch-page";
import { WelcomePage } from "@/renderer/pages/welcome-page";

export default function App() {
  const { i18n } = useTranslation();

  useEffect(() => {
    void syncThemeWithLocal();
    void updateAppLanguage(i18n);
  }, []);

  return (
    <HashRouter>
      <ScrollToTop />
      {/*
        Mounted at the root rather than inside the layout: the dialog must be able
        to appear on any route, including the watch page, which renders its own
        full-bleed shell outside the sidebar.
      */}
      <UpdateAvailableDialog />
      {/*
        Also at the root, and for the same reason as the dialog plus one more: a
        party session must survive navigating between `/party` and the show being
        watched, so it cannot live inside a single page.
      */}
      <WatchPartyProvider>
        <Routes>
          <Route element={<SidebarLayout />}>
            <Route path="/" element={<WelcomePage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/bookmarks" element={<BookmarksPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/following" element={<FollowingPage />} />
            <Route path="/party" element={<PartyPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/show/:id" element={<ShowDetailsPage />} />
            <Route path="/watch" element={<WatchPage />} />
            <Route path="/player" element={<PlayerPage />} />
          </Route>
        </Routes>
      </WatchPartyProvider>
    </HashRouter>
  );
}

void initI18n();
applyStoredThemeClass();

const root = createRoot(document.getElementById("app"));
root.render(<App />);
