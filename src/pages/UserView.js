import React, { useState, useEffect } from "react";
import { auth, database } from "../firebase";
import { GoogleMap, useJsApiLoader, Marker, InfoWindow } from '@react-google-maps/api';

// Components
import Available from "./Available"; 
import UnAvailable from "./UnAvailable";

const containerStyle = { 
  width: "100%", 
  height: "500px", 
  borderRadius: "15px",
  boxShadow: "0 4px 15px rgba(0,0,0,0.3)" 
};

// አዲስ አበባ መካከለኛ ነጥብ (Center)
const center = { lat: 9.0300, lng: 38.7400 }; 

const UserView = () => {
  const [parkingSlots, setParkingSlots] = useState([]);
  const [selectedSlot, setSelectedSlot] = useState(null);

  const { isLoaded } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: process.env.REACT_APP_GOOGLE_MAPS_API_KEY
  });

  useEffect(() => {
    // ከFirebase ላይ የፓርኪንግ ቦታዎችን በሪል-ታይም መከታተል
    const parkingRef = database.ref("parking_slots");
    parkingRef.on("value", (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const list = Object.keys(data).map((key) => ({
          id: key,
          ...data[key],
        }));
        setParkingSlots(list);
      }
    });

    return () => parkingRef.off(); // ከገጹ ሲወጣ ግንኙነቱን አቋርጥ
  }, []);

  const handleLogout = () => {
    auth.signOut();
  };

  // ቦታ ለመያዝ (Booking Logic)
  const handleBooking = (slot) => {
    if (window.confirm(`${slot.name} ላይ ቦታ መያዝ ይፈልጋሉ?`)) {
      database.ref(`parking_slots/${slot.id}`).update({
        status: "reserved",
        bookedBy: auth.currentUser.uid
      }).then(() => {
        alert("ቦታው በተሳካ ሁኔታ ተይዟል!");
        setSelectedSlot(null);
      });
    }
  };

  return (
    <div className="container mt-4 animate__animated animate__fadeIn">
      {/* Header ክፍል */}
      <div className="d-flex justify-content-between align-items-center mb-4 text-white p-4 bg-primary rounded shadow-sm">
        <div>
          <h2 className="fw-bold mb-0">ENDERASE Smart Parking</h2>
          <small className="opacity-75 text-uppercase">የአሽከርካሪ ዳሽቦርድ</small>
        </div>
        <button className="btn btn-outline-light btn-sm px-4" onClick={handleLogout}>ውጣ (Logout)</button>
      </div>

      {/* የካርታ ክፍል */}
      <div className="row mb-4">
        <div className="col-12">
          <div className="card border-0 overflow-hidden shadow">
            {isLoaded ? (
              <GoogleMap
                mapContainerStyle={containerStyle}
                center={center}
                zoom={14}
              >
                {parkingSlots.map((slot) => (
                  <Marker
                    key={slot.id}
                    position={{ lat: parseFloat(slot.lat), lng: parseFloat(slot.lng) }}
                    onClick={() => setSelectedSlot(slot)}
                    // ክፍት ከሆነ አረንጓዴ፣ ካልሆነ ቀይ ማርከር እንዲያሳይ (አማራጭ)
                    icon={slot.status === "available" ? "http://maps.google.com/mapfiles/ms/icons/green-dot.png" : "http://maps.google.com/mapfiles/ms/icons/red-dot.png"}
                  />
                ))}

                {/* ተጠቃሚው ማርከሩን ሲጫን የሚመጣ መረጃ */}
                {selectedSlot && (
                  <InfoWindow
                    position={{ lat: parseFloat(selectedSlot.lat), lng: parseFloat(selectedSlot.lng) }}
                    onCloseClick={() => setSelectedSlot(null)}
                  >
                    <div className="p-2 text-dark" style={{ minWidth: "150px" }}>
                      <h6 className="fw-bold">{selectedSlot.name}</h6>
                      <p className="small mb-1">ሁኔታ፦ <strong>{selectedSlot.status === 'available' ? 'ክፍት' : 'የተያዘ'}</strong></p>
                      <p className="small mb-2">ዋጋ፦ 50 ብር / ሰዓት</p>
                      {selectedSlot.status === "available" && (
                        <button 
                          className="btn btn-primary btn-sm w-100" 
                          onClick={() => handleBooking(selectedSlot)}
                        >
                          ቦታ ያዝ (Book Now)
                        </button>
                      )}
                    </div>
                  </InfoWindow>
                )}
              </GoogleMap>
            ) : (
              <div className="d-flex justify-content-center align-items-center py-5">
                <div className="spinner-border text-primary" role="status"></div>
                <span className="ms-2">ካርታው በመጫን ላይ...</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* የታችኛው የዝርዝር ክፍል */}
      <div className="row g-4">
        <div className="col-md-6">
          <div className="card h-100 border-0 shadow-sm">
            <div className="card-header bg-success text-white fw-bold">ክፍት የፓርኪንግ ቦታዎች</div>
            <div className="card-body">
              <Available slots={parkingSlots.filter(s => s.status === "available")} />
            </div>
          </div>
        </div>
        <div className="col-md-6">
          <div className="card h-100 border-0 shadow-sm">
            <div className="card-header bg-secondary text-white fw-bold">የተያዙ ቦታዎች</div>
            <div className="card-body">
              <UnAvailable slots={parkingSlots.filter(s => s.status !== "available")} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UserView;