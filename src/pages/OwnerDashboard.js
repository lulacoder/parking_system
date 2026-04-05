import React, { useState, useEffect } from "react";
import { database, auth } from "../firebase";

function OwnerView() {
  const [ownerData, setOwnerData] = useState(null);
  const [revenue, setRevenue] = useState({ totalOwnerRevenue: 0, totalSystemCommission: 0 });
  const [parkingLot, setParkingLot] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchOwnerData = async () => {
      try {
        const userSnapshot = await database.ref(`Users/${auth.currentUser.uid}`).once("value");
        const userData = userSnapshot.val();
        setOwnerData(userData);

        if (userData && userData.parkingLotId) {
          const lotId = userData.parkingLotId;

          // የገቢ መረጃን መከታተል
          const revRef = database.ref(`Revenue/${lotId}`);
          revRef.on("value", (snapshot) => {
            if (snapshot.exists()) setRevenue(snapshot.val());
          });

          // የቦታ ሁኔታን መከታተል
          const lotRef = database.ref(`Parking_Lots/${lotId}`);
          lotRef.on("value", (snapshot) => {
            if (snapshot.exists()) setParkingLot(snapshot.val());
            setLoading(false);
          });

          // Cleanup function
          return () => {
            revRef.off();
            lotRef.off();
          };
        }
      } catch (error) {
        console.error("Data fetching error:", error);
      }
    };

    fetchOwnerData();
  }, []);

  if (loading) return (
    <div className="d-flex justify-content-center align-items-center vh-100 text-white">
      <div className="spinner-grow text-success" role="status"></div>
      <span className="ms-3">የባለቤት መረጃ በመጫን ላይ...</span>
    </div>
  );

  return (
    <div className="container mt-4 text-white animate__animated animate__fadeIn">
      {/* ርዕስ */}
      <div className="d-flex justify-content-between align-items-center mb-4 p-3 bg-dark rounded border-bottom border-success border-3">
        <div>
          <h2 className="fw-bold mb-0 text-success">🏢 የባለቤት ዳሽቦርድ</h2>
          <small className="text-secondary text-uppercase tracking-widest">ባለቤት፦ {ownerData?.name}</small>
        </div>
        <div className="text-end">
          <span className="badge bg-success p-2 px-3 shadow-sm">{parkingLot?.name}</span>
        </div>
      </div>

      <div className="row g-4">
        {/* የገቢ ካርድ */}
        <div className="col-md-7">
          <div className="card bg-success text-white shadow-lg border-0 p-4 h-100" style={{ borderRadius: "20px", background: "linear-gradient(45deg, #198754, #20c997)" }}>
            <div className="d-flex justify-content-between">
              <h5 className="text-uppercase small fw-bold opacity-75">የእርስዎ የተጣራ ገቢ (90%)</h5>
              <i className="bi bi-wallet2 fs-3 opacity-50"></i>
            </div>
            <h1 className="fw-bold display-4 my-2">{(revenue.totalOwnerRevenue || 0).toLocaleString()} <small className="fs-4">ETB</small></h1>
            <hr className="opacity-25" />
            <div className="d-flex justify-content-between small">
              <span>የሲስተም ኮሚሽን (10%):</span>
              <span className="fw-bold">{(revenue.totalSystemCommission || 0).toLocaleString()} ETB</span>
            </div>
          </div>
        </div>

        {/* የቦታዎች ካርድ */}
        <div className="col-md-5">
          <div className="card bg-dark border-success text-white shadow-lg p-4 h-100" style={{ borderRadius: "20px", borderWidth: "2px" }}>
            <h5 className="text-uppercase small fw-bold text-success opacity-75">የቦታዎች ሁኔታ (Live)</h5>
            <div className="d-flex align-items-baseline gap-2 mt-3">
              <h1 className="fw-bold display-5 m-0 text-success">{parkingLot?.availableSpots}</h1>
              <h4 className="opacity-50 m-0 text-white-50">/ {parkingLot?.totalSpots} ክፍት</h4>
            </div>
            
            <div className="mt-4">
              <div className="d-flex justify-content-between mb-1 small">
                <span>የአጠቃቀም መጠን</span>
                <span>{Math.round(((parkingLot?.totalSpots - parkingLot?.availableSpots) / parkingLot?.totalSpots) * 100)}%</span>
              </div>
              <div className="progress bg-secondary" style={{ height: "12px", borderRadius: "10px" }}>
                <div 
                  className="progress-bar bg-success progress-bar-striped progress-bar-animated" 
                  style={{ width: `${((parkingLot?.totalSpots - parkingLot?.availableSpots) / parkingLot?.totalSpots) * 100}%` }}
                ></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ዝርዝር መረጃ */}
      <div className="mt-5">
        <h5 className="fw-bold mb-4 text-warning"><i className="bi bi-info-circle me-2"></i>የፓርኪንግ ዝርዝር መረጃዎች</h5>
        <div className="row g-3 text-center">
          {[
            { label: "የባለቤቱ ስም", value: ownerData?.name },
            { label: "ባንክ", value: "የኢትዮጵያ ንግድ ባንክ (CBE)" },
            { label: "መገኛ (Lat, Long)", value: `${parkingLot?.lat}, ${parkingLot?.lng}` }
          ].map((item, idx) => (
            <div key={idx} className="col-md-4">
              <div className="bg-dark border border-secondary p-3 rounded-4 shadow-sm h-100 hover-shadow">
                <p className="small mb-1 text-secondary text-uppercase font-monospace">{item.label}</p>
                <h6 className="fw-bold mb-0">{item.value}</h6>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default OwnerView;