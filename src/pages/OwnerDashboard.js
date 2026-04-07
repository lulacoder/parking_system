import React, { useState, useEffect } from "react";
import { database, auth } from "../firebase";

function OwnerView() {
  const [ownerData, setOwnerData] = useState(null);
  const [revenue, setRevenue] = useState({ totalOwnerRevenue: 0, totalSystemCommission: 0 });
  const [parkingLot, setParkingLot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let revRef = null;
    let lotRef = null;
    let mounted = true;

    const fetchOwnerData = async () => {
      try {
        const currentUser = auth.currentUser;
        if (!currentUser) {
          if (mounted) {
            setError("የተጠቃሚ መረጃ አልተገኘም። እባክዎ እንደገና ይግቡ።");
            setLoading(false);
          }
          return;
        }

        const userSnapshot = await database.ref(`Users/${currentUser.uid}`).once("value");
        const userData = userSnapshot.val();

        if (!mounted) return;
        setOwnerData(userData);

        if (!userData?.parkingLotId) {
          setError("ለዚህ ባለቤት የተመዘገበ ፓርኪንግ አልተገኘም።");
          setLoading(false);
          return;
        }

        const lotId = userData.parkingLotId;
        revRef = database.ref(`Revenue/${lotId}`);
        lotRef = database.ref(`Parking_Lots/${lotId}`);

        revRef.on("value", (snapshot) => {
          if (!mounted) return;
          setRevenue(snapshot.exists() ? snapshot.val() : { totalOwnerRevenue: 0, totalSystemCommission: 0 });
        });

        lotRef.on("value", (snapshot) => {
          if (!mounted) return;
          setParkingLot(snapshot.exists() ? snapshot.val() : null);
          setLoading(false);
        });
      } catch (fetchError) {
        console.error("Owner dashboard fetch failed:", fetchError);
        if (mounted) {
          setError("መረጃውን ማምጣት አልተቻለም።");
          setLoading(false);
        }
      }
    };

    fetchOwnerData();

    return () => {
      mounted = false;
      if (revRef) revRef.off();
      if (lotRef) lotRef.off();
    };
  }, []);

  if (loading) {
    return (
      <div className="d-flex justify-content-center align-items-center vh-100 text-white">
        <div className="spinner-grow text-success" role="status"></div>
        <span className="ms-3">የባለቤት መረጃ በመጫን ላይ...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mt-5">
        <div className="alert alert-danger">{error}</div>
      </div>
    );
  }

  return (
    <div className="container mt-4 text-white animate__animated animate__fadeIn">
      <div className="d-flex justify-content-between align-items-center mb-4 p-3 bg-dark rounded border-bottom border-success border-3">
        <div>
          <h2 className="fw-bold mb-0 text-success">🏢 የባለቤት ዳሽቦርድ</h2>
          <small className="text-secondary text-uppercase tracking-widest">ባለቤት፦ {ownerData?.name}</small>
        </div>
        <div className="text-end">
          <span className="badge bg-success p-2 px-3 shadow-sm">{parkingLot?.name || "N/A"}</span>
        </div>
      </div>

      <div className="row g-4">
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

        <div className="col-md-5">
          <div className="card bg-dark border-success text-white shadow-lg p-4 h-100" style={{ borderRadius: "20px", borderWidth: "2px" }}>
            <h5 className="text-uppercase small fw-bold text-success opacity-75">የቦታዎች ሁኔታ (Live)</h5>
            <div className="d-flex align-items-baseline gap-2 mt-3">
              <h1 className="fw-bold display-5 m-0 text-success">{parkingLot?.availableSpots ?? 0}</h1>
              <h4 className="opacity-50 m-0 text-white-50">/ {parkingLot?.totalSpots ?? 0} ክፍት</h4>
            </div>

            <div className="mt-4">
              <div className="d-flex justify-content-between mb-1 small">
                <span>የአጠቃቀም መጠን</span>
                <span>
                  {parkingLot?.totalSpots
                    ? Math.round(((parkingLot.totalSpots - parkingLot.availableSpots) / parkingLot.totalSpots) * 100)
                    : 0}
                  %
                </span>
              </div>
              <div className="progress bg-secondary" style={{ height: "12px", borderRadius: "10px" }}>
                <div
                  className="progress-bar bg-success progress-bar-striped progress-bar-animated"
                  style={{
                    width: `${
                      parkingLot?.totalSpots
                        ? ((parkingLot.totalSpots - parkingLot.availableSpots) / parkingLot.totalSpots) * 100
                        : 0
                    }%`,
                  }}
                ></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5">
        <h5 className="fw-bold mb-4 text-warning"><i className="bi bi-info-circle me-2"></i>የፓርኪንግ ዝርዝር መረጃዎች</h5>
        <div className="row g-3 text-center">
          {[
            { label: "የባለቤቱ ስም", value: ownerData?.name || "N/A" },
            { label: "ባንክ", value: "የኢትዮጵያ ንግድ ባንክ (CBE)" },
            { label: "መገኛ (Lat, Long)", value: `${parkingLot?.lat || "N/A"}, ${parkingLot?.lng || "N/A"}` },
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
