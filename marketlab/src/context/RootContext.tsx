import React, { createContext, useContext, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { useConvexAuth } from "@convex-dev/auth/react";
import { api } from "@/convex/_generated/api";

type Theme = "light" | "dark" | "system";

interface UserProfile {
  userId: string;
  name: string;
  email: string | null;
  theme: Theme;
  currency: string;
  timezone: string;
  defaultTradingMode: "paper" | "live";
  defaultOrderSettings: {
    productType: string;
    duration: string;
    autoSquareOff: boolean;
  };
  notificationPreferences: {
    emailNotifications: boolean;
    priceAlerts: boolean;
    weeklyDigest: boolean;
  };
}

interface RootContextType {
  user: UserProfile | null;
  isAuthenticated: boolean;
  theme: Theme;
  setTheme: (theme: Theme) => Promise<void> | void;
  currency: string;
  setCurrency: (currency: string) => Promise<void> | void;
  timezone: string;
  setTimezone: (timezone: string) => Promise<void> | void;
  defaultTradingMode: "paper" | "live";
  setDefaultTradingMode: (mode: "paper" | "live") => Promise<void> | void;
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
  const { isLoading: authLoading, isAuthenticated } = useConvexAuth();

  // Reactive profile from the backend; null when signed out / not yet created.
  const profile = useQuery(api.users.getProfile, {});
  const ensureProfile = useMutation(api.users.ensureProfile);
  const updateProfile = useMutation(api.users.updateProfile);

  // Create the profile document once after sign-in (idempotent on the server).
  useEffect(() => {
    if (isAuthenticated && profile === null) {
      ensureProfile().catch((err) => {
        console.error("Failed to ensure user profile:", err);
      });
    }
  }, [isAuthenticated, profile, ensureProfile]);

  const loading =
    authLoading || (isAuthenticated && profile === undefined) || profile === undefined;

  const value: RootContextType = {
    user: profile ?? null,
    isAuthenticated,
    theme: profile?.theme ?? "dark",
    setTheme: async (theme) => {
      await updateProfile({ theme });
    },
    currency: profile?.currency ?? "INR",
    setCurrency: async (currency) => {
      await updateProfile({ currency });
    },
    timezone: profile?.timezone ?? "Asia/Kolkata",
    setTimezone: async (timezone) => {
      await updateProfile({ timezone });
    },
    defaultTradingMode: profile?.defaultTradingMode ?? "paper",
    setDefaultTradingMode: async (defaultTradingMode) => {
      await updateProfile({ defaultTradingMode });
    },
    loading,
    setLoading: () => {
      /* auth/profile loading is derived; kept for API compatibility */
    },
  };

  return <RootContext.Provider value={value}>{children}</RootContext.Provider>;
};
