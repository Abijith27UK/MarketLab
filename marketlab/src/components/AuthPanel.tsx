import React, { useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { Button, Input } from "@/components/ui";

type Mode = "signin" | "signup";

/**
 * Registration / sign-in form backed by Convex Auth (Password provider).
 */
const AuthPanel: React.FC = () => {
  const { signIn } = useAuthActions();
  const [mode, setMode] = useState<Mode>("signup");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async () => {
    setError(null);
    if (!email.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (mode === "signup" && !name.trim()) {
      setError("Enter your name.");
      return;
    }
    setPending(true);
    try {
      const result = await signIn(
        "password",
        mode === "signup"
          ? { flow: "signUp", email, password, name: name.trim() }
          : { flow: "signIn", email, password }
      );
      if (!result.signingIn) {
        setError("Sign-in did not complete. Please try again.");
      }
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : "Authentication failed. Please try again."
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-900 p-8 text-center max-w-md mx-auto">
      <h2 className="text-2xl font-bold mb-1">MarketLab</h2>
      <p className="text-gray-400 mb-6 text-sm">
        {mode === "signup"
          ? "Create an account to track instruments and paper trade."
          : "Sign in to your account."}
      </p>

      <form
        className="space-y-3 text-left"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {mode === "signup" && (
          <div>
            <Input
              label="Name"
              placeholder="Your name"
              value={name}
              onChange={setName}
              disabled={pending}
            />
          </div>
        )}
        <div>
          <Input
            label="Email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={setEmail}
            disabled={pending}
          />
        </div>
        <div>
          <Input
            label="Password"
            type="password"
            placeholder="At least 8 characters"
            value={password}
            onChange={setPassword}
            disabled={pending}
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}

        <Button variant="primary" className="w-full" disabled={pending}>
          {pending
            ? mode === "signup"
              ? "Creating account..."
              : "Signing in..."
            : mode === "signup"
              ? "Create account"
              : "Sign in"}
        </Button>
      </form>

      <button
        type="button"
        className="mt-4 text-sm text-gray-400 hover:text-white underline"
        onClick={() => {
          setError(null);
          setMode(mode === "signup" ? "signin" : "signup");
        }}
      >
        {mode === "signup"
          ? "Already have an account? Sign in"
          : "New to MarketLab? Create an account"}
      </button>
    </div>
  );
};

export default AuthPanel;
