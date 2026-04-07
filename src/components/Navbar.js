import React from "react";
import { auth } from "../firebase";

function Navbar({ userRole, userEmail }) {
  const handleLogout = () => {
    // ተጠቃሚው በስህተት እንዳይወጣ ማረጋገጫ መጠየቅ
    if (window.confirm("እርግጠኛ ነዎት ከመለያዎ መውጣት ይፈልጋሉ?")) {
      auth.signOut();
    }
  };

  // የሥራ ድርሻውን ወደ አማርኛ መቀየር (ለተጠቃሚው እንዲቀል)
  const getRoleLabel = (role) => {
    const roles = {
      admin: "ሲስተም አድሚን",
      owner: "የፓርኪንግ ባለቤት",
      operator: "ኦፕሬተር",
      user: "አሽከርካሪ (Driver)",
      driver: "አሽከርካሪ (Driver)"
    };
    return roles[role] || role;
  };

  return (
    <nav className="navbar navbar-expand-lg navbar-dark bg-primary shadow-lg sticky-top px-3 py-2">
      <div className="container-fluid">
        {/* የሲስተሙ ስም እና አርማ */}
        <div className="navbar-brand fw-bold d-flex align-items-center" style={{ cursor: 'default' }}>
          <div className="bg-white rounded-circle p-1 me-2 shadow-sm d-flex align-items-center justify-content-center" style={{ width: '40px', height: '40px' }}>
            <span className="fs-4">🚗</span>
          </div>
          <div className="d-flex flex-column" style={{ lineHeight: '1.1' }}>
            <span className="tracking-wider fs-4">ENDERASE</span>
            <small className="text-white-50 fw-normal" style={{ fontSize: '10px', letterSpacing: '1px' }}>SMART PARKING</small>
          </div>
        </div>

        {/* የተጠቃሚ መረጃ እና መውጫ (Logout) */}
        <div className="d-flex align-items-center ms-auto bg-dark bg-opacity-10 p-2 rounded-4 px-3 border border-white border-opacity-10 shadow-inner">
          <div className="me-3 text-end d-none d-md-block border-end pe-3 border-white border-opacity-25">
            <div className="fw-bold text-white small mb-0" style={{ fontSize: '0.85rem' }}>
              {userEmail}
            </div>
            <span className="badge bg-warning text-dark fw-bold" style={{ fontSize: "9px", padding: "3px 8px" }}>
              {getRoleLabel(userRole)}
            </span> 
          </div>

          <button 
            className="btn btn-danger btn-sm fw-bold px-3 ms-2 shadow" 
            onClick={handleLogout}
            style={{ 
              borderRadius: "10px", 
              fontSize: "13px",
              transition: "0.2s"
            }}
          >
            <i className="bi bi-box-arrow-right me-1"></i> ውጣ
          </button>
        </div>
      </div>

      <style>{`
        .tracking-wider { letter-spacing: 2px; }
        .shadow-inner { box-shadow: inset 0 2px 4px rgba(0,0,0,0.05); }
        .navbar { background: linear-gradient(90deg, #0d6efd 0%, #0b5ed7 100%); }
        .btn-danger:hover { transform: scale(1.05); background-color: #dc3545 !important; }
      `}</style>
    </nav>
  );
}

export default Navbar;
