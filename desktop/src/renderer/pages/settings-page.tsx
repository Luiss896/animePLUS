import React, { useCallback, useEffect, useState } from "react";

import { AniListConnectDialog } from "@/renderer/components/anilist-connect-dialog";
import { PalettePicker } from "@/renderer/components/palette-picker";
import { ThemePicker } from "@/renderer/components/theme-picker";
import { Button } from "@/renderer/components/ui/button";
import { PageHeader } from "@/renderer/components/page-header";
import { Card } from "@/renderer/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/renderer/components/ui/select";
import { Switch } from "@/renderer/components/ui/switch";
import type { AppUpdateCheckResult } from "@/shared/app-update-types";
import {
  DEFAULT_STREAM_PROVIDER,
  STREAM_PROVIDER_LABELS,
  getEnabledStreamProviders,
  isStreamProviderName,
} from "@/shared/stream-providers";
import type { AniListIntegrationStatus, StreamProvider } from "@/shared/types";

function openExternalUrl(url: string) {
  if (window.urlOpener) {
    void window.urlOpener.openUrl(url);
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

export function SettingsPage() {
  const [updateCheck, setUpdateCheck] = useState<AppUpdateCheckResult | null>(null);
  const [updateLoading, setUpdateLoading] = useState(true);
  const [watchHistoryLoading, setWatchHistoryLoading] = useState(true);
  const [hasWatchHistory, setHasWatchHistory] = useState(false);
  const [clearHistoryBusy, setClearHistoryBusy] = useState(false);
  const [anilistStatus, setAnilistStatus] = useState<AniListIntegrationStatus | null>(null);
  const [anilistStatusLoading, setAnilistStatusLoading] = useState(true);
  const [anilistConnectOpen, setAnilistConnectOpen] = useState(false);
  const [anilistDisconnectBusy, setAnilistDisconnectBusy] = useState(false);
  const [anilistError, setAnilistError] = useState<string | null>(null);
  const [autoAddSequels, setAutoAddSequels] = useState(false);
  const [autoAddLoading, setAutoAddLoading] = useState(true);
  const [autoAddBusy, setAutoAddBusy] = useState(false);
  const enabledStreamProviders = getEnabledStreamProviders();
  // Mirrors resolveEnabledStreamProvider() in the main process, sharing the same
  // constant so the two can no longer drift apart.
  const [activeStreamProvider, setActiveStreamProvider] = useState<StreamProvider>(
    enabledStreamProviders.includes(DEFAULT_STREAM_PROVIDER)
      ? DEFAULT_STREAM_PROVIDER
      : (enabledStreamProviders[0] ?? DEFAULT_STREAM_PROVIDER)
  );
  const [streamProviderLoading, setStreamProviderLoading] = useState(true);
  const [streamProviderBusy, setStreamProviderBusy] = useState(false);
  const [openLogsBusy, setOpenLogsBusy] = useState(false);
  const [openLogsError, setOpenLogsError] = useState<string | null>(null);
  const [incognitoEnabled, setIncognitoEnabled] = useState(false);
  const [incognitoLoading, setIncognitoLoading] = useState(true);
  const [incognitoBusy, setIncognitoBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void window.streamProvider
      .getActiveProvider()
      .then((provider) => {
        if (!cancelled) {
          setActiveStreamProvider(provider);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setStreamProviderLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void window.privacy
      .getIncognito()
      .then((enabled) => {
        if (!cancelled) {
          setIncognitoEnabled(enabled);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIncognitoLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setUpdateLoading(true);
      try {
        const result = await window.app.checkForUpdate();
        if (!cancelled) {
          setUpdateCheck(result);
        }
      } finally {
        if (!cancelled) {
          setUpdateLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setWatchHistoryLoading(true);
    void window.recentlyWatched
      .read()
      .then((entries) => {
        if (!cancelled) {
          setHasWatchHistory(entries.length > 0);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setWatchHistoryLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshAnilistStatus = useCallback(async () => {
    setAnilistStatusLoading(true);
    try {
      const s = await window.anilist.getStatus();
      setAnilistStatus(s);
      setAnilistError(null);
    } finally {
      setAnilistStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    // Always read the status. This used to be gated on `isDevelopment`, which
    // meant a packaged build never asked the main process whether a token was
    // stored: the UI showed "not connected" on every launch even though the
    // saved token was still valid and the app kept syncing with AniList.
    void refreshAnilistStatus();
  }, [refreshAnilistStatus]);

  useEffect(() => {
    let cancelled = false;
    void window.anilist
      .getAutoAddSequels()
      .then((enabled) => {
        if (!cancelled) setAutoAddSequels(enabled);
      })
      .catch(() => {
        /* keep the default (off) if the setting cannot be read */
      })
      .finally(() => {
        if (!cancelled) setAutoAddLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onAutoAddChange = useCallback(async (enabled: boolean) => {
    setAutoAddBusy(true);
    try {
      const applied = await window.anilist.setAutoAddSequels(enabled);
      setAutoAddSequels(applied);
    } finally {
      setAutoAddBusy(false);
    }
  }, []);

  const onAnilistDisconnect = useCallback(async () => {
    setAnilistDisconnectBusy(true);
    setAnilistError(null);
    try {
      await window.anilist.disconnect();
      await refreshAnilistStatus();
    } finally {
      setAnilistDisconnectBusy(false);
    }
  }, [refreshAnilistStatus]);

  const onClearWatchHistory = useCallback(async () => {
    setClearHistoryBusy(true);
    try {
      await window.recentlyWatched.clear();
      setHasWatchHistory(false);
    } finally {
      setClearHistoryBusy(false);
    }
  }, []);

  const onUpdateClick = useCallback(() => {
    const url = updateCheck?.releaseUrl;
    if (url) {
      openExternalUrl(url);
    }
  }, [updateCheck?.releaseUrl]);

  const onStreamProviderChange = useCallback(async (provider: StreamProvider) => {
    setStreamProviderBusy(true);
    try {
      const next = await window.streamProvider.setActiveProvider(provider);
      setActiveStreamProvider(next);
    } finally {
      setStreamProviderBusy(false);
    }
  }, []);

  const onIncognitoChange = useCallback(async (enabled: boolean) => {
    setIncognitoBusy(true);
    try {
      const next = await window.privacy.setIncognito(enabled);
      setIncognitoEnabled(next);
    } finally {
      setIncognitoBusy(false);
    }
  }, []);

  const onOpenLogsDirectory = useCallback(async () => {
    setOpenLogsBusy(true);
    setOpenLogsError(null);
    try {
      await window.app.openLogsDirectory();
    } catch (error) {
      setOpenLogsError(error instanceof Error ? error.message : "Could not open log directory.");
    } finally {
      setOpenLogsBusy(false);
    }
  }, []);

  return (
    <div className="oa-page-enter w-full max-w-[1600px] mx-auto flex flex-col gap-6 p-6 md:p-8">
      <PageHeader
        title="Settings"
        description="Account, playback and appearance."
      />

      <Card as="section" className="p-5 flex flex-col gap-4">
        <div className="space-y-1 min-w-0">
          <h2 className="text-sm font-medium">App version</h2>
          <p className="text-sm text-muted-foreground">
            Compared with the latest release on GitHub.
          </p>
        </div>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm sm:max-w-md">
            <dt className="text-muted-foreground">Current</dt>
            <dd className="font-mono tabular-nums">
              {updateLoading ? "…" : (updateCheck?.currentVersion ?? "—")}
            </dd>
            <dt className="text-muted-foreground">Latest</dt>
            <dd className="font-mono tabular-nums">
              {updateLoading ? "…" : (updateCheck?.latestVersion ?? "—")}
            </dd>
          </dl>

          <Button
            type="button"
            className="sm:shrink-0 w-full sm:w-auto"
            disabled={updateLoading || !updateCheck?.updateAvailable || !updateCheck.releaseUrl}
            onClick={onUpdateClick}
          >
            Update
          </Button>
        </div>

        {/*
          `no-releases` means the repository is reachable but has not published a
          release yet. That is worth telling the user, but it is not a failure —
          showing it in red alongside real errors made a healthy app look broken.
        */}
        {updateCheck?.error === "no-releases" ? (
          <p className="text-sm text-muted-foreground">
            No releases published yet, so there is nothing to compare against.
          </p>
        ) : updateCheck?.error ? (
          <p className="text-sm text-destructive" role="alert">
            Could not check for updates ({updateCheck.error}).
          </p>
        ) : null}
      </Card>

      <Card as="section" className="p-5 flex flex-col gap-6">
        <div className="space-y-1 min-w-0">
          <h2 className="text-sm font-medium">Integrations</h2>
          <p className="text-sm text-muted-foreground">
            Connect to third-party services to keep track of your watch list, bookmarks, and more.
          </p>
        </div>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1 min-w-0 max-w-xl">
            <h3 className="text-sm font-medium">AniList</h3>
            {anilistError && (
              <p className="text-sm text-destructive" role="alert">
                {anilistError}
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              {anilistStatusLoading
                ? "…"
                : anilistStatus?.connected && anilistStatus.username
                  ? `Signed in as ${anilistStatus.username}.`
                  : "Not connected."}
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:items-end sm:shrink-0 w-full sm:w-auto">
            <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
              <Button
                type="button"
                className="w-full sm:w-auto"
                disabled={
                  anilistStatusLoading || anilistDisconnectBusy || Boolean(anilistStatus?.connected)
                }
                onClick={() => {
                  setAnilistConnectOpen(true);
                }}
              >
                Connect
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto"
                disabled={
                  anilistStatusLoading || anilistDisconnectBusy || !anilistStatus?.connected
                }
                onClick={() => {
                  void onAnilistDisconnect();
                }}
              >
                {anilistDisconnectBusy ? "Disconnecting…" : "Disconnect"}
              </Button>
            </div>
          </div>
        </div>

        <AniListConnectDialog
          open={anilistConnectOpen}
          onOpenChange={setAnilistConnectOpen}
          onConnected={() => {
            void refreshAnilistStatus();
          }}
        />

        <div className="flex flex-col gap-4 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1 min-w-0">
            <h3 className="text-sm font-medium">Track new seasons automatically</h3>
            <p className="text-sm text-muted-foreground">
              AniList does not link seasons together, so a sequel can be airing without ever
              appearing here. When this is on, announced and currently-airing sequels of shows you
              have completed or are watching are added to your list as <em>Planning</em>.
            </p>
          </div>
          <Switch
            className="sm:shrink-0"
            checked={autoAddSequels}
            disabled={autoAddLoading || autoAddBusy || !anilistStatus?.connected}
            onCheckedChange={(checked) => {
              void onAutoAddChange(checked);
            }}
            aria-label="Add new seasons to my AniList list automatically"
          />
        </div>
      </Card>

      <Card as="section" className="p-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1 min-w-0">
          <h2 className="text-sm font-medium">Incognito mode</h2>
          <p className="text-sm text-muted-foreground">
            When enabled, watching does not update local history or AniList progress.
          </p>
        </div>
        <Switch
          checked={incognitoEnabled}
          disabled={incognitoLoading || incognitoBusy}
          onCheckedChange={(checked) => {
            void onIncognitoChange(checked);
          }}
          aria-label="Incognito mode"
          className="sm:shrink-0"
        />
      </Card>

      <Card as="section" className="p-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1 min-w-0">
          <h2 className="text-sm font-medium">Watch history</h2>
          <p className="text-sm text-muted-foreground">
            Clear saved playback progress for Continue watching on this device.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="sm:shrink-0 w-full sm:w-auto text-destructive hover:text-destructive border-destructive/40 hover:bg-destructive/10"
          disabled={watchHistoryLoading || !hasWatchHistory || clearHistoryBusy}
          onClick={() => {
            void onClearWatchHistory();
          }}
        >
          Clear history
        </Button>
      </Card>

      <Card as="section" className="p-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1 min-w-0">
          <h2 className="text-sm font-medium">Streaming provider</h2>
          <p className="text-sm text-muted-foreground">
            Choose which upstream source is used for search, episodes, and playback.
          </p>
        </div>
        <Select
          value={activeStreamProvider}
          onValueChange={(value) => {
            if (isStreamProviderName(value)) {
              void onStreamProviderChange(value);
            }
          }}
          disabled={
            streamProviderLoading || streamProviderBusy || enabledStreamProviders.length === 0
          }
        >
          <SelectTrigger className="sm:shrink-0 w-full sm:w-[220px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {enabledStreamProviders.map((provider) => (
              <SelectItem key={provider} value={provider}>
                {STREAM_PROVIDER_LABELS[provider]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Card>

      <Card as="section" className="p-5 flex flex-col gap-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1 min-w-0">
            <h2 className="text-sm font-medium">Theme</h2>
            <p className="text-sm text-muted-foreground">Light, dark, or match your system.</p>
          </div>
          <ThemePicker className="sm:shrink-0" />
        </div>

        <div className="flex flex-col gap-3">
          <div className="space-y-1 min-w-0">
            <h3 className="text-sm font-medium">Colour palette</h3>
            <p className="text-sm text-muted-foreground">
              Recolours the interface. Works on top of the light or dark setting above.
            </p>
          </div>
          <PalettePicker />
        </div>
      </Card>

      <Card as="section" className="p-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1 min-w-0">
          <h2 className="text-sm font-medium">Logs</h2>
          <p className="text-sm text-muted-foreground">
            Open the local log folder to share when reporting issues. Logs older than 30 days are
            removed automatically.
          </p>
          {openLogsError && (
            <p className="text-sm text-destructive" role="alert">
              {openLogsError}
            </p>
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          className="sm:shrink-0 w-full sm:w-auto"
          disabled={openLogsBusy}
          onClick={() => {
            void onOpenLogsDirectory();
          }}
        >
          {openLogsBusy ? "Opening…" : "Open"}
        </Button>
      </Card>
    </div>
  );
}
