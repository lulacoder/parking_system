import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { auth, firestore, functionsClient } from "../firebase";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

function OwnerHome() {
  const [ownerProfile, setOwnerProfile] = useState(null);
  const [ownerAccount, setOwnerAccount] = useState(null);
  const [parkings, setParkings] = useState([]);
  const [operators, setOperators] = useState([]);
  const [completedSessions, setCompletedSessions] = useState([]);
  const [payments, setPayments] = useState([]);
  const [paymentForm, setPaymentForm] = useState({
    phone: "",
    bankAccountNumber: "",
  });
  const [paymentDetailsLoading, setPaymentDetailsLoading] = useState(false);
  const [operatorForm, setOperatorForm] = useState({
    fullName: "",
    email: "",
    password: "",
    phone: "",
    assignedParkingIds: [],
  });
  const [createOperatorLoading, setCreateOperatorLoading] = useState(false);
  const [operatorAssignmentsDraft, setOperatorAssignmentsDraft] = useState({});
  const [operatorActionLoading, setOperatorActionLoading] = useState({});

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return undefined;
    const unsub = firestore.collection("users").doc(uid).onSnapshot(
      (snap) => setOwnerProfile(snap.exists ? snap.data() : null),
      (err) => handleRealtimeError(err, "Failed to load owner profile.")
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!ownerProfile?.ownerId) {
      setOwnerAccount(null);
      setParkings([]);
      return undefined;
    }

    const ownerDocUnsub = firestore.collection("owners").doc(ownerProfile.ownerId).onSnapshot(
      (snap) => {
        const data = snap.exists ? snap.data() : null;
        setOwnerAccount(data);
        setPaymentForm({
          phone: data?.phone || "",
          bankAccountNumber: data?.bankAccountNumber || "",
        });
      },
      (err) => handleRealtimeError(err, "Failed to load owner payment details.")
    );

    const unsub = firestore
      .collection("parkings")
      .where("ownerId", "==", ownerProfile.ownerId)
      .onSnapshot(
        (snap) => setParkings(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
        (err) => handleRealtimeError(err, "Failed to load parkings.")
      );
    return () => {
      ownerDocUnsub();
      unsub();
    };
  }, [ownerProfile]);

  useEffect(() => {
    if (!ownerProfile?.ownerId) {
      setOperators([]);
      return undefined;
    }
    const unsub = firestore
      .collection("users")
      .where("ownerId", "==", ownerProfile.ownerId)
      .where("role", "==", "operator")
      .onSnapshot(
        (snap) => setOperators(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
        (err) => handleRealtimeError(err, "Failed to load operators.")
      );
    return () => unsub();
  }, [ownerProfile]);

  useEffect(() => {
    setOperatorAssignmentsDraft((prev) => {
      const next = { ...prev };
      operators.forEach((operator) => {
        if (!next[operator.id]) {
          next[operator.id] = Array.isArray(operator.assignedParkingIds) ? operator.assignedParkingIds : [];
        }
      });
      Object.keys(next).forEach((operatorId) => {
        if (!operators.some((op) => op.id === operatorId)) {
          delete next[operatorId];
        }
      });
      return next;
    });
  }, [operators]);

  useEffect(() => {
    if (!ownerProfile?.ownerId) {
      setCompletedSessions([]);
      setPayments([]);
      return undefined;
    }

    const sessionsUnsub = firestore
      .collection("sessions")
      .where("ownerId", "==", ownerProfile.ownerId)
      .where("status", "==", "completed")
      .onSnapshot(
        (snap) => setCompletedSessions(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
        (err) => handleRealtimeError(err, "Failed to load completed sessions.")
      );

    const paymentsUnsub = firestore
      .collection("payments")
      .where("ownerId", "==", ownerProfile.ownerId)
      .where("status", "==", "confirmed")
      .onSnapshot(
        (snap) => setPayments(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
        (err) => handleRealtimeError(err, "Failed to load payments.")
      );

    return () => {
      sessionsUnsub();
      paymentsUnsub();
    };
  }, [ownerProfile]);

  const summary = useMemo(() => {
    const totalCapacity = parkings.reduce((acc, p) => acc + Number(p.slotCapacity || 0), 0);
    const totalAvailable = parkings.reduce((acc, p) => acc + Number(p.availableSlots || 0), 0);
    const totalReserved = parkings.reduce((acc, p) => acc + Number(p.reservedSlots || 0), 0);
    const totalOccupied = parkings.reduce((acc, p) => acc + Number(p.occupiedSlots || 0), 0);
    const totalOwnerRevenue = payments.reduce((acc, p) => acc + Number(p.ownerAmount || 0), 0);
    const totalGrossRevenue = payments.reduce((acc, p) => acc + Number(p.grossAmount || 0), 0);
    const totalSessions = completedSessions.length;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(today.getDate() - 6);
    const todayMs = today.getTime();
    const weekMs = sevenDaysAgo.getTime();

    const todaySessions = completedSessions.filter((s) => getMs(s.exitTime || s.updatedAt) >= todayMs).length;
    const weekSessions = completedSessions.filter((s) => getMs(s.exitTime || s.updatedAt) >= weekMs).length;

    return {
      totalCapacity,
      totalAvailable,
      totalReserved,
      totalOccupied,
      totalOwnerRevenue,
      totalGrossRevenue,
      totalSessions,
      todaySessions,
      weekSessions,
    };
  }, [completedSessions, parkings, payments]);

  const handleOperatorFieldChange = (event) => {
    const { name, value } = event.target;
    setOperatorForm((prev) => ({ ...prev, [name]: value }));
  };

  const toggleParkingAssignment = (parkingId) => {
    setOperatorForm((prev) => {
      const isSelected = prev.assignedParkingIds.includes(parkingId);
      return {
        ...prev,
        assignedParkingIds: isSelected
          ? prev.assignedParkingIds.filter((id) => id !== parkingId)
          : [...prev.assignedParkingIds, parkingId],
      };
    });
  };

  const handleCreateOperator = async (event) => {
    event.preventDefault();
    setCreateOperatorLoading(true);

    try {
      const callable = functionsClient.httpsCallable("ownerCreateOperator");
      const response = await callable({
        fullName: operatorForm.fullName,
        email: operatorForm.email,
        password: operatorForm.password,
        phone: operatorForm.phone,
        assignedParkingIds: operatorForm.assignedParkingIds,
      });
      toast.success(`Operator created (UID: ${response.data.operatorUid}).`);
      setOperatorForm({
        fullName: "",
        email: "",
        password: "",
        phone: "",
        assignedParkingIds: [],
      });
    } catch (err) {
      toast.error(err?.message || "Failed to create operator.");
    } finally {
      setCreateOperatorLoading(false);
    }
  };

  const handleSavePaymentDetails = async (event) => {
    event.preventDefault();
    setPaymentDetailsLoading(true);
    try {
      const callable = functionsClient.httpsCallable("ownerUpdatePaymentDetails");
      const response = await callable({
        phone: paymentForm.phone,
        bankAccountNumber: paymentForm.bankAccountNumber,
      });
      setOwnerAccount((prev) => ({
        ...(prev || {}),
        phone: response?.data?.phone ?? paymentForm.phone,
        bankAccountNumber: response?.data?.bankAccountNumber ?? paymentForm.bankAccountNumber,
      }));
      toast.success("Payment destination details updated.");
    } catch (err) {
      toast.error(err?.message || "Failed to update payment details.");
    } finally {
      setPaymentDetailsLoading(false);
    }
  };

  const setOperatorLoading = (operatorUid, action, value) => {
    const key = `${operatorUid}:${action}`;
    setOperatorActionLoading((prev) => ({ ...prev, [key]: value }));
  };

  const isOperatorLoading = (operatorUid, action) => {
    const key = `${operatorUid}:${action}`;
    return Boolean(operatorActionLoading[key]);
  };

  const toggleOperatorParkingDraft = (operatorUid, parkingId) => {
    setOperatorAssignmentsDraft((prev) => {
      const current = prev[operatorUid] || [];
      const hasParking = current.includes(parkingId);
      return {
        ...prev,
        [operatorUid]: hasParking ? current.filter((id) => id !== parkingId) : [...current, parkingId],
      };
    });
  };

  const handleSaveOperatorAssignments = async (operatorUid) => {
    const assignedParkingIds = operatorAssignmentsDraft[operatorUid] || [];
    setOperatorLoading(operatorUid, "assignments", true);
    try {
      const callable = functionsClient.httpsCallable("ownerUpdateOperatorAssignments");
      await callable({ operatorUid, assignedParkingIds });
      toast.success("Operator assignments updated.");
    } catch (err) {
      toast.error(err?.message || "Failed to update operator assignments.");
    } finally {
      setOperatorLoading(operatorUid, "assignments", false);
    }
  };

  const handleToggleOperatorStatus = async (operatorUid, nextStatus) => {
    setOperatorLoading(operatorUid, "status", true);
    try {
      const callable = functionsClient.httpsCallable("ownerSetOperatorStatus");
      await callable({ operatorUid, status: nextStatus });
      toast.success(`Operator set to ${nextStatus}.`);
    } catch (err) {
      toast.error(err?.message || "Failed to update operator status.");
    } finally {
      setOperatorLoading(operatorUid, "status", false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="animate-fade-in-up">
        <CardHeader>
          <CardTitle>Owner Operations</CardTitle>
          <CardDescription>Manage operators, monitor live parking utilization, and track confirmed revenue.</CardDescription>
        </CardHeader>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard title="Owned Parkings" value={parkings.length} />
        <StatCard title="Capacity" value={summary.totalCapacity} />
        <StatCard title="Available" value={summary.totalAvailable} />
        <StatCard title="Occupied" value={summary.totalOccupied} />
        <StatCard title="Reserved" value={summary.totalReserved} />
        <StatCard title="Sessions (Today)" value={summary.todaySessions} />
        <StatCard title="Sessions (7 days)" value={summary.weekSessions} />
        <StatCard title="Sessions (All)" value={summary.totalSessions} />
        <StatCard title="Gross Revenue" value={`${summary.totalGrossRevenue.toFixed(2)} ETB`} />
        <StatCard title="Owner Revenue" value={`${summary.totalOwnerRevenue.toFixed(2)} ETB`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="animate-fade-in-up">
          <CardHeader>
            <CardTitle>Payment Destination Details</CardTitle>
            <CardDescription>
              Drivers see these details in the checkout modal before submitting manual payment.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSavePaymentDetails} className="space-y-4">
              <Field label="Phone Payment Number">
                <Input
                  value={paymentForm.phone}
                  onChange={(e) => setPaymentForm((prev) => ({ ...prev, phone: e.target.value }))}
                  placeholder="+251..."
                />
              </Field>
              <Field label="Bank Account Number">
                <Input
                  value={paymentForm.bankAccountNumber}
                  onChange={(e) => setPaymentForm((prev) => ({ ...prev, bankAccountNumber: e.target.value }))}
                  placeholder="Bank account for transfer"
                />
              </Field>
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                Current: Phone {ownerAccount?.phone || "not set"} | Bank {ownerAccount?.bankAccountNumber || "not set"}
              </div>
              <Button className="w-full" disabled={paymentDetailsLoading}>
                {paymentDetailsLoading ? "Saving..." : "Save Payment Details"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="animate-fade-in-up">
          <CardHeader>
            <CardTitle>Create Operator</CardTitle>
            <CardDescription>Create a new operator account and assign parking access instantly.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreateOperator} className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Full Name">
                  <Input name="fullName" value={operatorForm.fullName} onChange={handleOperatorFieldChange} required />
                </Field>
                <Field label="Email">
                  <Input
                    type="email"
                    name="email"
                    value={operatorForm.email}
                    onChange={handleOperatorFieldChange}
                    autoComplete="email"
                    required
                  />
                </Field>
                <Field label="Temporary Password">
                  <Input
                    type="password"
                    name="password"
                    value={operatorForm.password}
                    onChange={handleOperatorFieldChange}
                    autoComplete="new-password"
                    minLength={6}
                    required
                  />
                </Field>
                <Field label="Phone (Optional)">
                  <Input name="phone" value={operatorForm.phone} onChange={handleOperatorFieldChange} />
                </Field>
              </div>

              <div className="space-y-2">
                <Label>Assigned Parkings</Label>
                {!parkings.length ? (
                  <div className="text-sm text-muted-foreground">No owned parkings available yet.</div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {parkings.map((parking) => {
                      const checked = operatorForm.assignedParkingIds.includes(parking.id);
                      return (
                        <label
                          key={parking.id}
                          className={`cursor-pointer rounded-md border px-3 py-2 text-sm transition-colors ${
                            checked ? "border-blue-500 bg-blue-50 text-blue-700" : "border-border hover:bg-accent"
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="mr-2 h-4 w-4 align-middle"
                            checked={checked}
                            onChange={() => toggleParkingAssignment(parking.id)}
                          />
                          {parking.name}
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              <Button className="w-full" disabled={createOperatorLoading || !parkings.length}>
                {createOperatorLoading ? "Creating..." : "Create Operator"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="animate-fade-in-up">
          <CardHeader>
            <CardTitle>Owned Parkings</CardTitle>
            <CardDescription>Live slot distribution for your parking locations.</CardDescription>
          </CardHeader>
          <CardContent>
            {!parkings.length ? (
              <div className="text-sm text-muted-foreground">No parking sites are linked to your owner profile yet.</div>
            ) : (
              <div className="space-y-3">
                {parkings
                  .slice()
                  .sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)))
                  .map((parking) => (
                    <div key={parking.id} className="rounded-lg border border-border bg-background p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="font-medium">{parking.name}</div>
                          <div className="text-xs text-muted-foreground">{parking.address || "No address"}</div>
                        </div>
                        <Badge variant={parking.status === "active" ? "success" : "secondary"}>{parking.status || "unknown"}</Badge>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs">
                        <Badge variant="secondary">Capacity: {parking.slotCapacity || 0}</Badge>
                        <Badge>Available: {parking.availableSlots || 0}</Badge>
                        <Badge variant="warning">Reserved: {parking.reservedSlots || 0}</Badge>
                        <Badge variant="destructive">Occupied: {parking.occupiedSlots || 0}</Badge>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="animate-fade-in-up">
          <CardHeader>
            <CardTitle>Owned Operators</CardTitle>
            <CardDescription>Manage assignments and activation status per operator.</CardDescription>
          </CardHeader>
          <CardContent>
            {!operators.length ? (
              <div className="text-sm text-muted-foreground">No operators linked to this owner yet.</div>
            ) : (
              <div className="space-y-3">
                {operators
                  .slice()
                  .sort((a, b) => String(a.fullName || a.email || "").localeCompare(String(b.fullName || b.email || "")))
                  .map((operator) => (
                    <div key={operator.id} className="rounded-lg border border-border p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-medium">{operator.fullName || operator.email}</div>
                          <div className="text-xs text-muted-foreground">{operator.email}</div>
                        </div>
                        <Badge variant={operator.status === "active" ? "success" : "destructive"}>{operator.status || "unknown"}</Badge>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        {parkings.map((parking) => {
                          const checked = (operatorAssignmentsDraft[operator.id] || []).includes(parking.id);
                          return (
                            <label
                              key={`${operator.id}:${parking.id}`}
                              className={`cursor-pointer rounded-md border px-2 py-1 text-xs transition-colors ${
                                checked ? "border-blue-500 bg-blue-50 text-blue-700" : "border-border hover:bg-accent"
                              }`}
                            >
                              <input
                                type="checkbox"
                                className="mr-1 h-3.5 w-3.5 align-middle"
                                checked={checked}
                                onChange={() => toggleOperatorParkingDraft(operator.id, parking.id)}
                              />
                              {parking.name}
                            </label>
                          );
                        })}
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isOperatorLoading(operator.id, "assignments")}
                          onClick={() => handleSaveOperatorAssignments(operator.id)}
                        >
                          {isOperatorLoading(operator.id, "assignments") ? "Saving..." : "Save Assignments"}
                        </Button>
                        <Button
                          size="sm"
                          variant={operator.status === "active" ? "destructive" : "secondary"}
                          disabled={isOperatorLoading(operator.id, "status")}
                          onClick={() => handleToggleOperatorStatus(operator.id, operator.status === "active" ? "inactive" : "active")}
                        >
                          {isOperatorLoading(operator.id, "status")
                            ? "Updating..."
                            : operator.status === "active"
                            ? "Deactivate"
                            : "Activate"}
                        </Button>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="animate-fade-in-up">
          <CardHeader>
            <CardTitle>Recent Confirmed Payments</CardTitle>
            <CardDescription>Latest 10 settled payments across owned parkings.</CardDescription>
          </CardHeader>
          <CardContent>
            {!payments.length ? (
              <div className="text-sm text-muted-foreground">No confirmed payments yet.</div>
            ) : (
              <div className="space-y-3">
                {payments
                  .slice()
                  .sort((a, b) => getMs(b.paidAt) - getMs(a.paidAt))
                  .slice(0, 10)
                  .map((payment) => (
                    <div key={payment.id} className="rounded-lg border border-border bg-background p-3">
                      <div className="font-semibold">{Number(payment.grossAmount || 0).toFixed(2)} ETB</div>
                      <div className="text-xs text-muted-foreground">
                        Owner: {Number(payment.ownerAmount || 0).toFixed(2)} ETB | Commission:{" "}
                        {Number(payment.platformCommission || 0).toFixed(2)} ETB
                      </div>
                      <div className="text-xs text-muted-foreground">{formatDate(payment.paidAt)}</div>
                    </div>
                  ))}
              </div>
            )}
          </CardContent>
        </Card>
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

function formatDate(value) {
  return new Date(getMs(value)).toLocaleString();
}

function Field({ label, children }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function StatCard({ title, value }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="text-xs text-muted-foreground">{title}</div>
        <div className="text-xl font-semibold tracking-tight">{value}</div>
      </CardContent>
    </Card>
  );
}

function handleRealtimeError(err, fallbackMessage) {
  const code = err?.code || "";
  if (code === "permission-denied") {
    return;
  }
  toast.error(err?.message || fallbackMessage);
}

export default OwnerHome;
