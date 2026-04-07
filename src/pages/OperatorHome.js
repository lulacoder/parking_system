import React, { useEffect, useMemo, useState } from "react";
import { auth, firestore, functionsClient } from "../firebase";

function OperatorHome() {
  const [assignedParkingIds, setAssignedParkingIds] = useState([]);
  const [parkings, setParkings] = useState([]);
  const [selectedParkingId, setSelectedParkingId] = useState("");
  const [plateNumber, setPlateNumber] = useState("");
  const [allowWalkIn, setAllowWalkIn] = useState(true);
  const [activeSessions, setActiveSessions] = useState([]);
  const [loadingAction, setLoadingAction] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return undefined;
    const unsub = firestore.collection("users").doc(uid).onSnapshot((snap) => {
      const profile = snap.exists ? snap.data() : null;
      const assigned = Array.isArray(profile?.assignedParkingIds) ? profile.assignedParkingIds : [];
      setAssignedParkingIds(assigned);
      if (!selectedParkingId && assigned.length) setSelectedParkingId(assigned[0]);
    });
    return () => unsub();
  }, [selectedParkingId]);

  useEffect(() => {
    if (!assignedParkingIds.length) {
      setParkings([]);
      return undefined;
    }
    setParkings([]);
    let mounted = true;
    const unsubscribers = assignedParkingIds.map((parkingId) =>
      firestore.collection("parkings").doc(parkingId).onSnapshot((docSnap) => {
        if (!mounted) return;
        setParkings((prev) => {
          const filtered = prev.filter((p) => p.id !== parkingId);
          if (!docSnap.exists) return filtered;
          return [...filtered, { id: docSnap.id, ...docSnap.data() }].sort((a, b) => a.name.localeCompare(b.name));
        });
      })
    );
    return () => {
      mounted = false;
      unsubscribers.forEach((fn) => fn());
    };
  }, [assignedParkingIds]);

  useEffect(() => {
    if (!selectedParkingId) {
      setActiveSessions([]);
      return undefined;
    }
    const unsub = firestore
      .collection("sessions")
      .where("parkingId", "==", selectedParkingId)
      .where("status", "==", "active")
      .orderBy("entryTime", "desc")
      .onSnapshot((snapshot) => {
        setActiveSessions(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
      });
    return () => unsub();
  }, [selectedParkingId]);

  const selectedParking = useMemo(
    () => parkings.find((parking) => parking.id === selectedParkingId) || null,
    [parkings, selectedParkingId]
  );

  const callAction = async (name, payload) => {
    setLoadingAction(name);
    setError("");
    setMessage("");
    try {
      const callable = functionsClient.httpsCallable(name);
      const response = await callable(payload);
      setMessage(`${name} success.`);
      return response.data;
    } catch (err) {
      setError(err.message || `${name} failed`);
      return null;
    } finally {
      setLoadingAction("");
    }
  };

  const onCheckIn = async (e) => {
    e.preventDefault();
    await callAction("checkInVehicle", { parkingId: selectedParkingId, plateNumber, allowWalkIn });
  };

  const onCheckOut = async (e) => {
    e.preventDefault();
    const result = await callAction("checkOutVehicle", { parkingId: selectedParkingId, plateNumber });
    if (result?.feeAmount != null) {
      setMessage(`checkOutVehicle success. Fee: ${result.feeAmount} ETB`);
    }
  };

  return (
    <div className="container py-4">
      <div className="card border-0 shadow-sm mb-4">
        <div className="card-body">
          <h3 className="fw-bold mb-2">Operator Entry & Exit</h3>
          <p className="text-muted mb-0">Run secure check-in and check-out workflows via Cloud Functions.</p>
        </div>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}
      {message && <div className="alert alert-success">{message}</div>}

      <div className="row g-4">
        <div className="col-lg-6">
          <div className="card border-0 shadow-sm">
            <div className="card-body">
              <h5 className="fw-bold mb-3">Vehicle Action</h5>
              <div className="mb-3">
                <label className="form-label">Assigned Parking</label>
                <select
                  className="form-select"
                  value={selectedParkingId}
                  onChange={(e) => setSelectedParkingId(e.target.value)}
                  required
                >
                  {parkings.map((parking) => (
                    <option key={parking.id} value={parking.id}>
                      {parking.name}
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
                />
              </div>

              <div className="form-check mb-3">
                <input
                  id="walkin-toggle"
                  type="checkbox"
                  className="form-check-input"
                  checked={allowWalkIn}
                  onChange={(e) => setAllowWalkIn(e.target.checked)}
                />
                <label htmlFor="walkin-toggle" className="form-check-label">
                  Allow walk-in check-in
                </label>
              </div>

              <div className="d-flex gap-2">
                <button className="btn btn-primary" onClick={onCheckIn} disabled={loadingAction === "checkInVehicle"}>
                  {loadingAction === "checkInVehicle" ? "Checking in..." : "Check In"}
                </button>
                <button className="btn btn-warning" onClick={onCheckOut} disabled={loadingAction === "checkOutVehicle"}>
                  {loadingAction === "checkOutVehicle" ? "Checking out..." : "Check Out"}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="col-lg-6">
          <div className="card border-0 shadow-sm mb-3">
            <div className="card-body">
              <h5 className="fw-bold mb-2">Current Parking</h5>
              {selectedParking ? (
                <>
                  <div className="small text-muted">{selectedParking.address || "No address"}</div>
                  <div className="mt-2">Available: {selectedParking.availableSlots || 0}</div>
                  <div>Reserved: {selectedParking.reservedSlots || 0}</div>
                  <div>Occupied: {selectedParking.occupiedSlots || 0}</div>
                </>
              ) : (
                <div className="text-muted">No parking assigned.</div>
              )}
            </div>
          </div>

          <div className="card border-0 shadow-sm">
            <div className="card-body">
              <h5 className="fw-bold mb-2">Active Sessions</h5>
              {!activeSessions.length ? (
                <div className="text-muted">No active sessions.</div>
              ) : (
                <div className="list-group">
                  {activeSessions.map((session) => (
                    <div className="list-group-item" key={session.id}>
                      <div className="fw-bold">{session.plateNumber}</div>
                      <div className="small text-muted">Session ID: {session.id}</div>
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

export default OperatorHome;
