import "bootstrap/dist/css/bootstrap.min.css";
import React, { useState, useEffect } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { auth, database } from "./firebase";

// Components & Pages
import Navbar from "./components/Navbar";
import Login from "./pages/Login"; // ወይም "./components/Auth" እንደ ፋይልህ ስም
import UserView from "./pages/UserView";
import AdminDashboard from "./pages/AdminDashboard";
import OwnerDashboard from "./pages/OwnerDashboard";
import OperatorDashboard from "./pages/OperatorDashboard";

function App() {
  const [user, setUser] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // ተጠቃሚው መግባትና መውጣቱን የሚከታተል (Listener)
    const unsubscribe = auth.onAuthStateChanged(async (currentUser) => {
      setLoading(true);
      if (currentUser) {
        try {
          // የተጠቃሚውን Role ከFirebase Realtime Database ማምጣት
          const snapshot = await database.ref(`Users/${currentUser.uid}`).once('value');
          const userData = snapshot.val();
          
          setUser(currentUser);
          // Role ከሌለው እንደ 'user' (አሽከርካሪ) ይቆጠራል
          setUserRole(userData?.role || 'user'); 
        } catch (error) {
          console.error("የተጠቃሚ መረጃ ማግኘት አልተቻለም:", error);
          setUserRole('user');
        }
      } else {
        setUser(null);
        setUserRole(null);
      }
      setLoading(false);
    });

    // Cleanup subscription
    return () => unsubscribe();
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
    <Router>
      <div className="bg-dark min-vh-100 text-light overflow-hidden">
        {/* ተጠቃሚው ከገባ ብቻ Navbar ይታያል */}
        {user && <Navbar userRole={userRole} userEmail={user?.email} />}

        <div className="container-fluid p-0">
          <Routes>
            {/* ተጠቃሚው ካልገባ የትኛውም ገጽ ቢጻፍ ወደ Login ይሄዳል */}
            {!user ? (
              <Route path="*" element={<Login />} />
            ) : (
              <>
                {/* 2. እንደየድርሻው (Role) የሚታዩ ገጾች (Role-Based Routing) */}
                <Route path="/admin" element={userRole === 'admin' ? <AdminDashboard /> : <Navigate to={`/${userRole}`} />} />
                <Route path="/owner" element={userRole === 'owner' ? <OwnerDashboard /> : <Navigate to={`/${userRole}`} />} />
                <Route path="/operator" element={userRole === 'operator' ? <OperatorDashboard lotId="lot_01" /> : <Navigate to={`/${userRole}`} />} />
                <Route path="/user" element={userRole === 'user' ? <UserView /> : <Navigate to={`/${userRole}`} />} />

                {/* መነሻ ገጽ (/) ሲነካ ወደሚመለከተው ዳሽቦርድ ይመራዋል */}
                <Route path="/" element={<Navigate to={`/${userRole}`} replace />} />
                
                {/* የሌለ መንገድ ከተጻፈ ወደ ዋናው ገጽ ይመለሳል */}
                <Route path="*" element={<Navigate to={`/${userRole}`} replace />} />
              </>
            )}
          </Routes>
        </div>
      </div>
    </Router>
  );
}

export default App;