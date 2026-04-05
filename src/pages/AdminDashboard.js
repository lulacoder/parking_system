import React, { useState, useEffect } from "react";
import { database } from "../firebase";

function AdminDashboard() {
  const [stats, setStats] = useState({ systemCommission: 0 });
  const [parkingLots, setParkingLots] = useState([]);
  const [owners, setOwners] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 1. የፓርኪንግ ቦታዎችን መረጃ ማምጣት
    const lotsRef = database.ref("Parking_Lots");
    lotsRef.on("value", (snapshot) => {
      const data = snapshot.val();
      if (data) {
        setParkingLots(Object.keys(data).map(key => ({ id: key, ...data[key] })));
      }
      setLoading(false);
    });

    // 2. አጠቃላይ የሲስተም ኮሚሽንን ማስላት
    const revRef = database.ref("Revenue");
    revRef.on("value", (snapshot) => {
      const data = snapshot.val();
      let totalComm = 0;
      if (data) {
        Object.values(data).forEach(lot => {
          totalComm += lot.totalSystemCommission || 0;
        });
      }
      setStats({ systemCommission: totalComm });
    });

    // 3. ባለቤቶችን ብቻ መለየት
    const usersRef = database.ref("Users").orderByChild("role").equalTo("owner");
    usersRef.on("value", (snapshot) => {
      const data = snapshot.val();
      if (data) {
        setOwners(Object.keys(data).map(key => ({ id: key, ...data[key] })));
      }
    });

    // Cleanup: ገጹ ሲዘጋ ግንኙነቱን አቋርጥ
    return () => {
      lotsRef.off();
      revRef.off();
      usersRef.off();
    };
  }, []);

  if (loading) return (
    <div className="d-flex justify-content-center align-items-center vh-100 text-white">
      <div className="spinner-border text-info" role="status"></div>
      <span className="ms-3">የአድሚን ዳታ በመጫን ላይ...</span>
    </div>
  );

  return (
    <div className="container mt-4 text-white animate__animated animate__fadeIn">
      <div className="bg-dark p-3 rounded-4 mb-4 border-start border-info border-4 shadow-sm">
        <h2 className="fw-bold text-info m-0">🖥️ System Admin Dashboard</h2>
        <p className="small text-secondary mb-0">የENDERASE ሲስተም አጠቃላይ እንቅስቃሴ መቆጣጠሪያ</p>
      </div>

      <div className="row g-4 mb-5">
        {/* የገቢ ካርድ */}
        <div className="col-md-6">
          <div className="card h-100 bg-info text-dark shadow-lg border-0 p-4" style={{ borderRadius: "20px", background: "linear-gradient(45deg, #0dcaf0, #0aa2c0)" }}>
            <div className="d-flex justify-content-between align-items-start">
              <div>
                <h6 className="text-uppercase small fw-bold opacity-75">ጠቅላላ የሲስተም ኮሚሽን (10%)</h6>
                <h1 className="fw-bold display-5 my-2">{stats.systemCommission.toLocaleString()} <small className="fs-4">ETB</small></h1>
              </div>
              <span className="fs-1 opacity-25">💰</span>
            </div>
            <p className="mb-0 mt-3 small fw-bold text-white">ከሁሉም የፓርኪንግ ቦታዎች የተገኘ ገቢ</p>
          </div>
        </div>

        {/* የፓርኪንግ ብዛት ካርድ */}
        <div className="col-md-6">
          <div className="card h-100 bg-dark border-info text-white shadow-lg p-4" style={{ borderRadius: "20px", borderWidth: "2px" }}>
            <div className="d-flex justify-content-between align-items-start text-info">
              <div>
                <h6 className="text-uppercase small fw-bold opacity-75">ንቁ የፓርኪንግ ቦታዎች</h6>
                <h1 className="fw-bold display-5 my-2">{parkingLots.length}</h1>
              </div>
              <span className="fs-1 opacity-25">📍</span>
            </div>
            <p className="mb-0 mt-3 small text-secondary">በሲስተሙ ላይ የተመዘገቡ ንቁ ፓርኪንጎች</p>
          </div>
        </div>
      </div>

      <div className="row">
        {/* የፓርኪንግ ዝርዝር ሰንጠረዥ */}
        <div className="col-lg-8 mb-4">
          <div className="card bg-dark text-white shadow border-secondary h-100" style={{ borderRadius: "15px" }}>
            <div className="card-header bg-transparent border-secondary py-3">
              <h5 className="fw-bold m-0"><i className="bi bi-list-task me-2"></i>የፓርኪንግ ቦታዎች ሁኔታ</h5>
            </div>
            <div className="table-responsive">
              <table className="table table-dark table-hover align-middle mb-0">
                <thead className="small text-uppercase text-secondary">
                  <tr>
                    <th>የፓርኪንግ ስም</th>
                    <th className="text-center">ጠቅላላ ቦታ</th>
                    <th className="text-center">ክፍት</th>
                    <th className="text-center">ሁኔታ</th>
                  </tr>
                </thead>
                <tbody>
                  {parkingLots.map(lot => (
                    <tr key={lot.id}>
                      <td className="fw-bold">{lot.name}</td>
                      <td className="text-center">{lot.totalSpots}</td>
                      <td className="text-center text-info fw-bold">{lot.availableSpots}</td>
                      <td className="text-center">
                        <span className={`badge rounded-pill ${lot.availableSpots > 0 ? 'bg-success' : 'bg-danger'}`}>
                          {lot.availableSpots > 0 ? "አገልግሎት ይሰጣል" : "ተሞልቷል"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* የባለቤቶች ዝርዝር */}
        <div className="col-lg-4 mb-4">
          <div className="card bg-dark text-white shadow border-secondary h-100" style={{ borderRadius: "15px" }}>
            <div className="card-header bg-transparent border-secondary py-3">
              <h5 className="fw-bold m-0 text-warning"><i className="bi bi-people me-2"></i>የፓርኪንግ ባለቤቶች</h5>
            </div>
            <div className="list-group list-group-flush scroll-area" style={{ maxHeight: '400px', overflowY: 'auto' }}>
              {owners.map(owner => (
                <div key={owner.id} className="list-group-item bg-transparent text-white border-secondary border-opacity-25 py-3">
                  <div className="d-flex align-items-center">
                    <div className="avatar bg-secondary rounded-circle p-2 me-3">👤</div>
                    <div>
                      <h6 className="mb-0 fw-bold">{owner.name}</h6>
                      <small className="text-secondary">{owner.email}</small>
                    </div>
                  </div>
                </div>
              ))}
              {owners.length === 0 && <div className="p-4 text-center text-muted">ምንም ባለቤት አልተመዘገበም</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AdminDashboard;