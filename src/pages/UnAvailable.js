import React from 'react';
import { useNavigate } from 'react-router-dom';

function UnAvailable({ message, reason }) {
  const navigate = useNavigate();

  return (
    <div className="container vh-100 d-flex flex-column justify-content-center align-items-center text-white text-center animate__animated animate__fadeIn">
      {/* የሚንቀሳቀስ ምልክት (Pulse Animation) */}
      <div className="bg-danger p-4 rounded-circle mb-4 shadow-lg d-flex align-items-center justify-content-center" 
           style={{ width: '120px', height: '120px', animation: 'pulse 2s infinite' }}>
        <span style={{ fontSize: '60px' }}>🚫</span>
      </div>
      
      <h2 className="fw-bold mb-3 text-danger text-uppercase tracking-tighter">
        {message || "ይህ ፓርኪንግ በአሁኑ ሰዓት ተሞልቷል!"}
      </h2>
      
      <p className="lead opacity-75 mb-4 px-3" style={{ maxWidth: '500px' }}>
        {reason || "ይቅርታ፣ የመረጡት የፓርኪንግ ቦታ ምንም አይነት ክፍት ቦታ የለውም። እባክዎ በካርታው ላይ አቅራቢያ የሚገኙ ሌሎች አማራጮችን ይፈልጉ።"}
      </p>

      <div className="d-grid gap-2 d-sm-flex justify-content-sm-center">
        <button 
          className="btn btn-danger btn-lg px-5 fw-bold shadow" 
          onClick={() => navigate('/user')}
          style={{ borderRadius: '30px' }}
        >
          አቅራቢያ ያሉ ቦታዎችን እይ
        </button>
        
        <button 
          className="btn btn-outline-light btn-lg px-4" 
          onClick={() => window.location.reload()}
          style={{ borderRadius: '30px' }}
        >
          እንደገና ሞክር
        </button>
      </div>

      <div className="mt-5 text-muted small border-top pt-3 w-50 opacity-50">
        <p className="mb-0">ENDERASE Smart Parking System</p>
        <p>© 2026 - ደህንነቱ የተጠበቀ የፓርኪንግ አስተዳደር</p>
      </div>

      {/* CSS ለ Pulse Animation */}
      <style>{`
        @keyframes pulse {
          0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(220, 53, 69, 0.7); }
          70% { transform: scale(1.05); box-shadow: 0 0 0 20px rgba(220, 53, 69, 0); }
          100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(220, 53, 69, 0); }
        }
      `}</style>
    </div>
  );
}

export default UnAvailable;