import React, { createContext, useContext, useState, useEffect } from "react";
import { convexClient } from "../lib/convexClient";

type Theme = "light" | "dark" | "system";

interface UserProfile {
  userId: string;
  name: string;
  email: string;
  theme: Theme;
  currency: string;
  timezone: string;
  defaultTradingMode: "paper" | "live";
  defaultOrderSettings: {
    productType: string;
    duration: string;
    autoSquareOff: boolean;
  };
  watchlistPreferences: {
    defaultView: string;
    autoRefresh: boolean;
  };
  notificationPreferences: {
    emailNotifications: boolean;
    priceAlerts: boolean;
    weeklyDigest: boolean;
  };
  createdAt: number;
  updatedAt: number;
}

interface RootContextType {
  user: UserProfile | null;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  currency: string;
  setCurrency: (currency: string) => void;
  timezone: string;
  setTimezone: (timezone: string) => void;
  defaultTradingMode: "paper" | "live";
  setDefaultTradingMode: (mode: "paper" | "live") => void;
  loading: boolean;
  setLoading: (loading: boolean) => void;
}

const RootContext = createContext<RootContextType | undefined>(undefined);

export const useRootContext = () => {
  const ctx = useContext(RootContext);
  if (!ctx) {
    throw new Error("useRootContext must be used within RootProvider");
  }
  return ctx;
};

export const RootProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [theme, setTheme] = useState<Theme>("system");
  const [currency, setCurrency] = useState<string>("INR");
  const [timezone, setTimezone] = useState<string>("Asia/Kolkata");
  const [defaultTradingMode, setDefaultTradingMode] = useState<"paper" | "live">("paper");
  const [loading, setLoading] = useState(true);

  // Load user profile from convex on mount
  useEffect(() => {
    const loadUser = async () => {
      try {
        const profile = await convexClient.query<UserProfile | null>("userPreferences.get", {
          userId: "current_user",
        });
        setUser(profile);
      } catch (err) {
        console.error("Failed to load user profile:", err);
      } finally {
        setLoading(false);
      }
    };

    loadUser();
  }, []);

  const setThemeHandler = (newTheme: Theme) => {
    setTheme(newTheme);
    convexClient.mutation("userPreferences.patch", {
      theme: newTheme,
      userId: "current_user",
    });
  };

  const setCurrencyHandler = (newCurrency: string) => {
    setCurrency(newCurrency);
    convexClient.mutation("userPreferences.patch", {
      currency: newCurrency,
      userId: "current_user",
    });
  };

  const setTimezoneHandler = (newTimezone: string) => {
    setTimezone(newTimezone);
    convexClient.mutation("userPreferences.patch", {
      timezone: newTimezone,
      userId: "current_user",
    });
  };

  const setDefaultTradingModeHandler = (mode: "paper" | "live") => {
    setDefaultTradingMode(mode);
    convexClient.mutation("userPreferences.patch", {
      defaultTradingMode: mode,
      userId: "current_user",
    });
  };

  const value = {
    user,
    theme,
    setTheme: setThemeHandler,
    currency,
    setCurrency: setCurrencyHandler,
    timezone,
    setTimezone: setTimezoneHandler,
    defaultTradingMode,
    setDefaultTradingMode: setDefaultTradingModeHandler,
    loading,
    setLoading,
  };

  return (
    <RootContext.Provider value={value}>
      {children}
    </RootContext.Provider>
  );
};