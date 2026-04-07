import React from "react";

export default function Available({ slots = [], onBook }) {
  if (!slots.length) {
    return <p className="text-muted mb-0">አሁን ምንም ክፍት ፓርኪንግ የለም።</p>;
  }

  return (
    <div className="d-flex flex-column gap-2">
      {slots.map((slot) => (
        <div key={slot.id} className="d-flex justify-content-between align-items-center border rounded p-2">
          <div>
            <strong>{slot.name}</strong>
            <div className="small text-muted">ቀሪ ቦታ: {slot.availableSpots || 0}</div>
          </div>
          <button className="btn btn-success btn-sm" onClick={() => onBook(slot)}>
            ቦታ ያዝ
          </button>
        </div>
      ))}
    </div>
  );
}
