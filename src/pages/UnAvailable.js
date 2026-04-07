import React from "react";

function UnAvailable({ slots = [] }) {
  if (!slots.length) {
    return <p className="text-muted mb-0">ሁሉም ፓርኪንጎች አሁን ክፍት ናቸው።</p>;
  }

  return (
    <div className="d-flex flex-column gap-2">
      {slots.map((slot) => (
        <div key={slot.id} className="d-flex justify-content-between align-items-center border rounded p-2 bg-light">
          <div>
            <strong>{slot.name}</strong>
            <div className="small text-muted">ቀሪ ቦታ: {slot.availableSpots || 0}</div>
          </div>
          <span className="badge bg-secondary">ተሞልቷል</span>
        </div>
      ))}
    </div>
  );
}

export default UnAvailable;
