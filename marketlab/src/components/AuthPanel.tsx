import React, { useEffect, useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui";

export type AuthMode = "signin" | "signup";

export interface AuthPanelProps {
  initialMode?: AuthMode;
  /** Move focus into the first field when the panel is shown in a dialog. */
  autoFocus?: boolean;
}

const COPY: Record<AuthMode, { title: string; subtitle: string; submit: string; pending: string }> = {
  signin: {
    title: "Welcome back",
    subtitle: "Sign in to sync watchlists and your paper account.",
    submit: "Sign in",
    pending: "Signing in…",
  },
  signup: {
    title: "Create your account",
    subtitle: "Track instruments and paper trade with virtual funds.",
    submit: "Create account",
    pending: "Creating account…",
  },
};

interface FieldErrors {
  name?: string;
  email?: string;
  password?: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Sign-in / registration form backed by the existing Convex Auth password
 * provider. No other provider, recovery flow or schema change is introduced;
 * `signIn("password", …)` is called with exactly the flows the backend supports.
 */
const AuthPanel: React.FC<AuthPanelProps> = ({ initialMode = "signup", autoFocus = false }) => {
  const { signIn } = useAuthActions();
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  const firstFieldId = mode === "signup" ? "auth-name" : "auth-email";

  useEffect(() => {
    if (!autoFocus) return;
    const element = document.getElementById(firstFieldId);
    if (element instanceof HTMLInputElement) element.focus();
  }, [autoFocus, firstFieldId]);

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setFormError(null);
    setFieldErrors({});
  };

  const validate = (): FieldErrors => {
    const errors: FieldErrors = {};
    if (mode === "signup" && !name.trim()) errors.name = "Enter your name.";
    const trimmedEmail = email.trim();
    if (!trimmedEmail) errors.email = "Enter your email address.";
    else if (!EMAIL_PATTERN.test(trimmedEmail)) errors.email = "Enter a valid email address.";
    if (!password) errors.password = "Enter a password.";
    else if (mode === "signup" && password.length < 8) {
      errors.password = "Use at least 8 characters.";
    }
    return errors;
  };

  const submit = async () => {
    setFormError(null);
    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setPending(true);
    try {
      const result = await signIn(
        "password",
        mode === "signup"
          ? { flow: "signUp", email: email.trim(), password, name: name.trim() }
          : { flow: "signIn", email: email.trim(), password }
      );
      if (!result.signingIn) {
        setFormError("Sign-in did not complete. Check your details and try again.");
      }
    } catch (err) {
      setFormError(
        err instanceof Error && err.message
          ? err.message
          : "Authentication failed. Please try again."
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="ml-auth">
      <div className="ml-auth__tabs" role="tablist" aria-label="Account access">
        <button
          type="button"
          role="tab"
          id="auth-tab-signin"
          aria-controls="auth-form-panel"
          aria-selected={mode === "signin"}
          className="ml-auth__tab"
          onClick={() => switchMode("signin")}
        >
          Sign in
        </button>
        <button
          type="button"
          role="tab"
          id="auth-tab-signup"
          aria-controls="auth-form-panel"
          aria-selected={mode === "signup"}
          className="ml-auth__tab"
          onClick={() => switchMode("signup")}
        >
          Create account
        </button>
      </div>

      <div className="ml-auth__head">
        <h2 className="ml-auth__title" id="auth-title">
          {COPY[mode].title}
        </h2>
        <p className="ml-auth__sub">{COPY[mode].subtitle}</p>
      </div>

      <form
        id="auth-form-panel"
        role="tabpanel"
        aria-labelledby={`auth-tab-${mode}`}
        className="ml-auth__form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {mode === "signup" ? (
          <div className="ml-auth-field">
            <label className="ml-auth-label" htmlFor="auth-name">
              Name
            </label>
            <input
              id="auth-name"
              name="name"
              type="text"
              className="ml-auth-input"
              placeholder="Your name"
              autoComplete="name"
              value={name}
              disabled={pending}
              aria-invalid={Boolean(fieldErrors.name)}
              aria-describedby={fieldErrors.name ? "auth-name-error" : undefined}
              onChange={(event) => setName(event.target.value)}
            />
            {fieldErrors.name ? (
              <p className="ml-auth-error" id="auth-name-error">
                {fieldErrors.name}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="ml-auth-field">
          <label className="ml-auth-label" htmlFor="auth-email">
            Email
          </label>
          <input
            id="auth-email"
            name="email"
            type="email"
            className="ml-auth-input"
            placeholder="you@example.com"
            autoComplete="email"
            inputMode="email"
            value={email}
            disabled={pending}
            aria-invalid={Boolean(fieldErrors.email)}
            aria-describedby={fieldErrors.email ? "auth-email-error" : undefined}
            onChange={(event) => setEmail(event.target.value)}
          />
          {fieldErrors.email ? (
            <p className="ml-auth-error" id="auth-email-error">
              {fieldErrors.email}
            </p>
          ) : null}
        </div>

        <div className="ml-auth-field">
          <label className="ml-auth-label" htmlFor="auth-password">
            Password
          </label>
          <div className="ml-auth-password">
            <input
              id="auth-password"
              name="password"
              type={showPassword ? "text" : "password"}
              className="ml-auth-input"
              placeholder={mode === "signup" ? "At least 8 characters" : "Your password"}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              value={password}
              disabled={pending}
              aria-invalid={Boolean(fieldErrors.password)}
              aria-describedby={fieldErrors.password ? "auth-password-error" : undefined}
              onChange={(event) => setPassword(event.target.value)}
            />
            <button
              type="button"
              className="ml-auth-reveal"
              onClick={() => setShowPassword((shown) => !shown)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
            >
              {showPassword ? (
                <EyeOff size={15} aria-hidden="true" />
              ) : (
                <Eye size={15} aria-hidden="true" />
              )}
            </button>
          </div>
          {fieldErrors.password ? (
            <p className="ml-auth-error" id="auth-password-error">
              {fieldErrors.password}
            </p>
          ) : mode === "signup" ? (
            <p className="ml-auth-hint">At least 8 characters.</p>
          ) : null}
        </div>

        {formError ? (
          <p className="ml-auth-alert" role="alert">
            {formError}
          </p>
        ) : null}

        <Button type="submit" variant="primary" className="ml-auth__submit" disabled={pending} aria-busy={pending}>
          {pending ? (
            <>
              <Loader2 size={14} className="ml-palette-spinner" aria-hidden="true" />
              {COPY[mode].pending}
            </>
          ) : (
            COPY[mode].submit
          )}
        </Button>
      </form>

      <p className="ml-auth__switch">
        {mode === "signup" ? "Already have an account? " : "New to MarketLab? "}
        <button
          type="button"
          onClick={() => switchMode(mode === "signup" ? "signin" : "signup")}
        >
          {mode === "signup" ? "Sign in" : "Create an account"}
        </button>
      </p>
    </div>
  );
};

export default AuthPanel;
