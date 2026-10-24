import React from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/convex/_generated/api";
import { useRootContext } from "@/context/RootContext";
import { Card, Input, Select, Button } from "@/components/ui";

const Profile: React.FC = () => {
  const {
    user,
    currency,
    timezone,
    defaultTradingMode,
    setCurrency,
    setTimezone,
    setDefaultTradingMode,
    setTheme,
    theme,
  } = useRootContext();

  const { isPending } = useQuery({
    queryKey: ["userPreferences", user?.userId || ""],
    queryFn: () =>
      api.getUserPreferences({ userId: user?.userId || "" }),
    enabled: Boolean(user?.userId),
  });

  if (isPending && !user) {
    return (
      <div className="min-h-screen flex items-center justify-center py-12">
        <p className="text-center text-gray-400">Loading profile...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center py-12">
        <p className="text-gray-400">Please log in to view your profile</p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6">
      <header className="mb-6">
        <h1 className="text-3xl font-bold">Profile</h1>
        <p className="text-gray-400">Account settings</p>
      </header>

      <Card>
        <h2 className="text-xl font-semibold mb-6">Account Preferences</h2>

        <div className="mb-4">
          <label className="text-sm text-gray-300 mb-2 block">Theme</label>
          <Select
            value={theme}
            onSelect={(val) => setTheme(val as "light" | "dark" | "system")}
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
            onSelect={(val) => setCurrency(val)}
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
          />
        </div>

        <div className="mb-4">
          <label className="text-sm text-gray-300 mb-2 block">Default Trading Mode</label>
          <Select
            value={defaultTradingMode}
            onSelect={(val) => setDefaultTradingMode(val as "paper" | "live")}
            options={[
              { value: "paper", label: "Paper Trading" },
              { value: "live", label: "Live Trading (disabled until broker connected)" },
            ]}
          />
        </div>

        <div className="mb-4">
          <label className="text-sm text-gray-300 mb-2 block">Product Type</label>
          <Select
            options={[
              { value: "delivery", label: "Delivery" },
              { value: "intraday", label: "Intraday" },
              { value: "margin", label: "Margin" },
            ]}
          />
        </div>

        <Button
          variant="danger"
          size="sm"
          className="mt-4 w-full"
          onClick={() => {
            if (confirm("Reset all preferences to defaults?")) {
              setTheme("system");
              setCurrency("INR");
              setTimezone("Asia/Kolkata");
              setDefaultTradingMode("paper");
            }
          }}
        >
          Reset Preferences
        </Button>
      </Card>
    </div>
  );
};

export default Profile;