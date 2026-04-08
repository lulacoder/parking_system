import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { auth, firestore, functionsClient } from "../firebase";

function OperatorHome() {
  const [assignedParkingIds, setAssignedParkingIds] = useState([]);
  const [parkings, setParkings] = useState([]);
  const [selectedParkingId, setSelectedParkingId] = useState("");
  const [plateNumber, setPlateNumber] = useState("");
  const [allowWalkIn, setAllowWalkIn] = useState(true);
  const [activeSessions, setActiveSessions] = useState([]);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [qrPayload, setQrPayload] = useState(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrRefreshNonce, setQrRefreshNonce] = useState(0);
  const [loadingAction, setLoadingAction] = useState("");

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return undefined;
    const unsub = firestore.collection("users").doc(uid).onSnapshot(
      (snap) => {
        const profile = snap.exists ? snap.data() : null;
        const assigned = Array.isArray(profile?.assignedParkingIds) ? profile.assignedParkingIds : [];
        setAssignedParkingIds(assigned);
        if (!selectedParkingId && assigned.length) setSelectedParkingId(assigned[0]);
      },
      (err) => toast.error(err.message || "Failed to load operator profile.")
    );
    return () => unsub();
  }, [selectedParkingId]);

  useEffect(() => {
    if (!selectedParkingId) {
      setPendingRequests([]);
      return undefined;
    }
    const unsub = firestore
      .collection("checkInRequests")
      .where("parkingId", "==", selectedParkingId)
      .where("status", "==", "pending")
      .onSnapshot(
        (snapshot) => {
          const list = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
          list.sort((a, b) => getMs(b.createdAt) - getMs(a.createdAt));
          setPendingRequests(list);
        },
        (err) => toast.error(err.message || "Failed to load pending QR requests.")
      );
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
      firestore.collection("parkings").doc(parkingId).onSnapshot(
        (docSnap) => {
          if (!mounted) return;
          setParkings((prev) => {
            const filtered = prev.filter((p) => p.id !== parkingId);
            if (!docSnap.exists) return filtered;
            return [...filtered, { id: docSnap.id, ...docSnap.data() }].sort((a, b) => a.name.localeCompare(b.name));
          });
        },
        (err) => toast.error(err.message || "Failed to load assigned parking.")
      )
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
      .onSnapshot(
        (snapshot) => {
          setActiveSessions(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
        },
        (err) => toast.error(err.message || "Failed to load active sessions.")
      );
    return () => unsub();
  }, [selectedParkingId]);

  const selectedParking = useMemo(
    () => parkings.find((parking) => parking.id === selectedParkingId) || null,
    [parkings, selectedParkingId]
  );

  useEffect(() => {
    if (!selectedParkingId) {
      setQrPayload(null);
      return undefined;
    }

    let active = true;
    let timer = null;
    const refreshQr = async () => {
      try {
        setQrLoading(true);
        const callable = functionsClient.httpsCallable("createParkingCheckInToken");
        const response = await callable({ parkingId: selectedParkingId });
        if (!active) return;
        setQrPayload(response.data);
      } catch (err) {
        if (!active) return;
        toast.error(err.message || "Failed to create QR token.");
      } finally {
        if (active) setQrLoading(false);
      }
    };

    refreshQr();
    timer = setInterval(refreshQr, 55000);
    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, [selectedParkingId, qrRefreshNonce]);

  const callAction = async (name, payload) => {
    setLoadingAction(name);
    try {
      const callable = functionsClient.httpsCallable(name);
      const response = await callable(payload);
      toast.success(`${name} success.`);
      return response.data;
    } catch (err) {
      toast.error(err.message || `${name} failed`);
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
      toast.success(`Checkout success. Fee: ${result.feeAmount} ETB`);
    }
  };

  const onApproveRequest = async (requestId) => {
    const result = await callAction("approveCheckInRequest", { requestId });
    if (result?.sessionId) {
      toast.success(`Request approved. Session ${result.sessionId} started.`);
    }
  };

  const onRejectRequest = async (requestId) => {
    await callAction("rejectCheckInRequest", { requestId });
  };

  const qrLink = qrPayload?.deepLink || "";
  const qrImageUrl = qrLink
    ? `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(qrLink)}`
    : "";

  return (
    <div className="container py-4">
      <div className="card border-0 shadow-sm mb-4">
        <div className="card-body">
          <h3 className="fw-bold mb-2">Operator Entry & Exit</h3>
          <p className="text-muted mb-0">Run secure check-in and check-out workflows via Cloud Functions.</p>
        </div>
      </div>

      <div className="row g-4">
        <div className="col-12">
          <div className="card border-0 shadow-sm">
            <div className="card-body">
              <div className="d-flex justify-content-between align-items-center mb-2">
                <h5 className="fw-bold mb-0">Driver Check-In QR</h5>
                <button
                  className="btn btn-outline-primary btn-sm"
                  onClick={() => setQrRefreshNonce((n) => n + 1)}
                  disabled={qrLoading}
                >
                  {qrLoading ? "Refreshing..." : "Refresh"}
                </button>
              </div>
              {!selectedParkingId ? (
                <div className="text-muted">Select a parking to generate QR.</div>
              ) : qrLoading && !qrPayload ? (
                <div className="text-muted">Generating QR...</div>
              ) : qrPayload ? (
                <div className="d-flex flex-column flex-md-row gap-3 align-items-start">
                  <img src={qrImageUrl} alt="Check-in QR" width={220} height={220} style={{ borderRadius: "10px" }} />
                  <div>
                    <div className="small text-muted mb-2">Scan with phone camera. Driver will confirm plate and wait for approval.</div>
                    <div className="small text-muted mb-2">Token: {qrPayload.tokenId}</div>
                    <div className="small text-muted mb-2">Expires: {new Date(qrPayload.expiresAtMs || 0).toLocaleTimeString()}</div>
                    <a href={qrLink} target="_blank" rel="noreferrer">
                      Open Deep Link
                    </a>
                  </div>
                </div>
              ) : (
                <div className="text-muted">QR unavailable.</div>
              )}
            </div>
          </div>
        </div>

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

          <div className="card border-0 shadow-sm mt-3">
            <div className="card-body">
              <h5 className="fw-bold mb-2">Pending QR Confirmations</h5>
              {!pendingRequests.length ? (
                <div className="text-muted">No pending confirmations.</div>
              ) : (
                <div className="list-group">
                  {pendingRequests.map((request) => (
                    <div className="list-group-item" key={request.id}>
                      <div className="fw-bold">{request.plateNumber}</div>
                      <div className="small text-muted">Driver: {request.driverUid}</div>
                      <div className="small text-muted mb-2">Requested: {new Date(getMs(request.createdAt)).toLocaleString()}</div>
                      <div className="d-flex gap-2">
                        <button
                          className="btn btn-sm btn-success"
                          disabled={loadingAction === "approveCheckInRequest"}
                          onClick={() => onApproveRequest(request.id)}
                        >
                          Approve
                        </button>
                        <button
                          className="btn btn-sm btn-outline-danger"
                          disabled={loadingAction === "rejectCheckInRequest"}
                          onClick={() => onRejectRequest(request.id)}
                        >
                          Reject
                        </button>
                      </div>
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

function getMs(value) {
  if (!value) return 0;
  if (typeof value === "number") return value;
  if (value.toMillis) return value.toMillis();
  if (value.seconds) return value.seconds * 1000;
  return 0;
}

export default OperatorHome;
