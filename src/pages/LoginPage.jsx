import React, { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ShieldCheck, KeyRound, UserCog } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, login, loading } = useAuth();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (!loading && isAuthenticated) {
    const destination = location.state?.from || '/';
    return <Navigate to={destination} replace />;
  }

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      await login({ username, password });
      navigate(location.state?.from || '/', { replace: true });
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[1.05fr_0.95fr]">
      {/* ── Brand panel — navy authority, gold thread, editorial voice ── */}
      <section className="relative hidden overflow-hidden bg-navy-600 px-10 py-12 text-white lg:flex lg:flex-col lg:justify-between xl:px-16">
        {/* Atmospheric depth: soft navy gradient + faint gold glow */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              'radial-gradient(at 18% 12%, rgba(184,134,11,0.16) 0px, transparent 42%), linear-gradient(160deg, #1a3a52 0%, #163046 55%, #112536 100%)',
          }}
        />

        <div className="relative mc-reveal-stagger">
          {/* Gold wordmark mark */}
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full border border-gold-400/60 bg-gold-500/15 text-sm font-bold tracking-[0.14em] text-gold-300">
              AI
            </span>
            <div>
              <p className="font-display text-lg font-semibold leading-tight tracking-tight">MJR-EHR</p>
              <p className="text-[11px] uppercase tracking-[0.24em] text-gold-300/90">Intelligent Clinical Agent</p>
            </div>
          </div>
        </div>

        <div className="relative mc-reveal-stagger">
          <h1 className="max-w-xl font-display text-4xl font-semibold leading-[1.1] tracking-tight xl:text-5xl">
            A premium clinical record, made intelligent.
          </h1>
          <p className="mt-5 max-w-lg text-base leading-7 text-white/75">
            Secure clinician sign-in for the production workflow. This replaces the old demo role switcher — use a real
            clinician account, and the client refreshes expired access tokens automatically while your session stays valid.
          </p>

          <div className="mt-9 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm">
              <KeyRound size={18} strokeWidth={2} className="text-white/55" aria-hidden="true" />
              <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-gold-300">Auth</p>
              <p className="mt-2 text-sm leading-6 text-white/80">JWT access token plus refresh rotation.</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm">
              <ShieldCheck size={18} strokeWidth={2} className="text-white/55" aria-hidden="true" />
              <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-gold-300">Portal</p>
              <p className="mt-2 text-sm leading-6 text-white/80">Patient access is isolated behind a separate session.</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm">
              <UserCog size={18} strokeWidth={2} className="text-white/55" aria-hidden="true" />
              <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-gold-300">Bootstrap</p>
              <p className="mt-2 text-sm leading-6 text-white/80">First user via <code className="font-mono text-xs text-white/90">npm run create-user</code>.</p>
            </div>
          </div>
        </div>

        <div className="relative flex items-center gap-2 text-xs text-white/55">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-gold-400" aria-hidden="true" />
          Synthetic EHR Demo · No PHI · Not for clinical use
        </div>
      </section>

      {/* ── Sign-in panel — warm ivory ground, offWhite card ── */}
      <section className="flex min-h-screen items-center justify-center px-4 py-10 sm:px-8">
        <div className="mc-card mc-reveal relative w-full max-w-md p-8 shadow-mc-xl sm:p-10">
          {/* The single gold moment on the sign-in side: a refined gold key-line
              crowning the card. One genuine accent, not decoration. */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-gold-500/0 via-gold-500 to-gold-500/0"
          />
          <div className="mc-reveal-stagger">
          {/* Compact brand mark — visible on small screens where the panel is hidden */}
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="flex h-8 w-8 items-center justify-center rounded-full border border-gold-400/60 bg-gold-500/10 text-[11px] font-bold tracking-[0.12em] text-gold-600">
              AI
            </span>
            <span className="font-display text-base font-semibold tracking-tight text-navy-700">MJR-EHR</span>
          </div>

          <p className="mc-section-label">Clinician Access</p>
          <h2 className="mt-1 font-display text-3xl font-semibold tracking-tight text-navy-700">Sign in</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">Use your clinician credentials to enter the workflow.</p>

          <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
            <label className="block">
              <span className="label-clinical">Username</span>
              <input
                className="input-clinical"
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                required
              />
            </label>

            <label className="block">
              <span className="label-clinical">Password</span>
              <input
                className="input-clinical"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>

            {error ? (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-xl border border-danger-100 bg-danger-50 px-4 py-3 text-sm font-medium text-danger-600"
              >
                <span aria-hidden="true" className="mt-0.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-danger-500" />
                {error}
              </div>
            ) : null}

            <button
              className="touch-btn mc-btn-fill mc-btn-navy w-full bg-navy-600 text-white hover:bg-navy-700 active:bg-navy-800 focus:ring-navy-500 disabled:cursor-not-allowed disabled:opacity-45 disabled:saturate-50 disabled:shadow-none disabled:active:scale-100"
              type="submit"
              disabled={submitting}
            >
              {submitting ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          <p className="mt-7 border-t border-slate-100 pt-5 text-sm leading-6 text-slate-600">
            Patient access lives at{' '}
            <span className="font-mono text-xs font-semibold text-navy-700">/portal</span> and uses a separate session model.
          </p>
          </div>
        </div>
      </section>
    </div>
  );
}
