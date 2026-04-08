import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { firestore, functionsClient } from "../firebase";

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
    <div className="container py-4">
      <div className="card border-0 shadow-sm mb-4">
        <div className="card-body">
          <h3 className="fw-bold mb-2">Admin Management Console</h3>
          <p className="text-muted mb-0">Manage owners, parkings, and operator assignments using secure Cloud Functions.</p>
        </div>
      </div>

      <div className="row g-3 mb-4">
        <StatCard title="Owners" value={stats.owners} />
        <StatCard title="Parkings" value={stats.parkings} />
        <StatCard title="Active Parkings" value={stats.activeParkings} />
        <StatCard title="Operators" value={stats.operators} />
      </div>

      <div className="row g-4">
        <div className="col-lg-4">
          <div className="card border-0 shadow-sm h-100">
            <div className="card-body">
              <h5 className="fw-bold mb-3">Create Owner Account</h5>
              <form onSubmit={submitOwner}>
                <FormInput label="Full Name" value={ownerForm.fullName} onChange={(v) => setOwnerForm({ ...ownerForm, fullName: v })} />
                <FormInput label="Email" value={ownerForm.email} onChange={(v) => setOwnerForm({ ...ownerForm, email: v })} />
                <FormInput
                  label="Temporary Password"
                  type="password"
                  value={ownerForm.password}
                  onChange={(v) => setOwnerForm({ ...ownerForm, password: v })}
                />
                <FormInput label="Phone" value={ownerForm.phone} onChange={(v) => setOwnerForm({ ...ownerForm, phone: v })} />
                <FormInput
                  label="Bank Account"
                  value={ownerForm.bankAccountNumber}
                  onChange={(v) => setOwnerForm({ ...ownerForm, bankAccountNumber: v })}
                />
                <button className="btn btn-primary w-100" disabled={loading === "createOwnerAccount"}>
                  {loading === "createOwnerAccount" ? "Creating..." : "Create Owner"}
                </button>
              </form>
            </div>
          </div>
        </div>

        <div className="col-lg-4">
          <div className="card border-0 shadow-sm h-100">
            <div className="card-body">
              <h5 className="fw-bold mb-3">Create / Update Parking</h5>
              <form onSubmit={submitParking}>
                <FormInput
                  label="Parking ID (optional for create)"
                  value={parkingForm.parkingId}
                  required={false}
                  onChange={(v) => setParkingForm({ ...parkingForm, parkingId: v })}
                />
                <div className="mb-2">
                  <label className="form-label small fw-semibold">Owner</label>
                  <select
                    className="form-select"
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
                  </select>
                </div>
                <FormInput label="Parking Name" value={parkingForm.name} onChange={(v) => setParkingForm({ ...parkingForm, name: v })} />
                <FormInput label="Address" value={parkingForm.address} onChange={(v) => setParkingForm({ ...parkingForm, address: v })} />
                <FormInput
                  label="Slot Capacity"
                  type="number"
                  value={parkingForm.slotCapacity}
                  onChange={(v) => setParkingForm({ ...parkingForm, slotCapacity: Number(v || 0) })}
                />
                <FormInput
                  label="Available Slots"
                  type="number"
                  value={parkingForm.availableSlots}
                  onChange={(v) => setParkingForm({ ...parkingForm, availableSlots: Number(v || 0) })}
                />
                <FormInput
                  label="Reserved Slots"
                  type="number"
                  value={parkingForm.reservedSlots}
                  onChange={(v) => setParkingForm({ ...parkingForm, reservedSlots: Number(v || 0) })}
                />
                <FormInput
                  label="Occupied Slots"
                  type="number"
                  value={parkingForm.occupiedSlots}
                  onChange={(v) => setParkingForm({ ...parkingForm, occupiedSlots: Number(v || 0) })}
                />
                <FormInput
                  label="Hourly Rate"
                  type="number"
                  value={parkingForm.hourlyRate}
                  onChange={(v) => setParkingForm({ ...parkingForm, hourlyRate: Number(v || 0) })}
                />
                <FormInput
                  label="Latitude"
                  type="number"
                  value={parkingForm.lat}
                  onChange={(v) => setParkingForm({ ...parkingForm, lat: Number(v || 0) })}
                />
                <FormInput
                  label="Longitude"
                  type="number"
                  value={parkingForm.lng}
                  onChange={(v) => setParkingForm({ ...parkingForm, lng: Number(v || 0) })}
                />
                <div className="mb-2">
                  <label className="form-label small fw-semibold">Status</label>
                  <select
                    className="form-select"
                    value={parkingForm.status}
                    onChange={(e) => setParkingForm({ ...parkingForm, status: e.target.value })}
                  >
                    <option value="active">active</option>
                    <option value="inactive">inactive</option>
                  </select>
                </div>
                <button className="btn btn-primary w-100" disabled={loading === "upsertParking"}>
                  {loading === "upsertParking" ? "Saving..." : "Save Parking"}
                </button>
              </form>
            </div>
          </div>
        </div>

        <div className="col-lg-4">
          <div className="card border-0 shadow-sm h-100">
            <div className="card-body">
              <h5 className="fw-bold mb-3">Assign Operator</h5>
              <form onSubmit={submitAssignment}>
                <div className="mb-2">
                  <label className="form-label small fw-semibold">Operator</label>
                  <select
                    className="form-select"
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
                  </select>
                </div>
                <div className="mb-2">
                  <label className="form-label small fw-semibold">Parking</label>
                  <select
                    className="form-select"
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
                  </select>
                </div>
                <div className="form-check mb-3">
                  <input
                    id="assignment-mode"
                    className="form-check-input"
                    type="checkbox"
                    checked={assignmentForm.assign}
                    onChange={(e) => setAssignmentForm({ ...assignmentForm, assign: e.target.checked })}
                  />
                  <label htmlFor="assignment-mode" className="form-check-label">
                    Assign (uncheck to remove)
                  </label>
                </div>
                <button className="btn btn-primary w-100" disabled={loading === "assignOperatorToParking"}>
                  {loading === "assignOperatorToParking" ? "Saving..." : "Save Assignment"}
                </button>
              </form>

              <hr />
              <h6 className="fw-bold">Current Operators</h6>
              <div className="small text-muted">
                {operators.map((op) => (
                  <div key={op.id} className="mb-1">
                    {op.email}: {(op.assignedParkingIds || []).join(", ") || "none"}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FormInput({ label, value, onChange, type = "text", required = true }) {
  return (
    <div className="mb-2">
      <label className="form-label small fw-semibold">{label}</label>
      <input className="form-control" value={value} type={type} onChange={(e) => onChange(e.target.value)} required={required} />
    </div>
  );
}

function StatCard({ title, value }) {
  return (
    <div className="col-6 col-md-3">
      <div className="card border-0 shadow-sm h-100">
        <div className="card-body">
          <div className="small text-muted">{title}</div>
          <div className="display-6 fw-bold">{value}</div>
        </div>
      </div>
    </div>
  );
}

export default AdminHome;
