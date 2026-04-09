import React, { useEffect, useMemo, useRef, useState } from "react";
import { Circle, GoogleMap, Marker, useJsApiLoader } from "@react-google-maps/api";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { auth, firestore, functionsClient } from "../firebase";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select } from "../components/ui/select";

const SEEDED_IDS = ["lot_01", "lot_02"];

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
  const mapRef = useRef(null);
  const [parkings, setParkings] = useState([]);
  const [selectedParkingId, setSelectedParkingId] = useState("");
  const [plateNumber, setPlateNumber] = useState("");
  const [activeBookings, setActiveBookings] = useState([]);
  const [activeSessions, setActiveSessions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [checkoutLoadingId, setCheckoutLoadingId] = useState("");
  const [qrTokenInput, setQrTokenInput] = useState("");
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
          list.sort((a, b) => {
            const aIdx = SEEDED_IDS.indexOf(a.id);
            const bIdx = SEEDED_IDS.indexOf(b.id);
            if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
            if (aIdx !== -1) return -1;
            if (bIdx !== -1) return 1;
            return String(a.name || a.id).localeCompare(String(b.name || b.id));
          });
          setParkings(list);
          if (!selectedParkingId && list.length) setSelectedParkingId(list[0].id);
        },
        (err) => toast.error(err.message || "Failed to load parking locations.")
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
        (err) => toast.error(err.message || "Failed to load active bookings.")
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
        (err) => toast.error(err.message || "Failed to load active sessions.")
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

  useEffect(() => {
    const selected = parkingCoords(selectedParking);
    const map = mapRef.current;
    if (!selected || !map || !window.google?.maps) return;

    const radiusCircle = new window.google.maps.Circle({
      center: selected,
      radius: 1000,
    });
    const bounds = radiusCircle.getBounds();
    if (bounds) map.fitBounds(bounds, 22);
  }, [selectedParking]);

  const reserveSlot = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const callable = functionsClient.httpsCallable("createBooking");
      const response = await callable({
        parkingId: selectedParkingId,
        plateNumber,
      });
      toast.success(`Booking created: ${response.data.bookingId}`);
      setPlateNumber("");
    } catch (err) {
      toast.error(err.message || "Failed to create booking.");
    } finally {
      setLoading(false);
    }
  };

  const driverCheckout = async (session) => {
    setCheckoutLoadingId(session.id);
    try {
      const callable = functionsClient.httpsCallable("driverCheckOutVehicle");
      const response = await callable({
        parkingId: session.parkingId,
        plateNumber: session.plateNumber,
      });
      toast.success(`Checkout complete. Fee: ${response.data.feeAmount} ETB`);
    } catch (err) {
      toast.error(err.message || "Failed to check out.");
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

    try {
      const parsed = new URL(trimmed);
      const token = parsed.searchParams.get("token");
      if (token) {
        navigate(`/driver/checkin-confirm?token=${encodeURIComponent(token)}`);
        return;
      }
    } catch (_) {
      // no-op
    }
    navigate(`/driver/checkin-confirm?token=${encodeURIComponent(trimmed)}`);
  };

  return (
    <div className="space-y-6">
      <Card className="animate-fade-in-up">
        <CardHeader>
          <CardTitle>QR Check-In</CardTitle>
          <CardDescription>Scan operator QR with your phone camera, or paste token/link for desktop testing.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 sm:flex-row">
          <Input
            placeholder="Paste QR link or token (optional)"
            value={qrTokenInput}
            onChange={(e) => setQrTokenInput(e.target.value)}
          />
          <Button type="button" onClick={goToQrConfirm}>
            Open QR Check-In
          </Button>
        </CardContent>
      </Card>

      <Card className="animate-fade-in-up">
        <CardHeader>
          <CardTitle>Driver Booking</CardTitle>
          <CardDescription>Reserve a parking slot through secure Cloud Functions.</CardDescription>
        </CardHeader>
      </Card>

      <Card className="animate-fade-in-up">
        <CardHeader>
          <CardTitle>Choose Parking on Map</CardTitle>
          <CardDescription>Click a top card or map marker to select a parking location.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex flex-wrap gap-2">
            {parkings.map((parking) => (
              <button
                key={parking.id}
                type="button"
                className={`rounded-lg border px-3 py-2 text-left text-sm transition-all ${
                  parking.id === selectedParkingId
                    ? "border-blue-500 bg-blue-50 text-blue-700"
                    : "border-border bg-white hover:border-blue-300 hover:bg-blue-50"
                }`}
                onClick={() => setSelectedParkingId(parking.id)}
              >
                <div className="font-medium">{parking.name}</div>
                <div className="text-xs text-slate-500">{parking.availableSlots ?? 0} available • {parking.hourlyRate || 50} ETB/hr</div>
              </button>
            ))}
          </div>

          {!mapsApiKey ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-700">Google Maps API key is missing in `.env`.</div>
          ) : loadError ? (
            <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">Failed to load Google Maps. Check key restrictions/billing.</div>
          ) : isLoaded ? (
            <GoogleMap
              mapContainerStyle={{ width: "100%", height: "380px", borderRadius: "12px" }}
              center={mapCenter}
              zoom={13}
              onLoad={(map) => {
                mapRef.current = map;
              }}
              options={{ streetViewControl: false, mapTypeControl: false }}
            >
              {parkingCoords(selectedParking) && (
                <Circle
                  center={parkingCoords(selectedParking)}
                  radius={1000}
                  options={{
                    strokeColor: "#2563eb",
                    strokeOpacity: 0.9,
                    strokeWeight: 2,
                    fillColor: "#2563eb",
                    fillOpacity: 0.12,
                  }}
                />
              )}
              {mapPoints.map(({ parking, coords }) => (
                <Marker
                  key={parking.id}
                  position={coords}
                  title={parking.name}
                  onClick={() => setSelectedParkingId(parking.id)}
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
            <div className="text-sm text-slate-500">Loading map...</div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="animate-fade-in-up">
          <CardHeader>
            <CardTitle>Reserve Slot</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={reserveSlot} className="space-y-4">
              <div className="space-y-2">
                <Label>Parking</Label>
                <Select value={selectedParkingId} onChange={(e) => setSelectedParkingId(e.target.value)} required>
                  {parkings.map((parking) => (
                    <option key={parking.id} value={parking.id}>
                      {parking.name} - {parking.availableSlots ?? 0} available
                    </option>
                  ))}
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Plate Number</Label>
                <Input
                  value={plateNumber}
                  onChange={(e) => setPlateNumber(e.target.value.toUpperCase())}
                  placeholder="AA 12345"
                  required
                />
              </div>

              <Button disabled={loading || !selectedParkingId}>{loading ? "Reserving..." : "Reserve"}</Button>
            </form>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="animate-fade-in-up">
            <CardHeader>
              <CardTitle>Selected Parking</CardTitle>
            </CardHeader>
            <CardContent>
              {selectedParking ? (
                <div className="space-y-2 text-sm">
                  <div className="text-muted-foreground">{selectedParking.address || "No address"}</div>
                  <div className="flex gap-2">
                    <Badge>Rate: {selectedParking.hourlyRate || 50} ETB/hr</Badge>
                    <Badge variant="secondary">Capacity: {selectedParking.slotCapacity || 0}</Badge>
                  </div>
                  <div className="font-medium text-slate-700">Available: {selectedParking.availableSlots || 0}</div>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">No active parking found.</div>
              )}
            </CardContent>
          </Card>

          <Card className="animate-fade-in-up">
            <CardHeader>
              <CardTitle>My Active Bookings</CardTitle>
            </CardHeader>
            <CardContent>
              {!activeBookings.length ? (
                <div className="text-sm text-muted-foreground">No active bookings.</div>
              ) : (
                <div className="space-y-2">
                  {activeBookings.map((booking) => (
                    <div key={booking.id} className="rounded-lg border border-border bg-white p-3">
                      <div className="font-medium">{booking.plateNumber}</div>
                      <div className="text-sm text-muted-foreground">Status: {booking.status}</div>
                      <div className="text-xs text-muted-foreground">Expires: {formatDate(booking.expiresAt)}</div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="animate-fade-in-up">
            <CardHeader>
              <CardTitle>My Active Sessions</CardTitle>
            </CardHeader>
            <CardContent>
              {!activeSessions.length ? (
                <div className="text-sm text-muted-foreground">No active sessions.</div>
              ) : (
                <div className="space-y-2">
                  {activeSessions.map((session) => (
                    <div key={session.id} className="rounded-lg border border-border bg-white p-3">
                      <div className="font-medium">{session.plateNumber}</div>
                      <div className="mb-2 text-xs text-muted-foreground">Parking: {session.parkingId}</div>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={checkoutLoadingId === session.id}
                        onClick={() => driverCheckout(session)}
                      >
                        {checkoutLoadingId === session.id ? "Checking out..." : "Check Out"}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default DriverHome;
