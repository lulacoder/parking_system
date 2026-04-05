import React, { useState, useEffect } from "react";
import { database } from "../firebase";

function OperatorDashboard({ lotId = "lot_01" }) { 
  const [spots, setSpots] = useState([]);
  const [plateNumber, setPlateNumber] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const spotsRef = database.ref(`Parking_Spots/${lotId}`);
    spotsRef.on("value", (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const list = Object.keys(data).map(key => ({ id: key, ...data[key] }));
        // በቅደም ተከተል እንዲቀመጡ (Slot 1, Slot 2...)
        setSpots(list.sort((a, b) => (a.index || 0) - (b.index || 0)));
      }
      setLoading(false);
    });
    return () => spotsRef.off();
  }, [lotId]);

  // መኪና ሲገባ (Entry)
  const handleEntry = (spotId) => {
    if (!plateNumber || plateNumber.length < 5) {
      return alert("እባክዎ ትክክለኛ የሰሌዳ ቁጥር ያስገቡ! (ምሳሌ: AA 2 A12345)");
    }
    
    database.ref(`Parking_Spots/${lotId}/${spotId}`).update({
      availability: false,
      plateNumber: plateNumber.toUpperCase(),
      entryTime: Date.now(),
    });
    
    // የአጠቃላይ ክፍት ቦታዎችን ቁጥር መቀነስ
    database.ref(`Parking_Lots/${lotId}/availableSpots`).transaction(current => (current || 0) - 1);
    
    setPlateNumber(""); // የጽሁፍ ሳጥኑን ባዶ ማድረግ
  };

  // መኪና ሲወጣ (Exit)
  const handleExit = (spot) => {
    const durationMs = Date.now() - spot.entryTime;
    const hours = Math.max(1, Math.ceil(durationMs / (1000 * 60 * 60))); // ቢያንስ 1 ሰዓት
    const totalFee = hours * 50;
    const commission = totalFee * 0.10;
    const ownerNet = totalFee - commission;

    const confirmMsg = `
      🚗 ሰሌዳ: ${spot.plateNumber}
      ⏱️ ቆይታ: ${hours} ሰዓት
      💰 ጠቅላላ ክፍያ: ${totalFee} ETB
      ---------------------------
      ክፍያ ተፈጽሟል?
    `;

    if (window.confirm(confirmMsg)) {
      // 1. ስሎቱን ነጻ ማድረግ
      database.ref(`Parking_Spots/${lotId}/${spot.id}`).update({
        availability: true,
        plateNumber: "",
        entryTime: null
      });

      // 2. ገቢውን መመዝገብ (ለባለቤቱና ለሲስተሙ)
      database.ref(`Revenue/${lotId}`).transaction(current => ({
        totalOwnerRevenue: (current?.totalOwnerRevenue || 0) + ownerNet,
        totalSystemCommission: (current?.totalSystemCommission || 0) + commission,
        totalTransactions: (current?.totalTransactions || 0) + 1
      }));

      // 3. ክፍት ቦታውን መመለስ
      database.ref(`Parking_Lots/${lotId}/availableSpots`).transaction(current => (current || 0) + 1);
    }
  };

  if (loading) return <div className="text-center mt-5 text-white fw-bold italic">መረጃዎች በመጫን ላይ...</div>;

  return (
    <div className="container mt-4 text-white animate__animated animate__fadeIn">
      <div className="d-flex justify-content-between align-items-center mb-4 bg-dark p-3 rounded-4 shadow-sm border-start border-warning border-4">
        <h2 className="fw-bold m-0 text-warning">🚀 ኦፕሬተር ዳሽቦርድ</h2>
        <span className="badge bg-secondary p-2 shadow-sm">Lot ID: {lotId}</span>
      </div>
      
      {/* የሰሌዳ መመዝገቢያ */}
      <div className="card p-4 bg-white text-dark mb-5 shadow-lg border-0" style={{ borderRadius: "20px" }}>
        <h6 className="fw-bold text-uppercase small text-muted mb-3">አዲስ መኪና ለማስገባት</h6>
        <div className="row g-2">
          <div className="col-md-9">
            <input 
              type="text" 
              className="form-control form-control-lg bg-light border-0 shadow-inner" 
              placeholder="ሰሌዳ ያስገቡ (e.g. AA 2 B12345)"
              style={{ fontSize: "1.5rem", fontWeight: "bold", textAlign: "center" }}
              value={plateNumber}
              onChange={(e) => setPlateNumber(e.target.value)}
            />
          </div>
          <div className="col-md-3 d-flex align-items-center">
            <small className="text-muted italic">መጀመሪያ ሰሌዳ ጽፈው በመቀጠል ክፍት ስሎት ይጫኑ።</small>
          </div>
        </div>
      </div>

      {/* የፓርኪንግ ስሎቶች ዝርዝር */}
      <div className="row g-4 mb-5">
        {spots.map((spot) => (
          <div key={spot.id} className="col-6 col-sm-4 col-md-3 col-lg-2 text-center">
            <div 
              className={`card p-3 shadow border-0 transition-all h-100 ${spot.availability ? 'bg-success hover-opacity' : 'bg-danger scale-in'}`}
              style={{ cursor: 'pointer', borderRadius: "15px", position: "relative" }}
              onClick={() => spot.availability ? handleEntry(spot.id) : handleExit(spot)}
            >
              {/* ስሎት ቁጥር */}
              <span className="position-absolute top-0 start-50 translate-middle badge rounded-pill bg-dark border border-white">
                #{spot.index}
              </span>
              
              <div className="mt-2">
                {spot.availability ? (
                  <div className="py-3">
                    <i className="bi bi-plus-circle fs-1 text-white opacity-75"></i>
                    <p className="m-0 fw-bold mt-2">ክፍት</p>
                  </div>
                ) : (
                  <div className="py-2">
                    <h5 className="fw-bold mb-1 letter-spacing-1">{spot.plateNumber}</h5>
                    <hr className="my-2 opacity-25" />
                    <p className="m-0 small opacity-75">ውጣ (Exit)</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      
      {/* አጭር መመሪያ */}
      <div className="alert alert-dark border-secondary small text-center opacity-75 rounded-4">
        <i className="bi bi-info-circle me-2"></i>
        አረንጓዴ ስሎቶች መኪና <strong>ለማስገባት</strong>፣ ቀይ ስሎቶች ደግሞ መኪና <strong>ለማውጣት</strong> ያገለግላሉ።
      </div>
    </div>
  );
}

export default OperatorDashboard;