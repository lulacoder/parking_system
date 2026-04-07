import React, { useState, useEffect } from 'react';
import { GoogleMap, useJsApiLoader, Marker, InfoWindow } from '@react-google-maps/api';
import { database } from '../firebase';

const containerStyle = { 
  width: '100%', 
  height: '450px', 
  borderRadius: '20px', 
  boxShadow: "0 10px 30px rgba(0,0,0,0.5)" 
};

const center = { lat: 9.0300, lng: 38.7400 };

function UserMapSearch() {
  const [parkingLots, setParkingLots] = useState([]);
  const [selectedLot, setSelectedLot] = useState(null);
  const [bookingInFlight, setBookingInFlight] = useState(false);

  const mapsApiKey = (process.env.REACT_APP_GOOGLE_MAPS_API_KEY || "").trim();
  const { isLoaded, loadError } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: mapsApiKey 
  });

  useEffect(() => {
    // የፓርኪንግ መረጃዎችን ከFirebase ማምጣት
    const lotsRef = database.ref("Parking_Lots");
    lotsRef.on("value", (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const list = Object.keys(data).map(key => ({ id: key, ...data[key] }));
        setParkingLots(list);
      }
    });
    return () => lotsRef.off();
  }, []);

  const handleBooking = async (lot) => {
    if (bookingInFlight) return;
    if (!lot?.id) return alert("የፓርኪንግ መረጃ የተሟላ አይደለም።");

    if ((lot.availableSpots || 0) <= 0) {
      alert("ይቅርታ፣ በዚህ ፓርኪንግ ላይ ክፍት ቦታ የለም።");
      return;
    }

    const confirmBooking = window.confirm(`${lot.name} ላይ ቦታ መያዝ ይፈልጋሉ? ክፍያ 50 ብር ነው።`);
    if (!confirmBooking) return;

    setBookingInFlight(true);
    try {
      const tx = await database.ref(`Parking_Lots/${lot.id}/availableSpots`).transaction((currentValue) => {
        if (currentValue === null || currentValue <= 0) return;
        return currentValue - 1;
      });

      if (!tx.committed) {
        alert("ይቅርታ፣ ቦታው ከእርስዎ በፊት ተይዟል።");
        return;
      }

      await database.ref(`Parking_Lots/${lot.id}`).update({
        updatedAt: Date.now(),
      });

      alert(`ለ ${lot.name} ቦታ ተይዟል! በቴሌብር/ሲቢኢ ብር 50 ብር ይክፈሉ::`);
      setSelectedLot(null);
    } catch (error) {
      console.error("User map booking failed:", error);
      alert("ቦታ ለመያዝ ሲሞከር ስህተት ተፈጥሯል። እባክዎ ድጋሚ ይሞክሩ።");
    } finally {
      setBookingInFlight(false);
    }
  };

  return (
    <div className="container mt-3 animate__animated animate__fadeIn">
      <div className="bg-dark p-3 rounded mb-4 shadow-sm border-start border-primary border-4">
        <h4 className="fw-bold text-white mb-1">📍 አቅራቢያ የሚገኙ ፓርኪንጎች</h4>
        <small className="text-secondary">በአቅራቢያህ ያሉትን የፓርኪንግ አማራጮች እዚህ ታገኛለህ</small>
      </div>
      
      {!mapsApiKey ? (
        <div className="alert alert-warning">
          REACT_APP_GOOGLE_MAPS_API_KEY is missing. Add it to `.env` and restart the dev server.
        </div>
      ) : loadError ? (
        <div className="alert alert-danger">
          Google Maps failed to load. Verify Maps JavaScript API is enabled and the key/domain restrictions allow `localhost`.
        </div>
      ) : isLoaded ? (
        <div className="card border-0 bg-transparent mb-5">
          <GoogleMap 
            mapContainerStyle={containerStyle} 
            center={center} 
            zoom={13}
            options={{ streetViewControl: false, mapTypeControl: false }}
          >
            {parkingLots.map(lot => (
              <Marker 
                key={lot.id} 
                position={{ lat: parseFloat(lot.lat), lng: parseFloat(lot.lng) }} 
                onClick={() => setSelectedLot(lot)}
                // ክፍት ቦታ ከሌለ ቀይ፣ ካለ አረንጓዴ ማርከር መጠቀም ይቻላል
                label={{
                  text: `${lot.availableSpots}`,
                  color: "white",
                  fontWeight: "bold"
                }}
              />
            ))}

            {selectedLot && (
              <InfoWindow 
                position={{ lat: parseFloat(selectedLot.lat), lng: parseFloat(selectedLot.lng) }}
                onCloseClick={() => setSelectedLot(null)}
              >
                <div style={{ color: '#000', padding: '5px' }}>
                  <h6 className="fw-bold">{selectedLot.name}</h6>
                  <p className="small mb-1 text-primary">ቀሪ ቦታ፡ <strong>{selectedLot.availableSpots}</strong></p>
                  <p className="small mb-2 text-muted text-decoration-underline">ዋጋ፡ 50 ብር / ሰዓት</p>
                  <button 
                    className="btn btn-primary btn-sm w-100 shadow-sm" 
                    onClick={() => handleBooking(selectedLot)}
                    disabled={selectedLot.availableSpots === 0 || bookingInFlight}
                  >
                    {bookingInFlight ? "በመያዝ ላይ..." : "ቦታ ያዝ (Book Now)"}
                  </button>
                </div>
              </InfoWindow>
            )}
          </GoogleMap>
        </div>
      ) : (
        <div className="text-center p-5 text-white bg-dark rounded">
          <div className="spinner-border text-primary" role="status"></div>
          <p className="mt-2">ካርታው በመጫን ላይ ነው...</p>
        </div>
      )}

      {/* የፓርኪንጎች ዝርዝር ካርድ መልክ */}
      <div className="row">
        <div className="d-flex justify-content-between align-items-center mb-3 text-white">
          <h5 className="fw-bold m-0">የፓርኪንጎች ዝርዝር</h5>
          <span className="badge bg-primary">{parkingLots.length} ፓርኪንጎች ተገኝተዋል</span>
        </div>
        
        {parkingLots.map(lot => (
          <div key={lot.id} className="col-md-4 mb-4">
            <div className={`card h-100 border-0 shadow-sm ${lot.availableSpots === 0 ? 'bg-dark' : 'bg-secondary'} text-white`}>
              <div className="card-body">
                <div className="d-flex justify-content-between align-items-start">
                  <h6 className="fw-bold text-truncate" style={{maxWidth: '150px'}}>{lot.name}</h6>
                  <span className={`badge ${lot.availableSpots > 5 ? 'bg-success' : 'bg-warning'}`}>
                    {lot.availableSpots} ክፍት
                  </span>
                </div>
                <p className="small text-light opacity-75 mb-3">📍 ቦሌ አካባቢ</p>
                <hr className="my-2 opacity-25" />
                <div className="d-flex justify-content-between align-items-center">
                  <span className="small">ዋጋ፡ 50 ብር</span>
                  <button 
                    className="btn btn-outline-info btn-sm" 
                    onClick={() => {
                      setSelectedLot(lot);
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                  >
                    ካርታ ላይ እይ
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default UserMapSearch;
