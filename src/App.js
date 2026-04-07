import "bootstrap/dist/css/bootstrap.min.css";
import React, { useState, useEffect } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { auth, database } from "./firebase";

// Components & Pages
import Navbar from "./components/Navbar";
import Login from "./pages/Login";
import Signup from "./pages/signup";
import UserView from "./pages/UserView";
import AdminDashboard from "./pages/AdminDashboard";
import OwnerDashboard from "./pages/OwnerDashboard";
import OperatorDashboard from "./pages/OperatorDashboard";

function App() {
  const [user, setUser] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const authInitTimeout = setTimeout(() => {
      setLoading(false);
    }, 8000);

    // ተጠቃሚው መግባትና መውጣቱን የሚከታተል (Listener)
    const unsubscribe = auth.onAuthStateChanged(async (currentUser) => {
      setLoading(true);
      if (currentUser) {
        // Do not block routing on profile fetch; default role to user first.
        setUser(currentUser);
        setUserRole("user");

        try {
          const snapshot = await Promise.race([
            database.ref(`Users/${currentUser.uid}`).once("value"),
            new Promise((_, reject) => setTimeout(() => reject(new Error("Profile fetch timeout")), 5000)),
          ]);
          const userData = snapshot.val();
          setUserRole(userData?.role || "user");
        } catch (error) {
          console.error("Failed to fetch user profile:", error);
          // Keep authenticated user and fallback role.
          setUserRole("user");
        }
      } else {
        setUser(null);
        setUserRole(null);
      }
      setLoading(false);
      clearTimeout(authInitTimeout);
    }, (error) => {
      console.error("Auth listener failed:", error);
      setUser(null);
      setUserRole(null);
      setLoading(false);
      clearTimeout(authInitTimeout);
    });

    // Cleanup subscription
    return () => {
      clearTimeout(authInitTimeout);
      unsubscribe();
    };
  }, []);

  // 1. የጭነት ጊዜ (Loading Screen) - ነጭ ስክሪን እንዳይመጣ ይረዳል
  if (loading) {
    return (
      <div className="d-flex flex-column justify-content-center align-items-center vh-100 bg-dark text-white">
        <div className="spinner-border text-primary mb-3" role="status" style={{ width: '3rem', height: '3rem' }}></div>
        <h3 className="fw-bold text-uppercase tracking-wider animate__animated animate__pulse animate__infinite">E N D E R A S E</h3>
        <p className="text-secondary small mt-2">ስማርት የፓርኪንግ ሲስተም በመጫን ላይ...</p>
      </div>
    );
  }

  return (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <div className="bg-dark min-vh-100 text-light overflow-hidden">
        {/* ተጠቃሚው ከገባ ብቻ Navbar ይታያል */}
        {user && <Navbar userRole={userRole} userEmail={user?.email} />}

        <div className="container-fluid p-0">
          <Routes>
            {/* ተጠቃሚው ካልገባ የትኛውም ገጽ ቢጻፍ ወደ Login ይሄዳል */}
            {!user ? (
              <>
                <Route path="/login" element={<Login />} />
                <Route path="/signup" element={<Signup />} />
                <Route path="/" element={<Navigate to="/login" replace />} />
                <Route path="*" element={<Navigate to="/login" replace />} />
              </>
            ) : (
              <>
                <Route path="/login" element={<Navigate to={`/${userRole || "user"}`} replace />} />
                <Route path="/signup" element={<Navigate to={`/${userRole || "user"}`} replace />} />

                <Route path="/admin" element={userRole === "admin" ? <AdminDashboard /> : <Navigate to={`/${userRole || "user"}`} replace />} />
                <Route path="/owner" element={userRole === "owner" ? <OwnerDashboard /> : <Navigate to={`/${userRole || "user"}`} replace />} />
                <Route path="/operator" element={userRole === "operator" ? <OperatorDashboard lotId="lot_01" /> : <Navigate to={`/${userRole || "user"}`} replace />} />
                <Route path="/user" element={userRole === "user" ? <UserView /> : <Navigate to={`/${userRole || "user"}`} replace />} />

                <Route path="/" element={<Navigate to={`/${userRole || "user"}`} replace />} />
                <Route path="*" element={<Navigate to={`/${userRole || "user"}`} replace />} />
              </>
            )}
          </Routes>
        </div>
      </div>
    </Router>
  );
}

export default App;
