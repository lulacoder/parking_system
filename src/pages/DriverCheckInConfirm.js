import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { firestore, functionsClient } from "../firebase";

function DriverCheckInConfirm() {
  const location = useLocation();
  const navigate = useNavigate();
  const token = useMemo(() => new URLSearchParams(location.search).get("token") || "", [location.search]);

  const [plateNumber, setPlateNumber] = useState("");
  const [requestId, setRequestId] = useState("");
  const [requestStatus, setRequestStatus] = useState("");
  const [requestPayload, setRequestPayload] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!requestId) return undefined;
    const unsub = firestore.collection("checkInRequests").doc(requestId).onSnapshot(
      (snap) => {
        if (!snap.exists) return;
        const payload = snap.data();
        setRequestPayload(payload);
        setRequestStatus(payload.status || "");
      },
      (err) => toast.error(err.message || "Failed to read check-in request status.")
    );
    return () => unsub();
  }, [requestId]);

  const confirmCheckIn = async (event) => {
    event.preventDefault();

    if (!token) {
      toast.error("Invalid QR link. Ask operator to refresh QR and scan again.");
      return;
    }

    setLoading(true);
    try {
      const callable = functionsClient.httpsCallable("confirmCheckInFromQr");
      const response = await callable({ token, plateNumber });
      setRequestId(response.data.requestId);
      setRequestStatus(response.data.status);
      toast.success("Confirmation sent. Please wait for operator approval.");
    } catch (err) {
      toast.error(err.message || "Failed to confirm check-in.");
    } finally {
      setLoading(false);
    }
  };

  const renderStatus = () => {
    if (!requestStatus) return null;
    if (requestStatus === "pending") {
      return <div className="alert alert-info mb-0">Waiting for operator approval...</div>;
    }
    if (requestStatus === "approved") {
      return (
        <div className="alert alert-success mb-0">
          Approved. Your parking session has started.
          <button className="btn btn-link p-0 ms-2" onClick={() => navigate("/driver/home")}>
            Go to Driver Home
          </button>
        </div>
      );
    }
    if (requestStatus === "rejected") {
      return <div className="alert alert-warning mb-0">Request rejected by operator. Please re-scan a fresh QR.</div>;
    }
    if (requestStatus === "expired") {
      return <div className="alert alert-warning mb-0">QR token expired. Ask operator to refresh QR.</div>;
    }
    return <div className="alert alert-secondary mb-0">Current status: {requestStatus}</div>;
  };

  return (
    <div className="container py-4">
      <div className="card border-0 shadow-sm">
        <div className="card-body">
          <h3 className="fw-bold mb-2">Confirm Parking Check-In</h3>
          <p className="text-muted mb-4">Scan operator QR, confirm your plate, then wait for operator approval.</p>

          {!token && <div className="alert alert-danger">Missing QR token. Please scan again.</div>}

          <form onSubmit={confirmCheckIn} className="mb-3">
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
            <button type="submit" className="btn btn-primary" disabled={loading || !token}>
              {loading ? "Confirming..." : "Confirm Check-In"}
            </button>
          </form>

          {requestPayload && (
            <div className="small text-muted mb-2">
              Parking: {requestPayload.parkingId} | Request: {requestId}
            </div>
          )}
          {renderStatus()}
        </div>
      </div>
    </div>
  );
}

export default DriverCheckInConfirm;
