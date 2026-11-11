import React, { useEffect, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@/convex/_generated/api";
import { useRootContext } from "@/context/RootContext";
import { Card, Input, Select, Button } from "@/components/ui";
import AuthPanel from "@/components/AuthPanel";
import BackendRequired from "@/components/system/BackendRequired";

type SaveState = "idle" | "saving" | "saved" | "error";

const ProfileLive: React.FC = () => {
  const {
    user,
    loading,
    isAuthenticated,
    currency,
    timezone,
    defaultTradingMode,
    setCurrency,
    setTimezone,
    setDefaultTradingMode,
    setTheme,
    theme,
  } = useRootContext();

  const { signOut } = useAuthActions();
  const updateProfile = useMutation(api.users.updateProfile);
  const updatePaperSettings = useMutation(api.paperAccounts.updateSettings);
  const ensurePaperAccount = useMutation(api.paperAccounts.ensure);
  const paperAccount = useQuery(api.paperAccounts.get, {});

  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [productType, setProductType] = useState(
    user?.defaultOrderSettings.productType ?? "delivery"
  );
  const [name, setName] = useState(user?.name ?? "");
  const [startingCapital, setStartingCapital] = useState(
    String(paperAccount?.startingCapital ?? "")
  );

  useEffect(() => {
    if (isAuthenticated && paperAccount === null) {
      ensurePaperAccount().catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to create paper account")
      );
    }
  }, [isAuthenticated, paperAccount, ensurePaperAccount]);

  useEffect(() => {
    if (paperAccount) setStartingCapital(String(paperAccount.startingCapital));
  }, [paperAccount?.startingCapital]);

  useEffect(() => {
    if (user) setProductType(user.defaultOrderSettings.productType);
  }, [user?.defaultOrderSettings.productType]);

  useEffect(() => {
    if (user) setName(user.name);
  }, [user?.name]);

  const save = async (
    action: () => Promise<unknown> | void,
    _successMsg = "Preferences saved"
  ) => {
    setSaveState("saving");
    setError(null);
    try {
      await action();
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 2500);
    } catch (err) {
      setSaveState("error");
      setError(err instanceof Error ? err.message : "Failed to save changes.");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center py-12">
        <p className="text-center text-gray-400">Loading profile...</p>
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return (
      <div className="p-4 md:p-6">
        <h1 className="ml-page-title">Profile</h1>
        <p className="ml-page-sub">
          Preferences and paper-account settings are stored per user. Sign in to view and edit your
          own.
        </p>
        <Card className="mt-5 max-w-md">
          <AuthPanel />
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6">
      <header className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold">Profile</h1>
          <p className="text-gray-400">
            {user.email ?? "Account settings"} — settings persist in Convex
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void signOut()}>
          Sign out
        </Button>
      </header>

      <div aria-live="polite" className="mb-4 min-h-[1.25rem]">
        {saveState === "saving" && (
          <span className="text-sm text-gray-400">Saving…</span>
        )}
        {saveState === "saved" && (
          <span className="text-sm text-emerald-400">Saved ✓</span>
        )}
        {saveState === "error" && (
          <span role="alert" className="text-sm text-red-400">
            {error ?? "Save failed."}
          </span>
        )}
      </div>

      <Card className="mb-6">
        <h2 className="text-xl font-semibold mb-6">Account Preferences</h2>

        <div className="mb-4">
          <label className="text-sm text-gray-300 mb-2 block">Name</label>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-56 flex-1">
              <Input value={name} onChange={setName} placeholder="Your display name" />
            </div>
            <Button
              size="sm"
              disabled={!name.trim() || name.trim() === user.name || saveState === "saving"}
              onClick={() =>
                void save(() => updateProfile({ name: name.trim() }), "Name saved.")
              }
            >
              Save name
            </Button>
          </div>
        </div>

        <div className="mb-4">
          <label className="text-sm text-gray-300 mb-2 block">Theme</label>
          <Select
            value={theme}
            onSelect={(val) => void save(() => setTheme(val as "light" | "dark" | "system"))}
            options={[
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
              { value: "system", label: "System" },
            ]}
          />
        </div>

        <div className="mb-4">
          <label className="text-sm text-gray-300 mb-2 block">Default Currency</label>
          <Select
            value={currency}
            onSelect={(val) => void save(() => setCurrency(val))}
            options={[
              { value: "INR", label: "Indian Rupee (₹)" },
              { value: "USD", label: "US Dollar ($)" },
              { value: "EUR", label: "Euro (€)" },
            ]}
          />
        </div>

        <div className="mb-4">
          <label className="text-sm text-gray-300 mb-2 block">Timezone</label>
          <Input
            placeholder="Asia/Kolkata"
            value={timezone}
            onChange={(value) => setTimezone(value)}
            onSubmit={(value) => void save(() => setTimezone(value))}
          />
        </div>

        <div className="mb-4">
          <label className="text-sm text-gray-300 mb-2 block">Default Trading Mode</label>
          <Select
            value={defaultTradingMode}
            onSelect={(val) =>
              void save(() => setDefaultTradingMode(val as "paper" | "live"))
            }
            options={[
              { value: "paper", label: "Paper Trading" },
              {
                value: "live",
                label: "Live Trading (disabled until broker connected)",
              },
            ]}
          />
        </div>

        <div className="mb-4">
          <label className="text-sm text-gray-300 mb-2 block">Product Type</label>
          <Select
            value={productType}
            onSelect={(val) => {
              setProductType(val);
              void save(() =>
                updateProfile({
                  defaultOrderSettings: {
                    ...user.defaultOrderSettings,
                    productType: val,
                  },
                })
              );
            }}
            options={[
              { value: "delivery", label: "Delivery" },
              { value: "intraday", label: "Intraday" },
              { value: "margin", label: "Margin" },
            ]}
          />
        </div>

        <fieldset className="mb-4">
          <legend className="text-sm text-gray-300 mb-2 block">Notifications</legend>
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={user.notificationPreferences.priceAlerts}
              onChange={(e) =>
                void save(() =>
                  updateProfile({
                    notificationPreferences: {
                      ...user.notificationPreferences,
                      priceAlerts: e.target.checked,
                    },
                  })
                )
              }
            />
            Price alerts enabled
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-300 mt-2">
            <input
              type="checkbox"
              checked={user.notificationPreferences.weeklyDigest}
              onChange={(e) =>
                void save(() =>
                  updateProfile({
                    notificationPreferences: {
                      ...user.notificationPreferences,
                      weeklyDigest: e.target.checked,
                    },
                  })
                )
              }
            />
            Weekly digest
          </label>
          <p className="mt-2 text-xs text-gray-500">
            These flags are saved with your profile. This deployment has no email or push delivery,
            and alerts are evaluated only when you run a check on the Alerts page.
          </p>
        </fieldset>

        <Button
          variant="danger"
          size="sm"
          className="mt-4 w-full"
          onClick={() => {
            if (confirm("Reset all preferences to defaults?")) {
              void save(async () => {
                await updateProfile({
                  theme: "dark",
                  currency: "INR",
                  timezone: "Asia/Kolkata",
                  defaultTradingMode: "paper",
                  defaultOrderSettings: {
                    productType: "delivery",
                    duration: "DAY",
                    autoSquareOff: true,
                  },
                });
              }, "Preferences reset.");
            }
          }}
        >
          Reset Preferences
        </Button>
      </Card>

      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Paper Trading Account</h2>
          <span className="text-xs text-gray-500">Simulated — persisted in Convex</span>
        </div>

        {paperAccount === undefined && (
          <p className="text-gray-500 text-sm">Loading account…</p>
        )}
        {paperAccount === null && (
          <p className="text-gray-400 text-sm">Creating your paper account…</p>
        )}
        {paperAccount && (
          <>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <p className="text-sm text-gray-400">Available cash</p>
                <p className="text-xl font-bold">
                  ₹{paperAccount.availableCash.toLocaleString("en-IN")}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-400">Status</p>
                <p className="text-xl font-bold capitalize">{paperAccount.status}</p>
              </div>
            </div>

            {paperAccount.startingCapitalLocked ? (
              <p className="mb-4 text-xs text-amber-400/80" data-testid="capital-locked">
                Starting capital is ₹
                {paperAccount.startingCapital.toLocaleString("en-IN")} and is locked because
                orders already exist. Changing it now would rewrite past performance, so a new
                baseline requires a fresh account.
              </p>
            ) : (
              <div className="mb-4">
                <label className="text-sm text-gray-300 mb-2 block">
                  Starting Capital (₹)
                </label>
                <Input
                  value={startingCapital}
                  onChange={setStartingCapital}
                  onSubmit={(value) => {
                    const parsed = Number(value);
                    if (Number.isFinite(parsed) && parsed >= 1000) {
                      void save(
                        () => updatePaperSettings({ startingCapital: parsed }),
                        "Starting capital saved."
                      );
                    } else {
                      setSaveState("error");
                      setError("Starting capital must be at least ₹1,000.");
                    }
                  }}
                />
                <p className="text-xs text-gray-600 mt-1">
                  Press Enter to save. Locked once the first order is placed.
                </p>
              </div>
            )}

            <p className="text-xs text-gray-500">
              Simulated account. Cash, positions and P&amp;L are written only by the validated
              paper-trading engine (Trading and Portfolio). No order reaches a broker and live
              trading remains disabled.
            </p>
          </>
        )}
      </Card>
    </div>
  );
};

/* Backend-gated: the profile lives in Convex and requires an authenticated session. */
const Profile: React.FC = () => {
  const { backendOnline } = useRootContext();
  if (!backendOnline) {
    return (
      <BackendRequired
        feature="Profile"
        description="Your name, currency, timezone, trading mode and paper-account settings are stored per user in Convex."
      />
    );
  }
  return <ProfileLive />;
};

export default Profile;
