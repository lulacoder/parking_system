import React, { useEffect, useMemo, useState } from "react";
import { GoogleMap, Marker, useJsApiLoader } from "@react-google-maps/api";
import { useNavigate } from "react-router-dom";
import { auth, firestore, functionsClient } from "../firebase";

function formatDate(value) {
  if (!value) return "N/A";
  const ms = value?.toMillis ? value.toMillis() : value;
  return new Date(ms).toLocaleString();
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parkingCoords(parking) {
  if (!parking) return null;
  const loc = parking.location || {};
  const lat =
    toNumber(loc.lat) ??
    toNumber(loc.latitude) ??
    toNumber(loc._lat) ??
    toNumber(parking.lat) ??
    toNumber(parking.latitude);
  const lng =
    toNumber(loc.lng) ??
    toNumber(loc.longitude) ??
    toNumber(loc._long) ??
    toNumber(parking.lng) ??
    toNumber(parking.longitude);
  if (lat == null || lng == null) return null;
  return { lat, lng };
}

function DriverHome() {
  const navigate = useNavigate();
  const [parkings, setParkings] = useState([]);
  const [selectedParkingId, setSelectedParkingId] = useState("");
  const [plateNumber, setPlateNumber] = useState("");
  const [activeBookings, setActiveBookings] = useState([]);
  const [activeSessions, setActiveSessions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [checkoutLoadingId, setCheckoutLoadingId] = useState("");
  const [qrTokenInput, setQrTokenInput] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const mapsApiKey = (process.env.REACT_APP_GOOGLE_MAPS_API_KEY || "").trim();
  const { isLoaded, loadError } = useJsApiLoader({
    id: "driver-map-script",
    googleMapsApiKey: mapsApiKey,
  });

  useEffect(() => {
    const unsub = firestore
      .collection("parkings")
      .where("status", "==", "active")
      .onSnapshot(
        (snapshot) => {
          const list = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
          setParkings(list);
          if (!selectedParkingId && list.length) setSelectedParkingId(list[0].id);
        },
        (err) => setError(err.message)
      );
    return () => unsub();
  }, [selectedParkingId]);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return undefined;
    const unsub = firestore
      .collection("bookings")
      .where("driverId", "==", uid)
      .where("status", "in", ["reserved", "checked_in"])
      .onSnapshot(
        (snapshot) => setActiveBookings(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))),
        (err) => setError(err.message)
      );
    return () => unsub();
  }, []);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return undefined;
    const unsub = firestore
      .collection("sessions")
      .where("driverId", "==", uid)
      .where("status", "==", "active")
      .onSnapshot(
        (snapshot) => setActiveSessions(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))),
        (err) => setError(err.message)
      );
    return () => unsub();
  }, []);

  const selectedParking = useMemo(
    () => parkings.find((p) => p.id === selectedParkingId) || null,
    [parkings, selectedParkingId]
  );
  const mapPoints = useMemo(
    () =>
      parkings
        .map((p) => ({ parking: p, coords: parkingCoords(p) }))
        .filter((x) => x.coords),
    [parkings]
  );

  const mapCenter = useMemo(() => {
    const selected = parkingCoords(selectedParking);
    if (selected) return selected;
    if (mapPoints.length) return mapPoints[0].coords;
    return { lat: 8.997, lng: 38.786 };
  }, [mapPoints, selectedParking]);

  const reserveSlot = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      const callable = functionsClient.httpsCallable("createBooking");
      const response = await callable({
        parkingId: selectedParkingId,
        plateNumber,
      });
      setSuccess(`Booking created: ${response.data.bookingId}`);
      setPlateNumber("");
    } catch (err) {
      setError(err.message || "Failed to create booking.");
    } finally {
      setLoading(false);
    }
  };

  const driverCheckout = async (session) => {
    setError("");
    setSuccess("");
    setCheckoutLoadingId(session.id);
    try {
      const callable = functionsClient.httpsCallable("driverCheckOutVehicle");
      const response = await callable({
        parkingId: session.parkingId,
        plateNumber: session.plateNumber,
      });
      setSuccess(`Checkout complete. Fee: ${response.data.feeAmount} ETB`);
    } catch (err) {
      setError(err.message || "Failed to check out.");
    } finally {
      setCheckoutLoadingId("");
    }
  };

  const goToQrConfirm = () => {
    const trimmed = qrTokenInput.trim();
    if (!trimmed) {
      navigate("/driver/checkin-confirm");
      return;
    }

    // Accept either full URL from QR or raw token value for desktop testing.
    try {
      const parsed = new URL(trimmed);
      const token = parsed.searchParams.get("token");
      if (token) {
        navigate(`/driver/checkin-confirm?token=${encodeURIComponent(token)}`);
        return;
      }
    } catch (_) {
      // Not a URL; treat as raw token.
    }
    navigate(`/driver/checkin-confirm?token=${encodeURIComponent(trimmed)}`);
  };

  return (
    <div className="container py-4">
      <div className="card border-0 shadow-sm mb-4">
        <div className="card-body">
          <h5 className="fw-bold mb-2">QR Check-In</h5>
          <p className="text-muted mb-3">
            Scan operator QR with your phone camera, or paste token/link below for desktop testing.
          </p>
          <div className="d-flex flex-column flex-md-row gap-2">
            <input
              className="form-control"
              placeholder="Paste QR link or token (optional)"
              value={qrTokenInput}
              onChange={(e) => setQrTokenInput(e.target.value)}
            />
            <button type="button" className="btn btn-primary" onClick={goToQrConfirm}>
              Open QR Check-In
            </button>
          </div>
        </div>
      </div>

      <div className="card border-0 shadow-sm mb-4">
        <div className="card-body">
          <h3 className="fw-bold mb-2">Driver Booking</h3>
          <p className="text-muted mb-0">Reserve a parking slot through secure Cloud Functions.</p>
        </div>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <div className="card border-0 shadow-sm mb-4">
        <div className="card-body">
          <h5 className="fw-bold mb-3">Choose Parking on Map</h5>
          {!mapsApiKey ? (
            <div className="alert alert-warning mb-0">Google Maps API key is missing in `.env`.</div>
          ) : loadError ? (
            <div className="alert alert-danger mb-0">Failed to load Google Maps. Check key restrictions/billing.</div>
          ) : isLoaded ? (
            <GoogleMap
              mapContainerStyle={{ width: "100%", height: "360px", borderRadius: "12px" }}
              center={mapCenter}
              zoom={13}
              options={{ streetViewControl: false, mapTypeControl: false }}
            >
              {mapPoints.map(({ parking, coords }) => (
                  <Marker
                    key={parking.id}
                    position={coords}
                    title={parking.name}
                    onClick={() => setSelectedParkingId(parking.id)}
                    label={{
                      text: parking.id === selectedParkingId ? "Selected" : `${parking.availableSlots ?? 0}`,
                      color: "#ffffff",
                      fontWeight: "bold",
                    }}
                    icon={{
                      url:
                        parking.id === selectedParkingId
                          ? "http://maps.google.com/mapfiles/ms/icons/blue-dot.png"
                          : "http://maps.google.com/mapfiles/ms/icons/red-dot.png",
                    }}
                  />
                ))}
            </GoogleMap>
          ) : (
            <div className="d-flex align-items-center gap-2">
              <div className="spinner-border spinner-border-sm text-primary" role="status"></div>
              <span>Loading map...</span>
            </div>
          )}
          <div className="small text-muted mt-2">
            Tip: click a marker to auto-select a parking location for reservation.
          </div>
        </div>
      </div>

      <div className="row g-4">
        <div className="col-lg-6">
          <div className="card border-0 shadow-sm">
            <div className="card-body">
              <h5 className="fw-bold mb-3">Reserve Slot</h5>
              <form onSubmit={reserveSlot}>
                <div className="mb-3">
                  <label className="form-label">Parking</label>
                  <select
                    className="form-select"
                    value={selectedParkingId}
                    onChange={(e) => setSelectedParkingId(e.target.value)}
                    required
                  >
                    {parkings.map((parking) => (
                      <option key={parking.id} value={parking.id}>
                        {parking.name} - {parking.availableSlots ?? 0} available
                      </option>
                    ))}
                  </select>
                </div>

                <div className="mb-3">
                  <label className="form-label">Plate Number</label>
                  <input
                    className="form-control"
                    value={plateNumber}
                    onChange={(e) => setPlateNumber(e.target.value.toUpperCase())}
                    placeholder="AA 12345"
                    required
                  />
                </div>

                <button className="btn btn-primary" disabled={loading || !selectedParkingId}>
                  {loading ? "Reserving..." : "Reserve"}
                </button>
              </form>
            </div>
          </div>
        </div>

        <div className="col-lg-6">
          <div className="card border-0 shadow-sm mb-3">
            <div className="card-body">
              <h5 className="fw-bold mb-2">Selected Parking</h5>
              {selectedParking ? (
                <>
                  <div className="small text-muted">{selectedParking.address || "No address"}</div>
                  <div className="mt-2">Rate: {selectedParking.hourlyRate || 50} ETB / hour</div>
                  <div>Capacity: {selectedParking.slotCapacity || 0}</div>
                  <div>Available: {selectedParking.availableSlots || 0}</div>
                </>
              ) : (
                <div className="text-muted">No active parking found.</div>
              )}
            </div>
          </div>

          <div className="card border-0 shadow-sm">
            <div className="card-body">
              <h5 className="fw-bold mb-3">My Active Bookings</h5>
              {!activeBookings.length ? (
                <div className="text-muted">No active bookings.</div>
              ) : (
                <div className="list-group">
                  {activeBookings.map((booking) => (
                    <div key={booking.id} className="list-group-item">
                      <div className="fw-bold">{booking.plateNumber}</div>
                      <div className="small text-muted">Status: {booking.status}</div>
                      <div className="small text-muted">Expires: {formatDate(booking.expiresAt)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="card border-0 shadow-sm mt-3">
            <div className="card-body">
              <h5 className="fw-bold mb-3">My Active Sessions</h5>
              {!activeSessions.length ? (
                <div className="text-muted">No active sessions.</div>
              ) : (
                <div className="list-group">
                  {activeSessions.map((session) => (
                    <div key={session.id} className="list-group-item">
                      <div className="fw-bold">{session.plateNumber}</div>
                      <div className="small text-muted mb-2">Parking: {session.parkingId}</div>
                      <button
                        type="button"
                        className="btn btn-sm btn-warning"
                        disabled={checkoutLoadingId === session.id}
                        onClick={() => driverCheckout(session)}
                      >
                        {checkoutLoadingId === session.id ? "Checking out..." : "Check Out"}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default DriverHome;
