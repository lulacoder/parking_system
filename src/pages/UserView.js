import React, { useState, useEffect } from "react";
import { auth, database } from "../firebase";
import { GoogleMap, useJsApiLoader, Marker, InfoWindow } from "@react-google-maps/api";

import Available from "./Available";
import UnAvailable from "./UnAvailable";

const containerStyle = {
  width: "100%",
  height: "500px",
  borderRadius: "15px",
  boxShadow: "0 4px 15px rgba(0,0,0,0.3)",
};

const center = { lat: 9.03, lng: 38.74 };

const UserView = () => {
  const [parkingLots, setParkingLots] = useState([]);
  const [selectedLot, setSelectedLot] = useState(null);
  const [bookingInFlight, setBookingInFlight] = useState(false);

  const mapsApiKey = (process.env.REACT_APP_GOOGLE_MAPS_API_KEY || "").trim();
  const { isLoaded, loadError } = useJsApiLoader({
    id: "google-map-script",
    googleMapsApiKey: mapsApiKey,
  });

  useEffect(() => {
    const lotsRef = database.ref("Parking_Lots");
    lotsRef.on("value", (snapshot) => {
      const data = snapshot.val();
      if (!data) {
        setParkingLots([]);
        return;
      }

      const list = Object.keys(data).map((key) => ({
        id: key,
        ...data[key],
      }));
      setParkingLots(list);
    });

    return () => lotsRef.off();
  }, []);

  const handleLogout = async () => {
    try {
      await auth.signOut();
    } catch (error) {
      console.error("Logout failed:", error);
      alert("መውጣት አልተቻለም። እባክዎ ድጋሚ ይሞክሩ።");
    }
  };

  const handleBooking = async (lot) => {
    if (bookingInFlight) return;

    const currentUser = auth.currentUser;
    if (!currentUser) {
      alert("ቦታ ለመያዝ በመጀመሪያ እባክዎ ይግቡ።");
      return;
    }

    if (!lot?.id) {
      alert("የፓርኪንግ መረጃ የተሟላ አይደለም።");
      return;
    }

    if ((lot.availableSpots || 0) <= 0) {
      alert("ይቅርታ፣ ክፍት ቦታ የለም።");
      return;
    }

    if (!window.confirm(`${lot.name} ላይ ቦታ መያዝ ይፈልጋሉ?`)) return;

    setBookingInFlight(true);
    const lotRef = database.ref(`Parking_Lots/${lot.id}`);
    const bookingRef = database.ref(`Bookings/${lot.id}/${currentUser.uid}`);

    try {
      const tx = await lotRef.child("availableSpots").transaction((currentValue) => {
        if (currentValue === null || currentValue <= 0) return;
        return currentValue - 1;
      });

      if (!tx.committed) {
        alert("ይቅርታ፣ ቦታው ከእርስዎ በፊት ተይዟል።");
        return;
      }

      await bookingRef.set({
        bookedAt: Date.now(),
        userId: currentUser.uid,
        userEmail: currentUser.email || "",
      });

      await lotRef.update({
        lastBookedBy: currentUser.uid,
        updatedAt: Date.now(),
      });

      alert("ቦታው በተሳካ ሁኔታ ተይዟል!");
      setSelectedLot(null);
    } catch (error) {
      console.error("Booking failed:", error);
      alert("ቦታ ለመያዝ ሲሞከር ስህተት ተፈጥሯል። እባክዎ ድጋሚ ይሞክሩ።");
    } finally {
      setBookingInFlight(false);
    }
  };

  return (
    <div className="container mt-4 animate__animated animate__fadeIn">
      <div className="d-flex justify-content-between align-items-center mb-4 text-white p-4 bg-primary rounded shadow-sm">
        <div>
          <h2 className="fw-bold mb-0">ENDERASE Smart Parking</h2>
          <small className="opacity-75 text-uppercase">የአሽከርካሪ ዳሽቦርድ</small>
        </div>
        <button className="btn btn-outline-light btn-sm px-4" onClick={handleLogout}>ውጣ (Logout)</button>
      </div>

      <div className="row mb-4">
        <div className="col-12">
          <div className="card border-0 overflow-hidden shadow">
            {!mapsApiKey ? (
              <div className="alert alert-warning m-3 mb-0">
                REACT_APP_GOOGLE_MAPS_API_KEY is missing. Add it to your `.env` and restart `npm start`.
              </div>
            ) : loadError ? (
              <div className="alert alert-danger m-3 mb-0">
                Google Maps failed to load. Check API key restrictions, billing, and that Maps JavaScript API is enabled.
              </div>
            ) : isLoaded ? (
              <GoogleMap mapContainerStyle={containerStyle} center={center} zoom={14}>
                {parkingLots.map((lot) => (
                  <Marker
                    key={lot.id}
                    position={{ lat: parseFloat(lot.lat), lng: parseFloat(lot.lng) }}
                    onClick={() => setSelectedLot(lot)}
                    icon={lot.availableSpots > 0 ? "http://maps.google.com/mapfiles/ms/icons/green-dot.png" : "http://maps.google.com/mapfiles/ms/icons/red-dot.png"}
                  />
                ))}

                {selectedLot && (
                  <InfoWindow
                    position={{ lat: parseFloat(selectedLot.lat), lng: parseFloat(selectedLot.lng) }}
                    onCloseClick={() => setSelectedLot(null)}
                  >
                    <div className="p-2 text-dark" style={{ minWidth: "170px" }}>
                      <h6 className="fw-bold">{selectedLot.name}</h6>
                      <p className="small mb-1">
                        ሁኔታ፦ <strong>{(selectedLot.availableSpots || 0) > 0 ? "ክፍት" : "ተሞልቷል"}</strong>
                      </p>
                      <p className="small mb-2">ቀሪ ቦታ፦ <strong>{selectedLot.availableSpots || 0}</strong></p>
                      <p className="small mb-2">ዋጋ፦ 50 ብር / ሰዓት</p>
                      {(selectedLot.availableSpots || 0) > 0 && (
                        <button className="btn btn-primary btn-sm w-100" onClick={() => handleBooking(selectedLot)} disabled={bookingInFlight}>
                          {bookingInFlight ? "በመያዝ ላይ..." : "ቦታ ያዝ (Book Now)"}
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

      <div className="row g-4">
        <div className="col-md-6">
          <div className="card h-100 border-0 shadow-sm">
            <div className="card-header bg-success text-white fw-bold">ክፍት የፓርኪንግ ቦታዎች</div>
            <div className="card-body">
              <Available slots={parkingLots.filter((lot) => (lot.availableSpots || 0) > 0)} onBook={handleBooking} />
            </div>
          </div>
        </div>
        <div className="col-md-6">
          <div className="card h-100 border-0 shadow-sm">
            <div className="card-header bg-secondary text-white fw-bold">የተሞሉ ፓርኪንጎች</div>
            <div className="card-body">
              <UnAvailable slots={parkingLots.filter((lot) => (lot.availableSpots || 0) <= 0)} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UserView;
