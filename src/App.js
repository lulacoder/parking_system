import React, { useEffect, useMemo, useRef, useState } from "react";
import { BrowserRouter as Router, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Toaster } from "sonner";

import { auth, firestore } from "./firebase";
import Navbar from "./components/Navbar";
import Login from "./pages/Login";
import Signup from "./pages/signup";
import DriverHome from "./pages/DriverHome";
import AdminHome from "./pages/AdminHome";
import OwnerHome from "./pages/OwnerHome";
import OperatorHome from "./pages/OperatorHome";
import DriverCheckInConfirm from "./pages/DriverCheckInConfirm";
import { RedirectHome, RequireAuth, RequireRole } from "./app/RoleGuards";
import { FALLBACK_ROLE, canRoleAccessPath, getRoleHome, sanitizeRole } from "./app/roleUtils";
import { queryClient } from "./lib/serverState/queryClient";

const brandLogoUrl = `${process.env.PUBLIC_URL}/logo.svg`;

function App() {
  const [user, setUser] = useState(null);
  const [userRole, setUserRole] = useState(FALLBACK_ROLE);
  const [loading, setLoading] = useState(true);
  const previousUidRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    const timeoutRef = setTimeout(() => {
      if (mounted) setLoading(false);
    }, 8000);

    const unsubscribe = auth.onAuthStateChanged(
      async (currentUser) => {
        if (!mounted) return;
        const currentUid = currentUser?.uid || null;
        if (previousUidRef.current !== currentUid) {
          queryClient.clear();
          previousUidRef.current = currentUid;
        }
        setLoading(true);

        if (!currentUser) {
          setUser(null);
          setUserRole(FALLBACK_ROLE);
          setLoading(false);
          clearTimeout(timeoutRef);
          return;
        }

        // Never block auth state by profile fetch.
        setUser(currentUser);
        setUserRole(FALLBACK_ROLE);

        try {
          const snapshot = await Promise.race([
            firestore.collection("users").doc(currentUser.uid).get(),
            new Promise((_, reject) => setTimeout(() => reject(new Error("PROFILE_TIMEOUT")), 5000)),
          ]);

          const hasProfile =
            typeof snapshot?.exists === "function" ? snapshot.exists() : Boolean(snapshot?.exists);
          let profile = hasProfile ? snapshot.data() : null;

          // Legacy compatibility: some older environments seeded "Users" (capital U).
          if (!profile) {
            const legacySnapshot = await firestore.collection("Users").doc(currentUser.uid).get();
            const hasLegacyProfile =
              typeof legacySnapshot?.exists === "function"
                ? legacySnapshot.exists()
                : Boolean(legacySnapshot?.exists);
            profile = hasLegacyProfile ? legacySnapshot.data() : null;
          }

          if (!profile) {
            console.warn(`Profile missing for user ${currentUser.uid}; using fallback role.`);
          } else if (profile.status && profile.status !== "active") {
            console.warn(`User ${currentUser.uid} has status=${profile.status}; forcing sign-out.`);
            await auth.signOut();
            return;
          } else {
            setUserRole(sanitizeRole(profile.role));
          }
        } catch (error) {
          console.error("Failed to resolve user profile from Firestore:", error);
        } finally {
          if (mounted) {
            setLoading(false);
            clearTimeout(timeoutRef);
          }
        }
      },
      (error) => {
        console.error("Auth listener failed:", error);
        if (!mounted) return;
        setUser(null);
        setUserRole(FALLBACK_ROLE);
        setLoading(false);
        clearTimeout(timeoutRef);
      }
    );

    return () => {
      mounted = false;
      clearTimeout(timeoutRef);
      unsubscribe();
    };
  }, []);

  const roleHome = useMemo(() => getRoleHome(userRole), [userRole]);

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 text-white">
        <img src={brandLogoUrl} alt="Enderase" className="h-24 w-24 rounded-2xl bg-white object-cover p-2 shadow-soft" />
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-blue-300 border-t-blue-600" role="status"></div>
        <h3 className="mt-5 font-heading text-2xl font-bold uppercase tracking-[0.25em]">E N D E R A S E</h3>
        <p className="mt-2 text-sm text-slate-400">Loading authentication...</p>
      </div>
    );
  }

  return (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <div className="min-h-screen overflow-hidden bg-background text-foreground surface-grid">
        <Toaster theme="light" richColors position="top-right" />
        {user && <Navbar userRole={userRole} userEmail={user?.email} />}

        <div className="mx-auto w-full max-w-[1400px] px-4 pb-8 pt-6 md:px-6">
          <Routes>
            <Route path="/login" element={<LoginRoute user={user} role={userRole} />} />
            <Route path="/signup" element={user ? <Navigate to={roleHome} replace /> : <Signup />} />
            <Route path="/driver/checkin-confirm" element={<DriverCheckInConfirmRoute user={user} role={userRole} />} />

            <Route element={<RequireAuth user={user} loading={loading} />}>
              <Route element={<RequireRole user={user} role={userRole} allowedRoles={["driver"]} />}>
                <Route path="/driver/home" element={<DriverHome />} />
                <Route path="/driver/*" element={<Navigate to="/driver/home" replace />} />
              </Route>

              <Route element={<RequireRole user={user} role={userRole} allowedRoles={["operator"]} />}>
                <Route path="/operator/home" element={<OperatorHome />} />
                <Route path="/operator/*" element={<Navigate to="/operator/home" replace />} />
              </Route>

              <Route element={<RequireRole user={user} role={userRole} allowedRoles={["owner"]} />}>
                <Route path="/owner/home" element={<OwnerHome />} />
                <Route path="/owner/*" element={<Navigate to="/owner/home" replace />} />
              </Route>

              <Route element={<RequireRole user={user} role={userRole} allowedRoles={["admin"]} />}>
                <Route path="/admin/home" element={<AdminHome />} />
                <Route path="/admin/*" element={<Navigate to="/admin/home" replace />} />
              </Route>
            </Route>

            <Route path="/" element={<RedirectHome user={user} role={userRole} loading={loading} />} />
            <Route path="*" element={<RedirectHome user={user} role={userRole} loading={loading} />} />
          </Routes>
        </div>
      </div>
    </Router>
  );
}

function LoginRoute({ user, role }) {
  const location = useLocation();
  if (!user) return <Login />;

  const params = new URLSearchParams(location.search);
  const next = params.get("next") || "";
  const sanitizedRole = sanitizeRole(role);
  if (canRoleAccessPath(sanitizedRole, next)) {
    return <Navigate to={next} replace />;
  }
  return <Navigate to={getRoleHome(sanitizedRole)} replace />;
}

function DriverCheckInConfirmRoute({ user, role }) {
  const location = useLocation();
  if (!user) {
    const next = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  if (sanitizeRole(role) !== "driver") {
    return <Navigate to={getRoleHome(role)} replace />;
  }
  return <DriverCheckInConfirm />;
}

export default App;
