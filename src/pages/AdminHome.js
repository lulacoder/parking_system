import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { firestore, functionsClient } from "../firebase";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select } from "../components/ui/select";

function AdminHome() {
  const [owners, setOwners] = useState([]);
  const [parkings, setParkings] = useState([]);
  const [operators, setOperators] = useState([]);

  const [ownerForm, setOwnerForm] = useState({
    fullName: "",
    email: "",
    password: "",
    phone: "",
    bankAccountNumber: "",
  });

  const [parkingForm, setParkingForm] = useState({
    parkingId: "",
    ownerId: "",
    name: "",
    address: "",
    status: "active",
    slotCapacity: 20,
    availableSlots: 20,
    reservedSlots: 0,
    occupiedSlots: 0,
    hourlyRate: 50,
    lat: 8.997,
    lng: 38.786,
  });

  const [assignmentForm, setAssignmentForm] = useState({
    operatorUid: "",
    parkingId: "",
    assign: true,
  });

  const [loading, setLoading] = useState("");

  useEffect(() => {
    const unsubOwners = firestore.collection("owners").onSnapshot(
      (snap) => {
        const nextOwners = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setOwners(nextOwners);
        setParkingForm((prev) => {
          if (prev.ownerId || !nextOwners.length) return prev;
          return { ...prev, ownerId: nextOwners[0].ownerId || nextOwners[0].id };
        });
      },
      (err) => toast.error(err.message || "Failed to load owners.")
    );

    const unsubParkings = firestore.collection("parkings").onSnapshot(
      (snap) => setParkings(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => toast.error(err.message || "Failed to load parkings.")
    );

    const unsubOperators = firestore.collection("users").where("role", "==", "operator").onSnapshot(
      (snap) => setOperators(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => toast.error(err.message || "Failed to load operators.")
    );

    return () => {
      unsubOwners();
      unsubParkings();
      unsubOperators();
    };
  }, []);

  const stats = useMemo(() => {
    const activeParkings = parkings.filter((p) => p.status === "active").length;
    return {
      owners: owners.length,
      parkings: parkings.length,
      activeParkings,
      operators: operators.length,
    };
  }, [owners, operators, parkings]);

  const callFn = async (name, payload) => {
    setLoading(name);
    try {
      const callable = functionsClient.httpsCallable(name);
      const result = await callable(payload);
      toast.success(`${name} successful.`);
      return result.data;
    } catch (err) {
      toast.error(err.message || `${name} failed`);
      return null;
    } finally {
      setLoading("");
    }
  };

  const submitOwner = async (e) => {
    e.preventDefault();
    const data = await callFn("createOwnerAccount", ownerForm);
    if (data?.ownerId) {
      setOwnerForm({ fullName: "", email: "", password: "", phone: "", bankAccountNumber: "" });
      setParkingForm((prev) => ({ ...prev, ownerId: data.ownerId }));
    }
  };

  const submitParking = async (e) => {
    e.preventDefault();
    const data = await callFn("upsertParking", parkingForm);
    if (data?.parkingId) {
      setParkingForm((prev) => ({ ...prev, parkingId: data.parkingId }));
    }
  };

  const submitAssignment = async (e) => {
    e.preventDefault();
    await callFn("assignOperatorToParking", assignmentForm);
  };

  return (
    <div className="space-y-6">
      <Card className="animate-fade-in-up">
        <CardHeader>
          <CardTitle>Admin Management Console</CardTitle>
          <CardDescription>Manage owners, parkings, and operator assignments with secure callable functions.</CardDescription>
        </CardHeader>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Owners" value={stats.owners} />
        <StatCard title="Parkings" value={stats.parkings} />
        <StatCard title="Active Parkings" value={stats.activeParkings} />
        <StatCard title="Operators" value={stats.operators} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="animate-fade-in-up">
          <CardHeader>
            <CardTitle>Create Owner Account</CardTitle>
            <CardDescription>Creates auth user, users profile, and owners profile in one step.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submitOwner} className="space-y-3">
              <Field label="Full Name">
                <Input value={ownerForm.fullName} onChange={(e) => setOwnerForm({ ...ownerForm, fullName: e.target.value })} required />
              </Field>
              <Field label="Email">
                <Input type="email" value={ownerForm.email} onChange={(e) => setOwnerForm({ ...ownerForm, email: e.target.value })} required />
              </Field>
              <Field label="Temporary Password">
                <Input type="password" value={ownerForm.password} onChange={(e) => setOwnerForm({ ...ownerForm, password: e.target.value })} required />
              </Field>
              <Field label="Phone">
                <Input value={ownerForm.phone} onChange={(e) => setOwnerForm({ ...ownerForm, phone: e.target.value })} />
              </Field>
              <Field label="Bank Account">
                <Input
                  value={ownerForm.bankAccountNumber}
                  onChange={(e) => setOwnerForm({ ...ownerForm, bankAccountNumber: e.target.value })}
                />
              </Field>

              <Button className="w-full" disabled={loading === "createOwnerAccount"}>
                {loading === "createOwnerAccount" ? "Creating..." : "Create Owner"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="animate-fade-in-up">
          <CardHeader>
            <CardTitle>Create / Update Parking</CardTitle>
            <CardDescription>Select owner from dropdown. Owner ID is never manually typed.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submitParking} className="space-y-3">
              <Field label="Parking ID (optional)">
                <Input value={parkingForm.parkingId} onChange={(e) => setParkingForm({ ...parkingForm, parkingId: e.target.value })} />
              </Field>

              <Field label="Owner">
                <Select
                  value={parkingForm.ownerId}
                  onChange={(e) => setParkingForm({ ...parkingForm, ownerId: e.target.value })}
                  required
                >
                  <option value="">Choose owner...</option>
                  {owners.map((owner) => (
                    <option key={owner.id} value={owner.ownerId || owner.id}>
                      {owner.fullName || owner.ownerId} ({owner.email || "no-email"})
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Parking Name">
                <Input value={parkingForm.name} onChange={(e) => setParkingForm({ ...parkingForm, name: e.target.value })} required />
              </Field>

              <Field label="Address">
                <Input value={parkingForm.address} onChange={(e) => setParkingForm({ ...parkingForm, address: e.target.value })} required />
              </Field>

              <div className="grid grid-cols-2 gap-2">
                <Field label="Capacity">
                  <Input type="number" value={parkingForm.slotCapacity} onChange={(e) => setParkingForm({ ...parkingForm, slotCapacity: Number(e.target.value || 0) })} />
                </Field>
                <Field label="Available">
                  <Input type="number" value={parkingForm.availableSlots} onChange={(e) => setParkingForm({ ...parkingForm, availableSlots: Number(e.target.value || 0) })} />
                </Field>
                <Field label="Reserved">
                  <Input type="number" value={parkingForm.reservedSlots} onChange={(e) => setParkingForm({ ...parkingForm, reservedSlots: Number(e.target.value || 0) })} />
                </Field>
                <Field label="Occupied">
                  <Input type="number" value={parkingForm.occupiedSlots} onChange={(e) => setParkingForm({ ...parkingForm, occupiedSlots: Number(e.target.value || 0) })} />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Field label="Hourly Rate">
                  <Input type="number" value={parkingForm.hourlyRate} onChange={(e) => setParkingForm({ ...parkingForm, hourlyRate: Number(e.target.value || 0) })} />
                </Field>
                <Field label="Status">
                  <Select value={parkingForm.status} onChange={(e) => setParkingForm({ ...parkingForm, status: e.target.value })}>
                    <option value="active">active</option>
                    <option value="inactive">inactive</option>
                  </Select>
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Field label="Latitude">
                  <Input type="number" value={parkingForm.lat} onChange={(e) => setParkingForm({ ...parkingForm, lat: Number(e.target.value || 0) })} />
                </Field>
                <Field label="Longitude">
                  <Input type="number" value={parkingForm.lng} onChange={(e) => setParkingForm({ ...parkingForm, lng: Number(e.target.value || 0) })} />
                </Field>
              </div>

              <Button className="w-full" disabled={loading === "upsertParking"}>
                {loading === "upsertParking" ? "Saving..." : "Save Parking"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="animate-fade-in-up">
          <CardHeader>
            <CardTitle>Assign Operator</CardTitle>
            <CardDescription>Map operators to active parking sites.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submitAssignment} className="space-y-3">
              <Field label="Operator">
                <Select
                  value={assignmentForm.operatorUid}
                  onChange={(e) => setAssignmentForm({ ...assignmentForm, operatorUid: e.target.value })}
                  required
                >
                  <option value="">Choose operator...</option>
                  {operators.map((op) => (
                    <option key={op.id} value={op.id}>
                      {op.email} ({op.id})
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Parking">
                <Select
                  value={assignmentForm.parkingId}
                  onChange={(e) => setAssignmentForm({ ...assignmentForm, parkingId: e.target.value })}
                  required
                >
                  <option value="">Choose parking...</option>
                  {parkings.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.id})
                    </option>
                  ))}
                </Select>
              </Field>

              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={assignmentForm.assign}
                  onChange={(e) => setAssignmentForm({ ...assignmentForm, assign: e.target.checked })}
                  className="h-4 w-4 rounded border-border"
                />
                Assign (uncheck to remove)
              </label>

              <Button className="w-full" disabled={loading === "assignOperatorToParking"}>
                {loading === "assignOperatorToParking" ? "Saving..." : "Save Assignment"}
              </Button>
            </form>

            <div className="mt-4 border-t border-border pt-4">
              <p className="mb-2 text-sm font-medium text-slate-700">Current Operators</p>
              <div className="space-y-1 text-xs text-muted-foreground">
                {operators.map((op) => (
                  <div key={op.id} className="rounded-md bg-muted px-2 py-1">
                    <span className="font-medium">{op.email}</span>: {(op.assignedParkingIds || []).join(", ") || "none"}
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function StatCard({ title, value }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm text-muted-foreground">{title}</p>
        <div className="mt-2 flex items-center gap-2">
          <span className="font-heading text-3xl font-bold text-slate-900">{value}</span>
          <Badge variant="secondary">Live</Badge>
        </div>
      </CardContent>
    </Card>
  );
}

export default AdminHome;
