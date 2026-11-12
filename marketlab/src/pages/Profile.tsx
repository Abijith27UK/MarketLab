import React, { useEffect, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { LogOut } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { useRootContext } from "@/context/RootContext";
import { Card, Input, Select, Button, SectionHeader } from "@/components/ui";
import PageHeader from "@/components/layout/PageHeader";
import AuthPanel from "@/components/AuthPanel";
import BackendRequired from "@/components/system/BackendRequired";
import { formatInr } from "@/lib/format";

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
      <div className="p-4 md:p-6" aria-busy="true">
        <span className="skeleton" style={{ display: "block", height: 26, width: 140 }} />
        <span className="skeleton mt-4" style={{ display: "block", height: 260 }} />
        <span className="skeleton mt-4" style={{ display: "block", height: 140 }} />
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return (
      <div className="p-4 md:p-6">
        <PageHeader
          title="Profile"
          description="Preferences and paper-account settings are stored per user. Sign in to view and edit your own."
        />
        <Card className="max-w-md">
          <AuthPanel />
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6">
      <PageHeader
        title="Profile"
        description={`${user.email ?? "Account settings"} — preferences persist in Convex under your account.`}
        meta={
          <span className="ml-badge" data-testid="profile-session">
            SIGNED IN
          </span>
        }
        actions={
          <Button variant="secondary" size="sm" onClick={() => void signOut()}>
            <LogOut size={13} aria-hidden="true" /> Sign out
          </Button>
        }
      />

      <div aria-live="polite" className="mb-4 min-h-[1.25rem]">
        {saveState === "saving" && <span className="ml-metric__hint">Saving…</span>}
        {saveState === "saved" && <span className="text-xs text-[var(--pos)]">Saved ✓</span>}
        {saveState === "error" && (
          <span role="alert" className="text-xs text-[var(--neg)]">
            {error ?? "Save failed."}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-start">
        <div className="min-w-0">
          <Card>
            <SectionHeader
              title="Account"
              description="Identity, appearance and order defaults. Each control saves immediately."
            />

            <div className="ml-form-grid mt-3">
              <div className="is-full">
                <Input
                  label="Display name"
                  value={name}
                  onChange={setName}
                  placeholder="Your display name"
                />
                <div className="mt-2 flex items-center gap-2">
                  <Button
                    size="sm"
                    disabled={!name.trim() || name.trim() === user.name || saveState === "saving"}
                    onClick={() => void save(() => updateProfile({ name: name.trim() }), "Name saved.")}
                  >
                    Save name
                  </Button>
                  {name.trim() && name.trim() !== user.name && (
                    <span className="ml-metric__hint">Unsaved change</span>
                  )}
                </div>
              </div>

              <div className="is-full">
                <p className="ml-metric__label">Email</p>
                <p className="ml-mono mt-1 text-[var(--fs-sm)] text-[var(--text-2)]">
                  {user.email ?? "—"}
                </p>
                <p className="ml-metric__hint mt-1">
                  Sign-in identity — it is managed by the auth provider, not editable here.
                </p>
              </div>

              <Select
                label="Theme"
                value={theme}
                onSelect={(val) => void save(() => setTheme(val as "light" | "dark" | "system"))}
                options={[
                  { value: "light", label: "Light" },
                  { value: "dark", label: "Dark" },
                  { value: "system", label: "System" },
                ]}
              />
              <Select
                label="Default currency"
                value={currency}
                onSelect={(val) => void save(() => setCurrency(val))}
                options={[
                  { value: "INR", label: "Indian Rupee (₹)" },
                  { value: "USD", label: "US Dollar ($)" },
                  { value: "EUR", label: "Euro (€)" },
                ]}
              />
              <Input
                label="Timezone"
                placeholder="Asia/Kolkata"
                value={timezone}
                onChange={(value) => setTimezone(value)}
                onSubmit={(value) => void save(() => setTimezone(value))}
              />
              <Select
                label="Default trading mode"
                value={defaultTradingMode}
                onSelect={(val) => void save(() => setDefaultTradingMode(val as "paper" | "live"))}
                options={[
                  { value: "paper", label: "Paper trading" },
                  { value: "live", label: "Live trading (disabled until a broker is connected)" },
                ]}
              />
              <Select
                label="Product type"
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
            <p className="ml-metric__hint mt-3">
              Timezone saves when you press Enter. Theme, currency and order defaults save on change.
            </p>
          </Card>

          <Card className="mt-4">
            <SectionHeader
              title="Notifications"
              description="Stored with your profile. This deployment delivers nothing by email or push."
            />
            <div className="mt-3 space-y-2">
              <label className="ml-switch">
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
                <span>
                  Price alerts
                  <span className="ml-metric__hint">
                    Alerts are still evaluated only when you run a check on the Alerts page.
                  </span>
                </span>
              </label>
              <label className="ml-switch">
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
                <span>
                  Weekly digest
                  <span className="ml-metric__hint">No digest is sent by this deployment.</span>
                </span>
              </label>
            </div>
          </Card>

          <Card className="mt-4">
            <SectionHeader
              title="Reset preferences"
              description="Restores the stored defaults for theme, currency, timezone, trading mode and order settings."
            />
            <Button
              variant="danger"
              size="sm"
              className="mt-3"
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
              Reset preferences
            </Button>
          </Card>
        </div>

        <Card className="min-w-0">
          <SectionHeader
            title="Paper trading account"
            description="Simulated — persisted in Convex, never a brokerage balance."
          />

          {paperAccount === undefined && (
            <div className="mt-3 flex flex-col gap-2" aria-busy="true">
              <span className="skeleton" style={{ height: 44 }} />
              <span className="skeleton" style={{ height: 44 }} />
            </div>
          )}
          {paperAccount === null && (
            <p className="ml-metric__hint mt-3">Creating your paper account…</p>
          )}
          {paperAccount && (
            <>
              <div className="ml-metric-grid mt-3">
                <div className="ml-metric">
                  <p className="ml-metric__label">Available cash</p>
                  <p className="ml-metric__value ml-mono">{formatInr(paperAccount.availableCash)}</p>
                </div>
                <div className="ml-metric">
                  <p className="ml-metric__label">Status</p>
                  <p className="ml-metric__value capitalize">{paperAccount.status}</p>
                </div>
              </div>

              {paperAccount.startingCapitalLocked ? (
                <p className="ml-ticket__hint ml-ticket__hint--warn mt-3" data-testid="capital-locked">
                  Starting capital is {formatInr(paperAccount.startingCapital)} and is locked because
                  orders already exist. Changing it now would rewrite past performance, so a new
                  baseline requires a fresh account.
                </p>
              ) : (
                <div className="mt-3">
                  <Input
                    label="Starting capital (₹)"
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
                  <p className="ml-metric__hint mt-1">
                    Press Enter to save. Locked once the first order is placed.
                  </p>
                </div>
              )}

              <p className="ml-detail-note mt-3">
                Cash, positions and P&amp;L are written only by the validated paper-trading engine
                (Trading and Portfolio). No order reaches a broker and live trading remains disabled.
              </p>
            </>
          )}
        </Card>
      </div>
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
