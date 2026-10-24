import React, { useEffect, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@/convex/_generated/api";
import { useRootContext } from "@/context/RootContext";
import { Card, Input, Select, Button } from "@/components/ui";

type SaveState = "idle" | "saving" | "saved" | "error";

const Profile: React.FC = () => {
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
      <div className="min-h-screen flex items-center justify-center py-12">
        <p className="text-gray-400">Please sign in to view your profile</p>
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
          <Input
            value={user.name}
            onChange={(value) => value.trim() && void save(() => updateProfile({ name: value.trim() }))}
          />
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

        <div className="mb-4">
          <label className="text-sm text-gray-300 mb-2 block">Notifications</label>
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
            Price alerts
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
        </div>

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

            <div className="mb-4">
              <label className="text-sm text-gray-300 mb-2 block">
                Starting Capital (₹)
              </label>
              <Input
                value={startingCapital}
                onChange={setStartingCapital}
                onSubmit={(value) => {
                  const parsed = Number(value);
                  if (Number.isFinite(parsed) && parsed >= 0) {
                    void save(
                      () => updatePaperSettings({ startingCapital: parsed }),
                      "Starting capital saved."
                    );
                  } else {
                    setSaveState("error");
                    setError("Starting capital must be a number >= 0.");
                  }
                }}
              />
              <p className="text-xs text-gray-600 mt-1">
                Press Enter to save.
              </p>
            </div>

            <p className="text-xs text-gray-500">
              No trades have been executed in this account. Cash balance only changes
              through the trading engine in a later phase. Live trading remains disabled.
            </p>
          </>
        )}
      </Card>
    </div>
  );
};

export default Profile;
