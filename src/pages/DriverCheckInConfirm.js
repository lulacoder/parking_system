import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { firestore, functionsClient } from "../firebase";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

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
      return <Badge variant="warning">Waiting for operator approval...</Badge>;
    }
    if (requestStatus === "approved") {
      return (
        <div className="space-y-2">
          <Badge variant="success">Approved. Your parking session has started.</Badge>
          <div>
            <Button size="sm" onClick={() => navigate("/driver/home")}>Go to Driver Home</Button>
          </div>
        </div>
      );
    }
    if (requestStatus === "rejected") {
      return <Badge variant="destructive">Request rejected. Please re-scan a fresh QR.</Badge>;
    }
    if (requestStatus === "expired") {
      return <Badge variant="warning">QR token expired. Ask operator to refresh QR.</Badge>;
    }
    return <Badge variant="secondary">Current status: {requestStatus}</Badge>;
  };

  return (
    <div className="mx-auto w-full max-w-xl py-4">
      <Card className="animate-fade-in-up">
        <CardHeader>
          <CardTitle>Confirm Parking Check-In</CardTitle>
          <CardDescription>Scan operator QR, confirm your plate, then wait for operator approval.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!token ? <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">Missing QR token. Please scan again.</div> : null}

          <form onSubmit={confirmCheckIn} className="space-y-3">
            <div className="space-y-2">
              <Label>Plate Number</Label>
              <Input
                value={plateNumber}
                onChange={(e) => setPlateNumber(e.target.value.toUpperCase())}
                placeholder="AA 12345"
                required
              />
            </div>
            <Button type="submit" disabled={loading || !token}>
              {loading ? "Confirming..." : "Confirm Check-In"}
            </Button>
          </form>

          {requestPayload && (
            <div className="text-xs text-muted-foreground">
              Parking: {requestPayload.parkingId} | Request: {requestId}
            </div>
          )}
          {renderStatus()}
        </CardContent>
      </Card>
    </div>
  );
}

export default DriverCheckInConfirm;
