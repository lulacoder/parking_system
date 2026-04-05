import React from "react";

// spot = { id: "...", index: 1, availability: true, ... }
export default function Available({ spot, onBook }) {
  return (
    <div 
      className="card border-success shadow-sm h-100 text-center Available-Card border-2" 
      style={{ 
        cursor: "pointer", 
        backgroundColor: "#fafffa",
        transition: "all 0.3s ease-in-out",
        borderRadius: "15px",
        overflow: "hidden"
      }}
      onClick={() => onBook(spot.id)} // የቦታውን ID ለፈንክሽኑ ያስረክባል
    >
      
      {/* የላይኛው ክፍል */}
      <div className="card-header bg-success text-white fw-bold d-flex justify-content-between align-items-center border-0 py-3">
        <span className="small text-uppercase tracking-wider">ክፍት</span>
        <span className="badge bg-white text-success shadow-sm">Slot {spot.index}</span>
      </div>
      
      <div className="card-body py-4">
        {/* የፓርኪንግ ምልክት */}
        <div className="display-4 mb-2 animate__animated animate__pulse animate__infinite">
          <span className="text-success">🅿️</span>
        </div>
        
        <h5 className="card-title fw-bold text-dark mb-1">ቦታ {spot.index}</h5>
        <p className="card-text text-muted small px-2">
          ይህ ቦታ በአሁኑ ሰዓት ለመኪና ዝግጁ ነው።
        </p>
      </div>

      {/* የግርጌ ክፍል */}
      <div className="card-footer bg-transparent border-0 pb-4 px-4">
        <button className="btn btn-success btn-lg w-100 fw-bold shadow-sm py-2" style={{ borderRadius: "10px" }}>
          መኪና አስገባ (Check-In)
        </button>
      </div>

      {/* ለየት ያለ የ Hover ውጤት */}
      <style>{`
        .Available-Card:hover {
          transform: translateY(-10px);
          box-shadow: 0 15px 30px rgba(40, 167, 69, 0.2) !important;
          background-color: #ffffff !important;
        }
        .Available-Card:active {
          transform: scale(0.96);
        }
        .tracking-wider {
          letter-spacing: 1px;
        }
      `}</style>
    </div>
  );
}