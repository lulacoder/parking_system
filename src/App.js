import "bootstrap/dist/css/bootstrap.min.css";
import React, { useEffect, useMemo, useState } from "react";
import { BrowserRouter as Router, Navigate, Route, Routes, useLocation } from "react-router-dom";

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
import { FALLBACK_ROLE, getRoleHome, sanitizeRole } from "./app/roleUtils";

function App() {
  const [user, setUser] = useState(null);
  const [userRole, setUserRole] = useState(FALLBACK_ROLE);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const timeoutRef = setTimeout(() => {
      if (mounted) setLoading(false);
    }, 8000);

    const unsubscribe = auth.onAuthStateChanged(
      async (currentUser) => {
        if (!mounted) return;
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
      <div className="d-flex flex-column justify-content-center align-items-center vh-100 bg-dark text-white">
        <div className="spinner-border text-primary mb-3" role="status" style={{ width: "3rem", height: "3rem" }}></div>
        <h3 className="fw-bold text-uppercase">E N D E R A S E</h3>
        <p className="text-secondary small mt-2">Loading authentication...</p>
      </div>
    );
  }

  return (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <div className="bg-dark min-vh-100 text-light overflow-hidden">
        {user && <Navbar userRole={userRole} userEmail={user?.email} />}

        <div className="container-fluid p-0">
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
  const isSafeInternalPath = next.startsWith("/") && !next.startsWith("//");
  const sanitizedRole = sanitizeRole(role);
  if (isSafeInternalPath && (sanitizedRole === "driver" || !next.startsWith("/driver"))) {
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
