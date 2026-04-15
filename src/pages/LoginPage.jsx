import React, { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
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
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#eff6ff,_#e0f2fe_40%,_#f8fafc_80%)] px-4 py-10">
      <div className="mx-auto grid min-h-[calc(100vh-5rem)] max-w-5xl items-center gap-8 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-[2rem] border border-sky-100 bg-white/80 p-8 shadow-[0_30px_80px_rgba(14,116,144,0.12)] backdrop-blur sm:p-10">
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-sky-700">AI-EHR</p>
          <h1 className="mt-4 max-w-lg text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">
            Secure clinician sign-in for the production workflow.
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-slate-600 sm:text-lg">
            This replaces the old demo role switcher. Use a real clinician account, and the client will refresh expired access
            tokens automatically while your refresh session remains valid.
          </p>

          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-sky-100 bg-sky-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-sky-800">Auth</p>
              <p className="mt-2 text-sm text-slate-700">JWT access token plus refresh rotation.</p>
            </div>
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Portal</p>
              <p className="mt-2 text-sm text-slate-700">Patient access is isolated behind a separate cookie-backed session.</p>
            </div>
            <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Bootstrap</p>
              <p className="mt-2 text-sm text-slate-700">Create the first user with `npm run create-user -- --help`.</p>
            </div>
          </div>
        </section>

        <section className="rounded-[2rem] border border-slate-200 bg-white p-8 shadow-[0_24px_60px_rgba(15,23,42,0.12)] sm:p-10">
          <div className="mb-6">
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-500">Clinician Access</p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-900">Sign in</h2>
          </div>

          <form className="space-y-4" onSubmit={handleSubmit}>
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Username</span>
              <input
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-base outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-100"
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                required
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Password</span>
              <input
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-base outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-100"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>

            {error ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {error}
              </div>
            ) : null}

            <button
              className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-base font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
              type="submit"
              disabled={submitting}
            >
              {submitting ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          <p className="mt-6 text-sm leading-6 text-slate-500">
            Patient access lives at <span className="font-semibold text-slate-700">`/portal`</span> and uses a separate session model.
          </p>
        </section>
      </div>
    </div>
  );
}
