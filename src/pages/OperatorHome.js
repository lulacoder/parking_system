import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { auth, firestore, functionsClient } from "../firebase";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Dialog } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select } from "../components/ui/select";

function OperatorHome() {
  const [assignedParkingIds, setAssignedParkingIds] = useState([]);
  const [parkings, setParkings] = useState([]);
  const [selectedParkingId, setSelectedParkingId] = useState("");
  const [plateNumber, setPlateNumber] = useState("");
  const [allowWalkIn, setAllowWalkIn] = useState(true);
  const [activeSessions, setActiveSessions] = useState([]);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [pendingPayments, setPendingPayments] = useState([]);
  const [paymentsRefreshNonce, setPaymentsRefreshNonce] = useState(0);
  const [confirmPaymentTarget, setConfirmPaymentTarget] = useState(null);
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
      (err) => handleRealtimeError(err, "Failed to load operator profile.")
    );
    return () => unsub();
  }, [selectedParkingId]);

  useEffect(() => {
    if (!selectedParkingId) {
      setPendingPayments([]);
      return undefined;
    }
    let mounted = true;
    let timer = null;

    const loadPendingPayments = async () => {
      try {
        const callable = functionsClient.httpsCallable("listPendingPaymentsForOperator");
        const response = await callable({ parkingId: selectedParkingId });
        if (!mounted) return;
        setPendingPayments(Array.isArray(response?.data?.pendingPayments) ? response.data.pendingPayments : []);
      } catch (err) {
        if (mounted) {
          toast.error(err.message || "Failed to load pending payments.");
        }
      }
    };

    loadPendingPayments();
    timer = setInterval(loadPendingPayments, 8000);

    return () => {
      mounted = false;
      if (timer) clearInterval(timer);
    };
  }, [selectedParkingId, paymentsRefreshNonce]);

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
        (err) => handleRealtimeError(err, "Failed to load pending requests.")
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
        (err) => handleRealtimeError(err, "Failed to load assigned parking.")
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
        (err) => handleRealtimeError(err, "Failed to load active sessions.")
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

  const onApproveRequest = async (requestId) => {
    const result = await callAction("approveCheckInRequest", { requestId });
    if (result?.sessionId) {
      toast.success(`Request approved. Session ${result.sessionId} started.`);
    }
  };

  const onRejectRequest = async (requestId) => {
    await callAction("rejectCheckInRequest", { requestId });
  };

  const onConfirmPayment = async (requestId) => {
    const result = await callAction("confirmManualPayment", { requestId });
    if (result?.feeAmount != null) {
      toast.success(`Payment confirmed. Fee settled: ${result.feeAmount} ETB`);
    }
    setConfirmPaymentTarget(null);
    setPaymentsRefreshNonce((n) => n + 1);
  };

  const onRejectPayment = async (requestId) => {
    await callAction("rejectManualPayment", { requestId, reason: "Payment proof could not be verified" });
    setPaymentsRefreshNonce((n) => n + 1);
  };

  const resolvePendingPaymentForSession = async (sessionId) => {
    setLoadingAction("getPendingPaymentForSession");
    try {
      const callable = functionsClient.httpsCallable("getPendingPaymentForSession");
      const response = await callable({ sessionId });
      const pendingPayment = response?.data?.pendingPayment || null;
      if (!pendingPayment) {
        toast.error("No pending payment found for this session.");
        return null;
      }
      setPendingPayments((prev) => {
        const others = prev.filter((item) => item.id !== pendingPayment.id);
        return [pendingPayment, ...others];
      });
      return pendingPayment;
    } catch (err) {
      toast.error(err.message || "Failed to resolve pending payment.");
      return null;
    } finally {
      setLoadingAction("");
    }
  };

  const qrLink = qrPayload?.deepLink || "";
  const qrImageUrl = qrLink
    ? `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(qrLink)}`
    : "";

  return (
    <div className="space-y-6">
      <Card className="animate-fade-in-up">
        <CardHeader>
          <CardTitle>Operator Entry & Exit</CardTitle>
          <CardDescription>Secure check-in and check-out workflows with QR approvals.</CardDescription>
        </CardHeader>
      </Card>

      <Card className="animate-fade-in-up">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Driver Check-In QR</CardTitle>
            <CardDescription>Refreshes every minute for secure one-time usage.</CardDescription>
          </div>
          <Button variant="outline" onClick={() => setQrRefreshNonce((n) => n + 1)} disabled={qrLoading}>
            {qrLoading ? "Refreshing..." : "Refresh"}
          </Button>
        </CardHeader>
        <CardContent>
          {!selectedParkingId ? (
            <p className="text-sm text-muted-foreground">Select a parking to generate QR.</p>
          ) : qrLoading && !qrPayload ? (
            <p className="text-sm text-muted-foreground">Generating QR...</p>
          ) : qrPayload ? (
            <div className="flex flex-col items-start gap-4 md:flex-row">
              <img src={qrImageUrl} alt="Check-in QR" width={220} height={220} className="rounded-lg border border-border" />
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>Scan with phone camera. Driver confirms plate, then waits for approval.</p>
                <p>
                  Token: <span className="font-medium text-foreground">{qrPayload.tokenId}</span>
                </p>
                <p>
                  Expires: <span className="font-medium text-foreground">{new Date(qrPayload.expiresAtMs || 0).toLocaleTimeString()}</span>
                </p>
                <a href={qrLink} target="_blank" rel="noreferrer" className="text-blue-600 hover:text-blue-700">
                  Open Deep Link
                </a>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">QR unavailable.</p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="animate-fade-in-up">
          <CardHeader>
            <CardTitle>Vehicle Action</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-4">
              <div className="space-y-2">
                <Label>Assigned Parking</Label>
                <Select value={selectedParkingId} onChange={(e) => setSelectedParkingId(e.target.value)} required>
                  {parkings.map((parking) => (
                    <option key={parking.id} value={parking.id}>
                      {parking.name}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Plate Number</Label>
                <Input value={plateNumber} onChange={(e) => setPlateNumber(e.target.value.toUpperCase())} placeholder="AA 12345" />
              </div>

              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={allowWalkIn}
                  onChange={(e) => setAllowWalkIn(e.target.checked)}
                  className="h-4 w-4 rounded border-border"
                />
                Allow walk-in check-in
              </label>

              <div className="flex gap-2">
                <Button onClick={onCheckIn} disabled={loadingAction === "checkInVehicle"}>
                  {loadingAction === "checkInVehicle" ? "Checking in..." : "Check In"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="animate-fade-in-up">
            <CardHeader>
              <CardTitle>Current Parking</CardTitle>
            </CardHeader>
            <CardContent>
              {selectedParking ? (
                <div className="space-y-2 text-sm">
                  <div className="text-muted-foreground">{selectedParking.address || "No address"}</div>
                  <div className="flex gap-2">
                    <Badge variant="secondary">Available: {selectedParking.availableSlots || 0}</Badge>
                    <Badge variant="warning">Reserved: {selectedParking.reservedSlots || 0}</Badge>
                    <Badge variant="destructive">Occupied: {selectedParking.occupiedSlots || 0}</Badge>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">No parking assigned.</div>
              )}
            </CardContent>
          </Card>

          <Card className="animate-fade-in-up">
            <CardHeader>
              <CardTitle>Active Sessions</CardTitle>
            </CardHeader>
            <CardContent>
              {!activeSessions.length ? (
                <div className="text-sm text-muted-foreground">No active sessions.</div>
              ) : (
                <div className="space-y-2">
                  {activeSessions.map((session) => (
                    <div className="rounded-lg border border-border p-3" key={session.id}>
                      {(() => {
                        const sessionPendingPayment = pendingPayments.find((item) => item.sessionId === session.id);
                        return (
                          <>
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-medium">{session.plateNumber}</div>
                        <Badge variant={session.paymentStatus === "pending" ? "warning" : "secondary"}>
                          {session.paymentStatus === "pending" ? "Awaiting Confirmation" : `Payment ${session.paymentStatus || "unpaid"}`}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">Session ID: {session.id}</div>
                      {session.paymentStatus === "pending" ? (
                        <div className="mt-1 text-xs text-amber-700">Driver has submitted payment. Confirm below in Pending Payments.</div>
                      ) : null}
                      {session.paymentStatus === "pending" && sessionPendingPayment ? (
                        <div className="mt-2 flex gap-2">
                          <Button size="sm" onClick={() => setConfirmPaymentTarget(sessionPendingPayment)}>
                            Confirm Payment
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onRejectPayment(sessionPendingPayment.id)}
                            disabled={loadingAction === "rejectManualPayment"}
                          >
                            Reject
                          </Button>
                        </div>
                      ) : null}
                      {session.paymentStatus === "pending" && !sessionPendingPayment ? (
                        <div className="mt-2 flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">Payment request not loaded yet.</span>
                          <Button size="sm" variant="outline" onClick={() => setPaymentsRefreshNonce((n) => n + 1)}>
                            Refresh Payments
                          </Button>
                          <Button
                            size="sm"
                            onClick={async () => {
                              const pendingPayment = await resolvePendingPaymentForSession(session.id);
                              if (pendingPayment) setConfirmPaymentTarget(pendingPayment);
                            }}
                            disabled={loadingAction === "getPendingPaymentForSession"}
                          >
                            {loadingAction === "getPendingPaymentForSession" ? "Loading..." : "Load & Confirm"}
                          </Button>
                        </div>
                      ) : null}
                          </>
                        );
                      })()}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="animate-fade-in-up">
            <CardHeader>
              <CardTitle>Pending QR Confirmations</CardTitle>
            </CardHeader>
            <CardContent>
              {!pendingRequests.length ? (
                <div className="text-sm text-muted-foreground">No pending confirmations.</div>
              ) : (
                <div className="space-y-2">
                  {pendingRequests.map((request) => (
                    <div className="rounded-lg border border-border p-3" key={request.id}>
                      <div className="font-medium">{request.plateNumber}</div>
                      <div className="text-xs text-muted-foreground">Driver: {request.driverUid}</div>
                      <div className="mb-2 text-xs text-muted-foreground">Requested: {new Date(getMs(request.createdAt)).toLocaleString()}</div>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => onApproveRequest(request.id)} disabled={loadingAction === "approveCheckInRequest"}>
                          Approve
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => onRejectRequest(request.id)} disabled={loadingAction === "rejectCheckInRequest"}>
                          Reject
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="animate-fade-in-up">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Pending Payments</CardTitle>
              <Button size="sm" variant="outline" onClick={() => setPaymentsRefreshNonce((n) => n + 1)}>
                Refresh
              </Button>
            </CardHeader>
            <CardContent>
              {!pendingPayments.length ? (
                <div className="text-sm text-muted-foreground">No pending payments.</div>
              ) : (
                <div className="space-y-2">
                  {pendingPayments.map((request) => (
                    <div className="rounded-lg border border-border p-3" key={request.id}>
                      <div className="font-medium">{request.plateNumber || "Unknown Plate"}</div>
                      <div className="text-xs text-muted-foreground">Driver: {request.driverId}</div>
                      <div className="text-xs text-muted-foreground">Amount: {request.amountDue ?? 0} ETB</div>
                      <div className="text-xs text-muted-foreground">Method: {request.method || "N/A"}</div>
                      <div className="text-xs text-muted-foreground">Reference: {request.referenceCode || "Not provided"}</div>
                      <div className="mb-2 text-xs text-muted-foreground">
                        Submitted: {new Date(getMs(request.submittedAtMs || request.submittedAt)).toLocaleString()}
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => setConfirmPaymentTarget(request)}>
                          Confirm
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => onRejectPayment(request.id)} disabled={loadingAction === "rejectManualPayment"}>
                          Reject
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog
        open={Boolean(confirmPaymentTarget)}
        onClose={() => setConfirmPaymentTarget(null)}
        title="Confirm Manual Payment"
      >
        {!confirmPaymentTarget ? null : (
          <div className="space-y-4">
            <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
              <div className="font-medium">{confirmPaymentTarget.plateNumber || "Unknown plate"}</div>
              <div className="text-xs text-muted-foreground">Amount: {confirmPaymentTarget.amountDue ?? 0} ETB</div>
              <div className="text-xs text-muted-foreground">Method: {confirmPaymentTarget.method || "N/A"}</div>
              <div className="text-xs text-muted-foreground">Reference: {confirmPaymentTarget.referenceCode || "Not provided"}</div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmPaymentTarget(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => onConfirmPayment(confirmPaymentTarget.id)}
                disabled={loadingAction === "confirmManualPayment"}
              >
                {loadingAction === "confirmManualPayment" ? "Confirming..." : "Confirm Payment"}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
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

function handleRealtimeError(err, fallbackMessage) {
  const code = err?.code || "";
  if (code === "permission-denied") {
    return;
  }
  toast.error(err?.message || fallbackMessage);
}

export default OperatorHome;
