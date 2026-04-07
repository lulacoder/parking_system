import React, { useState, useCallback } from 'react';
import { GoogleMap, useJsApiLoader, Marker, InfoWindow } from '@react-google-maps/api';

const containerStyle = {
  width: '100%',
  height: '500px',
  borderRadius: '25px',
  boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
  border: '4px solid #fff'
};

// መነሻ ቦታ (አዲስ አበባ - መሀል ከተማ)
const center = {
  lat: 9.0192,
  lng: 38.7525
};

// የካርታ ስታይል (ከፈለግክ Dark mode ወይም Clean mode ማድረግ ትችላለህ)
const mapOptions = {
  disableDefaultUI: false,
  zoomControl: true,
  styles: [
    {
      featureType: "poi",
      elementType: "labels",
      stylers: [{ visibility: "off" }] // የካርታው መጨናነቅ እንዲቀንስ
    }
  ]
};

function MapComponent({ parkingLots, onBook }) {
  const [selectedLot, setSelectedLot] = useState(null);

  const mapsApiKey = (process.env.REACT_APP_GOOGLE_MAPS_API_KEY || "").trim();
  const { isLoaded, loadError } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: mapsApiKey
  });

  const onLoad = useCallback(function callback(map) {
    void map;
  }, []);

  const onUnmount = useCallback(function callback(map) {
    void map;
  }, []);

  if (!mapsApiKey) {
    return <div className="alert alert-warning">REACT_APP_GOOGLE_MAPS_API_KEY is missing.</div>;
  }

  if (loadError) {
    return <div className="alert alert-danger">Google Maps failed to load. Check API key setup and restrictions.</div>;
  }

  return isLoaded ? (
    <div className="animate__animated animate__fadeIn">
      <GoogleMap
        mapContainerStyle={containerStyle}
        center={center}
        zoom={14}
        onLoad={onLoad}
        onUnmount={onUnmount}
        options={mapOptions}
      >
        {parkingLots.map((lot) => (
          <Marker
            key={lot.id}
            position={{ lat: parseFloat(lot.lat), lng: parseFloat(lot.lng) }}
            onClick={() => setSelectedLot(lot)}
            // ቦታ ካለ አረንጓዴ፣ ከሌለ ቀይ ማርከር
            icon={
              lot.availableSpots > 0 
                ? "http://maps.google.com/mapfiles/ms/icons/green-dot.png" 
                : "http://maps.google.com/mapfiles/ms/icons/red-dot.png"
            }
            title={lot.name}
          />
        ))}

        {selectedLot && (
          <InfoWindow
            position={{ lat: parseFloat(selectedLot.lat), lng: parseFloat(selectedLot.lng) }}
            onCloseClick={() => setSelectedLot(null)}
          >
            <div style={{ color: '#212529', padding: '10px', minWidth: '180px' }}>
              <h6 className="fw-bold mb-1 text-primary border-bottom pb-2">🏢 {selectedLot.name}</h6>
              <div className="my-2">
                <p className="small mb-1">ጠቅላላ ቦታ፦ <strong>{selectedLot.totalSpots}</strong></p>
                <p className="small mb-2">
                  ክፍት ቦታ፦ <span className={`badge ${selectedLot.availableSpots > 0 ? 'bg-success' : 'bg-danger'}`}>
                    {selectedLot.availableSpots} ቦታዎች
                  </span>
                </p>
              </div>
              
              <button 
                className="btn btn-primary btn-sm w-100 fw-bold shadow-sm"
                disabled={selectedLot.availableSpots <= 0}
                onClick={() => {
                  onBook(selectedLot);
                  setSelectedLot(null);
                }}
                style={{ borderRadius: '8px' }}
              >
                {selectedLot.availableSpots > 0 ? "ቦታ ያዝ (Book Now)" : "ቦታ የለም"}
              </button>
            </div>
          </InfoWindow>
        )}
      </GoogleMap>
    </div>
  ) : (
    <div className="bg-dark rounded-5 p-5 text-center text-white d-flex flex-column align-items-center justify-content-center" style={{ height: '450px' }}>
      <div className="spinner-border text-primary mb-3" role="status"></div>
      <h5 className="fw-bold">ካርታው በመጫን ላይ ነው...</h5>
      <p className="small text-muted">እባክዎ ትንሽ ይጠብቁ</p>
    </div>
  );
}

export default React.memo(MapComponent);
